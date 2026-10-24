import { createRequire as __partsReq } from 'node:module';
const { requireParts, partsSource } = __partsReq(import.meta.url)('./_parts.cjs');
// ── Smoke test do render do quadro Kanban (Pendências) no design "Meu dia":
// confere a estrutura .pen-board (resumo + ações) e as 5 colunas com cards ───
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
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  setTimeout: () => 0,
  clearTimeout: () => {},
  timerWidget: () => '',
};
sandbox.globalThis = sandbox;
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);

const quiet = console.error;
console.error = () => {};
try {
  vm.runInContext(read('js/ui.js'), sandbox, { filename: 'ui.js' });
  vm.runInContext(partsSource('pendencias'), sandbox, { filename: 'pendencias.js' });
  vm.runInContext(
    `globalThis.__t = { renderPenKanban, penStatusSummary,
      setData: function(pens, serverMode){ _filteredPens = pens; _penServerMode = !!serverMode; } };`,
    sandbox
  );
} finally {
  console.error = quiet;
}

const T = sandbox.__t;
const area = _el();
const PENS = [
  { id: 'PEN-1', status: 'aberto', clientId: 1, clientName: 'Acme', priority: 'alta', responsible: 'Ana', deadline: '2020-01-01', assunto: 'Chamado aberto', createdAt: '2026-01-01T10:00:00Z', timerRunning: false },
  { id: 'PEN-2', status: 'em_andamento', clientId: 2, clientName: 'Beta', priority: 'critica', responsible: 'Bia', deadline: '2099-01-01', assunto: 'Chamado em andamento', createdAt: '2026-01-02T10:00:00Z', timerRunning: true },
  { id: 'PEN-3', status: 'pausado', clientId: 3, clientName: 'Gama', priority: 'baixa', responsible: 'Caio', deadline: null, assunto: 'Chamado pausado', createdAt: '2026-01-03T10:00:00Z', timerRunning: false },
];

function render(pens) {
  T.setData(pens, false);
  area.innerHTML = '';
  T.renderPenKanban(area);
  return area.innerHTML;
}

describe('renderPenKanban (modo local)', () => {
  const html = render(PENS);

  it('cabeçalho: só o resumo, sem duplicar ações da topbar (tema / nova pendência)', () => {
    expect(html).toContain('<div class="pen-board">');
    expect(html).toContain('<div class="pen-board-head">');
    expect(html).not.toContain('Alternar tema');
    expect(html).not.toContain("getElementById('themeToggleBtn').click()");
    expect(html).not.toContain('class="btn btn-primary"');
    expect(html).toContain('data-action="newPendencia"');
  });

  it('linha-resumo com total, colunas e vencidas', () => {
    expect(html).toContain('pen-summary');
    expect(html).toContain('<strong>3</strong>&nbsp;pendências ativas');
    expect(html).toContain('<strong>1</strong> vencida');
  });

  it('renderiza a região do quadro com as 5 colunas e contadores', () => {
    expect(html).toContain('<section class="kanban-board" role="region" aria-label="Quadro de pendências">');
    expect(html).toContain('class="kanban-col" style="--c:var(--kb-accent)"');
    expect(html).toContain('class="kanban-col" style="--c:var(--kb-cyan)"');
    expect(html).toContain('class="kanban-col" style="--c:var(--kb-amber)"');
    // Sem cards: coluna estreita (is-empty), sem botão de ordenar.
    expect(html).toContain('class="kanban-col is-empty" style="--c:var(--kb-violet)"');
    expect(html).toContain('class="kanban-col is-empty" style="--c:var(--kb-green)"');
    expect(html).not.toContain("cyclePenColSort('aguardando')");
    expect(html).toContain('aria-label="Coluna Em Andamento, 1 pendência"');
    expect(html).toContain('class="kanban-col-count"');
  });

  it('cabeçalho da coluna: contagem + botão de ordenação com o ícone do modo atual', () => {
    expect(html).toContain('<div class="kanban-col-header">');
    const aside = html.indexOf('class="kanban-col-aside"');
    expect(aside).toBeGreaterThan(-1);
    expect(html.indexOf('class="kanban-col-count"')).toBeGreaterThan(aside);
    expect(html).toContain('data-action="penColSort" data-arg="aberto"');
    // O rótulo acessível carrega a ordem em vigor, não só o nome da coluna.
    expect(html).toContain('aria-label="Ordem de Aberto: por criação. Clique para mudar."');
    // Ordenação padrão (criação) = relógio, só dentro do botão (sem relógio solto)
    const firstHeader = html.slice(aside, html.indexOf('</div>', aside));
    expect((firstHeader.match(/<circle cx="12" cy="12" r="9"\/>/g) || []).length).toBe(1);
    expect(firstHeader.indexOf('<circle cx="12" cy="12" r="9"/>')).toBeGreaterThan(firstHeader.indexOf('kanban-col-sort'));
  });

  it('um card por pendência, com drag-and-drop mantido', () => {
    expect(html).toContain('<article class="kanban-card" style="border-left:4px');
    expect((html.match(/<article class="kanban-card"/g) || []).length).toBe(3);
    expect(html).toContain('onPenKanbanDragStart');
    expect(html).toContain('onPenKanbanDrop(event,\'aberto\')');
    expect(html).toContain('border-left:4px solid var(--kb-cyan)');
    expect(html).toContain('Iniciar');
  });

  it('coluna vazia mostra empty-state', () => {
    const empty = render([]);
    expect(empty).toContain('Nenhuma pendência');
    expect(empty).toContain('<strong>0</strong>&nbsp;pendências ativas');
    expect(empty).toContain('<strong>0</strong> vencidas');
  });

  it('SLA restante aparece no card; SLA vencido fica de fora', () => {
    const fresh = render([{
      id: 'PEN-9', status: 'aberto', clientId: 1, clientName: 'Acme', priority: 'alta',
      responsible: 'Ana', deadline: null, assunto: 'Nova pendência',
      createdAt: new Date().toISOString(), timerRunning: false,
    }]);
    expect(fresh).toMatch(/<span class="kc-sla" title="SLA restante">\d+h<\/span>/);

    const old = render(PENS);
    expect(old).not.toContain('kc-sla');
  });
});
