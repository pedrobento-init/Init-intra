# Pasta do Drive no cadastro do cliente — plano de implementação

> Para o agente executor: rode com godmode:inline-execution ou
> godmode:delegated-execution, tarefa por tarefa. Os passos têm caixas de marcação.

**Objetivo:** a ficha do cliente abre, em um clique, a pasta do Drive que já existe para ele.

**Desenho:** aprovado no chat em 27/10/2026 (opção B do `godmode:rationale`, forma de dado A).
Mudança pequena: não há documento `*-design.md`; este plano carrega a especificação.

**Arquitetura:** uma coluna de texto em `clients` guarda a URL canônica da pasta. Um parser puro
extrai o ID da pasta de qualquer forma colada e **remonta** a URL a partir do ID. A ficha mostra um
botão de abrir na aba Documentos, ao lado da planilha. Vincular e remover são restritos a admin.

**Stack:** JavaScript em modo script (sem `import`/`export`), Vitest 5.0.5, Supabase/Postgres.

## Restrições globais

- `js/` é **modo script**: 70 arquivos num escopo global único. Antes de criar nome global,
  conferir que não existe. Os nomes deste plano foram conferidos e hoje não aparecem em nenhum
  arquivo: `parseDriveFolderId`, `driveFolderUrl`, `_canManageClientDrive`, `saveDriveFolderLink`,
  `removeDriveFolderConfirm`, `openDriveFolderPrompt`, `renderClientDriveSection`.
- **Nada de handler inline.** `onclick` no markup é proibido pelo `AGENTS.md`. Usar `data-action`
  com ação registrada em `registerActions`. A seção da planilha usa `onclick` — é o padrão antigo,
  não copiar.
- **XSS:** dado colado pelo usuário nunca é interpolado em HTML. O que vai ao atributo `href` é
  sempre o retorno de `driveFolderUrl(id)`, remontado. Texto visível passa por `escapeHtml`.
- **RLS por equipe:** nenhuma query nova. O campo viaja no registro do cliente, que já é
  team-scoped.
- **CRLF:** teste que compara texto de arquivo normaliza `\r\n` (ver `tests/rls-055.test.js`).
- Comentários, descrições de teste e mensagens de commit em português do Brasil.

## Foco de revisão

Classes de entrada que a especificação implica e que nenhum teste das tarefas cobre sozinho;
cada uma fica presa à tarefa que tem o código.

1. URL de pasta com barra final (`/folders/<ID>/`) — deve vincular, não recusar. **Tarefa 1.**
2. URL com query (`?usp=drive_link`) — a query não entra no ID. **Tarefa 1.**
3. String com aspa dupla (`.../folders/abc" onmouseover=x`) — recusada; nada do colado chega ao HTML. **Tarefa 1.**
4. Cliente salvo antes da migration (campo ausente) — a ficha mostra o estado vazio, não quebra. **Tarefa 4.**
5. Banco sem a coluna 068 aplicada — o upsert de clientes continua funcionando (`optionalFields`). **Tarefa 2.**

## Fontes

- Formato de URL de pasta do Drive: observado no próprio produto. O plano **não** depende de
  tamanho nem de alfabeto exato do ID — a validação ancora no segmento `/folders/`.
- Precedente no repositório: `js/clients-form.js:555-700` (planilha por cliente),
  `tests/google-sheet-url.test.js`, `js/actions.js:1-20`.

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
| --- | --- | --- |
| `supabase/migrations/068_clients_drive_folder.sql` | criar | a coluna, com verificar/reverter no cabeçalho |
| `tests/drive-folder-url.test.js` | criar | parser, gate de admin, guarda de fonte |
| `js/clients-form.js` | modificar | parser, salvar, remover, render; export em `:923-929` |
| `js/schema.js` | modificar `:17-28` | mapa de sync + `optionalFields` |
| `js/app.js` | modificar `:389` | coluna no payload de upsert |
| `js/clients-ficha.js` | modificar `:746-778` | seção na aba Documentos |
| `js/clients.js` | modificar `:114-120` | registro das ações |
| `tests/schema.test.js` | modificar | o campo está mapeado e é opcional |

---

### Tarefa 1: parser puro

**Arquivos:**

- Criar: `tests/drive-folder-url.test.js`
- Modificar: `js/clients-form.js` (funções novas após a atual linha 578; export em `:923-929`)

