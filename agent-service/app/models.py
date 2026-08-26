from typing import Any

from pydantic import BaseModel


class WebhookMessage(BaseModel):
    """Mensagem recebida via webhook da uazapi (campos tolerantes a ausência)."""
    id: str = ""
    chatid: str = ""
    content: Any = ""
    messageTimestamp: int = 0
    fromMe: bool = False
    sender: str = ""
    sender_pn: str = ""
    senderName: str = ""
    type: str = "text"        # text | audio | image | video | document | ptt
    mediaType: str = ""
    wasSentByApi: bool = False


class WebhookBody(BaseModel):
    BaseUrl: str = ""
    token: str = ""
    message: WebhookMessage


class WebhookPayload(BaseModel):
    body: WebhookBody


class NormalizedMessage(BaseModel):
    """Mensagem normalizada que trafega pelo pipeline (e serializa p/ o Celery)."""
    id: str
    chatid: str
    sender: str             # JID canônico — chave do Redis e campo chat no BD
    sender_name: str = ""
    message: str = ""       # texto (já transcrito/descrito p/ mídia)
    message_timestamp: int = 0
    content_type: str = "text"   # text | audio | image | video | file | unknown
    from_me: bool = False
    token: str = ""
    base_url: str = ""
