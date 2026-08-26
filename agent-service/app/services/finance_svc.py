"""Lógica financeira do ZapWallet: transações, metas, limites e agregações.

Camada de domínio usada pelas tools do agente e pela API do painel. Tudo
síncrono, escopado por user_id, via service-role (RLS bypassada).
"""
import calendar
import logging
from datetime import date, datetime, timedelta, timezone

from dateutil import parser as dateparser

from app.services.supabase_svc import get_db

log = logging.getLogger(__name__)

# Palavras que ficam minúsculas no meio do título (estética pt-BR)
_TITLE_SMALL = {"de", "da", "do", "das", "dos", "e", "a", "o", "as", "os",
                "com", "para", "pra", "no", "na", "em", "um", "uma", "ao", "à"}


def norm_title(s: str) -> str:
    """Capitaliza o título de forma agradável (ex.: 'cinema com a gata' -> 'Cinema com a Gata')."""
    s = (s or "").strip()
    if not s:
        return ""
    out = []
    for i, w in enumerate(s.split()):
        lw = w.lower()
        out.append(lw if (i > 0 and lw in _TITLE_SMALL) else (lw[:1].upper() + lw[1:]))
    return " ".join(out)


# ── helpers de data ────────────────────────────────────────────────────────────
def parse_date(value: str | None, tz_today: date | None = None) -> str:
    """Converte 'hoje'/'ontem'/'anteontem'/ISO/dd/mm[/aaaa] em 'YYYY-MM-DD'.

    Sem valor -> hoje. Datas inválidas caem em hoje.
    """
    today = tz_today or date.today()
    if not value:
        return today.isoformat()
    v = str(value).strip().lower()
    if v in ("hoje", "today"):
        return today.isoformat()
    if v in ("ontem", "yesterday"):
        return (today - timedelta(days=1)).isoformat()
    if v in ("anteontem",):
        return (today - timedelta(days=2)).isoformat()
    # ISO (AAAA-MM-DD) primeiro — é o formato que o agente envia. Sem isso o
    # dayfirst do dateutil inverteria mês/dia (2026-06-05 -> 2026-05-06).
    try:
        return date.fromisoformat(v).isoformat()
    except ValueError:
        pass
    try:
        return dateparser.parse(v, dayfirst=True).date().isoformat()
    except Exception:
        return today.isoformat()


def month_bounds(ref: date | None = None) -> tuple[str, str]:
    ref = ref or date.today()
    first = ref.replace(day=1)
    nxt = (first.replace(day=28) + timedelta(days=4)).replace(day=1)
    last = nxt - timedelta(days=1)
    return first.isoformat(), last.isoformat()


def week_bounds(ref: date | None = None) -> tuple[str, str]:
    ref = ref or date.today()
    start = ref - timedelta(days=ref.weekday())  # segunda
    end = start + timedelta(days=6)              # domingo
    return start.isoformat(), end.isoformat()


# ── transações ──────────────────────────────────────────────────────────────────
def create_transaction(user_id: str, type_: str, amount: float, category: str = "",
                        description: str = "", occurred_on: str | None = None,
                        source: str = "whatsapp", *, title: str = "", location: str = "",
                        occurred_at: str | None = None, recurring_id: str | None = None) -> dict:
    # Resolve data/hora: occurred_at (ISO completo) tem prioridade; senão a data
    # (meio-dia); senão agora.
    if occurred_at:
        occ_at = str(occurred_at)
        occ_on = occ_at[:10]
    elif occurred_on:
        occ_on = parse_date(occurred_on)
        occ_at = f"{occ_on}T12:00:00"
    else:
        occ_on = parse_date(None)
        occ_at = datetime.now().isoformat()

    row = {
        "user_id": user_id,
        "type": type_,
        "amount": round(float(amount), 2),
        "title": norm_title(title) or norm_title(category) or "Transação",
        "category": category or None,
        "description": description or None,
        "location": location or None,
        "occurred_on": occ_on,
        "occurred_at": occ_at,
        "source": source,
        "recurring_id": recurring_id,
    }
    res = get_db().table("transactions").insert(row).execute()
    return res.data[0] if res.data else row


