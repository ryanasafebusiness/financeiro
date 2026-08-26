"""Normalização de telefone BR: 55 + nono dígito (WhatsApp x login do painel)."""
import pytest

from app.services import supabase_svc as S
from tests.conftest import USER_ID


@pytest.mark.parametrize("raw,expected", [
    ("85999920343", "5585999920343"),
    ("558599920343", "558599920343"),
    ("5585999920343", "5585999920343"),
    ("(85) 99992-0343", "5585999920343"),
    ("+55 85 99992-0343", "5585999920343"),
    ("1199998888", "551199998888"),
    ("", ""),
])
def test_canonical_phone(raw, expected):
    assert S.canonical_phone(raw) == expected


@pytest.mark.parametrize("raw,must_contain", [
    ("85999920343", {"558599920343", "5585999920343"}),   # digitado com 9
    ("558599920343", {"558599920343", "5585999920343"}),  # WhatsApp sem 9
    ("5511988887777", {"5511988887777", "551188887777"}),
])
def test_phone_variants_cover_ninth_digit(raw, must_contain):
    assert must_contain.issubset(set(S.phone_variants(raw)))


# A peça central: WhatsApp grava sem o 9; login do painel digita com o 9 -> mesmo perfil.
@pytest.mark.parametrize("login_phone", [
    "5585999999999",   # exatamente como semeado
    "85999999999",     # sem o 55
    "558599999999",    # sem o nono dígito
    "(85) 99999-9999",
])
def test_get_profile_matches_across_formats(db, login_phone):
    p = S.get_profile_by_phone(login_phone)
    assert p is not None and p["id"] == USER_ID
