# Criação da pasta do Drive para cliente novo — design

Data: 27/10/2026. Status: **aguardando aprovação do usuário**.

## Intent

O robô noturno já preenche `drive_folder_url` a partir da planilha do cliente e
vigia as pastas vinculadas (PR #61). Sobra o cliente que nasce sem nada: sem
planilha e sem pasta. Hoje alguém precisa criar a pasta à mão e colar o link.
Este item faz o robô criar a pasta desse cliente na raiz compartilhada e gravar o
link — **só para cliente cadastrado depois do deploy**, porque o cliente antigo
pode já ter pasta no Drive sem vínculo e uma segunda pasta duplicaria.

Sucesso: cliente cadastrado hoje amanhece com `drive_folder_url` apontando para
uma pasta com o nome dele dentro da raiz; nenhum cliente antigo ganha pasta.

## Goals, non-goals, anti-goals

**Goals**

- Cliente novo (criado a partir de `PASTAS_CRIAR_DESDE`), sem pasta e sem
  planilha, ganha pasta na raiz `CLIENTES_ROOT_ID` e o link fica gravado.
- Rodar de novo não cria pasta repetida: reaproveita a pasta de mesmo nome.
- Robô antigo e função antiga continuam compatíveis entre si.

**Non-goals**

- Backfill de clientes antigos.
- Sanitizar nome, mover ou renomear pasta existente.
- Limpar pasta órfã automaticamente.
- Fila, retry imediato ou alerta no Chat.

**Anti-goals**

- Pasta duplicada para cliente antigo.
- Sobrescrever link que uma pessoa gravou.
- Service role no cliente ou mudança de auth da função.

## Constraints

- Sem migration: `clients` já tem `name` e `created_at`
  (`supabase/migrations/001_core_tables.sql`); `drive_folder_url` veio na 068/069.
- Auth da função `robo`, `verify_jwt` e `SYNC_SECRET` ficam como estão;
  `tests/edge-functions-guard.test.js` continua passando.
- Corte de data é constante no código (`PASTAS_CRIAR_DESDE`), não coluna nem
  config.
- O robô roda com a conta do Apps Script; essa conta precisa poder criar pasta no
  drive compartilhado.

## Approach

**A (escolhida): a Edge Function decide, o robô executa.** `planoPastas` devolve
`criar: [{client_id, nome}]`; o robô cria (ou reaproveita) e devolve o link em
`achados`, pelo mesmo caminho que já grava pasta vinda da planilha.

- B (robô decide): exigiria mandar `created_at` e a regra de corte para o Apps
  Script, duplicando regra de negócio fora do banco.
- C (app cria ao cadastrar): o navegador não tem credencial do Drive; exigiria
  OAuth no cliente ou nova Edge Function com conta de serviço.

## Design

### 1. Arquitetura

- O select de `planoDoBanco` passa a `"id, name, created_at, google_sheet_url,
  drive_folder_url"`.
- `planoPastas` ganha a lista `criar`. A resposta de `pastas` ganha
  `criar: plano.criar`; `Robo.gs` antigo ignora o campo.
- O robô lê a Script Property `CLIENTES_ROOT_ID`, abre a raiz, procura por nome
  (`getFoldersByName`, pulando `isTrashed()`), senão `createFolder`, e reporta o
  link em `achados`.
- `gravarResultadoPastas` aceita os ids de `criar`, sempre com
  `.is('drive_folder_url', null)`.
- Nenhuma migration, nenhuma ação nova.

### 2. Edge Function (`supabase/functions/robo/campo.ts` e `index.ts`)

- `ClientePasta` ganha `name?` e `created_at?`.
- Constante `PASTAS_CRIAR_DESDE` com a data ISO do deploy, comentada: "antes
  desta data o cliente pode já ter pasta no Drive sem vínculo; criar outra
  duplicaria."
- Cliente sem pasta:
  - planilha válida → `candidatos` (como hoje);
  - senão, se `google_sheet_url` vazio, `name.trim()` não vazio e
    `new Date(created_at) >= new Date(PASTAS_CRIAR_DESDE)` → `criar` com o nome
    aparado;
  - `created_at` nulo ou link de planilha inválido → fica de fora.
- Datas comparadas como `Date` (o banco devolve `+00:00`, a constante pode usar
  `-03:00` ou `Z`).
- Em `gravarResultadoPastas`, `cand` vira a união dos ids de `candidatos` e
  `criar`. O link de `getUrl()` passa por `driveFolderUrl`, que já normaliza
  para `https://drive.google.com/drive/folders/<id>`; nada muda ali.
- `index.ts`: cabeçalho da linha 20 vira `"pastas" → { candidatos, vigiar,
  criar }`.

### 3. Robô (`tools/google-agenda-apps-script/Robo.gs`)

- Terceiro laço em `roboPastas`, sobre `r.criar || []`.
- `CLIENTES_ROOT_ID` vazio: um erro só ("CLIENTES_ROOT_ID vazio: N cliente(s)
  sem pasta"), nada criado. Raiz inacessível (`getFolderById` lança): um erro só,
  pula `criar`.
- Por cliente, em try/catch: primeira pasta de `getFoldersByName(c.nome)` que não
  está na lixeira; senão `root.createFolder(c.nome)`;
  `achados.push({client_id, folder_url: f.getUrl()})`. Erro vira
  `erros.push(id + ': ' + msg)`.
- Linha de log ganha `| criadas: X | reusadas: Y`.
- `testarPastas` loga `| a criar: N` e os nomes, sem criar nada.
- Comentário ~333–334: sai "Só lê o Drive"; entra que o robô cria a pasta do
  cliente novo em `CLIENTES_ROOT_ID` (papel Colaborador).

### 4. Erros e degradação

| Falha | O que acontece |
| --- | --- |
| Raiz vazia ou inacessível | Um erro no log; nada criado; tenta na noite seguinte. |
| `createFolder` falha | Erro por cliente; tenta na noite seguinte. |
| Pasta criada, resultado não gravado | Na noite seguinte é reaproveitada pelo nome. Idempotente. |
| Pessoa gravou link no meio-tempo | `.is(null)` vence; fica uma pasta órfã inofensiva na raiz. |
| Cliente apagado ou id forjado | Contado em `ignorados`. |
| Banco sem a migration 069 | O fallback `sem069` grava só a URL. |
| Robô antigo ou função antiga | Compatíveis: campo novo é ignorado ou ausente (`r.criar || []`). |

### 5. Testes (`tests/robo-campo.test.js`, bloco das pastas, `fakeDb`)

- `planoPastas`: cliente novo vai para `criar` com nome aparado; corte de data
  inclusive na borda `Z` × `+00:00`; ficam fora de `criar` planilha válida (segue
  em `candidatos`), link de planilha inválido, nome vazio ou só espaços,
  `created_at` nulo, cliente que já tem pasta. O teste de plano existente não
  muda.
- `gravarResultadoPastas`: id de `criar` é gravado com status `ok`; link humano
  não é sobrescrito; id fora do plano é ignorado.
- Guardas estruturais (`fs.readFileSync` + `toContain`, como
  `tests/triagem-conversa.test.js`, com CRLF normalizado): `index.ts` seleciona
  `name, created_at` e responde `criar`; `Robo.gs` contém `CLIENTES_ROOT_ID`,
  `isTrashed()` e `r.criar || []`.
- Sem mock de `DriveApp`; a checagem real é `testarPastas`.

### 6. Documentação

- `GOOGLE-AGENDA.md` 365–369: "(leitura basta)" vira papel **Colaborador** no
  drive compartilhado; passo novo para a Script Property `CLIENTES_ROOT_ID` (o id
  é o trecho depois de `/folders/`), com a redação da linha 52 —
  "**Configurações do projeto** (engrenagem) → **Propriedades do script** →
  adicione:"; sem a propriedade nada é criado e o log avisa; rodar `testarPastas`
  antes da primeira noite; uma linha sobre o limite: só cliente cadastrado depois
  do deploy ganha pasta automática.
- README, AUDITORIA e a linha 8 de `Robo.gs` não mudam.

## Specification

### Inputs

| Input | Tipo | Obrigatório | Restrições | Padrão |
| --- | --- | --- | --- | --- |
| `clients.name` | text | sim | aparado; vazio não cria | — |
| `clients.created_at` | timestamptz | sim | nulo não cria; `>= PASTAS_CRIAR_DESDE` | — |
| `clients.google_sheet_url` | text | não | vazio para entrar em `criar` | null |
| `clients.drive_folder_url` | text | não | nulo para entrar em `criar` | null |
| `PASTAS_CRIAR_DESDE` | string ISO | sim | data do deploy | constante |
| `CLIENTES_ROOT_ID` | Script Property | sim para criar | id de pasta do drive compartilhado | vazio |

### Outputs

| Caso | Resultado |
| --- | --- |
| `pastas` | `{ candidatos, vigiar, criar: [{client_id, nome}] }` |
| Pasta criada ou reaproveitada | `achados` com `{client_id, folder_url}`; `drive_folder_url` gravado com status `ok` |
| Raiz ausente ou inacessível | Um erro no log; nada gravado |
| Falha por cliente | `erros` com `id: mensagem`; nada gravado para ele |

### Edge cases

| Caso | Comportamento esperado |
| --- | --- |
| `created_at` exatamente igual ao corte, em fuso diferente | Entra em `criar` |
| `created_at` antes do corte | Fora de `criar` |
| Nome com espaços nas pontas | Pasta com nome aparado |
| Nome vazio ou só espaços | Fora de `criar` |
| Link de planilha inválido | Fora de `candidatos` e de `criar` |
| Pasta de mesmo nome na lixeira | Ignorada; cria outra |
| Pasta de mesmo nome fora da lixeira | Reaproveitada |
| Dois clientes novos com o mesmo nome | Compartilham a pasta (limite aceito) |
| Link gravado por pessoa antes do resultado | Não sobrescrito |

### Acceptance criteria

- [ ] 1. Cliente novo sem pasta e sem planilha aparece em `criar` com nome aparado.
- [ ] 2. O corte de data é inclusivo e compara instantes, não strings (`Z` × `+00:00`).
- [ ] 3. Planilha válida, link inválido, nome vazio, `created_at` nulo e pasta já vinculada ficam fora de `criar`.
- [ ] 4. O teste de plano existente passa sem alteração.
- [ ] 5. `gravarResultadoPastas` grava id de `criar` com status `ok`.
- [ ] 6. Link humano não é sobrescrito e id fora do plano é ignorado.
- [ ] 7. `index.ts` seleciona `name, created_at` e responde `criar`.
- [ ] 8. `Robo.gs` contém `CLIENTES_ROOT_ID`, `isTrashed()` e `r.criar || []`.
- [ ] 9. `npm test`, `npm run lint` e `node tools/build-assets.js --check` passam.

### Out of scope

- Backfill de clientes antigos e de clientes com link de planilha inválido.
- Sanitizar nome, mover, renomear ou limpar pasta.
- Desambiguar clientes homônimos.
- Mock de `DriveApp` nos testes.

## Decisions

**Usuário (27/10/2026):** opção B do item 3 (só cliente novo); raiz é drive
compartilhado; pasta com só o nome do cliente; abordagem A; as 6 seções do
design aprovadas.

**Agent's call:**

- `PASTAS_CRIAR_DESDE` = dia do merge/deploy, 00:00 -03:00, fixado na
  implementação.
- Comparação de datas via `Date`, não string.
- Reaproveitar pasta pelo nome para ser idempotente.
- Sem limpeza de órfã e sem mock de `DriveApp`.
- Papel Colaborador basta para `createFolder` — **não verificado**; a checagem é
  o primeiro `roboNoite` depois de `testarPastas`.

## Sources

<!-- sources fetched 2026-10-27 -->

- `Folder.createFolder(name)` — https://developers.google.com/apps-script/reference/drive/folder#createFolder(String) (buscado em 27/10/2026)
- `Folder.getFoldersByName(name)` — https://developers.google.com/apps-script/reference/drive/folder#getFoldersByName(String) (buscado em 27/10/2026)
- `Folder.isTrashed()` — https://developers.google.com/apps-script/reference/drive/folder#isTrashed() (buscado em 27/10/2026)
- `DriveApp.getFolderById(id)` lança sem acesso — https://developers.google.com/apps-script/reference/drive/drive-app#getFolderById(String) (buscado em 27/10/2026)
- No repositório: `supabase/functions/robo/campo.ts` (`planoPastas`, `gravarResultadoPastas`), `supabase/functions/robo/index.ts` (`planoDoBanco`, `pastas`), `tools/google-agenda-apps-script/Robo.gs` (`roboPastas`, `testarPastas`, `pastaBackup_`), `docs/plans/2026-10-27-pasta-drive-robo-design.md`.
