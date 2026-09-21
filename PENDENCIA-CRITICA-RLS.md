# 🔴 CRÍTICO — RLS permissivo: qualquer autenticado lê/escreve quase tudo via API

- **Prioridade:** CRÍTICA
- **Status:** PENDENTE (aguardando DBA)
- **Origem:** auditoria do Dashboard por perfil (2026). Esconder blocos no
  frontend NÃO blinda os dados — o app sincroniza tudo para o Dexie local e
  qualquer console/anon-key alcança a API.

## Evidência (código)

- Baseline `supabase/migration.sql` criou policies `"operators all"`,
  `"clients all"`, `"pendencias all"` com `FOR ALL USING (true)` (sem `TO`
  = vale até p/ anon).
- Auditoria interna `supabase/migrations/021_rls_remediation.sql` (marcada
  "NÃO APLICAR / revisão") confirma via `pg_policies`: policies `"X all"`
  em 8 tabelas anulam por OU permissivo todas as policies por equipe/admin.
- `024_teams_mam_bt_isolation.sql` ("PODE APLICAR") faz o recorte mínimo
  operators/clients/pendencias — verificar se foi aplicada em produção.
- Já travados: `audit_logs` só-admin (`010`), writes de `operators`
  (`011`/`014`). Aberto por desenho: `procedure_templates` global.

## Impacto

Técnico autenticado pode ler (e em várias tabelas escrever/excluir) dados de
outras equipes — pendências, clientes, operadores, visitas — direto pela API
ou DevTools, independente dos gates visuais do Dashboard.

## Verificação (rodar com os próprios olhos)

1. **SQL Editor (Supabase, como postgres):**
   ```sql
   SELECT tablename, policyname, cmd FROM pg_policies
   WHERE schemaname='public' AND policyname ILIKE '% all %'
   ORDER BY tablename;
   ```
   Se retornar linhas em `clients/pendencias/operators/visits` → exposição
   confirmada.
2. **Console do app (logado como operador NÃO-admin, sem dados — só conta):**
   ```js
   (async () => ({
     pendencias: (await supabaseClient.from('pendencias').select('id', { count: 'exact', head: true })),
     operators: (await supabaseClient.from('operators').select('id', { count: 'exact', head: true })),
     clients: (await supabaseClient.from('clients').select('id', { count: 'exact', head: true })),
   }))();
   ```
   `count` numérico = leitura liberada além do time do operador.

## Remediação (DBA, tarefa separada do frontend)

1. Backup/snapshot do projeto Supabase.
2. Aplicar `024_teams_mam_bt_isolation.sql` (blocos §0→§5, nessa ordem).
3. Avaliar/aplicar `021_rls_remediation.sql` (cobre visits/reunioes/
   procedures/templates; tem pré-requisitos e Q-ORFÃS no cabeçalho).
4. Re-rodar a verificação acima: esperado zero policies `% all` vindas do app.
5. Re-testar sync offline-first em aparelho de operador (login, pull, push,
   realtime) antes de considerar encerrado.

## Critério de aceite

- Query do item 1 sem policies `% all` em tabelas de dados.
- Probe do item 2 como não-admin retorna só contagens do próprio time
  (ou 403 onde não houver acesso).
- Nenhuma regressão no sync (suíte `npm test` + smoke em 2 aparelhos).
