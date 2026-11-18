-- tools/migracao-limpar-dados.sql — APAGA DADOS do projeto NOVO (não o esquema).
-- Usado por tools/migrar-supabase.ps1 (etapa recarregar), só no projeto NOVO,
-- numa transação, antes de recarregar os dados frescos do antigo.
--
-- Esvazia todas as tabelas de public (as tabelas, índices, policies, grants e
-- funções ficam) e remove os usuários de auth.users (identidades, sessões e
-- tokens saem em cascata). NÃO toca em storage, vault, cron nem em extensões.
do $$
declare
  lista text;
begin
  select string_agg(format('%I.%I', schemaname, tablename), ', ')
    into lista
    from pg_tables
   where schemaname = 'public';
  if lista is not null then
    execute 'truncate table ' || lista || ' restart identity cascade';
  end if;
end $$;

delete from auth.users;
