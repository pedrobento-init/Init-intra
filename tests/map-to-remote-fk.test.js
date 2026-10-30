import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { _mapToRemote } = require('../js/schema.js');

describe('_mapToRemote — FK vazia', () => {
  it('client_id "" vira null (chamado sem cliente não quebra a FK na outbox)', () => {
    const out = _mapToRemote({ id: 'p1', clientId: '' }, { id: 'id', client_id: 'clientId' });
    expect(out.client_id).toBeNull();
  });

  it('texto vazio fora de *_id continua ""', () => {
    const out = _mapToRemote({ assunto: '' }, { assunto: 'assunto' });
    expect(out.assunto).toBe('');
  });
});
