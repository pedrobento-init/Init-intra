-- ============================================================
-- Migration 023: Lockdown de RPCs + default de team — REVISÃO
-- ============================================================
-- STATUS: ARQUIVO PARA REVISÃO. NÃO APLICAR sem ler os avisos abaixo.
--
-- DIAGNÓSTICO (auditoria C2, confirmado no código):
-- - Funções de 003 (get_operator_emails, get_upcoming_deadlines,
--   check_deadlines_and_notify, log_email_notification,
--   get_notification_stats) sem REVOKE/GRANT → EXECUTE p/ PUBLIC por
--   padrão, expostas via PostgREST RPC (harvesting de e-mails).
-- - Verificado no app (js/): NENHUMA chamada .rpc() a essas funções —
--   só o cron (dono do job) as usa. Restringir não quebra o frontend.
-- - current_op_team() default 'init' p/ auth sem operador → herda acesso
--   à equipe init (leitura E escrita).
--
-- PRÉ-REQUISITOS:
-- 1. Confirmar o dono do cron job (ver query abaixo): o owner (em geral
--    postgres) não é afetado por REVOKE de PUBLIC/authenticated.
-- 2. Se algum BI/script externo chama get_notification_stats com anon
--    key, liberar GRANT específico após revisão (hoje: ninguém chama).
--
-- VERIFICAÇÃO APÓS APLICAR (somente leitura):
--   SELECT p.proname, r.rolname FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   LEFT JOIN LATERAL aclexplode(p.proacl) a ON true
--   LEFT JOIN pg_roles r ON r.oid = a.grantee
--   WHERE n.nspname = 'public'
--     AND p.proname IN ('get_operator_emails','get_upcoming_deadlines',
--       'check_deadlines_and_notify','log_email_notification',
--       'get_notification_stats');
--   -- esperado: só owner/postgres + service_role, sem anon/authenticated
--     (exceto current_op_* abaixo, que permanecem p/ authenticated).
-- ============================================================

-- ── 1. RPCs de notificação/cron: só dono + service_role ──────────────
-- Revoga por ASSINATURA REAL (oid::regprocedure): cobre overloads com
-- parâmetros (ex.: get_upcoming_deadlines(integer),
-- log_email_notification(text×6)) sem abortar quando uma assinatura
-- exata não existe. Idempotente: pode rodar de novo após falha parcial.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'get_operator_emails',
        'get_upcoming_deadlines',
        'check_deadlines_and_notify',
        'log_email_notification',
        'get_notification_stats'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    -- service_role p/ rotinas server-side que precisarem:
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;

-- ── 2. Helpers de RLS seguem executáveis por authenticated ────────────
-- (As policies dependem deles; sem EXECUTE, queries autenticadas falham.)
GRANT EXECUTE ON FUNCTION public.current_op_is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_op_team() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_op_id() TO authenticated;

-- ── 3. current_op_team(): sem equipe default (nega em vez de herdar) ──
-- ⚠️ MUDANÇA DE COMPORTAMENTO: auth sem linha em operators passa a NÃO
-- enxergar a equipe 'init' (antes herdava). Fluxo de 1º vínculo por e-mail
-- (014:36-40) continua funcionando p/ UPDATE do próprio registro.
CREATE OR REPLACE FUNCTION public.current_op_team()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.team FROM public.operators o
  WHERE o.auth_user_id = auth.uid()
  LIMIT 1;
$$;

-- ── 4. Dono do cron (rode manualmente ANTES de aplicar) ───────────────
-- SELECT jobname, nodename, username AS dono FROM cron.job ORDER BY jobname;
-- Esperado: dono = postgres (superuser, imune aos REVOKEs acima).
