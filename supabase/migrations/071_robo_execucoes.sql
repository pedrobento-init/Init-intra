-- ============================================================
-- Migration 071: robo_execucoes — cada rodada do robô deixa rastro
-- ============================================================
-- O robô (supabase/functions/robo) roda pelo gatilho do Apps Script a cada
-- 5 minutos, e o único sinal de vida dele era o log da Edge Function — que só
-- quem tem acesso ao painel do Supabase lê. Quando a triagem parava (segredo
-- trocado, gatilho apagado, Make fora do ar), ninguém no app percebia até um
-- cliente reclamar que o e-mail não virou chamado.
--
-- Agora toda ação do robô grava uma linha aqui: qual ação, quando começou,
-- quanto durou, se deu certo, o erro e os contadores que ela devolveu. O app
-- mostra a última rodada e acende o aviso quando falha ou quando o robô some.
--
-- Sem esta migration o app segue igual: a Edge Function tenta gravar, falha,
-- só registra no log e devolve a resposta normal. Depois da 070. Idempotente.
--
-- Tamanho: a triagem sozinha dá ~288 linhas por dia. A própria Edge Function
-- apaga o que passou de 14 dias a cada rodada (o índice em inicio deixa isso
-- barato), e a tabela NÃO entra no sync do app: o painel busca só as últimas
-- rodadas direto do Supabase, para não encher o IndexedDB de cada aparelho.
--
-- VERIFICAR:
--   select acao, inicio, ok, erro, resultado from public.robo_execucoes
--    order by inicio desc limit 5;
--   -- esperado: uma linha por chamada do Apps Script, a mais nova com
--   -- poucos minutos de idade
--   select min(inicio) from public.robo_execucoes;
--   -- esperado: no máximo 14 dias atrás, depois do robô rodar
--
-- REVERTER:
--   drop table if exists public.robo_execucoes;
--
-- RLS: só leitura para authenticated, por equipe (admin vê tudo). Quem
-- escreve é a Edge Function com service role, que passa por cima da RLS. Não
-- há policy de insert/update/delete de propósito: o histórico do robô não é
-- coisa que o usuário edite.
-- ============================================================

create table if not exists public.robo_execucoes (
  id uuid primary key default gen_random_uuid(),
  acao text not null,
  inicio timestamptz not null,
  fim timestamptz,
  duracao_ms integer,
  ok boolean not null,
  erro text,
  resultado jsonb,
  team text not null default 'init',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists robo_execucoes_inicio_idx on public.robo_execucoes (inicio desc);

alter table public.robo_execucoes enable row level security;

grant select on public.robo_execucoes to authenticated;

drop policy if exists robo_execucoes_select on public.robo_execucoes;
create policy robo_execucoes_select on public.robo_execucoes
  for select to authenticated
  using ((select public.current_op_is_admin()) or coalesce(team, 'init') = (select public.current_op_team()));

comment on table public.robo_execucoes is
  'Uma linha por ação do robô (Edge Function robo): quando rodou, quanto durou, se falhou e os contadores. Só leitura no app.';
