-- ============================================================
-- 041: Checklists como entidade (nome / ativo / ordem)
-- Execute no Supabase SQL Editor (como postgres/service_role)
-- ============================================================
-- Contexto da 040: o modelo já existia com a coluna `tipo` e um CHECK
-- fechado (instalacao | troca | saida). Agora o usuário pode criar,
-- renomear, duplicar e desativar checklists pela aba do cliente, então:
--   * `tipo` passa a ser o ID da linha em `public.checklists` (FK);
--   * o CHECK antigo é removido;
--   * escrita em `checklists` e em `checklist_modelo_itens` é só de admin.
--
-- Idempotente e independente da ordem:
--   * se a 040 já foi aplicada -> cria `checklists` e ajusta a FK;
--   * se ainda NÃO foi aplicada -> cria as 3 tabelas (base da 040) e só
--     depois ajusta; assim os dois arquivos funcionam em qualquer ordem.
-- Seeds usam ON CONFLICT DO NOTHING para NUNCA sobrescrever edições
-- feitas pelo modo "Gerenciar" (nome, itens, ordem, ativo).
--
-- Permissões (padrão do projeto):
--   * SELECT: qualquer usuário autenticado (a tela de uso precisa ler);
--   * INSERT/UPDATE/DELETE: somente admin — current_op_is_admin() (011).
--
-- COMO APLICAR:
--   Rode a 040 (se ainda não rodou) e depois esta 041.
--   SELECT tipo, count(*) FROM public.checklist_modelo_itens
--    GROUP BY tipo ORDER BY tipo;   (esperado: 14 / 14 / 9)
--   SELECT id, nome, ativo, ordem FROM public.checklists ORDER BY ordem;
-- ROLLBACK:
--   ALTER TABLE public.checklist_modelo_itens DROP CONSTRAINT IF EXISTS fk_checklist_item_checklist;
--   ALTER TABLE public.checklist_modelo_itens ADD CONSTRAINT checklist_modelo_itens_tipo_check
--     CHECK (tipo IN ('instalacao', 'troca', 'saida'));
--   DROP TABLE IF EXISTS public.checklists;
-- ============================================================

