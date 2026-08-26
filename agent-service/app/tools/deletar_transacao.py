"""Tool: deletar_transacao — exclui um lançamento (pelo id)."""
from app.services import finance_svc

DEFINITION = {
    "type": "function",
    "function": {
        "name": "deletar_transacao",
        "description": (
            "Exclui um lançamento. Primeiro use consultar_transacoes para achar o id "
            "correto antes de chamar esta tool."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "id": {"type": "string", "description": "id do lançamento a excluir."},
            },
            "required": ["id"],
        },
    },
}


def execute(ctx: dict, id: str) -> dict:
    ok = finance_svc.delete_transaction(ctx["user_id"], id)
    if not ok:
        return {"ok": False, "erro": "nao_encontrado",
                "instrucao": "Lançamento não encontrado. Consulte novamente para confirmar o id."}
    return {"ok": True, "excluido_id": id}
