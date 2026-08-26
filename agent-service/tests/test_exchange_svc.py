import time
import pytest

from app.services import exchange_svc, finance_svc
from tests.conftest import USER_ID


@pytest.fixture(autouse=True)
def _clear_rate_cache():
    exchange_svc.reset_cache()
    yield
    exchange_svc.reset_cache()


def _seed_rate():
    exchange_svc._cache.update({
        "date": "2026-08-26",
        "eur_brl": 6.0,
        "provider": "ECB",
        "fetched_at": time.monotonic(),
    })


def test_converte_nos_dois_sentidos():
    _seed_rate()
    assert exchange_svc.convert(10, "EUR", "BRL") == 60
    assert exchange_svc.convert(60, "BRL", "EUR") == 10


def test_summary_converte_moedas_sem_alterar_origem(db):
    _seed_rate()
    finance_svc.create_transaction(USER_ID, "income", 10, currency="EUR")
    finance_svc.create_transaction(USER_ID, "income", 60, currency="BRL")

    eur = finance_svc.summary(USER_ID, "2000-01-01", "2100-01-01", "EUR")
    brl = finance_svc.summary(USER_ID, "2000-01-01", "2100-01-01", "BRL")

    assert eur["total_income"] == 20
    assert brl["total_income"] == 120
    assert {row["currency"] for row in db.rows("transactions")} == {"EUR", "BRL"}
