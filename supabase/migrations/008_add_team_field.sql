-- ============================================================
-- Migration 008: Adiciona campo team para separação por equipe
-- Execute este SQL no Supabase SQL Editor
-- ============================================================

-- Adiciona team à tabela clients
ALTER TABLE public.clients
ADD COLUMN IF NOT EXISTS team TEXT DEFAULT 'init';

-- Adiciona team à tabela pendencias
ALTER TABLE public.pendencias
ADD COLUMN IF NOT EXISTS team TEXT DEFAULT 'init';

-- Adiciona team à tabela tickets
ALTER TABLE public.tickets
ADD COLUMN IF NOT EXISTS team TEXT DEFAULT 'init';

-- Adiciona team à tabela operators
ALTER TABLE public.operators
ADD COLUMN IF NOT EXISTS team TEXT DEFAULT 'init';

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_clients_team ON public.clients(team);
CREATE INDEX IF NOT EXISTS idx_pendencias_team ON public.pendencias(team);
CREATE INDEX IF NOT EXISTS idx_tickets_team ON public.tickets(team);
CREATE INDEX IF NOT EXISTS idx_operators_team ON public.operators(team);
