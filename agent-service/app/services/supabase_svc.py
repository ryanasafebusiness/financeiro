"""Acesso ao Supabase/Postgres (síncrono).

Usa a service-role key, então toda operação bypassa RLS. Operações de auth
(criar usuário, gerar magic link p/ o login OTP) batem direto no GoTrue admin
via httpx — mais previsível entre versões do supabase-py.
"""
import json
import logging
import re
from datetime import datetime, timedelta, timezone

import httpx
from supabase import Client, create_client

from app.config import settings
from app.datetime_utils import parse_dt

log = logging.getLogger(__name__)

_client: Client | None = None
_http = httpx.Client(timeout=15)


def get_db() -> Client:
    global _client
    if _client is None:
        _client = create_client(settings.supabase_url, settings.supabase_service_key)
    return _client


def only_digits(s: str) -> str:
    return re.sub(r"\D", "", s or "")


def canonical_phone(raw: str) -> str:
    """Normaliza p/ 55DDDNÚMERO (formato do remetente do WhatsApp).

    Garante que o mesmo número resolva para UM perfil, venha do WhatsApp
    (já com 55) ou do login do painel (usuário às vezes digita sem o 55).
    """
    d = only_digits(raw)
    if not d:
        return ""
    if d.startswith("55") and len(d) >= 12:   # já tem código do país
        return d
    if len(d) in (10, 11):                     # DDD + número, sem 55
        return "55" + d
    return d


def phone_variants(raw: str) -> list[str]:
    """Variações equivalentes de um número BR (com/sem o nono dígito).

    O WhatsApp às vezes entrega o número sem o 9 (55+DDD+8díg), enquanto o
    usuário digita com o 9 (55+DDD+9díg). Devolve ambas p/ casar o mesmo perfil.
    """
    d = canonical_phone(raw)
    out = {d}
    if d.startswith("55") and len(d) >= 12:
        ddd, num = d[2:4], d[4:]
        if len(num) == 9 and num.startswith("9"):
            out.add("55" + ddd + num[1:])      # remove o 9 -> 12 díg
        elif len(num) == 8:
            out.add("55" + ddd + "9" + num)     # adiciona o 9 -> 13 díg
    return list(out)


def synthetic_email(phone: str) -> str:
    return f"wa{canonical_phone(phone)}@{settings.email_domain}"


# ── Auth admin (GoTrue) ───────────────────────────────────────────────────────
def _gotrue(path: str, method: str = "POST", json: dict | None = None) -> httpx.Response:
    url = f"{settings.supabase_url}/auth/v1/{path.lstrip('/')}"
    headers = {
        "apikey": settings.supabase_service_key,
        "Authorization": f"Bearer {settings.supabase_service_key}",
        "Content-Type": "application/json",
    }
    return _http.request(method, url, headers=headers, json=json)


def create_auth_user(phone: str, name: str = "") -> dict | None:
    """Cria o usuário no auth.users (o trigger handle_new_user cria o profile)."""
    digits = canonical_phone(phone)
    body = {
        "email": synthetic_email(digits),
        "phone": f"+{digits}",
        "email_confirm": True,
        "phone_confirm": True,
        "user_metadata": {"full_name": name, "phone": digits},
    }
    r = _gotrue("admin/users", "POST", body)
    if r.status_code in (200, 201):
        return r.json()
    # 422 = já existe; segue o fluxo lendo o profile
    log.warning("create_auth_user status=%s body=%s", r.status_code, r.text[:200])
    return None


def generate_magiclink_otp(phone: str) -> dict | None:
    """Gera um magic link (sem enviar e-mail) e devolve o OTP/token_hash do GoTrue.

    O frontend chama supabase.auth.verifyOtp({email, token, type:'email'}) com
    esses dados para estabelecer a sessão — entregamos o código por WhatsApp.
    """
    # Usa o e-mail do perfil existente (que pode ter sido criado pelo WhatsApp
    # com outra forma do número) em vez de recomputar — senão o magic link iria
    # p/ um usuário de auth diferente do dono das transações.
    prof = get_profile_by_phone(phone)
    email = (prof or {}).get("email") or synthetic_email(phone)
    r = _gotrue("admin/generate_link", "POST", {"type": "magiclink", "email": email})
    if r.status_code != 200:
        log.error("generate_link status=%s body=%s", r.status_code, r.text[:200])
        return None
    data = r.json()
    props = data.get("properties", data)
    return {
        "email": email,
        "email_otp": props.get("email_otp"),
        "hashed_token": props.get("hashed_token"),
    }


