-- ============================================================
-- Migration 063: linha do tempo do chamado
-- ============================================================
-- O feed de `notes` registra o que a equipe ESCREVE. Não registra o que
-- ACONTECE: status mudou, responsável mudou, prioridade mudou, prazo
-- mudou. Hoje esse histórico se perde — `oldStatus` existe no save só
-- para disparar recorrência e notificação, e some em seguida.
--
-- COLUNA: `events` jsonb, default '[]'.
--
-- Cada evento: { at, by, type, de, para }
--   type ∈ criado | status | responsavel | prioridade | prazo
--   `de`/`para` guardam o valor cru (o rótulo é resolvido na tela, para
--   renomear um status não reescrever o histórico).
--
-- Por que jsonb na própria linha, e não tabela separada: é o padrão que
-- `notes`, `checklist` e `attachments` já usam aqui — herda as policies
-- de `pendencias`, não cria entidade nova de sync e viaja junto no
-- registro. O volume é limitado (dezenas por chamado) e o app corta em
-- PEN_MAX_EVENTS para a linha não crescer sem teto.
--
-- RLS: nenhuma policy nova.
--
-- COMPATIBILIDADE: `events` entra em `optionalFields` no js/schema.js.
-- ATENÇÃO: sem esta migration a linha do tempo funciona só no aparelho —
-- o upsert não envia a coluna, então os eventos não viajam entre
-- dispositivos nem sobrevivem a um pull. Diferente da 062, aqui aplicar
-- não é opcional para a funcionalidade valer de verdade.
--
-- VERIFICAÇÃO:
--   select column_name, data_type, column_default
--   from information_schema.columns
--   where table_schema = 'public'
--     and table_name = 'pendencias'
--     and column_name = 'events';
--   -- esperado: events | jsonb | '[]'::jsonb
--
-- ROLLBACK:
--   alter table public.pendencias drop column if exists events;
-- ============================================================

alter table public.pendencias
  add column if not exists events jsonb not null default '[]'::jsonb;

comment on column public.pendencias.events is
  'Linha do tempo do chamado: o que ACONTECEU (status, responsavel, prioridade, prazo), complementar a notes, que e o que a equipe ESCREVEU. Cada item: { at, by, type, de, para }.';
