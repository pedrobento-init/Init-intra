-- ============================================================
-- 037: Pendências tipo Gestão — visível só para Felipe e Joarli
-- ============================================================
-- OBJETIVO: criar o tipo de ação "Gestão" com restrição real:
-- só operadores Gestão veem/criam/editam pendências com tipo Gestão.
-- Gestão = operators.is_gestao = true (backfill Felipe + Joarli).
-- Pedro fica de FORA por definição (só Felipe e Joarli).
--
-- POR QUE NÃO SÓ FRONTEND: o app é offline-first (Dexie + sync + Realtime).
-- Esconder na tela sem RLS deixa legível via API/console com anon-key + JWT.
--
-- O QUE MUDA:
-- - operators: ADD COLUMN is_gestao BOOLEAN DEFAULT false + backfill por nome.
-- - helper current_op_is_gestao() (SECURITY DEFINER).
-- - pendencias: recria pens_select/insert/update/delete com trava Gestão,
--   removendo antes a policy permissiva "pendencias all" (mesma causa da 024).
-- - NÃO TOCA: teams, clients, operators select, outras tabelas.
--
-- COMO APLICAR (Supabase SQL Editor, como postgres/service_role):
-- 1. Backup/snapshot.
-- 2. Rode este arquivo inteiro.
-- 3. Confira o §5 (verificação) + plano de teste no fim.
-- ROLLBACK: UPDATE operators SET is_gestao=false; policies recriáveis pela
-- 011/024 (definição original sem a trava Gestão está nos comentários §2).
-- ============================================================

-- ── §1. Coluna is_gestao + backfill Felipe/Joarli ─────────────
ALTER TABLE public.operators ADD COLUMN IF NOT EXISTS is_gestao BOOLEAN DEFAULT false;

-- Backfill nominal (idempotente): só promove quem casa com os nomes.
-- Ajuste se os nomes em produção tiverem sobrenome (ILIKE com % cobre).
UPDATE public.operators
SET is_gestao = true, updated_at = now()
WHERE (name ILIKE '%felipe%' OR name ILIKE '%joarli%')
  AND COALESCE(is_gestao, false) IS DISTINCT FROM true;

-- ── §2. Helpers (idempotentes, mesma definição da 024 + novo) ──
CREATE OR REPLACE FUNCTION public.current_op_is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (
  SELECT 1 FROM public.operators o
  WHERE o.auth_user_id = auth.uid()
    AND o.is_admin = true AND COALESCE(o.active, true) = true
); $$;

CREATE OR REPLACE FUNCTION public.current_op_team()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT COALESCE(
  (SELECT o.team FROM public.operators o WHERE o.auth_user_id = auth.uid() LIMIT 1),
  'init'
); $$;

CREATE OR REPLACE FUNCTION public.current_op_id()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT o.id FROM public.operators o WHERE o.auth_user_id = auth.uid() LIMIT 1; $$;

-- Novo: Gestão = flag is_gestao + ativo. Pedro não tem a flag → não vê Gestão.
CREATE OR REPLACE FUNCTION public.current_op_is_gestao()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (
  SELECT 1 FROM public.operators o
  WHERE o.auth_user_id = auth.uid()
    AND COALESCE(o.is_gestao, false) = true
    AND COALESCE(o.active, true) = true
); $$;

GRANT EXECUTE ON FUNCTION public.current_op_is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_op_team() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_op_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_op_is_gestao() TO authenticated;

ALTER TABLE public.pendencias ENABLE ROW LEVEL SECURITY;

-- Remove policy totalmente aberta (causa raiz da 024; OU permissivo anula o resto).
DROP POLICY IF EXISTS "pendencias all" ON public.pendencias;

-- ── §3. Policies de pendências com trava Gestão ────────────────
-- Lógica: se tipo é Gestão/Gestao → exige is_gestao; senão → regra por equipe
-- (admin OU mesma equipe). Delete: Gestão exige is_gestao; demais exigem admin.
DROP POLICY IF EXISTS "pens_select" ON public.pendencias;
DROP POLICY IF EXISTS "pens_insert" ON public.pendencias;
DROP POLICY IF EXISTS "pens_update" ON public.pendencias;
DROP POLICY IF EXISTS "pens_delete" ON public.pendencias;