# ── Profiles ──────────────────────────────────────────────────────────────────
def get_profile_by_phone(phone: str) -> dict | None:
    # Casa por variações com/sem o nono dígito (WhatsApp x digitado no painel).
    res = get_db().table("profiles").select("*").in_("phone", phone_variants(phone)).limit(1).execute()
    return res.data[0] if res.data else None


def get_profile(user_id: str) -> dict | None:
    res = get_db().table("profiles").select("*").eq("id", user_id).limit(1).execute()
    return res.data[0] if res.data else None


def resolve_or_create_profile(phone: str, name: str = "") -> dict | None:
    """Acha o profile pelo telefone; se não existir, cria o usuário e aplica trial."""
    prof = get_profile_by_phone(phone)
    if prof:
        return prof

    create_auth_user(phone, name)
    prof = get_profile_by_phone(phone)
    if not prof:
        log.error("Profile não encontrado após criar usuário para %s", phone)
        return None

    # Aplica trial grátis (limitado por DIAS e por COTA de mensagens) e nome.
    # Import tardio do settings_svc p/ evitar ciclo no carregamento dos módulos.
    from app.services import settings_svc
    update: dict = {}
    trial_days = settings_svc.get_trial_days()
    if trial_days > 0:
        until = datetime.now(timezone.utc) + timedelta(days=trial_days)
        update["premium_until"] = until.isoformat()
        update["plan"] = "Trial"
        update["message_limit"] = settings_svc.get_trial_message_limit()
    if name and not prof.get("name"):
        update["name"] = name
    if update:
        get_db().table("profiles").update(update).eq("id", prof["id"]).execute()
        prof.update(update)
    return prof


def set_premium(user_id: str, plan: str | None, premium_until_iso: str | None,
                message_limit: int | None = None, reset_usage: bool = False) -> None:
    update: dict = {"plan": plan, "premium_until": premium_until_iso}
    if message_limit is not None:
        update["message_limit"] = message_limit
    if reset_usage:                       # zera o contador (ex.: trial -> pago, renovação)
        update["messages_this_month"] = 0
    get_db().table("profiles").update(update).eq("id", user_id).execute()


def increment_messages(user_id: str, current: int) -> None:
    get_db().table("profiles").update({"messages_this_month": int(current) + 1}).eq("id", user_id).execute()


def reset_monthly_counters() -> int:
    """Zera messages_this_month dos planos PAGOS no início do mês.

    Pula plan='Trial': a cota do trial é única (vitalícia em mensagens), expira
    por dias e não deve ser renovada mensalmente. Feito via query builder (e não
    rpc) p/ ser testável no FakeSupabase e não depender da função SQL em runtime.
    """
    res = get_db().table("profiles").update(
        {"messages_this_month": 0}
    ).neq("plan", "Trial").execute()
    return len(res.data or [])


def is_premium_active(profile: dict) -> bool:
    if profile.get("is_admin"):
        return True
    dt = parse_dt(profile.get("premium_until"))
    if dt is None:
        return False
    return dt > datetime.now(timezone.utc)


# ── Messages (log) ────────────────────────────────────────────────────────────
def save_message(user_id: str | None, chat: str, message: str,
                 is_outgoing: bool, ai_generated: bool) -> None:
    try:
        get_db().table("messages").insert({
            "user_id": user_id,
            "chat": chat,
            "message": message,
            "is_outgoing": is_outgoing,
            "ai_generated": ai_generated,
        }).execute()
    except Exception as e:
        log.warning("save_message falhou (não-fatal): %s", e)


# ── Memória do agente (chat_histories, formato LangChain) ──────────────────────
def has_history(session_id: str) -> bool:
    res = get_db().table("chat_histories").select("id").eq("session_id", session_id).limit(1).execute()
    return bool(res.data)


# Verbos (1ª pessoa, pretérito) que indicam uma AÇÃO concluída num turno legado
# (sem _replay) → infere a ferramenta que o agente DEVE ter usado, p/ o histórico
# não ensinar a responder sem ferramenta. Conservador: só formas afirmativas.
_LEGACY_TOOL_HINTS = [
    (("removi", "apaguei", "excluí", "exclui", "deletei"), "deletar_transacao"),
    (("atualizei", "editei", "corrigi", "alterei"), "editar_transacao"),
    (("registrei", "anotei", "adicionei", "guardei"), "registrar_transacao"),
]


