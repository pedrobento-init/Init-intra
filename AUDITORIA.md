# AUDITORIA — Init Intra

> **Auditoria original:** 09/10/2026 (branch `audit/2026-10-09`) · **Reconciliada com o código em:**
> 17/11/2026 (HEAD `2815077`) — ver §15. Fases 1–10 concluídas
> (Fase 6 = SUSPEITas, §9 · Fase 7 = Edge Functions, §10 · Fase 8 = módulos novos, §11 ·
> Fase 9–10 = produção e banco, §12–§13 · Fase 2 de auth das functions, §14)
> **Segredos:** nenhum valor sensível é reproduzido aqui. Credenciais aparecem mascaradas
> (`https://****.supabase.co`, `sb_secret_****`, `<JWT-MASKED>`).

---

## 0. Resumo de status (17/11/2026)

Cada achado da §4 foi conferido contra o código atual e o `git log`. Onde não foi possível
confirmar, o status é **não verificado** — não foi inferido. Detalhe e evidência (commit ou
`arquivo:linha`) na coluna **Status** da §4.

| Situação                | Qtde | Achados                                                                                                                                                                                    |
| ----------------------- | ---: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Fechado / corrigido** |   34 | SEC-01, 02, 03, 04, 05, 06, 10, 12, 13, 14, 15, 17, 18, 21 · SYNC-01, 03, 06, 07, 08, 09, 10, 11, 12, 13, 14 · PERF-01, 02 · CONS-01, 02, 03, 04, 08, 10, 21                               |
| **Parcial**             |    4 | SEC-07 (`style-src-elem` ainda tem `unsafe-inline`, por causa do FullCalendar) · SEC-08 (trava só no cliente) · SYNC-02 (5 entidades na fila) · PERF-03 (fontes locais; scripts sem split) |
| **Decidido**            |    2 | SYNC-04 (`tickets` fail-closed, §13.5) · SYNC-05 (prefixo 011 mantido, §15.1)                                                                                                              |
| **Aberto**              |   13 | SEC-19 · PERF-05, 06, 07 · CONS-06, 11, 14, 15, 16, 17, 18, 19, 20                                                                                                                         |
| **Monitorar**           |    6 | SEC-09, 11, 16 · PERF-04 · CONS-05, 07                                                                                                                                                     |
| **Não verificado**      |    5 | SEC-20 · PERF-08 · CONS-09, 12, 13                                                                                                                                                         |

Reconciliação final de 17/11/2026, depois da rodada de refino: SEC-10, SYNC-01, 03, 09, 10, 12,
PERF-01 e CONS-01 foram fechados com teste; SEC-08, SYNC-02 e PERF-03 ficaram **parciais**, com o que
falta descrito na coluna Status. Nenhum item segue "em tratamento".

Pendências que dependem do dono do projeto (não do código): conferir no painel do Supabase os
limites de autenticação (§15.2), revogar a chave da Resend (§12.4) e confirmar se a migration
`053` está aplicada (§12.6).

---

## 1. Escopo e metodologia

Auditoria completa de **segurança, sincronização, performance e qualidade**, cobrindo:

| Camada                                | Arquivos                                                                     |
| ------------------------------------- | ---------------------------------------------------------------------------- |
| Frontend SPA (JS global, sem módulos) | `index.html` + 80 `js/*.js` (+ `config.example.js`) + `css/styles.css`       |
| PWA/Offline                           | `sw.js`, `js/outbox.js`, `js/sync-manager.js`, `js/db.js`                    |
| Backend                               | `supabase/migrations/*.sql` (83), 22 Edge Functions (`supabase/functions/*`) |
| Build/deploy                          | `tools/*`, `vercel.json`, `package.json`                                     |
| Testes                                | `tests/*.test.js` (139 arquivos) + 11 specs Playwright em `e2e/`             |

> Os números da tabela acima são de **17/11/2026**. Na auditoria de 09/10 eram 65 arquivos `js/`,
> 41 migrations, 9 functions e 48 testes.

Regras seguidas: nada foi inventado (todo achado cita `arquivo:linha`); incertezas estão marcadas
como **SUSPEITA**; nenhum segredo foi vazado; nenhuma migração foi executada; correções de baixo
risco em commits atômicos **um por correção**, sem `push`; tudo que altera contrato de API,
schema, migração ou UX ficou como **PROPOSTA**.

Ferramentas: varredura própria de templates/`innerHTML`, `npm audit`, `eslint`, `vitest`,
inspeção estática de RLS/policies, conferência de hashes SRI contra o CDN (download duplo).

---

## 2. Ambiente e baseline

| Item            | Antes                                                 | Depois                         |
| --------------- | ----------------------------------------------------- | ------------------------------ |
| `npm test`      | 537 pass / 1 fail (`build-assets` — `terser` ausente) | **546 pass / 0 fail**          |
| `npm run lint`  | 0 erros / 838 warnings                                | 0 erros / 838 warnings         |
| `npm run build` | ok (sem minify: `terser` não instalado)               | ok (**com minify**)            |
| `dist/`         | 73 arquivos / 4.323 KB (lixo acumulado)               | **33 arquivos / 953 KB**       |
| `npm audit`     | 5 (1 moderate, 2 high, 2 critical)                    | **3** (1 moderate, 2 critical) |
| Type-check      | inexistente (JS sem TS)                               | inexistente                    |

`npm audit` restante: `vitest` / `tinypool` / `@vitest/mocker` — todos **devDependencies**;
remediação exige `vitest@5.0.3` (breaking) → ver PROPOSTA P-6.

> A tabela acima é o baseline **histórico** de 09/10. P-6 foi aplicada depois (`vitest ^5.0.5`).

**Baseline atual (17/11/2026, HEAD `2815077` + esta reconciliação):**

| Item           | Valor                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------- |
| `npm test`     | **1867 pass / 0 fail** em 139 arquivos (inclui `tests/check-schema.test.js`)                                        |
| `npm run lint` | **0 erros / 0 warnings** (`eslint js tools --max-warnings 0`, `package.json:13`)                                    |
| Arquivos `js/` | 80 `.js` + `config.example.js`; `index.html` carrega 81 `<script src="js/…">` (conta o `config.js` gerado no build) |
| Migrations     | 83 arquivos (`001`–`082`; o prefixo `011` aparece duas vezes)                                                       |
| Edge Functions | 22 diretórios em `supabase/functions/`                                                                              |
| Saída do build | `build/` (não mais `dist/`; ambos ignorados pelo git)                                                               |

---

## 3. Mapa do sistema (Fase 1)

- **Banco:** (mapa de 09/10; hoje há mais tabelas — use `tools/check-schema.sql`, §13.6) 17 tabelas (`audit_logs`, `checklist_marcacoes`, `checklist_modelo_itens`,
  `checklists`, `client_devices`, `client_milvus_tickets`, `clients`, `email_notifications`,
  `equipamentos`, `milvus_client_map`, `operators`, `pendencias`, `procedure_templates`,
  `procedures`, `reunioes`, `tickets`, `visits`) + `storage.buckets(attachments)`.
- **Migrations:** `001`–`082` (hoje; eram `001`–`041` na auditoria; prefixo `011` **duplicado**, ver §15.1) + `migration.sql` legado.
  Duas estão marcadas pelo próprio repo como **“NÃO APLICAR”**: `021_rls_remediation.sql`
  e `022_storage_private.sql`.
- **Sync:** pull/push por entidade (`js/storage.js:766+`) com tombstones (TTL 30d),
  LWW por `updated_at` (`shouldApplyRemote`, `js/sync-manager.js:27`), outbox
  (`js/outbox.js`) e Realtime (`js/sync-manager.js`).
- **Deploy:** Vercel, CSP/HSTS/XFO em `vercel.json:5-19`, build `node tools/build-config.js && node tools/build-assets.js`.

---

## 4. Achados classificados (Fase 3)

Severidade: **CRÍTICO** > ALTO > MÉDIO > BAIXO > INFO.
Confiança: ALTA (código/migração explícitos), MÉDIA, BAIXA/SUSPEITA (depende de config externa).
Status: **CORRIGIDO/FECHADO**, **PARCIAL**, **DECIDIDO**, **ABERTO** (inclui os “em tratamento”), **PROPOSTA**, **MONITORAR**, **NÃO VERIFICADO**.
Os status da §4 refletem o código de 17/11/2026 (§0 e §15); as seções de detalhe (§5–§11) preservam o texto histórico.

