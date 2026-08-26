"""Fixtures e ambiente de teste do ZapWallet.

Define env vars dummy ANTES de importar a app (settings exige algumas), troca o
client Supabase por um dublê em memória, deixa o OpenAI scriptável e captura os
envios à uazapi. Nada de rede.
"""
import os

os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-service-key")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("OPENAI_API_KEY", "sk-test")
os.environ.setdefault("REDIS_URL", "fake")
os.environ.setdefault("UAZAPI_BASE_URL", "https://test.uazapi.com")
os.environ.setdefault("UAZAPI_TOKEN", "test-token")
os.environ.setdefault("STRIPE_SECRET_KEY", "sk_test_zapwallet")
os.environ.setdefault("STRIPE_WEBHOOK_SECRET", "whsec_test")
os.environ.setdefault("FREE_TRIAL_DAYS", "7")
os.environ.setdefault("APP_BASE_URL", "https://app.zapwallet.test")

from datetime import datetime, timedelta, timezone  # noqa: E402

import pytest  # noqa: E402

from app.config import settings  # noqa: E402
from app.celery_app import celery  # noqa: E402
from app.services import (  # noqa: E402
    supabase_svc, redis_svc, uazapi_svc, media_svc, guardrails_svc, ai_agent_svc,
    openai_client,
)
from tests.fakes import FakeSupabase, FakeOpenAI  # noqa: E402

USER_ID = "11111111-1111-1111-1111-111111111111"
PHONE = "5585999999999"


@pytest.fixture(autouse=True)
def _fast(monkeypatch):
    """Desliga o 'digitando…' p/ evitar sleeps e fixa debounce baixo."""
    monkeypatch.setattr(settings, "presence_typing", False, raising=False)
    monkeypatch.setattr(settings, "debounce_seconds", 0, raising=False)
    # Em modo eager, propaga exceções das tasks p/ aparecerem nos testes.
    monkeypatch.setattr(celery.conf, "task_eager_propagates", True, raising=False)


@pytest.fixture(autouse=True)
def _clear_settings_cache():
    """Isola o cache global de settings/clients entre testes (evita vazamento)."""
    from app.services import settings_svc, openai_client
    settings_svc._cache.clear()
    openai_client._cache.update({"key": None, "client": None})
    yield
    settings_svc._cache.clear()
    openai_client._cache.update({"key": None, "client": None})


@pytest.fixture(autouse=True)
def clean_redis():
    """Zera o fakeredis entre testes."""
    try:
        redis_svc.get_client().flushall()
    except Exception:
        pass
    yield
    try:
        redis_svc.get_client().flushall()
    except Exception:
        pass


def _seed(db: FakeSupabase, *, premium=True, ai_online=True, message_limit=0, is_admin=False):
    until = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat() if premium else None
    db.seed("profiles", {
        "id": USER_ID,
        "name": "Gabriel",
        "phone": PHONE,
        "email": f"wa{PHONE}@zapwallet.app",
        "premium_until": until,
        "plan": "Mensal" if premium else None,
        "is_admin": is_admin,
        "ai_online": ai_online,
        "messages_this_month": 0,
        "message_limit": message_limit,
        "timezone": "America/Fortaleza",
        "currency": "EUR",
    })
    # Categorias do próprio usuário (modelo por-usuário: cada perfil tem a sua cópia).
    for name, typ, emoji, desc in [
        ("Alimentação", "expense", "🍔", "ifood, restaurante, lanche, padaria"),
        ("Transporte", "expense", "🚗", "uber, 99, combustível, ônibus"),
        ("Mercado", "expense", "🛒", "supermercado, feira, hortifruti"),
        ("Outros", "expense", "📦", None),
        ("Salário", "income", "💰", "pagamento do trabalho"),
    ]:
        db.seed("categories", {"id": None, "user_id": USER_ID, "name": name,
                               "type": typ, "emoji": emoji, "description": desc})


@pytest.fixture
def db(monkeypatch):
    """FakeSupabase semeado com 1 usuário premium + categorias padrão."""
    fake = FakeSupabase()
    _seed(fake)
    monkeypatch.setattr(supabase_svc, "_client", fake)
    return fake


@pytest.fixture
def make_db(monkeypatch):
    """Fábrica p/ cenários específicos (ex.: usuário sem plano)."""
    def _factory(**kwargs):
        fake = FakeSupabase()
        _seed(fake, **kwargs)
        monkeypatch.setattr(supabase_svc, "_client", fake)
        return fake
    return _factory


@pytest.fixture
def profile(db):
    return supabase_svc.get_profile(USER_ID)


@pytest.fixture
def ctx(profile):
    return {"user_id": USER_ID, "profile": profile}


@pytest.fixture
def patch_openai(monkeypatch):
    """Instala um FakeOpenAI scriptado como o client do agente e o devolve.

    O agente resolve o client via openai_client.get() (chave dinâmica do painel),
    então o fake é injetado aí — vale p/ ai_agent_svc, media_svc e guardrails_svc.
    """
    def _install(script):
        fake = FakeOpenAI(script)
        monkeypatch.setattr(openai_client, "get", lambda: fake)
        return fake
    return _install


@pytest.fixture
def sent(monkeypatch):
    """Captura mensagens enviadas à uazapi e neutraliza mídia/guardrails."""
    outbox: list[tuple[str, str]] = []

    def _send_text(number, text, delay_ms=None, **kw):
        outbox.append((number, text))
        return True

    monkeypatch.setattr(uazapi_svc, "send_text", _send_text)
    monkeypatch.setattr(uazapi_svc, "send_presence", lambda *a, **k: None)
    monkeypatch.setattr(uazapi_svc, "mark_read", lambda *a, **k: None)
    monkeypatch.setattr(uazapi_svc, "send_media", lambda *a, **k: True)
    monkeypatch.setattr(guardrails_svc, "check_jailbreak", lambda *a, **k: False)
    monkeypatch.setattr(media_svc, "transcribe_audio", lambda *a, **k: "transcrição de teste")
    monkeypatch.setattr(media_svc, "describe_image", lambda *a, **k: "comprovante de 50 € no mercado")
    return outbox


@pytest.fixture
def sent_media(monkeypatch):
    """Captura envios de mídia à uazapi (ex.: relatório em PDF). Lista de payloads (dict)."""
    outbox: list[dict] = []

    def _send_media(number, file, media_type="document", *, doc_name=None, text=None,
                    mimetype=None, delay_ms=None, base_url="", token="", **_):
        outbox.append({"number": number, "file": file, "media_type": media_type,
                       "doc_name": doc_name, "text": text, "mimetype": mimetype})
        return True

    monkeypatch.setattr(uazapi_svc, "send_media", _send_media)
    return outbox
