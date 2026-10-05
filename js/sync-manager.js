// sync-manager.js — camada de sincronização em tempo real
// ============================================================
// Substitui o retry fixo de 3s de initSupabaseRealtime (supabase-config.js)
// por reconexão com exponential backoff + status visível, mantendo o
// contrato existente: atualiza o IndexedDB, respeita tombstones/equipe e
// notifica a UI sem F5 (CustomEvent `sync:update` + event bus `emitDataChanged`).
//
// Ordem de carga: após schema.js, supabase-config.js, db.js, storage.js,
// app-events.js e outbox.js. Funciona degradado em testes/Node (só os
// helpers puros são exportados; o socket só abre no browser autenticado).

// Pura e testável: próximo atraso de reconexão (backoff exponencial + jitter).
function _syncBackoffDelay(retryN) {
  var n = Math.max(0, Number(retryN) || 0);
  var base = 1000;
  var max = 30000;
  var d = Math.min(max, base * Math.pow(2, n));
  try { d += Math.random() * 500; } catch (_) {}
  return d;
}

// Pura e testável: Last-Write-Wins por updated_at.
// Local ainda na outbox nunca perde (será enviado no drain).
function shouldApplyRemote(local, remote, isEnqueued) {
  if (!local) return true;
  if (isEnqueued) return false;
  var lt = new Date((local && (local.updatedAt || local.updated_at)) || 0).getTime();
  var rt = new Date((remote && (remote.updatedAt || remote.updated_at)) || 0).getTime();
  if (Number.isNaN(lt)) lt = 0;
  if (Number.isNaN(rt)) rt = 0;
  if (rt !== lt) return rt > lt;
  return String((remote && remote.id) || '') > String((local && local.id) || '');
}

function _syncTeamFilter() {
  try {
    if (typeof isTeamAdmin === 'function' && isTeamAdmin()) {
      return (typeof _selectedTeam !== 'undefined' && _selectedTeam) ? _selectedTeam : null;
    }
    return typeof getCurrentTeam === 'function' ? getCurrentTeam() : null;
  } catch (_) { return null; }
}

var SYNC_FALLBACK_MIN_MS = 60000;

