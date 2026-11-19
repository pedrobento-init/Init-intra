-- ============================================================
-- Migration 088: automação do atendimento por WhatsApp (leva 3)
-- ============================================================
-- Horário de atendimento, saudação, encerramento, pesquisa de satisfação
-- (CSAT 1 a 5) e encerramento por inatividade, configurados POR EQUIPE. A regra
-- está em supabase/functions/whatsapp/automacao.ts; o passo a passo, na seção 12
-- do WHATSAPP.md.
--
-- O QUE MUDA:
--   * Tabela nova whatsapp_automacao: uma linha por equipe com o que está
--     ligado e os textos. Tudo nasce DESLIGADO (default false) e equipe sem
--     linha vale "tudo desligado": nenhuma mensagem automática sai antes de um
--     admin configurar. Lê quem é da equipe (ou admin); grava só admin.
--   * Tabela nova whatsapp_avaliacoes: a nota que o contato deu depois do
--     encerramento. Lê quem é da equipe (ou admin). NINGUÉM grava pelo app: só
--     o webhook, com service role — nota de satisfação forjada pelo navegador
--     não vale nada.
--   * whatsapp_conversas ganha o estado da automação por número: fora_horario_em
--     (último aviso de fora do expediente), encerrada_em (último encerramento),
--     pesquisa_ate / pesquisa_team / pesquisa_operador (esperando a nota até
--     quando, de que equipe, quem atendeu) e inatividade_lembrete_em. A tabela
--     segue sem policy (076): só o service_role lê e grava.
--   * pg_cron 'whatsapp-inatividade' a cada 5 minutos chamando a function de
--     mesmo nome (x-cron-secret = avisos_cron_secret do Vault, como a 051 e a
--     080). Sem equipe com inatividade ligada, a function lê uma tabela e
--     devolve. Sem pg_cron/pg_net no banco o agendamento é pulado com NOTICE e
--     o resto da migration vale do mesmo jeito.
--
-- PRÉ-REQUISITOS: 011 (current_op_is_admin/current_op_team), 076 e 085. Publicar
-- antes as functions conversa-encerrar e whatsapp-inatividade (senão o cron
-- chama uma URL que não existe a cada 5 minutos). Idempotente.
--
-- Sem esta migration o webhook, o encerramento e a Caixa seguem funcionando:
-- a automação lê as colunas/tabelas novas, recebe erro e fica desligada.
--
-- VERIFICAR:
--   select count(*) from public.whatsapp_automacao;            -- roda sem erro
--   select count(*) from public.whatsapp_avaliacoes;           -- roda sem erro
--   select polname from pg_policy where polrelid = 'public.whatsapp_automacao'::regclass;
--   -- esperado: whatsapp_automacao_select, _insert, _update, _delete (4 linhas)
--   select polname from pg_policy where polrelid = 'public.whatsapp_avaliacoes'::regclass;
--   -- esperado: whatsapp_avaliacoes_select (1 linha, nenhuma de escrita)
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'whatsapp_conversas'
--      and column_name in ('fora_horario_em', 'encerrada_em', 'pesquisa_ate',
--                          'pesquisa_team', 'pesquisa_operador', 'inatividade_lembrete_em');
--   -- esperado: 6 linhas
--   select count(*) from pg_policies where tablename = 'whatsapp_conversas';
--   -- esperado: 0 (continua fechada para authenticated)
--   select jobname, schedule, active from cron.job where jobname = 'whatsapp-inatividade';
--   -- esperado: */5 * * * *, active = true
--
-- REVERTER (o webhook volta a só gravar e a Caixa para de mostrar a nota):
--   select cron.unschedule('whatsapp-inatividade');
--   drop table if exists public.whatsapp_avaliacoes;
--   drop table if exists public.whatsapp_automacao;
--   alter table public.whatsapp_conversas
--     drop column if exists fora_horario_em,   drop column if exists encerrada_em,
--     drop column if exists pesquisa_ate,      drop column if exists pesquisa_team,
--     drop column if exists pesquisa_operador, drop column if exists inatividade_lembrete_em;
-- ============================================================

-- ── Configuração por equipe ──────────────────────────────────
create table if not exists public.whatsapp_automacao (
  team                      text primary key,
  horario_ativo             boolean not null default false,
  -- {"1": [["08:30","12:00"],["13:00","17:30"]], ...}; 0 = domingo … 6 = sábado.
  -- Faixa com fim antes do início atravessa a meia-noite (22:00–02:00).
  horario                   jsonb not null default '{}'::jsonb,
  -- ["2026-12-25", "01-01"]: com ano vale o dia; sem ano, todo ano.
  feriados                  jsonb not null default '[]'::jsonb,
  texto_fora_horario        text,
  saudacao_ativa            boolean not null default false,
  texto_saudacao            text,
  encerramento_ativo        boolean not null default false,
  texto_encerramento        text,
  pesquisa_ativa            boolean not null default false,
  texto_pesquisa            text,
  texto_agradecimento       text,
  pesquisa_horas            integer not null default 24,
  inatividade_ativa         boolean not null default false,
  inatividade_lembrete_min  integer,
  inatividade_encerrar_min  integer,
  texto_lembrete            text,
  texto_inatividade         text,
  updated_by                text,
  updated_at                timestamptz not null default now()
);

