"""Tool: gerenciar_recorrencia — cria/lista/remove/atualiza transações recorrentes.

Ex.: salário entra todo dia 15 (receita, mensal, dia_do_mes=15)
     aluguel sai todo dia 10 (gasto, mensal, dia_do_mes=10)
"""
from datetime import datetime
from zoneinfo import ZoneInfo

from app.services import finance_svc
from app.tools._common import INVALID_AMOUNT, parse_amount

_FREQ = {
    "mensal": "monthly", "mês": "monthly", "mes": "monthly", "monthly": "monthly",
    "semanal": "weekly", "semana": "weekly", "weekly": "weekly",
    "diario": "daily", "diário": "daily", "daily": "daily",
    "anual": "yearly", "ano": "yearly", "yearly": "yearly",
}
_FREQ_PT = {"monthly": "mensal", "weekly": "semanal", "daily": "diário", "yearly": "anual"}

DEFINITION = {
    "type": "function",
    "function": {
        "name": "gerenciar_recorrencia",
        "description": (
            "Gerencia transações recorrentes (que se repetem automaticamente). "
            "Use quando o usuário disser que algo entra/sai todo mês/semana num dia fixo "
            "(ex.: 'meu salário cai todo dia 15', 'o aluguel sai dia 10'). "
            "acao='criar' cria; 'listar' mostra; 'atualizar' altera (precisa do id); 'remover' apaga."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "acao": {"type": "string", "enum": ["criar", "listar", "atualizar", "remover"]},
                "id": {"type": "string", "description": "id da recorrência (para atualizar/remover)."},
                "tipo": {"type": "string", "enum": ["gasto", "receita"]},
                "titulo": {"type": "string", "description": "Título capitalizado, ex: 'Salário', 'Aluguel'."},
                "valor": {"type": "number"},
                "categoria": {"type": "string"},
                "descricao": {"type": "string", "description": "Frase curta opcional."},
                "local": {"type": "string", "description": "Local/origem opcional."},
                "frequencia": {"type": "string", "enum": ["mensal", "semanal", "diario", "anual"],
                               "description": "Padrão: mensal."},
                "dia_do_mes": {"type": "integer", "description": "Dia do mês 1-31 (p/ mensal/anual)."},
                "dia_da_semana": {"type": "integer", "description": "0=domingo … 6=sábado (p/ semanal)."},
                "mes_do_ano": {"type": "integer", "description": "1-12 (p/ anual)."},
                "ativo": {"type": "boolean", "description": "Ativar/pausar (p/ atualizar)."},
            },
            "required": ["acao"],
        },
    },
}


def _fmt(r: dict) -> dict:
    return {
        "id": r["id"],
        "tipo": "gasto" if r["type"] == "expense" else "receita",
        "titulo": r.get("title"),
        "valor": float(r["amount"]),
        "categoria": r.get("category"),
        "frequencia": _FREQ_PT.get(r.get("frequency"), r.get("frequency")),
        "dia_do_mes": r.get("day_of_month"),
        "proxima_ocorrencia": r.get("next_run"),
        "ativo": r.get("active"),
    }


def execute(ctx: dict, acao: str, id: str = "", tipo: str = "", titulo: str = "",
            valor: float | None = None, categoria: str = "", descricao: str = "", local: str = "",
            frequencia: str = "mensal", dia_do_mes=None, dia_da_semana=None, mes_do_ano=None,
            ativo=None) -> dict:
    uid = ctx["user_id"]
    acao = (acao or "listar").lower()

    if acao == "criar":
        if not titulo:
            return {"ok": False, "erro": "dados_incompletos",
                    "instrucao": "Para criar uma recorrência preciso do título e do valor (e o dia, p/ mensal)."}
        valor = parse_amount(valor)
        if valor is None:    # sem valor / zero / negativo -> pede, não cria
            return INVALID_AMOUNT
        type_ = "income" if str(tipo).lower().startswith("rec") else "expense"
        freq = _FREQ.get((frequencia or "mensal").lower(), "monthly")
        tz = ZoneInfo((ctx.get("profile") or {}).get("timezone") or "America/Fortaleza")
        today = datetime.now(tz).date()
        r = finance_svc.create_recurring(
            uid, type_, titulo, valor, category=categoria, description=descricao, location=local,
            frequency=freq, day_of_month=dia_do_mes, day_of_week=dia_da_semana,
            month_of_year=mes_do_ano, tz_today=today,
        )
        return {"ok": True, "recorrencia": _fmt(r)}

    if acao == "listar":
        return {"ok": True, "recorrencias": [_fmt(r) for r in finance_svc.list_recurring(uid, active=None)]}

    if acao == "remover":
        if not id:
            return {"ok": False, "erro": "sem_id", "instrucao": "Liste as recorrências para obter o id."}
        return {"ok": finance_svc.delete_recurring(uid, id), "removido_id": id}

    if acao == "atualizar":
        if not id:
            return {"ok": False, "erro": "sem_id", "instrucao": "Liste as recorrências para obter o id."}
        fields: dict = {}
        if tipo:
            fields["type"] = "income" if str(tipo).lower().startswith("rec") else "expense"
        if titulo:
            fields["title"] = titulo
        if valor is not None:
            valor = parse_amount(valor)
            if valor is None:    # tentou zerar o valor -> bloqueia
                return INVALID_AMOUNT
            fields["amount"] = valor
        if categoria:
            fields["category"] = categoria
        if descricao:
            fields["description"] = descricao
        if local:
            fields["location"] = local
        if frequencia:
            fields["frequency"] = _FREQ.get(frequencia.lower(), "monthly")
        if dia_do_mes is not None:
            fields["day_of_month"] = dia_do_mes
        if dia_da_semana is not None:
            fields["day_of_week"] = dia_da_semana
        if mes_do_ano is not None:
            fields["month_of_year"] = mes_do_ano
        if ativo is not None:
            fields["active"] = bool(ativo)
        r = finance_svc.update_recurring(uid, id, fields)
        if not r:
            return {"ok": False, "erro": "nao_encontrado"}
        return {"ok": True, "recorrencia": _fmt(r)}

    return {"ok": False, "erro": "acao_invalida"}
