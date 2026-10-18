-- ============================================================
-- Migration 044: Endereço do cliente (Roteiro do dia)
-- ============================================================
-- Usado pelo Roteiro do dia (Minha fila) para abrir Maps/Waze e montar a
-- rota com as visitas do dia. Texto livre ("Rua X, 123 - Bairro, Cidade").
-- O app só envia a coluna quando ela tem valor (campo opcional no sync),
-- então aplicar depois do deploy só atrasa o salvamento dos endereços.
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS address TEXT DEFAULT '';
