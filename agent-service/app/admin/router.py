"""API do painel admin do SaaS (protegida por is_admin via JWT)."""
import asyncio
import json
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.admin import log_handler
from app.api.auth import require_admin
from app.datetime_utils import parse_dt
from app.prompts import SYSTEM_PROMPT
from app.services import supabase_svc, settings_svc
from app.services.supabase_svc import get_db

router = APIRouter(prefix="/admin")

# Tickets de uso único p/ autenticar o EventSource (SSE não envia headers)
_sse_tickets: dict[str, str] = {}


@router.post("/api/run-recurring")
def run_recurring(_admin: dict = Depends(require_admin)):
    """Materializa as recorrências vencidas agora (normalmente roda via Celery beat diário)."""
    from app.services import finance_svc
    created = finance_svc.materialize_due()
    return {"ok": True, "created": created}


@router.get("/api/stats")
def stats(_admin: dict = Depends(require_admin)):
    db = get_db()
    now = datetime.now(timezone.utc)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()

    users = db.table("profiles").select("id", count="exact").execute()
    premium = db.table("profiles").select("id", count="exact").gt("premium_until", now.isoformat()).execute()
    msgs_today = db.table("messages").select("id", count="exact").gte("created_at", today).execute()
    msgs_total = db.table("messages").select("id", count="exact").execute()
    tx_total = db.table("transactions").select("id", count="exact").execute()

    pays = db.table("payments").select("amount, event").in_(
        "event", ["purchase_approved", "subscription_created", "subscription_renewed"]
    ).execute()
    revenue = sum(float(p.get("amount") or 0) for p in (pays.data or []))

    return {
        "users": users.count or 0,
        "premium_active": premium.count or 0,
        "messages_today": msgs_today.count or 0,
        "messages_total": msgs_total.count or 0,
        "transactions_total": tx_total.count or 0,
        "revenue": round(revenue, 2),
    }


@router.get("/api/users")
def list_users(search: str = "", limit: int = 100, _admin: dict = Depends(require_admin)):
    q = get_db().table("profiles").select(
        "id, name, phone, email, plan, premium_until, is_admin, ai_online, "
        "messages_this_month, message_limit, created_at"
    )
    if search:
        q = q.or_(f"name.ilike.%{search}%,phone.ilike.%{search}%,email.ilike.%{search}%")
    res = q.order("created_at", desc=True).limit(min(limit, 500)).execute()
    return {"users": res.data or []}


class PremiumBody(BaseModel):
    plan: str = "Premium"
    days: int = 30
    message_limit: Optional[int] = None
    reset_usage: bool = True


