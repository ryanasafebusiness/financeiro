"""Dublês de teste: FakeSupabase (query builder em memória) e FakeOpenAI (scriptado).

FakeSupabase emula o suficiente do supabase-py (.table().select()/insert()/update()/
delete()/upsert() + filtros + order/limit + execute()) para rodar finance_svc, as
tools e supabase_svc sem servidor. FakeOpenAI devolve respostas pré-roteirizadas para
exercitar o loop de tool-calling de ai_agent_svc.run de forma determinística.
"""
import itertools
import json
import re
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace


# ════════════════════════════════════════════════════════════════════════
#  FakeSupabase
# ════════════════════════════════════════════════════════════════════════
class FakeResponse:
    def __init__(self, data, count=None):
        self.data = data
        self.count = count


def _to_num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _cmp(cell, val, op):
    if cell is None:
        return False
    cn, vn = _to_num(cell), _to_num(val)
    if cn is not None and vn is not None:
        a, b = cn, vn
    else:
        a, b = str(cell), str(val)
    if op == "gt":
        return a > b
    if op == "gte":
        return a >= b
    if op == "lt":
        return a < b
    if op == "lte":
        return a <= b
    return False


def _ilike(cell, pattern):
    if cell is None:
        return False
    if "%" in pattern:
        regex = "^" + re.escape(pattern).replace("\\%", ".*") + "$"
        return re.match(regex, str(cell), re.IGNORECASE) is not None
    return str(cell).lower() == str(pattern).lower()


class FakeQuery:
    def __init__(self, table_store, table_name, counters):
        self._store = table_store
        self._table = table_name
        self._counters = counters
        self._filters = []          # (op, col, val)
        self._or = None
        self._order = []            # (col, desc)
        self._limit = None
        self._single = False
        self._op = "select"
        self._payload = None
        self._on_conflict = None
        self._count = None

    # ── operação ──
    def select(self, _cols="*", count=None):
        self._op, self._count = "select", count
        return self

    def insert(self, payload):
        self._op, self._payload = "insert", payload
        return self

    def update(self, payload):
        self._op, self._payload = "update", payload
        return self

    def delete(self):
        self._op = "delete"
        return self

    def upsert(self, payload, on_conflict=None):
        self._op, self._payload, self._on_conflict = "upsert", payload, on_conflict
        return self

    # ── filtros ──
    def eq(self, c, v): self._filters.append(("eq", c, v)); return self
    def neq(self, c, v): self._filters.append(("neq", c, v)); return self
    def gt(self, c, v): self._filters.append(("gt", c, v)); return self
    def gte(self, c, v): self._filters.append(("gte", c, v)); return self
    def lt(self, c, v): self._filters.append(("lt", c, v)); return self
    def lte(self, c, v): self._filters.append(("lte", c, v)); return self
    def ilike(self, c, v): self._filters.append(("ilike", c, v)); return self
    def in_(self, c, vals): self._filters.append(("in", c, list(vals))); return self
    def or_(self, expr): self._or = expr; return self
    def order(self, c, desc=False): self._order.append((c, desc)); return self
    def limit(self, n): self._limit = n; return self
    def single(self): self._single = True; return self
    def maybe_single(self): self._single = True; return self

    # ── matching ──
    def _match(self, row):
        for op, c, v in self._filters:
            cell = row.get(c)
            if op == "eq" and cell != v:
                return False
            if op == "neq" and cell == v:
                return False
            if op == "in" and cell not in v:
                return False
            if op == "ilike" and not _ilike(cell, v):
                return False
            if op in ("gt", "gte", "lt", "lte") and not _cmp(cell, v, op):
                return False
        if self._or and not self._match_or(row):
            return False
        return True

    def _match_or(self, row):
        for clause in self._or.split(","):
            parts = clause.split(".", 2)
            if len(parts) < 2:
                continue
            col, op = parts[0], parts[1]
            val = parts[2] if len(parts) > 2 else None
            cell = row.get(col)
            if op == "is" and val == "null" and cell is None:
                return True
            if op == "eq" and str(cell) == str(val):
                return True
            if op == "ilike" and _ilike(cell, val):
                return True
        return False

    # ── execução ──
    def execute(self):
        rows = self._store
        if self._op == "select":
            matched = [dict(r) for r in rows if self._match(r)]
            for col, desc in reversed(self._order):
                matched.sort(key=lambda r: (r.get(col) is None, r.get(col)), reverse=desc)
            count = len(matched)
            if self._limit is not None:
                matched = matched[: self._limit]
            if self._single:
                return FakeResponse(matched[0] if matched else None, count)
            return FakeResponse(matched, count)

        if self._op == "insert":
            return FakeResponse(self._do_insert(self._payload))

        if self._op == "update":
            updated = []
            for r in rows:
                if self._match(r):
                    r.update(self._payload)
                    updated.append(dict(r))
            return FakeResponse(updated)

        if self._op == "delete":
            removed = [dict(r) for r in rows if self._match(r)]
            self._store[:] = [r for r in rows if not self._match(r)]
            return FakeResponse(removed)

        if self._op == "upsert":
            payloads = self._payload if isinstance(self._payload, list) else [self._payload]
            out = []
            cols = (self._on_conflict or "").split(",") if self._on_conflict else []
            for p in payloads:
                existing = None
                if cols:
                    for r in rows:
                        if all(r.get(c) == p.get(c) for c in cols):
                            existing = r
                            break
                if existing:
                    existing.update(p)
                    out.append(dict(existing))
                else:
                    out.extend(self._do_insert(p))
            return FakeResponse(out)

        return FakeResponse([])

    def _do_insert(self, payload):
        payloads = payload if isinstance(payload, list) else [payload]
        out = []
        for p in payloads:
            row = dict(p)
            if "id" not in row or row["id"] is None:
                if self._table == "chat_histories":
                    row["id"] = next(self._counters["seq"])
                else:
                    row["id"] = uuid.uuid4().hex
            seq = next(self._counters["seq"])
            row.setdefault("created_at", f"2026-01-01T00:00:{seq % 60:02d}.{seq:06d}+00:00")
            self._store.append(row)
            out.append(dict(row))
        return out


