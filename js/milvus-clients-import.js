// milvus-clients-import.js — Importa clientes do Milvus p/ a intranet
// =====================================================================
// Fluxo em 2 fases: prévia (dry-run, sem escrita) → confirmação → commit.
// Novos entram com team='init' + vínculo no milvus_client_map.
// Frontend NUNCA vê o token do Milvus (só a Edge Function).

function normalizeImportCnpj(v) {
  return String(v === null || v === undefined ? '' : v).replace(/\D/g, '');
}

function normalizeImportName(v) {
  return String(v === null || v === undefined ? '' : v).replace(/\s+/g, ' ').trim().toLowerCase();
}

// Índice local p/ detectar duplicadas (CNPJ tem precedência).
function buildLocalClientIndex(clients) {
  const byCnpj = new Map();
  const byName = new Map();
  for (const c of clients || []) {
    if (!c) continue;
    const cn = normalizeImportCnpj(c.cnpj);
    if (cn && !byCnpj.has(cn)) byCnpj.set(cn, c.id);
    const nm = normalizeImportName(c.name);
    if (nm && !byName.has(nm)) byName.set(nm, c.id);
  }
  return { byCnpj: byCnpj, byName: byName };
}

function matchMilvusClientToLocal(milvusRow, index) {
  const cn = normalizeImportCnpj(milvusRow && milvusRow.cnpj);
  if (cn && index.byCnpj.has(cn)) return 'existe_cnpj';
  if (index.byName.has(normalizeImportName(milvusRow && milvusRow.nome))) return 'existe_nome';
  return 'novo';
}

function clientInitialsForName(name) {
  const parts = String(name || '').split(' ').map((w) => w[0]).filter(Boolean).join('');
  return ((parts.substring(0, 2) || 'CL')).toUpperCase();
}

function summarizeImportPreview(rows) {
  const list = rows || [];
  return {
    total: list.length,
    novos: list.filter((r) => r.status === 'novo').length,
    existeCnpj: list.filter((r) => r.status === 'existe_cnpj').length,
    existeNome: list.filter((r) => r.status === 'existe_nome').length,
  };
}

function _importAdminGuard() {
  const isAdmin = typeof isMilvusMappingAdmin === 'function'
    ? isMilvusMappingAdmin()
    : (typeof isCurrentAdmin === 'function' && isCurrentAdmin() === true);
  if (!isAdmin) throw new Error('Somente administradores.');
  if (typeof isSupabaseConnected !== 'function' || !isSupabaseConnected() ||
      typeof supabaseClient === 'undefined' || !supabaseClient) {
    throw new Error('Sem conexão com o servidor.');
  }
}

async function _invokeClientsImport(body) {
  _importAdminGuard();
  const { data, error } = await supabaseClient.functions.invoke('milvus-clients-import', { body: body });
  if (error) throw new Error('Falha na importação de clientes. Tente novamente.');
  if (!data || data.success !== true) throw new Error('Falha na importação de clientes. Tente novamente.');
  return data;
}

function previewMilvusClientsImport() {
  return _invokeClientsImport({ dry_run: true });
}

function commitMilvusClientsImport(onlyIds) {
  return _invokeClientsImport({ dry_run: false, onlyIds: onlyIds || null });
}

// Export para testes (Node/Vitest).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizeImportCnpj: normalizeImportCnpj,
    normalizeImportName: normalizeImportName,
    buildLocalClientIndex: buildLocalClientIndex,
    matchMilvusClientToLocal: matchMilvusClientToLocal,
    clientInitialsForName: clientInitialsForName,
    summarizeImportPreview: summarizeImportPreview,
    previewMilvusClientsImport: previewMilvusClientsImport,
    commitMilvusClientsImport: commitMilvusClientsImport,
  };
}