@router.post("/api/users/{user_id}/premium")
def grant_premium(user_id: str, body: PremiumBody, _admin: dict = Depends(require_admin)):
    profile = supabase_svc.get_profile(user_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    now = datetime.now(timezone.utc)
    base = now
    dt = parse_dt(profile.get("premium_until"))
    if dt is not None:
        base = max(now, dt)
    until = (base + timedelta(days=int(body.days))).isoformat()

    # Busca message_limit do plano cadastrado se não informado explicitamente.
    msg_limit = body.message_limit
    if msg_limit is None:
        plans = supabase_svc.list_plans()
        match = next((p for p in plans if p["name"] == body.plan), None)
        if match:
            msg_limit = match.get("message_limit")

    supabase_svc.set_premium(user_id, body.plan, until,
                             message_limit=msg_limit, reset_usage=body.reset_usage)
    return {"ok": True, "premium_until": until, "plan": body.plan}


class AiBody(BaseModel):
    online: bool


@router.post("/api/users/{user_id}/ai")
def toggle_ai(user_id: str, body: AiBody, _admin: dict = Depends(require_admin)):
    get_db().table("profiles").update({"ai_online": body.online}).eq("id", user_id).execute()
    return {"ok": True, "ai_online": body.online}


@router.get("/api/messages")
def recent_messages(limit: int = 50, _admin: dict = Depends(require_admin)):
    res = (get_db().table("messages")
           .select("id, chat, message, is_outgoing, ai_generated, created_at")
           .order("created_at", desc=True).limit(min(limit, 200)).execute())
    return {"messages": res.data or []}


@router.get("/api/users/{user_id}/messages")
def user_messages(user_id: str, limit: int = 200, _admin: dict = Depends(require_admin)):
    """Espelhamento da conversa de um usuário (ordem cronológica, mais antiga -> recente)."""
    res = (get_db().table("messages")
           .select("id, chat, message, is_outgoing, ai_generated, created_at")
           .eq("user_id", user_id)
           .order("created_at", desc=True).limit(min(limit, 500)).execute())
    return {"messages": list(reversed(res.data or []))}


@router.get("/api/payments")
def recent_payments(limit: int = 50, _admin: dict = Depends(require_admin)):
    res = (get_db().table("payments")
           .select("id, user_id, event, plan, amount, status, payment_method, created_at")
           .order("created_at", desc=True).limit(min(limit, 200)).execute())
    return {"payments": res.data or []}


@router.get("/api/logs")
def recent_logs(_admin: dict = Depends(require_admin)):
    return {"logs": log_handler.get_recent()[-200:]}


# ── Prompt de sistema do agente ──────────────────────────────────────────────
@router.get("/api/settings/system-prompt")
def get_system_prompt(_admin: dict = Depends(require_admin)):
    current = settings_svc.get_system_prompt(use_cache=False)
    return {
        "prompt": current,
        "default": SYSTEM_PROMPT,
        "is_custom": current.strip() != SYSTEM_PROMPT.strip(),
    }


class SystemPromptBody(BaseModel):
    prompt: str


@router.put("/api/settings/system-prompt")
def update_system_prompt(body: SystemPromptBody, _admin: dict = Depends(require_admin)):
    text = (body.prompt or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="O prompt não pode ficar vazio")
    settings_svc.set_system_prompt(text)
    return {"ok": True, "is_custom": text != SYSTEM_PROMPT.strip()}


@router.post("/api/settings/system-prompt/reset")
def reset_system_prompt(_admin: dict = Depends(require_admin)):
    settings_svc.reset_system_prompt()
    return {"ok": True, "prompt": SYSTEM_PROMPT, "is_custom": False}


# ── Configurações do funil (checkout, trial, nudges) ─────────────────────────
@router.get("/api/settings/funnel")
def get_funnel_settings(_admin: dict = Depends(require_admin)):
    return settings_svc.get_funnel_settings()


class FunnelSettingsBody(BaseModel):
    app_base_url: Optional[str] = None
    trial_days: Optional[int] = None
    trial_message_limit: Optional[int] = None
    nudge_threshold_msgs: Optional[int] = None
    nudge_threshold_days: Optional[int] = None


@router.put("/api/settings/funnel")
def update_funnel_settings(body: FunnelSettingsBody, _admin: dict = Depends(require_admin)):
    data = body.model_dump(exclude_unset=True, exclude_none=True)
    if not data:
        raise HTTPException(status_code=400, detail="Nada a atualizar")
    for key, value in data.items():
        settings_svc.set_funnel_setting(key, value)
    return {"ok": True, **settings_svc.get_funnel_settings()}


# ── Integrações / chaves de API (OpenAI, uazapi, Stripe) ──────────────────────
@router.get("/api/settings/integrations")
def get_integrations(_admin: dict = Depends(require_admin)):
    """Estado das integrações. Segredos vêm MASCARADOS (nunca em texto puro)."""
    return settings_svc.get_integration_settings()


class IntegrationsBody(BaseModel):
    openai_api_key: Optional[str] = None
    openai_model: Optional[str] = None
    openai_vision_model: Optional[str] = None
    openai_transcribe_model: Optional[str] = None
    openai_guardrails_model: Optional[str] = None
    uazapi_base_url: Optional[str] = None
    uazapi_token: Optional[str] = None
    stripe_secret_key: Optional[str] = None
    stripe_webhook_secret: Optional[str] = None


@router.put("/api/settings/integrations")
def update_integrations(body: IntegrationsBody, _admin: dict = Depends(require_admin)):
    """Salva só os campos enviados e não-vazios. Campo vazio = manter o atual
    (não dá p/ apagar uma chave pelo painel; isso evita zerar por engano)."""
    data = body.model_dump(exclude_unset=True, exclude_none=True)
    saved = []
    for key, value in data.items():
        value = (value or "").strip()
        if not value:                 # vazio -> mantém o valor atual
            continue
        settings_svc.set_integration_setting(key, value)
        saved.append(key)
    if not saved:
        raise HTTPException(status_code=400, detail="Nada a atualizar")
    return {"ok": True, "saved": saved, **{"settings": settings_svc.get_integration_settings()}}


# ── Saúde da integração Stripe ────────────────────────────────────────────────
@router.get("/api/stripe/health")
def stripe_health(_admin: dict = Depends(require_admin)):
    """Checklist do que ainda falta para as assinaturas funcionarem."""
    plans = supabase_svc.list_plans()
    active_plans = [p for p in plans if p.get("active")]
    # Um plano só é vendável se tiver um Price recorrente da Stripe colado nele.
    missing_price = [
        p["name"] for p in active_plans
        if not str(p.get("stripe_price_id") or "").startswith("price_")
    ]
    # O avulso é opcional (só destrava MB WAY/Multibanco), então não reprova o ok.
    missing_onetime = [
        p["name"] for p in active_plans
        if not str(p.get("stripe_price_id_onetime") or "").startswith("price_")
    ]
    secret_key = settings_svc.get_stripe_secret_key()
    base_url = settings_svc.get_app_base_url()
    ok = (
        bool(secret_key)
        and bool(settings_svc.get_stripe_webhook_secret())
        and len(active_plans) > 0
        and len(missing_price) == 0
    )
    return {
        "secret_key_set": bool(secret_key),
        "livemode": secret_key.startswith("sk_live_"),
        "webhook_secret_set": bool(settings_svc.get_stripe_webhook_secret()),
        "webhook_url": f"{base_url}/webhooks/stripe",
        "app_base_url": base_url,
        "plans_active": len(active_plans),
        "plans_missing_price": missing_price,
        "plans_missing_onetime": missing_onetime,
        "trial_days": settings_svc.get_trial_days(),
        "trial_message_limit": settings_svc.get_trial_message_limit(),
        "ok": ok,
    }


# ── CRUD de planos ─────────────────────────────────────────────────────────────
@router.get("/api/plans")
def list_plans(_admin: dict = Depends(require_admin)):
    return {"plans": supabase_svc.list_plans()}


class PlanBody(BaseModel):
    name: str
    price: float
    duration_days: int
    message_limit: int = 0
    stripe_price_id: str = ""
    stripe_price_id_onetime: str = ""
    active: bool = True


@router.post("/api/plans")
def create_plan(body: PlanBody, _admin: dict = Depends(require_admin)):
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="Nome do plano é obrigatório")
    if body.price < 0:
        raise HTTPException(status_code=400, detail="Preço não pode ser negativo")
    if body.duration_days < 1:
        raise HTTPException(status_code=400, detail="Duração mínima é 1 dia")
    plan = supabase_svc.create_plan(body.model_dump())
    return {"ok": True, "plan": plan}


