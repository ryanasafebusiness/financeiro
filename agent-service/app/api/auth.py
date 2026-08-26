"""Dependências de autenticação para a API do painel (JWT do Supabase)."""
import logging

import httpx
from fastapi import HTTPException, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from app.config import settings
from app.services import supabase_svc

log = logging.getLogger(__name__)
_bearer = HTTPBearer(auto_error=False)


async def require_user(request: Request) -> dict:
    """Verifica o JWT do Supabase e devolve o profile do usuário."""
    creds: HTTPAuthorizationCredentials | None = await _bearer(request)
    if not creds:
        raise HTTPException(status_code=401, detail="Token ausente")

    token = creds.credentials
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.get(
                f"{settings.supabase_url}/auth/v1/user",
                headers={"Authorization": f"Bearer {token}", "apikey": settings.supabase_anon_key},
            )
        if r.status_code != 200:
            raise HTTPException(status_code=401, detail="Token inválido ou expirado")
        user = r.json()
    except HTTPException:
        raise
    except Exception as e:
        log.error("Erro ao verificar JWT: %s", e)
        raise HTTPException(status_code=401, detail="Erro ao verificar token")

    profile = supabase_svc.get_profile(user.get("id"))
    if not profile:
        raise HTTPException(status_code=403, detail="Perfil não encontrado")
    return profile


async def require_admin(request: Request) -> dict:
    profile = await require_user(request)
    if not profile.get("is_admin"):
        raise HTTPException(status_code=403, detail="Acesso restrito a administradores")
    return profile
