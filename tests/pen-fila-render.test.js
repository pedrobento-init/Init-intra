import { createRequire as __partsReq } from 'node:module';
const { partsSource } = __partsReq(import.meta.url)('./_parts.cjs');
// ── Smoke test do render da Fila de atendimento (tabela): colunas, uma linha
// por pendência, ordenação clicável e os status ocultos fora da visão ───────
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const _el = () => ({
  innerHTML: '',
  textContent: '',
  style: {},
  dataset: {},
  scrollLeft: 0,
  scrollWidth: 0,
  clientWidth: 0,
  onscroll: null,
  classList: { add() {}, remove() {}, toggle() {} },
  addEventListener() {},
  removeEventListener() {},
  querySelector: () => null,
  querySelectorAll: () => [],
});

// localStorage de verdade (em memória): a visualização e a coluna de
// ordenação ficam no aparelho, e o teste cobre isso.
const store = new Map();
const sandbox = {
  console,
  window: { addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false }) },
  navigator: { onLine: true },
  document: {
    addEventListener() {},
    getElementById: () => _el(),
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => _el(),
    visibilityState: 'visible',
    body: { classList: { add() {}, remove() {}, toggle() {} }, style: {} },
    head: { appendChild() {} },
  },
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
  setTimeout: () => 0,
  clearTimeout: () => {},
  timerWidget: () => '',
  // Vizinhos de outros módulos que a barra de filtros de renderPendencias usa:
  // penSetView redesenha a tela inteira, então ela precisa rodar até o fim.
  isTeamAdmin: () => false,
  getMyClients: () => [],
  getClientsByTeam: () => [],
  getCurrentTeam: () => 'init',
  getOperatorNames: () => [],
  loadFilterState: () => ({}),
  setTopbarAction: () => {},
};
sandbox.globalThis = sandbox;
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);

const quiet = console.error;
console.error = () => {};
try {
  vm.runInContext(read('js/ui.js'), sandbox, { filename: 'ui.js' });
  vm.runInContext(read('js/sla.js'), sandbox, { filename: 'sla.js' });
  vm.runInContext(partsSource('pendencias'), sandbox, { filename: 'pendencias.js' });
  vm.runInContext(
    `globalThis.__t = { renderPenFila, penFilaSort, _penFilaOrdena, _penRenderAtual, penSetView,
      PEN_FILA_COLS, getView: () => penView, getSort: () => _penFilaSort,
      setData: function(pens, serverMode){ _filteredPens = pens; _penServerMode = !!serverMode; } };`,
    sandbox
  );
} finally {
  console.error = quiet;
}

const T = sandbox.__t;
const area = _el();
const PENS = [
  { id: 'PEN-1', numero: 1, status: 'aberto', clientName: 'Acme', priority: 'alta', responsible: 'Ana', solicitante: 'Zélia', deadline: '2099-03-01', assunto: 'Impressora parada', createdAt: '2026-01-01T10:00:00Z' },
  { id: 'PEN-2', numero: 2, status: 'em_andamento', clientName: 'Beta', priority: 'critica', responsible: 'Bia', solicitante: 'Yuri', deadline: '2099-01-01', assunto: 'Servidor lento', createdAt: '2026-01-02T10:00:00Z' },
  { id: 'PEN-3', numero: 3, status: 'pausado', clientName: 'Gama', priority: 'baixa', responsible: 'Caio', solicitante: '', deadline: null, assunto: 'Trocar toner', createdAt: '2026-01-03T10:00:00Z' },
];

function render(pens) {
  T.setData(pens, false);
  area.innerHTML = '';
  T.renderPenFila(area);
  return area.innerHTML;
}

