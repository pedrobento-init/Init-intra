import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const metrics = require('../js/metrics.js');

const { getPendenciaDisplayNumber } = metrics;

function pen(id, createdAt) {
  return { id, createdAt };
}

describe('getPendenciaDisplayNumber (só exibição, id interno intacto)', () => {
  it('ordena por createdAt crescente (#001 é a mais antiga)', () => {
    const list = [pen('PEN-c', '2024-05-03T10:00:00Z'), pen('PEN-a', '2024-05-01T10:00:00Z'), pen('PEN-b', '2024-05-02T10:00:00Z')];
    expect(getPendenciaDisplayNumber(list, 'PEN-a')).toBe('#001');
    expect(getPendenciaDisplayNumber(list, 'PEN-b')).toBe('#002');
    expect(getPendenciaDisplayNumber(list, 'PEN-c')).toBe('#003');
  });

  it('desempata por id quando createdAt é igual', () => {
    const list = [pen('PEN-b', '2024-05-01T10:00:00Z'), pen('PEN-a', '2024-05-01T10:00:00Z')];
    expect(getPendenciaDisplayNumber(list, 'PEN-a')).toBe('#001');
    expect(getPendenciaDisplayNumber(list, 'PEN-b')).toBe('#002');
  });

  it('formata com padStart(3), crescendo além de 999 sem truncar', () => {
    const ts = (i) => new Date(Date.UTC(2024, 4, 1, 10, 0, 0) + i * 1000).toISOString();
    const list = Array.from({ length: 1005 }, (_, i) => pen(`PEN-${i}`, ts(i)));
    expect(getPendenciaDisplayNumber(list.slice(0, 1), 'PEN-0')).toBe('#001');
    expect(getPendenciaDisplayNumber(list.slice(0, 9), 'PEN-8')).toBe('#009');
    expect(getPendenciaDisplayNumber(list.slice(0, 10), 'PEN-9')).toBe('#010');
    expect(getPendenciaDisplayNumber(list.slice(0, 100), 'PEN-99')).toBe('#100');
    expect(getPendenciaDisplayNumber(list, 'PEN-999')).toBe('#1000');
  });

  it('id desconhecido ou lista vazia retorna #--- (nunca quebra a tela)', () => {
    expect(getPendenciaDisplayNumber([pen('PEN-a', '2024-05-01T10:00:00Z')], 'PEN-zzz')).toBe('#---');
    expect(getPendenciaDisplayNumber([], 'PEN-a')).toBe('#---');
    expect(getPendenciaDisplayNumber(null, 'PEN-a')).toBe('#---');
  });

  it('é determinístico entre chamadas (consistente no reload)', () => {
    const list = [pen('PEN-b', '2024-05-02T10:00:00Z'), pen('PEN-a', '2024-05-01T10:00:00Z')];
    expect(getPendenciaDisplayNumber(list, 'PEN-a')).toBe(getPendenciaDisplayNumber(list, 'PEN-a'));
    expect(getPendenciaDisplayNumber([...list].reverse(), 'PEN-b')).toBe('#002');
  });

  it('não muta a lista de entrada', () => {
    const list = [pen('PEN-b', '2024-05-02T10:00:00Z'), pen('PEN-a', '2024-05-01T10:00:00Z')];
    const before = list.map((p) => p.id);
    getPendenciaDisplayNumber(list, 'PEN-a');
    expect(list.map((p) => p.id)).toEqual(before);
  });

  it('exclusão fecha o buraco (posteriores andam um número — Opção A)', () => {
    const list = [pen('PEN-a', '2024-05-01T10:00:00Z'), pen('PEN-b', '2024-05-02T10:00:00Z'), pen('PEN-c', '2024-05-03T10:00:00Z')];
    expect(getPendenciaDisplayNumber(list, 'PEN-c')).toBe('#003');
    const semB = list.filter((p) => p.id !== 'PEN-b');
    expect(getPendenciaDisplayNumber(semB, 'PEN-c')).toBe('#002');
  });
});
