-- ============================================================
-- Migration 060: check-in da visita, briefing e backups monitorados
-- ============================================================
-- visits:
-- - checkin_at / checkout_at: "Cheguei" / "Saí" no detalhe da visita
--   (o Saí também vira lançamento de horas, source 'visita').
-- - briefing_ia / briefing_em: parágrafo da IA (via Make) que o robô gera
--   no e-mail "Seu dia"; o app só mostra.
-- backup_monitores: um por rotina de backup de cliente. O robô lê os
--   e-mails do rótulo "Backups" do Gmail, acha o monitor pelo
--   identificador (texto do remetente/assunto) e grava o último status.
--   Falha ou silêncio além de max_horas abre pendência (pendencia_id).
--   RLS: mesmo molde de vencimentos (055): admin ou mesma equipe; excluir
--   só admin.
-- Depende de: 042/055 (current_op_is_admin, current_op_team).
-- ============================================================

ALTER TABLE public.visits ADD COLUMN IF NOT EXISTS checkin_at TIMESTAMPTZ;
ALTER TABLE public.visits ADD COLUMN IF NOT EXISTS checkout_at TIMESTAMPTZ;
ALTER TABLE public.visits ADD COLUMN IF NOT EXISTS briefing_ia TEXT;
ALTER TABLE public.visits ADD COLUMN IF NOT EXISTS briefing_em TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.backup_monitores (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  client_name TEXT DEFAULT '',
  team TEXT DEFAULT 'init',
  nome TEXT NOT NULL,                       -- ex.: "Veeam servidor"
  identificador TEXT NOT NULL,              -- texto que aparece no remetente ou assunto
  max_horas INT NOT NULL DEFAULT 48 CHECK (max_horas BETWEEN 1 AND 2160),
  responsavel TEXT DEFAULT '',              -- quem recebe a pendência automática
  ativo BOOLEAN NOT NULL DEFAULT true,
  ultimo_status TEXT,                       -- ok | aviso | falha
  ultimo_em TIMESTAMPTZ,
  ultimo_assunto TEXT,
  historico JSONB NOT NULL DEFAULT '[]'::jsonb,   -- últimos 20 e-mails {em, status, assunto}
  pendencia_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_backup_monitores_client ON public.backup_monitores(client_id);

ALTER TABLE public.backup_monitores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.backup_monitores FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.backup_monitores TO authenticated;

DROP POLICY IF EXISTS backup_monitores_select ON public.backup_monitores;
DROP POLICY IF EXISTS backup_monitores_insert ON public.backup_monitores;
DROP POLICY IF EXISTS backup_monitores_update ON public.backup_monitores;
DROP POLICY IF EXISTS backup_monitores_delete ON public.backup_monitores;
CREATE POLICY backup_monitores_select ON public.backup_monitores FOR SELECT TO authenticated
  USING ((SELECT public.current_op_is_admin()) OR COALESCE(team, 'init') = (SELECT public.current_op_team()));
CREATE POLICY backup_monitores_insert ON public.backup_monitores FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.current_op_is_admin()) OR COALESCE(team, 'init') = (SELECT public.current_op_team()));
CREATE POLICY backup_monitores_update ON public.backup_monitores FOR UPDATE TO authenticated
  USING ((SELECT public.current_op_is_admin()) OR COALESCE(team, 'init') = (SELECT public.current_op_team()))
  WITH CHECK ((SELECT public.current_op_is_admin()) OR COALESCE(team, 'init') = (SELECT public.current_op_team()));
CREATE POLICY backup_monitores_delete ON public.backup_monitores FOR DELETE TO authenticated
  USING ((SELECT public.current_op_is_admin()));

-- VERIFICAÇÃO:
--   SELECT client_name, nome, identificador, ultimo_status, ultimo_em, pendencia_id FROM public.backup_monitores;
