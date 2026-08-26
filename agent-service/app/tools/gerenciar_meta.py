"""Tool: gerenciar_meta — cria, atualiza e lista metas de economia."""
from app.services import finance_svc


def _fmt(g: dict) -> dict:
    return {
        "id": g["id"],
        "nome": g.get("name"),
        "valor_alvo": float(g["target_amount"]),
        "valor_guardado": float(g["saved_amount"]),
        "prazo": g.get("deadline"),
        "status": g.get("status"),
        "progresso_pct": round((float(g["saved_amount"]) / float(g["target_amount"])) * 100, 1)
        if float(g["target_amount"]) else 0,
    }


DEFINITION = {
    "type": "function",
    "function": {
        "name": "gerenciar_meta",
        "description": (
            "Gerencia metas de economia do usuário. acao='criar' cria uma meta; "
            "'atualizar' altera (precisa do id, obtido em 'listar'); 'listar' mostra as metas ativas."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "acao": {"type": "string", "enum": ["criar", "atualizar", "listar"]},
                "id": {"type": "string", "description": "id da meta (para atualizar)."},
                "nome": {"type": "string", "description": "Nome da meta, ex: 'Viagem'."},
                "valor_alvo": {"type": "number", "description": "Valor a atingir."},
                "valor_guardado": {"type": "number", "description": "Quanto já foi guardado."},
                "prazo": {"type": "string", "description": "Data limite 'AAAA-MM-DD' (opcional)."},
                "status": {"type": "string", "enum": ["active", "completed", "archived"]},
            },
            "required": ["acao"],
        },
    },
}


def execute(ctx: dict, acao: str, id: str = "", nome: str = "", valor_alvo: float | None = None,
            valor_guardado: float | None = None, prazo: str = "", status: str = "") -> dict:
    uid = ctx["user_id"]
    acao = (acao or "listar").lower()

    if acao == "criar":
        if not nome or valor_alvo is None:
            return {"ok": False, "erro": "dados_incompletos",
                    "instrucao": "Para criar uma meta preciso do nome e do valor alvo."}
        g = finance_svc.create_goal(uid, nome, valor_alvo, prazo or None, valor_guardado or 0)
        return {"ok": True, "meta": _fmt(g)}

    if acao == "atualizar":
        if not id:
            return {"ok": False, "erro": "sem_id",
                    "instrucao": "Liste as metas primeiro para obter o id antes de atualizar."}
        fields = {"name": nome or None, "target_amount": valor_alvo,
                  "saved_amount": valor_guardado, "deadline": prazo or None,
                  "status": status or None}
        g = finance_svc.update_goal(uid, id, fields)
        if not g:
            return {"ok": False, "erro": "nao_encontrado"}
        return {"ok": True, "meta": _fmt(g)}

    # listar
    metas = [_fmt(g) for g in finance_svc.list_goals(uid)]
    return {"ok": True, "total": len(metas), "metas": metas}
