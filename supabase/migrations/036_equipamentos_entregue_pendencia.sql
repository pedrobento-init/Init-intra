-- Migration 036: Equipamentos — status 'entregue' + vínculo de pendência
-- 1. Renomeia o status 'em_uso' → 'entregue' (com bump de updatedAt para o
--    merge/sync propagar sem ressuscitar o valor antigo).
-- 2. Adiciona pendencia_id (vínculo opcional com pendência; os_vinculada
--    passa a ser texto livre digitado pelo usuário).
-- Idempotente: roda com segurança mesmo se a 035 já incluía a coluna.

ALTER TABLE public.equipamentos ADD COLUMN IF NOT EXISTS pendencia_id TEXT;
CREATE INDEX IF NOT EXISTS idx_equipamentos_pendencia ON public.equipamentos(pendencia_id);

UPDATE public.equipamentos
SET status = 'entregue', updated_at = now()
WHERE status = 'em_uso';
