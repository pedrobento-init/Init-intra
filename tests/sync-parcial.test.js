import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

// Sync parcial (P-9) e pull paginado (SYNC-01) com o merge REAL do schema.js
// e um "servidor" em memória que imita o PostgREST (corta em 1000 linhas).
function _setGlobal(name, value) {
  try { Object.defineProperty(globalThis, name, { value, writable: true, configurable: true }); }
  catch (_) { globalThis[name] = value; }
}
const _ls = {};
_setGlobal('window', { _pendingSyncCount: 0, _supabaseAuthActive: true, _suppressPendingSync: false, addEventListener() {} });
_setGlobal('navigator', { onLine: true });
_setGlobal('document', { visibilityState: 'visible', getElementById: () => null, addEventListener() {} });
_setGlobal('localStorage', { getItem: (k) => (k in _ls ? _ls[k] : null), setItem: (k, v) => { _ls[k] = String(v); }, removeItem: (k) => { delete _ls[k]; } });
globalThis.Dexie = class { constructor() {} version() { return { stores() {} }; } };

// Banco local mínimo (getCacheStore/getCacheKV) para chaves fora do mapa.
const _kv = {};
_setGlobal('getCacheStore', () => []);
_setGlobal('getCacheKV', (k, d) => (k in _kv ? _kv[k] : d));
_setGlobal('setCacheStore', () => {});
_setGlobal('setCacheKV', (k, v) => { _kv[k] = v; });

const require = createRequire(import.meta.url);
const schema = require('../js/schema.js');
for (const k of ['_mergeRecords', '_mapToRemote', '_needsPush', '_classifyLocalOnly', '_filterRemoteByTombstones', '_retainFailedPush', '_planDeltaPull', '_shouldFullSync', '_pruneTombstones']) _setGlobal(k, schema[k]);
_setGlobal('SYNC_ENTITIES', []);
const quiet = console.error; console.error = () => {};
const storage = require('../js/storage.js');
console.error = quiet;

const ENTITY = { table: 'items', dbKey: 'intra_items_test', label: 'Itens', fields: { id: 'id', name: 'name', created_at: 'createdAt', updated_at: 'updatedAt' } };

// ── "Servidor" PostgREST em memória ─────────────────────────────────────────
let server; let calls;
function builder(table) {
  const st = { cols: '*', range: null, ids: null, limit: null };
  const exec = () => {
    let rows = [...(server[table] || [])].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    if (st.ids) rows = rows.filter((r) => st.ids.includes(r.id));
    if (st.range) rows = rows.slice(st.range[0], st.range[1] + 1);
    rows = rows.slice(0, st.limit || 1000); // max-rows do PostgREST
    if (st.cols !== '*') rows = rows.map((r) => Object.fromEntries(st.cols.split(',').map((c) => [c, r[c]])));
    calls.push({ table, cols: st.cols, range: st.range, ids: st.ids ? st.ids.length : null });
    return Promise.resolve({ data: rows.map((r) => ({ ...r })), error: null });
  };
  const b = {
    select(cols) { st.cols = cols || '*'; return b; },
    order() { return b; },
    range(a, z) { st.range = [a, z]; return b; },
    in(_c, ids) { st.ids = ids; return b; },
    limit(n) { st.limit = n; return b; },
    then(res, rej) { return exec().then(res, rej); },
    upsert(p) { const arr = server[table] || (server[table] = []); const i = arr.findIndex((r) => r.id === p.id); if (i >= 0) arr[i] = { ...arr[i], ...p }; else arr.push({ ...p }); calls.push({ table, upsert: p.id }); return Promise.resolve({ error: null }); },
    delete() { return { eq: (_c, id) => { server[table] = (server[table] || []).filter((r) => r.id !== id); return Promise.resolve({ error: null }); } }; },
  };
  return b;
}
const T0 = '2026-10-01T10:00:00.000Z';
const row = (id, name, at = T0) => ({ id, name, created_at: T0, updated_at: at });
const sync = () => storage.syncSupabaseToLocal({ checkTimeoutMs: 200, opTimeoutMs: 400, retry: false, reason: 'test' });
const local = () => storage.dbGet(ENTITY.dbKey);

