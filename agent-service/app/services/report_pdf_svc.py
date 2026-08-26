"""Gera o PDF de um relatório financeiro do ZapWallet (bytes), via fpdf2.

Função pura: recebe os dados já agregados (não toca no banco) e devolve os bytes
do PDF — fácil de testar offline. Usa as fontes core (Helvetica) com encoding
cp1252, então todo texto é higienizado para cp1252 (acentos e o símbolo do euro
passam; emojis são removidos). ATENÇÃO: latin-1 puro NÃO tem "€" — trocar este
encoding de volta faria o símbolo sumir silenciosamente do relatório.
"""
from datetime import datetime

from app.datetime_utils import parse_dt
from app.currency import format_money
from fpdf import FPDF
from fpdf.enums import XPos, YPos

# Paleta (mesma vibe do painel)
GREEN = (22, 163, 74)
RED = (220, 38, 38)
DARK = (31, 41, 55)
GRAY = (107, 114, 128)
LIGHT = (243, 244, 246)
ZEBRA = (249, 250, 251)
LINE = (229, 231, 235)

_MAX_TX_ROWS = 40


def _txt(s) -> str:
    """Mantém acentos e o "€" (cp1252) e descarta o que a fonte core não imprime (emojis)."""
    s = "" if s is None else str(s)
    return s.encode("cp1252", "ignore").decode("cp1252").strip()


def _eur(v) -> str:
    """12345.6 -> '12.345,60 €' (com sinal quando negativo)."""
    try:
        n = float(v)
    except (TypeError, ValueError):
        n = 0.0
    s = f"{abs(n):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"-{s} €" if n < 0 else f"{s} €"


def _ellipsize(s: str, limit: int) -> str:
    s = _txt(s)
    return s if len(s) <= limit else s[: limit - 1].rstrip() + "..."


def _fmt_dt(tx: dict) -> str:
    dt = parse_dt(tx.get("occurred_at"))
    if dt is not None:
        return dt.strftime("%d/%m %H:%M")
    on = tx.get("occurred_on")
    if on:
        try:
            return datetime.fromisoformat(str(on)[:10]).strftime("%d/%m")
        except Exception:
            return str(on)[:10]
    return "-"


