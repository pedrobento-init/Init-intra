-- tools/migracao-gerar-politicas-storage.sql — só SELECT (gera comandos).
-- As policies de storage.objects não vão no dump. Cada linha derruba a policy
-- de mesmo nome (se existir no destino) e a recria como está na origem.
select format('drop policy if exists %I on storage.objects;', policyname)
       || format(' create policy %I on storage.objects as %s for %s to %s%s%s;',
            policyname, permissive, cmd, array_to_string(roles, ', '),
            ' using (' || qual || ')', ' with check (' || with_check || ')')
  from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
 order by policyname;
