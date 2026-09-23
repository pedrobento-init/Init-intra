import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

// ── Calendário mobile: título curto, filtros em menu, botões lado a lado,
// grade mensal vira lista ────────────────────────────────────────────────────
function mkEl(id) {
  const el = {
    _id: id, innerHTML: '', textContent: '', value: '', disabled: false,
    hidden: false, dataset: { open: '0' },
    style: {}, attrs: {},
    setAttribute(k, v) { el.attrs[k] = String(v); },
    getAttribute(k) { return el.attrs[k]; },
    addEventListener() {}, appendChild() {}, remove() {}, click() {},
    contains: () => false,
    querySelector: () => null, querySelectorAll: () => [],
    focus() {},
  };
  return el;
}
const _el = {};
const _listeners = {};
const sandbox = {
  console,
  Promise,
  window: { addEventListener() {}, location: { hash: '#calendario' }, innerWidth: 360 },
  navigator: { onLine: true },
  document: {
    addEventListener(type, fn) { (_listeners[type] = _listeners[type] || []).push(fn); },
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
};
sandbox.globalThis = sandbox;
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
const _quietErr = console.error;
console.error = () => {};
try {
  vm.runInContext(fs.readFileSync('js/calendar.js', 'utf8'), sandbox, { filename: 'calendar.js' });
  vm.runInContext(
    'globalThis.__t = { calendarPageTitle, agFcView, agDefaultView, agSetView, toggleCalFilters, closeCalFilters, initFullCalendar, agDayMonth, agOverdueItems, agNext7Items, agRecurringGroups, agChipHtml };',
    sandbox
  );
} finally {
  console.error = _quietErr;
}
const T = sandbox.__t;

beforeEach(() => {
  for (const k of Object.keys(_el)) delete _el[k];
  _el.calFilters = mkEl('calFilters');
  _el.calFiltersToggle = mkEl('calFiltersToggle');
  vi.restoreAllMocks();
});

describe('título da página', () => {
  it('é "Agenda"', () => {
    expect(T.calendarPageTitle()).toBe('Agenda');
  });
});

describe('views lógicas da Agenda', () => {
  it('mobile abre em lista; desktop em mês', () => {
    expect(T.agDefaultView()).toBe('list'); // sandbox: innerWidth 360
  });

  it('mapeia Mês/Semana/Lista para o FullCalendar', () => {
    expect(T.agFcView('month')).toBe('dayGridMonth');
    expect(T.agFcView('week')).toBe('timeGridWeek');
    expect(T.agFcView('list')).toBe('listMonth'); // sandbox mobile
  });

  it('agSetView troca a view do motor e ignora inválidas', () => {
    vm.runInContext('_fcInstance = { v: null, changeView: function(v){ this.v = v; }, getDate: function(){ return new Date(2026, 8, 23); } };', sandbox);
    try {
      vm.runInContext("agSetView('week')", sandbox);
      expect(vm.runInContext('_fcInstance.v', sandbox)).toBe('timeGridWeek');
      vm.runInContext("agSetView('banana')", sandbox);
      expect(vm.runInContext('_fcInstance.v', sandbox)).toBe('timeGridWeek');
    } finally {
      vm.runInContext('_fcInstance = null;', sandbox);
    }
  });
});

describe('primeiro acesso: loading imediato + erro com retry se o CDN falhar', () => {
  it('mostra "Carregando" na hora e "Tentar novamente" ao falhar', async () => {
    _el.calendarContainer = mkEl('calendarContainer');
    // CDN falha de forma assíncrona (como na rede real)
    vm.runInContext('loadFullCalendar = function(){ return Promise.reject(new Error("cdn")); }', sandbox);
    const p = vm.runInContext('initFullCalendar()', sandbox);
    expect(_el.calendarContainer.innerHTML).toContain('Carregando calendário');
    await p;
    expect(_el.calendarContainer.innerHTML).toContain('Tentar novamente');
    expect(_el.calendarContainer.innerHTML).toContain('onclick="initFullCalendar()"');
    vm.runInContext('delete loadFullCalendar;', sandbox);
  });

  it('usa timeout em vez de travar para sempre', () => {
    const src = fs.readFileSync('js/calendar.js', 'utf8');
    expect(src).toContain('_loadFullCalendarWithTimeout');
    expect(src).toMatch(/Promise\.race\(\[\s*loadFullCalendar\(\)/);
  });
});

describe('view-models puros da sidebar', () => {
  it('agDayMonth formata "25 set"', () => {
    expect(T.agDayMonth('2026-09-25')).toBe('25 set');
    expect(T.agDayMonth('')).toBe('—');
  });

  it('agOverdueItems: só vencidas, mais antigas primeiro', () => {
    const pens = [
      { id: 'a', title: 'A', deadline: '2026-09-20', priority: 'media' },
      { id: 'b', title: 'B', deadline: '2026-09-18', priority: 'critica' },
      { id: 'c', title: 'C', deadline: '2026-09-25', priority: 'baixa' },
    ];
    const out = T.agOverdueItems(pens, '2026-09-23');
    expect(out.map((o) => o.id)).toEqual(['b', 'a']);
    expect(out[0].meta).toBe('Venceu em 18 set');
  });

  it('agNext7Items: janela [hoje, +7d] com pendências e visitas', () => {
    const pens = [
      { id: 'hoje', title: 'H', deadline: '2026-09-23', priority: 'alta' },
      { id: 'd7', title: 'S', deadline: '2026-09-30', priority: 'media' },
      { id: 'd8', title: 'Fora', deadline: '2026-10-01', priority: 'media' },
      { id: 'ontem', title: 'Passada', deadline: '2026-09-22', priority: 'media' },
    ];
    const visits = [{ id: 'v1', clientName: 'Panobianco', date: '2026-09-24' }];
    const out = T.agNext7Items(pens, visits, '2026-09-23');
    expect(out.map((o) => o.id)).toEqual(['hoje', 'v1', 'd7']);
    expect(out[0].meta).toContain('hoje');
    expect(out[1].title).toBe('Visita — Panobianco');
  });

  it('agRecurringGroups: agrupa por cliente com frequência e conta do mês', () => {
    const visits = [
      { id: 'v1', clientId: 'c1', clientName: 'Panobianco', date: '2026-09-02', recurrence: 'weekly' },
      { id: 'v2', clientId: 'c1', clientName: 'Panobianco', date: '2026-09-09', recurrence: 'weekly' },
      { id: 'v3', clientId: 'c2', clientName: 'Outro', date: '2026-09-05', recurrence: '' },
    ];
    const out = T.agRecurringGroups(visits, '2026-09');
    expect(out).toHaveLength(1);
    expect(out[0].clientName).toBe('Panobianco');
    expect(out[0].meta).toBe('Semanal · 2 no mês');
  });

  it('agChipHtml: escapa título e marca vencida', () => {
    const html = T.agChipHtml('pendencia', '<b>X</b>', '#dc2626', true);
    expect(html).toContain('ag-chip overdue');
    expect(html).not.toContain('<b>X</b>');
    expect(html).toContain('--dot:#dc2626');
    expect(T.agChipHtml('visit', 'Panobianco', '#0ea5e9', false)).toContain('ag-chip"');
  });
});

describe('toggle dos filtros (dropdown ao lado do Hoje)', () => {
  it('alterna data-open e aria-expanded', () => {
    T.toggleCalFilters();
    expect(_el.calFilters.dataset.open).toBe('1');
    expect(_el.calFiltersToggle.attrs['aria-expanded']).toBe('true');
    T.toggleCalFilters();
    expect(_el.calFilters.dataset.open).toBe('0');
    expect(_el.calFiltersToggle.attrs['aria-expanded']).toBe('false');
  });

  it('closeCalFilters fecha; clique fora e Escape fecham', () => {
    T.toggleCalFilters();
    expect(_el.calFilters.dataset.open).toBe('1');
    T.closeCalFilters();
    expect(_el.calFilters.dataset.open).toBe('0');
    T.toggleCalFilters();
    (_listeners.click || []).forEach((fn) => fn({ target: mkEl('fora') }));
    expect(_el.calFilters.dataset.open).toBe('0');
    T.toggleCalFilters();
    (_listeners.keydown || []).forEach((fn) => fn({ key: 'Escape', target: { tagName: 'DIV' } }));
    expect(_el.calFilters.dataset.open).toBe('0');
  });
});

describe('contrato do markup (filtros em menu + botões lado a lado)', () => {
  const src = fs.readFileSync('js/calendar.js', 'utf8');

  it('filtros envolvidos em .cal-filters com botão toggle', () => {
    expect(src).toContain('id="calFilters"');
    expect(src).toContain('id="calFiltersToggle"');
    expect(src).toContain('class="cal-filters"');
  });

  it('botão Filtros fica no nav ao lado do Hoje; painel tem selects + ações', () => {
    const navIdx = src.indexOf('agNav(\'next\')');
    const toggleIdx = src.indexOf('id="calFiltersToggle"');
    expect(navIdx).toBeGreaterThan(-1);
    expect(toggleIdx).toBeGreaterThan(navIdx);
    expect(src).toContain('class="cal-menu-actions"');
    expect(src).toContain('Nova Pendência');
    expect(src).toContain('Nova Visita');
    expect(src).toContain('exportCalendarICS');
    expect(src).not.toContain('cal-new-btns');
    expect(src).not.toContain('<div class="search-bar">');
  });

  it('usa toolbar própria (sem headerToolbar nativa)', () => {
    expect(src).toContain('headerToolbar: false');
    expect(src).toContain("agSetView('month')");
    expect(src).toContain("agSetView('week')");
    expect(src).toContain("agSetView('list')");
  });

  it('header da Agenda com título "Agenda" + legenda + layout grade/sidebar', () => {
    expect(src).toContain('<h1 class="ag-title">Agenda</h1>');
    expect(src).toContain('id="agendaSide"');
    expect(src).toContain('ag-legend');
  });

  it('ações do menu fecham o dropdown', () => {
    expect(src).toContain('closeCalFilters();openPendenciaForm()');
    expect(src).toContain('closeCalFilters();openVisitForm()');
    expect(src).toContain('closeCalFilters();exportCalendarICS()');
  });
});

describe('contrato mobile no CSS', () => {
  const css = fs.readFileSync('css/styles.css', 'utf8');
  const norm = css.replace(/\s+/g, ' ');
  const mobile = norm.split('@media screen and (max-width: 768px)')[1] || '';

  it('dropdown de filtros ancorado no nav (desktop e mobile)', () => {
    expect(norm).toMatch(/\.cal-filters\s*\{[^}]*position:\s*absolute/);
    expect(norm).toMatch(/\.cal-filters\[data-open="1"\]\s*\{\s*display:\s*flex/);
    expect(norm).toContain('.cal-menu-actions');
    expect(norm).not.toContain('.cal-new-btns');
  });

  it('título do mês centralizado e com inicial maiúscula', () => {
    expect(mobile).toMatch(/\.fc-header-toolbar \.fc-toolbar-chunk:nth-child\(2\)\s*\{[^}]*text-align:\s*center/);
    expect(mobile).toMatch(/\.fc-toolbar-title::first-letter\s*\{\s*text-transform:\s*uppercase/);
  });

  it('base do dropdown vem ANTES do bloco mobile (cascata não inverte)', () => {
    const baseIdx = norm.indexOf('.ag-filter-group { position:relative');
    const mobileIdx = norm.indexOf('@media screen and (max-width: 768px)');
    expect(baseIdx).toBeGreaterThan(-1);
    expect(mobileIdx).toBeGreaterThan(-1);
    expect(baseIdx).toBeLessThan(mobileIdx);
  });

  it('visual da mock: chips, grade 2 colunas e sidebar', () => {
    expect(norm).toContain('.ag-chip');
    expect(norm).toContain('.ag-chip.overdue');
    expect(norm).toMatch(/\.ag-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*320px/);
    expect(norm).toContain('.ag-side');
    expect(norm).toContain('.plist');
    expect(norm).toContain('.ag-card .badge.vencida');
  });

  it('index.html carrega Manrope (títulos da Agenda)', () => {
    expect(fs.readFileSync('index.html', 'utf8')).toContain('family=Manrope');
  });

});
