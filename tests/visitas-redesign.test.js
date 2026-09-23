import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

// ── Redesign mobile de Visitas: KPIs, chips, cards, FAB e sheet de filtros ───
function mkEl(id) {
  const el = {
    _id: id, innerHTML: '', textContent: '', value: '', disabled: false,
    hidden: false, dataset: {},
    style: {}, attrs: {}, toggled: {},
    setAttribute(k, v) { el.attrs[k] = String(v); },
    getAttribute(k) { return el.attrs[k]; },
    classList: {
      add() {}, remove() {},
      toggle: (k, f) => { el.toggled[k] = !!f; },
      contains: () => false,
    },
    addEventListener() {}, appendChild() {}, remove() {}, click() {},
    contains: () => false,
    querySelector: () => null, querySelectorAll: () => [],
    focus() {},
  };
  return el;
}
const _el = {};
const _savedStates = [];
const _modals = [];
const sandbox = {
  console,
  Promise,
  window: { addEventListener() {}, location: { hash: '#visitas' }, innerWidth: 360 },
  navigator: { onLine: true },
  document: {
    addEventListener() {},
    getElementById: (id) => _el[id] || (_el[id] = mkEl(id)),
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => mkEl('c'),
    visibilityState: 'visible',
    body: mkEl('body'),
    head: mkEl('head'),
  },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  setTimeout: (fn) => 0,
  clearTimeout: () => {},
  debounce: (fn) => fn,
  isTeamAdmin: () => false,
  getCurrentTeam: () => 'init',
  getMyClients: () => [],
  getOperatorNames: () => [],
  escapeHtml: (s) => String(s == null ? '' : s),
  formatDate: (iso) => String(iso || '').split('-').reverse().join('/'),
  formatVisitTimeRange: (v) => (!v || v.allDay || !v.time ? 'Dia inteiro' : String(v.time).slice(0, 5)),
  formatVisitNumero: (v) => '#' + String((v && v.numero) || '----').padStart(4, '0'),
  saveFilterState: (k, state) => { _savedStates.push(state); },
  openModal: (title, html) => { _modals.push({ title, html }); },
  closeModal: () => {},
};
sandbox.globalThis = sandbox;
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
const _quietErr = console.error;
console.error = () => {};
try {
  vm.runInContext(fs.readFileSync('js/visitas.js', 'utf8'), sandbox, { filename: 'visitas.js' });
  vm.runInContext(
    'globalThis.__t = { visitInitials, VISIT_STATUS_CHIPS, setVisitStatusFilter, getFilteredVisits, visitCardHtml, openVisitFiltersSheet, applyVisitFiltersSheet, clearVisitFiltersSheet, updateVisitFilterDot };',
    sandbox
  );
} finally {
  console.error = _quietErr;
}
const T = sandbox.__t;
const FAKE_VISITS = [
  { id: 'v1', numero: 7, date: '2026-09-23', time: '', allDay: true, clientId: 'c1', clientName: 'Panobianco', operator: 'Pedro Bento', motivo: 'Rotina', status: 'em_andamento' },
  { id: 'v2', numero: 8, date: '2026-09-16', time: '10:00', clientId: 'c1', clientName: 'Panobianco', operator: 'Pedro Bento', motivo: 'Suporte', status: 'concluida' },
  { id: 'v3', numero: 9, date: '2026-09-09', time: '', allDay: true, clientId: 'c2', clientName: 'Gmar', operator: 'Rafael', motivo: 'Instalação', status: 'agendada' },
];
const setVisits = () =>
  vm.runInContext('getMyVisits = function(){ return ' + JSON.stringify(FAKE_VISITS) + '; };', sandbox);

beforeEach(() => {
  for (const k of Object.keys(_el)) delete _el[k];
  _savedStates.length = 0;
  _modals.length = 0;
  _el.visitSearch = mkEl('visitSearch');
  _el.visitSearch.value = '';
  _el.visitFilterBtn = mkEl('visitFilterBtn');
  vm.runInContext('_visitFilter = { client: "", operator: "", status: "", from: "", to: "" }; _visitPage = 1;', sandbox);
  vi.restoreAllMocks();
});

describe('visitInitials', () => {
  it('"Pedro Bento" → "PB"; nome simples → 1 letra', () => {
    expect(T.visitInitials('Pedro Bento')).toBe('PB');
    expect(T.visitInitials('Rafael')).toBe('R');
    expect(T.visitInitials('')).toBe('•');
  });
});

describe('chips de status', () => {
  it('Todas + 3 status (sem select dedicado)', () => {
    expect(T.VISIT_STATUS_CHIPS.map((c) => c.value)).toEqual(['', 'em_andamento', 'concluida', 'agendada']);
  });

  it('setVisitStatusFilter atualiza estado e salva', () => {
    T.setVisitStatusFilter('concluida');
    expect(vm.runInContext('_visitFilter.status', sandbox)).toBe('concluida');
    expect(_savedStates.at(-1).status).toBe('concluida');
    T.setVisitStatusFilter('');
    expect(vm.runInContext('_visitFilter.status', sandbox)).toBe('');
  });
});

