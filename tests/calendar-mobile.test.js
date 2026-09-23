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
const sandbox = {
  console,
  window: { addEventListener() {}, location: { hash: '#calendario' }, innerWidth: 360 },
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
};
sandbox.globalThis = sandbox;
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
const _quietErr = console.error;
console.error = () => {};
try {
  vm.runInContext(fs.readFileSync('js/calendar.js', 'utf8'), sandbox, { filename: 'calendar.js' });
  vm.runInContext(
    'globalThis.__t = { calendarPageTitle, calInitialViewForWidth, toggleCalFilters };',
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

describe('título curto (sem truncar no topbar mobile)', () => {
  it('é "Calendário"', () => {
    expect(T.calendarPageTitle()).toBe('Calendário');
  });
});

describe('view inicial por largura', () => {
  it('celular (≤768px): lista mensal', () => {
    expect(T.calInitialViewForWidth(360)).toBe('listMonth');
    expect(T.calInitialViewForWidth(768)).toBe('listMonth');
  });

  it('desktop: grade mensal', () => {
    expect(T.calInitialViewForWidth(1024)).toBe('dayGridMonth');
    expect(T.calInitialViewForWidth(1920)).toBe('dayGridMonth');
  });
});

describe('toggle dos filtros (menu colapsável)', () => {
  it('alterna data-open e aria-expanded', () => {
    T.toggleCalFilters();
    expect(_el.calFilters.dataset.open).toBe('1');
    expect(_el.calFiltersToggle.attrs['aria-expanded']).toBe('true');
    T.toggleCalFilters();
    expect(_el.calFilters.dataset.open).toBe('0');
    expect(_el.calFiltersToggle.attrs['aria-expanded']).toBe('false');
  });
});

describe('contrato do markup (filtros em menu + botões lado a lado)', () => {
  const src = fs.readFileSync('js/calendar.js', 'utf8');

  it('filtros envolvidos em .cal-filters com botão toggle', () => {
    expect(src).toContain('id="calFilters"');
    expect(src).toContain('id="calFiltersToggle"');
    expect(src).toContain('class="cal-filters"');
  });

  it('botões Novo envolvidos em .cal-new-btns', () => {
    expect(src).toContain('class="cal-new-btns"');
    expect(src).toContain('Nova Pendência');
    expect(src).toContain('Nova Visita');
  });

  it('mobile usa listMonth (grade não é forçada nas duas larguras)', () => {
    expect(src).toContain("calInitialViewForWidth(window.innerWidth)");
    expect(src).not.toContain("isMobile ? 'dayGridMonth' : 'dayGridMonth'");
  });
});

describe('contrato mobile no CSS', () => {
  const css = fs.readFileSync('css/styles.css', 'utf8');
  const norm = css.replace(/\s+/g, ' ');
  const mobile = norm.split('@media screen and (max-width: 768px)')[1] || '';

  it('toggle de filtros visível + filtros colapsáveis', () => {
    expect(mobile).toContain('.cal-filters-toggle');
    expect(mobile).toContain('.cal-filters[data-open="1"]');
  });

  it('botões Novo em 2 colunas', () => {
    expect(mobile).toMatch(/\.cal-new-btns\s*\{[^}]*grid-template-columns:\s*1fr 1fr/);
  });

  it('desktop: wrappers transparentes, toggle oculto', () => {
    expect(norm).toMatch(/\.cal-filters,\s*\.cal-new-btns\s*\{\s*display:\s*contents/);
    expect(norm).toMatch(/\.cal-filters-toggle\s*\{\s*display:\s*none/);
  });

  it('base do calendário vem ANTES do bloco mobile (cascata não inverte)', () => {
    const baseIdx = norm.indexOf('.cal-filters, .cal-new-btns');
    const mobileIdx = norm.indexOf('@media screen and (max-width: 768px)');
    expect(baseIdx).toBeGreaterThan(-1);
    expect(mobileIdx).toBeGreaterThan(-1);
    expect(baseIdx).toBeLessThan(mobileIdx);
  });
});
