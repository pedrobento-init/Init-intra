-- ============================================================
-- Migration 082: caixa de entrada vira portal de conversas
-- ============================================================
-- Permite resposta direta por WhatsApp/e-mail, nota interna, mídia e
-- encerramento sem exigir chamado. As policies por equipe da 066 continuam.
--
-- Aplicar no SQL Editor depois da 077. Idempotente.
-- VERIFICAR:
--   select column_name from information_schema.columns
--    where table_name = 'emails_triagem'
--      and column_name in ('direcao', 'media');
--   -- esperado: 2 linhas
-- REVERTER (apaga as respostas/notas do portal antes):
--   delete from public.emails_triagem where direcao in ('saida', 'interna');
--   alter table public.emails_triagem drop column if exists media;
--   alter table public.emails_triagem drop column if exists direcao;
--   delete from public.emails_triagem where status = 'encerrado';
--   alter table public.emails_triagem drop constraint if exists emails_triagem_status_check;
--   alter table public.emails_triagem add constraint emails_triagem_status_check
--     check (status in ('pendente', 'virou_chamado', 'anexado', 'descartado'));
-- ============================================================

alter table public.emails_triagem
  add column if not exists direcao text not null default 'entrada',
  add column if not exists media jsonb;

alter table public.emails_triagem drop constraint if exists emails_triagem_direcao_check;
alter table public.emails_triagem add constraint emails_triagem_direcao_check
  check (direcao in ('entrada', 'saida', 'interna'));

alter table public.emails_triagem drop constraint if exists emails_triagem_status_check;
alter table public.emails_triagem add constraint emails_triagem_status_check
  check (status in ('pendente', 'virou_chamado', 'anexado', 'descartado', 'encerrado'));

create index if not exists emails_triagem_portal_idx
  on public.emails_triagem (team, thread_id, recebido_em);
