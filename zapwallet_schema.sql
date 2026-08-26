-- ===== 0001_schema.sql =====
-- ════════════════════════════════════════════════════════════════════════
--  ZapWallet — schema base
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

-- ===== 0002_functions_triggers.sql =====
-- ════════════════════════════════════════════════════════════════════════
--  ZapWallet — funções e triggers
-- ════════════════════════════════════════════════════════════════════════

-- ── is_admin(): usado nas policies sem recursão (SECURITY DEFINER) ────────────
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- ── handle_new_user(): cria o profile ao inserir em auth.users ────────────────
-- Lê phone/name/email do raw_user_meta_data (definidos pelo agent-service ao
-- criar o usuário via admin API). Idempotente.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_phone text := nullif(regexp_replace(coalesce(meta->>'phone', new.phone, ''), '\D', '', 'g'), '');
begin
  insert into public.profiles (id, name, phone, email)
  values (
    new.id,
    coalesce(meta->>'full_name', meta->>'name', ''),
    v_phone,
    coalesce(new.email, meta->>'email')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── touch_updated_at(): mantém updated_at em sincronia ────────────────────────
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['profiles','transactions','goals','spending_limits'] loop
    execute format('drop trigger if exists touch_%1$s on public.%1$s;', t);
    execute format(
      'create trigger touch_%1$s before update on public.%1$s
         for each row execute function public.touch_updated_at();', t);
  end loop;
end $$;

-- ── monthly_summary(): agregados do mês para o painel/admin ───────────────────
-- Retorna gasto, receita e saldo do período (default: mês corrente do usuário).
create or replace function public.monthly_summary(
  p_user_id uuid,
  p_from date default date_trunc('month', current_date)::date,
  p_to   date default (date_trunc('month', current_date) + interval '1 month - 1 day')::date
)
returns table (total_expense numeric, total_income numeric, balance numeric)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(sum(amount) filter (where type = 'expense'), 0) as total_expense,
    coalesce(sum(amount) filter (where type = 'income'),  0) as total_income,
    coalesce(sum(amount) filter (where type = 'income'),  0)
      - coalesce(sum(amount) filter (where type = 'expense'), 0) as balance
  from public.transactions
  where user_id = p_user_id
    and occurred_on between p_from and p_to;
$$;

-- ── reset_monthly_counters(): zera contadores mensais (chamar via cron) ───────
create or replace function public.reset_monthly_counters()
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles set messages_this_month = 0 where messages_this_month <> 0;
$$;

-- ===== 0003_rls.sql =====
-- ════════════════════════════════════════════════════════════════════════
--  ZapWallet — Row Level Security
--  Regra geral: o usuário enxerga/edita apenas as próprias linhas; admins
--  enxergam tudo. INSERTs sensíveis (profiles, messages, payments, memória)
--  ficam a cargo da service-role key (que bypassa RLS).
-- ════════════════════════════════════════════════════════════════════════

alter table public.profiles        enable row level security;
alter table public.categories      enable row level security;
alter table public.transactions    enable row level security;
alter table public.goals           enable row level security;
alter table public.spending_limits enable row level security;
alter table public.messages        enable row level security;
alter table public.chat_histories  enable row level security;
alter table public.plans           enable row level security;
alter table public.payments        enable row level security;
alter table public.app_settings    enable row level security;

-- ── profiles ──────────────────────────────────────────────────────────────
create policy "profiles_select_own"  on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy "profiles_update_own"  on public.profiles for update using (id = auth.uid() or public.is_admin());
-- is_admin/premium_until/plan/message_limit só mudam via service-role (sem policy de update p/ esses por anon).

-- ── categories ────────────────────────────────────────────────────────────
create policy "categories_select" on public.categories for select
  using (user_id is null or user_id = auth.uid() or public.is_admin());
create policy "categories_insert" on public.categories for insert
  with check (user_id = auth.uid());
create policy "categories_update" on public.categories for update
  using (user_id = auth.uid());
create policy "categories_delete" on public.categories for delete
  using (user_id = auth.uid());

-- ── transactions ────────────────────────────────────────────────────────────
create policy "transactions_select" on public.transactions for select
  using (user_id = auth.uid() or public.is_admin());
create policy "transactions_insert" on public.transactions for insert
  with check (user_id = auth.uid());
create policy "transactions_update" on public.transactions for update
  using (user_id = auth.uid());
create policy "transactions_delete" on public.transactions for delete
  using (user_id = auth.uid());

-- ── goals ───────────────────────────────────────────────────────────────────
create policy "goals_select" on public.goals for select
  using (user_id = auth.uid() or public.is_admin());
create policy "goals_insert" on public.goals for insert with check (user_id = auth.uid());
create policy "goals_update" on public.goals for update using (user_id = auth.uid());
create policy "goals_delete" on public.goals for delete using (user_id = auth.uid());

-- ── spending_limits ──────────────────────────────────────────────────────────
create policy "limits_select" on public.spending_limits for select
  using (user_id = auth.uid() or public.is_admin());
create policy "limits_insert" on public.spending_limits for insert with check (user_id = auth.uid());
create policy "limits_update" on public.spending_limits for update using (user_id = auth.uid());
create policy "limits_delete" on public.spending_limits for delete using (user_id = auth.uid());

-- ── messages (somente leitura p/ o dono; escrita via service-role) ────────────
create policy "messages_select" on public.messages for select
  using (user_id = auth.uid() or public.is_admin());

-- ── chat_histories: nenhuma policy p/ anon/auth -> acesso só via service-role ──

-- ── plans: catálogo legível por usuários autenticados; escrita só admin ───────
create policy "plans_select" on public.plans for select using (true);
create policy "plans_admin_write" on public.plans for all
  using (public.is_admin()) with check (public.is_admin());

-- ── payments: dono vê os seus; admin vê todos; escrita via service-role ───────
create policy "payments_select" on public.payments for select
  using (user_id = auth.uid() or public.is_admin());

-- ── app_settings: leitura autenticada; escrita só admin ───────────────────────
create policy "settings_select" on public.app_settings for select using (true);
create policy "settings_admin_write" on public.app_settings for all
  using (public.is_admin()) with check (public.is_admin());

-- ===== 0004_seed.sql =====
-- ════════════════════════════════════════════════════════════════════════
--  ZapWallet — seed (categorias padrão, planos, settings)
-- ════════════════════════════════════════════════════════════════════════

-- ── categorias padrão globais (user_id = NULL) ────────────────────────────────
insert into public.categories (user_id, name, type, emoji) values
  (null, 'Alimentação',  'expense', '🍔'),
  (null, 'Transporte',   'expense', '🚗'),
  (null, 'Moradia',      'expense', '🏠'),
  (null, 'Lazer',        'expense', '🎉'),
  (null, 'Saúde',        'expense', '💊'),
  (null, 'Educação',     'expense', '📚'),
  (null, 'Compras',      'expense', '🛍️'),
  (null, 'Assinaturas',  'expense', '🔁'),
  (null, 'Mercado',      'expense', '🛒'),
  (null, 'Contas',       'expense', '🧾'),
  (null, 'Outros',       'expense', '📦'),
  (null, 'Salário',      'income',  '💰'),
  (null, 'Freelance',    'income',  '💻'),
  (null, 'Investimentos','income',  '📈'),
  (null, 'Presente',     'income',  '🎁')
on conflict do nothing;

-- ── planos (ajuste cakto_offer_id com o id da SUA oferta na Cakto) ────────────
insert into public.plans (name, price, duration_days, message_limit, cakto_offer_id, active) values
  ('Mensal',     19.90,  30,  0, 'TROQUE_PELO_OFFER_ID_MENSAL',  true),
  ('Trimestral', 49.90,  90,  0, 'TROQUE_PELO_OFFER_ID_TRIM',    true),
  ('Anual',     149.90, 365,  0, 'TROQUE_PELO_OFFER_ID_ANUAL',   true)
on conflict do nothing;

-- ── settings globais ──────────────────────────────────────────────────────────
insert into public.app_settings (key, value) values
  ('checkout_url', '"https://pay.cakto.com.br/sua-oferta"'::jsonb),
  ('trial_days',   '7'::jsonb),
  ('ai_online',    'true'::jsonb)
on conflict (key) do nothing;

-- ── COMO PROMOVER UM ADMIN ────────────────────────────────────────────────────
-- Depois que o usuário existir (logou ao menos 1x ou foi criado pelo bot):
--   update public.profiles set is_admin = true where email = 'voce@email.com';

-- ===== 0005_rich_transactions_recurring.sql =====
-- ════════════════════════════════════════════════════════════════════════
--  ZapWallet — transações ricas + transações recorrentes
-- ════════════════════════════════════════════════════════════════════════

-- ── transactions: campos ricos ───────────────────────────────────────────────
-- title       = título capitalizado (ex.: "Cinema com a Gata")
-- description = breve frase sobre a transação (já existia)
-- location    = local (opcional)
-- occurred_at = data E hora (timestamptz); occurred_on continua sendo a data
--               (usada nas agregações/filtros) e é derivada de occurred_at.
alter table public.transactions
  add column if not exists title       text,
  add column if not exists location    text,
  add column if not exists occurred_at  timestamptz,
  add column if not exists recurring_id uuid;

-- permite transações geradas por recorrência
alter table public.transactions drop constraint if exists transactions_source_check;
alter table public.transactions
  add constraint transactions_source_check check (source in ('whatsapp','panel','recurring'));

-- backfill de linhas antigas
update public.transactions
set
  occurred_at = coalesce(occurred_at, (occurred_on::timestamp at time zone 'America/Fortaleza')),
  title       = coalesce(nullif(title, ''), initcap(coalesce(nullif(category, ''), 'Transação')))
where occurred_at is null or title is null or title = '';

-- ── recurring_transactions ────────────────────────────────────────────────────
-- Ex.: salário entra todo dia 15 (income, monthly, day_of_month=15)
--      aluguel sai todo dia 10 (expense, monthly, day_of_month=10)
create table if not exists public.recurring_transactions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  type         text not null check (type in ('expense','income')),
  title        text not null,
  description  text,
  amount       numeric(12,2) not null check (amount >= 0),
  category     text,
  location     text,
  frequency    text not null default 'monthly' check (frequency in ('daily','weekly','monthly','yearly')),
  day_of_month integer check (day_of_month between 1 and 31),  -- p/ monthly/yearly
  day_of_week  integer check (day_of_week between 0 and 6),     -- p/ weekly (0=domingo)
  month_of_year integer check (month_of_year between 1 and 12), -- p/ yearly
  active       boolean not null default true,
  last_run     date,
  next_run     date,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists recurring_user_idx on public.recurring_transactions (user_id);
create index if not exists recurring_due_idx  on public.recurring_transactions (active, next_run);

-- vincula a transação materializada à sua recorrência (opcional)
alter table public.transactions
  add constraint transactions_recurring_fk
  foreign key (recurring_id) references public.recurring_transactions(id) on delete set null
  not valid;

-- updated_at automático
drop trigger if exists touch_recurring_transactions on public.recurring_transactions;
create trigger touch_recurring_transactions
  before update on public.recurring_transactions
  for each row execute function public.touch_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table public.recurring_transactions enable row level security;

create policy "recurring_select" on public.recurring_transactions for select
  using (user_id = auth.uid() or public.is_admin());
create policy "recurring_insert" on public.recurring_transactions for insert
  with check (user_id = auth.uid());
create policy "recurring_update" on public.recurring_transactions for update
  using (user_id = auth.uid());
create policy "recurring_delete" on public.recurring_transactions for delete
  using (user_id = auth.uid());

-- ===== 0006_user_categories.sql =====
-- ════════════════════════════════════════════════════════════════════════
--  ZapWallet — categorias por usuário, com descrição para a IA
--
--  Antes: 15 categorias globais fixas (user_id = NULL), sem descrição.
--  Agora: cada usuário ganha a sua própria CÓPIA das categorias na criação
--  do perfil e pode criar/editar/excluir todas (inclusive as padrão) e dar
--  uma descrição que orienta a IA a classificar as transações.
--
--  As linhas globais (user_id = NULL) continuam existindo apenas como TEMPLATE
--  copiado para novos usuários — o painel e o agente passam a usar somente as
--  categorias do próprio usuário.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1) colunas novas ──────────────────────────────────────────────────────────
alter table public.categories
  add column if not exists description text,
  add column if not exists updated_at  timestamptz not null default now();

-- updated_at automático (reusa touch_updated_at do 0002)
drop trigger if exists touch_categories on public.categories;
create trigger touch_categories
  before update on public.categories
  for each row execute function public.touch_updated_at();

-- ── 2) sem categorias duplicadas por usuário (e permite upsert idempotente) ─────
-- NULLs (templates globais) são tratados como distintos no índice, então não
-- restringe os globais — serve para o conjunto de cada usuário.
create unique index if not exists categories_user_name_uniq
  on public.categories (user_id, name);

