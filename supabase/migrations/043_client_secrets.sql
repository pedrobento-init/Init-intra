-- ============================================================
-- Migration 043: Acessos da Ficha TI fora do registro do cliente (cifrados)
-- ============================================================
-- PROBLEMA: o ID de acesso remoto (server.remoteId) e as chaves de licença
-- (licenses[].key) ficavam em texto dentro de `clients` — no banco e no
-- cache offline (IndexedDB) de cada aparelho. Um celular perdido expunha os
-- acessos de todos os clientes da equipe.
--
-- O QUE MUDA:
-- - Tabela public.client_secrets, cifrada (pgcrypto, chave no Supabase
--   Vault), SEM nenhuma policy: ninguém lê pela API REST.
-- - Trigger em clients: todo save que traga remoteId/key (app novo, app
--   antigo ainda em cache no celular, importação) tem o valor movido para
--   client_secrets e removido do registro. No registro ficam só marcas:
--   server.remoteIdSet = true e licenses[i].kid / hasKey = true.
-- - RPC reveal_client_secret: confere acesso ao cliente (mesma regra do RLS),
--   GRAVA NA AUDITORIA quem revelou o quê e devolve o valor.
-- - RPC set_client_remote_id: troca/remove o ID (também auditado).
-- - Backfill: os valores atuais são movidos e o updated_at avança, para que
--   cada aparelho baixe o registro limpo no próximo sync.
--
-- PRÉ-REQUISITO (uma vez, SQL Editor):
--   SELECT vault.create_secret(encode(gen_random_bytes(32), 'base64'), 'client_secrets_key');
-- Sem a chave, esta migration para no passo 0 sem alterar nada.
-- Depende da 042 (can_see_client, current_op_name).
--
-- FORA DO ESCOPO (decisão): clients.milvus_client_token continua na tabela —
-- 5 Edge Functions o leem dali e, sozinho, ele não autentica nada (só
-- funciona junto com o MILVUS_API_TOKEN, que fica no servidor). A tela já o
-- mostra mascarado. Texto livre ("Observações") pode conter senha digitada
-- à mão: isso não tem como ser detectado aqui.
-- ROLLBACK: SELECT client_id, public._dec_secret(remote_id) FROM client_secrets
--   (como postgres) devolve os valores; DROP TRIGGER trg_clients_secrets.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ── 0. Chave no Vault (falha aqui = nada foi alterado) ────────
CREATE OR REPLACE FUNCTION public._client_secrets_key()
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE k text;
BEGIN
  SELECT decrypted_secret INTO k FROM vault.decrypted_secrets WHERE name = 'client_secrets_key' LIMIT 1;
  IF k IS NULL OR length(k) < 16 THEN
    RAISE EXCEPTION 'client_secrets_key ausente no Vault (veja o pré-requisito da migration 043)';
  END IF;
  RETURN k;
END $$;
DO $$ BEGIN PERFORM public._client_secrets_key(); END $$;

CREATE OR REPLACE FUNCTION public._enc_secret(v text)
RETURNS bytea LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, extensions
AS $$ SELECT pgp_sym_encrypt(v, public._client_secrets_key()) $$;

CREATE OR REPLACE FUNCTION public._dec_secret(b bytea)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions
AS $$ SELECT CASE WHEN b IS NULL THEN NULL ELSE pgp_sym_decrypt(b, public._client_secrets_key()) END $$;

