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
