import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

// ── Menu suspenso do topbar (mobile ≤768px): ações agrupadas em ⋮ ────────────
function mkEl(id) {
  const el = {
    _id: id, innerHTML: '', textContent: '', value: '', disabled: false,
    hidden: true, dataset: {},
    style: {}, children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    attrs: {},
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
const _listeners = { click: [], keydown: [] };
const sandbox = {
  console,
  window: { addEventListener() {}, location: { hash: '#dashboard' } },
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
  vm.runInContext(fs.readFileSync('js/ui.js', 'utf8'), sandbox, { filename: 'ui.js' });
  vm.runInContext(
    'globalThis.__t = { setTopbarAction, toggleTopbarMoreMenu, closeTopbarMoreMenu, _syncTopbarMoreAction };',
    sandbox
  );
} finally {
  console.error = _quietErr;
}
const T = sandbox.__t;
const fire = (type, evt) => (_listeners[type] || []).forEach((fn) => fn(evt || {}));

function labelEl() {
  const label = mkEl('topbarMoreAction:q');
  _el.topbarMoreAction.querySelector = (sel) =>
    sel === '.topbar-more-action-text' ? label : null;
  return label;
}

beforeEach(() => {
  for (const k of Object.keys(_el)) delete _el[k];
  _el.topbarActionBtn = mkEl('topbarActionBtn');
  _el.topbarActionBtn.style.display = 'none';
  _el.topbarMoreAction = mkEl('topbarMoreAction');
  _el.topbarMoreMenu = mkEl('topbarMoreMenu');
  _el.topbarMoreMenu.hidden = true;
  _el.topbarMoreMenu.dataset.open = '0';
  _el.topbarMoreBtn = mkEl('topbarMoreBtn');
  vi.restoreAllMocks();
});

describe('setTopbarAction espelha o menu mobile', () => {
  it('exibe o item do menu com o mesmo rótulo', () => {
    const label = labelEl();
    T.setTopbarAction('Nova Pendência', '');
    expect(_el.topbarActionBtn.style.display).toBe('inline-flex');
    expect(_el.topbarMoreAction.style.display).toBe('');
    expect(label.textContent).toBe('Nova Pendência');
  });
});

describe('abrir/fechar o menu suspenso', () => {
  it('toggle alterna hidden, dataset e aria-expanded', () => {
    T.toggleTopbarMoreMenu({ stopPropagation() {} });
    expect(_el.topbarMoreMenu.hidden).toBe(false);
    expect(_el.topbarMoreMenu.dataset.open).toBe('1');
    expect(_el.topbarMoreBtn.attrs['aria-expanded']).toBe('true');
    T.toggleTopbarMoreMenu({ stopPropagation() {} });
    expect(_el.topbarMoreMenu.hidden).toBe(true);
    expect(_el.topbarMoreMenu.dataset.open).toBe('0');
    expect(_el.topbarMoreBtn.attrs['aria-expanded']).toBe('false');
  });

  it('ao abrir, esconde o item Novo quando não há ação (btn oculto)', () => {
    _el.topbarActionBtn.style.display = 'none';
    T.toggleTopbarMoreMenu({ stopPropagation() {} });
    expect(_el.topbarMoreAction.style.display).toBe('none');
  });

  it('ao abrir, mostra o item Novo quando há ação', () => {
    _el.topbarActionBtn.style.display = 'inline-flex';
    T.toggleTopbarMoreMenu({ stopPropagation() {} });
    expect(_el.topbarMoreAction.style.display).toBe('');
  });

  it('clique fora fecha; Escape fecha', () => {
    T.toggleTopbarMoreMenu({ stopPropagation() {} });
    expect(_el.topbarMoreMenu.hidden).toBe(false);
    fire('click', { target: mkEl('fora') });
    expect(_el.topbarMoreMenu.hidden).toBe(true);
    T.toggleTopbarMoreMenu({ stopPropagation() {} });
    fire('keydown', { key: 'Escape', target: { tagName: 'DIV' } });
    expect(_el.topbarMoreMenu.hidden).toBe(true);
  });

  it('close em menu já fechado não quebra', () => {
    expect(() => T.closeTopbarMoreMenu()).not.toThrow();
  });
});

describe('contrato mobile no CSS e no HTML', () => {
  const css = fs.readFileSync('css/styles.css', 'utf8');
  const norm = css.replace(/\s+/g, ' ');
  const mobile = norm.split('@media screen and (max-width: 768px)')[1] || '';
  const html = fs.readFileSync('index.html', 'utf8');

  it('carrossel de clientes oculto no mobile', () => {
    expect(mobile).toContain('#penSlaSummary');
    expect(mobile).toMatch(/#penSlaSummary\s*\{\s*display:\s*none/);
  });

  it('abas Ativas/Arquivadas com sublinhado + número embaixo (sem "15 ativas" inline)', () => {
    // CSS: aba ativa com sublinhado e contador abaixo das abas
    expect(norm).toContain('.pen-scope-tab.is-active::after');
    expect(norm).toMatch(/\.pen-scope-row\s*\{[^}]*flex-direction:\s*column/);
    // markup: abas sem btn-primary/btn-secondary, contador sem rótulo duplicado
    const penJs = fs.readFileSync('js/pendencias.js', 'utf8');
    expect(penJs).toContain('pen-scope-tab');
    expect(penJs).not.toMatch(/setPenScope\('active'\)">Ativas<\/button>\s*<button class="btn/);
    expect(penJs).toContain("cntEl.textContent = total ? String(total) : ''");
  });

  it('ações do topbar colapsadas no ⋮ só no mobile', () => {
    // originais ocultos + wrap do ⋮ visível no mobile…
    expect(mobile).toContain('#notifSettingsBtn');
    expect(mobile).toMatch(/\.topbar-more-wrap\s*\{[^}]*display:\s*block/);
    expect(mobile).toContain('.topbar-more-menu');
    expect(mobile).toContain('.topbar-more-item');
    // …e wrap oculto no desktop
    expect(norm).toMatch(/\.topbar-more-wrap\s*\{\s*display:\s*none/);
  });

  it('hamburger normalizado em 40px no mobile', () => {
    expect(mobile).toMatch(/\.hamburger-btn\s*\{[^}]*width:\s*40px[^}]*height:\s*40px/);
  });

  it('drawer mobile: links da sidebar alinhados à esquerda', () => {
    expect(mobile).toMatch(/\.sidebar \.sidebar-nav a\s*\{[^}]*justify-content:\s*flex-start/);
  });

  it('aba Reunião oculta no menu em celulares', () => {
    expect(mobile).toMatch(/#nav-reuniao\s*\{\s*display:\s*none/);
  });

  it('HTML tem o menu suspenso com os 4 itens', () => {
    for (const id of ['topbarMoreBtn', 'topbarMoreMenu', 'topbarMoreAction', 'refreshBtn']) {
      expect(html).toContain(`id="${id}"`);
    }
  });
});
