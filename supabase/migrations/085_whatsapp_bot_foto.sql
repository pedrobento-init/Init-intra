-- ============================================================
-- Migration 085: atendimento automático do WhatsApp e foto do contato
-- ============================================================
-- O webhook do WhatsApp passa a (a) mandar o menu de departamentos e atribuir a
-- conversa conforme a escolha e (b) guardar a foto de perfil do contato para a
-- Caixa de entrada mostrar.
--
-- O que muda:
--   * whatsapp_conversas ganha o estado do bot por número: bot_etapa
--     ('aguardando_setor' ou 'atribuido'), bot_setor, bot_tentativas,
--     bot_protocolo e bot_em; e a foto: foto_url e foto_em. A tabela segue sem
--     policy (076): só o service_role lê e grava, então o operador não forja o
--     estado do bot nem a prova de que o número falou com a empresa.
--   * emails_triagem ganha foto_url, para a tela ler a foto junto com a
--     mensagem. A coluna recebe só https (CHECK), porque vai parar num
--     <img src> de quem atende.
--
-- O robô só responde com o secret WHATSAPP_BOT_ATIVO=1 (ver WHATSAPP.md). Sem a
-- migration, o webhook ignora o bot e a foto e segue como antes: a mensagem
-- nunca deixa de chegar na caixa por causa de coluna que não existe.
--
-- Aplicar no SQL Editor depois da 082. Idempotente.
--
-- VERIFICAR:
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'whatsapp_conversas'
--      and (column_name like 'bot\_%' or column_name like 'foto\_%');
--   -- esperado: bot_etapa, bot_setor, bot_tentativas, bot_protocolo, bot_em,
--   --           foto_url, foto_em (7 linhas, de whatsapp_conversas)
--   select column_name from information_schema.columns
--    where table_name = 'emails_triagem' and column_name = 'foto_url';
--   -- esperado: 1 linha
--   select count(*) from pg_policies where tablename = 'whatsapp_conversas';
--   -- esperado: 0
--
-- REVERTER (o app volta a mostrar só iniciais; o webhook volta a só gravar):
--   alter table public.emails_triagem drop constraint if exists emails_triagem_foto_https;
--   alter table public.emails_triagem drop column if exists foto_url;
--   alter table public.whatsapp_conversas
--     drop column if exists bot_etapa,    drop column if exists bot_setor,
--     drop column if exists bot_tentativas, drop column if exists bot_protocolo,
--     drop column if exists bot_em,       drop column if exists foto_url,
--     drop column if exists foto_em;
--
-- RLS: nenhuma policy nova. whatsapp_conversas continua fechada para
-- authenticated e anon; emails_triagem mantém as policies por equipe da 066, e
-- a coluna nova só é lida junto com a linha que o operador já enxerga.
-- ============================================================

alter table public.whatsapp_conversas
  add column if not exists bot_etapa      text,
  add column if not exists bot_setor      text,
  add column if not exists bot_tentativas integer not null default 0,
  add column if not exists bot_protocolo  text,
  add column if not exists bot_em         timestamptz,
  add column if not exists foto_url       text,
  add column if not exists foto_em        timestamptz;

alter table public.whatsapp_conversas drop constraint if exists whatsapp_conversas_bot_etapa_check;
alter table public.whatsapp_conversas
  add constraint whatsapp_conversas_bot_etapa_check
  check (bot_etapa is null or bot_etapa in ('aguardando_setor', 'atribuido'));

alter table public.whatsapp_conversas drop constraint if exists whatsapp_conversas_bot_setor_check;
alter table public.whatsapp_conversas
  add constraint whatsapp_conversas_bot_setor_check
  check (bot_setor is null or bot_setor in ('suporte', 'comercial', 'poiesis'));

alter table public.emails_triagem add column if not exists foto_url text;

alter table public.emails_triagem drop constraint if exists emails_triagem_foto_https;
alter table public.emails_triagem
  add constraint emails_triagem_foto_https
  check (foto_url is null or (foto_url ~ '^https://[^[:space:]"''<>]+$' and length(foto_url) <= 1000));
