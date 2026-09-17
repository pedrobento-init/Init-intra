import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

// ── Stubs mínimos de browser ─────────────────────────────────────────────
function _anyEl() {
  return new Proxy(function () {}, {
    get: (_t, p) => {
      if (p === Symbol.toPrimitive) return () => '';
      if (p === 'then') return undefined;
      if (p === 'style' || p === 'dataset') return {};
      if (p === 'classList') return { add() {}, remove() {}, toggle() {}, contains: () => false };
      return (..._a) => _anyEl();
    },
    set: () => true,
    apply: () => _anyEl(),
  });
}
function _setGlobal(name, value) {
  try {
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  } catch (_) {
    globalThis[name] = value;
  }
}
_setGlobal('window', { _pendingSyncCount: 0, _syncPending: 0, _supabaseAuthActive: false, _suppressPendingSync: false, addEventListener() {}, location: { hash: '' } });
_setGlobal('navigator', { onLine: true });
_setGlobal('document', new Proxy({}, {
  get: (_t, p) => {
    if (p === 'addEventListener') return () => {};
    if (p === 'getElementById' || p === 'querySelector' || p === 'createElement') return (..._a) => _anyEl();
    if (p === 'head' || p === 'body') return _anyEl();
    if (p === 'visibilityState') return 'visible';
    return undefined;
  },
  set: () => true,
}));
const _ls = {};
_setGlobal('localStorage', {
  getItem: (k) => (k in _ls ? _ls[k] : null),
  setItem: (k, v) => { _ls[k] = String(v); },
  removeItem: (k) => { delete _ls[k]; },
});
globalThis.Dexie = class {
  constructor() {}
  version() { return { stores() {} }; }
};

// ── Código REAL no escopo global ─────────────────────────────────────────
const _quietErr = console.error;
console.error = () => {};
try {
  vm.runInThisContext(fs.readFileSync('js/storage.js', 'utf8'), { filename: 'storage.js' });
  vm.runInThisContext(fs.readFileSync('js/ui.js', 'utf8'), { filename: 'ui.js' });
  vm.runInThisContext(fs.readFileSync('js/visitas.js', 'utf8'), { filename: 'visitas.js' });
} finally {
  console.error = _quietErr;
}
console.debug = () => {};
console.warn = () => {};

// ── Camada fake do db.js por CIMA (testes controlam o "disco") ────────────
const _stores = { clients: [], pendencias: [], visits: [] };
const _kv = {};
_setGlobal('getCacheStore', (name) => _stores[name] || []);
_setGlobal('setCacheStore', (name, items) => { _stores[name] = Array.isArray(items) ? [...items] : items; });
_setGlobal('getCacheKV', (k, d) => (k in _kv ? _kv[k] : d));
_setGlobal('setCacheKV', (k, v) => { _kv[k] = v; });
_setGlobal('getCacheTable', (t) =>
  t === 'sessions'
    ? { key: 'intra_session', value: { opId: 'OP-1', name: 'Teste', team: 'init' } }
    : {}
);
_setGlobal('setCacheTable', () => {});

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const schema = require('../js/schema.js');

function mkVisit(date, extra) {
  saveVisit({
    id: null, clientId: 'CLI-1', clientName: 'Cliente X', operator: 'Op',
    date, time: '09:00', timeEnd: '10:00', motivo: 'Preventiva',
    observacoes: '', relatorio: '', status: 'agendada', recurrence: '',
    ...(extra || {}),
  });
  const all = getVisits();
  return all[all.length - 1];
}

beforeEach(() => {
  _stores.clients = [{ id: 'CLI-1', name: 'Cliente X', team: 'init' }];
  _stores.pendencias = [];
  _stores.visits = [];
  for (const k of Object.keys(_kv)) delete _kv[k];
  globalThis.navigator.onLine = true;
  vi.restoreAllMocks();
  console.debug = () => {};
  console.warn = () => {};
});

describe('formato (Visita #0001, zeros, além de 9999)', () => {
  it('#0001 com zeros; #10000 sem truncar; sem número = #----', () => {
    expect(formatVisitNumero({ numero: 1 })).toBe('#0001');
    expect(formatVisitNumero({ numero: 42 })).toBe('#0042');
    expect(formatVisitNumero({ numero: 9999 })).toBe('#9999');
    expect(formatVisitNumero({ numero: 10000 })).toBe('#10000');
    expect(formatVisitNumero({})).toBe('#----');
    expect(visitDisplayTitle({ numero: 1 })).toBe('Visita #0001');
  });
});

describe('TESTE 1/2 — primeira e segunda visitas', () => {
  it('#0001 depois #0002, UUIDs distintos preservados', () => {
    const a = mkVisit('2026-09-15');
    const b = mkVisit('2026-09-16');
    expect(a.numero).toBe(1);
    expect(b.numero).toBe(2);
    expect(a.id).not.toBe(b.id);
    expect(visitDisplayTitle(a)).toBe('Visita #0001');
  });
});

