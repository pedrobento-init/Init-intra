# Edge Functions no @supabase/server + menores do PR #59 — plano

> Para o agente executor: `godmode:inline-execution`. As caixas marcam o
> andamento. Um commit por tarefa.

**Objetivo:** levar as quatro Edge Functions que ainda usam o padrão legado
(`serve` + `createClient(SERVICE_ROLE_KEY)`) para `withSupabase({ auth: "none" })`
e fechar os sete achados menores do review do PR #59.

**Desenho:** não há design separado — o padrão já está em 13 functions
(`ia-relatorio`, `milvus-*`, `send-*`) e no commit `a8e1040`.

**Arquitetura:** cada function troca o entrypoint `serve(async (req) => …)` por
`async function handle(req, ctx)` + `export default { fetch: withSupabase({ auth: "none" }, handle) }`.
O `ctx.supabaseAdmin` substitui o client criado à mão. A autenticação própria de
cada uma (`x-agenda-secret`, `x-cron-secret`, token na query) **fica como está** —
`auth: "none"` só desliga a checagem de JWT da plataforma.

**Stack:** Deno / TypeScript, `npm:@supabase/server@1` (1.9.2), Vitest 5.

## Restrições globais

- `js/` é modo script (sem import/export, escopo global único).
- `js/config.js` nunca vai ao git.
- Comentários, testes e commits em pt-BR; comentário explica **por quê**.
- Teste que compara texto de arquivo normaliza CRLF.
- `tests/edge-functions-guard.test.js` tranca o modo de auth e o `verify_jwt`;
  ele não pode ser afrouxado. As quatro continuam com `verify_jwt = false`.
- Nada de `Deno.serve`, `deno.land/std` ou `createClient(SUPABASE_URL, …)` no
  código final.
- `npm test`, `npm run lint` e `node tools/build-assets.js --check` verdes ao fim.

## Foco de revisão

1. **`agenda-ics` com token inválido** — esperado 404 seco, sem revelar se o
   operador existe; o teste é a sonda manual do plano.
2. **`avisos-prazo` sem `x-cron-secret`** — esperado 401 antes de qualquer
   leitura; o `safeEqual` tem de continuar sendo a primeira coisa do handler.
3. **`google-agenda` com JSON inválido** — esperado 400, não 500.
4. **`robo` com ação desconhecida** — esperado 400; e o `switch` não pode
   perder nenhuma das nove ações.
5. **Resposta do `robo` que não é JSON** (backup/planilha) — `withSupabase`
   devolve a `Response` do handler intacta.

## Fontes

- `@supabase/server` README (auth modes, `ctx.supabaseAdmin`, CORS):
  https://github.com/supabase/server — conferido em 28/10/2026; pacote 1.9.2.
- `supabase/config.toml:39-48` — as quatro com `verify_jwt = false`.
- `supabase/functions/ia-levar/index.ts:25-26` — forma exata dos imports.
- `tests/edge-functions-guard.test.js:36-101` — `authMode` e `verify_jwt`.
- Review do PR #59 (os sete menores): resumo no cabeçalho da Tarefa 5 abaixo.
  O relatório completo vivia em `.godmode/reviews/`, que não é versionado.
- `tests/drive-folder-url.test.js` — estado atual dos testes citados.

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
| --- | --- | --- |
| `tests/edge-functions-server.test.js` | Criar | Trava o padrão novo nas quatro functions, uma linha por tarefa |
| `tests/edge-functions-secret-auth.test.js` | Criar | Contrato externo: 405/401/404/400/200 das quatro (review, Importante 2) |
| `tests/helpers/edge-harness.js` | Modificar | Sai o stub de `serve()`, que ficou morto com a migração |
| `supabase/functions/agenda-ics/index.ts` | Modificar | Entrypoint + `ctx.supabaseAdmin` |
| `supabase/functions/avisos-prazo/index.ts` | Modificar | Idem |
| `supabase/functions/google-agenda/index.ts` | Modificar | Idem |
| `supabase/functions/robo/index.ts` | Modificar | Idem |
| `tests/drive-folder-url.test.js` | Modificar | Menores 1–4 do review |
| `docs/plans/2026-10-27-pasta-drive-menores.md` | Modificar | Menores 6–7 (caixas e contagem) |

---

### Tarefa 1: `agenda-ics`

**Arquivos:**
- Criar: `tests/edge-functions-server.test.js`
- Modificar: `supabase/functions/agenda-ics/index.ts:13-30, 65`

**Interfaces:**
- Produz: `MIGRADAS` no teste (array de nomes) — as tarefas 2–4 acrescentam nomes.

- [x] **Passo 1: escrever o teste que falha**

