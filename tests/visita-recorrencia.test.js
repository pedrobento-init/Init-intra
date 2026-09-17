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

// ── Camada fake do db.js (o "disco" — sobrevive a reload/offline) ─────────
const _stores = { clients: [], pendencias: [], visits: [] };
_setGlobal('getCacheStore', (name) => _stores[name] || []);
_setGlobal('setCacheStore', (name, items) => { _stores[name] = Array.isArray(items) ? [...items] : items; });
_setGlobal('getCacheKV', (_k, d) => d);
_setGlobal('getCacheTable', (t) =>
  t === 'sessions'
    ? { key: 'intra_session', value: { opId: 'OP-1', name: 'Teste', team: 'init' } }
    : {}
);
_setGlobal('setCacheTable', () => {});

// ── Carrega o código REAL (storage.js + ui.js) no escopo global ────────────
const _quietErr = console.error;
console.error = () => {};
try {
  vm.runInThisContext(fs.readFileSync('js/storage.js', 'utf8'), { filename: 'storage.js' });
  vm.runInThisContext(fs.readFileSync('js/ui.js', 'utf8'), { filename: 'ui.js' });
} finally {
  console.error = _quietErr;
}
console.debug = () => {};
console.warn = () => {};

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const schema = require('../js/schema.js');
const { _mergeRecords, _classifyLocalOnly, _retainFailedPush } = schema;

const VISITS = 'intra_visits';
const PENDENCIAS = 'intra_pendencias';
const FIELDS_V = { id: 'id', updated_at: 'updatedAt', created_at: 'createdAt' };

function seedClient() {
  _stores.clients = [{ id: 'CLI-1', name: 'Cliente X', team: 'init' }];
}
function createVisit(date, recurrence = 'weekly') {
  // mesmo objeto que submitVisitForm monta (id nulo = criação)
  saveVisit({
    id: null, clientId: 'CLI-1', clientName: 'Cliente X', operator: 'Op',
    date, time: '09:00', timeEnd: '10:00', motivo: 'Preventiva',
    observacoes: '', relatorio: '', status: 'agendada', recurrence,
  });
  return getVisits().find((v) => v.date === date && v.motivo === 'Preventiva');
}
// Padrão CORRIGIDO dos callers (cópia destacada — visitas.js pós-fix).
function concludeVisitCopy(id, relatorio = 'Feito') {
  const v = getVisitById(id);
  saveVisit({ ...v, relatorio, status: 'concluida' });
}
// Padrão ANTIGO (mutação do cache vivo — submitConcludeVisit pré-fix).
function concludeVisitMutating(id) {
  const v = getVisitById(id);
  v.relatorio = 'Feito';
  v.status = 'concluida';
  saveVisit(v);
}

beforeEach(() => {
  _stores.clients = [];
  _stores.pendencias = [];
  _stores.visits = [];
  for (const k of Object.keys(_ls)) delete _ls[k];
  globalThis.navigator.onLine = true;
  seedClient();
  vi.restoreAllMocks();
  console.debug = () => {};
  console.warn = () => {};
});

describe('causa raiz: mutar o cache vivo cega a transição', () => {
  it('padrão antigo (mutação + save) NÃO gera a próxima ocorrência', () => {
    const v = createVisit('2026-09-15');
    concludeVisitMutating(v.id);
    expect(getVisits()).toHaveLength(1);
  });
  it('padrão corrigido (cópia + save) gera a ocorrência +7 dias', () => {
    const v = createVisit('2026-09-15');
    concludeVisitCopy(v.id);
    const all = getVisits();
    expect(all).toHaveLength(2);
    const child = all.find((x) => x.id !== v.id);
    expect(child.date).toBe('2026-09-22');
    expect(child.status).toBe('agendada');
    expect(child.recurrence).toBe('weekly');
    expect(child.relatorio || '').toBe('');
  });
});

describe('TESTE 1 — cadeia semanal +7/+14/+21 (real nextRecurrenceDate)', () => {
  it('conclusões em cadeia geram 22/09, 29/09 e 06/10', () => {
    const v0 = createVisit('2026-09-15');
    concludeVisitCopy(v0.id);
    const v1 = getVisits().find((x) => x.date === '2026-09-22');
    concludeVisitCopy(v1.id);
    const v2 = getVisits().find((x) => x.date === '2026-09-29');
    concludeVisitCopy(v2.id);
    const dates = getVisits().map((x) => x.date).sort();
    expect(dates).toEqual(['2026-09-15', '2026-09-22', '2026-09-29', '2026-10-06']);
  });
  it('quinzenal avança 14 dias exatos', () => {
    expect(nextRecurrenceDate('2026-09-15', 'weekly')).toBe('2026-09-22');
    expect(nextRecurrenceDate('2026-09-15', 'biweekly')).toBe('2026-09-29');
    expect(nextRecurrenceDate('2026-09-15', '')).toBe(null);
  });
});

