# Caixa de entrada única — design

Data: 29/10/2026. Status: **aprovado em 29/10/2026**.

## Intent

Hoje `emails_triagem` (066) guarda só o que **não** virou chamado: sem cliente,
ignorado pela IA, resposta automática. O resto da label `Pendências` some do app
depois da triagem — o chamado aberto existe, a nota no chamado existe, mas não há
um lugar onde se veja "tudo que chegou por e-mail hoje" e quem está cuidando.

Decisão de 29/10/2026 (memória `sistema-de-chamados`): toda mensagem da label vira
linha, numa caixa estilo Octadesk — lista à esquerda, conversa à direita. A
triagem automática continua abrindo chamado; a caixa é o registro e o lugar de
decidir o que sobrou.

Sucesso: toda mensagem externa que o robô processa aparece na caixa com o
caminho que tomou (virou chamado, nota em chamado aberto, pendente de decisão); a
pessoa atribui, vincula cliente, abre chamado ou descarta sem sair da tela; nada
some em silêncio.

## Goals, non-goals, anti-goals

**Goals**

- Migration 073 evolui `emails_triagem`: aceita linha já resolvida, ganha
  `client_id`, `atribuido_a` e o estado `anexado` (nota em chamado aberto).
- O robô grava uma linha por mensagem externa em **todos** os caminhos da
  triagem, não só nos de sobra.
- Tela própria "Caixa de entrada": lista agrupada por conversa (`thread_id`),
  conversa e chamado vinculado à direita, filtro pendentes / todas.
- Ações: atribuir, vincular cliente, abrir chamado, descartar.
- Vincular cliente sozinho (sem abrir chamado) ensina o remetente, como já
  acontece ao abrir chamado (`_emailTriagemAprender`, 072).

**Non-goals (deste PR)**

- **Responder** pela caixa sem chamado. Hoje resposta só sai por
  `pendencia-responder`, ligada a um chamado; responder solto pede nova rota de
  envio, rastreio de thread e permissão. Vai no PR seguinte. No primeiro PR,
  "responder" é: abrir o chamado vinculado e responder por ele.
- Mensagens internas (respostas da equipe na thread). Continuam fora, como hoje
  (`internos++`); a conversa do lado direito mostra o que veio de fora.
- Janela de sync. A tabela entra inteira no IndexedDB (`schema.js`, sem filtro de
  data). Com uma linha por e-mail o volume cresce; se pesar, o próximo passo é
  sincronizar só pendentes + últimos N dias.
- CSAT (ver "Conflito com a branch csat").

**Anti-goals**

- IA respondendo cliente sozinha.
- Transferir (reatribuir de uma pessoa para outra) sem nota de motivo.
- Linha duplicada para a mesma mensagem (o `UNIQUE (email_id)` continua sendo a
  trava).
- Ação na caixa que mexa em linha de outra equipe (RLS da 066 continua valendo;
  todo update leva o `id` e passa pela policy de team).

## Constraints

- Migration aplicada à mão, depois da 072, idempotente, com VERIFICAR e
  ROLLBACK. Sem a 073 o robô novo não pode quebrar a triagem: insert que falha
  por CHECK é logado e a mensagem segue o caminho dela (chamado/nota já foram
  gravados antes).
- Função `robo`: auth, `verify_jwt` e segredo ficam como estão; o guard de Edge
  Functions continua passando.
- `js/` em modo script: nomes novos com prefixo `caixa`/`_caixa` para não colidir
  com `emailTriagem*` que já existe.
- Ações por `registerActions`; todo dado do e-mail em `innerHTML` passa por
  `escapeHtml` (o `corpo` é texto de terceiro — é o maior risco de XSS do app).

## Approach

**A (escolhida): evoluir `emails_triagem`.** Já tem sync, realtime (067), RLS por
team e a tela que abre chamado a partir da linha. Basta afrouxar `motivo`,
somar estados e colunas.

