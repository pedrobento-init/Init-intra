# AUDITORIA — Init Intra

> **Branch:** `audit/2026-10-09` · **Data:** 09/10/2026 · **Status:** Fases 1–7 concluídas
> (Fase 6 = fechamento das SUSPEITas, §9 · Fase 7 = Edge Functions, §10)
> **Segredos:** nenhum valor sensível é reproduzido aqui. Credenciais aparecem mascaradas
> (`https://****.supabase.co`, `sb_secret_****`, `<JWT-MASKED>`).

---

## 1. Escopo e metodologia

Auditoria completa de **segurança, sincronização, performance e qualidade**, cobrindo:

| Camada                                | Arquivos                                                                    |
| ------------------------------------- | --------------------------------------------------------------------------- |
| Frontend SPA (JS global, sem módulos) | `index.html` + 65 `js/*.js` + `css/styles.css`                              |
| PWA/Offline                           | `sw.js`, `js/outbox.js`, `js/sync-manager.js`, `js/db.js`                   |
| Backend                               | `supabase/migrations/*.sql` (41), 9 Edge Functions (`supabase/functions/*`) |
| Build/deploy                          | `tools/*`, `vercel.json`, `package.json`                                    |
| Testes                                | `tests/*.test.js` (48 arquivos)                                             |

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

---

## 3. Mapa do sistema (Fase 1)

- **Banco:** 17 tabelas (`audit_logs`, `checklist_marcacoes`, `checklist_modelo_itens`,
  `checklists`, `client_devices`, `client_milvus_tickets`, `clients`, `email_notifications`,
  `equipamentos`, `milvus_client_map`, `operators`, `pendencias`, `procedure_templates`,
  `procedures`, `reunioes`, `tickets`, `visits`) + `storage.buckets(attachments)`.
- **Migrations:** `001`–`041` (prefixo `011` **duplicado**) + `migration.sql` legado.
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
Status: **CORRIGIDO**, **PROPOSTA**, **PENDENTE (DBA)**, **MONITORAR**.