alter table public.whatsapp_automacao drop constraint if exists whatsapp_automacao_formato;
alter table public.whatsapp_automacao
  add constraint whatsapp_automacao_formato check (
    jsonb_typeof(horario) = 'object'
    and jsonb_typeof(feriados) = 'array'
    and pesquisa_horas between 1 and 168
    and (inatividade_lembrete_min is null or inatividade_lembrete_min between 5 and 10080)
    and (inatividade_encerrar_min is null or inatividade_encerrar_min between 10 and 10080)
    and (inatividade_lembrete_min is null or inatividade_encerrar_min is null
         or inatividade_lembrete_min < inatividade_encerrar_min)
    and (not inatividade_ativa or inatividade_encerrar_min is not null)
  );

-- Os textos vão para o WhatsApp do cliente: limite folgado, mas limite.
alter table public.whatsapp_automacao drop constraint if exists whatsapp_automacao_textos;
alter table public.whatsapp_automacao
  add constraint whatsapp_automacao_textos check (
    char_length(coalesce(texto_fora_horario, ''))  <= 1000
    and char_length(coalesce(texto_saudacao, ''))      <= 1000
    and char_length(coalesce(texto_encerramento, ''))  <= 1000
    and char_length(coalesce(texto_pesquisa, ''))      <= 1000
    and char_length(coalesce(texto_agradecimento, '')) <= 1000
    and char_length(coalesce(texto_lembrete, ''))      <= 1000
    and char_length(coalesce(texto_inatividade, ''))   <= 1000
  );

alter table public.whatsapp_automacao enable row level security;
grant select, insert, update, delete on public.whatsapp_automacao to authenticated;

drop policy if exists whatsapp_automacao_select on public.whatsapp_automacao;
drop policy if exists whatsapp_automacao_insert on public.whatsapp_automacao;
drop policy if exists whatsapp_automacao_update on public.whatsapp_automacao;
drop policy if exists whatsapp_automacao_delete on public.whatsapp_automacao;

-- A equipe enxerga o que o robô diz em nome dela; mudar é de admin, porque
-- cada mensagem automática sai do número da empresa.
create policy whatsapp_automacao_select on public.whatsapp_automacao for select to authenticated
  using ((select public.current_op_is_admin()) or team = (select public.current_op_team()));
create policy whatsapp_automacao_insert on public.whatsapp_automacao for insert to authenticated
  with check ((select public.current_op_is_admin()));
create policy whatsapp_automacao_update on public.whatsapp_automacao for update to authenticated
  using ((select public.current_op_is_admin()))
  with check ((select public.current_op_is_admin()));
create policy whatsapp_automacao_delete on public.whatsapp_automacao for delete to authenticated
  using ((select public.current_op_is_admin()));

comment on table public.whatsapp_automacao is
  'Automação do WhatsApp por equipe (horário, saudação, encerramento, pesquisa, inatividade). Tudo desligado por padrão. Grava só admin.';

-- ── Avaliações (CSAT 1 a 5) ──────────────────────────────────
create table if not exists public.whatsapp_avaliacoes (
  id            uuid primary key default gen_random_uuid(),
  team          text not null default 'init',
  telefone      text not null,
  thread_id     text,
  nota          smallint not null check (nota between 1 and 5),
  escala        text not null default 'csat' check (escala = 'csat'),
  operador      text,
  respondida_em timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create index if not exists whatsapp_avaliacoes_telefone_idx
  on public.whatsapp_avaliacoes (telefone, created_at desc);
create index if not exists whatsapp_avaliacoes_team_idx
  on public.whatsapp_avaliacoes (team, created_at desc);

alter table public.whatsapp_avaliacoes enable row level security;
-- Só leitura para o app; o insert é do webhook (service_role ignora RLS).
revoke insert, update, delete on public.whatsapp_avaliacoes from authenticated, anon;
grant select on public.whatsapp_avaliacoes to authenticated;

drop policy if exists whatsapp_avaliacoes_select on public.whatsapp_avaliacoes;
create policy whatsapp_avaliacoes_select on public.whatsapp_avaliacoes for select to authenticated
  using ((select public.current_op_is_admin()) or team = (select public.current_op_team()));

comment on table public.whatsapp_avaliacoes is
  'Nota de satisfação (CSAT 1 a 5) respondida pelo contato depois do encerramento. Grava só o webhook (service_role).';

-- ── Estado da automação por número ───────────────────────────
alter table public.whatsapp_conversas
  add column if not exists fora_horario_em         timestamptz,
  add column if not exists encerrada_em            timestamptz,
  add column if not exists pesquisa_ate            timestamptz,
  add column if not exists pesquisa_team           text,
  add column if not exists pesquisa_operador       text,
  add column if not exists inatividade_lembrete_em timestamptz;

-- ── Cron da inatividade ──────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from pg_extension where extname = 'pg_net') then
    if exists (select 1 from cron.job where jobname = 'whatsapp-inatividade') then
      perform cron.unschedule('whatsapp-inatividade');
    end if;
    perform cron.schedule(
      'whatsapp-inatividade',
      '*/5 * * * *',
      $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/whatsapp-inatividade',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'avisos_cron_secret')
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
      );
      $job$
    );
  else
    raise notice '088: pg_cron/pg_net ausentes, cron whatsapp-inatividade não agendado';
  end if;
end $$;
