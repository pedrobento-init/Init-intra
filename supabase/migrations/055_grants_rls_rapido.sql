-- ============================================================
-- Migration 055: GRANTs explícitos e RLS sem custo por linha
-- ============================================================
-- 1) GRANTS EXPLÍCITOS
--    A Supabase deixou de liberar tabelas novas para a API automaticamente
--    (padrão em projetos novos desde 30/05/2026; vale para todos a partir
--    de 30/10/2026). 16 tabelas do app só funcionavam por causa dessa
--    liberação automática: num projeto novo (ex.: staging) o app ficaria
--    sem ler nada. Aqui cada tabela recebe o acesso que o app usa;
--    quem decide QUAIS linhas continua sendo o RLS.
--
-- 2) RLS RÁPIDO (mesmas regras da 042/045/048/050/053)
--    As policies chamavam os helpers (can_see_team, current_op_is_admin...)
--    uma vez POR LINHA: função SECURITY DEFINER não é "inlined" pelo
--    Postgres. Numa leitura de 20 mil pendências (como a leitura leve do
--    sync parcial) isso custava ~680 ms; com os helpers dentro de
--    (SELECT ...) o Postgres calcula uma vez por consulta: ~55 ms.
--    Recomendação da Supabase: "wrap functions in SELECT".
--    As regras de acesso NÃO mudam: tests/rls-055.test.js compara, para
--    cada perfil (anon, técnico, outra equipe, Gestão, admin, inativo),
--    o que se lê e o que se grava antes e depois desta migration.
--
-- COMO APLICAR: depois da 054. Staging primeiro. Idempotente (pode rodar
-- de novo). Recria TODAS as policies das tabelas do app (laço em
-- pg_policies, como a 042), então policy criada à mão no painel some.
-- ============================================================

-- ── 1. GRANTs ────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO authenticated, service_role;

DO $$
DECLARE
  t text;
  seq text;
BEGIN
  -- Tabelas que o app lê e grava (o RLS filtra as linhas).
  FOREACH t IN ARRAY ARRAY[
    'operators', 'clients', 'pendencias', 'visits', 'procedures', 'procedure_templates',
    'reunioes', 'tickets', 'equipamentos', 'client_devices', 'milvus_client_map',
    'client_milvus_tickets', 'checklists', 'checklist_modelo_itens', 'checklist_marcacoes',
    'vencimentos', 'time_entries', 'push_subscriptions'
  ]
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
  -- Logs: sem UPDATE (registro não se reescreve).
  FOREACH t IN ARRAY ARRAY['audit_logs', 'client_errors']
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('GRANT SELECT, INSERT, DELETE ON public.%I TO authenticated', t);
    seq := NULL;
    IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.' || t) AND attname = 'id' AND NOT attisdropped) THEN
      seq := pg_get_serial_sequence('public.' || t, 'id');
    END IF;
    IF seq IS NOT NULL THEN
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO authenticated', seq);
    END IF;
  END LOOP;

  -- Edge Functions e cron (service_role ignora o RLS, mas precisa do GRANT).
  -- Inclui as tabelas que só o servidor usa: o app não recebe acesso a elas.
  FOREACH t IN ARRAY ARRAY[
    'operators', 'clients', 'pendencias', 'visits', 'procedures', 'procedure_templates',
    'audit_logs', 'reunioes', 'tickets', 'equipamentos', 'client_devices', 'milvus_client_map',
    'client_milvus_tickets', 'checklists', 'checklist_modelo_itens', 'checklist_marcacoes',
    'vencimentos', 'time_entries', 'client_errors', 'push_subscriptions',
    'email_notifications', 'avisos_enviados', 'calendar_feeds', 'client_secrets'
  ]
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    seq := NULL;
    IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.' || t) AND attname = 'id' AND NOT attisdropped) THEN
      seq := pg_get_serial_sequence('public.' || t, 'id');
    END IF;
    IF seq IS NOT NULL THEN
      EXECUTE format('GRANT ALL ON SEQUENCE %s TO service_role', seq);
    END IF;
  END LOOP;
END $$;

