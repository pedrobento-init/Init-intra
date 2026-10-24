import { createRequire as __partsReq } from 'node:module';
const { partsSource } = __partsReq(import.meta.url)('./_parts.cjs');
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

// ── Desfazer no quadro de chamados ────────────────────────────────────────
// Mover card e trocar responsável são um gesto só, sem confirmação: o que
// devolve a mão a quem errou é o "Desfazer" do toast, não um diálogo antes.

const _dummyEl = {
  addEventListener() {}, removeEventListener() {}, style: {},
  classList: { add() {}, remove() {}, toggle() {} },
  querySelector: () => null, querySelectorAll: () => [],
  innerHTML: '',
};
const STATUS = {
  aberto: { label: 'Aberto', dot: '#2563eb' },
  em_andamento: { label: 'Em andamento', dot: '#06b6d4' },
  resolvido: { label: 'Resolvido', dot: '#16a34a' },
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
  },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  setTimeout: () => 0,
  clearTimeout: () => {},
  timerWidget: () => '',
  STATUS_PEN_MAP: STATUS,
  isPendenciaClosed: (s) => FECHADOS.includes(s),
  updateBadges: () => {},
  renderPenView: () => {},
  getPendenciaById: () => null,
  savePendencia: () => {},
  updatePendenciaAssignee: () => ({ pen: {} }),
};
sandbox.globalThis = sandbox;
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
const _quietErr = console.error;
console.error = () => {};
try {
  vm.runInContext(fs.readFileSync('js/ui.js', 'utf8'), sandbox, { filename: 'ui.js' });
  vm.runInContext(partsSource('pendencias'), sandbox, { filename: 'pendencias.js' });
} finally {
  console.error = _quietErr;
}

// Toasts viram registro em memória; `desfazer` guarda o callback do botão.
let toasts, undos, salvos;
function instrumentar(pen) {
  toasts = []; undos = []; salvos = [];
  sandbox.showToast = (msg) => toasts.push(msg);
  sandbox.showUndoToast = (msg, onUndo) => undos.push({ msg, onUndo });
  const atual = { ...pen };
  sandbox.getPendenciaById = () => ({ ...atual });
  sandbox.savePendencia = (next) => { salvos.push(next); Object.assign(atual, next); };
  sandbox.updatePendenciaAssignee = (_id, patch) => {
    salvos.push(patch); Object.assign(atual, patch); return { pen: { ...atual } };
  };
  return atual;
}
const basePen = (over = {}) => ({ id: 'PEN-1', status: 'aberto', responsible: 'Ana', ...over });

describe('mover card de coluna', () => {
  beforeEach(() => instrumentar(basePen()));

  it('oferece desfazer em vez de só avisar', () => {
    sandbox.penMoveTo('PEN-1', 'em_andamento');
    expect(undos.length).toBe(1);
    expect(undos[0].msg).toContain('Em Andamento');
    expect(toasts).toEqual([]);
  });

  it('desfazer devolve o card à coluna de origem', () => {
    sandbox.penMoveTo('PEN-1', 'em_andamento');
    undos[0].onUndo();
    expect(salvos.map((s) => s.status)).toEqual(['em_andamento', 'aberto']);
  });

  it('o desfazer não oferece outro desfazer, para não virar vaivém', () => {
    sandbox.penMoveTo('PEN-1', 'em_andamento');
    undos[0].onUndo();
    expect(undos.length).toBe(1);
    expect(toasts.length).toBe(1); // o retorno avisa, mas sem botão
  });

  it('concluir fica de fora: voltar o status não desfaz a recorrência que nasceu', () => {
    sandbox.penMoveTo('PEN-1', 'resolvido');
    expect(undos).toEqual([]);
    expect(toasts[0]).toContain('Resolvido');
  });
});

describe('atribuir responsável pelo menu ⋯', () => {
  beforeEach(() => instrumentar(basePen()));

  it('oferece desfazer com o nome anterior', () => {
    sandbox.penQuickAssign('PEN-1', 'Beto');
    expect(undos.length).toBe(1);
    undos[0].onUndo();
    expect(salvos.map((s) => s.responsible)).toEqual(['Beto', 'Ana']);
  });

  it('sem responsável antes, desfazer devolve o chamado a ninguém', () => {
    instrumentar(basePen({ responsible: '' }));
    sandbox.penQuickAssign('PEN-1', 'Beto');
    undos[0].onUndo();
    expect(salvos[1].responsible).toBe('');
    expect(toasts[0]).toContain('Responsável removido');
  });

  it('erro ao atribuir continua sendo erro, sem botão de desfazer', () => {
    sandbox.updatePendenciaAssignee = () => { throw new Error('Operador afastado.'); };
    sandbox.penQuickAssign('PEN-1', 'Lia');
    expect(undos).toEqual([]);
    expect(toasts).toEqual(['Operador afastado.']);
  });
});
