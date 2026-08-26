"""Cenários ponta-a-ponta do agente: ai_agent_svc.run dirigido por um modelo
scriptado (FakeOpenAI). Valida o loop de tool-calling, o despacho das tools, os
efeitos no banco e o formato da resposta — tudo determinístico, sem rede.
"""
from app.services import ai_agent_svc as A, finance_svc as F
from tests.conftest import USER_ID
from tests.fakes import assistant_tools, tool_call, final, raw


def run(profile, script, text="oi"):
    return A.run("sess", text, profile)


# ── registrar gasto: "cinema 80" ─────────────────────────────────────────────
def test_cenario_registrar_gasto(db, profile, patch_openai):
    patch_openai([
        assistant_tools(tool_call("registrar_transacao", tipo="gasto", valor=80,
                                  categoria="Lazer", descricao="cinema", data="hoje")),
        final({"nao_responder": False, "mensagens_cliente": ["Anotado! R$80 no cinema 🎬"]}),
    ])
    reply = A.run("sess", "cinema 80", profile)
    txs = db.rows("transactions")
    assert len(txs) == 1 and txs[0]["type"] == "expense" and txs[0]["amount"] == 80.0
    assert reply["mensagens_cliente"] == ["Anotado! R$80 no cinema 🎬"]
    assert "_is_fallback" not in reply


def test_cenario_registrar_receita(db, profile, patch_openai):
    patch_openai([
        assistant_tools(tool_call("registrar_transacao", tipo="receita", valor=2000,
                                  categoria="Salário", descricao="salário")),
        final({"mensagens_cliente": ["Boa! Receita registrada 💰"]}),
    ])
    A.run("sess", "recebi 2000 de salario", profile)
    assert db.rows("transactions")[0]["type"] == "income"


def test_cenario_multi_tool_em_um_turno(db, profile, patch_openai):
    patch_openai([
        assistant_tools(
            tool_call("registrar_transacao", tipo="gasto", valor=30, categoria="Alimentação", descricao="almoço"),
            tool_call("registrar_transacao", tipo="receita", valor=100, categoria="Outros", descricao="pix"),
        ),
        final({"mensagens_cliente": ["Anotei os dois! 👍"]}),
    ])
    A.run("sess", "gastei 30 no almoço e recebi 100", profile)
    assert len(db.rows("transactions")) == 2


# ── valor alto: confirma antes (modelo não chama tool) ───────────────────────
def test_cenario_valor_alto_pede_confirmacao(db, profile, patch_openai):
    patch_openai([
        final({"mensagens_cliente": ["Eita! R$350 em pastel mesmo? 😅 Confirma?"]}),
    ])
    reply = A.run("sess", "350 pastel", profile)
    assert db.rows("transactions") == []      # nada registrado ainda
    assert "350" in reply["mensagens_cliente"][0]


# ── consultar / editar / deletar ─────────────────────────────────────────────
def test_cenario_consultar(db, profile, patch_openai):
    F.create_transaction(USER_ID, "expense", 40, "Mercado", "x")
    patch_openai([
        assistant_tools(tool_call("consultar_transacoes", tipo="gasto")),
        final({"mensagens_cliente": ["Você gastou R$40 no mercado."]}),
    ])
    reply = A.run("sess", "quanto gastei?", profile)
    assert reply["mensagens_cliente"]


def test_cenario_editar(db, profile, patch_openai):
    tx = F.create_transaction(USER_ID, "expense", 50, "Alimentação", "pizza", "2026-06-01")
    patch_openai([
        assistant_tools(tool_call("consultar_transacoes", categoria="Alimentação")),
        assistant_tools(tool_call("editar_transacao", id=tx["id"], valor=55)),
        final({"mensagens_cliente": ["Corrigido pra R$55 ✅"]}),
    ])
    A.run("sess", "a pizza foi 55 na verdade", profile)
    assert db.rows("transactions")[0]["amount"] == 55.0


def test_cenario_deletar(db, profile, patch_openai):
    tx = F.create_transaction(USER_ID, "expense", 50, "x", "y")
    patch_openai([
        assistant_tools(tool_call("consultar_transacoes")),
        assistant_tools(tool_call("deletar_transacao", id=tx["id"])),
        final({"mensagens_cliente": ["Apaguei pra você 🗑️"]}),
    ])
    A.run("sess", "apaga aquele gasto", profile)
    assert db.rows("transactions") == []


