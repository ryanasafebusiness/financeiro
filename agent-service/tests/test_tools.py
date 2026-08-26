"""Testes das 7 tools do agente (execute(ctx, **args)) com FakeSupabase."""
from datetime import date

import pytest

from app.services import finance_svc as F
from app.tools import (
    registrar_transacao, consultar_transacoes, editar_transacao,
    deletar_transacao, gerenciar_meta, gerenciar_limite, gerar_relatorio,
)
from tests.conftest import USER_ID

TODAY = date.today().isoformat()


# ── registrar_transacao ──────────────────────────────────────────────────────
@pytest.mark.parametrize("tipo,expected_type", [
    ("gasto", "expense"), ("receita", "income"),
    ("Gasto", "expense"), ("RECEITA", "income"),
])
def test_registrar_tipo_mapping(ctx, db, tipo, expected_type):
    r = registrar_transacao.execute(ctx, tipo=tipo, valor=50, categoria="Outros", descricao="x")
    assert r["ok"] is True
    assert db.rows("transactions")[0]["type"] == expected_type


def test_registrar_returns_data(ctx, db):
    r = registrar_transacao.execute(ctx, tipo="gasto", valor=80, categoria="Lazer", descricao="cinema")
    assert r["registrado"]["valor"] == 80.0
    assert r["registrado"]["data"] == TODAY


def test_registrar_default_date_today(ctx, db):
    r = registrar_transacao.execute(ctx, tipo="gasto", valor=10)
    assert r["registrado"]["data"] == TODAY


def test_registrar_alert_when_limit_near(ctx, db):
    F.set_limit(USER_ID, "geral", 100, "monthly")
    r = registrar_transacao.execute(ctx, tipo="gasto", valor=90, categoria="Outros", descricao="x")
    assert "alertas_limite" in r and r["alertas_limite"][0]["pct"] >= 80


def test_registrar_no_alert_for_income(ctx, db):
    F.set_limit(USER_ID, "geral", 100, "monthly")
    r = registrar_transacao.execute(ctx, tipo="receita", valor=500, categoria="Salário")
    assert "alertas_limite" not in r


def test_registrar_no_alert_when_under_80(ctx, db):
    F.set_limit(USER_ID, "geral", 1000, "monthly")
    r = registrar_transacao.execute(ctx, tipo="gasto", valor=100, categoria="Outros")
    assert "alertas_limite" not in r


@pytest.mark.parametrize("valor", [0, 0.0, -5, "0", None])
def test_registrar_valor_zero_ou_invalido_nao_registra(ctx, db, valor):
    r = registrar_transacao.execute(ctx, tipo="gasto", valor=valor, titulo="Assinatura OpenAI")
    assert r["ok"] is False and r["erro"] == "valor_obrigatorio"
    assert db.rows("transactions") == []          # nada criado


# ── consultar_transacoes ─────────────────────────────────────────────────────
@pytest.fixture
def tx3(ctx, db):
    registrar_transacao.execute(ctx, tipo="gasto", valor=30, categoria="Alimentação", descricao="a", data="2026-06-01")
    registrar_transacao.execute(ctx, tipo="gasto", valor=70, categoria="Transporte", descricao="b", data="2026-06-10")
    registrar_transacao.execute(ctx, tipo="receita", valor=2000, categoria="Salário", descricao="c", data="2026-06-05")
    return db


def test_consultar_all(ctx, tx3):
    r = consultar_transacoes.execute(ctx)
    assert r["total_itens"] == 3
    assert r["resumo"]["saldo"] == 1900.0


def test_consultar_filter_gasto(ctx, tx3):
    r = consultar_transacoes.execute(ctx, tipo="gasto")
    assert r["total_itens"] == 2
    assert all(i["tipo"] == "gasto" for i in r["itens"])


def test_consultar_filter_receita(ctx, tx3):
    r = consultar_transacoes.execute(ctx, tipo="receita")
    assert r["total_itens"] == 1 and r["itens"][0]["valor"] == 2000.0


def test_consultar_filter_categoria(ctx, tx3):
    r = consultar_transacoes.execute(ctx, categoria="Transporte")
    assert r["total_itens"] == 1


def test_consultar_date_range(ctx, tx3):
    r = consultar_transacoes.execute(ctx, data_inicio="2026-06-02", data_fim="2026-06-08")
    assert r["total_itens"] == 1 and r["itens"][0]["tipo"] == "receita"


def test_consultar_item_shape(ctx, tx3):
    item = consultar_transacoes.execute(ctx, tipo="gasto")["itens"][0]
    assert set(["id", "tipo", "valor", "categoria", "descricao", "data"]).issubset(item)


# ── editar_transacao ─────────────────────────────────────────────────────────
def test_editar_ok(ctx, db):
    tx = F.create_transaction(USER_ID, "expense", 50, "Alimentação", "pizza", "2026-06-01")
    r = editar_transacao.execute(ctx, id=tx["id"], valor=55)
    assert r["ok"] is True and r["atualizado"]["valor"] == 55.0


def test_editar_tipo(ctx, db):
    tx = F.create_transaction(USER_ID, "expense", 50, "x", "y")
    r = editar_transacao.execute(ctx, id=tx["id"], tipo="receita")
    assert r["atualizado"]["tipo"] == "receita"


def test_editar_not_found(ctx, db):
    r = editar_transacao.execute(ctx, id="inexistente", valor=10)
    assert r["ok"] is False and r["erro"] == "nao_encontrado"


