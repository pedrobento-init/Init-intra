import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildPrazosModel, classifyDeadline, prazosDaysBetween } = require('../js/prazos.js');

const TODAY = '2026-10-15';
let n = 0;
const pen = (over) => Object.assign({ id: 'P' + (++n), status: 'aberto', responsible: 'Ana', clientId: 'C1', clientName: 'Acme', priority: 'media' }, over);

describe('classifyDeadline', () => {
  it('separa vencida, hoje, em breve (até 3 dias), semana, futuro e sem prazo', () => {
    expect(classifyDeadline(pen({ deadline: '2026-10-14' }), TODAY)).toBe('vencida');
    expect(classifyDeadline(pen({ deadline: TODAY }), TODAY)).toBe('hoje');
    expect(classifyDeadline(pen({ deadline: '2026-10-18' }), TODAY)).toBe('breve');
    expect(classifyDeadline(pen({ deadline: '2026-10-22' }), TODAY)).toBe('semana');
    expect(classifyDeadline(pen({ deadline: '2026-11-30' }), TODAY)).toBe('futuro');
    expect(classifyDeadline(pen({}), TODAY)).toBe('sem_prazo');
  });
  it('conta dias de calendário (sem erro de fuso)', () => {
    expect(prazosDaysBetween('2026-10-31', '2026-11-01')).toBe(1);
    expect(prazosDaysBetween('2026-03-01', '2026-02-27')).toBe(-2);
  });
});

describe('buildPrazosModel', () => {
  const pens = [
    pen({ deadline: '2026-10-05' }),                       // Ana vencida há 10 dias
    pen({ deadline: '2026-10-13' }),                       // Ana vencida há 2
    pen({ deadline: TODAY, responsible: 'Beto' }),
    pen({ deadline: '2026-10-17', responsible: 'Beto' }),
    pen({ responsible: 'Beto' }),                          // sem prazo
    pen({ responsible: '', clientId: 'C2', clientName: 'Zeta' }),
    // Entregues nos últimos 30 dias (cumprimento)
    pen({ status: 'concluido', deadline: '2026-10-10', completedAt: '2026-10-09T15:00:00Z' }), // no prazo
    pen({ status: 'resolvido', deadline: '2026-10-10', completedAt: '2026-10-12T15:00:00Z' }), // atrasada
    pen({ status: 'concluido', deadline: '2026-08-01', completedAt: '2026-08-01T12:00:00Z' }), // fora da janela
    pen({ status: 'cancelado', deadline: '2026-10-01' }),                                      // não conta
  ];

  it('KPIs de risco e cumprimento', () => {
    const m = buildPrazosModel(pens, TODAY);
    expect(m.kpis).toMatchObject({ abertas: 6, vencidas: 2, hoje: 1, breve: 1, semPrazo: 2, entregues: 2, noPrazo: 1, pct: 50 });
  });

  it('agrupa por responsável com pior atraso, e quem tem mais vencidas vem primeiro', () => {
    const m = buildPrazosModel(pens, TODAY);
    expect(m.groups.map((g) => g.label)).toEqual(['Ana', 'Beto', 'Sem responsável']);
    const ana = m.groups[0];
    expect(ana).toMatchObject({ abertas: 2, vencidas: 2, piorAtraso: 10, entregues: 2, pct: 50 });
    expect(ana.items.map((i) => i.p.deadline)).toEqual(['2026-10-05', '2026-10-13']);
  });

  it('agrupa por cliente', () => {
    const m = buildPrazosModel(pens, TODAY, { groupBy: 'cliente' });
    expect(m.groupBy).toBe('cliente');
    expect(m.groups.map((g) => [g.label, g.abertas])).toEqual([['Acme', 5], ['Zeta', 1]]);
  });

  it('ordena os itens: vencidas, hoje, em breve, depois sem prazo', () => {
    const m = buildPrazosModel(pens, TODAY);
    const beto = m.groups.find((g) => g.label === 'Beto');
    expect(beto.items.map((i) => i.band)).toEqual(['hoje', 'breve', 'sem_prazo']);
  });

  it('sem nada entregue com prazo, cumprimento fica vazio (não 0%)', () => {
    const m = buildPrazosModel([pen({ deadline: '2026-10-20' })], TODAY);
    expect(m.kpis.pct).toBeNull();
  });
});
