-- ============================================================
-- Migration 053: Notificações no celular (Web Push)
-- ============================================================
-- Cada aparelho em que o operador tocou "Ativar notificações neste
-- aparelho" guarda aqui o endereço de push do navegador. A Edge Function
-- send-push lê com service_role e envia; endereços que o navegador
-- descartou (404/410) são apagados por ela.
--
-- Cada operador só vê, cria e apaga as próprias inscrições.
-- Depende de: 042 (current_op_id).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  operator_id TEXT NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_operator ON public.push_subscriptions(operator_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_subscriptions FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;

DROP POLICY IF EXISTS push_subscriptions_select ON public.push_subscriptions;
DROP POLICY IF EXISTS push_subscriptions_insert ON public.push_subscriptions;
DROP POLICY IF EXISTS push_subscriptions_update ON public.push_subscriptions;
DROP POLICY IF EXISTS push_subscriptions_delete ON public.push_subscriptions;
CREATE POLICY push_subscriptions_select ON public.push_subscriptions FOR SELECT TO authenticated
  USING (operator_id = public.current_op_id());
CREATE POLICY push_subscriptions_insert ON public.push_subscriptions FOR INSERT TO authenticated
  WITH CHECK (operator_id = public.current_op_id());
CREATE POLICY push_subscriptions_update ON public.push_subscriptions FOR UPDATE TO authenticated
  USING (operator_id = public.current_op_id())
  WITH CHECK (operator_id = public.current_op_id());
CREATE POLICY push_subscriptions_delete ON public.push_subscriptions FOR DELETE TO authenticated
  USING (operator_id = public.current_op_id());
