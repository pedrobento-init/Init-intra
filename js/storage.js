// storage.js – Abstração do localStorage

const DB = {
  CLIENTS: 'intra_clients',
  PENDENCIAS: 'intra_pendencias',
  PROCEDURES: 'intra_procedures',
  PROCEDURE_TEMPLATES: 'intra_procedure_templates',
  OPERATORS: 'intra_operators',
  TICKETS: 'intra_tickets',
  VISITS: 'intra_visits',
  REUNIOES: 'intra_reunioes',
  EQUIPAMENTOS: 'intra_equipamentos',
  VENCIMENTOS: 'intra_vencimentos',
  USER: 'intra_user',
  COUNTER: 'intra_counter',
  SESSION: 'intra_session',
  LOGS: 'intra_logs',
};

// ── FILA DE SINCRONIZAÇÃO VISÍVEL ───────────────────────────────────────────
// Contador em memória (NÃO persistido): 1 por registro criado/editado
// localmente enquanto o push está indisponível. Boot sempre começa em 0.
// Escritas internas (merge do sync, realtime, seed, import/restore) NÃO
// contam como pendência — ver window._suppressPendingSync.
if (typeof window !== 'undefined') {
  if (typeof window._pendingSyncCount !== 'number') window._pendingSyncCount = 0;
  if (typeof window._syncPending !== 'number') window._syncPending = window._pendingSyncCount;
}
function _isPendingSuppressed() {
  try { if (typeof window !== 'undefined' && window._suppressPendingSync) return true; } catch (_) {}
  return false;
}
function getPendingSyncCount() {
  if (typeof window !== 'undefined') return window._pendingSyncCount || window._syncPending || 0;
  return 0;
}
// Centraliza a UI do banner a partir do contador real (evita texto travado).
// Nota: o banner #offlineBanner saiu do index.html (o chip #syncStatus é o
// único indicador agora) — sem os elementos, aqui vira no-op. Mantido porque
// o contrato (contador + efeitos) é coberto por tests/sync-counter.test.js.
function _refreshSyncBanner() {
  if (typeof window === 'undefined') return;
  try {
    const banner = typeof document !== 'undefined' ? document.getElementById('offlineBanner') : null;
    const msgEl = typeof document !== 'undefined' ? document.getElementById('offlineBannerMsg') : null;
    const syncBtn = typeof document !== 'undefined' ? document.getElementById('syncNowBtn') : null;
    if (!banner || !msgEl) return;
    const cnt = getPendingSyncCount();
    const online = typeof navigator === 'undefined' || navigator.onLine !== false;
    if (cnt > 0) {
      msgEl.textContent = cnt + ' alterações aguardando sincronizar';
      banner.className = 'offline-banner offline visible';
      if (syncBtn && online) syncBtn.style.display = 'inline-block';
    } else if (online) {
      banner.classList.remove('visible');
      if (syncBtn) syncBtn.style.display = 'none';
    } else {
      msgEl.textContent = 'Sem conexão – modo offline ativo';
      banner.className = 'offline-banner offline visible';
    }
  } catch (_) {}
}
function incrementPendingSync() {
  if (typeof window !== 'undefined') {
    if (_isPendingSuppressed()) return;
    window._pendingSyncCount = (window._pendingSyncCount || 0) + 1;
    window._syncPending = window._pendingSyncCount;
    _refreshSyncBanner();
  }
}
// Push ao Supabase falhou com rede online: a escrita não foi confirmada,
// então conta como pendente. Offline já foi contado no dbSet (sem duplicar).
function markSyncPushFailed() {
  try {
    const offline = (typeof navigator !== 'undefined' && navigator.onLine === false);
    if (!offline) incrementPendingSync();
  } catch (_) {}
}
function resetPendingSyncCount() {
  let prev = 0;
  if (typeof window !== 'undefined') {
    prev = window._pendingSyncCount || 0;
    window._pendingSyncCount = 0;
    window._syncPending = 0;
  }
  // TEMP-DEBUG: confirmar visualmente no console que o reset ocorreu após o sync.
  try { console.debug('[sync] concluída, contador resetado de ' + prev + ' para 0'); } catch (_) {}
  _refreshSyncBanner();
}

// ── TOMBSTONES DE DELEÇÃO (persistentes) + ÚLTIMO SYNC POR ENTIDADE ──────────
// Causa raiz (C1): o merge descarta todo local sem correspondente remoto.
// Sem distinguir os casos, isso apaga criados-offline (pull antes do push) e
// ressuscita deletados (pull/realtime após delete offline). Estratégia:
// - Todo delete* local grava tombstone `{ dbKey: { id: deletedAtISO } }` (TTL).
// - No sync: push dos deletes (idempotente) ANTES do pull/merge; linhas
//   remotas cobertas por tombstone são filtradas, salvo remoto mais novo
//   (recriado de verdade → revive e limpa o tombstone).
// - Locais sem correspondente: criado após o último sync ok (ou sem sync
//   anterior) → push; mais antigo → deletado no servidor → descarta local.
// Persistência em localStorage (sobrevive a reload, ao contrário do contador
// em memória); fallback em memória fora do browser (testes).
const TOMBSTONE_LS_KEY = 'intra_tombstones_v1';
const SYNC_AT_LS_KEY = 'intra_sync_at_v1';
let _memTombstones = null;
let _memSyncAt = null;
function _loadTombstones() {
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(TOMBSTONE_LS_KEY);
      if (raw) { const p = JSON.parse(raw); if (p && typeof p === 'object') return p; }
    } catch (_) {}
  }
  if (!_memTombstones) _memTombstones = {};
  return _memTombstones;
}
function _saveTombstones(t) {
  if (typeof localStorage !== 'undefined') {
    try { localStorage.setItem(TOMBSTONE_LS_KEY, JSON.stringify(t || {})); return; }
    catch (_) {}
  }
  _memTombstones = t || {};
}
function _addTombstone(dbKey, id, at) {
  if (!dbKey || !id) return;
  try {
    const t = _loadTombstones();
    if (!t[dbKey]) t[dbKey] = {};
    t[dbKey][id] = at || new Date().toISOString();
    _saveTombstones(t);
  } catch (_) {}
}
function _removeTombstone(dbKey, id) {
  try {
    const t = _loadTombstones();
    if (t && t[dbKey] && t[dbKey][id]) { delete t[dbKey][id]; _saveTombstones(t); }
  } catch (_) {}
}
// Guarda para o realtime (supabase-config.js): retorna o ISO ou null.
function _tombTimeFor(dbKey, id) {
  try { const t = _loadTombstones(); return (t && t[dbKey] && t[dbKey][id]) || null; }
  catch (_) { return null; }
}
function _clearTombstone(dbKey, id) { _removeTombstone(dbKey, id); }
function _pruneTombstonesPersisted() {
  try {
    const ttl = (typeof TOMBSTONE_TTL_MS === 'number') ? TOMBSTONE_TTL_MS : 30 * 86400000;
    const pruned = (typeof _pruneTombstones === 'function')
      ? _pruneTombstones(_loadTombstones(), Date.now(), ttl)
      : _loadTombstones();
    _saveTombstones(pruned);
  } catch (_) {}
}
function _loadSyncAt() {
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(SYNC_AT_LS_KEY);
      if (raw) { const p = JSON.parse(raw); if (p && typeof p === 'object') return p; }
    } catch (_) {}
  }
  if (!_memSyncAt) _memSyncAt = {};
  return _memSyncAt;
}
function _saveSyncAt(m) {
  if (typeof localStorage !== 'undefined') {
    try { localStorage.setItem(SYNC_AT_LS_KEY, JSON.stringify(m || {})); return; }
    catch (_) {}
  }
  _memSyncAt = m || {};
}
function _getLastSyncAt(table) {
  try { return _loadSyncAt()[table] || null; } catch (_) { return null; }
}
function _setLastSyncAt(table, iso) {
  try { const m = _loadSyncAt(); m[table] = iso; _saveSyncAt(m); } catch (_) {}
}

