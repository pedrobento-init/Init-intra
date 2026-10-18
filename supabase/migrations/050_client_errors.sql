-- ============================================================
-- Migration 050: Erros do app (o que antes sumia em catch vazio)
-- ============================================================
-- O app tem ~400 `catch (_) {}`: falhas de sync, gravação e realtime
-- sumiam sem rastro. js/error-log.js agora junta esses erros (sem repetir o
-- mesmo na sessão) e envia em lote para esta tabela; o admin vê em
-- Histórico → "Erros do app".
-- Sem dado de cliente: só mensagem, pilha (cortada), onde, URL e versão.
-- RLS: cada um grava os próprios; só admin lê/apaga. Limpa após 30 dias.
-- Depende da 042 (current_op_id, current_op_is_admin).

CREATE TABLE IF NOT EXISTS public.client_errors (
  id BIGSERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  operator_id TEXT,
  operator_name TEXT DEFAULT '',
  source TEXT DEFAULT '',            -- onde (módulo/função)
  message TEXT NOT NULL,
  stack TEXT DEFAULT '',
  url TEXT DEFAULT '',
  app_version TEXT DEFAULT '',
  count INTEGER NOT NULL DEFAULT 1   -- repetições juntadas no aparelho
);
CREATE INDEX IF NOT EXISTS idx_client_errors_at ON public.client_errors(at DESC);

ALTER TABLE public.client_errors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.client_errors FROM anon;
GRANT SELECT, INSERT, DELETE ON public.client_errors TO authenticated;
GRANT USAGE ON SEQUENCE public.client_errors_id_seq TO authenticated;

DROP POLICY IF EXISTS client_errors_insert ON public.client_errors;
DROP POLICY IF EXISTS client_errors_select ON public.client_errors;
DROP POLICY IF EXISTS client_errors_delete ON public.client_errors;
CREATE POLICY client_errors_insert ON public.client_errors FOR INSERT TO authenticated
  WITH CHECK (operator_id IS NOT DISTINCT FROM public.current_op_id() AND length(message) <= 2000 AND length(COALESCE(stack, '')) <= 4000);
CREATE POLICY client_errors_select ON public.client_errors FOR SELECT TO authenticated
  USING (public.current_op_is_admin());
CREATE POLICY client_errors_delete ON public.client_errors FOR DELETE TO authenticated
  USING (public.current_op_is_admin());

-- Faxina: o que tem mais de 30 dias sai a cada gravação (barato com o índice).
CREATE OR REPLACE FUNCTION public.client_errors_prune()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN
  DELETE FROM public.client_errors WHERE at < now() - interval '30 days';
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.client_errors_prune() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_client_errors_prune ON public.client_errors;
CREATE TRIGGER trg_client_errors_prune AFTER INSERT ON public.client_errors
  FOR EACH STATEMENT EXECUTE FUNCTION public.client_errors_prune();
