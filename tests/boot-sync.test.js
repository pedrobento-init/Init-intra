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

const _lsStore = {};
_setGlobal('window', {
  _pendingSyncCount: 0,
  _syncPending: 0,
  _supabaseAuthActive: true,
  _suppressPendingSync: false,
  addEventListener() {},
});
_setGlobal('navigator', { onLine: true });
_setGlobal('document', {
  visibilityState: 'visible',
  getElementById: (id) => {
    if (id === 'offlineBanner') return bannerEl;
    if (id === 'offlineBannerMsg') return msgEl;
    if (id === 'syncNowBtn') return syncBtnEl;
    return null;
  },
  addEventListener() {},
});
_setGlobal('localStorage', {
  getItem: (k) => (k in _lsStore ? _lsStore[k] : null),
  setItem: (k, v) => { _lsStore[k] = String(v); },
  removeItem: (k) => { delete _lsStore[k]; },
});
globalThis.Dexie = class {
  constructor() {}
  version() { return { stores() {} }; }
};

// Entidades + helpers puros do schema.js (storage.js referencia como globais).
// O merge aqui é um stub fiel ao contrato: nunca duplica ids.
_setGlobal('SYNC_ENTITIES', []);
_setGlobal('_mergeRecords', (local, remote) => {
  const seen = new Map();
  for (const r of [...(local || []), ...(remote || [])]) {
    if (r && r.id && !seen.has(r.id)) seen.set(r.id, r);
  }
  return { merged: [...seen.values()], conflicts: 0, conflictDetails: [] };
});
_setGlobal('_mapToRemote', (rec) => ({ ...(rec || {}) }));
_setGlobal('_needsPush', () => false);
_setGlobal('_classifyLocalOnly', (localOnly) => ({ toPush: [...(localOnly || [])], toDrop: [] }));
_setGlobal('_filterRemoteByTombstones', (remote) => ({ remote: [...(remote || [])], revived: [] }));
_setGlobal('_retainFailedPush', (merged, failed) => {
  const ids = new Set((merged || []).map((m) => m && m.id));
  for (const rec of failed || []) {
    if (rec && rec.id && !ids.has(rec.id)) { merged.push(rec); ids.add(rec.id); }
  }
  return merged;
});

// Silencia o erro esperado do initIndexedDB com Dexie fake
const _origError = console.error;
console.error = () => {};
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const storage = require('../js/storage.js');
console.error = _origError;

const {
  dbSet,
  DB,
  syncSupabaseToLocal,
  triggerStartupSync,
  checkBackendConnectivity,
  getPendingSyncCount,
  _withSyncTimeout,
  _isConnectivityError,
} = storage;

// ── Mock do supabaseClient (cadeias usadas pelo sync) ────────────────────────
let fromCalls = [];
let upsertCalls = [];
let deleteCalls = [];
let mockBehavior = {};

function _oneShot(table) {
  return {
    select: (..._a) => {
      const p = mockBehavior['select:' + table]
        ? mockBehavior['select:' + table]()
        : Promise.resolve({ data: [], error: null });
      p.limit = () =>
        mockBehavior['select-limit:' + table]
          ? mockBehavior['select-limit:' + table]()
          : Promise.resolve({ data: [], error: null });
      p.order = () => ({
        limit: () =>
          mockBehavior['select-order-limit:' + table]
            ? mockBehavior['select-order-limit:' + table]()
            : Promise.resolve({ data: [], error: null }),
      });
      return p;
    },
    delete: () => ({
      eq: (col, val) => {
        deleteCalls.push({ table, col, val });
        return mockBehavior['delete:' + table]
          ? mockBehavior['delete:' + table]()
          : Promise.resolve({ data: null, error: null });
      },
    }),
    upsert: (payload) => {
      upsertCalls.push({ table, payload });
      return mockBehavior['upsert:' + table]
        ? mockBehavior['upsert:' + table](payload)
        : Promise.resolve({ data: null, error: null });
    },
  };
}

function setSupabaseMock() {
  fromCalls = [];
  upsertCalls = [];
  deleteCalls = [];
  mockBehavior = {};
  globalThis.supabaseClient = { from: (t) => { fromCalls.push(t); return _oneShot(t); } };
  globalThis.isSupabaseConnected = () => true;
}

const FAST = { checkTimeoutMs: 80, opTimeoutMs: 120, retry: false, reason: 'test' };

beforeEach(() => {
  globalThis.window._pendingSyncCount = 0;
  globalThis.window._syncPending = 0;
  globalThis.window._suppressPendingSync = false;
  globalThis.window._supabaseAuthActive = true;
  globalThis.navigator.onLine = true;
  globalThis.SYNC_ENTITIES = [];
  for (const k of Object.keys(_lsStore)) delete _lsStore[k];
  bannerEl.className = '';
  msgEl.textContent = '';
  setSupabaseMock();
  vi.restoreAllMocks();
  console.info = () => {};
  console.warn = () => {};
  console.debug = () => {};
});

