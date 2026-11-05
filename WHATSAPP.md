# WhatsApp — configurar e testar com um número de teste

Passo a passo para pôr o canal de WhatsApp (Evolution API) no ar pela primeira
vez e conferir as duas pontas: **mensagem do cliente chega no Intra** e
**resposta do Intra chega no celular do cliente**. O desenho do canal está no
[README](README.md#estrutura) e no cabeçalho das functions
`supabase/functions/whatsapp/` e `supabase/functions/whatsapp-responder/`.

A Evolution é **auto-hospedada**: diferente de um serviço pronto, alguém precisa
manter um servidor com ela rodando. Tudo o que o Intra sabe dela está em
`supabase/functions/whatsapp/provedor.ts`.

## O que você precisa

| Papel                         | O que é                                                                                                                                                                                            |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Servidor da Evolution**     | Uma VPS com Docker e um domínio com **HTTPS** (ex.: `evo.initnet.com.br`). O envio recusa `http://`, porque a apikey iria em texto puro.                                                           |
| **Número da empresa (teste)** | Um chip de teste com WhatsApp instalado num celular. É ele que conecta na Evolution. Não use o número principal enquanto testa: a conexão é não oficial (igual ao WhatsApp Web) e pode ser banida. |
| **Celular do "cliente"**      | O seu celular pessoal, que vai mandar mensagem para o número de teste.                                                                                                                             |
| Supabase                      | Acesso ao SQL Editor e o CLI logado no projeto (`supabase login` e `supabase link`).                                                                                                               |

> Conectar o número na Evolution **não** tira o WhatsApp do celular de teste:
> entra como "aparelho conectado", igual ao WhatsApp Web.

## 1. Subir a Evolution

O repositório oficial (`EvolutionAPI/evolution-api`) traz um
`docker-compose.yaml` com a API, o Postgres e o Redis. No servidor:

```bash
git clone https://github.com/EvolutionAPI/evolution-api.git
```

```bash
cd evolution-api && cp env.example .env
```

No `.env`, o mínimo a mudar:

- `AUTHENTICATION_API_KEY` — a **chave global**, que administra o servidor
  inteiro (cria e apaga instâncias). Gere uma longa (`openssl rand -hex 32`).
  Ela **não** vai para o Supabase.
- `SERVER_URL` — o endereço público com https (ex.: `https://evo.initnet.com.br`).
- `DATABASE_CONNECTION_URI` e `POSTGRES_*` — usuário e senha próprios, não os
  do exemplo.
- `LOG_LEVEL` — tire o `WEBHOOKS` da lista. Com ele, cada entrega de webhook vai
  para o log com o corpo inteiro, que inclui a apikey da instância.

Depois:

```bash
docker compose up -d
```

A API escuta em `127.0.0.1:8080`. Ponha um proxy reverso com HTTPS na frente
(Caddy é o mais simples: `evo.initnet.com.br { reverse_proxy 127.0.0.1:8080 }`).
O compose também publica o `evolution_frontend` na porta 3000 para qualquer
um; feche essa porta no firewall ou remova o serviço — o painel já existe em
`https://<seu servidor>/manager`.

Confira: `https://<seu servidor>/` responde um JSON com a versão.

## 2. Criar a instância e ler o QR code

1. Abra `https://<seu servidor>/manager` e entre com a chave global.
2. **Create instance** → nome `intra` (sem espaço; é o `EVOLUTION_INSTANCE`),
   canal **Baileys** (WhatsApp por QR code).
3. Abra a instância → **Get QR Code** e leia com o celular de teste
   (WhatsApp → ⋮ → **Aparelhos conectados** → **Conectar um aparelho**). O
   status fica **Connected** / `open`.
4. Copie o **token da instância** (aparece na tela dela; na criação por API vem
   como `hash`). É o `EVOLUTION_APIKEY`. Ele só mexe nesta instância — por isso
   é ele, e não a chave global, que vai para o Supabase.

## 3. Banco: migrations 075, 076 e 077

No **SQL Editor** do Supabase, nesta ordem (não use `supabase db push`):

1. Cole e rode `supabase/migrations/075_whatsapp_canal.sql`.
2. Cole e rode `supabase/migrations/076_whatsapp_conversas.sql`. O backfill
   comentado no cabeçalho **não** precisa rodar: ainda não chegou mensagem nenhuma.
3. Cole e rode `supabase/migrations/077_whatsapp_desempenho.sql` (casamento do
   cliente pelo telefone com índice e nota anexada sem corrida). Sem ela o
   canal funciona, só que mais devagar e com um aviso no log.
4. Confira com os `VERIFICAR` do cabeçalho de cada arquivo. O essencial:

```sql
select column_name from information_schema.columns
 where table_name = 'emails_triagem' and column_name in ('canal', 'telefone');
-- 2 linhas
select relrowsecurity from pg_class where oid = 'public.whatsapp_conversas'::regclass;
-- true
select public.telefone_chave('(11) 98765-4321');
-- 1187654321
```

## 4. Secrets das Edge Functions

Gere um segredo longo e aleatório para o webhook (é ele que impede qualquer um
de injetar mensagem falsa na caixa):

```bash
openssl rand -hex 24
```

Depois grave os quatro secrets (troque os valores; a URL vai sem barra no fim):

```bash
supabase secrets set EVOLUTION_URL=https://<seu servidor> EVOLUTION_INSTANCE=intra EVOLUTION_APIKEY=<token da instância> WHATSAPP_WEBHOOK_TOKEN=<segredo gerado acima>
```

## 5. Publicar as duas functions

```bash
supabase functions deploy whatsapp
```

```bash
supabase functions deploy whatsapp-responder
```

O `supabase/config.toml` já deixa `verify_jwt = false` no `whatsapp` (quem chama é
a Evolution, que não tem JWT) e `true` no `whatsapp-responder` (quem chama é o
app, com o login do operador).

## 6. Testar a entrada sem celular (simulador)

Antes de envolver a Evolution, confirme que a function responde. Na raiz do
projeto:

```bash
WHATSAPP_WEBHOOK_TOKEN=<segredo do webhook> node tools/whatsapp-simular.js --url https://<ref>.supabase.co/functions/v1/whatsapp --texto "teste do simulador"
```

Esperado: `{"ok":true,"notas":0,"caixa":1,"sem_cliente":1,...}` e a mensagem na
**Caixa de entrada** do Intra, com canal WhatsApp e motivo "sem cliente". Com
`--token errado` a resposta tem de ser **401**.

## 7. Apontar o webhook da instância

O segredo vai num **cabeçalho**, não na URL: a Evolution grava a URL de destino
no log. Cadastre pela API (o painel nem sempre mostra o campo de cabeçalhos):

```bash
curl -X POST https://<seu servidor>/webhook/set/intra -H "apikey: <token da instância>" -H "Content-Type: application/json" -d '{"webhook":{"enabled":true,"url":"https://<ref>.supabase.co/functions/v1/whatsapp","headers":{"x-whatsapp-secret":"<WHATSAPP_WEBHOOK_TOKEN>"},"byEvents":false,"base64":false,"events":["MESSAGES_UPSERT"]}}'
```

- `byEvents: false` — com `true`, a Evolution acrescenta `/messages-upsert` no
  fim da URL e a function não existe nesse caminho.
- `events` só com `MESSAGES_UPSERT` — o resto (presença, status de entrega,
  contatos) a function ignora; não há motivo para recebê-los.

## 8. Cadastrar o seu celular como contato de um cliente

O webhook casa o remetente com o cliente pelo telefone. Em **Clientes**, abra um
cliente de teste e ponha o número do seu celular em **Responsáveis → Contato**
(do Dono ou do Responsável TI), com DDD. Com ou sem o 9 e o 55 tanto faz: a
comparação normaliza.

Sem esse cadastro a mensagem ainda chega, mas cai como "sem cliente" na equipe
padrão (`init`).

## 9. Teste ponta a ponta

1. Do seu celular, mande uma mensagem para o número de teste.
2. No Intra, **Caixa de entrada**: a mensagem aparece com o nome do cliente.
3. Abra o chamado a partir dela, pela triagem. O webhook nunca abre chamado
   sozinho: quem decide é a triagem.
4. No chamado, escreva uma resposta e envie: ela chega no seu celular.
5. Responda do celular: a mensagem vira nota do solicitante no mesmo chamado,
   sem criar outro.
6. Conclua o chamado e mande outra mensagem: ela volta para a caixa como pedido
   novo.

## Quando algo não funciona

Os logs do Intra ficam no painel do Supabase: **Edge Functions → whatsapp** (ou
**whatsapp-responder**) **→ Logs**. Os da Evolution, no servidor:
`docker logs evolution_api --tail 200`.

| Sintoma                                 | Causa provável                                                                                                                    |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Nada chega e não há log no Supabase     | Webhook não cadastrado ou com URL errada (confira com `GET /webhook/find/intra`), ou a instância está desconectada.               |
| Log com 401                             | O cabeçalho `x-whatsapp-secret` não bate com o `WHATSAPP_WEBHOOK_TOKEN`, ou o webhook foi cadastrado sem `headers`.               |
| 200 com `caixa: 0` em mensagem de texto | Mensagem de grupo, ou contato que chegou só como `@lid` (sem telefone). Se for outro caso, me mande o JSON do log da Evolution.   |
| Erro `column "canal" does not exist`    | A migration 075 não foi aplicada.                                                                                                 |
| Mensagem cai como "sem cliente"         | O telefone não está cadastrado em nenhum cliente, ou está em dois clientes diferentes (aí o casamento é ambíguo e ninguém ganha). |
| Envio: `missing_credentials` (500)      | Faltou algum dos secrets `EVOLUTION_*`, ou a `EVOLUTION_URL` não começa com `https://`.                                           |
| Envio: `provider_unreachable` (502)     | O Supabase não alcança o servidor: DNS, certificado ou proxy reverso fora do ar.                                                  |
| Envio: `provider_error` (502)           | `EVOLUTION_APIKEY` errada, nome da instância errado (404) ou instância desconectada.                                              |
| Envio: `not_whatsapp_contact` (422)     | A 076 não foi aplicada, ou esse número nunca escreveu para a empresa. Peça para a pessoa mandar uma mensagem primeiro.            |
| Log "migration 077 não aplicada"        | Funciona assim, mas rode a 077 para o webhook não ler todos os clientes a cada mensagem.                                          |
| Log "passou de 30 mensagens por minuto" | O número mandou mais de 30 textos em um minuto; o excesso foi descartado de propósito.                                            |
| Envio: `pendencia_closed` (409)         | O chamado está encerrado. Reabra antes de responder.                                                                              |

## Antes de trocar para o número de verdade

- Desconecte o chip de teste e leia o QR do número oficial na mesma instância
  (ou crie outra e atualize `EVOLUTION_INSTANCE` e `EVOLUTION_APIKEY`).
- Gere um `WHATSAPP_WEBHOOK_TOKEN` novo e recadastre o webhook (passo 7) com ele.
- Rode o backfill da 076 só se quiser liberar resposta a quem escreveu durante
  os testes.
