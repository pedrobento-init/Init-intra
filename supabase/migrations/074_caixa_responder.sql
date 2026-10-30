-- ============================================================
-- Migration 074: responder pela caixa deixa registro na conversa
-- ============================================================
-- A caixa (#caixa) ganhou a ação Responder: o humano escreve, o e-mail sai
-- pelo Gmail (Edge Function caixa-responder), na mesma conversa — o
-- message_id da linha volta como In-Reply-To/References. A IA não participa
-- do caminho: só sai e-mail por clique de operador.
--
-- O que muda:
--   * status ganha 'respondido': a mensagem enviada vira linha nova em
--     emails_triagem (status respondido, team da linha de origem) e as
--     pendentes do thread também viram respondido — responder É decidir, como
--     abrir chamado ou descartar, e a conversa sai de "Aguardando decisão".
--
-- Sem esta migration a function envia o e-mail e a gravação falha no CHECK:
-- o envio NÃO se desfaz (resposta `registrado: false` e a tela avisa), mas a
-- conversa fica sem registro do que foi mandado. Depois da 073. Idempotente.
--
-- VERIFICAR:
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conname = 'emails_triagem_status_check';
--   -- esperado: a lista com 'respondido'
--
-- REVERTER (as linhas respondidas precisam sair antes, ou o CHECK antigo falha):
--   delete from public.emails_triagem where status = 'respondido';
--   alter table public.emails_triagem drop constraint if exists emails_triagem_status_check;
--   alter table public.emails_triagem add constraint emails_triagem_status_check
--     check (status in ('pendente', 'virou_chamado', 'anexado', 'descartado'));
--
-- RLS: nenhuma policy nova. As da 066 filtram por team e valem para a linha da
-- resposta; a function lê e grava com o cliente do operador, então a regra de
-- equipe decide o que pode ser respondido.
-- ============================================================

alter table public.emails_triagem drop constraint if exists emails_triagem_status_check;
alter table public.emails_triagem add constraint emails_triagem_status_check
  check (status in ('pendente', 'virou_chamado', 'anexado', 'respondido', 'descartado'));
