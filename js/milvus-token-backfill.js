// milvus-token-backfill.js — Preenche clients.milvus_client_token via API
// =====================================================================
// Duas fases: prévia (sem escrita) → confirmação → commit. Só preenche
// vazio; ambíguos (2+ tokens) e ausentes ficam para decisão manual.
// Match EXATO normalizado, sem fuzzy. Frontend NUNCA vê o API token.

function normalizeBackfillName(v) {
  return String(v === null || v === undefined ? '' : v).replace(/\s+/g, ' ').trim().toLowerCase();
}

// Espelho testável da regra do servidor: mapRows [{milvus_nome, client_id}],
// clientTokens {clientId: token}, milvusList [{nome, token}].
function buildBackfillPreview(mapRows, clientTokens, milvusList) {
  const byFantasia = new Map();
  for (const c of milvusList || []) {
    const key = normalizeBackfillName(c && c.nome);
    const tok = String((c && c.token) || '').trim();
    if (!key || !tok) continue;
    if (!byFantasia.has(key)) byFantasia.set(key, new Set());
    byFantasia.get(key).add(tok);
  }
  const out = [];
  for (const m of mapRows || []) {
    const nome = String((m && m.milvus_nome) || '').trim();
    if (!nome) continue;
    const current = String((clientTokens && clientTokens[m.client_id]) || '').trim();
    if (current) {
      out.push({ milvusNome: nome, clientId: m.client_id, token: null, status: 'ja_preenchido' });
      continue;
    }
    const toks = byFantasia.get(normalizeBackfillName(nome));
    if (!toks) {
      out.push({ milvusNome: nome, clientId: m.client_id, token: null, status: 'nao_encontrado' });
    } else if (toks.size > 1) {
      out.push({ milvusNome: nome, clientId: m.client_id, token: null, status: 'ambiguo' });
    } else {
      out.push({ milvusNome: nome, clientId: m.client_id, token: [...toks][0], status: 'pronto' });
    }
  }
  return out;
}

function summarizeBackfillPreview(rows) {
  const list = rows || [];
  const c = (s) => list.filter((r) => r.status === s).length;
  return { total: list.length, prontos: c('pronto'), jaPreenchidos: c('ja_preenchido'), naoEncontrados: c('nao_encontrado'), ambiguos: c('ambiguo') };
}

function _backfillAdminGuard() {
  const isAdmin = typeof isMilvusMappingAdmin === 'function'
    ? isMilvusMappingAdmin()
    : (typeof isCurrentAdmin === 'function' && isCurrentAdmin() === true);
  if (!isAdmin) throw new Error('Somente administradores.');
  if (typeof isSupabaseConnected !== 'function' || !isSupabaseConnected() ||
      typeof supabaseClient === 'undefined' || !supabaseClient) {
    throw new Error('Sem conexão com o servidor.');
  }
}

async function _invokeTokenBackfill(body) {
  _backfillAdminGuard();
  const { data, error } = await supabaseClient.functions.invoke('milvus-token-backfill', { body: body });
  if (error) throw new Error('Falha ao preencher tokens. Tente novamente.');
  if (!data || data.success !== true) throw new Error('Falha ao preencher tokens. Tente novamente.');
  return data;
}

function previewMilvusTokenBackfill() {
  return _invokeTokenBackfill({ dry_run: true });
}

function commitMilvusTokenBackfill(onlyNomes) {
  return _invokeTokenBackfill({ dry_run: false, onlyNomes: onlyNomes || null });
}

// Export para testes (Node/Vitest).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizeBackfillName: normalizeBackfillName,
    buildBackfillPreview: buildBackfillPreview,
    summarizeBackfillPreview: summarizeBackfillPreview,
    previewMilvusTokenBackfill: previewMilvusTokenBackfill,
    commitMilvusTokenBackfill: commitMilvusTokenBackfill,
  };
}
