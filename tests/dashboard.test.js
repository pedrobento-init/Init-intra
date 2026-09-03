import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const metrics = require('../js/metrics.js');

const {
  getPreviousDashRange,
  calcPeriodDelta,
  calcPeriodStats,
  filterItemsByDateRange,
  getClientLastContact,
  getSilentClients,
  getClientAnniversaries,
  getRecurrentClients,
  getRiskRanking,
  getNextMeeting,
  buildDaySummary,
} = metrics;

describe('comparativo com período anterior', () => {
  it('mês atual -> mês anterior', () => {
    const ref = new Date(2024, 4, 15); // 15/mai/2024
    const r = getPreviousDashRange('month', null, null, ref);
    expect(r.start.getFullYear()).toBe(2024);
    expect(r.start.getMonth()).toBe(3); // abril
    expect(r.end.getMonth()).toBe(3);
  });

  it('semana atual -> semana anterior (7 dias)', () => {
    const ref = new Date(2024, 4, 15); // quarta
    const r = getPreviousDashRange('week', null, null, ref);
    const len = Math.round((r.end - r.start) / 86400000);
    expect([6, 7]).toContain(len);
    expect(r.end < new Date(2024, 4, 13)).toBe(true);
  });

  it('custom usa mesma duração imediatamente antes', () => {
    const r = getPreviousDashRange('custom', '2024-05-01', '2024-05-10', new Date(2024, 4, 20));
    expect(r.end < new Date('2024-05-01T00:00:00')).toBe(true);
    const len = r.end - r.start;
    const orig = new Date('2024-05-10T23:59:59') - new Date('2024-05-01T00:00:00');
    expect(Math.abs(len - orig)).toBeLessThan(2000);
  });

  it('all não tem anterior', () => {
    expect(getPreviousDashRange('all', null, null, new Date())).toBeNull();
  });

  it('calcPeriodDelta: melhora depende da métrica', () => {
    // Menos abertas é bom (higherIsBetter=false): cair de 10 -> 8 é melhora
    expect(calcPeriodDelta(8, 10, false).improved).toBe(true);
    expect(calcPeriodDelta(12, 10, false).improved).toBe(false);
    // Mais conclusão é bom (higherIsBetter=true): subir 50 -> 60 é melhora
    expect(calcPeriodDelta(60, 50, true).improved).toBe(true);
    expect(calcPeriodDelta(40, 50, true).improved).toBe(false);
    // Estável
    expect(calcPeriodDelta(10, 10, true).direction).toBe('flat');
    // Base zero
    expect(calcPeriodDelta(0, 0, true).improved).toBeNull();
  });

  it('calcPeriodStats agrega open/avg/completion sem duplicar dashboard', () => {
    const pens = [
      { status: 'aberto', createdAt: '2024-05-01T10:00:00Z' },
      { status: 'concluido', createdAt: '2024-05-01T10:00:00Z', completedAt: '2024-05-01T12:00:00Z' },
      { status: 'concluido', createdAt: '2024-05-01T10:00:00Z', completedAt: '2024-05-02T10:00:00Z' },
    ];
    const s = calcPeriodStats(pens, (st) => ['concluido', 'resolvido', 'cancelado', 'fechado'].includes(st));
    expect(s.open).toBe(1);
    expect(s.completionRate).toBe(Math.round((2 / 3) * 100));
    expect(s.avgSlaHours).toBeCloseTo(13, 0);
  });

  it('filterItemsByDateRange respeita start/end', () => {
    const items = [
      { createdAt: '2024-04-15T10:00:00Z' },
      { createdAt: '2024-05-15T10:00:00Z' },
    ];
    const out = filterItemsByDateRange(items, new Date(2024, 4, 1), new Date(2024, 4, 31));
    expect(out).toHaveLength(1);
  });
});

describe('silêncio do cliente', () => {
  const clients = [
    { id: 'CLI-1', name: 'Ativo' },
    { id: 'CLI-2', name: 'Silencioso' },
  ];
  const pens = [
    { clientId: 'CLI-1', createdAt: '2024-05-28T10:00:00Z', updatedAt: '2024-05-28T10:00:00Z', notes: [] },
    { clientId: 'CLI-2', createdAt: '2024-01-01T10:00:00Z', updatedAt: '2024-01-01T10:00:00Z', notes: [] },
  ];
  const visits = [{ clientId: 'CLI-1', date: '2024-05-29', createdAt: '2024-05-29T10:00:00Z' }];

  it('getClientLastContact considera pendência, nota e visita', () => {
    const withNote = [
      { clientId: 'CLI-2', createdAt: '2024-01-01T10:00:00Z', notes: [{ text: 'oi', createdAt: '2024-05-29T10:00:00Z' }] },
    ];
    expect(getClientLastContact('CLI-2', withNote, [], Date.now())).toBeGreaterThan(
      getClientLastContact('CLI-2', pens, [], Date.now())
    );
  });

  it('lista apenas quem está há 30+ dias sem contato, ordenado pelo mais antigo', () => {
    const out = getSilentClients(clients, pens, visits, 30, '2024-05-30');
    expect(out.map((o) => o.clientId)).toEqual(['CLI-2']);
    expect(out[0].daysSince).toBeGreaterThanOrEqual(30);
  });
});

