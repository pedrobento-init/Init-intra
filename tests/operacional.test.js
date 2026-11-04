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

  it('alerta prazo nas próximas 24h, sem antecipar prazo vencido ou distante', () => {
    const pendencias = [
      { id: 'p1', status: 'aberto', deadline: '2026-11-03', assunto: 'Hoje à noite' },
      { id: 'p2', status: 'aberto', deadline: '2026-11-05', assunto: 'Distante' },
      { id: 'p3', status: 'aberto', deadline: '2026-11-02', assunto: 'Vencida' },
    ];
    const items = buildOperationalCenter([], pendencias, {}, now);
    expect(items.find(i => i.pendenciaId === 'p1')).toMatchObject({ kind: 'prazo_proximo' });
    expect(items.find(i => i.pendenciaId === 'p2')).toBeUndefined();
    expect(items.find(i => i.pendenciaId === 'p3')).toMatchObject({ kind: 'prazo' });
  });

  it('alerta resposta do solicitante somente sem resposta ou visualização posterior', () => {
    const pendencias = [
      { id: 'p1', status: 'aberto', assunto: 'Aguardando', notes: [{ visibility: 'solicitante', createdAt: '2026-11-03T10:00:00' }] },
      { id: 'p2', status: 'aberto', assunto: 'Respondida', notes: [
        { visibility: 'resposta', createdAt: '2026-11-03T11:00:00' },
        { visibility: 'solicitante', createdAt: '2026-11-03T10:00:00' },
      ] },
      { id: 'p3', status: 'aberto', assunto: 'Visualizada', lastViewedAt: '2026-11-03T11:00:00', notes: [
        { visibility: 'solicitante', createdAt: '2026-11-03T10:00:00' },
      ] },
      { id: 'p4', status: 'aberto', assunto: 'Inválida', notes: [null, { visibility: 'solicitante', createdAt: 'inválida' }] },
    ];
    const items = buildOperationalCenter([], pendencias, {}, now);
    expect(items.filter(i => i.kind === 'resposta_solicitante').map(i => i.pendenciaId)).toEqual(['p1']);
  });

  it('alerta pendência parada há sete dias, exceto quando encerrada', () => {
    const pendencias = [
      { id: 'p1', status: 'aberto', assunto: 'Parada', updatedAt: '2026-10-27T12:00:00' },
      { id: 'p2', status: 'resolvido', assunto: 'Resolvida', updatedAt: '2026-10-20T12:00:00' },
    ];
    const items = buildOperationalCenter([], pendencias, {}, now);
    expect(items.filter(i => i.kind === 'parada').map(i => i.pendenciaId)).toEqual(['p1']);
  });

  it('detecta reincidência normalizada do mesmo cliente em até 30 dias', () => {
    const pendencias = [
      { id: 'p1', clientId: 'c1', status: 'aberto', assunto: 'VPN não conecta', updatedAt: '2026-11-03T10:00:00' },
      { id: 'p2', clientId: 'c1', status: 'resolvido', assunto: 'vpn não conecta!', resolvedAt: '2026-10-20T10:00:00' },
      { id: 'p3', clientId: 'c2', status: 'aberto', assunto: 'VPN não conecta', updatedAt: '2026-11-03T10:00:00' },
    ];
    const items = buildOperationalCenter([], pendencias, {}, now);
    expect(items.filter(i => i.kind === 'reincidencia').map(i => i.pendenciaId)).toEqual(['p1']);
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
