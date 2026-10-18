import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

globalThis.escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const require = createRequire(import.meta.url);
const R = require('../js/relatorio-cliente.js');

describe('helpers do relatório', () => {
  it('intervalo do mês (inclui fevereiro bissexto)', () => {
    expect(R.rptMonthRange('2026-10')).toMatchObject({ start: '2026-10-01', end: '2026-10-31', label: 'outubro de 2026' });
    expect(R.rptMonthRange('2028-02').end).toBe('2028-02-29');
  });

  it('lê as sessões de cronômetro das notas (pausa, ajuste e conclusão)', () => {
    const notes = [
      { text: '⏸ Ana pausou. Tempo sessão: 01:30:00. Total: 01:30:00.', createdAt: '2026-10-02T12:00:00Z', author: 'Ana' },
      { text: '⏹ Beto parou o cronômetro de Ana (ligado há 12h). Sessão registrada: 00:45:00. Total: 02:15:00.', createdAt: '2026-10-03T12:00:00Z' },
      { text: '⏹ Cronômetro de Ana parado ao concluir. Sessão registrada: 00:10:30. Total: 02:25:30.', createdAt: '2026-10-04T12:00:00Z' },
      { text: '▶ Ana iniciou o trabalho.', createdAt: '2026-10-04T13:00:00Z' },
    ];
    expect(R.parseTimerSessions(notes).map((s) => s.seconds)).toEqual([5400, 2700, 630]);
  });

  it('duração da visita pelo horário', () => {
    expect(R.visitDurationMinutes({ time: '09:00', timeEnd: '11:30' })).toBe(150);
    expect(R.visitDurationMinutes({ time: '09:00', allDay: true, timeEnd: '18:00' })).toBeNull();
    expect(R.visitDurationMinutes({ time: '09:00' })).toBeNull();
    expect(R.rptFormatMinutes(150)).toBe('2h 30min');
    expect(R.rptFormatMinutes(45)).toBe('45min');
    expect(R.rptFormatMinutes(120)).toBe('2h');
  });
});

describe('buildClientMonthReport', () => {
  const client = { id: 'C1', name: 'Acme <Ltda>' };
  const visits = [
    { id: 'V1', date: '2026-10-05', time: '09:00', timeEnd: '11:00', status: 'concluida', operator: 'Ana', motivo: 'Servidor', milvusChamadoCodigo: 501 },
    { id: 'V2', date: '2026-10-20', time: '14:00', timeEnd: '15:00', status: 'agendada', operator: 'Beto' },
    { id: 'V3', date: '2026-10-21', status: 'cancelada' },
    { id: 'V4', date: '2026-09-30', time: '09:00', timeEnd: '10:00', status: 'concluida' },
  ];
  const pens = [
    { id: 'P1', status: 'concluido', completedAt: '2026-10-10T15:00:00Z', createdAt: '2026-09-20T10:00:00Z', assunto: 'Backup', notes: [
      { text: 'Tempo sessão: 01:00:00', createdAt: '2026-09-29T12:00:00Z' },
      { text: 'Sessão registrada: 00:30:00', createdAt: '2026-10-10T12:00:00Z' },
    ] },
    { id: 'P2', status: 'aberto', createdAt: '2026-10-02T10:00:00Z', deadline: '2000-01-01', assunto: 'Impressora' },
    { id: 'P3', status: 'resolvido', completedAt: '2026-09-28T15:00:00Z', createdAt: '2026-09-01T10:00:00Z' },
  ];
  const atend = [
    { codigo: '501', assunto: 'Servidor', tecnico: 'Ana', total_horas_atendimento: '01:15' },
    { codigo: '501', total_horas_atendimento: '00:45' },
    { codigo: '777', assunto: 'VPN', tecnico: 'Caio', total_horas_atendimento: '00:30' },
  ];

  it('soma só o que é do mês', () => {
    const m = R.buildClientMonthReport({ client, pens, visits, atend }, '2026-10');
    expect(m.visits.map((x) => x.v.id)).toEqual(['V1', 'V2']);
    expect(m.visitsDone).toBe(1);
    expect(m.visitMinutes).toBe(120);
    expect(m.penMinutes).toBe(30);
    expect(m.totalMinutes).toBe(150);
    expect(m.resolved.map((x) => [x.p.id, x.seconds])).toEqual([['P1', 1800]]);
    expect(m.opened).toBe(1);
    expect(m.stillOpen.map((x) => [x.p.id, x.overdue])).toEqual([['P2', true]]);
    expect(m.atendMinutes).toBe(150);
  });

  it('chamados: une os das visitas com os atendimentos (horas por chamado)', () => {
    const m = R.buildClientMonthReport({ client, pens, visits, atend }, '2026-10');
    expect(m.tickets.map((t) => [t.codigo, t.minutes || 0])).toEqual([['501', 120], ['777', 30]]);
  });

  it('sem Milvus (offline): marca indisponível e usa só os chamados das visitas', () => {
    const m = R.buildClientMonthReport({ client, pens, visits, atend: null }, '2026-10');
    expect(m.atendAvailable).toBe(false);
    expect(m.tickets.map((t) => t.codigo)).toEqual(['501']);
    const html = R.renderClientReportHtml(m);
    expect(html).toContain('Horas do Milvus indisponíveis');
  });

  it('HTML escapa os dados', () => {
    const html = R.renderClientReportHtml(R.buildClientMonthReport({ client, pens, visits, atend }, '2026-10'));
    expect(html).toContain('Acme &lt;Ltda&gt;');
    expect(html).not.toContain('<Ltda>');
    expect(html).toContain('Chamado #501');
  });
});
