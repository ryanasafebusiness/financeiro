"""Tool: gerar_relatorio — resumo financeiro de um período.

formato="resumo" (padrão): devolve os números p/ o agente narrar em texto.
formato="pdf": monta um PDF bonito e ENVIA como documento no WhatsApp do usuário.
"""
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from app.config import settings
from app.services import finance_svc, uazapi_svc, report_pdf_svc
from app.currency import format_money, normalize_currency

_MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
          "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"]

DEFINITION = {
    "type": "function",
    "function": {
        "name": "gerar_relatorio",
        "description": (
            "Gera um relatório financeiro do período: total de receitas, gastos, saldo e gasto por "
            "categoria. Com formato='pdf', monta um PDF bonito e o ENVIA como documento no WhatsApp "
            "do usuário (use quando pedirem 'em pdf', 'me manda o relatório', 'gera um documento')."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "periodo": {"type": "string",
                            "enum": ["mes_atual", "mes_passado", "semana", "personalizado"],
                            "description": "Período do relatório. Padrão: mes_atual."},
                "formato": {"type": "string", "enum": ["resumo", "pdf"],
                            "description": "resumo (números p/ responder no chat) ou pdf (envia o documento). Padrão: resumo."},
                "data_inicio": {"type": "string", "description": "'AAAA-MM-DD' (para periodo personalizado)."},
                "data_fim": {"type": "string", "description": "'AAAA-MM-DD' (para periodo personalizado)."},
            },
        },
    },
}


def _safe_filename(label: str) -> str:
    """Rótulo -> nome de arquivo seguro (sem / \\ : * ? etc.)."""
    out = label
    for ch in '/\\:*?"<>|':
        out = out.replace(ch, "-")
    return out.strip()


def _fmt_br(iso: str) -> str:
    try:
        return datetime.fromisoformat(str(iso)[:10]).strftime("%d/%m/%Y")
    except Exception:
        return str(iso)


def _resolve_period(periodo: str, data_inicio: str, data_fim: str, today: date) -> tuple[str, str, str]:
    """Devolve (data_inicio, data_fim, rótulo legível) do período pedido."""
    if periodo == "mes_passado":
        last_prev = today.replace(day=1) - timedelta(days=1)
        d0, d1 = finance_svc.month_bounds(last_prev)
        return d0, d1, f"{_MESES[last_prev.month - 1]} de {last_prev.year}"
    if periodo == "semana":
        d0, d1 = finance_svc.week_bounds(today)
        return d0, d1, f"Semana de {_fmt_br(d0)} a {_fmt_br(d1)}"
    if periodo == "personalizado" and data_inicio:
        d0 = finance_svc.parse_date(data_inicio, today)
        d1 = finance_svc.parse_date(data_fim, today) if data_fim else today.isoformat()
        return d0, d1, f"{_fmt_br(d0)} a {_fmt_br(d1)}"
    d0, d1 = finance_svc.month_bounds(today)
    return d0, d1, f"{_MESES[today.month - 1]} de {today.year}"


def execute(ctx: dict, periodo: str = "mes_atual", formato: str = "resumo",
            data_inicio: str = "", data_fim: str = "") -> dict:
    uid = ctx["user_id"]
    profile = ctx.get("profile") or {}
    tz = ZoneInfo(profile.get("timezone") or settings.app_tz)
    today = datetime.now(tz).date()

    d0, d1, label = _resolve_period(periodo, data_inicio, data_fim, today)
    currency = normalize_currency(profile.get("currency"))

    resumo = finance_svc.summary(uid, d0, d1, currency)
    por_categoria = finance_svc.spending_by_category(uid, d0, d1, currency)
    limites = finance_svc.limit_status(uid, currency=currency)

    base = {
        "ok": True,
        "moeda": currency,
        "periodo": {"inicio": d0, "fim": d1, "label": label},
        "receitas": resumo["total_income"],
        "gastos": resumo["total_expense"],
        "saldo": resumo["balance"],
        "lancamentos": resumo["count"],
        "gasto_por_categoria": por_categoria,
        "limites": limites,
    }

    if formato != "pdf":
        return base

    # ── PDF + envio como documento ────────────────────────────────────────────
    numero = (profile.get("phone") or "").strip()
    if not numero:
        return {**base, "formato": "pdf", "enviado": False, "erro": "sem_telefone",
                "instrucao": "Não foi possível enviar o PDF. Ofereça o resumo em texto."}

    transacoes = finance_svc.list_transactions(uid, date_from=d0, date_to=d1, limit=10000)
    transacoes, _ = finance_svc.convert_transactions(transacoes, currency)
    pdf_bytes = report_pdf_svc.build_financial_report_pdf(
        user_name=profile.get("name") or "",
        period_label=label,
        summary=resumo,
        by_category=por_categoria,
        transactions=transacoes,
        limits=limites,
        generated_at=datetime.now(tz),
        currency=currency,
    )
    doc_name = f"Relatório ZapWallet - {_safe_filename(label)}.pdf"
    caption = (
        f"📊 Relatório de {label}\n"
        f"Receitas: {format_money(resumo['total_income'], currency)}\n"
        f"Gastos: {format_money(resumo['total_expense'], currency)}\n"
        f"Saldo: {format_money(resumo['balance'], currency)}"
    )

    enviado = uazapi_svc.send_media(
        numero, uazapi_svc.pdf_data_uri(pdf_bytes), "document",
        doc_name=doc_name, text=caption, mimetype="application/pdf",
    )
    if not enviado:
        return {**base, "formato": "pdf", "enviado": False, "erro": "falha_envio",
                "instrucao": ("Não consegui enviar o PDF agora. Peça desculpas de forma leve e "
                              "ofereça mandar um resumo dos números em texto.")}
    return {**base, "formato": "pdf", "enviado": True, "arquivo": doc_name,
            "instrucao": ("O PDF JÁ FOI ENVIADO ao usuário como documento. Mande UMA bolha curta "
                          "confirmando o envio (ex.: 'Prontinho! Te mandei o relatório em PDF 📄') e "
                          "destaque o saldo do período. NÃO repita a tabela inteira nem liste tudo.")}
