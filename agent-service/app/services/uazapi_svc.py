"""Chamadas HTTP à uazapi (síncronas).

Instância única: usa UAZAPI_BASE_URL / UAZAPI_TOKEN por padrão, mas aceita
base_url/token vindos do webhook quando presentes (caso multi-instância futura).
"""
import base64
import logging

import httpx

from app.services import settings_svc

log = logging.getLogger(__name__)

_client = httpx.Client(timeout=30)


def _base(base_url: str | None) -> str:
    # Override do webhook tem prioridade; senão o valor vigente (painel admin > .env).
    return (base_url or settings_svc.get_uazapi_base_url() or "").rstrip("/")


def _token(token: str | None) -> str:
    return token or settings_svc.get_uazapi_token()


def mark_read(msg_id: str, *, base_url: str = "", token: str = "") -> None:
    if not msg_id:
        return
    try:
        _client.post(
            f"{_base(base_url)}/message/markread",
            headers={"token": _token(token)},
            json={"id": [msg_id]},
        )
    except Exception as e:
        log.warning("mark_read falhou: %s", e)


def send_presence(number: str, presence: str = "composing", delay_ms: int | None = None,
                  *, base_url: str = "", token: str = "") -> None:
    """Indicador de "digitando..." (cosmético; falhas são não-fatais)."""
    payload: dict = {"number": number, "presence": presence}
    if delay_ms is not None:
        payload["delay"] = delay_ms
    try:
        _client.post(
            f"{_base(base_url)}/message/presence",
            headers={"token": _token(token)},
            json=payload,
        )
    except Exception as e:
        log.warning("send_presence falhou: %s", e)


def send_text(number: str, text: str, delay_ms: int | None = None,
              *, base_url: str = "", token: str = "") -> bool:
    payload: dict = {"number": number, "text": text}
    if delay_ms is not None:
        payload["delay"] = delay_ms
    try:
        r = _client.post(
            f"{_base(base_url)}/send/text",
            headers={"token": _token(token)},
            json=payload,
        )
        r.raise_for_status()
        return True
    except Exception as e:
        log.error("send_text falhou: %s", e)
        return False


def send_media(number: str, file: str, media_type: str = "document", *, doc_name: str | None = None,
               text: str | None = None, mimetype: str | None = None, delay_ms: int | None = None,
               base_url: str = "", token: str = "") -> bool:
    """Envia mídia via /send/media. `file` aceita URL ou base64 (data URI)."""
    payload: dict = {"number": number, "type": media_type, "file": file}
    if doc_name:
        payload["docName"] = doc_name
    if text:
        payload["text"] = text
    if mimetype:
        payload["mimetype"] = mimetype
    if delay_ms is not None:
        payload["delay"] = delay_ms
    try:
        r = _client.post(
            f"{_base(base_url)}/send/media",
            headers={"token": _token(token)},
            json=payload,
        )
        r.raise_for_status()
        return True
    except Exception as e:
        log.error("send_media falhou: %s", e)
        return False


def pdf_data_uri(pdf_bytes: bytes) -> str:
    """bytes de PDF -> data URI base64 aceito pela uazapi no campo `file`."""
    return "data:application/pdf;base64," + base64.b64encode(pdf_bytes).decode("ascii")


def download_media(msg_id: str, *, base_url: str = "", token: str = "") -> bytes:
    """Baixa uma mídia e retorna os bytes brutos."""
    r = _client.post(
        f"{_base(base_url)}/message/download",
        headers={"token": _token(token)},
        json={"id": msg_id, "return_base64": True},
    )
    r.raise_for_status()
    data = r.json()
    b64 = data.get("base64Data") or data.get("base64") or ""
    if "," in b64:
        b64 = b64.split(",", 1)[1]
    return base64.b64decode(b64)
