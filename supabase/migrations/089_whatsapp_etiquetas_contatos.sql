-- ============================================================
-- Migration 089: etiquetas, contatos e envio ativo do WhatsApp
-- ============================================================
-- A Caixa (js/caixa-entrada.js) agrupa o WhatsApp por telefone, mas até aqui
-- não havia onde guardar nada sobre a CONVERSA: cada mensagem é uma linha de
-- emails_triagem, e etiqueta posta numa mensagem sumia quando o cliente
-- mandava a próxima. Esta migration cria o que mora na conversa (telefone +
-- equipe), e não na mensagem.
--
-- O que muda:
--   * whatsapp_etiquetas: cadastro por equipe (nome + cor de uma paleta fixa).
--     A cor é CHECK numa lista fechada, porque vai parar num data-sty de quem
--     atende: texto livre ali seria CSS de terceiro na tela.
--   * whatsapp_conversa_etiquetas: etiqueta aplicada a uma conversa. O
--     telefone é a CHAVE normalizada (a mesma de
--     chamadoTelefoneChave() no app: sem o 55 e sem o nono dígito), para
--     "5511987654321" e "(11) 8765-4321" serem a mesma conversa. A etiqueta tem
--     de ser da mesma equipe da linha (policy), senão uma equipe marcaria
--     conversa com etiqueta de outra.
--   * whatsapp_contatos: nome de exibição do contato, por equipe e telefone
--     (chave). Só o nome: a prova de que o número falou com a empresa continua
--     sendo a whatsapp_conversas (076), que o operador não grava. Telefone é
--     a mesma chave da tabela anterior.
--   * whatsapp_envios_ativos: cada conversa iniciada pela empresa (Edge
--     Function whatsapp-iniciar). SEM policy, como a 076: só o service_role lê
--     e grava, então o operador não apaga o próprio histórico para furar o
--     limite por hora. Sem esta tabela a function recusa todo envio ativo
--     (fail-closed), com o code migration_missing.
--   * As três tabelas da equipe entram na publicação do realtime, para a
--     etiqueta posta por um colega aparecer sem recarregar.
--
-- Banco sem esta migration: o app trata as três tabelas como opcionais
-- (js/schema.js), a Caixa segue igual, só sem etiquetas e nomes editados.
--
-- Aplicar no SQL Editor depois da 088. Idempotente.
--
-- VERIFICAR:
--   select relname, relrowsecurity from pg_class
--    where relname in ('whatsapp_etiquetas', 'whatsapp_conversa_etiquetas',
--                      'whatsapp_contatos', 'whatsapp_envios_ativos');
--   -- esperado: 4 linhas, todas true
--   select tablename, count(*) from pg_policies
--    where tablename like 'whatsapp\_%' group by tablename order by 1;
--   -- esperado: whatsapp_contatos 4, whatsapp_conversa_etiquetas 4,
--   --           whatsapp_etiquetas 4 (whatsapp_envios_ativos e
--   --           whatsapp_conversas não aparecem: zero policy)
--   select tablename from pg_publication_tables
--    where pubname = 'supabase_realtime' and tablename like 'whatsapp\_%';
--   -- esperado: as três tabelas da equipe
--
-- REVERTER (o app volta a não ter etiquetas; o envio ativo passa a recusar):
--   drop table if exists public.whatsapp_conversa_etiquetas;
--   drop table if exists public.whatsapp_etiquetas;
--   drop table if exists public.whatsapp_contatos;
--   drop table if exists public.whatsapp_envios_ativos;
--   (drop table já tira a tabela da publicação do realtime)
--
-- RLS: as três tabelas da equipe seguem o padrão da 074 (admin vê tudo, os
-- demais só a própria team). whatsapp_envios_ativos fica fechada para
-- authenticated e anon.
-- ============================================================

