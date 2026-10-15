import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildPendingList } = require('../js/pendentes.js');

const SYNC = '2026-10-15T12:00:00.000Z';

describe('lista de alterações aguardando envio', () => {
  it('pega o que mudou depois do último sync (e ignora o que já subiu)', () => {
    const list = buildPendingList([{
      table: 'visits', dbKey: 'intra_visits', lastSyncAt: SYNC,
      records: [
        { id: 'V1', clientName: 'Acme', date: '2026-10-15', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-15T13:00:00.000Z' },
        { id: 'V2', clientName: 'Beta', createdAt: '2026-10-15T14:00:00.000Z', updatedAt: '2026-10-15T14:00:00.000Z' },
        { id: 'V3', clientName: 'Velha', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-10T00:00:00.000Z' },
      ],
    }], [], {});
    expect(list.map((i) => i.id)).toEqual(['V2', 'V1']); // mais recente primeiro
    expect(list.find((i) => i.id === 'V2').kind).toBe('create');
    expect(list.find((i) => i.id === 'V1').kind).toBe('save');
    expect(list.find((i) => i.id === 'V1').title).toBe('Visita · Acme · 15/10/2026');
  });

  it('inclui outbox (com tentativas) sem duplicar e exclusões pendentes', () => {
    const list = buildPendingList(
      [{ table: 'pendencias', dbKey: 'intra_pendencias', lastSyncAt: SYNC, records: [{ id: 'P1', assunto: 'Backup', updatedAt: '2026-10-15T13:00:00.000Z' }] }],
      [{ entity: 'pendencias', targetId: 'P1', payload: { assunto: 'Backup', updatedAt: '2026-10-15T13:00:00.000Z' }, createdAt: '2026-10-15T13:00:01.000Z', attempts: 2 }],
      { intra_pendencias: { P9: '2026-10-15T12:30:00.000Z' } }
    );
    expect(list).toHaveLength(2);
    expect(list.find((i) => i.id === 'P1').attempts).toBe(2);
    expect(list.find((i) => i.id === 'P9').kind).toBe('delete');
  });

  it('sem sync anterior, tudo que existe só aqui está pendente', () => {
    const list = buildPendingList([{ table: 'clients', dbKey: 'intra_clients', lastSyncAt: null, records: [{ id: 'C1', name: 'Novo' }] }], [], {});
    expect(list.map((i) => i.title)).toEqual(['Novo']);
  });

  it('nada pendente = lista vazia', () => {
    expect(buildPendingList([{ table: 'clients', dbKey: 'k', lastSyncAt: SYNC, records: [{ id: 'C', updatedAt: '2026-10-01T00:00:00.000Z' }] }], [], {})).toEqual([]);
  });
});