-- ── 3) descrições nos templates globais (base copiada p/ cada usuário) ──────────
update public.categories c set description = v.descr
from (values
  ('Alimentação',  'Refeições fora de casa: delivery, iFood, restaurantes, lanchonetes, bares, cafés e padaria.'),
  ('Transporte',   'Locomoção: Uber, 99, táxi, ônibus, metrô, combustível, estacionamento e pedágio.'),
  ('Moradia',      'Casa: aluguel, condomínio, financiamento do imóvel, reformas e manutenção.'),
  ('Lazer',        'Diversão: cinema, shows, viagens, passeios, jogos, hobbies e saídas com amigos.'),
  ('Saúde',        'Cuidados com a saúde: farmácia, consultas, exames, plano de saúde, dentista e academia.'),
  ('Educação',     'Estudos: cursos, faculdade, escola, livros, mensalidades e materiais.'),
  ('Compras',      'Compras em geral: roupas, calçados, eletrônicos, presentes e itens pessoais.'),
  ('Assinaturas',  'Serviços recorrentes: Netflix, Spotify, apps, streamings e mensalidades digitais.'),
  ('Mercado',      'Supermercado e compras da casa: feira, hortifruti, produtos de limpeza e higiene.'),
  ('Contas',       'Contas da casa e serviços: luz, água, internet, telefone, gás e impostos.'),
  ('Outros',       'Gastos que não se encaixam nas demais categorias.'),
  ('Salário',      'Salário do trabalho ou pró-labore — pagamento recorrente do emprego.'),
  ('Freelance',    'Trabalhos avulsos, bicos, projetos e prestação de serviço autônomo.'),
  ('Investimentos','Rendimentos: juros, dividendos, resgates e lucros de aplicações.'),
  ('Presente',     'Dinheiro recebido de presente, doação ou ajuda de alguém.')
) as v(name, descr)
where c.user_id is null and c.name = v.name
  and (c.description is null or c.description = '');

