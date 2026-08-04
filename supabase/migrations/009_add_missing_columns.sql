-- ============================================================
-- Migration 009: Colunas que faltavam nos upserts do Supabase
-- ============================================================

-- Pendências: attachments, checklist, tags, completed_at
ALTER TABLE public.pendencias ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]';
ALTER TABLE public.pendencias ADD COLUMN IF NOT EXISTS checklist   JSONB DEFAULT '[]';
ALTER TABLE public.pendencias ADD COLUMN IF NOT EXISTS tags        JSONB DEFAULT '[]';
ALTER TABLE public.pendencias ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- Tickets: attachments, completed_at
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS attachments  JSONB DEFAULT '[]';
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- Clients: attachments (anexos de documentos)
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]';