describe('TESTE 6/7 — virada de mês e de ano', () => {
  it('29/09 semanal → 06/10 (outubro)', () => {
    expect(nextRecurrenceDate('2026-09-29', 'weekly')).toBe('2026-10-06');
  });
  it('30/12/2025 semanal → 06/01/2026 (ano seguinte)', () => {
    expect(nextRecurrenceDate('2025-12-30', 'weekly')).toBe('2026-01-06');
  });
  it('cadeia real atravessa o ano sem erro', () => {
    const v0 = createVisit('2025-12-30');
    concludeVisitCopy(v0.id);
    expect(getVisits().map((x) => x.date).sort()).toEqual(['2025-12-30', '2026-01-06']);
  });
});

describe('TESTE 8 — gerador não duplica ocorrência existente', () => {
  it('concluir 2× gera só 1 ocorrência', () => {
    const v = createVisit('2026-09-15');
    concludeVisitCopy(v.id);
    concludeVisitCopy(v.id); // status já concluída → sem transição → sem filho
    expect(getVisits()).toHaveLength(2);
  });
  it('re-concluir após reabrir (retry) não duplica', () => {
    const v = createVisit('2026-09-15');
    concludeVisitCopy(v.id);
    // simula "concluir de novo" (ex.: retry offline): volta p/ agendada e conclui
    saveVisit({ ...getVisitById(v.id), status: 'agendada' });
    concludeVisitCopy(v.id);
    const on22 = getVisits().filter((x) => x.date === '2026-09-22');
    expect(on22).toHaveLength(1);
  });
});

describe('TESTE 2/3 — reload e offline preservam visita + recorrência', () => {
  it('offline: criação + conclusão geram ocorrência localmente', () => {
    globalThis.navigator.onLine = false;
    const v = createVisit('2026-09-15');
    concludeVisitCopy(v.id);
    expect(getVisits()).toHaveLength(2);
    expect(getVisitById(v.id).recurrence).toBe('weekly');
  });
  it('reload: configuração e ocorrências continuam no store', () => {
    const v = createVisit('2026-09-15');
    concludeVisitCopy(v.id);
    // "reload" = relê do mesmo store persistente
    const reloaded = getVisits();
    expect(reloaded).toHaveLength(2);
    expect(reloaded.find((x) => x.id === v.id).recurrence).toBe('weekly');
    expect(reloaded.filter((x) => x.recurrence === 'weekly')).toHaveLength(2);
  });
});

describe('TESTE 4/5 — sincronização não perde nem duplica (schema real)', () => {
  it('ocorrência criada offline é classificada p/ push (não descartada)', () => {
    const cls = _classifyLocalOnly(
      [{ id: 'VIS-new', createdAt: '2026-09-22T10:00:00.000Z', updatedAt: '2026-09-22T10:00:00.000Z' }],
      '2026-09-20T10:00:00.000Z'
    );
    expect(cls.toPush.map((r) => r.id)).toEqual(['VIS-new']);
    expect(cls.toDrop).toEqual([]);
  });
  it('push falhou no meio → _retainFailedPush preserva p/ retry', () => {
    const loc = { id: 'VIS-new', updatedAt: '2026-09-22T10:00:00.000Z' };
    const { merged } = _mergeRecords([loc], [], FIELDS_V);
    expect(merged).toEqual([]);
    expect(_retainFailedPush(merged, [loc]).map((r) => r.id)).toEqual(['VIS-new']);
  });
  it('merge nunca duplica id presente dos dois lados', () => {
    const loc = { id: 'VIS-1', updatedAt: '2026-09-22T10:00:00.000Z' };
    const rem = { id: 'VIS-1', updated_at: '2026-09-21T10:00:00.000Z' };
    const { merged } = _mergeRecords([loc], [rem], FIELDS_V);
    expect(merged.filter((r) => r.id === 'VIS-1')).toHaveLength(1);
  });
});

