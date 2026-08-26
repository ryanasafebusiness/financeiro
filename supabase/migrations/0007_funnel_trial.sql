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
