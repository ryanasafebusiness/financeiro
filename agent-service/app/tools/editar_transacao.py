"""Tool: editar_transacao — altera um lançamento existente (pelo id)."""
from app.services import finance_svc
from app.tools._common import INVALID_AMOUNT, parse_amount

DEFINITION = {
    "type": "function",
    "function": {
        "name": "editar_transacao",
        "description": (
            "Edita um lançamento existente. Primeiro use consultar_transacoes para achar "
            "o id correto. Informe apenas os campos que mudam."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "id": {"type": "string", "description": "id do lançamento (obtido em consultar_transacoes)."},
                "tipo": {"type": "string", "enum": ["gasto", "receita"]},
                "valor": {"type": "number"},
                "titulo": {"type": "string", "description": "Novo título curto e capitalizado."},
                "categoria": {"type": "string"},
                "descricao": {"type": "string", "description": "Nova frase curta sobre a transação."},
                "local": {"type": "string", "description": "Local/estabelecimento."},
                "data": {"type": "string", "description": "'hoje', 'ontem' ou 'AAAA-MM-DD'."},
            },
            "required": ["id"],
        },
    },
}


def execute(ctx: dict, id: str, tipo: str = "", valor: float | None = None,
            titulo: str = "", categoria: str = "", descricao: str = "",
            local: str = "", data: str = "") -> dict:
    fields: dict = {}
    if tipo:
        fields["type"] = "income" if str(tipo).lower().startswith("rec") else "expense"
    if valor is not None:
        valor = parse_amount(valor)
        if valor is None:        # tentou editar p/ zero/negativo -> bloqueia
            return INVALID_AMOUNT
        fields["amount"] = valor
    if titulo:
        fields["title"] = titulo
    if categoria:
        fields["category"] = categoria
    if descricao:
        fields["description"] = descricao
    if local:
        fields["location"] = local
    if data:
        fields["occurred_on"] = data

    updated = finance_svc.update_transaction(ctx["user_id"], id, fields)
    if not updated:
        return {"ok": False, "erro": "nao_encontrado",
                "instrucao": "Lançamento não encontrado. Consulte novamente para confirmar o id."}
    return {
        "ok": True,
        "atualizado": {
            "id": updated["id"],
            "tipo": "gasto" if updated["type"] == "expense" else "receita",
            "titulo": updated.get("title"),
            "valor": float(updated["amount"]),
            "categoria": updated.get("category"),
            "descricao": updated.get("description"),
            "local": updated.get("location"),
            "data": updated.get("occurred_on"),
        },
    }
