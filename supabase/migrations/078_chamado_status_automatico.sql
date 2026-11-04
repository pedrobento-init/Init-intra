-- ============================================================
-- Migration 078: status do chamado anda sozinho
-- ============================================================
-- Até aqui o status só mudava quando alguém da equipe mexia no seletor. Duas
-- situações ficavam erradas sem ninguém perceber:
--
--   1. O cliente respondia (e-mail pelo robô, WhatsApp pelo webhook) e o
--      chamado continuava "Aguard. Cliente". A mensagem virava nota, mas a
--      bola já tinha voltado para a equipe e nada na fila dizia isso. O SLA
--      (js/sla.js, slaTempoPorLado) seguia contando esse tempo como "com quem
--      pediu".
--   2. Chamado esquecido ficava "Em Andamento" ou "Aguard. Cliente" para
--      sempre, enchendo a fila de coisa que ninguém está tocando.
--
-- O que muda:
--
--   * Trigger trg_pendencias_cliente_respondeu (BEFORE UPDATE OF notes): se a
--     gravação traz uma nota NOVA com visibility = 'solicitante' e o chamado
--     está em aguardando_cliente ou pausado, ele volta para em_andamento.
--     Fica no banco, e não no robô e no webhook, porque são três caminhos que
--     gravam a nota (robô, webhook antigo e append_pendencia_note da 077) e
--     mais um que apareça amanhã. Se a mesma gravação já muda o status, quem
--     gravou decidiu: o trigger não mexe.
--
--   * chamados_sem_interacao(): o que o pg_cron roda de hora em hora. Só
--     chamado (canal e-mail ou WhatsApp, a mesma regra de penPaginaTipo em
--     js/pagina-pendencia.js); projeto e tarefa interna ficam de fora. Com 7
--     dias corridos sem nota nem evento:
--       - aguardando_cliente → resolvido, sem mensagem ao cliente. Pendência
--         recorrente fica de fora: a próxima ocorrência nasce no app, quando
--         alguém resolve, e o banco não sabe gerá-la.
--       - em_andamento → pausado.
--     Cronômetro ligado é sinal de trabalho: esses ficam como estão.
--
-- Toda mudança automática entra em `events` (063) com by = 'Sistema' e um
-- `motivo`, para a linha do tempo dizer por que o status mudou.
--
-- Nada é enviado ao cliente.
--
-- RLS: nenhuma policy nova. O trigger só altera a própria linha que já está
-- sendo gravada (e passou pelo RLS de quem gravou). chamados_sem_interacao
-- roda no pg_cron, como dono do banco, e varre todas as equipes, mas só muda o
-- status de cada linha dentro dela mesma; não tem EXECUTE para anon nem
-- authenticated.
--
-- Depende de: 063 (events), 064/065 (solicitante_email, email_thread_id),
-- extensão pg_cron (Database → Extensions).
--
-- Idempotente.
--
-- VERIFICAR:
--   select tgname from pg_trigger where tgname = 'trg_pendencias_cliente_respondeu';
--   -- esperado: 1 linha
--   select jobname, schedule, active from cron.job where jobname = 'chamados-sem-interacao';
--   -- esperado: chamados-sem-interacao | 17 * * * * | t
--   -- o que a rodada faria agora, sem esperar o horário (MUDA os chamados):
--   select * from public.chamados_sem_interacao();
--
-- REVERTER:
--   select cron.unschedule('chamados-sem-interacao');
--   drop trigger if exists trg_pendencias_cliente_respondeu on public.pendencias;
--   drop function if exists public.pendencias_cliente_respondeu();
--   drop function if exists public.chamados_sem_interacao(timestamptz, integer);
--   drop function if exists public.chamado_com_evento(jsonb, jsonb);
--   drop function if exists public.chamado_ts(text);
-- ============================================================

-- Data de nota/evento é texto ISO gravado pelo app; texto torto não pode
-- derrubar a rodada inteira por causa de um chamado.
create or replace function public.chamado_ts(p text)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
begin
  if p is null or p !~ '^\d{4}-\d{2}-\d{2}' then return null; end if;
  return p::timestamptz;
exception when others then
  return null;
end $$;

-- Soma um evento e corta os mais antigos: o mesmo teto de PEN_MAX_EVENTS em
-- js/storage-pendencias.js, para a linha não crescer sem limite.
create or replace function public.chamado_com_evento(p_eventos jsonb, p_evento jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(s.e order by s.i), '[]'::jsonb)
    from (
      select t.e, t.i
        from jsonb_array_elements(
               case when jsonb_typeof(p_eventos) = 'array' then p_eventos else '[]'::jsonb end
               || jsonb_build_array(p_evento)
             ) with ordinality as t(e, i)
       order by t.i desc
       limit 200
    ) s
