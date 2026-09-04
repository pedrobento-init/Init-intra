import { describe, it, expect } from 'vitest';
import {
  _mergeRecords,
  _needsPush,
  TOMBSTONE_TTL_MS,
  _pruneTombstones,
  _filterRemoteByTombstones,
  _classifyLocalOnly,
  _retainFailedPush,
} from '../js/schema.js';

const FIELDS = {
  id: 'id',
  assunto: 'assunto',
  updated_at: 'updatedAt',
  created_at: 'createdAt',
};

const T0 = '2026-09-01T10:00:00.000Z';
const T1 = '2026-09-02T10:00:00.000Z';
const T2 = '2026-09-03T10:00:00.000Z';

describe('C1: criar offline → pull → push (sem perda)', () => {
  it('local-only novo é classificado para push e sobrevive ao merge', () => {
    const loc = { id: 'PEN-off', assunto: 'Criado offline', createdAt: T2, updatedAt: T2 };
    const cls = _classifyLocalOnly([loc], T1);
    expect(cls.toPush.map((r) => r.id)).toEqual(['PEN-off']);
    expect(cls.toDrop).toEqual([]);
    // Após o push, o remoto contém o id → merge mantém 1 cópia (sem duplicar).
    const remoteRow = { id: 'PEN-off', assunto: 'Criado offline', updated_at: T2, created_at: T2 };
    const { merged } = _mergeRecords([loc], [remoteRow], FIELDS);
    expect(merged.filter((r) => r.id === 'PEN-off')).toHaveLength(1);
    expect(_needsPush(loc, undefined)).toBe(true);
  });

  it('sem sync anterior, tudo local-only faz push (primeira sincronização)', () => {
    const loc = { id: 'PEN-seed', assunto: 'Seed', createdAt: T0, updatedAt: T0 };
    const cls = _classifyLocalOnly([loc], null);
    expect(cls.toPush.map((r) => r.id)).toEqual(['PEN-seed']);
  });
});

describe('C1: delete remoto → sincronização local (propagação, sem ressuscitar)', () => {
  it('local antigo sem correspondente remoto é descartado do merged', () => {
    const loc = { id: 'PEN-del', assunto: 'X', createdAt: T0, updatedAt: T0 };
    const cls = _classifyLocalOnly([loc], T1);
    expect(cls.toPush).toEqual([]);
    expect(cls.toDrop.map((r) => r.id)).toEqual(['PEN-del']);
    const { merged } = _mergeRecords([loc], [], FIELDS);
    expect(merged).toEqual([]);
  });
});

describe('C1: conflito de updatedAt (local × remoto)', () => {
  it('local mais novo vence sem contar conflito', () => {
    const loc = { id: 'PEN-c', assunto: 'Local novo', createdAt: T0, updatedAt: T2 };
    const rem = { id: 'PEN-c', assunto: 'Remoto velho', created_at: T0, updated_at: T1 };
    const { merged, conflicts } = _mergeRecords([loc], [rem], FIELDS);
    expect(merged[0].assunto).toBe('Local novo');
    expect(conflicts).toBe(0);
  });

  it('remoto mais novo vence com detalhe de conflito', () => {
    const loc = { id: 'PEN-c', assunto: 'Local velho', createdAt: T0, updatedAt: T0 };
    const rem = { id: 'PEN-c', assunto: 'Remoto novo', created_at: T0, updated_at: T2 };
    const { merged, conflicts, conflictDetails } = _mergeRecords([loc], [rem], FIELDS);
    expect(merged[0].assunto).toBe('Remoto novo');
    expect(conflicts).toBe(1);
    expect(conflictDetails[0].fields.map((f) => f.field)).toContain('assunto');
  });
});

describe('C1: deletado com cópia local + sem duplicação/ressuscitação', () => {
  it('snapshot remoto stale (mais velho que o tombstone) é filtrado', () => {
    const tombs = { 'PEN-x': T2 };
    const stale = [{ id: 'PEN-x', assunto: 'Velho', updated_at: T1 }];
    const { remote, revived } = _filterRemoteByTombstones(stale, tombs, 'updated_at');
    expect(remote).toEqual([]);
    expect(revived).toEqual([]);
  });

  it('remoto recriado após o tombstone revive (limpa tombstone, sem duplicar)', () => {
    const tombs = { 'PEN-x': T1 };
    const fresh = [{ id: 'PEN-x', assunto: 'Recriado', updated_at: T2 }];
    const { remote, revived } = _filterRemoteByTombstones(fresh, tombs, 'updated_at');
    expect(remote).toHaveLength(1);
    expect(revived).toEqual(['PEN-x']);
    const { merged } = _mergeRecords([], remote, FIELDS);
    expect(merged.filter((r) => r.id === 'PEN-x')).toHaveLength(1);
  });

  it('merge nunca duplica id presente dos dois lados', () => {
    const loc = { id: 'PEN-d', assunto: 'L', createdAt: T0, updatedAt: T2 };
    const rem = { id: 'PEN-d', assunto: 'R', created_at: T0, updated_at: T1 };
    const { merged } = _mergeRecords([loc], [rem], FIELDS);
    expect(merged.filter((r) => r.id === 'PEN-d')).toHaveLength(1);
  });
});

describe('C1-fix: push falhou não perde o dado local nem duplica', () => {
  it('merge descarta, mas _retainFailedPush reintegra sem duplicar', () => {
    const loc = { id: 'PEN-off', assunto: 'Criado offline', createdAt: T2, updatedAt: T2 };
    const { merged } = _mergeRecords([loc], [], FIELDS);
    expect(merged).toEqual([]);
    const retained = _retainFailedPush(merged, [loc]);
    expect(retained.filter((r) => r.id === 'PEN-off')).toHaveLength(1);
    const again = _retainFailedPush(retained, [loc]);
    expect(again.filter((r) => r.id === 'PEN-off')).toHaveLength(1);
  });

  it('sem falhas, merged passa intacto (mesma referência, sem cópia)', () => {
    const merged = [{ id: 'A' }];
    expect(_retainFailedPush(merged, [])).toBe(merged);
  });
});

describe('C1: tombstones expiram (TTL)', () => {
  it('prune remove tombstone velho e mantém o fresco', () => {
    const now = new Date(T2).getTime();
    const old = new Date(now - TOMBSTONE_TTL_MS - 1000).toISOString();
    const out = _pruneTombstones({ k: { velho: old, fresco: T2 } }, now, TOMBSTONE_TTL_MS);
    expect(out.k.velho).toBeUndefined();
    expect(out.k.fresco).toBe(T2);
    expect(TOMBSTONE_TTL_MS).toBe(30 * 86400000);
  });
});
