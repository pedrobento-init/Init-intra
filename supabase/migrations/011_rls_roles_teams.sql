-- ============================================================
-- 011: RLS por papel (admin) e time
-- Execute no Supabase SQL Editor após 005/006/010
-- ============================================================

-- Helpers (SECURITY DEFINER para ler operators sem recursão de RLS)
CREATE OR REPLACE FUNCTION public.current_op_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.operators o
    WHERE o.auth_user_id = auth.uid()
      AND o.is_admin = true
      AND COALESCE(o.active, true) = true
  );
$$;

CREATE OR REPLACE FUNCTION public.current_op_team()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT o.team FROM public.operators o
     WHERE o.auth_user_id = auth.uid()
     LIMIT 1),
    'init'
  );
$$;

CREATE OR REPLACE FUNCTION public.current_op_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.id FROM public.operators o
  WHERE o.auth_user_id = auth.uid()
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.current_op_is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_op_team() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_op_id() TO authenticated;

-- ── OPERATORS ──────────────────────────────────────────────
ALTER TABLE public.operators ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can select operators" ON public.operators;
DROP POLICY IF EXISTS "Authenticated users can insert operators" ON public.operators;
DROP POLICY IF EXISTS "Authenticated users can update operators" ON public.operators;
DROP POLICY IF EXISTS "Authenticated users can delete operators" ON public.operators;
DROP POLICY IF EXISTS "Service role can insert operators" ON public.operators;
DROP POLICY IF EXISTS "Service role can update operators" ON public.operators;
DROP POLICY IF EXISTS "Service role can delete operators" ON public.operators;
DROP POLICY IF EXISTS "ops_select" ON public.operators;
DROP POLICY IF EXISTS "ops_insert" ON public.operators;
DROP POLICY IF EXISTS "ops_update" ON public.operators;
DROP POLICY IF EXISTS "ops_delete" ON public.operators;

-- Todos autenticados leem operadores (dropdowns)
CREATE POLICY "ops_select" ON public.operators
  FOR SELECT TO authenticated
  USING (true);

-- Admin cria qualquer; usuário pode se auto-cadastrar (sem admin) no 1º login
CREATE POLICY "ops_insert" ON public.operators
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_op_is_admin()
    OR (
      auth_user_id = auth.uid()
      AND COALESCE(is_admin, false) = false
    )
  );

-- Admin atualiza qualquer; usuário atualiza só o próprio e não pode se promover/desativar
CREATE POLICY "ops_update" ON public.operators
  FOR UPDATE TO authenticated
  USING (
    public.current_op_is_admin()
    OR auth_user_id = auth.uid()
  )
  WITH CHECK (
    public.current_op_is_admin()
    OR (
      auth_user_id = auth.uid()
      AND COALESCE(is_admin, false) = false
      AND COALESCE(active, true) = true
    )
  );

-- Só admin exclui
CREATE POLICY "ops_delete" ON public.operators
  FOR DELETE TO authenticated
  USING (public.current_op_is_admin());

-- ── CLIENTS ────────────────────────────────────────────────
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can select clients" ON public.clients;
DROP POLICY IF EXISTS "Authenticated users can insert clients" ON public.clients;
DROP POLICY IF EXISTS "Authenticated users can update clients" ON public.clients;
DROP POLICY IF EXISTS "Authenticated users can delete clients" ON public.clients;
DROP POLICY IF EXISTS "Service role can delete clients" ON public.clients;
DROP POLICY IF EXISTS "clients_select" ON public.clients;
DROP POLICY IF EXISTS "clients_insert" ON public.clients;
DROP POLICY IF EXISTS "clients_update" ON public.clients;
DROP POLICY IF EXISTS "clients_delete" ON public.clients;

CREATE POLICY "clients_select" ON public.clients
  FOR SELECT TO authenticated
  USING (
    public.current_op_is_admin()
    OR COALESCE(team, 'init') = public.current_op_team()
  );

CREATE POLICY "clients_insert" ON public.clients
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_op_is_admin()
    OR COALESCE(team, 'init') = public.current_op_team()
  );

CREATE POLICY "clients_update" ON public.clients
  FOR UPDATE TO authenticated
  USING (
    public.current_op_is_admin()
    OR COALESCE(team, 'init') = public.current_op_team()
  )
  WITH CHECK (
    public.current_op_is_admin()
    OR COALESCE(team, 'init') = public.current_op_team()
  );

