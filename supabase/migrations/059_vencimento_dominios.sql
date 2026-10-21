-- ============================================================
-- Migration 059: Checagem de domínios (RDAP) dos vencimentos
-- ============================================================
-- Toda madrugada o robô (Apps Script → Edge Function robo, ação
-- "dominios") procura o domínio citado em cada vencimento do tipo
-- "dominio", consulta a data de expiração no registro público (RDAP) e
-- grava aqui. O resumo diário avisa os admins quando o registro discorda
-- do cadastro por mais de 1 dia.
-- Sem policy: só service_role (a Edge Function) lê e grava.
-- Depende de: 045 (vencimentos).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.vencimento_dominios (
  vencimento_id TEXT PRIMARY KEY REFERENCES public.vencimentos(id) ON DELETE CASCADE,
  dominio TEXT NOT NULL,
  expira_registro DATE,
  erro TEXT,
  verificado_em TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.vencimento_dominios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vencimento_dominios FROM anon, authenticated;

-- VERIFICAÇÃO:
--   SELECT d.dominio, v.data_vencimento AS cadastro, d.expira_registro AS registro, d.erro
--     FROM public.vencimento_dominios d JOIN public.vencimentos v ON v.id = d.vencimento_id;
