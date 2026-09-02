import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const metrics = require('../js/metrics.js');

const { getSlaStatsForClient, getAllSlaStats, sortClientsBySla, calculateAvgResolutionHours, calculateHealthScore, getHealthForClient, getWorkloadByOperator, compareMeetings, getConsecutiveMeetingStreak, getMinhaFilaDoDia, getNoteSnippet, parseSearchShortcuts } = metrics;

function isClosed(s) { return ['concluido','resolvido','cancelado','fechado'].includes(s); }

describe('SLA por cliente', () => {
  it('conta abertas, vencidas e dentro do prazo', () => {
    const pens = [
      { clientId: 'CLI-1', status: 'aberto', deadline: '2024-01-02' },
      { clientId: 'CLI-1', status: 'aberto', deadline: '2024-01-10' },
      { clientId: 'CLI-1', status: 'concluido', deadline: '2024-01-01' },
      { clientId: 'CLI-2', status: 'aberto', deadline: '2024-01-01' },
    ];
    const s1 = getSlaStatsForClient(pens, 'CLI-1', '2024-01-05', isClosed);
    expect(s1).toEqual({ totalAbertas: 2, vencidas: 1, dentroPrazo: 1 });
    const all = getAllSlaStats(pens, '2024-01-05', isClosed);
    expect(all['CLI-1'].totalAbertas).toBe(2);
    expect(all['CLI-2'].vencidas).toBe(1);
  });

  it('ordena fila por vencidas desc', () => {
    const clients = [{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }, { id: 'C', name: 'C' }];
    const slaMap = { A: { vencidas: 0, totalAbertas: 5 }, B: { vencidas: 2, totalAbertas: 2 }, C: { vencidas: 2, totalAbertas: 3 } };
    const sorted = sortClientsBySla(clients, slaMap);
    expect(sorted.map(c=>c.id)).toEqual(['C','B','A']);
  });
});

describe('saúde do cliente', () => {
  it('🟢 quando 0 vencidas e poucas abertas e média baixa', () => {
    const h = calculateHealthScore({ totalAbertas: 2, vencidas: 0, avgHours: 10 });
    expect(h.level).toBe('green'); expect(h.emoji).toBe('🟢');
  });
  it('🟡 quando até 2 vencidas', () => {
    const h = calculateHealthScore({ totalAbertas: 5, vencidas: 2, avgHours: 80 });
    expect(h.level).toBe('yellow');
  });
  it('🔴 quando muitas vencidas ou média alta', () => {
    const h = calculateHealthScore({ totalAbertas: 10, vencidas: 5, avgHours: 200 });
    expect(h.level).toBe('red');
  });
  it('avg null tratado como 0', () => {
    const h = calculateHealthScore({ totalAbertas: 1, vencidas: 0, avgHours: null });
    expect(h.level).toBe('green');
  });
  it('calcula média de resolução', () => {
    const pens = [
      { createdAt: '2024-01-01T00:00:00Z', completedAt: '2024-01-01T12:00:00Z', status: 'concluido' },
      { createdAt: '2024-01-01T00:00:00Z', completedAt: '2024-01-02T00:00:00Z', status: 'concluido' },
    ];
    const avg = calculateAvgResolutionHours(pens);
    expect(avg).toBeCloseTo(18, 0);
  });
});

describe('carga por operador', () => {
  it('soma getElapsedSeconds por responsible/timerOperator', () => {
    const pens = [
      { responsible: 'Ana', timerOperator: 'Ana', timerTotalSeconds: 3600 },
      { responsible: 'Ana', timerOperator: null, timerTotalSeconds: 1800 },
      { responsible: 'Bob', timerTotalSeconds: 7200 },
    ];
    const map = getWorkloadByOperator(pens, p => p.timerTotalSeconds || 0);
    expect(map['Ana']).toBe(5400);
    expect(map['Bob']).toBe(7200);
  });
});

describe('comparativo mês a mês', () => {
  it('delta por cliente', () => {
    const clients = [{ id: 'CLI-1', name: 'Padaria' }, { id: 'CLI-2', name: 'Mercado' }];
    const pens = [
      { clientId: 'CLI-1', reviewedInMeeting: 'REU-2024-01', status: 'aberto' },
      { clientId: 'CLI-1', reviewedInMeeting: 'REU-2024-02', status: 'concluido' },
      { clientId: 'CLI-2', reviewedInMeeting: 'REU-2024-02', status: 'aberto' },
    ];
    const rows = compareMeetings('2024-01','2024-02', pens, clients);
    expect(rows.find(r=>r.clientId==='CLI-1').totalReviewedA).toBe(1);
    expect(rows.find(r=>r.clientId==='CLI-1').totalReviewedB).toBe(1);
  });
});

