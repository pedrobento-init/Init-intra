-- ============================================================
-- Migration 061: Fotos da visita no Storage (pasta visits/*)
-- ============================================================
-- As fotos da visita (js/visit-photos.js) vão para o bucket privado
-- 'attachments' em visits/<id da visita>/<foto>.jpg. As policies da 022
-- só conhecem pendencias/* e clients/*: fora do admin, o envio era
-- recusado e a foto ficava presa em "Aguardando envio".
--
-- Aqui as 4 policies do bucket são recriadas com o mesmo desenho da 022
-- (admin: tudo; demais: só objetos de registros da própria equipe) e
-- ganham o ramo visits/* pela equipe da visita (visits.team).
-- Funções entre (SELECT ...) para avaliar uma vez por consulta (055).
--
-- Verificação (somente leitura):
--   SELECT policyname, cmd FROM pg_policies
--   WHERE schemaname = 'storage' AND tablename = 'objects'
--     AND policyname LIKE 'attachments team %' ORDER BY policyname;
-- Rollback: rodar de novo o bloco de policies da 022 (ETAPA B).
-- ============================================================

DO $$
DECLARE
  dono constant text := $c$(
    bucket_id = 'attachments'
    AND (
      (SELECT public.current_op_is_admin())
      OR (
        split_part(name, '/', 1) = 'pendencias'
        AND EXISTS (
          SELECT 1 FROM public.pendencias p
          WHERE p.id = split_part(name, '/', 2)
            AND COALESCE(p.team, 'init') = (SELECT public.current_op_team())
        )
      )
      OR (
        split_part(name, '/', 1) = 'clients'
        AND EXISTS (
          SELECT 1 FROM public.clients c
          WHERE c.id = split_part(name, '/', 2)
            AND COALESCE(c.team, 'init') = (SELECT public.current_op_team())
        )
      )
      OR (
        split_part(name, '/', 1) = 'visits'
        AND EXISTS (
          SELECT 1 FROM public.visits v
          WHERE v.id = split_part(name, '/', 2)
            AND COALESCE(v.team, 'init') = (SELECT public.current_op_team())
        )
      )
    )
  )$c$;
BEGIN
  DROP POLICY IF EXISTS "attachments team read" ON storage.objects;
  DROP POLICY IF EXISTS "attachments team insert" ON storage.objects;
  DROP POLICY IF EXISTS "attachments team update" ON storage.objects;
  DROP POLICY IF EXISTS "attachments team delete" ON storage.objects;

  EXECUTE format('CREATE POLICY "attachments team read" ON storage.objects FOR SELECT TO authenticated USING %s', dono);
  EXECUTE format('CREATE POLICY "attachments team insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK %s', dono);
  -- upsert:true (envio da foto) também passa por UPDATE.
  EXECUTE format('CREATE POLICY "attachments team update" ON storage.objects FOR UPDATE TO authenticated USING %s WITH CHECK %s', dono, dono);
  EXECUTE format('CREATE POLICY "attachments team delete" ON storage.objects FOR DELETE TO authenticated USING %s', dono);
END $$;