```js
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fnDir = fileURLToPath(new URL('../supabase/functions/', import.meta.url));
const fonte = (nome) => fs.readFileSync(path.join(fnDir, nome, 'index.ts'), 'utf8');

// As quatro se autenticam por segredo próprio, então auth: "none" é explícito
// e a validação continua no handler. O que este teste impede é o retorno do
// padrão legado: serve() + client criado à mão com a service role.
const MIGRADAS = ['agenda-ics'];

describe('functions no padrão @supabase/server', () => {
  it.each(MIGRADAS)('%s usa withSupabase com auth none', (nome) => {
    const src = fonte(nome);
    expect(src).toMatch(/withSupabase\(\s*\{\s*auth:\s*["']none["']/);
    expect(src).not.toMatch(/deno\.land\/std/);
    expect(src).not.toMatch(/createClient\(\s*SUPABASE_URL/);
  });
});
```

- [x] **Passo 2: rodar e ver falhar**

Run: `npx vitest run tests/edge-functions-server.test.js`
Esperado: FAIL — `agenda-ics` ainda tem `deno.land/std` e `createClient(SUPABASE_URL`.

- [x] **Passo 3: migrar `agenda-ics`**

Trocar os imports por `import { type SupabaseContext, withSupabase } from "npm:@supabase/server@1";`,
remover `SUPABASE_URL`/`SERVICE_ROLE_KEY`, virar o corpo de `serve(...)` em
`async function handle(req: Request, ctx: SupabaseContext)`, usar
`const admin = ctx.supabaseAdmin;` e exportar
`export default { fetch: withSupabase({ auth: "none" }, handle) };`.
Manter: método GET/HEAD, validação do token na query, os 404 secos e os headers
de `text/calendar`.

- [x] **Passo 4: rodar e ver passar**

Run: `npx vitest run tests/edge-functions-server.test.js tests/edge-functions-guard.test.js`
Esperado: PASS nos dois arquivos.

- [x] **Passo 5: commit**

`refactor(edge): agenda-ics no @supabase/server com auth none`

---

### Tarefa 2: `avisos-prazo`

**Arquivos:**
- Modificar: `tests/edge-functions-server.test.js` (acrescentar `'avisos-prazo'` em `MIGRADAS`)
- Modificar: `supabase/functions/avisos-prazo/index.ts:21-22, 40-41, 59-68, 167`

- [x] **Passo 1: acrescentar `'avisos-prazo'` em `MIGRADAS` e rodar**

Run: `npx vitest run tests/edge-functions-server.test.js`
Esperado: FAIL só para `avisos-prazo`.

- [x] **Passo 2: migrar**

Mesma transformação. O `safeEqual` do `x-cron-secret` continua sendo a primeira
coisa do handler (antes de qualquer query); o guard de env fica só com
`GMAIL_USER`/`GMAIL_APP_PASSWORD`. `const db = ctx.supabaseAdmin;`.

- [x] **Passo 3: rodar e ver passar**

Run: `npx vitest run tests/edge-functions-server.test.js tests/edge-functions-guard.test.js`
Esperado: PASS.

- [x] **Passo 4: commit**

`refactor(edge): avisos-prazo no @supabase/server com auth none`

---

### Tarefa 3: `google-agenda`

**Arquivos:**
- Modificar: `tests/edge-functions-server.test.js`
- Modificar: `supabase/functions/google-agenda/index.ts:27-34, 242-258`

- [x] **Passo 1: acrescentar `'google-agenda'` em `MIGRADAS` e rodar**

Run: `npx vitest run tests/edge-functions-server.test.js`
Esperado: FAIL só para `google-agenda`.

- [x] **Passo 2: migrar**

Mesma transformação. `begin`/`finish` continuam recebendo `SupabaseClient` —
importar o tipo de `npm:@supabase/supabase-js@2` (como `ia-levar`). Manter o
`safeEqual` do `x-agenda-secret`, o 400 de JSON inválido e o 500 genérico.

- [x] **Passo 3: rodar e ver passar**

Run: `npx vitest run tests/edge-functions-server.test.js tests/edge-functions-guard.test.js`
Esperado: PASS.

- [x] **Passo 4: commit**

`refactor(edge): google-agenda no @supabase/server com auth none`

---

### Tarefa 4: `robo`

**Arquivos:**
- Modificar: `tests/edge-functions-server.test.js`
- Modificar: `supabase/functions/robo/index.ts:40-42, 56-58, 500-525`

- [x] **Passo 1: acrescentar `'robo'` em `MIGRADAS` e rodar**

Run: `npx vitest run tests/edge-functions-server.test.js`
Esperado: FAIL só para `robo`.

- [x] **Passo 2: migrar**

Mesma transformação. As nove ações do `switch` (`vencimentos`, `dominios`,
`resumo`, `indicadores`, `backup`, `backups`, `triagem`, `pastas`,
`pastas-resultado`) continuam intactas; o `db` passado a elas vira
`ctx.supabaseAdmin`. Manter `x-agenda-secret` com `safeEqual`, o 400 de JSON
inválido e o log `robo: <ação> <mensagem>`.