| ID      | Sev.     | Conf. | Achado                                                                                                                                                                                                                | Local                                                                                                                                                            | Status                                    |
| ------- | -------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| SEC-01  | CRÍTICO  | ALTA  | Bucket `attachments` **público** + policy `attachments public read` sem `TO` → leitura anônima de documentos de clientes; app grava `getPublicUrl` no banco                                                           | `supabase/migrations/017_storage_attachments.sql:1-8`, `js/storage.js:1160-1162`                                                                                 | PROPOSTA (P-1)                            |
| SEC-02  | CRÍTICO  | ALTA  | Policies `FOR ALL USING (true) WITH CHECK (true)` **sem `TO`** (aplicam-se a `anon`) em 8 tabelas                                                                                                                     | `supabase/migrations/004_procedure_templates.sql:25-27`, `018_reunioes.sql:33`, `035_equipamentos.sql:49`, diagnóstico próprio em `021_rls_remediation.sql:5-14` | PROPOSTA (P-2) / DBA                      |
| SEC-03  | ALTO     | ALTA  | Edge Function `send-email` **sem verificação de JWT/role**: aceita `from`/`to`/`html` arbitrários → relay/spoofing                                                                                                    | `supabase/functions/send-email/index.ts:24-60`                                                                                                                   | PROPOSTA (P-3)                            |
| SEC-04  | ALTO     | ALTA  | Service Worker cacheava GETs autenticados do Supabase na Cache Storage (chave = URL, ignora `Authorization`) → dados de um usuário servidos a outra sessão                                                            | `sw.js` (handler `fetch`)                                                                                                                                        | **CORRIGIDO** `24d9160`                   |
| SEC-05  | MÉDIO    | ALTA  | CDN `motion@13.1.1` carregado **sem `integrity`** (SRI)                                                                                                                                                               | `index.html:294`                                                                                                                                                 | **CORRIGIDO** `6ca1acc`                   |
| SEC-06  | MÉDIO    | ALTA  | URL/chave do Supabase sobrescrevíveis via `localStorage` (`intra_supabase_url`/`intra_supabase_key`)                                                                                                                  | `js/supabase-config.js:12-14,38-39`                                                                                                                              | PROPOSTA (P-4)                            |
| SEC-07  | MÉDIO    | ALTA  | CSP com `script-src 'unsafe-inline'` e `style-src 'unsafe-inline'` → não mitiga XSS inline (`onclick` no HTML gerado)                                                                                                 | `vercel.json:5-19`                                                                                                                                               | PROPOSTA (P-5)                            |
| SEC-08  | MÉDIO    | ALTA  | Rate-limit de login só em memória (`_loginGuard`), zera no reload; sem trava server-side                                                                                                                              | `js/auth.js:6-27`                                                                                                                                                | PROPOSTA (P-7)                            |
| SEC-09  | BAIXO    | ALTA  | `Access-Control-Allow-Origin: *` em todas as 9 Edge Functions (mitigado pela checagem de JWT, quando existe)                                                                                                          | `supabase/functions/*/index.ts`                                                                                                                                  | MONITORAR                                 |
| SEC-10  | BAIXO    | ALTA  | Upload de anexos valida **apenas tamanho** (2 MB); sem allowlist de tipo/extensão                                                                                                                                     | `js/storage.js:1145,1227,1374,1444`                                                                                                                              | PROPOSTA (P-8)                            |
| SEC-11  | INFO     | ALTA  | Credenciais antigas já estiveram no histórico Git (papel `anon`, removidas em `9ea37ad`); nenhum `service_role` vazado                                                                                                | histórico Git                                                                                                                                                    | MONITORAR (rotacionar se exposto)         |
| SEC-12  | INFO     | MÉDIA | XSS: varredura dos 93 `${...}` em `innerHTML`; todos os pontos com dado do usuário conferidos escapam (`escapeHtml`/`esc`/`_richEsc`/`textContent`)                                                                   | `js/*`                                                                                                                                                           | **RESOLVIDO** — nenhum XSS (§9)           |
| SEC-13  | ALTO     | ALTA  | `equipamentos all` — `FOR ALL USING (true) WITH CHECK (true)` **sem `TO`** (`anon` lê e escreve) e criada **depois** da `021`, que só derruba 8 tabelas → aplicar `021` **não fecha esta**                            | `supabase/migrations/035_equipamentos.sql:49`, `021_rls_remediation.sql:68-75`                                                                                   | PROPOSTA (P-15) / DBA                     |
| SEC-14  | MÉDIO    | ALTA  | `checklists` e `checklist_modelo_itens` com `SELECT ... USING (true)` **sem isolamento por equipe** (escrita é admin-only); `checklist_marcacoes` já é team-scoped                                                    | `supabase/migrations/041_checklists.sql:157-158,174-176`, `040_checklist.sql:62-63`                                                                              | PROPOSTA (P-16) — decisão de produto      |
| SEC-15  | MÉDIO    | ALTA  | **CSV/XLSX injection**: 4 exportadores não neutralizam células iniciadas por `=`/`+`/`-`/`@`; o `exportCSV` genérico também não escapa `;`/quebra de linha (quebra colunas)                                           | `js/ui.js:836-839`, `js/visitas.js:685-687`, `js/equipamentos.js:905`, `js/milvus-devices.js:520`                                                                | **CORRIGIDO** `53c9fe7`                   |
| SEC-16  | BAIXO    | ALTA  | Nenhuma das 9 Edge Functions tem rate limit/quotas; autenticadas, podem ser chamadas em loop (consumo da API Milvus/Resend)                                                                                           | `supabase/functions/*/index.ts`                                                                                                                                  | MONITORAR                                 |
| SYNC-01 | MÉDIO    | MÉDIA | **SUSPEITA** — `pull` sem `.range()`: se o PostgREST `max-rows` (padrão 1000) truncar, linhas ausentes são tratadas como “deletadas no servidor” e **descartadas do merged** → perda local                            | `js/storage.js:834`, `js/schema.js:295-297`                                                                                                                      | PROPOSTA (P-9)                            |
| SYNC-02 | BAIXO    | ALTA  | Outbox cobre **só `pendencias`**; demais entidades sobem só no próximo ciclo de sync                                                                                                                                  | `js/storage.js:1910`, `js/storage.js:953`                                                                                                                        | PROPOSTA (P-10)                           |
| SYNC-03 | BAIXO    | MÉDIA | **SUSPEITA** — `applyRemote` reescreve a lista inteira via `dbSet` em paralelo com o merge do sync (corrida de escrita perdida)                                                                                       | `js/sync-manager.js:143`                                                                                                                                         | PROPOSTA (P-10)                           |
| SYNC-04 | MÉDIO    | ALTA  | `tickets` sem policies + RLS ligado = **fail-closed** (sync de `tickets` nega tudo)                                                                                                                                   | `021_rls_remediation.sql:9-12`                                                                                                                                   | PENDENTE (decisão de produto)             |
| SYNC-05 | MÉDIO    | ALTA  | Prefixo `011` duplicado (`011_rls_roles_teams.sql` + `011_visit_time_range.sql`) → ordem de aplicação ambígua                                                                                                         | `supabase/migrations/011_*.sql`                                                                                                                                  | PROPOSTA (P-11) / DBA                     |
| PERF-01 | MÉDIO    | ALTA  | `select('*')` sem paginação no pull de todas as entidades (+ `audit_logs` `select('*')` com 500 linhas)                                                                                                               | `js/storage.js:834,1012`, `js/checklist.js:348,366,405`                                                                                                          | PROPOSTA (P-9)                            |
| PERF-02 | MÉDIO    | ALTA  | `dist/` nunca era limpo → 4.323 KB/73 arquivos acumulados                                                                                                                                                             | `tools/build-assets.js`                                                                                                                                          | **CORRIGIDO** `12c875f`                   |
| PERF-03 | MÉDIO    | ALTA  | 32 `<script defer>` sem code-splitting + CSS de fontes bloqueante (3 famílias)                                                                                                                                        | `index.html:285-330`, `:13`                                                                                                                                      | PROPOSTA (P-12)                           |
| PERF-04 | BAIXO    | ALTA  | Contadores do quadro baixam `status,deadline` de todo o escopo a cada render                                                                                                                                          | `js/storage.js:1726-1731`                                                                                                                                        | MONITORAR                                 |
| CONS-01 | MÉDIO    | ALTA  | **398 `catch` vazios** (`catch (_) {}`); regra `no-empty` desligada → falhas silenciosas                                                                                                                              | `js/*`, `eslint.config.js`                                                                                                                                       | PROPOSTA (P-13)                           |
| CONS-02 | MÉDIO    | ALTA  | 838 warnings de lint, **100% `no-unused-vars`** (0 erros)                                                                                                                                                             | `js/`, `tools/`                                                                                                                                                  | PROPOSTA (P-14)                           |
| CONS-03 | MÉDIO    | ALTA  | `terser` declarado no `package.json` mas não instalado → build sem minify + teste falhando                                                                                                                            | `tools/build-assets.js:41-47`                                                                                                                                    | **CORRIGIDO no ambiente** (`npm install`) |
| CONS-04 | MÉDIO    | ALTA  | 3 CVEs restantes em devDeps exigindo `vitest@5` (breaking)                                                                                                                                                            | `package.json`                                                                                                                                                   | PROPOSTA (P-6)                            |
| CONS-05 | INFO     | ALTA  | Sem type-check em nenhum etapa                                                                                                                                                                                        | `package.json`                                                                                                                                                   | MONITORAR                                 |
| CONS-06 | INFO     | ALTA  | Código morto: `_daySummary` é calculado (`buildDaySummary`) mas **nunca lido** — o sink do resumo diário não existe mais desde o redesign do dashboard                                                                | `js/app.js:705-710`, `js/metrics.js:453`                                                                                                                         | MONITORAR                                 |
| CONS-07 | INFO     | ALTA  | `clients.milvus_client_token` (identificador por cliente, não o API token) é sincronizado ao navegador e fica no IndexedDB; visível só p/ a equipe dona via RLS                                                       | `js/schema.js:22`, `js/clients.js:190,1513`                                                                                                                      | MONITORAR                                 |
| CONS-08 | INFO     | MÉDIA | Exportação de `.ics` escapa `,` `;` e `\n`, mas não `\` nem CR solto (`_icsEscape`) — permite injeção de escape no arquivo de calendário                                                                              | `js/calendar.js:683-685`                                                                                                                                         | **CORRIGIDO** `53c9fe7`                   |
| SEC-17  | ALTO     | ALTA  | XSS armazenado no badge de timer: nome do operador (editável no próprio perfil) interpolado cru no atributo `title` e injetado via `innerHTML`                                                                        | `js/timer.js:69` (origem `js/operadores.js:361,539`, `js/storage.js:3240-3255`, `js/timer.js:153,188`)                                                           | NOVO (Fase 8)                             |
| SEC-18  | ALTO     | ALTA  | XSS por atributo na logo do cliente: `_safeLogoUrl` só valida o prefixo `http(s)://` e não escapa aspa; o campo “URL da Logo” é texto livre                                                                           | `js/ui.js:450` (`_safeLogoUrl`), `js/clients.js:1462,1629,1842`                                                                                                  | NOVO (Fase 8)                             |
| SEC-19  | BAIXO    | MÉDIA | Busca persistida (`localStorage`) injetada cru em `value="..."` (self-XSS) e, ao entrar na tela, o filtro restaurado **não** é aplicado à grade                                                                       | `js/clients.js:60,51` + `js/ui.js:222-230`                                                                                                                       | NOVO (Fase 8)                             |
| SEC-20  | BAIXO    | MÉDIA | Criar/editar modelos de procedimento compartilhados não tem gate de papel, enquanto excluir exige admin                                                                                                               | `js/templates.js:127,161` vs `:262-275`                                                                                                                          | NOVO (Fase 8)                             |
| SYNC-06 | CRÍTICO  | ALTA  | Editar pendência pelo formulário principal zera no **servidor** anexos, notas/feed, checklist, `visit_id`, conclusão e timers: o payload montado no form não leva esses campos e o `upsert` os envia como `[]`/`null` | `js/pendencias.js:1351-1358` + `js/storage.js:1878-1906` (merge local `:1788`)                                                                                   | NOVO (Fase 8)                             |
| SYNC-07 | ALTO     | ALTA  | Mesmo padrão em visitas: `upsert` zera `categories`/`checklist` e os 8 campos `milvus_*` e reatribui `numero` (`_visitNumeroOf`)                                                                                      | `js/visitas.js:399-414` + `js/storage.js:2452-2478`                                                                                                              | NOVO (Fase 8)                             |
| SYNC-08 | MÉDIO    | MÉDIA | Se `CHANNEL_ERROR`/`TIMED_OUT` acontece com a aba oculta, o backoff aborta e `visibilitychange` não reconecta (`!_channel` continua verdadeiro) → canal realtime morto até `online`/reload                            | `js/sync-manager.js:196-202,223`                                                                                                                                 | NOVO (Fase 8)                             |
| SYNC-09 | MÉDIO    | ALTA  | Fila offline sem `max-attempts`/dead-letter: `attempts` é incrementado e nunca lido; uma entrada que falha sempre quebra o drain e bloqueia a fila inteira para sempre                                                | `js/outbox.js:100-108` (campo `:21`)                                                                                                                             | NOVO (Fase 8)                             |
| SYNC-10 | MÉDIO    | MÉDIA | `deletePendencia` não remove a entrada já enfileirada para o mesmo id → o próximo drain recria o registro no servidor (e broadcast nos demais aparelhos)                                                              | `js/storage.js:2019-2031` vs `js/outbox.js:41-46`                                                                                                                | NOVO (Fase 8)                             |
| SYNC-11 | MÉDIO    | MÉDIA | `applyRemote` nunca executa `onMerged` (só `pinHash`/`pinSalt` hardcoded) → a proteção “remoto sem `numero` não apaga o local” vale só no pull; pelo realtime o `null` sobrescreve                                    | `js/sync-manager.js:113-136` vs `js/schema.js:165-174`                                                                                                           | NOVO (Fase 8)                             |
| SYNC-12 | BAIXO    | MÉDIA | Entrada de entidade desconhecida é apagada e contada como `sent` (perda offline disfarçada de sucesso); o campo `op` (delete) gravado no enqueue é ignorado — o drain sempre faz `upsert`                             | `js/outbox.js:100-104`                                                                                                                                           | NOVO (Fase 8)                             |
| SYNC-13 | SUSPEITA | BAIXA | Só 7 das 15 stores do Dexie têm `try/catch` individual no boot; se `toArray()` lançar, o cache fica vazio e a primeira `dbSet` faz `bulkDelete` das linhas “stale”                                                    | `js/db.js:157-175` vs `:229-246`                                                                                                                                 | NOVO (Fase 8)                             |
| SYNC-14 | MÉDIO    | MÉDIA | `saveEquipamento` não checa papel/equipe (só `delete` é admin) e um ativo **sem cliente** herda o `team` default → edição pode reescrever o dono do registro                                                          | `js/equipamentos.js:685-698,720` + `js/storage.js:2603-2619`                                                                                                     | NOVO (Fase 8)                             |
| PERF-05 | MÉDIO    | MÉDIA | Cada retorno de aba dispara sync completo (pull de todas as entidades) sem cooldown — só existe dedup de sync em voo                                                                                                  | `js/global-search.js:450-454`                                                                                                                                    | NOVO (Fase 8)                             |
| PERF-06 | MÉDIO    | ALTA  | Aplicar modelo a N clientes roda N× `saveProcedure`: cada iteração regrava a lista inteira no IndexedDB + 1 upsert HTTP + 1 audit log (O(N) local × N = O(N²))                                                        | `js/templates.js:263-272` (`js/storage.js:2681,2693,2694,2697`)                                                                                                  | NOVO (Fase 8)                             |
| PERF-07 | MÉDIO    | MÉDIA | `select('item_id, client_id')` de todas as marcações sem `.range()` → truncamento silencioso pelo `max-rows` do PostgREST e contagem errada no modo Gerenciar                                                         | `js/checklist.js:424`                                                                                                                                            | NOVO (Fase 8)                             |
| PERF-08 | BAIXO    | ALTA  | SLA e saúde do cliente recalculados para **todos** os clientes a cada render da grade                                                                                                                                 | `js/clients.js:98-100`                                                                                                                                           | NOVO (Fase 8)                             |
| CONS-09 | MÉDIO    | ALTA  | `if (!q) return false` no topo torna o `if (!q) return true` da linha seguinte inalcançável → atalhos `status:`/`cliente:` nunca retornam equipamentos (clientes e pendências retornam)                               | `js/global-search.js:162,169`                                                                                                                                    | NOVO (Fase 8)                             |
| CONS-10 | MÉDIO    | ALTA  | Se o próprio callback lançar, o `catch` o reexecuta → render duplicado e erro original engolido                                                                                                                       | `js/app-events.js:58-66`                                                                                                                                         | NOVO (Fase 8)                             |
| CONS-11 | BAIXO    | ALTA  | `#syncNowBtn` não existe em HTML nenhum (só `#syncStatus`, que já tem `onclick`) → estado “Sincronizando…”/disabled é código morto (testes mockam o id inexistente)                                                   | `js/global-search.js:404` vs `index.html:162`                                                                                                                    | NOVO (Fase 8)                             |
| CONS-12 | INFO     | ALTA  | Early-return para `_refreshSyncBanner()`, que é no-op porque `#offlineBanner` saiu do `index.html` → fallback de status de conexão inalcançável                                                                       | `js/global-search.js:61-67` + `js/storage.js:37,46,64-66`                                                                                                        | NOVO (Fase 8)                             |
| CONS-13 | INFO     | ALTA  | Definidos e exportados, nunca lidos: `_getPendingSyncCountSafe`, `_getPendingSyncText` e o campo `pendingPayload` do cache                                                                                            | `js/global-search.js:47,52,462`, `js/app-events.js:48`                                                                                                           | NOVO (Fase 8)                             |
| CONS-14 | INFO     | ALTA  | Funções redefinidas em arquivo posterior sobrescrevem as anteriores (ordem de carga): `isPendenciaResolvida`/`getPendenciaAssunto`/`getPendenciaTitulo`/`getNoteSnippet`/`parseSearchShortcuts`                       | `js/metrics.js:21,217,235,474` vs `js/ui.js:367-375`, `js/global-search.js:16,33`                                                                                | NOVO (Fase 8)                             |
| CONS-15 | INFO     | ALTA  | `filterItemsByDateRange` (+ `_parseDashItemDate`) só é chamada por teste                                                                                                                                              | `js/metrics.js:316,306`                                                                                                                                          | NOVO (Fase 8)                             |
| CONS-16 | INFO     | ALTA  | Alias `timerButtonHTML` nunca chamado e ramo `type === 'ticket'` de `toggleTimer` inalcançável (só se chama com `pendencia`)                                                                                          | `js/timer.js:137-139,332` vs `js/pendencias.js:742,1050`                                                                                                         | NOVO (Fase 8)                             |
| CONS-17 | BAIXO    | ALTA  | Poll de abertura de registro (25×120 ms) nunca cancelado por navegação → toast “Registro não encontrado” enganoso até 3 s depois                                                                                      | `js/global-search.js:298-315`                                                                                                                                    | NOVO (Fase 8)                             |
| CONS-18 | BAIXO    | ALTA  | Aplicar modelo a N clientes sem `try/catch` nem agregação: exceção no meio aborta em silêncio e o toast de sucesso é incondicional                                                                                    | `js/templates.js:262-275`                                                                                                                                        | NOVO (Fase 8)                             |
| CONS-19 | MÉDIO    | MÉDIA | Exportação `.ics` ignora `timeEnd`/`end` — nenhum `VEVENT` tem `DTEND`/`DURATION` (evento termina no início, duração zero)                                                                                            | `js/calendar.js:705-718`                                                                                                                                         | NOVO (Fase 8)                             |
| CONS-20 | BAIXO    | MÉDIA | “Tentar novamente” do FullCalendar injeta uma 2ª `<script>` da mesma URL (`loadScript` só cacheia em `onload`) → download duplo e reexecução                                                                          | `js/calendar.js:464,469` + `js/ui.js:5,10`                                                                                                                       | NOVO (Fase 8)                             |
| CONS-21 | SUSPEITA | MÉDIA | `moreLinkClick` monta a data via `toISOString()` (UTC) enquanto `dateClick` usa `dateStr` (local) → dia errado a leste de UTC (em pt-BR, UTC-3)                                                                       | `js/calendar.js:522` vs `:518`                                                                                                                                   | NOVO (Fase 8)                             |

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

