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

// Migra registros locais legados poiesis_1..6 -> poiesis (idempotente)
async function _migratePoiesisTeamsLocal(){
  try{
    if(typeof getCacheStore!=='function' || typeof setCacheStore!=='function') return;
    var tables=['clients','pendencias','operators','visits','reunioes','tickets','client_devices','client_milvus_tickets'];
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
        if(changed) setCacheStore(t, rows);
      }catch(_){}
    }
    // sessão legada
    try{
      var sess=getSession();
      if(sess && sess.team && String(sess.team).indexOf('poiesis_')===0){
        sess.team='poiesis';
        if(typeof setCacheTable==='function') setCacheTable('sessions', {key: DB.SESSION, value: sess});
      }
    }catch(_){}
  }catch(_){}
}
if(typeof window!=='undefined'){
  // tenta após DB pronto, com fallback imediato
  if(typeof _initDBPromise!=='undefined' && _initDBPromise && typeof _initDBPromise.then==='function'){
    _initDBPromise.then(function(){ _migratePoiesisTeamsLocal(); }).catch(function(){});
  }
  window.addEventListener('load', function(){ setTimeout(_migratePoiesisTeamsLocal, 800); });
}

const KEY_TO_TABLE = {
  [DB.CLIENTS]: 'clients',
  [DB.PENDENCIAS]: 'pendencias',
  [DB.PROCEDURES]: 'procedures',
  [DB.PROCEDURE_TEMPLATES]: 'procedure_templates',
  [DB.OPERATORS]: 'operators',
  [DB.TICKETS]: 'tickets',
  [DB.VISITS]: 'visits',
  [DB.REUNIOES]: 'reunioes'
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
        var _map={}; _map[DB.CLIENTS]='clientes'; _map[DB.PENDENCIAS]='pendencias'; _map[DB.OPERATORS]='operadores'; _map[DB.VISITS]='visitas'; _map[DB.REUNIOES]='reunioes'; _map[DB.PROCEDURES]='procedimentos'; _map[DB.PROCEDURE_TEMPLATES]='templates';
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
}
function triggerStartupSync(reason) {
  try {
    const p = syncSupabaseToLocal({ reason: reason || 'startup' });
    if (p && typeof p.then === 'function') {
      return p.then(
        (r) => { _kickMilvusChamados(reason); return r; },
        (err) => {
          console.warn('[sync] falha inesperada (' + (reason || 'startup') + '):', (err && err.message) || err, '— dados locais preservados.');
          try { _refreshSyncBanner(); } catch (_) {}
          _kickMilvusChamados(reason);
          return { ok: false, reason: 'unexpected', detail: String((err && err.message) || err) };
        }
      );
    }
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
  const timed = (promise, what) => _withSyncTimeout(promise, opTimeoutMs, what);

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
    let pull;
    try {
      pull = await timed(supabaseClient.from(e.table).select('*'), 'pull:' + e.table);
    } catch (err) {
      if (_isConnectivityError(err)) {
        connectivityFailed = true;
        console.warn('[sync] ' + e.table + ': sem conectividade (' + ((err && err.message) || err) + ') — mantendo dados locais.');
      } else {
        console.warn('[sync] ' + e.table + ' (erro de leitura):', (err && err.message) || err);
      }
      // Entidade opcional (tabela pode não existir, ex.: tickets 404):
      // pula sem marcar erro — comportamento anterior a C1. Falha de
      // conectividade, porém, sempre marca pendência (precisa de retry).
      if (e.optional && !_isConnectivityError(err)) return true;
      return false;
    }
    const { data: remoteRaw, error } = pull || {};
    if (error) {
      if (_isConnectivityError(error)) {
        connectivityFailed = true;
        console.warn(`[sync] ${e.table} (conectividade):`, error.message || error, '— mantendo dados locais.');
        return false;
      }
      console.warn(`Supabase ${e.table} error:`, error);
      // Entidade opcional (tabela pode não existir, ex.: tickets 404):
      // pula sem marcar erro — comportamento anterior a C1.
      if (e.optional) return true;
      return false;
    }
    if (!remoteRaw) return true;
    const nowIso = new Date().toISOString();
    const mapPayload = (rec) => (typeof e.buildUpsert === 'function') ? e.buildUpsert(rec) : _mapToRemote(rec, e.fields);
    // 1. Push de deletes pendentes (tombstones) — idempotente.
    let tombsForKey = {};
    try { tombsForKey = _loadTombstones()[e.dbKey] || {}; } catch (_) { tombsForKey = {}; }
    for (const tid of Object.keys(tombsForKey)) {
      try {
        const res = await timed(supabaseClient.from(e.table).delete().eq('id', tid), 'push-delete:' + e.table);
        if (res && res.error) throw new Error(res.error.message || 'delete falhou');
      } catch (err) {
        if (_isConnectivityError(err)) {
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
        if (_isConnectivityError(err)) {
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
          if (_isConnectivityError(err)) {
            connectivityFailed = true;
            console.warn(`[sync] ${e.table} (push ${rec.id}): sem conectividade — alteração segue pendente, sem perda local.`);
          } else {
            console.warn(`Supabase ${e.table} (push ${rec.id} pulado):`, err && err.message);
          }
          entityOk = false;
        }
      }
    }
    if (entityOk) _setLastSyncAt(e.table, nowIso);
    return entityOk;
  };

  // Escritas do próprio merge (1 dbSet por entidade) não são mudanças
  // pendentes — sem essa supressão o contador somava ~nº de tabelas por sync.
  if (typeof window !== 'undefined') window._suppressPendingSync = true;
  let syncHadErrors = false;
  try {
    try { _pruneTombstonesPersisted(); } catch (_) {}
    for (const e of SYNC_ENTITIES) {
      if (e.optional) {
        try { if ((await _syncEntity(e)) === false) syncHadErrors = true; }
        catch (err) { console.warn(`Supabase ${e.table} (sync pulado — tabela ausente?):`, err.message); }
      } else {
        try { if ((await _syncEntity(e)) === false) syncHadErrors = true; }
        catch (err) { console.warn(`Supabase ${e.table} (sync pulado):`, err.message); syncHadErrors = true; }
      }
    }

    if (connectivityFailed) syncHadErrors = true;

    // LOGS — merge remote with local (don't wipe local logs). Com timeout:
    // um hang aqui nunca trava o fim do sync nem ameaça os dados locais.
    try {
      const logsRes = await timed(supabaseClient.from('audit_logs').select('*').order('timestamp', { ascending: false }).limit(500), 'pull:audit_logs');
      const { data: remoteLogs, error: logErr } = logsRes || {};
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
    if (connectivityFailed) {
      console.warn('[sync] interrompida por falha de conectividade (motivo: ' + label + ') — dados locais preservados; pendências mantidas para a próxima tentativa.');
    } else {
      console.warn('[sync] concluída com erros parciais de dados (motivo: ' + label + ') — itens não confirmados seguem pendentes.');
    }
    try { _refreshSyncBanner(); } catch (_) {}
    if (allowRetry) _scheduleSyncRetry(label);
    return { ok: false, reason: connectivityFailed ? 'connectivity' : 'partial', conflicts: totalConflicts };
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

// ── HISTÓRICO DE ATIVIDADES ──
function getLogs() {
  if (typeof getCacheTable === 'function') {
    const data = getCacheTable('audit_logs');
    return Array.isArray(data) ? data : [];
  }
  const v = dbGet(DB.LOGS);
  return Array.isArray(v) ? v : [];
}

function addLog(action, type, targetId, details) {
  const session = getSession();
  const operatorName = session ? session.name : 'Sistema';
  const log = {
    id: nextId('LOG'),
    timestamp: new Date().toISOString(),
    operatorName,
    action,
    type,
    targetId,
    details: details || '',
    operatorId: session?.opId || null
  };

  if (typeof getCacheTable === 'function' && typeof setCacheTable === 'function') {
    const logs = getLogs();
    logs.unshift(log);
    const uniqueLogs = [...new Map(logs.map(item => [item.id || `${item.timestamp}-${item.action}-${item.targetId}`, item])).values()];
    if (uniqueLogs.length > 2000) uniqueLogs.length = 2000;
    setCacheTable('audit_logs', uniqueLogs);
  } else {
    const logs = getLogs();
    logs.unshift(log);
    if (logs.length > 2000) logs.pop();
    dbSet(DB.LOGS, logs);
  }

  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    supabaseClient.from('audit_logs').insert([{
      id: log.id,
      operator_name: log.operatorName,
      action: log.action,
      type: log.type,
      target_id: log.targetId,
      details: log.details,
      timestamp: log.timestamp
    }]).then(res => { if(res.error) console.warn('⚠️ Supabase log:', res.error.message); })
      .catch(err => console.warn('⚠️ Rede log:', err.message));
  }

  return log;
}

// ── ATTACHMENTS ──
const ATTACHMENT_MAX_SIZE = 2 * 1024 * 1024; // 2MB
const ATTACHMENT_MAX_COUNT = 5;

function getAttachments(type, itemId) {
  // type = 'clients' | 'pendencias' | 'tickets'
  const keyMap = { clients: DB.CLIENTS, pendencias: DB.PENDENCIAS, tickets: DB.TICKETS };
  const list = dbGet(keyMap[type] || type);
  const item = list.find(i => i.id === itemId);
  return (item && item.attachments) ? item.attachments : [];
}

async function _uploadAttachmentToStorage(type, itemId, attId, file) {
  if (typeof isSupabaseConnected !== 'function' || !isSupabaseConnected() || !window._supabaseAuthActive) return null;
  try {
    const path = `${type}/${itemId}/${attId}-${file.name}`;
    const { error } = await supabaseClient.storage.from('attachments').upload(path, file, { upsert: true });
    if (error) { console.warn('Storage upload error:', error.message); return null; }
    const { data } = supabaseClient.storage.from('attachments').getPublicUrl(path);
    return { url: data?.publicUrl || null, path };
  } catch (e) { console.warn('Storage upload exception:', e); return null; }
}

// ── FASE 2: backfill incremental base64 → Storage (compatível) ──────────────
// Anexos antigos (ou criados offline) têm só `data` (dataURL embutido, pesado:
// viaja em todo select/sync/cache). Quando ONLINE, sobe o conteúdo p/ o mesmo
// bucket/path de sempre e troca por url/path, zerando `data`. Render e
// download preferem `url` e funcionam com ambos (renderAttachmentList:715) —
// nada quebra se a migração não rodar (offline) ou falhar (mantém `data`).
// Sem spam: persiste via dbSet; o sync de fundo propaga pelo _needsPush.
function _dataUrlToBlob(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const m = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!m) return null;
  try {
    const mime = m[1] || 'application/octet-stream';
    const raw = m[3] || '';
    const bin = (typeof atob === 'function' ? atob(raw)
      : Buffer.from(raw, 'base64').toString('binary'));
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    if (typeof Blob === 'function') return new Blob([bytes], { type: mime });
    return null;
  } catch (_) { return null; }
}

async function migrateAttachmentDataToStorage(type, itemId) {
  try {
    if (typeof isSupabaseConnected !== 'function' || !isSupabaseConnected()
        || (typeof window !== 'undefined' && !window._supabaseAuthActive)) return 0;
    if (typeof File === 'undefined' || typeof supabaseClient === 'undefined') return 0;
    const keyMap = { clients: DB.CLIENTS, pendencias: DB.PENDENCIAS, tickets: DB.TICKETS };
    const key = keyMap[type];
    if (!key) return 0;
    const list = dbGet(key);
    const idx = list.findIndex(i => i.id === itemId);
    if (idx === -1 || !Array.isArray(list[idx].attachments)) return 0;
    let migrated = 0;
    for (const att of list[idx].attachments) {
      if (!att || !att.data || att.url || att._migrating) continue;
      att._migrating = true;
      try {
        const blob = _dataUrlToBlob(att.data);
        if (!blob) continue;
        const file = new File([blob], att.name || 'anexo', { type: att.mimeType || blob.type });
        const up = await _uploadAttachmentToStorage(type, itemId, att.id, file);
        if (up && up.url) {
          att.url = up.url; att.path = up.path; att.data = null; migrated++;
        }
      } catch (_) { /* mantém base64 — tenta de novo na próxima vez */ }
      finally { delete att._migrating; }
    }
    if (migrated) {
      list[idx].updatedAt = new Date().toISOString();
      dbSet(key, list); // sync de fundo propaga (sem e-mail de "atualizado")
    }
    return migrated;
  } catch (_) { return 0; }
}

function addAttachment(type, itemId, fileObj) {
  // fileObj = {name, mimeType/type, size, data (base64) | url, path}
  if (fileObj.size > ATTACHMENT_MAX_SIZE) {
    return { error: 'Arquivo excede o limite de 2MB.' };
  }
  const keyMap = { clients: DB.CLIENTS, pendencias: DB.PENDENCIAS, tickets: DB.TICKETS };
  const key = keyMap[type];
  if (!key) return { error: 'Tipo inválido.' };
  const list = dbGet(key);
  const idx = list.findIndex(i => i.id === itemId);
  if (idx === -1) return { error: 'Item não encontrado.' };
  if (!list[idx].attachments) list[idx].attachments = [];
  if (list[idx].attachments.length >= ATTACHMENT_MAX_COUNT) {
    return { error: `Máximo de ${ATTACHMENT_MAX_COUNT} anexos por item.` };
  }
  const att = {
    id: fileObj.id || ('ATT-' + Date.now() + '-' + _secureRandStr(4)),
    name: fileObj.name,
    mimeType: fileObj.mimeType || fileObj.type,
    size: fileObj.size,
    data: fileObj.data || null,
    url: fileObj.url || null,
    path: fileObj.path || null,
    uploadedBy: (getSession()?.name) || 'Sistema',
    uploadedAt: new Date().toISOString()
  };
  list[idx].attachments.push(att);
  list[idx].updatedAt = new Date().toISOString();
  dbSet(key, list);
  addLog('Anexou arquivo', type === 'clients' ? 'Cliente' : type === 'pendencias' ? 'Pendência' : 'Chamado', itemId, fileObj.name);
  return { success: true, attachment: att };
}

function removeAttachment(type, itemId, attachmentId) {
  const keyMap = { clients: DB.CLIENTS, pendencias: DB.PENDENCIAS, tickets: DB.TICKETS };
  const key = keyMap[type];
  if (!key) return false;
  const list = dbGet(key);
  const idx = list.findIndex(i => i.id === itemId);
  if (idx === -1) return false;
  if (!list[idx].attachments) return false;
  const attIdx = list[idx].attachments.findIndex(a => a.id === attachmentId);
  if (attIdx === -1) return false;
  const att = list[idx].attachments[attIdx];
  const attName = att.name;
  list[idx].attachments.splice(attIdx, 1);
  list[idx].updatedAt = new Date().toISOString();
  dbSet(key, list);
  addLog('Removeu anexo', type === 'clients' ? 'Cliente' : type === 'pendencias' ? 'Pendência' : 'Chamado', itemId, attName);
  if (att.path && typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    supabaseClient.storage.from('attachments').remove([att.path]).then(res => { if (res.error) console.warn('Storage remove error:', res.error.message); }).catch(() => {});
  }
  return true;
}

function handleFileUpload(type, itemId, inputElement, callback) {
  const file = inputElement.files[0];
  if (!file) return;
  if (file.size > ATTACHMENT_MAX_SIZE) {
    if (typeof showToast === 'function') showToast('Arquivo excede o limite de 2MB.', 'error');
    inputElement.value = '';
    return;
  }
  inputElement.value = '';
  (async () => {
    const attId = 'ATT-' + Date.now() + '-' + _secureRandStr(4);
    let url = null, path = null, data = null;
    try {
      const up = await _uploadAttachmentToStorage(type, itemId, attId, file);
      if (up) { url = up.url; path = up.path; }
    } catch (e) { url = null; }
    if (!url) {
      try {
        data = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.onerror = reject;
          r.readAsDataURL(file);
        });
      } catch (e) { data = null; }
    }
    const result = addAttachment(type, itemId, {
      id: attId, name: file.name, mimeType: file.type, size: file.size, data, url, path
    });
    if (result && result.error) {
      if (typeof showToast === 'function') showToast(result.error, 'error');
    } else {
      if (typeof showToast === 'function') showToast('Arquivo anexado!', 'success');
      if (callback) callback(result.attachment);
    }
  })();
}

