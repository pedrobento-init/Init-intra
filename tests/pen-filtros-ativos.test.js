import { createRequire as __partsReq } from 'node:module';
const { partsSource } = __partsReq(import.meta.url)('./_parts.cjs');
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

// ── Filtros ativos à vista ────────────────────────────────────────────────
// Quase todo filtro de pendências mora dentro do painel "Mais filtros", que
// fecha. Sem os selos, a lista encolhia e só um número no badge dizia que
// havia filtro — nunca qual.

const _dummyEl = {
  addEventListener() {}, removeEventListener() {}, style: {},
  classList: { add() {}, remove() {}, toggle() {} },
  querySelector: () => null, querySelectorAll: () => [],
  innerHTML: '',
};
// Campos da barra: cada um responde por id, como no DOM real.
const campos = {};
const campo = (id, tag, value, optLabel) => {
  campos[id] = {
    ..._dummyEl, id, tagName: tag, value,
    selectedOptions: optLabel ? [{ textContent: optLabel }] : [],
  };
};

const sandbox = {
  console,
  window: { addEventListener() {}, location: { hash: '#pendencias' } },
  navigator: { onLine: true },
  document: {
    addEventListener() {},
    // ui.js liga ouvintes a elementos fixos no load: o dummy evita null,
    // e quem não é campo da barra não tem `value` — logo, não vira selo.
    getElementById: (id) => campos[id] || _dummyEl,
    querySelector: () => _dummyEl,
    querySelectorAll: () => [],
    createElement: () => ({ ..._dummyEl }),
    body: { classList: { add() {}, remove() {}, toggle() {} }, style: {} },
    head: _dummyEl,
  },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  setTimeout: () => 0,
  clearTimeout: () => {},
  timerWidget: () => '',
};
sandbox.globalThis = sandbox;
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
const _quietErr = console.error;
console.error = () => {};
try {
  vm.runInContext(fs.readFileSync('js/ui.js', 'utf8'), sandbox, { filename: 'ui.js' });
  vm.runInContext(partsSource('pendencias'), sandbox, { filename: 'pendencias.js' });
} finally {
  console.error = _quietErr;
}

beforeEach(() => { for (const k of Object.keys(campos)) delete campos[k]; });

describe('penFiltrosAtivos: o que está preso agora', () => {
  it('campo vazio não vira selo', () => {
    campo('penSearch', 'INPUT', '');
    campo('penClient', 'SELECT', '', 'Todos os clientes');
    expect(sandbox.penFiltrosAtivos()).toEqual([]);
  });

  it('select mostra o rótulo da opção, nunca o id cru do cliente', () => {
    campo('penClient', 'SELECT', 'CLI-7', 'Galvão e Raça');
    const [chip] = sandbox.penFiltrosAtivos();
    expect(chip.texto).toBe('Galvão e Raça');
    expect(chip.campo).toBe('penClient');
  });

  it('busca mostra o que foi digitado', () => {
    campo('penSearch', 'INPUT', 'bitlocker');
    expect(sandbox.penFiltrosAtivos()[0].texto).toBe('bitlocker');
  });

  it('vários filtros saem na ordem da barra', () => {
    campo('penSearch', 'INPUT', 'vpn');
    campo('penPriority', 'SELECT', 'alta', 'Alta');
    campo('penStatus', 'SELECT', 'aberto', 'Aberto');
    expect(sandbox.penFiltrosAtivos().map((f) => f.nome)).toEqual(['Busca', 'Status', 'Prioridade']);
  });
});

describe('penFiltroChipsHtml: a fila de selos', () => {
  it('sem filtro, nada é desenhado', () => {
    expect(sandbox.penFiltroChipsHtml([])).toBe('');
  });

  it('cada selo tem o ✕ que remove só aquele filtro', () => {
    const html = sandbox.penFiltroChipsHtml([{ campo: 'penStatus', nome: 'Status', texto: 'Aberto' }]);
    expect(html).toContain('data-action="penClearFilter" data-arg="penStatus"');
    expect(html).toContain('aria-label="Remover filtro Status: Aberto"');
  });

  it('a fila termina com "Limpar tudo"', () => {
    const html = sandbox.penFiltroChipsHtml([{ campo: 'penSearch', nome: 'Busca', texto: 'vpn' }]);
    expect(html).toContain('data-action="penClearFilters"');
  });

  it('nome de cliente com < > não escapa para o HTML', () => {
    const html = sandbox.penFiltroChipsHtml([{ campo: 'penClient', nome: 'Cliente', texto: '<img onerror=x>' }]);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('nada de handler inline: os selos passam pela delegação', () => {
    const html = sandbox.penFiltroChipsHtml([{ campo: 'penStatus', nome: 'Status', texto: 'Aberto' }]);
    expect(html).not.toMatch(/\son(click|change)=/);
  });
});
