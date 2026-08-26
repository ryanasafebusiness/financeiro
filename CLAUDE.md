# CLAUDE.md

Guia para o Claude Code trabalhar neste repositório.

## O que é
SaaS de finanças pessoais via WhatsApp ("ZapWallet"). Migração de um fluxo n8n para um serviço
Python (FastAPI + Celery) com uazapi, OpenAI, Supabase e Stripe. Três partes:

| Pasta | O que é |
|---|---|
| `agent-service/` | Backend Python — webhook do WhatsApp, agente de IA, API do painel, webhook da Stripe |
| `supabase/migrations/` | 0001–0009: schema, funções/triggers, RLS, seed, transações ricas, categorias, funil/trial, cofre de chaves (app_secrets), migração p/ Stripe |
| `web/` | Painel React (usuário + admin) — Vite + TS + Tailwind |

## Comandos

```bash
# Backend (dev sem Redis: REDIS_URL=fake => Celery eager)
cd agent-service && uvicorn app.main:app --reload --port 8000
# Produção: 4 processos separados (ver Procfile)
#   web:            uvicorn app.main:app --host 0.0.0.0 --port $PORT
#   worker-inbound: celery ... --queues=inbound --concurrency=8
#   worker-agent:   celery ... --queues=agent,celery --concurrency=4
#   beat:           celery ... beat   (recorrências + reset mensal)
# Stack completa local: docker compose up --build

# Rodar local + túnel público + webhook uazapi (comando de projeto):
#   /rodar-localmente   (runbook em .claude/commands/rodar-localmente.md)

# Frontend
cd web && npm install && npm run dev      # :8080
npm run build                              # tsc -b && vite build

# Sanidade do backend sem deps de rede:
python -m py_compile $(find app -name '*.py')

# Testes (sem rede: FakeSupabase + FakeOpenAI scriptado)
cd agent-service && pip install -r requirements-dev.txt && pytest
```

## Testes (`agent-service/tests/`)
275+ testes, sem rede. `tests/fakes.py` traz o `FakeSupabase` (query builder em
memória) e o `FakeOpenAI` (respostas roteirizadas: `assistant_tools`/`tool_call`/`final`/`raw`).
`conftest.py` define env dummy, troca `supabase_svc._client` pelo dublê, deixa o OpenAI
scriptável (`patch_openai`) e captura envios à uazapi (`sent`). Cobre finance_svc, as 8 tools,
parsing da saída, helpers de tasks, redis/debounce, webhook Stripe, o prompt, funil de vendas
(gating/nudges/settings_svc) e cenários do agente (`run`, `finalize_batch`, `process_inbound`)
em modo Celery eager.

## Arquitetura do backend (`agent-service/app`)
- **Tudo síncrono** (clientes sync de openai/httpx/redis/supabase) porque o pipeline roda em tasks
  Celery (prefork). A API FastAPI só recebe o webhook e **enfileira**.
- **Pipeline** (`tasks.py`):
  1. `process_inbound(raw)` — valida token, dedup (`dedupe:{id}`), ignora `fromMe`, resolve/cria
     profile (com trial), **gating de plano** (com cooldown), transcreve áudio / descreve imagem,
     empurra texto para `batch:{sender}`, regrava `debounce:{sender}` e agenda `finalize_batch`
     com `countdown=DEBOUNCE_SECONDS`.
  2. `finalize_batch(sender, msg_id)` — só processa se ainda for o "dono" do marcador (debounce),
     drena o lote, roda guardrails + agente, envia bolhas, persiste memória, incrementa contador.
- **Agente** (`services/ai_agent_svc.py`): loop de tool-calling OpenAI; system prompt = persona
  ZapWallet (default em `app/prompts.py::SYSTEM_PROMPT`, editável pelo painel admin) + contexto
  dinâmico (`build_context`) + contrato de saída JSON `OUTPUT_CONTRACT`
  `{nao_responder, mensagens_cliente}`. Despacha 8 tools de `app/tools/`.
- **Tools** (`app/tools/*.py`): cada uma expõe `DEFINITION` (schema OpenAI) e
  `execute(ctx, **args)` onde `ctx["user_id"]`. Usam `services/finance_svc.py` (CRUD + agregações).
