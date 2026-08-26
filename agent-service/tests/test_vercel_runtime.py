from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.services import finance_svc, supabase_svc, vercel_queue_svc
from app.services.redis_svc import _safe_redis_target
from tests.test_pipeline import make_raw


def test_redis_log_target_never_exposes_credentials():
    target = _safe_redis_target(
        "rediss://default:super-secret@endpoint.upstash.io:6379/0?token=also-secret"
    )
    assert target == "rediss://endpoint.upstash.io:6379"
    assert "secret" not in target


def test_health_informa_modo_da_fila(monkeypatch):
    monkeypatch.setattr(settings, "vercel_queue_enabled", True)
    response = TestClient(app).get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "queue": "vercel"}


def test_webhook_publica_na_vercel_queue(monkeypatch):
    monkeypatch.setattr(settings, "vercel_queue_enabled", True)
    captured = {}

    async def fake_publish(request, topic, payload, **options):
        captured.update(topic=topic, payload=payload, options=options)
        return "msg_test"

    monkeypatch.setattr(vercel_queue_svc, "publish", fake_publish)
    response = TestClient(app).post("/webhook", json=make_raw("oi", msg_id="queue-1"))

    assert response.status_code == 200
    assert response.json()["queue_id"] == "msg_test"
    assert captured["topic"] == vercel_queue_svc.INBOUND_TOPIC
    assert captured["options"]["idempotency_key"] == "inbound-queue-1"


def test_cron_exige_segredo(monkeypatch):
    monkeypatch.setattr(settings, "cron_secret", "cron-test-secret")
    client = TestClient(app)
    assert client.get("/api/cron/materialize-recurring").status_code == 401

    monkeypatch.setattr(finance_svc, "materialize_due", lambda: 2)
    response = client.get(
        "/api/cron/materialize-recurring",
        headers={"authorization": "Bearer cron-test-secret"},
    )
    assert response.status_code == 200
    assert response.json() == {"ok": True, "created": 2}


def test_reset_mensal_cron(monkeypatch):
    monkeypatch.setattr(settings, "cron_secret", "cron-test-secret")
    monkeypatch.setattr(supabase_svc, "reset_monthly_counters", lambda: 3)
    response = TestClient(app).get(
        "/api/cron/reset-monthly",
        headers={"authorization": "Bearer cron-test-secret"},
    )
    assert response.status_code == 200
    assert response.json() == {"ok": True, "reset": 3}