function renderAttachmentList(type, itemId, containerId) {
  const atts = getAttachments(type, itemId);
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!atts.length) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:12px;padding:8px 0">Nenhum anexo.</p>';
    return;
  }
  // FASE 2: 1× por container, migra base64→Storage em fundo e re-renderiza
  // só se algo mudou (comportamento idêntico se offline/falha).
  if (!container._attBackfillDone && atts.some(a => a && a.data && !a.url)
      && typeof migrateAttachmentDataToStorage === 'function') {
    container._attBackfillDone = true;
    migrateAttachmentDataToStorage(type, itemId).then(n => {
      if (n > 0 && container.isConnected) renderAttachmentList(type, itemId, containerId);
    }).catch(() => {});
  }
  container.innerHTML = atts.map(a => {
    const isImage = a.mimeType && a.mimeType.startsWith('image/');
    const sizeKB = (a.size / 1024).toFixed(1);
    const icon = isImage ? '🖼️' : a.mimeType?.includes('pdf') ? '📄' : '📎';
    const src = a.url || a.data || '';
    return `<div class="attachment-item">
      ${isImage ? `<img src="${src}" class="attachment-thumb" alt="${escapeHtml(a.name)}" onclick="window.open(this.src,'_blank')" />` : `<div class="attachment-icon">${icon}</div>`}
      <div class="attachment-info">
        <div class="attachment-name">${escapeHtml(a.name)}</div>
        <div class="attachment-meta">${sizeKB} KB · ${escapeHtml(a.uploadedBy)} · ${formatDateTime(a.uploadedAt)}</div>
      </div>
      <div class="attachment-actions">
        <a href="${src}" download="${escapeHtml(a.name)}" class="btn btn-sm btn-secondary" title="Baixar">⬇</a>
        <button class="btn btn-sm btn-danger" onclick="removeAttachmentUI('${type}','${itemId}','${a.id}','${containerId}')" title="Remover">✕</button>
      </div>
    </div>`;
  }).join('');
}

