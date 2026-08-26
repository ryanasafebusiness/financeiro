"""Moedas aceitas nos lançamentos financeiros."""

SUPPORTED_CURRENCIES = ("EUR", "BRL")


def normalize_currency(value, default: str = "EUR") -> str:
    raw = str(value or "").strip().upper()
    aliases = {
        "EUR": "EUR", "EURO": "EUR", "EUROS": "EUR", "€": "EUR",
        "BRL": "BRL", "REAL": "BRL", "REAIS": "BRL", "R$": "BRL",
    }
    normalized = aliases.get(raw, raw)
    return normalized if normalized in SUPPORTED_CURRENCIES else default


def format_money(value, currency: str = "EUR") -> str:
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = 0.0
    digits = f"{number:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"R$ {digits}" if normalize_currency(currency) == "BRL" else f"{digits} €"