-- ── 1. Entidade "checklists" ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.checklists (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT true,
  ordem INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── 2. Tabelas base (caso a 040 ainda não tenha sido aplicada) ──
CREATE TABLE IF NOT EXISTS public.checklist_modelo_itens (
  id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL,
  categoria TEXT NOT NULL,
  texto TEXT NOT NULL,
  ordem INTEGER NOT NULL DEFAULT 0,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

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

CREATE INDEX IF NOT EXISTS idx_checklist_modelo_tipo
  ON public.checklist_modelo_itens(tipo, ordem);
CREATE INDEX IF NOT EXISTS idx_checklist_marcacoes_client
  ON public.checklist_marcacoes(client_id);
CREATE INDEX IF NOT EXISTS idx_checklist_marcacoes_team
  ON public.checklist_marcacoes(team);
CREATE INDEX IF NOT EXISTS idx_checklists_ordem
  ON public.checklists(ordem);

-- ── 3. `tipo` deixa de ser enum fechado ──────────────────────
ALTER TABLE public.checklist_modelo_itens
  DROP CONSTRAINT IF EXISTS checklist_modelo_itens_tipo_check;

-- ── 4. Seed dos checklists padrão (não sobrescreve edições) ──
INSERT INTO public.checklists (id, nome, ativo, ordem) VALUES
  ('instalacao', 'Instalação',     true, 1),
  ('troca',      'Troca de usuário', true, 2),
  ('saida',      'Saída de colaborador', true, 3)
ON CONFLICT (id) DO NOTHING;

-- ── 5. Seed dos itens (NO-OP se a 040 já aplicou) ────────────
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
ON CONFLICT (id) DO NOTHING;

-- ── 6. FK `tipo` -> checklists (exclui o checklist e leva os itens) ──
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_checklist_item_checklist'
      AND conrelid = 'public.checklist_modelo_itens'::regclass
  ) THEN
    ALTER TABLE public.checklist_modelo_itens
      ADD CONSTRAINT fk_checklist_item_checklist
      FOREIGN KEY (tipo) REFERENCES public.checklists(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ── 7. RLS ──────────────────────────────────────────────────
ALTER TABLE public.checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_modelo_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_marcacoes ENABLE ROW LEVEL SECURITY;

-- checklists: leitura para todos, escrita só admin
DROP POLICY IF EXISTS "checklists_select" ON public.checklists;
DROP POLICY IF EXISTS "checklists_insert" ON public.checklists;
DROP POLICY IF EXISTS "checklists_update" ON public.checklists;
DROP POLICY IF EXISTS "checklists_delete" ON public.checklists;

CREATE POLICY "checklists_select" ON public.checklists
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "checklists_insert" ON public.checklists
  FOR INSERT TO authenticated WITH CHECK (public.current_op_is_admin());
CREATE POLICY "checklists_update" ON public.checklists
  FOR UPDATE TO authenticated
  USING (public.current_op_is_admin())
  WITH CHECK (public.current_op_is_admin());
CREATE POLICY "checklists_delete" ON public.checklists
  FOR DELETE TO authenticated USING (public.current_op_is_admin());

-- modelo de itens: leitura para todos (tela de uso), escrita só admin
DROP POLICY IF EXISTS "checklist_modelo_select" ON public.checklist_modelo_itens;
DROP POLICY IF EXISTS "checklist_modelo_insert" ON public.checklist_modelo_itens;
DROP POLICY IF EXISTS "checklist_modelo_update" ON public.checklist_modelo_itens;
DROP POLICY IF EXISTS "checklist_modelo_delete" ON public.checklist_modelo_itens;

CREATE POLICY "checklist_modelo_select" ON public.checklist_modelo_itens
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "checklist_modelo_insert" ON public.checklist_modelo_itens
  FOR INSERT TO authenticated WITH CHECK (public.current_op_is_admin());
CREATE POLICY "checklist_modelo_update" ON public.checklist_modelo_itens
  FOR UPDATE TO authenticated
  USING (public.current_op_is_admin())
  WITH CHECK (public.current_op_is_admin());
CREATE POLICY "checklist_modelo_delete" ON public.checklist_modelo_itens
  FOR DELETE TO authenticated USING (public.current_op_is_admin());

-- marcações por cliente (mesma das 040 — recriadas para ficar tudo
-- em um arquivo só caso a 040 ainda não tenha sido aplicada)
DROP POLICY IF EXISTS "ckmarc_select" ON public.checklist_marcacoes;
DROP POLICY IF EXISTS "ckmarc_insert" ON public.checklist_marcacoes;
DROP POLICY IF EXISTS "ckmarc_update" ON public.checklist_marcacoes;
DROP POLICY IF EXISTS "ckmarc_delete" ON public.checklist_marcacoes;

CREATE POLICY "ckmarc_select" ON public.checklist_marcacoes
  FOR SELECT TO authenticated
  USING (public.current_op_is_admin() OR COALESCE(team, 'init') = public.current_op_team());
CREATE POLICY "ckmarc_insert" ON public.checklist_marcacoes
  FOR INSERT TO authenticated
  WITH CHECK (public.current_op_is_admin() OR COALESCE(team, 'init') = public.current_op_team());
CREATE POLICY "ckmarc_update" ON public.checklist_marcacoes
  FOR UPDATE TO authenticated
  USING (public.current_op_is_admin() OR COALESCE(team, 'init') = public.current_op_team())
  WITH CHECK (public.current_op_is_admin() OR COALESCE(team, 'init') = public.current_op_team());
CREATE POLICY "ckmarc_delete" ON public.checklist_marcacoes
  FOR DELETE TO authenticated
  USING (public.current_op_is_admin() OR COALESCE(team, 'init') = public.current_op_team());

-- ── 8. Verificação (somente leitura) ────────────────────────
-- SELECT id, nome, ativo, ordem FROM public.checklists ORDER BY ordem;
-- SELECT tipo, count(*) FROM public.checklist_modelo_itens
--  GROUP BY tipo ORDER BY tipo;
-- SELECT tablename, policyname FROM pg_policies
--  WHERE schemaname = 'public' AND tablename IN
--   ('checklists', 'checklist_modelo_itens', 'checklist_marcacoes')
--  ORDER BY 1, 2;