function removeAttachmentUI(type, itemId, attId, containerId) {
  if (removeAttachment(type, itemId, attId)) {
    if (typeof showToast === 'function') showToast('Anexo removido.', 'info');
    renderAttachmentList(type, itemId, containerId);
  }
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ── CLIENT DOCUMENTS (permanentes, campo documents) ──
function getClientDocuments(clientId) {
  const c = getClientById(clientId);
  return (c && c.documents) ? c.documents : [];
}

function addClientDocument(clientId, fileObj) {
  if (fileObj.size > ATTACHMENT_MAX_SIZE) return { error: 'Arquivo excede o limite de 2MB.' };
  const list = dbGet(DB.CLIENTS);
  const idx = list.findIndex(function(c){ return c.id === clientId; });
  if (idx === -1) return { error: 'Cliente não encontrado.' };
  if (!list[idx].documents) list[idx].documents = [];
  if (list[idx].documents.length >= ATTACHMENT_MAX_COUNT) return { error: 'Máximo de ' + ATTACHMENT_MAX_COUNT + ' documentos por cliente.' };
  var doc = {
    id: fileObj.id || ('DOC-' + Date.now() + '-' + _secureRandStr(4)),
    name: fileObj.name,
    mimeType: fileObj.mimeType || fileObj.type,
    size: fileObj.size,
    data: fileObj.data || null,
    url: fileObj.url || null,
    path: fileObj.path || null,
    uploadedBy: (getSession && getSession()?.name) || 'Sistema',
    uploadedAt: new Date().toISOString()
  };
  list[idx].documents.push(doc);
  list[idx].updatedAt = new Date().toISOString();
  dbSet(DB.CLIENTS, list);
  addLog('Anexou documento', 'Cliente', clientId, fileObj.name);
  return { success: true, document: doc };
}

function removeClientDocument(clientId, docId) {
  const list = dbGet(DB.CLIENTS);
  const idx = list.findIndex(function(c){ return c.id === clientId; });
  if (idx === -1) return false;
  if (!list[idx].documents) return false;
  var dIdx = list[idx].documents.findIndex(function(d){ return d.id === docId; });
  if (dIdx === -1) return false;
  var doc = list[idx].documents[dIdx];
  var docName = doc.name;
  list[idx].documents.splice(dIdx, 1);
  list[idx].updatedAt = new Date().toISOString();
  dbSet(DB.CLIENTS, list);
  addLog('Removeu documento', 'Cliente', clientId, docName);
  if (doc.path && typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    supabaseClient.storage.from('attachments').remove([doc.path]).then(function(res){ if(res.error) console.warn('Storage remove error:', res.error.message); }).catch(function(){});
  }
  return true;
}

function renderClientDocumentsList(clientId, containerId) {
  var docs = getClientDocuments(clientId);
  var container = document.getElementById(containerId);
  if (!container) return;
  if (!docs.length) { container.innerHTML = '<p style="color:var(--text-muted);font-size:12px;padding:8px 0">Nenhum documento permanente.</p>'; return; }
  container.innerHTML = docs.map(function(a){
    var isImage = a.mimeType && a.mimeType.startsWith('image/');
    var sizeKB = (a.size / 1024).toFixed(1);
    var icon = isImage ? '🖼️' : a.mimeType && a.mimeType.includes('pdf') ? '📄' : '📎';
    var src = a.url || a.data || '';
    return '<div class="attachment-item">' +
      (isImage ? '<img src="' + src + '" class="attachment-thumb" alt="' + escapeHtml(a.name) + '" onclick="window.open(this.src,\'_blank\')" />' : '<div class="attachment-icon">' + icon + '</div>') +
      '<div class="attachment-info"><div class="attachment-name">' + escapeHtml(a.name) + '</div><div class="attachment-meta">' + sizeKB + ' KB · ' + escapeHtml(a.uploadedBy) + ' · ' + formatDateTime(a.uploadedAt) + '</div></div>' +
      '<div class="attachment-actions"><a href="' + src + '" download="' + escapeHtml(a.name) + '" class="btn btn-sm btn-secondary" title="Baixar">⬇</a><button class="btn btn-sm btn-danger" onclick="removeClientDocumentUI(\'' + clientId + '\',\'' + a.id + '\',\'' + containerId + '\')" title="Remover">✕</button></div></div>';
  }).join('');
}

function removeClientDocumentUI(clientId, docId, containerId) {
  if (removeClientDocument(clientId, docId)) {
    if (typeof showToast === 'function') showToast('Documento removido.', 'info');
    renderClientDocumentsList(clientId, containerId);
  }
}

function handleClientDocumentUpload(clientId, inputElement, callback) {
  var file = inputElement.files[0];
  if (!file) return;
  if (file.size > ATTACHMENT_MAX_SIZE) { if (typeof showToast === 'function') showToast('Arquivo excede o limite de 2MB.', 'error'); inputElement.value=''; return; }
  inputElement.value='';
  (async function(){
    var docId = 'DOC-' + Date.now() + '-' + _secureRandStr(4);
    var url=null,path=null,data=null;
    try { var up = await _uploadAttachmentToStorage('clients', clientId, docId, file); if(up){ url=up.url; path=up.path; } } catch(e){ url=null; }
    if (!url) {
      try { data = await new Promise(function(resolve,reject){ var r=new FileReader(); r.onload=function(){ resolve(r.result); }; r.onerror=reject; r.readAsDataURL(file); }); } catch(e){ data=null; }
    }
    var result = addClientDocument(clientId, { id:docId, name:file.name, mimeType:file.type, size:file.size, data:data, url:url, path:path });
    if (result && result.error) { if (typeof showToast==='function') showToast(result.error,'error'); }
    else { if (typeof showToast==='function') showToast('Documento anexado!', 'success'); if (callback) callback(result.document); renderClientDocumentsList(clientId, 'cliDocumentsList'); }
  })();
}

// ── CLIENTS ──
function getClients() {
  const all = dbGet(DB.CLIENTS);
  return all.slice().sort((a, b) =>
    (a.name || '').localeCompare(b.name || '', 'pt-BR', { sensitivity: 'base', numeric: true })
  );
}
function getClientsByTeam(team) {
  const all = getClients();
  if (!team) return all;
  return all.filter(c => (c.team || 'init') === team);
}
function getMyClients() {
  return filterByTeam(getClients());
}
function getClientById(id) { return dbGet(DB.CLIENTS).find(c => c.id === id) || null; }
function saveClient(data) {
  const clients = getClients();
  const isEdit = !!data.id;
  var now = new Date().toISOString();
  if (!data.team) data.team = getCurrentTeam();
  if (isEdit) {
    const i = clients.findIndex(c => c.id === data.id);
    if (i !== -1) clients[i] = { ...clients[i], ...data, updatedAt: now };
  } else {
    data.id = nextId('CLI');
    data.createdAt = now;
    data.updatedAt = now;
    clients.push(data);
  }
  dbSet(DB.CLIENTS, clients);
  addLog(isEdit ? 'Editou' : 'Criou', 'Cliente', data.id, data.name);

  // Sync Supabase
  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    supabaseClient.from('clients').upsert({
      id: data.id,
      name: data.name,
      cnpj: data.cnpj,
      segment: data.segment,
      color: data.color,
      initials: data.initials,
      logo: data.logo,
      logo_shape: data.logoShape || 'circle',
      owner: data.owner,
      owner_phone: data.ownerPhone,
      responsible: data.responsible,
      responsible_phone: data.responsiblePhone,
      technician: data.technician,
      server: data.server,
      hosting: data.hosting,
      backup: data.backup,
      licenses: data.licenses,
      emails: data.emails,
      google_sheet_url: data.googleSheetUrl || null,
      milvus_client_token: data.milvusClientToken || null,
      notes: data.notes,
      team: data.team || 'init',
      attachments: data.attachments || [],
      documents: data.documents || [],
      created_at: data.createdAt || now,
      updated_at: now
    }).then(res => {
      if (res.error) { console.error('❌ Supabase cliente:', String(res.error.message || res.error)); markSyncPushFailed(); }
    }).catch(err => {
      console.error('❌ Erro de rede Supabase cliente:', String(err.message));
      markSyncPushFailed();
    });
  }

  return data;
}
function deleteClient(id) {
  if (!canDelete()) {
    if (typeof showToast === 'function') showToast('Permissão negada para excluir clientes.', 'error');
    return false;
  }
  const client = getClientById(id);
  const name = client ? client.name : 'Desconhecido';
  dbSet(DB.CLIENTS, getClients().filter(c => c.id !== id));
  _addTombstone(DB.CLIENTS, id);
  addLog('Excluiu', 'Cliente', id, name);

  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    supabaseClient.from('clients').delete().eq('id', id).then(res => { if(res.error) { console.error('❌ Supabase excluir cliente:', String(res.error.message || res.error)); markSyncPushFailed(); } }).catch(() => markSyncPushFailed());
  }
}

// ── PENDÊNCIAS ──
function getPendencias() { return dbGet(DB.PENDENCIAS); }
function getPendenciasByTeam(team) {
  const all = getPendencias();
  if (!team) return all;
  return all.filter(p => (p.team || 'init') === team);
}
function getMyPendencias() {
  return filterByTeam(getPendencias());
}

// ── FASE 3: paginação server-side por escopo ────────────────────────────────
// Mesma cadeia operador→equipe→cliente→pendência, agora com filtro/ordenação/
// paginação NO BANCO (RLS continua valendo p/ o JWT). Uso: tela de pendências
// quando ONLINE; offline ou falha → caminho local atual (inalterado).
// - scope 'active' (padrão): status NOT IN (fechados)
// - scope 'archived': status IN (fechados) — sob demanda, nunca junto
// - team: não-admin SEMPRE restrito ao próprio team; admin sem filtro vê tudo
//   (RLS is_admin), admin com _selectedTeam restringe àquele team.
const PEN_PAGE_DEFAULT_SIZE = 50;
const PEN_CLOSED_LIST = ['concluido', 'resolvido', 'cancelado', 'fechado'];

function _penServerAvailable() {
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
    if (typeof isSupabaseConnected !== 'function' || !isSupabaseConnected()) return false;
    if (typeof window !== 'undefined' && !window._supabaseAuthActive) return false;
    if (typeof supabaseClient === 'undefined' || !supabaseClient) return false;
    return true;
  } catch (_) { return false; }
}

function _penPageScope() {
  // Retorna { team: string|null, adminSeeAll: boolean }.
  try {
    const admin = (typeof isTeamAdmin === 'function') ? isTeamAdmin() : false;
    const sel = (typeof _selectedTeam !== 'undefined') ? _selectedTeam : '';
    if (admin && sel) return { team: sel, adminSeeAll: false };
    if (admin) return { team: null, adminSeeAll: true };
  } catch (_) {}
  try {
    if (typeof getCurrentTeam === 'function') return { team: getCurrentTeam(), adminSeeAll: false };
  } catch (_) {}
  return { team: 'init', adminSeeAll: false };
}

function _sanitizeIlike(s) {
  return String(s || '').replace(/[%_\\]/g, '').replace(/[,()]/g, ' ').trim().slice(0, 80);
}

// Puro e testável: encadeia filtros num builder postgrest (ou mock). Retorna q.
function applyPendenciaPageFilters(q, opts) {
  const o = opts || {};
  if (!o.adminSeeAll && o.team) q = q.eq('team', o.team);
  if (o.scope === 'archived') q = q.in('status', PEN_CLOSED_LIST);
  else q = q.not('status', 'in', '(' + PEN_CLOSED_LIST.join(',') + ')');
  if (o.clientId) q = q.eq('client_id', o.clientId);
  if (o.responsible) q = q.eq('responsible', o.responsible);
  if (o.status) q = q.eq('status', o.status);
  if (o.priority) q = q.eq('priority', o.priority);
  const sq = _sanitizeIlike(o.search);
  if (sq) {
    const pat = '%' + sq + '%';
    q = q.or('assunto.ilike.' + pat + ',descricao.ilike.' + pat + ',client_name.ilike.' + pat + ',responsible.ilike.' + pat);
  }
  return q;
}

function _penFields() {
  try {
    if (typeof ENTITIES !== 'undefined') {
      const e = ENTITIES.find(x => x.table === 'pendencias');
      if (e && e.fields) return e.fields;
    }
  } catch (_) {}
  return null;
}

