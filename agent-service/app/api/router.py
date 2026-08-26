"""Rotas da API do painel (conveniência). O CRUD pesado é feito direto via
Supabase JS com RLS; aqui ficam só agregações que dependem de cálculo."""
import logging
from datetime import datetime

from fastapi import APIRouter, Depends

from app.api.auth import require_user
from app.api.otp import router as otp_router
from app.config import settings
from app.services import finance_svc, supabase_svc, settings_svc

log = logging.getLogger(__name__)
router = APIRouter()
router.include_router(otp_router)


@router.get("/api/me")
def me(profile: dict = Depends(require_user)):
    """Perfil + panorama do mês corrente (atalho p/ o dashboard)."""
    from zoneinfo import ZoneInfo
    tz = ZoneInfo(profile.get("timezone") or settings.app_tz)
    today = datetime.now(tz).date()
    d0, d1 = finance_svc.month_bounds(today)
    return {
        "profile": {
            "id": profile["id"],
            "name": profile.get("name"),
            "phone": profile.get("phone"),
            "plan": profile.get("plan"),
            "premium_until": profile.get("premium_until"),
            "is_premium": supabase_svc.is_premium_active(profile),
            "is_admin": profile.get("is_admin", False),
        },
        "mes_atual": finance_svc.summary(profile["id"], d0, d1),
        "gasto_por_categoria": finance_svc.spending_by_category(profile["id"], d0, d1),
        "limites": finance_svc.limit_status(profile["id"]),
    }


@router.get("/api/plans")
def plans():
    res = supabase_svc.get_db().table("plans").select(
        "id, name, price, duration_days, message_limit, active"
    ).eq("active", True).order("price").execute()
    return {"plans": res.data or [], "checkout_url": settings_svc.get_checkout_url()}
