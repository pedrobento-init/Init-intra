import { describe, it, expect } from 'vitest';
import {
  ENTITIES,
  SYNC_ENTITIES,
  _mapFromRemote,
  _mapToRemote,
  _mergeRecords,
  _needsPush,
} from '../js/schema.js';

describe('ENTITIES (schema central)', () => {
  it('tem entidades únicas por table e dbKey', () => {
    const tables = ENTITIES.map((e) => e.table);
    const dbKeys = ENTITIES.map((e) => e.dbKey);
    expect(new Set(tables).size).toBe(tables.length);
    expect(new Set(dbKeys).size).toBe(dbKeys.length);
  });

  it('toda entidade de sync tem id e updated_at no mapa de campos', () => {
    for (const e of SYNC_ENTITIES) {
      expect(e.fields, `fields ausentes em ${e.table}`).toBeTruthy();
      expect(e.fields.id).toBe('id');
      expect(e.fields.updated_at).toBe('updatedAt');
      expect(e.fields.created_at).toBe('createdAt');
    }
  });

  it('apenas as tabelas com RLS por equipe têm hasTeam=true', () => {
    const teamScoped = ENTITIES.filter((e) => e.hasTeam).map((e) => e.table).sort();
    expect(teamScoped).toEqual(['clients', 'pendencias', 'reunioes', 'visits']);
  });
});

describe('_mapFromRemote / _mapToRemote', () => {
  const fields = { id: 'id', name: 'name', updated_at: 'updatedAt' };

  it('mapeia remote -> local', () => {
    const out = _mapFromRemote({ id: '1', name: 'X', updated_at: '2024-01-01' }, fields);
    expect(out).toEqual({ id: '1', name: 'X', updatedAt: '2024-01-01' });
  });

  it('mapeia local -> remote com null para campos ausentes', () => {
    const out = _mapToRemote({ id: '1', name: 'X', updatedAt: '2024-01-01' }, fields);
    expect(out).toEqual({ id: '1', name: 'X', updated_at: '2024-01-01' });
    expect(_mapToRemote({ id: '1' }, fields).name).toBeNull();
  });
});

describe('_mergeRecords', () => {
  const fields = { id: 'id', name: 'name', updated_at: 'updatedAt' };

  it('mantém local quando local é mais recente', () => {
    const local = [{ id: '1', name: 'local', updatedAt: '2024-01-02T00:00:00Z' }];
    const remote = [{ id: '1', name: 'remote', updated_at: '2024-01-01T00:00:00Z' }];
    const { merged, conflicts } = _mergeRecords(local, remote, fields);
    expect(merged).toEqual([local[0]]);
    expect(conflicts).toBe(0);
  });

  it('aplica remoto quando remoto é mais recente e reporta conflito', () => {
    const local = [{ id: '1', name: 'local', updatedAt: '2024-01-01T00:00:00Z' }];
    const remote = [{ id: '1', name: 'remote', updated_at: '2024-01-02T00:00:00Z' }];
    const { merged, conflicts, conflictDetails } = _mergeRecords(local, remote, fields);
    expect(merged[0].name).toBe('remote');
    expect(conflicts).toBe(1);
    expect(conflictDetails).toHaveLength(1);
  });

  it('descarta órfãos locais (registro removido no servidor)', () => {
    const local = [{ id: '1', name: 'local', updatedAt: '2024-01-01T00:00:00Z' }];
    const { merged } = _mergeRecords(local, [], fields);
    expect(merged).toEqual([]);
  });

  it('adiciona registros que só existem no remoto', () => {
    const remote = [{ id: '2', name: 'remote', updated_at: '2024-01-01T00:00:00Z' }];
    const { merged } = _mergeRecords([], remote, fields);
    expect(merged).toEqual([{ id: '2', name: 'remote', updatedAt: '2024-01-01T00:00:00Z' }]);
  });
});

describe('_needsPush', () => {
  it('retorna true sem remoto ou quando local é mais recente', () => {
    expect(_needsPush({ updatedAt: '2024-01-01' }, null)).toBe(true);
    expect(_needsPush({ updatedAt: '2024-01-02' }, { updated_at: '2024-01-01' })).toBe(true);
    expect(_needsPush({ updatedAt: '2024-01-01' }, { updated_at: '2024-01-02' })).toBe(false);
  });
});
