-- ============================================================
-- 033: Número amigável da visita (visits.numero)
-- Execute no Supabase SQL Editor (como postgres/service_role)
-- ============================================================
-- OBJETIVO: identificador público/sequencial da visita ("Visita #0001"),
-- exibido na interface no lugar do UUID. O UUID (coluna id) continua
-- sendo o identificador técnico/interno (sync, relações, tombstones).
--
-- REGRAS (aplicadas no frontend, espelhadas aqui como documentação):
-- - INTEGER, monotônico, nunca reutilizado (exclusão não recicla).
-- - Atribuído localmente no ato da criação (offline-first); a
--   reconciliação de colisões multi-dispositivo é determinística
--   (mantém o mais antigo; demais ganham max+1) e converge via sync.
-- - Sem UNIQUE: dispositivos offline podem alocar provisoriamente o
--   mesmo número; a unicidade final é garantida pela reconciliação,
--   não pela constraint (que quebraria writes offline).
--
-- Sem RLS nova: a coluna herda as policies visits_* por linha/team.
-- ============================================================

ALTER TABLE public.visits
  ADD COLUMN IF NOT EXISTS numero INTEGER;

COMMENT ON COLUMN public.visits.numero IS
  'Número amigável/sequencial da visita (exibição "Visita #0001"). O id (UUID) segue como identificador técnico. Sem UNIQUE cliffs: unicidade final via reconciliação determinística no app.';

-- ── Verificação (somente leitura) ────────────────────────────
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'visits'
--   AND column_name = 'numero';
-- (esperado: 1 linha — integer, YES)
