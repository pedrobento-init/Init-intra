import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const { isValidSignature, signatureFields } = createRequire(import.meta.url)('../js/visit-signature.js');

// Assinatura do cliente: só PNG em data URL (nada de link externo no <img>).
describe('assinatura da visita', () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgo=';

  it('aceita só PNG base64', () => {
    expect(isValidSignature(PNG)).toBe(true);
    expect(isValidSignature('https://evil.example/x.png')).toBe(false);
    expect(isValidSignature('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false);
    expect(isValidSignature('data:image/png;base64,abc"onerror=alert(1)')).toBe(false);
    expect(isValidSignature(null)).toBe(false);
  });

  it('signatureFields grava nome e horário; sem assinatura não mexe na visita', () => {
    const f = signatureFields({ dataUrl: PNG, nome: 'Maria' });
    expect(f.assinatura).toBe(PNG);
    expect(f.assinaturaNome).toBe('Maria');
    expect(Date.parse(f.assinaturaEm)).not.toBeNaN();
    expect(signatureFields(null)).toEqual({});
    expect(signatureFields({ dataUrl: 'x' })).toEqual({});
  });
});