**Estado final:** `npm test` **564/564** · `npm run lint` **0 erros / 838 warnings** ·
`npm run build` ok (com minify) · `index.html`/`sw.js` restaurados ao modo dev após validar o build ·
`git status` limpo (exceto `supabase/functions/milvus-chamado-create/index.ts`, debug, e
`referencia/`, fora do escopo — **não commitados**).

---

## 7. Propostas (não aplicadas) — prós e contras

Aplicada nesta sessão: **P-17** (commit `53c9fe7`) — fecha SEC-15 e CONS-08; ver §6 e §9. As demais seguem não aplicadas.

| #    | Proposta                                                                                                                                                                                         | Prós                                                                                   | Contras / risco                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| P-1  | Aplicar `022_storage_private.sql` + migrar o app para signed URLs (`js/storage.js:1162`)                                                                                                         | Fecha leitura anônima de anexos (SEC-01)                                               | Requer backup, conferência de paths (Q-INV1/2/3), código de signed URLs antes da migração; sem isso anexos quebram. **DBA + deploy atômico** |
| P-2  | Aplicar `021_rls_remediation.sql` (remove `X all USING (true)` e cria policies por equipe/admin)                                                                                                 | Fecha SEC-02 em 8 tabelas                                                              | Exige DBA, staging e bateria de 13 testes; decisão pendente sobre `tickets` (SYNC-04)                                                        |
| P-3  | `send-email`: exigir JWT + papel `admin`/`gestao` e fixar `from` permitido                                                                                                                       | Elimina relay aberto (SEC-03)                                                          | Altera contrato da API — clientes que chamam sem JWT passam a receber 401; precisa de deploy das 9 functions                                 |
| P-4  | Remover override via `localStorage` de URL/chave (ou exigir flag de build)                                                                                                                       | Remove vetor de redirecionamento do backend (SEC-06)                                   | Perde o recurso de “apontar p/ outro projeto pelo console”, usado na documentação interna                                                    |
| P-5  | Tirar `unsafe-inline` do CSP (refatorar `onclick` globais p/ `addEventListener`)                                                                                                                 | Mitiga XSS de verdade (SEC-07)                                                         | Grande refatoração de UI; risco de quebrar handlers gerados por template                                                                     |
| P-6  | Subir para `vitest@5` (resolve as 3 CVEs restantes)                                                                                                                                              | `npm audit` limpo                                                                      | Breaking: pode exigir mudar config/testes; precisa rodar a bateria completa                                                                  |
| P-7  | Rate-limit de login no servidor (ou tabela de tentativas)                                                                                                                                        | Fecha SEC-08 de verdade                                                                | Exige migração + lógica nova; o guard client-side é apenas informativo                                                                       |
| P-8  | Allowlist de MIME/extensão no upload de anexos                                                                                                                                                   | Reduz upload de SVG/HTML hostil (SEC-10)                                               | Pode bloquear formatos legítimos se for restritivo demais                                                                                    |
| P-9  | Pull paginado (`.range()`) + colunas mínimas (`status,deadline`, etc.)                                                                                                                           | Resolve PERF-01 e mitiga SYNC-01                                                       | Tem que garantir `updated_at` em toda coluna selecionada, senão tombstone/merge quebram (risco de perda)                                     |
| P-10 | Outbox genérica (todas as entidades) + lock de escrita entre `applyRemote` e merge                                                                                                               | Fecha SYNC-02/SYNC-03                                                                  | Refatoração do caminho crítico de sync; exige testes de concorrência                                                                         |
| P-11 | Renomear `011_visit_time_range.sql` p/ `012_*` (renumerar restantes)                                                                                                                             | Remove ambiguidade de ordem (SYNC-05)                                                  | Só é seguro se a migration nunca rodou; **DBA precisa confirmar histórico**                                                                  |
| P-12 | Code-splitting das telas + subset de fontes                                                                                                                                                      | Reduz payload inicial (PERF-03)                                                        | Muda a ordem de carregamento global (`navigateTo` depende de globais)                                                                        |
| P-13 | Habilitar `no-empty` (exceto `_`) + log de erro mínimo nos `catch`                                                                                                                               | 398 falhas silenciosas viram visíveis (CONS-01)                                        | Gera centenas de alterações; precisa de janela dedicada                                                                                      |
| P-14 | Limpar `no-unused-vars` (838) em lotes                                                                                                                                                           | Lint zerado, morte reduzida (CONS-02)                                                  | Trabalho mecânico; risco de apagar variáveis “usadas por string/`window`”                                                                    |
| P-15 | Nova migration (ex.: `042_equipamentos_rls`) copiando o modelo da `021` para `equipamentos` (remover `"equipamentos all"`, policies por equipe/admin)                                            | Fecha SEC-13 — `equipamentos` continua aberto mesmo **depois** da `021`                | Exige DBA/staging; tabela nova em relação ao escopo da `021`, precisa do mesmo rollback documentado                                          |
| P-16 | Isolar `checklists`/`checklist_modelo_itens` por equipe (padrão `ckmarc`) ou manter leitura global                                                                                               | Fecha SEC-14 se for vazamento; mantém o fluxo atual se modelos são globais por desenho | **Decisão de produto**: mudar pode esconder modelos de quem precisa vê-los                                                                   |
| P-18 | Escapar os atributos interpolados do badge de timer e da logo do cliente (`escapeHtml` no `title` de `js/timer.js:69` + `_safeLogoUrl` com `new URL()` e allowlist de esquema em `js/ui.js:450`) | Fecha SEC-17 e SEC-18 — os dois XSS armazenados da Fase 8                              | Toca renderização usada em 15 pontos do app; conferir logos legadas com query string/`data:` e nomes de operador com aspa                    |
| P-19 | Montar o payload remoto de `savePendencia`/`saveVisit` a partir do registro **mesclado** (e não do objeto parcial montado no form)                                                               | Fecha SYNC-06 e SYNC-07 — perda de anexos/feed/checklist/campos Milvus na edição       | Muda o contrato do push; exige regressão com pendência que tenha anexos + feed + checklist e com visita numerada/vinculada ao Milvus         |

