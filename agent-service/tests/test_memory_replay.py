"""Memória reconstrói o fluxo de ferramentas (assistant tool_calls -> tool -> texto).

Sem isso, o histórico reinjetado mostra só o texto final do agente e o modelo
aprende a "responder direto" sem chamar a ferramenta (passa a alucinar registros).
Com o _replay, o histórico mostra que cada ação passou por uma ferramenta.
"""
import json

from app.services import supabase_svc

SESSION = "5585999999999_memory"


def test_append_grava_replay_no_turno_ai(db):
    supabase_svc.append_memory(
        SESSION, "cinema 80", json.dumps({"mensagens_cliente": ["Anotado!"]}),
        tool_calls=[{"id": "call_0", "name": "registrar_transacao",
                     "args": {"tipo": "gasto", "valor": 80}, "result": '{"ok": true}'}],
    )
    ai_rows = [r for r in db.rows("chat_histories") if r["message"]["type"] == "ai"]
    assert ai_rows[0]["message"]["_replay"][0]["name"] == "registrar_transacao"


def test_get_memory_reconstroi_fluxo_de_tool(db):
    supabase_svc.append_memory(
        SESSION, "cinema 80", json.dumps({"mensagens_cliente": ["Anotado!"]}),
        tool_calls=[{"id": "call_0", "name": "registrar_transacao",
                     "args": {"tipo": "gasto", "valor": 80}, "result": '{"ok": true}'}],
    )
    mem = supabase_svc.get_memory(SESSION, 50)
    # user -> assistant(tool_calls) -> tool -> assistant(texto)
    assert [m["role"] for m in mem] == ["user", "assistant", "tool", "assistant"]
    assert mem[1]["content"] is None
    assert mem[1]["tool_calls"][0]["function"]["name"] == "registrar_transacao"
    assert json.loads(mem[1]["tool_calls"][0]["function"]["arguments"])["valor"] == 80
    assert mem[2]["tool_call_id"] == "call_0" and "ok" in mem[2]["content"]
    assert json.loads(mem[3]["content"])["mensagens_cliente"] == ["Anotado!"]


def test_get_memory_turno_sem_replay_e_simples(db):
    # Turno antigo sem ação (saudação): continua sendo só user -> assistant.
    supabase_svc.append_memory(SESSION, "oi", json.dumps({"mensagens_cliente": ["Olá!"]}))
    mem = supabase_svc.get_memory(SESSION, 50)
    assert [m["role"] for m in mem] == ["user", "assistant"]


def test_get_memory_legado_infere_tool_por_texto(db):
    # Turno legado (sem _replay) cujo texto afirma ação -> infere a tool retroativamente,
    # p/ o histórico antigo não reensinar o modelo a responder sem ferramenta.
    supabase_svc.append_memory(
        SESSION, "cinema 80",
        json.dumps({"mensagens_cliente": ["Registrei um gasto de 80 € no cinema 🎬"]}),
    )
    mem = supabase_svc.get_memory(SESSION, 50)
    assert [m["role"] for m in mem] == ["user", "assistant", "tool", "assistant"]
    assert mem[1]["tool_calls"][0]["function"]["name"] == "registrar_transacao"


def test_infer_legacy_tool_mapeia_verbos():
    assert supabase_svc._infer_legacy_tool("Removi o gasto de R$20") == "deletar_transacao"
    assert supabase_svc._infer_legacy_tool("Atualizei pra R$55") == "editar_transacao"
    assert supabase_svc._infer_legacy_tool("Registrei seu almoço") == "registrar_transacao"
    assert supabase_svc._infer_legacy_tool("Oi! Como posso ajudar?") is None
    assert supabase_svc._infer_legacy_tool("Quer que eu registre esse gasto?") is None


def test_get_memory_resultado_truncado(db):
    grande = json.dumps({"itens": ["x" * 50 for _ in range(100)]})
    supabase_svc.append_memory(
        SESSION, "meus gastos", json.dumps({"mensagens_cliente": ["..."]}),
        tool_calls=[{"id": "c1", "name": "consultar_transacoes", "args": {}, "result": grande}],
    )
    mem = supabase_svc.get_memory(SESSION, 50)
    tool_msg = next(m for m in mem if m["role"] == "tool")
    assert len(tool_msg["content"]) <= 800