create table if not exists public.whatsapp_etiquetas (
  id          text primary key,
  nome        text not null check (length(btrim(nome)) between 1 and 40),
  -- Mesma lista de WETQ_CORES em js/whatsapp-etiquetas.js; o teste
  -- tests/whatsapp-etiquetas.test.js confere que as duas batem.
  cor         text not null default 'azul'
              check (cor in ('azul', 'verde', 'amarelo', 'laranja', 'vermelho', 'roxo', 'rosa', 'cinza')),
  team        text not null default 'init',
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Duas "Financeiro" na mesma equipe deixariam o filtro ambíguo.
create unique index if not exists whatsapp_etiquetas_team_nome_uidx
  on public.whatsapp_etiquetas (team, lower(btrim(nome)));

create table if not exists public.whatsapp_conversa_etiquetas (
  id           text primary key,
  telefone     text not null check (telefone ~ '^[0-9]{10,20}$'),
  etiqueta_id  text not null references public.whatsapp_etiquetas (id) on delete cascade,
  team         text not null default 'init',
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index if not exists whatsapp_conversa_etiquetas_uidx
  on public.whatsapp_conversa_etiquetas (team, telefone, etiqueta_id);
create index if not exists whatsapp_conversa_etiquetas_etiqueta_idx
  on public.whatsapp_conversa_etiquetas (etiqueta_id);

create table if not exists public.whatsapp_contatos (
  id          text primary key,
  telefone    text not null check (telefone ~ '^[0-9]{10,20}$'),
  nome        text not null check (length(btrim(nome)) between 1 and 80),
  team        text not null default 'init',
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists whatsapp_contatos_team_telefone_uidx
  on public.whatsapp_contatos (team, telefone);

create table if not exists public.whatsapp_envios_ativos (
  id           bigint generated always as identity primary key,
  operador_id  text not null,
  team         text not null,
  telefone     text not null,
  criado_em    timestamptz not null default now()
);

-- O limite conta "deste operador na última hora" e "desta equipe na última
-- hora": os dois índices servem exatamente essas duas contagens.
create index if not exists whatsapp_envios_ativos_operador_idx
  on public.whatsapp_envios_ativos (operador_id, criado_em desc);
create index if not exists whatsapp_envios_ativos_team_idx
  on public.whatsapp_envios_ativos (team, criado_em desc);

alter table public.whatsapp_etiquetas enable row level security;
alter table public.whatsapp_conversa_etiquetas enable row level security;
alter table public.whatsapp_contatos enable row level security;
alter table public.whatsapp_envios_ativos enable row level security;

grant select, insert, update, delete on public.whatsapp_etiquetas to authenticated;
grant select, insert, update, delete on public.whatsapp_conversa_etiquetas to authenticated;
grant select, insert, update, delete on public.whatsapp_contatos to authenticated;
revoke all on public.whatsapp_envios_ativos from anon, authenticated;

-- ---- whatsapp_etiquetas ------------------------------------------------------
drop policy if exists whatsapp_etiquetas_select on public.whatsapp_etiquetas;
drop policy if exists whatsapp_etiquetas_insert on public.whatsapp_etiquetas;
drop policy if exists whatsapp_etiquetas_update on public.whatsapp_etiquetas;
drop policy if exists whatsapp_etiquetas_delete on public.whatsapp_etiquetas;

create policy whatsapp_etiquetas_select on public.whatsapp_etiquetas for select to authenticated
  using ((select public.current_op_is_admin()) or coalesce(team, 'init') = (select public.current_op_team()));
create policy whatsapp_etiquetas_insert on public.whatsapp_etiquetas for insert to authenticated
  with check ((select public.current_op_is_admin()) or coalesce(team, 'init') = (select public.current_op_team()));
create policy whatsapp_etiquetas_update on public.whatsapp_etiquetas for update to authenticated
  using ((select public.current_op_is_admin()) or coalesce(team, 'init') = (select public.current_op_team()))
  with check ((select public.current_op_is_admin()) or coalesce(team, 'init') = (select public.current_op_team()));
create policy whatsapp_etiquetas_delete on public.whatsapp_etiquetas for delete to authenticated
  using ((select public.current_op_is_admin()) or coalesce(team, 'init') = (select public.current_op_team()));

-- ---- whatsapp_conversa_etiquetas --------------------------------------------
-- A escrita confere também a equipe da ETIQUETA: sem isso o operador (ou o
-- admin por engano) grudaria a etiqueta de uma equipe na conversa de outra.
drop policy if exists whatsapp_conversa_etiquetas_select on public.whatsapp_conversa_etiquetas;
drop policy if exists whatsapp_conversa_etiquetas_insert on public.whatsapp_conversa_etiquetas;
drop policy if exists whatsapp_conversa_etiquetas_update on public.whatsapp_conversa_etiquetas;
drop policy if exists whatsapp_conversa_etiquetas_delete on public.whatsapp_conversa_etiquetas;

create policy whatsapp_conversa_etiquetas_select on public.whatsapp_conversa_etiquetas for select to authenticated
  using ((select public.current_op_is_admin()) or coalesce(team, 'init') = (select public.current_op_team()));
create policy whatsapp_conversa_etiquetas_insert on public.whatsapp_conversa_etiquetas for insert to authenticated
  with check (
    ((select public.current_op_is_admin()) or coalesce(team, 'init') = (select public.current_op_team()))
    and exists (
      select 1 from public.whatsapp_etiquetas e
       where e.id = etiqueta_id and e.team = whatsapp_conversa_etiquetas.team
    )
  );
create policy whatsapp_conversa_etiquetas_update on public.whatsapp_conversa_etiquetas for update to authenticated
  using ((select public.current_op_is_admin()) or coalesce(team, 'init') = (select public.current_op_team()))
  with check (
    ((select public.current_op_is_admin()) or coalesce(team, 'init') = (select public.current_op_team()))
    and exists (
      select 1 from public.whatsapp_etiquetas e
       where e.id = etiqueta_id and e.team = whatsapp_conversa_etiquetas.team
    )
  );
create policy whatsapp_conversa_etiquetas_delete on public.whatsapp_conversa_etiquetas for delete to authenticated
  using ((select public.current_op_is_admin()) or coalesce(team, 'init') = (select public.current_op_team()));

-- ---- whatsapp_contatos -------------------------------------------------------
drop policy if exists whatsapp_contatos_select on public.whatsapp_contatos;
drop policy if exists whatsapp_contatos_insert on public.whatsapp_contatos;
drop policy if exists whatsapp_contatos_update on public.whatsapp_contatos;
drop policy if exists whatsapp_contatos_delete on public.whatsapp_contatos;

create policy whatsapp_contatos_select on public.whatsapp_contatos for select to authenticated
  using ((select public.current_op_is_admin()) or coalesce(team, 'init') = (select public.current_op_team()));
create policy whatsapp_contatos_insert on public.whatsapp_contatos for insert to authenticated
  with check ((select public.current_op_is_admin()) or coalesce(team, 'init') = (select public.current_op_team()));
create policy whatsapp_contatos_update on public.whatsapp_contatos for update to authenticated
  using ((select public.current_op_is_admin()) or coalesce(team, 'init') = (select public.current_op_team()))
  with check ((select public.current_op_is_admin()) or coalesce(team, 'init') = (select public.current_op_team()));
create policy whatsapp_contatos_delete on public.whatsapp_contatos for delete to authenticated
  using ((select public.current_op_is_admin()) or coalesce(team, 'init') = (select public.current_op_team()));

-- whatsapp_envios_ativos: nenhuma policy, de propósito (ver cabeçalho).

do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['whatsapp_etiquetas', 'whatsapp_conversa_etiquetas', 'whatsapp_contatos'] loop
      if not exists (
        select 1 from pg_publication_tables
         where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

comment on table public.whatsapp_etiquetas is
  'Etiquetas de conversa do WhatsApp, por equipe. Cor de uma paleta fixa (CHECK).';
comment on table public.whatsapp_conversa_etiquetas is
  'Etiqueta aplicada a uma conversa do WhatsApp: telefone (chave normalizada) + equipe.';
comment on table public.whatsapp_contatos is
  'Nome de exibição do contato do WhatsApp, por equipe e telefone (chave normalizada).';
comment on table public.whatsapp_envios_ativos is
  'Conversas iniciadas pela empresa (whatsapp-iniciar). Só service_role; base do limite por hora.';