// ── PULL PAGINADO + SYNC PARCIAL (P-9 / SYNC-01 / PERF-01) ───────────────────
// SYNC-01: `select('*')` sem `.range()` é cortado pelo PostgREST (max-rows,
// padrão 1000) e as linhas além do corte eram tratadas como "deletadas no
// servidor". Agora o pull pagina por id. PERF-01: em vez de baixar a tabela
// inteira a cada sync, baixa só `id,updated_at` e busca a linha completa do
// que mudou; o que não mudou entra no merge reconstruído do local (o merge
// recebe exatamente o que receberia num pull completo). Sync completo 1x/dia.
const SYNC_PAGE_SIZE = 1000;
const SYNC_DELTA_CHUNK = 100;
const _FULL_KEY = (table) => '__full__:' + table;

async function _pullPaged(table, columns, timed, what) {
  const all = [];
  for (let from = 0; from <= 500000; from += SYNC_PAGE_SIZE) {
    const q = supabaseClient.from(table).select(columns);
    const ordered = q && typeof q.order === 'function' ? q.order('id', { ascending: true }) : null;
    // Cliente sem paginação (mocks/antigos): uma leitura só, como antes.
    if (!ordered || typeof ordered.range !== 'function') {
      const res = await timed(q, what);
      return { data: (res && res.data) || (res && res.error ? null : []), error: (res && res.error) || null };
    }
    const res = await timed(ordered.range(from, from + SYNC_PAGE_SIZE - 1), what + '@' + from);
    if (res && res.error) return { data: null, error: res.error };
    const rows = (res && res.data) || [];
    for (const r of rows) all.push(r);
    if (rows.length < SYNC_PAGE_SIZE) break;
  }
  return { data: all, error: null };
}

async function _pullEntityRows(e, local, timed) {
  const mapPayload = (rec) => (typeof e.buildUpsert === 'function') ? e.buildUpsert(rec) : _mapToRemote(rec, e.fields, e.optionalFields);
  // Tudo que o servidor devolve no pull está confirmado lá (faixa de pendentes).
  const _seen = (rows) => { try { if (rows && typeof markServerSeen === 'function') markServerSeen(e.table, rows); } catch (_) {} };
  const fullPull = async () => { const r = await _pullPaged(e.table, '*', timed, 'pull:' + e.table); _seen(r.data); return { ...r, mode: 'full' }; };
  const canDelta = typeof _shouldFullSync === 'function' && typeof _planDeltaPull === 'function';
  if (!canDelta || _shouldFullSync(e, _getLastSyncAt(_FULL_KEY(e.table)))) return fullPull();

  const light = await _pullPaged(e.table, 'id,updated_at', timed, 'pull-light:' + e.table);
  if (light.error) return { ...light, mode: 'delta' };
  _seen(light.data);
  const plan = _planDeltaPull(local, light.data);
  // Muita coisa mudou: uma leitura completa sai mais barata que N lotes.
  if (plan.changedIds.length > Math.max(300, light.data.length / 2)) return fullPull();

  const rows = [];
  for (let i = 0; i < plan.changedIds.length; i += SYNC_DELTA_CHUNK) {
    const q = supabaseClient.from(e.table).select('*');
    if (!q || typeof q.in !== 'function') return fullPull();
    const res = await timed(q.in('id', plan.changedIds.slice(i, i + SYNC_DELTA_CHUNK)), 'pull-delta:' + e.table);
    if (res && res.error) return { data: null, error: res.error, mode: 'delta' };
    for (const r of ((res && res.data) || [])) rows.push(r);
  }
  const localById = new Map((local || []).map(r => [r.id, r]));
  const lightById = new Map(light.data.map(r => [r.id, r]));
  for (const id of plan.sameIds) {
    const loc = localById.get(id);
    if (!loc) continue;
    rows.push({ ...mapPayload(loc), id, updated_at: lightById.get(id).updated_at });
  }
  try { console.debug('[sync] ' + e.table + ': parcial — ' + plan.changedIds.length + ' alterado(s), ' + plan.sameIds.length + ' igual(is).'); } catch (_) {}
  return { data: rows, error: null, mode: 'delta' };
}

// ── EQUIPES / PERFIS ──
// Poiesis 1-6 unificados em "poiesis" único (031). Legados mantidos como alias.
const TEAMS = {
  INIT: 'init',
  MAM: 'mam',
  POIESIS: 'poiesis',
  BT: 'bt',
  // aliases retrocompatíveis — não usar em novos registros
  POIESIS_1: 'poiesis',
  POIESIS_2: 'poiesis',
  POIESIS_3: 'poiesis',
  POIESIS_4: 'poiesis',
  POIESIS_5: 'poiesis',
  POIESIS_6: 'poiesis',
};

const TEAM_LABELS = {
  init: 'Init',
  mam: 'MAM',
  poiesis: 'Poiesis',
  bt: 'BT',
  // legados (leitura de dados antigos)
  poiesis_1: 'Poiesis',
  poiesis_2: 'Poiesis',
  poiesis_3: 'Poiesis',
  poiesis_4: 'Poiesis',
  poiesis_5: 'Poiesis',
  poiesis_6: 'Poiesis',
};

const TEAM_OPTIONS = [
  { value: 'init', label: 'Init' },
  { value: 'mam', label: 'MAM' },
  { value: 'poiesis', label: 'Poiesis' },
  { value: 'bt', label: 'BT' },
];

function normalizeTeam(team){
  if(!team) return team;
  var t=String(team).toLowerCase().trim();
  if(t.indexOf('poiesis_')===0) return 'poiesis';
  return t;
}

