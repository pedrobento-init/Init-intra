import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// SYNC-02 / P-10: a fila offline deixa de ser só de `pendencias`. Mesma tabela
// Dexie em memória do outbox.test.js; só o armazenamento é dublê.
function fakeOutboxTable() {
  const rows = new Map();
  let next = 1;
  const sorted = () => [...rows.values()].sort((a, b) => a.seq - b.seq);
  return {
    rows,
    all: sorted,
    async add(entry) { const seq = next++; rows.set(seq, { ...entry, seq }); return seq; },
    async delete(seq) { rows.delete(seq); },
    async update(seq, patch) { const r = rows.get(seq); if (r) rows.set(seq, { ...r, ...patch }); },
    orderBy() { return { toArray: async () => sorted() }; },
    where(field) {
      return { equals(val) { return { toArray: async () => sorted().filter((r) => r[field] === val) }; } };
    },
  };
}

// Servidor fake: guarda updated_at por id para o guard de LWW e registra escritas.
function fakeSupabase({ serverUpdatedAt = {}, failUpsert = false } = {}) {
  const ops = [];
  return {
    ops,
    from(table) {
      return {
        upsert(row) { ops.push(['upsert', table, row]); return Promise.resolve({ error: failUpsert ? { message: 'boom' } : null }); },
        delete() { return { eq(col, val) { ops.push(['delete', table, val]); return Promise.resolve({ error: null }); } }; },
        select() {
          return { eq(col, val) { return { maybeSingle: async () => ({ data: serverUpdatedAt[val] ? { updated_at: serverUpdatedAt[val] } : null, error: null }) }; } };
        },
      };
    },
  };
}

let table; let outbox; let sb;
const ENTS = [
  { table: 'visits', dbKey: 'intra_visits', fields: { id: 'id', client_name: 'clientName', updated_at: 'updatedAt' } },
  { table: 'operators', dbKey: 'intra_operators', fields: { id: 'id' }, buildUpsert: (o) => ({ id: o.id, built: true }) },
];

beforeEach(() => {
  table = fakeOutboxTable();
  sb = fakeSupabase();
  globalThis.idb = { outbox: table };
  globalThis.supabaseClient = sb;
  globalThis.ENTITIES = ENTS;
  globalThis._mapToRemote = (obj, fields) => { const o = {}; for (const [rk, lk] of Object.entries(fields)) o[rk] = obj[lk]; return o; };
  globalThis.isSupabaseConnected = () => true;
  globalThis.window = { _supabaseAuthActive: true, addEventListener() {}, dispatchEvent() {} };
  globalThis.CustomEvent = class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } };
  delete globalThis.showToast;
  delete require.cache[require.resolve('../js/outbox.js')];
  outbox = require('../js/outbox.js');
});

describe('Outbox — entidades além de pendencias (SYNC-02)', () => {
  it('upsert de visita enfileirado sobe mapeado pelo schema da entidade', async () => {
    await outbox.outboxQueueUpsert('visits', { id: 'V1', clientName: 'ACME', updatedAt: '2026-01-01T10:00:00.000Z' });
    const r = await outbox.outboxDrain();
    expect(r.sent).toBe(1);
    expect(sb.ops).toEqual([['upsert', 'visits', { id: 'V1', client_name: 'ACME', updated_at: '2026-01-01T10:00:00.000Z' }]]);
    expect(table.all()).toHaveLength(0);
  });
  it('entidade com buildUpsert usa o builder, não o mapa genérico', async () => {
    await outbox.outboxQueueUpsert('operators', { id: 'O1' });
    await outbox.outboxDrain();
    expect(sb.ops[0][2]).toEqual({ id: 'O1', built: true });
  });
  it('sem backend configurado (modo local) nada entra na fila', async () => {
    globalThis.isSupabaseConnected = () => false;
    expect(await outbox.outboxQueueUpsert('visits', { id: 'V1' })).toBeNull();
    expect(await outbox.outboxQueueDelete('visits', 'V1')).toBeNull();
    expect(table.all()).toHaveLength(0);
  });
  it('erro de dado (4xx/RLS) não enfileira; queda de rede enfileira', async () => {
    expect(outbox.outboxQueueIfTransient('visits', 'upsert', { id: 'V1' }, { status: 403, message: 'rls' })).toBeNull();
    await outbox.outboxQueueIfTransient('visits', 'upsert', { id: 'V2' }, null, true);
    expect(table.all().map((r) => r.targetId)).toEqual(['V2']);
  });
  it('delete enfileirado de visita não vira upsert', async () => {
    await outbox.outboxQueueDelete('visits', 'V9');
    await outbox.outboxDrain();
    expect(sb.ops).toEqual([['delete', 'visits', 'V9']]);
  });
  it('LWW: servidor mais novo que a entrada vence e a entrada é descartada sem upsert', async () => {
    sb = fakeSupabase({ serverUpdatedAt: { V1: '2026-02-01T00:00:00.000Z' } });
    globalThis.supabaseClient = sb;
    await outbox.outboxQueueUpsert('visits', { id: 'V1', clientName: 'velho', updatedAt: '2026-01-01T00:00:00.000Z' });
    const r = await outbox.outboxDrain();
    expect(sb.ops.filter((o) => o[0] === 'upsert')).toHaveLength(0);
    expect(r.sent).toBe(0);
    expect(r.skipped).toBe(1);
    expect(table.all()).toHaveLength(0);
  });
  it('LWW: servidor mais velho não bloqueia o envio', async () => {
    sb = fakeSupabase({ serverUpdatedAt: { V1: '2025-01-01T00:00:00.000Z' } });
    globalThis.supabaseClient = sb;
    await outbox.outboxQueueUpsert('visits', { id: 'V1', updatedAt: '2026-01-01T00:00:00.000Z' });
    expect((await outbox.outboxDrain()).sent).toBe(1);
  });
});

