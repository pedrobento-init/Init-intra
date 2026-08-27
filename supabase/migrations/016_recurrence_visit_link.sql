-- Migration 016: Recorrência em pendências/visitas e vínculo visita -> pendência
ALTER TABLE public.pendencias ADD COLUMN IF NOT EXISTS recurrence TEXT;
ALTER TABLE public.pendencias ADD COLUMN IF NOT EXISTS visit_id TEXT;
ALTER TABLE public.visits ADD COLUMN IF NOT EXISTS recurrence TEXT;
