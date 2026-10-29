-- ============================================================
-- Migration 070: resposta automática vai para a caixa de triagem
-- ============================================================
-- A triagem (supabase/functions/robo, respostaAutomatica) passa a separar o
-- e-mail escrito por máquina — "estou de férias", "recebemos sua mensagem",
-- aviso de não entrega — antes de olhar a conversa e antes de chamar a IA.
-- Antes ele virava nota do solicitante no chamado da conversa, ou gastava uma
-- chamada ao Make para ser ignorado. Agora fica em emails_triagem com o motivo
-- novo `auto_resposta`, para ninguém perder de vista se a detecção errar.
--
-- O CHECK da 066 só aceitava 'sem_cliente' e 'ignorado_ia'. Enquanto esta
-- migration não for aplicada, a Edge Function ainda descarta a auto-resposta
-- (não vira nota) e só avisa no log que não conseguiu guardá-la. Idempotente.
--
-- VERIFICAR:
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conname = 'emails_triagem_motivo_check';
--   -- esperado: a lista com 'auto_resposta'
--
-- REVERTER (as linhas novas precisam sair antes, ou o CHECK antigo falha):
--   update public.emails_triagem set motivo = 'ignorado_ia' where motivo = 'auto_resposta';
--   alter table public.emails_triagem drop constraint if exists emails_triagem_motivo_check;
--   alter table public.emails_triagem add constraint emails_triagem_motivo_check
--     check (motivo in ('sem_cliente', 'ignorado_ia'));
--
-- RLS: nenhuma policy nova. A linha leva o team do cliente quando o remetente
-- casa com uma ficha, e 'init' quando não casa — como as outras da 066.
-- ============================================================

alter table public.emails_triagem drop constraint if exists emails_triagem_motivo_check;
alter table public.emails_triagem add constraint emails_triagem_motivo_check
  check (motivo in ('sem_cliente', 'ignorado_ia', 'auto_resposta'));