| ID      | Sev.     | Conf. | Achado                                                                                                                                                                                                                                                                      | Local                                                                                                                                                            | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------- | -------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEC-01  | CRÍTICO  | ALTA  | Bucket `attachments` **público** + policy `attachments public read` sem `TO` → leitura anônima de documentos de clientes; app grava `getPublicUrl` no banco                                                                                                                 | `supabase/migrations/017_storage_attachments.sql:1-8`, `js/storage.js:1160-1162`                                                                                 | **FECHADO** — código `0c4f5bf` + bucket `public=false` verificado (§13)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| SEC-02  | CRÍTICO  | ALTA  | Policies `FOR ALL USING (true) WITH CHECK (true)` **sem `TO`** (aplicam-se a `anon`) em 8 tabelas                                                                                                                                                                           | `supabase/migrations/004_procedure_templates.sql:25-27`, `018_reunioes.sql:33`, `035_equipamentos.sql:49`, diagnóstico próprio em `021_rls_remediation.sql:5-14` | **FECHADO** pela `042` — verificado em produção (§13)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| SEC-03  | ALTO     | ALTA  | Edge Function `send-email` **sem verificação de JWT/role**: aceita `from`/`to`/`html` arbitrários → relay/spoofing                                                                                                                                                          | `supabase/functions/send-email/index.ts:24-60`                                                                                                                   | **CORRIGIDO** — código valida operador e destinatários; `verify_jwt` ligado (§12)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| SEC-04  | ALTO     | ALTA  | Service Worker cacheava GETs autenticados do Supabase na Cache Storage (chave = URL, ignora `Authorization`) → dados de um usuário servidos a outra sessão                                                                                                                  | `sw.js` (handler `fetch`)                                                                                                                                        | **CORRIGIDO** `24d9160`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| SEC-05  | MÉDIO    | ALTA  | CDN `motion@13.1.1` carregado **sem `integrity`** (SRI)                                                                                                                                                                                                                     | `index.html:294`                                                                                                                                                 | **CORRIGIDO** `6ca1acc`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| SEC-06  | MÉDIO    | ALTA  | URL/chave do Supabase sobrescrevíveis via `localStorage` (`intra_supabase_url`/`intra_supabase_key`)                                                                                                                                                                        | `js/supabase-config.js:12-14,38-39`                                                                                                                              | **FECHADO** — override via `localStorage` removido; `js/supabase-config.js:5-13` só lê `js/config.js` e limpa as chaves antigas (verificado em 17/11/2026)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| SEC-07  | MÉDIO    | ALTA  | CSP com `script-src 'unsafe-inline'` e `style-src 'unsafe-inline'` → não mitiga XSS inline (`onclick` no HTML gerado)                                                                                                                                                       | `vercel.json:5-19`                                                                                                                                               | **PARCIAL (ressalva única)** — `script-src` sem `'unsafe-inline'` (PR #113). `style-src` fechado: atributo `style=` eliminado do app (~620 estáticos viraram classes em `css/utilidades.css`; ~50 dinâmicos viraram `data-sty`, aplicado por `js/estilo-dinamico.js` via CSSOM); CSP com `style-src 'self'` e `style-src-attr 'none'`. **Risco residual:** `style-src-elem` mantém `'unsafe-inline'` porque o FullCalendar 6 injeta `<style>` sem nonce (Vercel estático não gera nonce); CSS injetado não executa script, mas poderia exfiltrar por `url()` em `img-src https:`. Sai com o FullCalendar ou com nonce. Exceção deliberada: HTML de e-mail e do `.xls` de visitas mantêm `style=`. `tests/csp-style.test.js` trava isso. |
| SEC-08  | MÉDIO    | ALTA  | Rate-limit de login só em memória (`_loginGuard`), zera no reload; sem trava server-side                                                                                                                                                                                    | `js/auth.js:6-27`                                                                                                                                                | **PARCIAL** — a trava de login agora sobrevive ao reload (`localStorage`, backoff de 30 s a 30 min, contagem regressiva na tela: `js/auth.js`, `tests/login-guard.test.js`). É só atrito no cliente: quem limpa o storage a zera. Falta a trava **server-side**, que é do Supabase Auth — ver §15.2                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| SEC-09  | BAIXO    | ALTA  | `Access-Control-Allow-Origin: *` em todas as 9 Edge Functions (mitigado pela checagem de JWT, quando existe)                                                                                                                                                                | `supabase/functions/*/index.ts`                                                                                                                                  | **MONITORAR** — as functions agora usam `withSupabase`, que cuida de CORS/preflight (`supabase/functions/send-email/index.ts:26-27`); não há mais `Access-Control-Allow-Origin: *` escrito à mão no repo, mas a origem efetivamente permitida **não foi verificada**; ver §15.2                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| SEC-10  | BAIXO    | ALTA  | Upload de anexos valida **apenas tamanho** (2 MB); sem allowlist de tipo/extensão                                                                                                                                                                                           | `js/storage.js:1145,1227,1374,1444`                                                                                                                              | **FECHADO** — `validateAttachmentFile` (`js/storage-anexos.js`) exige extensão na allowlist e MIME coerente com ela, barra extensão perigosa em qualquer posição (`a.pdf.exe`, svg, html), sanitiza o nome e é usada em todos os caminhos de upload e na renderização; `tests/attachment-allowlist.test.js`. Não olha magic bytes: a barreira real segue sendo o bucket privado                                                                                                                                                                                                                                                                                                                                                         |
| SEC-11  | INFO     | ALTA  | Credenciais antigas já estiveram no histórico Git (papel `anon`, removidas em `9ea37ad`); nenhum `service_role` vazado                                                                                                                                                      | histórico Git                                                                                                                                                    | MONITORAR (rotacionar se exposto)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| SEC-12  | INFO     | MÉDIA | XSS: varredura dos 93 `${...}` em `innerHTML`; todos os pontos com dado do usuário conferidos escapam (`escapeHtml`/`esc`/`_richEsc`/`textContent`)                                                                                                                         | `js/*`                                                                                                                                                           | **RESOLVIDO** — nenhum XSS (§9)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| SEC-13  | ALTO     | ALTA  | `equipamentos all` — `FOR ALL USING (true) WITH CHECK (true)` **sem `TO`** (`anon` lê e escreve) e criada **depois** da `021`, que só derruba 8 tabelas → aplicar `021` **não fecha esta**                                                                                  | `supabase/migrations/035_equipamentos.sql:49`, `021_rls_remediation.sql:68-75`                                                                                   | **FECHADO** pela `042` (§13)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| SEC-14  | MÉDIO    | ALTA  | `checklists` e `checklist_modelo_itens` com `SELECT ... USING (true)` **sem isolamento por equipe** (escrita é admin-only); `checklist_marcacoes` já é team-scoped                                                                                                          | `supabase/migrations/041_checklists.sql:157-158,174-176`, `040_checklist.sql:62-63`                                                                              | **FECHADO** pela `042` (§13)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| SEC-15  | MÉDIO    | ALTA  | **CSV/XLSX injection**: 4 exportadores não neutralizam células iniciadas por `=`/`+`/`-`/`@`; o `exportCSV` genérico também não escapa `;`/quebra de linha (quebra colunas)                                                                                                 | `js/ui.js:836-839`, `js/visitas.js:685-687`, `js/equipamentos.js:905`, `js/milvus-devices.js:520`                                                                | **CORRIGIDO** `53c9fe7`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| SEC-16  | BAIXO    | ALTA  | Nenhuma das 9 Edge Functions tem rate limit/quotas; autenticadas, podem ser chamadas em loop (consumo da API Milvus/Resend)                                                                                                                                                 | `supabase/functions/*/index.ts`                                                                                                                                  | MONITORAR (não reverificado; hoje são 22 functions)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| SYNC-01 | MÉDIO    | MÉDIA | **SUSPEITA** — `pull` sem `.range()`: se o PostgREST `max-rows` (padrão 1000) truncar, linhas ausentes são tratadas como “deletadas no servidor” e **descartadas do merged** → perda local                                                                                  | `js/storage.js:834`, `js/schema.js:295-297`                                                                                                                      | **FECHADO** — `_pullPaged` pagina com `.range()` (`js/storage.js`); `tests/sync-parcial.test.js` prova 2.500 linhas contra um servidor que corta em 1000                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| SYNC-02 | BAIXO    | ALTA  | Outbox cobre **só `pendencias`**; demais entidades sobem só no próximo ciclo de sync                                                                                                                                                                                        | `js/storage.js:1910`, `js/storage.js:953`                                                                                                                        | **PARCIAL** — a fila cobre `pendencias`, `clients`, `visits`, `reunioes`, `equipamentos` e `vencimentos` (`js/outbox.js`, `tests/outbox-entidades.test.js`), com LWW no drain. Fora por decisão: `operators` (reenviar payload velho poderia desfazer mudança de papel/equipe) e `time_entries`, `emails_triagem`, `respostas_prontas`, `procedures`, `procedure_templates` (seguem no sync normal)                                                                                                                                                                                                                                                                                                                                     |
| SYNC-03 | BAIXO    | MÉDIA | **SUSPEITA** — `applyRemote` reescreve a lista inteira via `dbSet` em paralelo com o merge do sync (corrida de escrita perdida)                                                                                                                                             | `js/sync-manager.js:143`                                                                                                                                         | **FECHADO** — `_reconcileConcurrentEdits` (`js/schema.js`) reconcilia o merge com o local atual depois do push; `applyRemote` não deixa ponto de suspensão entre ler e gravar; `tests/sync-concorrencia.test.js`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| SYNC-04 | MÉDIO    | ALTA  | `tickets` sem policies + RLS ligado = **fail-closed** (sync de `tickets` nega tudo)                                                                                                                                                                                         | `021_rls_remediation.sql:9-12`                                                                                                                                   | DECIDIDO (16/11/2026): mantido fail-closed, ver §13.5                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| SYNC-05 | MÉDIO    | ALTA  | Prefixo `011` duplicado (`011_rls_roles_teams.sql` + `011_visit_time_range.sql`) → ordem de aplicação ambígua                                                                                                                                                               | `supabase/migrations/011_*.sql`                                                                                                                                  | **DECIDIDO** (17/11/2026): não renomear; a ordem de aplicação foi escrita no cabeçalho dos dois arquivos 011 — ver §15.1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| PERF-01 | MÉDIO    | ALTA  | `select('*')` sem paginação no pull de todas as entidades (+ `audit_logs` `select('*')` com 500 linhas)                                                                                                                                                                     | `js/storage.js:834,1012`, `js/checklist.js:348,366,405`                                                                                                          | **FECHADO** — `audit_logs` e os três pulls de `checklist.js` selecionam colunas explícitas; `tests/pull-colunas.test.js`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| PERF-02 | MÉDIO    | ALTA  | `dist/` nunca era limpo → 4.323 KB/73 arquivos acumulados                                                                                                                                                                                                                   | `tools/build-assets.js`                                                                                                                                          | **CORRIGIDO** `12c875f`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| PERF-03 | MÉDIO    | ALTA  | 32 `<script defer>` sem code-splitting + CSS de fontes bloqueante (3 famílias)                                                                                                                                                                                              | `index.html:285-330`, `:13`                                                                                                                                      | **PARCIAL** — fonte bloqueante resolvida: Manrope auto-hospedada (`css/fonts.css`, `fonts/`, `font-display: swap`, sem Google Fonts na CSP). Os scripts `defer` seguem sem code-splitting; só as bibliotecas pesadas carregam sob demanda                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| PERF-04 | BAIXO    | ALTA  | Contadores do quadro baixam `status,deadline` de todo o escopo a cada render                                                                                                                                                                                                | `js/storage.js:1726-1731`                                                                                                                                        | MONITORAR (não reverificado)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| CONS-01 | MÉDIO    | ALTA  | **398 `catch` vazios** (`catch (_) {}`); regra `no-empty` desligada → falhas silenciosas                                                                                                                                                                                    | `js/*`, `eslint.config.js`                                                                                                                                       | **FECHADO** — 0 `catch` vazio sem log ou comentário (eram 348); `no-empty` e `caughtErrors` ligados no ESLint; `tests/catch-vazio.test.js` tranca. 27 ficam só com comentário, de propósito                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| CONS-02 | MÉDIO    | ALTA  | 838 warnings de lint, **100% `no-unused-vars`** (0 erros)                                                                                                                                                                                                                   | `js/`, `tools/`                                                                                                                                                  | **FECHADO** — `npm run lint` roda com `--max-warnings 0` (`package.json:13`) e passa; `no-unused-vars` com `vars: 'local'` (`eslint.config.mjs`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| CONS-03 | MÉDIO    | ALTA  | `terser` declarado no `package.json` mas não instalado → build sem minify + teste falhando                                                                                                                                                                                  | `tools/build-assets.js:41-47`                                                                                                                                    | **CORRIGIDO** — `terser` em `package.json:25` e instalado por `npm ci`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| CONS-04 | MÉDIO    | ALTA  | 3 CVEs restantes em devDeps exigindo `vitest@5` (breaking)                                                                                                                                                                                                                  | `package.json`                                                                                                                                                   | **FECHADO** — `vitest ^5.0.5` (`package.json:26`); `npm audit` zerado segundo §8/§14.3 (não reexecutado)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| CONS-05 | INFO     | ALTA  | Sem type-check em nenhum etapa                                                                                                                                                                                                                                              | `package.json`                                                                                                                                                   | MONITORAR (inalterado)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| CONS-06 | INFO     | ALTA  | Código morto: `_daySummary` é calculado (`buildDaySummary`) mas **nunca lido** — o sink do resumo diário não existe mais desde o redesign do dashboard                                                                                                                      | `js/app.js:705-710`, `js/metrics.js:453`                                                                                                                         | **ABERTO** — `_daySummary` ainda calculado e não lido (`js/app.js:744-749`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| CONS-07 | INFO     | ALTA  | `clients.milvus_client_token` (identificador por cliente, não o API token) é sincronizado ao navegador e fica no IndexedDB; visível só p/ a equipe dona via RLS                                                                                                             | `js/schema.js:22`, `js/clients.js:190,1513`                                                                                                                      | MONITORAR (inalterado)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| CONS-08 | INFO     | MÉDIA | Exportação de `.ics` escapa `,` `;` e `\n`, mas não `\` nem CR solto (`_icsEscape`) — permite injeção de escape no arquivo de calendário                                                                                                                                    | `js/calendar.js:683-685`                                                                                                                                         | **CORRIGIDO** `53c9fe7`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| SEC-17  | ALTO     | ALTA  | XSS armazenado no badge de timer: nome do operador (editável no próprio perfil) interpolado cru no atributo `title` e injetado via `innerHTML`                                                                                                                              | `js/timer.js:69` (origem `js/operadores.js:361,539`, `js/storage.js:3240-3255`, `js/timer.js:153,188`)                                                           | **CORRIGIDO** `3a3c13e`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| SEC-18  | ALTO     | ALTA  | XSS por atributo na logo do cliente: `_safeLogoUrl` só valida o prefixo `http(s)://` e não escapa aspa; o campo “URL da Logo” é texto livre                                                                                                                                 | `js/ui.js:450` (`_safeLogoUrl`), `js/clients.js:1462,1629,1842`                                                                                                  | **CORRIGIDO** `5b68c86`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| SEC-19  | BAIXO    | MÉDIA | Busca persistida (`localStorage`) injetada cru em `value="..."` (self-XSS) e, ao entrar na tela, o filtro restaurado **não** é aplicado à grade                                                                                                                             | `js/clients.js:60,51` + `js/ui.js:222-230`                                                                                                                       | **ABERTO** — `value="${filterState.search                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |     | ''}"` segue sem escape (`js/clients.js:61`) |
| SEC-20  | BAIXO    | MÉDIA | Criar/editar modelos de procedimento compartilhados não tem gate de papel, enquanto excluir exige admin                                                                                                                                                                     | `js/templates.js:127,161` vs `:262-275`                                                                                                                          | NÃO VERIFICADO                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| SYNC-06 | CRÍTICO  | ALTA  | Editar pendência pelo formulário principal zera no **servidor** anexos, notas/feed, checklist, `visit_id`, conclusão e timers: o payload montado no form não leva esses campos e o `upsert` os envia como `[]`/`null`                                                       | `js/pendencias.js:1351-1358` + `js/storage.js:1878-1906` (merge local `:1788`)                                                                                   | **CORRIGIDO** `812ab0d`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| SYNC-07 | ALTO     | ALTA  | Mesmo padrão em visitas: `upsert` zera `categories`/`checklist` e os 8 campos `milvus_*` e reatribui `numero` (`_visitNumeroOf`)                                                                                                                                            | `js/visitas.js:399-414` + `js/storage.js:2452-2478`                                                                                                              | **CORRIGIDO** `812ab0d`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| SYNC-08 | MÉDIO    | MÉDIA | Se `CHANNEL_ERROR`/`TIMED_OUT` acontece com a aba oculta, o backoff aborta e `visibilitychange` não reconecta (`!_channel` continua verdadeiro) → canal realtime morto até `online`/reload                                                                                  | `js/sync-manager.js:196-202,223`                                                                                                                                 | **CORRIGIDO** `9bf6644` (PR #112); teste `tests/sync-manager-realtime.test.js`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| SYNC-09 | MÉDIO    | ALTA  | Fila offline sem `max-attempts`/dead-letter: `attempts` é incrementado e nunca lido; uma entrada que falha sempre quebra o drain e bloqueia a fila inteira para sempre                                                                                                      | `js/outbox.js:100-108` (campo `:21`)                                                                                                                             | **FECHADO** — `OUTBOX_MAX_ATTEMPTS` e entrada `dead` não bloqueiam a fila; a falha agora aparece (toast) e a lista "Aguardando envio" (`js/pendentes.js`) oferece reenviar ou descartar; `tests/outbox.test.js`, `tests/outbox-entidades.test.js`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| SYNC-10 | MÉDIO    | MÉDIA | `deletePendencia` não remove a entrada já enfileirada para o mesmo id → o próximo drain recria o registro no servidor (e broadcast nos demais aparelhos)                                                                                                                    | `js/storage.js:2019-2031` vs `js/outbox.js:41-46`                                                                                                                | **FECHADO** — `deletePendencia` remove a entrada pendente do mesmo id (`Outbox.removeTarget`); `tests/outbox-exclusao.test.js`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| SYNC-11 | MÉDIO    | MÉDIA | `applyRemote` nunca executa `onMerged` (só `pinHash`/`pinSalt` hardcoded) → a proteção “remoto sem `numero` não apaga o local” vale só no pull; pelo realtime o `null` sobrescreve                                                                                          | `js/sync-manager.js:113-136` vs `js/schema.js:165-174`                                                                                                           | **CORRIGIDO** `9bf6644` (PR #112): `applyRemote` respeita o `onMerged`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| SYNC-12 | BAIXO    | MÉDIA | Entrada de entidade desconhecida é apagada e contada como `sent` (perda offline disfarçada de sucesso); o campo `op` (delete) gravado no enqueue é ignorado — o drain sempre faz `upsert`                                                                                   | `js/outbox.js:100-104`                                                                                                                                           | **FECHADO** — entidade desconhecida vira `dead` com motivo, não `sent`; `op: delete` é respeitado; `tests/outbox.test.js`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| SYNC-13 | SUSPEITA | BAIXA | Só 7 das 15 stores do Dexie têm `try/catch` individual no boot; se `toArray()` lançar, o cache fica vazio e a primeira `dbSet` faz `bulkDelete` das linhas “stale”                                                                                                          | `js/db.js:157-175` vs `:229-246`                                                                                                                                 | **CORRIGIDO** `48278d1` (PR #112)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| SYNC-14 | MÉDIO    | MÉDIA | `saveEquipamento` não checa papel/equipe (só `delete` é admin) e um ativo **sem cliente** herda o `team` default → edição pode reescrever o dono do registro                                                                                                                | `js/equipamentos.js:685-698,720` + `js/storage.js:2603-2619`                                                                                                     | **CORRIGIDO** `396753c` (PR #112)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| PERF-05 | MÉDIO    | MÉDIA | Cada retorno de aba dispara sync completo (pull de todas as entidades) sem cooldown — só existe dedup de sync em voo                                                                                                                                                        | `js/global-search.js:450-454`                                                                                                                                    | **ABERTO** — `visibilitychange` ainda dispara sync completo sem cooldown (`js/global-search.js:547-551`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| PERF-06 | MÉDIO    | ALTA  | Aplicar modelo a N clientes roda N× `saveProcedure`: cada iteração regrava a lista inteira no IndexedDB + 1 upsert HTTP + 1 audit log (O(N) local × N = O(N²))                                                                                                              | `js/templates.js:263-272` (`js/storage.js:2681,2693,2694,2697`)                                                                                                  | **ABERTO** — `js/templates.js:272-283` ainda chama `saveProcedure` por cliente                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| PERF-07 | MÉDIO    | MÉDIA | `select('item_id, client_id')` de todas as marcações sem `.range()` → truncamento silencioso pelo `max-rows` do PostgREST e contagem errada no modo Gerenciar                                                                                                               | `js/checklist.js:424`                                                                                                                                            | **ABERTO** — `js/checklist.js:424` segue sem `.range()`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| PERF-08 | BAIXO    | ALTA  | SLA e saúde do cliente recalculados para **todos** os clientes a cada render da grade                                                                                                                                                                                       | `js/clients.js:98-100`                                                                                                                                           | NÃO VERIFICADO                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| CONS-09 | MÉDIO    | ALTA  | `if (!q) return false` no topo torna o `if (!q) return true` da linha seguinte inalcançável → atalhos `status:`/`cliente:` nunca retornam equipamentos (clientes e pendências retornam)                                                                                     | `js/global-search.js:162,169`                                                                                                                                    | NÃO VERIFICADO (o trecho mudou; `js/global-search.js:160-200`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| CONS-10 | MÉDIO    | ALTA  | Se o próprio callback lançar, o `catch` o reexecuta → render duplicado e erro original engolido                                                                                                                                                                             | `js/app-events.js:58-66`                                                                                                                                         | **FECHADO** — o `catch` agora só avisa, sem reexecutar o callback (`js/app-events.js:41-46`); commit não identificado                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| CONS-11 | BAIXO    | ALTA  | `#syncNowBtn` não existe em HTML nenhum (só `#syncStatus`, que já tem `onclick`) → estado “Sincronizando…”/disabled é código morto (testes mockam o id inexistente)                                                                                                         | `js/global-search.js:404` vs `index.html:162`                                                                                                                    | **ABERTO** — `#syncNowBtn` ainda ausente do `index.html` e referenciado em `js/global-search.js:501`, `js/storage.js:48`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| CONS-12 | INFO     | ALTA  | Early-return para `_refreshSyncBanner()`, que é no-op porque `#offlineBanner` saiu do `index.html` → fallback de status de conexão inalcançável                                                                                                                             | `js/global-search.js:61-67` + `js/storage.js:37,46,64-66`                                                                                                        | NÃO VERIFICADO                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| CONS-13 | INFO     | ALTA  | Definidos e exportados, nunca lidos: `_getPendingSyncCountSafe`, `_getPendingSyncText` e o campo `pendingPayload` do cache                                                                                                                                                  | `js/global-search.js:47,52,462`, `js/app-events.js:48`                                                                                                           | NÃO VERIFICADO                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| CONS-14 | INFO     | ALTA  | Funções redefinidas em arquivo posterior sobrescrevem as anteriores (ordem de carga): `isPendenciaResolvida`/`getPendenciaAssunto`/`getPendenciaTitulo`/`getNoteSnippet`/`parseSearchShortcuts`                                                                             | `js/metrics.js:21,217,235,474` vs `js/ui.js:367-375`, `js/global-search.js:16,33`                                                                                | **ABERTO** — redefinições seguem em `js/ui.js:438-446`, `js/metrics.js:21,219,237,478` e `js/global-search.js:16,33`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| CONS-15 | INFO     | ALTA  | `filterItemsByDateRange` (+ `_parseDashItemDate`) só é chamada por teste                                                                                                                                                                                                    | `js/metrics.js:316,306`                                                                                                                                          | **ABERTO** — `filterItemsByDateRange` segue em `js/metrics.js:318`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| CONS-16 | INFO     | ALTA  | Alias `timerButtonHTML` nunca chamado e ramo `type === 'ticket'` de `toggleTimer` inalcançável (só se chama com `pendencia`)                                                                                                                                                | `js/timer.js:137-139,332` vs `js/pendencias.js:742,1050`                                                                                                         | **ABERTO** — alias `timerButtonHTML` segue em `js/timer.js:516`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| CONS-17 | BAIXO    | ALTA  | Poll de abertura de registro (25×120 ms) nunca cancelado por navegação → toast “Registro não encontrado” enganoso até 3 s depois                                                                                                                                            | `js/global-search.js:298-315`                                                                                                                                    | **ABERTO** — poll 25×120 ms segue em `js/global-search.js:408`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| CONS-18 | BAIXO    | ALTA  | Aplicar modelo a N clientes sem `try/catch` nem agregação: exceção no meio aborta em silêncio e o toast de sucesso é incondicional                                                                                                                                          | `js/templates.js:262-275`                                                                                                                                        | **ABERTO** — `js/templates.js:272-283` sem `try/catch` e com toast incondicional                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| CONS-19 | MÉDIO    | MÉDIA | Exportação `.ics` ignora `timeEnd`/`end` — nenhum `VEVENT` tem `DTEND`/`DURATION` (evento termina no início, duração zero)                                                                                                                                                  | `js/calendar.js:705-718`                                                                                                                                         | **ABERTO** — `.ics` segue só com `DTSTART` (`js/calendar.js:794-807`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| CONS-20 | BAIXO    | MÉDIA | “Tentar novamente” do FullCalendar injeta uma 2ª `<script>` da mesma URL (`loadScript` só cacheia em `onload`) → download duplo e reexecução                                                                                                                                | `js/calendar.js:464,469` + `js/ui.js:5,10`                                                                                                                       | **ABERTO** — `loadScript` só cacheia em `onload` (`js/ui.js:4-13`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| CONS-21 | SUSPEITA | MÉDIA | `moreLinkClick` monta a data via `toISOString()` (UTC) enquanto `dateClick` usa `dateStr` (local) → dia errado a leste de UTC (em pt-BR, UTC-3)                                                                                                                             | `js/calendar.js:522` vs `:518`                                                                                                                                   | **FECHADO** — `moreLinkClick` usa `localDateISO(info.date)` (`js/calendar.js:612-615`); commit não identificado                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| SEC-21  | MÉDIO    | ALTA  | Edge Function órfã `resend-email` ativa em produção **sem fonte no repositório**: template de exemplo do Supabase (`from: "you@example.com"`), sem checagem de operador nem allowlist de destinatário — qualquer usuário logado enviava e-mail arbitrário pela conta Resend | produção (não versionada); secret `RESEND_API_KEY` desde 22/07                                                                                                   | **CORRIGIDO** (§12) — função e secret removidos                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

---

## 5. Detalhamento dos CRÍTICO/ALTO

### SEC-01 — Bucket de anexos legível por anônimos (CRÍTICO)

`017_storage_attachments.sql:1-8` cria o bucket com `public = true` e
`create policy "attachments public read" ... for select using (bucket_id = 'attachments')`
**sem cláusula `TO`** → vale para `anon`. O app então persiste a URL pública no banco
(`js/storage.js:1162`). A remediação existe (`022_storage_private.sql`) mas está marcada
**“NÃO APLICAR”** porque exige (a) troca do app para signed URLs e (b) conferência da
convenção de paths antes de aplicar as policies por equipe.
**Impacto:** qualquer pessoa com a URL lê documentos de clientes/pendências.
**Não corrigido aqui** (migração = risco destrutivo, exigiria DBA).

### SEC-02 — RLS permissivo em 8 tabelas (CRÍTICO)

`004`, `018`, `035` criam policies `FOR ALL USING (true) WITH CHECK (true)` sem `TO`,
anulando as policies por equipe e valendo inclusive para `anon`. O próprio repo documenta o
estado em produção em `021_rls_remediation.sql:5-14` (“confirmado em produção via
pg_policies”; `014` nunca aplicada; `visits` só com delete).
**Impacto:** leitura/escrita sem autorização em `reunioes`, `equipamentos`,
`procedure_templates` e demais tabelas do bloco.
**Não corrigido aqui** (migração).

### SEC-03 — Relay de e-mail aberto (ALTO)

`send-email/index.ts` só valida `method`, `RESEND_API_KEY`, `to`, `subject` e `html`.
Não lê `authorization`, não chama `admin.auth.getUser` e não limita remetente.
Comparação: `update-user-password/index.ts:44-66` faz exatamente o fluxo correto
(JWT → `is_admin` → 403).
**Impacto:** envio arbitrário de e-mails em nome do domínio da empresa (phishing interno).
**Não corrigido aqui** por ser mudança de contrato da API (PROPOSTA P-3).

### SEC-04 — Service Worker cacheava dados autorizados (ALTO) — CORRIGIDO

O handler `fetch` cacheava qualquer GET cross-origin em `init-intra-cdn-*`. Respostas do
Supabase (`/rest/v1/*`, Storage) são autorizadas por `Authorization`, mas a **chave da cache é
apenas a URL**: uma resposta do usuário A podia ser servida numa sessão seguinte (troca de
usuário/aba offline). Colateral: `checkBackendConnectivity` podia receber `200` vindo da
cache e reportar “online” estando offline.
**Correção:** `sw.js:113-114` ignora requisições com `apikey`/`authorization`.
O offline-first não depende disso (roda por IndexedDB/outbox).

### SEC-05 — SRI ausente (MÉDIO) — CORRIGIDO

4 dos 5 scripts de CDN já tinham `integrity` (validados por download duplo, todos OK);
`motion@13.1.1` entrou sem. Hash conferido duas vezes no CDN
(`sha384-H2nNDydHmZprp4CMCumnXEUZpWPr9ifgL1W1PkhJj8awdAZ3QfvsGho12tqLeeBI`,
139.701 bytes, CORS `*`) e aplicado em `index.html:294-296`.

### SYNC-01 — Possível perda por truncamento do pull (SUSPEITA)

`js/storage.js:834` baixa a tabela inteira sem `.range()`. Se o projeto tiver
`db-max-rows` (padrão 1000 no Supabase) e a tabela exceder o limite, o pull retorna
parcial e `_mergeRecords` (`js/schema.js:295-297`) **descarta do merged** o que não veio
do remoto — comportamento correto para “deletado no servidor”, errado para “truncado”.
**Verificação sugerida (somente leitura):**
`select count(*) from pendencias;` e checagem de `Max rows` em _Project Settings → API_.

---

## 6. Correções aplicadas (Fase 4)

Branch `audit/2026-10-09`, **sem push**, 1 commit por correção, testes/lint/build rodando antes e depois:

| #   | Commit                    | Correção                                                                                                                                                                                                                                                                                                   | Testes                                                                                                             |
| --- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1   | `7ba3d0d` `chore(deps)`   | `npm audit fix` → `brace-expansion` 1.1.18→1.1.21 e `source-map-js` 1.2.1→1.2.2 (2 highs resolvidos, devDeps)                                                                                                                                                                                              | 537/537 ✓ lint 0 erros ✓                                                                                           |
| 2   | `12c875f` `fix(build)`    | `tools/build-assets.js` agora remove hashes antigos de `dist/js` e `dist/css` antes de finalizar (`removed` reportado no build)                                                                                                                                                                            | **novo teste** `tests/build-assets.test.js` (5) ✓ build: 72 obsoletos removidos, `dist/` 4.323 KB → 953 KB         |
| 3   | `6ca1acc` `fix(security)` | `integrity` + `crossorigin` em `motion@13.1.1` no `index.html`                                                                                                                                                                                                                                             | **novo teste** `tests/cdn-sri.test.js` (3): falha se qualquer script externo sair sem SRI                          |
| 4   | `24d9160` `fix(pwa)`      | SW não intercepta/cacheia GETs com `apikey`/`authorization`                                                                                                                                                                                                                                                | **novo teste** `tests/sw-cache.test.js` (5, sandbox `vm`): Supabase bypassado, mesmo-origem e CDN seguem cacheados |
| 5   | `53c9fe7` `fix(security)` | Helper único de célula CSV (`csvCell`/`csvRow` em `js/ui.js`) nos 4 exportadores: escape de `;`, aspa e quebra de linha + prefixo `'` em célula iniciada por `=`/`+`/`-`/`@`/tab/CR (número negativo puro preservado); `_icsEscape` escapa barra invertida e normaliza CRLF/CR/LF — fecha SEC-15 e CONS-08 | **novo teste** `tests/csv-export.test.js` (18) ✓ `npm test` 564/564 ✓                                              |
| 6   | `3a3c13e` `fix(security)` | `escapeHtml(worker)` no atributo `title` do badge de timer (`js/timer.js:69`) — fecha SEC-17; teste `tests/xss-attrs.test.js`                                                                                                                                                                              |
| 7   | `5b68c86` `fix(security)` | `_safeLogoUrl` com `new URL()` + `escapeHtml` no `src` do avatar (`js/ui.js`) — fecha SEC-18                                                                                                                                                                                                               |
| 8   | `812ab0d` `fix(sync)`     | payload remoto de `savePendencia`/`saveVisit` lido do registro mesclado (`_full`/`_fullV`), inclusive outbox e `numero` da visita — fecha SYNC-06/SYNC-07; teste `tests/push-payload.test.js`                                                                                                              |

**Estado final:** `npm test` **579/579** · `npm run lint` **0 erros / 838 warnings** ·
`npm run build` ok (com minify) · `index.html`/`sw.js` restaurados ao modo dev após validar o build ·
`git status` limpo (exceto `supabase/functions/milvus-chamado-create/index.ts`, debug, e
`referencia/`, fora do escopo — **não commitados**).

---

## 7. Propostas (não aplicadas) — prós e contras

Aplicadas nesta sessão: **P-17** (commit `53c9fe7`, fecha SEC-15 e CONS-08), **P-18** (commits `3a3c13e` e `5b68c86`, fecha SEC-17 e SEC-18) e **P-19** (commit `812ab0d`, fecha SYNC-06 e SYNC-07) — ver §6 e §11. As demais seguem não aplicadas.

> **Revisão de 22/10 (§12):** a metade de código da **P-1** já está em produção
> (`0c4f5bf`); falta só confirmar o bucket. A **P-3** está corrigida — a descrição
> do achado estava velha. A **P-2** segue intacta e continua sendo o bloqueador.

| #    | Proposta                                                                                                                                                  | Prós                                                                                   | Contras / risco                                                                                                                              |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| P-1  | Aplicar `022_storage_private.sql` + migrar o app para signed URLs (`js/storage.js:1162`)                                                                  | Fecha leitura anônima de anexos (SEC-01)                                               | Requer backup, conferência de paths (Q-INV1/2/3), código de signed URLs antes da migração; sem isso anexos quebram. **DBA + deploy atômico** |
| P-2  | Aplicar `021_rls_remediation.sql` (remove `X all USING (true)` e cria policies por equipe/admin)                                                          | Fecha SEC-02 em 8 tabelas                                                              | Exige DBA, staging e bateria de 13 testes; decisão pendente sobre `tickets` (SYNC-04)                                                        |
| P-3  | `send-email`: exigir JWT + papel `admin`/`gestao` e fixar `from` permitido                                                                                | Elimina relay aberto (SEC-03)                                                          | Altera contrato da API — clientes que chamam sem JWT passam a receber 401; precisa de deploy das 9 functions                                 |
| P-4  | Remover override via `localStorage` de URL/chave (ou exigir flag de build)                                                                                | Remove vetor de redirecionamento do backend (SEC-06)                                   | Perde o recurso de “apontar p/ outro projeto pelo console”, usado na documentação interna                                                    |
| P-5  | Tirar `unsafe-inline` do CSP (refatorar `onclick` globais p/ `addEventListener`)                                                                          | Mitiga XSS de verdade (SEC-07)                                                         | Grande refatoração de UI; risco de quebrar handlers gerados por template                                                                     |
| P-6  | Subir para `vitest@5` (resolve as 3 CVEs restantes)                                                                                                       | `npm audit` limpo                                                                      | Breaking: pode exigir mudar config/testes; precisa rodar a bateria completa                                                                  |
| P-7  | Rate-limit de login no servidor (ou tabela de tentativas)                                                                                                 | Fecha SEC-08 de verdade                                                                | Exige migração + lógica nova; o guard client-side é apenas informativo                                                                       |
| P-8  | Allowlist de MIME/extensão no upload de anexos                                                                                                            | Reduz upload de SVG/HTML hostil (SEC-10)                                               | Pode bloquear formatos legítimos se for restritivo demais                                                                                    |
| P-9  | Pull paginado (`.range()`) + colunas mínimas (`status,deadline`, etc.)                                                                                    | Resolve PERF-01 e mitiga SYNC-01                                                       | Tem que garantir `updated_at` em toda coluna selecionada, senão tombstone/merge quebram (risco de perda)                                     |
| P-10 | Outbox genérica (todas as entidades) + lock de escrita entre `applyRemote` e merge                                                                        | Fecha SYNC-02/SYNC-03                                                                  | Refatoração do caminho crítico de sync; exige testes de concorrência                                                                         |
| P-11 | ~~Renomear `011_visit_time_range.sql` p/ `012_*` (renumerar restantes)~~ **RECUSADA (17/11/2026)**: mantido o prefixo; ordem escrita no cabeçalho (§15.1) | Removeria a ambiguidade de ordem (SYNC-05)                                             | Renumerar quebra a rastreabilidade de um banco aplicado à mão; ganho baixo, já que os dois arquivos são independentes                        |
| P-12 | Code-splitting das telas + subset de fontes                                                                                                               | Reduz payload inicial (PERF-03)                                                        | Muda a ordem de carregamento global (`navigateTo` depende de globais)                                                                        |
| P-13 | Habilitar `no-empty` (exceto `_`) + log de erro mínimo nos `catch`                                                                                        | 398 falhas silenciosas viram visíveis (CONS-01)                                        | Gera centenas de alterações; precisa de janela dedicada                                                                                      |
| P-14 | Limpar `no-unused-vars` (838) em lotes                                                                                                                    | Lint zerado, morte reduzida (CONS-02)                                                  | Trabalho mecânico; risco de apagar variáveis “usadas por string/`window`”                                                                    |
| P-15 | Nova migration (ex.: `042_equipamentos_rls`) copiando o modelo da `021` para `equipamentos` (remover `"equipamentos all"`, policies por equipe/admin)     | Fecha SEC-13 — `equipamentos` continua aberto mesmo **depois** da `021`                | Exige DBA/staging; tabela nova em relação ao escopo da `021`, precisa do mesmo rollback documentado                                          |
| P-16 | Isolar `checklists`/`checklist_modelo_itens` por equipe (padrão `ckmarc`) ou manter leitura global                                                        | Fecha SEC-14 se for vazamento; mantém o fluxo atual se modelos são globais por desenho | **Decisão de produto**: mudar pode esconder modelos de quem precisa vê-los                                                                   |

---

## 8. Próximos passos

0. ~~**Imediato (Fase 8):** SYNC-06/SYNC-07 (perda de dados na edição) e SEC-17/SEC-18~~
   **Concluído** — commits `812ab0d` (SYNC-06/SYNC-07), `3a3c13e` e `5b68c86` (SEC-17/SEC-18);
   ver §6 e §11.

1. ~~**Urgente (DBA + staging):** P-1 e P-2 — as duas exposições CRÍTICO~~
   **SEM OBJETO (23/10, §13).** Conferido no banco: nenhuma policy permissiva em
   20 tabelas (a `042` fechou SEC-02/13/14) e `attachments.public = false`.
   **Nenhum trabalho de DBA está pendente por segurança.** As migrations `021` e
   `022` estão obsoletas — considerar removê-las para ninguém aplicar por engano.
   Em aberto nessa frente, só o SYNC-04 (`tickets` sem policy, fail-closed), que é
   decisão de produto, não exposição.
2. ~~**Alto:** P-3 (`send-email`) e P-6 (`vitest@5`)~~ **Concluído.**
   P-3: fechado por remetente fixo + allowlist de destinatário, **sem** o gate de papel
   (quebraria a notificação do operador comum); ver §12.3 e §14.3.
   P-6: `vitest@5.0.5`, `npm audit` de 4 vulnerabilidades (2 críticas) para **0**.
3. **Verificação (somente leitura):** confirmar `Max rows` da API Supabase e
   `select count(*)` das tabelas grandes (valida/refuta SYNC-01); rodar `tools/check-schema.sql`.
4. **Continuidade:** P-9 (pull paginado), P-13/P-14 (limpeza de código) e P-16
   (definir se checklists são globais ou por equipe).
5. **Antes de qualquer merge:** revisar os commits, rodar `npm test` + `npm run lint` +
   `npm run build` no CI e decidir sobre `push` (hoje **não** foi feito, conforme orientado).

---

## 9. Fase 6 — fechamento das SUSPEITas

Verificação adicional feita **depois** do relatório, para transformar SUSPEITas em
achado/nao-achado.

### SEC-12 (XSS) — nenhum XSS confirmado

Varredura completa dos **93** candidatos `${...}` interpolados em `innerHTML`/templates.
Pontos com dado do usuário verificados um a um:

| Ponto                                              | Por que é seguro                                                                |
| -------------------------------------------------- | ------------------------------------------------------------------------------- |
| Chips de cliente (`js/pendencias.js:337,342-345`)  | `name = escapeHtml(...)` antes de renderizar                                    |
| Painel “sobrecarregado” (`js/app.js:731,814`)      | `_ovOverTitle` passa por `escapeHtml`                                           |
| Modal de ticket Milvus (`js/clients.js:1134-1150`) | helper `ir()` recebe valores já `escapeHtml(...)` em cada chamada               |
| Cabeçalho da ficha (`js/clients.js:153-154`)       | `cfUpdatedMeta` escapa `updatedBy`; data via `formatDate` (`js/clients.js:749`) |
| E-mails (`js/notifications.js:215-422`)            | todos os campos de dados em `escapeHtml`                                        |
| Modal de preferências (`js/notifications.js:469`)  | só interpola booleans de `prefs`                                                |
| Toasts (`js/ui.js:188`)                            | `msgSpan.textContent` (não `innerHTML`)                                         |
| `onclick="...('${id}')"` gerados                   | ids vêm de `crypto.randomUUID()` (`js/storage.js:554`)                          |
| Enriquecimento de texto (`js/ui.js:1142`)          | `_richEsc` + `safeUrl` (`js/ui.js:89`) nos links                                |

Resíduo: **CONS-06** — `_daySummary` (`js/app.js:705-710`) é calculado e nunca lido
(`buildDaySummary` só é exercitado por `tests/dashboard.test.js:186`); sem sink, sem XSS.

### SEC-13 (novo, ALTO) — `equipamentos` escapou da remediação

A `021` derruba exatamente 8 policies `"X all"` (`021_rls_remediation.sql:68-75`).
`035_equipamentos.sql:49` é **posterior** e cria `"equipamentos all" FOR ALL USING (true)
WITH CHECK (true)` sem `TO` → `PUBLIC` (inclui `anon`). Nenhuma migration entre `036` e `041`
derruba essa policy. Consequência prática: **mesmo aplicando a `021`, `equipamentos` segue
lido e gravado por anônimos.**

### SEC-14 (novo, MÉDIO) — checklists sem isolamento de equipe

`041_checklists.sql:157-158` e `:174-176` (idem `040_checklist.sql:62-63`) criam
`SELECT ... TO authenticated USING (true)` — “leitura para todos” por comentário próprio,
enquanto `checklist_marcacoes` usa a regra de equipe (`041:192-195`). Escrita é admin-only.
Risco: operador de uma equipe lê checklists/modelos de clientes de outra equipe.

### SEC-15 (novo, MÉDIO) / CONS-08 — exportações CSV e `.ics` — CORRIGIDO

Quatro exportadores gravam conteúdo livre do usuário (relatório de visita, hostname/usuário
de inventário, nome de cliente) sem neutralizar o início de célula `=`/`+`/`-`/`@`:

| Exportador                                                                                | Escapa `;`/quebra | Neutraliza fórmula |
| ----------------------------------------------------------------------------------------- | ----------------- | ------------------ |
| `exportCSV` genérico (`js/ui.js:836-839`) — clientes, pendências, histórico, equipamentos | **não**           | **não**            |
| Relatório de visitas (`js/visitas.js:685-687`)                                            | sim (aspas)       | **não**            |
| Acerto de equipamentos (`js/equipamentos.js:905`)                                         | sim               | **não**            |
| Inventário Milvus (`js/milvus-devices.js:520`)                                            | sim               | **não**            |

Impacto: (a) abrir o CSV no Excel/LibreOffice avalia a fórmula (`=HYPERLINK(...)`,
`=cmd|...`); (b) em `exportCSV` um valor com `;` ou `\n` **desalinha as colunas** (quebra de
formato, independente de ataque). Mitigação **P-17 — aplicada em `53c9fe7`**: o conteúdo
exportado passa a ganhar aspas/prefixo ao abrir no Excel (conferir os 4 exportadores).

`CONS-08` (mesma família): `_icsEscape` (`js/calendar.js:683-685`) escapa `,` `;` e `\n`, mas
não a própria barra invertida nem CR solto.

> **CORRIGIDO em `53c9fe7` (P-17):** os 4 exportadores agora passam por um helper
> único (`csvCell`/`csvRow` em `js/ui.js`), que escapa ponto-e-vírgula, aspa dupla e
> quebra de linha (colunas deixam de desalinhar) e prefixa apóstrofo em célula iniciada
> por `=`, `+`, `-`, `@`, tab ou CR — números negativos puros são preservados.
> `_icsEscape` agora escapa a barra invertida antes de `;` e `,` e normaliza
> CRLF/CR/LF. A tabela acima descreve o estado **antes** da correção.

### Verificações negativas (confirmadas como OK)

- **`audit_logs`** continua admin-only: a `011` derruba as policies da `010` e recria
  `logs_select`/`logs_delete` com `current_op_is_admin()` (`011_rls_roles_teams.sql:262-290`).
- **`client_devices`**, **`milvus_client_map`**, **`client_milvus_tickets`** são team-scoped
  (`026_client_devices.sql:87-151`, `029_client_milvus_tickets.sql:56-81`).
- **Tokens Milvus:** `MILVUS_API_TOKEN` só em `Deno.env` (`milvus-atendimentos/index.ts:26`,
  `milvus-chamado-create/index.ts:80`); o front recebe apenas `clients.milvus_client_token`
  (identificador por cliente, visível à equipe dona via RLS) — **CONS-07**.
- **`visits`/`reunioes`/`procedure_templates`** seguem dentro do bloco das 8 tabelas da `021`
  (SEC-02).

---

## 10. Fase 7 — Edge Functions (9/9 na época; hoje são 22)

> Em 17/11/2026 há 22 functions (todas com `withSupabase`); as 13 que validam JWT são cobertas por
> `tests/edge-functions-auth.test.js` (§14). A tabela abaixo é o retrato das 9 originais.

Padrão observado em 8 das 9: `authorization` → `admin.auth.getUser(token)` (401 se inválido)
→ `operators` por `auth_user_id` (403 se inativo) → escopo (admin puro ou team-check do
cliente-alvo) → só então `service_role`.

| Função                  | JWT | Escopo                                                 | Observação                                                                                       |
| ----------------------- | --- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `milvus-atendimentos`   | ✓   | admin **ou** team (`:109-113`, `:175-205`)             | valida token por `milvus_client_token` + time dono                                               |
| `milvus-chamado-create` | ✓   | admin **ou** team (`:416-430`, `:464-469`, `:639-650`) | team-check antes de qualquer chamada/escrita                                                     |
| `milvus-devices`        | ✓   | admin **ou** team (`:432-464`)                         | lê `clients` antes de autorizar                                                                  |
| `milvus-tickets`        | ✓   | admin **ou** team (`:195-243`)                         | `404` se o cliente não existe, `403` se é de outra equipe (enumeração por id UUID é desprezível) |
| `milvus-client-names`   | ✓   | **admin only** (`:208+`)                               |                                                                                                  |
| `milvus-clients-import` | ✓   | **admin only** (`:141-150`)                            |                                                                                                  |
| `milvus-token-backfill` | ✓   | **admin only** (`:132-141`)                            | duas fases (prévia → commit)                                                                     |
| `update-user-password`  | ✓   | **admin only** (`:44-73`)                              | valida `password.length >= 8`                                                                    |
| `send-email`            | ✓   | operador **ativo** (`:62-71`)                          | remetente fixo + destinatário só de operador ativo (SEC-03 fechado — ver §12)                    |

Também verificado: nenhum valor de segredo aparece em log (só flags como
`hasToken=${!!clientToken}` e nomes de tabela/coluna) e `MILVUS_API_TOKEN`/`SERVICE_ROLE_KEY`
/`GMAIL_APP_PASSWORD` vêm sempre de `Deno.env` (o Resend saiu: a send-email e a avisos-prazo
usam Gmail SMTP).

Restrições registradas: **SEC-09** (`Access-Control-Allow-Origin: *` em todas — aceitável
enquanto a resposta exigir JWT) e **SEC-16** (nenhuma tem rate limit).

> Nota: `milvus-chamado-create/index.ts` está com alterações de debug **no working tree**
> (não commitadas); a leitura acima considera a versão de `HEAD`.

---

## 11. Fase 8 — módulos ainda não cobertos

Escopo novo: `db.js`, `outbox.js`, `sync-manager.js`, `global-search.js`, `metrics.js`,
`timer.js`, `calendar.js`, `app-events.js`, `templates.js`, `equipamentos.js`, `clients.js`
e `checklist.js`. Três varreduras independentes (leitura) + conferência manual, linha a
linha, dos achados de maior impacto. **30 achados novos** entram na tabela da §4
(SEC-17..SEC-20, SYNC-06..SYNC-14, PERF-05..PERF-08, CONS-09..CONS-21).

### 11.1 SEC-17 / SEC-18 — dois XSS armazenados que contradizem o SEC-12

O SEC-12 (“nenhum XSS”) varreu `${...}` dentro de `innerHTML` nos arquivos `js/*`; ficaram
de fora dois pontos em que o valor interpolado **não** passa por `escapeHtml`:

1. **`js/timer.js:69`** — o texto do badge escapa (`escapeHtml(worker)`), mas o atributo
   `title` interpola o nome cru:

   > `title="...${worker + ' está trabalhando neste item'}" ... ${escapeHtml(worker)}`

   O nome vem do próprio operador: ele edita o seu perfil (`js/operadores.js:361,539` —
   “só pode editar o seu próprio perfil”), `validateOperator` não restringe
   caracteres (`js/storage.js:3240-3255`), o nome vai para `user.name` e vira
   `timerOperator` (`js/timer.js:153,188`), que é sincronizado e renderizado nos aparelhos
   dos colegas pelo caminho `timerWidgetHTML` → `workerBadgeHTML` → `modalBody.innerHTML`
   (`js/pendencias.js:1036`, `js/ui.js:114`). Um `"` no nome quebra o atributo e adiciona
   handler inline — permitido pelo CSP atual (`script-src 'unsafe-inline'`, SEC-07).

2. **`js/ui.js:450`** — `src="${_safeLogoUrl(c.logo)}"`: `_safeLogoUrl` só testa o prefixo
   (`/^https?:\/\//i`) e devolve a URL **sem escapar aspa**, enquanto o campo é texto
   livre no formulário do cliente (“URL da Logo”, `js/clients.js:1462`, gravado em
   `:1629,1842`). `https://x/"onerror="...` passa no filtro e fecha o atributo. `clientAvatar`
   é chamado em 15 pontos do app (clientes, agenda, pendências, visitas, operadores…).

**Aplicado** (commits `3a3c13e` e `5b68c86`; testes `tests/xss-attrs.test.js`): `escapeHtml`
no `title` do badge e `_safeLogoUrl` com `new URL()` (aspa vira `%22`) + `escapeHtml` no `src`
do avatar; esquemas hostis seguem bloqueados. Fecha **SEC-17** e **SEC-18**.

### 11.2 SYNC-06 / SYNC-07 — perda de dados na edição (CRÍTICO/ALTO)

O formulário principal monta o payload só com os campos visíveis no form de pendência
(`js/pendencias.js:1351-1358`: id, cliente, tipo, assunto, descrição, responsável, status,
prioridade, prazo, link, tags, recorrência) — **sem** `attachments`, `notes`, `checklist`,
`visitId`, `reviewedInMeeting`, `completedAt/By` e campos de timer.

`savePendencia` **mescla localmente** (`js/storage.js:1788`: `list[i] = { ...list[i], ...data }`)
mas monta o payload remoto a partir do objeto parcial (`:1878-1906`):

> `attachments: data.attachments || []` / `notes: data.notes || []` /
> `checklist: data.checklist || []` / `visit_id: data.visitId || null` /
> `completed_at: data.completedAt || null` / `timer_total_seconds: 0` / `updated_at: now`

O `upsert` (`:1920`) ou a outbox (`_enqueuePen`, `:1909`) gravam `[]`/`null` no servidor;
o `updated_at` idempotente ao do registro local faz o merge do pull dar **empate ao remoto**
(`js/schema.js:299-313`), então o pull/realtime propaga o zero para todos os aparelhos —
inclusive para quem editou (o merge local é reescrito por `Object.assign` em
`js/sync-manager.js:113-136`). Resultado: anexos, feed de atividade, subtarefas, vínculo
com a visita, marcação de conclusão e tempo acumulado somem ao editar pelo form.

O mesmo vale para visitas: `js/visitas.js:399-414` não envia `numero`, `categories`,
`checklist` nem os 8 campos `milvus_*`, e o `upsert` de `js/storage.js:2452-2478` os grava
como `[]`/`null` — o `numero: _visitNumeroOf(data)` ainda gera **outro número** e
`maintainVisitNumeros` reatribui mais um por aparelho.

**Aplicado** (commit `812ab0d`; testes `tests/push-payload.test.js`): o payload remoto passa
a ler do registro mesclado (`_full`/`_fullV`), inclusive o enqueue da outbox (`_enqueuePen`) e
o `numero` da visita. Fecha **SYNC-06** e **SYNC-07**.

### 11.3 Demais achados de sincronização (SYNC-08..SYNC-14)

- **SYNC-09** (`js/outbox.js:100-108`): o `catch` incrementa `attempts` e faz `break`, mas
  `attempts` nunca é lido — sem teto nem dead-letter, uma entrada envenenada trava a fila
  inteira em todo `online`/`visibilitychange`, para sempre.
- **SYNC-10** (`js/storage.js:2019-2031`): `deletePendencia` grava tombstone e apaga no
  servidor, mas não remove a entrada já enfileirada → o drain seguinte recria o registro.
- **SYNC-11** (`js/sync-manager.js:113-136`): `applyRemote` não chama `onMerged`, então a
  proteção de `numero` só existe no pull; o realtime sobrescreve com `null`.
- **SYNC-08** (`js/sync-manager.js:196-202,223`): erro de canal com aba oculta deixa o
  canal morto (backoff aborta; `visibilitychange` exige `!_channel`, que continua truthy).

### 11.4 Qualidade/performance (CONS-09..CONS-21, PERF-05..PERF-08)

Os destaques: `CONS-10` (`js/app-events.js:58-66`, o `catch` reexecuta o callback e engole o
erro original), `CONS-09` (`js/global-search.js:162,169`, `return true` inalcançável),
`PERF-06` (`js/templates.js:263-272`, O(N²) local ao aplicar modelo em massa), `PERF-07`
(`js/checklist.js:424`, query sem `.range()` sujeita ao `max-rows`) e `CONS-19`
(`js/calendar.js:705-718`, `.ics` sem `DTEND`). Detalhes e linhas na tabela da §4.

### 11.5 Verificações negativas da Fase 8

- `onclick` com id interpolado (`calendar.js:427,435,441`, `templates.js:110-116`) — ids
  vêm de `crypto.randomUUID()` (`js/storage.js:553-555`).
- Tokens/secretos em URL, `console.log` com segredo, `eval`/`new Function`/`document.write`
  nos arquivos auditados: nenhum.
- `setInterval` órfão de timer (`js/timer.js:300`) — limpo no `visibilitychange` (`:314-329`).
- Assinaturas de bus Realtime duplicadas — todos os call sites têm guard de janela.
- “Pull vaza pendências de Gestão”: RLS server-side (`005`/`024`/`037`), não é client-side.
- `operators` sem filtro de time no pull: por design (`ops_select USING (true)`, `024:95-96`)
  e `pin_hash`/`pin_salt` não são mapeados (`js/schema.js:80-97`).

---

## 12. Fase 9 — estado real verificado em produção (22/10/2026)

Esta fase não leu código novo: ligou o repositório ao que está **rodando**, via
Supabase CLI (`functions list`, `functions download`, `secrets list`) e requisições
anônimas. Duas conclusões da auditoria estavam desatualizadas e uma exposição nova
apareceu.

### 12.1 P-1 / SEC-01 — o código já está feito → **e o bucket também, ver §13.3**

> A sondagem anônima abaixo era indício, não prova. Em 23/10 a consulta ao
> banco confirmou: `attachments.public = false`.

`0c4f5bf` (PR #27) implementou os links assinados que a P-1 exigia:
`signedStorageUrls` com TTL de 1 h, cache e fallback que extrai o caminho de anexos
antigos (`js/storage-anexos.js:93-130`). O `getPublicUrl` que sobrou (`:89`) só grava
a URL legada junto do `path`; a leitura passa pelo link assinado.

**O que falta é confirmar o bucket.** Requisição anônima a
`/storage/v1/object/public/attachments/<inexistente>` devolve `Bucket not found` —
consistente com bucket privado, **mas não é prova**: um bucket inexistente devolve a
mesma mensagem (controle feito). Como o `attachments` existe, a leitura provável é
que a `022` foi aplicada. Confirmar com:

```sql
select id, public from storage.buckets where id = 'attachments';
```

### 12.2 P-2 / SEC-02 — ~~segue aberto~~ → **fechado, ver §13.1**

> Escrito em 22/10, quando não havia como consultar o banco. A consulta foi
> feita em 23/10 e deu o oposto: zero policies permissivas, fechadas pela
> `042`. O texto abaixo fica como registro do que se sabia na época.

A `021_rls_remediation.sql` tem no cabeçalho **"ARQUIVO PARA REVISÃO. NÃO APLICAR"** —
não é uma migration pronta. Continua valendo o que a §8 diz: DBA, staging, backup, a
bateria de testes e a decisão sobre `tickets`.

Não foi possível verificar daqui: o CLI conecta ao banco, mas nenhum relatório de
`inspect db` lista policies e o `db dump` exige Docker. A consulta que decide:

```sql
select tablename, policyname, roles, cmd
from pg_policies
where schemaname = 'public' and qual = 'true'
order by tablename;
```

Vazia → SEC-02 foi fechado por outro caminho e a migração para `@supabase/server`
(Fases 3 e 5) destrava. Com as 8 tabelas → é o trabalho de DBA da §8, e tem
prioridade sobre a migração.

### 12.3 SEC-03 — corrigido, a descrição estava velha

A `send-email` **não** aceita mais `from`/`to`/`html` arbitrários: valida o operador
(`getUser` + `operators.active`), restringe destinatários a e-mails de operadores
ativos (`recipient_not_allowed`, HTTP 403) e usa `from` fixo do secret `GMAIL_FROM`.
Além disso, estava deployada com `verify_jwt = false` — a única das 17 nessa
situação — e passou a `true` no deploy de 22/10 (v26).

### 12.4 SEC-21 — função órfã removida

`resend-email` estava **ACTIVE em produção sem fonte no repositório**. O download
mostrou o template de exemplo do Supabase, com `from: "you@example.com"` intacto:
`auth: "user"`, nenhuma checagem de operador, nenhuma allowlist de destinatário.
Qualquer usuário logado podia enviar e-mail arbitrário pela conta Resend.

Removidos a função (endpoint devolve 404) e o secret `RESEND_API_KEY`.
**Pendente:** revogar a chave no painel da Resend — removê-la do Supabase não a
invalida.

### 12.5 Deploy — a lacuna que a §8 não cobria

O `config.toml` cobria 6 das 17 functions; as outras 11 dependiam da última opção
usada no deploy (`--no-verify-jwt` fica grudado). Declaradas e, após o redeploy de
22/10, todas as 17 estão coerentes: `verify_jwt = true` nas 13 que validam JWT do
operador, `false` nas 4 que se autenticam por segredo próprio.

Duas functions **nunca tinham sido deployadas** e o frontend as chamava:
`agenda-ics` (feed de calendário, `js/agenda-feed.js:47`) e `send-push`
(notificação no celular, `js/push.js:45,78`). A `send-push` dependia dos secrets
`VAPID_*`, que não existiam — o push estava inoperante por inteiro, inclusive os
lembretes de prazo da `avisos-prazo`. Par VAPID gerado e configurado; as duas estão
no ar.

### 12.6 O que não foi verificado

- Se as migrations `046` (`calendar_feeds`) e `053` (`push_subscriptions`) estão
  aplicadas. A `046` está — o modal do feed gera o link, que depende da RPC
  `my_calendar_feed_token`. A `053` segue sem confirmação.
- `supabase migration list` mostra remoto só até a `005`: as migrations são aplicadas
  à mão no SQL Editor, então a tabela de controle do CLI **não** reflete o banco.

---

## 13. Fase 10 — RLS e bucket conferidos no banco (23/10/2026)

A §12 deixou duas perguntas em aberto por não haver como respondê-las do
código. Foram respondidas no SQL Editor, e **as duas mudam o quadro**: não
há mais nenhum CRÍTICO em aberto.

### 13.1 SEC-02 / P-2 — fechado pela `042`, não pela `021`

```sql
select tablename, count(*) as policies,
       count(*) filter (where qual = 'true') as permissivas
from pg_policies where schemaname = 'public' group by tablename;
```

**20 tabelas, 3 a 4 policies cada, ZERO permissivas.** As oito que a `021`
corrigiria estão com o conjunto completo por operação, incluindo os buracos
que a própria `021` diagnosticava: `visits` tem `visits_select/insert/update`
(que ela dizia faltar) e `reunioes` tem as quatro (ela dizia ter só a aberta).

Quem fechou foi a **`042_rls_completo.sql`**, que já declara no título
"substitui 021 e fecha SEC-02/13/14". O raciocínio dela é melhor: a `021`
remove policies **pelo nome**, então qualquer policy aberta com nome
diferente sobreviveria — e como permissivas se somam por OU, **uma aberta
anula todas as outras**. A `042` varre o `pg_policies` e recria tudo, então o
resultado não depende do histórico do banco.

**`021` e `022` estão obsoletas.** Considerar removê-las de
`supabase/migrations/` para ninguém aplicar por engano.

### 13.2 SEC-13 e SEC-14 — fechados junto

`equipamentos` tem `equipamentos_delete/insert/select/update`; `checklists` e
`checklist_modelo_itens` idem. A `042` cobriu os dois, como o título dela diz.
As propostas **P-15** e **P-16** não têm mais objeto.

### 13.3 SEC-01 / P-1 — fechado

```sql
select id, public from storage.buckets where id = 'attachments';
-- attachments | false
```

Bucket **privado**. Somado ao `0c4f5bf`, que já pôs os signed URLs em
produção, o SEC-01 está encerrado — e a sondagem anônima da §12.1, que era
só indício, agora tem confirmação direta.

### 13.4 O que isso derruba na §8

O item 1 ("Urgente: DBA + staging — P-1 e P-2, as duas exposições CRÍTICO")
**não tem mais objeto**. Nenhum trabalho de DBA está pendente por segurança,
e a Fase 3 da migração para `@supabase/server`, que esperava por isso, está
liberada.

### 13.5 O que continua aberto

**`tickets` — decisão registrada (16/11/2026): fail-closed por design, mantido.**
A migration `011` registrou "tickets/chamados removidos do produto - sem policies";
a `042` (e a `055`) criou `tickets_admin` (FOR ALL TO authenticated, só admin); o
frontend nunca sincronizou `tickets` (não está em `ENTITIES`, sem policy para os
demais papéis). Ou seja: não é exposição, é tabela legado morta por decisão
deliberada — fechada para todo mundo exceto admin. Manter assim; não dar policy
por equipe (ressuscitaria entidade removida) nem dropar a tabela (destrutivo,
sem necessidade). O Dexie ainda guarda a store v1 `tickets` só para a migração
única do localStorage legado — ninguém lê dela. **SYNC-04 encerrado nesta
decisão.**

**`tickets` não aparece na lista de policies.** RLS ligado sem policy nenhuma
= _fail-closed_: ninguém acessa e o sync nega tudo. É o SYNC-04, com a mesma
decisão de produto de sempre — ou tirar `tickets` do `SYNC_ENTITIES`, ou dar
a ela coluna `team` e policies. Hoje é código morto que falha em silêncio.

> **Atualização de 17/11/2026:** SYNC-08, 11, 13 e 14 foram corrigidos (PR #112) e P-6 está aplicada.
> SYNC-09, 10 e 12 foram fechados na rodada de refino de 17/11/2026; P-9 e P-13 estão aplicadas (paginação e `no-empty`). Ver §0.

### 13.6 Lição para a próxima auditoria

Três achados CRÍTICO/ALTO ficaram marcados como pendentes por meses depois de
terem sido corrigidos, porque o documento media o **código e as migrations do
repositório**, não o **estado do banco**. Uma consulta de dez segundos ao
`pg_policies` teria evitado isso. Vale repetir as consultas desta seção a cada
auditoria, antes de classificar qualquer achado de RLS.

**Essas consultas agora estão versionadas em `tools/check-schema.sql`** (RLS por tabela,
policies e permissivas, tabelas sem policy, grants, buckets do storage e funções esperadas como
`current_op_name`). É só `SELECT`, sem efeito colateral — `tests/check-schema.test.js` garante isso.
Rode no SQL Editor e compare com o cabeçalho do arquivo, que diz o resultado esperado de cada bloco.

---

## 14. Fase 2 — contratos de auth das Edge Functions sob teste

A Fase 0 declarou `verify_jwt` das 17 functions e a Fase 1 travou esse invariante por
arquivo (`tests/edge-functions-guard.test.js`), deixando registrado que **4 contratos
seguiam sem cobertura**: sem JWT → 401, operador inativo → bloqueado, operador de outra
equipe → 403 e admin passa. Eles agora têm teste.

### 14.1 Como as functions passaram a rodar no vitest

O obstáculo era real: o `index.ts` chama `serve()` na carga e importa de
`https://deno.land/…`, `https://esm.sh/…` e `npm:…`, que o vitest não resolve.
`tests/helpers/edge-harness.js` empacota a function com o esbuild trocando **só** esses
três especificadores por stubs — `serve()` guarda o handler em vez de abrir porta,
`createClient()` devolve o dublê e o nodemailer não envia. O bundle roda dentro de uma
função cujos parâmetros sombreiam `Deno`, `fetch` e `console`, então o teste não alcança
rede nem ambiente. **É o `index.ts` de produção que executa**, não uma cópia da regra.

Continua fora de alcance: o comportamento do runtime Deno em si (o `verify_jwt` do
gateway, que é do Supabase, não da function) — por isso o guarda estrutural da Fase 1
segue necessário e complementar.

### 14.2 Cobertura

`tests/edge-functions-auth.test.js` — 47 testes sobre as 13 functions que usam
`auth.getUser`. A lista é conferida contra o diretório, então **uma function nova com JWT
que não entre na tabela quebra o teste**.

| Contrato                | Vale para                                                                                       | Esperado                |
| ----------------------- | ----------------------------------------------------------------------------------------------- | ----------------------- |
| sem JWT → 401           | as 13                                                                                           | `401`                   |
| operador inativo        | as 13                                                                                           | `401`/`403`             |
| cliente de outra equipe | `milvus-devices`, `milvus-tickets`, `milvus-chamado-create`                                     | `403`                   |
| exige admin             | `milvus-client-names`, `milvus-clients-import`, `milvus-token-backfill`, `update-user-password` | `403` p/ operador comum |
| admin passa o gate      | as 13                                                                                           | ≠ `401`/`403`           |

`milvus-atendimentos` e `milvus-chamado-status` não entram no contrato de equipe **por
desenho**: elas não negam, filtram a lista pela equipe do operador.

Capacidade de ficar vermelho verificada por mutação (5 mutantes, todos pegos): tirar os
dois gates de token da `milvus-devices` (1 falha), aceitar inativo na `send-push` (2),
remover o team-check da `milvus-tickets` (1), negar até o admin na `update-user-password`
(1) e dispensar admin na `milvus-client-names` (2).

Nota: remover **só** o `if (!callerToken)` da `milvus-devices` não derruba teste nenhum —
e está certo, porque o `if (!callerUid)` logo abaixo devolve o mesmo 401. É redundância
de defesa, não contrato.

### 14.3 SEC-03 / P-3 — o que foi fechado e o que foi recusado

`send-email` hoje exige JWT (`verify_jwt = true` + `auth.getUser`), aceita só **operador
ativo**, usa remetente **fixo** (`GMAIL_FROM`, ignorando o `from` do corpo) e só entrega
para e-mail de operador ativo (`403 recipient_not_allowed`). `tests/send-email-relay.test.js`
trava as duas últimas — as que de fato impediam o relay — e ambas foram verificadas por
mutação (usar o `from` do corpo derruba 2 testes; dispensar a allowlist derruba 3).

**O papel `admin`/`gestao` que a P-3 pedia não foi implementado, de propósito.** As
notificações de pendência saem de `js/storage-pendencias.js:455,457,709`
(`notifyPendenciaCreated`/`Updated`/`Note`) no fluxo de **qualquer** técnico. Exigir papel
na function calaria em silêncio o e-mail do operador comum — troca de um relay (já
fechado por remetente fixo + allowlist) por uma regressão funcional. Fica como **decisão
de produto**, ao lado da P-16.

---

## 15. Reconciliação com o código (17/11/2026)

Esta fase não procurou achado novo: conferiu cada ID da §4 contra o HEAD (`2815077`) e o
`git log`, corrigiu os números de baseline (§1, §2) e resumiu a situação na §0. Método:
`git log -S`/`--grep` para achar o commit, leitura do `arquivo:linha` atual para confirmar
o comportamento e `npm test`/`npm run lint` para o baseline. O que não deu para confirmar
ficou **NÃO VERIFICADO**. Itens que outros agentes estão tratando ficaram **abertos**.

### 15.1 SYNC-05 — prefixo `011` duplicado: decisão

Existem `011_rls_roles_teams.sql` e `011_visit_time_range.sql`. **Decisão: não renomear.**

- Os dois são independentes: a RLS não referencia `time_end`/`all_day`, e as colunas não
  dependem das policies. A ordem alfabética (RLS primeiro, depois as colunas de visita, ambas
  antes da `012`) é a ordem de aplicação recomendada.
- As migrations são aplicadas à mão e o banco de produção não é consultado pelo CLI
  (`supabase migration list` não reflete o banco). Renumerar dessincronizaria o histórico
  humano (“já rodei até a 0XX”) sem ganho de segurança. Por isso a P-11 foi recusada.
- Mitigação aplicada: o cabeçalho **dos dois arquivos** agora traz a ordem e a nota do prefixo
  duplicado (só comentário, sem mudança de SQL). A numeração da `012` em diante segue como está.
- Quem monta um banco novo: aplicar `001`…`010`, `011_rls_roles_teams`, `011_visit_time_range`,
  `012`… em ordem. O que o banco atual realmente tem se confere com `tools/check-schema.sql`.

### 15.2 SEC-08 / SEC-09 — o que o Supabase Auth já faz e o que conferir no painel

Estado do código: o limite de login do app é só atrito no cliente (`_loginGuard` persistido em `localStorage`, `js/auth.js`);
a trava agora persiste no cliente, mas o SEC-08 segue **parcial**: a defesa real é server-side e esta seção não a substitui.

O login usa **Supabase Auth** (e-mail e senha). O serviço aplica limites de taxa próprios nos
endpoints de autenticação (por IP e por tipo de operação, como login, cadastro, envio de e-mail
e renovação de token), e o painel permite ajustá-los. **Os valores efetivos desta instância não
foram verificados** e podem diferir do padrão — por isso nenhum número é afirmado aqui.

O dono do projeto deve conferir no painel do Supabase (nomes de menu podem variar; **conferir no painel**):

| O que conferir                                         | Onde (aproximado)                             | O que se espera                                                                                                              |
| ------------------------------------------------------ | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Limites de taxa de autenticação (login, token, e-mail) | Authentication → Rate Limits                  | existem valores definidos; **conferir no painel** se atendem ao uso real (poucos operadores atrás do mesmo IP de escritório) |
| Proteção contra bot (CAPTCHA) no login                 | Authentication → Attack Protection            | ativado ou decisão consciente de não ativar; **conferir no painel**                                                          |
| Política de senha (tamanho mínimo, força)              | Authentication → Policies / Providers → Email | alinhada com a regra do app (`update-user-password` exige 8+); **conferir no painel**                                        |
| Cadastro aberto                                        | Authentication → Providers → Email            | “permitir novos usuários” desligado se o acesso é só por convite/admin; **conferir no painel**                               |
| Logs de tentativa                                      | Logs → Auth                                   | procurar picos de falha de login; **conferir no painel**                                                                     |

Limite: o limite de taxa do Auth freia força bruta por IP, mas **não** substitui a trava por
conta (bloqueio após N falhas para o mesmo e-mail) que o SEC-08 pede; essa trava segue como
proposta P-7 e está com o agente responsável.

**SEC-09 (CORS).** As functions deixaram de escrever `Access-Control-Allow-Origin: *` à mão:
passaram a usar `withSupabase`, que trata CORS e preflight (comentário em
`supabase/functions/send-email/index.ts:26-27`). Qual origem esse tratamento devolve, na
configuração atual, **não foi verificado** — sondar com uma requisição `OPTIONS` e uma origem
qualquer. Mesmo com origem aberta, o risco continua baixo enquanto toda function exigir JWT ou
segredo próprio (contratos testados em §14).

### 15.3 O que não foi tocado

Por instrução desta rodada, nenhum arquivo de `js/` foi alterado. Os achados **abertos** da §0
ficam com os agentes responsáveis ou entram na fila de P-13/P-14 e afins.
