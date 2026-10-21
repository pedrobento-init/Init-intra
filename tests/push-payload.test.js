import { createRequire as __storageReq } from 'node:module';
const { requireStorage, storageSource } = __storageReq(import.meta.url)('./_storage.cjs');
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

// ── P-19 / SYNC-06 / SYNC-07 ────────────────────────────────────────────────
// O payload remoto enviado ao Supabase deve nascer do registro MESCLADO no
// cache, nunca do objeto parcial montado pelo form: caso contrário campos
// ausentes do form (attachments/notes/checklist/numero/milvus_*) subiriam
// como []/null e o pull/realtime espalharia o zeramento para todos os aparelhos.

const D = String.fromCharCode(34);

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
_setGlobal('window', {
  addEventListener() {},
  location: { hash: '' },
  innerWidth: 1280,
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
});
_setGlobal('navigator', { onLine: true, userAgent: 'test' });
_setGlobal(
  'document',
  new Proxy(
    {},
    {
      get: (_t, p) => {
        if (p === 'addEventListener') return () => {};
        if (p === 'querySelectorAll') return () => [];
        if (p === 'getElementById' || p === 'querySelector' || p === 'createElement') return (..._a) => _anyEl();
        if (p === 'head' || p === 'body') return _anyEl();
        if (p === 'visibilityState') return 'visible';
        return undefined;
      },
      set: () => true,
    }
  )
);
const _ls = {};
_setGlobal('localStorage', {
  getItem: (k) => (k in _ls ? _ls[k] : null),
  setItem: (k, v) => {
    _ls[k] = String(v);
  },
  removeItem: (k) => {
    delete _ls[k];
  },
});
globalThis.Dexie = class {
  constructor() {}
  version() {
    return { stores() {} };
  }
};

const _stores = {};
const _kv = {};
_setGlobal('getCacheStore', (name) => _stores[name] || []);
_setGlobal('setCacheStore', (name, items) => {
  _stores[name] = Array.isArray(items) ? items.slice() : items;
});
_setGlobal('getCacheKV', (key, fallback) => (key in _kv ? _kv[key] : fallback));
_setGlobal('setCacheKV', (key, value) => {
  _kv[key] = value;
});
_setGlobal('getCacheTable', (table) =>
  table === 'sessions' ? { key: 'intra_session', value: { opId: 'OP-1', name: 'Teste', team: 'init', role: 'membro' } } : {}
);
_setGlobal('setCacheTable', () => {});
_setGlobal('isSupabaseConnected', () => true);
globalThis.window._supabaseAuthActive = true;

const _pushed = [];
_setGlobal('supabaseClient', {
  from: (table) => ({
    insert: (payload) => {
      _pushed.push({ table, payload, method: 'insert' });
      return {
        then: (cb) => {
          cb({ error: null });
          return { catch: () => ({ finally: () => {} }) };
        },
        catch: () => ({ finally: () => {} }),
      };
    },
    upsert: (payload) => {
      _pushed.push({ table, payload, method: 'upsert' });
      return {
        then: (cb) => {
          cb({ error: null });
          return { catch: () => ({ finally: () => {} }) };
        },
        catch: () => ({ finally: () => {} }),
      };
    },
    select: () => ({
      order: () => ({
        abortSignal: () => ({
          abortSignal: () => ({ data: [], error: null }),
          then: (cb) => {
            cb({ data: [], error: null });
            return { catch: () => {} };
          },
        }),
        then: (cb) => {
          cb({ data: [], error: null });
          return { catch: () => {} };
        },
      }),
    }),
    update: () => ({
      eq: () => ({
        then: (cb) => {
          cb({ error: null });
          return { catch: () => {} };
        },
      }),
    }),
    delete: () => ({
      eq: () => ({
        then: (cb) => {
          cb({ error: null });
          return { catch: () => {} };
        },
      }),
    }),
  }),
});

const _quietErr = console.error;
console.error = () => {};
try {
  vm.runInThisContext(storageSource(), { filename: 'storage.js' });
} finally {
  console.error = _quietErr;
}
console.debug = () => {};
console.warn = () => {};

function _pushOf(table) {
  return _pushed.filter((p) => p.table === table).pop();
}

