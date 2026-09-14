-- ============================================================
-- FASE 9: EXPLAIN p/ staging — paginação de pendências (SOMENTE LEITURA)
-- ============================================================
-- COMO USAR (Supabase SQL Editor, ambiente de STAGING, nunca produção):
-- 1. Troque 'mam' pelo team de teste nas queries abaixo.
-- 2. Rode cada bloco e anexe o plano ao relatório.
-- 3. O QUE ESPERAR (ver 025):
--    - Index Scan usando idx_pendencias_team_status_created (ou Bitmap
--      combinando idx_pendencias_team + status), sem Seq Scan em 10k+;
--    - Sort pequeno/sobre índice (ORDER BY created_at DESC, id);
--    - Buffers baixos e proporcionais ao LIMIT, não à tabela.
-- LIMITAÇÃO HONESTA: como postgres (bypass RLS), o plano NÃO inclui o
-- custo da policy. A RLS soma 1 Init Plan: current_op_team() = 1 lookup
-- indexado em operators(auth_user_id) — O(1), avaliado 1× por statement
-- (função STABLE sem argumentos). Valide as policies com o bloco 5 e,
-- se quiser o plano COM RLS, rode como authenticated com JWT de teste
-- (SET LOCAL request.jwt.claims ...; SET ROLE authenticated;).
-- ============================================================

-- ── 0. Tamanho e cardinalidade (contexto) ──
-- SELECT pg_size_pretty(pg_total_relation_size('public.pendencias')) AS total,
--        (SELECT count(*) FROM public.pendencias) AS linhas;

-- ── 1. Página 1 ativas do team (query exata da Fase 3) ──
-- EXPLAIN (ANALYZE, BUFFERS)
-- SELECT * FROM public.pendencias
-- WHERE team = 'mam'
--   AND status NOT IN ('concluido','resolvido','cancelado','fechado')
-- ORDER BY created_at DESC, id ASC
-- LIMIT 50 OFFSET 0;

-- ── 2. Página funda (OFFSET alto — deve continuar indexada) ──
-- EXPLAIN (ANALYZE, BUFFERS)
-- SELECT * FROM public.pendencias
-- WHERE team = 'mam'
--   AND status NOT IN ('concluido','resolvido','cancelado','fechado')
-- ORDER BY created_at DESC, id ASC
-- LIMIT 50 OFFSET 5000;

-- ── 3. Arquivadas sob demanda ──
-- EXPLAIN (ANALYZE, BUFFERS)
-- SELECT * FROM public.pendencias
-- WHERE team = 'mam'
--   AND status IN ('concluido','resolvido','cancelado','fechado')
-- ORDER BY created_at DESC, id ASC
-- LIMIT 50 OFFSET 0;

-- ── 4. Contadores da Fase 6 (só coluna status) ──
-- EXPLAIN (ANALYZE, BUFFERS)
-- SELECT status FROM public.pendencias
-- WHERE team = 'mam'
--   AND status NOT IN ('concluido','resolvido','cancelado','fechado');

-- ── 5. Policies RLS vigentes (o plano acima não as mostra) ──
-- SELECT policyname, cmd, qual, with_check FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'pendencias'
-- ORDER BY policyname;

-- ── 6. Índices em uso potencial ──
-- SELECT indexname, indexdef FROM pg_indexes
-- WHERE tablename = 'pendencias' ORDER BY indexname;
