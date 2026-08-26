"""Tool: registrar_transacao — cria um gasto (expense) ou receita (income)."""
from app.services import finance_svc
from app.tools._common import INVALID_AMOUNT, parse_amount

DEFINITION = {
    "type": "function",
    "function": {
        "name": "registrar_transacao",
        "description": (
            "Registra um novo gasto ou receita do usuário. Use sempre que o usuário "
            "informar que gastou, pagou, comprou, recebeu ou ganhou um valor."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "tipo": {"type": "string", "enum": ["gasto", "receita"],
                         "description": "gasto (saída de dinheiro) ou receita (entrada)."},
                "valor": {"type": "number", "description": "Valor em reais, ex: 80.50"},
                "titulo": {"type": "string",
                           "description": "Título curto e capitalizado da transação, ex: 'Cinema com a Gata', 'Mercado do Mês'."},
                "descricao": {"type": "string",
                              "description": "Uma frase curta descrevendo a transação, ex: 'Sessão de cinema no shopping com a namorada'."},
                "categoria": {"type": "string",
                              "description": "Categoria (use uma das categorias do usuário pelo nome exato; senão 'Outros')."},
                "local": {"type": "string",
                          "description": "Local/estabelecimento, se mencionado (opcional). Ex: 'Shopping Iguatemi'."},
                "data": {"type": "string",
                         "description": "Data: 'hoje', 'ontem' ou 'AAAA-MM-DD'. Padrão: hoje (com a hora atual)."},
            },
            "required": ["tipo", "valor", "titulo"],
        },
    },
}


def execute(ctx: dict, tipo: str, valor: float, titulo: str = "", categoria: str = "",
            descricao: str = "", local: str = "", data: str = "") -> dict:
    valor = parse_amount(valor)
    if valor is None:        # sem valor / zero / negativo -> pede, não registra
        return INVALID_AMOUNT
    type_ = "income" if str(tipo).lower().startswith("rec") else "expense"
    # data vazia/'hoje' -> finance usa agora (data e hora); senão usa a data informada (meio-dia)
    occurred_on = None if str(data).strip().lower() in ("", "hoje", "today") else data
    tx = finance_svc.create_transaction(
        ctx["user_id"], type_, valor, categoria, descricao, occurred_on,
        title=titulo, location=local,
    )
    result = {
        "ok": True,
        "registrado": {
            "id": tx.get("id"),
            "tipo": tipo,
            "titulo": tx.get("title"),
            "valor": float(tx.get("amount", valor)),
            "categoria": tx.get("category"),
            "descricao": tx.get("description"),
            "local": tx.get("location"),
            "data": tx.get("occurred_on"),
            "data_hora": tx.get("occurred_at"),
        },
    }
    if type_ == "expense":
        alerts = [l for l in finance_svc.limit_status(ctx["user_id"], categoria)
                  if l["exceeded"] or l["pct"] >= 80]
        if alerts:
            result["alertas_limite"] = alerts
    return result
