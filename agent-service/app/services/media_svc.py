"""Transcrição de áudio (Whisper) e descrição de imagem (GPT-4o vision) — síncrono."""
import base64
import io
import logging

from app.services import uazapi_svc, settings_svc, openai_client

log = logging.getLogger(__name__)


def transcribe_audio(msg_id: str, *, base_url: str = "", token: str = "") -> str:
    try:
        audio = uazapi_svc.download_media(msg_id, base_url=base_url, token=token)
        f = io.BytesIO(audio)
        f.name = "audio.ogg"
        result = openai_client.get().audio.transcriptions.create(
            model=settings_svc.get_openai_transcribe_model(), file=f)
        return result.text or ""
    except Exception as e:
        log.error("Transcrição de áudio falhou: %s", e)
        return "[áudio não reconhecido]"


def describe_image(msg_id: str, *, base_url: str = "", token: str = "") -> str:
    """Descreve a imagem com foco em recibos/comprovantes (valor, estabelecimento, data)."""
    try:
        img = uazapi_svc.download_media(msg_id, base_url=base_url, token=token)
        b64 = base64.b64encode(img).decode()
        resp = openai_client.get().chat.completions.create(
            model=settings_svc.get_openai_vision_model(),
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": (
                        "Esta imagem provavelmente é um comprovante, nota fiscal, cupom ou print "
                        "de transação financeira. Descreva objetivamente o que vê e, se houver, "
                        "extraia: valor total (R$), estabelecimento/descrição e data. "
                        "Se não for financeiro, descreva brevemente."
                    )},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
                ],
            }],
            max_tokens=400,
        )
        return resp.choices[0].message.content or ""
    except Exception as e:
        log.error("Descrição de imagem falhou: %s", e)
        return "[imagem não reconhecida]"
