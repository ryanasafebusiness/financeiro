"""Prompt de sistema editável pelo admin: fallback, override, cache e uso no agente.

O prompt vive em app_settings (Supabase compartilhado com a Railway). Enquanto o
admin não customiza, vale o default do código; o cache curto segura a leitura por
um TTL e é invalidado ao salvar.
"""
import pytest

from app.config import settings
from app.prompts import SYSTEM_PROMPT
from app.services import settings_svc, ai_agent_svc


@pytest.fixture(autouse=True)
def _clear_cache():
    settings_svc._cache.clear()
    yield
    settings_svc._cache.clear()


def test_default_quando_sem_override(db):
    assert settings_svc.get_system_prompt() == SYSTEM_PROMPT


def test_override_salvo_e_lido(db):
    settings_svc.set_system_prompt("Você é o Zaq, responda curto.")
    assert settings_svc.get_system_prompt(use_cache=False) == "Você é o Zaq, responda curto."
    assert any(r["key"] == "system_prompt" for r in db.rows("app_settings"))


def test_reset_volta_ao_default(db):
    settings_svc.set_system_prompt("custom")
    settings_svc.reset_system_prompt()
    assert settings_svc.get_system_prompt(use_cache=False) == SYSTEM_PROMPT
    assert not [r for r in db.rows("app_settings") if r["key"] == "system_prompt"]


def test_valor_em_branco_cai_no_default(db):
    settings_svc.set_system_prompt("   ")
    assert settings_svc.get_system_prompt(use_cache=False) == SYSTEM_PROMPT


def test_cache_segura_por_ttl_e_invalida_no_set(db):
    assert settings_svc.get_system_prompt() == SYSTEM_PROMPT  # popula cache
    # Escrita direta no banco (sem passar pelo service) NÃO invalida o cache local.
    db.table("app_settings").upsert(
        {"key": "system_prompt", "value": "VINDO_DO_BANCO"}, on_conflict="key"
    ).execute()
    assert settings_svc.get_system_prompt() == SYSTEM_PROMPT          # ainda do cache
    assert settings_svc.get_system_prompt(use_cache=False) == "VINDO_DO_BANCO"
    # set_system_prompt invalida o cache deste processo.
    settings_svc.set_system_prompt("SALVO_PELO_ADMIN")
    assert settings_svc.get_system_prompt() == "SALVO_PELO_ADMIN"


# ── Config do funil (fonte única: app_settings, com fallback ao .env) ──────────
def test_funnel_defaults_sem_override(db):
    assert settings_svc.get_checkout_url() == settings.checkout_url
    assert settings_svc.get_trial_days() == settings.free_trial_days
    assert settings_svc.get_trial_message_limit() == 15
    assert settings_svc.get_nudge_threshold_msgs() == 3
    assert settings_svc.get_nudge_threshold_days() == 1


def test_funnel_override_lido_e_salvo(db):
    settings_svc.set_funnel_setting(settings_svc.TRIAL_MESSAGE_LIMIT_KEY, 25)
    assert settings_svc.get_trial_message_limit() == 25
    assert any(r["key"] == "trial_message_limit" for r in db.rows("app_settings"))


def test_funnel_checkout_override(db):
    settings_svc.set_funnel_setting(settings_svc.CHECKOUT_URL_KEY, "https://pay.cakto.com.br/nova")
    assert settings_svc.get_checkout_url() == "https://pay.cakto.com.br/nova"


def test_funnel_chave_invalida_levanta(db):
    with pytest.raises(ValueError):
        settings_svc.set_funnel_setting("chave_inexistente", 1)


def test_funnel_cast_invalido_cai_no_default(db):
    settings_svc.set_funnel_setting(settings_svc.TRIAL_DAYS_KEY, "abc")
    assert settings_svc.get_trial_days() == settings.free_trial_days