---

## 8. Próximos passos

0. **Imediato (Fase 8):** SYNC-06/SYNC-07 — a edição pelo formulário apaga anexos,
   feed e campos Milvus **no servidor** (perda de dados silenciosa); SEC-17/SEC-18 —
   XSS armazenado em badge de timer e na logo de cliente (ambos exigem fix pontual).

1. **Urgente (DBA + staging):** P-1 e P-2 — as duas exposições CRÍTICO; rodar backup →
   `021` → conferir `pg_policies` → `022` (somente com signed URLs já em produção).
   **Atenção:** aplicar a `021` sozinha **não** fecha `equipamentos` (SEC-13/P-15).
2. **Alto:** P-3 (`send-email`) e P-6 (`vitest@5`) — correções pontuais, alto valor/baixo custo.
3. **Verificação (somente leitura):** confirmar `Max rows` da API Supabase e
   `select count(*)` das tabelas grandes (valida/refuta SYNC-01).
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

## 10. Fase 7 — Edge Functions (9/9)

Padrão observado em 8 das 9: `authorization` → `admin.auth.getUser(token)` (401 se inválido)
→ `operators` por `auth_user_id` (403 se inativo) → escopo (admin puro ou team-check do
cliente-alvo) → só então `service_role`.

| Função                  | JWT     | Escopo                                                 | Observação                                                                                       |
| ----------------------- | ------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `milvus-atendimentos`   | ✓       | admin **ou** team (`:109-113`, `:175-205`)             | valida token por `milvus_client_token` + time dono                                               |
| `milvus-chamado-create` | ✓       | admin **ou** team (`:416-430`, `:464-469`, `:639-650`) | team-check antes de qualquer chamada/escrita                                                     |
| `milvus-devices`        | ✓       | admin **ou** team (`:432-464`)                         | lê `clients` antes de autorizar                                                                  |
| `milvus-tickets`        | ✓       | admin **ou** team (`:195-243`)                         | `404` se o cliente não existe, `403` se é de outra equipe (enumeração por id UUID é desprezível) |
| `milvus-client-names`   | ✓       | **admin only** (`:208+`)                               |                                                                                                  |
| `milvus-clients-import` | ✓       | **admin only** (`:141-150`)                            |                                                                                                  |
| `milvus-token-backfill` | ✓       | **admin only** (`:132-141`)                            | duas fases (prévia → commit)                                                                     |
| `update-user-password`  | ✓       | **admin only** (`:44-73`)                              | valida `password.length >= 8`                                                                    |
| `send-email`            | **não** | **nenhum**                                             | **SEC-03** — única exceção                                                                       |

Também verificado: nenhum valor de segredo aparece em log (só flags como
`hasToken=${!!clientToken}` e nomes de tabela/coluna) e `MILVUS_API_TOKEN`/`SERVICE_ROLE_KEY`
/`RESEND_API_KEY` vêm sempre de `Deno.env`.

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

Correção sugerida (baixo risco): envolver os dois com `escapeHtml` (e trocar o teste do
`_safeLogoUrl` por `new URL()` + allowlist de esquema). Fora do escopo automático por
mudar renderização — vira **PROPOSTA P-18**.

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

Correção sugerida (P-19): em `savePendencia`/`saveVisit`, montar o payload remoto a partir
de `list[i]`/`visit` (o registro mesclado) em vez do objeto parcial do form.

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
