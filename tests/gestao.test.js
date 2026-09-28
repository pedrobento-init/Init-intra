import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);

function mockQ() {
  const calls = [];
  const q = {};
  for (const m of ['eq', 'in', 'not', 'or', 'order', 'range', 'select']) {
    q[m] = (...args) => { calls.push([m, ...args]); return q; };
  }
  q.calls = calls;
  return q;
}

function setGlobal(name, value) {
  try {
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  } catch (_) { globalThis[name] = value; }
}

const _stores = { clients: [], pendencias: [], operators: [], visits: [] };
let _session = null;

setGlobal('window', { _pendingSyncCount: 0, _syncPending: 0, _supabaseAuthActive: false, _suppressPendingSync: true, addEventListener() {}, location: { hash: '' } });
setGlobal('document', { addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] });
setGlobal('navigator', { onLine: true });
setGlobal('getCacheStore', (name) => _stores[name] || []);
setGlobal('setCacheStore', (name, items) => { _stores[name] = Array.isArray(items) ? [...items] : items; });
setGlobal('getCacheKV', (k, d) => d);
setGlobal('setCacheKV', () => {});
setGlobal('getCacheTable', (t) => (t === 'sessions' && _session ? { key: 's', value: _session } : {}));
setGlobal('setCacheTable', () => {});
setGlobal('getOperatorNames', () => []);
setGlobal('escapeHtml', (s) => String(s));

describe('Gestão — tipo restrito só Felipe e Joarli', () => {
  let storage;
  beforeEach(() => {
    _stores.clients = [];
    _stores.pendencias = [];
    _stores.operators = [
      { id: 'OP-1', name: 'Pedro', team: 'init', isAdmin: true, active: true },
      { id: 'OP-4', name: 'Joarli', team: 'init', isAdmin: true, active: true },
      { id: 'OP-5', name: 'Felipe', team: 'init', isAdmin: true, active: true },
      { id: 'OP-9', name: 'Ana', team: 'init', isAdmin: false, active: true, role: 'Técnico' },
    ];
    _session = null;
    delete require.cache[require.resolve('../js/storage.js')];
    storage = require('../js/storage.js');
    try {
      const src = fs.readFileSync('js/pendencias.js', 'utf8');
      const m = src.match(/const TIPOS = \[(.*?)\];/);
      globalThis.__TIPOS_SRC__ = m ? m[1] : '';
    } catch (_) { globalThis.__TIPOS_SRC__ = ''; }
  });

  it('TIPOS contém Gestão', () => {
    expect(globalThis.__TIPOS_SRC__).toContain('Gestão');
  });

  it('isPendenciaGestao reconhece Gestão/Gestao com/sem acento e ignora outros', () => {
    expect(storage.isPendenciaGestao({ tipo: 'Gestão' })).toBe(true);
    expect(storage.isPendenciaGestao({ tipo: 'Gestao' })).toBe(true);
    expect(storage.isPendenciaGestao({ tipo: '  gestão  ' })).toBe(true);
    expect(storage.isPendenciaGestao({ tipo: 'Projeto' })).toBe(false);
    expect(storage.isPendenciaGestao({})).toBe(false);
    expect(storage.isPendenciaGestao(null)).toBe(false);
  });

  it('isGestaoOperator: flag isGestao/is_gestao ou nome Felipe/Joarli; Pedro não', () => {
    expect(storage.isGestaoOperator({ name: 'Felipe', active: true })).toBe(true);
    expect(storage.isGestaoOperator({ name: 'Joarli Souza', active: true })).toBe(true);
    expect(storage.isGestaoOperator({ name: 'FELIPE ADM', active: true })).toBe(true);
    expect(storage.isGestaoOperator({ name: 'Pedro', active: true })).toBe(false);
    expect(storage.isGestaoOperator({ name: 'Ana', active: true })).toBe(false);
    expect(storage.isGestaoOperator({ name: 'Qualquer', isGestao: true, active: true })).toBe(true);
    expect(storage.isGestaoOperator({ name: 'Qualquer', is_gestao: true, active: true })).toBe(true);
    expect(storage.isGestaoOperator(null)).toBe(false);
  });

  it('applyPendenciaPageFilters exclui Gestão do servidor para não-Gestão', () => {
    const q1 = mockQ();
    storage.applyPendenciaPageFilters(q1, { scope: 'active', team: 'init', adminSeeAll: true, canSeeGestao: false });
    expect(q1.calls.some(([m, a, b]) => m === 'not' && a === 'tipo' && b === 'in')).toBe(true);
    const q2 = mockQ();
    storage.applyPendenciaPageFilters(q2, { scope: 'active', team: 'init', adminSeeAll: true, canSeeGestao: true });
    expect(q2.calls.some(([m, a]) => m === 'not' && a === 'tipo')).toBe(false);
  });

  it('filterGestaoPendencias esconde Gestão de não-Gestão e mostra para Gestão', () => {
    const list = [
      { id: 'PEN-1', tipo: 'Projeto' },
      { id: 'PEN-2', tipo: 'Gestão' },
      { id: 'PEN-3', tipo: 'Gestao' },
    ];
    _session = null;
    expect(storage.filterGestaoPendencias(list).map(p => p.id)).toEqual(['PEN-1']);
    _session = { opId: 'OP-5', name: 'Felipe', team: 'init' };
    expect(storage.filterGestaoPendencias(list).map(p => p.id)).toEqual(['PEN-1', 'PEN-2', 'PEN-3']);
    _session = { opId: 'OP-1', name: 'Pedro', team: 'init' };
    expect(storage.filterGestaoPendencias(list).map(p => p.id)).toEqual(['PEN-1']);
  });

  it('canViewPendencia bloqueia Gestão para Pedro e libera para Joarli', () => {
    _session = { opId: 'OP-1', name: 'Pedro', team: 'init' };
    expect(storage.canViewPendencia({ tipo: 'Gestão' })).toBe(false);
    expect(storage.canViewPendencia({ tipo: 'Projeto' })).toBe(true);
    _session = { opId: 'OP-4', name: 'Joarli', team: 'init' };
    expect(storage.canViewPendencia({ tipo: 'Gestão' })).toBe(true);
  });

  it('getMyPendencias não vaza Gestão para Pedro, mas mostra para Felipe', () => {
    _stores.pendencias = [
      { id: 'PEN-1', tipo: 'Projeto', team: 'init', status: 'aberto' },
      { id: 'PEN-2', tipo: 'Gestão', team: 'init', status: 'aberto' },
    ];
    _session = { opId: 'OP-1', name: 'Pedro', team: 'init', isAdmin: true };
    expect(storage.getMyPendencias().map(p => p.id)).toEqual(['PEN-1']);
    _session = { opId: 'OP-5', name: 'Felipe', team: 'init', isAdmin: true };
    expect(storage.getMyPendencias().map(p => p.id).sort()).toEqual(['PEN-1', 'PEN-2']);
  });

  it('savePendencia bloqueia criar Gestão como Pedro e permite como Felipe', () => {
    _stores.pendencias = [];
    _session = { opId: 'OP-1', name: 'Pedro', team: 'init', isAdmin: true };
    expect(() => storage.savePendencia({ tipo: 'Gestão', assunto: 'x', descricao: 'y', status: 'aberto' })).toThrow(/Apenas Gestão/);
    _session = { opId: 'OP-5', name: 'Felipe', team: 'init', isAdmin: true };
    expect(() => storage.savePendencia({ tipo: 'Gestão', assunto: 'x', descricao: 'y', status: 'aberto' })).not.toThrow();
    expect(_stores.pendencias.length).toBe(1);
  });
});
