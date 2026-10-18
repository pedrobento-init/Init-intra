-- ============================================================
-- Migration 049: Pessoas por id (não só pelo nome)
-- ============================================================
-- PROBLEMA: visitas (operator), pendências (responsible, timer_operator) e
-- vencimentos (responsavel) guardavam o NOME da pessoa. Renomear alguém
-- deixava os registros antigos órfãos ("minha fila" vazia, contagens
-- erradas, link da agenda sem visitas); dois operadores com o mesmo nome
-- se misturavam.
--
-- O QUE MUDA:
-- - Colunas de id ao lado de cada nome, preenchidas pelo backfill.
-- - Trigger: a cada gravação o id é derivado do nome enviado (o app — até
--   versões antigas em cache — continua mandando só o nome; nada quebra).
-- - Renomear um operador reescreve o nome em todos os registros dele (pelo
--   id) e avança updated_at, para os aparelhos receberem no próximo sync.
-- - Nome de operador ATIVO passa a ser único (o app também valida).
--   Se já houver nomes repetidos, o índice não é criado e a migration avisa
--   (NOTICE) — renomeie um deles e rode de novo.
-- Depende de: 045 (vencimentos), 048 (time_entries).

ALTER TABLE public.visits ADD COLUMN IF NOT EXISTS operator_id TEXT;
ALTER TABLE public.pendencias ADD COLUMN IF NOT EXISTS responsible_id TEXT;
ALTER TABLE public.pendencias ADD COLUMN IF NOT EXISTS timer_operator_id TEXT;
DO $$ BEGIN
  IF to_regclass('public.vencimentos') IS NOT NULL THEN
    ALTER TABLE public.vencimentos ADD COLUMN IF NOT EXISTS responsavel_id TEXT;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_visits_operator_id ON public.visits(operator_id);
CREATE INDEX IF NOT EXISTS idx_pendencias_responsible_id ON public.pendencias(responsible_id);

