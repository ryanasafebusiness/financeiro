-- ════════════════════════════════════════════════════════════════════════
--  Gobbi — seed (categorias padrão, planos, settings)
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
