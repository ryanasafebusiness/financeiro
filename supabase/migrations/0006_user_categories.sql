-- ════════════════════════════════════════════════════════════════════════
--  Gobbi — categorias por usuário, com descrição para a IA
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
