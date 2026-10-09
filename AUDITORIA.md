# AUDITORIA — Init Intra

> **Branch:** `audit/2026-10-09` · **Data:** 09/10/2026 · **Status:** Fases 1–5 concluídas
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

| ID      | Sev.    | Conf. | Achado                                                                                                                                                                                     | Local                                                                                                                                                            | Status                                    |
| ------- | ------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| SEC-01  | CRÍTICO | ALTA  | Bucket `attachments` **público** + policy `attachments public read` sem `TO` → leitura anônima de documentos de clientes; app grava `getPublicUrl` no banco                                | `supabase/migrations/017_storage_attachments.sql:1-8`, `js/storage.js:1160-1162`                                                                                 | PROPOSTA (P-1)                            |
| SEC-02  | CRÍTICO | ALTA  | Policies `FOR ALL USING (true) WITH CHECK (true)` **sem `TO`** (aplicam-se a `anon`) em 8 tabelas                                                                                          | `supabase/migrations/004_procedure_templates.sql:25-27`, `018_reunioes.sql:33`, `035_equipamentos.sql:49`, diagnóstico próprio em `021_rls_remediation.sql:5-14` | PROPOSTA (P-2) / DBA                      |
| SEC-03  | ALTO    | ALTA  | Edge Function `send-email` **sem verificação de JWT/role**: aceita `from`/`to`/`html` arbitrários → relay/spoofing                                                                         | `supabase/functions/send-email/index.ts:24-60`                                                                                                                   | PROPOSTA (P-3)                            |
| SEC-04  | ALTO    | ALTA  | Service Worker cacheava GETs autenticados do Supabase na Cache Storage (chave = URL, ignora `Authorization`) → dados de um usuário servidos a outra sessão                                 | `sw.js` (handler `fetch`)                                                                                                                                        | **CORRIGIDO** `24d9160`                   |
| SEC-05  | MÉDIO   | ALTA  | CDN `motion@13.1.1` carregado **sem `integrity`** (SRI)                                                                                                                                    | `index.html:294`                                                                                                                                                 | **CORRIGIDO** `6ca1acc`                   |
| SEC-06  | MÉDIO   | ALTA  | URL/chave do Supabase sobrescrevíveis via `localStorage` (`intra_supabase_url`/`intra_supabase_key`)                                                                                       | `js/supabase-config.js:12-14,38-39`                                                                                                                              | PROPOSTA (P-4)                            |
| SEC-07  | MÉDIO   | ALTA  | CSP com `script-src 'unsafe-inline'` e `style-src 'unsafe-inline'` → não mitiga XSS inline (`onclick` no HTML gerado)                                                                      | `vercel.json:5-19`                                                                                                                                               | PROPOSTA (P-5)                            |
| SEC-08  | MÉDIO   | ALTA  | Rate-limit de login só em memória (`_loginGuard`), zera no reload; sem trava server-side                                                                                                   | `js/auth.js:6-27`                                                                                                                                                | PROPOSTA (P-7)                            |
| SEC-09  | BAIXO   | ALTA  | `Access-Control-Allow-Origin: *` em todas as 9 Edge Functions (mitigado pela checagem de JWT, quando existe)                                                                               | `supabase/functions/*/index.ts`                                                                                                                                  | MONITORAR                                 |
| SEC-10  | BAIXO   | ALTA  | Upload de anexos valida **apenas tamanho** (2 MB); sem allowlist de tipo/extensão                                                                                                          | `js/storage.js:1145,1227,1374,1444`                                                                                                                              | PROPOSTA (P-8)                            |
| SEC-11  | INFO    | ALTA  | Credenciais antigas já estiveram no histórico Git (papel `anon`, removidas em `9ea37ad`); nenhum `service_role` vazado                                                                     | histórico Git                                                                                                                                                    | MONITORAR (rotacionar se exposto)         |
| SEC-12  | —       | MÉDIA | **SUSPEITA** — XSS: varredura de 93 `${...}` em `innerHTML`; pontos conferidos escapam (`escapeHtml`/`esc`/`_richEsc`/`textContent`). Nenhum XSS confirmado                                | `js/*`                                                                                                                                                           | SUSPEITA                                  |
| SYNC-01 | MÉDIO   | MÉDIA | **SUSPEITA** — `pull` sem `.range()`: se o PostgREST `max-rows` (padrão 1000) truncar, linhas ausentes são tratadas como “deletadas no servidor” e **descartadas do merged** → perda local | `js/storage.js:834`, `js/schema.js:295-297`                                                                                                                      | PROPOSTA (P-9)                            |
| SYNC-02 | BAIXO   | ALTA  | Outbox cobre **só `pendencias`**; demais entidades sobem só no próximo ciclo de sync                                                                                                       | `js/storage.js:1910`, `js/storage.js:953`                                                                                                                        | PROPOSTA (P-10)                           |
| SYNC-03 | BAIXO   | MÉDIA | **SUSPEITA** — `applyRemote` reescreve a lista inteira via `dbSet` em paralelo com o merge do sync (corrida de escrita perdida)                                                            | `js/sync-manager.js:143`                                                                                                                                         | PROPOSTA (P-10)                           |
| SYNC-04 | MÉDIO   | ALTA  | `tickets` sem policies + RLS ligado = **fail-closed** (sync de `tickets` nega tudo)                                                                                                        | `021_rls_remediation.sql:9-12`                                                                                                                                   | PENDENTE (decisão de produto)             |
| SYNC-05 | MÉDIO   | ALTA  | Prefixo `011` duplicado (`011_rls_roles_teams.sql` + `011_visit_time_range.sql`) → ordem de aplicação ambígua                                                                              | `supabase/migrations/011_*.sql`                                                                                                                                  | PROPOSTA (P-11) / DBA                     |
| PERF-01 | MÉDIO   | ALTA  | `select('*')` sem paginação no pull de todas as entidades (+ `audit_logs` `select('*')` com 500 linhas)                                                                                    | `js/storage.js:834,1012`, `js/checklist.js:348,366,405`                                                                                                          | PROPOSTA (P-9)                            |
| PERF-02 | MÉDIO   | ALTA  | `dist/` nunca era limpo → 4.323 KB/73 arquivos acumulados                                                                                                                                  | `tools/build-assets.js`                                                                                                                                          | **CORRIGIDO** `12c875f`                   |
| PERF-03 | MÉDIO   | ALTA  | 32 `<script defer>` sem code-splitting + CSS de fontes bloqueante (3 famílias)                                                                                                             | `index.html:285-330`, `:13`                                                                                                                                      | PROPOSTA (P-12)                           |
| PERF-04 | BAIXO   | ALTA  | Contadores do quadro baixam `status,deadline` de todo o escopo a cada render                                                                                                               | `js/storage.js:1726-1731`                                                                                                                                        | MONITORAR                                 |
| CONS-01 | MÉDIO   | ALTA  | **398 `catch` vazios** (`catch (_) {}`); regra `no-empty` desligada → falhas silenciosas                                                                                                   | `js/*`, `eslint.config.js`                                                                                                                                       | PROPOSTA (P-13)                           |
| CONS-02 | MÉDIO   | ALTA  | 838 warnings de lint, **100% `no-unused-vars`** (0 erros)                                                                                                                                  | `js/`, `tools/`                                                                                                                                                  | PROPOSTA (P-14)                           |
| CONS-03 | MÉDIO   | ALTA  | `terser` declarado no `package.json` mas não instalado → build sem minify + teste falhando                                                                                                 | `tools/build-assets.js:41-47`                                                                                                                                    | **CORRIGIDO no ambiente** (`npm install`) |
| CONS-04 | MÉDIO   | ALTA  | 3 CVEs restantes em devDeps exigindo `vitest@5` (breaking)                                                                                                                                 | `package.json`                                                                                                                                                   | PROPOSTA (P-6)                            |
| CONS-05 | INFO    | ALTA  | Sem type-check em nenhum etapa                                                                                                                                                             | `package.json`                                                                                                                                                   | MONITORAR                                 |

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

