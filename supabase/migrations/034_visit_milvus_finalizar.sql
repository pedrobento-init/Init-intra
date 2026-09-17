-- ============================================================
-- 034: Estado de finalização do chamado Milvus (visits.milvus_finalizar_*)
-- Execute no Supabase SQL Editor (como postgres/service_role)
-- ============================================================
-- OBJETIVO: persistir no servidor o estado da 2ª etapa da integração
-- ("relatório concluído → chamado finalizado no Milvus"), espelhando os
-- campos locais (js/schema.js, entidade visits). Independente do status da
-- visita: relatório CONCLUÍDO + finalização PENDENTE é um estado válido
-- (offline) até o retry concluir.
--
-- COLUNAS:
-- - milvus_finalizar_status     TEXT — 'pendente' | 'finalizando' |
--   'finalizado' | 'erro'. NULL em visitas antigas/concluídas antes da
--   etapa = fora do escopo automático (sem bulk-finalize do histórico).
-- - milvus_finalizar_erro       TEXT — última mensagem de falha (p/ UI).
-- - milvus_finalizar_tentativas INTEGER — tentativas com erro temporário
--   (teto de auto-retry no frontend; erros permanentes não retentam).
--
-- Sem RLS nova: herdam as policies visits_* por linha/team.
-- ============================================================

ALTER TABLE public.visits
  ADD COLUMN IF NOT EXISTS milvus_finalizar_status TEXT;

ALTER TABLE public.visits
  ADD COLUMN IF NOT EXISTS milvus_finalizar_erro TEXT;

ALTER TABLE public.visits
  ADD COLUMN IF NOT EXISTS milvus_finalizar_tentativas INTEGER DEFAULT 0;

COMMENT ON COLUMN public.visits.milvus_finalizar_status IS
  'Estado da finalização do chamado Milvus: pendente | finalizando | finalizado | erro. NULL = fora do escopo automático. Independente do status da visita.';
COMMENT ON COLUMN public.visits.milvus_finalizar_erro IS
  'Última mensagem de falha da finalização do chamado (exibição e diagnóstico).';
COMMENT ON COLUMN public.visits.milvus_finalizar_tentativas IS
  'Contador de tentativas com erro temporário (teto de auto-retry no frontend).';

-- ── Verificação (somente leitura) ────────────────────────────
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'visits'
--   AND column_name LIKE 'milvus_finalizar_%'
-- ORDER BY column_name;
-- (esperado: 3 linhas — erro/text, status/text, tentativas/integer)
