import { describe, it, expect, vi, beforeEach } from 'vitest';

function _setGlobal(name, value) {
  try {
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  } catch (_) {
    globalThis[name] = value;
  }
}

_setGlobal('window', { _supabaseAuthActive: true, addEventListener() {} });
_setGlobal('navigator', { onLine: true });
_setGlobal('document', { visibilityState: 'visible', addEventListener() {}, getElementById: () => null });

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const mc = require('../js/milvus-chamado.js');

const {
  resolveMilvusChamadoState,
  shouldRetryMilvusChamado,
  extractMilvusCodigo,
  classifyMilvusChamadoResult,
  enqueueMilvusChamado,
  processPendingMilvusChamados,
  retryMilvusChamado,
  finalizeMilvusChamado,
  MILVUS_CHAMADO_MAX_TENTATIVAS,
} = mc;

// ── Mini store local (espelha saveVisit/getVisits o suficiente p/ o teste) ──
let _visits = [];
let invokeCalls = [];
let invokeBehavior = null;

function resetStore() {
  _visits = [];
  invokeCalls = [];
  invokeBehavior = null;
  globalThis.getVisits = () => _visits.slice();
  globalThis.getVisitById = (id) => _visits.find((v) => v.id === id) || null;
  globalThis.saveVisit = (data) => {
    const i = _visits.findIndex((v) => v.id === data.id);
    const now = new Date().toISOString();
    if (i !== -1) _visits[i] = { ..._visits[i], ...data, updatedAt: now };
    else _visits.push({ ...data, updatedAt: now });
    return data;
  };
  globalThis.isSupabaseConnected = () => true;
  globalThis.supabaseClient = {
    functions: {
      invoke: async (fn, opts) => {
        invokeCalls.push({ fn, body: opts && opts.body });
        if (invokeBehavior) return invokeBehavior(opts && opts.body);
        return { data: { success: true, codigo: 123 }, error: null };
      },
    },
  };
}

beforeEach(() => {
  resetStore();
  globalThis.navigator.onLine = true;
  globalThis.window._supabaseAuthActive = true;
  vi.restoreAllMocks();
});

describe('estado de UI (resolveMilvusChamadoState)', () => {
  it('codigo gravado = criado', () => {
    expect(resolveMilvusChamadoState({ milvusChamadoCodigo: 123 }).kind).toBe('criado');
  });
  it('pendente / criando / sem_token / erro', () => {
    expect(resolveMilvusChamadoState({ milvusChamadoStatus: 'pendente' }).kind).toBe('pendente');
    expect(resolveMilvusChamadoState({ milvusChamadoStatus: 'criando' }).kind).toBe('criando');
    expect(resolveMilvusChamadoState({ milvusChamadoStatus: 'sem_token' }).kind).toBe('sem_token');
    const e = resolveMilvusChamadoState({ milvusChamadoStatus: 'erro', milvusChamadoErro: 'HTTP 400' });
    expect(e.kind).toBe('erro');
    expect(e.erro).toBe('HTTP 400');
  });
  it('visita antiga sem campo = nao_aplicavel (sem backfill)', () => {
    expect(resolveMilvusChamadoState({}).kind).toBe('nao_aplicavel');
    expect(resolveMilvusChamadoState(null).kind).toBe('nao_aplicavel');
  });
});

describe('política de retry (shouldRetryMilvusChamado)', () => {
  it('pendente retenta; com codigo não; teto respeitado', () => {
    expect(shouldRetryMilvusChamado({ milvusChamadoStatus: 'pendente', milvusChamadoTentativas: 0 })).toBe(true);
    expect(shouldRetryMilvusChamado({ milvusChamadoStatus: 'pendente', milvusChamadoCodigo: 5 })).toBe(false);
    expect(shouldRetryMilvusChamado({ milvusChamadoStatus: 'pendente', milvusChamadoTentativas: MILVUS_CHAMADO_MAX_TENTATIVAS })).toBe(false);
    expect(shouldRetryMilvusChamado({ milvusChamadoStatus: 'erro' })).toBe(false);
    expect(shouldRetryMilvusChamado({ milvusChamadoStatus: 'sem_token' })).toBe(false);
  });
  it('criando recente espera; criando stale retoma', () => {
    const now = Date.now();
    const fresh = { milvusChamadoStatus: 'criando', updatedAt: new Date(now - 60 * 1000).toISOString() };
    const stale = { milvusChamadoStatus: 'criando', updatedAt: new Date(now - 60 * 60 * 1000).toISOString() };
    expect(shouldRetryMilvusChamado(fresh, now)).toBe(false);
    expect(shouldRetryMilvusChamado(stale, now)).toBe(true);
  });
});

