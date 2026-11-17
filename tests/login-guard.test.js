import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';

// SEC-08: a trava do login sobrevive ao reload e escala com backoff exponencial.
// (É atrito no cliente; a defesa real é server-side — ver comentário em js/auth.js.)
const src = fs.readFileSync('js/auth.js', 'utf8');
const block = src.slice(src.indexOf('const LOGIN_GUARD_KEY'), src.indexOf('/**\n * Realiza login'));

// Cada chamada é um "reload": estado em memória novo, mesmo storage.
const load = (storage) =>
  new Function('localStorage', block + '\nreturn { loginLockRemainingMs, formatLoginLockWait, _assertLoginAllowed, _recordLoginFailure, _recordLoginSuccess };')(storage);

const memStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
};
const fail = (g, n) => { for (let i = 0; i < n; i++) g._recordLoginFailure(); };

describe('trava de login (SEC-08)', () => {
  let st;
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-17T12:00:00Z')); st = memStorage(); });
  afterEach(() => vi.useRealTimers());

  it('4 falhas não travam; a 5ª trava por 30 s', () => {
    const g = load(st);
    fail(g, 4);
    expect(() => g._assertLoginAllowed()).not.toThrow();
    fail(g, 1);
    expect(g.loginLockRemainingMs()).toBe(30000);
    expect(() => g._assertLoginAllowed()).toThrow(/Muitas tentativas\. Aguarde 30 s/);
  });

  it('sobrevive ao reload: outro módulo carregado lê a mesma trava e a contagem parcial', () => {
    const a = load(st);
    fail(a, 5);
    const b = load(st); // "reload"
    expect(b.loginLockRemainingMs()).toBe(30000);
    const c = load(memStorage());
    expect(c.loginLockRemainingMs()).toBe(0); // storage novo = sem estado
    const d = load(st);
    vi.advanceTimersByTime(31000);
    fail(d, 3);
    const e = load(st);
    fail(e, 2); // 3 + 2 = 5 atravessando o reload
    expect(e.loginLockRemainingMs()).toBeGreaterThan(0);
  });

  it('backoff exponencial: 30 s, 60 s, 120 s… com teto de 30 min', () => {
    const g = load(st);
    const waits = [];
    for (let nivel = 0; nivel < 9; nivel++) {
      fail(g, 5);
      waits.push(g.loginLockRemainingMs());
      vi.advanceTimersByTime(g.loginLockRemainingMs() + 1);
    }
    expect(waits.slice(0, 4)).toEqual([30000, 60000, 120000, 240000]);
    expect(Math.max(...waits)).toBe(30 * 60 * 1000);
    expect(waits[8]).toBe(30 * 60 * 1000);
  });

  it('o tempo restante diminui e libera no fim; mensagem em pt-BR mostra minutos e segundos', () => {
    const g = load(st);
    fail(g, 5); fail(g, 0);
    vi.advanceTimersByTime(30001);
    expect(g.loginLockRemainingMs()).toBe(0);
    fail(g, 5); // nível 1: 60 s
    vi.advanceTimersByTime(10000);
    expect(g.loginLockRemainingMs()).toBe(50000);
    expect(g.formatLoginLockWait(125000)).toBe('2 min 5 s');
    expect(g.formatLoginLockWait(120000)).toBe('2 min');
    expect(g.formatLoginLockWait(500)).toBe('1 s');
  });

  it('sucesso zera contagem, nível e remove o registro do storage', () => {
    const g = load(st);
    fail(g, 5);
    vi.advanceTimersByTime(31000);
    g._recordLoginSuccess();
    expect(st._m.size).toBe(0);
    fail(g, 5);
    expect(g.loginLockRemainingMs()).toBe(30000); // voltou ao nível 0
  });

  it('1 h sem falhar zera o nível de backoff', () => {
    const g = load(st);
    fail(g, 5); vi.advanceTimersByTime(31000);
    fail(g, 5); vi.advanceTimersByTime(61000); // nível agora 2 (próxima trava = 120 s)
    vi.advanceTimersByTime(61 * 60 * 1000);
    const r = load(st);
    fail(r, 5);
    expect(r.loginLockRemainingMs()).toBe(30000);
  });

  it('storage que lança (modo privado/bloqueado): continua funcionando em memória', () => {
    const boom = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } };
    const g = load(boom);
    fail(g, 5);
    expect(g.loginLockRemainingMs()).toBe(30000);
    expect(() => g._recordLoginSuccess()).not.toThrow();
    expect(g.loginLockRemainingMs()).toBe(0);
  });

  it('localStorage ausente (undefined) também não derruba', () => {
    const g = load(undefined);
    expect(() => fail(g, 5)).not.toThrow();
    expect(g.loginLockRemainingMs()).toBe(30000);
  });

  it('registro adulterado/corrompido é ignorado; relógio voltado não passa do teto', () => {
    st.setItem('initintra:login-guard', '{nao e json');
    expect(load(st).loginLockRemainingMs()).toBe(0);
    st.setItem('initintra:login-guard', JSON.stringify({ fails: 'x', level: -3, lockUntil: Date.now() + 10 * 24 * 3600 * 1000 }));
    expect(load(st).loginLockRemainingMs()).toBe(30 * 60 * 1000);
    st.setItem('initintra:login-guard', JSON.stringify({ lockUntil: 'abc' }));
    expect(load(st).loginLockRemainingMs()).toBe(0);
  });
});