def list_transactions(user_id: str, type_: str | None = None, category: str | None = None,
                      date_from: str | None = None, date_to: str | None = None,
                      limit: int = 50) -> list[dict]:
    q = get_db().table("transactions").select("*").eq("user_id", user_id)
    if type_:
        q = q.eq("type", type_)
    if category:
        q = q.ilike("category", category)
    if date_from:
        q = q.gte("occurred_on", date_from)
    if date_to:
        q = q.lte("occurred_on", date_to)
    res = q.order("occurred_on", desc=True).order("created_at", desc=True).limit(limit).execute()
    return res.data or []


def update_transaction(user_id: str, tx_id: str, fields: dict) -> dict | None:
    clean = {k: v for k, v in fields.items()
             if k in ("type", "amount", "title", "category", "description",
                      "location", "occurred_on", "occurred_at") and v is not None}
    if "amount" in clean:
        clean["amount"] = round(float(clean["amount"]), 2)
    if "title" in clean:
        clean["title"] = norm_title(clean["title"])
    if "occurred_at" in clean:
        clean["occurred_on"] = str(clean["occurred_at"])[:10]
    elif "occurred_on" in clean:
        clean["occurred_on"] = parse_date(clean["occurred_on"])
    if not clean:
        return None
    res = get_db().table("transactions").update(clean).eq("id", tx_id).eq("user_id", user_id).execute()
    return res.data[0] if res.data else None


def delete_transaction(user_id: str, tx_id: str) -> bool:
    res = get_db().table("transactions").delete().eq("id", tx_id).eq("user_id", user_id).execute()
    return bool(res.data)


# ── categorias ───────────────────────────────────────────────────────────────────
def list_categories(user_id: str, type_: str | None = None) -> list[dict]:
    """Categorias do próprio usuário (nome, tipo, emoji, descrição).

    Cada usuário tem a sua cópia das categorias (semeada na criação do perfil),
    então filtramos só por user_id — sem as linhas globais (templates).
    """
    q = get_db().table("categories").select(
        "id, name, type, emoji, description"
    ).eq("user_id", user_id)
    if type_:
        q = q.in_("type", [type_, "both"])
    return q.order("type").order("name").execute().data or []


# ── metas ────────────────────────────────────────────────────────────────────────
def create_goal(user_id: str, name: str, target_amount: float,
                deadline: str | None = None, saved_amount: float = 0) -> dict:
    row = {
        "user_id": user_id,
        "name": name,
        "target_amount": round(float(target_amount), 2),
        "saved_amount": round(float(saved_amount or 0), 2),
        "deadline": parse_date(deadline) if deadline else None,
        "status": "active",
    }
    res = get_db().table("goals").insert(row).execute()
    return res.data[0] if res.data else row


def list_goals(user_id: str, status: str = "active") -> list[dict]:
    q = get_db().table("goals").select("*").eq("user_id", user_id)
    if status:
        q = q.eq("status", status)
    return q.order("created_at", desc=True).execute().data or []


def update_goal(user_id: str, goal_id: str, fields: dict) -> dict | None:
    clean = {k: v for k, v in fields.items()
             if k in ("name", "target_amount", "saved_amount", "deadline", "status") and v is not None}
    for k in ("target_amount", "saved_amount"):
        if k in clean:
            clean[k] = round(float(clean[k]), 2)
    if "deadline" in clean and clean["deadline"]:
        clean["deadline"] = parse_date(clean["deadline"])
    if not clean:
        return None
    res = get_db().table("goals").update(clean).eq("id", goal_id).eq("user_id", user_id).execute()
    return res.data[0] if res.data else None


# ── limites ────────────────────────────────────────────────────────────────────
def set_limit(user_id: str, category: str, limit_amount: float, period: str = "monthly") -> dict:
    row = {
        "user_id": user_id,
        "category": (category or "geral").strip().lower() or "geral",
        "period": period if period in ("monthly", "weekly") else "monthly",
        "limit_amount": round(float(limit_amount), 2),
    }
    res = get_db().table("spending_limits").upsert(
        row, on_conflict="user_id,category,period"
    ).execute()
    return res.data[0] if res.data else row


def list_limits(user_id: str) -> list[dict]:
    return get_db().table("spending_limits").select("*").eq("user_id", user_id).execute().data or []