def test_editar_valor_zero_bloqueado(ctx, db):
    tx = F.create_transaction(USER_ID, "expense", 50, "x", "y")
    r = editar_transacao.execute(ctx, id=tx["id"], valor=0)
    assert r["ok"] is False and r["erro"] == "valor_obrigatorio"
    row = next(t for t in db.rows("transactions") if t["id"] == tx["id"])
    assert float(row["amount"]) == 50.0           # inalterado


# ── deletar_transacao ────────────────────────────────────────────────────────
def test_deletar_ok(ctx, db):
    tx = F.create_transaction(USER_ID, "expense", 50, "x", "y")
    r = deletar_transacao.execute(ctx, id=tx["id"])
    assert r["ok"] is True and r["excluido_id"] == tx["id"]


def test_deletar_not_found(ctx, db):
    r = deletar_transacao.execute(ctx, id="nope")
    assert r["ok"] is False


# ── gerenciar_meta ───────────────────────────────────────────────────────────
def test_meta_criar(ctx, db):
    r = gerenciar_meta.execute(ctx, acao="criar", nome="Viagem", valor_alvo=5000, valor_guardado=500)
    assert r["ok"] is True and r["meta"]["valor_alvo"] == 5000.0
    assert r["meta"]["status"] == "active"
    assert r["meta"]["progresso_pct"] == 10.0


def test_meta_criar_incompleto(ctx, db):
    r = gerenciar_meta.execute(ctx, acao="criar", nome="Sem alvo")
    assert r["ok"] is False and r["erro"] == "dados_incompletos"


def test_meta_listar(ctx, db):
    gerenciar_meta.execute(ctx, acao="criar", nome="A", valor_alvo=100)
    r = gerenciar_meta.execute(ctx, acao="listar")
    assert r["total"] == 1 and r["metas"][0]["nome"] == "A"


def test_meta_atualizar_sem_id(ctx, db):
    r = gerenciar_meta.execute(ctx, acao="atualizar", valor_guardado=10)
    assert r["ok"] is False and r["erro"] == "sem_id"


def test_meta_atualizar_ok(ctx, db):
    c = gerenciar_meta.execute(ctx, acao="criar", nome="Carro", valor_alvo=10000)
    r = gerenciar_meta.execute(ctx, acao="atualizar", id=c["meta"]["id"], valor_guardado=2500)
    assert r["meta"]["valor_guardado"] == 2500.0 and r["meta"]["progresso_pct"] == 25.0


# ── gerenciar_limite ─────────────────────────────────────────────────────────
@pytest.mark.parametrize("periodo,expected", [
    ("mensal", "monthly"), ("semanal", "weekly"), ("mes", "monthly"), ("semana", "weekly"),
])
def test_limite_periodo_mapping(ctx, db, periodo, expected):
    r = gerenciar_limite.execute(ctx, acao="definir", categoria="Lazer", valor=300, periodo=periodo)
    assert r["limite"]["periodo"] == expected


def test_limite_definir_sem_valor(ctx, db):
    r = gerenciar_limite.execute(ctx, acao="definir", categoria="Lazer")
    assert r["ok"] is False and r["erro"] == "sem_valor"


def test_limite_listar(ctx, db):
    gerenciar_limite.execute(ctx, acao="definir", categoria="geral", valor=1000)
    r = gerenciar_limite.execute(ctx, acao="listar")
    assert len(r["limites"]) == 1


def test_limite_status(ctx, db):
    gerenciar_limite.execute(ctx, acao="definir", categoria="geral", valor=1000)
    F.create_transaction(USER_ID, "expense", 250, "Outros", "x")
    r = gerenciar_limite.execute(ctx, acao="status")
    assert r["status"][0]["spent"] == 250.0


def test_limite_remover(ctx, db):
    gerenciar_limite.execute(ctx, acao="definir", categoria="geral", valor=1000)
    r = gerenciar_limite.execute(ctx, acao="remover", categoria="geral")
    assert r["ok"] is True


# ── gerar_relatorio ──────────────────────────────────────────────────────────
def test_relatorio_mes_atual(ctx, db):
    F.create_transaction(USER_ID, "expense", 100, "Alimentação", "x")
    F.create_transaction(USER_ID, "income", 300, "Salário", "y")
    r = gerar_relatorio.execute(ctx, periodo="mes_atual")
    assert r["gastos"] == 100.0 and r["receitas"] == 300.0 and r["saldo"] == 200.0
    assert r["gasto_por_categoria"][0]["category"] == "Alimentação"


def test_relatorio_semana(ctx, db):
    F.create_transaction(USER_ID, "expense", 40, "Outros", "x")
    r = gerar_relatorio.execute(ctx, periodo="semana")
    assert r["gastos"] == 40.0


def test_relatorio_personalizado(ctx, db):
    F.create_transaction(USER_ID, "expense", 10, "Outros", "x", "2026-03-15")
    r = gerar_relatorio.execute(ctx, periodo="personalizado", data_inicio="2026-03-01", data_fim="2026-03-31")
    assert r["periodo"]["inicio"] == "2026-03-01" and r["gastos"] == 10.0


def test_relatorio_mes_passado_empty(ctx, db):
    r = gerar_relatorio.execute(ctx, periodo="mes_passado")
    assert r["ok"] is True and r["gastos"] == 0.0
