-- ============================================================
-- Migration 087: filas do WhatsApp por departamento e distribuição automática
-- ============================================================
-- Até a 085 a conversa que o robô atribuía caía na equipe e esperava alguém
-- clicar em "Assumir". Com volume, isso vira disputa (dois respondendo o mesmo
-- cliente) ou abandono (cada um achando que o outro pegou). Esta migration dá
-- a base para a Caixa trabalhar como fila (ver WHATSAPP.md, "Filas e rodízio").
--
-- O que muda:
--   * emails_triagem.departamento ('suporte', 'comercial', 'poiesis' ou NULL):
--     o departamento que o cliente escolheu no menu, gravado pelo webhook nas
--     mensagens da conversa. É o que separa as filas na Caixa.
--   * whatsapp_filas_config (uma linha por equipe): rodízio ligado/desligado e
--     limite de atendimentos simultâneos por operador. Só admin grava.
--   * whatsapp_atendentes (equipe + nome do operador): quem entra no rodízio,
--     de quais departamentos, limite próprio (opcional) e o sinal de vida que o
--     app manda a cada minuto (disponivel, visto_em). Admin grava a
--     configuração; o próprio operador só mexe no sinal de vida, pela função
--     whatsapp_atendente_ping.
--   * whatsapp_atribuir_se_livre(team, telefone, operador): atribui a conversa
--     só se ninguém estiver com ela, com trava por conversa
--     (pg_advisory_xact_lock). É o que o rodízio do webhook usa.
--   * whatsapp_pegar_proximo(departamento, team): o "Pegar próximo" da Caixa —
--     a conversa mais antiga da fila vai para quem chamou. Dois operadores
--     clicando juntos não pegam a mesma: a trava acima serializa, e o segundo
--     cai na conversa seguinte.
--
-- "Com responsável" = alguma mensagem do cliente ainda aberta (pendente ou
-- anexado) tem atribuido_a. Conversa encerrada fecha o ciclo: a mensagem
-- seguinte do número volta para a fila.
--
-- Sem esta migration o webhook grava a mensagem como antes e só registra um
-- aviso; a Caixa esconde o botão de pegar e a configuração.
--
-- Aplicar no SQL Editor depois da 085. Idempotente.
--
-- VERIFICAR:
--   select column_name from information_schema.columns
--    where table_name = 'emails_triagem' and column_name = 'departamento';
--   -- esperado: 1 linha
--   select tablename, count(*) from pg_policies
--    where tablename in ('whatsapp_filas_config', 'whatsapp_atendentes')
--    group by tablename;
--   -- esperado: 4 policies em cada
--   select proname, prosecdef from pg_proc
--    where proname in ('whatsapp_atribuir_se_livre', 'whatsapp_pegar_proximo',
--                      'whatsapp_atendente_ping');
--   -- esperado: 3 linhas; prosecdef = false nas duas primeiras (RLS do
--   -- operador vale) e true só no ping (grava só a linha de quem chamou)
--   select public.whatsapp_pegar_proximo();  -- logado no app: NULL com fila vazia
--
-- REVERTER (o app volta à atribuição manual; o webhook só registra aviso):
--   drop function if exists public.whatsapp_pegar_proximo(text, text);
--   drop function if exists public.whatsapp_atribuir_se_livre(text, text, text);
--   drop function if exists public.whatsapp_atendente_ping(boolean);
--   drop table if exists public.whatsapp_atendentes;
--   drop table if exists public.whatsapp_filas_config;
--   drop index if exists public.emails_triagem_fila_idx;
--   drop index if exists public.emails_triagem_responsavel_idx;
--   alter table public.emails_triagem drop constraint if exists emails_triagem_departamento_check;
--   alter table public.emails_triagem drop column if exists departamento;
--
-- RLS: emails_triagem mantém as policies por equipe da 066 (a coluna nova é
-- lida e gravada junto com a linha). As duas tabelas novas: leitura para quem
-- vê a equipe (admin vê todas), escrita só de admin. As funções de atribuir e
-- pegar são SECURITY INVOKER: rodam com a RLS de quem chamou, então um
-- operador não pega nem atribui conversa de outra equipe.
-- ============================================================

