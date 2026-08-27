-- ════════════════════════════════════════════════════════════════════════
--  Gobbi — chaves de integração geridas pelo painel admin
--
--  Diferente de app_settings (legível por qualquer usuário autenticado — RLS
--  "settings_select using(true)"), os SEGREDOS (OpenAI key, uazapi token, Cakto
--  secret) vivem aqui, numa tabela com RLS habilitado e SEM nenhuma policy de
--  acesso. Resultado: anon/authenticated não leem NADA via PostgREST; apenas a
--  service-role (o agent-service) lê/escreve (bypassa RLS). O painel admin
--  acessa só pelos endpoints /admin/api/settings/integrations, que mascaram os
--  segredos. Assim a chave nunca chega ao browser.
--
--  Chaves esperadas (key text primary key):
--    openai_api_key, openai_model, openai_vision_model,
--    openai_transcribe_model, openai_guardrails_model,
--    uazapi_base_url, uazapi_token, cakto_webhook_secret
--  Sem override aqui, o backend cai no .env (settings) — nada quebra ao migrar.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.app_secrets (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now()
);

alter table public.app_secrets enable row level security;

-- Sem policies de propósito: deny-all para anon/authenticated. Só a service-role
-- (que bypassa RLS) acessa. NÃO adicione policy de select aqui.
revoke all on public.app_secrets from anon, authenticated;
