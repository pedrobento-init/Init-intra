import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

// ── Ajustes visuais do print (kanban Pendências): faixa lateral de cor nos
// cards + remoção da barra redundante "N pendências" (página única) ──────────
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
  // penKanbanCard chama timerWidget sem guard — stub vazio p/ teste
  timerWidget: () => '',
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
    'globalThis.__t = { penKanbanCard, _penPagerBar, STATUS_PEN_MAP, PEN_UI_PAGE_SIZE, penClientChipState, togglePenClientChip };',
    sandbox
  );
} finally {
  console.error = _quietErr;
}
const T = sandbox.__t;
const setPager = (serverMode, total, page, rows) =>
  vm.runInContext(
    `_penServerMode = ${serverMode}; _penTotal = ${total}; _penPage = ${page}; _filteredPens = ${rows};`,
    sandbox
  );
const basePen = (over = {}) => Object.assign(
  { id: 'PEN-1', status: 'em_andamento', clientId: 'c1', clientName: 'Acme', priority: 'alta', responsible: 'Felipe', assunto: 'Teste', createdAt: '2026-09-01T10:00:00.000Z' },
  over
);
// togglePenClientChip com select/stubs isolados (restaura tudo ao fim)
const runToggle = (initial, clickId) => vm.runInContext(`
  (function(){
    var calls = { saved: 0, rendered: 0 };
    var sel = { value: '${initial}' };
    var prevGet = document.getElementById;
    var prevSave = (typeof saveFilterState === 'function') ? saveFilterState : undefined;
    var prevRender = (typeof renderPenView === 'function') ? renderPenView : undefined;
    document.getElementById = function(id){
      if (id === 'penClient') return sel;
      return null;
    };
    saveFilterState = function(){ calls.saved++; };
    renderPenView = function(){ calls.rendered++; };
    try {
      togglePenClientChip('${clickId}');
    } finally {
      document.getElementById = prevGet;
      if (prevSave) saveFilterState = prevSave;
      if (prevRender) renderPenView = prevRender;
    }
    return { value: sel.value, calls: calls };
  })()
`, sandbox);

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('kanban desktop: faixa lateral com a cor do status', () => {
  it('em_andamento usa o dot do STATUS_PEN_MAP (#6366f1)', () => {
    const html = T.penKanbanCard(basePen({ status: 'em_andamento' }));
    expect(html).toContain('border-left:3px solid #6366f1');
  });

  it('aberto usa #3b82f6; pausado usa #f59e0b', () => {
    expect(T.penKanbanCard(basePen({ status: 'aberto' }))).toContain('border-left:3px solid #3b82f6');
    expect(T.penKanbanCard(basePen({ status: 'pausado' }))).toContain('border-left:3px solid #f59e0b');
  });

  it('status desconhecido cai no cinza neutro #94a3b8', () => {
    expect(T.penKanbanCard(basePen({ status: 'xpto' }))).toContain('border-left:3px solid #94a3b8');
  });
});

describe('pager página única: barra "N pendências" removida', () => {
  it('fora do modo servidor: vazio', () => {
    setPager(false, null, 0, '[]');
    expect(T._penPagerBar()).toBe('');
  });

  it('modo servidor, 1 página (15 de 50): vazio — total vive no resumo + abas', () => {
    setPager(true, 15, 0, '[]');
    expect(T._penPagerBar()).toBe('');
  });

  it('modo servidor, multi-página: navegação mantida', () => {
    setPager(true, 120, 0, '[]');
    const html = T._penPagerBar();
    expect(html).toContain('Próxima');
    expect(html).toContain('Página 1 de 3');
  });
});

describe('chips de cliente: toggle com estado pressionado', () => {
  it('clica em chip inativo: filtra; clica de novo: volta a todos', () => {
    const r1 = runToggle('', 'c1');
    expect(r1.value).toBe('c1');
    expect(r1.calls.saved).toBe(1);
    expect(r1.calls.rendered).toBe(1);
    expect(runToggle('c1', 'c1').value).toBe('');
  });

  it('troca direto de um cliente para outro', () => {
    expect(runToggle('c1', 'c2').value).toBe('c2');
  });

  it('helper de estado: ativo só quando o chip é o selecionado', () => {
    expect(T.penClientChipState('c1', 'c1')).toContain('is-active');
    expect(T.penClientChipState('c1', 'c2')).toBe('');
    expect(T.penClientChipState('', 'c1')).toBe('');
  });

  it('contrato: chip chama o toggle, tem aria-pressed e CSS de ativo', () => {
    const src = fs.readFileSync('js/pendencias.js', 'utf8');
    expect(src).toContain('togglePenClientChip');
    expect(src).toContain('aria-pressed');
    const css = fs.readFileSync('css/styles.css', 'utf8').replace(/\s+/g, ' ');
    expect(css).toContain('.pen-client-chip.is-active');
  });
});
