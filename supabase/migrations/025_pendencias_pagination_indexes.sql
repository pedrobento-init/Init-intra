-- ============================================================
-- 025: Índices p/ paginação server-side de pendências — PODE APLICAR
-- ============================================================
-- POR QUE: a Fase 3 pagina no banco com
--   WHERE team = ? AND status IN/NOT IN (...) [ + filtros eq/ilike ]
--   ORDER BY created_at DESC, id ASC LIMIT 50.
-- Existentes (002/008, sem duplicidade — verificado): PK id,
-- idx_pendencias_client/status/priority/responsible/team.
-- FALTAM (criados aqui, todos IF NOT EXISTS, só leitura/escrita de
-- catálogo — sem mudar dados, RLS ou comportamento):
-- - deadline: filtros de prazo/calendário/vencidas;
-- - created_at: ORDER BY da paginação;
-- - completed_at: escopo de arquivadas/métricas futuras;
-- - composto (team, status, created_at DESC): atende a query paginada
--   (team + scope + ordem) num único índice.
-- VERIFICAÇÃO (leitura): SELECT indexname FROM pg_indexes
-- WHERE tablename = 'pendencias' ORDER BY indexname;
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_pendencias_deadline
  ON public.pendencias(deadline);
CREATE INDEX IF NOT EXISTS idx_pendencias_created
  ON public.pendencias(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pendencias_completed
  ON public.pendencias(completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_pendencias_team_status_created
  ON public.pendencias(team, status, created_at DESC);