| #   | Commit                    | Correção                                                                                                                        | Testes                                                                                                             |
| --- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1   | `7ba3d0d` `chore(deps)`   | `npm audit fix` → `brace-expansion` 1.1.18→1.1.21 e `source-map-js` 1.2.1→1.2.2 (2 highs resolvidos, devDeps)                   | 537/537 ✓ lint 0 erros ✓                                                                                           |
| 2   | `12c875f` `fix(build)`    | `tools/build-assets.js` agora remove hashes antigos de `dist/js` e `dist/css` antes de finalizar (`removed` reportado no build) | **novo teste** `tests/build-assets.test.js` (5) ✓ build: 72 obsoletos removidos, `dist/` 4.323 KB → 953 KB         |
| 3   | `6ca1acc` `fix(security)` | `integrity` + `crossorigin` em `motion@13.1.1` no `index.html`                                                                  | **novo teste** `tests/cdn-sri.test.js` (3): falha se qualquer script externo sair sem SRI                          |
| 4   | `24d9160` `fix(pwa)`      | SW não intercepta/cacheia GETs com `apikey`/`authorization`                                                                     | **novo teste** `tests/sw-cache.test.js` (5, sandbox `vm`): Supabase bypassado, mesmo-origem e CDN seguem cacheados |

**Estado final:** `npm test` **546/546** · `npm run lint` **0 erros / 838 warnings** ·
`npm run build` ok (com minify) · `index.html`/`sw.js` restaurados ao modo dev após validar o build ·
`git status` limpo (exceto `supabase/functions/milvus-chamado-create/index.ts`, debug, e
`referencia/`, fora do escopo — **não commitados**).

