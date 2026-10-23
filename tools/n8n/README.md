# n8n no lugar do Make (e, se quiser, do Apps Script)

Dois workflows prontos para importar. O primeiro substitui o Make; o segundo é
opcional e substitui um pedaço do Apps Script.

| Arquivo                                                          | Substitui                                  | Obrigatório?                         |
| ---------------------------------------------------------------- | ------------------------------------------ | ------------------------------------ |
| [`init-intra-ia.json`](init-intra-ia.json)                       | o cenário único do Make (`IA_WEBHOOK_URL`) | é o que de fato troca o Make         |
| [`init-intra-triagem-gmail.json`](init-intra-triagem-gmail.json) | o `roboPendenciasEmail` do `Robo.gs`       | não; o Apps Script continua servindo |

> **Nada disto foi testado numa instância de n8n.** Os `typeVersion` dos nós são
> os que valiam quando o arquivo foi escrito; o n8n migra na importação, mas um
> parâmetro pode mudar de lugar. Importe, abra cada nó e confira antes de ativar.

## 1. As quatro rotas de IA (`init-intra-ia.json`)

```
Webhook → Switch (tarefa) → briefing   → Claude Sonnet → Responde texto
                          → triagem    → Claude Haiku → Garante JSON → Responde JSON
                          → relatorio  → Claude Sonnet → Responde texto
                          → levar      → Claude Sonnet → Responde texto
```

É o mesmo desenho do Make descrito em [`GOOGLE-AGENDA.md`](../../GOOGLE-AGENDA.md):
uma URL, um Router pelo campo `tarefa`, uma resposta por rota. O Intra não muda
nenhuma linha — só o valor do secret:

```bash
supabase secrets set IA_WEBHOOK_URL=<URL de producao do no Webhook>
```

**Instalar**

1. Importe o workflow.
2. Crie a credencial do Anthropic (ou troque os dois nós de modelo pelo provedor
   que você preferir) e selecione-a nos nós **Claude Sonnet** e **Claude Haiku**.
3. Ative o workflow e copie a **URL de produção** do nó Webhook (a de teste só
   responde com o editor aberto).
4. Rode o `supabase secrets set` acima. Não precisa redeploy: o secret é lido em
   tempo de execução.

**As três armadilhas**

- **`responseMode` tem de ser `responseNode`.** No modo padrão o n8n responde na
  hora com `{"message":"Workflow was started"}`, e o Intra trata isso como falha
  — exatamente o que acontecia no Make sem o módulo _Webhook response_.
- **A rota `triagem` tem de devolver JSON parseável.** O nó **Garante JSON** tira
  cerca de código, recorta o primeiro objeto e normaliza os campos contra as
  listas da migration 056 — inclusive rebaixando `critica` para `alta`, como o
  `campo.ts` faz. Sem ele, um ` ```json ` na frente da resposta já derruba a
  classificação. E quando a resposta **não** é JSON de jeito nenhum, o nó
  **estoura de propósito**: o webhook responde 500, o Intra trata como falha da
  IA e abre o chamado com a etiqueta `sem-classificacao-ia`. Devolver um objeto
  vazio e válido seria pior — o chamado pareceria classificado sem ninguém ter
  classificado nada, e o técnico perderia o aviso de conferir antes de responder.
- **Os prazos de espera são do lado do Intra:** 25 s no briefing
  (`supabase/functions/robo/index.ts`), 45 s no levar, 60 s no relatório. Modelo
  lento estoura — e estourar não quebra nada, só perde a IA daquela chamada.

**O que muda em relação ao Make**

- **A chave de IA passa a ser sua.** O Make usava o provedor dele (GPT-5 mini) e
  por isso o projeto não tinha chave de IA nenhuma. Com n8n você paga o modelo à
  parte — e some o limite de 1.000 operações/mês do plano Free da Make.
- **Privacidade:** os fatos passam a ir para o seu n8n e para o provedor que você
  escolher, em vez do Make. Continuam sem senhas e sem tokens.

## 2. A triagem do Gmail (`init-intra-triagem-gmail.json`)

```
Schedule (15 min) → Gmail: busca label:"Pendências" → Monta mensagens
  → Remove Duplicates (já vistos) → Corpo da chamada → POST /functions/v1/robo
```

**Instalar**

1. Importe o workflow.
2. Credencial do Gmail **da conta do robô** (a mesma que tem o rótulo
   _Pendências_), no nó Gmail.
3. Credencial **Header Auth**: nome `x-agenda-secret`, valor = o
   `AGENDA_SYNC_SECRET` dos secrets do Supabase. Selecione-a no nó HTTP Request.
4. No nó HTTP Request, troque `https://SEU-PROJETO.supabase.co` pela URL do seu
   projeto.
5. Ative. Se ativar este, **remova o gatilho `roboPendenciasEmail`** no Apps
   Script, senão os dois mandam o mesmo e-mail (não duplica chamado — a function
   recusa repetido —, mas gasta execução dos dois lados).

**Por que Schedule e não Gmail Trigger**

O Gmail Trigger dispara pela **data de recebimento**. Aqui o e-mail normalmente
ganha o rótulo _Pendências_ depois de chegar, na mão — às vezes dias depois. Esse
e-mail o Gmail Trigger nunca veria. O Apps Script faz uma busca
(`label:"Pendências" after:…`), e este workflow faz o mesmo.

**Deduplicação em três camadas** (o `TRIAGEM_EMAIL_DESDE` do Apps Script era uma)

1. `newer_than:2d` na busca do Gmail: limita o que se olha.
2. **Remove Duplicates** por `id` de mensagem, com memória entre execuções — é a
   camada que importa, e é melhor que a marca d'água de tempo: e-mail antigo que
   ganha o rótulo hoje passa, e reimportar o workflow não reprocessa o que já foi.
3. A própria function grava `triagem:<id>` em `avisos_enviados` e ignora
   repetido. Então mesmo zerando a memória do n8n não nasce chamado duplicado.

**O `Message-ID`**

O nó _Monta mensagens_ lê o cabeçalho RFC 5322 `Message-ID` de
`payload.headers` — não o `id` interno do Gmail, que é outra coisa. É esse
cabeçalho que a pendência guarda em `email_message_id` e que volta como
`In-Reply-To`/`References` quando o técnico responde pela tela; com o campo
errado, a resposta sai como conversa nova. Por isso o nó Gmail usa
`simple: false`: é assim que os cabeçalhos vêm.

**O que não passa por aqui.** A resposta ao cliente continua saindo da
[`pendencia-responder`](../../supabase/functions/pendencia-responder/index.ts),
com a chave de serviço, lendo o `solicitante_email` do chamado. A tela manda só
o `pendencia_id`, nunca um destinatário — essa trava não muda por causa do n8n.

**O que o Apps Script continua fazendo** (nada disto está nos workflows):
`roboVencimentos` (agenda), `roboResumo` (e-mail "Seu dia" + Google Chat),
`roboNoite` (RDAP, planilha de indicadores, backup no Drive) e
`roboBackupsEmail` (rótulo _Backups_). Migrar só a triagem deixa o projeto com
duas colas — vale a pena se você quer os logs e o retry do n8n.