describe('streak N meses seguidos', () => {
  it('conta consecutivas', () => {
    const reunioes = [{ mesAno: '2024-03', id: 'REU-2024-03' }, { mesAno: '2024-02', id: 'REU-2024-02' }, { mesAno: '2024-01', id: 'REU-2024-01' }];
    const pens = [
      { clientId: 'CLI-1', reviewedInMeeting: 'REU-2024-03' },
      { clientId: 'CLI-1', reviewedInMeeting: 'REU-2024-02' },
    ];
    const streak = getConsecutiveMeetingStreak('CLI-1', reunioes, pens);
    expect(streak).toBe(2);
    const streak2 = getConsecutiveMeetingStreak('CLI-2', reunioes, pens);
    expect(streak2).toBe(0);
  });
});

describe('Minha fila do dia', () => {
  const today = '2024-05-10';
  const tomorrow = '2024-05-11';
  function mkStale(isStaleIds) {
    return (p) => isStaleIds.includes(p.id);
  }
  it('filtra por responsável e urgência (alta/critica, hoje/amanhã, stale)', () => {
    const pens = [
      { id:'PEN-1', responsible:'Ana', status:'aberto', priority:'alta', deadline:'2024-05-20', updatedAt:'2024-05-09T10:00:00Z' },
      { id:'PEN-2', responsible:'Ana', status:'aberto', priority:'baixa', deadline:today, updatedAt:'2024-05-09T10:00:00Z' },
      { id:'PEN-3', responsible:'Ana', status:'aberto', priority:'baixa', deadline:'2024-05-20', updatedAt:'2024-05-01T10:00:00Z' },
      { id:'PEN-4', responsible:'Bob', status:'aberto', priority:'critica', deadline:'2024-05-20', updatedAt:'2024-05-09T10:00:00Z' },
      { id:'PEN-5', responsible:'Ana', status:'concluido', priority:'critica', deadline:today, updatedAt:'2024-05-09T10:00:00Z' },
      { id:'PEN-6', responsible:'Ana', status:'aberto', priority:'baixa', deadline:'2024-05-20', updatedAt:'2024-05-09T10:00:00Z' },
    ];
    const queue = getMinhaFilaDoDia(pens, 'Ana', today, { tomorrowISO: tomorrow, isStaleFn: mkStale(['PEN-3']) });
    const ids = queue.map(p=>p.id);
    expect(ids).toContain('PEN-1');
    expect(ids).toContain('PEN-2');
    expect(ids).toContain('PEN-3');
    expect(ids).not.toContain('PEN-4');
    expect(ids).not.toContain('PEN-5');
    expect(ids).not.toContain('PEN-6');
  });
  it('ordena vencidas primeiro, depois prioridade, depois stale', () => {
    const pens = [
      { id:'PEN-A', responsible:'Ana', status:'aberto', priority:'media', deadline:'2024-05-09', updatedAt:'2024-05-09T10:00:00Z' },
      { id:'PEN-B', responsible:'Ana', status:'aberto', priority:'critica', deadline:'2024-05-20', updatedAt:'2024-05-09T10:00:00Z' },
      { id:'PEN-C', responsible:'Ana', status:'aberto', priority:'baixa', deadline:tomorrow, updatedAt:'2024-05-01T10:00:00Z' },
      { id:'PEN-D', responsible:'Ana', status:'aberto', priority:'alta', deadline:today, updatedAt:'2024-05-09T10:00:00Z' },
    ];
    const queue = getMinhaFilaDoDia(pens, 'Ana', today, { tomorrowISO: tomorrow, isStaleFn: mkStale(['PEN-C']) });
    expect(queue[0].id).toBe('PEN-A');
    expect(queue[1].id).toBe('PEN-B');
  });
});

describe('Busca global helpers (puros)', () => {
  it('parseSearchShortcuts extrai cliente e status e texto livre', () => {
    const r1 = parseSearchShortcuts('status:aberto pagamento');
    expect(r1.filters.status).toBe('aberto');
    expect(r1.remainingText).toBe('pagamento');
    const r2 = parseSearchShortcuts('cliente:"Padaria Central" status:aberto');
    expect(r2.filters.cliente).toBe('Padaria Central');
    expect(r2.filters.status).toBe('aberto');
    expect(r2.remainingText).toBe('');
  });
  it('getNoteSnippet destaca com <mark> e 60 chars ao redor', () => {
    const text = 'A'.repeat(70) + ' pagamento pendente ' + 'B'.repeat(70);
    const snippet = getNoteSnippet(text, 'pagamento', 60);
    expect(snippet).toContain('<mark>pagamento</mark>');
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
  });
  it('getNoteSnippet retorna null se não há match', () => {
    expect(getNoteSnippet('hello world', 'xyz')).toBeNull();
  });
});