-- ── 4) função que copia os templates globais para um usuário (idempotente) ──────
create or replace function public.seed_user_categories(p_user uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.categories (user_id, name, type, emoji, description)
  select p_user, name, type, emoji, description
  from public.categories
  where user_id is null
  on conflict (user_id, name) do nothing;
$$;

-- ── 5) handle_new_user: semeia as categorias ao criar o perfil ──────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_phone text := nullif(regexp_replace(coalesce(meta->>'phone', new.phone, ''), '\D', '', 'g'), '');
begin
  insert into public.profiles (id, name, phone, email)
  values (
    new.id,
    coalesce(meta->>'full_name', meta->>'name', ''),
    v_phone,
    coalesce(new.email, meta->>'email')
  )
  on conflict (id) do nothing;

  perform public.seed_user_categories(new.id);
  return new;
end;
$$;

-- ── 6) backfill: dá a cada usuário existente sua cópia das categorias padrão ─────
do $$
declare r record;
begin
  for r in select id from public.profiles loop
    perform public.seed_user_categories(r.id);
  end loop;
end $$;

-- ===== 0007_funnel_trial.sql =====
-- ════════════════════════════════════════════════════════════════════════
--  ZapWallet — funil de vendas: trial limitado (dias + cota) + nudges
--
--  Config do funil vive em app_settings (fonte ÚNICA lida pelo backend via
--  settings_svc). O admin edita pelo painel; o .env não controla mais nada
--  disso (exceto o segredo do webhook da Cakto). A cota do trial usa as colunas
--  já existentes em profiles (message_limit + messages_this_month).
-- ════════════════════════════════════════════════════════════════════════

