-- ============================================================
-- Migration 051: Avisos de prazo enviados pelo servidor (uma vez só)
-- ============================================================
-- PROBLEMA: lembretes de prazo de pendência e avisos de vencimento eram
-- disparados pelo navegador de quem abria o site. O controle de "já
-- enviado" ficava na aba (sessionStorage), então o mesmo e-mail saía de
-- novo a cada pessoa ou aba nova.
--
-- O QUE MUDA:
-- - Tabela avisos_enviados: uma linha por aviso dado (chave única). A Edge
--   Function avisos-prazo reserva a chave antes de enviar.
-- - Remove o job antigo 'deadline-reminders' (003): só gravava log, não
--   mandava e-mail nenhum.
-- - Agenda 'avisos-prazo' todo dia às 11:00 UTC (08:00 de Brasília),
--   chamando a Edge Function por pg_net.
--
-- ANTES DE RODAR (uma vez, no SQL Editor; troque os valores):
--   SELECT vault.create_secret('https://<ref-do-projeto>.supabase.co', 'project_url');
--   SELECT vault.create_secret('<segredo longo e aleatório>', 'avisos_cron_secret');
-- O mesmo segredo vai na Edge Function: supabase secrets set AVISOS_CRON_SECRET=...
-- Depende de: extensões pg_cron e pg_net (Database → Extensions).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.avisos_enviados (
  key TEXT PRIMARY KEY,           -- ex.: pendencia:PEN-1:2026-10-20:hoje
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_avisos_enviados_sent_at ON public.avisos_enviados(sent_at);

-- Só service_role (a Edge Function), que ignora RLS. Ninguém do app lê.
ALTER TABLE public.avisos_enviados ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.avisos_enviados FROM anon, authenticated;

-- Job antigo (003) e reagendamento idempotente do novo.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'deadline-reminders') THEN
    PERFORM cron.unschedule('deadline-reminders');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'avisos-prazo') THEN
    PERFORM cron.unschedule('avisos-prazo');
  END IF;
END $$;

SELECT cron.schedule(
  'avisos-prazo',
  '0 11 * * *',
  $job$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/avisos-prazo',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'avisos_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);

-- Limpeza: avisos com mais de 90 dias não servem mais para evitar repetição.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'avisos-enviados-limpeza') THEN
    PERFORM cron.unschedule('avisos-enviados-limpeza');
  END IF;
END $$;
SELECT cron.schedule(
  'avisos-enviados-limpeza',
  '30 11 * * 0',
  $job$ DELETE FROM public.avisos_enviados WHERE sent_at < now() - interval '90 days' $job$
);

-- VERIFICAÇÃO:
--   SELECT jobname, schedule, active FROM cron.job ORDER BY jobname;
--   -- teste agora, sem esperar o horário:
--   SELECT net.http_post(
--     url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/avisos-prazo',
--     headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',
--       (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'avisos_cron_secret')),
--     body := '{}'::jsonb);
--   SELECT status_code, content FROM net._http_response ORDER BY created DESC LIMIT 1;
