-- ============================================================
-- Migration 021: Remediação de RLS (fecha exposição total) — REVISÃO 2
-- ============================================================
-- STATUS: ARQUIVO PARA REVISÃO. NÃO APLICAR sem ler os avisos abaixo.
--
-- DIAGNÓSTICO (auditoria C2, confirmado em produção via pg_policies):
-- - Policies `"X all" FOR ALL USING (true)` vigentes em 8 tabelas anulam,
--   por OU permissivo, todas as policies específicas por equipe/admin.
-- - `visits` tem só `visits_delete` (+ `visits all`): faltam
--   select/insert/update por equipe (bloco da 011 nunca rodou com ela).
-- - `reunioes` tem SÓ `reunioes all` (018 nunca foi corrigida).
-- - `procedures`/`procedure_templates` têm `_write ALL authenticated`
--   (014 nunca aplicada — vide ops_insert/update ainda na versão 011).
-- - `tickets` SEM policies + RLS ligado = fail-closed (sync nega tudo).
--
-- ESTADO REAL CONFIRMADO (Q1): 011 aplicada EXCETO bloco visits;
-- 014 NÃO aplicada. Esta migration é autocontida: não pressupõe a 014 e
-- não altera operators/audit_logs além de remover o `"X all"`.
-- DECISÃO PENDENTE (C2-F2, fora desta migration): `tickets` — (a) remover
-- do SYNC_ENTITIES (código) ou (b) ADD COLUMN team + policies. Aqui:
-- intocado (continua fail-closed, sem vazar nem ressuscitar).
--
-- MODELO DE SEGURANÇA APLICADO (igual ao 011/014 onde existia):
-- - clients/pendencias/visits/reunioes: admin OU mesma equipe (team).
-- - procedures: admin OU equipe do CLIENTE PAI (via client_id → clients).
--   Motivo: procedures nunca têm team próprio (001/004, schema.js), mas
--   todo fluxo do app as acessa dentro de um cliente (clients.js:
--   getProcedures(clientId), openProcedureForm(clientId), templates.js
--   aplica modelo "para N clientes"). Sem team próprio, o vínculo com o
--   cliente é a única amarração correta — global seria vazamento.
-- - procedure_templates: GLOBAL POR DESENHO (qualquer authenticated
--   lê/escreve; delete só admin). Motivo documentado: biblioteca
--   compartilhada entre equipes/clientes, sem coluna team em nenhum
--   schema (001/004), UI 100% global (templates.js, pendencias form,
--   reuniões aplicam em qualquer cliente). Restringir por equipe quebraria
--   a funcionalidade e exigiria coluna team + backfill (ETAPA futura, se
--   um dia desejado). O risco residual aceito e explícito: um técnico
--   pode editar/excluir-conteúdo de modelos (delete segue só-admin).
-- - operators/audit_logs: mantém 011 (delete/select admin onde já há);
--   auto-cadastro 011 NÃO é endurecido aqui (mudaria fluxo de 1º login —
--   follow-up com análise de auth.js).
--
-- PRÉ-REQUISITOS ANTES DE APLICAR:
-- 1. Backup do banco (snapshot do Supabase).
-- 2. Rodar Q-ORFÃS abaixo: procedures com client_id nulo/órfão ficam
--    visíveis SÓ p/ admin após esta migration (fail-closed intencional).
--    Se houver muitas, sanear (reatribuir) antes.
-- 3. Rodar em staging/homologação primeiro.
-- 4. Sessões ativas continuam válidas; realtime reconecta sozinho.
--
-- Q-ORFÃS (somente leitura, rode ANTES):
--   SELECT id, title, client_id FROM procedures
--   WHERE client_id IS NULL
--      OR NOT EXISTS (SELECT 1 FROM clients c WHERE c.id = procedures.client_id);
--
-- VERIFICAÇÃO APÓS APLICAR (somente leitura):
--   SELECT tablename, policyname, cmd, roles FROM pg_policies
--   WHERE schemaname = 'public' ORDER BY tablename, policyname;
--   Esperado: (a) zero policies `% all` vindas de app; (b) procedures_*
--   com USING referenciando clients; (c) templates = select/insert/update
--   authenticated + delete admin (global documentado).
--
-- ROLLBACK: policies DROPadas podem ser recriadas a partir de
-- supabase/migration.sql + 018 (guardar saída de pg_policies antes).
-- ============================================================

-- ── 1. Remove as policies totalmente abertas ("X all") ────────────────
DROP POLICY IF EXISTS "operators all" ON public.operators;
DROP POLICY IF EXISTS "clients all" ON public.clients;
DROP POLICY IF EXISTS "pendencias all" ON public.pendencias;
DROP POLICY IF EXISTS "visits all" ON public.visits;
DROP POLICY IF EXISTS "procedures all" ON public.procedures;
DROP POLICY IF EXISTS "procedure_templates all" ON public.procedure_templates;
DROP POLICY IF EXISTS "audit_logs all" ON public.audit_logs;
DROP POLICY IF EXISTS "reunioes all" ON public.reunioes;

