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

// Teto de tentativas antes de considerar a entrada morta. Sem ele, uma entrada
// que falha sempre (payload inválido, RLS nega) trava a fila inteira para
// sempre, porque o drain para na primeira falha para preservar a ordem.
var OUTBOX_MAX_ATTEMPTS = 5;

function _outboxTable() {
  try {
    if (typeof idb !== 'undefined' && idb && idb.outbox) return idb.outbox;
  } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'outbox'); }
  return null;
}

// Tira da fila tudo que estava enfileirado para um id. Serve ao enqueue
// (última escrita vence) e à exclusão: deixar atrás um upsert pendente faz o
// próximo drain recriar no servidor o registro que o usuário apagou.
async function outboxRemoveTarget(targetId) {
  if (!targetId) return 0;
  var t = _outboxTable();
  if (!t) return 0;
  var removed = 0;
  try {
    var prev = await t.where('targetId').equals(String(targetId)).toArray();
    for (var i = 0; i < prev.length; i++) {
      try { await t.delete(prev[i].seq); removed++; } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'outbox'); }
    }
  } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'outbox'); }
  return removed;
}

// Enfileira sem duplicar o mesmo alvo (última escrita vence na fila).
async function outboxEnqueue(entity, op, payload) {
  var entry = buildOutboxEntry(entity, op, payload);
  if (!entry.entity || !entry.targetId) return null;
  var t = _outboxTable();
  if (!t) {
    try { if (typeof incrementPendingSync === 'function') incrementPendingSync(); } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'outbox'); }
    return null;
  }
  try {
    await outboxRemoveTarget(entry.targetId);
    var seq = await t.add(entry);
    try { if (typeof incrementPendingSync === 'function') incrementPendingSync(); } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'outbox'); }
    try {
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('sync:update', { detail: { status: 'pending' } }));
      if (typeof emitDataChanged === 'function') emitDataChanged('sync-status', { status: 'pending' });
    } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'outbox'); }
    return seq;
  } catch (_) {
    return null;
  }
}

// Entrada morta não está mais a caminho do servidor: contá-la deixaria o
// contador de pendências preso num número que nunca baixa.
function _outboxAlive(r) { return !!r && !r.dead; }

async function outboxHas(targetId) {
  if (!targetId) return false;
  var t = _outboxTable();
  if (!t) return false;
  try {
    return (await t.where('targetId').equals(String(targetId)).toArray()).some(_outboxAlive);
  } catch (_) { return false; }
}

async function outboxCount() {
  var t = _outboxTable();
  if (!t) {
    try { if (typeof getPendingSyncCount === 'function') return getPendingSyncCount(); } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'outbox'); }
    return 0;
  }
  try { return (await t.orderBy('seq').toArray()).filter(_outboxAlive).length; } catch (_) { return 0; }
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
    if (r && r.dead) continue; // dead-letter: não tenta de novo nem bloqueia
    try {
      var meta = null;
      try {
        meta = (typeof ENTITIES !== 'undefined')
          ? ENTITIES.find(function (e) { return e.table === r.entity || e.dbKey === r.entity; })
          : null;
      } catch (_) { meta = null; }
      // Entidade que não existe no schema nunca vai subir: marcar como morta
      // preserva o dado para inspeção. Apagar e contar como `sent` era perda
      // silenciosa disfarçada de sucesso.
      if (!meta) {
        try { await t.update(r.seq, { dead: true, deadReason: 'entidade desconhecida: ' + r.entity }); } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'outbox'); }
        continue;
      }
      // O `op` gravado no enqueue manda: um delete enfileirado que virasse
      // upsert recriaria no servidor o registro que o usuário excluiu.
      var res;
      if (r.op === 'delete') {
        res = await supabaseClient.from(meta.table).delete().eq('id', r.targetId);
      } else {
        var remote = (typeof _mapToRemote === 'function') ? _mapToRemote(r.payload || {}, meta.fields, meta.optionalFields) : (r.payload || {});
        res = await supabaseClient.from(meta.table).upsert(remote);
      }
      if (res && res.error) throw res.error;
      try { await t.delete(r.seq); } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'outbox'); }
      sent++;
    } catch (_) {
      var tries = (r.attempts || 0) + 1;
      var patch = { attempts: tries };
      if (tries >= OUTBOX_MAX_ATTEMPTS) {
        patch.dead = true;
        patch.deadReason = 'falhou ' + tries + ' vezes';
      }
      try { await t.update(r.seq, patch); } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'outbox'); }
      // Falha transitória para o drain para preservar a ordem; entrada morta
      // sai da frente para o resto da fila andar.
      if (patch.dead) continue;
      break;
    }
  }
  try {
    if (typeof triggerStartupSync === 'function') triggerStartupSync('outbox-drained');
  } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'outbox'); }
  try {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('sync:update', { detail: { status: 'drained', sent: sent } }));
  } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'outbox'); }
  return { ok: true, sent: sent, remaining: rows.length - sent };
}

// Aliases de compatibilidade (código proposto na discussão usava Outbox.*)
var Outbox = {
  MAX_ATTEMPTS: OUTBOX_MAX_ATTEMPTS,
  enqueue: outboxEnqueue,
  removeTarget: outboxRemoveTarget,
  has: outboxHas,
  count: outboxCount,
  drain: outboxDrain,
  buildEntry: buildOutboxEntry,
};

if (typeof window !== 'undefined') {
  window.Outbox = Outbox;
  window.addEventListener('online', function () { try { outboxDrain(); } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'outbox'); } });
  if (!window._outboxDrainBound && typeof document !== 'undefined') {
    window._outboxDrainBound = true;
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      try { if (typeof navigator === 'undefined' || navigator.onLine !== false) outboxDrain(); } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'outbox'); }
    });
  }
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildOutboxEntry, outboxEnqueue, outboxRemoveTarget, outboxHas, outboxCount, outboxDrain, Outbox, OUTBOX_MAX_ATTEMPTS };
}