class _ReportPDF(FPDF):
    def __init__(self, period_label: str, generated_str: str, currency: str = "EUR"):
        super().__init__(orientation="P", unit="mm", format="A4")
        # cp1252 (WinAnsi) em vez do latin-1 padrão do fpdf2: é o que permite
        # imprimir o "€" com as fontes core.
        self.core_fonts_encoding = "cp1252"
        self.period_label = period_label
        self.generated_str = generated_str
        self.currency = currency
        self.set_margins(14, 14, 14)
        self.set_auto_page_break(auto=True, margin=18)

    # Faixa verde fina em todas as páginas
    def header(self):
        self.set_fill_color(*GREEN)
        self.rect(0, 0, 210, 22, style="F")
        self.set_text_color(255, 255, 255)
        self.set_font("Helvetica", "B", 16)
        self.set_xy(14, 5)
        self.cell(120, 8, "ZapWallet")
        self.set_font("Helvetica", "", 10)
        self.set_xy(14, 13)
        self.cell(120, 5, "Relatório Financeiro")
        self.set_font("Helvetica", "B", 11)
        self.set_xy(96, 9)
        self.cell(100, 6, self.period_label, align="R")
        self.set_y(30)

    def footer(self):
        self.set_y(-14)
        self.set_draw_color(*LINE)
        self.set_line_width(0.2)
        self.line(14, self.get_y(), 196, self.get_y())
        self.set_y(-12)
        self.set_font("Helvetica", "", 8)
        self.set_text_color(*GRAY)
        self.cell(91, 6, f"Gerado por ZapWallet em {self.generated_str}")
        self.cell(91, 6, f"Página {self.page_no()}", align="R")

    # ── blocos ──────────────────────────────────────────────────────────────
    def summary_boxes(self, income: float, expense: float, balance: float):
        y = self.get_y()
        gap = 6.0
        box_w = (182 - 2 * gap) / 3
        cards = [
            ("Receitas", income, GREEN),
            ("Gastos", expense, RED),
            ("Saldo", balance, GREEN if balance >= 0 else RED),
        ]
        x = 14.0
        for label, val, color in cards:
            self.set_fill_color(*LIGHT)
            self.set_draw_color(*LINE)
            self.rect(x, y, box_w, 22, style="DF")
            self.set_fill_color(*color)
            self.rect(x, y, 2.4, 22, style="F")
            self.set_xy(x + 6, y + 4)
            self.set_text_color(*GRAY)
            self.set_font("Helvetica", "", 9)
            self.cell(box_w - 8, 5, label)
            self.set_xy(x + 6, y + 10)
            self.set_text_color(*color)
            self.set_font("Helvetica", "B", 15)
            self.cell(box_w - 8, 8, _txt(format_money(val, self.currency)))
            x += box_w + gap
        self.set_y(y + 30)

    def section_title(self, text: str):
        self.ln(2)
        self.set_text_color(*DARK)
        self.set_font("Helvetica", "B", 12)
        self.cell(0, 7, _txt(text), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        y = self.get_y()
        self.set_draw_color(*GREEN)
        self.set_line_width(0.6)
        self.line(14, y, 40, y)
        self.ln(3)

    def _thead(self, cols):
        self.set_font("Helvetica", "B", 9)
        self.set_text_color(*GRAY)
        self.set_fill_color(*LIGHT)
        for i, (w, label, align) in enumerate(cols):
            last = i == len(cols) - 1
            self.cell(w, 7, label, align=align, fill=True,
                      new_x=(XPos.LMARGIN if last else XPos.RIGHT),
                      new_y=(YPos.NEXT if last else YPos.TOP))

    def category_table(self, by_category, total_expense: float):
        self._thead([(86, "Categoria", "L"), (46, "Valor", "R"), (50, "% dos gastos", "R")])
        if not by_category:
            self.set_text_color(*GRAY)
            self.set_font("Helvetica", "I", 9)
            self.cell(0, 7, "Sem gastos no período.", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            return
        self.set_font("Helvetica", "", 10)
        for i, row in enumerate(by_category):
            fill = i % 2 == 1
            if fill:
                self.set_fill_color(*ZEBRA)
            val = float(row.get("total") or 0)
            pct = (val / total_expense * 100) if total_expense else 0
            self.set_text_color(*DARK)
            self.cell(86, 7, _ellipsize(row.get("category") or "Outros", 42), fill=fill)
            self.cell(46, 7, _txt(format_money(val, self.currency)), align="R", fill=fill)
            self.cell(50, 7, f"{pct:.1f}%", align="R", fill=fill,
                      new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    def tx_table(self, transactions):
        self._thead([(28, "Data", "L"), (74, "Título", "L"), (40, "Categoria", "L"), (40, "Valor", "R")])
        if not transactions:
            self.set_text_color(*GRAY)
            self.set_font("Helvetica", "I", 9)
            self.cell(0, 7, "Nenhum lançamento no período.", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            return
        self.set_font("Helvetica", "", 9)
        for i, t in enumerate(transactions[:_MAX_TX_ROWS]):
            fill = i % 2 == 1
            if fill:
                self.set_fill_color(*ZEBRA)
            inc = t.get("type") == "income"
            title = _ellipsize(t.get("title") or t.get("description") or "-", 40)
            self.set_text_color(*DARK)
            self.cell(28, 6, _fmt_dt(t), fill=fill)
            self.cell(74, 6, title, fill=fill)
            self.cell(40, 6, _ellipsize(t.get("category") or "-", 20), fill=fill)
            self.set_text_color(*(GREEN if inc else RED))
            self.cell(40, 6, ("+ " if inc else "- ") + _txt(format_money(abs(float(t.get("amount") or 0)), self.currency)),
                      align="R", fill=fill, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        extra = len(transactions) - _MAX_TX_ROWS
        if extra > 0:
            self.set_text_color(*GRAY)
            self.set_font("Helvetica", "I", 8)
            self.cell(0, 6, f"... e mais {extra} lançamento(s). Veja todos no painel.",
                      new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    def limits_table(self, limits):
        self._thead([(56, "Categoria", "L"), (30, "Período", "L"),
                     (56, "Gasto / Limite", "R"), (40, "Status", "R")])
        self.set_font("Helvetica", "", 9)
        for i, l in enumerate(limits):
            fill = i % 2 == 1
            if fill:
                self.set_fill_color(*ZEBRA)
            per = "Mensal" if l.get("period") == "monthly" else "Semanal"
            exceeded = bool(l.get("exceeded"))
            status = "Estourado" if exceeded else f"{float(l.get('pct') or 0):.0f}%"
            self.set_text_color(*DARK)
            self.cell(56, 7, _ellipsize(str(l.get("category", "")).capitalize(), 28), fill=fill)
            self.cell(30, 7, per, fill=fill)
            self.cell(56, 7, f"{_eur(l.get('spent', 0))} / {_eur(l.get('limit', 0))}", align="R", fill=fill)
            self.set_text_color(*(RED if exceeded else DARK))
            self.cell(40, 7, status, align="R", fill=fill, new_x=XPos.LMARGIN, new_y=YPos.NEXT)


def build_financial_report_pdf(*, user_name: str, period_label: str, summary: dict,
                               by_category, transactions, limits=None,
                               generated_at: datetime | None = None,
                               currency: str = "EUR") -> bytes:
    """Monta o PDF do relatório e devolve os bytes."""
    generated_at = generated_at or datetime.now()
    pdf = _ReportPDF(_txt(period_label) or "Período", generated_at.strftime("%d/%m/%Y %H:%M"), currency)
    pdf.add_page()

    pdf.set_text_color(*GRAY)
    pdf.set_font("Helvetica", "", 10)
    count = int(summary.get("count") or 0)
    pdf.cell(0, 6, _txt(f"Cliente: {user_name or 'Você'}   |   {count} lançamento(s) no período"),
             new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(2)

    pdf.summary_boxes(
        float(summary.get("total_income") or 0),
        float(summary.get("total_expense") or 0),
        float(summary.get("balance") or 0),
    )
    pdf.section_title("Gastos por categoria")
    pdf.category_table(by_category or [], float(summary.get("total_expense") or 0))
    pdf.section_title("Lançamentos do período")
    pdf.tx_table(transactions or [])
    if limits:
        pdf.section_title("Limites de gasto")
        pdf.limits_table(limits)

    return bytes(pdf.output())
