-- 074 — Respostas prontas (macros do chamado)
--
-- O QUE MUDA
--   Tabela nova `respostas_prontas`: textos que a equipe reaproveita ao
--   responder um chamado ("recebemos, vamos verificar", "reinicie o roteador").
--   Por equipe, porque o tom e os procedimentos de cada time são diferentes.
--   `procedure_templates` não serve: é modelo de checklist e não tem `team`.
--
-- COMO VERIFICAR
--   SELECT count(*) FROM public.respostas_prontas;            -- roda sem erro
--   SELECT polname FROM pg_policy
--    WHERE polrelid = 'public.respostas_prontas'::regclass;   -- 4 policies
--
-- ROLLBACK
--   DROP TABLE IF EXISTS public.respostas_prontas;
--   (o app trata a tabela como opcional: sem ela o sync segue e o seletor
--    fica vazio)

CREATE TABLE IF NOT EXISTS public.respostas_prontas (
  id          TEXT PRIMARY KEY,
  titulo      TEXT NOT NULL,
  conteudo    TEXT NOT NULL,
  team        TEXT NOT NULL DEFAULT 'init',
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- O sync resolve conflito por `updated_at` (js/storage.js): sem ela, duas
  -- abas editando a mesma resposta não saberiam qual versão é a mais nova.
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.respostas_prontas ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.respostas_prontas TO authenticated;

DROP POLICY IF EXISTS respostas_prontas_select ON public.respostas_prontas;
DROP POLICY IF EXISTS respostas_prontas_insert ON public.respostas_prontas;
DROP POLICY IF EXISTS respostas_prontas_update ON public.respostas_prontas;
DROP POLICY IF EXISTS respostas_prontas_delete ON public.respostas_prontas;

CREATE POLICY respostas_prontas_select ON public.respostas_prontas FOR SELECT TO authenticated
  USING ((SELECT public.current_op_is_admin()) OR COALESCE(team, 'init') = (SELECT public.current_op_team()));
CREATE POLICY respostas_prontas_insert ON public.respostas_prontas FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.current_op_is_admin()) OR COALESCE(team, 'init') = (SELECT public.current_op_team()));
CREATE POLICY respostas_prontas_update ON public.respostas_prontas FOR UPDATE TO authenticated
  USING ((SELECT public.current_op_is_admin()) OR COALESCE(team, 'init') = (SELECT public.current_op_team()))
  WITH CHECK ((SELECT public.current_op_is_admin()) OR COALESCE(team, 'init') = (SELECT public.current_op_team()));
-- Diferente da triagem, apagar fica com a equipe: a resposta pronta é
-- ferramenta do time, não registro de algo que aconteceu.
CREATE POLICY respostas_prontas_delete ON public.respostas_prontas FOR DELETE TO authenticated
  USING ((SELECT public.current_op_is_admin()) OR COALESCE(team, 'init') = (SELECT public.current_op_team()));

COMMENT ON TABLE public.respostas_prontas IS
  'Textos prontos que a equipe insere ao responder um chamado. Escopo por team.';
