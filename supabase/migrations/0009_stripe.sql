-- ════════════════════════════════════════════════════════════════════════
--  ZapWallet — migração da Cakto para a Stripe (assinaturas recorrentes)
--
--  O que muda no modelo:
--    • plans.cakto_offer_id      -> plans.stripe_price_id      (price_...)
--    • payments.cakto_transaction_id -> payments.stripe_event_id (evt_...)
--    • payments.offer_id         -> payments.price_id
--    • payments ganha subscription_id e customer_id (ciclo de vida da assinatura)
--
--  A dedup dos webhooks passa a ser por (stripe_event_id, event): a Stripe
--  reentrega eventos e o mesmo evento nunca deve liberar acesso duas vezes.
--
--  Idempotente: pode rodar em banco novo (0001..0008 aplicados) ou já migrado.
-- ════════════════════════════════════════════════════════════════════════

-- ── plans ────────────────────────────────────────────────────────────────────
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'plans' and column_name = 'cakto_offer_id'
  ) then
    alter table public.plans rename column cakto_offer_id to stripe_price_id;
  end if;
end $$;

alter table public.plans add column if not exists stripe_price_id text;

drop index if exists public.plans_offer_idx;
create index if not exists plans_price_idx on public.plans (stripe_price_id);

comment on column public.plans.stripe_price_id is
  'ID do Price recorrente na Stripe (price_...). É o que liga o plano ao checkout.';

-- Os offer IDs de exemplo da Cakto não valem nada na Stripe: limpa para o admin
-- perceber que precisa colar o price_... (o painel acusa "plano sem price").
update public.plans
   set stripe_price_id = null
 where stripe_price_id is not null
   and stripe_price_id not like 'price_%';

-- Liga os planos aos Prices já criados na conta Stripe (produto ZapWallet
-- Premium, prod_V94SSYg29c5q01). Casa por nome e só preenche quem está vazio —
-- se você já colou um price pelo painel admin, ele é preservado.
update public.plans p
   set stripe_price_id = v.price_id
  from (values
    ('Mensal',     'price_1U8mVpH7t2oko0FsppbppfiV'),   -- 19,90 € / mês
    ('Trimestral', 'price_1U8mY2H7t2oko0FspvMaX4nT'),   -- 49,90 € / 3 meses
    ('Anual',      'price_1U8mY7H7t2oko0Fs9WaOO19q')    -- 149,90 € / ano
  ) as v(plan_name, price_id)
 where lower(p.name) = lower(v.plan_name)
   and coalesce(p.stripe_price_id, '') = '';

-- ── payments ─────────────────────────────────────────────────────────────────
alter table public.payments drop constraint if exists payments_cakto_transaction_id_event_key;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'payments' and column_name = 'cakto_transaction_id'
  ) then
    alter table public.payments rename column cakto_transaction_id to stripe_event_id;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'payments' and column_name = 'offer_id'
  ) then
    alter table public.payments rename column offer_id to price_id;
  end if;
end $$;

alter table public.payments add column if not exists stripe_event_id  text;
alter table public.payments add column if not exists price_id         text;
alter table public.payments add column if not exists subscription_id  text;
alter table public.payments add column if not exists customer_id      text;

comment on column public.payments.stripe_event_id is
  'ID do Event da Stripe (evt_...). Com `event`, garante que uma reentrega não libere acesso de novo.';

-- Dedup por evento da Stripe (reentregas são normais e esperadas).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'payments_stripe_event_unique'
  ) then
    alter table public.payments
      add constraint payments_stripe_event_unique unique (stripe_event_id, event);
  end if;
end $$;

create index if not exists payments_subscription_idx
  on public.payments (subscription_id);

-- ── settings ─────────────────────────────────────────────────────────────────
-- A URL estática de checkout morre com a Cakto: cada compra passa a abrir uma
-- Checkout Session criada na hora pelo backend. Fica no lugar a URL pública do
-- app, usada para montar os retornos de sucesso/cancelamento.
delete from public.app_settings where key = 'checkout_url';

insert into public.app_settings (key, value) values
  ('app_base_url', '"https://zap-financeiro-template-ebon.vercel.app"'::jsonb)
on conflict (key) do nothing;

-- ── secrets ──────────────────────────────────────────────────────────────────
-- Chaves esperadas em app_secrets a partir daqui:
--   stripe_secret_key    (sk_live_... / sk_test_...)
--   stripe_webhook_secret(whsec_...)
delete from public.app_secrets where key = 'cakto_webhook_secret';