describe('Outbox — falha permanente visível e resolvível (SYNC-09)', () => {
  async function killOne() {
    await outbox.outboxQueueUpsert('visits', { id: 'V1', updatedAt: '2026-01-01T00:00:00.000Z' });
    globalThis.supabaseClient = fakeSupabase({ failUpsert: true });
    for (let i = 0; i < outbox.OUTBOX_MAX_ATTEMPTS; i++) await outbox.outboxDrain();
  }
  it('ao morrer, o usuário é avisado por toast', async () => {
    const toasts = [];
    globalThis.showToast = (m, t) => toasts.push([m, t]);
    await killOne();
    expect(table.all()[0].dead).toBe(true);
    expect(toasts).toHaveLength(1);
    expect(toasts[0][1]).toBe('error');
  });
  it('descartar remove só as mortas', async () => {
    await killOne();
    await outbox.outboxQueueUpsert('visits', { id: 'V2', updatedAt: '2026-01-01T00:00:00.000Z' });
    expect(await outbox.outboxDiscardDead()).toBe(1);
    expect(table.all().map((r) => r.targetId)).toEqual(['V2']);
  });
  it('reenviar zera tentativas e tenta de novo', async () => {
    await killOne();
    globalThis.supabaseClient = fakeSupabase();
    expect(await outbox.outboxRetryDead()).toBe(1);
    expect(table.all()).toHaveLength(0);
    expect(globalThis.supabaseClient.ops[0][0]).toBe('upsert');
  });
});

describe('Atalhos de enfileiramento dos saves (_outboxOffline/_outboxFail/_outboxDropTarget)', () => {
  it('_outboxOffline enfileira upsert e delete sem lançar', async () => {
    outbox._outboxOffline('visits', 'upsert', { id: 'V1', updatedAt: '2026-01-01T00:00:00.000Z' });
    outbox._outboxOffline('visits', 'delete', { id: 'V2' });
    await new Promise((r) => setTimeout(r, 0));
    expect(table.all().map((r) => [r.entity, r.op, r.targetId])).toEqual([['visits', 'upsert', 'V1'], ['visits', 'delete', 'V2']]);
  });
  it('_outboxFail só enfileira falha de conectividade, não 4xx/RLS', async () => {
    outbox._outboxFail('visits', 'upsert', { id: 'V1' }, { status: 403, message: 'rls' });
    outbox._outboxFail('visits', 'upsert', { id: 'V2' }, null, true);
    await new Promise((r) => setTimeout(r, 0));
    expect(table.all().map((r) => r.targetId)).toEqual(['V2']);
  });
  it('_outboxDropTarget remove a entrada pendente do id (delete direto não é desfeito pelo drain)', async () => {
    await outbox.outboxQueueUpsert('visits', { id: 'V1', updatedAt: '2026-01-01T00:00:00.000Z' });
    outbox._outboxDropTarget('V1');
    await new Promise((r) => setTimeout(r, 0));
    expect(table.all()).toHaveLength(0);
  });
  it('sem backend configurado, nenhum atalho lança nem enfileira', async () => {
    globalThis.isSupabaseConnected = () => false;
    expect(() => outbox._outboxOffline('visits', 'upsert', { id: 'V1' })).not.toThrow();
    expect(() => outbox._outboxFail('visits', 'delete', { id: 'V1' }, null, true)).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(table.all()).toHaveLength(0);
  });
});
