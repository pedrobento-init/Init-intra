-- ============================================================
-- Migration 057: Visitas na agenda Google do técnico (dois sentidos)
-- ============================================================
-- Um Google Apps Script numa conta da empresa (o "robô", ex.:
-- agenda@empresa) roda de minuto em minuto. Cada técnico compartilha a
-- própria agenda com o robô ("Fazer alterações nos eventos"). O script:
--   1. lê a fila abaixo pela Edge Function google-agenda e cria/altera/apaga
--      o evento da visita na agenda do técnico;
--   2. devolve o que mudou no Google (data/horário, evento apagado).
-- Código do script: tools/google-agenda-apps-script/. Passo a passo:
-- GOOGLE-AGENDA.md. Sem OAuth, pg_net ou cron do lado do Supabase.
--
-- - google_agenda_queue: visita mudou → uma linha. O trigger só grava aqui
--   (nada de rede), então nunca atrasa nem impede o salvamento.
-- - visits.google_hash: assinatura do que já está no Google (sem envio
--   repetido e sem loop Google ↔ site).
-- - google_agenda_calendars: se o robô consegue mexer na agenda de cada
--   técnico (o app mostra ao técnico o que falta).
-- - google_agenda_runner: e-mail do robô e última execução.
-- Tudo sem policy: só service_role (a Edge Function). O app lê o próprio
-- estado só pela RPC my_google_agenda_status().
-- Depende de: 049 (visits.operator_id), 042 (current_op_id).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.google_agenda_runner (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  email TEXT,
  last_run_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.google_agenda_calendars (
  operator_id TEXT PRIMARY KEY,
  calendar_id TEXT NOT NULL,
  ok BOOLEAN NOT NULL DEFAULT false,
  last_error TEXT,
  last_ok_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.google_agenda_queue (
  seq BIGSERIAL PRIMARY KEY,
  visit_id TEXT NOT NULL,
  old_operator_id TEXT,
  old_operator TEXT,
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  queued_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_google_agenda_queue_visit ON public.google_agenda_queue(visit_id);

ALTER TABLE public.google_agenda_runner ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_agenda_calendars ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_agenda_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.google_agenda_runner, public.google_agenda_calendars, public.google_agenda_queue FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.google_agenda_queue_seq_seq FROM anon, authenticated;

ALTER TABLE public.visits ADD COLUMN IF NOT EXISTS google_hash TEXT;

-- Visita mudou → entra na fila do robô.
CREATE OR REPLACE FUNCTION public.visits_google_agenda_enqueue()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Só o que aparece na agenda. Gravar só google_hash/updated_at não entra.
  IF TG_OP = 'UPDATE' AND
     (NEW.date, NEW."time", NEW.time_end, NEW.all_day, NEW.status, NEW.client_name, NEW.motivo,
      NEW.observacoes, NEW.numero, NEW.operator, NEW.operator_id)
     IS NOT DISTINCT FROM
     (OLD.date, OLD."time", OLD.time_end, OLD.all_day, OLD.status, OLD.client_name, OLD.motivo,
      OLD.observacoes, OLD.numero, OLD.operator, OLD.operator_id) THEN
    RETURN NULL;
  END IF;
  -- Robô ainda não instalado: a fila não cresce à toa (a 1ª execução manda
  -- as visitas de cada agenda liberada).
  IF NOT EXISTS (SELECT 1 FROM public.google_agenda_runner) THEN RETURN NULL; END IF;
  INSERT INTO public.google_agenda_queue (visit_id, old_operator_id, old_operator)
  VALUES (
    COALESCE(NEW.id, OLD.id),
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.operator_id END,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.operator END
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- A agenda Google é extra: a visita grava mesmo assim.
  RAISE WARNING 'google-agenda: fila não gravada (%)', SQLERRM;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.visits_google_agenda_enqueue() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_visits_google_agenda ON public.visits;
CREATE TRIGGER trg_visits_google_agenda AFTER INSERT OR UPDATE OR DELETE ON public.visits
  FOR EACH ROW EXECUTE FUNCTION public.visits_google_agenda_enqueue();

-- Estado da agenda Google do operador logado (modal "Agenda no celular").
CREATE OR REPLACE FUNCTION public.my_google_agenda_status()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'runner_email', r.email,
    'runner_last_run', r.last_run_at,
    'my_email', o.email,
    'ok', COALESCE(c.ok, false),
    'error', c.last_error,
    'last_ok_at', c.last_ok_at
  )
  FROM public.operators o
  LEFT JOIN public.google_agenda_calendars c ON c.operator_id = o.id
  LEFT JOIN public.google_agenda_runner r ON r.id = 1
  WHERE o.id = public.current_op_id();
$$;
REVOKE ALL ON FUNCTION public.my_google_agenda_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_google_agenda_status() TO authenticated;

-- VERIFICAÇÃO:
--   SELECT * FROM public.google_agenda_runner;            -- last_run_at a cada minuto
--   SELECT operator_id, calendar_id, ok, last_error FROM public.google_agenda_calendars;
--   SELECT count(*), max(attempts) FROM public.google_agenda_queue;  -- perto de 0