describe('P-19 — payload remoto da pendência (SYNC-06)', () => {
  beforeEach(() => {
    _pushed.length = 0;
    _stores['pendencias'] = [
      {
        id: 'PEN-1',
        clientId: 'CLI-1',
        clientName: 'ACME',
        tipo: 'suporte',
        assunto: 'Original',
        descricao: 'descrição',
        responsible: 'Maria',
        status: 'em_andamento',
        priority: 'alta',
        deadline: '2026-01-05',
        linkUtil: '',
        team: 'init',
        tags: ['x'],
        recurrence: null,
        notes: [{ id: 'N1', text: 'feed', author: 'Maria', createdAt: '2026-01-01T00:00:00.000Z' }],
        attachments: [{ id: 'A1', name: 'a.png' }],
        checklist: [{ id: 'CK1', done: true }],
        visitId: 'VIS-1',
        reviewedInMeeting: true,
        timerRunning: false,
        timerStartedAt: null,
        timerTotalSeconds: 77,
        timerOperator: null,
        completedAt: '2026-01-02T00:00:00.000Z',
        completedBy: 'Maria',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ];
  });

  it('form parcial não zera attachments/notes/checklist no servidor', () => {
    savePendencia({
      id: 'PEN-1',
      clientId: 'CLI-1',
      clientName: 'ACME',
      tipo: 'suporte',
      assunto: 'Editado pelo form',
      descricao: 'descrição 2',
      responsible: 'Joao',
      status: 'em_andamento',
      priority: 'media',
      deadline: '2026-01-06',
      linkUtil: '',
      tags: [],
      recurrence: null,
    });

    const push = _pushOf('pendencias');
    expect(push).toBeTruthy();
    expect(push.payload.id).toBe('PEN-1');
    expect(push.payload.assunto).toBe('Editado pelo form');
    expect(push.payload.attachments).toHaveLength(1);
    expect(push.payload.notes).toHaveLength(1);
    expect(push.payload.checklist).toHaveLength(1);
    expect(push.payload.visit_id).toBe('VIS-1');
    expect(push.payload.reviewed_in_meeting).toBe(true);
    expect(push.payload.completed_at).toBeTruthy();
    expect(push.payload.completed_by).toBe('Maria');
    expect(push.payload.timer_total_seconds).toBe(77);
    expect(push.payload.team).toBe('init');
  });

  it('o cache local continua completo após a edição (mescla)', () => {
    savePendencia({
      id: 'PEN-1',
      clientId: 'CLI-1',
      clientName: 'ACME',
      tipo: 'suporte',
      assunto: 'Editado pelo form',
      descricao: 'descrição 2',
      responsible: 'Joao',
      status: 'em_andamento',
      priority: 'media',
      deadline: '2026-01-06',
      linkUtil: '',
      tags: [],
      recurrence: null,
    });

    const local = getPendencias().find((p) => p.id === 'PEN-1');
    expect(local.assunto).toBe('Editado pelo form');
    expect(local.attachments).toHaveLength(1);
    expect(local.notes).toHaveLength(1);
    expect(local.checklist).toHaveLength(1);
  });

  it('registro inédito segue subindo defaults (sem exceção)', () => {
    savePendencia({
      id: 'PEN-NOVA',
      clientId: 'CLI-2',
      clientName: 'NOVA',
      tipo: 'suporte',
      assunto: 'Nova pendência',
      descricao: 'x',
      responsible: 'Ana',
      status: 'em_aberto',
      priority: 'baixa',
      deadline: null,
      linkUtil: '',
      tags: [],
      recurrence: null,
    });

    const push = _pushOf('pendencias');
    expect(push).toBeTruthy();
    expect(push.payload.id).toBe('PEN-NOVA');
    expect(push.payload.attachments).toEqual([]);
    expect(push.payload.notes).toEqual([]);
    expect(push.payload.checklist).toEqual([]);
    expect(push.payload.visit_id).toBe(null);
  });
});

describe('P-19 — payload remoto da visita (SYNC-07)', () => {
  beforeEach(() => {
    _pushed.length = 0;
    _stores['visits'] = [
      {
        id: 'VIS-1',
        clientId: 'CLI-1',
        clientName: 'ACME',
        operator: 'Maria',
        date: '2026-02-10',
        time: '09:00',
        timeEnd: '10:00',
        allDay: false,
        motivo: 'Preventiva',
        observacoes: 'obs',
        relatorio: 'rel',
        status: 'agendada',
        recurrence: '',
        team: 'init',
        numero: 42,
        categories: ['infra'],
        checklist: [{ id: 'CK1', done: false }],
        milvusChamadoCodigo: 7,
        milvusChamadoStatus: 'criado',
        milvusChamadoErro: null,
        milvusChamadoTentativas: 2,
        milvusFinalizarStatus: null,
        milvusFinalizarErro: null,
        milvusFinalizarTentativas: 0,
        createdAt: '2026-02-01T00:00:00.000Z',
        updatedAt: '2026-02-01T00:00:00.000Z',
      },
    ];
  });

  it('form parcial não zera numero/categories/checklist/milvus_* no servidor', () => {
    saveVisit({
      id: 'VIS-1',
      clientId: 'CLI-1',
      clientName: 'ACME',
      operator: 'Maria',
      date: '2026-02-10',
      time: '09:30',
      timeEnd: '10:30',
      allDay: false,
      motivo: 'Preventiva editada',
      observacoes: 'obs',
      relatorio: 'rel',
      status: 'agendada',
      recurrence: '',
    });

    const push = _pushOf('visits');
    expect(push).toBeTruthy();
    expect(push.payload.id).toBe('VIS-1');
    expect(push.payload.motivo).toBe('Preventiva editada');
    expect(push.payload.time).toBe('09:30');
    expect(push.payload.numero).toBe(42);
    expect(push.payload.categories).toEqual(['infra']);
    expect(push.payload.checklist).toHaveLength(1);
    expect(push.payload.milvus_chamado_codigo).toBe(7);
    expect(push.payload.milvus_chamado_status).toBe('criado');
    expect(push.payload.milvus_chamado_tentativas).toBe(2);
    expect(push.payload.team).toBe('init');
  });

  it('o cache local continua completo após a edição (mescla)', () => {
    saveVisit({
      id: 'VIS-1',
      clientId: 'CLI-1',
      clientName: 'ACME',
      operator: 'Maria',
      date: '2026-02-10',
      time: '09:30',
      timeEnd: '10:30',
      allDay: false,
      motivo: 'Preventiva editada',
      observacoes: 'obs',
      relatorio: 'rel',
      status: 'agendada',
      recurrence: '',
    });

    const local = getVisits().find((v) => v.id === 'VIS-1');
    expect(local.motivo).toBe('Preventiva editada');
    expect(local.numero).toBe(42);
    expect(local.categories).toEqual(['infra']);
    expect(local.milvusChamadoCodigo).toBe(7);
  });

  it('assinatura do cliente sobe junto com a visita (054)', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    const v = getVisits().find((x) => x.id === 'VIS-1');
    saveVisit({ ...v, status: 'concluida', assinatura: png, assinaturaNome: 'João', assinaturaEm: '2026-02-10T12:00:00.000Z' });

    const push = _pushOf('visits');
    expect(push.payload.assinatura).toBe(png);
    expect(push.payload.assinatura_nome).toBe('João');
    expect(push.payload.assinatura_em).toBe('2026-02-10T12:00:00.000Z');
  });

  it('visita sem assinatura não manda as colunas (banco sem a 054 não quebra)', () => {
    const v = getVisits().find((x) => x.id === 'VIS-1');
    saveVisit({ ...v, motivo: 'x' });
    const push = _pushOf('visits');
    expect('assinatura' in push.payload).toBe(false);
  });

  it('visita inédita sem numero ganha numero novo (sem exceção)', () => {
    saveVisit({
      id: null, // form novo envia id nulo (visitas.js:400)
      clientId: 'CLI-2',
      clientName: 'NOVA',
      operator: 'Ana',
      date: '2026-03-01',
      time: '10:00',
      timeEnd: '11:00',
      allDay: false,
      motivo: 'Nova',
      observacoes: '',
      relatorio: '',
      status: 'agendada',
      recurrence: '',
    });

    const push = _pushOf('visits');
    expect(push).toBeTruthy();
    expect(push.payload.id).toMatch(/^VIS-/);
    expect(push.payload.numero).toBeGreaterThan(0);
    expect(push.payload.categories).toEqual([]);
    expect(push.payload.milvus_chamado_codigo).toBe(null);
  });
});