describe('TESTE 3 — exclusão não recicla número', () => {
  it('exclui #0002 → próxima é #0003', () => {
    mkVisit('2026-09-15');
    const b = mkVisit('2026-09-16');
    _stores.visits = getVisits().filter((v) => v.id !== b.id);
    const c = mkVisit('2026-09-17');
    expect(c.numero).toBe(3);
  });
});

describe('TESTE 4/5 — reload e offline', () => {
  it('reload mantém os números (persistidos no store)', () => {
    mkVisit('2026-09-15');
    mkVisit('2026-09-16');
    const reloaded = getVisits();
    expect(reloaded.map((v) => v.numero).sort()).toEqual([1, 2]);
  });
  it('offline recebe número imediatamente', () => {
    globalThis.navigator.onLine = false;
    const v = mkVisit('2026-09-15');
    expect(v.numero).toBe(1);
    expect(visitDisplayTitle(v)).toBe('Visita #0001');
  });
});

describe('TESTE 6 — sync mantém o número (schema real)', () => {
  it('merge com o próprio registro remoto preserva numero', () => {
    const v = mkVisit('2026-09-15');
    const fields = schema.ENTITIES.find((e) => e.table === 'visits').fields;
    expect(fields.numero).toBe('numero');
    const remote = [{ id: v.id, numero: 1, updated_at: v.updatedAt, created_at: v.createdAt }];
    const { merged } = schema._mergeRecords([v], remote, fields);
    expect(merged).toHaveLength(1);
    expect(merged[0].numero).toBe(1);
  });
  it('local-only nova é classificada p/ push (não descartada)', () => {
    const cls = schema._classifyLocalOnly(
      [{ id: 'VIS-x', numero: 25, createdAt: '2026-09-22T10:00:00.000Z', updatedAt: '2026-09-22T10:00:00.000Z' }],
      '2026-09-20T10:00:00.000Z'
    );
    expect(cls.toPush.map((r) => r.numero)).toEqual([25]);
  });
});

describe('TESTE 7 — duas criações offline nunca repetem', () => {
  it('números distintos e crescentes', () => {
    globalThis.navigator.onLine = false;
    const a = mkVisit('2026-09-15');
    const b = mkVisit('2026-09-15');
    expect(new Set([a.numero, b.numero]).size).toBe(2);
    expect(b.numero).toBe(a.numero + 1);
  });
});

