# Design: pasta do Drive — preenchimento e vigilância pelo robô

Data: 27/10/2026. Status: **aguardando aprovação do usuário**.

## Intent

O Intra passou a guardar o endereço da pasta do Drive do cliente
(`clients.drive_folder_url`, PR #58/#59), mas o preenchimento é manual — quem
cadastrou que vincular — e um link errado (ID colado de forma que o parser
flexível aceita, pasta apagada, robô sem acesso) fica invisível até alguém
clicar. Este desenho faz o robô Apps Script (que já existe, já tem Drive e já
fala com a Edge Function `robo` por secret) fazer as duas pontas: **preencher**
a pasta a partir da planilha de documentação que já está vinculada e
**vigiar** os links preenchidos, com um selo silencioso na ficha.

Sucesso: cliente com planilha vinculada e sem pasta ganha `drive_folder_url`
sem ninguém tocar em nada; link quebrado aparece como ⚠️ na ficha no máximo
um dia depois de quebrar, sem pendência, sem notificação.

Escopo aprovado pelo usuário (27/10/2026): **só os itens 1 e 2** da lista de
automações — criação de pasta, conteúdo da pasta e organização/higiene ficam
fora.

## Goals, non-goals, anti-goals

**Goals**

- Preencher `drive_folder_url` de quem tem `google_sheet_url` e não tem pasta,
  deterministicamente (pasta pai da planilha), 1×/dia, sem sobrescrever
  vínculo humano.
- Testar cada `drive_folder_url` existente contra o Drive e gravar
  `drive_folder_status` + `drive_folder_checked_at`.
- Selo na ficha: ok / inacessível / inválido / sem selo. Silencioso — nada de
  pendência nova.

**Non-goals (fora, de propósito)**

- Procurar pasta por nome de cliente (chute pode vincular pasta de outro).
- Criar pastas, mover/renomear/arquivar arquivos, copiar para backup.
- Listar conteúdo da pasta, entrar no "Seu dia" ou no briefing com IA.
- Auditoria de quem tem acesso à pasta.
- Backstop de admin no servidor para o vínculo feito pelo usuário (adiado no
  PR #59, segue adiado — o caminho do robô aqui é servidor-por-secret, não é
  esse backstop).

**Anti-goals (falha mesmo que funcione)**

- Uma única escrita do robô por cima de um vínculo feito à mão.
- O app empurrar (push) as colunas de status e desfazer a gravação do robô.
- Pendência, e-mail ou toast aberto por link quebrado.
- Rodada de madrugada morrendo por um cliente com URL ruim.

## Constraints

- `js/` é modo script, escopo global único; XSS passa por `escapeHtml`; sem
  handler inline (`AGENTS.md`).
- Pré-requisito duro: **migration `068_clients_drive_folder.sql` aplicada**
  (coluna existe só no banco depois). A **069 está livre em todas as
  branches** (checado em 27/10/2026). Branch `feat/csat-email` está inativa
  (usuário, 27/10/2026): quando retomar, a `068_pendencias_csat.sql` dela vai
  para **070** — renumerar é de quem retomar.
- Padrão do projeto: Apps Script → Edge Function com `x-agenda-secret`
  (`Robo.gs:roboChamar_`), regra no servidor (`supabase/functions/robo`),
  gatilhos no `instalarRobo`. Sem secret novo, sem Edge Function nova.
- Orçamento: 6 h/dia de execução por gatilho do Workspace
  (`GOOGLE-AGENDA.md` §Limites) — duas chamadas HTTP e N leituras de Drive por
  madrugada é folga.
- `sync: true` + `realtime: true` em `clients`; `fields` do `schema.js` vale
  para push **e** pull (`_mapToRemote`/`_mapFromRemote`) — coluna fora de
  `fields` nunca é puxada nem empurrada.

## Approach

**A escolhida: ações novas dentro da Edge Function `robo`, rodando no
`roboNoite` existente.** Um `roboPastas()` novo no `Robo.gs`, chamado pelo
`roboNoite`, sem gatilho próprio. Rejeitadas: **B** (Edge Function dedicada —
mais deploy e segredo, contra a doc "a regra fica na `robo`") e **C** (gatilho
próprio a cada X h — cadência diária basta; dá para adicionar depois com duas
linhas se incomodar).

## Design

### Fluxo (ida e volta única, duas chamadas na mesma execução)

```
roboNoite (2h, gatilho existente)
  └─ roboPastas()                                    Robo.gs (novo)
       ├─ POST {action:'pastas'}                     ──► robo: monta o plano
       │    ◄── { candidatos:[{client_id, sheet_url}],
       │          vigiar:[{client_id, folder_id}] }
       │       (a robo já tratou URL inválida de vigiar:
       │        grava status='invalido' + checked_at na hora)
       ├─ Drive: por candidato, getFileById(sheet) → getParents() →
       │  primeira pasta não-lixeira → URL canônica; por vigilado,
       │  getFolderById(id) em try/catch + isTrashed()
       └─ POST {action:'pastas-resultado',
                achados, testes, erros}              ──► robo: grava
            ◄── { gravados, atualizados }
```

- **Fase plano** (`'pastas'`, sem corpo): a `robo` consulta `clients` —
  `candidatos` = `google_sheet_url` preenchido **e** `drive_folder_url` nulo;
  `vigiar` = `drive_folder_url` preenchido, com o ID já extraído e validado
  pelo parser de servidor. URL guardada que não parseia → `status='invalido'`
  + `checked_at` na própria fase plano, não vai ao Google.
- **Parser de servidor = espelho exato do `parseDriveFolderId` de
  `origin/main`** (pós-PR #59: canônica, sem esquema, host em maiúsculas,
  `/u/<n>/`, `open?id=` e ID cru ≥15, com a mesma recusa de aspa/espaço —
  guarda SEC-18). O app só grava valor canônico, então o ID cru só aparece se
  o banco foi editado à mão — e nesse caso quem julga é o `getFolderById`
  (devolve `inacessível`, não finge `ok`). A adesão ao conjunto flexível é a
  ruling "parser flexível" do usuário (27/10/2026) levada ao servidor.
- **Robô**: só fala com o Google (padrão da casa). Erro por item vira linha em
  `erros` (`{client_id, fase, detalhe}`) e não derruba a rodada. Pasta na
  lixeira conta como inacessível (`Folder.isTrashed()`, já usado em
  `pastaBackup_`).
- **Fase gravação** (`'pastas-resultado'`): servidor valida de novo
  (parser + `client_id` tinha de estar na lista enviada — defesa em
  profundidade, mesmo com secret), grava:
  - achado: `update {drive_folder_url, status:'ok', checked_at}
    .eq('id', x).is('drive_folder_url', null)` — **o `.is(..., null)` é a
    trava que impede sobrescrever vínculo humano** (corrida com quem vincula
    às 2h);
  - teste: `update {status, checked_at}` agrupado por status (`ok` /
    `inacessível`), para todos os vigilados — a cada madrugada sobrescreve o
    eco antigo de sync, se houver;
  - `client_id` desconhecido ou erro de banco (069 ausente) → loga e segue.

### Colunas novas — migration `069_clients_drive_folder_status.sql`

```sql
alter table public.clients add column if not exists drive_folder_status text;
alter table public.clients add column if not exists drive_folder_checked_at timestamptz;
```

Idempotente, sem policy nova (viaja no registro do cliente, já restrito por
equipe). Valores: `'ok' | 'inacessivel' | 'invalido' | null`
(`null` = nunca verificada). **Não entram em `schema.js:fields`** — de propósito:
`fields` é bidirecional e o push do app ecoaria valor velho por cima do robô
(classe SYNC-06/07). Consequência aceita: o app não as sincroniza; a ficha lê
por **query direta no render** (padrão `cliente-saude.js`), com `try/catch` —
offline o selo simplesmente não aparece (sem mentira).

### Selo na ficha

Em `renderClientDriveSection` (`js/clients-form.js`), depois do botão "📁
Abrir pasta", em `#cliDriveActions`:

| `drive_folder_status` | Mostra |
| --- | --- |
| nula / sem `drive_folder_url` | nada (o botão já some sem URL) |
| `'ok'` | ✅ "verificada em dd/mm" (da `checked_at`) |
| `'inacessivel'` | ⚠️ "pasta apagada ou sem acesso para o robô" |
| `'invalido'` | ⚠️ "link não é uma pasta do Drive" |

Texto visível por `escapeHtml`; sem atributo novo com dado cru. Erro da query
→ sem selo. Qualquer um que vê o cliente vê o selo (escopo de equipe, mesma
regra da coluna).

### Erros e degradação

- Item ruim no Drive → `erros` no retorno → linha no log do Apps Script
  (padrão `sem_cliente` da triagem); rodada segue.
- Robô fora do ar / secret errado → `roboChamar_` lança → `roboNoite` junta
  no erro único das Execuções (comportamento de hoje).
- Banco sem a 069 → a fase de gravação pega o erro de coluna — SQLSTATE
  **`42703`** (`undefined_column`) com o nome da coluna na mensagem —, loga
  "aplique a 069_clients_drive_folder_status.sql" e não derruba a madrugada
  (mesmo tom do "Banco sem a 066 não quebra nada"). Outro código de erro NÃO
  é mascarado: vira erro das Execuções, como os demais.

### Testes

- `campo.ts` (funções puras novas, vitest): parser de URL de pasta no servidor
  (espelho do `js/clients-form.js`, inclusive recusa de aspa/espaço — guarda
  SEC-18); montagem do plano (só entra quem tem planilha e não tem pasta; só
  entra em `vigiar` quem tem pasta; URL inválida vira `invalido`); gravação
  condicional (`.is null` presente; `client_id` fora do plano é ignorado);
  mapeamento de status (`ok` / `inacessível` / lixeira).
- `Robo.gs`: sem teste automatizado (padrão do repositório) + **`testarPastas()`**
  manual, imprime plano e resultados no log (espelho do `testarResumo`).
- Portões do CI como sempre: `npm test`, `npm run lint`,
  `node tools/build-assets.js --check`.

### Instalação (novo trecho no GOOGLE-AGENDA.md)

1. Aplicar no SQL Editor: `068_clients_drive_folder.sql` (se ainda não) e
   `069_clients_drive_folder_status.sql`.
2. Compartilhar a **raiz única** das pastas de clientes com a conta do robô
   (acesso de leitura/editor, como preferirem — leitura basta para os dois
   fluxos).
3. Colar o `Robo.gs` atualizado no projeto do Apps Script → rodar
   `instalarRobo`.
4. `supabase functions deploy robo --no-verify-jwt` (secret novo: nenhum).

## Specification

### Inputs

| Input | Tipo | Obrigatório | Restrições | Padrão |
| --- | --- | --- | --- | --- |
| `action:'pastas'` (sem corpo) | POST + `x-agenda-secret` | — | — | devolve o plano |
| `action:'pastas-resultado', achados[]` | `{client_id, folder_url}` | — | `folder_url` revalidada no servidor; `client_id` tinha de estar em `candidatos` | ignorado se fora do plano |
| `... , testes[]` | `{client_id, status:'ok'\|'inacessivel'}` | — | idem, tinha de estar em `vigiar` | ignorado se fora do plano |
| `... , erros[]` | `{client_id, fase, detalhe}` | — | só log | — |

### Outputs

| Caso | Resultado |
| --- | --- |
| fase plano | `{ candidatos:[...], vigiar:[...] }` (vazios é caso normal) |
| fase gravação | `{ gravados:n, atualizados:n }` |
| URL guardada de `vigiar` não parseia | `status='invalido'` + `checked_at`, sem ida ao Google |
| Drive: existe, fora da lixeira | `status='ok'` |
| Drive: apagada, lixeira ou sem acesso | `status='inacessivel'` (o Drive não distingue os três — ver Sources) |
| banco sem 069 | log de instrução, `gravados/atualizados=0`, exito da rodada preservado |

### Edge cases

| Caso | Comportamento esperado |
| --- | --- |
| Planilha sem pai (Minha unidade de alguém) | `erros` com `fase:'sem-pasta'`, sem gravação |
| Planilha com vários pais (herança) | primeiro pai não-lixeira |
| Planilha apagada/inacessível para o robô | `erros` com `fase:'planilha'` |
| Raiz não compartilhada com o robô | todos os itens em `erros`, log dirá — instalação incompleta |
| Cliente ganha vínculo humano entre plano e gravação | `.is('drive_folder_url', null)` não sobrescreve |
| `candidatos` e `vigiar` vazios | robô nem chama a fase de gravação |
| Robô devolve `client_id` que não foi enviado | ignorado e logado |
| Sync do app ecoar status velho | próxima madrugada o `testes` sobrescreve todos |
| URL com aspa/espaço logo após o ID (`...<ID>"onmouseover`) | parser de servidor recusa → `invalido` (SEC-18); na `?query` é aceita, pois a URL gravada é remontada só do ID |
| CRLF do arquivo de teste no Windows | teste de texto normaliza `\r\n` (`tests/rls-055.test.js`) |

### Acceptance criteria

- [x] 1. Parser de servidor: canônica, `?query`, `/u/0/` e `open?id=` aceitos;
      aspa, espaço, `/file/d/`, domínio estranho e ID de 14 chars recusados
      (espelho dos testes do app).
- [x] 2. Plano: cliente só entra em `candidatos` com planilha **e** sem pasta;
      só entra em `vigiar` com pasta; URL inválida de `vigiar` vira
      `invalido` sem ida ao Google.
- [x] 3. Gravação: achado leva `.is('drive_folder_url', null)` (teste prova
      que vínculo humano não é sobrescrito); `client_id` fora do plano é
      ignorado.
- [x] 4. Status: `ok` para achado e teste vivo; `inacessivel` para erro do
      Drive e lixeira; `invalido` para URL não-parseável; `checked_at`
      sempre preenchido em quem foi testado.
- [x] 5. Sem 069 (mock de erro de coluna): a função não lança, devolve log de
      instrução.
- [x] 6. Ficha: selo renderiza por status com `escapeHtml`; status nulo ou
      query falhando → sem selo; sem `drive_folder_url` → trecho inalterado.
- [x] 7. `schema.js` sem as colunas novas (nem `fields`, nem `optionalFields`)
      — teste de fonte quebra se alguém adicionar.
- [x] 8. Portões: `npm test` 0 falhas, `npm run lint` exit 0,
      `node tools/build-assets.js --check` exit 0.

### Out of scope

Itens 3, 4 e 5 da lista original (criação de pasta, conteúdo no
ficha/e-mail/briefing, organização/higiene); procura por nome; pendência por
link quebrado; backstop de admin do PR #59; renumeração da 068 do csat.

## Decisions

- **Usuário (27/10/2026):** escopo B (só itens 1+2); reação a link morto =
  selo na ficha, sem pendência; pastas sob **raiz única** compartilhada com o
  robô; abordagem A (na `robo`, no `roboNoite`); branch csat inativa — quem
  retomar renumbera para 070.
- **Agent's call:** sem procura por nome de cliente; sem gatilho novo (diário
  basta); duas chamadas HTTP na mesma execução (`pastas` + `pastas-resultado`)
  porque o robô não tem endpoint próprio; parser de servidor espelha o de
  `origin/main` (inclui `open?id=` e ID cru — leva ao servidor a ruling
  flexível do usuário; o builder-check apontou o conjunto e a fonte, ver
  abaixo); estado `inacessivel` funde "apagada" e "sem acesso" (o Drive não
  distingue, ver Sources) e inclui lixeira; colunas fora de
  `schema.js:fields` com leitura por query direta na ficha (offline = sem
  selo); teste de fonte que impede adicionar as colunas ao `fields`;
  detecção da 069 ausente por SQLSTATE `42703` + nome da coluna na mensagem
  (builder-check: outro erro de banco não pode ser mascarado).

