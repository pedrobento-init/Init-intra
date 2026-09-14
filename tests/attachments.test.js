import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

describe('_dataUrlToBlob (FASE 2 — backfill base64 para Storage)', () => {
  let storage;
  beforeEach(() => {
    globalThis.getOperatorNames = () => [];
    globalThis.escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    delete require.cache[require.resolve('../js/storage.js')];
    storage = require('../js/storage.js');
  });
  it('converte dataURL png em Blob com mime e bytes corretos', () => {
    // 1x1 png
    const d = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const b = storage._dataUrlToBlob(d);
    expect(b).not.toBeNull();
    expect(b.type).toBe('image/png');
    expect(b.size).toBeGreaterThan(0);
  });
  it('converte texto simples e preserva conteúdo', async () => {
    const d = 'data:text/plain;base64,aGVsbG8=';
    const b = storage._dataUrlToBlob(d);
    expect(b.type).toBe('text/plain');
    expect(await b.text()).toBe('hello');
  });
  it('retorna null para entrada inválida (sem quebrar)', () => {
    expect(storage._dataUrlToBlob(null)).toBeNull();
    expect(storage._dataUrlToBlob('')).toBeNull();
    expect(storage._dataUrlToBlob('https://x.com/a.png')).toBeNull();
    expect(storage._dataUrlToBlob('data:;base64,!!!')).toBeNull();
  });
});