def delete_limit(user_id: str, category: str, period: str = "monthly") -> bool:
    res = (get_db().table("spending_limits").delete()
           .eq("user_id", user_id).eq("category", (category or "geral").lower()).eq("period", period)
           .execute())
    return bool(res.data)


# ── agregações ─────────────────────────────────────────────────────────────────
def summary(user_id: str, date_from: str, date_to: str) -> dict:
    rows = list_transactions(user_id, date_from=date_from, date_to=date_to, limit=10000)
    income = sum(float(r["amount"]) for r in rows if r["type"] == "income")
    expense = sum(float(r["amount"]) for r in rows if r["type"] == "expense")
    return {
        "from": date_from, "to": date_to,
        "total_income": round(income, 2),
        "total_expense": round(expense, 2),
        "balance": round(income - expense, 2),
        "count": len(rows),
    }


def spending_by_category(user_id: str, date_from: str, date_to: str) -> list[dict]:
    rows = list_transactions(user_id, type_="expense", date_from=date_from, date_to=date_to, limit=10000)
    agg: dict[str, float] = {}
    for r in rows:
        cat = (r.get("category") or "Outros")
        agg[cat] = agg.get(cat, 0) + float(r["amount"])
    out = [{"category": k, "total": round(v, 2)} for k, v in agg.items()]
    out.sort(key=lambda x: x["total"], reverse=True)
    return out


def limit_status(user_id: str, category: str | None = None) -> list[dict]:
    """Para cada limite (ou só o da categoria informada), calcula quanto já foi
    gasto no período e quanto resta. Útil p/ avisar o usuário ao registrar gasto."""
    limits = list_limits(user_id)
    out = []
    for lim in limits:
        cat = lim["category"]
        if category is not None and cat not in ("geral", (category or "").strip().lower()):
            continue
        if lim["period"] == "weekly":
            d0, d1 = week_bounds()
        else:
            d0, d1 = month_bounds()
        if cat == "geral":
            spent = summary(user_id, d0, d1)["total_expense"]
        else:
            rows = list_transactions(user_id, type_="expense", category=cat,
                                     date_from=d0, date_to=d1, limit=10000)
            spent = sum(float(r["amount"]) for r in rows)
        cap = float(lim["limit_amount"])
        out.append({
            "category": cat,
            "period": lim["period"],
            "limit": round(cap, 2),
            "spent": round(spent, 2),
            "remaining": round(cap - spent, 2),
            "exceeded": spent > cap,
            "pct": round((spent / cap) * 100, 1) if cap else 0,
        })
    return out


# ── transações recorrentes ──────────────────────────────────────────────────────
def _clamp_day(y: int, m: int, day: int) -> date:
    return date(y, m, min(int(day), calendar.monthrange(y, m)[1]))


def _next_monthly(ref: date, dom: int) -> date:
    cand = _clamp_day(ref.year, ref.month, dom)
    if cand >= ref:
        return cand
    y, m = (ref.year + 1, 1) if ref.month == 12 else (ref.year, ref.month + 1)
    return _clamp_day(y, m, dom)


def _next_weekly(ref: date, dow_sun0: int) -> date:
    py_target = (int(dow_sun0) - 1) % 7   # 0=domingo -> weekday do Python (seg=0..dom=6)
    return ref + timedelta(days=(py_target - ref.weekday()) % 7)


def _next_yearly(ref: date, month: int, dom: int) -> date:
    cand = _clamp_day(ref.year, month, dom)
    return cand if cand >= ref else _clamp_day(ref.year + 1, month, dom)


def next_occurrence(frequency: str, ref: date, day_of_month=None, day_of_week=None, month_of_year=None) -> date:
    if frequency == "daily":
        return ref
    if frequency == "weekly":
        return _next_weekly(ref, day_of_week if day_of_week is not None else (ref.weekday() + 1) % 7)
    if frequency == "yearly":
        return _next_yearly(ref, month_of_year or ref.month, day_of_month or ref.day)
    return _next_monthly(ref, day_of_month or ref.day)   # monthly (padrão)


