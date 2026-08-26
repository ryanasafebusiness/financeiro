"""Redis síncrono: dedupe de webhook, fila de debounce, OTP e cooldowns.

Usa um cliente síncrono porque o pipeline roda dentro de tasks Celery (prefork).
Defina REDIS_URL=fake para usar fakeredis em memória (dev, sem servidor).

Padrão de debounce (idiomático em Celery, sem polling):
  - cada mensagem é empurrada para a lista `batch:{sender}`;
  - grava-se o marcador `debounce:{sender}` = id_da_mensagem;
  - agenda-se finalize_batch(sender, id) com countdown=DEBOUNCE_SECONDS;
  - quando o finalize dispara, ele só "vence" se o marcador ainda for o seu id
    (caso contrário chegou mensagem mais nova e outro finalize cuidará do lote).
"""
import json
import logging
from urllib.parse import urlsplit

import redis as _redis_lib

from app.config import settings

log = logging.getLogger(__name__)

_client = None


def _safe_redis_target(redis_url: str) -> str:
    """Identifica o destino sem registrar usuário, senha ou query string."""
    parsed = urlsplit(redis_url)
    host = parsed.hostname or "unknown-host"
    port = f":{parsed.port}" if parsed.port else ""
    return f"{parsed.scheme or 'redis'}://{host}{port}"


def get_client():
    global _client
    if _client is None:
        redis_url = settings.effective_redis_url
        if redis_url.lower() == "fake":
            if settings.vercel_queue_enabled:
                raise RuntimeError("REDIS_URL/KV_URL precisa apontar para um Redis persistente na Vercel")
            import fakeredis
            _client = fakeredis.FakeStrictRedis(decode_responses=True)
            log.info("Redis: usando fakeredis (em memória)")
        else:
            _client = _redis_lib.Redis.from_url(redis_url, decode_responses=True)
            log.info("Redis conectado: %s", _safe_redis_target(redis_url))
    return _client


# ── dedupe de webhook ─────────────────────────────────────────────────────────
def dedupe_seen(key: str, ttl: int) -> bool:
    """True se é a 1ª vez que `key` aparece (e reserva por ttl s). False se duplicado."""
    return bool(get_client().set(key, "1", nx=True, ex=ttl))


# ── fila de debounce ──────────────────────────────────────────────────────────
def push_message(sender: str, payload: dict) -> None:
    get_client().rpush(f"batch:{sender}", json.dumps(payload, ensure_ascii=False))


def drain_batch(sender: str) -> list[dict]:
    """Lê e apaga atomicamente a lista de mensagens pendentes."""
    pipe = get_client().pipeline()
    pipe.lrange(f"batch:{sender}", 0, -1)
    pipe.delete(f"batch:{sender}")
    results = pipe.execute()
    raw = results[0] or []
    out = []
    for r in raw:
        try:
            out.append(json.loads(r))
        except Exception:
            pass
    return out


def set_debounce_marker(sender: str, msg_id: str, ttl: int = 120) -> None:
    get_client().set(f"debounce:{sender}", msg_id, ex=ttl)


def get_debounce_marker(sender: str) -> str | None:
    return get_client().get(f"debounce:{sender}")


def clear_debounce_marker(sender: str) -> None:
    get_client().delete(f"debounce:{sender}")


# ── OTP (login do painel) ─────────────────────────────────────────────────────
def set_otp(phone: str, code: str, ttl: int = 300) -> None:
    get_client().set(f"otp:{phone}", code, ex=ttl)


def get_otp(phone: str) -> str | None:
    return get_client().get(f"otp:{phone}")


def delete_otp(phone: str) -> None:
    get_client().delete(f"otp:{phone}")


def otp_rate_limited(phone: str, window: int = 60) -> bool:
    """True se já houve um pedido de OTP nos últimos `window` s (anti-spam)."""
    ok = get_client().set(f"otp_rl:{phone}", "1", nx=True, ex=window)
    return not bool(ok)


# ── cooldown genérico (ex.: aviso de plano inativo) ──────────────────────────
def cooldown_passed(key: str, ttl: int) -> bool:
    """True (e arma o cooldown) se a chave não existia. False se ainda em cooldown."""
    return bool(get_client().set(key, "1", nx=True, ex=ttl))
