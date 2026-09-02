-- Migration 018: Tabela reunioes + campo reviewed_in_meeting em pendencias

-- 1. Adiciona campo reviewed_in_meeting em pendencias
ALTER TABLE public.pendencias ADD COLUMN IF NOT EXISTS reviewed_in_meeting TEXT;

-- 2. Cria tabela reunioes
CREATE TABLE IF NOT EXISTS public.reunioes (
  id TEXT PRIMARY KEY,
  mes_ano TEXT,
  status TEXT DEFAULT 'aberta',
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  team TEXT DEFAULT 'init',
  relatorio TEXT DEFAULT '',
  participants JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.reunioes ADD COLUMN IF NOT EXISTS mes_ano TEXT;
ALTER TABLE public.reunioes ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'aberta';
ALTER TABLE public.reunioes ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE public.reunioes ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;
ALTER TABLE public.reunioes ADD COLUMN IF NOT EXISTS team TEXT DEFAULT 'init';
ALTER TABLE public.reunioes ADD COLUMN IF NOT EXISTS relatorio TEXT DEFAULT '';
ALTER TABLE public.reunioes ADD COLUMN IF NOT EXISTS participants JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.reunioes ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.reunioes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
CREATE INDEX IF NOT EXISTS idx_reunioes_team ON public.reunioes(team);
CREATE INDEX IF NOT EXISTS idx_reunioes_status ON public.reunioes(status);
CREATE INDEX IF NOT EXISTS idx_reunioes_mes_ano ON public.reunioes(mes_ano);
ALTER TABLE public.reunioes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reunioes all" ON public.reunioes;
CREATE POLICY "reunioes all" ON public.reunioes FOR ALL USING (true) WITH CHECK (true);

-- 3. Adiciona à publicação Realtime
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.reunioes; EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;
