-- ============================================================
-- Migration 045: Vencimentos (licenças, SSL, domínios, garantias, backup…)
-- ============================================================
-- Agenda de renovações por cliente, com aviso 30 e 7 dias antes e no dia.
-- `avisos` guarda quais avisos por e-mail já saíram ("30", "7", "0") para
-- que dois aparelhos não mandem o mesmo e-mail.
-- RLS: mesmo molde da 042 (equipe lê/cria/edita; excluir só admin).
-- Depende da 042 (can_see_team / current_op_is_admin).

CREATE TABLE IF NOT EXISTS public.vencimentos (
  id TEXT PRIMARY KEY,
  client_id TEXT,
  client_name TEXT DEFAULT '',
  tipo TEXT NOT NULL DEFAULT 'outro',           -- licenca | ssl | dominio | garantia | backup | contrato | outro
  descricao TEXT NOT NULL DEFAULT '',
  data_vencimento DATE NOT NULL,
  responsavel TEXT DEFAULT '',
  renovacao_auto BOOLEAN DEFAULT false,
  status TEXT NOT NULL DEFAULT 'ativo',         -- ativo | encerrado
  observacoes TEXT DEFAULT '',
  avisos JSONB NOT NULL DEFAULT '[]'::jsonb,
  historico JSONB NOT NULL DEFAULT '[]'::jsonb, -- renovações anteriores
  team TEXT DEFAULT 'init',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vencimentos_data ON public.vencimentos(data_vencimento);
CREATE INDEX IF NOT EXISTS idx_vencimentos_team ON public.vencimentos(team);
CREATE INDEX IF NOT EXISTS idx_vencimentos_client ON public.vencimentos(client_id);
CREATE INDEX IF NOT EXISTS idx_vencimentos_updated ON public.vencimentos(updated_at DESC);

ALTER TABLE public.vencimentos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vencimentos FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vencimentos TO authenticated;

DROP POLICY IF EXISTS vencimentos_select ON public.vencimentos;
DROP POLICY IF EXISTS vencimentos_insert ON public.vencimentos;
DROP POLICY IF EXISTS vencimentos_update ON public.vencimentos;
DROP POLICY IF EXISTS vencimentos_delete ON public.vencimentos;
CREATE POLICY vencimentos_select ON public.vencimentos FOR SELECT TO authenticated USING (public.can_see_team(team));
CREATE POLICY vencimentos_insert ON public.vencimentos FOR INSERT TO authenticated WITH CHECK (public.can_see_team(team));
CREATE POLICY vencimentos_update ON public.vencimentos FOR UPDATE TO authenticated
  USING (public.can_see_team(team)) WITH CHECK (public.can_see_team(team));
CREATE POLICY vencimentos_delete ON public.vencimentos FOR DELETE TO authenticated USING (public.current_op_is_admin());

-- Realtime (mesma publicação das outras tabelas do app).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'vencimentos') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.vencimentos;
  END IF;
END $$;
