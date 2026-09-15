-- ============================================================
-- 027: Importação de planilha no inventário
-- Execute no Supabase SQL Editor (como postgres/service_role)
-- ============================================================
-- CONTEXTO: a API do Milvus ignora paginação (sempre os 50 primeiros),
-- então o inventário completo vem do export Excel. Linhas importadas
-- NÃO têm milvus_device_id (o export não traz id): a coluna passa a
-- aceitar NULL. O upsert dessas linhas é pelo PK `id` determinístico
-- (`<client_id>:imp-<hash>`), calculado no frontend — reimportar
-- atualiza em vez de duplicar.
-- Nenhuma policy é alterada; o UNIQUE (client_id, milvus_device_id)
-- continua valendo para linhas da API (NULLs não conflitam entre si).
-- ============================================================

ALTER TABLE public.client_devices
  ALTER COLUMN milvus_device_id DROP NOT NULL;
