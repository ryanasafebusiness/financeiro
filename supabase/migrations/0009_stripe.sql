-- ════════════════════════════════════════════════════════════════════════
--  Gobbi — migração da Cakto para a Stripe (assinaturas recorrentes)
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
-- Preço avulso (compra única). Existe porque MB WAY e Multibanco — os dois meios
-- mais usados em Portugal — NÃO fazem cobrança recorrente: só conseguem pagar
-- uma Checkout Session em mode=payment.
alter table public.plans add column if not exists stripe_price_id_onetime text;

drop index if exists public.plans_offer_idx;
create index if not exists plans_price_idx on public.plans (stripe_price_id);

comment on column public.plans.stripe_price_id is
  'ID do Price recorrente na Stripe (price_...). É o que liga o plano ao checkout.';
comment on column public.plans.stripe_price_id_onetime is
  'Price avulso (one_time) do mesmo plano, para MB WAY/Multibanco. Opcional.';

-- Os offer IDs de exemplo da Cakto não valem nada na Stripe: limpa para o admin
-- perceber que precisa colar o price_... (o painel acusa "plano sem price").
update public.plans
   set stripe_price_id = null
 where stripe_price_id is not null
   and stripe_price_id not like 'price_%';

-- Liga os planos aos Prices criados na conta Stripe (produto Gobbi Premium,
-- prod_V94SSYg29c5q01) e alinha preço e cota com a realidade portuguesa.
--
-- Os valores antigos (19,90 / 49,90 / 149,90) eram números em REAIS herdados da
-- fase brasileira — em euro ficavam ~6x acima do mercado local, onde a Boonzi,
-- referência de finanças pessoais em PT, cobra ~2 €/mês e 39,90 € vitalício.
--
-- Preços COM IVA INCLUÍDO (23% em Portugal continental): na UE, venda B2C tem de
-- anunciar o valor final. Os Prices na Stripe estão com tax_behavior=inclusive.
--
-- message_limit deixa de ser 0 (ilimitado): a 4,99 € sobram ~3,73 € depois de IVA
-- e taxas, e cada mensagem custa OpenAI — sem teto, o usuário intenso dá prejuízo.
update public.plans p
   set stripe_price_id         = v.price_id,
       stripe_price_id_onetime = coalesce(nullif(p.stripe_price_id_onetime, ''), v.price_onetime),
       price                   = v.price_eur,
       message_limit           = v.msg_limit
  from (values
    -- nome         recorrente                        avulso                            €      msgs/mês
    ('Mensal',     'price_1U8mpvH7t2oko0FsdszXhlde', 'price_1U8mqIH7t2oko0Fsajhda7co',  4.99,  300),
    ('Trimestral', 'price_1U8mq0H7t2oko0FsWFV1xbEU', 'price_1U8mqOH7t2oko0FsxDA7EyP4', 12.99,  400),
    ('Anual',      'price_1U8mqCH7t2oko0FsZc3Lr3di', 'price_1U8mqTH7t2oko0Fs9ESh22yA', 39.99,  500)
  ) as v(plan_name, price_id, price_onetime, price_eur, msg_limit)
 where lower(p.name) = lower(v.plan_name);

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
