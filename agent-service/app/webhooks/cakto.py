"""Webhook da Cakto — libera/revoga o acesso premium.

Payload (resumo): { secret, event, data: { id, refId, customer{name,email,phone},
offer{id,name,price}, product, status, amount, paymentMethod } }

Eventos que LIBERAM:  purchase_approved, subscription_created, subscription_renewed
Eventos que REVOGAM:  refund, chargeback
Apenas auditados:     subscription_canceled, subscription_renewal_refused, pix_gerado, ...
"""
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.datetime_utils import parse_dt
from app.services import supabase_svc, settings_svc
from app.services.supabase_svc import only_digits

log = logging.getLogger(__name__)
router = APIRouter(prefix="/webhooks")

GRANT_EVENTS = {"purchase_approved", "subscription_created", "subscription_renewed"}
REVOKE_EVENTS = {"refund", "chargeback"}


def _canonical_br_phone(phone: str) -> str:
    """Normaliza p/ 55DDDNÚMERO (formato do remetente WhatsApp)."""
    d = only_digits(phone)
    if not d:
        return ""
    if d.startswith("55") and len(d) >= 12:
        return d
    if len(d) in (10, 11):       # DDD + número, sem código do país
        return "55" + d
    return d


def _extend_premium(profile: dict, duration_days: int) -> str:
    now = datetime.now(timezone.utc)
    base = now
    dt = parse_dt(profile.get("premium_until"))
    if dt is not None:
        base = max(now, dt)
    return (base + timedelta(days=duration_days)).isoformat()


@router.post("/cakto")
async def cakto_webhook(request: Request):
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"ok": False, "detail": "json inválido"}, status_code=400)

    # Validação do secret (campo no corpo) — vigente: painel admin > .env
    expected_secret = settings_svc.get_cakto_webhook_secret()
    if expected_secret and body.get("secret") != expected_secret:
        log.warning("Cakto: secret inválido")
        return JSONResponse({"ok": False, "detail": "secret inválido"}, status_code=401)

    event = body.get("event", "")
    data = body.get("data") or {}
    customer = data.get("customer") or {}
    offer = data.get("offer") or {}
    phone = _canonical_br_phone(customer.get("phone", ""))
    email = (customer.get("email") or "").strip().lower()
    offer_id = offer.get("id") or ""

    plan_row = supabase_svc.get_plan_by_offer(offer_id)
    plan_name = plan_row["name"] if plan_row else (offer.get("name") or "Premium")
    duration_days = plan_row["duration_days"] if plan_row else 30
    message_limit = plan_row["message_limit"] if plan_row else 0

    # Acha/cria o perfil (paga-primeiro também funciona)
    profile = None
    if phone:
        profile = supabase_svc.get_profile_by_phone(phone) or supabase_svc.resolve_or_create_profile(
            phone, customer.get("name", "")
        )
    if not profile and email:
        res = supabase_svc.get_db().table("profiles").select("*").eq("email", email).limit(1).execute()
        profile = res.data[0] if res.data else None

    # Auditoria
    supabase_svc.record_payment({
        "user_id": profile["id"] if profile else None,
        "cakto_transaction_id": data.get("id"),
        "ref_id": data.get("refId"),
        "event": event,
        "plan": plan_name,
        "offer_id": offer_id,
        "amount": data.get("amount") or data.get("baseAmount"),
        "status": data.get("status"),
        "payment_method": data.get("paymentMethod"),
        "raw": body,
    })

    if not profile:
        log.warning("Cakto: perfil não encontrado (phone=%s email=%s) — pagamento auditado", phone, email)
        return {"ok": True, "matched": False}

    if event in GRANT_EVENTS:
        until = _extend_premium(profile, duration_days)
        # reset_usage=True: zera o contador (trial -> pago, ou renovação começa o mês limpo)
        supabase_svc.set_premium(profile["id"], plan_name, until, message_limit, reset_usage=True)
        log.info("Cakto: %s liberou %s até %s p/ user=%s", event, plan_name, until, profile["id"])
    elif event in REVOKE_EVENTS:
        now_iso = datetime.now(timezone.utc).isoformat()
        supabase_svc.set_premium(profile["id"], None, now_iso, 0)
        log.info("Cakto: %s revogou acesso de user=%s", event, profile["id"])
    else:
        log.info("Cakto: evento %s apenas auditado p/ user=%s", event, profile["id"])

    return {"ok": True, "matched": True, "event": event}
