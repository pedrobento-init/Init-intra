import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

describe('validateOperator anti-duplicata', () => {
  let storage;
  const GIO = { id: 'OP-9', name: 'Giovane', email: 'giba@initnet.com.br' };
  beforeEach(() => {
    globalThis.getCacheStore = (store) => (store === 'operators' ? [GIO] : []);
    delete require.cache[require.resolve('../js/storage.js')];
    storage = require('../js/storage.js');
  });
  it('criação com e-mail repetido (case-insensitive) é rejeitada', () => {
    const errs = storage.validateOperator({ name: 'Giovane 2', email: 'GIBA@initnet.com.br' });
    expect(errs.some((e) => e.includes('Já existe um operador'))).toBe(true);
  });
  it('criação com e-mail novo passa', () => {
    expect(storage.validateOperator({ name: 'Novo', email: 'novo@initnet.com.br' })).toEqual([]);
  });
  it('edição do próprio registro não é bloqueada', () => {
    expect(storage.validateOperator({ id: 'OP-9', name: 'Giovane', email: 'giba@initnet.com.br' })).toEqual([]);
  });
  it('criação sem e-mail passa (campo opcional)', () => {
    expect(storage.validateOperator({ name: 'Sem email' })).toEqual([]);
  });
});
