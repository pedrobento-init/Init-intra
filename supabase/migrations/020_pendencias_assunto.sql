-- ============================================================
-- Migration 020: Separa ASSUNTO e DESCRIÇÃO em pendências
-- ============================================================
-- Antes: apenas `descricao` (usada como título e detalhamento).
-- Depois: `assunto` (título/resumo curto, obrigatório no formulário)
--         + `descricao` (detalhamento completo, obrigatório no formulário).
--
-- Estratégia segura para dados existentes:
-- - Adiciona a coluna como NULL-able com DEFAULT '' (não remove nada).
-- - NÃO faz backfill automático: não é possível separar com segurança
--   o título do detalhamento a partir do texto antigo sem inventar dados.
-- - Pendências antigas mantêm `descricao` intacta e `assunto = ''`,
--   ficando marcadas para preenchimento posterior no formulário de edição.
-- - O frontend exibe `descricao` como título de fallback enquanto
--   `assunto` estiver vazio (compatibilidade de leitura).

ALTER TABLE public.pendencias ADD COLUMN IF NOT EXISTS assunto TEXT DEFAULT '';

-- Garante default para escritas futuras sem o campo (ex.: pushes antigos)
ALTER TABLE public.pendencias ALTER COLUMN assunto SET DEFAULT '';
