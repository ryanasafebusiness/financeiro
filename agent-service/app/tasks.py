"""Pipeline de processamento (tasks Celery).

process_inbound  -> normaliza, dedup, gating, mídia, empurra p/ o lote e agenda
finalize_batch   -> vence o debounce, roda o agente e envia as respostas
"""
import logging
import re
import time
from datetime import datetime, timezone

from app.celery_app import celery
from app.config import settings
from app.datetime_utils import parse_dt
from app.models import WebhookPayload
from app.services import (
    redis_svc, supabase_svc, uazapi_svc, media_svc, guardrails_svc, ai_agent_svc,
    settings_svc,
)
from app.services.supabase_svc import only_digits

log = logging.getLogger(__name__)

_MAX_BUBBLE_CHARS = 350


# ════════════════════════════════════════════════════════════════════════
#  Ingestão compartilhada (Celery local/tradicional + Vercel Queues)
# ════════════════════════════════════════════════════════════════════════
def process_inbound_payload(raw: dict) -> dict | None:
    """Processa um webhook e devolve o finalize que deve ser agendado.

    Separar processamento de agendamento permite usar o mesmo pipeline no
    Celery e nos consumidores privados do Vercel Queues.
    """
    try:
        payload = WebhookPayload(body=raw)
    except Exception as e:
        log.warning("Payload inválido: %s", e)
        return

    msg = payload.body.message
    token = payload.body.token
    base_url = payload.body.BaseUrl

    # Ecos das próprias mensagens enviadas pela API → ignora (senão o bot se bloqueia)
    if msg.wasSentByApi or msg.fromMe:
        return

    # Valida o token da instância (quando ambos estão definidos).
    # Lê o token vigente (painel admin > .env) p/ casar com o gerenciado.
    expected_token = settings_svc.get_uazapi_token()
    if expected_token and token and token != expected_token:
        log.warning("Token do webhook não confere — drop")
        return

    sender = only_digits(msg.sender if "@s.whatsapp.net" in (msg.sender or "") else (msg.sender_pn or msg.sender))
    if not sender:
        log.warning("Sem remetente — drop")
        return

    content_type = _detect_content_type(msg)

    # Idempotência: em caso de retry após processar mas antes de agendar o
    # finalize, devolve novamente o agendamento pendente. A fila o deduplica.
    if msg.id and not redis_svc.dedupe_seen(f"dedupe:{msg.id}", settings.dedupe_ttl_seconds):
        if redis_svc.get_debounce_marker(sender) == msg.id:
            return {"sender": sender, "msg_id": msg.id, "delay_seconds": settings.debounce_seconds}
        return

    # Confirma leitura (não-fatal)
    uazapi_svc.mark_read(msg.id, base_url=base_url, token=token)

    # Resolve/cria o perfil (aplica trial)
    profile = supabase_svc.resolve_or_create_profile(sender, msg.senderName or "")
    if not profile:
        return

    # Log da mensagem recebida
    supabase_svc.save_message(profile["id"], sender, _incoming_text_for_log(msg), False, False)

    # Agente pausado p/ este usuário
    if not profile.get("ai_online", True):
        return

    # Gating do funil — classifica o estado (trial/cota/expirado/...) e, se travar,
    # manda a mensagem certa com cooldown por-estado e NÃO processa a mensagem.
    gate = _gating_state(profile)
    if gate:
        _state, message, cooldown_key = gate
        if redis_svc.cooldown_passed(f"{cooldown_key}:{sender}", settings.gating_notice_cooldown):
            uazapi_svc.send_text(sender, message, base_url=base_url, token=token)
        return

    # Mídia → texto
    text = _extract_text(msg.content)
    if content_type == "audio":
        text = media_svc.transcribe_audio(msg.id, base_url=base_url, token=token)
    elif content_type == "image":
        desc = media_svc.describe_image(msg.id, base_url=base_url, token=token)
        text = (text + "\n" + desc).strip() if text else desc
    elif content_type in ("video", "file", "unknown"):
        uazapi_svc.send_text(
            sender,
            "Por enquanto não consigo abrir vídeos ou documentos 😅 Me conta por texto, áudio ou foto?",
            base_url=base_url, token=token,
        )
        return

    if not (text or "").strip():
        return

    # Empurra p/ o lote e devolve o debounce a agendar (só o último vence).
    redis_svc.push_message(sender, {"id": msg.id, "message": text, "content_type": content_type})
    redis_svc.set_debounce_marker(sender, msg.id)
    return {"sender": sender, "msg_id": msg.id, "delay_seconds": settings.debounce_seconds}


@celery.task(name="app.tasks.process_inbound", bind=True, max_retries=2, default_retry_delay=5)
def process_inbound(self, raw: dict) -> None:
    pending = process_inbound_payload(raw)
    if pending:
        finalize_batch.apply_async(
            args=[pending["sender"], pending["msg_id"]],
            countdown=pending["delay_seconds"],
        )


