# Pasta do Drive: backfill, homônimos e manutenção — design

Data: 29/10/2026. Status: **aguardando aprovação do usuário**.

## Intent

O PR #62 fez o robô criar a pasta do cliente novo, mas deixou quatro coisas fora
(`2026-10-27-pasta-drive-criar-design.md`, "Out of scope"): o cliente antigo, o
cliente homônimo, a manutenção da pasta já vinculada e o mock de `DriveApp`.
Este item fecha os quatro. A trava de data (`PASTAS_CRIAR_DESDE`) existia só
porque criar às cegas duplicaria pasta de cliente antigo; **procurar antes de
criar** remove esse risco, então a trava sai.

Sucesso: depois de uma noite, todo cliente com nome tem `drive_folder_url`, salvo
os casos ambíguos, que aparecem no log com nome e motivo; a pasta vinculada tem o
nome do cliente no Intra e mora em `CLIENTES_ROOT_ID`; nada é apagado.

## Goals, non-goals, anti-goals

**Goals**

- Cliente sem pasta e sem planilha válida (vazia **ou** inválida, como `/d/e/`),
  de qualquer data: o robô procura na raiz uma pasta com o nome esperado. Uma →
  vincula. Nenhuma → cria. Várias → só reporta.
- Nome de pasta saneado: sem `/` e `\`, espaços colapsados, tamanho limitado.
- Homônimos: quando o nome saneado se repete entre clientes, a pasta leva o CNPJ
  como sufixo — `Padaria Sol (12.345.678/0001-90)`.
- Pasta vinculada com nome diferente do esperado é renomeada.
- Pasta vinculada fora de `CLIENTES_ROOT_ID` é movida para lá.
- Pasta da raiz sem cliente vinculado é listada no log como órfã.
- `Robo.gs` testado com um `DriveApp` falso.

**Non-goals**

- Apagar, mover para a lixeira ou mesclar pasta — órfã e ambígua só são
  reportadas.
- Guardar órfãs e ambíguas no banco ou mostrar no app (seria migration e tela;
  fica para depois se o log não bastar).
- Mover o conteúdo de uma pasta para outra.

**Anti-goals**

- Pasta duplicada para cliente que já tinha uma.
- Vincular a raiz, ou uma pasta compartilhada por vários clientes, como pasta de
  um cliente só.
- Mover ou renomear pasta que serve a mais de um cliente.
- Sobrescrever link que uma pessoa gravou.

## Constraints

- Sem migration: `clients.cnpj` já existe (`001_core_tables.sql:10`, default
  `''`); status e data da checagem vieram na 069.
- Auth da função `robo`, `verify_jwt` e `SYNC_SECRET` ficam como estão.
- Apps Script tem limite de 6 minutos por execução; listar a raiz é uma chamada
  por pasta filha, aceitável para algumas centenas de clientes.
- `Robo.gs` é colado à mão no editor do Apps Script, então o deploy da função e
  o do robô não chegam juntos (ver compatibilidade).

## Approach

**A (escolhida): a Edge Function calcula o nome esperado, o robô executa.**
Saneamento e sufixo de homônimo são regra de negócio e precisam da lista inteira
de clientes, que só a função tem. O robô recebe `nome` pronto em `buscar` e em
`vigiar`, procura, cria, renomeia, move e devolve o que fez.

- B (robô calcula o nome): exigiria mandar CNPJ e a lista de nomes ao Apps
  Script e duplicar o saneamento em `.gs` e `.ts`.
- C (coluna `drive_folder_name` no banco): migration para guardar o que se
  deriva de `name` + `cnpj`; sem ganho.

## Design

### 1. Nome esperado (`campo.ts`)

- `nomeDaPasta(nome)`: troca `/` e `\` por `-`, colapsa espaços, apara, corta em
  `NOME_PASTA_MAX = 100` caracteres. Vazio continua vazio.
- Homônimo: conta os nomes saneados em minúsculas sobre **todos** os clientes
  (a raiz é uma só para todas as equipes). Repetido → `base + " (" + cnpj + ")"`;
  sem CNPJ, usa os 8 primeiros caracteres do `id`. O corte de 100 vale para a
  base, para o sufixo caber inteiro.
- O select de `planoDoBanco` ganha `cnpj` e perde `created_at`.

### 2. Plano (`planoPastas`)

| Cliente | Lista |
| --- | --- |
| Link de pasta válido | `vigiar: {client_id, folder_id, nome, compartilhada}` |
| Link de pasta inválido | `invalidos` (como hoje) |
| Sem pasta, planilha válida | `candidatos` (como hoje) |
| Sem pasta, sem planilha válida, nome não vazio | `buscar: {client_id, nome}` |
| Sem pasta, nome vazio | fora |

- `compartilhada = true` quando o mesmo `folder_id` aparece em mais de um
  cliente. O robô não move nem renomeia essas.
- `PASTAS_CRIAR_DESDE` e a lista `criar` saem. `gravarResultadoPastas` aceita os
  ids de `candidatos` e `buscar`, sempre com `.is('drive_folder_url', null)`.
- A resposta de `pastas` vira `{ candidatos, vigiar, buscar }`.

### 3. Robô (`roboPastas` em `Robo.gs`)

Raiz (`CLIENTES_ROOT_ID`) vazia ou inacessível: um erro só e pula `buscar`, a
movimentação e as órfãs; `candidatos` e o teste de `vigiar` seguem.

- **buscar** — pastas não lixeira de `root.getFoldersByName(nome)`: uma → `achados`
  (`reusadas++`); nenhuma → `createFolder(nome)` (`criadas++`); várias →
  `ambiguas.push(nome + ': N pastas')`, nada vinculado.
- **candidatos** — como hoje, mas se o pai da planilha **é a própria raiz**, o
  cliente não é vinculado a ela: cai em `ambiguas` com o motivo "planilha solta na
  raiz". (Hoje esse caso vincularia a raiz inteira como pasta do cliente.)
- **vigiar** — testa como hoje. Se acessível e `!compartilhada`:
  - `getName() !== nome` → `setName(nome)`, `renomeadas++`;
  - nenhum pai é a raiz → `moveTo(root)`, `movidas++`.
  Falha de rename ou move vira `erros`, sem mudar o status `ok`.
- **órfãs** — `root.getFolders()`, não lixeira, cujo id não está em `vigiar` nem
  nos `achados` desta noite → `orfas` (nomes).
- O log ganha `| renomeadas | movidas | ambíguas | órfãs`, e as listas de
  ambíguas e órfãs saem em linhas próprias (até 50 nomes cada).
- `pastas-resultado` recebe também `ambiguas` e `orfas`; a função só loga
  (`console.warn`, até 20), como já faz com `erros`.
- `testarPastas` loga o que faria (a buscar, a renomear, a mover) sem escrever
  nada no Drive.

### 4. Compatibilidade entre deploys

| Função | Robô | O que acontece |
| --- | --- | --- |
| nova | antigo | Robô lê `r.criar || []` → vazio: nada é criado até colar o `Robo.gs` novo. `vigiar` com campos a mais é ignorado. Seguro. |
| antiga | novo | Robô lê `r.buscar || []` → vazio; `v.nome` ausente → não renomeia; sem `compartilhada` → não move (exige `nome` presente para mexer). Seguro. |

### 5. Erros e degradação

| Falha | O que acontece |
| --- | --- |
| Raiz vazia ou inacessível | Um erro; nada criado, movido nem listado. |
| `createFolder`, `setName` ou `moveTo` falha | Erro por cliente; tenta na noite seguinte. |
| Pasta criada, resultado não gravado | Reaproveitada pelo nome na noite seguinte. |
| Pasta no Meu Drive de alguém, sem permissão de mover | Erro por cliente; continua vinculada. |
| Pessoa renomeia a pasta no Drive | Volta ao nome do Intra na noite seguinte (o Intra manda). |
| Cliente muda de nome e vira homônimo | Pasta ganha o sufixo no rename. |

### 6. Testes

- `tests/robo-campo.test.js` (`fakeDb`): `nomeDaPasta` (barras, espaços, corte,
  vazio); sufixo só em homônimo, comparando sem caixa, CNPJ ou id curto; corte
  preserva o sufixo; `buscar` recebe cliente antigo e link de planilha inválido;
  `compartilhada` marcada; `gravarResultadoPastas` aceita id de `buscar` e
  ignora id fora do plano.
- `tests/robo-pastas-drive.test.js` (novo) com `tests/_driveapp.cjs`: carrega
  `Robo.gs` num `vm` com `DriveApp`, `PropertiesService`, `Logger` e
  `roboChamar_` falsos. Casos: uma pasta → vincula; nenhuma → cria; várias →
  ambígua; lixeira ignorada; planilha solta na raiz não vincula a raiz; rename;
  move; compartilhada intocada; órfã listada; raiz vazia; plano antigo sem
  `nome` não renomeia nem move.
- O guard de Edge Functions continua passando.

### 7. Documentação

- `GOOGLE-AGENDA.md`, seção das pastas: o robô agora procura antes de criar,
  renomeia, move para a raiz e lista órfãs e ambíguas no log; nunca apaga. Papel
  na raiz: **Gerente de conteúdo** (mover exige mais que Colaborador).
- README: linha do robô noturno cita a manutenção das pastas.

## Specification

### Inputs

| Input | Tipo | Restrições |
| --- | --- | --- |
| `clients.name` | text | saneado; vazio não entra em `buscar` |
| `clients.cnpj` | text | sufixo só em homônimo; vazio usa id curto |
| `clients.google_sheet_url` | text | inválido equivale a vazio para `buscar` |
| `clients.drive_folder_url` | text | nulo para `buscar`; válido para `vigiar` |
| `CLIENTES_ROOT_ID` | Script Property | obrigatório para buscar, mover e órfãs |

### Outputs

| Caso | Resultado |
| --- | --- |
| `pastas` | `{ candidatos, vigiar: [{client_id, folder_id, nome, compartilhada}], buscar: [{client_id, nome}] }` |
| Uma pasta ou pasta criada | `drive_folder_url` gravado, status `ok` |
| Várias pastas | Nada gravado; nome em `ambiguas` |
| Rename ou move | Nada muda no banco (o id da pasta é o mesmo) |
| Órfã | Nome no log; nada muda |

### Edge cases

| Caso | Comportamento |
| --- | --- |
| Nome `A/B  C` | Pasta `A-B C` |
| Nome com 300 caracteres e homônimo | Base cortada em 100, sufixo inteiro |
| Dois clientes `Padaria Sol` e `padaria sol` | Ambos com sufixo |
| Homônimo sem CNPJ | Sufixo com 8 caracteres do id |
| Pasta antiga sem sufixo, cliente vira homônimo | Renomeada com sufixo |
| Pasta linkada por dois clientes | Testada, nunca renomeada nem movida |
| Planilha direto na raiz | Não vincula a raiz; vai para `ambiguas` |
| Pasta de mesmo nome só na lixeira | Ignorada; cria outra |

### Acceptance criteria

- [ ] 1. `nomeDaPasta` troca barras, colapsa espaços, apara e corta em 100.
- [ ] 2. Sufixo só para homônimo, sem diferenciar caixa; CNPJ ou id curto.
- [ ] 3. Cliente antigo e cliente com link de planilha inválido entram em `buscar`.
- [ ] 4. `vigiar` traz `nome` e `compartilhada`; `PASTAS_CRIAR_DESDE` sai.
- [ ] 5. Robô vincula uma, cria nenhuma, reporta várias, ignora lixeira.
- [ ] 6. Planilha solta na raiz não vincula a raiz.
- [ ] 7. Robô renomeia e move só pasta não compartilhada e só com `nome` presente.
- [ ] 8. Órfãs da raiz saem no log; nada é apagado.
- [ ] 9. Testes do robô rodam com `DriveApp` falso.
- [ ] 10. `npm test`, `npm run lint` e `node tools/build-assets.js --check` passam.

## Decisions

**Usuário (29/10/2026):** os quatro itens; backfill procura antes de criar (uma →
vincula, nenhuma → cria, várias → reporta); link de planilha inválido segue o
mesmo caminho; homônimo com sufixo de CNPJ só quando o nome repete; manutenção
completa (sanear, renomear, mover, órfãs reportadas sem apagar); mock de
`DriveApp`.

**Agent's call:**

- `PASTAS_CRIAR_DESDE` sai: a busca prévia resolve o risco que ela cobria.
- Sufixo é o CNPJ (o app não tem código de cliente); sem CNPJ, 8 caracteres do id.
- Homônimo conta sobre todos os clientes, não por equipe, porque a raiz é única.
- `NOME_PASTA_MAX = 100`.
- Pasta compartilhada por vários clientes não é movida nem renomeada.
- Planilha solta na raiz não vincula a raiz (bug latente do PR #61).
- Órfãs e ambíguas só no log, sem migration.
- Papel **Gerente de conteúdo** para mover — **não verificado**; a checagem é o
  primeiro `roboNoite` depois de `testarPastas`.

## Sources

- `Folder.moveTo(destination)` — https://developers.google.com/apps-script/reference/drive/folder#moveTo(Folder)
- `Folder.setName(name)` — https://developers.google.com/apps-script/reference/drive/folder#setName(String)
- `Folder.getFolders()` — https://developers.google.com/apps-script/reference/drive/folder#getFolders()
- No repositório: `supabase/functions/robo/campo.ts` (`planoPastas`, `gravarResultadoPastas`), `supabase/functions/robo/index.ts` (`planoDoBanco`), `tools/google-agenda-apps-script/Robo.gs` (`roboPastas`), `docs/plans/2026-10-27-pasta-drive-criar-design.md`.