async function fetchPendenciasPage(opts) {

  const o = Object.assign({ scope: 'active', page: 0, pageSize: PEN_PAGE_DEFAULT_SIZE }, opts || {});
  const sc = _penPageScope();
  const page = Math.max(0, parseInt(o.page, 10) || 0);
  const pageSize = Math.min(200, Math.max(1, parseInt(o.pageSize, 10) || PEN_PAGE_DEFAULT_SIZE));
  const fields = _penFields();
  if (!fields) throw new Error('Schema de pendências indisponível');
  let q = supabaseClient.from('pendencias').select('*', { count: 'exact' });
  q = applyPendenciaPageFilters(q, {
    scope: o.scope === 'archived' ? 'archived' : 'active',
    team: sc.team, adminSeeAll: sc.adminSeeAll,
    clientId: o.clientId || '', responsible: o.responsible || '',
    status: o.status || '', priority: o.priority || '', search: o.search || ''
  });
  q = q.order('created_at', { ascending: false }).order('id', { ascending: true });
  const from = page * pageSize;
  const res = await q.range(from, from + pageSize - 1);
  if (res.error) throw new Error(res.error.message || 'Falha na consulta paginada');
  const rows = (res.data || []).map(r => _mapFromRemote(r, fields));
  return { rows, total: (typeof res.count === 'number') ? res.count : rows.length, page, pageSize };
}

// ── FASE 6: contadores no banco ────────────────────────────────────────────
// Totais por status do escopo SEM trazer as linhas: consulta só a coluna
// `status` (≈ bytes por registro) com os mesmos team/scope da paginação
// (+ RLS). Agregação local via countPendenciaStatuses (pura, testada).
// PostgREST não faz GROUP BY sem RPC — esta é a forma sem criar backend.
function countPendenciaStatuses(statusRows) {
  const byStatus = {};
  let total = 0;
  for (const r of (statusRows || [])) {
    const s = (r && r.status) || 'aberto';
    byStatus[s] = (byStatus[s] || 0) + 1;
    total++;
  }
  return { byStatus, total };
}

async function fetchPendenciaStatusCounts(scope) {
  const sc = _penPageScope();
  let q = supabaseClient.from('pendencias').select('status');
  q = applyPendenciaPageFilters(q, {
    scope: scope === 'archived' ? 'archived' : 'active',
    team: sc.team, adminSeeAll: sc.adminSeeAll
  });
  const res = await q;
  if (res.error) throw new Error(res.error.message || 'Falha na contagem');
  return countPendenciaStatuses(res.data || []);
}
function getPendenciaById(id) { return getPendencias().find(p => p.id === id) || null; }
function uniquePendenciaId(list) {
  let id;
  do {
    id = `PEN-${Date.now().toString(36)}-${_secureRandStr(6)}`;
  } while (list.some(p => p.id === id));
  return id;
}
function savePendencia(data) {
  const list = getPendencias();
  const isEdit = !!data.id;
  var now = new Date().toISOString();
  // Herda team do cliente se não informado
  if (!data.team && data.clientId) {
    const client = getClientById(data.clientId);
    if (client) data.team = client.team || 'init';
  }
  if (!data.team) data.team = getCurrentTeam();
  let oldStatus = null;
  if (isEdit) {
    const i = list.findIndex(p => p.id === data.id);
    if (i !== -1) { oldStatus = list[i].status; list[i] = { ...list[i], ...data, updatedAt: now };
    } else {
      data.id = uniquePendenciaId(list);
      data.createdAt = now;
      data.updatedAt = now;
      data.status = data.status || 'em_andamento';
      list.push(data);
    }
  } else {
    data.id = uniquePendenciaId(list);
    data.createdAt = now;
    data.updatedAt = now;
    data.status = data.status || 'em_andamento';
    list.push(data);
  }
  const justConcluded = data.status === 'concluido' && oldStatus !== 'concluido';
  if (justConcluded) {
    data.completedAt = now;
    const idx = list.findIndex(p => p.id === data.id);
    if (idx !== -1) list[idx].completedAt = data.completedAt;
  }
  dbSet(DB.PENDENCIAS, list);
  addLog(isEdit ? 'Editou' : 'Criou', 'Pendência', data.id, (data.assunto || '').trim() || data.descricao);

  if (justConcluded && data.recurrence) {
    try {
      const nextDeadline = nextRecurrenceDate(data.deadline || data.completedAt, data.recurrence);
      // Idempotência (idem visitas): mesma chave lógica — cliente + deadline
      // + assunto — impede duplicata em conclusão repetida/offline/2 devices.
      const penKey = p => ((p.assunto || '').trim() || p.descricao);
      const already = nextDeadline && getPendencias().some(x => x.id !== data.id
        && (x.clientId || '') === (data.clientId || '')
        && (x.deadline || '') === nextDeadline
        && penKey(x) === penKey(data));
      if (already) {
        console.debug('[recorrência] pendência de ' + nextDeadline + ' já existe — geração pulada (sem duplicar).');
      } else {
        savePendencia({
          clientId: data.clientId,
          clientName: data.clientName,
          tipo: data.tipo,
          assunto: data.assunto || '',
          descricao: data.descricao,
          responsible: data.responsible,
          status: 'aberto',
          priority: data.priority,
          deadline: nextDeadline,
          linkUtil: data.linkUtil || '',
          tags: data.tags || [],
          team: data.team || 'init',
          recurrence: data.recurrence,
        });
      }
    } catch (e) { console.warn('⚠️ Erro ao gerar pendência recorrente:', e); }
  }

  // Notificação por e-mail (não bloqueia a operação)
  setTimeout(() => {
    try {
      if (isEdit && typeof notifyPendenciaUpdated === 'function') {
        notifyPendenciaUpdated(data, oldStatus);
      } else if (!isEdit && typeof notifyPendenciaCreated === 'function') {
        notifyPendenciaCreated(data);
      }
    } catch (e) { console.warn('📧 Erro na notificação de pendência:', e); }
  }, 100);

  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    supabaseClient.from('pendencias').upsert({
      id: data.id,
      client_id: data.clientId,
      client_name: data.clientName,
      tipo: data.tipo,
      assunto: data.assunto || '',
      descricao: data.descricao,
      responsible: data.responsible,
      status: data.status,
      priority: data.priority,
      deadline: data.deadline || null,
      notes: data.notes || [],
      link_util: data.linkUtil || '',
      team: data.team || 'init',
      attachments: data.attachments || [],
      checklist: data.checklist || [],
      tags: data.tags || [],
      recurrence: data.recurrence || null,
      visit_id: data.visitId || null,
      reviewed_in_meeting: data.reviewedInMeeting || null,
      timer_running: data.timerRunning === true,
      timer_started_at: data.timerStartedAt || null,
      timer_total_seconds: data.timerTotalSeconds || 0,
      timer_operator: data.timerOperator || null,
      completed_at: data.completedAt || null,
      created_at: data.createdAt || now,
      updated_at: now
    }).then(res => {
      if (res.error) { console.warn('⚠️ Supabase pendência (sync pulado — verifique schema):', res.error.message); markSyncPushFailed(); }
    }).catch(err => {
      console.warn('⚠️ Erro de rede Supabase pendência:', err.message);
      markSyncPushFailed();
    });
  }

  return data;
}
function deletePendencia(id) {
  if (!canDelete()) {
    if (typeof showToast === 'function') showToast('Permissão negada para excluir pendências.', 'error');
    return false;
  }
  const pen = getPendenciaById(id);
  const desc = pen ? ((pen.assunto || '').trim() || pen.descricao || 'Desconhecido') : 'Desconhecido';
  const remaining = getPendencias().filter(p => p.id !== id);
  if (remaining.length === getPendencias().length) return false;
  dbSet(DB.PENDENCIAS, remaining);
  _addTombstone(DB.PENDENCIAS, id);
  addLog('Excluiu', 'Pendência', id, desc);

  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    supabaseClient.from('pendencias').delete().eq('id', id).then(res => { if(res.error) { console.error('❌ Supabase excluir pendência:', res.error); markSyncPushFailed(); } }).catch(() => markSyncPushFailed());
  }
  return true;
}
// ── @MENÇÃO HELPERS ──
function _getOperatorNamesList() {
  try {
    if (typeof getOperatorNames === 'function') return getOperatorNames();
    if (typeof globalThis !== 'undefined' && typeof globalThis.getOperatorNames === 'function') return globalThis.getOperatorNames();
    if (typeof getOperators === 'function') return getOperators().map(function(o){ return o.name; });
    if (typeof globalThis !== 'undefined' && typeof globalThis.getOperators === 'function') return globalThis.getOperators().map(function(o){ return o.name; });
  } catch (_) {}
  return [];
}
function _escapeHtmlLocal(str){
  if (typeof escapeHtml === 'function') return escapeHtml(str);
  if (typeof globalThis !== 'undefined' && typeof globalThis.escapeHtml === 'function') return globalThis.escapeHtml(str);
  if (str == null) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function parseMentionedOperators(text) {
  if (!text) return [];
  var names = _getOperatorNamesList();
  if (!names.length) return [];
  var regex = /@([A-Za-zÀ-ÿ0-9_]+)/g;
  var mentions = [];
  var m;
  while ((m = regex.exec(text)) !== null) mentions.push(m[1]);
  if (!mentions.length) return [];
  var result = [];
  var seen = new Set();
  mentions.forEach(function(tok){
    var tokLower = tok.toLowerCase();
    names.forEach(function(n){
      var nLower = n.toLowerCase();
      var parts = nLower.split(/\s+/);
      var matches = parts.some(function(p){ return p === tokLower; }) || nLower === tokLower;
      if (matches && !seen.has(n)) { seen.add(n); result.push(n); }
    });
  });
  return result;
}

function highlightMentions(text) {
  var esc = _escapeHtmlLocal(text);
  var names = _getOperatorNamesList();
  if (!names.length) return esc;
  return esc.replace(/@([A-Za-zÀ-ÿ0-9_]+)/g, function(match, p1){
    var tokLower = p1.toLowerCase();
    var isMention = names.some(function(n){
      var parts = n.toLowerCase().split(/\s+/);
      return parts.some(function(part){ return part === tokLower; }) || n.toLowerCase() === tokLower;
    });
    if (isMention) return '<span style="background:#dbeafe;color:#1e40af;padding:1px 4px;border-radius:4px;font-weight:600">@' + p1 + '</span>';
    return match;
  });
}

function addPendenciaNote(id, text, author) {
  const list = getPendencias();
  const i = list.findIndex(p => p.id === id);
  if (i === -1) return;
  if (!list[i].notes) list[i].notes = [];
  var mentionedOperators = parseMentionedOperators(text);
  const note = { text, author, createdAt: new Date().toISOString(), mentionedOperators };
  list[i].updatedAt = new Date().toISOString();
  dbSet(DB.PENDENCIAS, list);

  // Notificação por e-mail (não bloqueia a operação)
  setTimeout(() => {
    try {
      if (typeof notifyPendenciaNote === 'function') {
        notifyPendenciaNote(list[i], note);
      }
    } catch (e) { console.warn('📧 Erro na notificação de nota:', e); }
  }, 100);

  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    supabaseClient.from('pendencias').update({
      notes: list[i].notes,
      updated_at: list[i].updatedAt
    }).eq('id', id).then(res => { if(res.error) { console.error('❌ Supabase atualizar pendência:', res.error); markSyncPushFailed(); } }).catch(() => markSyncPushFailed());
  }
}

