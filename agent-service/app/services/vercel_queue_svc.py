"""Publicação em Vercel Queues a partir do serviço FastAPI.

O runtime da Vercel injeta um OIDC curto no header da requisição. Usamos esse
token na API REST oficial da fila e mantemos o ID do deployment para que cada
preview/produção consuma apenas as mensagens da própria versão.
"""
import json
import os
import re

import httpx
from fastapi import Request

from app.config import settings

INBOUND_TOPIC = "gobbi-inbound"
FINALIZE_TOPIC = "gobbi-finalize"
_TOPIC_RE = re.compile(r"^[A-Za-z0-9_-]+$")


class QueuePublishError(RuntimeError):
    pass


def _oidc_token(request: Request) -> str:
    token = request.headers.get("x-vercel-oidc-token") or os.getenv("VERCEL_OIDC_TOKEN", "")
    if not token:
        raise QueuePublishError("OIDC da Vercel ausente; habilite Secure Backend Access")
    return token


async def publish(
    request: Request,
    topic: str,
    payload: dict,
    *,
    delay_seconds: int = 0,
    idempotency_key: str = "",
) -> str:
    if not _TOPIC_RE.fullmatch(topic):
        raise QueuePublishError("Nome de tópico inválido")

    headers = {
        "Authorization": f"Bearer {_oidc_token(request)}",
        "Content-Type": "application/json",
        "Vqs-Retention-Seconds": "86400",
    }
    if delay_seconds:
        headers["Vqs-Delay-Seconds"] = str(max(0, min(int(delay_seconds), 86400)))
    if idempotency_key:
        headers["Vqs-Idempotency-Key"] = idempotency_key[:256]
    deployment_id = os.getenv("VERCEL_DEPLOYMENT_ID", "")
    if deployment_id:
        headers["Vqs-Deployment-Id"] = deployment_id

    url = f"https://{settings.vercel_queue_region}.vercel-queue.com/api/v3/topic/{topic}"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(url, headers=headers, content=json.dumps(payload))
    except httpx.HTTPError as exc:
        raise QueuePublishError(f"Falha de rede ao publicar na fila: {exc}") from exc
    if response.status_code not in (201, 202):
        raise QueuePublishError(f"Vercel Queues respondeu HTTP {response.status_code}")
    if response.status_code == 202:
        return "deferred"
    try:
        return str(response.json().get("messageId") or "accepted")
    except ValueError:
        return "accepted"