-- ── 2. Zera as policies das tabelas do app ───────────────────
DO $$
DECLARE
  t text;
  p record;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'operators', 'clients', 'pendencias', 'visits', 'procedures', 'procedure_templates',
    'audit_logs', 'reunioes', 'tickets', 'equipamentos', 'client_devices', 'milvus_client_map',
    'client_milvus_tickets', 'checklists', 'checklist_modelo_itens', 'checklist_marcacoes',
    'vencimentos', 'time_entries', 'client_errors', 'push_subscriptions'
  ]
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, t);
    END LOOP;
  END LOOP;
END $$;

-- ── 3. Policies novas ────────────────────────────────────────
-- Cada helper vai dentro de (SELECT ...): calculado uma vez por consulta.
-- Expressões (iguais às da 042):
--   admin ....... (SELECT public.current_op_is_admin())
--   equipe ...... admin OU COALESCE(team, 'init') = (SELECT public.current_op_team())
--   cliente ..... admin OU client_id entre os clientes da equipe
--   ativo ....... (SELECT public.current_op_team()) IS NOT NULL OU admin
DO $$
DECLARE
  adm  constant text := '(SELECT public.current_op_is_admin())';
  team constant text := '((SELECT public.current_op_is_admin()) OR COALESCE(team, ''init'') = (SELECT public.current_op_team()))';
  cli  constant text := '((SELECT public.current_op_is_admin()) OR client_id IN (SELECT c.id FROM public.clients c WHERE COALESCE(c.team, ''init'') = (SELECT public.current_op_team())))';
  ativo constant text := '((SELECT public.current_op_team()) IS NOT NULL OR (SELECT public.current_op_is_admin()))';
  meu  constant text := '(SELECT public.current_op_id())';
  t text;
  proc text;
