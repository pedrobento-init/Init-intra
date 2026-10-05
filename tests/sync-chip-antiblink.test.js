import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function _setGlobal(name, value) {
  try {
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  } catch (_) {
    globalThis[name] = value;
  }
}

// Chip fake: innerHTML instrumentado para contar repinturas (qualquer
// escrita idêntica repetida = piscar) e atributos capturados.
const writes = [];
let inner = '';
const chip = { title: '', setAttribute(n, v) { this['attr_' + n] = v; } };
Object.defineProperty(chip, 'innerHTML', {
  get() { return inner; },
  set(v) { writes.push(String(v)); inner = String(v); },
  configurable: true,
});

const winHandlers = {};
_setGlobal('window', {
  addEventListener(type, cb) { (winHandlers[type] = winHandlers[type] || []).push(cb); },
  removeEventListener(type, cb) {
    const list = winHandlers[type];
    if (!list) return;
    const i = list.indexOf(cb);
    if (i !== -1) list.splice(i, 1);
  },
  dispatchEvent() {},
  _supabaseAuthActive: false,
});
_setGlobal('navigator', { onLine: true });
_setGlobal('document', {
  getElementById: () => null,
  addEventListener() {},
  visibilityState: 'visible',
  // sem o auto-tick de 15s no teste (guarda idêntica à do módulo)
  _syncStatusAutoTick: true,
});
_setGlobal('localStorage', { getItem: () => null, setItem() {}, removeItem() {} });

let pending = 0;
let outboxN = 0;
_setGlobal('getPendingSyncCount', () => pending);
_setGlobal('Outbox', { count: () => Promise.resolve(outboxN) });

const { mountSyncStatus } = require('../js/sync-manager.js');

function fire(type) { (winHandlers[type] || []).forEach((cb) => cb()); }
async function flush() { await new Promise((r) => setTimeout(r, 0)); }

beforeEach(() => {
  writes.length = 0;
  inner = '';
  pending = 0;
  outboxN = 0;
  globalThis.navigator.onLine = true;
});

describe('chip #syncStatus — anti-pisca (mountSyncStatus)', () => {
  it('repinturas com estado igual não escrevem no DOM (dedupe)', async () => {
    const off = mountSyncStatus(chip);
    await flush();
    expect(writes.length).toBe(1); // 1ª pintura: idle+online => 🟡 (0)

    fire('sync:update');
    await flush();
    fire('sync:update');
    await flush();
    expect(writes.length).toBe(1); // mesmo estado => zero escritas novas
    off();
  });

  it('contador legado 0 + outbox >0 pinta uma única vez já em 🟡 (nunca 🟢 antes)', async () => {
    outboxN = 3;
    const off = mountSyncStatus(chip);
    await flush();
    expect(writes.length).toBe(1); // sem o par síncrono+async não há 🟢→🟡
    expect(writes[0]).toContain('🟡');
    expect(writes[0]).toContain('(3)');
    off();
  });

  it('offline pinta 🔴 na hora e online volta a 🟡 imediatamente', async () => {
    globalThis.navigator.onLine = false;
    const off = mountSyncStatus(chip);
    await flush();
    expect(writes.length).toBe(1);
    expect(writes[0]).toContain('🔴');
    expect(chip.attr_dataSync || chip['attr_data-sync']).toBe('offline');

    globalThis.navigator.onLine = true;
    fire('online');
    await flush();
    // transição com offline envolvida é imediata (sem grace)
    expect(writes.length).toBe(2);
    expect(writes[1]).toContain('🟡');
    off();
  });

  it('mudança de contador dentro do mesmo estado repinta (número muda)', async () => {
    outboxN = 2;
    const off = mountSyncStatus(chip);
    await flush();
    expect(writes.length).toBe(1);
    expect(writes[0]).toContain('(2)');

    outboxN = 5;
    fire('sync:update');
    await flush();
    expect(writes.length).toBe(2);
    expect(writes[1]).toContain('(5)');
    off();
  });
});
