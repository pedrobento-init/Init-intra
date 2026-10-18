-- ============================================================
-- Migration 042: RLS completo e verificável (substitui 021 e fecha SEC-02/13/14)
-- ============================================================
-- POR QUE UMA MIGRATION NOVA EM VEZ DE APLICAR A 021:
-- - A 021 remove policies pelo NOME. Qualquer policy com nome diferente
--   (criada à mão no painel, de uma migration antiga, ou a "equipamentos all"
--   da 035, criada depois dela) continua valendo — e como policies
--   permissivas se somam por OU, UMA aberta anula todas as outras.
-- - Aqui, para cada tabela do app, TODAS as policies existentes são
--   removidas (laço em pg_policies) e o conjunto completo é recriado.
--   O resultado final não depende do histórico do banco.
-- - Testado automaticamente em Postgres real: tests/rls.test.js (PGlite)
--   aplica este arquivo e confere cada regra com anon, técnico de equipe,
--   outra equipe, Gestão e admin.
--
-- MODELO (o mesmo que o app já assume):
--   anon ............ nada (sem GRANT e sem policy).
--   admin ........... tudo (operador ativo com is_admin).
--   equipe .......... lê/cria/edita registros da própria equipe (team);
--                     excluir é só admin (exceto marcações de checklist).
--   Gestão .......... pendências tipo "Gestão" só para is_gestao (037).
--   operators ....... todos leem (dropdowns); só admin cria/exclui; cada um
--                     edita o próprio perfil, SEM mudar papel/equipe/flags
--                     (trigger operators_guard_self_update).
--   procedures ...... com cliente: equipe do cliente. Sem cliente (base de
--                     conhecimento): equipe do próprio artigo (coluna team).
--   modelos/checklists: leitura para todos os autenticados; escrita admin
--                     (checklists) ou autenticados (modelos de procedimento,
--                     biblioteca compartilhada — decisão documentada na 021).
--   audit_logs ...... admin lê; cada um só grava log em nome próprio.
--   tickets ......... legado sem team: só admin.
--   email_notifications: só service_role (Edge/cron), que ignora RLS.
--
-- CORRIGE TAMBÉM (achado novo): sem o trigger da 014 (nunca aplicada), um
-- técnico podia editar a própria linha em operators e se dar is_gestao=true
-- ou trocar de team — e passar a ver Gestão / outra equipe.
--
-- COMO APLICAR (SQL Editor, como postgres):
-- 1. Backup/snapshot. 2. Staging primeiro. 3. Rode o arquivo inteiro
--    (é idempotente: pode rodar de novo). 4. Rode a VERIFICAÇÃO do fim.
-- Pré-checagem (somente leitura) — linhas que vão sumir para não-admin:
--   SELECT 'procedures' t, count(*) FROM procedures p
--    WHERE client_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.id = p.client_id)
--   UNION ALL SELECT 'operators sem auth', count(*) FROM operators WHERE auth_user_id IS NULL;
-- ROLLBACK: guarde antes `SELECT * FROM pg_policies WHERE schemaname='public'`.
-- ============================================================

-- ── 1. Colunas usadas pelas regras ───────────────────────────
ALTER TABLE public.operators ADD COLUMN IF NOT EXISTS is_gestao BOOLEAN DEFAULT false;
ALTER TABLE public.procedures ADD COLUMN IF NOT EXISTS team TEXT;
-- Artigo sem cliente herda a equipe de quem tinha acesso: backfill pelo
-- cliente quando existe; artigos soltos antigos ficam 'init'.
UPDATE public.procedures p SET team = COALESCE(c.team, 'init')
  FROM public.clients c
 WHERE p.client_id = c.id AND p.team IS DISTINCT FROM COALESCE(c.team, 'init');
UPDATE public.procedures SET team = 'init' WHERE team IS NULL;

-- ── 2. Helpers (SECURITY DEFINER: leem operators sem recursão de RLS) ──
CREATE OR REPLACE FUNCTION public.current_op_is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (
  SELECT 1 FROM public.operators o
  WHERE o.auth_user_id = auth.uid()
    AND o.is_admin = true AND COALESCE(o.active, true) = true
); $$;

