import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.window = globalThis.window || {};
const E = require('../js/error-log.js');

describe('registro de erros silenciosos', () => {
  it('a mesma falha no mesmo lugar conta uma vez, com contador', () => {
    expect(E._logSilent(new Error('falhou sync'), 'storage')).toBe(true);
    expect(E._logSilent(new Error('falhou sync'), 'storage')).toBe(false);
    expect(E._logSilent(new Error('falhou sync'), 'outbox')).toBe(true); // outro lugar
    const e = E.getLoggedErrors().find((x) => x.source === 'storage');
    expect(e.count).toBe(2);
  });
  it('nunca lança, mesmo com entrada estranha', () => {
    expect(() => E._logSilent(undefined, 'x')).not.toThrow();
    expect(() => E._logSilent({ message: 'obj' }, null)).not.toThrow();
  });
  it('tem teto por sessão', () => {
    for (let i = 0; i < 200; i++) E._logSilent(new Error('e' + i), 'loop');
    expect(E.getLoggedErrors().length).toBeLessThanOrEqual(60);
  });
});
