import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

// Regressão: online, cada save já sobe direto ao servidor — a faixa não pode
// listá-lo como "aguardando envio" só por ser mais novo que o último sync.
const _ls = {};
globalThis.localStorage = { getItem: (k) => (k in _ls ? _ls[k] : null), setItem: (k, v) => { _ls[k] = String(v); }, removeItem: (k) => { delete _ls[k]; } };
const require = createRequire(import.meta.url);
const P = require('../js/pendentes.js');

const SYNC = '2026-10-15T12:00:00.000Z';
const src = (records) => [{ table: 'visits', dbKey: 'intra_visits', lastSyncAt: SYNC, records }];

describe('pendentes com confirmação do servidor', () => {
  it('save online confirmado não aparece (mesmo depois do último sync)', () => {
    const rec = { id: 'V1', clientName: 'Acme', updatedAt: '2026-10-15T13:00:00.000Z' };
    const list = P.buildPendingList(src([rec]), [], {}, { up: { visits: { V1: '2026-10-15T13:00:00.000Z' } } });
    expect(list).toEqual([]);
  });

  it('editado de novo depois da confirmação volta a ser pendente', () => {
    const rec = { id: 'V1', updatedAt: '2026-10-15T14:00:00.000Z' };
    const list = P.buildPendingList(src([rec]), [], {}, { up: { visits: { V1: '2026-10-15T13:00:00.000Z' } } });
    expect(list.map((i) => i.id)).toEqual(['V1']);
  });

  it('exclusão confirmada pelo servidor sai da lista (tombstone fica 30 dias)', () => {
    const tombs = { intra_visits: { V9: '2026-10-15T13:00:00.000Z', V8: '2026-10-15T13:00:00.000Z' } };
    const list = P.buildPendingList(src([]), [], tombs, { del: { visits: { V9: 1 } } });
    expect(list.map((i) => i.id)).toEqual(['V8']);
  });

  it('entrada antiga na outbox já confirmada não conta', () => {
    const ob = [{ entity: 'pendencias', targetId: 'P1', payload: { updatedAt: '2026-10-15T13:00:00.000Z' }, createdAt: '2026-10-15T13:00:00.000Z' }];
    const list = P.buildPendingList([], ob, {}, { up: { pendencias: { P1: '2026-10-15T13:05:00.000Z' } } });
    expect(list).toEqual([]);
  });
});

describe('interceptação do cliente Supabase', () => {
  let requests;
  const fakeClient = () => ({
    from: (table) => {
      const mk = (result) => {
        const b = { then: (res, rej) => { requests++; return Promise.resolve(result).then(res, rej); } };
        return b;
      };
      return {
        upsert: (payload) => mk({ error: payload.fail ? { message: 'x' } : null }),
        delete: () => ({ eq: (_c, id) => mk({ error: id === 'BAD' ? { message: 'x' } : null }) }),
      };
    },
  });
  beforeEach(() => { requests = 0; for (const k of Object.keys(_ls)) delete _ls[k]; });

  it('upsert sem erro marca confirmado; com erro, não', async () => {
    const c = P.wrapSupabaseForSeen(fakeClient());
    await c.from('visits').upsert({ id: 'A', updated_at: '2026-10-15T13:00:00.000Z' });
    await c.from('visits').upsert({ id: 'B', updated_at: '2026-10-15T13:00:00.000Z', fail: true });
    const s = P._loadServerSeen();
    expect(s.up.visits.A).toBe('2026-10-15T13:00:00.000Z');
    expect(s.up.visits.B).toBeUndefined();
    expect(requests).toBe(2); // nenhuma requisição extra
  });

  it('delete por id sem erro marca exclusão confirmada', async () => {
    const c = P.wrapSupabaseForSeen(fakeClient());
    await c.from('visits').delete().eq('id', 'X');
    await c.from('visits').delete().eq('id', 'BAD');
    const s = P._loadServerSeen();
    expect(s.del.visits.X).toBe(1);
    expect(s.del.visits.BAD).toBeUndefined();
  });
});