class PlanPatch(BaseModel):
    name: Optional[str] = None
    price: Optional[float] = None
    duration_days: Optional[int] = None
    message_limit: Optional[int] = None
    stripe_price_id: Optional[str] = None
    stripe_price_id_onetime: Optional[str] = None
    active: Optional[bool] = None


@router.patch("/api/plans/{plan_id}")
def update_plan(plan_id: str, body: PlanPatch, _admin: dict = Depends(require_admin)):
    data = body.model_dump(exclude_unset=True, exclude_none=True)
    if not data:
        raise HTTPException(status_code=400, detail="Nada a atualizar")
    plan = supabase_svc.update_plan(plan_id, data)
    return {"ok": True, "plan": plan}


@router.delete("/api/plans/{plan_id}")
def delete_plan(plan_id: str, _admin: dict = Depends(require_admin)):
    supabase_svc.delete_plan(plan_id)
    return {"ok": True}


# ── SSE de logs ───────────────────────────────────────────────────────────────
@router.post("/api/ticket")
def create_ticket(admin: dict = Depends(require_admin)):
    ticket = secrets.token_urlsafe(32)
    _sse_tickets[ticket] = admin["id"]
    return {"ticket": ticket}


@router.get("/api/logs/stream")
async def stream_logs(ticket: str):
    if _sse_tickets.pop(ticket, None) is None:
        raise HTTPException(status_code=401, detail="Ticket inválido")
    queue = log_handler.subscribe()

    async def gen():
        try:
            for entry in log_handler.get_recent()[-30:]:
                yield f"data: {json.dumps(entry)}\n\n"
            while True:
                try:
                    entry = await asyncio.wait_for(queue.get(), timeout=25)
                    yield f"data: {json.dumps(entry)}\n\n"
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
        finally:
            log_handler.unsubscribe(queue)

    return StreamingResponse(gen(), media_type="text/event-stream")
