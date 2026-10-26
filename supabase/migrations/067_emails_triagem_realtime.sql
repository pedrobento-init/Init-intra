-- ============================================================
-- Migration 067: a caixa de triagem acompanha o app em tempo real
-- ============================================================
-- O schema.js marca emails_triagem como `realtime: true` (066): o app
-- assina a tabela para a caixa aparecer sozinha quando um e-mail chega
-- enquanto alguém está na tela de Pendências. Mas assinar não basta — o
-- Supabase só entrega eventos de tabela que estejam NA PUBLICAÇÃO
-- `supabase_realtime`, e a 066 criou a tabela sem colocá-la lá.
--
-- O sintoma é o clássico "só atualiza ao renavegar": o INSERT do robô
-- acontece, o pull puxa, mas o canal não emite nada, e quem está olhando
-- vê a caixa parada.
--
-- A 066 é pré-requisito (a tabela tem de existir). Idempotente.
--
-- VERIFICAR:
--   select tablename from pg_publication_tables
--    where pubname = 'supabase_realtime' and tablename = 'emails_triagem';
--   -- esperado: 1 linha
--
-- ROLLBACK:
--   alter publication supabase_realtime drop table public.emails_triagem;
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'emails_triagem'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.emails_triagem;
  END IF;
END $$;
