-- Migration 011: horário início/fim e dia inteiro nas visitas
-- ORDEM DE APLICACAO E PREFIXO DUPLICADO (SYNC-05)
--   Existem DOIS arquivos com prefixo 011:
--     1) 011_rls_roles_teams.sql   (RLS por papel e equipe)
--     2) 011_visit_time_range.sql  (colunas time_end / all_day em visits)
--   Ordem correta: 1) 011_rls_roles_teams  ->  2) 011_visit_time_range
--   (a mesma ordem alfabetica), ambas ANTES da 012. Os dois sao independentes
--   (a RLS nao referencia time_end/all_day e as colunas nao dependem das
--   policies), mas mantenha a ordem acima para ficar igual ao que ja rodou.
--   Decisao: NAO renomear. Renumerar
--   deixaria o historico do banco (aplicacao manual) ambiguo; ver AUDITORIA.md SYNC-05.
ALTER TABLE public.visits ADD COLUMN IF NOT EXISTS time_end TIME;
ALTER TABLE public.visits ADD COLUMN IF NOT EXISTS all_day BOOLEAN DEFAULT false;
