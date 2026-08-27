"""Login do painel via OTP no WhatsApp.

request -> gera código de 6 dígitos, guarda no Redis e envia pela uazapi.
verify  -> confere o código e devolve {email, token} p/ o frontend chamar
           supabase.auth.verifyOtp({email, token, type:'email'}) e logar.
"""
import logging
import secrets

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services import redis_svc, supabase_svc, uazapi_svc
from app.services.supabase_svc import only_digits, canonical_phone

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/otp")


class RequestBody(BaseModel):
    phone: str


class VerifyBody(BaseModel):
    phone: str
    code: str


@router.post("/request")
def request_otp(body: RequestBody):
    phone = canonical_phone(body.phone)
    if len(only_digits(body.phone)) < 10:
        raise HTTPException(status_code=400, detail="Telefone inválido")
    if redis_svc.otp_rate_limited(phone):
        raise HTTPException(status_code=429, detail="Aguarde um instante antes de pedir outro código")

    # Garante que o usuário existe (permite login mesmo antes de falar com o bot)
    profile = supabase_svc.resolve_or_create_profile(phone)
    if not profile:
        raise HTTPException(status_code=500, detail="Não foi possível preparar a conta")

    code = f"{secrets.randbelow(1_000_000):06d}"
    redis_svc.set_otp(phone, code, ttl=300)

    msg = (
        f"🔐 Seu código de acesso ao Gobbi é: {code}\n"
        "Ele expira em 5 minutos. Se não foi você, ignore esta mensagem."
    )
    # Envia para o número como o perfil/WhatsApp o conhece (garante entrega).
    target = profile.get("phone") or phone
    if not uazapi_svc.send_text(target, msg):
        raise HTTPException(status_code=502, detail="Falha ao enviar o código pelo WhatsApp")
    return {"ok": True}


@router.post("/verify")
def verify_otp(body: VerifyBody):
    phone = canonical_phone(body.phone)
    stored = redis_svc.get_otp(phone)
    if not stored or stored != only_digits(body.code):
        raise HTTPException(status_code=401, detail="Código inválido ou expirado")

    link = supabase_svc.generate_magiclink_otp(phone)
    if not link or not link.get("email_otp"):
        raise HTTPException(status_code=500, detail="Não foi possível concluir o login")

    redis_svc.delete_otp(phone)
    return {"email": link["email"], "token": link["email_otp"], "type": "email"}