BEGIN
  -- Tabelas por equipe: lê/cria/edita a equipe; exclui só admin.
  FOREACH t IN ARRAY ARRAY['clients', 'visits', 'reunioes', 'equipamentos',
    'client_devices', 'client_milvus_tickets', 'vencimentos']
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (%s)', t || '_select', t, team);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (%s)', t || '_insert', t, team);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)', t || '_update', t, team, team);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (%s)', t || '_delete', t, adm);
  END LOOP;

  -- Marcações de checklist: a equipe também desmarca.
  IF to_regclass('public.checklist_marcacoes') IS NOT NULL THEN
    EXECUTE format('CREATE POLICY ckmarc_select ON public.checklist_marcacoes FOR SELECT TO authenticated USING (%s)', team);
    EXECUTE format('CREATE POLICY ckmarc_insert ON public.checklist_marcacoes FOR INSERT TO authenticated WITH CHECK (%s)', team);
    EXECUTE format('CREATE POLICY ckmarc_update ON public.checklist_marcacoes FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)', team, team);
    EXECUTE format('CREATE POLICY ckmarc_delete ON public.checklist_marcacoes FOR DELETE TO authenticated USING (%s)', team);
  END IF;

  -- Pendências: tipo Gestão só para is_gestao (037); demais pela equipe.
  EXECUTE format('CREATE POLICY pens_select ON public.pendencias FOR SELECT TO authenticated USING (CASE WHEN COALESCE(tipo, '''') IN (''Gestão'', ''Gestao'') THEN (SELECT public.current_op_is_gestao()) ELSE %s END)', team);
  EXECUTE format('CREATE POLICY pens_insert ON public.pendencias FOR INSERT TO authenticated WITH CHECK (CASE WHEN COALESCE(tipo, '''') IN (''Gestão'', ''Gestao'') THEN (SELECT public.current_op_is_gestao()) ELSE %s END)', team);
  EXECUTE format('CREATE POLICY pens_update ON public.pendencias FOR UPDATE TO authenticated USING (CASE WHEN COALESCE(tipo, '''') IN (''Gestão'', ''Gestao'') THEN (SELECT public.current_op_is_gestao()) ELSE %s END) WITH CHECK (CASE WHEN COALESCE(tipo, '''') IN (''Gestão'', ''Gestao'') THEN (SELECT public.current_op_is_gestao()) ELSE %s END)', team, team);
  EXECUTE format('CREATE POLICY pens_delete ON public.pendencias FOR DELETE TO authenticated USING (CASE WHEN COALESCE(tipo, '''') IN (''Gestão'', ''Gestao'') THEN (SELECT public.current_op_is_gestao()) ELSE %s END)', adm);

  -- Procedimentos: com cliente, pela equipe do cliente; artigo da base, pela equipe do artigo.
  proc := format('(CASE WHEN client_id IS NULL THEN %s ELSE %s END)', team, cli);
  EXECUTE format('CREATE POLICY procedures_select ON public.procedures FOR SELECT TO authenticated USING %s', proc);
  EXECUTE format('CREATE POLICY procedures_insert ON public.procedures FOR INSERT TO authenticated WITH CHECK %s', proc);
  EXECUTE format('CREATE POLICY procedures_update ON public.procedures FOR UPDATE TO authenticated USING %s WITH CHECK %s', proc, proc);
  EXECUTE format('CREATE POLICY procedures_delete ON public.procedures FOR DELETE TO authenticated USING (%s)', adm);

  -- Mapa Milvus × cliente: pela equipe do cliente.
  IF to_regclass('public.milvus_client_map') IS NOT NULL THEN
    EXECUTE format('CREATE POLICY mmap_select ON public.milvus_client_map FOR SELECT TO authenticated USING (%s)', cli);
    EXECUTE format('CREATE POLICY mmap_insert ON public.milvus_client_map FOR INSERT TO authenticated WITH CHECK (%s)', cli);
    EXECUTE format('CREATE POLICY mmap_update ON public.milvus_client_map FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)', cli, cli);
    EXECUTE format('CREATE POLICY mmap_delete ON public.milvus_client_map FOR DELETE TO authenticated USING (%s)', adm);
  END IF;

  -- Bibliotecas: modelos de procedimento (todos os ativos editam) e checklists (só admin escreve).
  EXECUTE format('CREATE POLICY procedure_templates_select ON public.procedure_templates FOR SELECT TO authenticated USING (%s)', ativo);
  EXECUTE format('CREATE POLICY procedure_templates_insert ON public.procedure_templates FOR INSERT TO authenticated WITH CHECK (%s)', ativo);
  EXECUTE format('CREATE POLICY procedure_templates_update ON public.procedure_templates FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)', ativo, ativo);
  EXECUTE format('CREATE POLICY procedure_templates_delete ON public.procedure_templates FOR DELETE TO authenticated USING (%s)', adm);
  FOREACH t IN ARRAY ARRAY['checklists', 'checklist_modelo_itens']
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (%s)', t || '_select', t, ativo);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (%s)', t || '_insert', t, adm);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)', t || '_update', t, adm, adm);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (%s)', t || '_delete', t, adm);
  END LOOP;

  -- Operadores: todo ativo lê; o próprio edita o perfil (o trigger
  -- operators_guard_self_update da 042 segura papel, equipe e flags).
  EXECUTE format($p$CREATE POLICY ops_select ON public.operators FOR SELECT TO authenticated
    USING (%s OR auth_user_id = (SELECT auth.uid())
      OR (auth_user_id IS NULL AND email IS NOT NULL AND lower(email) = lower(COALESCE((SELECT auth.jwt()) ->> 'email', ''))))$p$, ativo);
  EXECUTE format($p$CREATE POLICY ops_insert ON public.operators FOR INSERT TO authenticated
    WITH CHECK (%s OR (id = %s AND auth_user_id = (SELECT auth.uid())
      AND COALESCE(is_admin, false) = false
      AND COALESCE(is_gestao, false) = (SELECT public.current_op_is_gestao())
      AND COALESCE(team, 'init') = (SELECT public.current_op_team())))$p$, adm, meu);
  EXECUTE format($p$CREATE POLICY ops_update ON public.operators FOR UPDATE TO authenticated
    USING (%s OR auth_user_id = (SELECT auth.uid())
      OR (auth_user_id IS NULL AND email IS NOT NULL AND lower(email) = lower(COALESCE((SELECT auth.jwt()) ->> 'email', ''))))
    WITH CHECK (%s OR auth_user_id = (SELECT auth.uid()))$p$, adm, adm);
  EXECUTE format('CREATE POLICY ops_delete ON public.operators FOR DELETE TO authenticated USING (%s)', adm);

  -- Auditoria: admin lê; cada um só grava log em nome próprio.
  EXECUTE format('CREATE POLICY logs_select ON public.audit_logs FOR SELECT TO authenticated USING (%s)', adm);
  EXECUTE format('CREATE POLICY logs_insert ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (%s OR operator_name = (SELECT public.current_op_name()))', adm);
  EXECUTE format('CREATE POLICY logs_delete ON public.audit_logs FOR DELETE TO authenticated USING (%s)', adm);

  IF to_regclass('public.tickets') IS NOT NULL THEN
    EXECUTE format('CREATE POLICY tickets_admin ON public.tickets FOR ALL TO authenticated USING (%s) WITH CHECK (%s)', adm, adm);
  END IF;

  -- Horas (048): equipe vê e lança; corrigir/excluir só o próprio (ou admin).
  IF to_regclass('public.time_entries') IS NOT NULL THEN
    EXECUTE format('CREATE POLICY time_entries_select ON public.time_entries FOR SELECT TO authenticated USING (%s)', team);
    EXECUTE format('CREATE POLICY time_entries_insert ON public.time_entries FOR INSERT TO authenticated WITH CHECK (%s)', team);
    EXECUTE format('CREATE POLICY time_entries_update ON public.time_entries FOR UPDATE TO authenticated USING (%s OR (%s AND operator_id = %s)) WITH CHECK (%s OR (%s AND operator_id = %s))', adm, team, meu, adm, team, meu);
    EXECUTE format('CREATE POLICY time_entries_delete ON public.time_entries FOR DELETE TO authenticated USING (%s OR (%s AND operator_id = %s))', adm, team, meu);
  END IF;

  -- Erros do app (050): cada um grava os próprios; admin lê e apaga.
  IF to_regclass('public.client_errors') IS NOT NULL THEN
    EXECUTE format('CREATE POLICY client_errors_insert ON public.client_errors FOR INSERT TO authenticated WITH CHECK (operator_id IS NOT DISTINCT FROM %s AND length(message) <= 2000 AND length(COALESCE(stack, '''')) <= 4000)', meu);
    EXECUTE format('CREATE POLICY client_errors_select ON public.client_errors FOR SELECT TO authenticated USING (%s)', adm);
    EXECUTE format('CREATE POLICY client_errors_delete ON public.client_errors FOR DELETE TO authenticated USING (%s)', adm);
  END IF;

  -- Push (053): cada um só as próprias inscrições.
  IF to_regclass('public.push_subscriptions') IS NOT NULL THEN
    EXECUTE format('CREATE POLICY push_subscriptions_select ON public.push_subscriptions FOR SELECT TO authenticated USING (operator_id = %s)', meu);
    EXECUTE format('CREATE POLICY push_subscriptions_insert ON public.push_subscriptions FOR INSERT TO authenticated WITH CHECK (operator_id = %s)', meu);
    EXECUTE format('CREATE POLICY push_subscriptions_update ON public.push_subscriptions FOR UPDATE TO authenticated USING (operator_id = %s) WITH CHECK (operator_id = %s)', meu, meu);
    EXECUTE format('CREATE POLICY push_subscriptions_delete ON public.push_subscriptions FOR DELETE TO authenticated USING (operator_id = %s)', meu);
  END IF;
