-- ============================================================
-- Migration 048: Lançamentos de horas (time_entries)
-- ============================================================
-- PROBLEMA: as horas por período (relatório mensal, cobrança) eram lidas do
-- TEXTO das notas da pendência ("Sessão registrada: 01:20:00"). Funciona,
-- mas qualquer mudança de texto quebra a conta e não dá para corrigir uma
-- sessão errada sem editar nota.
--
-- O QUE MUDA:
-- - Tabela time_entries: uma linha por sessão de trabalho (quem, quando,
--   quanto, em qual pendência/cliente, de onde veio).
-- - O app grava um lançamento a cada pausa, ajuste e conclusão com o
--   cronômetro ligado, e permite lançar/corrigir horas à mão.
-- - Backfill: as sessões já registradas nas notas viram lançamentos
--   (id determinístico: rodar de novo não duplica).
-- RLS: equipe lê e lança; corrigir/excluir só quem lançou ou admin.
-- Depende da 042 (can_see_team, current_op_id, current_op_is_admin).

CREATE TABLE IF NOT EXISTS public.time_entries (
  id TEXT PRIMARY KEY,
  pendencia_id TEXT,
  client_id TEXT,
  operator_id TEXT,
  operator_name TEXT DEFAULT '',
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ NOT NULL,
  seconds INTEGER NOT NULL CHECK (seconds >= 0 AND seconds <= 86400),
  source TEXT NOT NULL DEFAULT 'timer',   -- timer | ajuste | conclusao | manual | notas
  note TEXT DEFAULT '',
  team TEXT DEFAULT 'init',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_time_entries_pen ON public.time_entries(pendencia_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_client_ended ON public.time_entries(client_id, ended_at);
CREATE INDEX IF NOT EXISTS idx_time_entries_updated ON public.time_entries(updated_at DESC);

ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.time_entries FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.time_entries TO authenticated;

DROP POLICY IF EXISTS time_entries_select ON public.time_entries;
DROP POLICY IF EXISTS time_entries_insert ON public.time_entries;
DROP POLICY IF EXISTS time_entries_update ON public.time_entries;
DROP POLICY IF EXISTS time_entries_delete ON public.time_entries;
CREATE POLICY time_entries_select ON public.time_entries FOR SELECT TO authenticated
  USING (public.can_see_team(team));
CREATE POLICY time_entries_insert ON public.time_entries FOR INSERT TO authenticated
  WITH CHECK (public.can_see_team(team));
CREATE POLICY time_entries_update ON public.time_entries FOR UPDATE TO authenticated
  USING (public.current_op_is_admin() OR (public.can_see_team(team) AND operator_id = public.current_op_id()))
  WITH CHECK (public.current_op_is_admin() OR (public.can_see_team(team) AND operator_id = public.current_op_id()));
CREATE POLICY time_entries_delete ON public.time_entries FOR DELETE TO authenticated
  USING (public.current_op_is_admin() OR (public.can_see_team(team) AND operator_id = public.current_op_id()));

-- ── Backfill a partir das notas ("Tempo sessão: 01:20:00" / "Sessão registrada: …") ──
INSERT INTO public.time_entries (id, pendencia_id, client_id, operator_id, operator_name, started_at, ended_at, seconds, source, team, created_at, updated_at)
SELECT
  'TE-n-' || md5(p.id || '|' || (n ->> 'createdAt') || '|' || (n ->> 'text')),
  p.id,
  p.client_id,
  o.id,
  COALESCE(n ->> 'author', ''),
  (n ->> 'createdAt')::timestamptz - make_interval(secs => s.secs),
  (n ->> 'createdAt')::timestamptz,
  s.secs,
  'notas',
  COALESCE(p.team, 'init'),
  now(), now()
FROM public.pendencias p
CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(p.notes) = 'array' THEN p.notes ELSE '[]'::jsonb END) AS n
CROSS JOIN LATERAL (
  SELECT regexp_match(n ->> 'text', '[Ss]ess[ãa]o(?: registrada)?:\s*(\d+):(\d{2}):(\d{2})') AS m
) AS r
CROSS JOIN LATERAL (
  SELECT (r.m[1])::int * 3600 + (r.m[2])::int * 60 + (r.m[3])::int AS secs
) AS s
LEFT JOIN LATERAL (
  SELECT id FROM public.operators WHERE name = n ->> 'author' ORDER BY active DESC NULLS LAST LIMIT 1
) AS o ON true
WHERE r.m IS NOT NULL
  AND (n ->> 'createdAt') IS NOT NULL
  AND s.secs > 0 AND s.secs <= 86400
ON CONFLICT (id) DO NOTHING;

-- Realtime
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'time_entries') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.time_entries;
  END IF;
END $$;