-- ── 2. Remove resquícios permissivos de era 005/006, se existirem ─────
-- (A 011 já remove a maioria; isto é defesa em profundidade idempotente.)
DROP POLICY IF EXISTS "Authenticated users can delete clients" ON public.clients;
DROP POLICY IF EXISTS "Authenticated users can delete pendencias" ON public.pendencias;
DROP POLICY IF EXISTS "Authenticated users can delete operators" ON public.operators;
DROP POLICY IF EXISTS "Authenticated users can delete procedures" ON public.procedures;
DROP POLICY IF EXISTS "Authenticated users can delete procedure_templates" ON public.procedure_templates;
DROP POLICY IF EXISTS "Authenticated users can delete audit_logs" ON public.audit_logs;

-- ── 3. visits: policies por equipe (faltantes) ────────────────────────
DO $$
BEGIN
  IF to_regclass('public.visits') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "visits_select" ON public.visits';
    EXECUTE 'DROP POLICY IF EXISTS "visits_insert" ON public.visits';
    EXECUTE 'DROP POLICY IF EXISTS "visits_update" ON public.visits';
    EXECUTE 'DROP POLICY IF EXISTS "visits_delete" ON public.visits';
    EXECUTE $p$
      CREATE POLICY "visits_select" ON public.visits
        FOR SELECT TO authenticated
        USING (public.current_op_is_admin() OR COALESCE(team, 'init') = public.current_op_team())
    $p$;
    EXECUTE $p$
      CREATE POLICY "visits_insert" ON public.visits
        FOR INSERT TO authenticated
        WITH CHECK (public.current_op_is_admin() OR COALESCE(team, 'init') = public.current_op_team())
    $p$;
    EXECUTE $p$
      CREATE POLICY "visits_update" ON public.visits
        FOR UPDATE TO authenticated
        USING (public.current_op_is_admin() OR COALESCE(team, 'init') = public.current_op_team())
        WITH CHECK (public.current_op_is_admin() OR COALESCE(team, 'init') = public.current_op_team())
    $p$;
    EXECUTE $p$
      CREATE POLICY "visits_delete" ON public.visits
        FOR DELETE TO authenticated
        USING (public.current_op_is_admin())
    $p$;
  END IF;
END $$;

-- ── 4. reunioes: policies por equipe (inexistentes até aqui) ──────────
DO $$
BEGIN
  IF to_regclass('public.reunioes') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "reunioes_select" ON public.reunioes';
    EXECUTE 'DROP POLICY IF EXISTS "reunioes_insert" ON public.reunioes';
    EXECUTE 'DROP POLICY IF EXISTS "reunioes_update" ON public.reunioes';
    EXECUTE 'DROP POLICY IF EXISTS "reunioes_delete" ON public.reunioes';
    EXECUTE $p$
      CREATE POLICY "reunioes_select" ON public.reunioes
        FOR SELECT TO authenticated
        USING (public.current_op_is_admin() OR COALESCE(team, 'init') = public.current_op_team())
    $p$;
    EXECUTE $p$
      CREATE POLICY "reunioes_insert" ON public.reunioes
        FOR INSERT TO authenticated
        WITH CHECK (public.current_op_is_admin() OR COALESCE(team, 'init') = public.current_op_team())
    $p$;
    EXECUTE $p$
      CREATE POLICY "reunioes_update" ON public.reunioes
        FOR UPDATE TO authenticated
        USING (public.current_op_is_admin() OR COALESCE(team, 'init') = public.current_op_team())
        WITH CHECK (public.current_op_is_admin() OR COALESCE(team, 'init') = public.current_op_team())
    $p$;
    EXECUTE $p$
      CREATE POLICY "reunioes_delete" ON public.reunioes
        FOR DELETE TO authenticated
        USING (public.current_op_is_admin())
    $p$;
  END IF;
END $$;

