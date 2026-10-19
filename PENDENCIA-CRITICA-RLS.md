# Trava de acesso por equipe (RLS): como conferir

- **Status:** a correção existe na migration `042_rls_completo.sql` (substitui
  a `021` e a `024`). Falta só confirmar que ela está aplicada em produção.
- **Por que importa:** esconder blocos na tela não protege os dados. Sem RLS,
  qualquer técnico logado lê e edita dados de outras equipes direto pela API.
- As migrations `045` em diante usam funções criadas pela `042`
  (`can_see_team`, `current_op_is_admin`). Se `vencimentos` funciona em
  produção, a `042` provavelmente já rodou, mas confira com os comandos abaixo.

## 1. Conferir (somente leitura, SQL Editor do Supabase)

```sql
-- a) a 042 está aplicada? (esperado: true)
SELECT to_regprocedure('public.can_see_team(text)') IS NOT NULL AS tem_042;

-- b) nenhuma policy aberta ou para anon (esperado: 0 linhas)
SELECT tablename, policyname, roles, qual FROM pg_policies
 WHERE schemaname = 'public' AND (qual = 'true' OR with_check = 'true'
    OR NOT (roles @> ARRAY['authenticated']::name[]));

-- c) nenhuma tabela sem RLS (esperado: 0 linhas)
SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;

-- d) anon sem privilégio em tabela (esperado: 0 linhas)
SELECT table_name, privilege_type FROM information_schema.role_table_grants
 WHERE grantee = 'anon' AND table_schema = 'public';
```

Tudo como esperado: nada a fazer. Algo diferente: siga o passo 2.

## 2. Aplicar (só se a conferência falhar)

1. Faça um backup (Database → Backups) e guarde as policies atuais:
   `SELECT * FROM pg_policies WHERE schemaname = 'public';`
2. Rode a pré-checagem do cabeçalho da `042` e veja o que vai sumir para não-admin.
3. Cole e rode o arquivo `supabase/migrations/042_rls_completo.sql` inteiro
   (é idempotente: pode rodar de novo).
4. Rode a conferência do passo 1 de novo.
5. Teste com um técnico que não é admin: login, lista de pendências, criar e
   editar uma pendência, e que dados de outra equipe não aparecem.

A `042` é testada em Postgres real em `tests/rls.test.js` (anon, técnico,
outra equipe, Gestão e admin).
