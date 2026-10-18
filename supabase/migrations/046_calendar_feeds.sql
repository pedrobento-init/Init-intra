-- ============================================================
-- Migration 046: Link de agenda (ICS) por técnico
-- ============================================================
-- Cada técnico assina um link no Google Agenda / Outlook / iPhone e vê as
-- próprias visitas no celular. O app de agenda não manda login, então o
-- link carrega um token secreto (aleatório, 32 bytes).
-- - Tabela sem policy: o token NÃO fica em operators (que todos leem).
-- - O próprio operador obtém/troca o token só pelas RPCs abaixo.
-- - A Edge Function agenda-ics (deploy com --no-verify-jwt) resolve o token
--   com service_role e devolve só as visitas daquele operador.
-- Depende da 042 (current_op_id).

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.calendar_feeds (
  operator_id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_used_at TIMESTAMPTZ
);
ALTER TABLE public.calendar_feeds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.calendar_feeds FROM anon, authenticated;

-- Devolve o token do operador logado (cria na 1ª vez). p_rotate = true troca
-- (o link antigo para de funcionar — para quando vazou ou trocou de celular).
CREATE OR REPLACE FUNCTION public.my_calendar_feed_token(p_rotate boolean DEFAULT false)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  op text := public.current_op_id();
  t text;
BEGIN
  IF auth.uid() IS NULL OR op IS NULL THEN
    RAISE EXCEPTION 'Operador não encontrado' USING ERRCODE = '42501';
  END IF;
  SELECT token INTO t FROM public.calendar_feeds WHERE operator_id = op;
  IF t IS NULL OR p_rotate THEN
    t := translate(encode(gen_random_bytes(32), 'base64'), '+/=', '-_');
    INSERT INTO public.calendar_feeds (operator_id, token) VALUES (op, t)
      ON CONFLICT (operator_id) DO UPDATE SET token = EXCLUDED.token, created_at = now(), last_used_at = NULL;
  END IF;
  RETURN t;
END $$;
REVOKE ALL ON FUNCTION public.my_calendar_feed_token(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_calendar_feed_token(boolean) TO authenticated;

-- Operador desativado: o link dele para de funcionar junto.
CREATE OR REPLACE FUNCTION public.operators_drop_feed_on_disable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.active, true) = false AND COALESCE(OLD.active, true) = true THEN
    DELETE FROM public.calendar_feeds WHERE operator_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.operators_drop_feed_on_disable() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_operators_drop_feed ON public.operators;
CREATE TRIGGER trg_operators_drop_feed AFTER UPDATE OF active ON public.operators
  FOR EACH ROW EXECUTE FUNCTION public.operators_drop_feed_on_disable();