-- ── 5. procedures: escopo via CLIENTE PAI (sem team próprio) ──────────
-- Qualquer authenticated NÃO basta: técnico só enxerga procedures de
-- clientes da própria equipe (ou sendo admin). Órfãos (client_id nulo ou
-- cliente excluído): só admin — fail-closed intencional; sanear via Q-ORFÃS.
DO $$
BEGIN
  IF to_regclass('public.procedures') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "procedures_select" ON public.procedures';
    EXECUTE 'DROP POLICY IF EXISTS "procedures_write" ON public.procedures';
    EXECUTE 'DROP POLICY IF EXISTS "procedures_insert" ON public.procedures';
    EXECUTE 'DROP POLICY IF EXISTS "procedures_update" ON public.procedures';
    EXECUTE 'DROP POLICY IF EXISTS "procedures_delete" ON public.procedures';
    EXECUTE $p$
      CREATE POLICY "procedures_select" ON public.procedures
        FOR SELECT TO authenticated
        USING (
          public.current_op_is_admin()
          OR EXISTS (
            SELECT 1 FROM public.clients c
            WHERE c.id = procedures.client_id
              AND COALESCE(c.team, 'init') = public.current_op_team()
          )
        )
    $p$;
    EXECUTE $p$
      CREATE POLICY "procedures_insert" ON public.procedures
        FOR INSERT TO authenticated
        WITH CHECK (
          public.current_op_is_admin()
          OR EXISTS (
            SELECT 1 FROM public.clients c
            WHERE c.id = procedures.client_id
              AND COALESCE(c.team, 'init') = public.current_op_team()
          )
        )
    $p$;
    EXECUTE $p$
      CREATE POLICY "procedures_update" ON public.procedures
        FOR UPDATE TO authenticated
        USING (
          public.current_op_is_admin()
          OR EXISTS (
            SELECT 1 FROM public.clients c
            WHERE c.id = procedures.client_id
              AND COALESCE(c.team, 'init') = public.current_op_team()
          )
        )
        WITH CHECK (
          public.current_op_is_admin()
          OR EXISTS (
            SELECT 1 FROM public.clients c
            WHERE c.id = procedures.client_id
              AND COALESCE(c.team, 'init') = public.current_op_team()
          )
        )
    $p$;
    EXECUTE $p$
      CREATE POLICY "procedures_delete" ON public.procedures
        FOR DELETE TO authenticated
        USING (public.current_op_is_admin())
    $p$;
  END IF;
END $$;

-- ── 6. procedure_templates: GLOBAL POR DESENHO (documentado acima) ────
-- Mantém o modelo 011/014: qualquer authenticated lê/insere/atualiza
-- (biblioteca compartilhada, sem team em schema e UI), delete só admin.
DO $$
BEGIN
  IF to_regclass('public.procedure_templates') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "procedure_templates_select" ON public.procedure_templates';
    EXECUTE 'DROP POLICY IF EXISTS "procedure_templates_write" ON public.procedure_templates';
    EXECUTE 'DROP POLICY IF EXISTS "procedure_templates_insert" ON public.procedure_templates';
    EXECUTE 'DROP POLICY IF EXISTS "procedure_templates_update" ON public.procedure_templates';
    EXECUTE 'DROP POLICY IF EXISTS "procedure_templates_delete" ON public.procedure_templates';
    EXECUTE $p$
      CREATE POLICY "procedure_templates_select" ON public.procedure_templates
        FOR SELECT TO authenticated USING (true)
    $p$;
    EXECUTE $p$
      CREATE POLICY "procedure_templates_insert" ON public.procedure_templates
        FOR INSERT TO authenticated WITH CHECK (true)
    $p$;
    EXECUTE $p$
      CREATE POLICY "procedure_templates_update" ON public.procedure_templates
        FOR UPDATE TO authenticated USING (true) WITH CHECK (true)
    $p$;
    EXECUTE $p$
      CREATE POLICY "procedure_templates_delete" ON public.procedure_templates
        FOR DELETE TO authenticated USING (public.current_op_is_admin())
    $p$;
  END IF;
END $$;

-- ── 7. Revoga anon em TODAS as tabelas do app (a 014 cobriu só 8) ─────
-- Privilégio de banco ≠ RLS: sem GRANT, nem policy aberta alcança o anon.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'clients','pendencias','operators','visits','procedures',
    'procedure_templates','audit_logs','tickets','reunioes',
    'email_notifications'
  ]
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    END IF;
  END LOOP;
END $$;

-- ── 8. Pós-verificação (rode manualmente após aplicar) ────────────────
-- -- 8a. Nenhuma policy aberta de app restante:
-- SELECT tablename, policyname, cmd, roles FROM pg_policies
-- WHERE schemaname = 'public'
--   AND (policyname LIKE '% all' OR (roles::text LIKE '%public%' AND qual = 'true'))
-- ORDER BY tablename;
-- -- Esperado: zero linhas (as únicas USING(true) restantes devem ser as de
-- -- procedure_templates documentadas na seção 6 + service_role de e-mail).
-- -- 8b. Contagem de policies por tabela (sanidade: sem duplicadas):
-- SELECT tablename, count(*) FROM pg_policies
-- WHERE schemaname = 'public' GROUP BY tablename ORDER BY tablename;