-- Operador inativo não tem equipe (não enxerga nada além do próprio perfil).
CREATE OR REPLACE FUNCTION public.current_op_team()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT o.team FROM public.operators o
  WHERE o.auth_user_id = auth.uid() AND COALESCE(o.active, true) = true
  LIMIT 1; $$;

CREATE OR REPLACE FUNCTION public.current_op_id()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT o.id FROM public.operators o WHERE o.auth_user_id = auth.uid() LIMIT 1; $$;

CREATE OR REPLACE FUNCTION public.current_op_name()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT o.name FROM public.operators o WHERE o.auth_user_id = auth.uid() LIMIT 1; $$;

CREATE OR REPLACE FUNCTION public.current_op_is_gestao()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (
  SELECT 1 FROM public.operators o
  WHERE o.auth_user_id = auth.uid()
    AND COALESCE(o.is_gestao, false) = true AND COALESCE(o.active, true) = true
); $$;

-- "Posso ver esta equipe?" — admin vê todas; demais só a própria.
CREATE OR REPLACE FUNCTION public.can_see_team(t text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT public.current_op_is_admin()
  OR COALESCE(t, 'init') = public.current_op_team(); $$;

-- "Posso ver este cliente?" — pela equipe do cliente.
CREATE OR REPLACE FUNCTION public.can_see_client(cid text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT public.current_op_is_admin() OR EXISTS (
  SELECT 1 FROM public.clients c
  WHERE c.id = cid AND COALESCE(c.team, 'init') = public.current_op_team()
); $$;

-- Pendência: tipo Gestão exige is_gestao; demais pela equipe.
CREATE OR REPLACE FUNCTION public.can_see_pendencia(t text, tipo text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT CASE WHEN COALESCE(tipo, '') IN ('Gestão', 'Gestao')
  THEN public.current_op_is_gestao()
  ELSE public.can_see_team(t) END; $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['current_op_is_admin()', 'current_op_team()', 'current_op_id()',
    'current_op_name()', 'current_op_is_gestao()', 'can_see_team(text)', 'can_see_client(text)',
    'can_see_pendencia(text, text)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

-- ── 3. Zera: RLS ligado, anon sem acesso, NENHUMA policy antiga ──
DO $$
DECLARE
  t text;
  p record;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'operators', 'clients', 'pendencias', 'visits', 'procedures', 'procedure_templates',
    'audit_logs', 'reunioes', 'tickets', 'equipamentos', 'client_devices',
    'milvus_client_map', 'client_milvus_tickets', 'checklists',
    'checklist_modelo_itens', 'checklist_marcacoes', 'email_notifications'
  ]
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, t);
    END LOOP;
  END LOOP;
END $$;

-- ── 4. Tabelas por equipe (team na própria linha) ────────────
-- Mesmo molde: select/insert/update pela equipe; delete só admin.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['clients', 'visits', 'reunioes', 'equipamentos',
    'client_devices', 'client_milvus_tickets']
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.can_see_team(team))', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.can_see_team(team))', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.can_see_team(team)) WITH CHECK (public.can_see_team(team))', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.current_op_is_admin())', t || '_delete', t);
  END LOOP;
END $$;

-- Marcações de checklist: a equipe também desmarca (delete por equipe, como na 040).
DO $$
BEGIN
  IF to_regclass('public.checklist_marcacoes') IS NULL THEN RETURN; END IF;
  CREATE POLICY ckmarc_select ON public.checklist_marcacoes FOR SELECT TO authenticated USING (public.can_see_team(team));
  CREATE POLICY ckmarc_insert ON public.checklist_marcacoes FOR INSERT TO authenticated WITH CHECK (public.can_see_team(team));
  CREATE POLICY ckmarc_update ON public.checklist_marcacoes FOR UPDATE TO authenticated USING (public.can_see_team(team)) WITH CHECK (public.can_see_team(team));
  CREATE POLICY ckmarc_delete ON public.checklist_marcacoes FOR DELETE TO authenticated USING (public.can_see_team(team));
END $$;

-- ── 5. Pendências (trava Gestão da 037) ──────────────────────
CREATE POLICY pens_select ON public.pendencias FOR SELECT TO authenticated
  USING (public.can_see_pendencia(team, tipo));
