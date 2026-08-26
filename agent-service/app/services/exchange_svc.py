"""Cotação EUR/BRL oficial do BCE, publicada pela API Frankfurter."""
from __future__ import annotations

import logging
import time

import httpx

from app.currency import normalize_currency

log = logging.getLogger(__name__)

_URL = "https://api.frankfurter.dev/v2/rate/EUR/BRL?providers=ECB"
_CACHE_TTL = 6 * 60 * 60
_cache: dict[str, object] = {}


class ExchangeRateUnavailable(RuntimeError):
    pass


def latest() -> dict:
    """Retorna a cotação mais recente; usa cache vencido se a fonte oscilar."""
    now = time.monotonic()
    if _cache and now - float(_cache.get("fetched_at", 0)) < _CACHE_TTL:
        return dict(_cache)
    try:
        response = httpx.get(_URL, timeout=5.0)
        response.raise_for_status()
        payload = response.json()
        rate = float(payload["rate"])
        if rate <= 0:
            raise ValueError("cotação inválida")
        _cache.update({
            "date": str(payload["date"]),
            "eur_brl": rate,
            "provider": "ECB",
            "fetched_at": now,
        })
    except Exception as exc:
        if not _cache:
            raise ExchangeRateUnavailable("Cotação EUR/BRL indisponível") from exc
        log.warning("Cotação atual indisponível; usando último valor em cache: %s", exc)
    return dict(_cache)


def rates_for(target_currency: str) -> dict:
    """Multiplicadores para converter EUR e BRL à moeda de destino."""
    target = normalize_currency(target_currency)
    quote = latest()
    eur_brl = float(quote["eur_brl"])
    rates = {"EUR": eur_brl, "BRL": 1.0} if target == "BRL" else {"EUR": 1.0, "BRL": 1 / eur_brl}
    return {
        "target": target,
        "date": quote["date"],
        "provider": quote["provider"],
        "rates": rates,
    }


def convert(amount, source_currency: str, target_currency: str, rates: dict | None = None) -> float:
    source = normalize_currency(source_currency)
    target = normalize_currency(target_currency)
    number = float(amount or 0)
    if source == target:
        return round(number, 2)
    snapshot = rates or rates_for(target)
    return round(number * float(snapshot["rates"][source]), 2)


def reset_cache() -> None:
    _cache.clear()
