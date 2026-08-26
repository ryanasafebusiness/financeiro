"""Rotas da API do painel (conveniência). O CRUD pesado é feito direto via
Supabase JS com RLS; aqui ficam só agregações que dependem de cálculo."""
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.auth import require_user
from app.api.otp import router as otp_router
from app.config import settings
from app.services import finance_svc, stripe_svc, supabase_svc, settings_svc

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
    return {"plans": res.data or []}


def _real_email(profile: dict) -> str | None:
    """E-mail para pré-preencher no checkout — só se for um e-mail de verdade.

    Quem entra pelo WhatsApp recebe um e-mail sintético (wa<telefone>@<domínio>)
    que não existe como caixa. Passar isso como `customer_email` faria a Stripe
    TRAVAR o campo e mandar o recibo para o vazio; melhor deixar o cliente
    digitar o próprio e-mail.
    """
    email = (profile.get("email") or "").strip().lower()
    if not email or email.endswith(f"@{settings.email_domain}"):
        return None
    return email


class CheckoutBody(BaseModel):
    plan_id: str


@router.post("/api/checkout")
def create_checkout(body: CheckoutBody, profile: dict = Depends(require_user)):
    """Abre uma Checkout Session da Stripe para o plano escolhido.

    Devolve a URL hospedada pela Stripe; quem redireciona é o painel. O acesso
    premium NÃO é liberado aqui — só pelo webhook, que é a única fonte confiável
    de que o pagamento aconteceu de verdade.
    """
    plan = supabase_svc.get_plan_by_id(body.plan_id)
    if not plan or not plan.get("active"):
        raise HTTPException(status_code=404, detail="Plano não encontrado")

    price_id = str(plan.get("stripe_price_id") or "")
    if not price_id.startswith("price_"):
        raise HTTPException(
            status_code=409,
            detail="Plano ainda não está ligado a um preço da Stripe. Avise o suporte.",
        )

    base = settings_svc.get_app_base_url()
    try:
        session = stripe_svc.create_checkout_session(
            price_id=price_id,
            profile_id=profile["id"],
            plan_id=str(plan["id"]),
            success_url=f"{base}/assinatura?checkout=sucesso",
            cancel_url=f"{base}/assinatura?checkout=cancelado",
            customer_email=_real_email(profile),
            phone=profile.get("phone") or None,
        )
    except RuntimeError as e:                      # Stripe não configurada
        log.error("checkout: %s", e)
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:                         # erro da API da Stripe
        log.exception("checkout: falha ao criar sessão")
        raise HTTPException(status_code=502, detail=f"Falha ao abrir o checkout: {e}")

    return {"url": session["url"], "session_id": session["id"]}
