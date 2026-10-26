-- ============================================================
-- Migration 066: nada que chega por e-mail se perde
-- ============================================================
-- A triagem descartava em silêncio duas coisas, e as duas eram pedido de
-- cliente:
--
-- 1. E-mail sem cliente (robo/index.ts: `if (!c) { semCliente.push(...) }`).
--    O domínio não casou com nenhuma ficha, ou a pessoa escreveu de um Gmail
--    pessoal — que NUNCA casa, de propósito. O assunto ia para o JSON que o
--    robô devolve ao Apps Script, e ninguém lê aquele JSON. Cliente novo
--    mandava e-mail e não acontecia nada: nem chamado, nem registro.
--
-- 2. E-mail que a IA marcou `ignorar` (propaganda, aviso automático). A conta
--    subia em `ignorados++` e a mensagem sumia. Quando o Make erra — e ele
--    erra — um pedido real some com ela, e não há como descobrir.
--
-- Agora as duas viram linha aqui. Não é fila de trabalho: é o registro do que
-- chegou e NÃO virou chamado, para alguém olhar e decidir. Por isso `status`
-- tem `descartado`: fechar a entrada é uma decisão de gente, que fica
-- registrada com quem decidiu — diferente de sumir.
--
-- Pendência ganha também:
-- - email_corpo ... o e-mail inteiro, já sem citação e sem assinatura. A
--                   `descricao` é cortada em 600 caracteres pela triagem, e o
--                   resto não existia em lugar nenhum. E-mail longo é
--                   justamente aquele em que a pessoa explicou o problema.
--
-- EQUIPE: a caixa do robô é UMA caixa (GMAIL_USER), então a entrada nasce com
-- o team padrão e o admin vê tudo — mesma policy de backup_monitores (060).
-- E-mail sem cliente não tem equipe para herdar; inventar uma seria pior que
-- assumir a caixa de onde ele veio.
--
-- Sem esta migration o app segue igual: a tela da caixa some sozinha quando a
-- tabela não existe, e a triagem volta a descartar como antes.
-- Depois da 065. Idempotente.
--
-- VERIFICAR:
--   select table_name from information_schema.tables
--    where table_schema = 'public' and table_name = 'emails_triagem';
--   -- esperado: 1 linha
--
--   select column_name from information_schema.columns
--    where table_name = 'pendencias' and column_name = 'email_corpo';
--   -- esperado: 1 linha
--
--   select policyname from pg_policies where tablename = 'emails_triagem';
--   -- esperado: 4 linhas (select/insert/update/delete)
--
-- ROLLBACK:
--   drop table if exists public.emails_triagem;
--   alter table public.pendencias drop column if exists email_corpo;
-- ============================================================

-- ── O e-mail inteiro no chamado ─────────────────────────────────────────────

ALTER TABLE public.pendencias ADD COLUMN IF NOT EXISTS email_corpo TEXT;

COMMENT ON COLUMN public.pendencias.email_corpo IS
  'E-mail que abriu o chamado, inteiro, sem citação nem assinatura. A descricao é um resumo de 600 caracteres.';

-- ── O que chegou e não virou chamado ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.emails_triagem (
  id            TEXT PRIMARY KEY,
  -- Id da mensagem no Gmail. UNIQUE é a trava de "uma linha por e-mail": o
  -- robô reenvia a mesma entrega quando uma rodada falha no meio.
  email_id      TEXT NOT NULL UNIQUE,
  thread_id     TEXT,
  message_id    TEXT,
  de            TEXT NOT NULL,
  assunto       TEXT,
  -- Já limpo (sem citação, sem assinatura): é o que alguém vai ler para
  -- decidir. O e-mail cru continua no Gmail.
  corpo         TEXT,
  recebido_em   TIMESTAMPTZ,
  -- Por que não virou chamado. Muda o que a pessoa faz com a linha: sem
  -- cliente pede cadastro ou vínculo; ignorado pede conferir se a IA errou.
  motivo        TEXT NOT NULL CHECK (motivo IN ('sem_cliente', 'ignorado_ia')),
  status        TEXT NOT NULL DEFAULT 'pendente'
                CHECK (status IN ('pendente', 'virou_chamado', 'descartado')),
  -- Preenchido quando a entrada virou chamado: é o que impede abrir dois a
  -- partir da mesma mensagem, e o que liga um ao outro na tela.
  pendencia_id  TEXT,
  team          TEXT NOT NULL DEFAULT 'init',
  tratado_por   TEXT,
  tratado_em    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- O sync do app resolve conflito por `updated_at` (js/storage.js), e toda
  -- entidade sincronizada precisa ter — sem ela, duas abas decidindo a mesma
  -- entrada não teriam como saber qual decisão é a mais nova.
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A consulta da tela é sempre "o que falta olhar". Índice parcial porque
-- entrada tratada nunca entra nela, e com o tempo elas são a maioria.
CREATE INDEX IF NOT EXISTS idx_emails_triagem_pendente
  ON public.emails_triagem (created_at DESC)
  WHERE status = 'pendente';

ALTER TABLE public.emails_triagem ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.emails_triagem TO authenticated;

DROP POLICY IF EXISTS emails_triagem_select ON public.emails_triagem;
DROP POLICY IF EXISTS emails_triagem_insert ON public.emails_triagem;
DROP POLICY IF EXISTS emails_triagem_update ON public.emails_triagem;
DROP POLICY IF EXISTS emails_triagem_delete ON public.emails_triagem;

CREATE POLICY emails_triagem_select ON public.emails_triagem FOR SELECT TO authenticated
  USING ((SELECT public.current_op_is_admin()) OR COALESCE(team, 'init') = (SELECT public.current_op_team()));
CREATE POLICY emails_triagem_insert ON public.emails_triagem FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.current_op_is_admin()) OR COALESCE(team, 'init') = (SELECT public.current_op_team()));
CREATE POLICY emails_triagem_update ON public.emails_triagem FOR UPDATE TO authenticated
  USING ((SELECT public.current_op_is_admin()) OR COALESCE(team, 'init') = (SELECT public.current_op_team()))
  WITH CHECK ((SELECT public.current_op_is_admin()) OR COALESCE(team, 'init') = (SELECT public.current_op_team()));
-- Apagar é só do admin: a linha é o registro de que um pedido chegou. Quem
-- atende FECHA (status = 'descartado'), que deixa rastro de quem decidiu.
CREATE POLICY emails_triagem_delete ON public.emails_triagem FOR DELETE TO authenticated
  USING ((SELECT public.current_op_is_admin()));

COMMENT ON TABLE public.emails_triagem IS
  'E-mails que chegaram na caixa do robô e NÃO viraram chamado (sem cliente, ou ignorados pela IA). Registro para alguém olhar, não fila de trabalho.';
