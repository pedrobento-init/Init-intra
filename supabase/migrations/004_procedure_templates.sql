-- ============================================================
-- Sprint 6: Templates de Procedimentos - Setup no Supabase
-- Execute este SQL no Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS public.procedure_templates (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT,
  content TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_proc_templates_category ON public.procedure_templates(category);
CREATE INDEX IF NOT EXISTS idx_proc_templates_created_at ON public.procedure_templates(created_at);

-- RLS (Row Level Security) - Acesso total para usuários da aplicação
ALTER TABLE public.procedure_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public full access to procedure_templates"
  ON public.procedure_templates
  FOR ALL
  USING (true)
  WITH CHECK (true);
