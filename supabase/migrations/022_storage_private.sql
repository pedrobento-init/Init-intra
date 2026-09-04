-- ============================================================
-- Migration 022: Bucket attachments privado + escopo por equipe — REVISÃO 2
-- ============================================================
-- STATUS: ARQUIVO PARA REVISÃO. NÃO APLICAR sem ler os avisos abaixo.
--
-- DIAGNÓSTICO (auditoria C2 + código js/storage.js:580-704):
-- - Bucket 'attachments' public=true + SELECT sem auth (017) → leitura
--   anônima de anexos/documentos de clientes. CONFIRMADO.
-- - Convenção de path GERADA PELO APP (storage.js:583):
--     `{type}/{itemId}/{attId}-{file.name}`
--   com type ∈ {clients, pendencias, tickets} (keyMap em addAttachment /
--   removeAttachment / handleFileUpload + upload de clipboard em
--   pendencias.js:526 e documentos em storage.js:806). NENHUM outro
--   padrão é gerado pelo código → escopo por equipe É implementável só
--   com o schema atual, via JOIN com a tabela pai (sem backfill, sem
--   metadado novo). Regra por prefixo do path:
--     pendencias/* → team da pendência pai (pendencias.team);
--     clients/*    → team do cliente pai (clients.team);
--     tickets/*    → SÓ admin (tickets não tem coluna team — Q3 C2);
--     prefixo desconhecido → SÓ admin (fail-closed, sem regra falsa).
-- - URLs públicas (`getPublicUrl`, storage.js:586) são ARMAZENADAS no
--   banco (attachments[].url). Porém `attachments[].path` TAMBÉM é
--   armazenado sempre que houve upload com Storage → signed URLs podem
--   ser geradas a partir de `path` (arquitetura correta, sem migração
--   destrutiva). Anexos só-base64 (`data`, fallback offline) não usam o
--   bucket e não são afetados.
--
-- PRÉ-REQUISITOS ANTES DE APLICAR (na ordem):
-- 1. Backup do banco + snapshot do projeto Supabase.
-- 2. Rodar Q-INV1 e Q-INV2 abaixo. SÓ prossiga se 100% dos objetos
--    seguirem `{type}/{itemId}/...` com type ∈ {clients,pendencias,
--    tickets}. Se houver divergência, RENOMEAR os objetos (MOVE) antes,
--    ou adiar as policies de team e aplicar só a etapa A (privado).
-- 3. Helpers current_op_is_admin()/current_op_team() existindo (011 —
--    confirmado em produção via pg_policies).
-- 4. Código com signed URLs (ETAPA de código listada no relatório):
--    SEM ela, anexos com Storage param de abrir após esta migration
--    (as URLs públicas morrem com public=false). NÃO aplicar antes.
-- 5. Staging primeiro, com a bateria de 13 testes do relatório.
--
-- Q-INV1 (somente leitura):
--   SELECT count(*) FROM storage.objects WHERE bucket_id = 'attachments';
-- Q-INV2 (somente leitura — convenção dos nomes):
--   SELECT name FROM storage.objects
--   WHERE bucket_id = 'attachments' ORDER BY name LIMIT 20;
-- Q-INV3 (somente leitura — fora da convenção; esperado: zero linhas):
--   SELECT name FROM storage.objects
--   WHERE bucket_id = 'attachments'
--     AND split_part(name, '/', 1) NOT IN ('clients','pendencias','tickets');
--
-- ROLLBACK: UPDATE storage.buckets SET public = true WHERE id =
-- 'attachments'; recriar "attachments public read" da 017. (As policies
-- de team são DROP IF EXISTS — reversíveis pelo mesmo mecanismo.)
-- ============================================================

-- ── ETAPA A: bucket privado (fecha exposição anônima) ─────────────────
UPDATE storage.buckets SET public = false WHERE id = 'attachments';

REVOKE ALL ON storage.objects FROM anon;

DROP POLICY IF EXISTS "attachments public read" ON storage.objects;
DROP POLICY IF EXISTS "attachments authenticated read" ON storage.objects;
DROP POLICY IF EXISTS "attachments authenticated insert" ON storage.objects;
DROP POLICY IF EXISTS "attachments authenticated delete" ON storage.objects;
DROP POLICY IF EXISTS "attachments team read" ON storage.objects;
DROP POLICY IF EXISTS "attachments team insert" ON storage.objects;
DROP POLICY IF EXISTS "attachments team update" ON storage.objects;
DROP POLICY IF EXISTS "attachments team delete" ON storage.objects;

-- ── ETAPA B: escopo por equipe via tabela pai ─────────────────────────
-- Admin: tudo. Demais: só objetos sob registros da própria equipe.
-- tickets/* e prefixo desconhecido: só admin (tickets não tem team).
CREATE POLICY "attachments team read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'attachments'
    AND (
      public.current_op_is_admin()
      OR (
        split_part(name, '/', 1) = 'pendencias'
        AND EXISTS (
          SELECT 1 FROM public.pendencias p
          WHERE p.id = split_part(name, '/', 2)
            AND COALESCE(p.team, 'init') = public.current_op_team()
        )
      )
      OR (
        split_part(name, '/', 1) = 'clients'
        AND EXISTS (
          SELECT 1 FROM public.clients c
          WHERE c.id = split_part(name, '/', 2)
            AND COALESCE(c.team, 'init') = public.current_op_team()
        )
      )
    )
  );

-- Upload: o path NOVO precisa pertencer à própria equipe (impede upload
-- arbitrário em pasta de outra equipe). upsert:true exige UPDATE também.
CREATE POLICY "attachments team insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'attachments'
    AND (
      public.current_op_is_admin()
      OR (
        split_part(name, '/', 1) = 'pendencias'
        AND EXISTS (
          SELECT 1 FROM public.pendencias p
          WHERE p.id = split_part(name, '/', 2)
            AND COALESCE(p.team, 'init') = public.current_op_team()
        )
      )
      OR (
        split_part(name, '/', 1) = 'clients'
        AND EXISTS (
          SELECT 1 FROM public.clients c
          WHERE c.id = split_part(name, '/', 2)
            AND COALESCE(c.team, 'init') = public.current_op_team()
        )
      )
    )
  );

CREATE POLICY "attachments team update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'attachments'
    AND (
      public.current_op_is_admin()
      OR (
        split_part(name, '/', 1) = 'pendencias'
        AND EXISTS (
          SELECT 1 FROM public.pendencias p
          WHERE p.id = split_part(name, '/', 2)
            AND COALESCE(p.team, 'init') = public.current_op_team()
        )
      )
      OR (
        split_part(name, '/', 1) = 'clients'
        AND EXISTS (
          SELECT 1 FROM public.clients c
          WHERE c.id = split_part(name, '/', 2)
            AND COALESCE(c.team, 'init') = public.current_op_team()
        )
      )
    )
  )
  WITH CHECK (
    bucket_id = 'attachments'
    AND (
      public.current_op_is_admin()
      OR (
        split_part(name, '/', 1) = 'pendencias'
        AND EXISTS (
          SELECT 1 FROM public.pendencias p
          WHERE p.id = split_part(name, '/', 2)
            AND COALESCE(p.team, 'init') = public.current_op_team()
        )
      )
      OR (
        split_part(name, '/', 1) = 'clients'
        AND EXISTS (
          SELECT 1 FROM public.clients c
          WHERE c.id = split_part(name, '/', 2)
            AND COALESCE(c.team, 'init') = public.current_op_team()
        )
      )
    )
  );

CREATE POLICY "attachments team delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'attachments'
    AND (
      public.current_op_is_admin()
      OR (
        split_part(name, '/', 1) = 'pendencias'
        AND EXISTS (
          SELECT 1 FROM public.pendencias p
          WHERE p.id = split_part(name, '/', 2)
            AND COALESCE(p.team, 'init') = public.current_op_team()
        )
      )
      OR (
        split_part(name, '/', 1) = 'clients'
        AND EXISTS (
          SELECT 1 FROM public.clients c
          WHERE c.id = split_part(name, '/', 2)
            AND COALESCE(c.team, 'init') = public.current_op_team()
        )
      )
    )
  );

-- ── Pós-verificação (rode manualmente após aplicar, somente leitura) ──
-- SELECT policyname, cmd, roles FROM pg_policies
-- WHERE schemaname = 'storage' AND tablename = 'objects'
-- ORDER BY policyname;
-- Esperado: 4 policies "attachments team *" TO authenticated, nenhuma
-- com USING(true) irrestrito; SELECT id, public FROM storage.buckets
-- WHERE id='attachments' → public = false.