CREATE POLICY pens_insert ON public.pendencias FOR INSERT TO authenticated
  WITH CHECK (public.can_see_pendencia(team, tipo));
CREATE POLICY pens_update ON public.pendencias FOR UPDATE TO authenticated
  USING (public.can_see_pendencia(team, tipo)) WITH CHECK (public.can_see_pendencia(team, tipo));
CREATE POLICY pens_delete ON public.pendencias FOR DELETE TO authenticated
  USING (CASE WHEN COALESCE(tipo, '') IN ('Gestão', 'Gestao')
    THEN public.current_op_is_gestao() ELSE public.current_op_is_admin() END);

-- ── 6. Procedimentos e base de conhecimento ──────────────────
-- Com cliente: quem vê o cliente. Sem cliente (artigo da base): a equipe do artigo.
CREATE POLICY procedures_select ON public.procedures FOR SELECT TO authenticated
  USING (CASE WHEN client_id IS NULL THEN public.can_see_team(team) ELSE public.can_see_client(client_id) END);
CREATE POLICY procedures_insert ON public.procedures FOR INSERT TO authenticated
  WITH CHECK (CASE WHEN client_id IS NULL THEN public.can_see_team(team) ELSE public.can_see_client(client_id) END);
CREATE POLICY procedures_update ON public.procedures FOR UPDATE TO authenticated
  USING (CASE WHEN client_id IS NULL THEN public.can_see_team(team) ELSE public.can_see_client(client_id) END)
  WITH CHECK (CASE WHEN client_id IS NULL THEN public.can_see_team(team) ELSE public.can_see_client(client_id) END);
CREATE POLICY procedures_delete ON public.procedures FOR DELETE TO authenticated
  USING (public.current_op_is_admin());

-- Mapa Milvus × cliente: pela equipe do cliente.
DO $$
BEGIN
  IF to_regclass('public.milvus_client_map') IS NULL THEN RETURN; END IF;
  CREATE POLICY mmap_select ON public.milvus_client_map FOR SELECT TO authenticated USING (public.can_see_client(client_id));
  CREATE POLICY mmap_insert ON public.milvus_client_map FOR INSERT TO authenticated WITH CHECK (public.can_see_client(client_id));
  CREATE POLICY mmap_update ON public.milvus_client_map FOR UPDATE TO authenticated USING (public.can_see_client(client_id)) WITH CHECK (public.can_see_client(client_id));
  CREATE POLICY mmap_delete ON public.milvus_client_map FOR DELETE TO authenticated USING (public.current_op_is_admin());
END $$;

-- ── 7. Bibliotecas compartilhadas ────────────────────────────
CREATE POLICY procedure_templates_select ON public.procedure_templates FOR SELECT TO authenticated USING (public.current_op_team() IS NOT NULL OR public.current_op_is_admin());
CREATE POLICY procedure_templates_insert ON public.procedure_templates FOR INSERT TO authenticated WITH CHECK (public.current_op_team() IS NOT NULL OR public.current_op_is_admin());
CREATE POLICY procedure_templates_update ON public.procedure_templates FOR UPDATE TO authenticated
  USING (public.current_op_team() IS NOT NULL OR public.current_op_is_admin())
  WITH CHECK (public.current_op_team() IS NOT NULL OR public.current_op_is_admin());
CREATE POLICY procedure_templates_delete ON public.procedure_templates FOR DELETE TO authenticated USING (public.current_op_is_admin());

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['checklists', 'checklist_modelo_itens']
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.current_op_team() IS NOT NULL OR public.current_op_is_admin())', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.current_op_is_admin())', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.current_op_is_admin()) WITH CHECK (public.current_op_is_admin())', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.current_op_is_admin())', t || '_delete', t);
  END LOOP;
END $$;

-- ── 8. Operadores ────────────────────────────────────────────
-- Leitura: todo operador ativo (dropdowns de responsável, sync).
CREATE POLICY ops_select ON public.operators FOR SELECT TO authenticated
  USING (public.current_op_team() IS NOT NULL OR public.current_op_is_admin() OR auth_user_id = auth.uid()
    OR (auth_user_id IS NULL AND email IS NOT NULL AND lower(email) = lower(COALESCE(auth.jwt() ->> 'email', ''))));
