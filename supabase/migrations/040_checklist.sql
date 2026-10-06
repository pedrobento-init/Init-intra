-- ============================================================
-- 040: Checklist do cliente (modelo global + marcações)
-- Execute no Supabase SQL Editor (como postgres/service_role)
-- ============================================================
-- ESCOPO: lista de confirmação por cliente, 3 tipos
-- (instalacao | troca | saida). Sem responsável, sem observação
-- por item, sem "não se aplica", sem bloqueio de conclusão.
--
-- TABELAS:
-- 1. checklist_modelo_itens — modelo global (igual para todos os
--    clientes): tipo, categoria, texto, ordem, ativo.
--    Editável SOMENTE por seed/migração (não há UI de edição):
--    por isso a tabela tem política só de LEITURA — escrita fica
--    com service_role/postgres.
--    Itens futuros novos aparecem desmarcados para todos os
--    clientes; ativo = false simplesmente some da lista/cálculo.
-- 2. checklist_marcacoes — estado por cliente. Existir a linha =
--    item marcado; desmarcar = apagar a linha. Índice único
--    (client_id, item_id) garante "1 estado por item por cliente".
--    Guarda quem/marquou quando (marcado_por, marcado_em) por
--    baixo dos panos — hoje não aparece na UI.
--
-- RLS:
-- - modelo: SELECT para autenticados (leitura pura).
-- - marcações: mesmo isolamento operador×equipe×cliente das
--   demais tabelas com `team` desnormalizada (011/024), usando
--   current_op_is_admin()/current_op_team(). Nenhuma policy
--   existente é alterada.
--
-- COMO APLICAR (Supabase SQL Editor, como postgres/service_role):
-- 1. Backup/snapshot.
-- 2. Rode este arquivo inteiro (o seed é idempotente:
--    ON CONFLICT (id) DO UPDATE — o arquivo é a fonte de verdade
--    do modelo built-in; textos editados aqui re-sincronizam).
-- 3. Confira:
--    SELECT tipo, count(*) FROM public.checklist_modelo_itens
--    GROUP BY tipo ORDER BY tipo;
--    (esperado: instalacao=14, saida=14, troca=9)
-- ROLLBACK:
--   DROP TABLE IF EXISTS public.checklist_marcacoes;
--   DROP TABLE IF EXISTS public.checklist_modelo_itens;
-- ============================================================

