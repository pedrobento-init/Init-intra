-- Checklist e categorias de verificação nas visitas técnicas
ALTER TABLE public.visits ADD COLUMN IF NOT EXISTS categories JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.visits ADD COLUMN IF NOT EXISTS checklist  JSONB DEFAULT '[]'::jsonb;