# ════════════════════════════════════════════════════════════════════════
#  Finalização compartilhada (vence o debounce e responde)
# ════════════════════════════════════════════════════════════════════════
def finalize_batch_payload(sender: str, msg_id: str) -> None:
    # Só prossegue se ainda for o "dono" do lote (nenhuma mensagem mais nova chegou)
    if redis_svc.get_debounce_marker(sender) != msg_id:
        return

    msgs = redis_svc.drain_batch(sender)
    redis_svc.clear_debounce_marker(sender)
    combined = "\n".join(m.get("message", "") for m in msgs if m.get("message"))
    if not combined.strip():
        return

    profile = supabase_svc.get_profile_by_phone(sender)
    if not profile:
        return

    # Guardrails (jailbreak/abuso)
    if guardrails_svc.check_jailbreak(combined):
        uazapi_svc.send_text(sender, "Não consigo te ajudar com isso. Mas tô aqui pras suas finanças! 🙂")
        return

    session_id = f"{sender}_memory"
    reply = ai_agent_svc.run(session_id, combined, profile)
    is_fallback = bool(reply.pop("_is_fallback", False))
    # Recibos determinísticos de transação (enviados antes do comentário do agente,
    # NÃO persistidos na memória — por isso saem do reply antes do append_memory).
    cards = reply.pop("_cards", []) or []
    # Ferramentas executadas neste turno → vão p/ a memória (reconstrói o fluxo de tools).
    tool_trace = reply.pop("_tool_trace", []) or []

    if reply.get("nao_responder"):
        # Silêncio NÃO é persistido: gravar "{nao_responder:true}" como turno do
        # assistente ensina o modelo a repetir o silêncio nas próximas mensagens.
        return

    sent_any = False

    def _emit(text: str, *, sanitize: bool) -> None:
        nonlocal sent_any
        parts = _split_long(_sanitize_for_whatsapp(text) if sanitize else text)
        for part in parts:
            part = part.strip()
            if not part:
                continue
            if settings.presence_typing:
                delay = _bubble_delay(part)
                uazapi_svc.send_presence(sender, "composing", delay_ms=delay)
                time.sleep(min(delay / 1000, 2.0))
            if uazapi_svc.send_text(sender, part):
                supabase_svc.save_message(profile["id"], sender, part, True, True)
                sent_any = True

    # 1) recibos (formato fixo, sem sanitize); 2) comentário do agente.
    for card in cards:
        _emit(card, sanitize=False)
    for bubble in reply.get("mensagens_cliente") or []:
        _emit(bubble, sanitize=True)

    if not is_fallback:
        import json
        supabase_svc.append_memory(session_id, combined, json.dumps(reply, ensure_ascii=False),
                                   tool_calls=tool_trace)

    if sent_any:
        supabase_svc.increment_messages(profile["id"], profile.get("messages_this_month") or 0)
        _maybe_send_nudge(profile, sender)


@celery.task(name="app.tasks.finalize_batch")
def finalize_batch(sender: str, msg_id: str) -> None:
    finalize_batch_payload(sender, msg_id)


# ════════════════════════════════════════════════════════════════════════
#  Helpers
# ════════════════════════════════════════════════════════════════════════
def _gating_message() -> str:
    """Mensagem de boas-vindas + checkout p/ quem nunca teve plano."""
    return (
        "Oi! Eu sou o ZapWallet 💚\n"
        "Vi aqui que você ainda não tem um plano ativo. Sem problema!\n"
        f"É só ativar por aqui e me mandar uma mensagem: {settings_svc.get_subscribe_url()}"
    )


def _gating_state(profile: dict):
    """Classifica o estado do funil. Retorna (state, mensagem, cooldown_key) p/
    TRAVAR, ou None p/ liberar o processamento.

    Estados: pago ativo (libera) · trial esgotado por cota · trial expirado por
    dias · pago esgotado por cota · pago expirado · nunca teve plano. Chaves de
    cooldown distintas p/ não silenciar a transição entre dois estados.
    """
    url = settings_svc.get_subscribe_url()
    is_trial = profile.get("plan") == "Trial"

    if supabase_svc.is_premium_active(profile):
        # Dentro da validade (ou admin) — só falta checar a cota de mensagens.
        limit = int(profile.get("message_limit") or 0)
        used = int(profile.get("messages_this_month") or 0)
        if limit and used >= limit:
            if is_trial:
                return ("trial_quota",
                        f"Você usou suas {limit} mensagens grátis do ZapWallet 💚\n"
                        f"Curtiu? Pra continuar organizando seus gastos é só assinar: {url}",
                        "trial_quota")
            return ("paid_quota",
                    "Você atingiu o limite de mensagens do seu plano este mês 🙏\n"
                    f"Pra liberar mais é só renovar ou fazer upgrade: {url}",
                    "msglimit")
        return None  # libera o processamento

    # Fora da validade (premium_until no passado)
    if is_trial:
        return ("trial_expired",
                "Seu teste grátis do ZapWallet chegou ao fim ⏳\n"
                f"Pra continuar comigo, escolhe um plano aqui: {url}",
                "trial_expired")
    if profile.get("plan"):
        return ("paid_expired",
                "Seu plano do ZapWallet expirou 😕\n"
                f"Reativa em 1 minutinho aqui: {url}",
                "gating")
    return ("no_plan", _gating_message(), "gating")


