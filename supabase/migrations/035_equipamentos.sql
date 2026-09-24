-- Migration 035: Tabela equipamentos (Initnet + clientes)
-- Modelo: nome, numero_serie, tipo, cliente_id, os_vinculada (texto livre),
-- pendencia_id (vínculo opcional com pendência), status
-- (entregue | em_manutencao | estoque | baixado), valor, data_aquisicao.

CREATE TABLE IF NOT EXISTS public.equipamentos (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL DEFAULT '',
  numero_serie TEXT DEFAULT '',
  tipo TEXT DEFAULT 'outro',
  client_id TEXT,
  client_name TEXT DEFAULT 'Estoque Initnet',
  os_vinculada TEXT,
  pendencia_id TEXT,
  status TEXT DEFAULT 'estoque',
  valor NUMERIC,
  data_aquisicao DATE,
  observacoes TEXT DEFAULT '',
  team TEXT DEFAULT 'init',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.equipamentos ADD COLUMN IF NOT EXISTS nome TEXT NOT NULL DEFAULT '';
ALTER TABLE public.equipamentos ADD COLUMN IF NOT EXISTS numero_serie TEXT DEFAULT '';
ALTER TABLE public.equipamentos ADD COLUMN IF NOT EXISTS tipo TEXT DEFAULT 'outro';
ALTER TABLE public.equipamentos ADD COLUMN IF NOT EXISTS client_id TEXT;
ALTER TABLE public.equipamentos ADD COLUMN IF NOT EXISTS client_name TEXT DEFAULT 'Estoque Initnet';
ALTER TABLE public.equipamentos ADD COLUMN IF NOT EXISTS os_vinculada TEXT;
ALTER TABLE public.equipamentos ADD COLUMN IF NOT EXISTS pendencia_id TEXT;
ALTER TABLE public.equipamentos ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'estoque';
ALTER TABLE public.equipamentos ADD COLUMN IF NOT EXISTS valor NUMERIC;
ALTER TABLE public.equipamentos ADD COLUMN IF NOT EXISTS data_aquisicao DATE;
ALTER TABLE public.equipamentos ADD COLUMN IF NOT EXISTS observacoes TEXT DEFAULT '';
ALTER TABLE public.equipamentos ADD COLUMN IF NOT EXISTS team TEXT DEFAULT 'init';
ALTER TABLE public.equipamentos ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.equipamentos ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_equipamentos_team ON public.equipamentos(team);
CREATE INDEX IF NOT EXISTS idx_equipamentos_status ON public.equipamentos(status);
CREATE INDEX IF NOT EXISTS idx_equipamentos_client ON public.equipamentos(client_id);
CREATE INDEX IF NOT EXISTS idx_equipamentos_tipo ON public.equipamentos(tipo);
CREATE INDEX IF NOT EXISTS idx_equipamentos_os ON public.equipamentos(os_vinculada);
CREATE INDEX IF NOT EXISTS idx_equipamentos_pendencia ON public.equipamentos(pendencia_id);
CREATE INDEX IF NOT EXISTS idx_equipamentos_updated ON public.equipamentos(updated_at DESC);

ALTER TABLE public.equipamentos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "equipamentos all" ON public.equipamentos;
CREATE POLICY "equipamentos all" ON public.equipamentos FOR ALL USING (true) WITH CHECK (true);

-- Realtime (mesmo padrão das demais entidades opcionais)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.equipamentos; EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;
