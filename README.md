# ZapWallet 💚

SaaS de **finanças pessoais via WhatsApp**. O usuário conversa com um agente no WhatsApp para
registrar gastos e receitas, definir metas e limites de gasto e pedir relatórios — tudo por
mensagem de texto, áudio ou foto de comprovante. Um painel web acompanha tudo, e um painel
admin controla planos, trial, checkout e o texto do agente sem precisar de redeploy.

---

## Stack

| Camada | Tecnologia |
|---|---|
| WhatsApp | uazapi (gateway oficial) |
| Backend | Python 3.12, FastAPI, Vercel Queues (produção), Celery (local), Redis |
| IA | OpenAI (`gpt-4o-mini` + Whisper + GPT-4o vision) |
| Banco / Auth | Supabase (Postgres + GoTrue) com RLS |
| Pagamento | Stripe Billing (assinaturas recorrentes em EUR) |
| Painel | React 18, Vite, TypeScript, Tailwind |

## Pré-requisitos

- Conta no [Supabase](https://supabase.com) (plano free funciona)
- Chave de API da [OpenAI](https://platform.openai.com)
- Instância no [uazapi](https://uazapi.com) com WhatsApp conectado
- Conta na [Stripe](https://stripe.com) com um produto e um **preço recorrente** em EUR
- Redis acessível em produção (Upstash, Railway Redis, etc.)

---

## Arquitetura

```
WhatsApp ──▶ uazapi ──▶ POST /webhook (FastAPI)
                              │  enfileira
                              ▼
                 Vercel Queues ou Celery — Redis
              ┌──────────────────────────────────┐
              │ fila inbound  → process_inbound  │  dedup, gating de plano,
              │   ↓ (debounce countdown)          │  transcreve áudio / lê imagem,
              │ fila agent    → finalize_batch    │  roda o agente (tool-calling),
              └──────────────────────────────────┘  responde em bolhas via uazapi
              │ Vercel Cron / Celery Beat         │  recorrências diárias, reset mensal
              └──────────────────────────────────┘
                              │
              Supabase (profiles, transactions, goals, limits, memória…)
                              ▲
        painel web (React) ───┘   |   Stripe ─▶ POST /webhooks/stripe (libera premium)
```

- **Debounce durável**: cada mensagem regrava um marcador no Redis e agenda `finalize_batch`
  via Vercel Queues em produção ou Celery localmente;
  com `countdown`; só o último agendamento "vence" — agrupa mensagens enviadas em sequência.
- O agente devolve `{nao_responder, mensagens_cliente}`; cada bolha vira uma mensagem no WhatsApp
  com indicador de "digitando…".

## Layout do repositório

```
agent-service/            # backend Python
  app/
    main.py               # FastAPI: /webhook, /health, /api/*, /admin/*, /webhooks/*
    celery_app.py         # Celery (eager em dev, Redis em prod; 3 filas: inbound/agent/celery)
    tasks.py              # pipeline: process_inbound + finalize_batch + beat tasks
    config.py             # settings (pydantic-settings + .env)
    services/             # redis, uazapi, supabase, media, guardrails, finance, ai_agent, settings
    tools/                # 8 tools do agente (transação, editar, deletar, consultar, meta, limite, recorrência, relatório)
    api/                  # OTP por WhatsApp, /api/me, /api/plans
    webhooks/stripe_webhook.py  # libera/renova/revoga premium
    admin/                # API do painel ops (usuarios, planos, configurações, prompt, logs SSE)
  Procfile                # web / worker-inbound / worker-agent / beat
  Dockerfile
supabase/migrations/      # 0001–0007: schema, funções, RLS, seed, ricas, categorias, funil
zapwallet_schema.sql      # dump completo (concat das migrations — referência rápida)
web/                      # painel React (usuário + admin)
docker-compose.yml        # redis + api + worker-inbound + worker-agent + beat
queue-service/            # consumidores privados do Vercel Queues (Node/Next)
vercel.json               # Services, rotas, filas e Cron Jobs
```

---

## Setup passo a passo

### 1. Supabase

1. Crie um projeto em [app.supabase.com](https://app.supabase.com).
2. Abra o **SQL Editor** e execute os arquivos de `supabase/migrations/` em ordem (`0001` → `0008`).
   Ou use o CLI:
   ```bash
   supabase link --project-ref <ref>
   supabase db push
   ```
   > `zapwallet_schema.sql` na raiz é um atalho — contém todas as migrations concatenadas.
   > Funciona para criar tudo do zero no SQL Editor em uma passagem só.
3. Em **Settings → API**, copie: `URL`, `anon key`, `service_role key`.
4. O login usa e-mail sintético (`wa<telefone>@<EMAIL_DOMAIN>`) entregue por WhatsApp — nenhum
   SMTP ou SMS é necessário.

---

### 2. Backend (agent-service)

```bash
cd agent-service
cp .env.example .env      # preencha as chaves (veja comentários no arquivo)
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Dev local (sem Redis — Celery roda em modo eager, inline):
uvicorn app.main:app --reload --port 8000
```

Variáveis obrigatórias no `.env`:

| Variável | Onde pegar |
|---|---|
| `SUPABASE_URL` | Supabase → Settings → API |
| `SUPABASE_SERVICE_KEY` | Supabase → Settings → API → service_role |
| `SUPABASE_ANON_KEY` | Supabase → Settings → API → anon/public |
| `OPENAI_API_KEY` | platform.openai.com |
| `UAZAPI_BASE_URL` | painel uazapi → sua instância |
| `UAZAPI_TOKEN` | painel uazapi → sua instância → token |
| `STRIPE_SECRET_KEY` | Stripe → Desenvolvedores → Chaves de API |
| `STRIPE_WEBHOOK_SECRET` | Stripe → Desenvolvedores → Webhooks → seu endpoint → Signing secret |
| `APP_BASE_URL` | URL pública do painel (base do retorno do checkout) |
| `QUEUE_BRIDGE_SECRET` | segredo aleatório compartilhado pelos Services |
| `CRON_SECRET` | segredo aleatório usado automaticamente pelo Vercel Cron |

> 💡 As chaves do **OpenAI**, **uazapi** e **Stripe** (e os modelos) também podem ser geridas
> pelo painel admin em **Integrações** — sem mexer no `.env` nem fazer redeploy. O `.env` serve
> como valor inicial/fallback; o que estiver salvo no painel tem prioridade. `SUPABASE_*` e
> `REDIS_URL` continuam só no `.env` (são infraestrutura).

---

### 3. uazapi — registrar webhook

Aponte o webhook da sua instância para `https://SEU_BACKEND/webhook` e marque **todos os eventos**.

> Em dev local use um Cloudflare Tunnel (`cloudflared tunnel --url http://localhost:8000`) para
> expor o backend. O comando de projeto `/rodar-localmente` (Claude Code) automatiza esse passo.

---

### 4. Stripe — assinaturas

1. Crie um **produto** e um **preço recorrente em EUR** (Stripe → Catálogo de produtos).
   Guarde o `price_...` de cada plano.
2. Em **Desenvolvedores → Webhooks → Adicionar endpoint**:
   - URL: `https://SEU_BACKEND/webhooks/stripe`
   - Eventos: `checkout.session.completed`, `invoice.paid`, `customer.subscription.deleted`
     (opcionalmente `invoice.payment_failed` e `customer.subscription.updated`, que são só auditados)
   - Copie o **Signing secret** (`whsec_...`) para `STRIPE_WEBHOOK_SECRET`.
3. O painel admin mostra a URL exata e o que ainda falta — veja **Primeiros passos no admin**.

> Os `price_...` de cada plano são colados no painel admin (não no SQL). Faça isso após subir
> o serviço pela primeira vez.

**Como o acesso é liberado:** o painel chama `POST /api/checkout`, que abre uma Checkout Session
com o `profile_id` gravado em `client_reference_id` e em `subscription_data.metadata` — este
último é o que sobrevive às renovações. O premium só é concedido pelo webhook, nunca pelo retorno
do navegador. `premium_until` recebe o fim do período informado pela Stripe (atribuição, não soma),
então uma reentrega do mesmo evento não estende o acesso duas vezes.

---

### 5. Frontend (web)

```bash
cd web
cp .env.example .env      # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_API_URL
npm install
npm run dev               # http://localhost:8080
```

Em produção, `npm run build` gera estático — hospede em Vercel / Netlify / Cloudflare Pages.

---

### 6. Primeiros passos no painel admin

**Tornar-se admin** (uma vez, via SQL no Supabase):
```sql
update public.profiles set is_admin = true where phone = '55DDDSEUNÚMERO';
```

Depois, no painel web (`/admin`):

1. **Integrações** → cole a chave da OpenAI, a URL+token da uazapi e as duas chaves da Stripe
   (secret key e signing secret do webhook). Os segredos ficam num cofre no servidor (tabela
   `app_secrets`, só o backend acessa) e nunca são exibidos por completo. Entram em vigor em
   ~30s, sem redeploy.
2. **Configurações** → confirme a URL pública do painel, ajuste os dias/mensagens do trial e
   os thresholds de nudge. O card de saúde mostra o que ainda falta configurar.
3. **Planos** → crie os planos (nome, preço, duração, **Price ID da Stripe**). O `price_...` fica
   em Stripe → Catálogo de produtos → seu produto → Preço.
4. **Prompt da IA** → edite a persona/instruções do agente sem redeploy.

---

## Login do painel (OTP via WhatsApp)

1. Usuário digita o telefone → `POST /api/otp/request` gera um código de 6 dígitos, guarda no
   Redis e envia pelo WhatsApp.
2. Usuário digita o código → `POST /api/otp/verify` confere e abre a sessão via GoTrue.
   O usuário nunca vê tokens do Supabase.

---

## Funcionalidades do agente

- Registrar **gastos** e **receitas** (texto, áudio ou foto de comprovante). Cada registro envia
  um **recibo automático** (valor, título, categoria, data) seguido de um comentário curto do agente.
- **Editar / excluir** lançamentos por linguagem natural.
- **Recorrências**: salário, aluguel, assinaturas (materialização diária automática via Celery beat).
- **Metas** de economia (criar, acompanhar progresso, atualizar).
- **Limites** de gasto por categoria/período, com aviso ao estourar.
- **Relatórios** em PDF por período.
- **Funil de trial**: limite configurável de dias e mensagens; nudges de urgência; gating com
  mensagem de checkout quando esgota.

---

## Funil de vendas (trial → pago)

Configurável no painel admin sem redeploy:

| Configuração | Padrão | Onde ajustar |
|---|---|---|
| Duração do trial (dias) | 3 | Admin → Configurações |
| Limite de mensagens do trial | 15 | Admin → Configurações |
| Nudge N mensagens antes do fim | 3 | Admin → Configurações |
| Nudge N dias antes do fim | 1 | Admin → Configurações |
| URL pública do painel | — | Admin → Configurações |

Quando o usuário esgota o trial, recebe no WhatsApp o link da página `/assinatura` do painel.
De lá ele escolhe o plano, a Stripe processa, o webhook chega e o acesso é liberado — inclusive
nas renovações mensais seguintes.

---

## Deploy (produção)

### Vercel — frontend + FastAPI + filas (recomendado)

O `vercel.json` publica três Services no mesmo domínio:

- `frontend`: painel Vite e fallback SPA;
- `backend`: FastAPI para `/api`, `/admin`, `/webhook`, `/webhooks/*` e `/health`;
- `queues`: consumidores privados dos tópicos `zapwallet-inbound` e `zapwallet-finalize`.

Passos:

1. Importe o repositório na Vercel e selecione o preset **Services**.
2. Em **Settings → Security**, habilite Secure Backend Access/OIDC.
3. Configure um Redis gerenciado e use sua URL TLS em `REDIS_URL` (não use `fake`).
   A integração Upstash da Vercel também é reconhecida automaticamente por `KV_URL`.
4. Cadastre as variáveis abaixo nos ambientes Production e Preview:

   ```text
   SUPABASE_URL
   SUPABASE_SERVICE_KEY
   SUPABASE_ANON_KEY
   REDIS_URL (ou KV_URL, quando injetada pela integração Upstash)
   VERCEL_QUEUE_ENABLED=true
   VERCEL_QUEUE_REGION=iad1
   QUEUE_BRIDGE_SECRET=<segredo aleatório forte>
   CRON_SECRET=<outro segredo aleatório forte>
   ```

   OpenAI, UAZAPI e Stripe podem continuar em `app_secrets`; se preferir fallback,
   configure também suas variáveis no projeto. Deixe `VITE_API_URL` vazio: frontend
   e backend usam a mesma origem.
5. Faça um preview, valide `/health` e então promova para produção.
6. No painel UAZAPI, use `https://SEU_DOMINIO/webhook`. Na Stripe, registre o endpoint
   `https://SEU_DOMINIO/webhooks/stripe`.

Os Cron Jobs já estão declarados em UTC: recorrências diariamente às 09:00 UTC
(06:00 de Brasília) e reset mensal às 03:05 UTC (00:05 de Brasília). O plano
Hobby comporta exatamente os dois jobs.

### Backend tradicional — Railway / Render / VPS

O `Dockerfile` na pasta `agent-service/` builda a imagem. Use o mesmo image com comandos
diferentes (via `Procfile` ou múltiplos serviços):

```
web:            uvicorn app.main:app --host 0.0.0.0 --port $PORT
worker-inbound: celery -A app.celery_app.celery worker --queues=inbound --concurrency=8 --loglevel=info
worker-agent:   celery -A app.celery_app.celery worker --queues=agent,celery --concurrency=4 --loglevel=info
beat:           celery -A app.celery_app.celery beat --loglevel=info
```

> **beat** é obrigatório em produção para: materializar recorrências diárias e zerar o contador
> mensal de mensagens no dia 1º de cada mês (pulando trials).

Configure `REDIS_URL` apontando para um Redis gerenciado (Upstash, Railway Redis, etc.).
As demais variáveis são as mesmas do `.env.example`.

### Dev local com Docker

```bash
docker compose up --build
```

Sobe redis + api + worker-inbound + worker-agent + beat em containers locais.

### Frontend

```bash
cd web && npm run build
```

Copie `dist/` para Vercel, Netlify ou Cloudflare Pages. Configure as variáveis de ambiente no
painel da plataforma (as mesmas do `web/.env.example`).

---

## Testes

```bash
cd agent-service
pip install -r requirements-dev.txt
pytest
```

313 testes sem rede (FakeSupabase + FakeOpenAI scriptado). Cobrem o pipeline completo, funil,
tools, webhook Stripe (assinatura, liberação, renovação, revogação), memória/tool-calls, agente e cenários do Redis.

### Smoke test com OpenAI real (opcional)

Depois de configurar a chave da OpenAI, valide o comportamento REAL do modelo (o que os mocks não
pegam — decisão de chamar a ferramenta, recibo, pedido de valor):

```bash
cd agent-service && .venv/bin/python smoke_agent.py
```

Usa um banco isolado em memória (não toca no Supabase real); só as chamadas ao OpenAI são reais
(~25 chamadas, alguns centavos). Exercita gasto/receita/edição/exclusão/meta/limite/recorrência.

---

## Personalização rápida

| O que mudar | Onde |
|---|---|
| Nome / persona do agente | Admin → Prompt da IA (sem redeploy) |
| Chaves de API (OpenAI/uazapi/Stripe) e modelos | Admin → Integrações (sem redeploy) |
| Categorias padrão | `supabase/migrations/0004_seed.sql` |
| Funil (trial, nudge, checkout) | Admin → Configurações |
| Planos e preços | Admin → Planos |
| Adicionar uma tool ao agente | Criar `app/tools/<nome>.py` + registrar em `ai_agent_svc.py` |
