// outbox.js — fila persistente de operações offline (outbox pattern)
// =====================================================================
// Por que Dexie e não só contador em memória: o contador atual
// (window._pendingSyncCount em storage.js) morre no reload e não guarda
// O QUE enviar. A outbox guarda a operação (entity/op/payload) no
// IndexedDB (tabela `outbox`, db.js v8) e reenvia no `online` em lote,
// removendo só com confirmação do servidor.
//
// Ordem de carga: após db.js (idb), schema.js (ENTITIES/_mapToRemote) e
// storage.js (incrementPendingSync/triggerStartupSync).

// Pura e testável: monta a entrada sem tocar no IndexedDB.
function buildOutboxEntry(entity, op, payload) {
  var p = payload || {};
  return {
    entity: String(entity || ''),
    op: String(op || 'upsert'),
    targetId: String(p.id || ''),
    payload: p,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
}

function _outboxTable() {
  try {
    if (typeof idb !== 'undefined' && idb && idb.outbox) return idb.outbox;
  } catch (_) {}
  return null;
}

// Enfileira sem duplicar o mesmo alvo (última escrita vence na fila).
async function outboxEnqueue(entity, op, payload) {
  var entry = buildOutboxEntry(entity, op, payload);
  if (!entry.entity || !entry.targetId) return null;
  var t = _outboxTable();
  if (!t) {
    try { if (typeof incrementPendingSync === 'function') incrementPendingSync(); } catch (_) {}
    return null;
  }
  try {
    var prev = await t.where('targetId').equals(entry.targetId).toArray();
    for (var i = 0; i < prev.length; i++) {
      try { await t.delete(prev[i].seq); } catch (_) {}
    }
    var seq = await t.add(entry);
    try { if (typeof incrementPendingSync === 'function') incrementPendingSync(); } catch (_) {}
    try {
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('sync:update', { detail: { status: 'pending' } }));
      if (typeof emitDataChanged === 'function') emitDataChanged('sync-status', { status: 'pending' });
    } catch (_) {}
    return seq;
  } catch (_) {
    return null;
  }
}

async function outboxHas(targetId) {
  if (!targetId) return false;
  var t = _outboxTable();
  if (!t) return false;
  try {
    return (await t.where('targetId').equals(String(targetId)).count()) > 0;
  } catch (_) { return false; }
}

async function outboxCount() {
  var t = _outboxTable();
  if (!t) {
    try { if (typeof getPendingSyncCount === 'function') return getPendingSyncCount(); } catch (_) {}
    return 0;
  }
  try { return await t.count(); } catch (_) { return 0; }
}

// Envio em lote ao reconectar: em ordem de criação, para no primeiro
// erro (tenta de novo no próximo `online`). Remove SÓ com ack do servidor
// (idempotente: upsert pela mesma PK não duplica).
async function outboxDrain() {
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return { ok: false, reason: 'offline' };
    if (typeof isSupabaseConnected !== 'function' || !isSupabaseConnected() || !window._supabaseAuthActive) {
      return { ok: false, reason: 'not-connected' };
    }
  } catch (_) { return { ok: false, reason: 'not-connected' }; }
  var t = _outboxTable();
  if (!t) return { ok: false, reason: 'no-table' };
  var rows = [];
  try { rows = await t.orderBy('seq').toArray(); } catch (_) { return { ok: false, reason: 'read-failed' }; }
  var sent = 0;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    try {
      var meta = null;
      try {
        meta = (typeof ENTITIES !== 'undefined')
          ? ENTITIES.find(function (e) { return e.table === r.entity || e.dbKey === r.entity; })
          : null;
      } catch (_) { meta = null; }
      if (!meta) { try { await t.delete(r.seq); } catch (_) {} sent++; continue; }
      var remote = (typeof _mapToRemote === 'function') ? _mapToRemote(r.payload || {}, meta.fields) : (r.payload || {});
      var res = await supabaseClient.from(meta.table).upsert(remote);
      if (res && res.error) throw res.error;
      try { await t.delete(r.seq); } catch (_) {}
      sent++;
    } catch (_) {
      try { await t.update(r.seq, { attempts: (r.attempts || 0) + 1 }); } catch (_) {}
      break;
    }
  }
  try {
    if (typeof triggerStartupSync === 'function') triggerStartupSync('outbox-drained');
  } catch (_) {}
  try {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('sync:update', { detail: { status: 'drained', sent: sent } }));
  } catch (_) {}
  return { ok: true, sent: sent, remaining: rows.length - sent };
}

// Aliases de compatibilidade (código proposto na discussão usava Outbox.*)
var Outbox = {
  enqueue: outboxEnqueue,
  has: outboxHas,
  count: outboxCount,
  drain: outboxDrain,
  buildEntry: buildOutboxEntry,
};

if (typeof window !== 'undefined') {
  window.Outbox = Outbox;
  window.addEventListener('online', function () { try { outboxDrain(); } catch (_) {} });
  if (!window._outboxDrainBound && typeof document !== 'undefined') {
    window._outboxDrainBound = true;
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      try { if (typeof navigator === 'undefined' || navigator.onLine !== false) outboxDrain(); } catch (_) {}
    });
  }
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildOutboxEntry, outboxEnqueue, outboxHas, outboxCount, outboxDrain, Outbox };
}
