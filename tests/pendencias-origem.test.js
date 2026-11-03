import { createRequire as __storageReq } from 'node:module';
const { requireStorage } = __storageReq(import.meta.url)('./_storage.cjs');
import { describe, it, expect, beforeEach } from 'vitest';

// Mesmo builder de tests/pagination.test.js: registra as chamadas encadeadas.
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
const temFiltroCanal = (q) =>
  q.calls.some(([m, a]) => (m === 'eq' && a === 'canal') || (m === 'or' && String(a).includes('canal.')));

describe('origem da pendência (abas Internas × E-mail)', () => {
  let storage;
  beforeEach(() => {
    globalThis.getOperatorNames = () => [];
    globalThis.escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    storage = requireStorage();
  });

  describe('penOrigemDe', () => {
    it('canal email vira aba E-mail', () => {
      expect(storage.penOrigemDe({ canal: 'email' })).toBe('email');
    });
    it('sem canal (pendência anterior à 056 ou criada na mão) é interna', () => {
      expect(storage.penOrigemDe({})).toBe('interna');
      expect(storage.penOrigemDe({ canal: null })).toBe('interna');
      expect(storage.penOrigemDe({ canal: '' })).toBe('interna');
    });
    it('whatsapp e telefone ficam em Internas: só a triagem de e-mail tem aba própria', () => {
      expect(storage.penOrigemDe({ canal: 'whatsapp' })).toBe('interna');
      expect(storage.penOrigemDe({ canal: 'telefone' })).toBe('interna');
    });
    it('comparação é exata, igual ao filtro do banco (Email maiúsculo não conta)', () => {
      expect(storage.penOrigemDe({ canal: 'Email' })).toBe('interna');
    });
    it('descrição com bloco de e-mail não muda a origem: quem decide é o canal', () => {
      expect(storage.penOrigemDe({ descricao: 'De: cliente@x.com\nAssunto: queda', canal: null })).toBe('interna');
    });
    it('pendência nula ou indefinida não quebra e cai em interna', () => {
      expect(storage.penOrigemDe(null)).toBe('interna');
      expect(storage.penOrigemDe(undefined)).toBe('interna');
    });
  });

  describe('penContarOrigens', () => {
    it('conta cada pendência em exatamente uma aba', () => {
      const lista = [{ canal: 'email' }, { canal: 'email' }, {}, { canal: 'whatsapp' }, { canal: null }];
      expect(storage.penContarOrigens(lista)).toEqual({ interna: 3, email: 2 });
    });
    it('lista vazia ou ausente devolve zeros nas duas abas', () => {
      expect(storage.penContarOrigens([])).toEqual({ interna: 0, email: 0 });
      expect(storage.penContarOrigens(null)).toEqual({ interna: 0, email: 0 });
    });
  });

  describe('applyPendenciaPageFilters com origem', () => {
    it("origem 'email' filtra canal = email", () => {
      const q = mockQ();
      storage.applyPendenciaPageFilters(q, { scope: 'active', team: 'mam', adminSeeAll: false, origem: 'email' });
      expect(has(q, 'eq', 'canal', 'email')).toBe(true);
    });
    it("origem 'interna' inclui canal nulo (neq sozinho perderia as sem canal)", () => {
      const q = mockQ();
      storage.applyPendenciaPageFilters(q, { scope: 'active', team: 'mam', adminSeeAll: false, origem: 'interna' });
      expect(has(q, 'or', 'canal.is.null,canal.neq.email')).toBe(true);
      expect(q.calls.some(([m, a]) => m === 'eq' && a === 'canal')).toBe(false);
    });
    it('sem origem não filtra canal (compatível com quem já chamava sem ela)', () => {
      const q = mockQ();
      storage.applyPendenciaPageFilters(q, { scope: 'active', team: 'mam', adminSeeAll: false });
      expect(temFiltroCanal(q)).toBe(false);
    });
    it('origem desconhecida é ignorada em vez de esconder tudo', () => {
      const q = mockQ();
      storage.applyPendenciaPageFilters(q, { scope: 'active', team: 'mam', adminSeeAll: false, origem: 'fax' });
      expect(temFiltroCanal(q)).toBe(false);
    });
    it('origem não afrouxa o escopo de team de quem não é admin', () => {
      const q = mockQ();
      storage.applyPendenciaPageFilters(q, { scope: 'active', team: 'bt', adminSeeAll: false, origem: 'email' });
      expect(has(q, 'eq', 'team', 'bt')).toBe(true);
      expect(has(q, 'eq', 'canal', 'email')).toBe(true);
    });
    it('origem convive com a busca: os dois or ficam separados', () => {
      const q = mockQ();
      storage.applyPendenciaPageFilters(q, { scope: 'active', team: 'mam', adminSeeAll: false, origem: 'interna', search: 'dell' });
      const ors = q.calls.filter(([m]) => m === 'or');
      expect(ors).toHaveLength(2);
      expect(ors[0][1]).toBe('canal.is.null,canal.neq.email');
      expect(ors[1][1]).toContain('dell');
    });
  });
});
