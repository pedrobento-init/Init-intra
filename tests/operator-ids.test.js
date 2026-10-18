import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire as __storageReq } from 'node:module';
const { requireStorage } = __storageReq(import.meta.url)('./_storage.cjs');

// Ambiente mínimo do storage (mesmo padrão dos outros testes de storage).
const _stores = { operators: [], pendencias: [], visits: [], vencimentos: [], time_entries: [] };
globalThis.window = globalThis.window || {};
globalThis.window.addEventListener = globalThis.window.addEventListener || (() => {});
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.getCacheStore = (t) => _stores[t] || [];
globalThis.setCacheStore = (t, v) => { _stores[t] = v; };
globalThis.getCacheKV = () => null;
globalThis.setCacheKV = () => {};
globalThis.getCacheTable = () => null;
globalThis.setCacheTable = () => {};
globalThis.addLog = () => {};
globalThis.Validators = { required: (v) => !!String(v || '').trim(), email: () => true, phone: () => true };

let S;
beforeEach(() => {
  _stores.operators = [
    { id: 'OP-1', name: 'Ana', active: true },
    { id: 'OP-2', name: 'Beto', active: true },
    { id: 'OP-3', name: 'Beto', active: false },
    { id: 'OP-4', name: 'Caio', active: false },
  ];
  S = requireStorage();
});

describe('pessoas por id (049)', () => {
  it('id pelo nome: ativo único ganha; inativo só se for o único; desconhecido é null', () => {
    expect(S.operatorIdByName(' ana ')).toBe('OP-1');
    expect(S.operatorIdByName('Beto')).toBe('OP-2');
    expect(S.operatorIdByName('Caio')).toBe('OP-4');
    expect(S.operatorIdByName('Zé')).toBeNull();
  });

  it('mesma pessoa: compara id quando há; senão nome', () => {
    expect(S.isSameOperator('OP-1', 'Nome velho', 'OP-1', 'Ana')).toBe(true);
    expect(S.isSameOperator('OP-2', 'Ana', 'OP-1', 'Ana')).toBe(false);
    expect(S.isSameOperator(null, 'Ana', 'OP-1', 'Ana')).toBe(true);
    expect(S.isSameOperator(null, '', 'OP-1', '')).toBe(false);
  });

  it('não deixa criar outro operador ativo com o mesmo nome', () => {
    expect(S.validateOperator({ name: 'ANA', active: true })).toContain('Já existe um operador ativo chamado "Ana". Use um nome diferente (ex.: com sobrenome).');
    expect(S.validateOperator({ id: 'OP-1', name: 'Ana', active: true })).toEqual([]); // ela mesma
    expect(S.validateOperator({ name: 'Ana', active: false })).toEqual([]);
  });
});

describe('marcação de campos editados', () => {
  it('marca só o que mudou e acumula entre saves', () => {
    const a = S._withDirtyFields({ id: '1', name: 'X', phone: '1', notes: 'n' }, { id: '1', name: 'X', phone: '2', notes: 'n', updatedAt: 't' });
    expect(a._dirtyFields).toEqual(['phone']);
    const b = S._withDirtyFields(a, { ...a, server: { ip: '1' } });
    expect(b._dirtyFields.sort()).toEqual(['phone', 'server']);
  });
});
