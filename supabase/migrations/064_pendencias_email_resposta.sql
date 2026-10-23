-- ============================================================
-- Migration 064: responder ao solicitante por e-mail, na mesma conversa
-- ============================================================
-- A triagem (robo/campo.ts) já abre pendência a partir do e-mail do cliente.
-- Faltava o caminho de volta. Pendência ganha:
-- - solicitante_email .. endereço de quem pediu. É o ÚNICO destinatário que a
--                        function pendencia-responder aceita: o app nunca
--                        escolhe para quem manda, só qual chamado responde.
-- - email_message_id ... o Message-ID (cabeçalho RFC 5322) do e-mail que abriu
--                        a pendência. Vai como In-Reply-To/References na
--                        resposta, e é só por isso que a resposta cai na mesma
--                        conversa na caixa do cliente em vez de começar outra.
--
-- Sem estas colunas o app segue igual: são optionalFields em js/schema.js, e
-- sem endereço o botão de responder por e-mail simplesmente não aparece.
-- RLS: as policies de pendencias (042/055) já cobrem as colunas novas.
-- Depois da 063. Idempotente.
--
-- VERIFICAR:
--   select column_name from information_schema.columns
--    where table_name = 'pendencias'
--      and column_name in ('solicitante_email', 'email_message_id');
--   -- esperado: 2 linhas
--
-- ROLLBACK:
--   alter table public.pendencias drop column if exists solicitante_email;
--   alter table public.pendencias drop column if exists email_message_id;
-- ============================================================

ALTER TABLE public.pendencias ADD COLUMN IF NOT EXISTS solicitante_email TEXT;
ALTER TABLE public.pendencias ADD COLUMN IF NOT EXISTS email_message_id TEXT;

COMMENT ON COLUMN public.pendencias.solicitante_email IS
  'E-mail de quem pediu. Único destinatário aceito por pendencia-responder.';
COMMENT ON COLUMN public.pendencias.email_message_id IS
  'Message-ID do e-mail que abriu a pendência; vira In-Reply-To na resposta.';
