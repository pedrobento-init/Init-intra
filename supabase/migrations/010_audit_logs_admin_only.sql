-- Histórico (audit_logs): leitura e exclusão apenas para operadores admin
-- INSERT permanece aberto para qualquer autenticado (registrar ações)

DROP POLICY IF EXISTS "Authenticated users can select audit_logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Authenticated users can delete audit_logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Service role can delete audit_logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Admins can select audit_logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Admins can delete audit_logs" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs all" ON public.audit_logs;

CREATE POLICY "Admins can select audit_logs"
  ON public.audit_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.operators o
      WHERE o.auth_user_id = auth.uid()
        AND o.is_admin = true
        AND COALESCE(o.active, true) = true
    )
  );

CREATE POLICY "Admins can delete audit_logs"
  ON public.audit_logs
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.operators o
      WHERE o.auth_user_id = auth.uid()
        AND o.is_admin = true
        AND COALESCE(o.active, true) = true
    )
  );