// ── TICKETS ──
function getTickets() { return dbGet(DB.TICKETS); }
function getTicketsByTeam(team) {
  const all = getTickets();
  if (!team) return all;
  return all.filter(t => (t.team || 'init') === team);
}
function getMyTickets() {
  return filterByTeam(getTickets());
}
function getTicketById(id) { return getTickets().find(t => t.id === id) || null; }
function saveTicket(data) {
  const list = getTickets();
  const isEdit = !!data.id;
  // Herda team do cliente se não informado
  if (!data.team && data.clientId) {
    const client = getClientById(data.clientId);
    if (client) data.team = client.team || 'init';
  }
  if (!data.team) data.team = getCurrentTeam();
  let oldStatus = null;
  var now = new Date().toISOString();
  if (isEdit) {
    const i = list.findIndex(t => t.id === data.id);
    if (i !== -1) { oldStatus = list[i].status; list[i] = { ...list[i], ...data, updatedAt: now };
    } else {
      data.id = nextId('TCK');
      data.createdAt = now;
      data.updatedAt = now;
      data.status = data.status || 'aberto';
      data.updates = [];
      list.push(data);
    }
  } else {
    data.id = nextId('TCK');
    data.createdAt = now;
    data.updatedAt = now;
    data.status = data.status || 'aberto';
    data.updates = [];
    list.push(data);
  }
  if (data.status === 'concluido' && oldStatus !== 'concluido') {
    data.completedAt = now;
    const idx = list.findIndex(t => t.id === data.id);
    if (idx !== -1) list[idx].completedAt = data.completedAt;
  }
  dbSet(DB.TICKETS, list);
  addLog(isEdit ? 'Editou' : 'Criou', 'Chamado', data.id, data.title);

  // Notificação por e-mail (não bloqueia a operação)
  setTimeout(() => {
    try {
      if (isEdit && typeof notifyTicketUpdated === 'function') {
        notifyTicketUpdated(data, oldStatus);
      } else if (!isEdit && typeof notifyTicketCreated === 'function') {
        notifyTicketCreated(data);
      }
    } catch (e) { console.warn('📧 Erro na notificação de chamado:', e); }
  }, 100);

  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    supabaseClient.from('tickets').upsert({
      id: data.id,
      client_id: data.clientId,
      client_name: data.clientName,
      title: data.title,
      description: data.description,
      status: data.status,
      priority: data.priority,
      technician: data.technician,
      updates: data.updates || [],
      team: data.team || 'init',
      attachments: data.attachments || [],
      timer_running: data.timerRunning === true,
      timer_started_at: data.timerStartedAt || null,
      timer_total_seconds: data.timerTotalSeconds || 0,
      timer_operator: data.timerOperator || null,
      completed_at: data.completedAt || null,
      created_at: data.createdAt || now,
      updated_at: now
    }).then(res => { if(res.error) { console.error('❌ Supabase chamado:', res.error); markSyncPushFailed(); } }).catch(() => markSyncPushFailed());
  }

  return data;
}
function deleteTicket(id) {
  if (!canDelete()) {
    if (typeof showToast === 'function') showToast('Permissão negada para excluir chamados.', 'error');
    return false;
  }
  const tck = getTicketById(id);
  const title = tck ? tck.title : 'Desconhecido';
  dbSet(DB.TICKETS, getTickets().filter(t => t.id !== id));
  _addTombstone(DB.TICKETS, id);
  addLog('Excluiu', 'Chamado', id, title);

  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    supabaseClient.from('tickets').delete().eq('id', id).then(res => { if(res.error) { console.error('❌ Supabase excluir chamado:', res.error); markSyncPushFailed(); } }).catch(() => markSyncPushFailed());
  }
}
function addTicketUpdate(id, text, author) {
  const list = getTickets();
  const i = list.findIndex(t => t.id === id);
  if (i === -1) return;
  if (!list[i].updates) list[i].updates = [];
  list[i].updates.push({ text, author, createdAt: new Date().toISOString() });
  var now = new Date().toISOString();
  list[i].updatedAt = now;
  dbSet(DB.TICKETS, list);

  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    supabaseClient.from('tickets').update({
      updates: list[i].updates,
      updated_at: now
    }).eq('id', id).then(res => { if(res.error) { console.error('❌ Supabase atualizar chamado:', res.error); markSyncPushFailed(); } }).catch(() => markSyncPushFailed());
  }
}

// ── VISITS (Visitas Técnicas) ──
const VISIT_STATUS_MAP = {
  agendada:     { label: 'Agendada',     color: '#0ea5e9' },
  em_andamento: { label: 'Em andamento', color: '#f59e0b' },
  concluida:    { label: 'Concluída',    color: '#16a34a' },
  cancelada:    { label: 'Cancelada',    color: '#94a3b8' },
};


function formatVisitTimeRange(v) {
  if (!v) return '—';
  if (v.allDay) return 'Dia inteiro';
  const start = (v.time || '').toString().slice(0, 5);
  const end = (v.timeEnd || '').toString().slice(0, 5);
  if (start && end) return start + ' – ' + end;
  if (start) return start;
  if (end) return 'até ' + end;
  return '—';
}
function getVisits() { return dbGet(DB.VISITS); }
function getVisitsByTeam(team) {
  const all = getVisits();
  if (!team) return all;
  return all.filter(v => (v.team || 'init') === team);
}
function getMyVisits() { return filterByTeam(getVisits()); }
function getVisitById(id) { return getVisits().find(v => v.id === id) || null; }
function getVisitsByClient(clientId) {
  return getVisits().filter(v => v.clientId === clientId)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}
function getVisitsByOperator(operatorName) {
  return getVisits().filter(v => v.operator === operatorName)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}
function saveVisit(data) {
  const list = getVisits();
  const isEdit = !!data.id;
  if (!data.team && data.clientId) {
    const client = getClientById(data.clientId);
    if (client) data.team = client.team || 'init';
  }
  if (!data.team) data.team = getCurrentTeam();
  data.allDay = data.allDay === true;
  if (data.allDay) {
    data.time = '';
    data.timeEnd = '';
  } else {
    data.time = data.time || '';
    data.timeEnd = data.timeEnd || '';
  }
  const now = new Date().toISOString();
  let oldStatus = null;
  if (isEdit) {
    const i = list.findIndex(v => v.id === data.id);
    if (i !== -1) { oldStatus = list[i].status; list[i] = { ...list[i], ...data, updatedAt: now }; }
    else list.push({ ...data, createdAt: now, updatedAt: now });
  } else {
    data.id = nextId('VIS');
    data.createdAt = now;
    data.updatedAt = now;
    // Offline-first (integração Milvus): visita nova nasce com o chamado
    // pendente. Visitas antigas (sem o campo) nunca são carimbadas aqui —
    // sem backfill: edições preservam ausência do campo.
    if (!data.milvusChamadoStatus) data.milvusChamadoStatus = 'pendente';
    if (data.milvusChamadoTentativas === undefined) data.milvusChamadoTentativas = 0;
    list.push(data);
  }
  dbSet(DB.VISITS, list);
  addLog(isEdit ? 'Editou' : 'Criou', 'Visita', data.id, data.clientName + ' – ' + (data.motivo || ''));

  if (data.status === 'concluida' && oldStatus !== 'concluida' && data.recurrence) {
    try {
      const nextDate = nextRecurrenceDate(data.date, data.recurrence);
      // Idempotência: concluir a mesma visita 2× (reload, offline/online, 2
      // dispositivos) não pode duplicar a ocorrência. Chave lógica: mesmo
      // cliente + mesma data + mesmo motivo.
      const already = nextDate && getVisits().some(x => x.id !== data.id
        && (x.clientId || '') === (data.clientId || '')
        && (x.date || '') === nextDate
        && (x.motivo || '') === (data.motivo || ''));
      if (already) {
        console.debug('[recorrência] visita de ' + nextDate + ' já existe — geração pulada (sem duplicar).');
      } else {
        saveVisit({
          clientId: data.clientId,
          clientName: data.clientName,
          operator: data.operator,
          date: nextDate,
          time: data.time,
          timeEnd: data.timeEnd,
          allDay: data.allDay,
          motivo: data.motivo,
          observacoes: data.observacoes,
          status: 'agendada',
          team: data.team || 'init',
          recurrence: data.recurrence,
        });
      }
    } catch (e) { console.warn('⚠️ Erro ao gerar visita recorrente:', e); }
  }

  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    supabaseClient.from('visits').upsert({
      id: data.id,
      client_id: data.clientId,
      client_name: data.clientName,
      operator: data.operator,
      date: data.date,
      time: data.allDay ? null : (data.time || null),
      time_end: data.allDay ? null : (data.timeEnd || null),
      all_day: data.allDay === true,
      motivo: data.motivo,
      observacoes: data.observacoes || '',
      relatorio: data.relatorio || '',
      status: data.status,
      recurrence: data.recurrence || null,
      team: data.team || 'init',
      categories: data.categories || [],
      checklist: data.checklist || [],
      milvus_chamado_codigo: data.milvusChamadoCodigo ?? null,
      milvus_chamado_status: data.milvusChamadoStatus ?? null,
      milvus_chamado_erro: data.milvusChamadoErro ?? null,
      milvus_chamado_tentativas: data.milvusChamadoTentativas ?? 0,
      created_at: data.createdAt,
      updated_at: now
    }).then(res => { if (res.error) { console.error('❌ Supabase visita:', String(res.error.message || res.error)); markSyncPushFailed(); } }).catch(() => markSyncPushFailed());
  }

  // Integração Milvus (fire-and-forget, só em criações): com rede, tenta
  // criar o chamado já; offline, a visita segue 'pendente' no local e o
  // processador retoma no pós-sync/online/boot. Nunca bloqueia nem lança.
  if (!isEdit) {
    try { if (typeof enqueueMilvusChamado === 'function') enqueueMilvusChamado(data.id); } catch (_) {}
  }
  return data;
}
function deleteVisit(id) {
  if (!canDelete()) {
    if (typeof showToast === 'function') showToast('Permissão negada para excluir visitas.', 'error');
    return false;
  }
  const v = getVisitById(id);
  const desc = v ? (v.clientName + ' – ' + (v.motivo || '')) : 'Desconhecido';
  dbSet(DB.VISITS, getVisits().filter(x => x.id !== id));
  _addTombstone(DB.VISITS, id);
  addLog('Excluiu', 'Visita', id, desc);

  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    supabaseClient.from('visits').delete().eq('id', id).then(res => { if (res.error) { console.error('❌ Supabase excluir visita:', res.error); markSyncPushFailed(); } }).catch(() => markSyncPushFailed());
  }
}

