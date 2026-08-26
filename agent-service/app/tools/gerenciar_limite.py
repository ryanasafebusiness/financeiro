"""Tool: gerenciar_limite — define, lista, remove e checa limites de gasto."""
from app.services import finance_svc

_PERIODO = {"mensal": "monthly", "mes": "monthly", "monthly": "monthly",
            "semanal": "weekly", "semana": "weekly", "weekly": "weekly"}

DEFINITION = {
    "type": "function",
    "function": {
        "name": "gerenciar_limite",
        "description": (
            "Gerencia limites de gasto. acao='definir' cria/atualiza um limite por categoria "
            "(use categoria 'geral' para o limite total); 'status' mostra quanto já foi gasto "
            "vs o limite no período; 'listar' lista os limites; 'remover' apaga um limite."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "acao": {"type": "string", "enum": ["definir", "status", "listar", "remover"]},
                "categoria": {"type": "string",
                              "description": "Categoria do limite, ou 'geral' para o total. Padrão: geral."},
                "valor": {"type": "number", "description": "Valor do limite (para 'definir')."},
                "periodo": {"type": "string", "enum": ["mensal", "semanal"],
                            "description": "Período do limite. Padrão: mensal."},
            },
            "required": ["acao"],
        },
    },
}


def execute(ctx: dict, acao: str, categoria: str = "geral", valor: float | None = None,
            periodo: str = "mensal") -> dict:
    uid = ctx["user_id"]
    acao = (acao or "status").lower()
    period = _PERIODO.get((periodo or "mensal").lower(), "monthly")
    cat = (categoria or "geral").strip().lower() or "geral"

    if acao == "definir":
        if valor is None:
            return {"ok": False, "erro": "sem_valor",
                    "instrucao": "Para definir um limite preciso do valor."}
        lim = finance_svc.set_limit(uid, cat, valor, period)
        return {"ok": True, "limite": {"categoria": lim["category"], "periodo": lim["period"],
                                       "valor": float(lim["limit_amount"])}}

    if acao == "remover":
        ok = finance_svc.delete_limit(uid, cat, period)
        return {"ok": ok, "removido": cat if ok else None}

    if acao == "listar":
        lims = finance_svc.list_limits(uid)
        return {"ok": True, "limites": [
            {"categoria": l["category"], "periodo": l["period"], "valor": float(l["limit_amount"])}
            for l in lims
        ]}

    # status — categoria explícita filtra; 'geral' (padrão) mostra todos os limites
    filtro = None if cat == "geral" else cat
    st = finance_svc.limit_status(uid, filtro)
    return {"ok": True, "status": st}
