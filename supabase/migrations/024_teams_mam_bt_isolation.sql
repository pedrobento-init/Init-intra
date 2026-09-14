-- ============================================================
-- 024: Isolamento MAM x BT (escopo MÍNIMO) — PODE APLICAR
-- ============================================================
-- OBJETIVO: operador do time MAM vê só pendências do cliente MAM;
-- operador do time BT vê só as do cliente BT. Admin (is_admin) vê tudo.
--
-- POR QUE ESTA MIGRATION É NECESSÁRIA (não dá p/ resolver só com dados):
-- 1. O baseline (supabase/migration.sql:46,103,160) criou policies
--    `"operators all"`, `"clients all"`, `"pendencias all"`
--    `FOR ALL USING (true) WITH CHECK (true)` SEM cláusula TO (= PUBLIC).
--    Policies permissivas combinam por OU: essas 3 anulam completamente
--    as policies por equipe da 011 (pens_select, clients_select, ...).
--    Hoje, no banco, QUALQUER authenticated lê/escreve TUDO.
-- 2. A 021 remove essas policies, mas está marcada "NÃO APLICAR"
--    (revisão C2 pendente, mexe em visits/reunioes/procedures/templates).
--    Esta 024 faz SÓ o recorte operators/clients/pendencias.
--
-- O QUE MUDA / NÃO MUDA:
-- - REMOVE: "operators all", "clients all", "pendencias all".
-- - RECRIA (idempotente, definição idêntica à 011): helpers
--   current_op_is_admin/current_op_team/current_op_id + policies
--   ops_*, clients_*, pens_* (admin OU mesma equipe; delete só admin).
-- - NÃO TOCA: visits, reunioes, procedures, templates, tickets,
--   audit_logs, storage, functions de cron, current_op_team() default
--   'init' (fail-closed total fica p/ a 023, quando aprovada).
-- - DADOS: alinha pendencias.team ao team do cliente (herança que o app
--   já faz em savePendencia, storage.js:944-949) e atribui team aos
--   clientes MAM/BT por nome (bloco §4, com travas de segurança).
--
-- COMO APLICAR (você, no Supabase SQL Editor, como postgres/service_role):
-- 1. Backup/snapshot do projeto.
-- 2. Rode o bloco §0 (só leitura) e confira o ANTES.
-- 3. Rode os blocos §1→§4 nesta ordem.
-- 4. Rode o bloco §5 e confira o DEPOIS + plano de teste no fim.
-- ROLLBACK: policies recriáveis a partir da 011 + migration.sql
-- (guarde a saída do §0).
-- ============================================================

-- ── §0. VERIFICAÇÃO DO ANTES (somente leitura) ─────────────────
-- -- 0a. Policies abertas que anulam o isolamento (esperado ANTES: 3 linhas):
-- SELECT tablename, policyname, cmd, roles, qual, with_check
-- FROM pg_policies WHERE schemaname = 'public'
--   AND policyname IN ('operators all', 'clients all', 'pendencias all')
-- ORDER BY tablename;
-- -- 0b. Policies por equipe vigentes (esperado ANTES: as da 011, se aplicada):
-- SELECT tablename, policyname, cmd FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename IN ('operators', 'clients', 'pendencias')
-- ORDER BY tablename, policyname;
-- -- 0c. Distribuição de teams (antes de configurar MAM/BT):
-- SELECT team, count(*) FROM public.clients GROUP BY team ORDER BY team;
-- SELECT team, count(*) FROM public.pendencias GROUP BY team ORDER BY team;
-- SELECT team, count(*) FROM public.operators GROUP BY team ORDER BY team;
-- -- 0d. Clientes candidatos a MAM/BT (confira IDs antes do §4):
-- SELECT id, name, team FROM public.clients
-- WHERE name ILIKE '%MAM%' OR name ILIKE '%BT%' OR name ILIKE '%B_T%';

-- ── §1. Remove as policies totalmente abertas ──────────────────
DROP POLICY IF EXISTS "operators all" ON public.operators;
DROP POLICY IF EXISTS "clients all" ON public.clients;
DROP POLICY IF EXISTS "pendencias all" ON public.pendencias;

-- ── §2. Garante helpers + policies por equipe (definição da 011) ──
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

GRANT EXECUTE ON FUNCTION public.current_op_is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_op_team() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_op_id() TO authenticated;

