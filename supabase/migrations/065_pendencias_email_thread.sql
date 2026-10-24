-- ============================================================
-- Migration 065: casar a conversa de e-mail com o chamado que ela já abriu
-- ============================================================
-- O robô varre a CONVERSA inteira do rótulo (Robo.gs, th.getMessages()), então
-- a resposta do cliente dentro da thread chegava à triagem como mensagem nova
-- e abria OUTRO chamado do mesmo assunto. Quem atende acabava com dois
-- chamados para a mesma história, cada um com metade da conversa.
--
-- Pendência ganha:
-- - email_thread_id ... id da conversa no Gmail (th.getId()), não o do e-mail.
--                       É a chave que liga toda mensagem da thread ao chamado
--                       que ela já abriu: achando um chamado ABERTO com este
--                       id, a triagem posta a mensagem como nota em vez de
--                       abrir chamado novo.
--
-- O índice é parcial (só quem tem thread) porque a coluna fica nula em todo
-- chamado aberto à mão, que é a maioria — índice cheio pagaria por linha que
-- nunca entra na consulta.
--
-- Sem esta coluna o app segue igual: é optionalField em js/schema.js, e a
-- triagem só deixa de casar a thread (volta a abrir chamado novo, como antes).
-- RLS: as policies de pendencias (042/055) já cobrem a coluna nova.
-- Depois da 064. Idempotente.
--
-- VERIFICAR:
--   select column_name from information_schema.columns
--    where table_name = 'pendencias' and column_name = 'email_thread_id';
--   -- esperado: 1 linha
--
--   select indexname from pg_indexes
--    where tablename = 'pendencias' and indexname = 'idx_pendencias_email_thread';
--   -- esperado: 1 linha
--
-- ROLLBACK:
--   drop index if exists public.idx_pendencias_email_thread;
--   alter table public.pendencias drop column if exists email_thread_id;
-- ============================================================

ALTER TABLE public.pendencias ADD COLUMN IF NOT EXISTS email_thread_id TEXT;

CREATE INDEX IF NOT EXISTS idx_pendencias_email_thread
  ON public.pendencias (email_thread_id)
  WHERE email_thread_id IS NOT NULL;

COMMENT ON COLUMN public.pendencias.email_thread_id IS
  'Id da conversa no Gmail. Mensagem nova na mesma thread vira nota no chamado aberto, em vez de chamado novo.';
