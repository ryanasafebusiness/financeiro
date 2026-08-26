"""Testes do parser de saída do agente (_try_parse / _extract_json_object / _fallback)."""
import pytest

from app.services import ai_agent_svc as A


def test_parse_valid():
    d = A._try_parse('{"nao_responder": false, "mensagens_cliente": ["oi"]}')
    assert d["mensagens_cliente"] == ["oi"] and d["nao_responder"] is False


def test_parse_code_fence():
    d = A._try_parse('```json\n{"mensagens_cliente": ["a"]}\n```')
    assert d["mensagens_cliente"] == ["a"]


def test_parse_prose_around_json():
    d = A._try_parse('Claro!\n{"mensagens_cliente": ["b"]}\nespero ter ajudado')
    assert d["mensagens_cliente"] == ["b"]


@pytest.mark.parametrize("text", ["", "   ", "sem json aqui", "{quebrado", "[1,2,3]"])
def test_parse_invalid_returns_none(text):
    assert A._try_parse(text) is None


def test_parse_nao_responder_forces_empty_bubbles():
    d = A._try_parse('{"nao_responder": true, "mensagens_cliente": ["nao deveria"]}')
    assert d["nao_responder"] is True and d["mensagens_cliente"] == []


def test_parse_bubbles_not_list_gets_default():
    d = A._try_parse('{"mensagens_cliente": "string solta"}')
    assert d["mensagens_cliente"] == ["Pode repetir, por favor? 🙂"]


def test_parse_empty_bubbles_gets_default():
    d = A._try_parse('{"mensagens_cliente": ["", "   "]}')
    assert d["mensagens_cliente"] == ["Pode repetir, por favor? 🙂"]


def test_parse_defaults_nao_responder_false():
    d = A._try_parse('{"mensagens_cliente": ["x"]}')
    assert d["nao_responder"] is False


def test_parse_strips_bubbles():
    d = A._try_parse('{"mensagens_cliente": ["  oi  ", "tudo bem"]}')
    assert d["mensagens_cliente"] == ["oi", "tudo bem"]


def test_extract_nested_braces():
    assert A._extract_json_object('{"a": {"b": 1}}') == '{"a": {"b": 1}}'


def test_extract_braces_inside_strings():
    assert A._extract_json_object('{"a": "tem } chave"}') == '{"a": "tem } chave"}'


def test_extract_none():
    assert A._extract_json_object("nada aqui") is None


def test_fallback_shape():
    fb = A._fallback()
    assert fb["_is_fallback"] is True
    assert fb["nao_responder"] is False
    assert len(fb["mensagens_cliente"]) >= 1