-- ── Defaults do funil ─────────────────────────────────────────────────────────
-- trial_days passa a 3 (trial curto, por isso o update); demais chaves novas só
-- inserem se ainda não existirem (não pisam em ajuste feito pelo admin).
insert into public.app_settings (key, value) values
  ('trial_days', '3'::jsonb)
on conflict (key) do update set value = excluded.value, updated_at = now();

insert into public.app_settings (key, value) values
  ('trial_message_limit',  '15'::jsonb),  -- mensagens grátis no trial (0 = ilimitado)
  ('nudge_threshold_msgs', '3'::jsonb),   -- avisa quando restarem <= N mensagens
  ('nudge_threshold_days', '1'::jsonb)    -- avisa quando faltarem <= N dias
on conflict (key) do nothing;

-- ── reset_monthly_counters(): NÃO renova a cota do trial ──────────────────────
-- A cota do trial é única (expira por dias, não por mês). O reset mensal (Celery
-- beat, dia 1) zera só os planos PAGOS. Mantida por compatibilidade/ops — o app
-- executa o reset via service layer (supabase_svc.reset_monthly_counters).
create or replace function public.reset_monthly_counters()
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles set messages_this_month = 0
  where messages_this_month <> 0 and coalesce(plan, '') <> 'Trial';
