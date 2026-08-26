"""Cliente da Stripe — Checkout Sessions e verificação de webhook.

Segue o mesmo padrão do openai_client: a chave vem do settings_svc (painel admin
> .env) e o client é recriado só quando a chave muda, para que trocar a chave no
painel tenha efeito sem redeploy. NUNCA instancie `stripe.StripeClient` direto.

Tudo síncrono (o pipeline roda em tasks Celery prefork).
"""
import logging

import stripe

from app.services import settings_svc

log = logging.getLogger(__name__)

# Fixa a versão da API: assim um upgrade da conta na Stripe não muda o formato
# dos objetos que este código lê sem que ninguém perceba. É a MESMA versão
# fixada no endpoint de webhook (we_...), para que o que enviamos e o que
# recebemos falem a mesma língua. Ao trocar, revise `_period_id`/`_price_id` e
# `_subscription_metadata` em webhooks/stripe_webhook.py.
API_VERSION = "2026-05-27.dahlia"

_client: stripe.StripeClient | None = None
_client_key: str | None = None


def get() -> stripe.StripeClient:
    """Client com a chave vigente. Recria só quando a chave muda."""
    global _client, _client_key
    key = settings_svc.get_stripe_secret_key()
    if not key:
        raise RuntimeError(
            "Stripe não configurada: defina a Secret Key em Admin → Integrações "
            "(ou STRIPE_SECRET_KEY no .env)."
        )
    if _client is None or key != _client_key:
        _client = stripe.StripeClient(key, stripe_version=API_VERSION)
        _client_key = key
    return _client


def reset_cache() -> None:
    """Descarta o client (usado pelos testes e após troca de chave no painel)."""
    global _client, _client_key
    _client, _client_key = None, None


#: modos aceitos. "subscription" renova sozinho (cartão/SEPA); "payment" é a
#: compra avulsa, único caminho que MB WAY e Multibanco conseguem pagar — ambos
#: têm "Recurring payments: No" na Stripe.
MODES = ("subscription", "payment")


def create_checkout_session(
    *,
    price_id: str,
    profile_id: str,
    plan_id: str,
    success_url: str,
    cancel_url: str,
    mode: str = "subscription",
    customer_email: str | None = None,
    phone: str | None = None,
) -> dict:
    """Abre uma Checkout Session e devolve {id, url}.

    O vínculo com o usuário é feito em três lugares de propósito:
      • client_reference_id  -> chega em checkout.session.completed;
      • metadata             -> idem, redundância barata;
      • subscription_data.metadata -> é o ÚNICO que sobrevive nas RENOVAÇÕES
        (invoice.paid meses depois não conhece a sessão original).

    Em `mode="payment"` não há assinatura: o acesso é concedido por
    `plans.duration_days` quando o pagamento confirma.
    """
    if mode not in MODES:
        raise ValueError(f"mode inválido: {mode!r} (use um de {MODES})")

    link = {"profile_id": profile_id, "plan_id": plan_id}
    if phone:
        # Rede de segurança: se o profile_id sumir, o webhook ainda casa o
        # pagamento pelo telefone do WhatsApp.
        link["phone"] = phone

    params: dict = {
        "mode": mode,
        "line_items": [{"price": price_id, "quantity": 1}],
        "success_url": success_url,
        "cancel_url": cancel_url,
        "client_reference_id": profile_id,
        "metadata": dict(link),
        # O tenant do ZapWallet é o telefone do WhatsApp; a Stripe não coleta
        # telefone por padrão, então pedimos explicitamente.
        "phone_number_collection": {"enabled": True},
        "allow_promotion_codes": True,
    }
    if mode == "subscription":
        params["subscription_data"] = {"metadata": dict(link)}
    else:
        params["payment_intent_data"] = {"metadata": dict(link)}

    if customer_email:
        params["customer_email"] = customer_email

    # namespace v1 (o acesso direto .checkout está deprecado no SDK 13+)
    session = get().v1.checkout.sessions.create(params=params)
    return {"id": session.id, "url": session.url}


def construct_event(payload: bytes, signature_header: str) -> stripe.Event:
    """Valida a assinatura do webhook e devolve o Event.

    Levanta stripe.SignatureVerificationError se a assinatura não bater ou se o
    timestamp estiver fora da tolerância (proteção contra replay). Exige o corpo
    CRU da requisição — qualquer reserialização quebra a verificação.
    """
    secret = settings_svc.get_stripe_webhook_secret()
    if not secret:
        raise RuntimeError(
            "Webhook da Stripe sem signing secret: defina em Admin → Integrações "
            "(ou STRIPE_WEBHOOK_SECRET no .env)."
        )
    return stripe.Webhook.construct_event(payload, signature_header, secret)