def _infer_legacy_tool(content: str) -> str | None:
    low = (content or "").lower()
    for verbs, tool in _LEGACY_TOOL_HINTS:
        if any(v in low for v in verbs):
            return tool
    return None


def get_memory(session_id: str, limit: int) -> list[dict]:
    res = (
        get_db().table("chat_histories")
        .select("id, message")
        .eq("session_id", session_id)
        .order("id", desc=False)
        .execute()
    )
    rows = (res.data or [])[-limit:]
    out: list[dict] = []
    for row in rows:
        msg = row["message"]
        t = msg.get("type")
        content = msg.get("content", "")
        if t == "human":
            out.append({"role": "user", "content": content})
        elif t == "ai":
            # Se o turno executou ferramentas, reconstrói o fluxo (assistant tool_calls
            # -> tool results -> texto). Sem isso, o histórico mostraria só o texto final
            # e ENSINARIA o modelo a "responder direto" sem chamar a ferramenta (ele passa
            # a alucinar registros). Turnos antigos sem _replay caem no caminho simples.
            replay = msg.get("_replay") or []
            if not replay:
                # Turno legado (gravado antes do _replay): infere a ferramenta pelo texto
                # p/ não reensinar o modelo a responder ações sem chamar ferramenta.
                inferred = _infer_legacy_tool(content)
                if inferred:
                    replay = [{"id": f"legacy_{len(out)}", "name": inferred,
                               "args": {}, "result": '{"ok": true}'}]
            if replay:
                out.append({
                    "role": "assistant", "content": None,
                    "tool_calls": [
                        {"id": tc["id"], "type": "function",
                         "function": {"name": tc["name"],
                                      "arguments": json.dumps(tc.get("args") or {}, ensure_ascii=False)}}
                        for tc in replay
                    ],
                })
                for tc in replay:
                    res_val = tc.get("result")
                    if not isinstance(res_val, str):
                        res_val = json.dumps(res_val, ensure_ascii=False, default=str)
                    out.append({"role": "tool", "tool_call_id": tc["id"], "content": res_val[:800]})
            out.append({"role": "assistant", "content": content})
    return out


def append_memory(session_id: str, user_input: str, ai_output: str, tool_calls: list | None = None) -> None:
    ai_message = {"type": "ai", "content": ai_output, "tool_calls": [],
                  "additional_kwargs": {}, "response_metadata": {}, "invalid_tool_calls": []}
    # _replay: ferramentas executadas neste turno, p/ o get_memory reconstruir o fluxo
    # e o modelo continuar usando ferramentas (em vez de imitar respostas sem tool).
    if tool_calls:
        ai_message["_replay"] = tool_calls
    rows = [
        {"session_id": session_id, "message": {"type": "human", "content": user_input,
                                               "additional_kwargs": {}, "response_metadata": {}}},
        {"session_id": session_id, "message": ai_message},
    ]
    get_db().table("chat_histories").insert(rows).execute()


# ── Planos / pagamentos (Stripe) ───────────────────────────────────────────────
def get_plan_by_price(price_id: str) -> dict | None:
    """Plano ligado a um Price da Stripe (price_...)."""
    if not price_id:
        return None
    res = get_db().table("plans").select("*").eq("stripe_price_id", price_id).limit(1).execute()
    return res.data[0] if res.data else None


def get_plan_by_id(plan_id: str) -> dict | None:
    if not plan_id:
        return None
    res = get_db().table("plans").select("*").eq("id", plan_id).limit(1).execute()
    return res.data[0] if res.data else None


def list_plans(active_only: bool = False) -> list[dict]:
    q = get_db().table("plans").select("*")
    if active_only:
        q = q.eq("active", True)
    return q.order("price").execute().data or []


def create_plan(data: dict) -> dict:
    res = get_db().table("plans").insert(data).execute()
    return res.data[0]


def update_plan(plan_id: str, data: dict) -> dict:
    res = get_db().table("plans").update(data).eq("id", plan_id).execute()
    return res.data[0] if res.data else {}


def delete_plan(plan_id: str) -> None:
    get_db().table("plans").delete().eq("id", plan_id).execute()


def record_payment(payload: dict) -> None:
    """Insere o pagamento (dedup via unique (stripe_event_id, event))."""
    try:
        get_db().table("payments").insert(payload).execute()
    except Exception as e:
        log.info("record_payment ignorado (provável duplicado): %s", e)
