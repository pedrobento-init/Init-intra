import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

describe('parseMentionedOperators', () => {
  let storage;
  beforeEach(() => {
    globalThis.getOperatorNames = () => ['Pedro', 'João Silva', 'Maria'];
    globalThis.escapeHtml = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    // clear require cache
    delete require.cache[require.resolve('../js/storage.js')];
    storage = require('../js/storage.js');
  });
  it('detecta @Pedro case-insensitive', () => {
    const r = storage.parseMentionedOperators('Oi @pedro tudo bem?');
    expect(r).toContain('Pedro');
  });
  it('detecta @João com acento e match para João Silva', () => {
    const r = storage.parseMentionedOperators('Chamar @João para revisar');
    expect(r).toContain('João Silva');
  });
  it('extrai múltiplos operadores', () => {
    const r = storage.parseMentionedOperators('@Pedro e @Maria resolver');
    expect(r).toContain('Pedro');
    expect(r).toContain('Maria');
    expect(r.length).toBe(2);
  });
  it('ignora nome não cadastrado', () => {
    const r = storage.parseMentionedOperators('@Inexistente teste');
    expect(r.length).toBe(0);
  });
  it('permite @Pedro com pontuação', () => {
    const r = storage.parseMentionedOperators('Olá @Pedro, pode verificar?');
    expect(r).toContain('Pedro');
  });
});

describe('highlightMentions', () => {
  let storage;
  beforeEach(() => {
    globalThis.getOperatorNames = () => ['Pedro', 'João Silva'];
    globalThis.escapeHtml = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    delete require.cache[require.resolve('../js/storage.js')];
    storage = require('../js/storage.js');
  });
  it('envolve @Nome com span estilizado', () => {
    const out = storage.highlightMentions('Oi @Pedro tudo bem');
    expect(out).toContain('<span style="background:#dbeafe;color:#1e40af;padding:1px 4px;border-radius:4px;font-weight:600">@Pedro</span>');
  });
  it('escapa HTML antes de destacar', () => {
    const out = storage.highlightMentions('<script>alert(1)</script> @Pedro');
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
    expect(out).toContain('@Pedro');
  });
  it('não destaca operador inexistente', () => {
    const out = storage.highlightMentions('Oi @Inexistente');
    expect(out).not.toContain('background:#dbeafe');
    expect(out).toContain('@Inexistente');
  });
});
