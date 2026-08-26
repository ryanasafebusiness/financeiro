"""Configurações globais editáveis pelo admin (tabela app_settings, key/value jsonb).

A MESMA instância do Supabase é compartilhada entre o painel admin e o
agent-service na Railway. Então o prompt de sistema que o admin salva aqui chega
ao agente sem precisar de deploy: o agente lê desta tabela a cada lote, com um
cache curto (TTL) por processo para não bater no banco em toda mensagem.

O default fica no código (`app.prompts.SYSTEM_PROMPT`) e serve de fallback —
enquanto o admin não customizar, nenhuma linha existe em app_settings.
"""
import logging
import time
from datetime import datetime, timezone

from app.config import settings
from app.prompts import SYSTEM_PROMPT
from app.services.supabase_svc import get_db

log = logging.getLogger(__name__)

SYSTEM_PROMPT_KEY = "system_prompt"

# ── Funil / Cakto (fonte única; o backend lê DAQUI, não do .env) ───────────────
CHECKOUT_URL_KEY = "checkout_url"
TRIAL_DAYS_KEY = "trial_days"
TRIAL_MESSAGE_LIMIT_KEY = "trial_message_limit"
NUDGE_THRESHOLD_MSGS_KEY = "nudge_threshold_msgs"
NUDGE_THRESHOLD_DAYS_KEY = "nudge_threshold_days"
_FUNNEL_KEYS = {
    CHECKOUT_URL_KEY, TRIAL_DAYS_KEY, TRIAL_MESSAGE_LIMIT_KEY,
    NUDGE_THRESHOLD_MSGS_KEY, NUDGE_THRESHOLD_DAYS_KEY,
}

# ── Integrações / chaves de API (vivem em app_secrets — tabela BLOQUEADA) ───────
# app_secrets não tem policy de SELECT pública: só a service-role (este backend)
# lê/escreve. Por isso segredos NUNCA são expostos ao frontend direto — o painel
# admin os acessa via endpoints que mascaram os valores.
OPENAI_API_KEY_KEY = "openai_api_key"
OPENAI_MODEL_KEY = "openai_model"
OPENAI_VISION_MODEL_KEY = "openai_vision_model"
OPENAI_TRANSCRIBE_MODEL_KEY = "openai_transcribe_model"
OPENAI_GUARDRAILS_MODEL_KEY = "openai_guardrails_model"
UAZAPI_BASE_URL_KEY = "uazapi_base_url"
UAZAPI_TOKEN_KEY = "uazapi_token"
CAKTO_WEBHOOK_SECRET_KEY = "cakto_webhook_secret"
_INTEGRATION_KEYS = {
    OPENAI_API_KEY_KEY, OPENAI_MODEL_KEY, OPENAI_VISION_MODEL_KEY,
    OPENAI_TRANSCRIBE_MODEL_KEY, OPENAI_GUARDRAILS_MODEL_KEY,
    UAZAPI_BASE_URL_KEY, UAZAPI_TOKEN_KEY, CAKTO_WEBHOOK_SECRET_KEY,
}
# Quais valores são segredos (mascarados ao expor no painel).
_SECRET_INTEGRATION_KEYS = {OPENAI_API_KEY_KEY, UAZAPI_TOKEN_KEY, CAKTO_WEBHOOK_SECRET_KEY}
_SECRETS_TABLE = "app_secrets"

_CACHE_TTL = 30.0  # segundos — janela de sincronização entre salvar e o agente ver

_cache: dict[str, tuple[float, object]] = {}


def _read_setting(key: str):
    res = get_db().table("app_settings").select("value").eq("key", key).limit(1).execute()
    return res.data[0].get("value") if res.data else None