-- ── Departamento na mensagem ───────────────────────────────────────────────
alter table public.emails_triagem add column if not exists departamento text;

alter table public.emails_triagem drop constraint if exists emails_triagem_departamento_check;
alter table public.emails_triagem
  add constraint emails_triagem_departamento_check
  check (departamento is null or departamento in ('suporte', 'comercial', 'poiesis'));

-- A fila: pendente do WhatsApp sem dono, por equipe, da mais antiga.
create index if not exists emails_triagem_fila_idx
  on public.emails_triagem (team, recebido_em)
  where canal = 'whatsapp' and status = 'pendente' and atribuido_a is null;

-- Contagem de atendimentos abertos por operador (limite do rodízio).
create index if not exists emails_triagem_responsavel_idx
  on public.emails_triagem (team, atribuido_a, telefone)
  where canal = 'whatsapp' and atribuido_a is not null and status in ('pendente', 'anexado');

-- ── Configuração por equipe ────────────────────────────────────────────────
create table if not exists public.whatsapp_filas_config (
  team               text primary key,
  -- Desligado por padrão: ligar o rodízio muda quem recebe o quê, e isso é
  -- decisão de quem coordena a equipe, não efeito colateral de migration.
  rodizio_ativo      boolean not null default false,
  limite_simultaneo  integer not null default 5
                     check (limite_simultaneo between 1 and 100),
  updated_by         text,
  updated_at         timestamptz not null default now()
);

alter table public.whatsapp_filas_config enable row level security;
grant select, insert, update, delete on public.whatsapp_filas_config to authenticated;

drop policy if exists whatsapp_filas_config_select on public.whatsapp_filas_config;
drop policy if exists whatsapp_filas_config_insert on public.whatsapp_filas_config;
drop policy if exists whatsapp_filas_config_update on public.whatsapp_filas_config;
drop policy if exists whatsapp_filas_config_delete on public.whatsapp_filas_config;

create policy whatsapp_filas_config_select on public.whatsapp_filas_config for select to authenticated
  using ((select public.current_op_is_admin()) or coalesce(team, 'init') = (select public.current_op_team()));
create policy whatsapp_filas_config_insert on public.whatsapp_filas_config for insert to authenticated
  with check ((select public.current_op_is_admin()));
create policy whatsapp_filas_config_update on public.whatsapp_filas_config for update to authenticated
  using ((select public.current_op_is_admin()))
  with check ((select public.current_op_is_admin()));
create policy whatsapp_filas_config_delete on public.whatsapp_filas_config for delete to authenticated
  using ((select public.current_op_is_admin()));

-- ── Atendentes ─────────────────────────────────────────────────────────────
-- Por NOME, porque é o nome que emails_triagem.atribuido_a guarda (073).
create table if not exists public.whatsapp_atendentes (
  team                  text not null,
  operador              text not null,
  -- Vazio = atende todos os departamentos.
  departamentos         text[] not null default '{}'::text[]
                        check (departamentos <@ array['suporte', 'comercial', 'poiesis']::text[]),
  -- NULL = usa o limite da equipe.
  limite                integer check (limite is null or limite between 1 and 100),
  -- Fora por padrão: o ping cria a linha de todo operador que abre o app, e
  -- só quem o admin marcar entra no rodízio.
  recebe_rodizio        boolean not null default false,
  disponivel            boolean not null default false,
  visto_em              timestamptz,
  ultima_atribuicao_em  timestamptz,
  updated_at            timestamptz not null default now(),
  primary key (team, operador)
);

alter table public.whatsapp_atendentes enable row level security;
grant select, insert, update, delete on public.whatsapp_atendentes to authenticated;

