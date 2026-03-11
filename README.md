# YouTube Clip Factory

Pipeline automatizado para baixar, cortar e publicar clipes de vídeos do YouTube.

## Stack

- Node.js 20 + Express
- PostgreSQL (Railway)
- AssemblyAI (transcrição)
- OpenAI GPT-4o-mini (análise de cortes)
- FFmpeg (edição de vídeo)
- YouTube Data API v3 (upload)

## Desenvolvimento local

```bash
# 1. Instalar dependências
npm install

# 2. Configurar variáveis de ambiente
cp .env.example .env
# Editar .env com suas credenciais

# 3. Rodar servidor
npm run dev
```

Acesse: http://localhost:3000

## Deploy na Railway.app

### Passo 1 — Criar conta e projeto

1. Acesse [railway.app](https://railway.app) e crie uma conta
2. Clique em **"New Project"**
3. Selecione **"Deploy from GitHub repo"**
4. Conecte este repositório

### Passo 2 — Adicionar banco de dados

1. No projeto Railway, clique em **"+ New"**
2. Selecione **"Database" → "Add PostgreSQL"**
3. Railway criará o banco automaticamente
4. Copie a variável `DATABASE_URL` gerada

### Passo 3 — Configurar variáveis de ambiente

No painel Railway, vá em **"Variables"** e adicione:

| Variável | Valor |
|---|---|
| `DATABASE_URL` | (copiado do PostgreSQL plugin) |
| `DASHBOARD_PASSWORD` | (senha de acesso ao dashboard) |
| `TEMP_DIR` | `/tmp` |
| `NODE_ENV` | `production` |

As demais variáveis (AssemblyAI, OpenAI, YouTube) serão adicionadas conforme as stories forem implementadas.

### Passo 4 — Deploy

Railway faz deploy automático a cada `git push`. O health check em `/health` confirma que o serviço está rodando.

## Estrutura do projeto

```
src/
├── app.js              # Express config
├── server.js           # Entry point
├── db/
│   ├── connection.js   # PostgreSQL pool
│   └── migrate.js      # Schema migrations
├── modules/
│   ├── downloader/     # yt-dlp integration (Story 4.2)
│   ├── transcriber/    # AssemblyAI (Story 4.3)
│   ├── analyzer/       # OpenAI GPT (Story 4.4)
│   ├── editor/         # FFmpeg (Story 4.5)
│   └── uploader/       # YouTube API (Story 4.7)
├── routes/
│   ├── health.js
│   ├── jobs.js
│   └── clips.js
├── workers/            # Background processing
└── public/             # Dashboard web (Story 4.6)
```
