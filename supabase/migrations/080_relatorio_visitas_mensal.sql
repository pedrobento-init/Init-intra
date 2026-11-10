-- ============================================================
-- Migration 080: relatório mensal de visitas para a Gestão
-- ============================================================
-- O QUE MUDA: agenda, no primeiro dia de cada mês às 11:00 UTC
-- (08:00 de Brasília), o envio das visitas do mês anterior aos
-- operadores ativos com is_gestao = true e e-mail cadastrado.
--
-- PRÉ-REQUISITOS: migrations 037 e 051, extensões pg_cron e pg_net,
-- secrets project_url e avisos_cron_secret no Vault. A Edge Function
-- relatorio-visitas-mensal deve estar publicada com AVISOS_CRON_SECRET
-- e as credenciais GMAIL_* já usadas pelos demais envios.
--
-- VERIFICAÇÃO:
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'relatorio-visitas-mensal';
--   -- No primeiro dia do mês, teste pelo SQL Editor:
--   SELECT net.http_post(
--     url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/relatorio-visitas-mensal',
--     headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret',
--       (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'avisos_cron_secret')),
--     body := '{}'::jsonb);
--
-- ROLLBACK: SELECT cron.unschedule('relatorio-visitas-mensal');
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'relatorio-visitas-mensal') THEN
    PERFORM cron.unschedule('relatorio-visitas-mensal');
  END IF;
END $$;

SELECT cron.schedule(
  'relatorio-visitas-mensal',
  '0 11 1 * *',
  $job$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/relatorio-visitas-mensal',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'avisos_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);
