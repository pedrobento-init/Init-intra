# Responder da caixa de entrada — plano de implementação

> Para o agente executor: `godmode:inline-execution` (tarefas pequenas e
> sequenciais, contexto segura). Steps com checkboxes para acompanhar.

**Goal:** ação **Responder** na tela `#caixa`: humano escreve, o e-mail sai pelo
Gmail no mesmo thread, a resposta fica registrada na conversa; IA nunca responde
sozinha.
**Design:** docs/plans/2026-10-29-caixa-entrada-design.md (seção "Responder",
aprovada como PR seguinte ao #69).
**Architecture:** Edge Function nova `caixa-responder` (`@supabase/server`,
`auth: "user"`, irmã da `pendencia-responder`) envia via Gmail SMTP com
In-Reply-To = `message_id` da linha, grava a resposta como linha nova em
`emails_triagem` com status `respondido` e marca as pendentes do thread.
Frontend `js/caixa-entrada.js` ganha `caixaResponder`/`caixaResponderSalvar` por
`registerActions`. Migration 074 soma `respondido` ao CHECK de status.
**Stack:** JS puro em `<script>` (sem módulos), Vitest, Edge Functions Deno com
`npm:@supabase/server@1` + `npm:nodemailer@6.9.16`, migrations manuais.

## Global Constraints

- Ações só por `registerActions`/`data-action`; nada de handler inline.
- Todo dado de e-mail em `innerHTML` passa por `escapeHtml` (terceiro é o maior
  risco de XSS do app).
- RLS por team: a function lê a linha com o cliente do usuário (nunca
  `supabaseAdmin`); linha de outra equipe → 404, não envio.
- Edge Function: `withSupabase({ auth: "user" })` + `[functions.caixa-responder]
  verify_jwt = true` em `supabase/config.toml`; `tests/edge-functions-guard.test.js`
  e `tests/edge-functions-auth.test.js` verdes.
- Migration idempotente, aplicada à mão, com VERIFICAR e REVERTER no cabeçalho.
- IA não responde cliente: não existe caminho de envio sem clique humano.
- `js/` é escopo global: confirmar por grep que `caixaResponder`,
  `caixaResponderSalvar` não existem antes de criar.
- Comentários, mensagens de teste e commits em pt-BR.
- Existe rascunho não rastreado em `supabase/functions/caixa-responder/index.ts`
  (branch `feat/caixa-responder`): estender, não reescrever.

## Review Focus

1. **Reenvio/duplo clique** — segunda resposta para a mesma conversa não pode
   mandar e-mail de novo: a function recusa linha com status ≠ `pendente`
   (`already_handled`); trava no servidor (Task 2) + toast no app (Task 3).
2. **Relay de e-mail** — destinatário só do `de` da linha; corpo da requisição
   restrito a `email_id`+`text`; sem `supabaseAdmin` no fonte (Task 2, teste
   estrutural).
3. **Banco sem a 074** — insert da resposta falha no CHECK depois do e-mail já
   ter saído: function responde `registrado: false`, app avisa e NÃO perde o
   envio (Task 2 comportamental + Task 3).
4. **XSS no modal** — assunto/remetente no modal do Responder passam por
   `escapeHtml` (Task 3, teste com `<img onerror>`).
5. **Conflito de decisão** — responder marca as pendentes do thread como
   `respondido` no servidor mesmo se o app cair no meio; o app só pinta o local
   depois do servidor confirmar (Tasks 2 e 3).

## Sources

- Repositório: `supabase/functions/pendencia-responder/index.ts` (precedente de
  envio na mesma conversa), `supabase/migrations/066|073`, `js/caixa-entrada.js`,
  `js/emails-triagem.js`, `tests/edge-functions-guard.test.js`,
  `tests/edge-functions-auth.test.js`, `tests/pendencia-responder.test.js`,
  `tests/migrations-073.test.js`, `tests/helpers/edge-harness.js`,
  `tests/helpers/fake-supabase.js`. Todos em 30/10/2026.
- Skill `supabase-server`: `auth: "user"` entrega `ctx.supabase` com o JWT;
  `verify_jwt = true` é o padrão para functions chamadas pelo app.

## File Map

| Arquivo | Ação | Responsabilidade |
| --- | --- | --- |
| `supabase/migrations/074_caixa_responder.sql` | criar | CHECK de status aceita `respondido` |
| `tests/migrations-074.test.js` | criar | trava texto da 074 (idempotente, VERIFICAR/REVERTER) |
| `supabase/functions/caixa-responder/index.ts` | estender | enviar + registrar resposta + marcar pendentes do thread |
| `supabase/config.toml` | modificar | `[functions.caixa-responder] verify_jwt = true` |
| `tests/caixa-responder.test.js` | criar | invariantes estruturais + envio feliz via harness |
| `tests/helpers/fake-supabase.js` | modificar | builder ganha `insert` (fire-and-forget, como `update`) |
| `tests/edge-functions-auth.test.js` | modificar | `caixa-responder` na lista dos 15 com JWT |
| `js/caixa-entrada.js` | modificar | ação Responder, selo "resposta enviada", comentário do topo |
| `tests/caixa-entrada.test.js` | modificar | sandbox com `functions.invoke`; casos do Responder |
| `README.md`, `GOOGLE-AGENDA.md` | modificar | documentar a function e a migration 074 |

---

### Task 1: Migration 074 + teste

**Files:**
- Create: `supabase/migrations/074_caixa_responder.sql`
- Test: `tests/migrations-074.test.js`

**Covers:** resposta registrada com status novo sem quebrar banco sem a
migration.

**Interfaces:**
- Produz: status `'respondido'` aceito por `emails_triagem_status_check`. Task 2
  insere linha e atualiza pendentes com esse valor; Task 3 pinta o selo.

- [ ] **Step 1: escrever o teste falhando** (`tests/migrations-074.test.js`,
  espelhando `tests/migrations-073.test.js` com CRLF normalizado):
  - CHECK contém os cinco estados (`pendente`, `virou_chamado`, `anexado`,
    `respondido`, `descartado`);
  - idempotente: `drop constraint if exists emails_triagem_status_check` ANTES
    de `add constraint`;
  - não mexe em policy nem em `motivo`;
  - traz `-- VERIFICAR:` e `-- REVERTER:`, e no REVERTER o `delete ... status = 'respondido'`
    vem antes do `check (status in ('pendente', 'virou_chamado', 'anexado', 'descartado'))`.
- [ ] **Step 2: rodar e ver falhar**
  Run: `npx vitest run tests/migrations-074.test.js`
  Expected: FAIL (arquivo de migration inexistente).
- [ ] **Step 3: escrever a migration** — cabeçalho no padrão da 073 (o que
  muda, por quê, sem ela o que acontece, depois da 073, idempotente, VERIFICAR
  com `-- esperado:`, ROLLBACK/REVERTER); corpo:
  `drop constraint if exists` + `add constraint ... check (status in (os 5))`.
- [ ] **Step 4: rodar e ver passar**
  Run: `npx vitest run tests/migrations-074.test.js`
  Expected: PASS.
- [ ] **Step 5: commit**
  `git add supabase/migrations/074_caixa_responder.sql tests/migrations-074.test.js`
  `git commit -m "feat(migrations): status respondido na caixa (074)"`

### Task 2: Edge Function `caixa-responder` completa + guards

**Files:**
- Modify: `supabase/functions/caixa-responder/index.ts` (rascunho existente)
- Modify: `supabase/config.toml` (depois da linha 31, bloco `pendencia-responder`)
- Modify: `tests/helpers/fake-supabase.js` (uma linha: `insert: () => api`)
- Modify: `tests/edge-functions-auth.test.js` (lista `FUNCTIONS`: adicionar
  `{ nome: 'caixa-responder', equipe: 'nenhum', body: { email_id: 'e1', text: 'resposta de teste' } }`;
  título "as 14 com JWT" → "as 15 com JWT")
- Test: `tests/caixa-responder.test.js`

**Covers:** review focus 1, 2, 3 e 5 (lado servidor); AC "resposta no mesmo
thread", "registrada na conversa", "IA nunca sozinha" (só envio por clique).

**Interfaces:**
- Consome: colunas da 073 (`thread_id`, `client_id`, `pendencia_id`, `team`) e
  status `respondido` da Task 1.
- Produz: requisição `{ email_id, text }` → resposta
  `{ success, to, threaded, registrado, id }`. Task 3 monta o invoke com exatamente
  esse corpo e lê `threaded` e `registrado`.

- [ ] **Step 1: escrever o teste falhando** `tests/caixa-responder.test.js`:
  - Estrutural (estilo `tests/pendencia-responder.test.js`, lendo o index.ts):
    corpo da requisição só `email_id` e `text`; `destino` vem de `row.de`;
    fonte NÃO contém `supabaseAdmin` (RLS é a trava de equipe);
    `withSupabase({ auth: "user" })` + `from("operators")` + `unauthorized`;
    recusa linha fora de `pendente` com `already_handled`; `inReplyTo`/
    `references` = `message_id` e `threaded: !!refId`; insert com
    `status: "respondido"`, `email_id: info.messageId` e `team: row.team`;
    update das pendentes do thread para `"respondido"`.
  - Comportamental (harness `tests/helpers/edge-harness.js` +
    `fakeSupabase` com `operators` ativo e uma linha `emails_triagem` pendente
    do thread `t1`, `createTransport` devolvendo `messageId: 'id-de-teste'`,
    `createClient` embrulhado para gravar chamadas de `from()`): com Bearer
    válido → 200, `success: true`, `threaded: true`; `sendMail` recebeu
    `inReplyTo: '<m1@acme.com.br>'` e `to: 'marcia@acme.com.br'`; gravou insert
    na `emails_triagem` com `status: 'respondido'` e `email_id: 'id-de-teste'`;
    e update com `{ status: 'respondido', ... }`.
- [ ] **Step 2: rodar e ver falhar**
  Run: `npx vitest run tests/caixa-responder.test.js`
  Expected: FAIL nos casos de `already_handled`, insert e update (o rascunho só
  envia).
- [ ] **Step 3: estender o index.ts** — além do que o rascunho já faz:
  - `select` da linha passa a incluir `thread_id, pendencia_id, client_id, team, status`;
  - `status !== "pendente"` → 422 `already_handled` (depois do 404, antes do envio);
  - depois do `sendMail` bem-sucedido: insert da linha-resposta com
    `id: crypto.randomUUID()`, `email_id`/`message_id` = `info.messageId`,
    `thread_id`, `de` = operador (`"<nome> <GMAIL_FROM>"`), `assunto` =
    `assuntoResposta(row.assunto)`, `corpo` = texto, `recebido_em` = agora,
    `motivo: null`, `status: "respondido"`, `pendencia_id`/`client_id`/`team` da
    linha de origem, `tratado_por`/`tratado_em`; e update das pendentes do
    thread (`eq("thread_id", row.thread_id).eq("status", "pendente")`; sem
    thread, `eq("id", row.id)`), mesmos `tratado_*` e `updated_at`;
  - `registrado: !insErr && !updErr` na resposta; falha de gravação é logada,
    nunca desfaz o envio (filosofia da `pendencia-responder`, invertida: o
    e-mail já saiu).
  - `config.toml`: `[functions.caixa-responder]` + `verify_jwt = true`.
  - `fake-supabase.js`: `insert: () => api` com comentário (fire-and-forget,
    como o `update`).
- [ ] **Step 4: rodar os guards e ver passar**
  Run: `npx vitest run tests/caixa-responder.test.js tests/edge-functions-auth.test.js tests/edge-functions-guard.test.js`
  Expected: PASS nos três.
- [ ] **Step 5: commit**
  `git add supabase/functions/caixa-responder supabase/config.toml tests/caixa-responder.test.js tests/helpers/fake-supabase.js tests/edge-functions-auth.test.js`
  `git commit -m "feat(caixa-responder): resposta no mesmo thread, registrada na conversa"`

### Task 3: ação Responder no `js/caixa-entrada.js`

**Files:**
- Modify: `js/caixa-entrada.js`
- Test: `tests/caixa-entrada.test.js`

**Covers:** review focus 1 (toast), 4; AC "ações por registerActions",
"escapeHtml", "resposta registrada na conversa" (lado app).

**Interfaces:**
- Consome: `{ email_id, text }` → `{ success, to, threaded, registrado }` da
  Task 2.
- Produz: `caixaResponder(id)` (abre modal) e `caixaResponderSalvar(id, texto):
  Promise<boolean>`; ações registradas `caixaResponder` e `caixaResponderSalvar`.

- [ ] **Step 1: escrever o teste falhando** (novos casos em
  `tests/caixa-entrada.test.js`; sandbox ganha `functions: { invoke }`
  gravável e `openModal` que registra título/html):
  - modal do Responder escapa assunto com `<img src=x onerror=alert(1)>`;
  - sem texto: `false`, toast de erro, `invoke` não chamado;
  - offline (`conectado = false`): `false`, toast de erro, `invoke` não chamado;
  - conversa sem pendente: `false`, toast "já foi tratada";
  - sucesso: `invoke` com `{ email_id: <id da pendente mais nova>, text }`,
    todas as pendentes do thread viram `respondido`, `tratadoPor` = usuário,
    `true`, toast de sucesso;
  - falha do servidor: continua `pendente`, `false`, toast de erro;
  - `threaded: false`: toast avisa "conversa nova";
  - `registrado: false`: toast de erro avisa que o registro falhou.
- [ ] **Step 2: rodar e ver falhar**
  Run: `npx vitest run tests/caixa-entrada.test.js`
  Expected: FAIL (ações inexistentes).
- [ ] **Step 3: implementar em `js/caixa-entrada.js`**
  - `CAIXA_STATUS` ganha `respondido: 'Respondido'`;
  - cabeçalho do arquivo: o parágrafo "Responder NÃO sai daqui ainda" vira
    "sai daqui, por humano, pela function caixa-responder; IA nunca sozinha";
  - `caixaResponder(id)`: modal `openModal('Responder ao cliente', ...)` com
    destino (`_emailTriagemEndereco` da pendente mais nova) visível, textarea
    `name="texto"`, aviso de que o e-mail sai na mesma conversa e de que a IA
    não responde no lugar de ninguém; form `data-submit="caixaResponderSalvar"`;
  - `caixaResponderSalvar(id, texto)`: valida texto, conexão
    (`isSupabaseConnected() && window._supabaseAuthActive`) e pendente (mesmo
    critério de `caixaAbrirChamado`); `await supabaseClient.functions.invoke('caixa-responder', { body: { email_id: alvo.id, text } })`;
    sucesso → `_caixaSalvarConversa(c, { status: 'respondido' }, true)` +
    `_emailTriagemRedesenhar()` + toast (com aviso de conversa nova se
    `threaded === false`; com aviso de erro se `registrado === false`);
    falha → toast de erro e `false` (nada muda local);
  - ações em `registerActions`: `caixaResponder` e `caixaResponderSalvar`
    (lê `FormData`, `await`, `closeModal()` só no `true`);
  - `_caixaConversaHTML`: mensagem com `status === 'respondido'` ganha selo de
    texto `✉ resposta enviada` no header (escapeHtml no que for variável).
- [ ] **Step 4: rodar e ver passar**
  Run: `npx vitest run tests/caixa-entrada.test.js`
  Expected: PASS (novos + existentes).
- [ ] **Step 5: commit**
  `git add js/caixa-entrada.js tests/caixa-entrada.test.js`
  `git commit -m "feat(caixa): ação Responder na caixa de entrada"`

### Task 4: documentação

**Files:**
- Modify: `README.md` (seção "Edge Functions", linha ~85, se listar as functions)
- Modify: `GOOGLE-AGENDA.md` (depois do bloco "### Responder ao cliente pela
  tela (migration 064)", novo "### Responder direto da Caixa de entrada
  (migration 074)")

- [ ] **Step 1: GOOGLE-AGENDA.md** — parágrafo curto: botão **Responder** na
  `#caixa`, function `caixa-responder`, mesma conversa pelo `message_id`,
  resposta vira linha `respondido` e dispara as pendentes do thread, IA fora do
  caminho, deploy `supabase functions deploy caixa-responder`, exige a 074.
- [ ] **Step 2: README.md** — incluir `caixa-responder` na lista de functions
  (se houver lista).
- [ ] **Step 3: commit**
  `git add README.md GOOGLE-AGENDA.md`
  `git commit -m "docs(caixa): documenta o Responder e a migration 074"`

### Task 5: gates finais + PR

- [ ] **Step 1:** `npm test` → verde completo.
- [ ] **Step 2:** `npm run lint` → verde (0 warnings).
- [ ] **Step 3:** `node tools/build-assets.js --check` → verde.
- [ ] **Step 4:** `git push -u origin feat/caixa-responder`.
- [ ] **Step 5:** `gh pr create --base main` com título
  `feat(caixa): responder da caixa de entrada` e corpo pt-BR: o que muda, a
  074 (como verificar/reverter), deploy da function, e que a IA continua fora
  do envio.