def _advance(frequency: str, d: date, day_of_month=None, day_of_week=None, month_of_year=None) -> date:
    if frequency == "daily":
        return d + timedelta(days=1)
    if frequency == "weekly":
        return d + timedelta(days=7)
    if frequency == "yearly":
        return _clamp_day(d.year + 1, month_of_year or d.month, day_of_month or d.day)
    y, m = (d.year + 1, 1) if d.month == 12 else (d.year, d.month + 1)   # monthly
    return _clamp_day(y, m, day_of_month or d.day)


def create_recurring(user_id: str, type_: str, title: str, amount: float, category: str = "",
                     description: str = "", location: str = "", frequency: str = "monthly",
                     day_of_month=None, day_of_week=None, month_of_year=None,
                     tz_today: date | None = None) -> dict:
    today = tz_today or date.today()
    nxt = next_occurrence(frequency, today, day_of_month, day_of_week, month_of_year)
    row = {
        "user_id": user_id,
        "type": type_,
        "title": norm_title(title) or norm_title(category) or "Recorrência",
        "amount": round(float(amount), 2),
        "category": category or None,
        "description": description or None,
        "location": location or None,
        "frequency": frequency,
        "day_of_month": day_of_month,
        "day_of_week": day_of_week,
        "month_of_year": month_of_year,
        "active": True,
        "next_run": nxt.isoformat(),
    }
    res = get_db().table("recurring_transactions").insert(row).execute()
    return res.data[0] if res.data else row


def list_recurring(user_id: str, active: bool | None = True) -> list[dict]:
    q = get_db().table("recurring_transactions").select("*").eq("user_id", user_id)
    if active is not None:
        q = q.eq("active", active)
    return q.order("next_run", desc=False).execute().data or []


def update_recurring(user_id: str, rec_id: str, fields: dict) -> dict | None:
    clean = {k: v for k, v in fields.items()
             if k in ("type", "title", "amount", "category", "description", "location",
                      "frequency", "day_of_month", "day_of_week", "month_of_year", "active")
             and v is not None}
    if "amount" in clean:
        clean["amount"] = round(float(clean["amount"]), 2)
    if "title" in clean:
        clean["title"] = norm_title(clean["title"])
    # Recalcula a próxima ocorrência se a regra mudou
    if any(k in clean for k in ("frequency", "day_of_month", "day_of_week", "month_of_year")):
        cur = (get_db().table("recurring_transactions").select("*")
               .eq("id", rec_id).eq("user_id", user_id).limit(1).execute().data)
        if cur:
            merged = {**cur[0], **clean}
            clean["next_run"] = next_occurrence(
                merged["frequency"], date.today(), merged.get("day_of_month"),
                merged.get("day_of_week"), merged.get("month_of_year")).isoformat()
    if not clean:
        return None
    res = get_db().table("recurring_transactions").update(clean).eq("id", rec_id).eq("user_id", user_id).execute()
    return res.data[0] if res.data else None


def delete_recurring(user_id: str, rec_id: str) -> bool:
    res = get_db().table("recurring_transactions").delete().eq("id", rec_id).eq("user_id", user_id).execute()
    return bool(res.data)


def materialize_due(today: date | None = None) -> int:
    """Cria as transações das recorrências vencidas (next_run <= hoje) e reagenda a
    próxima ocorrência futura. Uma transação por recorrência vencida (sem backfill)."""
    today = today or date.today()
    due = (get_db().table("recurring_transactions").select("*")
           .eq("active", True).lte("next_run", today.isoformat()).execute().data or [])
    created = 0
    for r in due:
        run_date = r.get("next_run")
        if not run_date:
            continue
        create_transaction(
            r["user_id"], r["type"], r["amount"],
            title=r.get("title"), category=r.get("category") or "",
            description=r.get("description") or "", location=r.get("location") or "",
            occurred_at=f"{run_date}T09:00:00", source="recurring", recurring_id=r["id"],
        )
        nxt = _advance(r["frequency"], date.fromisoformat(run_date),
                       r.get("day_of_month"), r.get("day_of_week"), r.get("month_of_year"))
        guard = 0
        while nxt <= today and guard < 400:
            nxt = _advance(r["frequency"], nxt, r.get("day_of_month"), r.get("day_of_week"), r.get("month_of_year"))
            guard += 1
        get_db().table("recurring_transactions").update(
            {"last_run": run_date, "next_run": nxt.isoformat()}).eq("id", r["id"]).execute()
        created += 1
    return created