- **Memória**: tabela `chat_histories` (formato LangChain `type: human|ai`), igual ao n8n.
- **Supabase** (`services/supabase_svc.py`): service-role (bypassa RLS). Criação de usuário e
  `generate_link` (login OTP) via GoTrue admin com httpx.
- **Stripe** (`webhooks/stripe_webhook.py`): assinaturas recorrentes. Verifica a assinatura do
  header `Stripe-Signature` (corpo CRU), mapeia `metadata.plan_id`/`price` → `plans`, e ATRIBUI
  `premium_until` a partir do fim do período da Stripe (nunca soma, então reentrega não estende
  duas vezes). Libera em `checkout.session.completed`/`invoice.paid`, revoga em
  `customer.subscription.deleted`, audita tudo em `payments` (unique `(stripe_event_id, event)`).
  O checkout é criado em `POST /api/checkout` (`services/stripe_svc.py`) — não existe URL estática.
- **Settings** (`services/settings_svc.py`): fonte única para app_base_url, trial_days,
  trial_message_limit, nudge thresholds (em `app_settings`) **e** as chaves de integração —
  OpenAI key/modelos, uazapi base/token, Stripe secret key + webhook secret (em `app_secrets`). Lê com TTL 30s e
  fallback para `.env`/defaults. Admin grava via PUT e invalida o cache; nenhum redeploy.
  `app_settings` é legível por autenticados (RLS `using(true)`) — por isso segredos vão em
  `app_secrets`, tabela com RLS sem policies (só service-role acessa; ver migration 0008).
- **OpenAI client** (`services/openai_client.py`): `get()` devolve o client com a chave vigente
  (settings_svc), recriando só quando a chave muda. Use SEMPRE `openai_client.get()` — nunca
  instanciar `openai.OpenAI` direto — p/ a troca de chave pelo painel ter efeito. uazapi
  (`_base`/`_token`) e Stripe (`stripe_svc.get()`, mesmo padrão do openai_client) também leem do settings_svc.
- **Recibo de transação**: ao registrar com sucesso, `ai_agent_svc.run` anexa um cartão
  determinístico em `reply["_cards"]` (formato fixo: valor/título/categoria/data). O pipeline
  envia o(s) recibo(s) ANTES do comentário do agente e NÃO os persiste na memória. O prompt
  instrui o agente a só comentar, sem repetir os dados.
- **Admin** (`admin/router.py`): protegido por `is_admin` (JWT); stats, usuários, conceder premium,
  toggle IA, pagamentos, CRUD de planos, configurações do funil, integrações/chaves de API
  (GET mascara segredos; PUT só grava não-vazios), saúde do setup Stripe, logs (buffer + SSE).

## Banco (multi-tenant por usuário)
Tenant = 1 usuário (1 telefone = 1 `profiles.id` = `auth.users.id`). Tabelas escopadas por
`user_id`. RLS: usuário vê/edita só as próprias linhas; `is_admin()` vê tudo. Escritas sensíveis
(profiles, messages, payments, chat_histories) são feitas pela service-role. Telefone armazenado
só com dígitos, no formato internacional sem "+" (ex.: `55DDDNÚMERO`, `351NÚMERO`).

## Frontend (`web/src`)
- Stack: React Router v6, TanStack Query, Tailwind, `sonner`. UI primitives **próprios** em
  `components/ui/` (sem Radix; `Select` é `<select>` nativo, `Dialog`/`Tabs` são custom).
- `integrations/supabase/client.ts` (anon key + RLS) para CRUD direto; `lib/api.ts` para falar com
  o FastAPI (OTP, `/api/me`, `/admin/*`) anexando o JWT.
- Login OTP em `pages/Login.tsx`; rotas protegidas por `ProtectedRoute`; admin por `AdminRoute`
  (checa `useProfile().is_admin`). Layout em `components/layout/AppLayout.tsx`.

## Convenções
- Texto de usuário em **pt-BR**, tom WhatsApp (curto, sem markdown).
- Não introduzir Radix/shadcn-cli; manter os primitives próprios.
- Backend novo = manter sync; não misturar asyncio nas tasks Celery.
- Ao adicionar uma tool: criar `app/tools/<nome>.py` (DEFINITION + execute) e registrar em
  `_MODULES` de `ai_agent_svc.py`.
- LLM = OpenAI (provider escolhido); ids/modelos em `config.py`.
