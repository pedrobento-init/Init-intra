import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// Tabela Dexie em memória com a superfície que a outbox usa. O teste exercita
// a lógica real do drain; só o armazenamento é dublê.
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

// Registra o que foi pedido ao servidor, no espírito do mockQ() dos outros testes.
function fakeSupabase({ failIds = [] } = {}) {
  const ops = [];
  const fails = (id) => failIds.includes(id);
  const answer = (id) => Promise.resolve(fails(id) ? { error: { message: 'boom' } } : { error: null });
  return {
    ops,
    from(table) {
      return {
        upsert(row) { ops.push(['upsert', table, row]); return answer(row && row.id); },
        delete() {
          return {
            eq(col, val) { ops.push(['delete', table, col, val]); return answer(val); },
          };
        },
      };
    },
  };
}

let table;
let outbox;

beforeEach(() => {
  table = fakeOutboxTable();
  globalThis.idb = { outbox: table };
  globalThis.ENTITIES = [{ table: 'pendencias', dbKey: 'pendencias', fields: { id: 'id' } }];
  globalThis._mapToRemote = (obj) => ({ id: obj.id });
  globalThis.isSupabaseConnected = () => true;
  globalThis.window = { _supabaseAuthActive: true, addEventListener() {}, dispatchEvent() {} };
  delete require.cache[require.resolve('../js/outbox.js')];
  outbox = require('../js/outbox.js');
});

describe('Outbox — operação enfileirada é respeitada (SYNC-12)', () => {
  it('entrada com op delete exclui no servidor, não faz upsert', async () => {
    globalThis.supabaseClient = fakeSupabase();
    await table.add(outbox.buildOutboxEntry('pendencias', 'delete', { id: 'PEN-1' }));

    await outbox.outboxDrain();

    expect(globalThis.supabaseClient.ops).toEqual([['delete', 'pendencias', 'id', 'PEN-1']]);
  });

  it('entrada de entidade desconhecida não conta como enviada nem desaparece', async () => {
    globalThis.supabaseClient = fakeSupabase();
    await table.add(outbox.buildOutboxEntry('entidade_que_nao_existe', 'upsert', { id: 'X-1' }));

    const res = await outbox.outboxDrain();

    expect(res.sent).toBe(0);
    expect(globalThis.supabaseClient.ops).toEqual([]);
    // Fica como dead-letter: o dado não sobe, mas também não é apagado em silêncio.
    expect(table.all()).toHaveLength(1);
    expect(table.all()[0].dead).toBe(true);
  });
});

describe('Outbox — excluir não ressuscita o registro (SYNC-10)', () => {
  it('outboxRemoveTarget tira da fila o que estava enfileirado para o id', async () => {
    globalThis.supabaseClient = fakeSupabase();
    await outbox.outboxEnqueue('pendencias', 'upsert', { id: 'PEN-1' });
    await outbox.outboxEnqueue('pendencias', 'upsert', { id: 'PEN-2' });

    const removidas = await outbox.outboxRemoveTarget('PEN-1');

    expect(removidas).toBe(1);
    expect(table.all().map((r) => r.targetId)).toEqual(['PEN-2']);
  });

  it('enfileirar o delete substitui o upsert pendente do mesmo id', async () => {
    globalThis.supabaseClient = fakeSupabase();
    await outbox.outboxEnqueue('pendencias', 'upsert', { id: 'PEN-1' });
    await outbox.outboxEnqueue('pendencias', 'delete', { id: 'PEN-1' });

    await outbox.outboxDrain();

    // Se o upsert tivesse sobrevivido, o drain recriaria a pendência excluída.
    expect(globalThis.supabaseClient.ops).toEqual([['delete', 'pendencias', 'id', 'PEN-1']]);
  });
});

describe('Outbox — uma entrada ruim não bloqueia a fila para sempre (SYNC-09)', () => {
  it('depois de OUTBOX_MAX_ATTEMPTS a entrada morre e a de trás sobe', async () => {
    globalThis.supabaseClient = fakeSupabase({ failIds: ['PEN-ruim'] });
    await table.add(outbox.buildOutboxEntry('pendencias', 'upsert', { id: 'PEN-ruim' }));
    await table.add(outbox.buildOutboxEntry('pendencias', 'upsert', { id: 'PEN-bom' }));

    for (let i = 0; i < outbox.OUTBOX_MAX_ATTEMPTS; i++) await outbox.outboxDrain();

    const ruim = table.all().find((r) => r.targetId === 'PEN-ruim');
    expect(ruim.attempts).toBe(outbox.OUTBOX_MAX_ATTEMPTS);
    expect(ruim.dead).toBe(true);
    // A de trás na fila chegou ao servidor e saiu da fila.
    expect(globalThis.supabaseClient.ops.some((o) => o[0] === 'upsert' && o[2].id === 'PEN-bom')).toBe(true);
    expect(table.all().some((r) => r.targetId === 'PEN-bom')).toBe(false);
  });

  it('falha transitória preserva a ordem: a de trás espera a da frente', async () => {
    globalThis.supabaseClient = fakeSupabase({ failIds: ['PEN-ruim'] });
    await table.add(outbox.buildOutboxEntry('pendencias', 'upsert', { id: 'PEN-ruim' }));
    await table.add(outbox.buildOutboxEntry('pendencias', 'upsert', { id: 'PEN-bom' }));

    await outbox.outboxDrain();

    expect(globalThis.supabaseClient.ops.map((o) => o[2].id)).toEqual(['PEN-ruim']);
  });

  it('entrada morta não conta como pendente (o contador precisa poder zerar)', async () => {
    globalThis.supabaseClient = fakeSupabase();
    const seq = await table.add(outbox.buildOutboxEntry('pendencias', 'upsert', { id: 'PEN-morta' }));
    await table.update(seq, { dead: true });

    expect(await outbox.outboxCount()).toBe(0);
    expect(await outbox.outboxHas('PEN-morta')).toBe(false);
  });

  it('entrada morta é ignorada pelo drain em vez de tentada de novo', async () => {
    globalThis.supabaseClient = fakeSupabase();
    const seq = await table.add(outbox.buildOutboxEntry('pendencias', 'upsert', { id: 'PEN-morta' }));
    await table.update(seq, { dead: true });

    const res = await outbox.outboxDrain();

    expect(globalThis.supabaseClient.ops).toEqual([]);
    expect(res.sent).toBe(0);
  });
});
