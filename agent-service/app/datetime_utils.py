"""Parsing tolerante de datas/datetimes vindos do Postgres/Supabase.

O Postgres devolve `timestamptz` com fração de segundo de precisão variável
(ex.: `.85378` — 5 dígitos) e offset abreviado (`+00`). O `datetime.fromisoformat`
do Python 3.10 só aceita frações de 3 ou 6 dígitos e offset `±HH:MM`, então
levanta `ValueError` nesses valores (o que fazia, p.ex., o gating tratar um
trial válido como expirado). Em 3.11+ o parser foi relaxado, mas normalizamos
aqui para funcionar em qualquer Python ≥3.10 e ser imune à precisão variável.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

# offset abreviado no fim da string: "+00" -> "+00:00"
_TZ_SHORT = re.compile(r"([+-]\d{2})$")
# fração de segundo de tamanho variável
_FRAC = re.compile(r"\.(\d+)")


def _normalize(s: str) -> str:
    s = s.strip().replace("Z", "+00:00")
    s = _TZ_SHORT.sub(r"\1:00", s)
    s = _FRAC.sub(lambda m: "." + (m.group(1) + "000000")[:6], s)
    return s


def parse_dt(value) -> datetime | None:
    """Parseia um timestamp(tz) tolerante a fração variável e offset abreviado.

    Retorna `None` se vazio/inválido. Datetimes sem timezone assumem UTC.
    """
    if not value:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        try:
            dt = datetime.fromisoformat(_normalize(str(value)))
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt
