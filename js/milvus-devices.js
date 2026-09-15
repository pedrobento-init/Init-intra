// milvus-devices.js — Inventário Milvus (SOMENTE listagem de dispositivos)
// =====================================================================
// O frontend NUNCA acessa o Milvus diretamente e NUNCA vê o token.
// Fluxo: frontend → Edge Function `milvus-devices` (valida JWT + team,
// mesma regra do RLS) → Milvus → upsert → retorno agregado.
// NÃO inclui: softwares, status online/offline, Google, e-mails.

const MILVUS_SYNC_AT_KEY = 'intra_milvus_sync_at_v1';
const MILVUS_MAX_PAGES = 60;

// ── Autorização client-side (defesa em profundidade; o servidor revalida) ──
function canSyncClientDevices(operator, client) {
  if (!operator || !client) return false;
  if (operator.active === false) return false;
  if (operator.isAdmin === true) return true;
  return (operator.team || 'init') === (client.team || 'init');
}

// ── Normalização (espelho do servidor; null-safe, sem licença) ──
function normalizeMilvusDevice(raw, clientId, team) {
  if (!raw || typeof raw !== 'object') return null;
  const num = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  };
  const txt = (v) => (v === null || v === undefined ? '' : String(v));
  const iso = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const d = new Date(String(v));
    return isNaN(d.getTime()) ? null : d.toISOString();
  };
  const mid = num(raw.id);
  if (mid === null) return null;
  // `sistema_operacional_licenca` é ignorado de propósito (pode conter chave).
  return {
    id: clientId + ':milvus-' + mid,
    client_id: clientId,
    team: team || 'init',
    milvus_device_id: mid,
    hostname: txt(raw.hostname),
    apelido: txt(raw.apelido),
    ip_interno: txt(raw.ip_interno),
    ip_externo: txt(raw.ip_externo),
    mac_address: txt(raw.macaddres !== undefined ? raw.macaddres : raw.mac_address),
    marca: txt(raw.marca),
    fabricante: txt(raw.fabricante),
    is_ativo: raw.is_ativo === undefined || raw.is_ativo === null
      ? true
      : raw.is_ativo === true || raw.is_ativo === 1 || raw.is_ativo === '1',
    data_criacao: iso(raw.data_criacao),
    data_ultima_atualizacao: iso(raw.data_ultima_atualizacao),
    dominio: txt(raw.dominio),
    sistema_operacional: txt(raw.sistema_operacional),
    placa_mae: txt(raw.placa_mae),
    placa_mae_serial: txt(raw.placa_mae_serial),
    processador: txt(raw.processador),
    versao_client: txt(raw.versao_client),
    observacao: txt(raw.observacao),
    usuario_logado: txt(raw.usuario_logado),
    total_processadores: num(raw.total_processadores),
    numero_serial: txt(raw.numero_serial),
    placa_mae_modelo: txt(raw.placa_mae_modelo),
    data_compra: iso(raw.data_compra) ? iso(raw.data_compra).slice(0, 10) : null,
    data_garantia: iso(raw.data_garantia) ? iso(raw.data_garantia).slice(0, 10) : null,
    modelo_notebook: txt(raw.modelo_notebook),
    nome_fantasia: txt(raw.nome_fantasia),
    tipo_dispositivo_id: num(raw.tipo_dispositivo_id),
    tipo_dispositivo_text: txt(raw.tipo_dispositivo_text),
  };
}

// ── Paginação (puros, testáveis) ──
function buildMilvusListPayload(page) {
  return {
    is_paginate: true,
    is_descending: false,
    order_by: 'id',
    total_registros: 1000,
    pagina: page,
  };
}

function parseMilvusPage(data, fallbackPage) {
  if (!data || typeof data !== 'object') throw new Error('Resposta inválida do Milvus');
  const lista = data.lista !== undefined ? data.lista : data.data;
  if (!Array.isArray(lista)) throw new Error('Resposta do Milvus sem lista de dispositivos');
  const pag = (data.meta && data.meta.paginate) || {};
  const current = Number(pag.current_page !== undefined ? pag.current_page : fallbackPage) || fallbackPage;
  const last = Number(pag.last_page !== undefined ? pag.last_page : fallbackPage) || fallbackPage;
  return { list: lista, current: current, last: last };
}

function shouldStopMilvusPaging(current, last, pageCount) {
  if (pageCount >= MILVUS_MAX_PAGES) return true;
  return current >= last;
}

// Classifica erro do Milvus: auth (401/403) nunca repete; 429/5xx/rede
// admitem 1 retry; demais, sem retry.
function classifyMilvusError(status) {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'retry';
  if (typeof status === 'number' && status >= 500 && status < 600) return 'retry';
  if (status === 'timeout' || status === 'network') return 'retry';
  return 'fatal';
}

// Conta upsert sem duplicar: chave (client_id, milvus_device_id).
function diffMilvusUpsert(existingIds, rows) {
  const seen = new Set(existingIds || []);
  let created = 0;
  let updated = 0;
  for (const r of rows || []) {
    if (r && seen.has(r.milvus_device_id)) updated++;
    else if (r) { created++; seen.add(r.milvus_device_id); }
  }
  return { created: created, updated: updated };
}

