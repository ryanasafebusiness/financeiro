"""Transações ricas (título/local/data-hora) e recorrências."""
from datetime import date

import pytest

from app.services import finance_svc as F
from app.tools import gerenciar_recorrencia, registrar_transacao
from tests.conftest import USER_ID


# ── título capitalizado / campos ricos ───────────────────────────────────────
@pytest.mark.parametrize("raw,expected", [
    ("cinema com a gata", "Cinema com a Gata"),
    ("mercado do mês", "Mercado do Mês"),
    ("SALÁRIO", "Salário"),
    ("uber", "Uber"),
    ("", ""),
])
def test_norm_title(raw, expected):
    assert F.norm_title(raw) == expected


def test_create_transaction_rich_fields(db):
    tx = F.create_transaction(USER_ID, "expense", 45, "Lazer", "sessão com a namorada",
                              title="cinema com a gata", location="Shopping Iguatemi")
    assert tx["title"] == "Cinema com a Gata"
    assert tx["location"] == "Shopping Iguatemi"
    assert tx["description"] == "sessão com a namorada"
    assert tx["occurred_at"] is not None and tx["occurred_on"] == date.today().isoformat()


def test_create_transaction_title_fallback_to_category(db):
    tx = F.create_transaction(USER_ID, "expense", 10, "Transporte", "uber")
    assert tx["title"] == "Transporte"   # sem título -> usa categoria


def test_registrar_tool_saves_rich(ctx, db):
    r = registrar_transacao.execute(ctx, tipo="gasto", valor=45, titulo="cinema com a gata",
                                    categoria="Lazer", descricao="com a namorada", local="Shopping")
    assert r["ok"] and r["registrado"]["titulo"] == "Cinema com a Gata"
    assert r["registrado"]["local"] == "Shopping"
    assert r["registrado"]["data_hora"]


# ── próxima ocorrência ────────────────────────────────────────────────────────
@pytest.mark.parametrize("ref,dom,expected", [
    (date(2026, 6, 10), 15, date(2026, 6, 15)),   # ainda neste mês
    (date(2026, 6, 15), 10, date(2026, 7, 10)),   # já passou -> mês que vem
    (date(2026, 6, 15), 15, date(2026, 6, 15)),   # hoje
    (date(2026, 2, 1), 31, date(2026, 2, 28)),    # clamp p/ fim do mês
    (date(2026, 12, 20), 5, date(2027, 1, 5)),    # vira o ano
])
def test_next_monthly(ref, dom, expected):
    assert F.next_occurrence("monthly", ref, day_of_month=dom) == expected


def test_next_daily_is_ref():
    assert F.next_occurrence("daily", date(2026, 6, 10)) == date(2026, 6, 10)


# ── CRUD de recorrência ───────────────────────────────────────────────────────
def test_create_recurring(db):
    r = F.create_recurring(USER_ID, "income", "salário", 3000, category="Salário",
                           frequency="monthly", day_of_month=15, tz_today=date(2026, 6, 10))
    assert r["title"] == "Salário" and r["next_run"] == "2026-06-15"
    assert r["active"] is True


def test_list_and_delete_recurring(db):
    r = F.create_recurring(USER_ID, "expense", "aluguel", 1500, frequency="monthly",
                           day_of_month=10, tz_today=date(2026, 6, 15))
    assert len(F.list_recurring(USER_ID, active=None)) == 1
    assert F.delete_recurring(USER_ID, r["id"]) is True
    assert F.list_recurring(USER_ID, active=None) == []


# ── materialização ────────────────────────────────────────────────────────────
def test_materialize_due_creates_and_reschedules(db):
    today = date(2026, 6, 15)
    r = F.create_recurring(USER_ID, "income", "salário", 3000, category="Salário",
                           frequency="monthly", day_of_month=15, tz_today=today)
    assert r["next_run"] == "2026-06-15"   # vence hoje

    n = F.materialize_due(today=today)
    assert n == 1

    txs = db.rows("transactions")
    assert len(txs) == 1
    tx = txs[0]
    assert tx["type"] == "income" and float(tx["amount"]) == 3000.0
    assert tx["source"] == "recurring" and tx["recurring_id"] == r["id"]
    assert tx["title"] == "Salário"

    # reagendou p/ o próximo mês
    rec = db.rows("recurring_transactions")[0]
    assert rec["last_run"] == "2026-06-15" and rec["next_run"] == "2026-07-15"


def test_materialize_not_due(db):
    today = date(2026, 6, 1)
    F.create_recurring(USER_ID, "expense", "aluguel", 1500, frequency="monthly",
                       day_of_month=10, tz_today=today)   # next_run = 2026-06-10 (futuro)
    assert F.materialize_due(today=today) == 0
    assert db.rows("transactions") == []


# ── tool gerenciar_recorrencia ────────────────────────────────────────────────
def test_tool_recorrencia_criar_listar_remover(ctx, db):
    r = gerenciar_recorrencia.execute(ctx, acao="criar", tipo="receita", titulo="salário",
                                      valor=3000, categoria="Salário", frequencia="mensal", dia_do_mes=15)
    assert r["ok"] and r["recorrencia"]["frequencia"] == "mensal"
    assert r["recorrencia"]["dia_do_mes"] == 15

    lst = gerenciar_recorrencia.execute(ctx, acao="listar")
    assert lst["ok"] and len(lst["recorrencias"]) == 1

    rem = gerenciar_recorrencia.execute(ctx, acao="remover", id=r["recorrencia"]["id"])
    assert rem["ok"] is True


def test_tool_recorrencia_criar_incompleto(ctx, db):
    r = gerenciar_recorrencia.execute(ctx, acao="criar", tipo="receita")
    assert r["ok"] is False and r["erro"] == "dados_incompletos"


def test_tool_recorrencia_criar_sem_valor_pede(ctx, db):
    # Caso real: "tenho uma assinatura da OpenAI todo dia 12" (sem valor) -> NÃO cria com R$ 0,00.
    r = gerenciar_recorrencia.execute(ctx, acao="criar", tipo="gasto", titulo="Assinatura OpenAI",
                                      frequencia="mensal", dia_do_mes=12)
    assert r["ok"] is False and r["erro"] == "valor_obrigatorio"
    assert F.list_recurring(USER_ID, active=None) == []          # nada criado


@pytest.mark.parametrize("valor", [0, 0.0, -10])
def test_tool_recorrencia_criar_valor_zero(ctx, db, valor):
    r = gerenciar_recorrencia.execute(ctx, acao="criar", tipo="gasto", titulo="X", valor=valor, dia_do_mes=5)
    assert r["ok"] is False and r["erro"] == "valor_obrigatorio"
    assert F.list_recurring(USER_ID, active=None) == []


def test_tool_recorrencia_atualizar_valor_zero_bloqueado(ctx, db):
    r = gerenciar_recorrencia.execute(ctx, acao="criar", tipo="gasto", titulo="Aluguel",
                                      valor=1000, dia_do_mes=10)
    rid = r["recorrencia"]["id"]
    upd = gerenciar_recorrencia.execute(ctx, acao="atualizar", id=rid, valor=0)
    assert upd["ok"] is False and upd["erro"] == "valor_obrigatorio"
    # valor permanece o original
    atual = gerenciar_recorrencia.execute(ctx, acao="listar")["recorrencias"][0]
    assert atual["valor"] == 1000.0
