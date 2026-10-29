# Menores da revisão da pasta do Drive — plano de implementação

> Para o agente executor: rode com godmode:inline-execution ou
> godmode:delegated-execution, tarefa por tarefa. Os passos têm caixas de marcação.

**Objetivo:** fechar os cinco menores deferidos da revisão do PR #58 (pasta do Drive
na ficha do cliente) e o flake de baseline descoberto na preparação deste lote, na
mesma disciplina do lote anterior: teste primeiro, um commit por tarefa, portões do
CI antes do PR.

**Design:** sem documento separado — este plano carrega a especificação. Achados:
`.godmode/runs/pasta-drive-cliente/progress.md:40-45` (registro da revisão que
fechou o PR #58). **Rulings do usuário (27/10/2026):**

- **Parser flexível (minor 2 e 3):** aceitar host sem esquema e em maiúsculas, e a
  forma legada `drive.google.com/open?id=<ID>`; manter o fallback de ID cru. Risco
  aceito e documentado: um ID que não seja de pasta pode virar link que dá 404 —
  mesmo risco que o design aprovado já aceita no ID cru, e indistinguível sem chamar
  a API do Drive.
- **Backstop de admin no servidor (minor 1): adiado com registro.** O gate é só no
  cliente (`isCurrentAdmin`, `js/storage-operadores.js:184`); o mesmo buraco existe
  em `google_sheet_url` há tempo, o review classificou como não-regressão, e
  implementar exige projetar como o Postgres saberia quem é admin. Fica registrado
  em "Fora de escopo" abaixo e no corpo do PR; tarefa de hardening futura.
- **Flake do baseline (achado novo na preparação): incluir a correção no lote**
  (ruling do usuário, 27/10/2026): o teste `submitDriveFolderLink` chama o
  `viewClient` de verdade, que agenda o `setTimeout` de 20 ms de
  `js/clients-ficha.js:786`; dois dos quatro renderizadores do callback
  (`renderClientDocumentsList`, `renderAttachmentList`) moram em
  `js/storage-anexos.js`, **fora** do grupo que o teste compila →
  `ReferenceError` intermitente (2 em 5 execuções no baseline, exit 1 — o CI
  reprovaria sem aviso). Correção: `await` de 30 ms no teste (torna o vermelho
  determinístico) + stub das duas funções; as duas chaves entram na higiene da
  Tarefa 3.

**Arquitetura:** nenhuma mudança estrutural. O parser deixa de exigir esquema
exato; os testes devolvem os globais que emprestam; o cabeçalho da seção ganha um
emoji distinto; o plano original fica com as caixas marcadas e a contagem real.

**Stack:** JavaScript modo script (69 arquivos em escopo global único), Vitest
5.0.5, sem dependências novas.

**Branch:** `fix/cliente-pasta-menores`, nascida de `origin/main`.

## Restrições globais

Copiadas do plano original (`docs/plans/2026-10-27-pasta-drive-cliente.md:17-31`):

- `js/` é **modo script**: 69 arquivos num escopo global único. Antes de criar nome global,
  conferir que não existe.
- **Nada de handler inline.** `onclick` no markup é proibido pelo `AGENTS.md`. Usar `data-action`
  com ação registrada em `registerActions`.
- **XSS:** dado colado pelo usuário nunca é interpolado em HTML. O que vai ao atributo `href` é
  sempre o retorno de `driveFolderUrl(id)`, remontado. Texto visível passa por `escapeHtml`.
- **RLS por equipe:** nenhuma query nova neste lote.
- **CRLF:** teste que compara texto de arquivo normaliza `\r\n` (ver `tests/rls-055.test.js`).
- Comentários, descrições de teste e mensagens de commit em português do Brasil.

## Foco de revisão

Classes de entrada que as rulings implicam e que nenhum teste sozinho cobre;
cada uma fica presa à tarefa que tem o código.

1. ID com caixa mista após host em maiúsculas — o remonte não pode devolver o ID
   em minúsculas. **Tarefa 1.**
2. Forma de arquivo com host em maiúsculas (`HTTPS://DRIVE.GOOGLE.COM/file/d/...`)
   — a normalização não pode abrir porteira para não-pasta. **Tarefa 1.**
3. `open?id=` com token curto ou entrada com aspa/espaço na forma sem esquema —
   continua `null`. **Tarefa 1.**
4. Após a devolução de globais, um teste que dependia de vazamento de outro
   `describe` quebra — a suíte inteira do arquivo é a verificação. **Tarefa 3.**
5. Literal do emoji idêntico no teste e no fonte (o teste falha se o arquivo
   receber 🗂 sem o seletor e o teste tiver 🗂️, ou vice-versa). **Tarefa 4.**
6. O `await` do teste do timer tem de ficar acima do delay de 20 ms do
   `setTimeout` — abaixo disso o flake volta. **Tarefa 2.**

## Fontes

- Achados da revisão: `.godmode/runs/pasta-drive-cliente/progress.md:40-45` (lido em 27/10/2026).
- Padrão de devolução de globais: `tests/milvus-client-token.test.js:49-59` (snapshot +
  `afterEach` que `delete` quando a chave era `undefined`).
- Parser atual: `js/clients-form.js:585-604`; guarda SEC-18 em `tests/drive-folder-url.test.js:32-36`.
- Grupo de teste `clients` inclui `clients-ficha.js`: `tests/_parts.cjs:9`.
- Títulos das seções: `js/clients-ficha.js:761` (Anexos, 📁) e `:780` (pasta, 📁).
- Timer do baseline: `js/clients-ficha.js:786` (`setTimeout` de 20 ms →
  `renderClientDocumentsList`/`renderAttachmentList` em `js/storage-anexos.js:424`
  e `:321`, fora do grupo `clients`); captura do erro no baseline, 27/10/2026.
- Contagem real da suíte na Tarefa 2 do plano anterior: 101 → 102 arquivos
  (`.godmode/runs/pasta-drive-cliente/progress.md:19`).

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
| --- | --- | --- |
| `js/clients-form.js:585-597` | modificar | parser flexível (normalização + `open?id=`) |
| `tests/drive-folder-url.test.js` | modificar | testes do parser, higiene de globais, guarda do emoji |
| `js/clients-ficha.js:780` | modificar | `🗂️` no título da seção da pasta |
| `docs/plans/2026-10-27-pasta-drive-cliente.md` | modificar | caixas marcadas, contagem real 101→102 |

---

### Tarefa 1: parser flexível

**Arquivos:**

- Modificar: `js/clients-form.js:585-597` (`parseDriveFolderId`)
- Modificar: `tests/drive-folder-url.test.js`

**Cobre:** minor 2 (sem esquema, host em maiúsculas, `open?id=` legado); minor 3
(o limite de 15 chars do ID cru fica preso por teste, com o risco de 404
documentado no comentário em vez de "consertável" — é a ruling flexível).

**Interfaces:**

- Assinaturas inalteradas: `parseDriveFolderId(v): string|null` e
  `driveFolderUrl(v): string`. Consumidores (`saveDriveFolderLink`,
  `renderClientDriveSection`) não mudam.

- [x] **Passo 1: escrever os testes que falham**

Adicionar ao `tests/drive-folder-url.test.js`, depois do describe
`recusa entrada com aspa...` (linha 36):

```js
describe('parseDriveFolderId — normalização flexível', () => {
  let mod;
  beforeEach(() => { mod = requireParts('clients'); });

  it('aceita host sem esquema, host em maiúsculas e a forma legada open?id=', () => {
    expect(mod.parseDriveFolderId('drive.google.com/drive/folders/' + ID)).toBe(ID);
    expect(mod.parseDriveFolderId('HTTPS://DRIVE.GOOGLE.COM/drive/folders/' + ID + '/?usp=sharing')).toBe(ID);
    expect(mod.parseDriveFolderId('https://drive.google.com/open?id=' + ID)).toBe(ID);
    expect(mod.parseDriveFolderId('drive.google.com/open?id=' + ID + '&usp=sharing')).toBe(ID);
  });

  it('a normalização preserva a caixa do ID e não abre porteira para não-pasta', () => {
    expect(mod.driveFolderUrl('HTTPS://DRIVE.GOOGLE.COM/drive/folders/' + ID)).toBe(BASE + ID);
    expect(mod.parseDriveFolderId('HTTPS://DRIVE.GOOGLE.COM/file/d/' + ID + '/view')).toBeNull();
    expect(mod.parseDriveFolderId('docs.google.com/spreadsheets/d/' + ID + '/edit')).toBeNull();
    expect(mod.parseDriveFolderId('drive.google.com/drive/folders/' + ID + '" onmouseover=x')).toBeNull();
    expect(mod.parseDriveFolderId('drive.google.com/open?id=' + ID.slice(0, 14))).toBeNull();
  });
});
```

E no describe `aceita o ID colado cru` (linha 19), acrescentar a fixação do piso:

```js
  it('recusa ID cru de 14 caracteres — o piso é 15', () => {
    expect(mod.parseDriveFolderId(ID.slice(0, 14))).toBeNull();
  });
```

- [x] **Passo 2: rodar e ver falhar**

Rodar: `npx vitest run tests/drive-folder-url.test.js`

Esperado: FAIL — 2 dos 3 testes novos falham (os que aceitam sem esquema/maiúsculas/
`open?id=` recebem `null`; o de 14 chars já passa, o parser atual também o recusa).
Contagem nova: 21 testes no arquivo (18 + 3), 2 vermelhos.

- [x] **Passo 3: implementar a normalização em `parseDriveFolderId`**

Em `js/clients-form.js:590`, mesma assinatura. Comportamento fixado pelo teste:

1. `trim` como hoje; vazio → `null`.
2. Se a entrada começa com `drive.google.com/` (qualquer caixa) → prefixar `https://`
   antes de casar — é o "sem esquema".
3. Casar com flag `i` para o esquema e o host (`HTTPS://DRIVE.GOOGLE.COM/...`), sem
   flag de case-fold no resto além do que a classe `[a-zA-Z0-9_-]` já cobre — o ID
   é case-sensitive e volta ao chamador como veio.
4. Aceitar duas formas de caminho: `[/drive/[/u/<n>/]]folders/<ID>` (como hoje) e
   `open?id=<ID>`, ambas com o mesmo piso de 15 caracteres e com query/hash
   opcional depois do ID.
5. Fallback de ID cru inalterado (`^[a-zA-Z0-9_-]{15,}$`).
6. Qualquer outra coisa → `null`. `/file/d/` e `docs.google.com` continuam fora.

Referência de implementação (cópia exata é permitida aqui: é o regex que a guarda
SEC-18 depende — improvisar regex é o vetor):

```js
function parseDriveFolderId(v) {
  let s = String(v === null || v === undefined ? '' : v).trim();
  if (!s) return null;
  if (/^drive\.google\.com\//i.test(s)) s = 'https://' + s;
  const m = s.match(/^https?:\/\/drive\.google\.com\/(?:(?:drive\/(?:u\/\d+\/)?)?folders\/([a-zA-Z0-9_-]{15,})\/?(?:[?#].*)?|open\?id=([a-zA-Z0-9_-]{15,})(?:[?&#].*)?)$/i);
  if (m) return m[1] || m[2];
  if (/^[a-zA-Z0-9_-]{15,}$/.test(s)) return s;
  return null;
}
```

Atualizar o comentário (`js/clients-form.js:585-589`, em pt-BR, diz **por quê**):
a normalização existe porque o endereço colado sem esquema ou com host em outra
caixa é o mesmo link; `open?id=` é a forma legada de compartilhamento; e o fallback
de ID cru não distingue pasta de arquivo (risco aceito — link que dá 404 é
visível para quem colou errado, e o ID de planilha só chega aqui cru, sem a forma
`/spreadsheets/` que é recusada).

- [x] **Passo 4: rodar e ver passar**

Rodar: `npx vitest run tests/drive-folder-url.test.js`

Esperado: PASS — 21 testes, 0 falhas (os 18 antigos, inclusive a guarda SEC-18,
continuam verdes).

- [x] **Passo 5: commitar**

```bash
git add js/clients-form.js tests/drive-folder-url.test.js
git commit -m "fix(cliente): parser da pasta aceita host sem esquema, maiúsculas e open?id="
```

Corpo: o endereço de uma pasta era recusado por detalhe de forma (faltava
`https://`, host em maiúsculas, ou era o `open?id=` legado); agora só o que
identifica não-pasta é recusado.

---

### Tarefa 2: o timer que escapava do teste (flake do baseline)

**Arquivos:**

- Modificar: `tests/drive-folder-url.test.js` (describe `submitDriveFolderLink reabre a ficha`)

**Cobre:** o achado novo do baseline (ruling: incluir no lote) — mesma classe do
minor 4: trabalho que escapa do teste e derruba o CI sem aviso.

**Interfaces:**

- Nenhuma mudança de código de produto. Consome o `viewClient` real do grupo
  `clients` e o `setTimeout` de `js/clients-ficha.js:786` (20 ms, chama
  `renderClientDocumentsList`, `renderAttachmentList`, `renderClientSheetSection`,
  `renderClientDriveSection`).
- As duas funções stubadas são de `js/storage-anexos.js:424` e `:321`, fora do
  grupo compilado pelo teste. A Tarefa 3 leva as duas chaves para a higiene.

- [x] **Passo 1: tornar o teste async com o await (o vermelho vira determinístico)**

Em `tests/drive-folder-url.test.js`, no `it('salvar leva de volta para a ficha do
cliente')` (linha ~185), virar `async` e acrescentar o `await` **antes** da
asserção:

```js
  it('salvar leva de volta para a ficha do cliente', async () => {
    // ...corpo existente até mod.submitDriveFolderLink('cli-1')...
    await new Promise((r) => setTimeout(r, 30));
    expect(titulo).toBe('ACME');
  });
```

Comentário no teste (pt-BR, por quê): o `viewClient` agenda o `setTimeout` de
20 ms de `clients-ficha.js:786`; sem o `await`, o timer disputa com a
desmontagem do worker e o erro só aparece em algumas execuções — com ele, o
timer dispara sempre dentro do teste.

- [x] **Passo 2: rodar e ver falhar (de forma determinística)**

Rodar: `npx vitest run tests/drive-folder-url.test.js`

Esperado: o `it` passa, mas o run termina **exit 1** — `Unhandled Error:
ReferenceError: renderClientDocumentsList is not defined`
(`Timeout._onTimeout` no fonte concatenado). É exatamente a falha intermitente do
baseline (2 em 5), agora garantida a cada execução.

- [x] **Passo 3: stubar as duas funções fora do grupo**

No corpo do mesmo `it`, antes de `mod.submitDriveFolderLink('cli-1')`:

```js
    // Dois dos quatro renderizadores do timer moram em js/storage-anexos.js,
    // fora do grupo 'clients' que o teste compila: sem o stub, ReferenceError.
    global.renderClientDocumentsList = () => {};
    global.renderAttachmentList = () => {};
```

- [x] **Passo 4: rodar e ver passar**

Rodar: `npx vitest run tests/drive-folder-url.test.js`

Esperado: PASS — 21 testes, **exit 0**, nenhum Unhandled Error.

- [x] **Passo 5: commitar**

```bash
git add tests/drive-folder-url.test.js
git commit -m "test(cliente): o timer de 20 ms do viewClient deixa de escapar do teste"
```

Corpo: o teste chamava o `viewClient` de verdade, cujo `setTimeout` de
`clients-ficha.js:786` invoca `renderClientDocumentsList`/`renderAttachmentList`,
que não existem no grupo compilado — `ReferenceError` em ~2 de 5 execuções que
reprovaria o CI sem aviso; o `await` de 30 ms torna o disparo determinístico
dentro do teste.

---

### Tarefa 3: higiene dos globais nos testes

**Arquivos:**

- Modificar: `tests/drive-folder-url.test.js`

**Cobre:** minor 4 (testes atribuem globais e não restauram; `isCurrentAdmin`
vaza entre describes).

**Interfaces:**

- Nenhuma mudança de código de produto. Padrão copiado de
  `tests/milvus-client-token.test.js:49-59`.

- [x] **Passo 1: escrever o teste que falha**

No fim do `tests/drive-folder-url.test.js` (depois de todos os describes que
atribuem global), um describe de higiene. Acima dele, no topo do arquivo (logo
após o `import` da linha 3 — o snapshot roda na carga do módulo, antes de
qualquer teste):

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// Snapshot antes de qualquer teste: o que é devolvido é exatamente o que
// existia. Chave ausente vira delete — é o padrão de milvus-client-token.test.js.
const _globalKeys = [
  'getClientById', 'isCurrentAdmin', 'saveClient', 'showToast', 'closeModal',
  'openModal', 'getVisitsByClient', 'getPendenciasByClient', 'document', 'escapeHtml',
  'renderClientDocumentsList', 'renderAttachmentList',
];
const _keep = {};
for (const k of _globalKeys) _keep[k] = globalThis[k];
afterEach(() => {
  for (const k of _globalKeys) {
    if (_keep[k] === undefined) delete globalThis[k];
    else globalThis[k] = _keep[k];
  }
});
```

E o teste, no fim do arquivo:

```js
describe('higiene dos globais', () => {
  it('nenhum global emprestado sobrevive ao teste que o atribuiu', () => {
    for (const k of _globalKeys) expect(globalThis[k]).toBe(_keep[k]);
  });
});
```

- [x] **Passo 2: rodar e ver falhar**

Rodar: `npx vitest run tests/drive-folder-url.test.js`

Esperado: FAIL no teste de higiene — `isCurrentAdmin` (e provavelmente
`document`, `saveClient`, `openModal`, e os stubs `renderClientDocumentsList`/
`renderAttachmentList` da Tarefa 2) ainda está atribuído pelo describe anterior.

- [x] **Passo 3: o `afterEach` de arquivo**

O snapshot + `afterEach` do Passo 1 **já é a correção**: basta mantê-los no
lugar. Se algum teste existente passar a falhar porque dependia do vazamento de
outro describe, mover a atribuição que ele usava para o `beforeEach`/`it` dele
próprio — nunca retirar a devolução.

- [x] **Passo 4: rodar o arquivo inteiro e depois a suíte**

Rodar: `npx vitest run tests/drive-folder-url.test.js`

Esperado: PASS — 22 testes (21 + o de higiene), 0 falhas.

Rodar: `npm test`

Esperado: PASS, 0 falhas. Atenção ao primeiro vermelho aqui: se um teste de
outro arquivo enxergava `isCurrentAdmin`/`document` vazados deste, o conserto é
no arquivo que faltou declarar o próprio global, não aqui.

- [x] **Passo 5: commitar**

```bash
git add tests/drive-folder-url.test.js
git commit -m "test(cliente): globais emprestados aos testes da pasta são devolvidos"
```

Corpo: os testes fixavam `isCurrentAdmin` & cia. em `globalThis` sem devolver;
o vazamento sobrevivia entre describes e o último a escrever vencia a suíte.

---

### Tarefa 4: emoji distinto na seção da pasta

**Arquivos:**

- Modificar: `js/clients-ficha.js:780`
- Modificar: `tests/drive-folder-url.test.js`

**Cobre:** minor 5 (`📁` repetido com a seção de Anexos; `🗂️` distinguiria).

**Interfaces:**

- Nenhuma. Só texto de título.

- [x] **Passo 1: escrever o teste que falha**

No `tests/drive-folder-url.test.js`, junto da guarda de fonte existente
(linha 94):

```js
describe('título da seção da pasta', () => {
  it('usa 🗂️ para não repetir o 📁 das Anexos', () => {
    const src = partsSource('clients').replace(/\r\n/g, '\n');
    expect(src).toContain('🗂️ Pasta no Drive');
    expect(src).toContain('📁 Anexos do Cliente');
  });
});
```

**Copiar o literal `🗂️` (com seletor de apresentação) do plano para os dois
lugares** — teste e fonte têm de ser byte a byte o mesmo, senão o teste falha.

- [x] **Passo 2: rodar e ver falhar**

Rodar: `npx vitest run tests/drive-folder-url.test.js`

Esperado: FAIL — `expect(src).toContain('🗂️ Pasta no Drive')` recebeu o texto
com `📁`.

- [x] **Passo 3: trocar o título**

Em `js/clients-ficha.js:780`:

```html
<span class="section-title">🗂️ Pasta no Drive</span>
```

Só o cabeçalho da seção: o botão "📁 Abrir pasta no Drive" e o modal
"📁 Vincular pasta do Drive" (em `js/clients-form.js`) ficam como estão — o
choque apontado foi entre os dois títulos da mesma aba.

- [x] **Passo 4: rodar e ver passar**

Rodar: `npx vitest run tests/drive-folder-url.test.js`

Esperado: PASS — 23 testes.

- [x] **Passo 5: commitar**

```bash
git add js/clients-ficha.js tests/drive-folder-url.test.js
git commit -m "fix(cliente): seção da pasta usa 🗂️ para não repetir o das Anexos"
```

---

### Tarefa 5: caixas e contagem do plano original

**Arquivos:**

- Modificar: `docs/plans/2026-10-27-pasta-drive-cliente.md`

**Cobre:** minor 6 (caixas do plano desmarcadas; contagem de 104 arquivos).

Nenhuma mudança de código — não há teste a escrever (edição de documentação).

- [x] **Passo 1: marcar as caixas**

Substituir **todas** as `- [x]` por `- [x]` no arquivo (34 ocorrências: passos
das Tarefas 1–4 e critérios de aceite 1–8 — tudo foi executado e mergeado no
PR #58).

- [x] **Passo 2: corrigir a contagem**

Linha 232: `a contagem de arquivos sobe de 103 para 104` →
`a contagem de arquivos sobe de 101 para 102` (o número real registrado em
`.godmode/runs/pasta-drive-cliente/progress.md:19`; o plano foi escrito sobre
outra branch).

- [x] **Passo 3: verificar**

Rodar: `Select-String -Path docs/plans/2026-10-27-pasta-drive-cliente.md -Pattern '- \[ \]'`

Esperado: sem saída (nenhuma caixa aberta).

Rodar: `Select-String -Path docs/plans/2026-10-27-pasta-drive-cliente.md -Pattern '103 para 104'`

Esperado: sem saída.

- [x] **Passo 4: commitar**

```bash
git add docs/plans/2026-10-27-pasta-drive-cliente.md
git commit -m "docs(plano): caixas marcadas e contagem real dos testes da pasta"
```

---

### Tarefa 6: portões do CI e PR

**Arquivos:** nenhum novo.

- [x] **Passo 1: os três portões**

Rodar: `npm test && npm run lint && node tools/build-assets.js --check`

Esperado: PASS com **0 falhas** (não fixar contagem de arquivos — ela muda a
cada PR que entra na main, foi a lição do plano anterior); lint sem nenhuma
saída, exit 0; `✅ build-assets (check): 69 js, 1 css`.

- [x] **Passo 2: push e PR**

```bash
git push -u origin fix/cliente-pasta-menores
gh pr create --title "fix(cliente): menores da revisão da pasta do Drive" --body-file <corpo>
```

Corpo do PR: os cinco menores fechados (um por item, com o commit) e o flake do
baseline resolvido (timer de 20 ms determinístico); **ruling registrada** —
o backstop de admin no servidor segue adiado (mesmo buraco de
`google_sheet_url`, não-regressão; hardening futuro exige design de como o
Postgres identifica o admin); lembrete de que a migration
`068_clients_drive_folder.sql` é aplicada à mão no SQL Editor (e a branch
`feat/csat-email` tem outra `068` — renumerar antes que as duas cheguem ao banco).

- [x] **Passo 3: CI verde**

Rodar: `gh pr checks`

Esperado: `test` SUCCESS (o resto é Vercel/Supabase, mesmo padrão do PR #58).

---

## Critérios de aceite

- [x] 1. URL sem esquema, host em maiúsculas e forma `open?id=` vinculam; a caixa do ID sobrevive ao remonte.
- [x] 2. `/file/d/`, `docs.google.com`, aspa/espaço e ID de 14 chars continuam recusados.
- [x] 3. O timer de 20 ms do `viewClient` não derruba mais o run: `npx vitest run tests/drive-folder-url.test.js` sai com exit 0, sem Unhandled Error, em toda execução.
- [x] 4. Nenhum global atribuído pelos testes sobrevive ao teste (teste de higiene verde).
- [x] 5. Cabeçalho da seção da pasta é `🗂️`; o das Anexos segue `📁`.
- [x] 6. Plano original sem caixa aberta e sem a contagem 103→104.
- [x] 7. `npm test` 0 falhas, `npm run lint` exit 0, `build-assets --check` ok.

## Fora de escopo

- **Backstop de admin no servidor (minor 1) — adiado com registro** (ruling do
  usuário, 27/10/2026): gate é client-side só, idêntico ao de `google_sheet_url`;
  implementar exige decidir como o Postgres sabe quem é admin. Hardening futuro.
- Aplicar a migration `068_clients_drive_folder.sql` no banco: à mão no SQL
  Editor, como todas.
- Renumerar a `068_pendencias_csat.sql` da branch `feat/csat-email` (outra
  sessão): conflito de numeração, aviso dado ao usuário, não é deste lote.
- Embed da pasta, criação de pasta, permissões no Drive: continuam fora, como no
  plano original.
