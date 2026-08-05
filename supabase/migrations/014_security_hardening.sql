-- ============================================================
-- 014: Hardening de segurança (login + RLS + colunas sensíveis)
-- Execute no Supabase SQL Editor após 011
-- ============================================================

-- 1) Helpers já existem em 011; reforça grants mínimos
GRANT EXECUTE ON FUNCTION public.current_op_is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_op_team() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_op_id() TO authenticated;

-- 2) OPERATORS — impedir auto-promoção e auto-cadastro livre
ALTER TABLE public.operators ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ops_select" ON public.operators;
DROP POLICY IF EXISTS "ops_insert" ON public.operators;
DROP POLICY IF EXISTS "ops_update" ON public.operators;
DROP POLICY IF EXISTS "ops_delete" ON public.operators;

-- Leitura: autenticados (dropdowns / sync).
-- pin_hash/pin_salt devem ser omitidos no SELECT do app (js/auth.js, storage.js).
CREATE POLICY "ops_select" ON public.operators
  FOR SELECT TO authenticated
  USING (true);

-- Insert: SOMENTE admin (sem auto-cadastro no 1º login)
CREATE POLICY "ops_insert" ON public.operators
  FOR INSERT TO authenticated
  WITH CHECK (public.current_op_is_admin());

-- Update: admin qualquer; usuário o próprio (por auth_user_id ou e-mail no 1º vínculo)
CREATE POLICY "ops_update" ON public.operators
  FOR UPDATE TO authenticated
  USING (
    public.current_op_is_admin()
    OR auth_user_id = auth.uid()
    OR (
      auth_user_id IS NULL
      AND email IS NOT NULL
      AND lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  )
  WITH CHECK (
    public.current_op_is_admin()
    OR (
      (
        auth_user_id = auth.uid()
        OR (
          auth_user_id IS NULL
          AND email IS NOT NULL
          AND lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        )
      )
      AND COALESCE(is_admin, false) = false
      AND COALESCE(active, true) = true
    )
  );

CREATE POLICY "ops_delete" ON public.operators
  FOR DELETE TO authenticated
  USING (public.current_op_is_admin());

-- 3) Trigger: não-admin não pode alterar is_admin / active / team / auth_user_id de si
CREATE OR REPLACE FUNCTION public.operators_guard_self_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.current_op_is_admin() THEN
    RETURN NEW;
  END IF;

  NEW.is_admin := OLD.is_admin;
  NEW.active := OLD.active;
  NEW.team := OLD.team;
  NEW.pin_hash := OLD.pin_hash;
  NEW.pin_salt := OLD.pin_salt;

  -- Só permite setar auth_user_id se estava nulo e é o próprio uid
  IF OLD.auth_user_id IS NULL AND NEW.auth_user_id IS NOT DISTINCT FROM auth.uid() THEN
    NULL;
  ELSE
    NEW.auth_user_id := OLD.auth_user_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_operators_guard_self_update ON public.operators;
CREATE TRIGGER trg_operators_guard_self_update
  BEFORE UPDATE ON public.operators
  FOR EACH ROW
  EXECUTE FUNCTION public.operators_guard_self_update();

-- 4) CLIENTS / PENDENCIAS / VISITS — mantém filtro por time (011)
-- Reforça: DELETE só admin

DROP POLICY IF EXISTS "clients_delete" ON public.clients;
CREATE POLICY "clients_delete" ON public.clients
  FOR DELETE TO authenticated
  USING (public.current_op_is_admin());

DROP POLICY IF EXISTS "pens_delete" ON public.pendencias;
CREATE POLICY "pens_delete" ON public.pendencias
  FOR DELETE TO authenticated
  USING (public.current_op_is_admin());

DO $$
BEGIN
  IF to_regclass('public.visits') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "visits_delete" ON public.visits';
    EXECUTE $p$
      CREATE POLICY "visits_delete" ON public.visits
        FOR DELETE TO authenticated
        USING (public.current_op_is_admin())
    $p$;
  END IF;
END $$;

-- 5) PROCEDURES / TEMPLATES — write autenticado; delete admin
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['procedures', 'procedure_templates']
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "%s_select" ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "%s_write" ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "%s_insert" ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "%s_update" ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "%s_delete" ON public.%I', t, t);

    EXECUTE format(
      'CREATE POLICY "%s_select" ON public.%I FOR SELECT TO authenticated USING (true)',
      t, t
    );
    EXECUTE format(
      'CREATE POLICY "%s_insert" ON public.%I FOR INSERT TO authenticated WITH CHECK (true)',
      t, t
    );
    EXECUTE format(
      'CREATE POLICY "%s_update" ON public.%I FOR UPDATE TO authenticated USING (true) WITH CHECK (true)',
      t, t
    );
    EXECUTE format(
      'CREATE POLICY "%s_delete" ON public.%I FOR DELETE TO authenticated USING (public.current_op_is_admin())',
      t, t
    );
  END LOOP;
END $$;

-- 6) AUDIT_LOGS — insert auth; select/delete admin
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "logs_select" ON public.audit_logs;
DROP POLICY IF EXISTS "logs_insert" ON public.audit_logs;
DROP POLICY IF EXISTS "logs_delete" ON public.audit_logs;
DROP POLICY IF EXISTS "Admins can select audit_logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Admins can delete audit_logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Authenticated users can insert audit_logs" ON public.audit_logs;

CREATE POLICY "logs_select" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (public.current_op_is_admin());

CREATE POLICY "logs_insert" ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "logs_delete" ON public.audit_logs
  FOR DELETE TO authenticated
  USING (public.current_op_is_admin());

-- 7) Revoga acesso anônimo (sem login) às tabelas públicas
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'clients','pendencias','operators','visits','procedures',
    'procedure_templates','audit_logs','tickets'
  ]
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    END IF;
  END LOOP;
END $$;

-- 8) Comentário operacional (Auth Settings no Dashboard):
--    - Disable public signups (apenas admin cria usuários)
--    - Enable email confirmations (recomendado)
--    - Minimum password length >= 8
--    - Enable leaked password protection se disponível