describe('TESTE 8 — sync de várias sem duplicar numero', () => {
  it('merge de conjuntos convergentes não duplica ids', () => {
    const a = mkVisit('2026-09-15');
    const b = mkVisit('2026-09-16');
    const fields = schema.ENTITIES.find((e) => e.table === 'visits').fields;
    const remote = [a, b].map((v) => ({ id: v.id, numero: v.numero, updated_at: v.updatedAt, created_at: v.createdAt }));
    const { merged } = schema._mergeRecords([a, b], remote, fields);
    expect(merged.map((r) => r.numero).sort()).toEqual([1, 2]);
  });
  it('colisão real (mesmo numero, ids distintos) é reparada deterministicamente', () => {
    _stores.visits = [
      { id: 'A', numero: 2, createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z' },
      { id: 'B', numero: 2, createdAt: '2026-09-02T10:00:00.000Z', updatedAt: '2026-09-02T10:00:00.000Z' },
      { id: 'C', numero: 5, createdAt: '2026-09-03T10:00:00.000Z', updatedAt: '2026-09-03T10:00:00.000Z' },
    ];
    expect(maintainVisitNumeros()).toBeGreaterThan(0);
    const byId = Object.fromEntries(getVisits().map((v) => [v.id, v.numero]));
    expect(byId.A).toBe(2); // mais antiga mantém
    expect(byId.B).toBe(6); // max+1 determinístico
    expect(byId.C).toBe(5);
    expect(maintainVisitNumeros()).toBe(0); // converge: 2ª passada sem mudanças
  });
});

describe('TESTE 9 — recorrência: cada ocorrência com número próprio', () => {
  it('cadeia semanal gera números próprios e crescentes', () => {
    const v0 = mkVisit('2026-09-15', { recurrence: 'weekly' });
    saveVisit({ ...getVisitById(v0.id), relatorio: 'Ok', status: 'concluida' });
    const v1 = getVisits().find((x) => x.date === '2026-09-22');
    saveVisit({ ...getVisitById(v1.id), relatorio: 'Ok', status: 'concluida' });
    const nums = getVisits().map((v) => v.numero).sort((x, y) => x - y);
    expect(nums).toEqual([1, 2, 3]);
    expect(new Set(getVisits().map((v) => v.id)).size).toBe(3);
  });
});

describe('TESTE 10 — visitas antigas ganham número persistente', () => {
  it('backfill determinístico por createdAt; idempotente', () => {
    _stores.visits = [
      { id: 'OLD-c', createdAt: '2024-05-03T10:00:00.000Z', updatedAt: '2024-05-03T10:00:00.000Z' },
      { id: 'OLD-a', createdAt: '2024-05-01T10:00:00.000Z', updatedAt: '2024-05-01T10:00:00.000Z' },
      { id: 'OLD-b', createdAt: '2024-05-02T10:00:00.000Z', updatedAt: '2024-05-02T10:00:00.000Z' },
    ];
    maintainVisitNumeros();
    const byId = Object.fromEntries(getVisits().map((v) => [v.id, v.numero]));
    expect(byId).toEqual({ 'OLD-a': 1, 'OLD-b': 2, 'OLD-c': 3 });
    expect(maintainVisitNumeros()).toBe(0);
    // UUIDs intactos
    expect(getVisits().map((v) => v.id).sort()).toEqual(['OLD-a', 'OLD-b', 'OLD-c']);
  });
  it('edição de visita antiga sem número não quebra; backfill cobre depois', () => {
    _stores.visits = [{ id: 'OLD-1', motivo: 'X', createdAt: '2024-01-01T10:00:00.000Z', updatedAt: '2024-01-01T10:00:00.000Z' }];
    saveVisit({ ...getVisitById('OLD-1'), motivo: 'Y' });
    expect(getVisitById('OLD-1').motivo).toBe('Y');
    maintainVisitNumeros();
    expect(getVisitById('OLD-1').numero).toBe(1);
  });
});

describe('estabilidade: reparo propaga (updatedAt) e merge não zera', () => {
  const visitsEntity = () => schema.ENTITIES.find((e) => e.table === 'visits');
  it('maintain carimba updatedAt junto do numero', () => {
    _stores.visits = [{ id: 'OLD-1', createdAt: '2024-01-01T10:00:00.000Z', updatedAt: '2024-01-01T10:00:00.000Z' }];
    maintainVisitNumeros();
    const v = getVisitById('OLD-1');
    expect(v.numero).toBe(1);
    expect(new Date(v.updatedAt).getTime()).toBeGreaterThan(new Date('2024-01-01T10:00:00.000Z').getTime());
  });
  it('onMerged restaura numero local quando o merge zerou', () => {
    const e = visitsEntity();
    expect(typeof e.onMerged).toBe('function');
    const local = [{ id: 'VIS-1', numero: 7 }];
    const out = e.onMerged([{ id: 'VIS-1', numero: null }], local, []);
    expect(out[0].numero).toBe(7);
  });
  it('onMerged preserva número remoto real (reparo de outro aparelho)', () => {
    const e = visitsEntity();
    const out = e.onMerged([{ id: 'VIS-1', numero: 9 }], [{ id: 'VIS-1', numero: 7 }], []);
    expect(out[0].numero).toBe(9);
  });
  it('ciclo reload+sync: remoto sem coluna (mesmo timestamp) não renumera', () => {
    const fields = visitsEntity().fields;
    const v = mkVisit('2026-09-15'); // numero 1
    // pull remoto SEM numero e com MESMO timestamp (registro intocado):
    // merge genérico prefere o remoto no empate e zeraria o numero…
    const remote = [{ id: v.id, updated_at: v.updatedAt, created_at: v.createdAt }];
    const { merged } = schema._mergeRecords([getVisitById(v.id)], remote, fields);
    expect(merged[0].numero == null).toBe(true); // undefined (coluna ausente) ou null
    // …mas o onMerged da entidade restaura o local antes de persistir:
    const final = visitsEntity().onMerged(merged, [getVisitById(v.id)], remote);
    expect(final[0].numero).toBe(1);
    _stores.visits = final;
    // e o maintain seguinte não tem o que renumerar (fim do loop 7→17→27):
    expect(maintainVisitNumeros()).toBe(0);
    expect(getVisitById(v.id).numero).toBe(1);
  });
});

describe('TESTE 11 — busca por número amigável', () => {
  it('"0001", "#0001" e "visita #0001" encontram; vizinho não', () => {
    const v = mkVisit('2026-09-15');
    expect(visitMatchesNumero(v, '0001')).toBe(true);
    expect(visitMatchesNumero(v, '#0001')).toBe(true);
    expect(visitMatchesNumero(v, 'Visita #0001')).toBe(true);
    expect(visitMatchesNumero(v, '0002')).toBe(false);
    expect(visitMatchesNumero(v, 'preventiva')).toBe(false);
    expect(parseVisitNumeroQuery('abc')).toBe(null);
  });
});
