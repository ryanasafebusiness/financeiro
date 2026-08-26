"""Bateria de smoke test do agente com OpenAI REAL e banco ISOLADO (FakeSupabase).

Diferente da suíte pytest (que usa um OpenAI mockado), este script valida o
comportamento REAL do modelo: decisão de chamar a ferramenta certa, tool-calling,
recibo e pedido de valor — exatamente o que mocks não pegam. O banco é um
FakeSupabase em memória, então NÃO toca no seu Supabase real; só as chamadas ao
OpenAI são reais (custa alguns centavos por execução, ~25 chamadas).

Use depois de configurar a chave da OpenAI (no .env ou no painel admin) para
confirmar que a instalação responde de verdade. Sai com código 1 se algo falhar.

    cd agent-service && .venv/bin/python smoke_agent.py
"""
import json
from datetime import datetime, timedelta, timezone

import openai
from app.services import settings_svc, supabase_svc, ai_agent_svc, openai_client
from tests.fakes import FakeSupabase

# 1) captura chave/modelo reais ANTES de isolar o banco
REAL_KEY = settings_svc.get_openai_api_key()
REAL_MODEL = settings_svc.get_openai_model()
assert REAL_KEY, "sem OPENAI_API_KEY (no .env ou painel)"

# 2) isola o banco num FakeSupabase semeado
UID = "11111111-1111-1111-1111-111111111111"
PHONE = "5511999990000"
fake = FakeSupabase()
fake.seed("profiles", {
    "id": UID, "name": "Teste", "phone": PHONE, "email": f"wa{PHONE}@zapwallet.app",
    "premium_until": (datetime.now(timezone.utc) + timedelta(days=30)).isoformat(),
    "plan": "Mensal", "is_admin": False, "ai_online": True,
    "messages_this_month": 0, "message_limit": 0, "timezone": "America/Fortaleza",
})
for name, typ, emoji in [("Alimentação", "expense", "🍔"), ("Transporte", "expense", "🚗"),
                         ("Mercado", "expense", "🛒"), ("Lazer", "expense", "🎬"),
                         ("Outros", "expense", "📦"), ("Salário", "income", "💰")]:
    fake.seed("categories", {"id": None, "user_id": UID, "name": name, "type": typ,
                             "emoji": emoji, "description": None})
supabase_svc._client = fake
settings_svc._cache.clear()

# 3) força o client OpenAI real (o Fake não tem app_secrets)
_oai = openai.OpenAI(api_key=REAL_KEY)
openai_client.get = lambda: _oai
settings_svc.get_openai_model = lambda: REAL_MODEL

SID = f"{PHONE}_memory"


def profile():
    return supabase_svc.get_profile(UID)


def turn(text):
    """Roda um turno e persiste a memória como o pipeline faz (com tool trace)."""
    reply = ai_agent_svc.run(SID, text, profile())
    trace = reply.get("_tool_trace", [])
    cards = reply.get("_cards", [])
    clean = {k: v for k, v in reply.items() if not k.startswith("_")}
    supabase_svc.append_memory(SID, text, json.dumps(clean, ensure_ascii=False), tool_calls=trace)
    return reply, [t["name"] for t in trace], cards


def txs():
    return fake.rows("transactions")


def recs():
    return fake.rows("recurring_transactions")


results = []


def check(name, cond, detail=""):
    results.append(cond)
    flag = "✅" if cond else "❌"
    print(f"  {flag} {name}" + (f"  [{detail}]" if detail else ""))


print("\n=== BATERIA DE SMOKE TEST (OpenAI real, banco isolado) ===\n")

# 1) saudação não dispara tool
r, tools, cards = turn("oi, tudo bem?")
check("Saudação responde sem ferramenta", tools == [] and bool(r["mensagens_cliente"]),
      " ".join(r["mensagens_cliente"])[:50])

# 2) registrar gasto + recibo
r, tools, cards = turn("cinema 80")
check("Registra gasto", "registrar_transacao" in tools and len(txs()) == 1)
check("Recibo do gasto sai com valor", bool(cards) and "R$ 80,00" in cards[0])

# 3) registrar receita
r, tools, cards = turn("recebi 2000 de salário")
check("Registra receita", "registrar_transacao" in tools and any(t["type"] == "income" for t in txs()))
check("Recibo da receita", bool(cards) and "Receita registrada" in cards[0])

# 4) registrar SEM valor -> pede, não cria
n_before = len(txs())
r, tools, cards = turn("comprei um lanche agora")
print(f"     [debug cenário 4] tools={tools} cards={len(cards)} nao_responder={r.get('nao_responder')} "
      f"msgs={r.get('mensagens_cliente')}")
check("Sem valor: NÃO cria lançamento", len(txs()) == n_before, f"{len(txs())} txs")
check("Sem valor: pede o valor / não manda recibo", not cards and bool(r["mensagens_cliente"]),
      " ".join(r["mensagens_cliente"])[:50])

# 5) consultar / relatório
r, tools, cards = turn("quanto eu gastei esse mês?")
check("Consulta gastos", ("consultar_transacoes" in tools or "gerar_relatorio" in tools) and bool(r["mensagens_cliente"]))

# 6) editar (consulta o id e altera)
r, tools, cards = turn("muda o valor do cinema pra 100")
cinema = next((t for t in txs() if (t.get("title") or "").lower().startswith("cinema")), None)
check("Edita o gasto do cinema p/ 100", "editar_transacao" in tools and cinema and float(cinema["amount"]) == 100.0,
      f"valor={cinema and cinema['amount']}")

# 7) deletar
n_before = len(txs())
r, tools, cards = turn("apaga o salário que registrei")
check("Deleta a receita do salário", "deletar_transacao" in tools and len(txs()) == n_before - 1)

# 8) criar meta
r, tools, cards = turn("quero juntar 5000 pra uma viagem")
check("Cria meta", "gerenciar_meta" in tools and len(fake.rows("goals")) == 1)

# 9) definir limite
r, tools, cards = turn("põe um limite de 300 em lazer por mês")
check("Define limite", "gerenciar_limite" in tools and len(fake.rows("spending_limits")) >= 1)

# 10) recorrência COM valor
r, tools, cards = turn("meu aluguel de 1500 vence todo dia 10")
check("Cria recorrência com valor", "gerenciar_recorrencia" in tools and len(recs()) == 1,
      f"{len(recs())} recs")

# 11) recorrência SEM valor -> pede, não cria (o bug que corrigimos)
n_before = len(recs())
r, tools, cards = turn("tenho uma assinatura da netflix que renova todo dia 10")
check("Recorrência sem valor: NÃO cria com R$ 0,00", len(recs()) == n_before, f"{len(recs())} recs")
check("Recorrência sem valor: pede o valor", bool(r["mensagens_cliente"]),
      " ".join(r["mensagens_cliente"])[:50])

# sumário
ok = sum(1 for c in results if c)
print(f"\n=== RESULTADO: {ok}/{len(results)} checagens passaram ===")
if ok != len(results):
    raise SystemExit(1)