// ── PIN HASH (SHA-256 via crypto.subtle – assíncrono e nativo) ──
async function hashPin(pin, salt) {
  const str = 'intra:' + String(pin) + (salt ? ':' + String(salt) : '');
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}


// ── SESSÃO ──
const SESSION_TTL = 8 * 60 * 60 * 1000; // 8 horas

function getSession() {
  try {
    const cache = typeof getCacheTable === 'function' ? getCacheTable('sessions') : null;
    const s = cache?.value || null;
    if (!s) return null;
    if (Date.now() - s.ts > SESSION_TTL) { clearSession(); return null; }
    return s;
  } catch { return null; }
}

function setSession(opId) {
  const op = getOperatorById(opId);
  if (!op) return null;
  const session = {
    opId,
    name:     op.name,
    initials: op.initials || op.name.substring(0, 2).toUpperCase(),
    color:    op.color || '#1a56db',
    role:     op.role || 'Técnico',
    isAdmin:  op.isAdmin === true,
    isGestao: (typeof isGestaoOperator === 'function') ? isGestaoOperator(op) : false,
    team:     op.team || 'init',
    ts: Date.now(),
  };
  if (typeof setCacheTable === 'function') setCacheTable('sessions', { key: DB.SESSION, value: session });
  return session;
}

function clearSession() {
  if (typeof setCacheTable === 'function') setCacheTable('sessions', { key: DB.SESSION, value: null });
}

// ── TEAM HELPERS ──
function getCurrentTeam() {
  const session = getSession();
  return normalizeTeam(session?.team || 'init');
}

function isTeamAdmin() {
  return getCurrentPermissions().viewAll;
}

function canViewTeam(targetTeam) {
  if (isTeamAdmin()) return true;
  return normalizeTeam(getCurrentTeam()) === normalizeTeam(targetTeam || 'init');
}

function filterByTeam(items) {
  if (isTeamAdmin()) return items;
  const myTeam = normalizeTeam(getCurrentTeam());
  return items.filter(i => normalizeTeam(i.team || 'init') === myTeam);
}