// ── REUNIÕES (Reunião Mensal) ──
function getReunioes() { return dbGet(DB.REUNIOES); }
function getReunioesByTeam(team) {
  const all = getReunioes();
  if (!team) return all;
  return all.filter(r => (r.team || 'init') === team);
}
function getMyReunioes() { return filterByTeam(getReunioes()); }
function getReuniaoById(id) { return getReunioes().find(r => r.id === id) || null; }
function saveReuniao(data) {
  const list = getReunioes();
  const isEdit = !!data.id;
  const now = new Date().toISOString();
  if (!data.team) data.team = getCurrentTeam();
  if (isEdit) {
    const i = list.findIndex(r => r.id === data.id);
    if (i !== -1) list[i] = { ...list[i], ...data, updatedAt: now };
    else list.push({ ...data, createdAt: now, updatedAt: now });
  } else {
    data.id = nextId('REU');
    data.createdAt = now;
    data.updatedAt = now;
    list.push(data);
  }
  dbSet(DB.REUNIOES, list);
  addLog(isEdit ? 'Editou' : 'Criou', 'Reunião', data.id, data.mesAno || '');

  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    supabaseClient.from('reunioes').upsert({
      id: data.id,
      mes_ano: data.mesAno || null,
      status: data.status || 'aberta',
      started_at: data.startedAt || null,
      ended_at: data.endedAt || null,
      team: data.team || 'init',
      relatorio: data.relatorio || '',
      participants: data.participants || [],
      created_at: data.createdAt || now,
      updated_at: now
    }).then(res => {
      if (res.error) { console.warn('⚠️ Supabase reunião (sync pulado — verifique schema):', res.error.message); markSyncPushFailed(); }
    }).catch(err => {
      console.warn('⚠️ Erro de rede Supabase reunião:', err.message);
      markSyncPushFailed();
    });
  }

  return data;
}
function deleteReuniao(id) {
  if (!canDelete()) {
    if (typeof showToast === 'function') showToast('Permissão negada para excluir reuniões.', 'error');
    return false;
  }
  const r = getReuniaoById(id);
  const desc = r ? r.mesAno : 'Desconhecida';
  dbSet(DB.REUNIOES, getReunioes().filter(x => x.id !== id));
  _addTombstone(DB.REUNIOES, id);
  addLog('Excluiu', 'Reunião', id, desc);

  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    supabaseClient.from('reunioes').delete().eq('id', id).then(res => { if (res.error) { console.error('❌ Supabase excluir reunião:', res.error); markSyncPushFailed(); } }).catch(() => markSyncPushFailed());
  }
}

// ── PROCEDURES ──
function getProcedures(clientId) {
  const all = dbGet(DB.PROCEDURES);
  return clientId ? all.filter(p => p.clientId === clientId) : all;
}
function saveProcedure(data) {
  const list = dbGet(DB.PROCEDURES);
  const isEdit = !!data.id;
  var now = new Date().toISOString();
  if (isEdit) {
    const i = list.findIndex(p => p.id === data.id);
    if (i !== -1) list[i] = { ...list[i], ...data, updatedAt: now };
  } else {
    data.id = nextId('PROC');
    data.createdAt = now;
    data.updatedAt = now;
    list.push(data);
  }
  dbSet(DB.PROCEDURES, list);
  addLog(isEdit ? 'Editou' : 'Criou', 'Procedimento', data.id, data.title);

  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    supabaseClient.from('procedures').upsert({
      id: data.id,
      client_id: data.clientId,
      title: data.title,
      category: data.category,
      content: data.content,
      created_at: data.createdAt || now,
      updated_at: now
    }).then(res => { if(res.error) { console.error('❌ Supabase procedimento:', res.error); markSyncPushFailed(); } }).catch(() => markSyncPushFailed());
  }

  return data;
}
function deleteProcedure(id) {
  if (!canDelete()) {
    if (typeof showToast === 'function') showToast('Permissão negada para excluir procedimentos.', 'error');
    return false;
  }
  const list = dbGet(DB.PROCEDURES);
  const proc = list.find(p => p.id === id);
  const title = proc ? proc.title : 'Desconhecido';
  dbSet(DB.PROCEDURES, list.filter(p => p.id !== id));
  _addTombstone(DB.PROCEDURES, id);
  addLog('Excluiu', 'Procedimento', id, title);

  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    supabaseClient.from('procedures').delete().eq('id', id).then(res => { if(res.error) { console.error('❌ Supabase excluir procedimento:', res.error); markSyncPushFailed(); } }).catch(() => markSyncPushFailed());
  }
}

// ── PROCEDURE TEMPLATES ──
function getProcedureTemplates() {
  return dbGet(DB.PROCEDURE_TEMPLATES);
}
function getProcedureTemplateById(id) {
  return getProcedureTemplates().find(t => t.id === id) || null;
}
function saveProcedureTemplate(data) {
  const list = dbGet(DB.PROCEDURE_TEMPLATES);
  const isEdit = !!data.id;
  const currentUser = typeof getUser === 'function' ? getUser() : null;
  const author = data.createdBy || (currentUser ? currentUser.name : 'Suporte TI');
  var now = new Date().toISOString();

  if (isEdit) {
    const i = list.findIndex(t => t.id === data.id);
    if (i !== -1) list[i] = { ...list[i], ...data, createdBy: author, updatedAt: now };
  } else {
    data.id = nextId('TPL');
    data.createdBy = author;
    data.createdAt = now;
    data.updatedAt = now;
    list.push(data);
  }
  dbSet(DB.PROCEDURE_TEMPLATES, list);
  addLog(isEdit ? 'Editou' : 'Criou', 'Modelo Procedimento', data.id, data.title);

  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    supabaseClient.from('procedure_templates').upsert({
      id: data.id,
      title: data.title,
      category: data.category,
      content: data.content,
      created_by: data.createdBy,
      created_at: data.createdAt || now,
      updated_at: now
    }).then(res => { if(res.error) { console.error('❌ Supabase modelo procedimento:', res.error); markSyncPushFailed(); } }).catch(() => markSyncPushFailed());
  }

  return data;
}
function deleteProcedureTemplate(id) {
  if (!canDelete()) {
    if (typeof showToast === 'function') showToast('Permissão negada para excluir modelos de procedimento.', 'error');
    return false;
  }
  const list = dbGet(DB.PROCEDURE_TEMPLATES);
  const tpl = list.find(t => t.id === id);
  const title = tpl ? tpl.title : 'Desconhecido';
  dbSet(DB.PROCEDURE_TEMPLATES, list.filter(t => t.id !== id));
  _addTombstone(DB.PROCEDURE_TEMPLATES, id);
  addLog('Excluiu', 'Modelo Procedimento', id, title);

  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    supabaseClient.from('procedure_templates').delete().eq('id', id).then(res => { if(res.error) { console.error('❌ Supabase excluir modelo procedimento:', res.error); markSyncPushFailed(); } }).catch(() => markSyncPushFailed());
  }
  return true;
}

// ── USER ──
function getUser() {
  const session = getSession();
  if (session) return { name: session.name, initials: session.initials, color: session.color, role: session.role };
  if (typeof getCacheTable === 'function') {
    const entry = getCacheTable('user_profile');
    return entry?.value || { name: 'Suporte TI', initials: 'TI' };
  }
  return dbGetObj(DB.USER, { name: 'Suporte TI', initials: 'TI' });
}

function saveUser(data) {
  if (typeof setCacheTable === 'function') {
    setCacheTable('user_profile', { key: DB.USER, value: data });
  } else {
    dbSet(DB.USER, data);
  }
}

// ── OPERATORS ──
function getOperators() {
  return dbGet(DB.OPERATORS);
}
function getOperatorById(id) { return getOperators().find(o => o.id === id) || null; }
function getOperatorByEmail(email) {
  if (!email) return null;
  const e = email.trim().toLowerCase();
  return getOperators().find(o => o.email?.toLowerCase() === e) || null;
}
function getOperatorByAuthId(authUserId) {
  if (!authUserId) return null;
  return getOperators().find(o => o.auth_user_id === authUserId) || null;
}
async function saveOperator(data) {
  const list = getOperators();
  const isEdit = !!data.id;
  const existing = isEdit ? list.find(o => o.id === data.id) : null;
  
  var now = new Date().toISOString();

  // Preserve existing pinSalt or generate new one
  if (!data.pinSalt && existing?.pinSalt) {
    data.pinSalt = existing.pinSalt;
  }
  if (!data.pinSalt) {
    data.pinSalt = Array.from(crypto.getRandomValues(new Uint8Array(8))).map(b => b.toString(16).padStart(2,'0')).join('');
  }
  
  // Compute new hash only if a new pin was provided
  if (data.pin) {
    data.pinHash = await hashPin(data.pin, data.pinSalt);
    delete data.pin;
  } else if (!data.pinHash && existing?.pinHash) {
    // Preserve existing password when not changing it
    data.pinHash = existing.pinHash;
  }

  let savedOp;
  if (isEdit) {
    const i = list.findIndex(o => o.id === data.id);
    if (i !== -1) {
      list[i] = { ...list[i], ...data, updatedAt: now };
      savedOp = list[i];
    } else {
      savedOp = data;
    }
  } else {
    data.id = nextId('OP');
    data.createdAt = now;
    data.updatedAt = now;
    data.active = true;
    data.onLeave = data.onLeave === true;
    list.push(data);
    savedOp = data;
  }
  // ensure boolean normalization for onLeave
  if (savedOp) savedOp.onLeave = savedOp.onLeave === true;
  dbSet(DB.OPERATORS, list);
  
  // Sync the current session if this operator is the one logged in
  const session = getSession();
  if (session && session.opId === savedOp.id) {
    setSession(savedOp.id);
    if (typeof updateUserUI === 'function') updateUserUI();
  }
  
  addLog(isEdit ? 'Editou' : 'Criou', 'Operador', savedOp.id, savedOp.name);

  // Sync to Supabase using the MERGED operator data (savedOp), not the partial form data
  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    supabaseClient.from('operators').upsert({
      id: savedOp.id,
      name: savedOp.name,
      initials: savedOp.initials,
      color: savedOp.color,
      role: savedOp.role,
      phone: savedOp.phone,
       email: savedOp.email,
       auth_user_id: savedOp.auth_user_id || null,
       pin_hash: savedOp.pinHash || null,
      pin_salt: savedOp.pinSalt || null,
      is_admin: savedOp.isAdmin === true,
       active: savedOp.active !== false,
       team: savedOp.team || 'init',
      on_leave: savedOp.onLeave === true,
      created_at: savedOp.createdAt || now,
      updated_at: now
    }).then(res => {
      if (res.error) {
        if (res.error.code === 'PGRST204' || (res.error.message && res.error.message.includes('column'))) {
          console.warn('⚠️ Supabase operadores: schema incompleto (coluna ausente?). Use o script de migração.');
        } else {
          console.warn('⚠️ Supabase operadores:', res.error.message);
        }
        markSyncPushFailed();
      }
    }).catch(err => { console.warn('⚠️ Erro de rede ao salvar operador:', err.message); markSyncPushFailed(); });
  }

  return savedOp;
}
function deleteOperator(id) {
  if (!canManageOps()) {
    if (typeof showToast === 'function') showToast('Permissão negada para excluir operadores.', 'error');
    return false;
  }
  const op = getOperatorById(id);
  const name = op ? op.name : 'Desconhecido';
  dbSet(DB.OPERATORS, getOperators().filter(o => o.id !== id));
  _addTombstone(DB.OPERATORS, id);
  addLog('Excluiu', 'Operador', id, name);

  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    supabaseClient.from('operators').delete().eq('id', id).then(res => { if(res.error) { console.error('❌ Supabase excluir operador:', res.error); markSyncPushFailed(); } }).catch(() => markSyncPushFailed());
  }
}
function toggleOperatorActive(id) {
  const list = getOperators();
  const i = list.findIndex(o => o.id === id);
  if (i !== -1) {
    list[i].active = !list[i].active;
    dbSet(DB.OPERATORS, list);
    addLog(list[i].active ? 'Ativou' : 'Desativou', 'Operador', id, list[i].name);

    if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
      supabaseClient.from('operators').update({ active: list[i].active }).eq('id', id).then(res => { if(res.error) { console.error('❌ Supabase toggle operador:', res.error); markSyncPushFailed(); } }).catch(() => markSyncPushFailed());
    }
  }
}

