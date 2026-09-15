// milvus-tickets.js — Últimos 10 chamados do Milvus por cliente
// =====================================================================
// Contexto rápido p/ visita — NÃO é cópia do Milvus. O frontend NUNCA
// acessa o Milvus direto e NUNCA vê o token.
// Fluxo: frontend → Edge Function `milvus-tickets` (valida JWT + team,
// mesma regra do RLS) → 1 consulta por cliente → top 10 → upsert+prune.

const MILVUS_TICKETS_SYNC_AT_KEY = 'intra_milvus_tickets_sync_at_v1';
const MILVUS_TICKETS_KEEP = 10;
const MILVUS_TICKETS_STALE_MS = 60 * 60 * 1000; // 60 min p/ auto-sync

// ── Autorização client-side (defesa; o servidor revalida) ──
function canViewMilvusTickets(operator, client) {
  if (!operator || !client) return false;
  if (operator.active === false) return false;
  if (operator.isAdmin === true) return true;
  return (operator.team || 'init') === (client.team || 'init');
}

// ── Normalização (espelho do servidor; só campos da tela compacta) ──
function normalizeMilvusTicket(raw, clientId, team) {
  if (!raw || typeof raw !== 'object') return null;
  const num = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  };
  const txt = (v) => (v === null || v === undefined ? '' : String(v));
  const iso = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const d = new Date(String(v).trim().replace(' ', 'T'));
    return isNaN(d.getTime()) ? null : d.toISOString();
  };
  const mid = num(raw.id);
  if (mid === null) return null;
  // NUNCA carrega: contato, e-mails, telefone, CPF/CNPJ, tokens,
  // avaliações, HTML, logs extras, dispositivo.
  const log = (raw.ultima_log && typeof raw.ultima_log === 'object') ? raw.ultima_log : null;
  return {
    id: clientId + ':ticket-' + mid,
    client_id: clientId,
    team: team || 'init',
    milvus_ticket_id: mid,
    codigo: num(raw.codigo),
    assunto: txt(raw.assunto),
    descricao: txt(raw.descricao),
    status: txt(raw.status),
    prioridade: txt(raw.prioridade),
    categoria_primaria: txt(raw.categoria_primaria),
    categoria_secundaria: txt(raw.categoria_secundaria),
    tecnico: txt(raw.tecnico),
    data_criacao: iso(raw.data_criacao),
    data_modificacao: iso(raw.data_modificacao),
    data_solucao: iso(raw.data_solucao),
    ultima_log: log
      ? { texto: txt(log.texto), data: iso(log.data), tecnico: txt(log.tecnico) }
      : null,
  };
}

// Ordena por código desc e corta no teto (puro, testável).
function topMilvusTickets(rows, keep) {
  const n = Math.max(1, keep || MILVUS_TICKETS_KEEP);
  return (rows || []).slice()
    .sort((a, b) => (Number(b && b.codigo) || 0) - (Number(a && a.codigo) || 0))
    .slice(0, n);
}

// Ids que sobram além do top (puro, testável). Escopo sempre 1 cliente.
function staleMilvusTicketIds(existingIds, keepIds) {
  const keep = new Set(keepIds || []);
  return (existingIds || []).filter((id) => !keep.has(id));
}

// Decide auto-sync na abertura: nunca sincronizado ou >60min.
function shouldAutoSyncMilvusTickets(lastSyncAt, nowMs) {
  if (!lastSyncAt) return true;
  const t = new Date(lastSyncAt).getTime();
  if (isNaN(t)) return true;
  const now = (typeof nowMs === 'number') ? nowMs : Date.now();
  return (now - t) > MILVUS_TICKETS_STALE_MS;
}

function getMilvusTicketsLastSyncAt(clientId) {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(MILVUS_TICKETS_SYNC_AT_KEY) : null;
    if (!raw) return null;
    const map = JSON.parse(raw);
    return (map && map[clientId]) || null;
  } catch (_) { return null; }
}