def get_system_prompt(use_cache: bool = True) -> str:
    """Prompt de sistema vigente (override do admin ou default do código)."""
    if use_cache:
        hit = _cache.get(SYSTEM_PROMPT_KEY)
        if hit and (time.monotonic() - hit[0]) < _CACHE_TTL:
            return hit[1]
    try:
        value = _read_setting(SYSTEM_PROMPT_KEY)
    except Exception as e:  # banco indisponível -> não derruba o agente
        log.warning("Falha lendo system_prompt; usando default: %s", e)
        value = None
    prompt = value if isinstance(value, str) and value.strip() else SYSTEM_PROMPT
    _cache[SYSTEM_PROMPT_KEY] = (time.monotonic(), prompt)
    return prompt


def set_system_prompt(text: str) -> None:
    """Salva o override do admin e invalida o cache local deste processo."""
    get_db().table("app_settings").upsert(
        {"key": SYSTEM_PROMPT_KEY, "value": text,
         "updated_at": datetime.now(timezone.utc).isoformat()},
        on_conflict="key",
    ).execute()
    _cache.pop(SYSTEM_PROMPT_KEY, None)


def reset_system_prompt() -> None:
    """Remove o override -> volta a usar o default do código."""
    get_db().table("app_settings").delete().eq("key", SYSTEM_PROMPT_KEY).execute()
    _cache.pop(SYSTEM_PROMPT_KEY, None)


# ── Funil / Cakto — leitura com cache + fallback tolerante a banco off ─────────
def _get_raw(key: str):
    """Valor cru de app_settings[key] com cache curto. None se ausente.

    Tolerante a falha de banco (igual `get_system_prompt`): se a leitura
    estourar, devolve None SEM cachear, p/ o chamador cair no default.
    """
    hit = _cache.get(key)
    if hit and (time.monotonic() - hit[0]) < _CACHE_TTL:
        return hit[1]
    try:
        value = _read_setting(key)
    except Exception as e:  # banco indisponível -> usa o fallback do chamador
        log.warning("Falha lendo %s; usando fallback: %s", key, e)
        return None
    _cache[key] = (time.monotonic(), value)
    return value


def _get_int(key: str, default: int) -> int:
    v = _get_raw(key)
    if v is None or (isinstance(v, str) and not v.strip()):
        return int(default)
    try:
        return int(v)
    except (TypeError, ValueError):
        return int(default)


def get_checkout_url() -> str:
    """URL de checkout vigente (override do admin ou default do .env)."""
    v = _get_raw(CHECKOUT_URL_KEY)
    return v if isinstance(v, str) and v.strip() else settings.checkout_url


def get_trial_days() -> int:
    return _get_int(TRIAL_DAYS_KEY, settings.free_trial_days)


def get_trial_message_limit() -> int:
    return _get_int(TRIAL_MESSAGE_LIMIT_KEY, 15)


def get_nudge_threshold_msgs() -> int:
    return _get_int(NUDGE_THRESHOLD_MSGS_KEY, 3)


def get_nudge_threshold_days() -> int:
    return _get_int(NUDGE_THRESHOLD_DAYS_KEY, 1)


def get_funnel_settings() -> dict:
    """Snapshot de toda a config do funil (p/ o endpoint admin)."""
    return {
        "checkout_url": get_checkout_url(),
        "trial_days": get_trial_days(),
        "trial_message_limit": get_trial_message_limit(),
        "nudge_threshold_msgs": get_nudge_threshold_msgs(),
        "nudge_threshold_days": get_nudge_threshold_days(),
    }


def set_funnel_setting(key: str, value) -> None:
    """Salva uma config do funil em app_settings e invalida o cache local."""
    if key not in _FUNNEL_KEYS:
        raise ValueError(f"chave de funil desconhecida: {key}")
    get_db().table("app_settings").upsert(
        {"key": key, "value": value,
         "updated_at": datetime.now(timezone.utc).isoformat()},
        on_conflict="key",
    ).execute()
    _cache.pop(key, None)


# ── Integrações / chaves de API — leitura de app_secrets, fallback ao .env ─────
def _read_secret(key: str):
    res = get_db().table(_SECRETS_TABLE).select("value").eq("key", key).limit(1).execute()
    return res.data[0].get("value") if res.data else None


