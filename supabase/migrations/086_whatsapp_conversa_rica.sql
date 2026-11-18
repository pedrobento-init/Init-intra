-- ============================================================
-- Migration 086: WhatsApp — recibo de leitura, resposta citando e reações
-- ============================================================
-- A conversa do WhatsApp na Caixa de entrada passa a mostrar o que qualquer
-- plataforma de atendimento mostra: se a mensagem chegou e foi lida (✓, ✓✓,
-- ✓✓ azul), a mensagem que a pessoa respondeu citando e as reações (👍 ❤️).
--
-- O que muda em emails_triagem:
--   * ack — recibo da mensagem que NÓS mandamos, como o WAHA informa:
--     -1 erro, 0 pendente, 1 servidor, 2 entregue, 3 lida, 4 ouvida (áudio).
--     O webhook (evento message.ack) grava; o trigger abaixo impede o valor
--     de voltar atrás quando o WAHA entrega os eventos fora de ordem.
--   * citacao — a mensagem citada: {"id": "<message_id do WAHA>",
--     "texto": "...", "autor": "..."}. Só exibição; o texto é limitado no
--     servidor e escapado na tela.
--   * reacao_contato / reacao_equipe — a reação de cada lado sobre a mensagem
--     (um emoji, ou null quando a pessoa tirou a reação).
--   * índice em message_id (só WhatsApp): é por ele que o recibo e a reação
--     acham a linha.
--
-- Sem a migration o webhook segue gravando as mensagens; só os recibos e as
-- reações são ignorados (ficam no log como coluna ausente).
--
-- Aplicar no SQL Editor depois da 085. Idempotente.
--
-- VERIFICAR:
--   select column_name from information_schema.columns
--    where table_name = 'emails_triagem'
--      and column_name in ('ack', 'citacao', 'reacao_contato', 'reacao_equipe');
--   -- esperado: 4 linhas
--   select tgname from pg_trigger where tgname = 'emails_triagem_ack_so_avanca';
--   -- esperado: 1 linha
--   -- O ack não volta atrás:
--   --   update emails_triagem set ack = 3 where id = '<id de teste>';
--   --   update emails_triagem set ack = 2 where id = '<id de teste>';
--   --   select ack from emails_triagem where id = '<id de teste>';  -- 3
--
-- REVERTER (a conversa volta a mostrar só as bolhas, sem ✓ nem reações):
--   drop trigger if exists emails_triagem_ack_so_avanca on public.emails_triagem;
--   drop function if exists public.emails_triagem_ack_so_avanca();
--   drop index if exists public.emails_triagem_whatsapp_message_id_idx;
--   alter table public.emails_triagem
--     drop constraint if exists emails_triagem_ack_check,
--     drop constraint if exists emails_triagem_reacoes_check,
--     drop column if exists ack,
--     drop column if exists citacao,
--     drop column if exists reacao_contato,
--     drop column if exists reacao_equipe;
--
-- RLS: nenhuma policy nova. As colunas são lidas junto com a linha que o
-- operador já enxerga (policies por equipe da 066); quem grava recibo e reação
-- do contato é o webhook, com service role.
-- ============================================================

alter table public.emails_triagem
  add column if not exists ack            smallint,
  add column if not exists citacao        jsonb,
  add column if not exists reacao_contato text,
  add column if not exists reacao_equipe  text;

alter table public.emails_triagem drop constraint if exists emails_triagem_ack_check;
alter table public.emails_triagem
  add constraint emails_triagem_ack_check check (ack is null or ack between -1 and 4);

-- Reação é um emoji: curta, sem espaço nem marcação. Vai para a tela escapada
-- de qualquer jeito, mas o CHECK impede usar a coluna para guardar texto.
alter table public.emails_triagem drop constraint if exists emails_triagem_reacoes_check;
alter table public.emails_triagem
  add constraint emails_triagem_reacoes_check check (
    (reacao_contato is null or (char_length(reacao_contato) <= 16 and reacao_contato !~ '[[:space:]<>"'']'))
    and (reacao_equipe is null or (char_length(reacao_equipe) <= 16 and reacao_equipe !~ '[[:space:]<>"'']'))
  );

create index if not exists emails_triagem_whatsapp_message_id_idx
  on public.emails_triagem (message_id)
  where canal = 'whatsapp' and message_id is not null;

-- O WAHA não garante a ordem dos eventos: "entregue" pode chegar depois de
-- "lida". Erro (-1) só entra enquanto a mensagem não foi entregue: depois de
-- lida, um erro atrasado é ruído.
create or replace function public.emails_triagem_ack_so_avanca()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.ack is not null and new.ack is distinct from old.ack then
    if new.ack is null then
      new.ack := old.ack;
    elsif new.ack = -1 then
      if old.ack >= 2 then new.ack := old.ack; end if;
    elsif new.ack < old.ack and old.ack <> -1 then
      new.ack := old.ack;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists emails_triagem_ack_so_avanca on public.emails_triagem;
create trigger emails_triagem_ack_so_avanca
  before update of ack on public.emails_triagem
  for each row execute function public.emails_triagem_ack_so_avanca();
