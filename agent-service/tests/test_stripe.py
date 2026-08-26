"""Testes do webhook da Stripe: verificação de assinatura, liberação na compra,
renovação, revogação, dedup de reentrega e casamento do usuário.

Sem rede: a assinatura é gerada localmente com o mesmo HMAC que a Stripe usa, e
o `construct_event` do SDK faz a verificação de verdade (nada é mockado aqui).
"""
import asyncio
import hashlib
import hmac
import json
import time
from datetime import datetime, timezone

import pytest

from app.services import supabase_svc
from app.services.supabase_svc import is_premium_active
from app.webhooks import stripe_webhook
from tests.conftest import USER_ID, PHONE

SECRET = "whsec_test"          # igual ao STRIPE_WEBHOOK_SECRET do conftest
PRICE_ID = "price_mensal123"
PLAN_ID = "plan-mensal-uuid"
PRICE_ID_AVULSO = "price_mensal_avulso123"


def sign(payload: bytes, secret: str = SECRET, timestamp: int | None = None) -> str:
    """Monta o header Stripe-Signature exatamente como a Stripe monta."""
    ts = timestamp or int(time.time())
    mac = hmac.new(secret.encode(), f"{ts}.{payload.decode()}".encode(), hashlib.sha256)
    return f"t={ts},v1={mac.hexdigest()}"


class FakeRequest:
    def __init__(self, payload: bytes, signature: str):
        self._payload = payload
        self.headers = {"stripe-signature": signature}

    async def body(self) -> bytes:
        return self._payload


def call(event: dict, *, secret: str = SECRET, timestamp: int | None = None):
    payload = json.dumps(event).encode()
    req = FakeRequest(payload, sign(payload, secret, timestamp))
    return asyncio.run(stripe_webhook.stripe_webhook(req))


# ── fábricas de evento ───────────────────────────────────────────────────────
def checkout_completed(*, event_id="evt_1", profile_id=USER_ID, phone="", email="",
                       plan_id=PLAN_ID, payment_status="paid", subscription="sub_1",
                       event_type="checkout.session.completed"):
    return {
        "id": event_id,
        "type": event_type,
        "data": {"object": {
            "id": "cs_test_1",
            "object": "checkout.session",
            "client_reference_id": profile_id,
            "customer": "cus_1",
            "subscription": subscription,
            "amount_total": 499,
            "status": "complete",
            "payment_status": payment_status,
            "metadata": {"profile_id": profile_id or "", "plan_id": plan_id},
            "customer_details": {"name": "Gabriel", "email": email, "phone": phone},
        }},
    }


def invoice_paid(*, event_id="evt_2", period_end: int, profile_id=USER_ID, status="paid"):
    return {
        "id": event_id,
        "type": "invoice.paid",
        "data": {"object": {
            "id": "in_1",
            "object": "invoice",
            "customer": "cus_1",
            "subscription": "sub_1",
            "status": status,
            "amount_paid": 1990,
            "subscription_details": {"metadata": {"profile_id": profile_id}},
            "lines": {"data": [{
                "price": {"id": PRICE_ID},
                "period": {"start": period_end - 2_592_000, "end": period_end},
            }]},
        }},
    }


def subscription_deleted(*, event_id="evt_3", profile_id=USER_ID):
    return {
        "id": event_id,
        "type": "customer.subscription.deleted",
        "data": {"object": {
            "id": "sub_1",
            "object": "subscription",
            "customer": "cus_1",
            "status": "canceled",
            "metadata": {"profile_id": profile_id},
            "items": {"data": [{"price": {"id": PRICE_ID}}]},
        }},
    }


@pytest.fixture
def with_plan(db):
    db.seed("plans", {
        "id": PLAN_ID, "name": "Mensal", "price": 4.99, "duration_days": 30,
        "message_limit": 300, "stripe_price_id": PRICE_ID,
        "stripe_price_id_onetime": PRICE_ID_AVULSO, "active": True,
    })
    return db


# ── verificação de assinatura ────────────────────────────────────────────────
def test_assinatura_invalida_401(with_plan):
    resp = call(checkout_completed(), secret="whsec_errado")
    assert getattr(resp, "status_code", None) == 401


def test_assinatura_expirada_401(with_plan):
    """Replay velho: fora da tolerância de 5 min, a Stripe (e nós) recusa."""
    resp = call(checkout_completed(), timestamp=int(time.time()) - 3600)
    assert getattr(resp, "status_code", None) == 401


