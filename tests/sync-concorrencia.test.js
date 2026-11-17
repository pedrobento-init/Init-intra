import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { _reconcileConcurrentEdits } = require('../js/schema.js');

// SYNC-03: o merge do sync grava a lista inteira depois de awaits; o que o
// usuário/realtime gravou nesse intervalo não pode ser sobrescrito.
const rec = (id, at, extra = {}) => ({ id, updatedAt: at, ...extra });

describe('_reconcileConcurrentEdits (SYNC-03)', () => {
  it('edição local feita durante o sync (mais nova) vence o resultado do merge', () => {
    const snapshot = [rec('A', '2026-01-01T00:00:00Z', { nome: 'x' })];
    const final = [rec('A', '2026-01-01T00:00:00Z', { nome: 'x' })];
    const current = [rec('A', '2026-01-01T00:05:00Z', { nome: 'editado' })];
    expect(_reconcileConcurrentEdits(final, snapshot, current)[0].nome).toBe('editado');
  });
  it('registro criado durante o sync (ausente do remoto) não some', () => {
    const out = _reconcileConcurrentEdits([rec('A', '2026-01-01T00:00:00Z')], [rec('A', '2026-01-01T00:00:00Z')], [rec('A', '2026-01-01T00:00:00Z'), rec('NOVO', '2026-01-02T00:00:00Z')]);
    expect(out.map((r) => r.id).sort()).toEqual(['A', 'NOVO']);
  });
  it('apagado localmente durante o sync não ressuscita pelo remoto', () => {
    const snap = [rec('A', '2026-01-01T00:00:00Z'), rec('B', '2026-01-01T00:00:00Z')];
    const out = _reconcileConcurrentEdits(snap.slice(), snap, [snap[0]]);
    expect(out.map((r) => r.id)).toEqual(['A']);
  });
  it('se o merge trouxe versão mais nova que a do local atual, o merge vence (LWW)', () => {
    const snap = [rec('A', '2026-01-01T00:00:00Z')];
    const final = [rec('A', '2026-03-01T00:00:00Z', { nome: 'remoto' })];
    const current = [rec('A', '2026-01-02T00:00:00Z', { nome: 'local' })];
    expect(_reconcileConcurrentEdits(final, snap, current)[0].nome).toBe('remoto');
  });
  it('sem mudança concorrente devolve o merge intacto', () => {
    const snap = [rec('A', '2026-01-01T00:00:00Z')];
    const final = [rec('A', '2026-01-01T00:00:00Z', { nome: 'merge' })];
    expect(_reconcileConcurrentEdits(final, snap, snap)).toEqual(final);
  });
});

describe('applyRemote não tem ponto de suspensão entre dbGet e dbSet (SYNC-03)', () => {
  let store; let order;
  beforeEach(() => {
    store = [{ id: 'A', updatedAt: '2026-01-01T00:00:00Z', nome: 'velho' }];
    order = [];
    globalThis.window = { addEventListener() {}, dispatchEvent() {} };
    globalThis.document = { addEventListener() {} };
    globalThis.ENTITIES = [{ table: 'items', dbKey: 'items', fields: { id: 'id', nome: 'nome', updated_at: 'updatedAt' } }];
    globalThis._mapFromRemote = (row) => ({ id: row.id, nome: row.nome, updatedAt: row.updated_at });
    globalThis.dbGet = () => { order.push('get'); return store.slice(); };
    globalThis.dbSet = (_k, list) => { order.push('set'); store = list; };
  });
  it('a leitura da outbox (async) acontece antes do dbGet', async () => {
    globalThis.Outbox = { has: async () => { order.push('has'); await new Promise((r) => setTimeout(r, 5)); return false; } };
    delete require.cache[require.resolve('../js/sync-manager.js')];
    const { SyncManager } = require('../js/sync-manager.js');
    await SyncManager.applyRemote('items', 'UPDATE', { id: 'A', nome: 'novo', updated_at: '2026-02-01T00:00:00Z' });
    expect(order).toEqual(['has', 'get', 'set']);
    expect(store[0].nome).toBe('novo');
  });
});
