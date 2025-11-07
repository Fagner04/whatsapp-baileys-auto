# WhatsApp Baileys Server para Railway

Backend que gerencia conexões WhatsApp usando Baileys.

## 🚀 Deploy no Railway - INSTRUÇÕES COMPLETAS

### 1. Criar projeto no Railway
- Acesse [railway.app](https://railway.app)
- Clique em "New Project"
- Selecione "Empty Project"

### 2. Deploy via GitHub (RECOMENDADO)
- Conecte seu repositório GitHub
- Configure "Root Directory" como `railway-baileys`
- Railway detectará o package.json automaticamente

### 3. Configurar Variáveis de Ambiente
No Railway dashboard, adicione na aba "Variables":

```env
PORT=3000
SUPABASE_URL=https://kgjtweydkggbbfncnpxc.supabase.co
SUPABASE_SERVICE_ROLE_KEY=seu_service_role_key_aqui
```

⚠️ **IMPORTANTE:** Pegue o Service Role Key em:
https://supabase.com/dashboard/project/kgjtweydkggbbfncnpxc/settings/api

### 4. Deploy
- Railway fará deploy automático
- Aguarde logs mostrarem "Baileys server running on port 3000"

### 5. Obter URL e configurar no Supabase
- No Railway: Settings > Networking > Generate Domain
- Copie a URL (ex: `https://seu-app.up.railway.app`)
- Adicione como secret `RAILWAY_BAILEYS_URL` no Lovable

## 📁 Estrutura

```
railway-baileys/
├── index.js          # Servidor principal
├── package.json      # Dependências Node.js
├── railway.json      # Config Railway
├── nixpacks.toml     # Build config
└── .env.example      # Template de variáveis
```

## 🔌 Endpoints API

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/` | Health check |
| POST | `/api/device/create` | Criar conexão |
| GET | `/api/device/:id/qr` | Obter QR code |
| POST | `/api/device/:id/disconnect` | Desconectar |
| GET | `/api/device/:id/status` | Status |
| POST | `/api/message/send` | Enviar mensagem |

## 🐛 Troubleshooting

### Erro: "error reading package.json"
✅ **SOLUÇÃO:** 
1. Certifique-se de que `package.json` existe e está bem formatado
2. Verifique se o arquivo `railway.json` e `nixpacks.toml` estão presentes
3. Redeploy do zero: Delete o serviço e crie novamente

### QR Code não aparece
✅ **SOLUÇÃO:**
1. Verifique logs do Railway: aba "Deployments" > "View Logs"
2. Confirme que `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` estão corretos
3. Aguarde até 60 segundos para QR ser gerado

### "makeWASocket is not a function"
✅ **SOLUÇÃO:**
- Certifique-se de usar Node.js >= 18
- No Railway, confirme engine em package.json: `"node": ">=18.0.0"`

### Conexão cai após conectar
✅ **SOLUÇÃO:**
1. Não abra WhatsApp Web em outro navegador
2. Não escaneie o mesmo QR duas vezes
3. Use volume persistente no Railway para manter sessões

## 💾 Volumes Persistentes (Opcional)

Para manter sessões entre deploys:
1. Railway dashboard > seu projeto
2. Aba "Volumes" > "New Volume"
3. Mount Path: `/app/auth_sessions`

## 📊 Monitoramento

Logs em tempo real:
```
Railway Dashboard > Deployments > View Logs
```
