"""Cliente OpenAI com a chave resolvida em runtime (painel admin > .env).

A API key e os modelos podem ser geridos pelo painel admin (tabela `app_secrets`
via `settings_svc`). O client é (re)criado quando a chave muda, com cache por
processo — então uma troca no painel propaga em até ~30s (TTL do settings_svc),
sem redeploy. Sem override no banco, cai no `.env` (settings).

Use SEMPRE `openai_client.get()` em vez de instanciar `openai.OpenAI` direto, para
que a troca de chave pelo painel tenha efeito.
"""
import openai

from app.services import settings_svc

_cache: dict = {"key": None, "client": None}


def get() -> "openai.OpenAI":
    """Client OpenAI com a chave vigente (recriado só quando a chave muda)."""
    key = settings_svc.get_openai_api_key()
    if _cache["client"] is None or _cache["key"] != key:
        _cache["client"] = openai.OpenAI(api_key=key)
        _cache["key"] = key
    return _cache["client"]