ALTER TABLE public.operators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pendencias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ops_select" ON public.operators;
DROP POLICY IF EXISTS "ops_insert" ON public.operators;
DROP POLICY IF EXISTS "ops_update" ON public.operators;
DROP POLICY IF EXISTS "ops_delete" ON public.operators;
CREATE POLICY "ops_select" ON public.operators
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "ops_insert" ON public.operators
  FOR INSERT TO authenticated WITH CHECK (
    public.current_op_is_admin()
    OR (auth_user_id = auth.uid() AND COALESCE(is_admin, false) = false));
CREATE POLICY "ops_update" ON public.operators
  FOR UPDATE TO authenticated
  USING (public.current_op_is_admin() OR auth_user_id = auth.uid())
  WITH CHECK (public.current_op_is_admin()
    OR (auth_user_id = auth.uid() AND COALESCE(is_admin, false) = false
        AND COALESCE(active, true) = true));
CREATE POLICY "ops_delete" ON public.operators
  FOR DELETE TO authenticated USING (public.current_op_is_admin());

DROP POLICY IF EXISTS "clients_select" ON public.clients;
DROP POLICY IF EXISTS "clients_insert" ON public.clients;
DROP POLICY IF EXISTS "clients_update" ON public.clients;
DROP POLICY IF EXISTS "clients_delete" ON public.clients;
CREATE POLICY "clients_select" ON public.clients
  FOR SELECT TO authenticated
  USING (public.current_op_is_admin()
    OR COALESCE(team, 'init') = public.current_op_team());
CREATE POLICY "clients_insert" ON public.clients
  FOR INSERT TO authenticated
  WITH CHECK (public.current_op_is_admin()
    OR COALESCE(team, 'init') = public.current_op_team());
CREATE POLICY "clients_update" ON public.clients
  FOR UPDATE TO authenticated
  USING (public.current_op_is_admin()
    OR COALESCE(team, 'init') = public.current_op_team())
  WITH CHECK (public.current_op_is_admin()
    OR COALESCE(team, 'init') = public.current_op_team());
CREATE POLICY "clients_delete" ON public.clients
  FOR DELETE TO authenticated USING (public.current_op_is_admin());

DROP POLICY IF EXISTS "pens_select" ON public.pendencias;
DROP POLICY IF EXISTS "pens_insert" ON public.pendencias;
DROP POLICY IF EXISTS "pens_update" ON public.pendencias;
DROP POLICY IF EXISTS "pens_delete" ON public.pendencias;
CREATE POLICY "pens_select" ON public.pendencias
  FOR SELECT TO authenticated
  USING (public.current_op_is_admin()
    OR COALESCE(team, 'init') = public.current_op_team());
CREATE POLICY "pens_insert" ON public.pendencias
  FOR INSERT TO authenticated
  WITH CHECK (public.current_op_is_admin()
    OR COALESCE(team, 'init') = public.current_op_team());
CREATE POLICY "pens_update" ON public.pendencias
  FOR UPDATE TO authenticated
  USING (public.current_op_is_admin()
    OR COALESCE(team, 'init') = public.current_op_team())
  WITH CHECK (public.current_op_is_admin()
    OR COALESCE(team, 'init') = public.current_op_team());
CREATE POLICY "pens_delete" ON public.pendencias
  FOR DELETE TO authenticated USING (public.current_op_is_admin());

-- ── §3. Backfill: pendencia herda team do cliente ─────────────
-- Regra da cadeia operador→time→cliente→pendência. Sem isso, pendências
-- antigas team='init' ficariam invisíveis p/ MAM/BT (fail-closed) após o §1.
-- Idempotente: só toca linhas divergentes do cliente.
UPDATE public.pendencias p
SET team = c.team, updated_at = now()
FROM public.clients c
WHERE p.client_id = c.id
  AND p.team IS DISTINCT FROM c.team;

-- ── §4. Atribui team aos clientes MAM e BT (por nome, com travas) ──
-- TRAVAS: só atualiza se existir EXATAMENTE 1 cliente com aquele nome
-- (evita atingir o cliente errado). Ajuste os nomes se necessário.
-- Rode o §0d antes e confira os NOTICE ao final.
DO $$
DECLARE
  v_mam_id text; v_mam_n int;
  v_bt_id text;  v_bt_n int;
