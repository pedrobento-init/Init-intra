-- ============================================================
-- Sprint 5: Segurança — Row Level Security em todas as tabelas
-- Execute este SQL no Supabase SQL Editor
-- ============================================================

DO $$
DECLARE
  tbl TEXT;
BEGIN

  -- Helper: aplica RLS + DROP/CREATE policies apenas se tabela existir
  -- Parâmetros: nome_tabela, (policies a criar como arrays)

  -- 1. CLIENTS
  IF to_regclass('public.clients') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY';

    DROP POLICY IF EXISTS "Authenticated users can select clients" ON public.clients;
    CREATE POLICY "Authenticated users can select clients" ON public.clients FOR SELECT USING (auth.role() = 'authenticated');

    DROP POLICY IF EXISTS "Authenticated users can insert clients" ON public.clients;
    CREATE POLICY "Authenticated users can insert clients" ON public.clients FOR INSERT WITH CHECK (auth.role() = 'authenticated');

    DROP POLICY IF EXISTS "Authenticated users can update clients" ON public.clients;
    CREATE POLICY "Authenticated users can update clients" ON public.clients FOR UPDATE USING (auth.role() = 'authenticated');

    DROP POLICY IF EXISTS "Service role can delete clients" ON public.clients;
    CREATE POLICY "Service role can delete clients" ON public.clients FOR DELETE USING (auth.role() = 'service_role');

    RAISE NOTICE '✓ RLS habilitado em clients';
  ELSE
    RAISE NOTICE '⚠ clients não existe — pulando';
  END IF;

  -- 2. PENDENCIAS
  IF to_regclass('public.pendencias') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.pendencias ENABLE ROW LEVEL SECURITY';

    DROP POLICY IF EXISTS "Authenticated users can select pendencias" ON public.pendencias;
    CREATE POLICY "Authenticated users can select pendencias" ON public.pendencias FOR SELECT USING (auth.role() = 'authenticated');

    DROP POLICY IF EXISTS "Authenticated users can insert pendencias" ON public.pendencias;
    CREATE POLICY "Authenticated users can insert pendencias" ON public.pendencias FOR INSERT WITH CHECK (auth.role() = 'authenticated');

    DROP POLICY IF EXISTS "Authenticated users can update pendencias" ON public.pendencias;
    CREATE POLICY "Authenticated users can update pendencias" ON public.pendencias FOR UPDATE USING (auth.role() = 'authenticated');

    DROP POLICY IF EXISTS "Service role can delete pendencias" ON public.pendencias;
    CREATE POLICY "Service role can delete pendencias" ON public.pendencias FOR DELETE USING (auth.role() = 'service_role');

    RAISE NOTICE '✓ RLS habilitado em pendencias';
  ELSE
    RAISE NOTICE '⚠ pendencias não existe — pulando';
  END IF;

  -- 3. TICKETS
  IF to_regclass('public.tickets') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY';

    DROP POLICY IF EXISTS "Authenticated users can select tickets" ON public.tickets;
    CREATE POLICY "Authenticated users can select tickets" ON public.tickets FOR SELECT USING (auth.role() = 'authenticated');

    DROP POLICY IF EXISTS "Authenticated users can insert tickets" ON public.tickets;
    CREATE POLICY "Authenticated users can insert tickets" ON public.tickets FOR INSERT WITH CHECK (auth.role() = 'authenticated');

    DROP POLICY IF EXISTS "Authenticated users can update tickets" ON public.tickets;
    CREATE POLICY "Authenticated users can update tickets" ON public.tickets FOR UPDATE USING (auth.role() = 'authenticated');

    DROP POLICY IF EXISTS "Service role can delete tickets" ON public.tickets;
    CREATE POLICY "Service role can delete tickets" ON public.tickets FOR DELETE USING (auth.role() = 'service_role');

    RAISE NOTICE '✓ RLS habilitado em tickets';
  ELSE
    RAISE NOTICE '⚠ tickets não existe — pulando';
  END IF;

  -- 4. OPERATORS
  IF to_regclass('public.operators') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.operators ENABLE ROW LEVEL SECURITY';

    DROP POLICY IF EXISTS "Authenticated users can select operators" ON public.operators;
    CREATE POLICY "Authenticated users can select operators" ON public.operators FOR SELECT USING (auth.role() = 'authenticated');

    DROP POLICY IF EXISTS "Service role can insert operators" ON public.operators;
    CREATE POLICY "Service role can insert operators" ON public.operators FOR INSERT WITH CHECK (auth.role() = 'service_role');

    DROP POLICY IF EXISTS "Service role can update operators" ON public.operators;
    CREATE POLICY "Service role can update operators" ON public.operators FOR UPDATE USING (auth.role() = 'service_role');

    DROP POLICY IF EXISTS "Service role can delete operators" ON public.operators;
    CREATE POLICY "Service role can delete operators" ON public.operators FOR DELETE USING (auth.role() = 'service_role');

    RAISE NOTICE '✓ RLS habilitado em operators';
  ELSE
    RAISE NOTICE '⚠ operators não existe — pulando';
  END IF;

  -- 5. PROCEDURES
  IF to_regclass('public.procedures') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.procedures ENABLE ROW LEVEL SECURITY';

    DROP POLICY IF EXISTS "Authenticated users can select procedures" ON public.procedures;
    CREATE POLICY "Authenticated users can select procedures" ON public.procedures FOR SELECT USING (auth.role() = 'authenticated');

    DROP POLICY IF EXISTS "Authenticated users can insert procedures" ON public.procedures;
    CREATE POLICY "Authenticated users can insert procedures" ON public.procedures FOR INSERT WITH CHECK (auth.role() = 'authenticated');

    DROP POLICY IF EXISTS "Authenticated users can update procedures" ON public.procedures;
    CREATE POLICY "Authenticated users can update procedures" ON public.procedures FOR UPDATE USING (auth.role() = 'authenticated');

    DROP POLICY IF EXISTS "Service role can delete procedures" ON public.procedures;
    CREATE POLICY "Service role can delete procedures" ON public.procedures FOR DELETE USING (auth.role() = 'service_role');

    RAISE NOTICE '✓ RLS habilitado em procedures';
  ELSE
    RAISE NOTICE '⚠ procedures não existe — pulando';
  END IF;

  -- 6. PROCEDURE_TEMPLATES
  IF to_regclass('public.procedure_templates') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.procedure_templates ENABLE ROW LEVEL SECURITY';

    DROP POLICY IF EXISTS "Public full access to procedure_templates" ON public.procedure_templates;

    DROP POLICY IF EXISTS "Authenticated users can select procedure_templates" ON public.procedure_templates;
    CREATE POLICY "Authenticated users can select procedure_templates" ON public.procedure_templates FOR SELECT USING (auth.role() = 'authenticated');

    DROP POLICY IF EXISTS "Authenticated users can insert procedure_templates" ON public.procedure_templates;
    CREATE POLICY "Authenticated users can insert procedure_templates" ON public.procedure_templates FOR INSERT WITH CHECK (auth.role() = 'authenticated');

    DROP POLICY IF EXISTS "Authenticated users can update procedure_templates" ON public.procedure_templates;
    CREATE POLICY "Authenticated users can update procedure_templates" ON public.procedure_templates FOR UPDATE USING (auth.role() = 'authenticated');

    DROP POLICY IF EXISTS "Service role can delete procedure_templates" ON public.procedure_templates;
    CREATE POLICY "Service role can delete procedure_templates" ON public.procedure_templates FOR DELETE USING (auth.role() = 'service_role');

    RAISE NOTICE '✓ RLS habilitado em procedure_templates';
  ELSE
    RAISE NOTICE '⚠ procedure_templates não existe — pulando';
  END IF;

  -- 7. AUDIT_LOGS
  IF to_regclass('public.audit_logs') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY';

    DROP POLICY IF EXISTS "Authenticated users can select audit_logs" ON public.audit_logs;
    CREATE POLICY "Authenticated users can select audit_logs" ON public.audit_logs FOR SELECT USING (auth.role() = 'authenticated');

    DROP POLICY IF EXISTS "Authenticated users can insert audit_logs" ON public.audit_logs;
    CREATE POLICY "Authenticated users can insert audit_logs" ON public.audit_logs FOR INSERT WITH CHECK (auth.role() = 'authenticated');

    DROP POLICY IF EXISTS "Service role can delete audit_logs" ON public.audit_logs;
    CREATE POLICY "Service role can delete audit_logs" ON public.audit_logs FOR DELETE USING (auth.role() = 'service_role');

    RAISE NOTICE '✓ RLS habilitado em audit_logs';
  ELSE
    RAISE NOTICE '⚠ audit_logs não existe — pulando';
  END IF;

END $$;

-- ============================================================
-- VERIFICAÇÃO
-- ============================================================
-- Execute separadamente:
-- SELECT tablename, policyname, cmd, permissive FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, cmd;
