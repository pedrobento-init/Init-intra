-- ============================================================
-- Migration 073: emails_triagem vira a caixa de entrada única
-- ============================================================
-- Até aqui a tabela da 066 guardava só o que NÃO virou chamado (sem cliente,
-- ignorado pela IA, resposta automática). O resto da label Pendências sumia do
-- app depois da triagem: o chamado existia, a nota existia, mas não havia um
-- lugar com "tudo que chegou por e-mail" e quem está cuidando de cada conversa.
-- Agora o robô grava uma linha por mensagem externa em todos os caminhos, e a
-- tela #caixa (js/caixa-entrada.js) lista por conversa.
--
-- O que muda:
--   * motivo aceita NULL: linha que virou chamado ou nota não tem "motivo de não
--     ter virado". O CHECK da 070 continua valendo para valor não nulo.
--   * status ganha 'anexado' (a mensagem virou nota num chamado aberto).
--   * client_id, atribuido_a, atribuido_em e atribuicao_nota (o motivo da
--     última transferência — o app exige quando troca de uma pessoa para outra).
--   * índice (thread_id, recebido_em) para montar a conversa.
--
-- Enquanto esta migration não for aplicada, o robô continua abrindo chamado e
-- gravando nota: a linha da caixa é gravada DEPOIS, e o insert que falha no
-- CHECK só vai para o log e para o contador caixa_erros. Idempotente.
--
-- VERIFICAR:
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conname = 'emails_triagem_status_check';
--   -- esperado: a lista com 'anexado'
--   select column_name, is_nullable from information_schema.columns
--    where table_schema = 'public' and table_name = 'emails_triagem'
--      and column_name in ('motivo', 'client_id', 'atribuido_a', 'atribuido_em', 'atribuicao_nota');
--   -- esperado: 5 linhas, motivo com is_nullable = YES
--
-- REVERTER (as linhas novas precisam sair antes, ou os CHECK antigos falham):
--   delete from public.emails_triagem where status = 'anexado' or motivo is null;
--   alter table public.emails_triagem drop constraint if exists emails_triagem_status_check;
--   alter table public.emails_triagem add constraint emails_triagem_status_check
--     check (status in ('pendente', 'virou_chamado', 'descartado'));
--   alter table public.emails_triagem alter column motivo set not null;
--   drop index if exists public.emails_triagem_thread_idx;
--   alter table public.emails_triagem
--     drop column if exists client_id,
--     drop column if exists atribuido_a,
--     drop column if exists atribuido_em,
--     drop column if exists atribuicao_nota;
--
-- RLS: nenhuma policy nova. As da 066 filtram por team e valem para as colunas
-- novas; vincular cliente pela caixa grava o team do cliente na linha.
-- ============================================================

alter table public.emails_triagem alter column motivo drop not null;

alter table public.emails_triagem drop constraint if exists emails_triagem_status_check;
alter table public.emails_triagem add constraint emails_triagem_status_check
  check (status in ('pendente', 'virou_chamado', 'anexado', 'descartado'));

alter table public.emails_triagem
  add column if not exists client_id       text,
  add column if not exists atribuido_a     text,
  add column if not exists atribuido_em    timestamptz,
  add column if not exists atribuicao_nota text;

create index if not exists emails_triagem_thread_idx
  on public.emails_triagem (thread_id, recebido_em);