**Cobre:** critérios de aceite 1, 2 e 3; foco de revisão 1, 2 e 3.

**Interfaces:**

- Produz: `parseDriveFolderId(v): string|null` e `driveFolderUrl(v): string` em
  `js/clients-form.js`. As tarefas 3 e 4 consomem as duas.

- [ ] **Passo 1: escrever o teste que falha**

```js
import { createRequire as __partsReq } from 'node:module';
const { requireParts, partsSource } = __partsReq(import.meta.url)('./_parts.cjs');
import { describe, it, expect, beforeEach } from 'vitest';

const ID = '1a2B3cD4eF5gH6iJ7kL8mN9oP0qR';
const BASE = 'https://drive.google.com/drive/folders/';

describe('parseDriveFolderId', () => {
  let mod;
  beforeEach(() => { mod = requireParts('clients'); });

  it('extrai o ID com query, com barra final e na forma /u/<n>/', () => {
    expect(mod.parseDriveFolderId(BASE + ID)).toBe(ID);
    expect(mod.parseDriveFolderId(BASE + ID + '?usp=drive_link')).toBe(ID);
    expect(mod.parseDriveFolderId(BASE + ID + '/')).toBe(ID);
    expect(mod.parseDriveFolderId('https://drive.google.com/drive/u/0/folders/' + ID)).toBe(ID);
  });

  it('aceita o ID colado cru', () => {
    expect(mod.parseDriveFolderId(ID)).toBe(ID);
  });

  it('recusa arquivo, planilha, outro domínio, vazio e nulo', () => {
    expect(mod.parseDriveFolderId('https://drive.google.com/file/d/' + ID + '/view')).toBeNull();
    expect(mod.parseDriveFolderId('https://docs.google.com/spreadsheets/d/' + ID + '/edit')).toBeNull();
    expect(mod.parseDriveFolderId('https://example.com/pasta')).toBeNull();
    expect(mod.parseDriveFolderId('')).toBeNull();
    expect(mod.parseDriveFolderId(null)).toBeNull();
    expect(mod.parseDriveFolderId(undefined)).toBeNull();
  });

  it('recusa entrada com aspa, sinal de menor ou espaço — o vetor do SEC-18', () => {
    expect(mod.parseDriveFolderId(BASE + ID + '" onmouseover=alert(1) x="')).toBeNull();
    expect(mod.parseDriveFolderId(BASE + '<script>')).toBeNull();
    expect(mod.parseDriveFolderId(ID + ' ' + ID)).toBeNull();
  });
});

describe('driveFolderUrl', () => {
  let mod;
  beforeEach(() => { mod = requireParts('clients'); });

  it('remonta a URL pelo ID e descarta o que foi colado', () => {
    expect(mod.driveFolderUrl('https://drive.google.com/drive/u/3/folders/' + ID + '?usp=sharing'))
      .toBe(BASE + ID);
  });

  it('devolve vazio quando inválido', () => {
    expect(mod.driveFolderUrl('https://example.com/x')).toBe('');
    expect(mod.driveFolderUrl('')).toBe('');
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Roda: `npx vitest run tests/drive-folder-url.test.js`

Esperado: FAIL — `mod.parseDriveFolderId is not a function`.

- [ ] **Passo 3: implementar as duas funções em `js/clients-form.js`**

Logo após `parseGoogleSheetId` (atual linha 578), no estilo das vizinhas: `function` declarada,
com um comentário de uma linha dizendo **por que** é pura e testável.

`parseDriveFolderId(v): string|null` — aceita `drive.google.com/drive/folders/<ID>`,
`drive.google.com/drive/u/<n>/folders/<ID>` (query e barra final opcionais) e o ID cru. O ID é um
token seguro para URL: `[a-zA-Z0-9_-]` com 15 caracteres ou mais, e nada além disso — é o que
recusa aspa, `<` e espaço. Sem suposição sobre o comprimento exato do ID do Google. Devolve `null`
em qualquer outro caso, incluindo `/file/d/` e `/spreadsheets/`.

`driveFolderUrl(v): string` — chama `parseDriveFolderId` e devolve
`https://drive.google.com/drive/folders/` seguido do ID, ou string vazia quando o parser dá `null`.
Nunca repassa a entrada.

