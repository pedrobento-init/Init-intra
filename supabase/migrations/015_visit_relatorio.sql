-- Migration 015: Adiciona campo 'relatorio' para registrar o que foi feito nas visitas técnicas
ALTER TABLE public.visits ADD COLUMN IF NOT EXISTS relatorio TEXT;
