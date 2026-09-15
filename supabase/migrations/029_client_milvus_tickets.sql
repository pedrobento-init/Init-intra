-- ============================================================
-- 029: Chamados recentes do Milvus (top 10 por cliente)
-- Execute no Supabase SQL Editor (como postgres/service_role)
-- ============================================================
-- ESCOPO: somente os 10 chamados MAIS RECENTES por cliente, para
-- contexto rápido do técnico. NÃO é cópia do Milvus (20k+ ficam lá).
--
-- FONTE: POST /api/chamado/listagem com filtro_body.cliente_id =
-- milvus_client_map.milvus_cliente_id (resolvido via /cliente/busca).
-- A API ignora total_registros (sempre 50/página): o backend corta os
-- 10 primeiros (ordem decrescente de código) e apaga o excedente
-- SOMENTE do client_id sincronizado.
--
-- NÃO PERSISTIDO (embora a API retorne): contato, e-mails, telefone,
-- CPF/CNPJ, cliente_token, avaliações, texto_html, ultimas_cinco_logs,
-- dados de dispositivo e demais campos fora da tela compacta.
--
-- RLS: mesmo isolamento operador→equipe→cliente (team desnormalizada,
-- como client_devices). Nenhuma policy existente é alterada.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.client_milvus_tickets (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  team TEXT NOT NULL DEFAULT 'init',
  milvus_ticket_id INTEGER NOT NULL,
  codigo INTEGER,
  assunto TEXT DEFAULT '',
  descricao TEXT DEFAULT '',
  status TEXT DEFAULT '',
  prioridade TEXT DEFAULT '',
  categoria_primaria TEXT DEFAULT '',
  categoria_secundaria TEXT DEFAULT '',
  tecnico TEXT DEFAULT '',
  data_criacao TIMESTAMPTZ,
  data_modificacao TIMESTAMPTZ,
  data_solucao TIMESTAMPTZ,
  ultima_log JSONB,
  synced_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_client_milvus_tickets_client_ticket UNIQUE (client_id, milvus_ticket_id)
);

CREATE INDEX IF NOT EXISTS idx_client_milvus_tickets_client ON public.client_milvus_tickets(client_id);
CREATE INDEX IF NOT EXISTS idx_client_milvus_tickets_team ON public.client_milvus_tickets(team);
CREATE INDEX IF NOT EXISTS idx_client_milvus_tickets_codigo ON public.client_milvus_tickets(client_id, codigo DESC);

ALTER TABLE public.client_milvus_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mtickets_select" ON public.client_milvus_tickets;
DROP POLICY IF EXISTS "mtickets_insert" ON public.client_milvus_tickets;
DROP POLICY IF EXISTS "mtickets_update" ON public.client_milvus_tickets;
DROP POLICY IF EXISTS "mtickets_delete" ON public.client_milvus_tickets;

CREATE POLICY "mtickets_select" ON public.client_milvus_tickets
  FOR SELECT TO authenticated
  USING (
    public.current_op_is_admin()
    OR COALESCE(team, 'init') = public.current_op_team()
  );

CREATE POLICY "mtickets_insert" ON public.client_milvus_tickets
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_op_is_admin()
    OR COALESCE(team, 'init') = public.current_op_team()
  );

CREATE POLICY "mtickets_update" ON public.client_milvus_tickets
  FOR UPDATE TO authenticated
  USING (
    public.current_op_is_admin()
    OR COALESCE(team, 'init') = public.current_op_team()
  )
  WITH CHECK (
    public.current_op_is_admin()
    OR COALESCE(team, 'init') = public.current_op_team()
  );

CREATE POLICY "mtickets_delete" ON public.client_milvus_tickets
  FOR DELETE TO authenticated USING (public.current_op_is_admin());

-- ── Verificação (somente leitura) ────────────────────────────
-- SELECT tablename, policyname, cmd FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'client_milvus_tickets'
-- ORDER BY policyname;
-- (esperado: 4 linhas mtickets_*)