function setMilvusTicketsLastSyncAt(clientId, iso) {
  try {
    if (typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem(MILVUS_TICKETS_SYNC_AT_KEY);
    const map = raw ? JSON.parse(raw) : {};
    map[clientId] = iso;
    localStorage.setItem(MILVUS_TICKETS_SYNC_AT_KEY, JSON.stringify(map));
  } catch (_) {}
}

function _ticketOpView() {
  try {
    const session = typeof getSession === 'function' ? getSession() : null;
    const operators = typeof getOperators === 'function' ? getOperators() : [];
    const me = session ? operators.find((o) => o.id === session.opId) : null;
    if (me) {
      return { team: session.team || me.team, isAdmin: session.isAdmin === true || me.isAdmin === true, active: me.active };
    }
    return { team: session ? session.team : 'init', isAdmin: session ? session.isAdmin === true : false, active: true };
  } catch (_) {
    return { team: 'init', isAdmin: false, active: true };
  }
}

// Leitura via RLS (isolamento por equipe) + cache local de fallback.
async function getClientMilvusTickets(clientId) {
  try {
    if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() &&
        typeof supabaseClient !== 'undefined' && supabaseClient) {
      const { data, error } = await supabaseClient
        .from('client_milvus_tickets')
        .select('*')
        .eq('client_id', clientId)
        .order('codigo', { ascending: false })
        .limit(MILVUS_TICKETS_KEEP);
      if (!error && Array.isArray(data)) {
        try {
          if (typeof setCacheStore === 'function' && typeof getCacheStore === 'function') {
            const cached = getCacheStore('client_milvus_tickets') || [];
            const others = cached.filter((t) => t && t.client_id !== clientId);
            setCacheStore('client_milvus_tickets', others.concat(data));
          }
        } catch (_) {}
        return data;
      }
    }
  } catch (_) {}
  try {
    if (typeof getCacheStore === 'function') {
      return (getCacheStore('client_milvus_tickets') || [])
        .filter((t) => t && t.client_id === clientId)
        .sort((a, b) => (b.codigo || 0) - (a.codigo || 0))
        .slice(0, MILVUS_TICKETS_KEEP);
    }
  } catch (_) {}
  return [];
}

// Sincronização sob demanda: frontend → Edge (nunca Milvus direto).
async function syncClientMilvusTickets(clientId) {
  if (!clientId) throw new Error('Cliente inválido.');
  const client = typeof getClientById === 'function' ? getClientById(clientId) : null;
  if (!client) throw new Error('Cliente não encontrado.');
  if (!canViewMilvusTickets(_ticketOpView(), client)) {
    throw new Error('Acesso negado a este cliente.');
  }
  if (typeof isSupabaseConnected !== 'function' || !isSupabaseConnected() ||
      typeof supabaseClient === 'undefined' || !supabaseClient) {
    throw new Error('Sem conexão com o servidor.');
  }
  const { data, error } = await supabaseClient.functions.invoke('milvus-tickets', {
    body: { clientId: clientId },
  });
  if (error) throw new Error('Não foi possível atualizar os chamados do Milvus.');
  if (data && data.error) throw new Error('Não foi possível atualizar os chamados do Milvus.');
  // Estado controlado (ex.: sem token): não é exceção — a UI decide a mensagem.
  try {
    if (data && data.lastSyncAt) setMilvusTicketsLastSyncAt(clientId, data.lastSyncAt);
    else setMilvusTicketsLastSyncAt(clientId, new Date().toISOString());
  } catch (_) {}
  return data;
}

// Mapeia o retorno do sync p/ estado de UI (puro, testável).
function resolveMilvusTicketsSyncState(res) {
  if (res && res.code === 'MILVUS_CLIENT_TOKEN_NOT_CONFIGURED') return { kind: 'no-token' };
  if (res && res.unmapped) return { kind: 'unmapped' };
  return { kind: 'ok', synced: Number(res && res.synced) || 0 };
}

// Export para testes (Node/Vitest).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MILVUS_TICKETS_KEEP: MILVUS_TICKETS_KEEP,
    MILVUS_TICKETS_STALE_MS: MILVUS_TICKETS_STALE_MS,
    canViewMilvusTickets: canViewMilvusTickets,
    normalizeMilvusTicket: normalizeMilvusTicket,
    topMilvusTickets: topMilvusTickets,
    staleMilvusTicketIds: staleMilvusTicketIds,
    shouldAutoSyncMilvusTickets: shouldAutoSyncMilvusTickets,
    resolveMilvusTicketsSyncState: resolveMilvusTicketsSyncState,
    syncClientMilvusTickets: syncClientMilvusTickets,
  };
}