function isCurrentAdmin() {
  const session = getSession();
  if (!session) return false;
  const op = getOperatorById(session.opId);
  return op ? (op.isAdmin === true && op.active !== false) : false;
}

const PERMISSIONS = {
  admin:    { delete: true, editAll: true, manageOps: true, viewAll: true, export: true },
  supervisor: { delete: false, editAll: true, manageOps: false, viewAll: true, export: true },
  tecnico:  { delete: false, editAll: false, manageOps: false, viewAll: false, export: false }
};

function getCurrentPermissions() {
  const session = getSession();
  if (!session) return PERMISSIONS.tecnico;
  const op = getOperatorById(session.opId);
  if (!op || op.active === false) return PERMISSIONS.tecnico;
  if (op.isAdmin) return PERMISSIONS.admin;
  const roleLower = (op.role || '').toLowerCase();
  if (roleLower.includes('supervisor') || roleLower.includes('gerente') || roleLower.includes('coordenador')) return PERMISSIONS.supervisor;
  return PERMISSIONS.tecnico;
}

function canDelete() { return getCurrentPermissions().delete; }
function canEditAll() { return getCurrentPermissions().editAll; }
function canManageOps() { return getCurrentPermissions().manageOps; }
function canViewAll() { return getCurrentPermissions().viewAll; }
function canExport() { return getCurrentPermissions().export; }

function resetOperatorPassword(opId) {
  if (!isCurrentAdmin()) return false;
  const list = getOperators();
  const i = list.findIndex(o => o.id === opId);
  if (i !== -1) {
    list[i].pinHash = null;
    list[i].updatedAt = new Date().toISOString();
    dbSet(DB.OPERATORS, list);

    if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
      supabaseClient.from('operators').update({ pin_hash: null, updated_at: list[i].updatedAt }).eq('id', opId).then(res => { if (res.error) { console.error('❌ Supabase reset de senha:', String(res.error.message || res.error)); markSyncPushFailed(); } }).catch(() => markSyncPushFailed());
    }

    // If the reset operator is the current session, update it
    const session = getSession();
    if (session && session.opId === opId) {
      setSession(opId);
    }
    return true;
  }
  return false;
}

