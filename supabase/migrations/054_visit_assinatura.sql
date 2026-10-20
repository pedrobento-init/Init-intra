-- ============================================================
-- Migration 054: Assinatura do cliente na visita
-- ============================================================
-- assinatura: PNG em data URL (data:image/png;base64,...), ~10-30 KB,
-- coletada no app ao concluir a visita. Vai no relatório da visita.
-- O app funciona sem estas colunas (campos opcionais no sync).
-- RLS: as policies existentes de visits já cobrem as novas colunas.
-- ============================================================

ALTER TABLE public.visits ADD COLUMN IF NOT EXISTS assinatura TEXT;
ALTER TABLE public.visits ADD COLUMN IF NOT EXISTS assinatura_nome TEXT;
ALTER TABLE public.visits ADD COLUMN IF NOT EXISTS assinatura_em TIMESTAMPTZ;

-- Só PNG em data URL e com limite de tamanho (nada de link externo).
ALTER TABLE public.visits DROP CONSTRAINT IF EXISTS visits_assinatura_formato;
ALTER TABLE public.visits ADD CONSTRAINT visits_assinatura_formato
  CHECK (assinatura IS NULL OR (assinatura LIKE 'data:image/png;base64,%' AND length(assinatura) < 400000));
