-- tools/migracao-gerar-permissoes.sql — só SELECT (gera comandos, não os executa).
-- Uma linha de GRANT por objeto e papel (anon, authenticated), igual ao que o
-- projeto de origem permite hoje. Rodado no projeto ANTIGO por
-- tools/migrar-supabase.ps1 (etapa permissoes) e aplicado no NOVO.
select format('grant %s on table public.%I to %I;', string_agg(p, ', ' order by p), c.relname, r.rolname)
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join (values ('anon'), ('authenticated')) r(rolname)
  cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
 where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p')
   and has_table_privilege(r.rolname, c.oid, p)
 group by c.relname, r.rolname
union all
select format('grant %s on sequence public.%I to %I;', string_agg(p, ', ' order by p), c.relname, r.rolname)
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join (values ('anon'), ('authenticated')) r(rolname)
  cross join unnest(array['USAGE', 'SELECT', 'UPDATE']) p
 where n.nspname = 'public' and c.relkind = 'S'
   and has_sequence_privilege(r.rolname, c.oid, p)
 group by c.relname, r.rolname
union all
select format('grant execute on function %s to %I;', p.oid::regprocedure::text, r.rolname)
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join (values ('anon'), ('authenticated')) r(rolname)
 where n.nspname = 'public' and has_function_privilege(r.rolname, p.oid, 'EXECUTE');