def _days_until(iso) -> int | None:
    """Dias inteiros até `iso` (negativo se já passou). None se inválido/ausente."""
    dt = parse_dt(iso)
    if dt is None:
        return None
    return (dt - datetime.now(timezone.utc)).days


def _maybe_send_nudge(profile: dict, sender: str) -> None:
    """Empurra UMA bolha de urgência quando a cota/dias do trial estão acabando.

    Determinístico (não passa pelo agente). Roda após responder, então calcula
    o contador já incrementado. Cooldown próprio p/ não repetir a cada lote.
    """
    new_count = int(profile.get("messages_this_month") or 0) + 1
    limit = int(profile.get("message_limit") or 0)
    url = settings_svc.get_subscribe_url()

    # 1) Cota acabando (trial ou plano pago com limite)
    if limit:
        remaining = limit - new_count
        if 0 < remaining <= settings_svc.get_nudge_threshold_msgs():
            if redis_svc.cooldown_passed(f"nudge:{sender}", settings.gating_notice_cooldown):
                uazapi_svc.send_text(
                    sender,
                    f"Psiu! Te restam só {remaining} mensagens grátis 😉\n"
                    f"Quando quiser seguir sem limite: {url}",
                )
            return

    # 2) Último(s) dia(s) do trial
    if profile.get("plan") == "Trial":
        days_left = _days_until(profile.get("premium_until"))
        if days_left is not None and 0 <= days_left <= settings_svc.get_nudge_threshold_days():
            if redis_svc.cooldown_passed(f"nudge:{sender}", settings.gating_notice_cooldown):
                uazapi_svc.send_text(
                    sender,
                    "Seu teste grátis termina logo ⏳\n"
                    f"Garante seu acesso sem corre: {url}",
                )


def _detect_content_type(msg) -> str:
    mime = msg.content.get("mimetype", "") if isinstance(msg.content, dict) else ""
    if msg.type == "text":
        return "text"
    if mime.startswith("audio") or msg.type in ("ptt", "audio") or msg.mediaType == "ptt":
        return "audio"
    if mime.startswith("image") or msg.type == "image":
        return "image"
    if mime.startswith("video") or msg.type == "video":
        return "video"
    if mime.startswith("application") or msg.type == "document":
        return "file"
    return "unknown"


def _extract_text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, dict):
        return content.get("text") or content.get("caption") or ""
    return ""


def _incoming_text_for_log(msg) -> str:
    t = _extract_text(msg.content)
    if t:
        return t
    return f"[{_detect_content_type(msg)}]"


def _sanitize_for_whatsapp(text: str) -> str:
    t = text
    t = re.sub(r"\*\*(.+?)\*\*", r"\1", t)
    t = re.sub(r"\*([^*\n]+)\*", r"\1", t)
    t = re.sub(r"_([^_\n]+)_", r"\1", t)
    t = re.sub(r"^#{1,6}\s+", "", t, flags=re.MULTILINE)
    t = re.sub(r"^[•\-\*]\s+", "", t, flags=re.MULTILINE)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


def _bubble_delay(text: str) -> int:
    return int(min(2.0, max(0.6, len(text) / 240)) * 1000)


def _split_long(text: str) -> list[str]:
    if len(text) <= _MAX_BUBBLE_CHARS:
        return [text]
    sentences = re.split(r"(?<=[.!?])\s+", text)
    chunks, current = [], ""
    for s in sentences:
        cand = (current + " " + s).strip() if current else s
        if current and len(cand) > _MAX_BUBBLE_CHARS:
            chunks.append(current.strip())
            current = s
        else:
            current = cand
    if current.strip():
        chunks.append(current.strip())
    return chunks or [text]


# ════════════════════════════════════════════════════════════════════════
#  Recorrências — materializa as vencidas (roda via Celery beat, diário)
# ════════════════════════════════════════════════════════════════════════
@celery.task(name="app.tasks.materializar_recorrencias")
def materializar_recorrencias() -> int:
    from app.services import finance_svc
    n = finance_svc.materialize_due()
    if n:
        log.info("[recorrencias] %s transação(ões) materializada(s)", n)
    return n


# ════════════════════════════════════════════════════════════════════════
#  Reset mensal do contador de mensagens (roda via Celery beat, dia 1)
# ════════════════════════════════════════════════════════════════════════
@celery.task(name="app.tasks.reset_monthly_counters")
def reset_monthly_counters() -> int:
    """Zera messages_this_month dos planos pagos (pula trials). Beat 1x/mês."""
    n = supabase_svc.reset_monthly_counters()
    if n:
        log.info("[reset-mensal] %s contador(es) de mensagens zerado(s)", n)
    return n