// ── SEED ──
function seedDemoData() {
  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    console.log('ℹ️ Supabase conectado — seed de demonstração pulado.');
    return;
  }
  if (getClients().length > 0) return;
  // Carga inicial local — não é mudança pendente do usuário (não conta no banner).
  if (typeof window !== 'undefined') window._suppressPendingSync = true;

  // Seed operators (emails usam .example.local — domínio reservado, sem relação com endereços reais)
  if (getOperators().length === 0) {
    const operators = [
      { id:'OP-1', name:'Pedro',   initials:'PE', color:'#1a56db', role:'Técnico',   phone:'', email:'op1@example.local',   auth_user_id:null, active:true, isAdmin:true, team:'init', createdAt:'2025-01-01T00:00:00Z', updatedAt:'2025-01-01T00:00:00Z' },
      { id:'OP-2', name:'Giovane', initials:'GI', color:'#0891b2', role:'Técnico',   phone:'', email:'op2@example.local', auth_user_id:null, active:true, team:'init', createdAt:'2025-01-01T00:00:00Z', updatedAt:'2025-01-01T00:00:00Z' },
      { id:'OP-3', name:'Rafael',  initials:'RA', color:'#0f766e', role:'Técnico',   phone:'', email:'op3@example.local',  auth_user_id:null, active:true, team:'init', createdAt:'2025-01-01T00:00:00Z', updatedAt:'2025-01-01T00:00:00Z' },
      { id:'OP-4', name:'Joarli',  initials:'JO', color:'#4f46e5', role:'Técnico',   phone:'', email:'op4@example.local',  auth_user_id:null, active:true, team:'init', createdAt:'2025-01-01T00:00:00Z', updatedAt:'2025-01-01T00:00:00Z' },
      { id:'OP-5', name:'Felipe',  initials:'FE', color:'#6366f1', role:'CEO',       phone:'', email:'op5@example.local', auth_user_id:null, active:true, isAdmin:true, team:'init', createdAt:'2025-01-01T00:00:00Z', updatedAt:'2025-01-01T00:00:00Z' },
    ];
    dbSet(DB.OPERATORS, operators);
    const c = dbGetObj(DB.COUNTER, {});
    c['OP'] = 5;
    dbSet(DB.COUNTER, c);
  }

  const clients = [
    {
      id: 'CLI-1', createdAt: '2025-01-10T10:00:00Z', updatedAt: '2025-01-10T10:00:00Z', team: 'init',
      name: 'Padaria Central', cnpj: '12.345.678/0001-90', segment: 'Alimentação',
      color: '#f97316', initials: 'PC',
      owner: 'Carlos Mendes', ownerPhone: '(11) 99999-1111',
      responsible: 'Ana Lima', responsiblePhone: '(11) 98888-2222',
      technician: 'João Silva',
      server: { type: 'Físico', os: 'Windows Server 2019', ip: '192.168.1.10', remoteAccess: 'AnyDesk', remoteId: '123456789', notes: 'Senha padrão no cofre' },
      hosting: { provider: 'HostGator', panelUrl: 'https://painel.hostgator.com', user: 'padaria@email.com', notes: 'Plano Business' },
      backup: { frequency: 'Diário', time: '23:00', destination: 'HD Externo + Google Drive', tool: 'Acronis', lastCheck: '2025-04-20', notes: '' },
      licenses: [{ software: 'Windows Server 2019', key: 'XXXXX-XXXXX-XXXXX', expiry: '2027-12-31' }],
      emails: { provider: 'Google Workspace', domain: 'padariacentral.com.br', server: 'smtp.gmail.com', port: '587', quota: '30GB/usuário' },
      notes: 'Cliente prioritário. Não realizar manutenção em horário comercial sem aviso prévio.'
    },
    {
      id: 'CLI-2', createdAt: '2025-02-15T10:00:00Z', updatedAt: '2025-02-15T10:00:00Z', team: 'init',
      name: 'Distribuidora Ômega', cnpj: '98.765.432/0001-10', segment: 'Distribuição',
      color: '#6366f1', initials: 'DΩ',
      owner: 'Roberto Prado', ownerPhone: '(11) 97777-3333',
      responsible: 'Fernanda Costa', responsiblePhone: '(11) 96666-4444',
      technician: 'Maria Santos',
      server: { type: 'Cloud (AWS)', os: 'Ubuntu 22.04', ip: '54.12.34.56', remoteAccess: 'SSH + VPN', remoteId: '', notes: 'Acesso via chave SSH' },
      hosting: { provider: 'AWS', panelUrl: 'https://console.aws.amazon.com', user: 'admin@omega.com.br', notes: 'EC2 t3.medium' },
      backup: { frequency: 'Semanal', time: '02:00 Domingo', destination: 'S3 Bucket', tool: 'AWS Backup', lastCheck: '2025-04-14', notes: '' },
      licenses: [],
      emails: { provider: 'Microsoft 365', domain: 'omega.com.br', server: 'outlook.office365.com', port: '993', quota: '50GB/usuário' },
      notes: 'Qualquer mudança precisa de aprovação do Roberto.'
    },
    {
      id: 'CLI-3', createdAt: '2025-03-01T10:00:00Z', updatedAt: '2025-03-01T10:00:00Z', team: 'init',
      name: 'Al Marques', cnpj: '11.222.333/0001-44', segment: 'Varejo',
      color: '#22c55e', initials: 'AM',
      owner: 'Al Marques', ownerPhone: '(11) 91111-5555',
      responsible: 'Al Marques', responsiblePhone: '(11) 91111-5555',
      technician: 'João Silva',
      server: { type: 'Físico', os: 'Windows 11', ip: '192.168.0.5', remoteAccess: 'TeamViewer', remoteId: '987654321', notes: '' },
      hosting: { provider: '', panelUrl: '', user: '', notes: '' },
      backup: { frequency: 'Mensal', time: '', destination: 'HD Externo', tool: 'Manual', lastCheck: '2025-03-01', notes: '' },
      licenses: [],
      emails: { provider: 'Gmail', domain: 'gmail.com', server: '', port: '', quota: '' },
      notes: ''
    }
  ];

  const pendencias = [
    {
      id: 'PEN-1', createdAt: '2025-04-28T08:00:00Z', updatedAt: '2025-04-29T14:00:00Z', team: 'init',
      clientId: 'CLI-1', clientName: 'Padaria Central',
      tipo: 'Projeto', assunto: 'Cabeamento estruturado', descricao: 'Cabeamento estruturado no andar 2',
      responsible: 'Pedro', status: 'em_andamento', priority: 'media',
      deadline: '2025-05-15', notes: [], linkUtil: ''
    },
    {
      id: 'PEN-2', createdAt: '2025-04-29T10:00:00Z', updatedAt: '2025-04-29T10:00:00Z', team: 'init',
      clientId: 'CLI-2', clientName: 'Distribuidora Ômega',
      tipo: 'Projeto', assunto: 'Migração para AWS', descricao: 'Migração para AWS',
      responsible: 'Giovane', status: 'em_andamento', priority: 'alta',
      deadline: '2025-06-01', notes: [], linkUtil: ''
    },
    {
      id: 'PEN-3', createdAt: '2025-04-30T07:00:00Z', updatedAt: '2025-04-30T07:00:00Z', team: 'init',
      clientId: 'CLI-3', clientName: 'Al Marques',
      tipo: 'Suporte', assunto: 'Verificação mensal de backup', descricao: 'Verificação mensal de backup e segurança',
      responsible: 'Rafael', status: 'aberto', priority: 'baixa',
      deadline: '', notes: [], linkUtil: ''
    },
    {
      id: 'PEN-4', createdAt: '2025-05-01T09:00:00Z', updatedAt: '2025-05-01T09:00:00Z', team: 'init',
      clientId: 'CLI-1', clientName: 'Padaria Central',
      tipo: 'Manutenção', assunto: 'Atualização do antivírus', descricao: 'Atualização do antivírus em todos os terminais',
      responsible: 'Joarli', status: 'aberto', priority: 'media',
      deadline: '2025-05-20', notes: [], linkUtil: ''
    },
    {
      id: 'PEN-5', createdAt: '2025-05-02T11:00:00Z', updatedAt: '2025-05-02T11:00:00Z', team: 'init',
      clientId: 'CLI-2', clientName: 'Distribuidora Ômega',
      tipo: 'Suporte', assunto: 'Configurar VPN', descricao: 'Configurar VPN para novos colaboradores',
      responsible: 'Felipe', status: 'em_andamento', priority: 'alta',
      deadline: '2025-05-10', notes: [], linkUtil: ''
    }
  ];

  const procedures = [
    {
      id: 'PROC-1', clientId: 'CLI-1', createdAt: '2025-01-15T10:00:00Z', updatedAt: '2025-01-15T10:00:00Z',
      title: 'Acesso remoto via AnyDesk', category: 'Acesso',
      content: '1. Abrir AnyDesk\n2. Inserir ID: 123456789\n3. Solicitar senha ao responsável (Carlos Mendes)\n4. Aceitar a conexão no computador do cliente\n\nObservação: Sempre avisar antes de conectar.'
    },
    {
      id: 'PROC-2', clientId: 'CLI-1', createdAt: '2025-01-16T10:00:00Z', updatedAt: '2025-01-16T10:00:00Z',
      title: 'Verificação do backup diário', category: 'Backup',
      content: '1. Acessar o servidor via AnyDesk\n2. Abrir o Acronis True Image\n3. Verificar o log do último backup (deve ser às 23h)\n4. Confirmar que o backup no Google Drive está sincronizado\n5. Registrar verificação na planilha de controle'
    },
    {
      id: 'PROC-3', clientId: 'CLI-2', createdAt: '2025-02-20T10:00:00Z', updatedAt: '2025-02-20T10:00:00Z',
      title: 'Acesso SSH ao servidor AWS', category: 'Acesso',
      content: '1. Conectar à VPN da Ômega\n2. Abrir terminal: ssh -i ~/.ssh/omega.pem ubuntu@54.12.34.56\n3. Senha da VPN disponível no cofre\n\nATENÇÃO: Nunca fazer sudo rm sem aprovação do Roberto Prado.'
    }
  ];

  const procedureTemplates = [
    {
      id: 'TPL-1', createdAt: '2025-01-10T10:00:00Z', updatedAt: '2025-01-10T10:00:00Z',
      title: 'Verificação Padrão de Backup', category: 'Backup',
      createdBy: 'Felipe',
      content: '1. Acessar o servidor via Acesso Remoto.\n2. Abrir o software de backup (ex: Acronis, AWS Backup, Veeam).\n3. Verificar status do último job executado.\n4. Validar espaço disponível no destino do backup.\n5. Registrar resultado da verificação.'
    },
    {
      id: 'TPL-2', createdAt: '2025-01-12T10:00:00Z', updatedAt: '2025-01-12T10:00:00Z',
      title: 'Configuração de Acesso Remoto Padrão', category: 'Acesso',
      createdBy: 'Pedro',
      content: '1. Instalar o aplicativo de acesso remoto no estação/servidor.\n2. Definir senha não supervisionada / permanente segura.\n3. Cadastrar ID no sistema e salvar no cofre de senhas.\n4. Realizar teste de conexão antes de liberar ao suporte.'
    },
    {
      id: 'TPL-3', createdAt: '2025-01-15T10:00:00Z', updatedAt: '2025-01-15T10:00:00Z',
      title: 'Checklist de Onboarding de Novo Usuário', category: 'Usuários',
      createdBy: 'Giovane',
      content: '1. Criar conta de e-mail corporativo.\n2. Cadastrar usuário no Active Directory / Servidor de Arquivos.\n3. Aplicar permissões de pastas conforme departamento.\n4. Configurar conta no smartphone/notebook do usuário.\n5. Enviar credenciais temporárias de forma segura.'
    }
  ];

  dbSet(DB.CLIENTS, clients);
  dbSet(DB.PENDENCIAS, pendencias);
  dbSet(DB.PROCEDURES, procedures);
  if (getProcedureTemplates().length === 0) {
    dbSet(DB.PROCEDURE_TEMPLATES, procedureTemplates);
  }
  const currentCounters = dbGetObj(DB.COUNTER, { CLI: 3, PEN: 5, PROC: 3, OP: 5 });
  dbSet(DB.COUNTER, { ...currentCounters, CLI: 3, PEN: 5, PROC: 3, TPL: 3, OP: 5 });
  if (typeof window !== 'undefined') window._suppressPendingSync = false;
}

// ── VALIDAÇÃO ──
const Validators = {
  cpf(v) {
    if (!v) return true;
    const d = v.replace(/\D/g, '');
    if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += parseInt(d[i]) * (10 - i);
    let rev = 11 - (sum % 11);
    if (rev === 10 || rev === 11) rev = 0;
    if (rev !== parseInt(d[9])) return false;
    sum = 0;
    for (let i = 0; i < 10; i++) sum += parseInt(d[i]) * (11 - i);
    rev = 11 - (sum % 11);
    if (rev === 10 || rev === 11) rev = 0;
    return rev === parseInt(d[10]);
  },

  cnpj(v) {
    if (!v) return true;
    const d = v.replace(/\D/g, '');
    if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
    const weights1 = [5,4,3,2,9,8,7,6,5,4,3,2];
    const weights2 = [6,5,4,3,2,9,8,7,6,5,4,3,2];
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += parseInt(d[i]) * weights1[i];
    let rem = sum % 11;
    const digit1 = rem < 2 ? 0 : 11 - rem;
    if (parseInt(d[12]) !== digit1) return false;
    sum = 0;
    for (let i = 0; i < 13; i++) sum += parseInt(d[i]) * weights2[i];
    rem = sum % 11;
    const digit2 = rem < 2 ? 0 : 11 - rem;
    return parseInt(d[13]) === digit2;
  },

  email(v) {
    if (!v) return true;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
  },

  phone(v) {
    if (!v) return true;
    const d = v.replace(/\D/g, '');
    return d.length >= 10 && d.length <= 11;
  },

  required(v) {
    return v && v.trim().length > 0;
  }
};

function validateClient(data) {
  const errors = [];
  if (!Validators.required(data.name)) errors.push('Nome é obrigatório.');
  // CNPJ/CPF é opcional e aceita qualquer valor (não validamos dígitos verificadores)
  if (data.ownerPhone && !Validators.phone(data.ownerPhone)) errors.push('Telefone do proprietário inválido.');
  if (data.responsiblePhone && !Validators.phone(data.responsiblePhone)) errors.push('Telefone do responsável inválido.');
  return errors;
}

function validatePendencia(data) {
  const errors = [];
  if (!Validators.required(data.assunto)) errors.push('Assunto é obrigatório.');
  if (!Validators.required(data.descricao)) errors.push('Descrição é obrigatória.');
  if (data.linkUtil && !/^https?:\/\//.test(data.linkUtil) && !/^mailto:/.test(data.linkUtil)) errors.push('Link inválido (use https://...).');
  return errors;
}

function validateTicket(data) {
  const errors = [];
  if (!Validators.required(data.title)) errors.push('Título é obrigatório.');
  if (data.technician && data.technician.includes('@') && !Validators.email(data.technician)) errors.push('E-mail do técnico inválido.');
  return errors;
}

function validateOperator(data) {
  const errors = [];
  if (!Validators.required(data.name)) errors.push('Nome é obrigatório.');
  if (data.email && !Validators.email(data.email)) errors.push('E-mail inválido.');
  if (data.phone && !Validators.phone(data.phone)) errors.push('Telefone inválido.');
  if (data.initials && data.initials.length > 3) errors.push('Iniciais devem ter no máximo 3 caracteres.');
  return errors;
}

function validateTemplate(data) {
  const errors = [];
  if (!Validators.required(data.title)) errors.push('Título é obrigatório.');
  if (!Validators.required(data.content)) errors.push('Conteúdo é obrigatório.');
  return errors;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getPendingSyncCount, incrementPendingSync, resetPendingSyncCount, markSyncPushFailed, dbSet, dbGet, DB, parseMentionedOperators, highlightMentions, getClientDocuments, addClientDocument, removeClientDocument, _dataUrlToBlob, applyPendenciaPageFilters, countPendenciaStatuses, syncSupabaseToLocal, triggerStartupSync, checkBackendConnectivity, _withSyncTimeout, _isConnectivityError };
}