- B (tabela nova `caixa_entrada`): duplicaria sync, realtime, policies e a
  migração dos dados da 066. Sem ganho.
- C (montar a caixa lendo `pendencias` + `emails_triagem`): mensagem que virou
  nota não tem linha própria em lugar nenhum; a lista não fecharia.

## Design

### 1. Migration 073 (`073_caixa_entrada.sql`)

- `motivo` passa a aceitar `NULL`: linha que virou chamado ou nota não tem
  "motivo de não ter virado". O CHECK continua (`sem_cliente`, `ignorado_ia`,
  `auto_resposta`) para valor não nulo.
- `status` ganha `anexado`: `pendente | virou_chamado | anexado | descartado`.
- `client_id TEXT` (sem FK, como o resto do app; nulo quando não casou).
- `atribuido_a TEXT` (id do operador) e `atribuido_em TIMESTAMPTZ`.
- `atribuicao_nota TEXT`: motivo da última transferência. O app exige quando
  `atribuido_a` muda de uma pessoa para outra; atribuir quem estava vazio não
  exige.
- Índice `(thread_id, recebido_em)` para agrupar a conversa.
- Dados da 066 ficam como estão (todos têm `motivo` preenchido).
- ROLLBACK: apagar linhas `anexado` e as com `motivo is null`, voltar os dois
  CHECK, `drop column` das quatro colunas.

### 2. Robô (`triagem()` em `robo/index.ts`, `campo.ts`)

`entradaNaoAproveitada` vira `entradaDaCaixa(e, { motivo, status, pendenciaId,
clientId, team }, id, agora)`; o nome antigo sai.

| Caminho na triagem | Linha gravada |
| --- | --- |
| Remetente interno | nenhuma (como hoje) |
| Resposta automática | `pendente`, motivo `auto_resposta`, client e team do cliente se casou |
| Thread com chamado aberto (nota) | `anexado`, `pendencia_id` do chamado, client e team do chamado |
| Sem cliente | `pendente`, motivo `sem_cliente`, team padrão |
| IA mandou ignorar | `pendente`, motivo `ignorado_ia`, client e team do cliente |
| Chamado aberto | `virou_chamado`, `pendencia_id` novo, client e team do cliente |

- A linha dos caminhos que já gravam chamado ou nota é gravada **depois** deles:
  se o insert falhar (073 não aplicada, CHECK), o chamado já existe e só se loga.
- `tratado_por` = `robo` nas linhas que nascem resolvidas, para a tela distinguir
  "o robô decidiu" de "alguém decidiu".
