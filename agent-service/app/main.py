"""ZapWallet — FastAPI.

Recebe o webhook da uazapi e enfileira no Vercel Queues em produção ou no
Celery em desenvolvimento/deploy tradicional.
"""
import hmac
import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from app.admin import log_handler as _log_handler
from app.admin.router import router as admin_router
from app.api.router import router as api_router
from app.config import settings
from app.tasks import finalize_batch_payload, process_inbound, process_inbound_payload
from app.services import finance_svc, supabase_svc, vercel_queue_svc
from app.webhooks.cakto import router as cakto_router

# Handler de logs do admin antes do basicConfig
_admin_handler = _log_handler.AdminLogHandler()
_admin_handler.setFormatter(logging.Formatter("%(message)s"))
logging.root.addHandler(_admin_handler)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s – %(message)s")
log = logging.getLogger(__name__)

app = FastAPI(title="ZapWallet API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)
app.include_router(admin_router)
app.include_router(cakto_router)


@app.post("/webhook")
async def webhook(request: Request):
    """Webhook da uazapi. Enfileira e retorna imediatamente."""
    try:
        raw = await request.json()
    except Exception:
        return {"status": "ignored"}

    # Só processa eventos de mensagem
    if not (isinstance(raw, dict) and raw.get("message")):
        return {"status": "ignored"}

    if settings.vercel_queue_enabled:
        msg_id = str((raw.get("message") or {}).get("id") or "")
        try:
            queue_id = await vercel_queue_svc.publish(
                request,
                vercel_queue_svc.INBOUND_TOPIC,
                raw,
                idempotency_key=f"inbound-{msg_id}" if msg_id else "",
            )
        except vercel_queue_svc.QueuePublishError as exc:
            log.error("Falha ao enfileirar webhook: %s", exc)
            raise HTTPException(status_code=503, detail="Fila temporariamente indisponível") from exc
        return {"status": "accepted", "queue_id": queue_id}

    process_inbound.delay(raw)
    return {"status": "accepted", "queue": "celery"}


def _require_queue_bridge(request: Request) -> None:
    expected = settings.queue_bridge_secret
    received = request.headers.get("x-queue-bridge-secret", "")
    if not expected or not hmac.compare_digest(received, expected):
        raise HTTPException(status_code=401, detail="Consumidor de fila inválido")


@app.post("/internal/queues/process-inbound", include_in_schema=False)
async def queue_process_inbound(request: Request):
    _require_queue_bridge(request)
    raw = await request.json()
    pending = process_inbound_payload(raw)
    return {"status": "processed", "finalize": pending}


@app.post("/internal/queues/finalize", include_in_schema=False)
async def queue_finalize(request: Request):
    _require_queue_bridge(request)
    body = await request.json()
    sender = str(body.get("sender") or "")
    msg_id = str(body.get("msg_id") or "")
    if not sender or not msg_id:
        raise HTTPException(status_code=400, detail="sender e msg_id são obrigatórios")
    finalize_batch_payload(sender, msg_id)
    return {"status": "processed"}


def _require_cron(request: Request) -> None:
    expected = settings.cron_secret
    received = request.headers.get("authorization", "")
    if not expected or not hmac.compare_digest(received, f"Bearer {expected}"):
        raise HTTPException(status_code=401, detail="Cron inválido")


@app.get("/api/cron/materialize-recurring", include_in_schema=False)
async def cron_materialize_recurring(request: Request):
    _require_cron(request)
    return {"ok": True, "created": finance_svc.materialize_due()}


@app.get("/api/cron/reset-monthly", include_in_schema=False)
async def cron_reset_monthly(request: Request):
    _require_cron(request)
    return {"ok": True, "reset": supabase_svc.reset_monthly_counters()}


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "queue": "vercel" if settings.vercel_queue_enabled else "celery",
    }
