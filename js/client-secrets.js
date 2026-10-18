// client-secrets.js — Acessos da Ficha TI guardados fora do registro
// =====================================================================
// Com o Supabase (migration 043), o ID de acesso remoto e as chaves de
// licença não ficam no registro do cliente (nem no cache offline): ficam
// cifrados no banco e só voltam por RPC, que grava na auditoria quem revelou.
// No registro sobram as marcas server.remoteIdSet e licenses[i].hasKey/kid.
//
// O valor revelado vive só em memória, por 1 minuto, e some no logout.
// Modo local (sem Supabase) segue como antes: o valor está no próprio registro.

const CLIENT_SECRET_TTL_MS = 60 * 1000;
const _clientSecretMem = new Map(); // "cliente|tipo|kid" → { v, timer }

function _secretKey(clientId, kind, kid) { return clientId + '|' + kind + '|' + (kid || ''); }

function clientSecretsOnline() {
  try {
    return typeof isSupabaseConnected === 'function' && isSupabaseConnected() &&
      typeof window !== 'undefined' && window._supabaseAuthActive === true &&
      typeof supabaseClient !== 'undefined' && !!supabaseClient &&
      (typeof navigator === 'undefined' || navigator.onLine !== false);
  } catch (_) { return false; }
}

/** O ID está guardado no cofre (marca presente e sem valor no registro)? */
function isRemoteIdVaulted(c) {
  const s = c && c.server;
  return !!(s && s.remoteIdSet === true && !String(s.remoteId || '').trim());
}

/** A chave desta licença está no cofre? */
function isLicenseKeyVaulted(l) {
  return !!(l && l.hasKey === true && l.kid && !String(l.key || '').trim());
}

/** Valor já revelado (ainda em memória) ou null. */
function getRevealedSecret(clientId, kind, kid) {
  const e = _clientSecretMem.get(_secretKey(clientId, kind, kid));
  return e ? e.v : null;
}

function forgetClientSecret(clientId, kind, kid) {
  const k = _secretKey(clientId, kind, kid);
  const e = _clientSecretMem.get(k);
  if (e && e.timer) clearTimeout(e.timer);
  _clientSecretMem.delete(k);
}

function forgetAllClientSecrets() {
  _clientSecretMem.forEach((e) => { if (e.timer) clearTimeout(e.timer); });
  _clientSecretMem.clear();
}

/**
 * Busca o valor no servidor (RPC auditada). Lança Error com mensagem
 * pronta para toast quando offline ou sem acesso.
 * @param {(clientId: string) => void} [onExpire] chamado quando o valor sai da memória
 */
async function revealClientSecret(clientId, kind, kid, onExpire) {
  const cached = getRevealedSecret(clientId, kind, kid);
  if (cached !== null) return cached;
  if (!clientSecretsOnline()) throw new Error('Os acessos ficam no servidor: conecte-se para ver.');
  const { data, error } = await supabaseClient.rpc('reveal_client_secret', { p_client_id: clientId, p_kind: kind, p_kid: kid || null });
  if (error) throw new Error(/negado/i.test(error.message || '') ? 'Sem acesso a este cliente.' : 'Não foi possível buscar o acesso.');
  const v = data == null ? '' : String(data);
  const k = _secretKey(clientId, kind, kid);
  const timer = setTimeout(() => {
    _clientSecretMem.delete(k);
    if (typeof onExpire === 'function') { try { onExpire(clientId); } catch (_) {} }
  }, CLIENT_SECRET_TTL_MS);
  _clientSecretMem.set(k, { v, timer });
  return v;
}

/** Troca (ou remove, com '') o ID de acesso remoto direto no cofre. */
async function setClientRemoteId(clientId, value) {
  if (!clientSecretsOnline()) throw new Error('Sem conexão: tente de novo online.');
  const { error } = await supabaseClient.rpc('set_client_remote_id', { p_client_id: clientId, p_value: value || '' });
  if (error) throw new Error('Não foi possível salvar o acesso.');
  forgetClientSecret(clientId, 'remote_id');
  return true;
}

if (typeof window !== 'undefined') {
  // Logout / troca de usuário: nada revelado sobrevive.
  window.addEventListener('pagehide', forgetAllClientSecrets);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { isRemoteIdVaulted, isLicenseKeyVaulted, getRevealedSecret, revealClientSecret, forgetAllClientSecrets, CLIENT_SECRET_TTL_MS };
}