-- ── 1. Tabela (sem FK: o trigger BEFORE grava antes da linha do cliente existir) ──
CREATE TABLE IF NOT EXISTS public.client_secrets (
  client_id TEXT PRIMARY KEY,
  remote_id BYTEA,
  license_keys JSONB NOT NULL DEFAULT '{}'::jsonb, -- { kid: base64(cifrado) }
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.client_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.client_secrets FROM anon, authenticated;
-- (sem policy: só funções SECURITY DEFINER abaixo e service_role acessam)

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['_client_secrets_key()', '_enc_secret(text)', '_dec_secret(bytea)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
END $$;

-- ── 2. Trigger: tira os acessos do registro do cliente ────────
CREATE OR REPLACE FUNCTION public.clients_extract_secrets()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  rid text;
  lic jsonb;
  out_lics jsonb := '[]'::jsonb;
  keys jsonb;
  kid text;
  k text;
  kids text[] := ARRAY[]::text[];
  has_rid boolean;
  stripped boolean := false;
BEGIN
  INSERT INTO public.client_secrets (client_id) VALUES (NEW.id) ON CONFLICT (client_id) DO NOTHING;
  SELECT license_keys INTO keys FROM public.client_secrets WHERE client_id = NEW.id;

  -- ID de acesso remoto: valor novo substitui; vazio/ausente mantém o guardado.
  rid := btrim(COALESCE(NEW.server ->> 'remoteId', ''));
  stripped := NEW.server ? 'remoteId';
  IF rid <> '' THEN
    UPDATE public.client_secrets SET remote_id = public._enc_secret(rid), updated_at = now() WHERE client_id = NEW.id;
  END IF;
  SELECT remote_id IS NOT NULL INTO has_rid FROM public.client_secrets WHERE client_id = NEW.id;
  NEW.server := (COALESCE(NEW.server, '{}'::jsonb) - 'remoteId') || jsonb_build_object('remoteIdSet', has_rid);

  -- Licenças: cada chave ganha um kid estável; a chave sai do registro.
  IF jsonb_typeof(NEW.licenses) = 'array' THEN
    FOR lic IN SELECT * FROM jsonb_array_elements(NEW.licenses)
    LOOP
      kid := NULLIF(lic ->> 'kid', '');
      k := btrim(COALESCE(lic ->> 'key', ''));
      IF lic ? 'key' THEN stripped := true; END IF;
      IF k <> '' THEN
        kid := COALESCE(kid, replace(gen_random_uuid()::text, '-', ''));
        keys := jsonb_set(keys, ARRAY[kid], to_jsonb(encode(public._enc_secret(k), 'base64')));
      END IF;
      IF kid IS NOT NULL THEN kids := kids || kid; END IF;
      lic := lic - 'key';
      IF kid IS NOT NULL THEN
        lic := lic || jsonb_build_object('kid', kid, 'hasKey', keys ? kid);
      END IF;
      out_lics := out_lics || jsonb_build_array(lic);
    END LOOP;
    NEW.licenses := out_lics;
    -- Licença removida do registro: a chave dela também some.
    SELECT COALESCE(jsonb_object_agg(e.key, e.value), '{}'::jsonb) INTO keys
      FROM jsonb_each(keys) e WHERE e.key = ANY (kids);
    UPDATE public.client_secrets SET license_keys = keys, updated_at = now() WHERE client_id = NEW.id;
  END IF;
  -- Registro limpo fica MAIS NOVO que a cópia do aparelho (que ainda tem o
  -- texto): no próximo sync o LWW troca a cópia local pela limpa.
  IF stripped THEN
    NEW.updated_at := GREATEST(COALESCE(NEW.updated_at, now()), now()) + interval '1 millisecond';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.clients_extract_secrets() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_clients_secrets ON public.clients;
CREATE TRIGGER trg_clients_secrets
  BEFORE INSERT OR UPDATE OF server, licenses ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.clients_extract_secrets();

CREATE OR REPLACE FUNCTION public.clients_drop_secrets()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN DELETE FROM public.client_secrets WHERE client_id = OLD.id; RETURN OLD; END $$;
REVOKE ALL ON FUNCTION public.clients_drop_secrets() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_clients_drop_secrets ON public.clients;
CREATE TRIGGER trg_clients_drop_secrets AFTER DELETE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.clients_drop_secrets();

-- ── 3. RPCs (únicas portas de leitura/escrita para o app) ────
-- p_kind: 'remote_id' | 'license' (com p_kid).
CREATE OR REPLACE FUNCTION public.reveal_client_secret(p_client_id text, p_kind text, p_kid text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  s public.client_secrets%ROWTYPE;
  v text;
  what text;
  lic_name text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_see_client(p_client_id) THEN
    RAISE EXCEPTION 'Acesso negado a este cliente' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM public.client_secrets WHERE client_id = p_client_id;
  IF p_kind = 'remote_id' THEN
    v := public._dec_secret(s.remote_id);
    what := 'ID de acesso remoto';
  ELSIF p_kind = 'license' AND p_kid IS NOT NULL THEN
    IF s.license_keys ? p_kid THEN
      v := public._dec_secret(decode(s.license_keys ->> p_kid, 'base64'));
    END IF;
    SELECT l ->> 'software' INTO lic_name FROM public.clients c, jsonb_array_elements(c.licenses) l
      WHERE c.id = p_client_id AND l ->> 'kid' = p_kid LIMIT 1;
    what := 'Chave de licença' || COALESCE(': ' || lic_name, '');
  ELSE
    RAISE EXCEPTION 'Tipo inválido' USING ERRCODE = '22023';
  END IF;
  IF v IS NOT NULL THEN
    INSERT INTO public.audit_logs (operator_name, action, type, target_id, details)
    VALUES (COALESCE(public.current_op_name(), 'Desconhecido'), 'Revelou acesso', 'Cliente', p_client_id, what);
  END IF;
  RETURN v;
END $$;

-- Valor vazio/NULL remove o ID guardado.
CREATE OR REPLACE FUNCTION public.set_client_remote_id(p_client_id text, p_value text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE v text := btrim(COALESCE(p_value, ''));
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_see_client(p_client_id) THEN
    RAISE EXCEPTION 'Acesso negado a este cliente' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.client_secrets (client_id) VALUES (p_client_id) ON CONFLICT (client_id) DO NOTHING;
  UPDATE public.client_secrets SET remote_id = CASE WHEN v = '' THEN NULL ELSE public._enc_secret(v) END, updated_at = now()
    WHERE client_id = p_client_id;
  -- Atualiza a marca no registro (e o updated_at, para os aparelhos sincronizarem).
  UPDATE public.clients SET server = COALESCE(server, '{}'::jsonb) || jsonb_build_object('remoteIdSet', v <> ''), updated_at = now()
    WHERE id = p_client_id;
  INSERT INTO public.audit_logs (operator_name, action, type, target_id, details)
  VALUES (COALESCE(public.current_op_name(), 'Desconhecido'), CASE WHEN v = '' THEN 'Removeu acesso' ELSE 'Alterou acesso' END, 'Cliente', p_client_id, 'ID de acesso remoto');
  RETURN v <> '';
END $$;

REVOKE ALL ON FUNCTION public.reveal_client_secret(text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_client_remote_id(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reveal_client_secret(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_client_remote_id(text, text) TO authenticated;

-- ── 4. Backfill: move o que já existe e força o re-sync dos aparelhos ──
UPDATE public.clients
   SET server = server, licenses = licenses, updated_at = now()
 WHERE COALESCE(server ->> 'remoteId', '') <> ''
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(licenses) = 'array' THEN licenses ELSE '[]'::jsonb END) l
               WHERE COALESCE(l ->> 'key', '') <> '');

-- ── 5. VERIFICAÇÃO (somente leitura) ─────────────────────────
-- Nenhum acesso em texto restante (esperado: 0):
--   SELECT count(*) FROM clients WHERE server ? 'remoteId'
--      OR EXISTS (SELECT 1 FROM jsonb_array_elements(licenses) l WHERE l ? 'key');
-- Revelações recentes:
--   SELECT timestamp, operator_name, target_id, details FROM audit_logs
--    WHERE action = 'Revelou acesso' ORDER BY timestamp DESC LIMIT 50;