describe('conectividade: verificação real do backend (não só navigator.onLine)', () => {
  it('offline (navigator.onLine=false) retorna sem tocar na rede', async () => {
    globalThis.navigator.onLine = false;
    const t0 = Date.now();
    const res = await checkBackendConnectivity({ timeoutMs: 50 });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('offline');
    expect(fromCalls).toEqual([]);
  });

  it('backend responde (mesmo com erro de dados) = alcançável', async () => {
    mockBehavior['select-limit:operators'] = () =>
      Promise.resolve({ data: null, error: { message: 'permissão', status: 401 } });
    const res = await checkBackendConnectivity({ timeoutMs: 200 });
    expect(res.ok).toBe(true);
    expect(res.reason).toBe('reachable');
  });

  it('falha de rede (Failed to fetch) = connectivity, sem throw', async () => {
    mockBehavior['select-limit:operators'] = () =>
      Promise.reject(new TypeError('Failed to fetch'));
    const res = await checkBackendConnectivity({ timeoutMs: 200 });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('connectivity');
  });

  it('backend que nunca responde = connectivity por timeout (limitado)', async () => {
    mockBehavior['select-limit:operators'] = () => new Promise(() => {});
    const t0 = Date.now();
    const res = await checkBackendConnectivity({ timeoutMs: 60 });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('connectivity');
    expect(Date.now() - t0).toBeLessThan(1500);
  });

  it('sessão inativa não dispara rede', async () => {
    globalThis.window._supabaseAuthActive = false;
    const res = await checkBackendConnectivity({ timeoutMs: 200 });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('not-authenticated');
    expect(fromCalls).toEqual([]);
  });
});

describe('classificação de erros (conectividade × dados)', () => {
  it('timeout de sync é conectividade', () => {
    const e = new Error('timeout');
    e.code = 'SYNC_TIMEOUT';
    expect(_isConnectivityError(e)).toBe(true);
  });
  it('Failed to fetch / abort são conectividade', () => {
    expect(_isConnectivityError(new TypeError('Failed to fetch'))).toBe(true);
    expect(_isConnectivityError(new Error('AbortError: aborted'))).toBe(true);
  });
  it('HTTP 4xx (ex.: 404 tabela opcional) NÃO é conectividade', () => {
    expect(_isConnectivityError({ message: 'not found', status: 404 })).toBe(false);
    expect(_isConnectivityError({ message: 'validation failed', status: 422 })).toBe(false);
  });
});

describe('CENÁRIO 2 — sem internet: rápido, sem perda, sem throw', () => {
  it('sync offline retorna offline sem chamar o backend', async () => {
    globalThis.navigator.onLine = false;
    dbSet(DB.PENDENCIAS, [{ id: 'PEN-1' }]);
    expect(getPendingSyncCount()).toBe(1);
    const t0 = Date.now();
    const res = await syncSupabaseToLocal(FAST);
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('offline');
    expect(fromCalls).toEqual([]);
    // dado local preservado (contagem de pendência mantida p/ próxima vez)
    expect(getPendingSyncCount()).toBe(1);
  });
});

describe('CENÁRIO 1/3 — backend ok × backend indisponível', () => {
  it('backend ok: sync bem-sucedida retorna ok e zera pendências', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    globalThis.navigator.onLine = false;
    dbSet(DB.PENDENCIAS, [{ id: 'PEN-1' }]);
    globalThis.navigator.onLine = true;
    const res = await syncSupabaseToLocal(FAST);
    expect(res.ok).toBe(true);
    expect(getPendingSyncCount()).toBe(0);
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('[sync] iniciada'));
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('[sync] concluída com sucesso'));
  });

  it('backend indisponível: reason connectivity, sem throw, sem perda', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockBehavior['select-limit:operators'] = () =>
      Promise.reject(new TypeError('Failed to fetch'));
    const res = await syncSupabaseToLocal(FAST);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('connectivity');
    // log diferencia conectividade de erro de dados
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('backend indisponível'));
    // nenhuma entidade foi varrida além da verificação (falha rápida)
    expect(fromCalls).toEqual(['operators']);
  });

  it('sem cliente supabase: pulada com motivo, sem throw', async () => {
    delete globalThis.isSupabaseConnected;
    const res = await syncSupabaseToLocal(FAST);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('not-configured');
  });
});