describe('edição e exclusão preservadas', () => {
  it('editar ocorrência mantém recorrência; concluir depois gera a próxima', () => {
    const v = createVisit('2026-09-15');
    concludeVisitCopy(v.id);
    const child = getVisits().find((x) => x.date === '2026-09-22');
    saveVisit({ ...child, motivo: 'Preventiva (ajustada)' });
    expect(getVisitById(child.id).recurrence).toBe('weekly');
    concludeVisitCopy(child.id);
    // chave inclui motivo editado → próxima data usa o motivo atual
    expect(getVisits().map((x) => x.date).sort()).toEqual(['2026-09-15', '2026-09-22', '2026-09-29']);
  });
  it('ocorrência excluída não volta ao concluir de novo', () => {
    const v = createVisit('2026-09-15');
    concludeVisitCopy(v.id);
    const child = getVisits().find((x) => x.date === '2026-09-22');
    // exclusão: remove do store + tombstone (padrão deleteVisit)
    _stores.visits = getVisits().filter((x) => x.id !== child.id);
    _addTombstone(VISITS, child.id);
    concludeVisitCopy(v.id); // já concluída → sem transição → sem regen
    expect(getVisits().find((x) => x.date === '2026-09-22')).toBeUndefined();
  });
});

describe('etapa 2 Milvus: marcação de finalização na conclusão (saveVisit real)', () => {
  it('concluir COM codigo marca finalizar pendente; SEM codigo não marca', () => {
    saveVisit({
      id: null, clientId: 'CLI-1', clientName: 'Cliente X', operator: 'Op',
      date: '2026-09-15', motivo: 'M', status: 'agendada', recurrence: '',
      milvusChamadoCodigo: 1234, milvusChamadoStatus: 'criado',
    });
    const withCode = getVisits().find((v) => v.milvusChamadoCodigo === 1234);
    saveVisit({ ...getVisitById(withCode.id), relatorio: 'Ok', status: 'concluida' });
    expect(getVisitById(withCode.id).milvusFinalizarStatus).toBe('pendente');

    saveVisit({
      id: null, clientId: 'CLI-1', clientName: 'Cliente X', operator: 'Op',
      date: '2026-09-16', motivo: 'M2', status: 'agendada', recurrence: '',
    });
    const noCode = getVisits().find((v) => v.motivo === 'M2');
    saveVisit({ ...getVisitById(noCode.id), relatorio: 'Ok', status: 'concluida' });
    expect(getVisitById(noCode.id).milvusFinalizarStatus || null).toBe(null);
  });
  it('visita antiga já concluída não entra sozinha (sem transição nova)', () => {
    _stores.visits = [{
      id: 'OLD-C', clientId: 'CLI-1', status: 'concluida', relatorio: 'Antigo',
      milvusChamadoCodigo: 77, milvusChamadoStatus: 'criado',
      createdAt: '2024-01-01T10:00:00.000Z', updatedAt: '2024-01-01T10:00:00.000Z',
    }];
    saveVisit({ ...getVisitById('OLD-C'), observacoes: 'edit' });
    expect(getVisitById('OLD-C').milvusFinalizarStatus || null).toBe(null);
  });
});

describe('pendências: mesmo padrão de transição', () => {
  function createPen(deadline) {
    savePendencia({
      id: null, clientId: 'CLI-1', clientName: 'Cliente X', assunto: 'Backup',
      descricao: 'Verificar backup', responsible: 'Op', status: 'aberto',
      priority: 'media', deadline, recurrence: 'weekly',
    });
    return getPendencias().find((p) => p.deadline === deadline);
  }
  it('mutação do cache cega; cópia gera +7 dias sem duplicar', () => {
    const p = createPen('2026-09-15');
    const live = getPendenciaById(p.id);
    live.status = 'concluido';
    savePendencia(live);
    expect(getPendencias()).toHaveLength(1);
    // padrão corrigido (cópia)
    const p2 = createPen('2026-09-16');
    savePendencia({ ...getPendenciaById(p2.id), status: 'concluido' });
    const all = getPendencias();
    expect(all).toHaveLength(3);
    expect(all.find((x) => x.deadline === '2026-09-23' && x.assunto === 'Backup')).toBeTruthy();
    // concluir de novo não duplica (guarda por cliente+deadline+assunto)
    savePendencia({ ...getPendenciaById(p2.id), status: 'aberto' });
    savePendencia({ ...getPendenciaById(p2.id), status: 'concluido' });
    expect(getPendencias().filter((x) => x.deadline === '2026-09-23')).toHaveLength(1);
  });
});
