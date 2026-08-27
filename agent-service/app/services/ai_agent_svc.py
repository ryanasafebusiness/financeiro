"""Loop de tool-calling (OpenAI, síncrono) com saída JSON estruturada.

O agente conversa como o Gobbi, registra/consulta finanças via tools e sua
mensagem FINAL deve ser um único objeto JSON: {nao_responder, mensagens_cliente}.
`run()` devolve esse dict; o pipeline (tasks.py) transforma mensagens_cliente em
bolhas no WhatsApp e persiste a memória em chat_histories.
"""
import json
import logging
import re
from datetime import datetime

from app.config import settings
from app.currency import format_money, normalize_currency
from app.datetime_utils import parse_dt
from app.prompts import OUTPUT_CONTRACT
from app.services import supabase_svc, finance_svc, settings_svc, openai_client
from app.tools import (
    registrar_transacao, consultar_transacoes, editar_transacao,
    deletar_transacao, gerenciar_meta, gerenciar_limite, gerar_relatorio,
    gerenciar_recorrencia,
)

log = logging.getLogger(__name__)

_MODULES = {
    "registrar_transacao": registrar_transacao,
    "consultar_transacoes": consultar_transacoes,
    "editar_transacao": editar_transacao,
    "deletar_transacao": deletar_transacao,
    "gerenciar_meta": gerenciar_meta,
    "gerenciar_limite": gerenciar_limite,
    "gerar_relatorio": gerar_relatorio,
    "gerenciar_recorrencia": gerenciar_recorrencia,
}
TOOLS = [m.DEFINITION for m in _MODULES.values()]

_REINSTRUCT_JSON = (
    "Sua última resposta não veio como JSON válido do formato pedido. Responda AGORA "
    "somente com o objeto JSON, sem texto fora dele e sem markdown."
)


def build_context(profile: dict) -> str:
    """Contexto dinâmico injetado no system: nome, data, plano e panorama do mês."""
    from datetime import datetime
    from zoneinfo import ZoneInfo

    tz = ZoneInfo(profile.get("timezone") or settings.app_tz)
    now = datetime.now(tz)
    d0, d1 = finance_svc.month_bounds(now.date())
    currency = normalize_currency(profile.get("currency"))
    s = finance_svc.summary(profile["id"], d0, d1, currency)
    goals = finance_svc.list_goals(profile["id"])
    limits = finance_svc.limit_status(profile["id"], currency=currency)
    categories = finance_svc.list_categories(profile["id"])

    lines = [
        "--- CONTEXTO ATUAL (use, não peça de novo) ---",
        f"Nome do usuário: {profile.get('name') or 'desconhecido'}",
        f"Data e hora agora: {now.strftime('%d/%m/%Y %H:%M')} ({tz.key})",
        f"Plano: {profile.get('plan') or 'Trial'}",
        f"Moeda preferida: {currency}. Se a mensagem disser euro/€ use EUR; se disser real/reais/R$ use BRL; sem moeda explícita use {currency}.",
        f"Mês atual em {currency}: receitas {s['total_income']:.2f} {currency}, "
        f"gastos {s['total_expense']:.2f} {currency}, saldo {s['balance']:.2f} {currency} "
        f"({s['count']} lançamentos).",
    ]
    if categories:
        cat_lines = []
        for c in categories:
            emoji = (c.get("emoji") or "").strip()
            label = f"{emoji} {c['name']}".strip()
            desc = (c.get("description") or "").strip()
            cat_lines.append(f"- {label}" + (f": {desc}" if desc else ""))
        lines.append(
            "Categorias do usuário (classifique cada lançamento em UMA delas pelo nome exato, "
            "usando a descrição como guia; se nenhuma servir, use 'Outros'):\n"
            + "\n".join(cat_lines)
        )
    if goals:
        gtxt = "; ".join(
            f"{g['name']} ({float(g['saved_amount']):.2f} €/{float(g['target_amount']):.2f} €)"
            for g in goals[:5]
        )
        lines.append(f"Metas ativas: {gtxt}")
    if limits:
        ltxt = "; ".join(
            f"{l['category']} {l['period']}: {l['spent']:.2f} €/{l['limit']:.2f} €"
            + (" (ESTOURADO)" if l["exceeded"] else "")
            for l in limits[:6]
        )
        lines.append(f"Limites: {ltxt}")
    lines.append("--- FIM DO CONTEXTO ---")
    return "\n".join(lines)


