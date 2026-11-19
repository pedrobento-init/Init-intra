-- ============================================================
-- Migration 090: pendência vinculada a um chamado do Milvus
-- ============================================================
-- A Caixa de entrada (js/caixa-pendencia.js) abre pendência e chamado no
-- Milvus direto da conversa. Até aqui a pendência não tinha onde guardar QUAL
-- chamado do Milvus é o dela: o técnico colava o número na descrição e ninguém
-- achava depois. Esta migration dá um lugar para isso.
--
-- O QUE MUDA:
--   * pendencias.milvus_chamado_codigo INTEGER: código do chamado no Milvus
--     (o mesmo número que aparece no portal). Pode vir de duas formas: o
--     técnico escolhe um chamado que já existe (lista de client_milvus_tickets,
--     029) ou cria um novo pela Edge Function milvus-chamado-create, ação
--     "conversa". NULL = pendência sem chamado no Milvus, que é o normal.
--   * Sem RLS nova: a coluna herda as policies de pendencias por linha/team.
--   * Sem UNIQUE: duas pendências podem apontar para o mesmo chamado (um
--     chamado grande que virou duas tarefas internas é caso real).
--
-- Banco sem esta migration: o app trata a coluna como opcional
-- (js/schema.js, optionalFields). A pendência é criada do mesmo jeito; o
-- vínculo fica só no aparelho de quem criou até a migration ser aplicada.
--
-- Aplicar no SQL Editor depois da 089. Idempotente.
--
-- VERIFICAR:
--   select column_name, data_type from information_schema.columns
--    where table_schema = 'public' and table_name = 'pendencias'
--      and column_name = 'milvus_chamado_codigo';
--   -- esperado: 1 linha, integer
--
-- REVERTER:
--   alter table public.pendencias drop column if exists milvus_chamado_codigo;
-- ============================================================

alter table public.pendencias
  add column if not exists milvus_chamado_codigo integer;

comment on column public.pendencias.milvus_chamado_codigo is
  'Código do chamado no Milvus vinculado a esta pendência (escolhido ou criado pela Caixa). NULL = sem chamado.';
