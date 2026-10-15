import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

// ── SEC-17 (badge de timer) e SEC-18 (logo do cliente) ───────────────────────
// Regra: nenhum valor controlado pelo usuário pode entrar cru em atributo HTML
// (title/src) montado por template literal — o CSP atual permite handler inline.
const NL = String.fromCharCode(10);
const D = String.fromCharCode(34);
const Q = String.fromCharCode(39);

function _anyEl() {
  return new Proxy(function () {}, {
    get: (_t, p) => {
      if (p === Symbol.toPrimitive) return () => '';
      if (p === 'then') return undefined;
      if (p === 'style' || p === 'dataset') return {};
      if (p === 'classList') return { add() {}, remove() {}, toggle() {}, contains: () => false };
      return (..._a) => _anyEl();
    },
    set: () => true,
    apply: () => _anyEl(),
  });
}
function _setGlobal(name, value) {
  try {
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  } catch (_) {
    globalThis[name] = value;
  }
}
_setGlobal('window', {
  addEventListener() {},
  location: { hash: '' },
  innerWidth: 1280,
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
});
_setGlobal('navigator', { onLine: true, userAgent: 'test' });
_setGlobal(
  'document',
  new Proxy(
    {},
    {
      get: (_t, p) => {
        if (p === 'addEventListener') return () => {};
        if (p === 'querySelectorAll') return () => [];
        if (p === 'getElementById' || p === 'querySelector' || p === 'createElement') return (..._a) => _anyEl();
        if (p === 'head' || p === 'body') return _anyEl();
        if (p === 'visibilityState') return 'visible';
        return undefined;
      },
      set: () => true,
    }
  )
);
const _ls = {};
_setGlobal('localStorage', {
  getItem: (k) => (k in _ls ? _ls[k] : null),
  setItem: (k, v) => {
    _ls[k] = String(v);
  },
  removeItem: (k) => {
    delete _ls[k];
  },
});
globalThis.Dexie = class {
  constructor() {}
  version() {
    return { stores() {} };
  }
};

const _quietErr = console.error;
console.error = () => {};
try {
  vm.runInThisContext(fs.readFileSync('js/storage.js', 'utf8'), { filename: 'storage.js' });
  vm.runInThisContext(fs.readFileSync('js/ui.js', 'utf8'), { filename: 'ui.js' });
} finally {
  console.error = _quietErr;
}
console.debug = () => {};
console.warn = () => {};

describe('SEC-18 — logo do cliente em atributo src', () => {
  it('URL com aspa não quebra o atributo (normalizada + escapada)', () => {
    const html = clientAvatar({ name: 'ACME', logo: 'https://x.com/a' + D + 'onerror=' + D + 'alert(1)' });
    // a aspa vira %22 na normalização da URL e nunca aparece crua no atributo
    expect(html.includes(D + 'onerror=' + D)).toBe(false);
    expect(html).toContain('a%22onerror=%22alert(1)');
    expect(html).toContain('src="');
  });

  it('esquemas hostis continuam bloqueados', () => {
    expect(_safeLogoUrl('javascript:alert(1)')).toBe('#');
    expect(_safeLogoUrl('data:text/html,<script>')).toBe('#');
    expect(_safeLogoUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBe('#');
    expect(_safeLogoUrl('ftp://x.com/a')).toBe('#');
    expect(_safeLogoUrl('')).toBe('#');
    expect(_safeLogoUrl(null)).toBe('#');
  });

  it('logos legítimas são preservadas (http/https/data:image)', () => {
    expect(_safeLogoUrl('https://cdn.x.com/logo.png?v=2')).toBe('https://cdn.x.com/logo.png?v=2');
    expect(_safeLogoUrl('http://x.com/a b')).toContain('http://x.com/a');
    expect(_safeLogoUrl('data:image/png;base64,AAA')).toBe('data:image/png;base64,AAA');
  });

  it('o src interpolado passa por escapeHtml', () => {
    const src = fs.readFileSync('js/ui.js', 'utf8');
    expect(src).toContain('escapeHtml(_safeLogoUrl(c.logo))');
  });

  it('nome do cliente com aspa é escapado no alt', () => {
    const html = clientAvatar({ name: 'X' + D + ' y', logo: 'https://x.com/l.png' });
    expect(html).toContain('alt="X&quot; y"');
  });
});

describe('SEC-17 — badge de timer em atributo title', () => {
  const src = fs.readFileSync('js/timer.js', 'utf8');
  const st = src.indexOf('function workerBadgeHTML');
  const en = src.indexOf(NL + '}', st);
  const workerBadgeHTML = vm.runInNewContext('(' + src.slice(st, en + 2) + ')', {
    getCurrentWorker: (item) => (item && item.timerOperator) || '',
    isCurrentWorker: () => false,
    escapeHtml,
  });

  it('nome de operador com aspa não escapa do atributo title', () => {
    const evil = 'Evil' + D + ' onmouseover=' + D + 'alert(1)';
    const html = workerBadgeHTML({ timerRunning: true, timerOperator: evil });
    expect(html.includes('onmouseover=' + D)).toBe(false);
    expect(html).toContain('title="Evil&quot; onmouseover=&quot;alert(1)');
    expect(html).toContain('🟢 Evil&quot; onmouseover=&quot;alert(1');
  });

  it('nome simples segue legível (sem regressão de conteúdo)', () => {
    const html = workerBadgeHTML({ timerRunning: true, timerOperator: 'Maria' });
    expect(html).toContain('title="Maria está trabalhando neste item"');
    expect(html).toContain('🟢 Maria');
  });

  it('sem worker, não renderiza badge', () => {
    expect(workerBadgeHTML({})).toBe('');
  });

  it('o título interpola com escapeHtml (asserção de fonte)', () => {
    expect(src).toContain("escapeHtml(worker) + ' está trabalhando neste item'");
    expect(src.includes(': worker + ' + Q + ' está trabalhando')).toBe(false);
  });
});
