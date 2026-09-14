import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// Builder mock que registra chamadas e permite encadeamento.
function mockQ() {
  const calls = [];
  const q = {};
  for (const m of ['eq', 'in', 'not', 'or', 'order', 'range', 'select']) {
    q[m] = (...args) => { calls.push([m, ...args]); return q; };
  }
  q.calls = calls;
  return q;
}
const has = (q, method, ...prefix) =>
  q.calls.some(([m, ...a]) => m === method && prefix.every((p, i) => JSON.stringify(a[i]) === JSON.stringify(p)));

describe('applyPendenciaPageFilters (FASE 3 — paginação por escopo)', () => {
  let storage;
  beforeEach(() => {
    globalThis.getOperatorNames = () => [];
    globalThis.escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    delete require.cache[require.resolve('../js/storage.js')];
    storage = require('../js/storage.js');
  });
  it('não-admin SEMPRE restringe ao próprio team (nunca amplo)', () => {
    const q = mockQ();
    storage.applyPendenciaPageFilters(q, { scope: 'active', team: 'mam', adminSeeAll: false });
    expect(has(q, 'eq', 'team', 'mam')).toBe(true);
  });
  it('admin sem filtro não impõe team (RLS is_admin cobre)', () => {
    const q = mockQ();
    storage.applyPendenciaPageFilters(q, { scope: 'active', team: null, adminSeeAll: true });
    expect(q.calls.some(([m, a]) => m === 'eq' && a === 'team')).toBe(false);
  });
  it("scope active exclui fechados; archived inclui só fechados", () => {
    const qa = mockQ();
    storage.applyPendenciaPageFilters(qa, { scope: 'active', team: 'mam', adminSeeAll: false });
    expect(has(qa, 'not', 'status', 'in', '(concluido,resolvido,cancelado,fechado)')).toBe(true);
    const qb = mockQ();
    storage.applyPendenciaPageFilters(qb, { scope: 'archived', team: 'mam', adminSeeAll: false });
    expect(has(qb, 'in', 'status', ['concluido', 'resolvido', 'cancelado', 'fechado'])).toBe(true);
  });
  it('filtros opcionais viram eq somente quando preenchidos', () => {
    const q = mockQ();
    storage.applyPendenciaPageFilters(q, { scope: 'active', team: 'bt', adminSeeAll: false, clientId: 'CLI-1', priority: 'alta' });
    expect(has(q, 'eq', 'client_id', 'CLI-1')).toBe(true);
    expect(has(q, 'eq', 'priority', 'alta')).toBe(true);
    expect(q.calls.some(([m, a]) => m === 'eq' && a === 'responsible')).toBe(false);
    expect(q.calls.some(([m, a]) => m === 'eq' && a === 'status')).toBe(false);
  });
  it('busca usa ilike com sanitização (sem % _ nem quebra do or)', () => {
    const q = mockQ();
    storage.applyPendenciaPageFilters(q, { scope: 'active', team: 'mam', adminSeeAll: false, search: 'dell% (urgente),x' });
    const orCall = q.calls.find(([m]) => m === 'or');
    expect(orCall).toBeTruthy();
    expect(orCall[1]).not.toContain('%dell%%');
    expect(orCall[1]).toContain('dell');
  });
  it('busca vazia não adiciona or', () => {
    const q = mockQ();
    storage.applyPendenciaPageFilters(q, { scope: 'active', team: 'mam', adminSeeAll: false, search: '   ' });
    expect(q.calls.some(([m]) => m === 'or')).toBe(false);
  });
});

describe('countPendenciaStatuses (FASE 6 — totais do banco)', () => {
  let storage;
  beforeEach(() => {
    globalThis.getOperatorNames = () => [];
    globalThis.escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    delete require.cache[require.resolve('../js/storage.js')];
    storage = require('../js/storage.js');
  });
  it('agrega por status com total', () => {
    const r = storage.countPendenciaStatuses([
      { status: 'aberto' }, { status: 'aberto' }, { status: 'em_andamento' },
    ]);
    expect(r).toEqual({ byStatus: { aberto: 2, em_andamento: 1 }, total: 3 });
  });
  it('status ausente cai em aberto; vazio retorna zeros', () => {
    expect(storage.countPendenciaStatuses([{}, { status: null }])).toEqual({ byStatus: { aberto: 2 }, total: 2 });
    expect(storage.countPendenciaStatuses([])).toEqual({ byStatus: {}, total: 0 });
    expect(storage.countPendenciaStatuses(null)).toEqual({ byStatus: {}, total: 0 });
  });
});
