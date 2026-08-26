"""Webhook da Stripe — libera/renova/revoga o acesso premium (assinaturas).

Eventos tratados
  checkout.session.completed     primeira compra: libera na hora (boa UX no retorno)
  invoice.paid                   primeira cobrança E renovações: fonte da verdade do período
  customer.subscription.deleted  assinatura encerrada: revoga
  invoice.payment_failed         só auditado (a Stripe ainda vai tentar de novo)
  customer.subscription.updated  só auditado

Duas garantias importantes:
  • A assinatura do corpo é verificada (Stripe-Signature) com o corpo CRU.
  • `premium_until` é ATRIBUÍDO (não incrementado) a partir do fim do período da
    Stripe. Assim uma reentrega do mesmo evento — que é normal — não estende o
    acesso duas vezes.
"""
import logging
from datetime import datetime, timedelta, timezone

import stripe
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.services import stripe_svc, supabase_svc
from app.services.supabase_svc import only_digits

log = logging.getLogger(__name__)
router = APIRouter(prefix="/webhooks")

GRANT_EVENTS = {"checkout.session.completed", "invoice.paid"}
REVOKE_EVENTS = {"customer.subscription.deleted"}


def _phone_from_e164(raw: str) -> str:
    """'+351 912 345 678' -> '351912345678'.

    A Stripe devolve E.164, que já traz o código do país — o mesmo formato que o
    remetente do WhatsApp usa (só dígitos). Não assumimos país nenhum aqui.
    """
    return only_digits(raw or "")


def _period_end(obj: dict) -> datetime | None:
    """Fim do período pago, quando o payload informa (epoch -> datetime UTC)."""
    ts = None
    # invoice.paid: o período vem na linha da assinatura
    for line in ((obj.get("lines") or {}).get("data") or []):
        period = line.get("period") or {}
        if period.get("end"):
            ts = max(ts or 0, int(period["end"]))
    # customer.subscription.*: campo direto (API antiga)
    if ts is None and obj.get("current_period_end"):
        ts = int(obj["current_period_end"])
    # A partir de 2025-03-31 o current_period_end saiu da assinatura e passou
    # a viver em cada item — sem isto, versão nova devolveria None aqui.
    if ts is None:
        for item in ((obj.get("items") or {}).get("data") or []):
            if item.get("current_period_end"):
                ts = max(ts or 0, int(item["current_period_end"]))
    if not ts:
        return None
    return datetime.fromtimestamp(ts, tz=timezone.utc)


def _subscription_metadata(obj: dict) -> dict:
    """Metadata da assinatura, que é o que sobrevive às renovações."""
    details = obj.get("subscription_details") or {}
    if details.get("metadata"):
        return details["metadata"]
    # Versões mais novas aninham em parent.subscription_details
    parent = (obj.get("parent") or {}).get("subscription_details") or {}
    if parent.get("metadata"):
        return parent["metadata"]
    return obj.get("metadata") or {}


def _price_id(obj: dict) -> str:
    for line in ((obj.get("lines") or {}).get("data") or []):
        price = line.get("price") or {}
        if price.get("id"):
            return price["id"]
        pricing = ((line.get("pricing") or {}).get("price_details") or {})
        if pricing.get("price"):
            return pricing["price"]
    items = ((obj.get("items") or {}).get("data") or [])
    for item in items:
        if (item.get("price") or {}).get("id"):
            return item["price"]["id"]
    return ""


def _subscription_id(obj: dict) -> str:
    sub = obj.get("subscription")
    if isinstance(sub, str):
        return sub
    if isinstance(sub, dict):
        return sub.get("id") or ""
    parent = (obj.get("parent") or {}).get("subscription_details") or {}
    if isinstance(parent.get("subscription"), str):
        return parent["subscription"]
    # o próprio objeto é a assinatura
    if str(obj.get("object")) == "subscription":
        return obj.get("id") or ""
    return ""


