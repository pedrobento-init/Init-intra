import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// SRI (Subresource Integrity): todo <script> externo precisa de integrity +
// crossorigin, senão um CDN comprometido executa no contexto do app.
// Regressão: motion@13.1.1 entrou sem integrity (auditoria SEC-04).
const html = fs.readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');

function externalScripts(source) {
  const out = [];
  const re = /<script\b([^>]*)\bsrc="([^"]+)"([^>]*)>/g;
  let m;
  while ((m = re.exec(source))) {
    const attrs = (m[1] || '') + ' ' + (m[3] || '');
    if (!/^https?:\/\//.test(m[2])) continue;
    out.push({
      src: m[2],
      integrity: /(?:^|\s)integrity="([^"]+)"/.exec(attrs)?.[1] || '',
      crossorigin: /(?:^|\s)crossorigin(?:[=>\s]|$)/.test(attrs),
    });
  }
  return out;
}

describe('SRI dos scripts de terceiros no index.html', () => {
  const scripts = externalScripts(html);

  it('há scripts externos para validar', () => {
    expect(scripts.length).toBeGreaterThanOrEqual(2); // supabase-js e dexie; o resto vem sob demanda
  });

  it('todos declaram integrity sha384-...', () => {
    for (const s of scripts) {
      expect(s.integrity, s.src).toMatch(/^sha384-[A-Za-z0-9+/=]+$/);
    }
  });

  it('todos declaram crossorigin (obrigatório p/ SRI em CDN)', () => {
    for (const s of scripts) {
      expect(s.crossorigin, s.src).toBe(true);
    }
  });
});

// Scripts carregados sob demanda (Chart.js, FullCalendar) também precisam de
// versão fixa e SRI: `npm/chart.js` sem versão entrega sempre a última.
describe('scripts carregados sob demanda (js/ui.js)', () => {
  const ui = fs.readFileSync(fileURLToPath(new URL('../js/ui.js', import.meta.url)), 'utf8');
  const calls = [...ui.matchAll(/loadScript\(\s*'([^']+)'\s*(?:,\s*'([^']+)')?\s*\)/g)];

  it('há chamadas para validar', () => {
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it('cada URL tem versão exata e integrity sha384', () => {
    for (const [, url, sri] of calls) {
      expect(url, url).toMatch(/@\d+\.\d+\.\d+\//);
      expect(sri || '', url).toMatch(/^sha384-[A-Za-z0-9+/=]+$/);
    }
  });
});

// xlsx, mammoth e motion saíram do index.html (eram baixados em todo acesso)
// e vêm sob demanda por js/lazy-libs.js — com a mesma exigência de SRI.
describe('bibliotecas sob demanda (js/lazy-libs.js)', () => {
  const require = createRequire(import.meta.url);
  const { LAZY_LIBS } = require('../js/lazy-libs.js');

  it('cada uma tem versão exata, integrity sha384 e o global esperado', () => {
    expect(Object.keys(LAZY_LIBS).sort()).toEqual(['mammoth', 'motion', 'xlsx']);
    for (const [name, lib] of Object.entries(LAZY_LIBS)) {
      expect(lib.src, name).toMatch(/^https:\/\/cdn\.jsdelivr\.net\/npm\/[^/]+@\d+\.\d+\.\d+\//);
      expect(lib.integrity, name).toMatch(/^sha384-[A-Za-z0-9+/=]+$/);
      expect(lib.global, name).toMatch(/^[A-Za-z]+$/);
    }
  });

  it('nenhuma delas volta a ser carregada direto no index.html', () => {
    for (const lib of Object.values(LAZY_LIBS)) expect(html, lib.src).not.toContain(lib.src);
  });
});
