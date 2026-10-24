# AGENTS.md

Regras para agentes de IA que trabalham neste repositório. Fonte única: o
`CLAUDE.md` aponta para cá, e o opencode lê este arquivo direto. **Mudança de
convenção entra aqui, não nos arquivos de agente.**

O que o projeto faz, telas e Edge Functions estão no [README.md](README.md) — não
repita aquilo aqui. Este arquivo é só _como trabalhar no código_.

## Em uma linha

Init Intra: intranet de gestão (clientes, pendências, visitas) em JavaScript
puro, offline-first com IndexedDB, Supabase com RLS por equipe, publicada na
Vercel como PWA.

## Comandos

```bash
npm ci
cp js/config.example.js js/config.js   # URL e anon key do Supabase
npm run dev                            # vercel dev
npm test                               # vitest run
npm run test:e2e                       # playwright
npm run lint                           # eslint js tools --max-warnings 0
```

Sem `js/config.js`, o app roda em modo local com dados de demonstração. O CI
roda `lint`, `test` e `node tools/build-assets.js --check` em cada PR.

## As armadilhas que custam caro

**`js/` é modo script, não módulo.** Os 69 arquivos são carregados por `<script>`
no `index.html` e **compartilham um único escopo global**. Não há `import` nem
`export`. Consequência prática: nome de função ou constante no topo de arquivo
colide silenciosamente com o de outro arquivo. Antes de criar um nome global,
procure se já existe.

**Nada de handler inline no HTML.** As ações passam por delegação em
`js/actions.js`. `onclick="..."` no markup não é o padrão daqui.

**XSS é o risco número um.** Dado de usuário que entra em `innerHTML` passa por
`escapeHtml` primeiro. Isso vale para texto, atributo e URL.

**`js/config.js` nunca vai ao git** (está no `.gitignore`, junto com `.env` em
qualquer profundidade). É gerado por `tools/build-config.js` no deploy.

**RLS por equipe é regra de negócio, não detalhe.** Toda query respeita o escopo
de `team`. Não contorne com service role no cliente; `delete`/`update` sem filtro
de team é bug de segurança, não de lógica.

**Edge Functions usam `@supabase/server`:** `export default { fetch:
withSupabase({ auth: "..." }, handle) }`, nunca `Deno.serve` com
`createClient(SERVICE_ROLE_KEY)`. O modo de `auth:` **não se deduz** da função
vizinha — função que autentica por segredo próprio (`x-agenda-secret`,
`x-cron-secret`, token na query) usa `auth: "none"` mais a validação que já
existe. `tests/edge-functions-guard.test.js` tranca isso e o `verify_jwt` do
`config.toml`; rode sempre que mexer em `supabase/functions/`.

**Migrations são aplicadas à mão** no SQL Editor, em ordem numérica. Cada arquivo
traz no cabeçalho o que muda, como verificar e como reverter —
mantenha esse padrão. `supabase migration list` **não** reflete o banco: a
tabela de controle do CLI só conhece as primeiras.

**Windows gera CRLF.** Teste que compara texto de arquivo normaliza a quebra de
linha, ou falha em checkout Windows e passa no CI (já aconteceu: `rls-055`).

## Testes

- Unitários em `tests/<nome>.test.js`, ESM:
  `import { describe, it, expect, beforeEach } from 'vitest'`.
- E2E é separado (Playwright, em `e2e/`) — não misturar com os unitários.
- Para testar função global de `js/`, use os helpers que já existem:
  `tests/_storage.cjs` (`requireStorage()` carrega a fonte de `js/storage.js`),
  `tests/_parts.cjs` (utilitários de UI) e `createRequire(import.meta.url)` para
  CJS.
- Query do Supabase se mocka com o padrão `mockQ()` — builder que registra as
  chamadas encadeáveis. Referência: `tests/pagination.test.js`.
- Um `it()` por comportamento. Prefira caso-limite e regra de negócio (escopo de
  team, RLS, estados de pendência) a asserção trivial.
- Antes de escrever, leia um ou dois testes do mesmo domínio e espelhe o estilo.
  São 95 arquivos; o estilo já está decidido.
- Teste novo não quebra teste existente: rode `npm test` até verde.

## Idioma e escrita

Código e identificadores em inglês quando já é assim no arquivo; **comentários,
descrições de teste, mensagens de commit e respostas ao usuário em português do
Brasil**. Comentário explica _por que_, não _o que_ — o projeto é consistente
nisso, siga o tom dos arquivos vizinhos.

## Commits

`tipo(escopo): resumo no imperativo`, em português — `feat(chamado):`,
`fix(testes):`, `refactor(supabase-server):`, `chore(n8n):`. O corpo explica o
problema que existia antes e por que a solução é essa; invariante que o teste
protege merece uma linha dizendo isso. Trabalho entra por PR, não por push
direto na `main`.

## Dois agentes no mesmo diretório

Claude Code e opencode rodam como processos separados, **sem lock entre eles**.
Dois editando o mesmo arquivo: o último a salvar vence, sem aviso. Então: um por
vez na mesma árvore, ou cada um no seu `git worktree` com branch próprio. Quem
termina, commita antes de passar a bola — o git é a única coordenação que existe.

## Onde está o resto

| Arquivo                                              | Para quê                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------ |
| [README.md](README.md)                               | funcionalidades, estrutura, Edge Functions, deploy           |
| [GOOGLE-AGENDA.md](GOOGLE-AGENDA.md)                 | robô Apps Script, triagem de e-mail e as rotas de IA no Make |
| [AUDITORIA.md](AUDITORIA.md)                         | achados de auditoria e o que já foi fechado                  |
| [PENDENCIA-CRITICA-RLS.md](PENDENCIA-CRITICA-RLS.md) | histórico do problema de RLS                                 |

Agentes especializados ficam em `.claude/agents/` (Claude Code) e
`.opencode/agent/` (opencode). Eles herdam este arquivo — contêm só o que é
próprio do papel.
