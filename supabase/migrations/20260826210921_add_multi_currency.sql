-- Moeda preferida do usuário e moeda original de cada lançamento.
-- Valores antigos eram tratados como euros pelo app, portanto o backfill é EUR.
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
