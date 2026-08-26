"""Testes do webhook da Cakto: normalização de telefone, extensão de premium e
o handler completo (libera / revoga / apenas audita / secret inválido)."""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest

from app.services import supabase_svc
from app.services.supabase_svc import is_premium_active
from app.webhooks import cakto
from tests.conftest import USER_ID, PHONE


class FakeRequest:
    def __init__(self, body):
        self._body = body

    async def json(self):
        return self._body


def call(body):
    return asyncio.run(cakto.cakto_webhook(FakeRequest(body)))


# ── _canonical_br_phone ──────────────────────────────────────────────────────
@pytest.mark.parametrize("raw,expected", [
    ("85999999999", "5585999999999"),          # DDD + número, sem país
    ("5585999999999", "5585999999999"),         # já completo
    ("+55 (85) 99999-9999", "5585999999999"),   # formatado
    ("", ""),
    ("1199998888", "551199998888"),             # 10 dígitos
])
def test_canonical_phone(raw, expected):
    assert cakto._canonical_br_phone(raw) == expected


# ── _extend_premium ──────────────────────────────────────────────────────────
def test_extend_no_current():
    until = cakto._extend_premium({"premium_until": None}, 30)
    dt = datetime.fromisoformat(until)
    assert dt > datetime.now(timezone.utc) + timedelta(days=29)


def test_extend_stacks_on_future():
    future = (datetime.now(timezone.utc) + timedelta(days=10)).isoformat()
    until = cakto._extend_premium({"premium_until": future}, 30)
    dt = datetime.fromisoformat(until)
    assert dt > datetime.now(timezone.utc) + timedelta(days=39)


def test_extend_ignores_past():
    past = (datetime.now(timezone.utc) - timedelta(days=10)).isoformat()
    until = cakto._extend_premium({"premium_until": past}, 30)
    dt = datetime.fromisoformat(until)
    assert dt < datetime.now(timezone.utc) + timedelta(days=31)


# ── handler ──────────────────────────────────────────────────────────────────
def _body(event, *, phone="85999999999", email="", offer_id="OFFER1", status="paid"):
    return {
        "secret": "test-secret",
        "event": event,
        "data": {
            "id": "tx-123", "refId": "AB12",
            "customer": {"name": "Gabriel", "email": email, "phone": phone},
            "offer": {"id": offer_id, "name": "Plano Mensal", "price": 19.9},
            "status": status, "amount": 19.9, "paymentMethod": "pix",
        },
    }


@pytest.fixture
def with_plan(db):
    db.seed("plans", {
        "id": None, "name": "Mensal", "price": 19.9, "duration_days": 30,
        "message_limit": 0, "cakto_offer_id": "OFFER1", "active": True,
    })
    return db


def test_secret_invalido_401(with_plan):
    resp = call({**_body("purchase_approved"), "secret": "errado"})
    assert getattr(resp, "status_code", None) == 401


def test_purchase_approved_libera(with_plan):
    # zera premium antes
    supabase_svc.set_premium(USER_ID, None, None)
    out = call(_body("purchase_approved"))
    assert out["matched"] is True
    prof = supabase_svc.get_profile(USER_ID)
    assert is_premium_active(prof) is True and prof["plan"] == "Mensal"


def test_purchase_approved_registra_pagamento(with_plan):
    call(_body("purchase_approved"))
    pays = with_plan.rows("payments")
    assert len(pays) == 1 and pays[0]["event"] == "purchase_approved"


def test_subscription_renewed_libera(with_plan):
    supabase_svc.set_premium(USER_ID, None, None)
    call(_body("subscription_renewed"))
    assert is_premium_active(supabase_svc.get_profile(USER_ID)) is True


def test_purchase_approved_zera_uso(with_plan):
    # Simula consumo (trial gasto) antes do pagamento liberar.
    supabase_svc.get_db().table("profiles").update(
        {"messages_this_month": 9}).eq("id", USER_ID).execute()
    call(_body("purchase_approved"))
    assert supabase_svc.get_profile(USER_ID)["messages_this_month"] == 0


def test_refund_revoga(with_plan):
    out = call(_body("refund"))
    prof = supabase_svc.get_profile(USER_ID)
    assert out["matched"] is True
    assert is_premium_active(prof) is False and prof["plan"] is None


def test_chargeback_revoga(with_plan):
    call(_body("chargeback"))
    assert is_premium_active(supabase_svc.get_profile(USER_ID)) is False


def test_subscription_canceled_apenas_audita(with_plan):
    # cancelamento não revoga na hora (vale até expirar), mas é auditado
    before = supabase_svc.get_profile(USER_ID)["premium_until"]
    out = call(_body("subscription_canceled"))
    after = supabase_svc.get_profile(USER_ID)["premium_until"]
    assert out["matched"] is True and before == after
    assert with_plan.rows("payments")[0]["event"] == "subscription_canceled"


def test_oferta_desconhecida_usa_fallback(with_plan):
    supabase_svc.set_premium(USER_ID, None, None)
    out = call(_body("purchase_approved", offer_id="DESCONHECIDA"))
    prof = supabase_svc.get_profile(USER_ID)
    # plano cai p/ offer.name e ainda libera 30 dias
    assert prof["plan"] == "Plano Mensal" and is_premium_active(prof)


def test_match_por_email(with_plan):
    supabase_svc.set_premium(USER_ID, None, None)
    out = call(_body("purchase_approved", phone="", email=f"wa{PHONE}@zapwallet.app"))
    assert out["matched"] is True
