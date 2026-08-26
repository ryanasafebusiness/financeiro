"""Testes dos endpoints de admin que tocam o Supabase (sem rede).

Chamam as funções do router direto, passando `_admin={}` no lugar da dependência
`require_admin` (a auth por JWT é validada na camada FastAPI, não aqui).
"""
import pytest

from app.admin import router as admin_router
from app.services import settings_svc

USER_ID = "11111111-1111-1111-1111-111111111111"
OTHER_ID = "22222222-2222-2222-2222-222222222222"


def _seed_msg(db, user_id, message, *, is_outgoing, ai_generated=False, created_at):
    db.seed("messages", {
        "id": None,
        "user_id": user_id,
        "chat": "5585999999999",
        "message": message,
        "is_outgoing": is_outgoing,
        "ai_generated": ai_generated,
        "created_at": created_at,
    })


def test_user_messages_scoped_and_chronological(db):
    # Lote do usuário pedido + 1 mensagem de outro usuário (não deve vazar).
    _seed_msg(db, USER_ID, "oi", is_outgoing=False,
              created_at="2026-02-01T10:00:00+00:00")
    _seed_msg(db, USER_ID, "olá! como posso ajudar?", is_outgoing=True,
              ai_generated=True, created_at="2026-02-01T10:00:05+00:00")
    _seed_msg(db, OTHER_ID, "mensagem de outro usuário", is_outgoing=False,
              created_at="2026-02-01T10:00:03+00:00")

    res = admin_router.user_messages(USER_ID, _admin={})
    msgs = res["messages"]

    # Só as do usuário pedido, em ordem cronológica ascendente (mais antiga -> recente).
    assert [m["message"] for m in msgs] == ["oi", "olá! como posso ajudar?"]
    assert msgs[0]["created_at"] < msgs[1]["created_at"]
    assert msgs[1]["ai_generated"] is True


def test_user_messages_empty(db):
    res = admin_router.user_messages(OTHER_ID, _admin={})
    assert res["messages"] == []


# ── Integrações / chaves de API ───────────────────────────────────────────────
def test_get_integrations_mascara_e_marca_origem(db):
    res = admin_router.get_integrations(_admin={})
    # segredo nunca em texto puro; default vem do .env (from_db False, set True)
    assert "value" not in res["openai_api_key"]
    assert "masked" in res["openai_api_key"]
    assert res["openai_api_key"]["from_db"] is False
    assert res["openai_api_key"]["set"] is True


def test_put_integrations_salva_e_reflete(db):
    body = admin_router.IntegrationsBody(openai_api_key="sk-painel-12345678")
    out = admin_router.update_integrations(body, _admin={})
    assert out["ok"] and out["saved"] == ["openai_api_key"]
    assert settings_svc.get_openai_api_key() == "sk-painel-12345678"
    # snapshot reflete origem banco + mascarado
    snap = out["settings"]["openai_api_key"]
    assert snap["from_db"] is True and snap["masked"] == "sk-p••••5678"


def test_put_integrations_campo_vazio_nao_sobrescreve(db):
    settings_svc.set_integration_setting(settings_svc.OPENAI_API_KEY_KEY, "sk-existente-999")
    # manda key vazia (mantém) + model novo (salva)
    body = admin_router.IntegrationsBody(openai_api_key="", openai_model="gpt-4o-mini-x")
    out = admin_router.update_integrations(body, _admin={})
    assert out["saved"] == ["openai_model"]
    assert settings_svc.get_openai_api_key() == "sk-existente-999"   # preservada
    assert settings_svc.get_openai_model() == "gpt-4o-mini-x"


def test_put_integrations_tudo_vazio_400(db):
    from fastapi import HTTPException
    body = admin_router.IntegrationsBody(openai_api_key="   ")
    with pytest.raises(HTTPException) as e:
        admin_router.update_integrations(body, _admin={})
    assert e.value.status_code == 400


def test_stripe_health_le_secret_do_painel(db):
    # Sem secret no .env de teste? há ("test-secret"). Com override pelo painel:
    settings_svc.set_integration_setting(settings_svc.STRIPE_WEBHOOK_SECRET_KEY, "whsec_novo")
    res = admin_router.stripe_health(_admin={})
    assert res["webhook_secret_set"] is True
