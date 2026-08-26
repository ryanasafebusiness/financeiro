"""Funil de vendas: trial limitado (dias + cota), gating por estado, nudges de
urgência, criação de trial e reset mensal pulando trials. Sem rede."""
from datetime import datetime, timedelta, timezone

import pytest

from app import tasks
from app.services import redis_svc, supabase_svc, settings_svc
from tests.conftest import USER_ID, PHONE
from tests.fakes import assistant_tools, tool_call, final

JID = PHONE + "@s.whatsapp.net"


@pytest.fixture(autouse=True)
def _clear_cache():
    settings_svc._cache.clear()
    yield
    settings_svc._cache.clear()


def make_raw(text="oi", msg_id="m1"):
    return {
        "BaseUrl": "https://test.uazapi.com", "token": "test-token",
        "message": {"id": msg_id, "chatid": JID, "sender": JID, "senderName": "Gabriel",
                    "type": "text", "content": text, "fromMe": False, "wasSentByApi": False,
                    "messageTimestamp": 1700000000},
    }


def _set_profile(db, **fields):
    """Muta a linha do perfil semeado (FakeSupabase devolve cópias na leitura)."""
    db.rows("profiles")[0].update(fields)


def _iso(days=0, hours=0):
    return (datetime.now(timezone.utc) + timedelta(days=days, hours=hours)).isoformat()


# ════════════════════════════════════════════════════════════════════════
#  Gating por estado (process_inbound)
# ════════════════════════════════════════════════════════════════════════
def test_trial_dentro_da_cota_processa(make_db, sent, patch_openai):
    db = make_db(premium=True, message_limit=15)
    _set_profile(db, plan="Trial", messages_this_month=2)
    patch_openai([
        assistant_tools(tool_call("registrar_transacao", tipo="gasto", valor=20,
                                  categoria="Transporte", descricao="uber")),
        final({"mensagens_cliente": ["Anotado! 🚗"]}),
    ])
    tasks.process_inbound.apply(args=[make_raw("uber 20")])

    assert len(db.rows("transactions")) == 1
    assert any("Anotado" in t for _, t in sent)


def test_trial_esgotado_por_cota_trava(make_db, sent, patch_openai):
    db = make_db(premium=True, message_limit=15)
    _set_profile(db, plan="Trial", messages_this_month=15)
    patch_openai([])  # o agente NÃO pode ser chamado

    tasks.process_inbound.apply(args=[make_raw("gastei 50")])

    assert len(sent) == 1
    assert "mensagens grátis" in sent[0][1] and "cakto" in sent[0][1].lower()
    assert db.rows("transactions") == []


def test_trial_expirado_por_dias_trava(make_db, sent, patch_openai):
    db = make_db(premium=True, message_limit=15)
    _set_profile(db, plan="Trial", premium_until=_iso(days=-1))
    patch_openai([])

    tasks.process_inbound.apply(args=[make_raw("oi")])

    assert len(sent) == 1 and "teste grátis" in sent[0][1].lower()
    assert db.rows("transactions") == []


def test_pago_esgotado_por_cota_trava(make_db, sent, patch_openai):
    db = make_db(premium=True, message_limit=10)   # plan="Mensal"
    _set_profile(db, messages_this_month=10)
    patch_openai([])

    tasks.process_inbound.apply(args=[make_raw("oi")])

    assert len(sent) == 1 and "limite de mensagens" in sent[0][1].lower()


def test_pago_expirado_trava(make_db, sent, patch_openai):
    db = make_db(premium=True)                      # plan="Mensal"
    _set_profile(db, premium_until=_iso(days=-1))
    patch_openai([])

    tasks.process_inbound.apply(args=[make_raw("oi")])

    assert len(sent) == 1 and "expirou" in sent[0][1].lower()


# ════════════════════════════════════════════════════════════════════════
#  Nudges de urgência (finalize_batch, após responder)
# ════════════════════════════════════════════════════════════════════════
def _drive_finalize(msg_id="m1", text="gastei 20"):
    redis_svc.set_debounce_marker(PHONE, msg_id)
    redis_svc.push_message(PHONE, {"id": msg_id, "message": text, "content_type": "text"})
    tasks.finalize_batch(PHONE, msg_id)


def test_nudge_cota_quase_no_fim(make_db, sent, patch_openai):
    db = make_db(premium=True, message_limit=15)
    _set_profile(db, plan="Trial", messages_this_month=12)   # vira 13 -> restam 2
    patch_openai([final({"mensagens_cliente": ["Anotado!"]})])

    _drive_finalize()

    assert len(sent) == 2                          # resposta + nudge
    assert "restam só 2" in sent[1][1]


def test_nudge_nao_dispara_com_folga(make_db, sent, patch_openai):
    db = make_db(premium=True, message_limit=15)
    _set_profile(db, plan="Trial", messages_this_month=2)    # vira 3 -> restam 12
    patch_openai([final({"mensagens_cliente": ["ok"]})])

    _drive_finalize()

    assert len(sent) == 1                          # só a resposta


def test_nudge_ultimo_dia_trial(make_db, sent, patch_openai):
    db = make_db(premium=True, message_limit=0)     # sem cota; gatilho é por dias
    _set_profile(db, plan="Trial", premium_until=_iso(hours=12))
    patch_openai([final({"mensagens_cliente": ["ok"]})])

    _drive_finalize()

    assert len(sent) == 2 and "termina logo" in sent[1][1].lower()


def test_nudge_respeita_cooldown(make_db, sent, patch_openai):
    db = make_db(premium=True, message_limit=15)
    _set_profile(db, plan="Trial", messages_this_month=12)
    patch_openai([final({"mensagens_cliente": ["a"]}), final({"mensagens_cliente": ["b"]})])

    _drive_finalize("m1")
    _set_profile(db, messages_this_month=13)
    _drive_finalize("m2")

    nudges = [t for _, t in sent if "restam" in t]
    assert len(nudges) == 1                        # cooldown bloqueou o 2º


# ════════════════════════════════════════════════════════════════════════
#  Criação de trial (resolve_or_create_profile) e reset mensal
# ════════════════════════════════════════════════════════════════════════
def test_resolve_cria_trial_com_cota(make_db, monkeypatch):
    db = make_db()
    new_phone = "5585911112222"

    def fake_create(phone, name=""):
        db.seed("profiles", {"id": "22222222-2222-2222-2222-222222222222",
                             "phone": supabase_svc.canonical_phone(phone), "name": name,
                             "messages_this_month": 0, "message_limit": 0})
        return {}
    monkeypatch.setattr(supabase_svc, "create_auth_user", fake_create)

    prof = supabase_svc.resolve_or_create_profile(new_phone, "Maria")

    assert prof["plan"] == "Trial"
    assert prof["message_limit"] == settings_svc.get_trial_message_limit() == 15
    assert datetime.fromisoformat(prof["premium_until"]) > datetime.now(timezone.utc)


def test_reset_mensal_pula_trial(make_db):
    db = make_db(premium=True)                      # USER_ID plan="Mensal"
    _set_profile(db, messages_this_month=8)
    db.seed("profiles", {"id": "33333333-3333-3333-3333-333333333333",
                         "phone": "5585900000000", "plan": "Trial",
                         "messages_this_month": 5, "message_limit": 15})

    supabase_svc.reset_monthly_counters()

    rows = {r["id"]: r for r in db.rows("profiles")}
    assert rows[USER_ID]["messages_this_month"] == 0          # pago zerado
    assert rows["33333333-3333-3333-3333-333333333333"]["messages_this_month"] == 5  # trial preservado