describe('parse do código (extractMilvusCodigo)', () => {
  it('aceita número, texto "123" e objetos', () => {
    expect(extractMilvusCodigo(123)).toBe(123);
    expect(extractMilvusCodigo('123')).toBe(123);
    expect(extractMilvusCodigo('  123  ')).toBe(123);
    expect(extractMilvusCodigo({ codigo: 123 })).toBe(123);
    expect(extractMilvusCodigo('{"codigo":123}')).toBe(123);
  });
  it('rejeita vazio/zero/lixo', () => {
    expect(extractMilvusCodigo(null)).toBe(null);
    expect(extractMilvusCodigo('')).toBe(null);
    expect(extractMilvusCodigo('abc')).toBe(null);
    expect(extractMilvusCodigo(0)).toBe(null);
  });
});

describe('classificação de resultado (classifyMilvusChamadoResult)', () => {
  it('sucesso com código = created (com recovered)', () => {
    expect(classifyMilvusChamadoResult({ data: { success: true, codigo: 123 } }).outcome).toBe('created');
    const r = classifyMilvusChamadoResult({ data: { success: true, codigo: 123, recovered: true } });
    expect(r.outcome).toBe('created');
    expect(r.recovered).toBe(true);
  });
  it('sem token = no-token; validação/token = permanent', () => {
    expect(classifyMilvusChamadoResult({ data: { success: false, code: 'MILVUS_CLIENT_TOKEN_NOT_CONFIGURED' } }).outcome).toBe('no-token');
    expect(classifyMilvusChamadoResult({ data: { success: false, code: 'MILVUS_VALIDATION_ERROR' } }).outcome).toBe('permanent');
    expect(classifyMilvusChamadoResult({ data: { success: false, code: 'MILVUS_INVALID_TOKEN' } }).outcome).toBe('permanent');
  });
  it('erro de invoke / indisponível = transient', () => {
    expect(classifyMilvusChamadoResult(null, new TypeError('Failed to fetch')).outcome).toBe('transient');
    expect(classifyMilvusChamadoResult({ data: { success: false, code: 'MILVUS_UNAVAILABLE' } }).outcome).toBe('transient');
  });
});

describe('A. criar visita online → chamado criado, código salvo', () => {
  it('processa pendente e grava código sem duplicar invoke', async () => {
    _visits.push({ id: 'VIS-1', clientId: 'CLI-1', milvusChamadoStatus: 'pendente', milvusChamadoTentativas: 0 });
    const res = await processPendingMilvusChamados('test');
    expect(res.created).toBe(1);
    expect(invokeCalls).toHaveLength(1);
    expect(invokeCalls[0].fn).toBe('milvus-chamado-create');
    expect(invokeCalls[0].body).toEqual({ visitId: 'VIS-1' });
    const v = globalThis.getVisitById('VIS-1');
    expect(v.milvusChamadoCodigo).toBe(123);
    expect(v.milvusChamadoStatus).toBe('criado');
  });
});

describe('B. criar visita offline → pendente, sem erro', () => {
  it('enqueue offline não chama a Edge e mantém pendente', async () => {
    globalThis.navigator.onLine = false;
    _visits.push({ id: 'VIS-1', clientId: 'CLI-1', milvusChamadoStatus: 'pendente', milvusChamadoTentativas: 0 });
    enqueueMilvusChamado('VIS-1');
    await new Promise((r) => setTimeout(r, 30));
    expect(invokeCalls).toHaveLength(0);
    expect(globalThis.getVisitById('VIS-1').milvusChamadoStatus).toBe('pendente');
  });
});

describe('C. voltar online → pendência processada, código salvo', () => {
  it('processa ao recuperar conectividade', async () => {
    _visits.push({ id: 'VIS-1', clientId: 'CLI-1', milvusChamadoStatus: 'pendente', milvusChamadoTentativas: 0 });
    globalThis.navigator.onLine = true;
    await processPendingMilvusChamados('online');
    expect(globalThis.getVisitById('VIS-1').milvusChamadoCodigo).toBe(123);
  });
});