drop policy if exists whatsapp_atendentes_select on public.whatsapp_atendentes;
drop policy if exists whatsapp_atendentes_insert on public.whatsapp_atendentes;
drop policy if exists whatsapp_atendentes_update on public.whatsapp_atendentes;
drop policy if exists whatsapp_atendentes_delete on public.whatsapp_atendentes;

create policy whatsapp_atendentes_select on public.whatsapp_atendentes for select to authenticated
  using ((select public.current_op_is_admin()) or coalesce(team, 'init') = (select public.current_op_team()));
create policy whatsapp_atendentes_insert on public.whatsapp_atendentes for insert to authenticated
  with check ((select public.current_op_is_admin()));
create policy whatsapp_atendentes_update on public.whatsapp_atendentes for update to authenticated
  using ((select public.current_op_is_admin()))
  with check ((select public.current_op_is_admin()));
create policy whatsapp_atendentes_delete on public.whatsapp_atendentes for delete to authenticated
  using ((select public.current_op_is_admin()));

-- ── Sinal de vida do operador ──────────────────────────────────────────────
-- SECURITY DEFINER porque a tabela só aceita escrita de admin; a função grava
-- exclusivamente a linha de quem chamou (nome e equipe saem de operators pelo
-- auth.uid(), nunca de parâmetro) e só as colunas de presença.
create or replace function public.whatsapp_atendente_ping(p_disponivel boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome text;
  v_team text;
begin
  select o.name, coalesce(o.team, 'init') into v_nome, v_team
    from public.operators o
   where o.auth_user_id = auth.uid() and coalesce(o.active, true) = true
   limit 1;
  if coalesce(v_nome, '') = '' then
    raise exception 'whatsapp_atendente_ping: operador não identificado' using errcode = '42501';
  end if;
  insert into public.whatsapp_atendentes as a (team, operador, disponivel, visto_em, updated_at)
  values (v_team, v_nome, coalesce(p_disponivel, false), now(), now())
  on conflict (team, operador) do update
    set disponivel = excluded.disponivel, visto_em = excluded.visto_em, updated_at = now();
end;
$$;

revoke all on function public.whatsapp_atendente_ping(boolean) from public, anon;
grant execute on function public.whatsapp_atendente_ping(boolean) to authenticated;

-- ── Atribuir se a conversa estiver livre ───────────────────────────────────
-- A trava é por conversa (equipe + telefone) e dura até o fim da transação de
-- quem chamou: o segundo a chegar espera, e quando entra já enxerga o nome que
-- o primeiro gravou (cada comando em READ COMMITTED lê o que já foi
-- confirmado). Só mensagens abertas recebem o nome: as de ciclos encerrados
-- ficam com quem atendeu na época.
create or replace function public.whatsapp_atribuir_se_livre(
  p_team text,
  p_telefone text,
  p_operador text
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_team text := coalesce(nullif(p_team, ''), 'init');
  v_n integer;
begin
  if coalesce(p_telefone, '') = '' or coalesce(trim(p_operador), '') = '' then
    return false;
  end if;
  -- Operador comum só atribui a si mesmo: a função está liberada para
  -- authenticated e, sem isto, dava para pôr conversa no nome de um colega
  -- (ou de um nome que nem existe). Admin distribui; o webhook (service role,
  -- sem auth.uid()) é quem faz o rodízio.
  if auth.uid() is not null
     and not coalesce(public.current_op_is_admin(), false)
     and lower(btrim(p_operador)) is distinct from lower(btrim(coalesce(public.current_op_name(), ''))) then
    raise exception 'whatsapp_atribuir_se_livre: só é possível atribuir a si mesmo'
      using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('whatsapp_fila:' || v_team || ':' || p_telefone, 0));
  if exists (
    select 1 from public.emails_triagem r
     where r.canal = 'whatsapp' and r.telefone = p_telefone
       and r.team = v_team
       and coalesce(r.direcao, 'entrada') = 'entrada'
       and r.status in ('pendente', 'anexado')
       and r.atribuido_a is not null
  ) then
    return false;
  end if;
  update public.emails_triagem r
     set atribuido_a = trim(p_operador), atribuido_em = now(), updated_at = now()
   where r.canal = 'whatsapp' and r.telefone = p_telefone
     and r.team = v_team
     and r.status in ('pendente', 'anexado')
     and r.atribuido_a is null;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

revoke all on function public.whatsapp_atribuir_se_livre(text, text, text) from public, anon;
grant execute on function public.whatsapp_atribuir_se_livre(text, text, text) to authenticated, service_role;

-- ── Pegar próximo ──────────────────────────────────────────────────────────
-- p_departamento: só aquela fila. NULL: os departamentos de quem chamou em
-- whatsapp_atendentes (lista vazia ou sem linha = todos), mais as conversas
-- sem departamento, que são de qualquer um. p_team NULL = equipe de quem
-- chamou. Devolve o telefone da conversa pega, ou NULL com a fila vazia.
-- O limite de simultâneos não vale aqui: pegar é decisão consciente de quem
-- clicou; o limite é para o que chega sem ninguém pedir.
create or replace function public.whatsapp_pegar_proximo(
  p_departamento text default null,
  p_team text default null
)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_nome text := public.current_op_name();
  v_team text := coalesce(nullif(p_team, ''), public.current_op_team(), 'init');
  v_deps text[];
  v_cand record;
begin
  if coalesce(v_nome, '') = '' then
    raise exception 'whatsapp_pegar_proximo: operador não identificado' using errcode = '42501';
  end if;
  if p_departamento is not null and p_departamento not in ('suporte', 'comercial', 'poiesis') then
    raise exception 'whatsapp_pegar_proximo: departamento inválido' using errcode = '22023';
  end if;
  if p_departamento is null then
    select a.departamentos into v_deps
      from public.whatsapp_atendentes a
     where a.team = v_team and a.operador = v_nome;
    if v_deps is not null and cardinality(v_deps) = 0 then
      v_deps := null;
    end if;
  end if;

  for v_cand in
    select e.telefone, min(coalesce(e.recebido_em, e.created_at)) as desde
      from public.emails_triagem e
     where e.canal = 'whatsapp' and e.status = 'pendente'
       and coalesce(e.direcao, 'entrada') = 'entrada'
       and e.team = v_team
       and coalesce(e.telefone, '') <> ''
       and e.atribuido_a is null
       and case
             when p_departamento is not null then e.departamento is not distinct from p_departamento
             when v_deps is null then true
             else e.departamento is null or e.departamento = any (v_deps)
           end
       and not exists (
         select 1 from public.emails_triagem r
          where r.canal = 'whatsapp' and r.telefone = e.telefone
            and r.team = v_team
            and coalesce(r.direcao, 'entrada') = 'entrada'
            and r.status in ('pendente', 'anexado')
            and r.atribuido_a is not null
       )
     group by e.telefone
     order by desde asc, e.telefone
     limit 25
  loop
    if public.whatsapp_atribuir_se_livre(v_team, v_cand.telefone, v_nome) then
      return v_cand.telefone;
    end if;
  end loop;
  return null;
end;
$$;

revoke all on function public.whatsapp_pegar_proximo(text, text) from public, anon;
-- A função lê o nome de quem chamou por current_op_name() (042). A policy de
-- audit_logs já depende dele; o grant explícito só tira a dúvida.
grant execute on function public.current_op_name() to authenticated;
grant execute on function public.whatsapp_pegar_proximo(text, text) to authenticated;

comment on table public.whatsapp_filas_config is
  'Filas do WhatsApp por equipe: rodízio ligado/desligado e limite de atendimentos simultâneos (087).';
comment on table public.whatsapp_atendentes is
  'Quem atende o WhatsApp no rodízio, de quais departamentos, e o sinal de vida do app (087).';