-- ── 1. Modelo global ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.checklist_modelo_itens (
  id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL CHECK (tipo IN ('instalacao', 'troca', 'saida')),
  categoria TEXT NOT NULL,
  texto TEXT NOT NULL,
  ordem INTEGER NOT NULL DEFAULT 0,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_checklist_modelo_tipo
  ON public.checklist_modelo_itens(tipo, ordem);

ALTER TABLE public.checklist_modelo_itens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "checklist_modelo_select" ON public.checklist_modelo_itens;
CREATE POLICY "checklist_modelo_select" ON public.checklist_modelo_itens
  FOR SELECT TO authenticated USING (true);
-- Sem policy de INSERT/UPDATE/DELETE: escrita só via service_role.

-- ── 2. Marcações por cliente ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.checklist_marcacoes (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES public.checklist_modelo_itens(id) ON DELETE CASCADE,
  team TEXT NOT NULL DEFAULT 'init',
  marcado_por TEXT DEFAULT '',
  marcado_em TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_checklist_marcacao UNIQUE (client_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_checklist_marcacoes_client
  ON public.checklist_marcacoes(client_id);
CREATE INDEX IF NOT EXISTS idx_checklist_marcacoes_team
  ON public.checklist_marcacoes(team);

ALTER TABLE public.checklist_marcacoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ckmarc_select" ON public.checklist_marcacoes;
DROP POLICY IF EXISTS "ckmarc_insert" ON public.checklist_marcacoes;
DROP POLICY IF EXISTS "ckmarc_update" ON public.checklist_marcacoes;
DROP POLICY IF EXISTS "ckmarc_delete" ON public.checklist_marcacoes;

CREATE POLICY "ckmarc_select" ON public.checklist_marcacoes
  FOR SELECT TO authenticated
  USING (
    public.current_op_is_admin()
    OR COALESCE(team, 'init') = public.current_op_team()
  );

CREATE POLICY "ckmarc_insert" ON public.checklist_marcacoes
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_op_is_admin()
    OR COALESCE(team, 'init') = public.current_op_team()
  );

CREATE POLICY "ckmarc_update" ON public.checklist_marcacoes
  FOR UPDATE TO authenticated
  USING (
    public.current_op_is_admin()
    OR COALESCE(team, 'init') = public.current_op_team()
  )
  WITH CHECK (
    public.current_op_is_admin()
    OR COALESCE(team, 'init') = public.current_op_team()
  );

CREATE POLICY "ckmarc_delete" ON public.checklist_marcacoes
  FOR DELETE TO authenticated
  USING (
    public.current_op_is_admin()
    OR COALESCE(team, 'init') = public.current_op_team()
  );

-- Realtime (mesmo bloco das demais entidades opcionais)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.checklist_marcacoes; EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;

-- ── 3. Seed do modelo built-in (idempotente) ──────────────────
-- Ordem = ordem de exibição dentro do tipo (categorias na ordem
-- em que aparecem). Espelhado em CHECKLIST_MODELO_DEFAULT
-- (js/checklist.js) como fallback offline — mantenha os dois em
-- sincronia ao alterar.

INSERT INTO public.checklist_modelo_itens (id, tipo, categoria, texto, ordem, ativo) VALUES
-- Instalação
('inst-01', 'instalacao', 'Estações', 'Instalar atualizações do Windows', 1, true),
('inst-02', 'instalacao', 'Estações', 'Definir nome padrão da máquina', 2, true),
('inst-03', 'instalacao', 'Estações', 'Instalar e ativar antivírus', 3, true),
('inst-04', 'instalacao', 'Estações', 'Configurar AnyDesk e anotar ID na Ficha TI', 4, true),
('inst-05', 'instalacao', 'Estações', 'Ativar backup', 5, true),
('inst-06', 'instalacao', 'Servidor(es)', 'Ingressar na rede/domínio', 6, true),
('inst-07', 'instalacao', 'Servidor(es)', 'Criar usuário', 7, true),
('inst-08', 'instalacao', 'Servidor(es)', 'Mapear pastas de rede', 8, true),
('inst-09', 'instalacao', 'E-mails', 'Configurar e-mail', 9, true),
('inst-10', 'instalacao', 'Impressora', 'Configurar impressoras', 10, true),
('inst-11', 'instalacao', 'Sistemas', 'Instalar sistemas do cliente', 11, true),
('inst-12', 'instalacao', 'Sistemas', 'Testar acesso aos sistemas', 12, true),
('inst-13', 'instalacao', 'Geral', 'Atualizar inventário', 13, true),
('inst-14', 'instalacao', 'Geral', 'Testar com o usuário', 14, true),
-- Troca de usuário
('troca-01', 'troca', 'Servidor(es)', 'Criar usuário e definir permissões', 1, true),
('troca-02', 'troca', 'Servidor(es)', 'Redefinir senhas e acessos', 2, true),
('troca-03', 'troca', 'Servidor(es)', 'Revisar permissões de pastas', 3, true),
('troca-04', 'troca', 'Servidor(es)', 'Migrar ou arquivar arquivos do usuário anterior', 4, true),
('troca-05', 'troca', 'E-mails', 'Atualizar e-mail e assinatura', 5, true),
('troca-06', 'troca', 'Sistemas', 'Transferir licenças e acessos dos sistemas', 6, true),
('troca-07', 'troca', 'Geral', 'Identificar quem sai e quem entra', 7, true),
('troca-08', 'troca', 'Geral', 'Atualizar inventário', 8, true),
('troca-09', 'troca', 'Geral', 'Validar com o gestor', 9, true),
-- Saída de colaborador
('saida-01', 'saida', 'Servidor(es)', 'Desativar usuário e senha', 1, true),
('saida-02', 'saida', 'Servidor(es)', 'Encerrar sessões abertas', 2, true),
('saida-03', 'saida', 'Servidor(es)', 'Fazer backup do perfil', 3, true),
('saida-04', 'saida', 'Servidor(es)', 'Definir quem herda arquivos e pastas', 4, true),
('saida-05', 'saida', 'E-mails', 'Remover do e-mail e WhatsApp corporativo', 5, true),
('saida-06', 'saida', 'E-mails', 'Fazer backup do e-mail', 6, true),
('saida-07', 'saida', 'E-mails', 'Redirecionar e-mail para o gestor', 7, true),
('saida-08', 'saida', 'Firewall', 'Revogar acesso remoto (VPN, AnyDesk, painéis)', 8, true),
('saida-09', 'saida', 'Sistemas', 'Remover de sistemas e licenças', 9, true),
('saida-10', 'saida', 'Sistemas', 'Trocar senhas compartilhadas que ele conhecia', 10, true),
('saida-11', 'saida', 'Estações', 'Receber o equipamento', 11, true),
('saida-12', 'saida', 'Estações', 'Formatar ou reatribuir', 12, true),
('saida-13', 'saida', 'Geral', 'Atualizar inventário', 13, true),
('saida-14', 'saida', 'Geral', 'Gestor confirmou a conclusão', 14, true)
ON CONFLICT (id) DO UPDATE SET
  tipo = EXCLUDED.tipo,
  categoria = EXCLUDED.categoria,
  texto = EXCLUDED.texto,
  ordem = EXCLUDED.ordem,
  ativo = EXCLUDED.ativo,
  updated_at = now();

-- ── 4. Verificação (somente leitura) ──────────────────────────
-- SELECT tipo, count(*) FROM public.checklist_modelo_itens GROUP BY tipo ORDER BY tipo;
-- SELECT tablename, policyname FROM pg_policies
--  WHERE schemaname = 'public' AND tablename IN
--   ('checklist_modelo_itens', 'checklist_marcacoes') ORDER BY 1, 2;
