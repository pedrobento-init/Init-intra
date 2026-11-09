import { createRequire as _req } from 'node:module';
const { storageSource } = _req(import.meta.url)('./_storage.cjs');
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

// ── Relatório mensal de visitas (Excel/CSV): novas colunas, resumo por
// técnico e horários reais. Mesmo carregamento em escopo global de
// csv-export.test.js (storage.js + ui.js + visitas.js com DOM mockado).

function _anyEl() {
  return new Proxy(function () {}, {
    get: (_t, p) => {
      if (p === Symbol.toPrimitive) return () => '';
      if (p === 'then') return undefined;
      if (p === 'style' || p === 'dataset') return {};
      if (p === 'classList') { return { add() {}, remove() {}, toggle() {}, contains: () => false }; }
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
  _pendingSyncCount: 0,
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

const _quietErr = console.error;
console.error = () => {};
try {
  vm.runInThisContext(storageSource(), { filename: 'storage.js' });
  vm.runInThisContext(fs.readFileSync('js/ui.js', 'utf8'), { filename: 'ui.js' });
  vm.runInThisContext(fs.readFileSync('js/visitas.js', 'utf8'), { filename: 'visitas.js' });
} finally {
  console.error = _quietErr;
}
console.debug = () => {};
console.warn = () => {};

const VISITS = [
  { id: 'V1', clientId: 'C1', clientName: 'Acme', operator: 'Ana', date: '2026-10-05', time: '09:00', timeEnd: '11:00', status: 'concluida',
    motivo: 'Servidor', relatorio: 'Troca do SSD', observacoes: 'Portaria B',
    checkinAt: '2026-10-05T09:07:00', checkoutAt: '2026-10-05T11:24:00',
    milvusChamadoCodigo: 501, assinaturaNome: 'Maria Silva', assinaturaEm: '2026-10-05T11:25:00' },
  { id: 'V2', clientId: 'C2', clientName: 'Beta', operator: 'Beto', date: '2026-10-06', time: '14:00', timeEnd: '15:00', status: 'agendada', motivo: 'Rede' },
  { id: 'V3', clientId: 'C1', clientName: 'Acme', operator: 'Ana', date: '2026-10-08', time: '08:00', timeEnd: '09:00', status: 'concluida', motivo: 'Preventiva' },
  { id: 'V4', clientId: 'C1', clientName: 'Acme', operator: 'Ana', date: '2026-09-30', time: '08:00', timeEnd: '09:00', status: 'concluida', motivo: 'Fora do mês' },
];

// ISO sem 'Z' é lido/escrito no fuso local: o 'HH:MM' sai igual em qualquer TZ.
_setGlobal('getMyVisits', () => VISITS);
_setGlobal('isTeamAdmin', () => false);
_setGlobal('getCurrentTeam', () => 'init');
_setGlobal('getUser', () => ({ name: 'Ana' }));

describe('_visitReportCollect', () => {
  it('filtra o mês, ordena e agrega por técnico com duração real quando há', () => {
    const data = _visitReportCollect('2026-10');
    expect(data.visits.map((v) => v.id)).toEqual(['V1', 'V2', 'V3']);
    // Ana: V1 vale 2h17 (real 09:07→11:24) + V3 1h prevista = 197min; Beto: 1h prevista.
    expect(data.operators.map((o) => [o.operator, o.count, o.concluidas, o.minutes])).toEqual([
      ['Ana', 2, 2, 197],
      ['Beto', 1, 0, 60],
    ]);
    expect([...data.operators[0].clients]).toEqual(['Acme']);
    expect(data.operators[1].clients.has('Beta')).toBe(true);
  });
});

describe('_exportVisitMonthCsv', () => {
  it('inclui horários reais, chamado, assinatura e seção por técnico', async () => {
    const _create = URL.createObjectURL;
    const _revoke = URL.revokeObjectURL;
    let captured = null;
    URL.createObjectURL = (blob) => {
      captured = blob;
      return 'blob:fake';
    };
    URL.revokeObjectURL = () => {};
    try {
      _exportVisitMonthCsv(_visitReportCollect('2026-10'));
      expect(captured).toBeTruthy();
      const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(new Uint8Array(await captured.arrayBuffer()));
      expect(text.charCodeAt(0)).toBe(0xfeff);
      const body = text.slice(1);
      expect(body).toContain('Chegada real;Saída real;Duração real');
      expect(body).toContain('Observações prévias');
      expect(body).toContain('09:07');
      expect(body).toContain('11:24');
      expect(body).toContain('2h 17min');
      expect(body).toContain('Portaria B');
      expect(body).toContain('501'); // chamado
      expect(body).toContain('Maria Silva (11:25)'); // assinatura + horário
      expect(body).toContain('OPERADOR');
      expect(body).toContain('OPERADOR;Ana;2;2;3h 17min;Acme');
      expect(body).toContain('OPERADOR;Beto;1;0;1h;Beta');
    } finally {
      URL.createObjectURL = _create;
      URL.revokeObjectURL = _revoke;
    }
  });
});