- [ ] **Passo 4: exportar para o teste**

Em `js/clients-form.js:925`, acrescentar `parseDriveFolderId, driveFolderUrl` à lista do
`module.exports`, ao lado de `parseGoogleSheetId`.

- [ ] **Passo 5: rodar e ver passar**

Roda: `npx vitest run tests/drive-folder-url.test.js`

Esperado: PASS — 6 testes.

- [ ] **Passo 6: commitar**

```bash
git add js/clients-form.js tests/drive-folder-url.test.js
git commit -m "feat(cliente): parser da pasta do Drive remonta a URL pelo ID"
```

---

### Tarefa 2: coluna e sync

**Arquivos:**

- Criar: `supabase/migrations/068_clients_drive_folder.sql`
- Modificar: `js/schema.js:17-28`, `js/app.js:389`, `tests/schema.test.js`

**Cobre:** critério de aceite 6; foco de revisão 5.

- [ ] **Passo 1: escrever o teste que falha**

Em `tests/schema.test.js`, no estilo dos `it()` que já estão lá:

```js
it('clients mapeia drive_folder_url e o trata como coluna opcional', () => {
  const clients = ENTITIES.find((e) => e.table === 'clients');
  expect(clients.fields.drive_folder_url).toBe('driveFolderUrl');
  expect(clients.optionalFields).toContain('drive_folder_url');
});
```

- [ ] **Passo 2: rodar e ver falhar**

Roda: `npx vitest run tests/schema.test.js`

Esperado: FAIL — recebido `undefined`, esperado `'driveFolderUrl'`.

- [ ] **Passo 3: a migration**

`supabase/migrations/068_clients_drive_folder.sql`, com o cabeçalho das recentes (ver a `067`): o
que muda, por que, **VERIFICAR** e **REVERTER**. Idempotente.

Corpo: `alter table public.clients add column if not exists drive_folder_url text;`

VERIFICAR: consultar `information_schema.columns` por `table_name='clients'` e
`column_name='drive_folder_url'` — esperado 1 linha.

REVERTER: `alter table public.clients drop column if exists drive_folder_url;`

- [ ] **Passo 4: o mapa de sync**

Em `js/schema.js:22`, acrescentar `drive_folder_url: 'driveFolderUrl',` ao lado de
`google_sheet_url`. Em `optionalFields` (`:28`), acrescentar `'drive_folder_url'` — sem isso, um
banco sem a 068 aplicada derruba o sync de **todos** os clientes.

- [ ] **Passo 5: o payload de upsert**

Em `js/app.js:389`, acrescentar `drive_folder_url: c.driveFolderUrl || null,` ao lado de
`google_sheet_url`.

- [ ] **Passo 6: rodar a suíte inteira**

Roda: `npm test`

Esperado: PASS, 0 falhas; a contagem de arquivos sobe de 103 para 104.

- [ ] **Passo 7: commitar**

```bash
git add supabase/migrations/068_clients_drive_folder.sql js/schema.js js/app.js tests/schema.test.js
git commit -m "feat(cliente): coluna drive_folder_url entra no sync como opcional"
```

---

### Tarefa 3: vincular e remover, com gate de admin

**Arquivos:**

- Modificar: `js/clients-form.js` (após `renderClientSheetSection`, ou seja depois da atual linha 637); export em `:923-929`
- Modificar: `tests/drive-folder-url.test.js`

**Cobre:** critérios de aceite 4 e 5.

**Interfaces:**

- Consome: `parseDriveFolderId`, `driveFolderUrl` (Tarefa 1).
- Produz: `_canManageClientDrive(): boolean`,
  `saveDriveFolderLink(clientId, raw): { ok: boolean, error?: string }` e
  `removeDriveFolderConfirm(clientId): void`. A Tarefa 4 chama as três.

- [ ] **Passo 1: escrever o teste que falha**