END $$;

-- ── 4. Índice usado em toda checagem de "quem sou eu" ────────
-- Os helpers buscam o operador por auth_user_id. O índice existia só no
-- migration.sql antigo (fora da pasta migrations/).
CREATE INDEX IF NOT EXISTS idx_operators_auth_user_id ON public.operators(auth_user_id);

-- ── 5. VERIFICAÇÃO (somente leitura; rode depois) ────────────
-- a) Nenhum helper chamado por linha (esperado: 0 linhas):
--   SELECT tablename, policyname FROM pg_policies
--    WHERE schemaname = 'public'
--      AND (regexp_replace(COALESCE(qual, '') || ' ' || COALESCE(with_check, ''), '\(\s*SELECT\s+(public\.)?(current_op_\w+|auth\.\w+)\(\)', '', 'g')
--           ~ '(current_op_\w+|can_see_\w+|auth\.uid|auth\.jwt)\(');
-- b) App com acesso às tabelas (esperado: uma linha por tabela do app):
--   SELECT table_name, string_agg(privilege_type, ', ' ORDER BY privilege_type)
--     FROM information_schema.role_table_grants
--    WHERE grantee = 'authenticated' AND table_schema = 'public' GROUP BY 1 ORDER BY 1;
-- c) anon sem nenhum privilégio de tabela (esperado: 0 linhas):
--   SELECT table_name, privilege_type FROM information_schema.role_table_grants
--    WHERE grantee = 'anon' AND table_schema = 'public';
