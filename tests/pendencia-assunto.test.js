import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const metrics = require('../js/metrics.js');

const { getPendenciaAssunto, getPendenciaTitulo } = metrics;

describe('assunto x descrição da pendência', () => {
  it('assunto preenchido é o título', () => {
    expect(getPendenciaTitulo({ assunto: 'Trocar HD', descricao: 'Detalhes longos' })).toBe('Trocar HD');
  });

  it('registro antigo sem assunto usa descricao como fallback de leitura', () => {
    expect(getPendenciaTitulo({ assunto: '', descricao: 'Cabeamento andar 2' })).toBe('Cabeamento andar 2');
    expect(getPendenciaTitulo({ descricao: 'Só descricao' })).toBe('Só descricao');
  });

  it('sem assunto e sem descricao indica ausência', () => {
    expect(getPendenciaTitulo({})).toBe('Sem descrição');
    expect(getPendenciaTitulo(null)).toBe('Sem descrição');
  });

  it('assunto com espaços em branco é tratado como vazio', () => {
    expect(getPendenciaAssunto({ assunto: '   ' })).toBe('');
    expect(getPendenciaTitulo({ assunto: '  ', descricao: 'X' })).toBe('X');
  });

  it('assunto é aparado para exibição', () => {
    expect(getPendenciaAssunto({ assunto: '  Título  ' })).toBe('Título');
  });
});