---

## 7. Propostas (não aplicadas) — prós e contras

| #    | Proposta                                                                                         | Prós                                                 | Contras / risco                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| P-1  | Aplicar `022_storage_private.sql` + migrar o app para signed URLs (`js/storage.js:1162`)         | Fecha leitura anônima de anexos (SEC-01)             | Requer backup, conferência de paths (Q-INV1/2/3), código de signed URLs antes da migração; sem isso anexos quebram. **DBA + deploy atômico** |
| P-2  | Aplicar `021_rls_remediation.sql` (remove `X all USING (true)` e cria policies por equipe/admin) | Fecha SEC-02 em 8 tabelas                            | Exige DBA, staging e bateria de 13 testes; decisão pendente sobre `tickets` (SYNC-04)                                                        |
| P-3  | `send-email`: exigir JWT + papel `admin`/`gestao` e fixar `from` permitido                       | Elimina relay aberto (SEC-03)                        | Altera contrato da API — clientes que chamam sem JWT passam a receber 401; precisa de deploy das 9 functions                                 |
| P-4  | Remover override via `localStorage` de URL/chave (ou exigir flag de build)                       | Remove vetor de redirecionamento do backend (SEC-06) | Perde o recurso de “apontar p/ outro projeto pelo console”, usado na documentação interna                                                    |
| P-5  | Tirar `unsafe-inline` do CSP (refatorar `onclick` globais p/ `addEventListener`)                 | Mitiga XSS de verdade (SEC-07)                       | Grande refatoração de UI; risco de quebrar handlers gerados por template                                                                     |
| P-6  | Subir para `vitest@5` (resolve as 3 CVEs restantes)                                              | `npm audit` limpo                                    | Breaking: pode exigir mudar config/testes; precisa rodar a bateria completa                                                                  |
| P-7  | Rate-limit de login no servidor (ou tabela de tentativas)                                        | Fecha SEC-08 de verdade                              | Exige migração + lógica nova; o guard client-side é apenas informativo                                                                       |
| P-8  | Allowlist de MIME/extensão no upload de anexos                                                   | Reduz upload de SVG/HTML hostil (SEC-10)             | Pode bloquear formatos legítimos se for restritivo demais                                                                                    |
| P-9  | Pull paginado (`.range()`) + colunas mínimas (`status,deadline`, etc.)                           | Resolve PERF-01 e mitiga SYNC-01                     | Tem que garantir `updated_at` em toda coluna selecionada, senão tombstone/merge quebram (risco de perda)                                     |
| P-10 | Outbox genérica (todas as entidades) + lock de escrita entre `applyRemote` e merge               | Fecha SYNC-02/SYNC-03                                | Refatoração do caminho crítico de sync; exige testes de concorrência                                                                         |
| P-11 | Renomear `011_visit_time_range.sql` p/ `012_*` (renumerar restantes)                             | Remove ambiguidade de ordem (SYNC-05)                | Só é seguro se a migration nunca rodou; **DBA precisa confirmar histórico**                                                                  |
| P-12 | Code-splitting das telas + subset de fontes                                                      | Reduz payload inicial (PERF-03)                      | Muda a ordem de carregamento global (`navigateTo` depende de globais)                                                                        |
| P-13 | Habilitar `no-empty` (exceto `_`) + log de erro mínimo nos `catch`                               | 398 falhas silenciosas viram visíveis (CONS-01)      | Gera centenas de alterações; precisa de janela dedicada                                                                                      |
| P-14 | Limpar `no-unused-vars` (838) em lotes                                                           | Lint zerado, morte reduzida (CONS-02)                | Trabalho mecânico; risco de apagar variáveis “usadas por string/`window`”                                                                    |

---

## 8. Próximos passos

1. **Urgente (DBA + staging):** P-1 e P-2 — as duas exposições CRÍTICO; rodar backup →
   `021` → conferir `pg_policies` → `022` (somente com signed URLs já em produção).
2. **Alto:** P-3 (`send-email`) e P-6 (`vitest@5`) — correções pontuais, alto valor/baixo custo.
3. **Verificação (somente leitura):** confirmar `Max rows` da API Supabase e
   `select count(*)` das tabelas grandes (valida/refuta SYNC-01).
4. **Continuidade:** P-9 (pull paginado), P-13/P-14 (limpeza de código) e fechar SUSPEITA
   SEC-12 com teste de fuzzing de campos de texto em `innerHTML`.
5. **Antes de qualquer merge:** revisar os 4 commits, rodar `npm test` + `npm run lint` +
   `npm run build` no CI e decidir sobre `push` (hoje **não** foi feito, conforme orientado).
