-- ============================================================
-- Migration 076: números que já falaram com a empresa pelo WhatsApp
-- ============================================================
-- O whatsapp-responder tira o destino de pendencias.email_thread_id
-- ("whatsapp:<dígitos>"), e não do body, para o operador não escolher para
-- quem escreve. Só que o app cria o chamado de WhatsApp no cliente (a caixa de
-- entrada abre o chamado a partir da mensagem), então um operador pode gravar
-- qualquer "whatsapp:<número>" num chamado da própria equipe e, em seguida,
-- mandar mensagem com o número da empresa para um desconhecido.
--
-- A saída é ter uma lista que só o servidor escreve: o webhook registra aqui
-- todo número que mandou mensagem, e o responder recusa enviar para número que
-- não está nela. Ficou numa tabela própria porque a emails_triagem não serve:
-- a 066 deixa authenticated inserir lá, e o operador forjaria a prova.
--
-- O que muda:
--   * tabela whatsapp_conversas (telefone PK, primeira_em, ultima_em): o
--     telefone são os dígitos crus do webhook, iguais aos de email_thread_id;
--   * RLS ligado SEM policy nenhuma: authenticated e anon não leem nem gravam.
--     Só o service_role (webhook e responder, pelo supabaseAdmin) passa.
--
-- Enquanto esta migration não for aplicada, o webhook só loga a falha do
-- upsert e segue; o responder recusa todo envio (fail-closed), com o code
-- not_whatsapp_contact.
--
-- Números que escreveram antes desta migration não estão na lista: o primeiro
-- envio para eles falha até a pessoa mandar nova mensagem. Para liberar os
-- chamados que já estão abertos, rode o backfill abaixo (opcional) depois de
-- conferir os números que ele lista.
--
-- Idempotente.
--
-- BACKFILL (opcional, a partir do que o webhook já guardou na caixa):
--   insert into public.whatsapp_conversas (telefone, primeira_em, ultima_em)
--   select telefone, min(recebido_em), max(recebido_em)
--     from public.emails_triagem
--    where canal = 'whatsapp' and telefone ~ '^[0-9]{12,15}$'
--    group by telefone
--   on conflict (telefone) do nothing;
--   -- atenção: a 066 deixa authenticated inserir na caixa; confira a lista
--   -- antes, se houver dúvida sobre linhas criadas pelo app.
--
-- VERIFICAR:
--   select relrowsecurity from pg_class where oid = 'public.whatsapp_conversas'::regclass;
--   -- esperado: true
--   select count(*) from pg_policies where tablename = 'whatsapp_conversas';
--   -- esperado: 0
--
-- REVERTER (o responder volta a recusar tudo até o código antigo ser publicado):
--   drop table if exists public.whatsapp_conversas;
--
-- RLS: tabela nova sem policy, de propósito. Não há team: o número é da
-- empresa, não de uma equipe. Risco que sobra: operador de uma equipe consegue
-- responder a um número que só falou com outra equipe, se gravar esse número
-- num chamado seu. Fechar isso exigiria guardar a team aqui também.
-- ============================================================

create table if not exists public.whatsapp_conversas (
  telefone    text primary key,
  primeira_em timestamptz not null default now(),
  ultima_em   timestamptz not null default now()
);

alter table public.whatsapp_conversas enable row level security;
