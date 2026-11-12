-- ============================================================
-- Migration 081: agenda compartilhada da equipe (Google)
-- ============================================================
-- O QUE MUDA: além da agenda pessoal de cada técnico (057), as visitas
-- passam a sair também numa agenda Google compartilhada da equipe (ex.:
-- "Atendimentos"), nos dois sentidos. O id dessa agenda vai no secret
-- AGENDA_SHARED_CAL da Edge Function google-agenda; aqui ficam só o
-- estado dela e a assinatura por agenda.
--
-- - visits.google_hash_shared: o google_hash da 057 é um por visita, mas
--   cada visita passa a existir em DUAS agendas. Sem uma assinatura por
--   agenda, uma edição aplicada vinda da compartilhada marcaria a visita
--   como sincronizada e a agenda pessoal ficaria velha para sempre (e
--   vice-versa). A coluna não entra no trigger da 057 (ele compara uma
--   lista fixa de campos), então gravá-la não reenfileira a visita.
-- - google_agenda_shared: se o robô consegue mexer na agenda
--   compartilhada — mesmo papel de google_agenda_calendars para as
--   pessoais. Sem policy: só service_role (a Edge Function).
-- - my_google_agenda_status() passa a trazer shared_ok/shared_error para
--   o modal "Agenda no celular" mostrar o estado da compartilhada.
--
-- PRÉ-REQUISITOS: migration 057 aplicada.
--
-- VERIFICAÇÃO:
--   SELECT google_hash_shared FROM public.visits LIMIT 1;
--   SELECT * FROM public.google_agenda_shared;
--   SELECT my_google_agenda_status();  -- logado: traz shared_ok
--
-- ROLLBACK:
--   CREATE OR REPLACE FUNCTION public.my_google_agenda_status() ... -- texto da 057
--   DROP TABLE public.google_agenda_shared;
--   ALTER TABLE public.visits DROP COLUMN google_hash_shared;
--   (e remova o secret AGENDA_SHARED_CAL da Edge Function)
-- ============================================================

ALTER TABLE public.visits ADD COLUMN IF NOT EXISTS google_hash_shared TEXT;

CREATE TABLE IF NOT EXISTS public.google_agenda_shared (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  calendar_id TEXT,
  ok BOOLEAN NOT NULL DEFAULT false,
  last_error TEXT,
  last_ok_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.google_agenda_shared ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.google_agenda_shared FROM anon, authenticated;

-- Mesma RPC da 057, agora com o estado da agenda compartilhada.
CREATE OR REPLACE FUNCTION public.my_google_agenda_status()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'runner_email', r.email,
    'runner_last_run', r.last_run_at,
    'my_email', o.email,
    'ok', COALESCE(c.ok, false),
    'error', c.last_error,
    'last_ok_at', c.last_ok_at,
    'shared_ok', s.ok,
    'shared_error', s.last_error
  )
  FROM public.operators o
  LEFT JOIN public.google_agenda_calendars c ON c.operator_id = o.id
  LEFT JOIN public.google_agenda_runner r ON r.id = 1
  LEFT JOIN public.google_agenda_shared s ON s.id = 1
  WHERE o.id = public.current_op_id();
$$;
REVOKE ALL ON FUNCTION public.my_google_agenda_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_google_agenda_status() TO authenticated;