def test_corpo_adulterado_401(with_plan):
    payload = json.dumps(checkout_completed()).encode()
    signature = sign(payload)
    adulterado = payload.replace(b'"amount_total": 499', b'"amount_total": 1')
    assert adulterado != payload, "o teste precisa realmente alterar o corpo"
    resp = asyncio.run(stripe_webhook.stripe_webhook(FakeRequest(adulterado, signature)))
    assert getattr(resp, "status_code", None) == 401


# ── liberação ────────────────────────────────────────────────────────────────
def test_checkout_completed_libera(with_plan):
    supabase_svc.set_premium(USER_ID, None, None)
    out = call(checkout_completed())
    prof = supabase_svc.get_profile(USER_ID)
    assert out["matched"] is True
    assert is_premium_active(prof) is True and prof["plan"] == "Mensal"


def test_checkout_sem_metadata_de_plano_cai_no_generico(with_plan):
    """Sessão sem plan_id (ex.: link criado à mão no painel da Stripe): libera
    como "Premium" por 30 dias e o invoice.paid seguinte corrige o plano."""
    supabase_svc.set_premium(USER_ID, None, None)
    call(checkout_completed(plan_id=""))
    prof = supabase_svc.get_profile(USER_ID)
    assert prof["plan"] == "Premium" and is_premium_active(prof)


def test_checkout_completed_registra_pagamento(with_plan):
    call(checkout_completed())
    pays = with_plan.rows("payments")
    assert len(pays) == 1
    assert pays[0]["event"] == "checkout.session.completed"
    assert pays[0]["stripe_event_id"] == "evt_1"
    assert pays[0]["amount"] == 4.99        # centavos convertidos


def test_checkout_completed_zera_uso(with_plan):
    supabase_svc.get_db().table("profiles").update(
        {"messages_this_month": 9}).eq("id", USER_ID).execute()
    call(checkout_completed())
    assert supabase_svc.get_profile(USER_ID)["messages_this_month"] == 0


def test_invoice_paid_usa_periodo_da_stripe(with_plan):
    """O fim do acesso vem do período da Stripe, não de um cálculo nosso."""
    supabase_svc.set_premium(USER_ID, None, None)
    end = int(time.time()) + 30 * 86400
    call(invoice_paid(period_end=end))
    prof = supabase_svc.get_profile(USER_ID)
    assert is_premium_active(prof)
    from app.datetime_utils import parse_dt
    assert int(parse_dt(prof["premium_until"]).timestamp()) == end


def test_invoice_paid_renova_sem_empilhar(with_plan):
    """Renovação ATRIBUI o novo fim de período — nunca soma em cima do anterior."""
    end1 = int(time.time()) + 30 * 86400
    call(invoice_paid(event_id="evt_a", period_end=end1))
    end2 = end1 + 30 * 86400
    call(invoice_paid(event_id="evt_b", period_end=end2))
    from app.datetime_utils import parse_dt
    prof = supabase_svc.get_profile(USER_ID)
    assert int(parse_dt(prof["premium_until"]).timestamp()) == end2


def invoice_paid_dahlia(*, event_id="evt_d", period_end: int, profile_id=USER_ID):
    """Formato da API 2026-05-27.dahlia — que é a versão fixada no endpoint real.

    Nela a Stripe moveu os dados da assinatura para `parent.subscription_details`
    e o preço da linha para `pricing.price_details.price`. Sem cobrir isso, uma
    renovação em produção quebraria em silêncio.
    """
    return {
        "id": event_id,
        "type": "invoice.paid",
        "data": {"object": {
            "id": "in_2",
            "object": "invoice",
            "customer": "cus_1",
            "status": "paid",
            "amount_paid": 1990,
            "parent": {"subscription_details": {
                "subscription": "sub_1",
                "metadata": {"profile_id": profile_id},
            }},
            "lines": {"data": [{
                "pricing": {"price_details": {"price": PRICE_ID}},
                "period": {"start": period_end - 2_592_000, "end": period_end},
            }]},
        }},
    }


def test_invoice_paid_formato_novo_da_api(with_plan):
    supabase_svc.set_premium(USER_ID, None, None)
    end = int(time.time()) + 30 * 86400
    out = call(invoice_paid_dahlia(period_end=end))
    prof = supabase_svc.get_profile(USER_ID)
    assert out["matched"] is True and prof["plan"] == "Mensal"
    from app.datetime_utils import parse_dt
    assert int(parse_dt(prof["premium_until"]).timestamp()) == end
    # e a assinatura é auditada mesmo vindo aninhada em parent
    assert with_plan.rows("payments")[0]["subscription_id"] == "sub_1"


