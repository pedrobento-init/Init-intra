-- ============================================================
-- Migration 052: fecha a view v_notification_stats (003)
-- ============================================================
-- A view foi criada sem REVOKE, então anon/authenticated herdaram todos os
-- privilégios. Como view roda com o dono (postgres), ela ignora o RLS de
-- email_notifications: qualquer um com a anon key lia as contagens de
-- e-mails por tipo e dia. O app não usa a view; só service_role/postgres.
-- Achado na conferência de grants (PENDENCIA-CRITICA-RLS.md, consulta d).

REVOKE ALL ON public.v_notification_stats FROM anon, authenticated, PUBLIC;
ALTER VIEW public.v_notification_stats SET (security_invoker = true);

-- VERIFICAÇÃO (esperado: 0 linhas):
--   SELECT table_name, privilege_type FROM information_schema.role_table_grants
--    WHERE grantee IN ('anon', 'authenticated') AND table_name = 'v_notification_stats';
