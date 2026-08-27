"""Testes do prompt de sistema padrão e do contexto dinâmico."""
from app.prompts import SYSTEM_PROMPT, OUTPUT_CONTRACT
from app.services import ai_agent_svc as A, finance_svc as F
from tests.conftest import USER_ID
from tests.fakes import final


def test_system_prompt_identity():
    assert "Gobbi" in SYSTEM_PROMPT
    assert "WhatsApp" in SYSTEM_PROMPT


def test_system_prompt_tool_rule():
    assert "INQUEBRÁVEL" in SYSTEM_PROMPT
    assert "ferramenta" in SYSTEM_PROMPT.lower()


def test_system_prompt_no_markdown_rule():
    assert "markdown" in SYSTEM_PROMPT.lower()


def test_system_prompt_no_invention():
    assert "invent" in SYSTEM_PROMPT.lower()  # "nunca invente números"


def test_output_contract_keys():
    assert "nao_responder" in OUTPUT_CONTRACT
    assert "mensagens_cliente" in OUTPUT_CONTRACT


def test_build_context_basic(db, profile):
    ctx = A.build_context(profile)
    assert "CONTEXTO ATUAL" in ctx
    assert "Gabriel" in ctx
    assert "Mensal" in ctx


def test_build_context_includes_month_summary(db, profile):
    F.create_transaction(USER_ID, "income", 1000, "Salário", "x")
    F.create_transaction(USER_ID, "expense", 300, "Outros", "y")
    ctx = A.build_context(profile)
    assert "1000.00" in ctx and "300.00" in ctx


def test_build_context_includes_goals(db, profile):
    F.create_goal(USER_ID, "Viagem", 5000, None, 1000)
    ctx = A.build_context(profile)
    assert "Metas ativas" in ctx and "Viagem" in ctx


def test_build_context_includes_limits(db, profile):
    F.set_limit(USER_ID, "geral", 1000, "monthly")
    ctx = A.build_context(profile)
    assert "Limites" in ctx


def test_build_context_includes_categories_and_descriptions(db, profile):
    ctx = A.build_context(profile)
    assert "Categorias do usuário" in ctx
    # nome + descrição da categoria do usuário chegam à IA
    assert "Alimentação" in ctx
    assert "ifood, restaurante, lanche, padaria" in ctx
    # categoria sem descrição aparece só com o nome (sem ": ")
    assert "📦 Outros" in ctx


def test_run_composes_full_system_prompt(db, profile, patch_openai):
    fake = patch_openai([final({"nao_responder": False, "mensagens_cliente": ["oi"]})])
    A.run("sess", "oi", profile)
    system_msg = fake.calls[0]["messages"][0]["content"]
    assert "Gobbi" in system_msg               # SYSTEM_PROMPT
    assert "CONTEXTO ATUAL" in system_msg           # build_context
    assert "FORMATO DE SAÍDA" in system_msg         # OUTPUT_CONTRACT
    assert "Gabriel" in system_msg                  # nome do usuário injetado
