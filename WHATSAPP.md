# WhatsApp — configurar e testar com um número de teste

Passo a passo para pôr o canal de WhatsApp (Z-API) no ar pela primeira vez e
conferir as duas pontas: **mensagem do cliente chega no Intra** e **resposta do
Intra chega no celular do cliente**. O desenho do canal está no
[README](README.md#estrutura) e no cabeçalho das functions
`supabase/functions/whatsapp/` e `supabase/functions/whatsapp-responder/`.

## O que você precisa

| Papel                         | O que é                                                                                                                                                                                      |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Número da empresa (teste)** | Um chip de teste com WhatsApp instalado num celular. É ele que conecta na Z-API. Não use o número principal da empresa enquanto testa: a Z-API é API não oficial e o número pode ser banido. |
| **Celular do "cliente"**      | O seu celular pessoal, que vai mandar mensagem para o número de teste.                                                                                                                       |
| Painel da Z-API               | Conta com uma instância (o plano de teste serve).                                                                                                                                            |
| Supabase                      | Acesso ao SQL Editor e o CLI logado no projeto (`supabase login` e `supabase link`).                                                                                                         |

> Conectar o número na Z-API **não** tira o WhatsApp do celular de teste: entra
> como "aparelho conectado", igual ao WhatsApp Web.

## 1. Z-API: instância e credenciais

1. No painel, **Instâncias → Adicionar instância**.
2. Abra a instância e leia o **QR code** com o celular de teste
   (WhatsApp → ⋮ → **Aparelhos conectados** → **Conectar um aparelho**). O status
   fica **Conectado**.
3. Na página da instância, anote o **ID da instância** e o **Token da instância**.
4. Aba **Segurança** → **Token de Segurança da Conta** → **Configurar agora** e
   depois **ativar**. Anote o token: é o `Client-Token`, que o envio manda no
   cabeçalho. Com ele ativo, a Z-API recusa qualquer chamada sem o token.

Guarde os três valores num lugar seguro; eles vão para os secrets no passo 3, e
nunca para o git nem para o `js/config.js`.

## 2. Banco: migrations 075 e 076

No **SQL Editor** do Supabase, nesta ordem (não use `supabase db push`):

1. Cole e rode `supabase/migrations/075_whatsapp_canal.sql`.
2. Cole e rode `supabase/migrations/076_whatsapp_conversas.sql`. O backfill
   comentado no cabeçalho **não** precisa rodar: ainda não chegou mensagem nenhuma.
3. Confira com os `VERIFICAR` do cabeçalho de cada arquivo. O essencial:

```sql
select column_name from information_schema.columns
 where table_name = 'emails_triagem' and column_name in ('canal', 'telefone');
-- 2 linhas
select relrowsecurity from pg_class where oid = 'public.whatsapp_conversas'::regclass;
-- true
```

## 3. Secrets das Edge Functions

Gere um token longo e aleatório para o webhook (é ele que impede qualquer um de
injetar mensagem falsa na caixa):

```bash
openssl rand -hex 24
```

Depois grave os quatro secrets (troque os valores):

```bash
supabase secrets set ZAPI_INSTANCE_ID=<id da instância> ZAPI_TOKEN=<token da instância> ZAPI_CLIENT_TOKEN=<token de segurança da conta> WHATSAPP_WEBHOOK_TOKEN=<token gerado acima>
```

## 4. Publicar as duas functions

```bash
supabase functions deploy whatsapp
```

```bash
supabase functions deploy whatsapp-responder
```

O `supabase/config.toml` já deixa `verify_jwt = false` no `whatsapp` (quem chama é
a Z-API, que não tem JWT) e `true` no `whatsapp-responder` (quem chama é o app,
com o login do operador).

## 5. Testar a entrada sem celular (simulador)

Antes de envolver a Z-API, confirme que a function responde. Na raiz do projeto:

```bash
WHATSAPP_WEBHOOK_TOKEN=<token do webhook> node tools/whatsapp-simular.js --url https://<ref>.supabase.co/functions/v1/whatsapp --texto "teste do simulador"
```

Esperado: `{"ok":true,"notas":0,"caixa":1,"sem_cliente":1}` e a mensagem na
**Caixa de entrada** do Intra, com canal WhatsApp e motivo "sem cliente". Com
`--token errado` a resposta tem de ser **401**.

## 6. Apontar o webhook da Z-API

Na instância, **Webhooks** → campo **Ao receber**:

```text
https://<ref>.supabase.co/functions/v1/whatsapp?token=<WHATSAPP_WEBHOOK_TOKEN>
```

Deixe **desligado** o "notificar as enviadas por mim". A function já ignora
essas mensagens, mas não há motivo para a Z-API mandá-las.

> **Opcional, mas recomendado na primeira vez:** o formato do payload da Z-API
> foi escrito pela documentação e ainda não foi conferido com uma mensagem
> real. Para conferir, aponte o **Ao receber** primeiro para uma URL do
> [webhook.site](https://webhook.site), mande um "oi" do seu celular, copie o
> JSON que aparecer lá (apague o seu número antes, se for compartilhar) e
> depois volte a URL para a do Supabase.

## 7. Cadastrar o seu celular como contato de um cliente

O webhook casa o remetente com o cliente pelo telefone. Em **Clientes**, abra um
cliente de teste e ponha o número do seu celular em **Responsáveis → Contato**
(do Dono ou do Responsável TI), com DDD. Com ou sem o 9 e o 55 tanto faz: a
comparação normaliza.

Sem esse cadastro a mensagem ainda chega, mas cai como "sem cliente" na equipe
padrão (`init`).

## 8. Teste ponta a ponta

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

Os logs ficam no painel do Supabase: **Edge Functions → whatsapp** (ou
**whatsapp-responder**) **→ Logs**.

| Sintoma                                 | Causa provável                                                                                                                    |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Nada chega e não há log                 | URL do webhook errada na Z-API, ou a instância está desconectada.                                                                 |
| Log com 401                             | O `token=` da URL não bate com o `WHATSAPP_WEBHOOK_TOKEN`.                                                                        |
| 200 com `caixa: 0` em mensagem de texto | O payload veio num formato que o parser não reconhece: veja o passo 6 (opcional) e me mande o JSON.                               |
| Erro `column "canal" does not exist`    | A migration 075 não foi aplicada.                                                                                                 |
| Mensagem cai como "sem cliente"         | O telefone não está cadastrado em nenhum cliente, ou está em dois clientes diferentes (aí o casamento é ambíguo e ninguém ganha). |
| Envio: `missing_credentials` (500)      | Faltou algum dos secrets `ZAPI_*`.                                                                                                |
| Envio: `provider_error` (502)           | Client-Token errado ou desativado, ou instância desconectada.                                                                     |
| Envio: `not_whatsapp_contact` (422)     | A 076 não foi aplicada, ou esse número nunca escreveu para a empresa. Peça para a pessoa mandar uma mensagem primeiro.            |
| Envio: `pendencia_closed` (409)         | O chamado está encerrado. Reabra antes de responder.                                                                              |

## Antes de trocar para o número de verdade

- Troque a instância (QR do número oficial) e atualize `ZAPI_INSTANCE_ID` e
  `ZAPI_TOKEN`; o `ZAPI_CLIENT_TOKEN` é da conta e não muda.
- Gere um `WHATSAPP_WEBHOOK_TOKEN` novo e atualize a URL do webhook.
- Rode o backfill da 076 só se quiser liberar resposta a quem escreveu durante
  os testes.
