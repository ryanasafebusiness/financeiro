"""Testes da camada de domínio finance_svc (com FakeSupabase)."""
from datetime import date, timedelta

import pytest

from app.services import finance_svc as F
from tests.conftest import USER_ID

TODAY = date.today()


# ── parse_date ────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("value,expected", [
    ("hoje", TODAY.isoformat()),
    ("today", TODAY.isoformat()),
    ("", TODAY.isoformat()),
    (None, TODAY.isoformat()),
    ("ontem", (TODAY - timedelta(days=1)).isoformat()),
    ("yesterday", (TODAY - timedelta(days=1)).isoformat()),
    ("anteontem", (TODAY - timedelta(days=2)).isoformat()),
    ("2026-03-15", "2026-03-15"),
    ("15/03/2026", "2026-03-15"),
    ("01/01/2025", "2025-01-01"),
    ("blá-coisa-inválida", TODAY.isoformat()),
])
def test_parse_date(value, expected):
    assert F.parse_date(value) == expected


# ── month_bounds / week_bounds ──────────────────────────────────────────────────
@pytest.mark.parametrize("ref,first,last", [
    (date(2026, 2, 15), "2026-02-01", "2026-02-28"),
    (date(2024, 2, 10), "2024-02-01", "2024-02-29"),   # bissexto
    (date(2026, 12, 5), "2026-12-01", "2026-12-31"),
    (date(2026, 1, 31), "2026-01-01", "2026-01-31"),
    (date(2026, 4, 1), "2026-04-01", "2026-04-30"),
])
def test_month_bounds(ref, first, last):
    assert F.month_bounds(ref) == (first, last)


@pytest.mark.parametrize("ref,mon,sun", [
    (date(2026, 6, 10), "2026-06-08", "2026-06-14"),   # quarta
    (date(2026, 6, 8), "2026-06-08", "2026-06-14"),    # segunda
    (date(2026, 6, 14), "2026-06-08", "2026-06-14"),   # domingo
])
def test_week_bounds(ref, mon, sun):
    assert F.week_bounds(ref) == (mon, sun)


# ── transações: create ──────────────────────────────────────────────────────────
def test_create_transaction_basic(db):
    tx = F.create_transaction(USER_ID, "expense", 80, "Lazer", "cinema")
    assert tx["id"] and tx["amount"] == 80.0
    assert tx["type"] == "expense" and tx["category"] == "Lazer"
    assert tx["occurred_on"] == TODAY.isoformat()


def test_create_transaction_rounds_amount(db):
    tx = F.create_transaction(USER_ID, "expense", 12.349, "Outros", "x")
    assert tx["amount"] == 12.35


def test_create_transaction_empty_category_is_null(db):
    tx = F.create_transaction(USER_ID, "income", 100, "", "")
    assert tx["category"] is None and tx["description"] is None


def test_create_transaction_persists(db):
    F.create_transaction(USER_ID, "expense", 10, "Mercado", "a")
    F.create_transaction(USER_ID, "income", 50, "Salário", "b")
    assert len(db.rows("transactions")) == 2


# ── transações: list + filtros ──────────────────────────────────────────────────
@pytest.fixture
def some_tx(db):
    F.create_transaction(USER_ID, "expense", 30, "Alimentação", "almoço", "2026-06-01")
    F.create_transaction(USER_ID, "expense", 70, "Transporte", "uber", "2026-06-10")
    F.create_transaction(USER_ID, "income", 2000, "Salário", "salário", "2026-06-05")
    return db


def test_list_all(some_tx):
    assert len(F.list_transactions(USER_ID)) == 3


def test_list_filter_type_expense(some_tx):
    rows = F.list_transactions(USER_ID, type_="expense")
    assert len(rows) == 2 and all(r["type"] == "expense" for r in rows)


def test_list_filter_type_income(some_tx):
    rows = F.list_transactions(USER_ID, type_="income")
    assert len(rows) == 1 and rows[0]["amount"] == 2000


def test_list_filter_category_case_insensitive(some_tx):
    rows = F.list_transactions(USER_ID, category="transporte")
    assert len(rows) == 1 and rows[0]["category"] == "Transporte"


def test_list_filter_date_range(some_tx):
    rows = F.list_transactions(USER_ID, date_from="2026-06-02", date_to="2026-06-08")
    assert len(rows) == 1 and rows[0]["category"] == "Salário"


def test_list_limit(some_tx):
    assert len(F.list_transactions(USER_ID, limit=1)) == 1


def test_list_only_own_user(some_tx):
    F.create_transaction("99999999-9999-9999-9999-999999999999", "expense", 999, "x", "y")
    assert all(r["user_id"] == USER_ID for r in F.list_transactions(USER_ID))


# ── transações: update / delete ──────────────────────────────────────────────────
def test_update_transaction(db):
    tx = F.create_transaction(USER_ID, "expense", 50, "Alimentação", "pizza", "2026-06-01")
    upd = F.update_transaction(USER_ID, tx["id"], {"amount": 55})
    assert upd["amount"] == 55.0


def test_update_transaction_parses_date(db):
    tx = F.create_transaction(USER_ID, "expense", 50, "x", "y")
    upd = F.update_transaction(USER_ID, tx["id"], {"occurred_on": "ontem"})
    assert upd["occurred_on"] == (TODAY - timedelta(days=1)).isoformat()


def test_update_transaction_no_fields_returns_none(db):
    tx = F.create_transaction(USER_ID, "expense", 50, "x", "y")
    assert F.update_transaction(USER_ID, tx["id"], {"foo": "bar"}) is None


def test_update_transaction_wrong_user(db):
    tx = F.create_transaction(USER_ID, "expense", 50, "x", "y")
    assert F.update_transaction("00000000-0000-0000-0000-000000000000", tx["id"], {"amount": 1}) is None


