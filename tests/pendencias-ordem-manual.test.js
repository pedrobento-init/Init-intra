import { createRequire as __partsReq } from 'node:module';
const { partsSource } = __partsReq(import.meta.url)('./_parts.cjs');
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

// Ordem manual do quadro (migration 062): `position` fracionária, menor
// primeiro, e quem nunca foi arrastado (position null) vai para o FIM.
//
// Regressão que motivou este arquivo: `Number(null)` é 0 e 0 é finito, então
// a primeira versão de _penPos tratava "sem posição" como posição zero e
// jogava esses cards para o TOPO. Pego ao rodar no navegador, não pelo tipo.

const _dummyEl = {
  addEventListener() {}, removeEventListener() {}, style: {},
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  querySelector: () => null, querySelectorAll: () => [],
};
const sandbox = {
  console,
  window: { matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }), addEventListener() {} },
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
  setTimeout: () => 0,
  clearTimeout: () => {},
};
sandbox.globalThis = sandbox;
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
const _quietErr = console.error;
console.error = () => {};
try {
  vm.runInContext(fs.readFileSync('js/ui.js', 'utf8'), sandbox, { filename: 'ui.js' });
  vm.runInContext(partsSource('pendencias'), sandbox, { filename: 'pendencias.js' });
  vm.runInContext('globalThis.__t = { _penSortCards, _penPos, _penColSort, cyclePenColSort };', sandbox);
} finally {
  console.error = _quietErr;
}
const T = sandbox.__t;

const ordenar = (cards, colId) => T._penSortCards(cards, colId).map((c) => c.id).join(',');
const comModoManual = (colId, fn) => {
  T._penColSort[colId] = 'manual';
  try { return fn(); } finally { delete T._penColSort[colId]; }
};

describe('_penPos — "sem posição" não pode virar zero', () => {
  it('null, undefined e string vazia são ausência, não a posição 0', () => {
    expect(T._penPos({ position: null })).toBeNull();
    expect(T._penPos({ position: undefined })).toBeNull();
    expect(T._penPos({ position: '' })).toBeNull();
    expect(T._penPos({})).toBeNull();
    expect(T._penPos(null)).toBeNull();
  });

  it('zero continua sendo uma posição válida', () => {
    expect(T._penPos({ position: 0 })).toBe(0);
  });

  it('número em texto vale; lixo não', () => {
    expect(T._penPos({ position: '2.5' })).toBe(2.5);
    expect(T._penPos({ position: 'abc' })).toBeNull();
  });
});

describe('ordem manual', () => {
  const cards = [
    { id: 'a', position: 3, createdAt: '2026-01-01' },
    { id: 'b', position: 1, createdAt: '2026-01-02' },
    { id: 'c', position: null, createdAt: '2026-01-03' },
    { id: 'd', position: 2, createdAt: '2026-01-04' },
    { id: 'e', position: null, createdAt: '2026-01-02' },
  ];

  it('ordena por position e joga os sem posição para o fim', () => {
    expect(comModoManual('aberto', () => ordenar(cards, 'aberto'))).toBe('b,d,a,e,c');
  });

  it('entre os sem posição, vale a ordem de criação', () => {
    const sos = [
      { id: 'novo', position: null, createdAt: '2026-05-01' },
      { id: 'velho', position: null, createdAt: '2026-01-01' },
    ];
    expect(comModoManual('aberto', () => ordenar(sos, 'aberto'))).toBe('velho,novo');
  });

  it('posição fracionária cai entre as inteiras (é o que o arrasto grava)', () => {
    const frac = [
      { id: 'um', position: 1, createdAt: '2026-01-01' },
      { id: 'meio', position: 1.5, createdAt: '2026-01-02' },
      { id: 'dois', position: 2, createdAt: '2026-01-03' },
    ];
    expect(comModoManual('aberto', () => ordenar(frac, 'aberto'))).toBe('um,meio,dois');
  });

  it('posição negativa ordena antes (é como um card vai para o topo)', () => {
    const neg = [
      { id: 'primeiro', position: -1, createdAt: '2026-01-09' },
      { id: 'zero', position: 0, createdAt: '2026-01-01' },
    ];
    expect(comModoManual('aberto', () => ordenar(neg, 'aberto'))).toBe('primeiro,zero');
  });

  it('sem o modo manual, position é ignorada e vale a criação', () => {
    expect(ordenar(cards, 'aberto')).toBe('a,b,e,c,d');
  });
});

describe('ciclo de ordenação da coluna', () => {
  it('criação → prazo → prioridade → manual → criação', () => {
    const col = 'em_andamento';
    const visto = [];
    for (let i = 0; i < 4; i++) {
      T.cyclePenColSort(col);
      visto.push(T._penColSort[col]);
    }
    delete T._penColSort[col];
    expect(visto).toEqual(['prazo', 'prioridade', 'manual', 'criacao']);
  });
});