describe('getFilteredVisits com estado (sem ler selects do DOM)', () => {
  it('filtra por status, cliente, operador, período e busca', () => {
    setVisits();
    expect(T.getFilteredVisits()).toHaveLength(3);
    vm.runInContext('_visitFilter.status = "concluida";', sandbox);
    expect(T.getFilteredVisits().map((v) => v.id)).toEqual(['v2']);
    vm.runInContext('_visitFilter.status = ""; _visitFilter.operator = "Rafael";', sandbox);
    expect(T.getFilteredVisits().map((v) => v.id)).toEqual(['v3']);
    vm.runInContext('_visitFilter.operator = ""; _visitFilter.from = "2026-09-16"; _visitFilter.to = "2026-09-23";', sandbox);
    expect(T.getFilteredVisits().map((v) => v.id)).toEqual(['v1', 'v2']);
    _el.visitSearch.value = 'gmar';
    vm.runInContext('_visitFilter.from = ""; _visitFilter.to = "";', sandbox);
    expect(T.getFilteredVisits().map((v) => v.id)).toEqual(['v3']);
  });
});

describe('visitCardHtml (mock)', () => {
  it('data + número, status, cliente, operador e horário', () => {
    const html = T.visitCardHtml(FAKE_VISITS[0]);
    expect(html).toContain('23/09/2026');
    expect(html).toContain('#0007');
    expect(html).toContain('Panobianco');
    expect(html).toContain('PB');
    expect(html).toContain('Pedro Bento');
    expect(html).toContain('Dia inteiro');
    expect(html).toContain("openVisitDetail('v1')");
    expect(html).toContain('vis-card');
  });

  it('horário formatado quando há hora marcada', () => {
    expect(T.visitCardHtml(FAKE_VISITS[1])).toContain('10:00');
  });
});

describe('sheet de filtros (rascunho + Aplicar/Limpar)', () => {
  it('abre modal com os 4 campos e aplica no estado', () => {
    T.openVisitFiltersSheet();
    expect(_modals).toHaveLength(1);
    expect(_modals[0].title).toBe('Filtros');
    for (const id of ['fVisitClient', 'fVisitOperator', 'fVisitFrom', 'fVisitTo']) {
      expect(_modals[0].html).toContain(`id="${id}"`);
    }
    _el.fVisitClient = mkEl('fVisitClient');
    _el.fVisitOperator = mkEl('fVisitOperator');
    _el.fVisitFrom = mkEl('fVisitFrom');
    _el.fVisitTo = mkEl('fVisitTo');
    _el.fVisitClient.value = 'c2';
    _el.fVisitFrom.value = '2026-09-01';
    T.applyVisitFiltersSheet();
    expect(vm.runInContext('_visitFilter.client', sandbox)).toBe('c2');
    expect(vm.runInContext('_visitFilter.from', sandbox)).toBe('2026-09-01');
    T.clearVisitFiltersSheet();
    expect(vm.runInContext('_visitFilter.client', sandbox)).toBe('');
    expect(vm.runInContext('_visitFilter.from', sandbox)).toBe('');
  });

  it('ponto no botão só com filtro estruturado (não busca/status)', () => {
    T.updateVisitFilterDot();
    expect(_el.visitFilterBtn.toggled.on).toBe(false);
    vm.runInContext('_visitFilter.client = "c1";', sandbox);
    T.updateVisitFilterDot();
    expect(_el.visitFilterBtn.toggled.on).toBe(true);
    _el.visitSearch.value = 'x';
    vm.runInContext('_visitFilter.client = "";', sandbox);
    T.updateVisitFilterDot();
    expect(_el.visitFilterBtn.toggled.on).toBe(false);
  });
});

describe('contrato do template e do CSS', () => {
  const src = fs.readFileSync('js/visitas.js', 'utf8');
  const css = fs.readFileSync('css/styles.css', 'utf8').replace(/\s+/g, ' ');

  it('template: busca + funil + KPIs + chips + mês + FAB, sem tabela/selects', () => {
    for (const id of ['visitSearch', 'visitFilterBtn', 'visitStats', 'visitChips', 'visitCount', 'visitViewArea']) {
      expect(src).toContain(`id="${id}"`);
    }
    expect(src).toContain('openVisitMonthReportModal');
    expect(src).toContain('vis-fab');
    expect(src).toContain('openVisitDetail');
    expect(src).not.toContain('visit-table');
    expect(src).not.toContain('id="visitStatus"');
    expect(src).not.toContain('id="visitClient"');
  });

  it('excluir migrou para dentro do detalhe', () => {
    expect(src).toContain("closeModal();deleteVisitConfirm(");
  });

  it('CSS do redesign presente + fonte Schibsted', () => {
    for (const sel of ['.vis-card', '.vis-chip[aria-pressed', '.vis-fab', '.vis-kpis', '.vis-fbtn.on', '.vis-st', '.vis-av']) {
      expect(css).toContain(sel);
    }
    expect(fs.readFileSync('index.html', 'utf8')).toContain('Schibsted+Grotesk');
  });
});
