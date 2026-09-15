-- ============================================================
-- 028: Cache do cliente_id Milvus no mapa
-- Execute no Supabase SQL Editor (como postgres/service_role)
-- ============================================================
-- CONTEXTO: a listagem ignora paginação, mas GET /buscar?cliente=<id>
-- devolve a lista completa do cliente. O id numérico do Milvus é
-- descoberto uma vez (via serial/id conhecido) e guardado aqui para
-- os próximos syncs irem direto.
-- NÃO é vínculo: só chave de busca dentro de nome já mapeado
-- manualmente. Nenhuma policy é alterada.
-- ============================================================

ALTER TABLE public.milvus_client_map
  ADD COLUMN IF NOT EXISTS milvus_cliente_id INTEGER;