def test_delete_transaction(db):
    tx = F.create_transaction(USER_ID, "expense", 50, "x", "y")
    assert F.delete_transaction(USER_ID, tx["id"]) is True
    assert len(db.rows("transactions")) == 0


def test_delete_transaction_not_found(db):
    assert F.delete_transaction(USER_ID, "inexistente") is False


# ── metas ────────────────────────────────────────────────────────────────────────
def test_create_goal(db):
    g = F.create_goal(USER_ID, "Viagem", 5000, "2026-12-31", 500)
    assert g["target_amount"] == 5000.0 and g["saved_amount"] == 500.0
    assert g["deadline"] == "2026-12-31"


def test_list_goals_active_only(db):
    F.create_goal(USER_ID, "A", 100)
    g = F.create_goal(USER_ID, "B", 200)
    F.update_goal(USER_ID, g["id"], {"status": "archived"})
    actives = F.list_goals(USER_ID)
    assert len(actives) == 1 and actives[0]["name"] == "A"


def test_update_goal_saved(db):
    g = F.create_goal(USER_ID, "Carro", 10000)
    upd = F.update_goal(USER_ID, g["id"], {"saved_amount": 1500})
    assert upd["saved_amount"] == 1500.0


# ── limites ────────────────────────────────────────────────────────────────────
def test_set_limit_creates(db):
    lim = F.set_limit(USER_ID, "Alimentação", 800, "monthly")
    assert lim["category"] == "alimentação" and lim["limit_amount"] == 800.0


def test_set_limit_upsert_no_duplicate(db):
    F.set_limit(USER_ID, "Lazer", 300, "monthly")
    F.set_limit(USER_ID, "Lazer", 500, "monthly")
    rows = F.list_limits(USER_ID)
    assert len(rows) == 1 and rows[0]["limit_amount"] == 500.0


def test_set_limit_period_normalized(db):
    lim = F.set_limit(USER_ID, "geral", 1000, "bizarro")
    assert lim["period"] == "monthly"


def test_delete_limit(db):
    F.set_limit(USER_ID, "geral", 1000, "monthly")
    assert F.delete_limit(USER_ID, "geral", "monthly") is True
    assert F.list_limits(USER_ID) == []


# ── agregações ────────────────────────────────────────────────────────────────
def test_summary(some_tx):
    s = F.summary(USER_ID, "2026-06-01", "2026-06-30")
    assert s["total_income"] == 2000.0
    assert s["total_expense"] == 100.0
    assert s["balance"] == 1900.0
    assert s["count"] == 3


def test_spending_by_category_sorted(some_tx):
    cats = F.spending_by_category(USER_ID, "2026-06-01", "2026-06-30")
    assert cats[0] == {"category": "Transporte", "total": 70.0}
    assert {"category": "Alimentação", "total": 30.0} in cats


def test_spending_by_category_null_is_outros(db):
    F.create_transaction(USER_ID, "expense", 40, "", "sem categoria", "2026-06-01")
    cats = F.spending_by_category(USER_ID, "2026-06-01", "2026-06-30")
    assert cats == [{"category": "Outros", "total": 40.0}]


# ── limit_status ────────────────────────────────────────────────────────────────
def test_limit_status_geral_within(db):
    F.set_limit(USER_ID, "geral", 1000, "monthly")
    F.create_transaction(USER_ID, "expense", 300, "Alimentação", "x")  # hoje
    st = F.limit_status(USER_ID)[0]
    assert st["spent"] == 300.0 and st["remaining"] == 700.0
    assert st["exceeded"] is False and st["pct"] == 30.0


def test_limit_status_exceeded(db):
    F.set_limit(USER_ID, "geral", 100, "monthly")
    F.create_transaction(USER_ID, "expense", 150, "Outros", "x")
    st = F.limit_status(USER_ID)[0]
    assert st["exceeded"] is True and st["remaining"] == -50.0


def test_limit_status_by_category(db):
    F.set_limit(USER_ID, "Alimentação", 200, "monthly")
    F.create_transaction(USER_ID, "expense", 50, "Alimentação", "x")
    F.create_transaction(USER_ID, "expense", 500, "Transporte", "y")  # não conta no limite de Alimentação
    st = F.limit_status(USER_ID, "Alimentação")
    assert len(st) == 1 and st[0]["spent"] == 50.0


def test_limit_status_weekly(db):
    F.set_limit(USER_ID, "geral", 500, "weekly")
    F.create_transaction(USER_ID, "expense", 120, "Outros", "x")  # hoje, dentro da semana
    st = F.limit_status(USER_ID)[0]
    assert st["period"] == "weekly" and st["spent"] == 120.0


# ── categorias ──────────────────────────────────────────────────────────────────
def test_list_categories_only_own(db):
    cats = F.list_categories(USER_ID)
    names = {c["name"] for c in cats}
    assert {"Alimentação", "Transporte", "Mercado", "Outros", "Salário"} <= names
    # devolve nome, tipo, emoji e descrição
    alim = next(c for c in cats if c["name"] == "Alimentação")
    assert alim["type"] == "expense" and alim["description"]
    # não vaza categorias de outro usuário
    db.seed("categories", {"id": None, "user_id": "outro", "name": "Secreta",
                           "type": "expense", "emoji": None, "description": None})
    assert all(c["name"] != "Secreta" for c in F.list_categories(USER_ID))


def test_list_categories_filter_by_type(db):
    expense = F.list_categories(USER_ID, "expense")
    assert all(c["type"] in ("expense", "both") for c in expense)
    assert all(c["name"] != "Salário" for c in expense)  # income fica de fora
    income = F.list_categories(USER_ID, "income")
    assert any(c["name"] == "Salário" for c in income)
