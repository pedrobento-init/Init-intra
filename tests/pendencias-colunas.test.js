import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

// ── Sandbox com stubs de browser; ui.js + pendencias.js rodam no MESMO
// contexto VM para que os `const` (STATUS_PEN_MAP etc.) sejam visíveis ──────
const _dummyEl = {
  addEventListener() {}, removeEventListener() {}, style: {},
  classList: { add() {}, remove() {}, toggle() {} },
  querySelector: () => null, querySelectorAll: () => [],
  innerHTML: '',
};
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
    visibilityState: 'visible',
    body: { classList: { add() {}, remove() {}, toggle() {} }, style: {} },
    head: _dummyEl,
  },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  setTimeout: (fn) => 0,
  clearTimeout: () => {},
};
sandbox.globalThis = sandbox;
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
const _quietErr = console.error;
console.error = () => {};
try {
  vm.runInContext(fs.readFileSync('js/ui.js', 'utf8'), sandbox, { filename: 'ui.js' });
  vm.runInContext(fs.readFileSync('js/pendencias.js', 'utf8'), sandbox, { filename: 'pendencias.js' });
  vm.runInContext(
    'globalThis.__t = { penBoardCols, penColVisible, setPenScope, STATUS_PEN_MAP, isPendenciaClosed, PEN_HIDDEN_COLS };',
    sandbox
  );
} finally {
  console.error = _quietErr;
}
const T = sandbox.__t;
// setPenScope() renderiza a página (DOM + storage); aqui basta alternar o
// `penScope` do módulo para exercitar penBoardCols() nos dois escopos.
const setScope = (s) => vm.runInContext(`penScope = '${s}'`, sandbox);

beforeEach(() => {
  setScope('active');
  vi.restoreAllMocks();
});

describe('abas Concluído/Fechado fora da visualização (dados preservados)', () => {
  it('escopo ativo: colunas abertas, sem concluido/fechado', () => {
    setScope('active');
    const ids = T.penBoardCols().map((c) => c.id);
    expect(ids).toContain('aberto');
    expect(ids).toContain('em_andamento');
    expect(ids).not.toContain('concluido');
    expect(ids).not.toContain('fechado');
  });

  it('escopo arquivado: resolvido/cancelado visíveis; concluido/fechado fora', () => {
    setScope('archived');
    const ids = T.penBoardCols().map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['resolvido', 'cancelado']));
    expect(ids).not.toContain('concluido');
    expect(ids).not.toContain('fechado');
  });

  it('penColVisible: só os dois status ocultos', () => {
    expect(T.penColVisible('concluido')).toBe(false);
    expect(T.penColVisible('fechado')).toBe(false);
    expect(T.penColVisible('aberto')).toBe(true);
    expect(T.penColVisible('resolvido')).toBe(true);
    expect(T.penColVisible('cancelado')).toBe(true);
    expect(T.penColVisible({ id: 'concluido' })).toBe(false);
    expect(T.penColVisible({ id: 'aberto' })).toBe(true);
  });

  it('lógica interna intacta: continuam "fechados" p/ sync/escopo', () => {
    expect(T.isPendenciaClosed('concluido')).toBe(true);
    expect(T.isPendenciaClosed('fechado')).toBe(true);
    expect(T.isPendenciaClosed('resolvido')).toBe(true);
    expect(T.isPendenciaClosed('aberto')).toBe(false);
    // removidos das opções (menus/filtros/forms), mas a rede de segurança fica
    expect(T.STATUS_PEN_MAP.concluido).toBeUndefined();
    expect(T.STATUS_PEN_MAP.fechado).toBeUndefined();
    expect(T.STATUS_PEN_MAP.resolvido.label).toBe('Resolvido');
    expect(T.PEN_HIDDEN_COLS).toEqual(['concluido', 'fechado']);
  });
});