def _get_secret_raw(key: str):
    """Valor cru de app_secrets[key] com cache curto. None se ausente/banco off."""
    ckey = f"__secret__{key}"
    hit = _cache.get(ckey)
    if hit and (time.monotonic() - hit[0]) < _CACHE_TTL:
        return hit[1]
    try:
        value = _read_secret(key)
    except Exception as e:  # banco off / tabela ausente -> usa o fallback do .env
        log.warning("Falha lendo secret %s; usando fallback: %s", key, e)
        return None
    _cache[ckey] = (time.monotonic(), value)
    return value


def _secret_or(key: str, fallback: str) -> str:
    v = _get_secret_raw(key)
    return v if isinstance(v, str) and v.strip() else (fallback or "")


def get_openai_api_key() -> str:
    return _secret_or(OPENAI_API_KEY_KEY, settings.openai_api_key)


def get_openai_model() -> str:
    return _secret_or(OPENAI_MODEL_KEY, settings.openai_model)


def get_openai_vision_model() -> str:
    return _secret_or(OPENAI_VISION_MODEL_KEY, settings.openai_vision_model)


def get_openai_transcribe_model() -> str:
    return _secret_or(OPENAI_TRANSCRIBE_MODEL_KEY, settings.openai_transcribe_model)


def get_openai_guardrails_model() -> str:
    return _secret_or(OPENAI_GUARDRAILS_MODEL_KEY, settings.openai_guardrails_model)


def get_uazapi_base_url() -> str:
    return _secret_or(UAZAPI_BASE_URL_KEY, settings.uazapi_base_url)


def get_uazapi_token() -> str:
    return _secret_or(UAZAPI_TOKEN_KEY, settings.uazapi_token)


def get_cakto_webhook_secret() -> str:
    return _secret_or(CAKTO_WEBHOOK_SECRET_KEY, settings.cakto_webhook_secret)


def _mask(v: str) -> str:
    """Mascara um segredo p/ exibição: sk-a••••••wxyz (nunca o valor completo)."""
    v = v or ""
    if not v:
        return ""
    if len(v) <= 8:
        return "•" * len(v)
    return f"{v[:4]}••••{v[-4:]}"


def get_integration_settings() -> dict:
    """Snapshot p/ o painel admin: segredos mascarados, modelos/URL em claro, e
    flags `set`/`from_db` por chave. NUNCA devolve segredo em texto puro."""
    _ENV_FALLBACK = {
        OPENAI_API_KEY_KEY: settings.openai_api_key,
        OPENAI_MODEL_KEY: settings.openai_model,
        OPENAI_VISION_MODEL_KEY: settings.openai_vision_model,
        OPENAI_TRANSCRIBE_MODEL_KEY: settings.openai_transcribe_model,
        OPENAI_GUARDRAILS_MODEL_KEY: settings.openai_guardrails_model,
        UAZAPI_BASE_URL_KEY: settings.uazapi_base_url,
        UAZAPI_TOKEN_KEY: settings.uazapi_token,
        CAKTO_WEBHOOK_SECRET_KEY: settings.cakto_webhook_secret,
    }
    out = {}
    for key in _INTEGRATION_KEYS:
        raw = _get_secret_raw(key)
        from_db = isinstance(raw, str) and raw.strip() != ""
        effective = (raw if from_db else _ENV_FALLBACK.get(key)) or ""
        effective = effective if isinstance(effective, str) else str(effective)
        entry = {"set": bool(effective), "from_db": from_db}
        if key in _SECRET_INTEGRATION_KEYS:
            entry["masked"] = _mask(effective)
        else:
            entry["value"] = effective
        out[key] = entry
    return out


def set_integration_setting(key: str, value: str) -> None:
    """Grava uma chave de integração em app_secrets e invalida o cache local."""
    if key not in _INTEGRATION_KEYS:
        raise ValueError(f"chave de integração desconhecida: {key}")
    get_db().table(_SECRETS_TABLE).upsert(
        {"key": key, "value": value,
         "updated_at": datetime.now(timezone.utc).isoformat()},
        on_conflict="key",
    ).execute()
    _cache.pop(f"__secret__{key}", None)