CREATE POLICY "pens_select" ON public.pendencias
  FOR SELECT TO authenticated
  USING (
    CASE WHEN COALESCE(tipo, '') IN ('Gestão', 'Gestao')
      THEN public.current_op_is_gestao()
      ELSE (public.current_op_is_admin()
        OR COALESCE(team, 'init') = public.current_op_team())
    END
  );

CREATE POLICY "pens_insert" ON public.pendencias
  FOR INSERT TO authenticated
  WITH CHECK (
    CASE WHEN COALESCE(tipo, '') IN ('Gestão', 'Gestao')
      THEN public.current_op_is_gestao()
      ELSE (public.current_op_is_admin()
        OR COALESCE(team, 'init') = public.current_op_team())
    END
  );

CREATE POLICY "pens_update" ON public.pendencias
  FOR UPDATE TO authenticated
  USING (
    CASE WHEN COALESCE(tipo, '') IN ('Gestão', 'Gestao')
      THEN public.current_op_is_gestao()
      ELSE (public.current_op_is_admin()
        OR COALESCE(team, 'init') = public.current_op_team())
    END
  )
  WITH CHECK (
    CASE WHEN COALESCE(tipo, '') IN ('Gestão', 'Gestao')
      THEN public.current_op_is_gestao()
      ELSE (public.current_op_is_admin()
        OR COALESCE(team, 'init') = public.current_op_team())
    END
  );

CREATE POLICY "pens_delete" ON public.pendencias
  FOR DELETE TO authenticated
  USING (
    CASE WHEN COALESCE(tipo, '') IN ('Gestão', 'Gestao')
      THEN public.current_op_is_gestao()
      ELSE public.current_op_is_admin()
    END
  );

-- ── §4. Verificação do depois (somente leitura) ────────────────
-- -- 4a. Coluna + backfill (esperado: Felipe e Joarli com is_gestao=true, Pedro false):
-- SELECT id, name, email, team, is_admin, is_gestao, active, auth_user_id
-- FROM public.operators
-- WHERE name ILIKE '%felipe%' OR name ILIKE '%joarli%' OR name ILIKE '%pedro%'
-- ORDER BY name;
-- -- 4b. Policy aberta removida (esperado: 0 linhas):
-- SELECT tablename, policyname FROM pg_policies
-- WHERE schemaname = 'public' AND policyname = 'pendencias all';
-- -- 4c. Policies Gestão presentes (esperado: 4 linhas pens_*):
-- SELECT tablename, policyname, cmd FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'pendencias'
-- ORDER BY policyname;
-- -- 4d. Tipos em uso (esperado: Gestão aparece após o app criar a primeira):
-- SELECT tipo, count(*) FROM public.pendencias GROUP BY tipo ORDER BY tipo;

-- ============================================================
-- PLANO DE TESTE (após §4 OK + logins vinculados)
-- Logado como FELIPE ou JOARLI (is_gestao=true):
-- [ ] cria pendência tipo Gestão (form mostra a opção)
-- [ ] lista/busca/calendário/dashboard mostram a Gestão
-- [ ] edita/exclui a Gestão
-- Logado como PEDRO ou qualquer outro (is_gestao=false):
-- [ ] form Nova Pendência NÃO mostra a opção Gestão
-- [ ] lista/busca/calendário/dashboard NÃO mostram Gestão (contadores idem)
-- [ ] abrir detalhe por ID de Gestão mostra "Acesso restrito à Gestão"
-- [ ] criar via reunião com tipo Gestão é bloqueado
-- DIRETO NO BANCO (JWT do operador, RLS avalia auth.uid()):
-- [ ] SELECT * FROM pendencias → não-Gestão não retorna linhas tipo Gestão
-- [ ] SELECT por ID Gestão como não-Gestão → 0 linhas
-- [ ] INSERT tipo='Gestão' como não-Gestão → erro 42501
-- [ ] UPDATE para tipo='Gestão' como não-Gestão → erro 42501
-- [ ] Felipe/Joarli passam em todos acima.
-- NOTA: pelo SQL Editor (postgres, bypass RLS) use só os SELECTs do §4.
-- ============================================================