# ── metas e limites ───────────────────────────────────────────────────────────
def test_cenario_criar_meta(db, profile, patch_openai):
    patch_openai([
        assistant_tools(tool_call("gerenciar_meta", acao="criar", nome="Viagem", valor_alvo=5000)),
        final({"mensagens_cliente": ["Meta da viagem criada! ✈️"]}),
    ])
    A.run("sess", "quero juntar 5000 pra viagem", profile)
    assert len(db.rows("goals")) == 1


def test_cenario_definir_limite(db, profile, patch_openai):
    patch_openai([
        assistant_tools(tool_call("gerenciar_limite", acao="definir", categoria="Lazer", valor=300, periodo="mensal")),
        final({"mensagens_cliente": ["Limite de R$300 em lazer definido 👍"]}),
    ])
    A.run("sess", "limite de 300 em lazer", profile)
    assert db.rows("spending_limits")[0]["limit_amount"] == 300.0


def test_cenario_gasto_estoura_limite(db, profile, patch_openai):
    F.set_limit(USER_ID, "geral", 100, "monthly")
    patch_openai([
        assistant_tools(tool_call("registrar_transacao", tipo="gasto", valor=150, categoria="Outros", descricao="tv")),
        final({"mensagens_cliente": ["Anotado! Mas atenção: você passou do seu limite do mês ⚠️"]}),
    ])
    A.run("sess", "gastei 150 numa tv", profile)
    st = F.limit_status(USER_ID)[0]
    assert st["exceeded"] is True


def test_cenario_relatorio(db, profile, patch_openai):
    F.create_transaction(USER_ID, "expense", 100, "Alimentação", "x")
    patch_openai([
        assistant_tools(tool_call("gerar_relatorio", periodo="mes_atual")),
        final({"mensagens_cliente": ["No mês você gastou R$100 em Alimentação 🍔"]}),
    ])
    reply = A.run("sess", "me manda um relatório", profile)
    assert reply["mensagens_cliente"]


# ── silêncio / robustez ──────────────────────────────────────────────────────
def test_cenario_nao_responder(db, profile, patch_openai):
    patch_openai([final({"nao_responder": True, "mensagens_cliente": []})])
    reply = A.run("sess", "obrigado!", profile)
    assert reply["nao_responder"] is True and reply["mensagens_cliente"] == []


def test_cenario_parse_retry_recupera(db, profile, patch_openai):
    fake = patch_openai([
        raw("Claro, vou te ajudar!"),                       # não-JSON -> reinstrução
        final({"mensagens_cliente": ["Pronto!"]}),          # agora válido
    ])
    reply = A.run("sess", "oi", profile)
    assert reply["mensagens_cliente"] == ["Pronto!"]
    assert len(fake.calls) == 2


def test_cenario_fallback_apos_invalidos(db, profile, patch_openai):
    patch_openai([raw("um"), raw("dois"), raw("três")])     # 3 inválidas -> fallback
    reply = A.run("sess", "oi", profile)
    assert reply["_is_fallback"] is True
    assert reply["mensagens_cliente"]


def test_cenario_tool_args_invalidos_nao_quebra(db, profile, patch_openai):
    # registrar_transacao sem 'valor' -> TypeError capturado -> erro tratado
    patch_openai([
        assistant_tools(tool_call("registrar_transacao", tipo="gasto")),
        final({"mensagens_cliente": ["Quanto foi esse gasto?"]}),
    ])
    reply = A.run("sess", "gastei no mercado", profile)
    assert db.rows("transactions") == []
    assert reply["mensagens_cliente"]


def test_cenario_tool_inexistente_nao_quebra(db, profile, patch_openai):
    patch_openai([
        assistant_tools(tool_call("ferramenta_que_nao_existe", x=1)),
        final({"mensagens_cliente": ["Deixa comigo!"]}),
    ])
    reply = A.run("sess", "faz algo", profile)
    assert reply["mensagens_cliente"] == ["Deixa comigo!"]


def test_cenario_openai_excecao_retorna_fallback(db, profile, monkeypatch):
    from tests.fakes import FakeOpenAI

    class Boom(FakeOpenAI):
        def __init__(self):
            super().__init__([])

    boom = FakeOpenAI([])

    def explode(**kw):
        raise RuntimeError("api down")

    boom.chat.completions.create = explode
    from app.services import openai_client
    monkeypatch.setattr(openai_client, "get", lambda: boom)
    reply = A.run("sess", "oi", profile)
    assert reply["_is_fallback"] is True