-- Criar: admin. Exceção: o upsert do próprio perfil (saveOperator faz
-- INSERT ... ON CONFLICT) precisa passar no WITH CHECK do INSERT — só vale
-- para a PRÓPRIA linha (mesmo id), sem papel de admin/Gestão.
CREATE POLICY ops_insert ON public.operators FOR INSERT TO authenticated
  WITH CHECK (public.current_op_is_admin()
    OR (id = public.current_op_id() AND auth_user_id = auth.uid()
        AND COALESCE(is_admin, false) = false
        AND COALESCE(is_gestao, false) = public.current_op_is_gestao()
        AND COALESCE(team, 'init') = public.current_op_team()));
-- Editar: admin qualquer; o próprio (já vinculado, ou vínculo do 1º login por e-mail).
CREATE POLICY ops_update ON public.operators FOR UPDATE TO authenticated
  USING (public.current_op_is_admin() OR auth_user_id = auth.uid()
    OR (auth_user_id IS NULL AND email IS NOT NULL AND lower(email) = lower(COALESCE(auth.jwt() ->> 'email', ''))))
  WITH CHECK (public.current_op_is_admin() OR auth_user_id = auth.uid());
CREATE POLICY ops_delete ON public.operators FOR DELETE TO authenticated
  USING (public.current_op_is_admin());

-- Não-admin editando a própria linha: papel, equipe e vínculos ficam como estavam.
CREATE OR REPLACE FUNCTION public.operators_guard_self_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF public.current_op_is_admin() OR auth.uid() IS NULL THEN
    RETURN NEW; -- admin, ou service_role/SQL Editor (sem JWT de usuário)
  END IF;
  NEW.is_admin := OLD.is_admin;
  NEW.is_gestao := OLD.is_gestao;
  NEW.active := OLD.active;
  NEW.team := OLD.team;
  NEW.email := OLD.email;
  -- auth_user_id: só o vínculo do 1º login (nulo → próprio uid).
  IF NOT (OLD.auth_user_id IS NULL AND NEW.auth_user_id IS NOT DISTINCT FROM auth.uid()) THEN
    NEW.auth_user_id := OLD.auth_user_id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_operators_guard_self_update ON public.operators;
CREATE TRIGGER trg_operators_guard_self_update
  BEFORE UPDATE ON public.operators
  FOR EACH ROW EXECUTE FUNCTION public.operators_guard_self_update();

-- ── 9. Auditoria e legados ───────────────────────────────────
CREATE POLICY logs_select ON public.audit_logs FOR SELECT TO authenticated
  USING (public.current_op_is_admin());
-- Log só em nome próprio (antes: WITH CHECK (true) permitia forjar autor).
CREATE POLICY logs_insert ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (public.current_op_is_admin() OR operator_name = public.current_op_name());
CREATE POLICY logs_delete ON public.audit_logs FOR DELETE TO authenticated
  USING (public.current_op_is_admin());

DO $$
BEGIN
  IF to_regclass('public.tickets') IS NULL THEN RETURN; END IF;
  CREATE POLICY tickets_admin ON public.tickets FOR ALL TO authenticated
    USING (public.current_op_is_admin()) WITH CHECK (public.current_op_is_admin());
END $$;
-- email_notifications: sem policy → só service_role (que ignora RLS).

-- ── 10. VERIFICAÇÃO (somente leitura; rode depois) ───────────
-- a) Nenhuma policy aberta ou para PUBLIC/anon (esperado: 0 linhas):
--   SELECT tablename, policyname, roles, qual FROM pg_policies
--    WHERE schemaname = 'public' AND (qual = 'true' OR with_check = 'true'
--       OR NOT (roles @> ARRAY['authenticated']::name[]));
-- b) Nenhuma tabela do app sem RLS (esperado: 0 linhas):
--   SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;
-- c) anon sem privilégio em tabela (esperado: 0 linhas):
--   SELECT table_name, privilege_type FROM information_schema.role_table_grants
--    WHERE grantee = 'anon' AND table_schema = 'public';
