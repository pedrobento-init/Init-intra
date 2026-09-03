import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Stubs de browser ANTES de carregar storage.js ────────────────────────────
function makeBanner() {
  const el = { textContent: '', style: { display: 'none' } };
  const classes = new Set();
  Object.defineProperty(el, 'className', {
    get() { return [...classes].join(' '); },
    set(v) { classes.clear(); String(v || '').split(/\s+/).filter(Boolean).forEach((c) => classes.add(c)); },
    configurable: true,
  });
  el.classList = {
    add: (...cs) => cs.forEach((c) => classes.add(c)),
    remove: (...cs) => cs.forEach((c) => classes.delete(c)),
    contains: (c) => classes.has(c),
  };
  el.__classes = classes;
  return el;
}

const bannerEl = makeBanner();
const msgEl = { textContent: '' };
const syncBtnEl = { style: { display: 'none' }, textContent: '', disabled: false };

function _setGlobal(name, value) {
  try {
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  } catch (_) {
    globalThis[name] = value;
  }
}
_setGlobal('window', {
  _pendingSyncCount: 0,
  _syncPending: 0,
  _supabaseAuthActive: false,
  _suppressPendingSync: false,
  addEventListener() {},
});
_setGlobal('navigator', { onLine: true });
_setGlobal('document', {
  getElementById: (id) => {
    if (id === 'offlineBanner') return bannerEl;
    if (id === 'offlineBannerMsg') return msgEl;
    if (id === 'syncNowBtn') return syncBtnEl;
    return null;
  },
  addEventListener() {},
});
_setGlobal('localStorage', {
  getItem: () => null,
  setItem() {},
  removeItem() {},
});
globalThis.Dexie = class {
  constructor() {}
  version() { return { stores() {} }; }
};

// Silencia o erro esperado do initIndexedDB com Dexie fake
const _origError = console.error;
console.error = () => {};
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const storage = require('../js/storage.js');
const gs = require('../js/global-search.js');
console.error = _origError;

const {
  getPendingSyncCount,
  incrementPendingSync,
  resetPendingSyncCount,
  markSyncPushFailed,
  dbSet,
  DB,
} = storage;

function setOnline(v) { globalThis.navigator.onLine = v; }
function setConnected(v) {
  if (v) {
    globalThis.isSupabaseConnected = () => true;
    globalThis.window._supabaseAuthActive = true;
  } else {
    delete globalThis.isSupabaseConnected;
    globalThis.window._supabaseAuthActive = false;
  }
}

beforeEach(() => {
  globalThis.window._pendingSyncCount = 0;
  globalThis.window._syncPending = 0;
  globalThis.window._suppressPendingSync = false;
  bannerEl.className = '';
  msgEl.textContent = '';
  syncBtnEl.style.display = 'none';
  setOnline(true);
  setConnected(false);
});

describe('contador de sync (boot)', () => {
  it('inicia em 0, sem valor recuperado do cache', () => {
    expect(getPendingSyncCount()).toBe(0);
  });
});

describe('contador de sync (incremento por registro)', () => {
  it('incrementa 1 por escrita offline (2 pendências => 2)', () => {
    setOnline(false);
    dbSet(DB.PENDENCIAS, [{ id: 'PEN-1' }]);
    dbSet(DB.PENDENCIAS, [{ id: 'PEN-1' }, { id: 'PEN-2' }]);
    expect(getPendingSyncCount()).toBe(2);
    expect(msgEl.textContent).toBe('2 alterações aguardando sincronizar');
    expect(bannerEl.__classes.has('visible')).toBe(true);
  });

  it('não incrementa quando online e sync bem-sucedida (conectado+autenticado)', () => {
    setOnline(true);
    setConnected(true);
    dbSet(DB.PENDENCIAS, [{ id: 'PEN-1' }]);
    dbSet(DB.CLIENTS, [{ id: 'CLI-1' }]);
    expect(getPendingSyncCount()).toBe(0);
  });
});

describe('contador de sync (entidades não contam)', () => {
  it('N dbSets internos do merge (1 por entidade) não incrementam', () => {
    setOnline(false); // mesmo offline, escrita interna não conta
    globalThis.window._suppressPendingSync = true;
    const entities = ['clients', 'pendencias', 'tickets', 'operators', 'procedures', 'visits', 'reunioes', 'procedure_templates', 'audit_logs'];
    entities.forEach((t, i) => dbSet(DB.PENDENCIAS, [{ id: `X-${t}-${i}` }]));
    globalThis.window._suppressPendingSync = false;
    expect(getPendingSyncCount()).toBe(0);
  });
});

describe('contador de sync (push falhou)', () => {
  it('incrementa quando o push falha com rede online', () => {
    setOnline(true);
    setConnected(true);
    markSyncPushFailed();
    expect(getPendingSyncCount()).toBe(1);
  });

  it('não duplica quando offline (dbSet já contou)', () => {
    setOnline(false);
    dbSet(DB.PENDENCIAS, [{ id: 'PEN-1' }]);
    markSyncPushFailed();
    expect(getPendingSyncCount()).toBe(1);
  });
});

describe('contador de sync (reset)', () => {
  it('zera após sync e esconde o banner (com log de debug)', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    setOnline(false);
    dbSet(DB.PENDENCIAS, [{ id: 'PEN-1' }]);
    dbSet(DB.PENDENCIAS, [{ id: 'PEN-1' }, { id: 'PEN-2' }]);
    expect(getPendingSyncCount()).toBe(2);

    setOnline(true);
    resetPendingSyncCount();

    expect(getPendingSyncCount()).toBe(0);
    expect(bannerEl.__classes.has('visible')).toBe(false);
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('contador resetado de 2 para 0'));
    debugSpy.mockRestore();
  });

  it('sync em background que reseta limpa o banner (fim do "travado em 9")', async () => {
    setOnline(false);
    for (let i = 0; i < 9; i++) incrementPendingSync();
    expect(getPendingSyncCount()).toBe(9);
    expect(msgEl.textContent).toBe('9 alterações aguardando sincronizar');

    setOnline(true);
    globalThis.syncSupabaseToLocal = () => Promise.resolve().then(() => resetPendingSyncCount());
    gs._triggerBackgroundSync('teste:');
    await new Promise((r) => setTimeout(r, 20));

    expect(getPendingSyncCount()).toBe(0);
    expect(bannerEl.__classes.has('visible')).toBe(false);
    delete globalThis.syncSupabaseToLocal;
  });
});