var SyncManager = (function () {
  var _channel = null;
  var _retryN = 0;
  var _status = 'idle'; // idle|connecting|live|error|offline
  var _listeners = [];
  var _lastFallbackAt = 0;

  function _emit(s, extra) {
    _status = s;
    var detail = { status: s };
    if (extra && typeof extra === 'object') {
      for (var k in extra) { try { detail[k] = extra[k]; } catch (_) {} }
    }
    try {
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('sync:update', { detail: detail }));
    } catch (_) {}
    try { if (typeof emitDataChanged === 'function') emitDataChanged('sync-status', detail); } catch (_) {}
    for (var i = 0; i < _listeners.length; i++) {
      try { _listeners[i](s, detail); } catch (_) {}
    }
  }

  function onStatus(cb) {
    if (typeof cb !== 'function') return function () {};
    _listeners.push(cb);
    return function () {
      var i = _listeners.indexOf(cb);
      if (i !== -1) _listeners.splice(i, 1);
    };
  }

  // Aplica um evento remoto no IndexedDB (transação via setCacheStore/dbSet)
  // e acorda a UI. Mesmas guardas do legado: tombstone, equipe, pin local.
  async function applyRemote(table, event, row) {
    var meta = null;
    try {
      meta = (typeof ENTITIES !== 'undefined')
        ? ENTITIES.find(function (e) { return e.table === table; })
        : null;
    } catch (_) { meta = null; }
    if (!meta || typeof dbGet !== 'function' || typeof dbSet !== 'function') return;
    var prevSuppress = false;
    try { prevSuppress = (typeof window !== 'undefined' && window._suppressPendingSync) || false; } catch (_) {}
    try {
      if (typeof window !== 'undefined') window._suppressPendingSync = true;
      var list = dbGet(meta.dbKey);
      if (!Array.isArray(list)) list = [];
      try {
        if (typeof _tombTimeFor === 'function') {
          var pid = (row && row.id) || null;
          var tAt = pid ? _tombTimeFor(meta.dbKey, pid) : null;
          if (tAt) {
            var rAt = row && (row.updated_at || row.updatedAt);
            if (!rAt || new Date(rAt).getTime() <= new Date(tAt).getTime()) return;
            if (typeof _clearTombstone === 'function') _clearTombstone(meta.dbKey, pid);
          }
        }
      } catch (_) {}
      if (event === 'DELETE') {
        if (!row || !row.id) return;
        list = list.filter(function (x) { return x.id !== row.id; });
      } else if ((event === 'INSERT' || event === 'UPDATE') && row) {
        var mapped = (typeof meta.mapRow === 'function')
          ? meta.mapRow(row)
          : ((typeof _mapFromRemote === 'function') ? _mapFromRemote(row, meta.fields) : row);
        try {
          if (meta.hasTeam && typeof mapped.team === 'string' && typeof canViewTeam === 'function' && !canViewTeam(mapped.team)) return;
        } catch (_) {}
        var idx = -1;
        for (var i = 0; i < list.length; i++) { if (list[i] && list[i].id === mapped.id) { idx = i; break; } }
        var enq = false;
        try {
          enq = (typeof Outbox !== 'undefined' && Outbox && typeof Outbox.has === 'function')
            ? await Outbox.has(mapped.id)
            : ((typeof outboxHas === 'function') ? await outboxHas(mapped.id) : false);
        } catch (_) { enq = false; }
        if (idx !== -1) {
          if (shouldApplyRemote(list[idx], mapped, enq)) {
            var prevPin = list[idx].pinHash;
            var prevSalt = list[idx].pinSalt;
            list[idx] = Object.assign({}, list[idx], mapped);
            if (prevPin && !mapped.pinHash) list[idx].pinHash = prevPin;
            if (prevSalt && !mapped.pinSalt) list[idx].pinSalt = prevSalt;
          }
        } else {
          list.unshift(mapped);
        }
      } else {
        return;
      }
      if (meta.cacheTable && typeof setCacheTable === 'function') setCacheTable(meta.cacheTable, list);
      else dbSet(meta.dbKey, list);
      // dbSet já emite `emitDataChanged(entidade)` (storage.js); o onChange
      // abaixo preserva o refresh legado por tela (kanban/dashboard/etc).
      if (typeof meta.onChange === 'function') { try { meta.onChange(); } catch (_) {} }
      _retryN = 0;
    } catch (_) {} finally {
      try { if (typeof window !== 'undefined') window._suppressPendingSync = prevSuppress; } catch (_) {}
    }
  }

  function _canConnect() {
    try {
      if (typeof isSupabaseConnected !== 'function' || !isSupabaseConnected()) return false;
      if (typeof window !== 'undefined' && !window._supabaseAuthActive) return false;
      return typeof supabaseClient !== 'undefined' && !!supabaseClient;
    } catch (_) { return false; }
  }

  function connect() {
    if (!_canConnect()) return;
    try { if (_channel) supabaseClient.removeChannel(_channel); } catch (_) {}
    _channel = null;
    _emit('connecting');
    var teamFilter = _syncTeamFilter();
    var ch = null;
    try {
      ch = supabaseClient.channel('public-changes-v2');
      var metas = [];
      try { metas = (typeof ENTITIES !== 'undefined' ? ENTITIES : []).filter(function (e) { return e.realtime !== false; }); } catch (_) {}
      metas.forEach(function (meta) {
        var opts = { event: '*', schema: 'public', table: meta.table };
        if (teamFilter && meta.hasTeam) opts.filter = 'team=eq.' + teamFilter;
        ch = ch.on('postgres_changes', opts, function (payload) {
          var ev = payload.eventType || payload.event;
          var data = (ev === 'DELETE' ? payload.old : payload.new) || {};
          applyRemote(meta.table, ev, data).catch(function () {});
        });
      });
      _channel = ch.subscribe(function (st) {
        if (st === 'SUBSCRIBED') { _retryN = 0; _emit('live'); }
        else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT' || st === 'CLOSED') {
          _emit('error');
          // Anti-storm: o fallback completo (8 entidades) roda no máximo 1×
          // a cada 60s e nunca com aba oculta. Sem isso, token expirado gera
          // erro → sync → reconnect → erro em loop, cada sync logando os
          // mesmos ~156 "conflitos". O reconnect barato segue o backoff.
          try {
            var _nowFb = Date.now();
            var _hiddenFb = (typeof document !== 'undefined' && document.visibilityState === 'hidden');
            if (!_hiddenFb && (_nowFb - _lastFallbackAt) >= SYNC_FALLBACK_MIN_MS && typeof syncSupabaseToLocal === 'function') {
              _lastFallbackAt = _nowFb;
              syncSupabaseToLocal({ reason: 'realtime-fallback' }).catch(function () {});
            }
          } catch (_) {}
          var d = _syncBackoffDelay(_retryN++);
          setTimeout(function () {
            try {
              if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
              if (_canConnect()) connect();
            } catch (_) {}
          }, d);
        }
      });
    } catch (_) {
      _emit('error');
      var d2 = _syncBackoffDelay(_retryN++);
      setTimeout(function () { try { if (_canConnect()) connect(); } catch (_) {} }, d2);
    }
  }

  function disconnect() {
    try { if (_channel && typeof supabaseClient !== 'undefined') supabaseClient.removeChannel(_channel); } catch (_) {}
    _channel = null;
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('online', function () { _retryN = 0; connect(); });
    window.addEventListener('offline', function () { _emit('offline'); });
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState !== 'visible') return;
        try { if (_canConnect() && !_channel) connect(); } catch (_) {}
      });
      window.addEventListener('pageshow', function (e) {
        if (e && e.persisted) { try { if (_canConnect()) connect(); } catch (_) {} }
      });
    }
  }

  return {
    connect: connect,
    disconnect: disconnect,
    onStatus: onStatus,
    getStatus: function () { return _status; },
    shouldApplyRemote: shouldApplyRemote,
    applyRemote: applyRemote,
  };
})();

