"""Recibo determinístico de transação ('mensagem meio pronta').

format_transaction_card monta o cartão; ai_agent_svc.run expõe os cartões em
`_cards` (separado de mensagens_cliente, p/ o pipeline enviar antes do comentário
e NÃO persistir na memória).
"""
from app.services import ai_agent_svc as A
from tests.fakes import assistant_tools, tool_call, final


# ── formatador ────────────────────────────────────────────────────────────────
def test_card_gasto_tem_infos():
    card = A.format_transaction_card({
        "tipo": "gasto", "valor": 80.5, "titulo": "Cinema com a Gata",
        "categoria": "Lazer", "local": "Shopping", "data": "2026-06-15",
    })
    assert "✅ Gasto registrado" in card
    assert "💸 80,50 €" in card
    assert "📌 Cinema com a Gata" in card
    assert "🏷️ Lazer" in card
    assert "📍 Shopping" in card
    assert "📅 15/06/2026" in card


def test_card_receita_usa_rotulo_e_emoji_proprios():
    card = A.format_transaction_card({"tipo": "receita", "valor": 2000, "titulo": "Salário"})
    assert "✅ Receita registrada" in card
    assert "💰 2.000,00 €" in card


def test_card_em_reais():
    card = A.format_transaction_card({
        "tipo": "gasto", "valor": 80.5, "moeda": "BRL", "titulo": "Cinema"
    })
    assert "💸 R$ 80,50" in card


def test_card_omite_campos_ausentes():
    card = A.format_transaction_card({"tipo": "gasto", "valor": 10, "titulo": "Pão"})
    assert "📍" not in card          # sem local
    assert "🏷️" not in card          # sem categoria


def test_fmt_eur_milhar_e_decimal():
    assert A._fmt_eur(1234.5) == "1.234,50 €"
    assert A._fmt_eur(0) == "0,00 €"
    assert A._fmt_eur("xxx") == "0,00 €"


# ── integração com run() ──────────────────────────────────────────────────────
def test_run_expoe_cards_ao_registrar(db, profile, patch_openai):
    patch_openai([
        assistant_tools(tool_call("registrar_transacao", tipo="gasto", valor=80,
                                  titulo="Cinema", categoria="Lazer", descricao="cinema")),
        final({"mensagens_cliente": ["Anotado! 🎬"]}),
    ])
    reply = A.run("sess", "cinema 80", profile)
    assert "_cards" in reply and len(reply["_cards"]) == 1
    assert "Gasto registrado" in reply["_cards"][0]
    # o comentário do agente fica intacto e separado do recibo
    assert reply["mensagens_cliente"] == ["Anotado! 🎬"]


def test_run_sem_registro_nao_tem_cards(db, profile, patch_openai):
    patch_openai([final({"mensagens_cliente": ["Oi! 😊"]})])
    reply = A.run("sess", "oi", profile)
    assert "_cards" not in reply


def test_run_dois_registros_dois_cards(db, profile, patch_openai):
    patch_openai([
        assistant_tools(
            tool_call("registrar_transacao", tipo="gasto", valor=30, titulo="Almoço", categoria="Alimentação"),
            tool_call("registrar_transacao", tipo="receita", valor=100, titulo="Pix", categoria="Outros"),
        ),
        final({"mensagens_cliente": ["Anotei os dois! 👍"]}),
    ])
    reply = A.run("sess", "almoço 30 e recebi 100 de pix", profile)
    assert len(reply["_cards"]) == 2
    assert "Gasto registrado" in reply["_cards"][0]
    assert "Receita registrada" in reply["_cards"][1]


def test_run_forca_resposta_quando_registra(db, profile, patch_openai):
    # Mesmo que o modelo tente silenciar após registrar, o recibo precisa sair.
    patch_openai([
        assistant_tools(tool_call("registrar_transacao", tipo="gasto", valor=12, titulo="Café")),
        final({"nao_responder": True, "mensagens_cliente": []}),
    ])
    reply = A.run("sess", "café 12", profile)
    assert reply["nao_responder"] is False
    assert len(reply["_cards"]) == 1


def test_run_expoe_tool_trace_p_memoria(db, profile, patch_openai):
    # run() registra as ferramentas executadas em _tool_trace (vai p/ a memória).
    patch_openai([
        assistant_tools(tool_call("registrar_transacao", tipo="gasto", valor=80, titulo="Cinema")),
        final({"mensagens_cliente": ["Anotado! 🎬"]}),
    ])
    reply = A.run("sess", "cinema 80", profile)
    assert [t["name"] for t in reply["_tool_trace"]] == ["registrar_transacao"]
    assert reply["_tool_trace"][0]["args"]["valor"] == 80
