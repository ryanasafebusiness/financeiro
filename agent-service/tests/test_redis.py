"""Testes do redis_svc (fakeredis): dedupe, fila de debounce, OTP, cooldown."""
from app.services import redis_svc as R


def test_dedupe_first_then_duplicate():
    assert R.dedupe_seen("dedupe:abc", 60) is True
    assert R.dedupe_seen("dedupe:abc", 60) is False


def test_push_and_drain():
    R.push_message("5585", {"id": "1", "message": "oi"})
    R.push_message("5585", {"id": "2", "message": "tudo bem"})
    drained = R.drain_batch("5585")
    assert [m["message"] for m in drained] == ["oi", "tudo bem"]
    assert R.drain_batch("5585") == []  # segunda drenagem vazia


def test_debounce_marker_roundtrip():
    R.set_debounce_marker("5585", "msg1")
    assert R.get_debounce_marker("5585") == "msg1"
    R.set_debounce_marker("5585", "msg2")
    assert R.get_debounce_marker("5585") == "msg2"
    R.clear_debounce_marker("5585")
    assert R.get_debounce_marker("5585") is None


def test_otp_roundtrip():
    R.set_otp("5585", "123456")
    assert R.get_otp("5585") == "123456"
    R.delete_otp("5585")
    assert R.get_otp("5585") is None


def test_otp_rate_limited():
    assert R.otp_rate_limited("5585") is False  # 1º pedido permitido
    assert R.otp_rate_limited("5585") is True   # 2º dentro da janela bloqueado


def test_cooldown_passed():
    assert R.cooldown_passed("gating:5585", 60) is True
    assert R.cooldown_passed("gating:5585", 60) is False
