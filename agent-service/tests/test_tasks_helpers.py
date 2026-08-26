"""Testes dos helpers puros de tasks.py (detecção de tipo, sanitização, split…)."""
import pytest

from app import tasks
from app.models import WebhookMessage


def _msg(**kw):
    return WebhookMessage(**kw)


@pytest.mark.parametrize("kw,expected", [
    (dict(type="text", content="oi"), "text"),
    (dict(type="ptt", content=""), "audio"),
    (dict(type="audio", content={"mimetype": "audio/ogg"}), "audio"),
    (dict(type="chat", content={"mimetype": "audio/mp4"}), "audio"),
    (dict(type="image", content={"mimetype": "image/jpeg"}), "image"),
    (dict(type="image", content=""), "image"),
    (dict(type="video", content={"mimetype": "video/mp4"}), "video"),
    (dict(type="document", content={"mimetype": "application/pdf"}), "file"),
    (dict(type="document", content=""), "file"),
    (dict(type="sticker", content={"mimetype": "x/y"}), "unknown"),
])
def test_detect_content_type(kw, expected):
    assert tasks._detect_content_type(_msg(**kw)) == expected


@pytest.mark.parametrize("content,expected", [
    ("texto puro", "texto puro"),
    ({"text": "do dict"}, "do dict"),
    ({"caption": "legenda"}, "legenda"),
    ({}, ""),
    (123, ""),
])
def test_extract_text(content, expected):
    assert tasks._extract_text(content) == expected


@pytest.mark.parametrize("raw,expected", [
    ("**negrito**", "negrito"),
    ("*itálico*", "itálico"),
    ("_sublinhado_", "sublinhado"),
    ("## Título", "Título"),
    ("- item de lista", "item de lista"),
    ("• bullet", "bullet"),
])
def test_sanitize_for_whatsapp(raw, expected):
    assert tasks._sanitize_for_whatsapp(raw) == expected


def test_sanitize_collapses_blank_lines():
    assert tasks._sanitize_for_whatsapp("a\n\n\n\nb") == "a\n\nb"


def test_split_long_short_is_single():
    assert tasks._split_long("curtinho") == ["curtinho"]


def test_split_long_breaks_into_chunks():
    txt = ("Frase número um. " * 40).strip()
    chunks = tasks._split_long(txt)
    assert len(chunks) > 1
    assert all(len(c) <= 360 for c in chunks)


@pytest.mark.parametrize("text", ["oi", "x" * 500])
def test_bubble_delay_range(text):
    d = tasks._bubble_delay(text)
    assert 600 <= d <= 2000


def test_gating_message_has_checkout(db):
    msg = tasks._gating_message()
    assert "ZapWallet" in msg and "pay.cakto.com.br" in msg


def test_incoming_text_for_log_text():
    assert tasks._incoming_text_for_log(_msg(type="text", content="oi")) == "oi"


def test_incoming_text_for_log_media_placeholder():
    assert tasks._incoming_text_for_log(_msg(type="ptt", content="")) == "[audio]"
