-- ============================================================
-- Migration 091: respostas_prontas na publicação do realtime
-- ============================================================
-- O app assina as tabelas com `realtime: true` do schema.js num canal só
-- ('public-changes-v2', js/sync-manager.js). Se UMA delas não está na
-- publicação `supabase_realtime`, o Supabase recusa a assinatura do canal
-- inteiro e nenhuma tabela entrega evento ao vivo — nem a Caixa de entrada.
-- A 074 criou respostas_prontas sem colocá-la na publicação, e o sintoma era
-- a mensagem do WhatsApp só aparecer na conferência de 30 s (ou no sync
-- manual), nunca na hora.
--
-- PRÉ-REQUISITO: 074. Idempotente. Sem a publicação (banco sem Realtime), não
-- faz nada.
--
-- VERIFICAR:
--   select tablename from pg_publication_tables
--    where pubname = 'supabase_realtime' and tablename = 'respostas_prontas';
--   -- esperado: 1 linha
--   Depois, recarregue o app: uma mensagem nova de WhatsApp aparece na Caixa
--   em poucos segundos, sem sincronizar.
--
-- REVERTER:
--   alter publication supabase_realtime drop table public.respostas_prontas;
-- ============================================================

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and exists (select 1 from pg_class where oid = to_regclass('public.respostas_prontas'))
     and not exists (
       select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public'
          and tablename = 'respostas_prontas'
     ) then
    alter publication supabase_realtime add table public.respostas_prontas;
  end if;
end $$;
