-- ============================================================
-- Migration 075: a caixa de entrada passa a receber WhatsApp
-- ============================================================
-- A 073 fez de emails_triagem a caixa única de "tudo que chegou", mas tudo que
-- chegava era e-mail. Com a entrada por WhatsApp (supabase/functions/whatsapp/,
-- hoje pela Z-API), a mensagem precisa cair na MESMA caixa — senão quem atende
-- passa a ter duas filas, e a que não tem tela é a que esquece.
--
-- O nome da tabela continua dizendo e-mail porque renomear quebraria o sync do
-- app (js/storage.js) e as policies da 066 por um ganho só de nome. O canal fica
-- explícito numa coluna, e é ela que a tela usa para mostrar de onde veio.
--
-- O que muda:
--   * canal (text, NOT NULL, default 'email', CHECK em 'email' | 'whatsapp'): o
--     default mantém as linhas antigas e o robô do Gmail como estão, sem tocar
--     no robo/index.ts.
--   * telefone (text): só dígitos, com país, de quem escreveu pelo WhatsApp.
--     Nulo em e-mail. É a chave da conversa nesse canal — o thread_id guarda o
--     mesmo valor com prefixo ("whatsapp:5511..."), igual ao email_thread_id
--     das pendências.
--   * índice parcial (telefone, recebido_em) para montar a conversa de um
--     número sem varrer as linhas de e-mail, que são a maioria.
--
-- NÃO muda pendencias.canal: ela já existe desde a 056, e o CHECK de lá já
-- aceita 'whatsapp'. O chamado que nascer de uma mensagem usa essa coluna.
--
-- Enquanto esta migration não for aplicada, o webhook do WhatsApp continua
-- anexando nota a chamado aberto; só o insert na caixa falha (coluna que não
-- existe) e vai para o log. Nenhuma mensagem de e-mail é afetada.
--
-- Idempotente.
--
-- VERIFICAR:
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'emails_triagem'
--      and column_name in ('canal', 'telefone');
--   -- esperado: 2 linhas; canal com is_nullable = NO e default 'email'::text
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conname = 'emails_triagem_canal_check';
--   -- esperado: CHECK ((canal = ANY (ARRAY['email'::text, 'whatsapp'::text])))
--   select indexdef from pg_indexes where indexname = 'emails_triagem_telefone_idx';
--   -- esperado: 1 linha, com WHERE (telefone IS NOT NULL)
--
-- REVERTER (as linhas de WhatsApp saem antes: sem a coluna canal, elas ficariam
-- na caixa parecendo e-mail):
--   delete from public.emails_triagem where canal = 'whatsapp';
--   drop index if exists public.emails_triagem_telefone_idx;
--   alter table public.emails_triagem drop constraint if exists emails_triagem_canal_check;
--   alter table public.emails_triagem
--     drop column if exists telefone,
--     drop column if exists canal;
--
-- RLS: nenhuma policy nova e nenhuma afrouxada. As da 066 filtram por team
-- (admin, ou COALESCE(team, 'init') = current_op_team()) e valem para as
-- colunas novas; o webhook grava o team do cliente que casou pelo telefone, ou
-- 'init' quando nenhum casou.
-- ============================================================

alter table public.emails_triagem
  add column if not exists canal    text not null default 'email',
  add column if not exists telefone text;

alter table public.emails_triagem drop constraint if exists emails_triagem_canal_check;
alter table public.emails_triagem add constraint emails_triagem_canal_check
  check (canal in ('email', 'whatsapp'));

create index if not exists emails_triagem_telefone_idx
  on public.emails_triagem (telefone, recebido_em)
  where telefone is not null;
