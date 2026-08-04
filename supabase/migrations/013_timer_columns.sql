-- ============================================================
-- Migration 010: Colunas de timer (play/pause) para chamados e pendências
-- ============================================================

-- Tickets: timer
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS timer_running BOOLEAN DEFAULT false;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS timer_started_at TIMESTAMPTZ;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS timer_total_seconds INTEGER DEFAULT 0;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS timer_operator TEXT;

-- Pendências: timer
ALTER TABLE public.pendencias ADD COLUMN IF NOT EXISTS timer_running BOOLEAN DEFAULT false;
ALTER TABLE public.pendencias ADD COLUMN IF NOT EXISTS timer_started_at TIMESTAMPTZ;
ALTER TABLE public.pendencias ADD COLUMN IF NOT EXISTS timer_total_seconds INTEGER DEFAULT 0;
ALTER TABLE public.pendencias ADD COLUMN IF NOT EXISTS timer_operator TEXT;
