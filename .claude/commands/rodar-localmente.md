---
description: Setup guiado completo — instala dependências, configura o .env interativamente e sobe back+front+túnel+webhook
allowed-tools: Bash, Read, Write, Edit, AskUserQuestion
---

# /rodar-localmente — ZapWallet

Setup guiado. Execute as fases na ordem, de forma **idempotente** (não duplique o que já está rodando).

---

## Fase 1 — Pré-requisitos

Verifique e instale o que falta:

```bash
command -v cloudflared || brew install cloudflared
command -v node        || brew install node
```

Se `cloudflared` não instalar via brew: avise o usuário para baixar em
https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/ e pare.

---

## Fase 2 — Setup guiado do .env

### 2a. Crie os arquivos se não existirem

```bash
[ -f agent-service/.env ] || cp agent-service/.env.example agent-service/.env
[ -f web/.env ]           || cp web/.env.example web/.env
```

### 2b. Identifique o que falta no `agent-service/.env`

Leia o arquivo e classifique cada variável abaixo como **preenchida** ou **pendente**.
Uma variável está pendente se o valor estiver: vazio, contiver `<` ou `>`, começar com
`SUA_`, `SEU_`, `YOUR_`, `TROQUE`, ou for um placeholder óbvio.

Variáveis a verificar:

| Variável | Onde encontrar | Obrigatório? |
|---|---|---|
| `SUPABASE_URL` | Supabase → Settings → API → Project URL | sim |
| `SUPABASE_SERVICE_KEY` | Supabase → Settings → API → service_role | sim |
| `SUPABASE_ANON_KEY` | Supabase → Settings → API → anon / public | sim |
| `OPENAI_API_KEY` | platform.openai.com/api-keys | não (pode configurar depois pelo painel admin) |
| `UAZAPI_BASE_URL` | Painel uazapi → sua instância → URL | para WhatsApp funcionar |
| `UAZAPI_TOKEN` | Painel uazapi → sua instância → token | para WhatsApp funcionar |
| `STRIPE_SECRET_KEY` | Stripe → Desenvolvedores → Chaves de API | para pagamentos |
| `STRIPE_WEBHOOK_SECRET` | Stripe → Desenvolvedores → Webhooks → Signing secret | para pagamentos |
| `EMAIL_DOMAIN` | Domínio fictício dos e-mails OTP (ex: `zapwallet.app`) | não (padrão já funciona) |

### 2c. Se houver pendentes: colete os valores do usuário

Se **tudo já estiver preenchido**, pule para a Fase 3.

Se houver pendentes, exiba uma mensagem como esta (adaptada às que faltam):

```
Antes de subir, preciso de algumas configurações. Cole os valores abaixo — só o que falta:

SUPABASE_URL=            ← Supabase → Settings → API → Project URL
SUPABASE_SERVICE_KEY=    ← Supabase → Settings → API → service_role (secret key)
SUPABASE_ANON_KEY=       ← Supabase → Settings → API → anon / public key
OPENAI_API_KEY=          ← platform.openai.com/api-keys  (ou deixe em branco — configura depois pelo painel admin)
UAZAPI_BASE_URL=         ← URL da instância uazapi, ex: https://xxx.uazapi.com
UAZAPI_TOKEN=            ← Token da instância uazapi
STRIPE_SECRET_KEY=       ← Stripe → Desenvolvedores → Chaves de API   (pode deixar em branco agora)
STRIPE_WEBHOOK_SECRET=   ← Stripe → Desenvolvedores → Webhooks → signing  (pode deixar em branco agora)

Responda no formato CHAVE=valor, uma por linha.
```

Aguarde a resposta do usuário. Quando ele colar os valores:
- Para cada `CHAVE=valor` recebido, substitua a linha correspondente no `agent-service/.env` usando Edit.
- Não toque em variáveis já preenchidas corretamente.
- Não exiba os valores na saída — confirme apenas os nomes das chaves atualizadas.

### 2d. Propague para o `web/.env` (sem perguntar)

Após ter os valores do back, atualize o `web/.env` automaticamente:
- `VITE_SUPABASE_URL`     = mesmo valor que `SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` = mesmo valor que `SUPABASE_ANON_KEY`
- `VITE_API_URL`          = `http://localhost:8000`

### 2e. Garanta `REDIS_URL=fake` para dev local

Verifique se `REDIS_URL` está definido no `agent-service/.env`. Se estiver ausente ou vazio,
adicione `REDIS_URL=fake` (Celery roda inline, sem precisar de Redis instalado).

---

## Fase 3 — Instalar dependências

### Backend (venv Python)

```bash
# Python compatível: ≤ 3.13 (pydantic-core não compila no 3.14)
PY=""
for c in python3.13 python3.12 python3.11; do
  command -v "$c" >/dev/null 2>&1 && { PY="$c"; break; }
done
[ -z "$PY" ] && python3 -c 'import sys; sys.exit(0 if sys.version_info[:2] <= (3,13) else 1)' 2>/dev/null && PY=python3
[ -z "$PY" ] && echo "ERRO: Python ≤ 3.13 não encontrado. Instale: brew install python@3.13" && exit 1

if [ ! -f agent-service/.venv/bin/python ]; then
  cd agent-service && "$PY" -m venv .venv \
    && .venv/bin/pip install -q --upgrade pip \
    && .venv/bin/pip install -q -r requirements.txt \
    && cd .. \
    && echo "✅ venv criada"
else
  echo "✅ venv já existe"
fi
```

