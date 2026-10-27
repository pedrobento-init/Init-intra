# Criação da pasta do Drive para cliente novo — plano

> Para o agente executor: godmode:inline-execution, tarefa por tarefa.

**Goal:** o robô da noite cria a pasta do Drive do cliente novo sem pasta e sem planilha e grava `drive_folder_url`.
**Design:** docs/plans/2026-10-27-pasta-drive-criar-design.md
**Architecture:** a Edge Function `robo` decide quem entra em `criar` (`planoPastas`); o `Robo.gs` cria (ou reusa) a pasta em `CLIENTES_ROOT_ID` e devolve como `achados`; `gravarResultadoPastas` grava como já faz.
**Stack:** Deno/TypeScript (Edge Function), Google Apps Script, Vitest.

## Global Constraints
- `index.ts` continua com `serve` + `createClient`; não migrar auth nem `verify_jwt` nesta mudança.
- Gravação só com `.is("drive_folder_url", null)`; não sobrescreve vínculo humano.
- Testes que leem arquivo normalizam CRLF.

## Review Focus
1. Cliente antigo (antes de `PASTAS_CRIAR_DESDE`) nunca entra em `criar` — teste na Tarefa 1.
2. `created_at` nulo ou inválido fica de fora — Tarefa 1.
3. Link de planilha inválido fica de fora (pode já ter pasta) — Tarefa 1.
4. Nome vazio ou só espaço fica de fora — Tarefa 1.
5. `CLIENTES_ROOT_ID` vazio ou inacessível não cria nada e loga um erro só — guarda estrutural na Tarefa 2.

## Sources
- DriveApp `Folder.createFolder`, `getFoldersByName`, `isTrashed`, `getUrl`: https://developers.google.com/apps-script/reference/drive/folder (27/10/2026).

## File Map
| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `supabase/functions/robo/campo.ts` | Modificar | `PASTAS_CRIAR_DESDE`, `criar` em `planoPastas`, `cand` em `gravarResultadoPastas` |
| `supabase/functions/robo/index.ts` | Modificar | select com `name, created_at`; `pastas` devolve `criar` |
| `tools/google-agenda-apps-script/Robo.gs` | Modificar | terceiro laço em `roboPastas`; `testarPastas` mostra `a criar` |
| `GOOGLE-AGENDA.md` | Modificar | papel Colaborador, propriedade `CLIENTES_ROOT_ID`, limites |
| `tests/robo-campo.test.js` | Modificar | testes de `criar` e guardas estruturais |

### Tarefa 1: campo.ts + index.ts

- [ ] Testes em `tests/robo-campo.test.js` (bloco de pastas): `criar` inclui só cliente novo (limite inclusivo, `Z` e `+00:00`) sem pasta, sem planilha e com nome; exclui planilha válida (vai a `candidatos`), link de planilha inválido, nome vazio/branco, `created_at` nulo, quem já tem pasta e cliente antigo. `gravarResultadoPastas` grava id de `criar` com status `ok`. Guarda: `index.ts` contém `name, created_at` e `criar: plano.criar`.
- [ ] `npx vitest run tests/robo-campo.test.js` → FAIL (`criar` indefinido).
- [ ] `ClientePasta` ganha `name?`, `created_at?`; `export const PASTAS_CRIAR_DESDE = "2026-10-27T00:00:00-03:00"`; `planoPastas` devolve `criar: {client_id, nome}[]`; `cand` = união de `candidatos` e `criar`. `index.ts`: select e retorno.
- [ ] Mesmo comando → PASS.

### Tarefa 2: Robo.gs

- [ ] Guarda: `Robo.gs` contém `CLIENTES_ROOT_ID`, `isTrashed()` e `r.criar || []` → FAIL, depois PASS.
- [ ] Laço `criar` em `roboPastas`: propriedade vazia → um erro; `getFolderById` lança → um erro, pula; por cliente reusa a primeira pasta não excluída de mesmo nome ou cria; log `| criadas: X | reusadas: Y`. `testarPastas` mostra `| a criar: N` e os nomes, sem criar.

### Tarefa 3: documentação

- [ ] `GOOGLE-AGENDA.md`, seção "Instalar a pasta do Drive automática": papel Colaborador; propriedade `CLIENTES_ROOT_ID`; rodar `testarPastas`; limite (só cliente novo; homônimos dividem pasta).
- [ ] Gates: `npm test`, `npm run lint`, `node tools/build-assets.js --check` → verdes. Commit e PR.
