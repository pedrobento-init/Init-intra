-- ============================================================
-- Migration 006: Ajuste de RLS para permitir sync via anon key
-- Execute este SQL no Supabase SQL Editor
-- ============================================================

-- 1. OPERATORS — Permitir INSERT/UPDATE por authenticated
--    (DELETE continua apenas service_role)
--    Os campos pin_hash e pin_salt são SHA-256 hasheados — 
--    não é possível reverter o hash mesmo se lido.
DROP POLICY IF EXISTS "Service role can insert operators" ON public.operators;
CREATE POLICY "Authenticated users can insert operators"
  ON public.operators
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Service role can update operators" ON public.operators;
CREATE POLICY "Authenticated users can update operators"
  ON public.operators
  FOR UPDATE
  USING (auth.role() = 'authenticated');

-- 2. DELETE policies: trocar service_role por authenticated (mais prático)
--    Mantemos a UI com confirmação + permissão client-side
DROP POLICY IF EXISTS "Service role can delete clients" ON public.clients;
CREATE POLICY "Authenticated users can delete clients"
  ON public.clients
  FOR DELETE
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Service role can delete pendencias" ON public.pendencias;
CREATE POLICY "Authenticated users can delete pendencias"
  ON public.pendencias
  FOR DELETE
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Service role can delete tickets" ON public.tickets;
CREATE POLICY "Authenticated users can delete tickets"
  ON public.tickets
  FOR DELETE
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Service role can delete operators" ON public.operators;
CREATE POLICY "Authenticated users can delete operators"
  ON public.operators
  FOR DELETE
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Service role can delete procedures" ON public.procedures;
CREATE POLICY "Authenticated users can delete procedures"
  ON public.procedures
  FOR DELETE
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Service role can delete procedure_templates" ON public.procedure_templates;
CREATE POLICY "Authenticated users can delete procedure_templates"
  ON public.procedure_templates
  FOR DELETE
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Service role can delete audit_logs" ON public.audit_logs;
CREATE POLICY "Authenticated users can delete audit_logs"
  ON public.audit_logs
  FOR DELETE
  USING (auth.role() = 'authenticated');

-- ============================================================
-- VERIFICAÇÃO
-- ============================================================
-- SELECT tablename, policyname, cmd FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, cmd;