- O retorno da rodada ganha `caixa` (linhas gravadas) e `caixa_erros`; o painel
  de execuções (`robo_execucoes`, PR #67) mostra os dois.

### 3. Tela "Caixa de entrada" (`js/caixa-entrada.js`, novo)

- Rota `#caixa`, item no menu lateral e no "Mais" do mobile (`navigateTo`).
- **Lista (esquerda):** uma linha por `thread_id` (sem thread, a própria
  mensagem), ordenada pela mensagem mais nova. Mostra remetente, assunto, hora,
  selo do estado da última mensagem, cliente (ou "sem cliente") e responsável.
  Filtros: Pendentes (padrão) / Minhas / Todas; busca por remetente e assunto.
- **Conversa (direita):** as mensagens da thread em ordem, `corpo` como texto
  (`escapeHtml` + quebra de linha, nunca HTML do e-mail); acima, o chamado
  vinculado com link para o detalhe.
- **Ações** (na mensagem pendente; atribuir e vincular valem para a thread):
  - Atribuir: lista de operadores da equipe; trocar de pessoa abre campo de
    motivo obrigatório.
  - Vincular cliente: escolhe o cliente, grava `client_id` e `team` do cliente
    nas linhas da thread e chama `_emailTriagemAprender`.
  - Abrir chamado: reusa `emailTriagemAbrirChamado`, agora já com o cliente
    vinculado preenchido.
  - Descartar: reusa `emailTriagemDescartar` (com desfazer).
- Mobile: lista em tela cheia, conversa abre por cima com "voltar".
- `schema.js`: campos novos no mapa; `onChange` redesenha `#caixa` além de
  `#pendencias`.
- A seção recolhível na tela de Pendências fica, mostrando só as pendentes, com
  link "abrir caixa". Ela some num PR depois, se a caixa pegar.

### 4. Conflito com a branch csat

O worktree `Init-intra-csat` (`feat/csat-email`) partiu de f4cbd33, bem antes da
`main` atual. A `068_pendencias_csat.sql` dele:

- colide em número com `068_clients_drive_folder`;
- recria `emails_triagem_motivo_check` como `('sem_cliente', 'ignorado_ia',
  'pos_resolucao')`, **sem** `auto_resposta` (070). Aplicada depois da 070,
  quebra a gravação de resposta automática; depois da 073, também.

Este PR não mexe nela. Quando o CSAT voltar, a migration dele precisa ser
renumerada (074+) e somar `pos_resolucao` ao CHECK da 073 em vez de recriá-lo.

### 5. Testes

- `tests/robo-campo.test.js`: `entradaDaCaixa` para cada caminho da tabela
  (status, motivo nulo, client, team, `tratado_por`).
- `tests/robo-triagem.test.js` (ou o arquivo que já cobre `triagem`, com
  `fakeDb`): uma linha por caminho; interno sem linha; falha do insert da caixa
  não desfaz chamado nem nota.
- `tests/caixa-entrada.test.js`: agrupamento por thread; filtros; transferência
  sem motivo recusada e atribuição inicial aceita; vincular cliente grava o team
  do cliente e aprende o remetente; `corpo` com `<script>` sai escapado; update
  sempre por `id`.
- `tests/migrations-073.test.js` (texto da migration, CRLF normalizado):
  idempotente, CHECK de status com `anexado`, `motivo` sem `NOT NULL`, VERIFICAR
  e ROLLBACK presentes.

## Specification

### Acceptance criteria

- [ ] 1. 073 aplica duas vezes sem erro e o ROLLBACK desfaz.
- [ ] 2. Robô grava uma linha por mensagem externa, com o estado da tabela da
      seção 2.
- [ ] 3. Falha ao gravar a linha não desfaz chamado nem nota.
- [ ] 4. Tela `#caixa` lista por conversa, filtra e mostra a conversa escapada.
- [ ] 5. Atribuir exige motivo só na troca de pessoa.
- [ ] 6. Vincular cliente sem abrir chamado aprende o remetente.
- [ ] 7. Nenhuma resposta sai da caixa neste PR.
- [ ] 8. `npm test`, `npm run lint` e `node tools/build-assets.js --check` passam.

## Decisions

**Usuário (29/10/2026):** toda mensagem da label vira linha; lista à esquerda,
conversa à direita; triagem automática continua; ações atribuir, responder, abrir
chamado, vincular, descartar; evoluir `emails_triagem`; IA não responde cliente;
transferência exige nota.

**Agent's call (aprovado em 29/10/2026):**

- Responder fica para o PR seguinte; no primeiro, responde-se pelo chamado.
- Estado novo `anexado` para nota em chamado aberto, em vez de reusar
  `virou_chamado`.
- Atribuição é por thread, não por mensagem.
- A seção da caixa na tela de Pendências fica por enquanto.
- Sem janela de sync neste PR.

## Sources

- No repositório: `supabase/migrations/066_emails_triagem.sql`, `067`, `070`,
  `072`; `supabase/functions/robo/index.ts` (`triagem`, `guardarEntrada`);
  `supabase/functions/robo/campo.ts` (`entradaNaoAproveitada`);
  `js/emails-triagem.js`; `js/schema.js` (entrada `emails_triagem`).