- [x] **Passo 3: rodar e ver passar**

Run: `npx vitest run tests/edge-functions-server.test.js tests/edge-functions-guard.test.js`
Esperado: PASS, 4 nomes.

- [x] **Passo 4: commit**

`refactor(edge): robo no @supabase/server com auth none`

---

### Tarefa 5: menores do review do PR #59

**Arquivos:**
- Modificar: `tests/drive-folder-url.test.js:1-10, 150-156, 237-255`
- Modificar: `docs/plans/2026-10-27-pasta-drive-menores.md` (caixas e "70 arquivos")

**Menores cobertos:** 1 (espiã do timer), 2 (tail depois de `?`/`#`), 3
(comentário morto), 4 (guarda do emoji), 6 (caixas do plano), 7 (contagem).
O menor 5 (higiene fora da lista fechada) fica de fora: a varredura de
`globalThis` apagaria chaves do próprio Vitest; o risco é maior que o ganho.

- [x] **Passo 1: menor 1 — a espiã prova que o timer disparou**

Importar `vi` e trocar os stubs por `vi.fn()`, afirmando
`expect(docs).toHaveBeenCalled()`. Sem isso, subir o delay de 20 ms para 40–50 ms
devolve o flake silencioso.

- [x] **Passo 2: menor 2 — tail hostil depois de `?`**

```js
it('descarta o tail depois de ?/# e devolve só o ID', () => {
  expect(mod.driveFolderUrl(BASE + ID + '?x="><img src=x>')).toBe(BASE + ID);
  expect(mod.driveFolderUrl(BASE + ID + '#"><img src=x>')).toBe(BASE + ID);
});
```

- [x] **Passo 3: menor 3 — comentário do snapshot**

Trocar o texto das linhas 7–10 por *por que* o snapshot é na carga do módulo
("em `beforeEach` ele capturaria o que o teste anterior deixou").

- [x] **Passo 4: menor 4 — guarda do emoji deixa de ser frouxa**

Acrescentar `expect(src).not.toContain('📁 Pasta no Drive');` ao teste do título.

- [x] **Passo 5: menores 6 e 7 — plano**

Marcar todas as caixas de `2026-10-27-pasta-drive-menores.md` como `[x]` e
trocar "70 arquivos" por "69 arquivos" (linhas 40 e 49).

- [x] **Passo 6: rodar e ver passar**

Run: `npx vitest run tests/drive-folder-url.test.js tests/edge-functions-server.test.js tests/edge-functions-guard.test.js`
Esperado: PASS.

- [x] **Passo 7: commit**

`test(drive): fecha os menores do review do PR #59`

---

### Tarefa 6: portões e PR

- [x] **Passo 1: suíte completa**

Run: `npm test`
Resultado: 1166 passam, 36 pulados; 2 suítes (`rls`, `client-secrets`) estouram
o hook de 10 s do PGlite **nesta máquina** — passam isoladas e em par (36/36 em
4,7 s) e o mesmo acontece na `main` sem estas mudanças. Não é o diff.

- [x] **Passo 2: lint**

Run: `npm run lint` → exit 0.

- [x] **Passo 3: build**

Run: `node tools/build-assets.js --check` → exit 0 (aviso não-fatal de
`js/config.js` ausente).

- [x] **Passo 4: abrir PR**

Corpo com: as quatro functions migradas, o que **não** mudou (auth própria,
`verify_jwt = false`), os menores fechados, o menor 5 adiado com o motivo, e o
lembrete de que a prova é o deploy (`supabase functions deploy <nome> --no-verify-jwt`).

---

### Revisão fresca da branch

Revisor: subagente `code-reviewer`, sem contexto da execução, faixa
`3e078e0..91d1766`. Veredito: "depois de correções" — nenhum Crítico.

Fechados nesta branch: guarda passa a exigir `ctx.supabaseAdmin` e a proibir
`Deno.serve` (Importante 1); `tests/edge-functions-secret-auth.test.js` cobre
405/401/404/400/200 das quatro e a ordem do segredo antes do admin
(Importante 2); instrução mutilada do plano anterior, "70 arquivos" na fonte,
comentário e stub morto do harness, e a espiã com os argumentos certos
(Menores 3, 4, 5, 7); Tarefa 6 registrada (Menor 9).

Recusados, com motivo: helper `fnDir`/`fonte` repetido em dois testes (Menor 6)
— são quatro linhas de `readFileSync` e extrair um módulo para isso é mais
indireção que o problema; corpos de commit (Menor 8) — reescrever seis commits
locais não muda o código e o "por quê" fica no corpo deste PR e no desta seção.