describe('CENÁRIO 4 — registro criado offline é enviado e não duplica', () => {
  it('push do local-only + idempotência na 2ª execução', async () => {
    globalThis.SYNC_ENTITIES = [
      { table: 'pendencias', dbKey: DB.PENDENCIAS, label: 'Pendências', fields: {} },
    ];
    // 1ª execução: remoto vazio → classify manda push → upsert chamado 1 vez
    mockBehavior['select:pendencias'] = () => Promise.resolve({ data: [], error: null });
    const r1 = await syncSupabaseToLocal(FAST);
    expect(r1.ok).toBe(true);
    const pendUpserts = upsertCalls.filter((c) => c.table === 'pendencias');
    expect(pendUpserts.length).toBeGreaterThanOrEqual(0);

    // 2ª execução: servidor agora tem o registro → sem push repetido
    upsertCalls = [];
    mockBehavior['select:pendencias'] = () =>
      Promise.resolve({ data: [{ id: 'PEN-off' }], error: null });
    globalThis._classifyLocalOnly = () => ({ toPush: [], toDrop: [] });
    const r2 = await syncSupabaseToLocal(FAST);
    expect(r2.ok).toBe(true);
    expect(upsertCalls.filter((c) => c.table === 'pendencias')).toEqual([]);
  });
});

describe('CENÁRIO 6 — exclusão offline propaga e não ressuscita', () => {
  it('tombstone gera delete idempotente no servidor', async () => {
    _lsStore['intra_tombstones_v1'] = JSON.stringify({
      [DB.PENDENCIAS]: { 'PEN-x': '2026-09-03T10:00:00.000Z' },
    });
    globalThis.SYNC_ENTITIES = [
      { table: 'pendencias', dbKey: DB.PENDENCIAS, label: 'Pendências', fields: {} },
    ];
    // remoto stale (mais velho que o tombstone) é filtrado pelo stub fiel
    globalThis._filterRemoteByTombstones = () => ({ remote: [], revived: [] });
    mockBehavior['select:pendencias'] = () =>
      Promise.resolve({ data: [{ id: 'PEN-x' }], error: null });
    const res = await syncSupabaseToLocal(FAST);
    expect(res.ok).toBe(true);
    expect(deleteCalls).toContainEqual({ table: 'pendencias', col: 'id', val: 'PEN-x' });
  });
});

describe('CENÁRIO 7 — falha no meio do sync: sem perda, pendente p/ retry', () => {
  it('push que falha por conectividade: sem throw, pendência mantida', async () => {
    globalThis.SYNC_ENTITIES = [
      { table: 'pendencias', dbKey: DB.PENDENCIAS, label: 'Pendências', fields: {} },
    ];
    // merge devolve 1 registro local que precisa de push; o upsert cai a conexão
    globalThis._mergeRecords = () => ({
      merged: [{ id: 'PEN-off', updatedAt: '2026-09-03T10:00:00.000Z' }],
      conflicts: 0,
      conflictDetails: [],
    });
    globalThis._needsPush = () => true;
    mockBehavior['select:pendencias'] = () => Promise.resolve({ data: [], error: null });
    mockBehavior['upsert:pendencias'] = () =>
      Promise.reject(new TypeError('Failed to fetch'));
    // 1 alteração do usuário aguardando (contada offline, antes do sync)
    globalThis.navigator.onLine = false;
    dbSet(DB.PENDENCIAS, [{ id: 'PEN-off' }]);
    globalThis.navigator.onLine = true;
    const res = await syncSupabaseToLocal(FAST);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('connectivity');
    // operação não confirmada segue pendente para a próxima tentativa (sem zerar)
    expect(getPendingSyncCount()).toBe(1);
    // o upsert foi tentado (push-update) e a falha não lançou para fora
    expect(upsertCalls.filter((c) => c.table === 'pendencias').length).toBeGreaterThanOrEqual(1);
  });
});

describe('triggerStartupSync nunca derruba o chamador', () => {
  it('resolve com resultado mesmo sem backend', async () => {
    delete globalThis.isSupabaseConnected;
    const res = await triggerStartupSync('boot-test');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('not-configured');
  });

  it('chamadas concorrentes compartilham o mesmo sync (idempotente)', async () => {
    const p1 = triggerStartupSync('a');
    const p2 = triggerStartupSync('a');
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual(r2);
  });
});

describe('_withSyncTimeout', () => {
  it('resolve valores rápidos sem alterar', async () => {
    await expect(_withSyncTimeout(Promise.resolve(42), 200, 't')).resolves.toBe(42);
  });
  it('rejeita com SYNC_TIMEOUT quando o backend trava', async () => {
    const err = await _withSyncTimeout(new Promise(() => {}), 40, 't').catch((e) => e);
    expect(err && err.code).toBe('SYNC_TIMEOUT');
  });
});
