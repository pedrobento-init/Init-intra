-- ============================================================
-- 039: Clientes — quem editou por último (updated_by)
-- ============================================================
-- OBJETIVO: guardar o autor da última edição (updated_by TEXT), ao lado
-- do já existente updated_at, para o cabeçalho do modal de cliente:
-- "Atualizada em DD/MM/AAAA por <usuário>".
--
-- O QUE MUDA:
-- - clients: ADD COLUMN updated_by TEXT (nulo por padrão).
-- - Nada mais: sem backfill automático. Registros antigos mantêm
--   updated_by NULL (a UI omite "por ..."), sem inventar autoria.
--   A partir desta versão, salvar cliente carimba o nome do operador
--   da sessão (js/storage.js -> saveClient()).
-- - RLS: políticas existentes são por tabela; a nova coluna é herdada
--   sem policy nova (mesmo regime das demais colunas).
--
-- ORDEM DE PUBLICAÇÃO (importante):
-- rode ANTES de subir a versão do app. O upsert do saveClient() e o
-- sync genérico (js/schema.js) já enviam updated_by; se a coluna não
-- existir, o PostgREST rejeita a escrita inteira da linha.
--
-- COMO APLICAR (Supabase SQL Editor, como postgres/service_role):
-- 1. Backup/snapshot.
-- 2. Rode este arquivo inteiro.
-- 3. Confira: SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'clients' AND column_name = 'updated_by';
-- ROLLBACK: ALTER TABLE public.clients DROP COLUMN IF EXISTS updated_by;
-- (apaga o "quem editou" preenchido depois da migração).
-- ============================================================

ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS updated_by TEXT;

COMMENT ON COLUMN public.clients.updated_by IS
  'Nome do operador responsável pela última edição (gravado pelo app junto de updated_at). NULL = desconhecido/registro antigo.';