def _resolve_profile(obj: dict, meta: dict) -> dict | None:
    """Acha o usuário: id no metadata > telefone > e-mail.

    O id vem do client_reference_id/metadata que nós mesmos gravamos na criação
    da sessão — é o caminho confiável. Telefone e e-mail são a rede de segurança
    para quem pagou antes de existir no sistema.
    """
    profile_id = meta.get("profile_id") or obj.get("client_reference_id")
    if profile_id:
        profile = supabase_svc.get_profile(str(profile_id))
        if profile:
            return profile
        log.warning("Stripe: profile_id %s não encontrado — caindo p/ telefone", profile_id)

    customer = obj.get("customer_details") or {}
    phone = _phone_from_e164(customer.get("phone") or meta.get("phone") or "")
    name = customer.get("name") or ""
    if phone:
        return supabase_svc.get_profile_by_phone(phone) or supabase_svc.resolve_or_create_profile(
            phone, name
        )

    email = (customer.get("email") or "").strip().lower()
    if email:
        res = supabase_svc.get_db().table("profiles").select("*").eq("email", email).limit(1).execute()
        if res.data:
            return res.data[0]
    return None


@router.post("/stripe")
async def stripe_webhook(request: Request):
    payload = await request.body()          # CRU: reserializar quebra a assinatura
    signature = request.headers.get("stripe-signature", "")

    try:
        event = stripe_svc.construct_event(payload, signature)
    except stripe.SignatureVerificationError:
        log.warning("Stripe: assinatura inválida no webhook")
        return JSONResponse({"ok": False, "detail": "assinatura inválida"}, status_code=401)
    except ValueError:
        return JSONResponse({"ok": False, "detail": "payload inválido"}, status_code=400)
    except RuntimeError as e:                # signing secret não configurado
        log.error("Stripe: %s", e)
        return JSONResponse({"ok": False, "detail": str(e)}, status_code=503)

    event_type = event["type"]
    obj = dict(event["data"]["object"])
    meta = _subscription_metadata(obj)

    price_id = _price_id(obj)
    plan_row = (
        supabase_svc.get_plan_by_id(str(meta["plan_id"])) if meta.get("plan_id") else None
    ) or supabase_svc.get_plan_by_price(price_id)

    plan_name = plan_row["name"] if plan_row else "Premium"
    duration_days = plan_row["duration_days"] if plan_row else 30
    message_limit = plan_row["message_limit"] if plan_row else 0

    profile = _resolve_profile(obj, meta)

    # Auditoria — sempre, mesmo sem casar usuário. O unique (stripe_event_id,
    # event) faz a reentrega virar no-op.
    supabase_svc.record_payment({
        "user_id": profile["id"] if profile else None,
        "stripe_event_id": event["id"],
        "ref_id": obj.get("id"),
        "event": event_type,
        "plan": plan_name,
        "price_id": price_id,
        "subscription_id": _subscription_id(obj),
        "customer_id": obj.get("customer") if isinstance(obj.get("customer"), str) else None,
        "amount": _amount(obj),
        "status": obj.get("status"),
        "payment_method": "stripe",
        "raw": dict(event),
    })

    if not profile:
        log.warning("Stripe: evento %s sem usuário correspondente — apenas auditado", event_type)
        return {"ok": True, "matched": False}

    if event_type in GRANT_EVENTS:
        if event_type == "invoice.paid" and str(obj.get("status")) not in ("paid", "", "None"):
            log.info("Stripe: invoice %s não está paga (%s) — só auditado", obj.get("id"), obj.get("status"))
            return {"ok": True, "matched": True, "event": event_type}

        end = _period_end(obj)
        until = (end or datetime.now(timezone.utc) + timedelta(days=duration_days)).isoformat()
        # reset_usage=True: trial -> pago, e cada renovação começa o mês limpo.
        supabase_svc.set_premium(profile["id"], plan_name, until, message_limit, reset_usage=True)
        log.info("Stripe: %s liberou %s até %s p/ user=%s", event_type, plan_name, until, profile["id"])

    elif event_type in REVOKE_EVENTS:
        now_iso = datetime.now(timezone.utc).isoformat()
        supabase_svc.set_premium(profile["id"], None, now_iso, 0)
        log.info("Stripe: %s revogou acesso de user=%s", event_type, profile["id"])

    else:
        log.info("Stripe: evento %s apenas auditado p/ user=%s", event_type, profile["id"])

    return {"ok": True, "matched": True, "event": event_type}


def _amount(obj: dict):
    """Centavos -> unidade monetária (a Stripe trabalha na menor unidade)."""
    for field in ("amount_paid", "amount_total", "amount"):
        v = obj.get(field)
        if isinstance(v, (int, float)):
            return round(v / 100, 2)
    return None