```js
describe('saveDriveFolderLink', () => {
  let mod;
  beforeEach(() => {
    mod = requireParts('clients');
    global.getClientById = () => ({ id: 'cli-1', name: 'ACME' });
  });

  it('recusa quem não é admin', () => {
    global.isCurrentAdmin = () => false;
    const r = mod.saveDriveFolderLink('cli-1', BASE + ID);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/administrador/i);
  });

  it('recusa link inválido mesmo para admin', () => {
    global.isCurrentAdmin = () => true;
    expect(mod.saveDriveFolderLink('cli-1', 'https://example.com/x').ok).toBe(false);
  });

  it('salva a URL canônica, não a colada', () => {
    global.isCurrentAdmin = () => true;
    let salvo = null;
    global.saveClient = (c) => { salvo = c; };
    const r = mod.saveDriveFolderLink('cli-1', 'https://drive.google.com/drive/u/2/folders/' + ID + '?usp=sharing');
    expect(r.ok).toBe(true);
    expect(salvo.driveFolderUrl).toBe(BASE + ID);
  });

  it('campo vazio desvincula', () => {
    global.isCurrentAdmin = () => true;
    let salvo = null;
    global.saveClient = (c) => { salvo = c; };
    expect(mod.saveDriveFolderLink('cli-1', '  ').ok).toBe(true);
    expect(salvo.driveFolderUrl).toBeNull();
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Roda: `npx vitest run tests/drive-folder-url.test.js`

Esperado: FAIL — `mod.saveDriveFolderLink is not a function`.

- [ ] **Passo 3: implementar as três funções**

`_canManageClientDrive()` — espelha `_canManageClientSheet` (`:601-604`): `isCurrentAdmin()` dentro
de try/catch, `false` no erro.

`saveDriveFolderLink(clientId, raw)` — devolve `{ ok, error }` e nunca lança. Nesta ordem: sem gate
de admin → `{ ok: false, error: 'Apenas administradores podem vincular a pasta.' }`; cliente
inexistente → `{ ok: false, error: 'Cliente não encontrado.' }`; `raw` vazio após `trim` → grava
`null` e `{ ok: true }`; `parseDriveFolderId` nulo →
`{ ok: false, error: 'Link inválido. Cole o link de uma pasta do Google Drive (drive.google.com/drive/folders/...).' }`;
válido → `saveClient({ ...existing, id: clientId, driveFolderUrl: driveFolderUrl(raw) })` e
`{ ok: true }`.

`removeDriveFolderConfirm(clientId)` — gate de admin com `showToast` de erro; depois
`confirmAction` com a pergunta "Desvincular a pasta do Drive deste cliente?" e, no aceite,
`saveDriveFolderLink(clientId, '')`, `renderClientDriveSection(clientId)` (Tarefa 4) e
`showToast('Pasta desvinculada.', 'success')`. Espelha `removeSheetLinkConfirm` (`:688-700`).

- [ ] **Passo 4: exportar**

Acrescentar `_canManageClientDrive, saveDriveFolderLink` ao `module.exports` (`:925`).

- [ ] **Passo 5: rodar e ver passar**

Roda: `npx vitest run tests/drive-folder-url.test.js`

Esperado: PASS — 10 testes.

- [ ] **Passo 6: commitar**

```bash
git add js/clients-form.js tests/drive-folder-url.test.js
git commit -m "feat(cliente): vincular e desvincular a pasta do Drive, só admin"
```

---

### Tarefa 4: a seção na ficha, sem handler inline

**Arquivos:**

- Modificar: `js/clients-form.js` (`renderClientDriveSection`, `openDriveFolderPrompt`)
- Modificar: `js/clients-ficha.js:746-778` (markup da aba Documentos e a chamada no `setTimeout` da linha 778)
- Modificar: `js/clients.js:114-120` (registro das ações)
- Modificar: `tests/drive-folder-url.test.js`

**Cobre:** critérios de aceite 7 e 8; foco de revisão 4.

**Interfaces:**

- Consome: `driveFolderUrl` (Tarefa 1), `saveDriveFolderLink`, `removeDriveFolderConfirm` (Tarefa 3).
- Produz: `renderClientDriveSection(clientId): void` e `openDriveFolderPrompt(clientId): void`;
  `js/clients-ficha.js` chama a primeira, `js/clients.js` as duas.

- [ ] **Passo 1: escrever o teste que falha**

Guarda de fonte, no estilo de `tests/rls-055.test.js`, com CRLF normalizado:

```js
describe('seção da pasta na ficha', () => {
  it('não usa onclick e tira o href de driveFolderUrl', () => {
    const src = partsSource('clients').replace(/\r\n/g, '\n');
    const i = src.indexOf('function renderClientDriveSection');
    expect(i).toBeGreaterThan(-1);
    const corpo = src.slice(i, src.indexOf('\n}\n', i) + 3);
    expect(corpo).not.toMatch(/onclick=/);
    expect(corpo).toMatch(/data-action=/);
    expect(corpo).toMatch(/driveFolderUrl\(/);
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Roda: `npx vitest run tests/drive-folder-url.test.js`

Esperado: FAIL — `expect(i).toBeGreaterThan(-1)` recebe `-1`.

- [ ] **Passo 3: `renderClientDriveSection(clientId)` e `openDriveFolderPrompt(clientId)`**

`renderClientDriveSection` lê `getClientById(clientId).driveFolderUrl` (cliente sem o campo → `''`,
estado vazio, sem erro), passa por `driveFolderUrl()` e escreve em `#cliDriveBody` e
`#cliDriveActions`:

- sem link: corpo `<div class="empty-state"><p>Nenhuma pasta vinculada.</p></div>`; ações, só para
  admin, um botão `data-action="driveLink"` com `data-arg` do id e o texto `+ Vincular pasta`.
- com link: corpo com
  `<a class="btn btn-secondary btn-sm" href="<url escapada>" target="_blank" rel="noopener">📁 Abrir pasta no Drive ↗</a>`,
  onde a url é o retorno de `driveFolderUrl`; ações, só para admin, `data-action="driveLink"`
  (Editar link) e `data-action="driveUnlink"` (Remover).

`openDriveFolderPrompt(clientId)` reaproveita o utilitário de entrada de texto que o arquivo já usa
para a planilha (`openModal` com um `form-input`), **sem** criar um modal dedicado novo — foi o
corte da opção B. Na volta, chama `saveDriveFolderLink` e, quando `ok` é falso, mostra `r.error`
com `showToast`; quando é verdadeiro, chama `renderClientDriveSection(clientId)`.

- [ ] **Passo 4: a seção no markup da aba**

Em `js/clients-ficha.js`, depois do bloco da planilha (termina na linha 775) e antes do fechamento
do template (`:777`), um bloco irmão com `<hr class="divider" />`, título `📁 Pasta no Drive`,
`<div id="cliDriveActions"></div>` e `<div id="cliDriveBody"></div>`. Na linha 778, acrescentar
`renderClientDriveSection(id);` ao `setTimeout` que já existe.

- [ ] **Passo 5: registrar as ações**

Em `js/clients.js:115-119`, acrescentar ao mapa:
`driveLink: (_el, id) => openDriveFolderPrompt(id),` e
`driveUnlink: (_el, id) => removeDriveFolderConfirm(id),`.

- [ ] **Passo 6: rodar os três portões do CI**

Roda: `npm test && npm run lint && node tools/build-assets.js --check`

Esperado: PASS com 0 falhas; lint sem nenhuma saída; `✅ build-assets (check): 69 js, 1 css`.

- [ ] **Passo 7: commitar**

```bash
git add js/clients-form.js js/clients-ficha.js js/clients.js tests/drive-folder-url.test.js
git commit -m "feat(cliente): ficha abre a pasta do Drive em um clique"
```

---

## Critérios de aceite

- [ ] 1. O parser devolve o mesmo ID na URL de pasta, na forma `/u/<n>/` e no ID cru.
- [ ] 2. O parser devolve `null` em URL de arquivo, de planilha e em texto com aspa, `<` ou espaço.
- [ ] 3. `driveFolderUrl` remonta a URL a partir do ID e descarta a entrada.
- [ ] 4. Quem não é admin não vincula nem remove.
- [ ] 5. Campo vazio desvincula.
- [ ] 6. O campo está no mapa de sync e em `optionalFields`.
- [ ] 7. Cliente sem pasta mostra "Nenhuma pasta vinculada".
- [ ] 8. A seção nova não tem `onclick`; as ações passam por `data-action`.

## Fora de escopo

- Embed da pasta na ficha: decidido no `rationale` — exigiria deixar a pasta legível por qualquer
  um com o link, que é a forma do SEC-01.
- Criar pasta, casar pasta por nome, pasta-mãe, qualquer coisa de permissão no Drive.
- Aplicar a migration no banco: é feita à mão no SQL Editor, como todas as outras.
