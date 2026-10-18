import { createRequire as __partsReq } from 'node:module';
const { requireParts, partsSource } = __partsReq(import.meta.url)('./_parts.cjs');
import { createRequire as __storageReq } from 'node:module';
const { requireStorage, storageSource } = __storageReq(import.meta.url)('./_storage.cjs');
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

// Carrega ui.js + pendencias.js num sandbox mínimo (mesmo padrão dos testes
// do quadro) para testar as funções puras novas.
const _el = { addEventListener() {}, removeEventListener() {}, style: {}, classList: { add() {}, remove() {}, toggle() {} }, querySelector: () => null, querySelectorAll: () => [], innerHTML: '' };
const sandbox = {
  console,
  window: { addEventListener() {}, location: { hash: '#pendencias' }, matchMedia: () => ({ matches: false, addEventListener() {} }) },
  navigator: { onLine: true },
  document: { addEventListener() {}, getElementById: () => _el, querySelector: () => _el, querySelectorAll: () => [], createElement: () => ({ ..._el }), body: { classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, style: {} }, head: _el },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0,
  timerWidget: () => '',
};
sandbox.globalThis = sandbox;
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
const quiet = console.error; console.error = () => {};
try {
  vm.runInContext(fs.readFileSync('js/ui.js', 'utf8'), sandbox, { filename: 'ui.js' });
  vm.runInContext(partsSource('pendencias'), sandbox, { filename: 'pendencias.js' });
  vm.runInContext('globalThis.__t = { nextRecurrenceDate, nextRecurrenceDateFrom, RECURRENCE_OPTIONS, templateStepsToChecklist, penQuickMenuModel, penKanbanCard };', sandbox);
} finally { console.error = quiet; }
const T = sandbox.__t;

describe('recorrência', () => {
  it('mensal não escorrega no fim do mês (31/01 → 28/02 → 28/03)', () => {
    expect(T.nextRecurrenceDate('2027-01-31', 'monthly')).toBe('2027-02-28');
    expect(T.nextRecurrenceDate('2028-01-31', 'monthly')).toBe('2028-02-29'); // bissexto
    expect(T.nextRecurrenceDate('2027-03-31', 'monthly')).toBe('2027-04-30');
  });
  it('novas opções: trimestral e anual', () => {
    const values = T.RECURRENCE_OPTIONS.map((o) => o.value);
    expect(values).toContain('quarterly');
    expect(values).toContain('yearly');
    expect(T.nextRecurrenceDate('2027-11-30', 'quarterly')).toBe('2028-02-29');
    expect(T.nextRecurrenceDate('2028-02-29', 'yearly')).toBe('2029-02-28');
  });
  it('concluída com atraso: a próxima não nasce no passado', () => {
    expect(T.nextRecurrenceDateFrom('2026-09-01', 'weekly', '2026-10-15')).toBe('2026-10-20');
    expect(T.nextRecurrenceDateFrom('2026-10-14', 'monthly', '2026-10-15')).toBe('2026-11-14');
  });
  it('próxima ocorrência herda o checklist desmarcado (contrato no storage)', () => {
    const src = storageSource();
    expect(src).toMatch(/checklist: \(Array\.isArray\(data\.checklist\)[^]*done: false/);
  });
  it('card mostra o selo de recorrência', () => {
    const html = T.penKanbanCard({ id: 'P1', status: 'aberto', clientName: 'Acme', priority: 'media', assunto: 'Backup', recurrence: 'monthly' });
    expect(html).toContain('kc-recur');
    expect(html).toContain('Repete: Mensal');
  });
});

describe('modelos de pendência', () => {
  it('passos numerados viram itens', () => {
    expect(T.templateStepsToChecklist('1. Criar conta\n2) Liberar VPN\n\n3 - Entregar máquina')).toEqual(['Criar conta', 'Liberar VPN', 'Entregar máquina']);
  });
  it('marcadores e texto solto', () => {
    expect(T.templateStepsToChecklist('Intro do modelo\n- Item A\n• Item B')).toEqual(['Item A', 'Item B']);
    expect(T.templateStepsToChecklist('Linha 1\nLinha 2')).toEqual(['Linha 1', 'Linha 2']);
    expect(T.templateStepsToChecklist('')).toEqual([]);
  });
  it('limita a 30 itens', () => {
    const many = Array.from({ length: 40 }, (_, i) => `${i + 1}. Passo`).join('\n');
    expect(T.templateStepsToChecklist(many)).toHaveLength(30);
  });
});

describe('menu ⋯ do card', () => {
  const cols = [{ id: 'aberto', label: 'Aberto' }, { id: 'em_andamento', label: 'Em Andamento' }, { id: 'resolvido', label: 'Resolvido' }];
  const ops = [{ name: 'Ana' }, { name: 'Beto', onLeave: true }, { name: 'Caio', active: false }];
  it('não oferece o status atual; marca responsável atual e afastado', () => {
    const m = T.penQuickMenuModel({ status: 'aberto', responsible: 'Ana' }, cols, ops);
    expect(m.statuses.map((s) => s.id)).toEqual(['em_andamento', 'resolvido']);
    expect(m.people.map((p) => p.name)).toEqual(['Ana', 'Beto']); // inativo fora
    expect(m.people[0].current).toBe(true);
    expect(m.people[1].away).toBe(true);
  });
  it('card tem o botão ⋯ que não dispara o arrasto', () => {
    const html = T.penKanbanCard({ id: 'P2', status: 'aberto', clientName: 'Acme', priority: 'media', assunto: 'X' });
    expect(html).toContain('class="kc-menu"');
    expect(html).toContain('openPenQuickMenu(event,');
    expect(html).toContain('aria-haspopup="menu"');
  });
});
