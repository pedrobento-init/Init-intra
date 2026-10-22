import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);

const { cwPassoInicial, cwResumo, CW_PASSOS } = req('../js/visita-guiada.js');
const SIG = 'data:image/png;base64,iVBORw0KGgo=';

beforeAll(() => {
  globalThis.isValidSignature = req('../js/visit-signature.js').isValidSignature;
});

describe('Atendimento guiado — etapa inicial', () => {
  it('cinco etapas na ordem do atendimento', () => {
    expect(CW_PASSOS.map((p) => p.k)).toEqual(['chegada', 'fotos', 'relatorio', 'assinatura', 'concluir']);
  });

  it('sem chegada registrada começa na Chegada (mesmo com etapa salva)', () => {
    expect(cwPassoInicial({ status: 'agendada' }, null)).toBe(0);
    expect(cwPassoInicial({ status: 'agendada' }, '3')).toBe(0);
  });

  it('volta para a etapa onde parou', () => {
    expect(cwPassoInicial({ checkinAt: '2026-10-21T12:00:00Z' }, '2')).toBe(2);
    expect(cwPassoInicial({ checkinAt: '2026-10-21T12:00:00Z' }, '0')).toBe(0);
  });

  it('etapa salva inválida cai no que a visita já tem', () => {
    const v = { checkinAt: '2026-10-21T12:00:00Z' };
    expect(cwPassoInicial(v, '9')).toBe(1);
    expect(cwPassoInicial(v, 'x')).toBe(1);
    expect(cwPassoInicial({ ...v, relatorio: 'Troquei o switch' }, null)).toBe(3);
    expect(cwPassoInicial({ ...v, relatorio: 'Troquei o switch', assinatura: SIG }, null)).toBe(4);
  });

  it('visita ausente não quebra', () => {
    expect(cwPassoInicial(null, '2')).toBe(0);
  });
});

describe('Atendimento guiado — resumo antes de concluir', () => {
  it('aponta o que falta e qual é obrigatório', () => {
    const r = cwResumo({ status: 'em_andamento' }, 0);
    expect(r.map((x) => x.ok)).toEqual([false, false, false, false]);
    expect(r.filter((x) => x.obrigatorio).map((x) => x.passo)).toEqual([2]);
    expect(r[2].texto).toBe('Falta o relatório');
  });

  it('tudo feito', () => {
    const r = cwResumo({ checkinAt: '2026-10-21T12:05:00Z', relatorio: 'ok', assinatura: SIG, assinaturaNome: 'Ana' }, 3);
    expect(r.every((x) => x.ok)).toBe(true);
    expect(r[1].texto).toBe('3 fotos');
    expect(r[3].texto).toBe('Assinado por Ana');
  });

  it('uma foto no singular', () => {
    expect(cwResumo({}, 1)[1].texto).toBe('1 foto');
  });
});
