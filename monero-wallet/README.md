# MoneroWallet — Carteira Digital Monero (estilo corretora)

Carteira digital exclusiva para a criptomoeda **Monero (XMR)**. Cada usuário tem saldo exibido no site, mas os fundos reais ficam na **conta-mestra (hot wallet)**. Depósitos chegam automaticamente na conta-mestra e são creditados no site; saques saem da conta-mestra após aprovação do admin.

## Funcionalidades

### Usuário
- Cadastro / login com senha bcrypt + **2FA (TOTP)** opcional
- Carteira com saldo em XMR, endereço de depósito próprio (subaddress da conta-mestra) + QR code
- Depósito automático detectado por scanner em segundo plano (com N confirmações configurável)
- Solicitação de saque para endereço XMR externo (validação de endereço)
- Histórico completo de transações

### Admin (poder total)
- Dashboard com saldo da conta-mestra, XMR depositado/sacado, usuários, pendências
- Gestão de usuários: bloquear, excluir, **ajustar saldo (crédito/débito)** manualmente
- Aprovar/rejeitar saques → envio automático via wallet-rpc (com estorno automático em falha)
- Confirmar manualmente ou reverter depósitos
- Conta-mestra: scan manual, rescan da blockchain, endereço principal
- Configurações: nome do site, confirmações mínimas, taxa de saque, manutenção, cadastros
- **2FA obrigatório do admin**, logs de auditoria, caminho secreto do painel

### API (pronta para integrar o marketplace)
O marketplace poderá cobrar compras usando o saldo XMR do usuário:

| Endpoint | Descrição |
|---|---|
| `POST /api/v1/balance` | Consulta saldo de um usuário (`email` ou `user_id`) |
| `POST /api/v1/hold` | Reserva saldo para uma compra (bloqueia o valor) |
| `POST /api/v1/capture` | Finaliza a compra capturando a reserva |
| `POST /api/v1/release` | Cancela e devolve o saldo ao usuário |

Autenticação via header `X-API-Key` (defina em `API_KEYS` no `.env`).

## Como rodar

```bash
npm install
# edite o .env (senha admin, chaves, etc.)
npm start
```

- Carteira do usuário: `http://localhost:3001`
- Painel admin: `http://localhost:3001/admin/login`

### Modo mock (padrão — sem node)
Funciona sem nenhum node Monero. O painel admin → **Conta-Mestra** tem a opção
**"Simular depósito"**: cole o endereço de depósito do usuário e o valor; o scanner
incrementa confirmações a cada ciclo e credita o saldo automaticamente. Ideal para
testar todo o fluxo.

### Modo live (produção)
1. Rode um node Monero completo + carteira:
   ```
   monerod --prune-blockchain --no-igd
   monero-wallet-rpc --wallet-file conta-mestra.keys --password X \
     --rpc-bind-port 18082 --daemon-host 127.0.0.1 --confirm-external-bind
   ```
2. No `.env`:
   ```
   WALLET_MODE=live
   MONERO_RPC_URL=http://127.0.0.1:18082/json_rpc
   ```
3. **Nunca exponha o wallet-rpc publicamente** — acesse apenas via localhost/VPN.
4. Teste antes em **Stagenet** com saldos de teste.

## Segurança
- Senhas com bcrypt (12 rounds), sessões HTTP-only, CSRF em todos os formulários
- Rate-limit em login e geral; helmet com CSP
- 2FA (TOTP) para usuários e admin (obrigatório recomendado para admin)
- Endereços de depósito são subaddresses da conta-mestra — nenhuma chave fica no banco
- Depósitos só são creditados após N confirmações (anti-reorg)
- Saques exigem aprovação manual; falha de envio devolve o saldo automaticamente
- Tudo auditado em logs (painel → Logs)
- Caminho do painel admin configurável (`.env` → `ADMIN_PATH`)

## Estrutura

```
monero-wallet/
├── server.js              # app Express + scanner
├── config.js              # caminhos secretos
├── database/db.js         # schema + camada de dados (sql.js)
├── lib/
│   ├── monero-rpc.js      # cliente wallet-rpc (mock + live)
│   ├── wallet.js          # singleton da carteira
│   └── scanner.js         # scanner automático de depósitos
├── middleware/
│   ├── auth.js            # requireAuth / requireAdmin
│   └── csrf.js            # proteção CSRF
├── routes/
│   ├── auth.js            # login/cadastro/2FA
│   ├── wallet.js          # carteira, depósito, saque, histórico
│   ├── admin.js           # painel admin completo
│   └── api.js             # API para o marketplace
└── views/                 # EJS (usuário + admin)
```

## Aviso importante
- Operar corretora/carteira publicamente no Brasil exige **registro no Banco Central** (Lei 14.478/2022) e KYC/AML. Este sistema é para uso privado/pessoal conforme solicitado.
- Criptomoedas envolvem risco de perda. Faça backup da carteira (`.keys`) e teste em Stagenet antes de valores reais.