def run(session_id: str, user_input: str, profile: dict) -> dict:
    user_id = profile["id"]
    history = supabase_svc.get_memory(session_id, settings.max_context_messages)

    full_system = settings_svc.get_system_prompt() + "\n\n" + build_context(profile) + "\n\n" + OUTPUT_CONTRACT

    messages: list[dict] = [{"role": "system", "content": full_system}]
    messages.extend(history)
    messages.append({"role": "user", "content": user_input})

    ctx = {"user_id": user_id, "profile": profile}
    parse_retries = 0
    max_iterations = 12
    cards: list[str] = []   # recibos determinísticos de transações registradas no loop
    trace: list[dict] = []  # ferramentas executadas (p/ a memória reconstruir o fluxo)

    for _ in range(max_iterations):
        try:
            resp = openai_client.get().chat.completions.create(
                model=settings_svc.get_openai_model(),
                messages=messages,
                tools=TOOLS,
                tool_choice="auto",
            )
        except Exception as e:
            log.error("Chamada OpenAI falhou: %s", e)
            return _fallback()

        msg = resp.choices[0].message

        if msg.tool_calls:
            messages.append({
                "role": "assistant",
                "content": msg.content,
                "tool_calls": [
                    {"id": tc.id, "type": "function",
                     "function": {"name": tc.function.name, "arguments": tc.function.arguments}}
                    for tc in msg.tool_calls
                ],
            })
            for tc in msg.tool_calls:
                try:
                    args = json.loads(tc.function.arguments)
                except json.JSONDecodeError:
                    args = {}
                result = _dispatch(tc.function.name, args, ctx)
                # Recibo automático ao registrar uma transação com sucesso.
                if tc.function.name == "registrar_transacao" and isinstance(result, dict) \
                        and result.get("ok") and result.get("registrado"):
                    cards.append(format_transaction_card(result["registrado"]))
                result_json = json.dumps(result, ensure_ascii=False, default=str)
                # Registra a chamada p/ a memória reconstruir o fluxo depois (result truncado).
                trace.append({"id": tc.id, "name": tc.function.name, "args": args,
                              "result": result_json[:600]})
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": result_json,
                })
            continue

        text = msg.content or ""
        parsed = _try_parse(text)
        if parsed is None:
            if parse_retries >= 2:
                return _attach(_fallback(), cards, trace)
            parse_retries += 1
            if text:
                messages.append({"role": "assistant", "content": text})
            messages.append({"role": "user", "content": _REINSTRUCT_JSON})
            continue
        return _attach(parsed, cards, trace)

    return _attach(_fallback(), cards, trace)


# ── dispatch ──────────────────────────────────────────────────────────────────
def _dispatch(name: str, args: dict, ctx: dict) -> dict:
    mod = _MODULES.get(name)
    if not mod:
        return {"erro": f"tool '{name}' não encontrada"}
    try:
        return mod.execute(ctx, **args)
    except TypeError as e:
        log.warning("Args inválidos p/ %s: %s", name, e)
        return {"erro": "argumentos_invalidos", "detalhe": str(e)}
    except Exception as e:
        log.error("Tool %s falhou: %s", name, e)
        return {"erro": "erro_interno", "instrucao": (
            "Houve um erro ao executar a ferramenta. NÃO mencione problemas técnicos ao usuário. "
            "Peça gentilmente para repetir a informação."
        )}


