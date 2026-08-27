-- ════════════════════════════════════════════════════════════════════════
--  Gobbi — schema base
--  Cada usuário (1 número de WhatsApp = 1 perfil) é o tenant. Quase todas as
--  tabelas são escopadas por user_id. O agent-service usa a service-role key
--  (bypassa RLS); o painel usa a anon key + JWT do usuário (RLS aplicada).
-- ════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ── profiles ───────────────────────────────────────────────────────────────
-- Espelha auth.users (id = auth.users.id). Criado pelo trigger handle_new_user.
create table if not exists public.profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  name                text,
  phone               text unique,                 -- somente dígitos, ex: 5585999999999
  email               text,
  premium_until       timestamptz,                 -- plano ativo enquanto > now()
  plan                text,                         -- nome do plano vigente
  is_admin            boolean not null default false,
  ai_online           boolean not null default true,-- pausa o agente p/ este usuário
  messages_this_month integer not null default 0,
  message_limit       integer not null default 0,   -- 0 = ilimitado
  timezone            text not null default 'America/Fortaleza',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists profiles_phone_idx on public.profiles (phone);

-- ── categories ───────────────────────────────────────────────────────────────
-- user_id NULL = categoria padrão global (semeada). Senão, categoria do usuário.
create table if not exists public.categories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references public.profiles(id) on delete cascade,
  name       text not null,
  type       text not null default 'expense' check (type in ('expense','income','both')),
  emoji      text,
  created_at timestamptz not null default now()
);
create index if not exists categories_user_idx on public.categories (user_id);

-- ── transactions ─────────────────────────────────────────────────────────────
create table if not exists public.transactions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  type        text not null check (type in ('expense','income')),
  amount      numeric(12,2) not null check (amount >= 0),
  category    text,
  description text,
  occurred_on date not null default current_date,
  source      text not null default 'whatsapp' check (source in ('whatsapp','panel')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists transactions_user_date_idx on public.transactions (user_id, occurred_on desc);
create index if not exists transactions_user_type_idx on public.transactions (user_id, type);

-- ── goals (metas de economia) ────────────────────────────────────────────────
create table if not exists public.goals (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  name          text not null,
  target_amount numeric(12,2) not null check (target_amount > 0),
  saved_amount  numeric(12,2) not null default 0,
  deadline      date,
  status        text not null default 'active' check (status in ('active','completed','archived')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists goals_user_idx on public.goals (user_id);

-- ── spending_limits (limites de gasto) ───────────────────────────────────────
-- category = 'geral' representa o limite total do período.
create table if not exists public.spending_limits (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  category     text not null default 'geral',
  period       text not null default 'monthly' check (period in ('monthly','weekly')),
  limit_amount numeric(12,2) not null check (limit_amount > 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, category, period)
);
create index if not exists spending_limits_user_idx on public.spending_limits (user_id);

-- ── messages (log completo p/ painel e admin) ────────────────────────────────
create table if not exists public.messages (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references public.profiles(id) on delete cascade,
  chat         text not null,             -- jid/telefone do contato
  message      text not null,
  is_outgoing  boolean not null default false,
  ai_generated boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists messages_chat_idx on public.messages (chat, created_at desc);
create index if not exists messages_user_idx on public.messages (user_id, created_at desc);

-- ── chat_histories (memória do agente, compatível com formato LangChain) ──────
create table if not exists public.chat_histories (
  id         bigint generated always as identity primary key,
  session_id text not null,
  message    jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists chat_histories_session_idx on public.chat_histories (session_id, id);

-- ── plans (catálogo; mapeia ofertas da Cakto -> direitos) ─────────────────────
create table if not exists public.plans (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  price          numeric(12,2) not null default 0,
  duration_days  integer not null default 30,   -- quanto estende premium_until
  message_limit  integer not null default 0,    -- 0 = ilimitado
  cakto_offer_id text,                           -- = data.offer.id no webhook
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);
create index if not exists plans_offer_idx on public.plans (cakto_offer_id);

-- ── payments (auditoria dos webhooks da Cakto) ───────────────────────────────
create table if not exists public.payments (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid references public.profiles(id) on delete set null,
  cakto_transaction_id  text,                    -- data.id
  ref_id                text,                    -- data.refId
  event                 text not null,           -- purchase_approved, refund, ...
  plan                  text,
  offer_id              text,
  amount                numeric(12,2),
  status                text,
  payment_method        text,
  raw                   jsonb,
  created_at            timestamptz not null default now(),
  unique (cakto_transaction_id, event)
);
create index if not exists payments_user_idx on public.payments (user_id, created_at desc);

-- ── app_settings (config global controlada pelo admin) ───────────────────────
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