describe('D. reload antes do sync → visita e pendência persistem', () => {
  it('criando recente não é tocado; criando stale retoma', async () => {
    const now = Date.now();
    _visits.push({ id: 'VIS-fresh', milvusChamadoStatus: 'criando', updatedAt: new Date(now - 30 * 1000).toISOString() });
    await processPendingMilvusChamados('boot');
    expect(invokeCalls).toHaveLength(0);
    _visits.push({ id: 'VIS-stale', milvusChamadoStatus: 'criando', updatedAt: new Date(now - 3600 * 1000).toISOString() });
    await processPendingMilvusChamados('boot');
    expect(invokeCalls).toHaveLength(1);
    expect(globalThis.getVisitById('VIS-stale').milvusChamadoStatus).toBe('criado');
    expect(globalThis.getVisitById('VIS-fresh').milvusChamadoStatus).toBe('criando');
  });
});

describe('E. sync duas vezes → um só chamado', () => {
  it('segunda varredura vê o código e pula', async () => {
    _visits.push({ id: 'VIS-1', milvusChamadoStatus: 'pendente', milvusChamadoTentativas: 0 });
    await processPendingMilvusChamados('run1');
    await processPendingMilvusChamados('run2');
    expect(invokeCalls).toHaveLength(1);
  });
  it('gatilhos concorrentes compartilham a varredura', async () => {
    _visits.push({ id: 'VIS-1', milvusChamadoStatus: 'pendente', milvusChamadoTentativas: 0 });
    const [r1, r2] = await Promise.all([
      processPendingMilvusChamados('a'),
      processPendingMilvusChamados('b'),
    ]);
    expect(r2.reason).toBe('already-running');
    expect(r1.created).toBe(1);
    expect(invokeCalls).toHaveLength(1);
  });
});

describe('F. Milvus indisponível → visita ok, pendente mantida', () => {
  it('500/timeout volta a pendente com tentativa contada', async () => {
    invokeBehavior = () => ({ data: { success: false, code: 'MILVUS_UNAVAILABLE' }, error: null });
    _visits.push({ id: 'VIS-1', milvusChamadoStatus: 'pendente', milvusChamadoTentativas: 0 });
    const res = await processPendingMilvusChamados('test');
    expect(res.ok).toBe(true);
    const v = globalThis.getVisitById('VIS-1');
    expect(v.milvusChamadoStatus).toBe('pendente');
    expect(v.milvusChamadoTentativas).toBe(1);
    expect(v.milvusChamadoErro).toBeTruthy();
    expect(v.milvusChamadoCodigo || null).toBe(null);
  });
});

describe('G. cliente sem cliente_id → sem chamada incorreta', () => {
  it('vira sem_token e não retenta sozinho', async () => {
    invokeBehavior = () => ({ data: { success: false, code: 'MILVUS_CLIENT_TOKEN_NOT_CONFIGURED' }, error: null });
    _visits.push({ id: 'VIS-1', milvusChamadoStatus: 'pendente', milvusChamadoTentativas: 0 });
    await processPendingMilvusChamados('run1');
    const v = globalThis.getVisitById('VIS-1');
    expect(v.milvusChamadoStatus).toBe('sem_token');
    expect(v.milvusChamadoErro).toMatch(/Milvus/i);
    await processPendingMilvusChamados('run2');
    expect(invokeCalls).toHaveLength(1);
  });
  it('retry manual reenfileira', async () => {
    invokeBehavior = () => ({ data: { success: true, codigo: 777 }, error: null });
    _visits.push({ id: 'VIS-1', milvusChamadoStatus: 'erro', milvusChamadoErro: 'x' });
    retryMilvusChamado('VIS-1');
    await new Promise((r) => setTimeout(r, 30));
    expect(globalThis.getVisitById('VIS-1').milvusChamadoCodigo).toBe(777);
  });
});

describe('finalização abstraída (futura)', () => {
  it('não executa — rejeita com mensagem explícita', async () => {
    await expect(finalizeMilvusChamado('VIS-1')).rejects.toThrow(/ainda não implementada/i);
    expect(invokeCalls).toHaveLength(0);
  });
});
