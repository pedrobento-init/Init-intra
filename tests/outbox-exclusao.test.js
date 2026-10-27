import { createRequire as __storageReq } from 'node:module';
const { requireStorage } = __storageReq(import.meta.url)('./_storage.cjs');
import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// SYNC-10: excluir uma pendência que tinha save enfileirado deixava o upsert na
// fila; o drain seguinte recriava o registro no servidor. O teste exercita o
// `deletePendencia` real contra uma outbox em memória.
function _setGlobal(name, value) {
  try { Object.defineProperty(globalThis, name, { value, writable: true, configurable: true }); }
  catch (_) { globalThis[name] = value; }
}

function fakeOutboxTable() {
  const rows = new Map();
  let next = 1;
  const sorted = () => [...rows.values()].sort((a, b) => a.seq - b.seq);
  return {
    all: sorted,
    async add(entry) { const seq = next++; rows.set(seq, { ...entry, seq }); return seq; },
    async delete(seq) { rows.delete(seq); },
    async update(seq, patch) { const r = rows.get(seq); if (r) rows.set(seq, { ...r, ...patch }); },
    async count() { return rows.size; },
    orderBy() { return { toArray: async () => sorted() }; },
    where(field) {
      return {
        equals(val) {
          const sel = () => sorted().filter((r) => r[field] === val);
          return { toArray: async () => sel(), count: async () => sel().length };
        },
      };
    },
  };
}

// Espera pela condição em vez de dormir: a limpeza da fila é assíncrona.
async function until(cond, label) {
  for (let i = 0; i < 100; i++) {
    if (await cond()) return;
    await new Promise((r) => setImmediate(r));
  }
  throw new Error('condição não atingida: ' + label);
}

const _ls = {};
let stores;
let table;

_setGlobal('window', { _pendingSyncCount: 0, _supabaseAuthActive: true, _suppressPendingSync: false, addEventListener() {}, dispatchEvent() {} });
_setGlobal('navigator', { onLine: true });
_setGlobal('document', { visibilityState: 'visible', getElementById: () => null, addEventListener() {} });
_setGlobal('localStorage', { getItem: (k) => (k in _ls ? _ls[k] : null), setItem: (k, v) => { _ls[k] = String(v); }, removeItem: (k) => { delete _ls[k]; } });
_setGlobal('getCacheStore', (t) => stores[t] || []);
_setGlobal('setCacheStore', (t, v) => { stores[t] = v; });
_setGlobal('getCacheTable', (t) => (t === 'sessions' ? { value: { opId: 'OP-1', ts: Date.now() } } : null));
_setGlobal('setCacheTable', () => {});
_setGlobal('getCacheKV', (_k, d) => d);
_setGlobal('setCacheKV', () => {});
_setGlobal('isSupabaseConnected', () => true);

const quiet = console.error;
console.error = () => {};
const storage = requireStorage();
console.error = quiet;
const outbox = require('../js/outbox.js');
_setGlobal('Outbox', outbox.Outbox); // em produção os dois são <script> no mesmo escopo

describe('Excluir pendência limpa a fila (SYNC-10)', () => {
  beforeEach(() => {
    table = fakeOutboxTable();
    _setGlobal('idb', { outbox: table });
    stores = {
      operators: [{ id: 'OP-1', name: 'Admin', isAdmin: true, active: true, team: 'init' }],
      pendencias: [{ id: 'PEN-1', assunto: 'Trocar HD', team: 'init', updatedAt: '2026-10-01T00:00:00.000Z' }],
    };
    _setGlobal('supabaseClient', {
      from: () => ({
        delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
        upsert: () => Promise.resolve({ error: null }),
        insert: () => Promise.resolve({ error: null }),
      }),
    });
  });

  it('o upsert enfileirado para a pendência sai da fila ao excluir', async () => {
    await outbox.outboxEnqueue('pendencias', 'upsert', { id: 'PEN-1', assunto: 'Trocar HD' });
    expect(table.all()).toHaveLength(1);

    expect(storage.deletePendencia('PEN-1')).toBe(true);

    await until(() => table.all().every((r) => r.op === 'delete'), 'nenhum upsert pendente para PEN-1');
    expect(table.all().some((r) => r.targetId === 'PEN-1' && r.op === 'upsert')).toBe(false);
  });

  it('offline, o delete entra na fila no lugar do upsert', async () => {
    _setGlobal('isSupabaseConnected', () => false);
    try {
      await outbox.outboxEnqueue('pendencias', 'upsert', { id: 'PEN-1', assunto: 'Trocar HD' });

      expect(storage.deletePendencia('PEN-1')).toBe(true);

      await until(() => table.all().some((r) => r.targetId === 'PEN-1' && r.op === 'delete'), 'delete enfileirado');
      expect(table.all().filter((r) => r.targetId === 'PEN-1')).toHaveLength(1);
    } finally {
      _setGlobal('isSupabaseConnected', () => true);
    }
  });

  it('não mexe na fila de outras pendências', async () => {
    await outbox.outboxEnqueue('pendencias', 'upsert', { id: 'PEN-9', assunto: 'Outra' });

    storage.deletePendencia('PEN-1');

    await until(() => true, 'tick');
    expect(table.all().some((r) => r.targetId === 'PEN-9' && r.op === 'upsert')).toBe(true);
  });
});
