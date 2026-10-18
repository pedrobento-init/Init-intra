-- ============================================================
-- Migration 047: Fim do hash de senha em operators
-- ============================================================
-- PROBLEMA: operators.pin_hash/pin_salt guardavam um SHA-256 (sal de 8 bytes)
-- da MESMA senha de login — e operators é legível por todo autenticado
-- (dropdowns). Qualquer técnico podia baixar os hashes e quebrar senhas
-- fracas offline. O login de verdade é o Supabase Auth; o hash só servia
-- para pedir a "senha atual" ao editar o próprio perfil, o que o app agora
-- confere no próprio Supabase Auth.
--
-- O QUE MUDA:
-- - Apaga os hashes existentes.
-- - Trigger zera pin_hash/pin_salt em qualquer gravação: versões antigas do
--   app ainda em cache nos celulares continuam salvando sem erro, mas o hash
--   não volta. (As colunas ficam para não quebrar esses clientes antigos;
--   podem ser removidas depois que todos atualizarem.)
-- ROLLBACK: não há o que restaurar (as senhas continuam no Supabase Auth).

UPDATE public.operators SET pin_hash = NULL, pin_salt = NULL
 WHERE pin_hash IS NOT NULL OR pin_salt IS NOT NULL;

CREATE OR REPLACE FUNCTION public.operators_strip_pin()
RETURNS trigger LANGUAGE plpgsql
AS $$
BEGIN
  NEW.pin_hash := NULL;
  NEW.pin_salt := NULL;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.operators_strip_pin() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_operators_strip_pin ON public.operators;
CREATE TRIGGER trg_operators_strip_pin
  BEFORE INSERT OR UPDATE ON public.operators
  FOR EACH ROW EXECUTE FUNCTION public.operators_strip_pin();

-- VERIFICAÇÃO (esperado: 0):
--   SELECT count(*) FROM operators WHERE pin_hash IS NOT NULL OR pin_salt IS NOT NULL;
