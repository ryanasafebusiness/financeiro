-- ════════════════════════════════════════════════════════════════════════
--  Gobbi — Row Level Security
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
