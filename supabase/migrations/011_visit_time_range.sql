-- Migration 011: horário início/fim e dia inteiro nas visitas
ALTER TABLE public.visits ADD COLUMN IF NOT EXISTS time_end TIME;
ALTER TABLE public.visits ADD COLUMN IF NOT EXISTS all_day BOOLEAN DEFAULT false;
