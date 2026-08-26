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
