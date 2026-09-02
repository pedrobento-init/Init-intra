import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const search = require('../js/global-search.js');

const { parseSearchShortcuts, getNoteSnippet } = search;

describe('global-search parseSearchShortcuts', () => {
  it('extrai filtro cliente e status com texto livre', () => {
    const r = parseSearchShortcuts('status:aberto pagamento');
    expect(r.filters.status).toBe('aberto');
    expect(r.remainingText).toBe('pagamento');
  });
  it('suporta valores com aspas', () => {
    const r = parseSearchShortcuts('cliente:"Padaria Central" teste');
    expect(r.filters.cliente).toBe('Padaria Central');
    expect(r.remainingText).toBe('teste');
  });
  it('múltiplos filtros', () => {
    const r = parseSearchShortcuts('cliente:Padaria status:aberto urgente');
    expect(r.filters.cliente).toBe('Padaria');
    expect(r.filters.status).toBe('aberto');
    expect(r.remainingText).toBe('urgente');
  });
  it('texto sem filtros', () => {
    const r = parseSearchShortcuts('pagamento simples');
    expect(Object.keys(r.filters).length).toBe(0);
    expect(r.remainingText).toBe('pagamento simples');
  });
});

describe('global-search getNoteSnippet', () => {
  it('gera preview com 60 chars ao redor e <mark>', () => {
    const text = 'x'.repeat(70) + ' nota importante sobre pagamento ' + 'y'.repeat(70);
    const snip = getNoteSnippet(text, 'pagamento', 60);
    expect(snip).toContain('<mark>pagamento</mark>');
    expect(snip.length).toBeGreaterThan(0);
  });
  it('escapa HTML no snippet', () => {
    const text = 'antes <script>alert(1)</script> pagamento depois';
    const snip = getNoteSnippet(text, 'pagamento', 60);
    expect(snip).not.toContain('<script>');
    expect(snip).toContain('&lt;script&gt;');
    expect(snip).toContain('<mark>pagamento</mark>');
  });
  it('retorna null sem match', () => {
    expect(getNoteSnippet('hello', 'world')).toBeNull();
  });
});
