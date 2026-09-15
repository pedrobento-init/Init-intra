-- ============================================================
-- 030: Token do cliente no Milvus (clients.milvus_client_token)
-- Execute no Supabase SQL Editor (como postgres/service_role)
-- ============================================================
-- OBJETIVO: identificador do CLIENTE dentro do Milvus, usado pela
-- API de chamados via filtro_body.cliente_token.
--
-- ATENÇÃO — DOIS VALORES DISTINTOS, SEM CONFUSÃO:
-- - MILVUS_API_TOKEN = segredo de autenticação da API. Vive SOMENTE
--   em Supabase Secrets / Edge Function. NUNCA nesta coluna.
-- - clients.milvus_client_token = identificador público do cliente
--   no Milvus (ex.: "2JWX2PU"). Administrável, sem máscara.
--
-- NULL = cliente sem integração Milvus (campo opcional).
-- Sem UNIQUE: não verificado se dois clientes podem compartilhar
-- identificação no Milvus — não presumir.
-- Sem RLS nova: a coluna herda as policies clients_* (por linha/team);
-- quem não pode editar o cliente não edita o token.
-- ============================================================

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS milvus_client_token TEXT;

COMMENT ON COLUMN public.clients.milvus_client_token IS
  'Identificador/token do CLIENTE no Milvus (filtro_body.cliente_token nos chamados). NÃO é o MILVUS_API_TOKEN (segredo da API, só em Supabase Secrets/Edge). NULL = sem integração.';

-- ── Verificação (somente leitura) ────────────────────────────
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'clients'
--   AND column_name = 'milvus_client_token';
-- (esperado: 1 linha — text, YES)
