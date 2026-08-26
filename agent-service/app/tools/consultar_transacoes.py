"""Tool: consultar_transacoes — lista/filtra gastos e receitas e devolve resumo."""
from app.services import finance_svc

DEFINITION = {
    "type": "function",
    "function": {
        "name": "consultar_transacoes",
        "description": (
            "Busca os lançamentos (gastos/receitas) do usuário. Use SEMPRE que ele "
            "perguntar sobre seus gastos, receitas, histórico ou para achar o id de um "
            "lançamento antes de editar/excluir. Nunca responda de memória."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "tipo": {"type": "string", "enum": ["gasto", "receita", "todos"],
                         "description": "Filtra por tipo. Padrão: todos."},
                "categoria": {"type": "string", "description": "Filtra por categoria (opcional)."},
                "data_inicio": {"type": "string", "description": "'AAAA-MM-DD' (opcional)."},
                "data_fim": {"type": "string", "description": "'AAAA-MM-DD' (opcional)."},
                "limite": {"type": "integer", "description": "Máximo de itens (padrão 30)."},
                "moeda": {"type": "string", "enum": ["EUR", "BRL"],
                          "description": "Moeda a consultar; padrão é a moeda preferida do usuário."},
            },
        },
    },
}


def execute(ctx: dict, tipo: str = "todos", categoria: str = "",
            data_inicio: str = "", data_fim: str = "", limite: int = 30, moeda: str = "") -> dict:
    type_ = None
    if str(tipo).lower().startswith("gas"):
        type_ = "expense"
    elif str(tipo).lower().startswith("rec"):
        type_ = "income"

    currency = moeda or (ctx.get("profile") or {}).get("currency") or "EUR"
    rows = finance_svc.list_transactions(
        ctx["user_id"], type_=type_, category=categoria or None,
        date_from=data_inicio or None, date_to=data_fim or None,
        limit=min(int(limite or 30), 200),
    )
    rows, rates = finance_svc.convert_transactions(rows, currency)
    itens = [{
        "id": r["id"],
        "tipo": "gasto" if r["type"] == "expense" else "receita",
        "valor": float(r["amount"]),
        "moeda": r.get("currency", currency),
        "valor_original": r.get("original_amount"),
        "moeda_original": r.get("original_currency"),
        "categoria": r.get("category"),
        "descricao": r.get("description"),
        "data": r.get("occurred_on"),
    } for r in rows]

    income = sum(i["valor"] for i in itens if i["tipo"] == "receita")
    expense = sum(i["valor"] for i in itens if i["tipo"] == "gasto")
    return {
        "ok": True,
        "total_itens": len(itens),
        "moeda": currency,
        "cotacao_data": rates.get("date") if rates else None,
        "resumo": {"receitas": round(income, 2), "gastos": round(expense, 2),
                   "saldo": round(income - expense, 2)},
        "itens": itens,
    }
