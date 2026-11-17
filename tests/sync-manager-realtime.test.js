// sync-manager-realtime.test.js — cobre os dois furos do canal ao vivo que a
// auditoria registrou e que não dependiam de rede:
//   SYNC-08 — CHANNEL_ERROR/TIMED_OUT/CLOSED com a aba oculta deixava o
//     `_channel` truthy para sempre: o backoff abortava escondido e o
//     `visibilitychange` nunca reconectava.
//   SYNC-11 — `applyRemote` não passava pelo `onMerged` do pull, então um
//     UPDATE remoto sem `numero` (visita) zerava o local pelo realtime.
//
// Os globais são montados ANTES do require porque o módulo registra os
// listeners de `window`/`document` na carga.
import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const listeners = {};
const hook = (scope) => (ev, cb) => {
  (listeners[scope + ev] = listeners[scope + ev] || []).push(cb);
};

let channelCount = 0;
const subscribeCbs = [];
let store = [];
let captured = null;

globalThis.window = {
  addEventListener: hook('win:'),
  dispatchEvent() {},
  _supabaseAuthActive: true,
  _suppressPendingSync: false,
};
globalThis.document = { visibilityState: 'visible', addEventListener: hook('doc:') };
// navigator do Node 22 é getter-only; `typeof navigator` no módulo já basta
// (sem a global, o drain/connect segue o caminho online).

globalThis.isSupabaseConnected = () => true;
globalThis.getCurrentTeam = () => 'init';
globalThis.supabaseClient = {
  channel() {
    channelCount++;
    const ch = {
      on() {
        return ch;
      },
      subscribe(cb) {
        subscribeCbs.push(cb);
        return ch;
      },
    };
    return ch;
  },
  removeChannel() {},
};
globalThis.dbGet = () => store.slice();
globalThis.dbSet = (_key, value) => {
  captured = value;
  store = value;
};
globalThis._tombTimeFor = () => null;
// Mesma proteção do pull (schema.js): remoto sem numero não apaga o local.
globalThis.ENTITIES = [
  {
    table: 'visits',
    dbKey: 'intra_visits',
    hasTeam: false,
    realtime: true,
    mapRow: (r) => ({
      id: r.id,
      numero: Number.isInteger(r.numero) && r.numero > 0 ? r.numero : null,
      updatedAt: r.updated_at,
    }),
    onMerged: (merged, local) => {
      const byId = new Map((local || []).map((o) => [o.id, o]));
      for (const m of merged || []) {
        if (!m || (m.numero !== null && m.numero !== undefined)) continue;
        const loc = m.id ? byId.get(m.id) : null;
        const n = loc ? Number(loc.numero) : NaN;
        if (Number.isInteger(n) && n > 0) m.numero = n;
      }
      return merged;
    },
  },
];

const syncMgr = require('../js/sync-manager.js');
const { SyncManager } = syncMgr;

describe('SyncManager — canal morto com a aba oculta (SYNC-08)', () => {
  beforeEach(() => {
    // Listeners registrados na carga do módulo não podem ser apagados aqui.
    channelCount = 0;
    subscribeCbs.length = 0;
  });

  it('erro do canal solta a referência e a aba reconecta ao voltar a ficar visível', () => {
    SyncManager.connect();
    expect(channelCount).toBe(1);
    document.visibilityState = 'hidden';
    subscribeCbs[0]('CHANNEL_ERROR');
    document.visibilityState = 'visible';
    const vc = (listeners['doc:visibilitychange'] || [])[0];
    expect(typeof vc).toBe('function');
    vc();
    expect(channelCount).toBe(2);
  });
});

describe('SyncManager — applyRemote e o onMerged do pull (SYNC-11)', () => {
  beforeEach(() => {
    store = [{ id: 'V1', numero: 7, updatedAt: '2026-01-01T00:00:00.000Z' }];
    captured = null;
  });

  it('UPDATE remoto sem numero não zera o numero local pelo realtime', async () => {
    await SyncManager.applyRemote('visits', 'UPDATE', {
      id: 'V1',
      numero: null,
      updated_at: '2026-06-01T00:00:00.000Z',
    });
    expect(captured).not.toBeNull();
    expect(captured[0].numero).toBe(7);
  });

  it('UPDATE remoto com numero entra pelo merge (reparo de outro aparelho)', async () => {
    await SyncManager.applyRemote('visits', 'UPDATE', {
      id: 'V1',
      numero: 9,
      updated_at: '2026-06-01T00:00:00.000Z',
    });
    expect(captured[0].numero).toBe(9);
  });
});
