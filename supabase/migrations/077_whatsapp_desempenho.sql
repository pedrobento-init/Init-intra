-- ============================================================
-- Migration 077: webhook do WhatsApp sem varrer clientes e sem regravar notas
-- ============================================================
-- Duas coisas que o webhook (supabase/functions/whatsapp/) fazia de um jeito
-- que só funciona com pouco volume:
--
--   1. Para casar o remetente com o cliente, lia a tabela clients INTEIRA (de
--      1000 em 1000) a cada mensagem sem chamado aberto e comparava em
--      TypeScript. Não dava índice simples porque o cadastro guarda o telefone
--      de todo jeito ("(11) 98765-4321", "+55 11 ...", sem o nono dígito).
--   2. Para anexar a mensagem ao chamado aberto, lia o array notes, somava a
--      nota e regravava o array todo. Duas mensagens do mesmo número chegando
--      juntas (o cliente manda "oi" e logo o pedido) liam o mesmo array, e a
--      segunda gravação apagava a nota da primeira.
--
-- O que muda:
--   * telefone_chave(text): a MESMA regra de chaveTelefone() em
--     supabase/functions/whatsapp/mensagem.ts (DDD + 8 últimos dígitos, sem o
--     55), em SQL e IMMUTABLE para poder ir em índice. Devolve NULL quando o
--     número é curto demais, para não entrar no índice nem casar com nada.
--     tests/whatsapp-desempenho-077.test.js compara as duas versões.
--   * índices de expressão em clients (owner_phone e responsible_phone).
--   * clientes_do_telefone(p_chave): os clientes cuja chave bate, pelos
--     índices. A regra de ambiguidade (dois clientes com o mesmo número) segue
--     no TypeScript, que recebe só as linhas candidatas.
--   * append_pendencia_note(p_id, p_team, p_nota): soma a nota no array num
--     único UPDATE, que o Postgres serializa por linha. Filtra por id E team,
--     como o update antigo: se o chamado mudou de equipe no meio, não grava.
--     Devolve true quando gravou.
--
-- Quem chama é só o webhook, com service_role. As duas funções que leem ou
-- gravam dado são SECURITY INVOKER e sem EXECUTE para anon/authenticated (como
-- a 023 fez com as RPCs antigas): pelo PostgREST, um operador não lista
-- clientes de outra equipe pelo telefone nem anexa nota fora do RLS.
-- telefone_chave fica liberada para authenticated porque é cálculo puro e o
-- índice a avalia em todo insert/update de clients feito pelo app.
--
-- Enquanto esta migration não for aplicada, o webhook percebe que as funções
-- não existem e volta ao caminho antigo (varredura e ler-e-regravar), com uma
-- linha no log. Nada para de funcionar.
--
-- Idempotente.
--
-- VERIFICAR:
--   select public.telefone_chave('(11) 98765-4321'),   -- 1187654321
--          public.telefone_chave('5511987654321'),     -- 1187654321
--          public.telefone_chave('1234');              -- NULL
--   select indexname from pg_indexes
--    where tablename = 'clients' and indexname like 'clients_%_phone_chave_idx';
--   -- esperado: 2 linhas
--   select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as authenticated
--     from pg_proc p
--    where p.pronamespace = 'public'::regnamespace
--      and p.proname in ('telefone_chave', 'clientes_do_telefone', 'append_pendencia_note');
--   -- esperado: telefone_chave true; as outras duas false
--
-- REVERTER (o webhook volta sozinho ao caminho antigo):
--   drop function if exists public.append_pendencia_note(text, text, jsonb);
--   drop function if exists public.clientes_do_telefone(text);
--   drop index if exists public.clients_owner_phone_chave_idx;
--   drop index if exists public.clients_responsible_phone_chave_idx;
--   drop function if exists public.telefone_chave(text);
--
-- RLS: nenhuma policy nova ou alterada.
-- ============================================================

create or replace function public.telefone_chave(bruto text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case when length(s.d) < 10 then null else left(s.d, 2) || right(s.d, 8) end
    from (
      select case when length(t.d) > 11 and left(t.d, 2) = '55' then substr(t.d, 3) else t.d end as d
        from (select regexp_replace(coalesce(bruto, ''), '[^0-9]', '', 'g') as d) t
    ) s
$$;

revoke all on function public.telefone_chave(text) from public, anon;
grant execute on function public.telefone_chave(text) to authenticated, service_role;

create index if not exists clients_owner_phone_chave_idx
  on public.clients (public.telefone_chave(owner_phone));
create index if not exists clients_responsible_phone_chave_idx
  on public.clients (public.telefone_chave(responsible_phone));

create or replace function public.clientes_do_telefone(p_chave text)
returns setof public.clients
language sql
stable
security invoker
set search_path = ''
as $$
  -- Teto de 5: o webhook só precisa saber se é um, nenhum ou mais de um.
  select c.*
    from public.clients c
   where public.telefone_chave(c.owner_phone) = p_chave
      or public.telefone_chave(c.responsible_phone) = p_chave
   limit 5
$$;

revoke all on function public.clientes_do_telefone(text) from public, anon, authenticated;
grant execute on function public.clientes_do_telefone(text) to service_role;

create or replace function public.append_pendencia_note(p_id text, p_team text, p_nota jsonb)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
  with gravou as (
    update public.pendencias
       set notes = (case when jsonb_typeof(notes) = 'array' then notes else '[]'::jsonb end)
                   || jsonb_build_array(p_nota),
           updated_at = now()
     where id = p_id
       and team is not distinct from p_team
       and jsonb_typeof(p_nota) = 'object'
    returning 1
  )
  select exists (select 1 from gravou)
$$;

revoke all on function public.append_pendencia_note(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.append_pendencia_note(text, text, jsonb) to service_role;
