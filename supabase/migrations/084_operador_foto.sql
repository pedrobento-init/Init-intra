-- ============================================================
-- Migration 084: foto do operador
-- ============================================================
-- O formulário do operador ganhou foto de perfil. O app reduz a imagem para
-- 256x256 (JPEG) antes de guardar, então o data URL cabe em poucos KB e vai
-- direto na linha, como já é a logo do cliente.
--
-- O app funciona sem esta migration: a coluna `photo` só entra no upsert
-- quando o operador tem foto (ou acabou de removê-la). O banco sem a coluna
-- segue salvando operadores normalmente; só não dá para guardar foto.
--
-- Aplicar no SQL Editor. Idempotente.
--
-- VERIFICAR:
--   select column_name, data_type from information_schema.columns
--    where table_schema = 'public' and table_name = 'operators' and column_name = 'photo';
--   -- esperado: 1 linha (text)
-- REVERTER:
--   alter table public.operators drop constraint if exists operators_photo_formato;
--   alter table public.operators drop column if exists photo;
-- ============================================================

alter table public.operators add column if not exists photo text;

-- Só imagem raster em data URL e com teto de tamanho: a coluna é lida por todos
-- os autenticados e não pode virar depósito de arquivo (nem de SVG com script).
alter table public.operators drop constraint if exists operators_photo_formato;
alter table public.operators
  add constraint operators_photo_formato
  check (
    photo is null
    or (photo ~ '^data:image/(jpeg|png|webp);base64,' and length(photo) <= 150000)
  );