// Reatividade vanilla (equivale ao useLiveQuery do Dexie / useSyncExternalStore):
// lê do IndexedDB agora e reinscreve no bus — o componente re-renderiza
// sozinho quando SyncManager ou dbSet atualizarem a entidade.
function subscribeLive(entity, render) {
  if (typeof render !== 'function') return function () {};
  try { render(); } catch (e) { try { console.warn('subscribeLive render erro', e); } catch (_) {} }
  try {
    if (typeof onDataChanged === 'function') {
      return onDataChanged(entity, function () {
        try {
          if (typeof preserveScrollAround === 'function') preserveScrollAround(function () { render(); });
          else render();
        } catch (_) {}
      });
    }
  } catch (_) {}
  return function () {};
}

// Feedback visual 🟢🟡🔴 (topbar). Usa online/offline + status do socket +
// pendências (contador sync + outbox persistente).
function mountSyncStatus(el) {
  if (!el) return function () {};
  function paintSync() {
    var pend = 0;
    try { if (typeof getPendingSyncCount === 'function') pend = Number(getPendingSyncCount()) || 0; } catch (_) {}
    var off = false;
    try { off = (typeof navigator !== 'undefined' && navigator.onLine === false); } catch (_) {}
    var st = 'idle';
    try { st = (typeof SyncManager !== 'undefined' && SyncManager) ? SyncManager.getStatus() : 'idle'; } catch (_) {}
    function render(total) {
      var n = Math.max(pend, Number(total) || 0);
      if (off) {
        el.innerHTML = '🔴 Offline' + (n ? ' (' + n + ' pendente' + (n > 1 ? 's' : '') + ')' : '');
        el.setAttribute('data-sync', 'offline');
        el.title = 'Sem conexão — as alterações ficam na fila e enviam ao reconectar';
      } else if (st === 'live' && !n) {
        el.innerHTML = '🟢 Sincronizado';
        el.setAttribute('data-sync', 'live');
        el.title = 'Tempo real ativo';
      } else {
        el.innerHTML = '🟡 Sincronizando...' + (n ? ' (' + n + ')' : '');
        el.setAttribute('data-sync', 'pending');
        el.title = 'Sincronizando com o servidor';
      }
    }
    render(pend);
    try {
      var p = null;
      if (typeof Outbox !== 'undefined' && Outbox && typeof Outbox.count === 'function') p = Outbox.count();
      else if (typeof outboxCount === 'function') p = outboxCount();
      if (p && typeof p.then === 'function') p.then(function (c) { render(c); }).catch(function () {});
    } catch (_) {}
  }
  paintSync();
  var off1 = function () { paintSync(); };
  var off2 = function () { paintSync(); };
  var off3 = function () { paintSync(); };
  try { window.addEventListener('online', off1); } catch (_) {}
  try { window.addEventListener('offline', off2); } catch (_) {}
  try { window.addEventListener('sync:update', off3); } catch (_) {}
  var unsub = function () {};
  try { if (typeof onDataChanged === 'function') unsub = onDataChanged('sync-status', paintSync) || unsub; } catch (_) {}
  try {
    if (typeof document !== 'undefined' && !document._syncStatusAutoTick) {
      document._syncStatusAutoTick = true;
      setInterval(function () { try { paintSync(); } catch (_) {} }, 15000);
    }
  } catch (_) {}
  return function () {
    try { window.removeEventListener('online', off1); } catch (_) {}
    try { window.removeEventListener('offline', off2); } catch (_) {}
    try { window.removeEventListener('sync:update', off3); } catch (_) {}
    try { if (typeof unsub === 'function') unsub(); } catch (_) {}
  };
}

if (typeof window !== 'undefined') {
  window.SyncManager = SyncManager;
  window.subscribeLive = subscribeLive;
  window.mountSyncStatus = mountSyncStatus;
  // Compat: callers legados (app.js onTeamChange/boot) continuam chamando
  // initSupabaseRealtime() — agora delega ao SyncManager com backoff.
  try {
    window._legacyInitSupabaseRealtime = (typeof initSupabaseRealtime === 'function') ? initSupabaseRealtime : null;
    window.initSupabaseRealtime = function () { try { SyncManager.connect(); } catch (_) {} };
    initSupabaseRealtime = window.initSupabaseRealtime;
  } catch (_) {}
  try {
    document.addEventListener('DOMContentLoaded', function () {
      try {
        var el = document.getElementById('syncStatus');
        if (el && typeof mountSyncStatus === 'function') mountSyncStatus(el);
      } catch (_) {}
    });
  } catch (_) {}
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { _syncBackoffDelay, shouldApplyRemote, SyncManager: (typeof SyncManager !== 'undefined' ? SyncManager : null), subscribeLive: (typeof subscribeLive !== 'undefined' ? subscribeLive : null), mountSyncStatus: (typeof mountSyncStatus !== 'undefined' ? mountSyncStatus : null) };
}