def test_funnel_fallback_quando_banco_off(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("db off")
    monkeypatch.setattr(settings_svc, "get_db", boom)
    assert settings_svc.get_trial_message_limit() == 15
    assert settings_svc.get_checkout_url() == settings.checkout_url


def test_agente_usa_prompt_do_banco(profile, patch_openai):
    from tests.fakes import final

    settings_svc.set_system_prompt("PERSONA_CUSTOMIZADA_XYZ")
    fake = patch_openai([final({"nao_responder": False, "mensagens_cliente": ["oi"]})])

    result = ai_agent_svc.run("session-x", "oi", profile)

    assert result["mensagens_cliente"] == ["oi"]
    system_msg = fake.calls[0]["messages"][0]
    assert system_msg["role"] == "system"
    assert "PERSONA_CUSTOMIZADA_XYZ" in system_msg["content"]


# ── Integrações / chaves de API (app_secrets, fallback ao .env) ────────────────
def test_integration_defaults_sem_override(db):
    assert settings_svc.get_openai_api_key() == settings.openai_api_key
    assert settings_svc.get_openai_model() == settings.openai_model
    assert settings_svc.get_uazapi_base_url() == settings.uazapi_base_url
    assert settings_svc.get_uazapi_token() == settings.uazapi_token
    assert settings_svc.get_cakto_webhook_secret() == settings.cakto_webhook_secret


def test_integration_override_lido_e_salvo(db):
    settings_svc.set_integration_setting(settings_svc.OPENAI_API_KEY_KEY, "sk-nova-do-painel")
    assert settings_svc.get_openai_api_key() == "sk-nova-do-painel"
    # segredo vai p/ app_secrets (tabela bloqueada), NÃO p/ app_settings
    assert any(r["key"] == "openai_api_key" for r in db.rows("app_secrets"))
    assert not any(r["key"] == "openai_api_key" for r in db.rows("app_settings"))


def test_integration_chave_invalida_levanta(db):
    with pytest.raises(ValueError):
        settings_svc.set_integration_setting("chave_que_nao_existe", "x")


def test_integration_fallback_quando_banco_off(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("db off")
    monkeypatch.setattr(settings_svc, "get_db", boom)
    assert settings_svc.get_openai_api_key() == settings.openai_api_key
    assert settings_svc.get_uazapi_token() == settings.uazapi_token


def test_integration_snapshot_mascara_segredos(db):
    settings_svc.set_integration_setting(settings_svc.OPENAI_API_KEY_KEY, "sk-abcd1234efgh5678")
    settings_svc.set_integration_setting(settings_svc.OPENAI_MODEL_KEY, "gpt-4o")
    snap = settings_svc.get_integration_settings()
    # segredo: só mascarado, nunca o valor cru
    assert "value" not in snap["openai_api_key"]
    assert snap["openai_api_key"]["masked"] == "sk-a••••5678"
    assert snap["openai_api_key"]["set"] is True and snap["openai_api_key"]["from_db"] is True
    # não-segredo (modelo): valor em claro
    assert snap["openai_model"]["value"] == "gpt-4o"
    # nenhum valor cru de segredo aparece no snapshot inteiro
    import json as _json
    assert "sk-abcd1234efgh5678" not in _json.dumps(snap)


def test_integration_snapshot_marca_origem_env(db):
    snap = settings_svc.get_integration_settings()
    # sem override no banco -> from_db False, mas set True (vem do .env)
    assert snap["openai_api_key"]["from_db"] is False
    assert snap["openai_api_key"]["set"] is True


def test_openai_client_recria_quando_chave_muda(db):
    from app.services import openai_client
    openai_client._cache.update({"key": None, "client": None})
    c1 = openai_client.get()
    assert openai_client.get() is c1            # mesma chave -> mesmo client (cacheado)
    settings_svc.set_integration_setting(settings_svc.OPENAI_API_KEY_KEY, "sk-trocada-agora")
    c2 = openai_client.get()
    assert c2 is not c1                          # chave nova -> client recriado