> Se a venv existir mas falhar (erro de `pydantic-core` com 3.14), apague e recrie:
> `rm -rf agent-service/.venv` e rode o bloco acima de novo.

### Frontend (node_modules)

```bash
if [ ! -d web/node_modules ]; then
  cd web && npm install --no-audit --no-fund && cd .. && echo "✅ node_modules instalados"
else
  echo "✅ node_modules já existem"
fi
```

---

## Fase 4 — Subir os serviços

Antes de subir cada processo, verifique se já está no ar.

### API (FastAPI — porta 8000)

```bash
curl -fsS http://localhost:8000/health 2>/dev/null && echo "API já no ar" || echo "API parada — subindo..."
```

Se parada:
```bash
# run_in_background: true
cd agent-service && .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload > /tmp/zapwallet_api.log 2>&1
```

Se `REDIS_URL` não for `fake`, suba também o worker Celery:
```bash
# run_in_background: true  (só se REDIS_URL != fake)
cd agent-service && .venv/bin/celery -A app.celery_app.celery worker --loglevel=info > /tmp/zapwallet_worker.log 2>&1
```

Confirme que subiu (aguarde até 20s):
```bash
for i in $(seq 1 20); do curl -fsS http://localhost:8000/health && break; sleep 1; done
```

Se não responder, mostre o final do log e pare:
```bash
tail -40 /tmp/zapwallet_api.log
```

### Front (Vite — porta 8080)

```bash
curl -fsS http://localhost:8080 2>/dev/null && echo "Front já no ar" || echo "Front parado — subindo..."
```

Se parado:
```bash
# run_in_background: true
cd web && npm run dev > /tmp/zapwallet_web.log 2>&1
```

---

## Fase 5 — Cloudflare Tunnel

Verifique se o túnel já está ativo:
```bash
TUNNEL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/zapwallet_cf.log 2>/dev/null | head -1)
[ -n "$TUNNEL" ] && echo "Túnel já ativo: $TUNNEL" || echo "Subindo túnel..."
```

Se não estiver ativo:
```bash
# run_in_background: true
cloudflared tunnel --url http://localhost:8000 > /tmp/zapwallet_cf.log 2>&1
```

Aguarde a URL aparecer (até 30s):
```bash
for i in $(seq 1 30); do
  TUNNEL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/zapwallet_cf.log | head -1)
  [ -n "$TUNNEL" ] && echo "TUNNEL=$TUNNEL" && break
  sleep 1
done
[ -z "$TUNNEL" ] && echo "FALHOU — veja /tmp/zapwallet_cf.log" && exit 1
```

Valide o túnel:
```bash
curl -fsS "$TUNNEL/health" && echo " ← túnel OK"
```

---

## Fase 6 — Webhook uazapi

Extraia as credenciais sem comentários inline:
```bash
clean() { grep -E "^$1=" agent-service/.env | head -1 | cut -d= -f2- | sed 's/#.*//' | xargs; }
UAZAPI_BASE_URL=$(clean UAZAPI_BASE_URL)
UAZAPI_TOKEN=$(clean UAZAPI_TOKEN)
echo "BASE=$UAZAPI_BASE_URL  |  TOKEN preenchido: $([ -n "$UAZAPI_TOKEN" ] && echo sim || echo não)"
```

Se ambas estiverem preenchidas, registre automaticamente:
1. `GET $UAZAPI_BASE_URL/webhook -H "token: $UAZAPI_TOKEN"` — descubra o formato atual
2. `POST` apontando para `$TUNNEL/webhook` com todos os eventos ligados:
   ```bash
   curl -fsS -X POST "$UAZAPI_BASE_URL/webhook" \
     -H "token: $UAZAPI_TOKEN" -H "Content-Type: application/json" \
     -d "{\"enabled\":true,\"url\":\"$TUNNEL/webhook\",\"events\":[\"messages\",\"messages_update\",\"connection\",\"presence\",\"contacts\",\"chats\",\"groups\",\"labels\",\"call\",\"leads\"],\"excludeMessages\":[],\"addUrlEvents\":false,\"addUrlTypesMessages\":false}"
   ```
3. Confirme com outro GET que a URL e os eventos estão corretos.

Se falhar ou as credenciais estiverem em branco, instrua o usuário:
```
→ Painel uazapi → sua instância → Webhook
  URL: <TUNNEL>/webhook
  Marque TODOS os eventos e salve.
```

---

## Fase 7 — Relatório final

```
✅ ZapWallet rodando localmente

• Back  (API):    http://localhost:8000   (/health · /docs)
• Front (painel): http://localhost:8080
• Túnel público:  <TUNNEL>
• Webhook uazapi: <TUNNEL>/webhook        [registrado automaticamente | registre manualmente]

Logs:
• API:    /tmp/zapwallet_api.log
• Worker: /tmp/zapwallet_worker.log  (se Redis real)
• Front:  /tmp/zapwallet_web.log
• Túnel:  /tmp/zapwallet_cf.log

Obs.: a URL trycloudflare muda a cada execução — re-registre o webhook quando rodar de novo.
```

---

## Regras
- **Idempotente**: cheque antes de subir — não duplique processos.
- **Nunca exiba** chaves, tokens ou secrets completos na saída.
- Se qualquer fase falhar, mostre o trecho relevante do log e o conserto sugerido. Não siga silenciosamente.
- Ao coletar valores do .env, aceite o que o usuário colar mesmo que a resposta venha em formatos ligeiramente diferentes (`CHAVE = valor`, com aspas, com espaço antes do `=`).
