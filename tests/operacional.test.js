import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildOperationalCenter, buildVisitMetrics } = require('../js/operacional.js');
const { visitDurationMinutes } = require('../js/relatorio-cliente.js');
globalThis.visitDurationMinutes = visitDurationMinutes;

describe('central operacional', () => {
  const now = new Date(2026, 10, 3, 12, 0);
  it('reúne divergência do Milvus, relatório ausente e pendência vencida', () => {
    const visits = [
      { id: 'v1', clientId: 'c1', clientName: 'A', status: 'em_andamento', milvusChamadoCodigo: 1 },
      { id: 'v2', clientId: 'c2', clientName: 'B', status: 'concluida', relatorio: '' },
    ];
    const items = buildOperationalCenter(visits, [{ id: 'p1', status: 'aberto', deadline: '2026-11-02', clientName: 'C' }], { v1: { kind: 'finalizado' } }, now);
    expect(items.map(i => i.kind)).toEqual(['milvus', 'relatorio', 'prazo']);
  });

  it('alerta atraso, visita longa e deslocamento curto', () => {
    const visits = [
      { id: 'v1', clientId: 'c1', clientName: 'A', operator: 'Ana', date: '2026-11-03', time: '10:00', timeEnd: '11:45', status: 'agendada' },
      { id: 'v2', clientId: 'c2', clientName: 'B', operator: 'Ana', date: '2026-11-03', time: '12:00', status: 'agendada' },
      { id: 'v3', clientId: 'c3', status: 'em_andamento', checkinAt: '2026-11-03T06:00:00' },
    ];
    const items = buildOperationalCenter(visits, [], {}, now);
    expect(items.map(i => i.kind)).toEqual(expect.arrayContaining(['atraso', 'deslocamento', 'andamento']));
  });
});

describe('indicadores de visitas', () => {
  it('calcula duração média, volume por operador e reincidência por cliente', () => {
    const visits = [
      { date: '2026-11-01', status: 'concluida', time: '09:00', timeEnd: '10:00', operator: 'Ana', clientName: 'A' },
      { date: '2026-11-02', status: 'concluida', time: '09:00', timeEnd: '11:00', operator: 'Ana', clientName: 'A' },
      { date: '2026-11-03', status: 'concluida', time: '09:00', timeEnd: '09:30', operator: 'Beto', clientName: 'B' },
      { date: '2026-10-03', status: 'concluida', operator: 'Beto', clientName: 'C' },
    ];
    expect(buildVisitMetrics(visits, '2026-11')).toEqual({ total: 3, avgMinutes: 70, topOperator: ['Ana', 2], topClient: ['A', 2], recurrentClients: 1 });
  });
});