beforeEach(() => {
  for (const k of Object.keys(_ls)) delete _ls[k];
  for (const k of Object.keys(_kv)) delete _kv[k];
  server = { items: [], operators: [{ id: 'op', updated_at: T0 }] };
  calls = [];
  globalThis.supabaseClient = { from: (t) => builder(t) };
  globalThis.isSupabaseConnected = () => true;
  globalThis.SYNC_ENTITIES = [ENTITY];
  console.info = () => {}; console.warn = () => {}; console.debug = () => {};
});

describe('pull paginado (SYNC-01)', () => {
  it('2.500 linhas no servidor chegam inteiras (antes: cortava em 1.000)', async () => {
    server.items = Array.from({ length: 2500 }, (_, i) => row('I' + String(i).padStart(5, '0'), 'n' + i));
    const res = await sync();
    expect(res.ok).toBe(true);
    expect(local()).toHaveLength(2500);
    expect(calls.filter((c) => c.table === 'items' && c.cols === '*' && c.range).length).toBe(3);
  });
});

describe('sync parcial (P-9)', () => {
  async function seeded() {
    server.items = [row('A', 'a'), row('B', 'b'), row('C', 'c')];
    await sync(); // 1º sync: completo
    calls = [];
  }

  it('2º sync baixa só id,updated_at quando nada mudou', async () => {
    await seeded();
    await sync();
    const itemCalls = calls.filter((c) => c.table === 'items' && !c.upsert);
    expect(itemCalls.length).toBeGreaterThan(0);
    expect(itemCalls.every((c) => c.cols === 'id,updated_at')).toBe(true);
    expect(local().map((r) => r.name).sort()).toEqual(['a', 'b', 'c']);
  });

  it('alteração e linha nova no servidor: busca só esses ids', async () => {
    await seeded();
    server.items[1] = row('B', 'b2', '2026-10-02T10:00:00.000Z');
    server.items.push(row('D', 'd'));
    await sync();
    const delta = calls.find((c) => c.table === 'items' && c.cols === '*');
    expect(delta.ids).toBe(2);
    expect(local().map((r) => r.name).sort()).toEqual(['a', 'b2', 'c', 'd']);
  });

  it('linha apagada no servidor some do local (mesma regra do sync completo)', async () => {
    await seeded();
    server.items = server.items.filter((r) => r.id !== 'C');
    await sync();
    expect(local().map((r) => r.id).sort()).toEqual(['A', 'B']);
  });

  it('edição local mais nova continua sendo enviada', async () => {
    await seeded();
    const list = local().map((r) => (r.id === 'A' ? { ...r, name: 'a-local', updatedAt: '2026-10-03T10:00:00.000Z' } : r));
    storage.dbSet(ENTITY.dbKey, list);
    await sync();
    expect(server.items.find((r) => r.id === 'A').name).toBe('a-local');
    expect(local().find((r) => r.id === 'A').name).toBe('a-local');
  });

  it('sem sync completo há mais de 24h, faz o completo de novo', async () => {
    await seeded();
    const m = JSON.parse(_ls.intra_sync_at_v1);
    m['__full__:items'] = '2026-01-01T00:00:00.000Z';
    _ls.intra_sync_at_v1 = JSON.stringify(m);
    await sync();
    expect(calls.some((c) => c.table === 'items' && c.cols === '*' && c.range)).toBe(true);
  });
});

describe('_planDeltaPull', () => {
  it('compara instantes, não texto (+00:00 = Z)', () => {
    const p = schema._planDeltaPull(
      [{ id: 'A', updatedAt: '2026-10-01T10:00:00.000Z' }],
      [{ id: 'A', updated_at: '2026-10-01T10:00:00+00:00' }, { id: 'B', updated_at: T0 }]
    );
    expect(p.sameIds).toEqual(['A']);
    expect(p.changedIds).toEqual(['B']);
  });
});
