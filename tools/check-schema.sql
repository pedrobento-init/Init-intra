-- ============================================================
-- tools/check-schema.sql — conferência do estado REAL do banco
-- ============================================================
-- O QUE FAZ
--   Consultas SOMENTE LEITURA (apenas SELECT) sobre o catálogo do Postgres e
--   o storage. Mostra o que o banco de produção realmente tem, que pode ser
--   diferente do que as migrations do repositório dizem: elas são aplicadas
--   à mão e `supabase migration list` não reflete o banco (AGENTS.md,
--   AUDITORIA.md §13.6).
--
-- COMO USAR
--   Cole no SQL Editor do Supabase e rode bloco a bloco (cada bloco é uma
--   consulta independente, numerada de 1 a 7). Repita a cada auditoria e
--   depois de aplicar migration nova.
--
-- COMO INTERPRETAR
--   1. RLS por tabela: toda tabela de `public` deve ter rls_ligado = true.
--      false = tabela exposta à API sem filtro de linha.
--   2. Policies por tabela: cada tabela de negócio deve ter policies por
--      operação (select/insert/update/delete ou uma ALL restrita). Uma
--      policy com qual = 'true' (e roles = {public}) anula as demais, porque
--      permissivas se somam por OU. O esperado é ZERO em `permissivas`.
--   3. Tabelas sem policy: RLS ligado + nenhuma policy = fail-closed (ninguém
--      acessa). Qualquer tabela listada aqui precisa ser explicada (ex.:
--      tabela legado fechada de propósito, SYNC-04 em AUDITORIA.md §13.5);
--      se não for, é bug.
--   4. Grants: o que `anon` e `authenticated` podem fazer em cada tabela. A
--      migration 055 deu grants explícitos; `anon` não deveria ter INSERT,
--      UPDATE ou DELETE em tabela de negócio (o RLS é a segunda barreira).
--   5. Buckets do storage: `attachments` deve ter public = false (SEC-01).
--      Confira também qualquer bucket criado depois (ex.: fotos de visita,
--      migration 061) e o limite de tamanho/tipos permitidos.
--   6. Policies do storage.objects: nenhuma deve liberar leitura a anon.
--   7. Funções esperadas: as `current_op_*` e as RPCs que o app e as policies
--      chamam devem existir; existe = false indica migration não aplicada.
--      Também mostra se são SECURITY DEFINER.
--
-- EFEITO COLATERAL
--   Nenhum. Só SELECT; não altera dado, schema, grant nem policy. O teste
--   tests/check-schema.test.js impede que DDL/DML entre neste arquivo.
-- ============================================================

-- 1) RLS ligado por tabela (esperado: rls_ligado = true em todas)
select c.relname as tabela,
       c.relrowsecurity as rls_ligado,
       c.relforcerowsecurity as rls_forcado
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relrowsecurity, c.relname;

-- 2) Policies por tabela (esperado: permissivas = 0 em todas)
select tablename as tabela,
       count(*) as policies,
       count(*) filter (where qual = 'true' or with_check = 'true') as permissivas,
       string_agg(policyname || ' [' || cmd || ']', ', ' order by policyname) as lista
from pg_policies
where schemaname = 'public'
group by tablename
order by permissivas desc, tablename;

-- 2b) Detalhe de qualquer policy permissiva (esperado: nenhuma linha)
select tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and (qual = 'true' or with_check = 'true')
order by tablename, policyname;

-- 3) Tabelas com RLS ligado e SEM nenhuma policy (fail-closed)
select c.relname as tabela
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  and not exists (
    select 1 from pg_policies p
    where p.schemaname = 'public' and p.tablename = c.relname
  )
order by c.relname;

-- 4) Grants por tabela para anon / authenticated
select table_name as tabela,
       grantee,
       string_agg(privilege_type, ', ' order by privilege_type) as privilegios
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated')
group by table_name, grantee
order by table_name, grantee;

-- 5) Buckets do storage (esperado: attachments com public = false)
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
order by id;

-- 6) Policies do storage.objects (esperado: nenhuma de leitura para anon/public)
select policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
order by policyname;

-- 7) Funções esperadas (existe = false => migration não aplicada)
select e.nome as funcao,
       (p.oid is not null) as existe,
       coalesce(p.prosecdef, false) as security_definer
from unnest(array[
  'current_op_id', 'current_op_name', 'current_op_team',
  'current_op_is_admin', 'current_op_is_gestao',
  'can_see_client', 'can_see_pendencia', 'can_see_team',
  'append_pendencia_note', 'marcar_chamado_visto',
  'my_calendar_feed_token', 'my_google_agenda_status',
  'reveal_client_secret', 'op_id_by_name'
]) as e(nome)
left join pg_proc p
  on p.proname = e.nome
 and p.pronamespace = (select oid from pg_namespace where nspname = 'public')
order by existe, e.nome;
