import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  presencaListaDoEstado,
  presencaStatusDe,
  presencaSaudacao,
  presencaIniciais,
} = require('../js/presenca.js');

const meta = (over) =>
  Object.assign(
    { opId: 'op1', name: 'Ana', status: 'online', since: '2026-11-17T12:00:00Z' },
    over
  );

describe('presencaListaDoEstado', () => {
  it('a mesma pessoa em duas abas aparece uma vez, desde a conexão mais antiga', () => {
    const lista = presencaListaDoEstado({
      op1: [
        meta({ status: 'ausente', since: '2026-11-17T13:00:00Z' }),
        meta({ since: '2026-11-17T11:00:00Z' }),
      ],
    });
    expect(lista).toHaveLength(1);
    expect(lista[0].since).toBe('2026-11-17T11:00:00Z');
  });

  it('fica online se qualquer aba estiver online, mesmo que a primeira esteja ausente', () => {
    const lista = presencaListaDoEstado({
      op1: [meta({ status: 'ausente' }), meta({ status: 'online' })],
    });
    expect(lista[0].status).toBe('online');
  });

  it('ordena online antes de ausente e, dentro de cada grupo, por nome', () => {
    const lista = presencaListaDoEstado({
      a: [meta({ opId: 'a', name: 'Zé', status: 'online' })],
      b: [meta({ opId: 'b', name: 'Bia', status: 'ausente' })],
      c: [meta({ opId: 'c', name: 'Ana', status: 'online' })],
    });
    expect(lista.map((p) => p.name)).toEqual(['Ana', 'Zé', 'Bia']);
  });

  it('descarta meta sem opId e trata status desconhecido como online', () => {
    const lista = presencaListaDoEstado({
      x: [{ name: 'Sem id' }],
      op1: [meta({ status: 'qualquer' })],
    });
    expect(lista).toHaveLength(1);
    expect(lista[0].status).toBe('online');
  });

  it('estado vazio ou ausente vira lista vazia', () => {
    expect(presencaListaDoEstado({})).toEqual([]);
    expect(presencaListaDoEstado(null)).toEqual([]);
  });
});

describe('presencaStatusDe', () => {
  it('quem não está no canal é offline', () => {
    const lista = presencaListaDoEstado({ op1: [meta({ status: 'ausente' })] });
    expect(presencaStatusDe('op1', lista)).toBe('ausente');
    expect(presencaStatusDe('op2', lista)).toBe('offline');
  });
});

describe('presencaSaudacao', () => {
  it('bom dia das 5h ao meio-dia, boa tarde até 18h, boa noite no resto', () => {
    expect(presencaSaudacao(5)).toBe('Bom dia');
    expect(presencaSaudacao(11)).toBe('Bom dia');
    expect(presencaSaudacao(12)).toBe('Boa tarde');
    expect(presencaSaudacao(17)).toBe('Boa tarde');
    expect(presencaSaudacao(18)).toBe('Boa noite');
    expect(presencaSaudacao(2)).toBe('Boa noite');
  });
});

describe('presencaIniciais', () => {
  it('usa as iniciais cadastradas e, sem elas, primeira letra de dois nomes', () => {
    expect(presencaIniciais({ initials: 'pb', name: 'Pedro Bento' })).toBe('PB');
    expect(presencaIniciais({ name: 'Mariana Souza' })).toBe('MS');
    expect(presencaIniciais({ name: 'Joarli' })).toBe('JO');
    expect(presencaIniciais({ name: '' })).toBe('?');
  });
});