-- Id do operador pelo nome (sem acento/caixa/espaços extras). Ambíguo → NULL.
CREATE OR REPLACE FUNCTION public.op_id_by_name(p_name text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH c AS (
    SELECT id, COALESCE(active, true) AS active FROM public.operators
    WHERE lower(btrim(name)) = lower(btrim(p_name)) AND btrim(COALESCE(p_name, '')) <> ''
  )
  SELECT CASE
    WHEN (SELECT count(*) FROM c WHERE active) = 1 THEN (SELECT id FROM c WHERE active)
    WHEN (SELECT count(*) FROM c WHERE active) = 0 AND (SELECT count(*) FROM c) = 1 THEN (SELECT id FROM c)
    ELSE NULL
  END
$$;
REVOKE ALL ON FUNCTION public.op_id_by_name(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.op_id_by_name(text) TO authenticated;

-- ── Triggers: id sempre derivado do nome gravado ─────────────
CREATE OR REPLACE FUNCTION public.visits_sync_operator_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN
  NEW.operator_id := CASE WHEN btrim(COALESCE(NEW.operator, '')) = '' THEN NULL ELSE public.op_id_by_name(NEW.operator) END;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_visits_operator_id ON public.visits;
CREATE TRIGGER trg_visits_operator_id BEFORE INSERT OR UPDATE OF operator, operator_id ON public.visits
  FOR EACH ROW EXECUTE FUNCTION public.visits_sync_operator_id();

CREATE OR REPLACE FUNCTION public.pendencias_sync_operator_ids()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN
  NEW.responsible_id := CASE WHEN btrim(COALESCE(NEW.responsible, '')) = '' THEN NULL ELSE public.op_id_by_name(NEW.responsible) END;
  NEW.timer_operator_id := CASE WHEN btrim(COALESCE(NEW.timer_operator, '')) = '' THEN NULL ELSE public.op_id_by_name(NEW.timer_operator) END;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_pendencias_operator_ids ON public.pendencias;
CREATE TRIGGER trg_pendencias_operator_ids BEFORE INSERT OR UPDATE OF responsible, timer_operator, responsible_id, timer_operator_id ON public.pendencias
  FOR EACH ROW EXECUTE FUNCTION public.pendencias_sync_operator_ids();

CREATE OR REPLACE FUNCTION public.vencimentos_sync_responsavel_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN
  NEW.responsavel_id := CASE WHEN btrim(COALESCE(NEW.responsavel, '')) = '' THEN NULL ELSE public.op_id_by_name(NEW.responsavel) END;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF to_regclass('public.vencimentos') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_vencimentos_responsavel_id ON public.vencimentos;
    CREATE TRIGGER trg_vencimentos_responsavel_id BEFORE INSERT OR UPDATE OF responsavel, responsavel_id ON public.vencimentos
      FOR EACH ROW EXECUTE FUNCTION public.vencimentos_sync_responsavel_id();
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.visits_sync_operator_id() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pendencias_sync_operator_ids() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vencimentos_sync_responsavel_id() FROM PUBLIC, anon, authenticated;

-- ── Renomear operador: nome novo em todos os registros dele ──
CREATE OR REPLACE FUNCTION public.operators_cascade_rename()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name AND btrim(COALESCE(NEW.name, '')) <> '' THEN
    UPDATE public.visits SET operator = NEW.name, updated_at = now() WHERE operator_id = NEW.id;
    UPDATE public.pendencias SET responsible = NEW.name, updated_at = now() WHERE responsible_id = NEW.id;
    UPDATE public.pendencias SET timer_operator = NEW.name, updated_at = now() WHERE timer_operator_id = NEW.id;
    IF to_regclass('public.vencimentos') IS NOT NULL THEN
      UPDATE public.vencimentos SET responsavel = NEW.name, updated_at = now() WHERE responsavel_id = NEW.id;
    END IF;
    IF to_regclass('public.time_entries') IS NOT NULL THEN
      UPDATE public.time_entries SET operator_name = NEW.name, updated_at = now() WHERE operator_id = NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.operators_cascade_rename() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_operators_cascade_rename ON public.operators;
CREATE TRIGGER trg_operators_cascade_rename AFTER UPDATE OF name ON public.operators
  FOR EACH ROW EXECUTE FUNCTION public.operators_cascade_rename();

-- ── Backfill (dispara os triggers acima; não mexe em updated_at) ──
UPDATE public.visits SET operator = operator WHERE operator IS NOT NULL AND operator_id IS NULL;
UPDATE public.pendencias SET responsible = responsible WHERE (responsible IS NOT NULL AND responsible_id IS NULL) OR (timer_operator IS NOT NULL AND timer_operator_id IS NULL);
DO $$ BEGIN
  IF to_regclass('public.vencimentos') IS NOT NULL THEN
    UPDATE public.vencimentos SET responsavel = responsavel WHERE responsavel IS NOT NULL AND responsavel <> '' AND responsavel_id IS NULL;
  END IF;
END $$;

-- ── Nome único entre ativos ──────────────────────────────────
DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS uq_operators_active_name ON public.operators (lower(btrim(name))) WHERE COALESCE(active, true);
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'Há operadores ATIVOS com o mesmo nome — índice único não criado. Veja: SELECT lower(btrim(name)), count(*) FROM operators WHERE COALESCE(active,true) GROUP BY 1 HAVING count(*) > 1;';
END $$;

-- ── VERIFICAÇÃO ──────────────────────────────────────────────
-- Registros com nome que não bate com nenhum operador (esperado: poucos/0):
--   SELECT 'visita' t, operator n, count(*) FROM visits WHERE operator <> '' AND operator_id IS NULL GROUP BY 2
--   UNION ALL SELECT 'pendencia', responsible, count(*) FROM pendencias WHERE responsible <> '' AND responsible_id IS NULL GROUP BY 2;