$$;

create or replace function public.pendencias_cliente_respondeu()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  antes integer;
  depois integer;
begin
  if NEW.status is distinct from OLD.status then return NEW; end if;
  if coalesce(OLD.status, '') not in ('aguardando_cliente', 'pausado') then return NEW; end if;

  -- Contar, e não procurar a última nota: o app regrava o array inteiro, e uma
  -- nota antiga do cliente que já estava lá não é resposta nova.
  select count(*) into antes
    from jsonb_array_elements(case when jsonb_typeof(OLD.notes) = 'array' then OLD.notes else '[]'::jsonb end) n
   where n->>'visibility' = 'solicitante';
  select count(*) into depois
    from jsonb_array_elements(case when jsonb_typeof(NEW.notes) = 'array' then NEW.notes else '[]'::jsonb end) n
   where n->>'visibility' = 'solicitante';
  if depois <= antes then return NEW; end if;

  NEW.status := 'em_andamento';
  NEW.events := public.chamado_com_evento(NEW.events, jsonb_build_object(
    'at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'by', 'Sistema', 'type', 'status', 'de', OLD.status, 'para', 'em_andamento',
    'motivo', 'Cliente respondeu'));
  return NEW;
end $$;

revoke all on function public.pendencias_cliente_respondeu() from public, anon, authenticated;

drop trigger if exists trg_pendencias_cliente_respondeu on public.pendencias;
create trigger trg_pendencias_cliente_respondeu
  before update of notes on public.pendencias
  for each row execute function public.pendencias_cliente_respondeu();

create or replace function public.chamados_sem_interacao(p_agora timestamptz default now(), p_dias integer default 7)
returns table (id text, de text, para text)
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
declare
  limite timestamptz := p_agora - make_interval(days => p_dias);
  quando text := to_char(p_agora at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  return query
  with alvo as (
    select p.id,
           p.status as de,
           case p.status when 'aguardando_cliente' then 'resolvido' else 'pausado' end as para
      from public.pendencias p
     where p.status in ('aguardando_cliente', 'em_andamento')
       and coalesce(p.timer_running, false) = false
       and (p.status <> 'aguardando_cliente' or btrim(coalesce(p.recurrence, '')) = '')
       and (lower(coalesce(p.canal, '')) in ('email', 'whatsapp')
            or coalesce(p.email_thread_id, '') like 'whatsapp:%'
            or btrim(coalesce(p.solicitante_email, '')) <> '')
       -- Última interação: abertura, qualquer nota (da equipe ou do cliente)
       -- ou qualquer evento. updated_at não serve: o app o renova em toques
       -- que não são atendimento (revisão em reunião, sync).
       and greatest(
             p.created_at,
             (select max(public.chamado_ts(n->>'createdAt'))
                from jsonb_array_elements(case when jsonb_typeof(p.notes) = 'array' then p.notes else '[]'::jsonb end) n),
             (select max(public.chamado_ts(e->>'at'))
                from jsonb_array_elements(case when jsonb_typeof(p.events) = 'array' then p.events else '[]'::jsonb end) e)
           ) <= limite
       for update skip locked
  )
  update public.pendencias p
     set status = a.para,
         events = public.chamado_com_evento(p.events, jsonb_build_object(
           'at', quando, 'by', 'Sistema', 'type', 'status', 'de', a.de, 'para', a.para,
           'motivo', case a.para when 'resolvido' then 'Sem retorno do cliente em ' || p_dias || ' dias'
                                 else 'Sem interação em ' || p_dias || ' dias' end)),
         completed_at = case when a.para = 'resolvido' then p_agora else p.completed_at end,
         completed_by = case when a.para = 'resolvido'
                             then coalesce(nullif(btrim(p.completed_by), ''), nullif(btrim(p.responsible), ''))
                             else p.completed_by end,
         updated_at = p_agora
    from alvo a
   where p.id = a.id
     and p.status = a.de
  returning p.id, a.de, a.para;
end $$;

revoke all on function public.chamados_sem_interacao(timestamptz, integer) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'chamados-sem-interacao') then
    perform cron.unschedule('chamados-sem-interacao');
  end if;
end $$;

select cron.schedule(
  'chamados-sem-interacao',
  '17 * * * *',
  $job$ select public.chamados_sem_interacao() $job$
);
