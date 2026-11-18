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

describe('SyncManager — reconectar não entra em recursão (removeChannel dispara CLOSED)', () => {
  // A biblioteca real chama o callback do canal removido com 'CLOSED' de forma
  // síncrona. Com `_channel` ainda apontando para ele, o callback derrubava o
  // canal de novo, que disparava CLOSED de novo, até "Maximum call stack size
  // exceeded": a reconexão quebrava e a tela ficava sem canal vivo.
  function bibliotecaReal() {
    const callbacks = new Map();
    const estado = { criados: 0, removidos: 0, canais: [] };
    const cliente = {
      channel() {
        estado.criados++;
        const ch = {
          on() {
            return ch;
          },
          subscribe(cb) {
            callbacks.set(ch, cb);
            return ch;
          },
        };
        estado.canais.push(ch);
        return ch;
      },
      removeChannel(ch) {
        estado.removidos++;
        const cb = callbacks.get(ch);
        if (cb) cb('CLOSED');
      },
    };
    return { cliente, estado, callbacks };
  }

  it('connect() com canal aberto remove o velho uma vez e deixa um canal novo', () => {
    const original = globalThis.supabaseClient;
    const { cliente, estado } = bibliotecaReal();
    globalThis.supabaseClient = cliente;
    try {
      SyncManager.disconnect();
      SyncManager.connect();
      SyncManager.connect();
      expect(estado.criados).toBe(2);
      // Sem a trava, isto passa de milhares (cada remoção chamava outra).
      expect(estado.removidos).toBeLessThan(5);
    } finally {
      globalThis.supabaseClient = original;
    }
  });

  it('o CLOSED tardio de um canal antigo não derruba o canal novo', () => {
    const original = globalThis.supabaseClient;
    const { cliente, estado, callbacks } = bibliotecaReal();
    globalThis.supabaseClient = cliente;
    try {
      SyncManager.disconnect();
      SyncManager.connect();
      SyncManager.connect();
      const antigo = estado.canais[0];
      callbacks.get(antigo)('CLOSED'); // evento atrasado do canal que já foi trocado
      const vc = (listeners['doc:visibilitychange'] || [])[0];
      vc(); // se o canal novo tivesse sido derrubado, isto abriria um terceiro
      expect(estado.criados).toBe(2);
    } finally {
      globalThis.supabaseClient = original;
    }
  });
});
