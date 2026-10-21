-- ============================================================
-- Migration 058: "O que levar" na visita
-- ============================================================
-- Ao digitar o motivo (ex.: "Formatação de máquina"), o app sugere o que o
-- técnico precisa levar (pendrive bootável, HD para backup...). O técnico
-- ajusta a lista e marca o que já separou.
-- - visits.levar: [{ "t": "Pendrive bootável", "ok": false }, ...]
-- - levar_regras: palavras-chave do motivo → itens. Todos leem; só admin
--   cria/edita/apaga (tela "Regras do que levar" no formulário da visita).
-- - Trigger da agenda Google (057) passa a considerar a lista (vai na
--   descrição do evento).
-- Rodar ANTES de publicar o site novo: o app manda `levar` no upsert.
-- Depende de: 042 (current_op_is_admin), 057.
-- ============================================================

ALTER TABLE public.visits ADD COLUMN IF NOT EXISTS levar JSONB;

CREATE TABLE IF NOT EXISTS public.levar_regras (
  id TEXT PRIMARY KEY,
  palavras TEXT NOT NULL,              -- separadas por vírgula; sem acento/maiúscula na comparação
  itens JSONB NOT NULL DEFAULT '[]'::jsonb,   -- ["Pendrive bootável", ...]
  ativo BOOLEAN NOT NULL DEFAULT true,
  ordem INT NOT NULL DEFAULT 0,
  updated_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.levar_regras ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.levar_regras FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.levar_regras TO authenticated;

DROP POLICY IF EXISTS levar_regras_select ON public.levar_regras;
DROP POLICY IF EXISTS levar_regras_insert ON public.levar_regras;
DROP POLICY IF EXISTS levar_regras_update ON public.levar_regras;
DROP POLICY IF EXISTS levar_regras_delete ON public.levar_regras;
CREATE POLICY levar_regras_select ON public.levar_regras FOR SELECT TO authenticated
  USING ((SELECT public.current_op_id()) IS NOT NULL);
CREATE POLICY levar_regras_insert ON public.levar_regras FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.current_op_is_admin()));
CREATE POLICY levar_regras_update ON public.levar_regras FOR UPDATE TO authenticated
  USING ((SELECT public.current_op_is_admin())) WITH CHECK ((SELECT public.current_op_is_admin()));
CREATE POLICY levar_regras_delete ON public.levar_regras FOR DELETE TO authenticated
  USING ((SELECT public.current_op_is_admin()));

-- Regras iniciais (o admin muda pela tela). ON CONFLICT: rodar de novo não
-- desfaz o que o admin editou. Mesma lista de LEVAR_REGRAS_PADRAO (visita-levar.js).
INSERT INTO public.levar_regras (id, palavras, itens, ordem) VALUES
  ('lv-formatacao', 'formatacao, formatar, formatação, reinstalar windows, reinstalacao',
   '["Pendrive bootável do Windows", "HD externo para backup", "Pendrive com drivers", "Chave de licença do Windows"]', 1),
  ('lv-backup', 'backup',
   '["HD externo para backup", "Cabo USB/SATA"]', 2),
  ('lv-maquina-nova', 'maquina nova, computador novo, notebook novo, instalacao de computador, instalacao de maquina',
   '["Pendrive com instaladores", "Cabo de rede", "Filtro de linha"]', 3),
  ('lv-impressora', 'impressora, scanner',
   '["Cabo USB de impressora", "Driver da impressora no pendrive", "Papel para teste"]', 4),
  ('lv-rede', 'rede, cabeamento, cabo de rede, switch, ponto de rede',
   '["Alicate de crimpar", "Conectores RJ45", "Testador de cabo", "Cabo de rede"]', 5),
  ('lv-wifi', 'wifi, wi-fi, roteador, access point',
   '["Cabo de rede", "Notebook para configurar", "Fonte/adaptador PoE"]', 6),
  ('lv-servidor', 'servidor',
   '["Notebook", "Pendrive bootável", "HD externo", "Cabo de rede"]', 7)
ON CONFLICT (id) DO NOTHING;

-- Agenda Google (057): a lista também conta como mudança da visita.
CREATE OR REPLACE FUNCTION public.visits_google_agenda_enqueue()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND
     (NEW.date, NEW."time", NEW.time_end, NEW.all_day, NEW.status, NEW.client_name, NEW.motivo,
      NEW.observacoes, NEW.numero, NEW.operator, NEW.operator_id, NEW.levar)
     IS NOT DISTINCT FROM
     (OLD.date, OLD."time", OLD.time_end, OLD.all_day, OLD.status, OLD.client_name, OLD.motivo,
      OLD.observacoes, OLD.numero, OLD.operator, OLD.operator_id, OLD.levar) THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.google_agenda_runner) THEN RETURN NULL; END IF;
  INSERT INTO public.google_agenda_queue (visit_id, old_operator_id, old_operator)
  VALUES (
    COALESCE(NEW.id, OLD.id),
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.operator_id END,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.operator END
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'google-agenda: fila não gravada (%)', SQLERRM;
  RETURN NULL;
END $$;

-- VERIFICAÇÃO:
--   SELECT id, palavras, jsonb_array_length(itens) FROM public.levar_regras ORDER BY ordem;