def test_subscription_period_end_no_item(with_plan):
    """Na API nova o current_period_end vive no item, não na assinatura."""
    end = int(time.time()) + 15 * 86400
    obj = {"object": "subscription", "items": {"data": [{"current_period_end": end}]}}
    got = stripe_webhook._period_end(obj)
    assert int(got.timestamp()) == end


def test_invoice_nao_paga_apenas_audita(with_plan):
    supabase_svc.set_premium(USER_ID, None, None)
    end = int(time.time()) + 30 * 86400
    call(invoice_paid(period_end=end, status="open"))
    assert is_premium_active(supabase_svc.get_profile(USER_ID)) is False


# ── Multibanco: notificação atrasada ─────────────────────────────────────────
def test_checkout_nao_pago_nao_libera(with_plan):
    """Voucher Multibanco GERADO mas não pago não pode dar acesso.

    A sessão chega com payment_status="unpaid" e o cliente pode levar dias — ou
    nunca — para pagar. Liberar aqui seria dar o produto de graça.
    """
    supabase_svc.set_premium(USER_ID, None, None)
    out = call(checkout_completed(payment_status="unpaid"))
    assert out.get("pending") is True
    assert is_premium_active(supabase_svc.get_profile(USER_ID)) is False
    # mas o evento fica auditado
    assert with_plan.rows("payments")[0]["event"] == "checkout.session.completed"


def test_async_payment_succeeded_libera(with_plan):
    """Dias depois, o cliente paga o voucher e o acesso abre."""
    supabase_svc.set_premium(USER_ID, None, None)
    out = call(checkout_completed(
        event_id="evt_async",
        event_type="checkout.session.async_payment_succeeded",
    ))
    assert out["matched"] is True
    assert is_premium_active(supabase_svc.get_profile(USER_ID)) is True


def test_compra_avulsa_usa_duration_days(with_plan):
    """Sessão em mode=payment não tem assinatura nem período: vale duration_days."""
    supabase_svc.set_premium(USER_ID, None, None)
    call(checkout_completed(subscription=None))
    prof = supabase_svc.get_profile(USER_ID)
    assert prof["plan"] == "Mensal" and is_premium_active(prof)
    from app.datetime_utils import parse_dt
    dias = (parse_dt(prof["premium_until"]) - datetime.now(timezone.utc)).days
    assert 28 <= dias <= 30        # 30 dias do plano Mensal


# ── revogação ────────────────────────────────────────────────────────────────
def test_subscription_deleted_revoga(with_plan):
    out = call(subscription_deleted())
    prof = supabase_svc.get_profile(USER_ID)
    assert out["matched"] is True
    assert is_premium_active(prof) is False and prof["plan"] is None


# ── casamento do usuário ─────────────────────────────────────────────────────
def test_match_por_telefone_e164(with_plan):
    """Sem profile_id, cai no telefone — e o E.164 vira só dígitos, sem assumir país."""
    supabase_svc.set_premium(USER_ID, None, None)
    out = call(checkout_completed(profile_id="", phone=f"+{PHONE}"))
    assert out["matched"] is True
    assert is_premium_active(supabase_svc.get_profile(USER_ID)) is True


def test_match_por_email(with_plan):
    supabase_svc.set_premium(USER_ID, None, None)
    out = call(checkout_completed(profile_id="", email=f"wa{PHONE}@zapwallet.app"))
    assert out["matched"] is True


def test_sem_usuario_audita_e_nao_quebra(with_plan):
    out = call(checkout_completed(profile_id="", phone="", email=""))
    assert out["matched"] is False
    assert with_plan.rows("payments")[0]["user_id"] is None


# ── helpers ──────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("raw,expected", [
    ("+351912345678", "351912345678"),
    ("+55 (85) 99999-9999", "5585999999999"),
    ("", ""),
])
def test_phone_from_e164(raw, expected):
    assert stripe_webhook._phone_from_e164(raw) == expected


def test_amount_converte_centavos():
    assert stripe_webhook._amount({"amount_paid": 1990}) == 19.9
    assert stripe_webhook._amount({"amount_total": 4990}) == 49.9
    assert stripe_webhook._amount({}) is None