// ── Última sincronização (local, por cliente) ──
function getMilvusLastSyncAt(clientId) {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(MILVUS_SYNC_AT_KEY) : null;
    if (!raw) return null;
    const map = JSON.parse(raw);
    return (map && map[clientId]) || null;
  } catch (_) { return null; }
}

function setMilvusLastSyncAt(clientId, iso) {
  try {
    if (typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem(MILVUS_SYNC_AT_KEY);
    const map = raw ? JSON.parse(raw) : {};
    map[clientId] = iso;
    localStorage.setItem(MILVUS_SYNC_AT_KEY, JSON.stringify(map));
  } catch (_) {}
}

// ── Leitura (RLS do Supabase aplica o isolamento; fallback p/ cache) ──
async function getClientDevices(clientId) {
  try {
    if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() &&
        typeof supabaseClient !== 'undefined' && supabaseClient) {
      const { data, error } = await supabaseClient
        .from('client_devices')
        .select('*')
        .eq('client_id', clientId)
        .order('hostname', { ascending: true });
      if (!error && Array.isArray(data)) {
        try {
          if (typeof setCacheStore === 'function') {
            const cached = typeof getCacheStore === 'function' ? getCacheStore('client_devices') : [];
            const others = (cached || []).filter((d) => d && d.client_id !== clientId);
            setCacheStore('client_devices', others.concat(data.map(mapMilvusRowToLocal)));
          }
        } catch (_) {}
        return data.map(mapMilvusRowToLocal);
      }
    }
  } catch (_) {}
  try {
    if (typeof getCacheStore === 'function') {
      return (getCacheStore('client_devices') || []).filter((d) => d && d.client_id === clientId);
    }
  } catch (_) {}
  return [];
}

function mapMilvusRowToLocal(r) {
  if (!r || typeof r !== 'object') return r;
  return {
    id: r.id,
    client_id: r.client_id,
    team: r.team,
    milvus_device_id: r.milvus_device_id,
    hostname: r.hostname || '',
    apelido: r.apelido || '',
    fabricante: r.fabricante || '',
    marca: r.marca || '',
    modelo_notebook: r.modelo_notebook || '',
    sistema_operacional: r.sistema_operacional || '',
    numero_serial: r.numero_serial || '',
    usuario_logado: r.usuario_logado || '',
    tipo_dispositivo_text: r.tipo_dispositivo_text || '',
    ip_interno: r.ip_interno || '',
    ip_externo: r.ip_externo || '',
    is_ativo: r.is_ativo !== false,
    data_ultima_atualizacao: r.data_ultima_atualizacao || r.updated_at || null,
    updatedAt: r.updated_at || null,
  };
}

// ── Sincronização: frontend → Edge Function (nunca Milvus direto) ──
async function syncClientDevices(clientId) {
  if (!clientId) throw new Error('Cliente inválido.');
  const client = typeof getClientById === 'function' ? getClientById(clientId) : null;
  if (!client) throw new Error('Cliente não encontrado.');
  try {
    const session = typeof getSession === 'function' ? getSession() : null;
    const operators = typeof getOperators === 'function' ? getOperators() : [];
    const me = session ? operators.find((o) => o.id === session.opId) : null;
    const opView = me
      ? { team: session.team || me.team, isAdmin: session.isAdmin === true || me.isAdmin === true, active: me.active }
      : { team: session ? session.team : 'init', isAdmin: session ? session.isAdmin === true : false, active: true };
    if (!canSyncClientDevices(opView, client)) {
      throw new Error('Acesso negado a este cliente.');
    }
  } catch (e) {
    if (e && /Acesso negado/.test(e.message)) throw e;
  }
  if (typeof isSupabaseConnected !== 'function' || !isSupabaseConnected() ||
      typeof supabaseClient === 'undefined' || !supabaseClient) {
    throw new Error('Sem conexão com o servidor.');
  }
  const { data, error } = await supabaseClient.functions.invoke('milvus-devices', {
    body: { clientId: clientId },
  });
  if (error) {
    // Mensagem amigável; detalhe técnico fica no log da Edge Function.
    throw new Error('Falha ao sincronizar inventário. Tente novamente.');
  }
  if (data && data.error) throw new Error('Falha ao sincronizar inventário. Tente novamente.');
  try {
    if (data && data.lastSyncAt) setMilvusLastSyncAt(clientId, data.lastSyncAt);
    else setMilvusLastSyncAt(clientId, new Date().toISOString());
  } catch (_) {}
  return data;
}

// Export para testes (Node/Vitest).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MILVUS_MAX_PAGES: MILVUS_MAX_PAGES,
    canSyncClientDevices: canSyncClientDevices,
    normalizeMilvusDevice: normalizeMilvusDevice,
    buildMilvusListPayload: buildMilvusListPayload,
    parseMilvusPage: parseMilvusPage,
    shouldStopMilvusPaging: shouldStopMilvusPaging,
    classifyMilvusError: classifyMilvusError,
    diffMilvusUpsert: diffMilvusUpsert,
  };
}