describe('renderPenFila (modo local)', () => {
  const html = render(PENS);

  it('monta a tabela com as nove colunas e o resumo que o quadro já usa', () => {
    expect(html).toContain('pen-summary');
    expect(html).toContain('<div class="pf-wrap">');
    expect((html.match(/<th class="pf-/g) || []).length).toBe(T.PEN_FILA_COLS.length);
    expect(html).toContain('Protocolo');
    expect(html).toContain('Quem pediu');
    expect(html).toContain('data-arg="responsavel"');
    expect(html).toContain('Prazo');
  });

  it('uma linha por pendência, clicável e abrindo o detalhe por delegação', () => {
    expect((html.match(/<tr class="pf-row"/g) || []).length).toBe(3);
    expect(html).toContain('data-action="openPen" data-arg="PEN-1"');
    expect(html).toContain('tabindex="0" role="button"');
    expect(html).not.toContain('onclick=');
    expect(html).toContain('Impressora parada');
    expect(html).toContain('Zélia');
  });

  it('prazo vazio aparece como travessão, sem data inventada', () => {
    const linha3 = html.slice(html.indexOf('data-arg="PEN-3"'));
    expect(linha3.slice(0, linha3.indexOf('</tr>'))).toContain('>—<');
  });

  it('concluído e fechado ficam fora da visualização, como no quadro', () => {
    const comFechadas = render(PENS.concat([
      { id: 'PEN-4', numero: 4, status: 'concluido', assunto: 'Já concluída', createdAt: '2026-01-04T10:00:00Z' },
      { id: 'PEN-5', numero: 5, status: 'fechado', assunto: 'Já fechada', createdAt: '2026-01-05T10:00:00Z' },
    ]));
    expect((comFechadas.match(/<tr class="pf-row"/g) || []).length).toBe(3);
    expect(comFechadas).not.toContain('Já concluída');
  });

  it('sem pendências, diz que o filtro não achou nada em vez de tabela vazia', () => {
    expect(render([])).toContain('Nenhuma pendência com os filtros atuais.');
  });

  // Fila vazia por causa de filtro é beco sem saída: o aviso leva a saída.
  it('com filtro ativo, o vazio traz o botão de limpar', () => {
    const orig = sandbox.document.getElementById;
    sandbox.document.getElementById = (id) => (id === 'penStatus'
      ? Object.assign(_el(), { tagName: 'SELECT', value: 'aberto', selectedOptions: [{ textContent: 'Aberto' }] })
      : _el());
    try {
      expect(render([])).toContain('data-action="penClearFilters"');
    } finally { sandbox.document.getElementById = orig; }
  });

  it('sem filtro, não oferece limpar o que não existe', () => {
    expect(render([])).not.toContain('data-action="penClearFilters"');
  });
});

describe('ordenação da fila', () => {
  it('padrão é prazo crescente — o que vence primeiro, primeiro — e sem prazo vai para o fim', () => {
    expect(T.getSort().col).toBe('prazo');
    const ids = T._penFilaOrdena(PENS).map((p) => p.id);
    expect(ids).toEqual(['PEN-2', 'PEN-1', 'PEN-3']);
  });

  it('sem prazo continua no fim também na ordem decrescente', () => {
    T.penFilaSort('prazo'); // prazo asc → desc
    expect(T.getSort()).toEqual({ col: 'prazo', dir: 'desc' });
    expect(T._penFilaOrdena(PENS).map((p) => p.id)).toEqual(['PEN-1', 'PEN-2', 'PEN-3']);
    T.penFilaSort('prazo'); // volta para asc
  });

  it('clicar em outra coluna começa crescente e marca aria-sort só nela', () => {
    T.penFilaSort('prioridade');
    expect(T.getSort()).toEqual({ col: 'prioridade', dir: 'asc' });
    expect(T._penFilaOrdena(PENS).map((p) => p.id)).toEqual(['PEN-3', 'PEN-1', 'PEN-2']);

    const html = render(PENS);
    expect((html.match(/aria-sort="ascending"/g) || []).length).toBe(1);
    expect(html).toContain('<th class="pf-pri is-sorted" aria-sort="ascending">');
    T.penFilaSort('prazo');
  });

  it('a coluna escolhida fica no aparelho', () => {
    T.penFilaSort('cliente');
    expect(JSON.parse(store.get('intra_pen_fila_sort'))).toEqual({ col: 'cliente', dir: 'asc' });
    T.penFilaSort('prazo');
  });
});

describe('alternador de visualização', () => {
  it('nasce no quadro e guarda a escolha da fila no aparelho', () => {
    expect(T.getView()).toBe('kanban');
    T.penSetView('fila');
    expect(T.getView()).toBe('fila');
    expect(store.get('intra_pen_view')).toBe('fila');
  });

  it('com a fila escolhida, os patches otimistas redesenham a fila, não o quadro', () => {
    T.setData(PENS, false);
    area.innerHTML = '';
    T._penRenderAtual(area);
    expect(area.innerHTML).toContain('<table class="pf-table">');
    expect(area.innerHTML).not.toContain('kanban-board');
  });

  it('de volta ao quadro, o despacho volta ao kanban', () => {
    T.penSetView('kanban');
    area.innerHTML = '';
    T._penRenderAtual(area);
    expect(area.innerHTML).toContain('kanban-board');
  });
});