describe('aniversário de cliente', () => {
  it('lista quem completa anos no mês corrente', () => {
    const clients = [
      { id: 'A', name: 'Maio 2022', createdAt: '2022-05-10T10:00:00Z' },
      { id: 'B', name: 'Junho 2020', createdAt: '2020-06-10T10:00:00Z' },
      { id: 'C', name: 'Maio atual', createdAt: '2024-05-01T10:00:00Z' },
    ];
    const out = getClientAnniversaries(clients, new Date(2024, 4, 15));
    expect(out.map((o) => o.clientId)).toEqual(['A']);
    expect(out[0].years).toBe(2);
  });
});

describe('recorrência e risco', () => {
  it('getRecurrentClients top 5 com streak > 1', () => {
    const clients = [
      { id: 'CLI-1', name: 'Padaria' },
      { id: 'CLI-2', name: 'Mercado' },
    ];
    const reunioes = [{ mesAno: '2024-03', id: 'REU-2024-03' }, { mesAno: '2024-02', id: 'REU-2024-02' }];
    const pens = [
      { clientId: 'CLI-1', reviewedInMeeting: 'REU-2024-03' },
      { clientId: 'CLI-1', reviewedInMeeting: 'REU-2024-02' },
      { clientId: 'CLI-2', reviewedInMeeting: 'REU-2024-03' },
    ];
    const out = getRecurrentClients(clients, reunioes, pens, 2, 5);
    expect(out).toHaveLength(1);
    expect(out[0].clientId).toBe('CLI-1');
  });

  it('getRiskRanking piores primeiro com link para ficha', () => {
    const clients = [
      { id: 'CLI-1', name: 'Ok' },
      { id: 'CLI-2', name: 'Ruim' },
    ];
    const pens = [
      { clientId: 'CLI-1', status: 'aberto', deadline: '2030-01-01', createdAt: '2024-05-01T10:00:00Z' },
      { clientId: 'CLI-2', status: 'aberto', deadline: '2020-01-01', createdAt: '2024-05-01T10:00:00Z' },
      { clientId: 'CLI-2', status: 'aberto', deadline: '2020-01-01', createdAt: '2024-05-01T10:00:00Z' },
      { clientId: 'CLI-2', status: 'aberto', deadline: '2020-01-01', createdAt: '2024-05-01T10:00:00Z' },
    ];
    const out = getRiskRanking(clients, pens, '2024-05-30', 5);
    expect(out[0].clientId).toBe('CLI-2');
    expect(out[0].health).toBeTruthy();
  });
});

describe('reunião e resumo do dia', () => {
  it('getNextMeeting prioriza aberta', () => {
    const list = [
      { id: 'REU-2024-04', mesAno: '2024-04', status: 'encerrada' },
      { id: 'REU-2024-05', mesAno: '2024-05', status: 'aberta' },
    ];
    expect(getNextMeeting(list).id).toBe('REU-2024-05');
    expect(getNextMeeting([])).toBeNull();
  });

  it('buildDaySummary combina números + afastados/sobrecarga', () => {
    const s = buildDaySummary({ dueToday: [{}, {}], todayVisits: [{}], overloadedOps: [{ name: 'Ana', count: 9 }], onLeaveOps: ['Beto'] });
    expect(s).toContain('2 pendência(s) vencem');
    expect(s).toContain('1 visita(s)');
    expect(s).toContain('Ana');
    expect(s).toContain('Beto');
  });
});

describe('performance do dashboard (200 clientes / 1000 pendências)', () => {
  it('agregados rodam em tempo aceitável', () => {
    const clients = Array.from({ length: 200 }, (_, i) => ({
      id: `CLI-${i}`, name: `Cliente ${i}`, createdAt: '2022-05-10T10:00:00Z',
    }));
    const pens = Array.from({ length: 1000 }, (_, i) => ({
      id: `PEN-${i}`,
      clientId: `CLI-${i % 200}`,
      clientName: `Cliente ${i % 200}`,
      status: i % 4 === 0 ? 'concluido' : 'aberto',
      priority: i % 10 === 0 ? 'critica' : 'media',
      deadline: i % 3 === 0 ? '2020-01-01' : '2030-01-01',
      createdAt: '2024-05-01T10:00:00Z',
      completedAt: i % 4 === 0 ? '2024-05-02T10:00:00Z' : null,
      updatedAt: '2024-05-20T10:00:00Z',
      notes: [],
      reviewedInMeeting: i % 7 === 0 ? 'REU-2024-03' : null,
    }));
    const visits = Array.from({ length: 200 }, (_, i) => ({
      id: `VIS-${i}`, clientId: `CLI-${i}`, date: '2024-05-20', createdAt: '2024-05-20T10:00:00Z',
    }));
    const reunioes = [{ mesAno: '2024-03', id: 'REU-2024-03', status: 'encerrada' }];

    const t0 = Date.now();
    calcPeriodStats(pens);
    getRiskRanking(clients, pens, '2024-05-30', 5);
    getSilentClients(clients, pens, visits, 30, '2024-05-30');
    getRecurrentClients(clients, reunioes, pens, 2, 5);
    getClientAnniversaries(clients, new Date(2024, 4, 15));
    const dt = Date.now() - t0;
    expect(dt).toBeLessThan(2000);
  });
});
