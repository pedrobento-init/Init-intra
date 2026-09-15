-- ============================================================
-- 026: Inventário Milvus — client_devices + milvus_client_map
-- Execute no Supabase SQL Editor (como postgres/service_role)
-- ============================================================
-- ESCOPO: somente inventário de dispositivos (listagem).
-- NÃO inclui: softwares, status online/offline, Google, e-mails,
-- novas regras de auth ou alteração das policies existentes.
--
-- DECISÕES:
-- - `sistema_operacional_licenca` NÃO é persistido (pode conter chave;
--   sem necessidade funcional → coluna nem é criada).
-- - Vínculo dispositivo→cliente via tabela explícita
--   `milvus_client_map` (nome_fantasia → client_id). NENHUMA heurística
--   (hostname/IP/MAC/domínio/usuário) é usada para associar cliente.
-- - `client_devices.team` é desnormalizado do cliente (mesmo padrão de
--   pendencias.team, storage.js) para reutilizar o isolamento
--   operador→equipe→cliente sem nova arquitetura de autorização.
-- ============================================================

-- ── 1. Tabela de inventário ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_devices (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  team TEXT NOT NULL DEFAULT 'init',
  milvus_device_id INTEGER NOT NULL,
  hostname TEXT DEFAULT '',
  apelido TEXT DEFAULT '',
  ip_interno TEXT DEFAULT '',
  ip_externo TEXT DEFAULT '',
  mac_address TEXT DEFAULT '',
  marca TEXT DEFAULT '',
  fabricante TEXT DEFAULT '',
  is_ativo BOOLEAN DEFAULT true,
  data_criacao TIMESTAMPTZ,
  data_ultima_atualizacao TIMESTAMPTZ,
  dominio TEXT DEFAULT '',
  sistema_operacional TEXT DEFAULT '',
  placa_mae TEXT DEFAULT '',
  placa_mae_serial TEXT DEFAULT '',
  processador TEXT DEFAULT '',
  versao_client TEXT DEFAULT '',
  observacao TEXT DEFAULT '',
  usuario_logado TEXT DEFAULT '',
  total_processadores INTEGER,
  numero_serial TEXT DEFAULT '',
  placa_mae_modelo TEXT DEFAULT '',
  data_compra DATE,
  data_garantia DATE,
  modelo_notebook TEXT DEFAULT '',
  nome_fantasia TEXT DEFAULT '',
  tipo_dispositivo_id INTEGER,
  tipo_dispositivo_text TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_client_devices_client_milvus UNIQUE (client_id, milvus_device_id)
);

CREATE INDEX IF NOT EXISTS idx_client_devices_client ON public.client_devices(client_id);
CREATE INDEX IF NOT EXISTS idx_client_devices_team ON public.client_devices(team);
CREATE INDEX IF NOT EXISTS idx_client_devices_milvus ON public.client_devices(milvus_device_id);

-- ── 2. Mapa explícito Milvus → cliente ───────────────────────
-- Povoamento manual pendente: inserir uma linha por `nome_fantasia`
-- retornado pelo Milvus apontando para o client_id correspondente.
-- Exemplo:
--   INSERT INTO public.milvus_client_map (milvus_nome, client_id)
--   VALUES ('MAM MATRIZ', 'CLI-xxx'), ('BT FILIAL', 'CLI-yyy');
CREATE TABLE IF NOT EXISTS public.milvus_client_map (
  milvus_nome TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_milvus_client_map_client ON public.milvus_client_map(client_id);

-- ── 3. RLS — mesmo isolamento operador→equipe→cliente ────────
-- Reutiliza current_op_is_admin()/current_op_team() da 011/024.
-- Nenhuma policy existente é alterada.
ALTER TABLE public.client_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.milvus_client_map ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cdev_select" ON public.client_devices;
DROP POLICY IF EXISTS "cdev_insert" ON public.client_devices;
DROP POLICY IF EXISTS "cdev_update" ON public.client_devices;
DROP POLICY IF EXISTS "cdev_delete" ON public.client_devices;

CREATE POLICY "cdev_select" ON public.client_devices
  FOR SELECT TO authenticated
  USING (
    public.current_op_is_admin()
    OR COALESCE(team, 'init') = public.current_op_team()
  );

CREATE POLICY "cdev_insert" ON public.client_devices
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_op_is_admin()
    OR COALESCE(team, 'init') = public.current_op_team()
  );

CREATE POLICY "cdev_update" ON public.client_devices
  FOR UPDATE TO authenticated
  USING (
    public.current_op_is_admin()
    OR COALESCE(team, 'init') = public.current_op_team()
  )
  WITH CHECK (
    public.current_op_is_admin()
    OR COALESCE(team, 'init') = public.current_op_team()
  );

CREATE POLICY "cdev_delete" ON public.client_devices
  FOR DELETE TO authenticated USING (public.current_op_is_admin());

DROP POLICY IF EXISTS "mmap_select" ON public.milvus_client_map;
DROP POLICY IF EXISTS "mmap_write" ON public.milvus_client_map;
DROP POLICY IF EXISTS "mmap_delete" ON public.milvus_client_map;

-- Leitura: mesma regra de equipe (via cliente). Escrita: admin ou
-- mesma equipe do cliente referenciado (evita mapear p/ outra equipe).
CREATE POLICY "mmap_select" ON public.milvus_client_map
  FOR SELECT TO authenticated
  USING (
    public.current_op_is_admin()
    OR EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = milvus_client_map.client_id
        AND COALESCE(c.team, 'init') = public.current_op_team()
    )
  );

CREATE POLICY "mmap_write" ON public.milvus_client_map
  FOR ALL TO authenticated
  USING (
    public.current_op_is_admin()
    OR EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = milvus_client_map.client_id
        AND COALESCE(c.team, 'init') = public.current_op_team()
    )
  )
  WITH CHECK (
    public.current_op_is_admin()
    OR EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = milvus_client_map.client_id
        AND COALESCE(c.team, 'init') = public.current_op_team()
    )
  );

CREATE POLICY "mmap_delete" ON public.milvus_client_map
  FOR DELETE TO authenticated USING (public.current_op_is_admin());

-- ── 4. Verificação (somente leitura) ─────────────────────────
-- SELECT tablename, policyname, cmd FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename IN ('client_devices', 'milvus_client_map')
-- ORDER BY tablename, policyname;
-- (esperado: cdev_* 4 + mmap_* 3 = 7 linhas)