class FakeSupabase:
    """Substituto do client supabase-py. Acesse o estado por .store[table]."""

    def __init__(self):
        self.store: dict[str, list] = {}
        self._counters = {"seq": itertools.count(1)}

    def table(self, name):
        self.store.setdefault(name, [])
        return FakeQuery(self.store[name], name, self._counters)

    # atalhos de teste
    def seed(self, table, row):
        self.store.setdefault(table, [])
        r = dict(row)
        r.setdefault("created_at", datetime.now(timezone.utc).isoformat())
        self.store[table].append(r)
        return r

    def rows(self, table):
        return self.store.get(table, [])


# ════════════════════════════════════════════════════════════════════════
#  FakeOpenAI (scriptado)
# ════════════════════════════════════════════════════════════════════════
def tool_call(name, **args):
    """Uma chamada de ferramenta dentro de um turno do modelo."""
    return (name, args)


def assistant_tools(*calls):
    """Turno do modelo que dispara ferramentas. calls = tool_call(...) itens."""
    tcs = []
    for i, (name, args) in enumerate(calls):
        tcs.append(SimpleNamespace(
            id=f"call_{i}",
            type="function",
            function=SimpleNamespace(name=name, arguments=json.dumps(args, ensure_ascii=False)),
        ))
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=None, tool_calls=tcs))])


def final(obj):
    """Turno final do modelo: objeto vira JSON; string é usada crua."""
    content = obj if isinstance(obj, str) else json.dumps(obj, ensure_ascii=False)
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content, tool_calls=None))])


def raw(text):
    """Turno final cru (texto não-JSON) — exercita o reinstruct/parse-retry."""
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=text, tool_calls=None))])


class _FakeCompletions:
    def __init__(self, script):
        self.script = list(script)
        self.calls = []

    def create(self, **kwargs):
        # snapshot das messages (a lista é mutada entre iterações do loop)
        snap = dict(kwargs)
        if "messages" in snap:
            snap["messages"] = [dict(m) for m in snap["messages"]]
        self.calls.append(snap)
        if not self.script:
            raise AssertionError("FakeOpenAI: script esgotado (chamadas a mais)")
        return self.script.pop(0)


class FakeOpenAI:
    def __init__(self, script):
        self.chat = SimpleNamespace(completions=_FakeCompletions(script))

    @property
    def calls(self):
        return self.chat.completions.calls
