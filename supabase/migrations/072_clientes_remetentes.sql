-- ============================================================
-- Migration 072: o robô aprende de quem é o e-mail
-- ============================================================
-- O robô só reconhece cliente pelo domínio da ficha (`clients.emails.domain`)
-- ou pelo nome no assunto. Quem escreve de um Gmail pessoal, ou de um domínio
-- que ninguém cadastrou, cai na caixa como `sem_cliente` — e cai de novo no
-- e-mail seguinte, e no outro. A pessoa abre o chamado, escolhe o cliente à
-- mão, e o robô não guarda nada disso.
--
-- Agora, quando um chamado aberto pela caixa é salvo com cliente, o app grava
-- aqui quem mandou. Na rodada seguinte o robô consulta esta tabela ANTES do
-- domínio da ficha (robo/campo.ts: clienteDoEmail).
--
-- O que se aprende depende de quem mandou:
-- - provedor pessoal (gmail.com, hotmail.com...) → o ENDEREÇO inteiro. Aprender
--   o domínio faria todo Gmail do mundo virar chamado daquele cliente.
-- - domínio próprio → o DOMÍNIO, que cobre os colegas da mesma empresa.
--
-- EQUIPE: a linha herda o team do cliente, não o de quem vinculou — é o
-- cliente que pertence a uma equipe. UNIQUE por (team, remetente) e não só por
-- remetente porque a RLS esconde a linha de outra equipe: com UNIQUE global, o
-- upsert de uma equipe esbarraria numa linha que ela não pode ver nem
-- atualizar. Se duas equipes vincularem o mesmo remetente, o robô fica com o
-- vínculo mais recente.
--
-- Sem esta migration o app segue igual: o vínculo falha em silêncio e o robô
-- volta a casar só pela ficha.
-- Depois da 071. Idempotente.
--
-- VERIFICAR:
--   select table_name from information_schema.tables
--    where table_schema = 'public' and table_name = 'clientes_remetentes';
--   -- esperado: 1 linha
--
--   select policyname from pg_policies where tablename = 'clientes_remetentes';
--   -- esperado: 4 linhas (select/insert/update/delete)
--
-- ROLLBACK:
--   drop table if exists public.clientes_remetentes;
-- ============================================================

CREATE TABLE IF NOT EXISTS public.clientes_remetentes (
  id          TEXT PRIMARY KEY,
  -- Sempre em minúsculas: o robô compara com o remetente normalizado, e
  -- "Joao@Gmail.com" e "joao@gmail.com" são a mesma caixa.
  remetente   TEXT NOT NULL CHECK (remetente = lower(remetente)),
  tipo        TEXT NOT NULL CHECK (tipo IN ('endereco', 'dominio')),
  -- CASCADE: cliente apagado não pode continuar recebendo chamado do robô.
  client_id   TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  team        TEXT NOT NULL DEFAULT 'init',
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team, remetente)
);

CREATE INDEX IF NOT EXISTS idx_clientes_remetentes_client
  ON public.clientes_remetentes (client_id);

ALTER TABLE public.clientes_remetentes ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.clientes_remetentes TO authenticated;

DROP POLICY IF EXISTS clientes_remetentes_select ON public.clientes_remetentes;
DROP POLICY IF EXISTS clientes_remetentes_insert ON public.clientes_remetentes;
DROP POLICY IF EXISTS clientes_remetentes_update ON public.clientes_remetentes;
DROP POLICY IF EXISTS clientes_remetentes_delete ON public.clientes_remetentes;

CREATE POLICY clientes_remetentes_select ON public.clientes_remetentes FOR SELECT TO authenticated
  USING ((SELECT public.current_op_is_admin()) OR COALESCE(team, 'init') = (SELECT public.current_op_team()));
CREATE POLICY clientes_remetentes_insert ON public.clientes_remetentes FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.current_op_is_admin()) OR COALESCE(team, 'init') = (SELECT public.current_op_team()));
CREATE POLICY clientes_remetentes_update ON public.clientes_remetentes FOR UPDATE TO authenticated
  USING ((SELECT public.current_op_is_admin()) OR COALESCE(team, 'init') = (SELECT public.current_op_team()))
  WITH CHECK ((SELECT public.current_op_is_admin()) OR COALESCE(team, 'init') = (SELECT public.current_op_team()));
-- Desfazer um vínculo errado é decisão do admin: ele muda para onde vão os
-- chamados de um remetente, e quem atende corrige vinculando de novo.
CREATE POLICY clientes_remetentes_delete ON public.clientes_remetentes FOR DELETE TO authenticated
  USING ((SELECT public.current_op_is_admin()));

COMMENT ON TABLE public.clientes_remetentes IS
  'Remetentes (endereço ou domínio) que o robô aprendeu a ligar a um cliente quando alguém vinculou na caixa. Consultada antes do domínio da ficha.';