// ── GESTÃO (tipo de ação restrito: só Felipe e Joarli) ──────────────────────
// Regra: pendências com tipo Gestão/Gestao são invisíveis para quem não é
// Gestão — em TODAS as telas (lista, busca, calendário, dashboard, contadores).
// Identidade: flag operators.is_gestao (migration 037) + fallback por nome
// (pré-migration / offline / seed), para não travar se a coluna ainda não
// sincronizou. Pedro fica de fora por definição (só Felipe e Joarli).
function _normGestaoText(s) {
  try {
    return String(s || '').trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  } catch (_) {
    return String(s || '').trim().toLowerCase();
  }
}
function isPendenciaGestao(p) {
  if (!p) return false;
  const t = _normGestaoText(p.tipo);
  return t === 'gestao';
}
function _isGestaoName(name) {
  const n = _normGestaoText(name);
  if (!n) return false;
  return n.indexOf('felipe') !== -1 || n.indexOf('joarli') !== -1;
}
function isGestaoOperator(op) {
  if (!op) return false;
  if (op.isGestao === true || op.is_gestao === true) return true;
  if (op.active === false) return false;
  return _isGestaoName(op.name);
}
function canViewGestao() {
  try {
    if (typeof getSession !== 'function') return false;
    const session = getSession();
    if (!session) return false;
    if (session.isGestao === true) return true;
    if (typeof getOperatorById !== 'function') return _isGestaoName(session.name);
    const op = getOperatorById(session.opId);
    if (!op) return _isGestaoName(session.name);
    return isGestaoOperator(op);
  } catch (_) { return false; }
}
function canViewPendencia(p) {
  if (!p) return false;
  if (!isPendenciaGestao(p)) return true;
  return canViewGestao();
}
function filterGestaoPendencias(list) {
  const arr = Array.isArray(list) ? list : [];
  if (canViewGestao()) return arr;
  return arr.filter(p => !isPendenciaGestao(p));
}
// Log de pendência Gestão: esconder por completo de quem não é Gestão
// (Histórico global, histórico do cliente, export CSV). Usa o vínculo
// targetId → pendência; se a pendência foi excluída, o detalhe já foi
// redigido na escrita ([Gestão – restrito]) e o marcador sozinho não
// identifica conteúdo — mas ainda ocultamos quando dá para vincular.
function isGestaoLog(log) {
  try {
    if (!log) return false;
    var _t = String(log.type || '').trim().toLowerCase();
    try { _t = _t.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (_) {}
    if (_t !== 'pendencia') return false;
    if (typeof getPendenciaById !== 'function' || typeof isPendenciaGestao !== 'function') return false;
    var _p = log.targetId ? getPendenciaById(log.targetId) : null;
    return !!(_p && isPendenciaGestao(_p));
  } catch (_) { return false; }
}
function filterGestaoLogs(logs) {
  try {
    const arr = Array.isArray(logs) ? logs : [];
    if (typeof canViewGestao === 'function' && canViewGestao()) return arr;
    if (typeof isGestaoLog !== 'function') return arr;
    return arr.filter(l => !isGestaoLog(l));
  } catch (_) { return Array.isArray(logs) ? logs : []; }
}

// Migra registros locais legados poiesis_1..6 -> poiesis (idempotente).
// Resquício pós-migração 031: após a primeira varredura sem nada a migrar,
// carimba flag local e as próximas cargas retornam de imediato (evita iterar
// 8 tabelas a cada boot). O servidor já foi unificado pela 031, então nenhum
// registro poiesis_N novo pode chegar depois do carimbo.
var _POIESIS_MIG_FLAG = 'intra_poiesis_migrated_v1';
async function _migratePoiesisTeamsLocal(){
  try{
    try {
      if (typeof localStorage !== 'undefined' && localStorage.getItem(_POIESIS_MIG_FLAG) === '1') return;
    } catch (_) {}
    if(typeof getCacheStore!=='function' || typeof setCacheStore!=='function') return;
    var tables=['clients','pendencias','operators','visits','reunioes','equipamentos','tickets','client_devices','client_milvus_tickets'];
    var anyChanged=false;
    for(var ti=0; ti<tables.length; ti++){
      var t=tables[ti];
      try{
        var rows=getCacheStore(t);
        if(!Array.isArray(rows) || !rows.length) continue;
        var changed=false;
        var now=new Date().toISOString();
        for(var i=0;i<rows.length;i++){
          var r=rows[i];
          if(r && r.team && String(r.team).indexOf('poiesis_')===0){
            r.team='poiesis';
            if('updatedAt' in r) r.updatedAt=now;
            if('updated_at' in r) r.updated_at=now;
            changed=true;
          }
        }
        if(changed){ setCacheStore(t, rows); anyChanged=true; }
      }catch(_){}
    }
    // sessão legada
    try{
      var sess=getSession();
      if(sess && sess.team && String(sess.team).indexOf('poiesis_')===0){
        sess.team='poiesis';
        if(typeof setCacheTable==='function') setCacheTable('sessions', {key: DB.SESSION, value: sess});
        anyChanged=true;
      }
    }catch(_){}
    if(!anyChanged){
      try { if (typeof localStorage !== 'undefined') localStorage.setItem(_POIESIS_MIG_FLAG, '1'); } catch (_) {}
    }
  }catch(_){}
}
if(typeof window!=='undefined'){
  // tenta após DB pronto, com fallback imediato
  if(typeof _initDBPromise!=='undefined' && _initDBPromise && typeof _initDBPromise.then==='function'){
    _initDBPromise.then(function(){ _migratePoiesisTeamsLocal(); }).catch(function(){});
  }
  window.addEventListener('load', function(){ setTimeout(_migratePoiesisTeamsLocal, 800); });
}

// ── Migração one-shot: status legados de pendência ───────────────────────────
// 'concluido' → 'resolvido', 'fechado' → 'cancelado'. Idempotente: sem linhas
// legadas, não faz nada. Roda no boot em cada aparelho (cobre o Dexie local)
// e empurra o mesmo mapeamento ao Supabase (cobre o banco compartilhado;
// o eco do realtime converge pelo updatedAt sem loop).
var _legacyPenStatusMigratedAtBoot = false;
function _migrateLegacyPenStatuses() {
  if (_legacyPenStatusMigratedAtBoot) return 0;
  _legacyPenStatusMigratedAtBoot = true;
  var map = { concluido: 'resolvido', fechado: 'cancelado' };
  var touched = 0;
  try {
    if (typeof getPendencias !== 'function') return 0;
    var list = getPendencias();
    if (!Array.isArray(list)) return 0;
    // updatedAt vai para "agora": sem o bump, um pull/eco com timestamps
    // empatados faz o remoto (legado) vencer o merge e o status antigo volta.
    var now3 = new Date().toISOString();
    var changed = false;
    for (var i = 0; i < list.length; i++) {
      var to = list[i] && map[list[i].status];
      if (to) {
        list[i] = { ...list[i], status: to, updatedAt: now3 };
        touched++;
        changed = true;
      }
    }
    if (!changed) return 0;
    dbSet(DB.PENDENCIAS, list); // emite bus → UI/badges acompanham
  } catch (_) { return 0; }
  try {
    if (typeof isSupabaseConnected === 'function' && isSupabaseConnected()
        && typeof window !== 'undefined' && window._supabaseAuthActive
        && typeof supabaseClient !== 'undefined' && supabaseClient) {
      var now2 = new Date().toISOString();
      supabaseClient.from('pendencias').update({ status: 'resolvido', updated_at: now2 }).in('status', ['concluido'])
        .then(function(res) { if (res && res.error) console.warn('⚠️ Migração status p/ resolvido:', res.error.message); })
        .catch(function() {});
      supabaseClient.from('pendencias').update({ status: 'cancelado', updated_at: now2 }).in('status', ['fechado'])
        .then(function(res) { if (res && res.error) console.warn('⚠️ Migração status p/ cancelado:', res.error.message); })
        .catch(function() {});
    }
  } catch (_) {}
  try {
    if (touched > 0 && typeof showToast === 'function') showToast(touched + (touched === 1 ? ' pendência antiga atualizada' : ' pendências antigas atualizadas') + ' para os novos status.', 'info');
    else console.debug('[migração] status legados convertidos: ' + touched);
  } catch (_) {}
  return touched;
}
if(typeof window!=='undefined'){
  if(typeof _initDBPromise!=='undefined' && _initDBPromise && typeof _initDBPromise.then==='function'){
    _initDBPromise.then(function(){ try { _migrateLegacyPenStatuses(); } catch (_) {} }).catch(function(){});
  }
  window.addEventListener('load', function(){ setTimeout(function(){ try { _migrateLegacyPenStatuses(); } catch (_) {} }, 1200); });
}

const KEY_TO_TABLE = {
  [DB.CLIENTS]: 'clients',
  [DB.PENDENCIAS]: 'pendencias',
  [DB.PROCEDURES]: 'procedures',
  [DB.PROCEDURE_TEMPLATES]: 'procedure_templates',
  [DB.OPERATORS]: 'operators',
  [DB.TICKETS]: 'tickets',
  [DB.VISITS]: 'visits',
  [DB.REUNIOES]: 'reunioes',
  [DB.EQUIPAMENTOS]: 'equipamentos',
  [DB.VENCIMENTOS]: 'vencimentos'
};

const KV_TO_V2TABLE = {
  [DB.USER]: 'user_profile',
  [DB.COUNTER]: 'counters',
  [DB.SESSION]: 'sessions',
  [DB.LOGS]: 'audit_logs'
};

function dbGet(key) {
  if (typeof getCacheStore === 'function') {
    if (KEY_TO_TABLE[key]) {
      return getCacheStore(KEY_TO_TABLE[key]);
    }
    if (KV_TO_V2TABLE[key]) {
      const table = KV_TO_V2TABLE[key];
      const entry = typeof getCacheTable === 'function' ? getCacheTable(table) : null;
      return entry?.value ?? (table === 'audit_logs' ? [] : {});
    }
    if (typeof getCacheKV === 'function') return getCacheKV(key, []);
  }
  console.error('dbGet called before IndexedDB is ready for key:', key);
  return [];
}

function dbGetObj(key, def = {}) {
  if (typeof getCacheKV === 'function' && !KV_TO_V2TABLE[key]) {
    return getCacheKV(key, def);
  }
  if (KV_TO_V2TABLE[key]) {
    const table = KV_TO_V2TABLE[key];
    const entry = typeof getCacheTable === 'function' ? getCacheTable(table) : null;
    return entry?.value ?? def;
  }
  console.error('dbGetObj called before IndexedDB is ready for key:', key);
  return def;
}

function dbSet(key, value) {
  try {
    if (!_isPendingSuppressed()) {
      const offline = (typeof navigator !== 'undefined' && navigator.onLine === false);
      const notConnected = typeof isSupabaseConnected === 'function' ? (!isSupabaseConnected() || !window._supabaseAuthActive) : false;
      if (offline || notConnected) incrementPendingSync();
    }
  } catch (_) {}
  if (typeof setCacheStore === 'function') {
    if (KEY_TO_TABLE[key]) {
      setCacheStore(KEY_TO_TABLE[key], value);
    } else if (KV_TO_V2TABLE[key]) {
      const table = KV_TO_V2TABLE[key];
      if (typeof setCacheTable === 'function') setCacheTable(table, { key, value });
    } else {
      setCacheKV(key, value);
    }
    try{
      if(!_isPendingSuppressed() && typeof window!=='undefined' && typeof window.emitDataChanged==='function'){
        var _map={}; _map[DB.CLIENTS]='clientes'; _map[DB.PENDENCIAS]='pendencias'; _map[DB.OPERATORS]='operadores'; _map[DB.VISITS]='visitas'; _map[DB.REUNIOES]='reunioes'; _map[DB.EQUIPAMENTOS]='equipamentos'; _map[DB.VENCIMENTOS]='vencimentos'; _map[DB.PROCEDURES]='procedimentos'; _map[DB.PROCEDURE_TEMPLATES]='templates';
        var _ent=_map[key];
        if(_ent) window.emitDataChanged(_ent, {key:key, via:'dbSet'});
      }
    }catch(_){}
    return;
  }
  console.error('dbSet called before IndexedDB is ready for key:', key);
}

function nextId(prefix) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${_secureRandStr(6)}`;
}

/**
 * Gera uma string aleatória criptograficamente segura (hex chars).
 * Substitui Math.random() para geração de IDs.
 */
function _secureRandStr(len) {
  const arr = new Uint8Array(Math.ceil(len / 2));
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('').slice(0, len);
}

// ── SUPABASE CLOUD SYNC HELPERS ──
// (_valuesDiffer, _mergeRecords, _mapToRemote, _mapFromRemote e _needsPush
//  agora vivem em js/schema.js — fonte única.)

// ── OFFLINE-FIRST: boot sync não-bloqueante + verificação real de backend ────
// Regras:
// - A UI sempre monta a partir do banco local; o sync roda em segundo plano.
// - `navigator.onLine` NÃO decide sozinho: antes de sincronizar há uma leitura
//   real e barata no backend, com timeout curto.
// - Falha de rede/timeout/backend fora do ar NUNCA lança exceção para fora e
//   NUNCA apaga dado local: o que não foi confirmado permanece pendente.
// - Logs com prefixo [sync] marcam início, fim, motivo e o tipo da falha
//   (conectividade × dados/conflito).
const BACKEND_CHECK_TIMEOUT_MS = 5000;
const SUPABASE_OP_TIMEOUT_MS = 12000;
const SYNC_RETRY_DELAY_MS = 30000;

let _syncRetryTimer = null;

function _isBrowserOnline() {
  try { if (typeof navigator !== 'undefined' && navigator.onLine === false) return false; }
  catch (_) {}
  return true;
}

// Corrida com timeout que nunca mantém o processo vivo (unref em Node/testes).
function _withSyncTimeout(promise, ms, label) {
  let timer = null;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`[sync] timeout após ${ms}ms em ${label || 'backend'}`);
      err.code = 'SYNC_TIMEOUT';
      reject(err);
    }, ms);
    try { if (timer && typeof timer.unref === 'function') timer.unref(); } catch (_) {}
  });
  return Promise.race([Promise.resolve(promise), guard]).then(
    (v) => { try { clearTimeout(timer); } catch (_) {} return v; },
    (e) => { try { clearTimeout(timer); } catch (_) {} throw e; }
  );
}

// Diferencia erro de CONECTIVIDADE (rede/timeout/backend fora do ar → tenta
// de novo depois) de erro de DADOS (HTTP 4xx, validação, conflito → loga e
// segue, sem retry agressivo).
function _isConnectivityError(err) {
  if (!err) return false;
  try {
    if (err.code === 'SYNC_TIMEOUT') return true;
    const status = Number(err.status ?? err.statusCode ?? (err.error && err.error.status));
    if (status === 502 || status === 503 || status === 504) return true;
    if (status >= 400 && status < 500) return false;
  } catch (_) {}
  const msg = String((err && err.message) || err || '').toLowerCase();
  return /timeout|timed out|failed to fetch|fetch failed|networkerror|network request failed|failed to load|load failed|offline|econn|enotfound|eai_again|ehostunreach|enetunreach|socket|dns|abort|aborted|connection|internet|503|502|504|temporar|unavailable|indispon/.test(msg);
}

// Erro de AUTENTICAÇÃO (401/JWT expirado): não é rede nem dado inválido —
// é sessão. Tratar como dado ("pulado" por item) martela o backend com um
// 401 por registro; tratar como conectividade agenda retries inúteis.
// Caminho certo: refresh da sessão uma vez e short-circuit das entidades.
function _isAuthError(err) {
  if (!err) return false;
  const msg = String((err && err.message) || err || '').toLowerCase();
  // Assinatura de SESSÃO expirada/inválida (log real: "JWT expired").
  // 401 puro com mensagem genérica (ex: RLS "permissão") é erro de DADOS,
  // não de sessão — mantém o legado (reachable na checagem, "pulado" no item).
  return /jwt expired|invalid jwt|token expired|expired token|session expired|expired session|unauthorized|invalid token|missing[^a-z]*token|token[^a-z]*missing|refresh token/.test(msg);
}

// Tenta renovar a sessão Supabase (uma vez). Retorna true se há sessão válida.
async function _refreshSupabaseSession() {
  try {
    if (typeof supabaseClient === 'undefined' || !supabaseClient || !supabaseClient.auth) return false;
    const { data, error } = await supabaseClient.auth.refreshSession();
    if (error || !data || !data.session) return false;
    return true;
  } catch (_) { return false; }
}

// Verificação REAL do backend (não só navigator.onLine): leitura barata com
// timeout. Nunca lança exceção; retorna { ok, reason, detail }.
async function checkBackendConnectivity(opts) {
  const o = opts || {};
  const timeoutMs = Number(o.timeoutMs) > 0 ? Number(o.timeoutMs) : BACKEND_CHECK_TIMEOUT_MS;
  if (!_isBrowserOnline()) return { ok: false, reason: 'offline', detail: 'navegador sem conexão (navigator.onLine=false)' };
  try {
    if (typeof isSupabaseConnected !== 'function' || !isSupabaseConnected()) {
      return { ok: false, reason: 'not-configured', detail: 'cliente Supabase ausente' };
    }
    if (typeof window !== 'undefined' && window._supabaseAuthActive === false) {
      return { ok: false, reason: 'not-authenticated', detail: 'sessão Supabase inativa' };
    }
    const t0 = Date.now();
    const res = await _withSyncTimeout(
      supabaseClient.from('operators').select('id').limit(1),
      timeoutMs,
      'backend-check'
    );
    if (res && res.error && _isAuthError(res.error)) {
      // Sessão expirada: tenta renovar uma vez antes de desistir do sync.
      // Sem isso cada entidade do sync falharia com 401 individual.
      if (await _refreshSupabaseSession()) {
        const retry = await _withSyncTimeout(
          supabaseClient.from('operators').select('id').limit(1),
          timeoutMs,
          'backend-check-retry'
        );
        if (!retry || !retry.error) {
          return { ok: true, reason: 'reachable', latencyMs: Date.now() - t0, refreshed: true };
        }
      }
      return { ok: false, reason: 'not-authenticated', detail: 'sessão Supabase expirada e refresh falhou' };
    }
    if (res && res.error && _isConnectivityError(res.error)) {
      return { ok: false, reason: 'connectivity', detail: String(res.error.message || res.error) };
    }
    // Respondeu (mesmo com erro de dados/permissão): backend está alcançável.
    return { ok: true, reason: 'reachable', latencyMs: Date.now() - t0 };
  } catch (err) {
    const connective = _isConnectivityError(err);
    return { ok: false, reason: connective ? 'connectivity' : 'error', detail: String((err && err.message) || err) };
  }
}

function _scheduleSyncRetry(syncReason) {
  try {
    if (typeof window === 'undefined') return;
    if (_syncRetryTimer) return; // já há uma nova tentativa agendada
    _syncRetryTimer = setTimeout(() => {
      _syncRetryTimer = null;
      try {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
          _scheduleSyncRetry(syncReason); // aba oculta: adia sem gastar rede
          return;
        }
      } catch (_) {}
      triggerStartupSync('retry:' + (syncReason || 'sync'));
    }, SYNC_RETRY_DELAY_MS);
    try { if (_syncRetryTimer && typeof _syncRetryTimer.unref === 'function') _syncRetryTimer.unref(); } catch (_) {}
  } catch (_) {}
}

// Disparo padrão (boot, online, aba visível, retry): nunca bloqueia a UI e
// nunca lança — toda falha vira { ok:false, reason } + log + banner.
// Ao assentar (ok ou falha), acorda o processador de chamados Milvus
// pendentes (js/milvus-chamado.js) — sem alterar o resultado do sync.
function _kickMilvusChamados(reason) {
  try { if (typeof processPendingMilvusChamados === 'function') processPendingMilvusChamados('post-sync:' + (reason || 'startup')); } catch (_) {}
  try { if (typeof processPendingMilvusFinalizar === 'function') processPendingMilvusFinalizar('post-sync:' + (reason || 'startup')); } catch (_) {}
}
// Manutenção local dos números amigáveis (backfill + anti-colisão).
// Roda após boot e após cada sync (mesmo offline/falho): só escreve no
// banco local, nunca depende de rede, nunca relança.
function _kickVisitNumeros(_reason) {
  try { if (typeof maintainVisitNumeros === 'function') maintainVisitNumeros(); } catch (_) {}
}
function triggerStartupSync(reason) {
  try {
    const p = syncSupabaseToLocal({ reason: reason || 'startup' });
    if (p && typeof p.then === 'function') {
      return p.then(
        (r) => { _kickVisitNumeros(reason); _kickMilvusChamados(reason); return r; },
        (err) => {
          console.warn('[sync] falha inesperada (' + (reason || 'startup') + '):', (err && err.message) || err, '— dados locais preservados.');
          try { _refreshSyncBanner(); } catch (_) {}
          _kickVisitNumeros(reason);
          _kickMilvusChamados(reason);
          return { ok: false, reason: 'unexpected', detail: String((err && err.message) || err) };
        }
      );
    }
    _kickVisitNumeros(reason);
    _kickMilvusChamados(reason);
    return Promise.resolve(p);
  } catch (err) {
    console.warn('[sync] falha inesperada (' + (reason || 'startup') + '):', (err && err.message) || err, '— dados locais preservados.');
    return Promise.resolve({ ok: false, reason: 'unexpected', detail: String((err && err.message) || err) });
  }
}

let _syncPromise = null;
// opts: { reason, checkTimeoutMs, opTimeoutMs, retry }
// Retorna SEMPRE um resultado { ok, reason, ... } — nunca lança para os
// chamadores (a UI/offline-first jamais pode cair por causa do sync).
async function syncSupabaseToLocal(opts) {
  const reason = (opts && opts.reason) || 'manual';
  if (typeof isSupabaseConnected !== 'function' || !isSupabaseConnected()) {
    console.info('[sync] pulada (motivo: ' + reason + '): backend não configurado — mantendo dados locais.');
    return { ok: false, reason: 'not-configured' };
  }
  if (_syncPromise) return _syncPromise;
  _syncPromise = _runSupabaseSync(reason, opts);
  try { return await _syncPromise; } finally { _syncPromise = null; }
}

async function _runSupabaseSync(reason, opts) {
  const label = reason || 'startup';
  const o = opts || {};
  const opTimeoutMs = Number(o.opTimeoutMs) > 0 ? Number(o.opTimeoutMs) : SUPABASE_OP_TIMEOUT_MS;
  const checkTimeoutMs = Number(o.checkTimeoutMs) > 0 ? Number(o.checkTimeoutMs) : BACKEND_CHECK_TIMEOUT_MS;
  const allowRetry = o.retry !== false;
  console.info('[sync] iniciada (motivo: ' + label + ')');

  // Caminho rápido offline: sem internet, nenhuma chamada ao backend (evita
  // timeouts longos) — a UI já está utilizável com o banco local.
  if (!_isBrowserOnline()) {
    console.info('[sync] sem conectividade (navegador offline) — mantendo dados locais; tentativa pendente.');
    try { _refreshSyncBanner(); } catch (_) {}
    if (allowRetry) _scheduleSyncRetry(label);
    return { ok: false, reason: 'offline' };
  }

  // Verificação real do backend com timeout (não confia só em navigator.onLine).
  const check = await checkBackendConnectivity({ timeoutMs: checkTimeoutMs });
  if (!check.ok) {
    if (check.reason === 'not-authenticated') {
      console.info('[sync] pulada (motivo: ' + label + '): sessão inativa — mantendo dados locais.');
      return { ok: false, reason: 'not-authenticated' };
    }
    console.warn('[sync] backend indisponível (' + check.reason + (check.detail ? ': ' + check.detail : '') + ') — mantendo dados locais; tenta de novo depois.');
    try { _refreshSyncBanner(); } catch (_) {}
    if (allowRetry) _scheduleSyncRetry(label);
    return { ok: false, reason: check.reason, detail: check.detail };
  }

  let totalConflicts = 0;
  let allConflictDetails = [];
  let connectivityFailed = false;
  let authFailed = false;
  let _authWarned = false;
  const timed = (promise, what) => _withSyncTimeout(promise, opTimeoutMs, what);
  // Sessão expirada no meio do sync: renova uma vez e pula o restante do
  // ciclo (cada item daria 401). Sem short-circuit seriam dezenas de 401s.
  function _noteAuthFailure(where) {
    authFailed = true;
    if (!_authWarned) {
      _authWarned = true;
      console.warn('[sync] sessão expirada (' + where + ') — renovando e pulando o restante deste ciclo; dados locais preservados.');
      try {
        const r = _refreshSupabaseSession();
        if (r && typeof r.catch === 'function') r.catch(function () {});
      } catch (_) {}
    }
  }

  // Ordem segura anti-perda (C1): push-deletes → pull → push-criados →
  // merge → dbSet → push-updates. Falhas de item não abortam as demais
  // entidades; lastSyncAt só avança com a entidade 100% ok (viés: em dúvida,
  // preserva o dado local em vez de descartar).
  const _syncEntity = async (e) => {
    let entityOk = true;
    // Sem conectividade no meio do sync: pula as demais entidades de imediato
    // (evita N timeouts em sequência); o local fica intacto e pendente.
    if (connectivityFailed) {
      console.info('[sync] ' + e.table + ' pulada: conectividade perdida nesta sincronização — dados locais preservados.');
      return false;
    }
    // Sessão expirada: pula as demais entidades de imediato (evita N 401s).
    if (authFailed) {
      return false;
    }
    let pull;
    try {
      pull = await _pullEntityRows(e, dbGet(e.dbKey), timed);
    } catch (err) {
      if (_isConnectivityError(err)) {
        connectivityFailed = true;
        console.warn('[sync] ' + e.table + ': sem conectividade (' + ((err && err.message) || err) + ') — mantendo dados locais.');
      } else {
        console.warn('[sync] ' + e.table + ' (erro de leitura):', (err && err.message) || err);
      }
      // Entidade opcional (tabela pode não existir no banco):
      // pula sem marcar erro — comportamento anterior a C1. Falha de
      // conectividade, porém, sempre marca pendência (precisa de retry).
      if (e.optional && !_isConnectivityError(err)) return true;
      return false;
    }
    const { data: remoteRaw, error } = pull || {};
    if (error) {
      if (_isAuthError(error)) {
        _noteAuthFailure('pull:' + e.table);
        return false;
      }
      if (_isConnectivityError(error)) {
        connectivityFailed = true;
        console.warn(`[sync] ${e.table} (conectividade):`, error.message || error, '— mantendo dados locais.');
        return false;
      }
      console.warn(`Supabase ${e.table} error:`, error);
      // Entidade opcional (tabela pode não existir no banco):
      // pula sem marcar erro — comportamento anterior a C1.
      if (e.optional) return true;
      return false;
    }
    if (!remoteRaw) return true;
    const nowIso = new Date().toISOString();
    const mapPayload = (rec) => (typeof e.buildUpsert === 'function') ? e.buildUpsert(rec) : _mapToRemote(rec, e.fields, e.optionalFields);
    // 1. Push de deletes pendentes (tombstones) — idempotente.
    let tombsForKey = {};
    try { tombsForKey = _loadTombstones()[e.dbKey] || {}; } catch (_) { tombsForKey = {}; }
    for (const tid of Object.keys(tombsForKey)) {
      try {
        const res = await timed(supabaseClient.from(e.table).delete().eq('id', tid), 'push-delete:' + e.table);
        if (res && res.error) throw new Error(res.error.message || 'delete falhou');
      } catch (err) {
        if (_isAuthError(err)) {
          _noteAuthFailure('push-delete:' + e.table);
        } else if (_isConnectivityError(err)) {
          connectivityFailed = true;
          console.warn(`[sync] ${e.table} (delete ${tid}): sem conectividade — exclusão segue pendente.`);
        } else {
          console.warn(`Supabase ${e.table} (delete ${tid} pulado):`, err && err.message);
        }
        entityOk = false;
      }
    }
    // 2. Filtra o remoto contra tombstones (revive só se recriado depois).
    let remote = remoteRaw;
    try {
      const fr = (typeof _filterRemoteByTombstones === 'function')
        ? _filterRemoteByTombstones(remoteRaw, tombsForKey, 'updated_at')
        : { remote: remoteRaw, revived: [] };
      remote = fr.remote;
      (fr.revived || []).forEach(id => _removeTombstone(e.dbKey, id));
    } catch (_) {}
    const remoteById = new Map(remote.map(r => [r.id, r]));
    // 3. Locais sem correspondente: push (criado offline) vs drop (deletado
    //    no servidor). Classificação pura e testável em schema.js.
    const local = dbGet(e.dbKey);
    let toPush = [];
    try {
      const cls = (typeof _classifyLocalOnly === 'function')
        ? _classifyLocalOnly(local.filter(l => !remoteById.has(l.id)), _getLastSyncAt(e.table))
        : { toPush: [], toDrop: [] };
      toPush = cls.toPush;
    } catch (_) { toPush = []; }
    const synthRemote = [];
    const failedPush = [];
    for (const rec of toPush) {
      try {
        const res = await timed(supabaseClient.from(e.table).upsert(mapPayload(rec)), 'push-create:' + e.table);
        if (res && res.error) throw new Error(res.error.message || 'upsert falhou');
        const synth = mapPayload(rec);
        if (synth && typeof synth === 'object') {
          if (!synth.updated_at) synth.updated_at = rec.updatedAt || nowIso;
          synthRemote.push({ ...synth, id: rec.id });
        } else {
          synthRemote.push({ id: rec.id, updated_at: rec.updatedAt || nowIso });
        }
      } catch (err) {
        if (_isAuthError(err)) {
          _noteAuthFailure('push-create:' + e.table);
        } else if (_isConnectivityError(err)) {
          connectivityFailed = true;
          console.warn(`[sync] ${e.table} (push ${rec.id}): sem conectividade — registro segue pendente, sem perda local.`);
        } else {
          console.warn(`Supabase ${e.table} (push ${rec.id} pulado):`, err && err.message);
        }
        entityOk = false;
        failedPush.push(rec);
      }
    }
    // 4. Merge (genérico, inalterado) + persistência local. Registros cujo
    // push falhou são retidos no merged: descartá-los seria perda de dados.
    const { merged, conflicts, conflictDetails } = _mergeRecords(local, remote.concat(synthRemote), e.fields);
    totalConflicts += conflicts;
    allConflictDetails.push(...conflictDetails.map(d => ({ ...d, table: e.label })));
    let final = (typeof e.onMerged === 'function') ? e.onMerged(merged, local, remote) : merged;
    try {
      if (typeof _retainFailedPush === 'function') final = _retainFailedPush(final, failedPush) || final;
      else if (failedPush.length) {
        const ids = new Set(final.map(m => m && m.id));
        for (const rec of failedPush) if (rec && rec.id && !ids.has(rec.id)) { final.push(rec); ids.add(rec.id); }
      }
    } catch (_) {}
    dbSet(e.dbKey, final);
    // 5. Push de updates — por item (um item com falha não trava os demais).
    // Falha de background NÃO incrementa o contador (ele conta alterações
    // do usuário, já contabilizadas; inflar aqui prendia o banner).
    const remoteById2 = new Map(remote.concat(synthRemote).map(r => [r.id, r]));
    for (const rec of final) {
      const r = remoteById2.get(rec.id);
      if (_needsPush(rec, r)) {
        try {
          const res = await timed(supabaseClient.from(e.table).upsert(mapPayload(rec)), 'push-update:' + e.table);
          if (res && res.error) throw new Error(res.error.message || 'upsert falhou');
        } catch (err) {
          if (_isAuthError(err)) {
            _noteAuthFailure('push-update:' + e.table);
          } else if (_isConnectivityError(err)) {
            connectivityFailed = true;
            console.warn(`[sync] ${e.table} (push ${rec.id}): sem conectividade — alteração segue pendente, sem perda local.`);
          } else {
            console.warn(`Supabase ${e.table} (push ${rec.id} pulado):`, err && err.message);
          }
          entityOk = false;
        }
      }
    }
    if (entityOk) {
      _setLastSyncAt(e.table, nowIso);
      if (pull && pull.mode === 'full') _setLastSyncAt(_FULL_KEY(e.table), nowIso);
    }
    return entityOk;
  };

  // Escritas do próprio merge (1 dbSet por entidade) não são mudanças
  // pendentes — sem essa supressão o contador somava ~nº de tabelas por sync.
  if (typeof window !== 'undefined') window._suppressPendingSync = true;
  let syncHadErrors = false;
  try {
    try { _pruneTombstonesPersisted(); } catch (_) {}
    // Entidades são independentes (tabelas distintas): sincronizam em paralelo
    // com concorrência limitada — a ordem interna de cada entidade (C1:
    // push-deletes → pull → push → merge) é preservada. Cai de soma(N) para
    // ~soma(N)/3 no tempo de boot. Semântica de erro idêntica à serial.
    const _runEntity = async (e) => {
      if (e.optional) {
        try { if ((await _syncEntity(e)) === false) syncHadErrors = true; }
        catch (err) { console.warn(`Supabase ${e.table} (sync pulado — tabela ausente?):`, err.message); }
      } else {
        try { if ((await _syncEntity(e)) === false) syncHadErrors = true; }
        catch (err) { console.warn(`Supabase ${e.table} (sync pulado):`, err.message); syncHadErrors = true; }
      }
    };
    {
      const _queue = SYNC_ENTITIES.slice();
      const _poolSize = (typeof SYNC_ENTITY_CONCURRENCY === 'number' && SYNC_ENTITY_CONCURRENCY >= 1)
        ? Math.floor(SYNC_ENTITY_CONCURRENCY) : 3;
      const _workers = Array.from(
        { length: Math.min(_poolSize, _queue.length) || 1 },
        async () => { while (_queue.length) { const _e = _queue.shift(); if (!_e) return; await _runEntity(_e); } }
      );
      await Promise.all(_workers);
    }

    if (connectivityFailed) syncHadErrors = true;
    if (authFailed) syncHadErrors = true;

    // LOGS — merge remote with local (don't wipe local logs). Com timeout:
    // um hang aqui nunca trava o fim do sync nem ameaça os dados locais.
    // Pulado direto se a sessão expirou (evita mais um 401).
    try {
      if (authFailed) throw { status: 401, message: 'skipped: sessão expirada neste ciclo' };
      const logsRes = await timed(supabaseClient.from('audit_logs').select('*').order('timestamp', { ascending: false }).limit(500), 'pull:audit_logs');
      const { data: remoteLogs, error: logErr } = logsRes || {};
      if (logErr && _isAuthError(logErr)) throw logErr;
      if (logErr) console.warn('Supabase logs error:', logErr);
      if (remoteLogs && remoteLogs.length > 0) {
        const mapped = remoteLogs.map(l => ({ id: l.id, operatorName: l.operator_name, action: l.action, type: l.type, targetId: l.target_id, details: l.details, timestamp: l.timestamp }));
        const localLogs = getLogs();
        const logKey = l => l.id || `${l.timestamp || ''}-${l.action || ''}-${l.targetId || ''}`;
        const allIds = new Map(localLogs.map(l => [logKey(l), l]));
        for (const l of mapped) { allIds.set(logKey(l), l); }
        const mergedLogs = [...allIds.values()].sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
        if (typeof setCacheTable === 'function') setCacheTable('audit_logs', mergedLogs);
        else dbSet(DB.LOGS, mergedLogs);
      }
    } catch (err) {
      if (_isConnectivityError(err)) {
        connectivityFailed = true;
        syncHadErrors = true;
        console.warn('[sync] logs (sem conectividade — mantidos locais):', (err && err.message) || err);
      } else {
        console.warn('[sync] logs (pulados):', (err && err.message) || err);
      }
    }

    // Só zera o contador com sync 100% ok; com falha, mantém o banner com
    // a contagem real (falha de background não soma: o contador é de
    // alterações do usuário, e inflá-lo prendia o banner para sempre).
    if (!syncHadErrors) {
      if (allConflictDetails.length > 0) {
        console.debug('[sync]', `${allConflictDetails.length} registro(s) alinhado(s) com o servidor em background.`);
      }
      console.info('[sync] concluída com sucesso (motivo: ' + label + '): ' + SYNC_ENTITIES.length + ' entidade(s), ' + totalConflicts + ' conflito(s).');
      resetPendingSyncCount();
      return { ok: true, reason: 'synced', conflicts: totalConflicts };
    }
    if (authFailed) {
      console.warn('[sync] interrompida por sessão expirada (motivo: ' + label + ') — sessão renovada em background; dados locais preservados.');
    } else if (connectivityFailed) {
      console.warn('[sync] interrompida por falha de conectividade (motivo: ' + label + ') — dados locais preservados; pendências mantidas para a próxima tentativa.');
    } else {
      console.warn('[sync] concluída com erros parciais de dados (motivo: ' + label + ') — itens não confirmados seguem pendentes.');
    }
    try { _refreshSyncBanner(); } catch (_) {}
    if (allowRetry) _scheduleSyncRetry(label);
    return { ok: false, reason: authFailed ? 'not-authenticated' : (connectivityFailed ? 'connectivity' : 'partial'), conflicts: totalConflicts };
  } catch (err) {
    console.warn('[sync] falhou (erro inesperado, motivo: ' + label + '):', (err && err.message) || err, '— dados locais preservados.');
    // Sync falhou: mantém a contagem real e reflete no banner (sem zerar).
    try { _refreshSyncBanner(); } catch (_) {}
    if (allowRetry) _scheduleSyncRetry(label);
    return { ok: false, reason: 'unexpected', detail: String((err && err.message) || err) };
  } finally {
    if (typeof window !== 'undefined') window._suppressPendingSync = false;
  }
}

// ── Sincronização automática na abertura (offline-first) ──
// O disparo principal ocorre em _startApp (app.js), DEPOIS de carregar o banco
// local e montar a UI. Este listener é uma redundância para recarregamentos
// com sessão já ativa. triggerStartupSync nunca bloqueia a interface e nunca
// lança exceção (verificação de backend com timeout + fallback local).
if (typeof window !== 'undefined') {
  window.addEventListener('load', () => setTimeout(() => {
    try { if (typeof triggerStartupSync === 'function') triggerStartupSync('window-load'); } catch (_) {}
  }, 500));
}

