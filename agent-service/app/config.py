from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # ── Supabase ──────────────────────────────────────────────────────────
    supabase_url: str
    supabase_service_key: str          # service-role — bypassa RLS
    supabase_anon_key: str = ""        # anon/public — verificação de JWT

    # ── OpenAI ────────────────────────────────────────────────────────────
    # Pode ficar vazia no .env e ser configurada pelo painel admin (Integrações);
    # settings_svc lê de app_secrets com fallback p/ cá. Supabase/Redis, não — são
    # infra e precisam estar no .env (o backend lê app_secrets do Supabase).
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    openai_vision_model: str = "gpt-4o"
    openai_guardrails_model: str = "gpt-4o-mini"
    openai_transcribe_model: str = "whisper-1"

    # ── uazapi ────────────────────────────────────────────────────────────
    uazapi_base_url: str = ""
    uazapi_token: str = ""

    # ── Redis / Celery ──────────────────────────────────────────────────────
    redis_url: str = ""
    # A integração Upstash da Vercel fornece KV_URL. Mantemos REDIS_URL como
    # nome portátil e usamos KV_URL automaticamente quando ele não existir.
    kv_url: str = ""
    celery_broker_url: str = ""        # vazio -> usa redis_url
    celery_result_backend: str = ""    # vazio -> usa redis_url

    # ── Vercel (Queues + Cron) ────────────────────────────────────────────
    # Em produção na Vercel, o webhook publica em Queues. Celery continua
    # disponível para desenvolvimento local e deploys tradicionais.
    vercel_queue_enabled: bool = False
    vercel_queue_region: str = "iad1"
    queue_bridge_secret: str = ""
    cron_secret: str = ""

    # ── Stripe ─────────────────────────────────────────────────────────────
    stripe_secret_key: str = ""        # sk_live_... / sk_test_...
    stripe_webhook_secret: str = ""    # whsec_... (assinatura do webhook)
    # URL pública do painel — base dos retornos de sucesso/cancelamento do checkout.
    app_base_url: str = "http://localhost:8080"

    # ── Admin ────────────────────────────────────────────────────────────────
    admin_email: str = ""

    # ── Comportamento ──────────────────────────────────────────────────────
    debounce_seconds: float = 8.0
    dedupe_ttl_seconds: int = 86400
    max_context_messages: int = 50
    free_trial_days: int = 3            # fallback p/ trial_days; app_settings manda (settings_svc)
    presence_typing: bool = True
    gating_notice_cooldown: int = 3600
    email_domain: str = "zapwallet.app"
    app_tz: str = "America/Fortaleza"

    @property
    def effective_redis_url(self) -> str:
        return self.redis_url or self.kv_url or "redis://localhost:6379/0"

    @property
    def broker_url(self) -> str:
        return self.celery_broker_url or self.effective_redis_url

    @property
    def backend_url(self) -> str:
        return self.celery_result_backend or self.effective_redis_url


settings = Settings()