$$;

-- ===== 0008_app_secrets.sql =====
-- ════════════════════════════════════════════════════════════════════════
--  ZapWallet — chaves de integração geridas pelo painel admin
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


-- ===== 0009_stripe.sql =====
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

-- Liga os planos aos Prices criados na conta Stripe (produto ZapWallet Premium,
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
   set stripe_price_id         = coalesce(nullif(p.stripe_price_id, ''), v.price_id),
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

-- ===== 20260826210921_add_multi_currency.sql =====
alter table public.profiles
  add column if not exists currency text not null default 'EUR';
alter table public.profiles drop constraint if exists profiles_currency_check;
alter table public.profiles
  add constraint profiles_currency_check check (currency in ('EUR', 'BRL'));

alter table public.transactions
  add column if not exists currency text not null default 'EUR';
alter table public.transactions drop constraint if exists transactions_currency_check;
alter table public.transactions
  add constraint transactions_currency_check check (currency in ('EUR', 'BRL'));

alter table public.recurring_transactions
  add column if not exists currency text not null default 'EUR';
alter table public.recurring_transactions drop constraint if exists recurring_transactions_currency_check;
alter table public.recurring_transactions
  add constraint recurring_transactions_currency_check check (currency in ('EUR', 'BRL'));

create index if not exists transactions_user_currency_date_idx
  on public.transactions (user_id, currency, occurred_on desc);
