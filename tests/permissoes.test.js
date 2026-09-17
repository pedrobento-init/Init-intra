import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

// ── Stubs de browser com innerHTML gravável ────────────────────────────────
function mkEl(id) {
  return {
    _id: id, innerHTML: '', textContent: '', value: '', disabled: false,
    style: {}, dataset: {}, children: [], firstChild: null,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, appendChild() {}, remove() {},
    querySelector: () => mkEl(id + ':q'), querySelectorAll: () => [],
    focus() {}, click() {},
  };
}
const _el = {};
function _setGlobal(name, value) {
  try {
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  } catch (_) {
    globalThis[name] = value;
  }
}
_setGlobal('window', { _pendingSyncCount: 0, _syncPending: 0, _supabaseAuthActive: false, _suppressPendingSync: false, addEventListener() {}, location: { hash: '#operadores' } });
_setGlobal('navigator', { onLine: true });
_setGlobal('document', {
  addEventListener() {},
  getElementById: (id) => _el[id] || (_el[id] = mkEl(id)),
  querySelector: () => mkEl('q'),
  querySelectorAll: () => [],
  createElement: () => mkEl('c'),
  head: mkEl('head'), body: mkEl('body'),
  visibilityState: 'visible',
});
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

// ── Código REAL ────────────────────────────────────────────────────────────
const _quietErr = console.error;
console.error = () => {};
try {
  vm.runInThisContext(fs.readFileSync('js/storage.js', 'utf8'), { filename: 'storage.js' });
  vm.runInThisContext(fs.readFileSync('js/ui.js', 'utf8'), { filename: 'ui.js' });
  vm.runInThisContext(fs.readFileSync('js/operadores.js', 'utf8'), { filename: 'operadores.js' });
  vm.runInThisContext(fs.readFileSync('js/clients.js', 'utf8'), { filename: 'clients.js' });
} finally {
  console.error = _quietErr;
}
console.debug = () => {};
console.warn = () => {};

// ── Fake da camada db (o "disco") ──────────────────────────────────────────
const _stores = { clients: [], pendencias: [], visits: [], operators: [] };
const _kv = {};
let _session = null;
_setGlobal('getCacheStore', (name) => _stores[name] || []);
_setGlobal('setCacheStore', (name, items) => { _stores[name] = Array.isArray(items) ? [...items] : items; });
_setGlobal('getCacheKV', (k, d) => (k in _kv ? _kv[k] : d));
_setGlobal('setCacheKV', (k, v) => { _kv[k] = v; });
_setGlobal('getCacheTable', (t) => (t === 'sessions' && _session ? { key: 's', value: _session } : {}));
_setGlobal('setCacheTable', () => {});

const ADMIN = { id: 'OP-1', name: 'Ana Admin', team: 'init', isAdmin: true, active: true };
const TEC_MAM = { id: 'OP-2', name: 'Bob Mam', team: 'mam', isAdmin: false, active: true, role: 'Técnico' };
const TEC_MAM2 = { id: 'OP-3', name: 'Cara Mam', team: 'mam', isAdmin: false, active: true, role: 'Técnico' };

function asAdmin() { _session = { opId: 'OP-1', name: 'Ana Admin', team: 'init', isAdmin: true }; }
function asTec() { _session = { opId: 'OP-2', name: 'Bob Mam', team: 'mam', isAdmin: false }; }

beforeEach(() => {
  for (const k of Object.keys(_el)) delete _el[k];
  for (const k of Object.keys(_ls)) delete _ls[k];
  for (const k of Object.keys(_kv)) delete _kv[k];
  _stores.clients = [{ id: 'CLI-1', name: 'Cliente X', team: 'mam' }];
  _stores.pendencias = [];
  _stores.visits = [];
  _stores.operators = [{ ...ADMIN }, { ...TEC_MAM }, { ...TEC_MAM2 }];
  globalThis.window._pendingSyncCount = 0;
  globalThis.window._syncPending = 0;
  globalThis.navigator.onLine = true;
  vi.restoreAllMocks();
  console.debug = () => {};
  console.warn = () => {};
});

describe('PARTE 1 — aba Operadores carrega para não-admin (só leitura)', () => {
  it('não-admin visualiza a própria equipe, sem ações de admin', () => {
    asTec();
    renderOperadores();
    const html = _el['opGridWrap'].innerHTML;
    expect(html).toContain('Bob Mam');
    expect(html).toContain('Cara Mam');
    expect(html).not.toContain('Ana Admin');
    expect(html).not.toContain('Excluir');
    expect(html).not.toContain('Novo Operador');
    expect(_el['topbarActionBtn'].style.display).toBe('none');
  });

  it('não-admin edita só o próprio perfil (sem travar a grade)', () => {
    asTec();
    renderOperadores();
    const html = _el['opGridWrap'].innerHTML;
    expect(html).toContain('Editar'); // próprio card tem Editar
  });

  it('admin vê todos + ações administrativas', () => {
    asAdmin();
    renderOperadores();
    const html = _el['opGridWrap'].innerHTML;
    expect(html).toContain('Ana Admin');
    expect(html).toContain('Bob Mam');
    expect(html).toContain('Excluir');
  });

  it('registro sem nome não trava a grade no skeleton', () => {
    asAdmin();
    _stores.operators.push({ id: 'OP-X', team: 'init', active: true });
    expect(() => renderOperadores()).not.toThrow();
    expect(_el['opGridWrap'].innerHTML).toContain('op-card');
  });
});

describe('PARTE 2 — exclusão de clientes bloqueada p/ não-admin em todas as camadas', () => {
  it('função: não-admin recebe false, registro intacto, sem tombstone, sem pendência', () => {
    asTec();
    const before = globalThis.window._pendingSyncCount;
    const res = deleteClient('CLI-1');
    expect(res).toBe(false);
    expect(getClientById('CLI-1')).toBeTruthy();
    expect(_ls['intra_tombstones_v1'] || null).toBe(null);
    expect(globalThis.window._pendingSyncCount).toBe(before);
  });

  it('função: não-admin offline também não gera fila', () => {
    asTec();
    globalThis.navigator.onLine = false;
    expect(deleteClient('CLI-1')).toBe(false);
    expect(getClientById('CLI-1')).toBeTruthy();
    expect(globalThis.window._pendingSyncCount).toBe(0);
    expect(_ls['intra_tombstones_v1'] || null).toBe(null);
  });

  it('handler: não-admin nem abre o modal (toast de negação)', () => {
    asTec();
    const toasts = [];
    globalThis.showToast = (m, t) => { toasts.push(String(m)); };
    deleteClientConfirm('CLI-1');
    expect(toasts.join(' ')).toMatch(/administradores/i);
    expect(_el['modalOverlay']).toBe(undefined); // modal nunca aberto
    expect(getClientById('CLI-1')).toBeTruthy();
  });

  it('admin exclui normalmente (com tombstone p/ sync)', () => {
    asAdmin();
    deleteClient('CLI-1');
    expect(getClientById('CLI-1')).toBe(null);
    const tombs = JSON.parse(_ls['intra_tombstones_v1'] || '{}');
    expect(tombs['intra_clients'] && tombs['intra_clients']['CLI-1']).toBeTruthy();
  });
});
