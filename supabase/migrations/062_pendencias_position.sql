-- ============================================================
-- Migration 062: ordenação manual no quadro de pendências
-- ============================================================
-- O quadro já ordena cada coluna por criação, prazo ou prioridade
-- (js/pendencias.js, _penSortCards). Falta a ordem ARBITRÁRIA: arrastar
-- um card para cima ou para baixo dentro da mesma coluna.
--
-- COLUNA: `position` double precision, NULL por padrão.
--
-- Por que double e não integer: inserir entre dois cards vira
-- (anterior + seguinte) / 2 — sem renumerar a coluna inteira a cada
-- arrasto, o que geraria N updates e N broadcasts de realtime.
-- O primeiro da coluna recebe (menor - 1); o último, (maior + 1).
--
-- NULL = nunca foi ordenado à mão. No modo manual esses cards vão para o
-- fim, em ordem de criação — nenhum backfill é necessário.
--
-- RLS: nenhuma policy nova. `position` é só mais uma coluna de
-- `pendencias` e herda as policies existentes da tabela.
--
-- COMPATIBILIDADE: `position` entra em `optionalFields` no js/schema.js,
-- então o app funciona igual antes desta migration ser aplicada — o
-- upsert simplesmente não envia o campo. Aplicar não exige deploy junto.
--
-- VERIFICAÇÃO (depois de aplicar):
--   select column_name, data_type, is_nullable
--   from information_schema.columns
--   where table_schema = 'public'
--     and table_name = 'pendencias'
--     and column_name = 'position';
--   -- esperado: position | double precision | YES
--
-- ROLLBACK:
--   alter table public.pendencias drop column if exists position;
--   -- seguro: nenhuma outra coluna, view ou policy depende dela.
-- ============================================================

alter table public.pendencias
  add column if not exists position double precision;

comment on column public.pendencias.position is
  'Ordem manual dentro da coluna do quadro (menor primeiro). NULL = nunca ordenada à mão; vai para o fim do modo manual. Fracionária de proposito: inserir entre dois cards nao renumera a coluna.';
