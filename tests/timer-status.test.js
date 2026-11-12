import { createRequire as __partsReq } from 'node:module';
const { partsSource } = __partsReq(import.meta.url)('./_parts.cjs');
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

// ── Cronômetro x mudança de status ─────────────────────────────────────────
// Antes, só o botão ⏸ pausava e só o select do detalhe encerrava: arrastar o
// card para Pausado/Resolvido (ou usar o menu ⋯) deixava o cronômetro rodando
// fantasma na coluna nova. A regra agora é única, em timer.js.

const _dummyEl = {
  addEventListener() {}, removeEventListener() {}, style: {},
  classList: { add() {}, remove() {}, toggle() {} },
  querySelector: () => null, querySelectorAll: () => [],
  innerHTML: '',
};
const FECHADOS = ['concluido', 'resolvido', 'cancelado', 'fechado'];

const sandbox = {
  console,
  window: { addEventListener() {}, location: { hash: '#pendencias' } },
  navigator: { onLine: true },
  document: {
    addEventListener() {},
    getElementById: () => _dummyEl,
    querySelector: () => _dummyEl,
    querySelectorAll: () => [],
    createElement: () => ({ ..._dummyEl }),
    body: { classList: { add() {}, remove() {}, toggle() {} }, style: {} },
    head: _dummyEl,
    hidden: false,
  },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  setTimeout: () => 0,
  clearTimeout: () => {},
  setInterval: () => 0,
  clearInterval: () => {},
  timerWidget: () => '',
  isPendenciaClosed: (s) => FECHADOS.includes(s),
  updateBadges: () => {},
  renderPenView: () => {},
  getPendenciaById: () => null,
  savePendencia: () => {},
  getUser: () => ({ name: 'Ana' }),
  escapeHtml: (s) => String(s ?? ''),
};
sandbox.globalThis = sandbox;
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
const _quietErr = console.error;
console.error = () => {};
try {
  vm.runInContext(fs.readFileSync('js/ui.js', 'utf8'), sandbox, { filename: 'ui.js' });
  vm.runInContext(fs.readFileSync('js/timer.js', 'utf8'), sandbox, { filename: 'timer.js' });
  vm.runInContext(partsSource('pendencias'), sandbox, { filename: 'pendencias.js' });
} finally {
  console.error = _quietErr;
}

const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
const runningPen = (over = {}) => ({
  id: 'PEN-1', status: 'em_andamento', responsible: 'Ana', notes: [],
  timerRunning: true, timerOperator: 'Ana', timerStartedAt: hoursAgo(2), timerTotalSeconds: 3600,
  ...over,
});

// Toasts/saves registrados em memória, mesmo padrão do chamado-desfazer.
let salvos, sessoes, atual;
function instrumentar(pen) {
  salvos = []; sessoes = [];
  atual = { ...pen };
  sandbox.showToast = () => {};
  sandbox.showUndoToast = () => {};
  sandbox.getPendenciaById = () => ({ ...atual });
  sandbox.savePendencia = (next) => { salvos.push(next); Object.assign(atual, next); };
  sandbox.recordTimeSession = (p, secs, opts) => { sessoes.push({ secs, opts }); };
}

describe('timerSessionStopForStatus', () => {
  it('cronômetro parado: nada a fazer, qualquer que seja o status', () => {
    expect(sandbox.timerSessionStopForStatus({ timerRunning: false }, 'pausado')).toBe(null);
    expect(sandbox.timerSessionStopForStatus({ timerRunning: false }, 'resolvido')).toBe(null);
  });

  it('status que não pausa nem fecha (em_andamento, aguardando): null', () => {
    expect(sandbox.timerSessionStopForStatus(runningPen(), 'em_andamento')).toBe(null);
    expect(sandbox.timerSessionStopForStatus(runningPen(), 'aguardando')).toBe(null);
  });

  it('Pausado: para a sessão somando ao total, sem fechar', () => {
    const stop = sandbox.timerSessionStopForStatus(runningPen(), 'pausado');
    expect(stop.closed).toBe(false);
    expect(stop.operator).toBe('Ana');
    // 1h acumulada + ~2h de sessão
    expect(stop.total).toBeGreaterThanOrEqual(3600 + 2 * 3600 - 5);
    expect(stop.total).toBeLessThan(3600 + 2 * 3600 + 60);
  });

  it('Resolvido: encerra (closed) com o mesmo cálculo de tempo', () => {
    const stop = sandbox.timerSessionStopForStatus(runningPen(), 'resolvido');
    expect(stop.closed).toBe(true);
    expect(stop.total).toBeGreaterThanOrEqual(3600 + 2 * 3600 - 5);
  });
});

describe('penMoveTo com cronômetro rodando', () => {
  beforeEach(() => instrumentar(runningPen()));

  it('mover para Pausado pausa o cronômetro e registra a sessão', () => {
    sandbox.penMoveTo('PEN-1', 'pausado');
    const salvo = salvos[0];
    expect(salvo.status).toBe('pausado');
    expect(salvo.timerRunning).toBe(false);
    expect(salvo.timerOperator).toBe(null);
    expect(salvo.timerStartedAt).toBe(null);
    expect(salvo.timerTotalSeconds).toBeGreaterThanOrEqual(3600 + 2 * 3600 - 5);
    expect(sessoes.length).toBe(1);
    expect(sessoes[0].opts.source).toBe('timer');
    expect(sessoes[0].opts.operatorName).toBe('Ana');
    expect(salvo.notes.at(-1).text).toContain('pausado ao mover para Pausado');
  });

  it('mover para Resolvido encerra o cronômetro (sem fantasma)', () => {
    sandbox.penMoveTo('PEN-1', 'resolvido');
    const salvo = salvos[0];
    expect(salvo.status).toBe('resolvido');
    expect(salvo.timerRunning).toBe(false);
    expect(sessoes[0].opts.source).toBe('conclusao');
    expect(salvo.notes.at(-1).text).toContain('parado ao concluir');
  });

  it('mover para Em Andamento não mexe no cronômetro', () => {
    instrumentar(runningPen({ status: 'aberto' }));
    sandbox.penMoveTo('PEN-1', 'em_andamento');
    expect(salvos[0].timerRunning).toBe(true);
    expect(sessoes).toEqual([]);
  });
});
