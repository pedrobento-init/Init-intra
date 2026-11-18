-- tools/migracao-permissoes-efetivas.sql — só SELECT.
-- O que anon e authenticated PODEM fazer em tabelas, sequências e funções do
-- schema public, já contando herança e PUBLIC (has_*_privilege). Usado por
-- tools/migrar-supabase.ps1 (etapas comparar e permissoes).
select 'table' as tipo, c.relname::text as objeto, r.rolname::text as papel,
       string_agg(p, ',' order by p) as privilegios
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join (values ('anon'), ('authenticated')) r(rolname)
  cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
 where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p')
   and has_table_privilege(r.rolname, c.oid, p)
 group by c.relname, r.rolname
union all
select 'sequence', c.relname::text, r.rolname::text, string_agg(p, ',' order by p)
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join (values ('anon'), ('authenticated')) r(rolname)
  cross join unnest(array['USAGE', 'SELECT', 'UPDATE']) p
 where n.nspname = 'public' and c.relkind = 'S'
   and has_sequence_privilege(r.rolname, c.oid, p)
 group by c.relname, r.rolname
union all
select 'function', p.oid::regprocedure::text, r.rolname::text, 'EXECUTE'
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join (values ('anon'), ('authenticated')) r(rolname)
 where n.nspname = 'public' and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
order by 1, 2, 3;