CREATE POLICY "clients_delete" ON public.clients
  FOR DELETE TO authenticated
  USING (public.current_op_is_admin());

-- ── PENDENCIAS ─────────────────────────────────────────────
ALTER TABLE public.pendencias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can select pendencias" ON public.pendencias;
DROP POLICY IF EXISTS "Authenticated users can insert pendencias" ON public.pendencias;
DROP POLICY IF EXISTS "Authenticated users can update pendencias" ON public.pendencias;
DROP POLICY IF EXISTS "Authenticated users can delete pendencias" ON public.pendencias;
DROP POLICY IF EXISTS "Service role can delete pendencias" ON public.pendencias;
DROP POLICY IF EXISTS "pens_select" ON public.pendencias;
DROP POLICY IF EXISTS "pens_insert" ON public.pendencias;
DROP POLICY IF EXISTS "pens_update" ON public.pendencias;
DROP POLICY IF EXISTS "pens_delete" ON public.pendencias;

CREATE POLICY "pens_select" ON public.pendencias
  FOR SELECT TO authenticated
  USING (
    public.current_op_is_admin()
    OR COALESCE(team, 'init') = public.current_op_team()
  );

CREATE POLICY "pens_insert" ON public.pendencias
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_op_is_admin()
    OR COALESCE(team, 'init') = public.current_op_team()
  );

CREATE POLICY "pens_update" ON public.pendencias
  FOR UPDATE TO authenticated
  USING (
    public.current_op_is_admin()
    OR COALESCE(team, 'init') = public.current_op_team()
  )
  WITH CHECK (
    public.current_op_is_admin()
    OR COALESCE(team, 'init') = public.current_op_team()
  );

CREATE POLICY "pens_delete" ON public.pendencias
  FOR DELETE TO authenticated
  USING (public.current_op_is_admin());

-- tickets/chamados removidos do produto — sem policies

-- ── VISITS (se existir) ────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.visits') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.visits ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "visits_select" ON public.visits';
    EXECUTE 'DROP POLICY IF EXISTS "visits_insert" ON public.visits';
    EXECUTE 'DROP POLICY IF EXISTS "visits_update" ON public.visits';
    EXECUTE 'DROP POLICY IF EXISTS "visits_delete" ON public.visits';
    EXECUTE 'DROP POLICY IF EXISTS "Authenticated users can select visits" ON public.visits';
    EXECUTE 'DROP POLICY IF EXISTS "Authenticated users can insert visits" ON public.visits';
    EXECUTE 'DROP POLICY IF EXISTS "Authenticated users can update visits" ON public.visits';
    EXECUTE 'DROP POLICY IF EXISTS "Authenticated users can delete visits" ON public.visits';

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

-- ── PROCEDURES / TEMPLATES — autenticados leem/escrevem; delete admin ──
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['procedures', 'procedure_templates']
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "%s_select" ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "%s_write" ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "%s_delete" ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "Authenticated users can select %s" ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "Authenticated users can insert %s" ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "Authenticated users can update %s" ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "Authenticated users can delete %s" ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "Service role can delete %s" ON public.%I', t, t);

    EXECUTE format(
      'CREATE POLICY "%s_select" ON public.%I FOR SELECT TO authenticated USING (true)',
      t, t
    );
    EXECUTE format(
      'CREATE POLICY "%s_write" ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
      t, t
    );
  END LOOP;
END $$;

-- ── AUDIT_LOGS — insert qualquer auth; select/delete só admin ──
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can select audit_logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Authenticated users can insert audit_logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Authenticated users can delete audit_logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Admins can select audit_logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Admins can delete audit_logs" ON public.audit_logs;
DROP POLICY IF EXISTS "logs_select" ON public.audit_logs;
DROP POLICY IF EXISTS "logs_insert" ON public.audit_logs;
DROP POLICY IF EXISTS "logs_delete" ON public.audit_logs;

CREATE POLICY "logs_select" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (public.current_op_is_admin());

CREATE POLICY "logs_insert" ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "logs_delete" ON public.audit_logs
  FOR DELETE TO authenticated
  USING (public.current_op_is_admin());
