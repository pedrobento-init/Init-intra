-- ============================================================
-- 032: Vínculo visita → chamado Milvus (visits.milvus_chamado_*)
-- Execute no Supabase SQL Editor (como postgres/service_role)
-- ============================================================
-- OBJETIVO: persistir no servidor o estado da integração
-- "visita criada → chamado criado no Milvus", espelhando os campos
-- locais (js/schema.js, entidade visits). O código do chamado é a
-- prova de criação e a chave anti-duplicação (idempotência).
--
-- COLUNAS:
-- - milvus_chamado_codigo     INTEGER — código retornado pelo Milvus
--   (ex.: 123). Só é preenchido APÓS criação confirmada.
-- - milvus_chamado_status     TEXT — 'pendente' | 'criando' |
--   'criado' | 'sem_token' | 'erro'. NULL em visitas antigas
--   (anteriores à integração) = fora do escopo, sem backfill.
-- - milvus_chamado_erro       TEXT — última mensagem de falha (p/ UI).
-- - milvus_chamado_tentativas INTEGER — tentativas com erro temporário
--   (teto de auto-retry no frontend; erros permanentes não retentam).
--
-- Sem RLS nova: as colunas herdam as policies visits_* por linha/team
-- (021_rls_remediation). Sem UNIQUE: 1 visita → no máx. 1 chamado,
-- garantido pela Edge Function + travas do frontend.
-- ============================================================

ALTER TABLE public.visits
  ADD COLUMN IF NOT EXISTS milvus_chamado_codigo INTEGER;

ALTER TABLE public.visits
  ADD COLUMN IF NOT EXISTS milvus_chamado_status TEXT;

ALTER TABLE public.visits
  ADD COLUMN IF NOT EXISTS milvus_chamado_erro TEXT;

ALTER TABLE public.visits
  ADD COLUMN IF NOT EXISTS milvus_chamado_tentativas INTEGER DEFAULT 0;

COMMENT ON COLUMN public.visits.milvus_chamado_codigo IS
  'Código do chamado criado no Milvus para esta visita. Preenchido somente após criação confirmada; é a chave anti-duplicação.';
COMMENT ON COLUMN public.visits.milvus_chamado_status IS
  'Estado da integração: pendente | criando | criado | sem_token | erro. NULL = visita anterior à integração (fora do escopo).';
COMMENT ON COLUMN public.visits.milvus_chamado_erro IS
  'Última mensagem de falha da criação do chamado (exibição e diagnóstico).';
COMMENT ON COLUMN public.visits.milvus_chamado_tentativas IS
  'Contador de tentativas com erro temporário (teto de auto-retry no frontend).';

-- ── Verificação (somente leitura) ────────────────────────────
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'visits'
--   AND column_name LIKE 'milvus_chamado_%'
-- ORDER BY column_name;
-- (esperado: 4 linhas — codigo/integer, erro/text, status/text,
--  tentativas/integer)