## Sources

<!-- sources fetched 2026-10-27 -->

- `DriveApp.getFolderById(id)`: "Throws a scripting exception if the folder
  does not exist **or** the user does not have permission to access it" —
  https://developers.google.com/apps-script/reference/drive/drive-app
  (buscado em 27/10/2026). Daí a fusão apagada/sem-acesso num estado só.
- `File.getParents()`: "Gets a collection of folders that are immediate
  parents of the File" — https://developers.google.com/apps-script/reference/drive/file
  (buscado em 27/10/2026).
- `Folder.isTrashed()` já usado no repositório: `Robo.gs:319`.
- Padrão robô/Edge Function/secret: `GOOGLE-AGENDA.md`, `Robo.gs`,
  `supabase/functions/robo/index.ts` (lidos em 27/10/2026).
- `schema.js` `fields` bidirecional e `optionalFields`: `js/schema.js:17-28`,
  `_mapToRemote`/`_mapFromRemote` (`js/schema.js:359,366`),
  `js/sync-manager.js:115` (lidos em 27/10/2026).
- Numeração de migrations livre na 069: `git ls-tree` de `origin/main`,
  `feat/csat-email` e todas as branches (27/10/2026).
- Não verificado: quota de operações de `DriveApp` por dia (documentação de
  quotas não aberta) — a folga vem das 6 h/dia de gatilho documentadas em
  `GOOGLE-AGENDA.md`; se um dia faltar, o log de `erros` dirá.
