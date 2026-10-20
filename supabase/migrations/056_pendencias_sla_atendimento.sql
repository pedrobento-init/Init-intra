-- ============================================================
-- Migration 056: SLA de primeira resposta e dados do atendimento
-- ============================================================
-- Pendência ganha:
-- - solicitante ........ quem pediu, do lado do cliente (texto livre)
-- - canal .............. por onde chegou: telefone, whatsapp, email,
--                        milvus, presencial, proativo
-- - categoria .......... rede, email, impressora, hardware, software,
--                        acesso, backup, servidor, seguranca, telefonia, outro
-- - first_response_due . até quando alguém da equipe deve dar a 1ª resposta
--                        (calculado no app pela prioridade, em horário
--                        comercial — js/sla.js)
-- - first_response_at/by quando e quem deu a 1ª resposta (nota, cronômetro
--                        ou status saindo de "Aberto")
--
-- O app funciona sem estas colunas: só envia cada campo quando tem valor
-- (optionalFields em js/schema.js). Pendências antigas ficam sem prazo de
-- 1ª resposta e não entram na conta de SLA.
-- RLS: as policies de pendencias (042/055) já cobrem as colunas novas.
-- Depois da 055. Idempotente.
-- ============================================================

ALTER TABLE public.pendencias ADD COLUMN IF NOT EXISTS solicitante TEXT;
ALTER TABLE public.pendencias ADD COLUMN IF NOT EXISTS canal TEXT;
ALTER TABLE public.pendencias ADD COLUMN IF NOT EXISTS categoria TEXT;
ALTER TABLE public.pendencias ADD COLUMN IF NOT EXISTS first_response_due TIMESTAMPTZ;
ALTER TABLE public.pendencias ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMPTZ;
ALTER TABLE public.pendencias ADD COLUMN IF NOT EXISTS first_response_by TEXT;

-- Valores fechados (vazio continua valendo: pendência antiga ou sem informação).
ALTER TABLE public.pendencias DROP CONSTRAINT IF EXISTS pendencias_canal_valido;
ALTER TABLE public.pendencias ADD CONSTRAINT pendencias_canal_valido
  CHECK (canal IS NULL OR canal IN ('telefone', 'whatsapp', 'email', 'milvus', 'presencial', 'proativo'));
ALTER TABLE public.pendencias DROP CONSTRAINT IF EXISTS pendencias_categoria_valida;
ALTER TABLE public.pendencias ADD CONSTRAINT pendencias_categoria_valida
  CHECK (categoria IS NULL OR categoria IN ('rede', 'email', 'impressora', 'hardware', 'software',
    'acesso', 'backup', 'servidor', 'seguranca', 'telefonia', 'outro'));
ALTER TABLE public.pendencias DROP CONSTRAINT IF EXISTS pendencias_solicitante_tamanho;
ALTER TABLE public.pendencias ADD CONSTRAINT pendencias_solicitante_tamanho
  CHECK (solicitante IS NULL OR length(solicitante) <= 120);

-- Relatório de problemas recorrentes: cliente × categoria nos últimos meses.
CREATE INDEX IF NOT EXISTS idx_pendencias_client_categoria_created
  ON public.pendencias (client_id, categoria, created_at DESC) WHERE categoria IS NOT NULL;
-- Painel de 1ª resposta: só as que ainda esperam resposta.
CREATE INDEX IF NOT EXISTS idx_pendencias_first_response_pending
  ON public.pendencias (first_response_due) WHERE first_response_at IS NULL AND first_response_due IS NOT NULL;

-- VERIFICAÇÃO:
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'pendencias'
--      AND column_name IN ('solicitante','canal','categoria','first_response_due','first_response_at','first_response_by');
