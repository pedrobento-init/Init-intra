import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// pendencias helpers are pure and exported via module
const pend = require('../js/pendencias.js');
const { suggestTemplateForDescription, _tokenizeWords } = pend;

describe('_tokenizeWords', () => {
  it('filtra palavras com >2 chars e remove pontuação', () => {
    const t = _tokenizeWords('Oi instalar VPN urgente!');
    expect(t).toContain('instalar');
    expect(t).not.toContain('oi');
  });
});

describe('suggestTemplateForDescription', () => {
  const templates = [
    { id:'TPL-1', title:'Backup', category:'Backup', content:'verificar backup Acronis espaço destino' },
    { id:'TPL-2', title:'VPN', category:'Rede', content:'configurar VPN colaboradores acesso remoto' },
  ];
  it('retorna template quando >=2 palavras batem', () => {
    const best = suggestTemplateForDescription('preciso configurar VPN para colaboradores', templates);
    expect(best).not.toBeNull();
    expect(best.id).toBe('TPL-2');
  });
  it('retorna null quando insuficiente', () => {
    const best = suggestTemplateForDescription('olá mundo simples', templates);
    expect(best).toBeNull();
  });
  it('considera 50% das palavras como match', () => {
    const tpl = [{ id:'TPL-X', title:'Onboarding', category:'', content:'criar e-mail permissões pastas' }];
    const best = suggestTemplateForDescription('criar e-mail', tpl);
    // words = ['criar','email'] => 2/2 =100% >=50% => match
    expect(best).not.toBeNull();
  });
  it('escolhe melhor score quando múltiplos', () => {
    const tpls = [
      { id:'A', title:'A', category:'', content:'backup validar espaço' },
      { id:'B', title:'B', category:'', content:'backup validar espaço Acronis Google Drive sincronizado' },
    ];
    const best = suggestTemplateForDescription('verificar backup Acronis espaço Google Drive', tpls);
    expect(best.id).toBe('B');
  });
});