# ── parsing da saída ─────────────────────────────────────────────────────────
def _extract_json_object(text: str) -> str | None:
    depth, start, in_str, esc = 0, None, False, False
    for i, ch in enumerate(text):
        if esc:
            esc = False
            continue
        if ch == "\\" and in_str:
            esc = True
            continue
        if ch == '"':
            in_str = not in_str
            continue
        if in_str:
            continue
        if ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and start is not None:
                return text[start:i + 1]
    return None


def _try_parse(text: str) -> dict | None:
    if not text or not text.strip():
        return None
    cleaned = re.sub(r"```json\s*", "", text, flags=re.IGNORECASE)
    cleaned = re.sub(r"```\s*", "", cleaned).strip()
    data = None
    try:
        data = json.loads(cleaned)
    except Exception:
        extracted = _extract_json_object(cleaned)
        if extracted:
            try:
                data = json.loads(extracted)
            except Exception:
                data = None
    if not isinstance(data, dict):
        return None
    data.setdefault("nao_responder", False)
    if data.get("nao_responder") is True:
        data["mensagens_cliente"] = []
    else:
        bubbles = data.get("mensagens_cliente")
        if isinstance(bubbles, list):
            bubbles = [str(m).strip() for m in bubbles if isinstance(m, str) and str(m).strip()]
        else:
            bubbles = []
        data["mensagens_cliente"] = bubbles or ["Pode repetir, por favor? 🙂"]
    return data


def _fallback() -> dict:
    return {"_is_fallback": True, "nao_responder": False,
            "mensagens_cliente": ["Pode me dar mais um detalhe, por favor? 🙂"]}


def _attach(reply: dict, cards: list[str], trace: list[dict]) -> dict:
    """Anexa ao reply (campos `_`, consumidos pelo pipeline e removidos antes da memória):
    - `_cards`: recibos de transação, enviados ANTES das bolhas do agente.
    - `_tool_trace`: ferramentas executadas, gravadas na memória p/ reconstruir o fluxo
      (assim o histórico não ensina o modelo a responder sem chamar ferramentas).

    Se houve registro, garante que não fique mudo: força nao_responder=False.
    """
    if cards:
        reply["_cards"] = cards
        if reply.get("nao_responder"):
            reply["nao_responder"] = False
            reply["mensagens_cliente"] = reply.get("mensagens_cliente") or []
    if trace:
        reply["_tool_trace"] = trace
    return reply


# ── Recibo determinístico de transação (enviado pelo pipeline) ─────────────────
def _fmt_eur(value) -> str:
    """Compatibilidade: formata explicitamente em euros."""
    return format_money(value, "EUR")


def _fmt_date(iso) -> str:
    """'AAAA-MM-DD' (ou ISO) -> 'DD/MM/AAAA'. Devolve '' se não der p/ parsear."""
    if not iso:
        return ""
    dt = parse_dt(iso)
    if dt is not None:
        return dt.strftime("%d/%m/%Y")
    try:
        return datetime.strptime(str(iso)[:10], "%Y-%m-%d").strftime("%d/%m/%Y")
    except Exception:
        return ""


def format_transaction_card(reg: dict) -> str:
    """Monta o recibo ('mensagem meio pronta') de uma transação registrada.

    Uma info por linha; o comentário do agente vem numa bolha à parte, embaixo.
    """
    tipo = str(reg.get("tipo") or "").lower()
    is_income = tipo.startswith("rec")
    header = "✅ Receita registrada" if is_income else "✅ Gasto registrado"
    money_emoji = "💰" if is_income else "💸"

    lines = [header, f"{money_emoji} {format_money(reg.get('valor'), reg.get('moeda') or 'EUR')}"]
    titulo = (reg.get("titulo") or "").strip()
    if titulo:
        lines.append(f"📌 {titulo}")
    categoria = (reg.get("categoria") or "").strip()
    if categoria:
        lines.append(f"🏷️ {categoria}")
    local = (reg.get("local") or "").strip()
    if local:
        lines.append(f"📍 {local}")
    data = _fmt_date(reg.get("data") or reg.get("data_hora"))
    if data:
        lines.append(f"📅 {data}")
    return "\n".join(lines)