BEGIN
  SELECT count(*), max(id) INTO v_mam_n, v_mam_id
  FROM public.clients WHERE name ILIKE 'MAM';
  SELECT count(*), max(id) INTO v_bt_n, v_bt_id
  FROM public.clients WHERE name ILIKE 'BT';

  IF v_mam_n = 1 THEN
    UPDATE public.clients SET team = 'mam', updated_at = now()
    WHERE id = v_mam_id AND COALESCE(team, 'init') IS DISTINCT FROM 'mam';
    -- Propaga p/ pendências desse cliente (mesma regra do §3, escopo certo)
    UPDATE public.pendencias SET team = 'mam', updated_at = now()
    WHERE client_id = v_mam_id AND COALESCE(team, 'init') IS DISTINCT FROM 'mam';
    RAISE NOTICE 'Cliente MAM (%) configurado p/ team=mam.', v_mam_id;
  ELSE
    RAISE NOTICE 'MAM: % cliente(s) com esse nome — NADA alterado. Liste com o §0d e ajuste.', v_mam_n;
  END IF;

  IF v_bt_n = 1 THEN
    UPDATE public.clients SET team = 'bt', updated_at = now()
    WHERE id = v_bt_id AND COALESCE(team, 'init') IS DISTINCT FROM 'bt';
    UPDATE public.pendencias SET team = 'bt', updated_at = now()
    WHERE client_id = v_bt_id AND COALESCE(team, 'init') IS DISTINCT FROM 'bt';
    RAISE NOTICE 'Cliente BT (%) configurado p/ team=bt.', v_bt_id;
  ELSE
    RAISE NOTICE 'BT: % cliente(s) com esse nome — NADA alterado. Liste com o §0d e ajuste.', v_bt_n;
  END IF;
END $$;

-- ── §5. VERIFICAÇÃO DO DEPOIS (somente leitura) ─────────────────
-- -- 5a. Policies abertas removidas (esperado: 0 linhas):
-- SELECT tablename, policyname FROM pg_policies
-- WHERE schemaname = 'public'
--   AND policyname IN ('operators all', 'clients all', 'pendencias all');
-- -- 5b. Policies por equipe presentes (esperado: 4+4+4 = 12 linhas):
-- SELECT tablename, policyname, cmd FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename IN ('operators', 'clients', 'pendencias')
-- ORDER BY tablename, policyname;
-- -- 5c. Distribuição final (esperado: MAM e BT com team próprio):
-- SELECT team, count(*) FROM public.clients GROUP BY team ORDER BY team;
-- SELECT team, count(*) FROM public.pendencias GROUP BY team ORDER BY team;
-- SELECT team, count(*) FROM public.operators GROUP BY team ORDER BY team;
-- -- 5d. Órfãs de cadeia (esperado: 0 linhas — pendência fora do team do cliente):
-- SELECT p.id, p.client_id, p.team AS pen_team, c.team AS cli_team
-- FROM public.pendencias p JOIN public.clients c ON c.id = p.client_id
-- WHERE p.team IS DISTINCT FROM c.team;
-- -- 5e. Operadores sem vínculo Auth (não terão acesso via RLS até vincular):
-- SELECT id, name, email, team, auth_user_id FROM public.operators
-- WHERE auth_user_id IS NULL;

-- ============================================================
-- PLANO DE TESTE (após §5 OK + operadores criados/vinculados)
-- Crie OPERADOR_MAM (team=mam, is_admin=false) e OPERADOR_BT
-- (team=bt, is_admin=false) pelo app (cadastro já tem select de
-- equipe, operadores.js:318) e vincule o login Supabase no 1º acesso.
--
-- NO APP, logado como OPERADOR_MAM:
-- [ ] lista só pendências MAM (nenhuma BT)
-- [ ] abre pendência MAM; ID de pendência BT não abre (RLS filtra)
-- [ ] criar pendência p/ cliente BT é bloqueado (form + RLS)
-- [ ] editar cliente/pendência BT é bloqueado
-- [ ] excluir: qualquer operador não-admin já não exclui (pens_delete
--     = só admin — regra preservada, não ampliada)
-- Repetir invertido como OPERADOR_BT. Admin segue vendo tudo.
--
-- DIRETO NO BANCO (logado como cada operador, via app/supabase-js
-- com o JWT dele — RLS avalia auth.uid()):
-- [ ] SELECT * FROM pendencias → só as do próprio team
-- [ ] SELECT por ID de outro team → 0 linhas
-- [ ] INSERT com team de outro team → erro 42501 (violates RLS)
-- [ ] UPDATE mudando team p/ outro team → erro 42501
-- [ ] DELETE de outro team → 0 linhas afetadas / erro
-- NOTA: teste "direto" precisa do contexto JWT do operador; pelo
-- SQL Editor (postgres, bypass RLS) use apenas os SELECTs do §5.
-- ============================================================
