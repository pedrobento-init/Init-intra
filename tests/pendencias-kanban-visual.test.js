import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

// ── Quadro Kanban de Pendências no design system "Meu dia":
// faixa lateral de 4px na cor da coluna + linha-resumo com vencidas ─────────
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
  // penTimerCell chama o timer.js sem guard — stub vazio p/ teste
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
    'globalThis.__t = { penKanbanCard, penStatusSummary, penColColor, penPriColor, _penPagerBar, STATUS_PEN_MAP, PEN_UI_PAGE_SIZE, penClientChipState, togglePenClientChip };',
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

describe('kanban desktop: faixa lateral com a cor da coluna', () => {
  it('em_andamento usa a cor Em andamento (cyan)', () => {
    const html = T.penKanbanCard(basePen({ status: 'em_andamento' }));
    expect(html).toContain('border-left:4px solid var(--kb-cyan)');
  });

  it('aberto usa accent; pausado usa amber', () => {
    expect(T.penKanbanCard(basePen({ status: 'aberto' }))).toContain('border-left:4px solid var(--kb-accent)');
    expect(T.penKanbanCard(basePen({ status: 'pausado' }))).toContain('border-left:4px solid var(--kb-amber)');
  });

  it('status desconhecido cai no cinza neutro (kb-muted)', () => {
    expect(T.penKanbanCard(basePen({ status: 'xpto' }))).toContain('border-left:4px solid var(--kb-muted)');
  });

  it('cores das 5 colunas do quadro (ordem/semântica do protótipo)', () => {
    expect(T.penColColor('aberto')).toBe('var(--kb-accent)');
    expect(T.penColColor('em_andamento')).toBe('var(--kb-cyan)');
    expect(T.penColColor('pausado')).toBe('var(--kb-amber)');
    expect(T.penColColor('aguardando')).toBe('var(--kb-violet)');
    expect(T.penColColor('aguardando_cliente')).toBe('var(--kb-green)');
  });
});

describe('card: avatar, prioridade, prazo e ação Iniciar', () => {
  it('avatar com iniciais do cliente + nome em negrito', () => {
    const html = T.penKanbanCard(basePen({ clientName: 'Galvão e Raça' }));
    expect(html).toContain('class="kc-av"');
    expect(html).toContain('>GR<');
    expect(html).toMatch(/kc-client-name[^>]*>Galvão e Raça/);
  });

  it('pill de prioridade na cor certa (Crítica=red, Baixa=green)', () => {
    expect(T.penKanbanCard(basePen({ priority: 'critica' }))).toContain('--c:var(--kb-red)');
    expect(T.penKanbanCard(basePen({ priority: 'baixa' }))).toContain('--c:var(--kb-green)');
    expect(T.penKanbanCard(basePen({ priority: 'media' }))).toContain('--c:var(--kb-muted)');
  });

  it('prazo vencido mostra alerta + data em vermelho; sem prazo mostra "Sem prazo"', () => {
    const late = T.penKanbanCard(basePen({ deadline: '2020-01-01' }));
    expect(late).toContain('Vencida');
    expect(late).toContain('kc-deadline is-overdue');
    expect(T.penKanbanCard(basePen({ deadline: null }))).toContain('Sem prazo');
  });

  it('sem cronômetro ativo, o rodapé traz o botão "Iniciar"', () => {
    const html = T.penKanbanCard(basePen({ status: 'aberto', timerRunning: false }));
    expect(html).toContain('class="kb-go"');
    expect(html).toContain('Iniciar');
    expect(html).toContain('kb-play');
  });
});

describe('linha-resumo do quadro', () => {
  it('total + colunas + vencidas', () => {
    const html = T.penStatusSummary([
      basePen({ id: 'PEN-1', status: 'aberto', deadline: '2020-01-01' }),
      basePen({ id: 'PEN-2', status: 'em_andamento', deadline: '2099-01-01' }),
    ]);
    expect(html).toContain('<strong>2</strong>&nbsp;pendências ativas');
    expect(html).toContain('<strong>1</strong> aberto');
    expect(html).toContain('<strong>1</strong> em andamento');
    expect(html).toContain('pen-sum-over');
    expect(html).toContain('<strong>1</strong> vencida');
  });

  it('sem pendências o resumo não tem contagem de colunas', () => {
    const html = T.penStatusSummary([]);
    expect(html).toContain('<strong>0</strong>&nbsp;pendências ativas');
    expect(html).toContain('0</strong> vencidas');
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
