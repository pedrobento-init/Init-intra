# WhatsApp — WAHA, n8n e Docker

Passo a passo para pôr o canal de WhatsApp no ar com
[WAHA](https://github.com/devlikeapro/waha) e conferir as duas pontas:
**mensagem do cliente chega no Intra** e **resposta do Intra chega no celular** —
pelo chamado (`whatsapp-responder`) ou direto da **Caixa de entrada**
(`conversa-responder`). O desenho do canal está no [README](README.md#estrutura) e
no cabeçalho das functions `supabase/functions/whatsapp/`,
`supabase/functions/whatsapp-responder/` e
`supabase/functions/conversa-responder/`.

> WAHA usa o WhatsApp Web como aparelho conectado. É uma API não oficial: use um
> número de teste antes do principal, pois automação indevida pode levar a
> restrições ou bloqueio do número.

## 1. Subir WAHA, n8n e PostgreSQL

O `compose.yaml` sobe os três serviços. O PostgreSQL é interno do n8n; o WAHA
guarda a sessão do WhatsApp em um volume próprio. As portas web ficam restritas
ao computador local.

1. Instale e abra o [Docker Desktop](https://www.docker.com/products/docker-desktop/).
2. No PowerShell, na raiz do projeto:

   ```powershell
   Copy-Item .env.example .env
   node -e "const c=require('crypto');for(const n of ['N8N_DB_PASSWORD','N8N_ENCRYPTION_KEY','WAHA_API_KEY','WAHA_DASHBOARD_PASSWORD'])console.log(n+'='+c.randomBytes(32).toString('hex'))"
   ```

3. Se o `.env` já existir, apenas acrescente as variáveis que faltarem. Substitua
   todos os valores `troque-por-...` pelos valores gerados, sem aspas. Guarde a
   `N8N_ENCRYPTION_KEY`: sem ela, o n8n não decifra suas credenciais após uma
   restauração.
4. Suba os serviços:

   ```powershell
   docker compose up -d
   docker compose ps
   ```

5. Abra [http://localhost:5678](http://localhost:5678) e crie o administrador
   do n8n no primeiro acesso.

Para parar sem apagar os dados, use `docker compose down`. Não use `down -v`:
isso apaga workflows, credenciais e a sessão do WhatsApp.

## 2. Conectar o número no WAHA

1. Abra [http://localhost:3000](http://localhost:3000).
2. Entre com usuário `admin` e a senha de `WAHA_DASHBOARD_PASSWORD`.
3. Crie ou inicie a sessão `default` e leia o QR Code no celular:
   **WhatsApp → Aparelhos conectados → Conectar um aparelho**.
4. Aguarde o status **WORKING**.

No n8n, chamadas ao WAHA usam a URL interna `http://waha:3000` e autenticação
por cabeçalho `X-Api-Key`, com o valor de `WAHA_API_KEY`. Por exemplo, o envio de
texto é `POST /api/sendText` com `{ "session": "default", "chatId":
"5511987654321@c.us", "text": "oi" }`.

## 3. Banco: migrations 075, 076, 077 e 082

No **SQL Editor** do Supabase, nesta ordem (não use `supabase db push`):

1. Cole e rode `supabase/migrations/075_whatsapp_canal.sql`.
2. Cole e rode `supabase/migrations/076_whatsapp_conversas.sql`. O backfill
   comentado no cabeçalho não precisa rodar antes de chegar a primeira mensagem.
3. Cole e rode `supabase/migrations/077_whatsapp_desempenho.sql`. Sem ela o canal
   funciona, só que mais devagar e com um aviso no log.
4. Cole e rode `supabase/migrations/082_portal_conversas.sql`. É a que permite
   responder e anotar direto na caixa (`direcao`, `media` e o status
   `encerrado`). Sem ela o webhook ainda grava a mensagem, mas o portal não
   responde.
5. Confira com os `VERIFICAR` do cabeçalho de cada arquivo. O essencial:

```sql
select column_name from information_schema.columns
 where table_name = 'emails_triagem' and column_name in ('canal', 'telefone');
-- 2 linhas
select column_name from information_schema.columns
 where table_name = 'emails_triagem' and column_name in ('direcao', 'media');
-- 2 linhas
select relrowsecurity from pg_class where oid = 'public.whatsapp_conversas'::regclass;
-- true
select public.telefone_chave('(11) 98765-4321');
-- 1187654321
```

## 4. Tornar o WAHA acessível ao Supabase

As Edge Functions rodam na nuvem e **não alcançam `localhost`**. O serviço
`waha-tunnel` do `compose.yaml` cria um túnel HTTPS temporário para os testes.
Descubra o endereço com:

```powershell
docker compose logs waha-tunnel
```

Procure a linha `https://<nome>.trycloudflare.com` e use essa URL em
`WAHA_BASE_URL`. O endereço muda quando o túnel é recriado; nesse caso, atualize o
secret e o webhook. Para produção, use um túnel nomeado ou um servidor com endereço
fixo. Não exponha a API sem a `WAHA_API_KEY`, nem libere o painel publicamente sem
necessidade.

## 5. Secrets das Edge Functions

Gere um token longo e aleatório para o webhook:

```bash
openssl rand -hex 24
```

Depois grave os secrets (troque os valores):

```bash
supabase secrets set WAHA_BASE_URL=https://<endereco-publico-do-waha> WAHA_API_KEY=<mesma-chave-do-env> WAHA_SESSION=default WHATSAPP_WEBHOOK_TOKEN=<token-gerado>
```

Esses valores nunca vão para o Git nem para o `js/config.js`.

## 6. Publicar as três functions

```bash
supabase functions deploy whatsapp
supabase functions deploy whatsapp-responder
supabase functions deploy conversa-responder
```

O `supabase/config.toml` deixa `verify_jwt = false` no `whatsapp` (quem chama é o
WAHA, sem JWT) e `true` nas outras duas (quem chama é o app, com o login do
operador).

## 7. Testar a entrada sem celular

Na raiz do projeto:

```bash
WHATSAPP_WEBHOOK_TOKEN=<token> node tools/whatsapp-simular.js --url https://<ref>.supabase.co/functions/v1/whatsapp --texto "teste do simulador"
```

Esperado: `{"ok":true,"notas":0,"caixa":1,"sem_cliente":1}` e a mensagem na
**Caixa de entrada** do Intra, com canal WhatsApp e motivo "sem cliente". Com
`--token errado` a resposta tem de ser **401**.

## 8. Apontar o webhook do WAHA

Na configuração da sessão `default`, cadastre um webhook:

- **URL:** `https://<ref>.supabase.co/functions/v1/whatsapp?token=<WHATSAPP_WEBHOOK_TOKEN>`
- **Eventos:** somente `message`
- **Tentativas:** 15, com intervalo inicial de 2 segundos

Não assine `message.any`: ele inclui as mensagens enviadas pelo próprio número. O
adaptador também ignora essas mensagens, grupos e eventos sem texto.

## 9. Cadastrar o celular como contato de um cliente

O webhook casa o remetente com o cliente pelo telefone. Em **Clientes**, abra um
cliente de teste e ponha o número do celular em **Responsáveis → Contato**, com
DDD. Com ou sem o 9 e o 55 tanto faz: a comparação normaliza.

Sem esse cadastro a mensagem ainda chega, mas cai como "sem cliente" na equipe
padrão (`init`).

## 10. Teste ponta a ponta

1. De outro celular, mande uma mensagem para o número conectado no WAHA.
2. No Intra, **Caixa de entrada**: a mensagem aparece com o nome do cliente.
3. Responda ali mesmo, em **Responder ao cliente**, e envie: a resposta chega no
   celular e aparece na conversa como saída. Não precisa abrir chamado.
4. Troque para **Nota interna (não envia)**: a nota entra no histórico e o
   celular não recebe nada.
5. **Encerrar conversa** tira a conversa de "Em atendimento" e a mantém em
   "Todas". Responda do celular: a mensagem reabre o atendimento.
6. Se o caso precisar de SLA, abra o chamado a partir da conversa. A triagem
   nunca abre chamado sozinha: quem decide é quem atende.
7. No chamado, escreva uma resposta e envie: ela chega no celular.
8. Responda do celular: a mensagem vira nota do solicitante no mesmo chamado.
9. Conclua o chamado e mande outra mensagem: ela volta para a caixa como pedido
   novo.

## Quando algo não funciona

Os logs ficam no painel do Supabase: **Edge Functions → whatsapp** (ou
`whatsapp-responder`, `conversa-responder`) **→ Logs**. Os logs locais do WAHA
aparecem com `docker compose logs waha`.

| Sintoma                                 | Causa provável                                                                         |
| --------------------------------------- | -------------------------------------------------------------------------------------- |
| Nada chega e não há log                 | URL do webhook errada no WAHA, sessão sem `WORKING` ou evento `message` não assinado.  |
| Log com 401                             | O `token=` da URL não bate com `WHATSAPP_WEBHOOK_TOKEN`.                               |
| 200 com `caixa: 0` em mensagem de texto | O payload não é um evento `message` com `payload.body`, `payload.from` e `payload.id`. |
| Erro `column "canal" does not exist`    | A migration 075 não foi aplicada.                                                      |
| Erro `column "direcao" does not exist`  | A migration 082 não foi aplicada; a mensagem ainda entra, mas o portal não responde.  |
| Mensagem cai como "sem cliente"         | O telefone não está cadastrado ou está em dois clientes diferentes.                    |
| Envio: `missing_credentials` (500)      | Faltou `WAHA_BASE_URL` ou `WAHA_API_KEY` nos secrets.                                  |
| Envio: `provider_error` (502)           | Chave errada, sessão desconectada ou WAHA recusou o envio.                             |
| Envio: `provider_unreachable` (502)     | `WAHA_BASE_URL` está inacessível; `localhost` não funciona para a Edge Function.       |
| Envio: `not_whatsapp_contact` (422)     | A 076 não foi aplicada, ou esse número nunca escreveu para a empresa.                  |
| Portal: `thread_not_found` (404)        | Linha antiga sem `thread_id` ou conversa de outra equipe; a RLS esconde a mensagem.    |
| Portal: `missing_credentials` (500)      | Faltou `WAHA_*` (WhatsApp) ou `GMAIL_*` (e-mail) nos secrets.                          |
| Log "migration 077 não aplicada"        | Funciona assim, mas rode a 077 para evitar leitura de todos os clientes.               |
| Log "passou de 30 mensagens por minuto" | O excesso foi descartado pelo limite do canal.                                         |
| Envio: `pendencia_closed` (409)         | O chamado está encerrado. Reabra antes de responder.                                   |
