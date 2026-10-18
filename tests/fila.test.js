import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { buildFilaModel, buildAlertStripText } = require('../js/fila.js');
const { matchSearchActions } = require('../js/global-search.js');

const TODAY = '2026-10-15';
const pen = (over) => Object.assign({ id: 'P' + Math.random(), status: 'aberto', responsible: 'Ana', priority: 'media', clientName: 'Acme' }, over);

describe('buildFilaModel', () => {
  const pens = [
    pen({ id: 'over', deadline: '2026-10-10' }),
    pen({ id: 'today', deadline: TODAY }),
    pen({ id: 'crit', priority: 'critica' }),
    pen({ id: 'week', deadline: '2026-10-19' }),
    pen({ id: 'far', deadline: '2026-12-01' }),
    pen({ id: 'other', deadline: '2026-10-10', responsible: 'Beto' }),
    pen({ id: 'done', deadline: '2026-10-10', status: 'concluido' }),
  ];
  const m = buildFilaModel(pens, [], 'Ana', TODAY, Date.now());

  it('"agora" = minhas vencidas, de hoje/amanhã e alta/crítica; vencida primeiro', () => {
    expect(m.now.map((p) => p.id)).toEqual(['over', 'crit', 'today']);
  });

  it('"semana" = prazos de depois de amanhã até +7 dias, sem repetir o "agora"', () => {
    expect(m.week.map((p) => p.id)).toEqual(['week']);
  });

  it('conta só as minhas abertas (não de outros, não concluídas)', () => {
    expect(m.counts.open).toBe(5);
    expect(m.counts.overdue).toBe(1);
  });

  it('visitas de hoje do operador, sem concluídas/canceladas', () => {
    const visits = [
      { id: 'v1', date: TODAY, operator: 'Ana', status: 'agendada', time: '14:00' },
      { id: 'v2', date: TODAY, operator: 'Ana', status: 'concluida' },
      { id: 'v3', date: TODAY, operator: 'Beto', status: 'agendada' },
      { id: 'v4', date: TODAY, operator: 'Ana', status: 'agendada', allDay: true },
    ];
    const mv = buildFilaModel([], visits, 'Ana', TODAY, Date.now());
    expect(mv.visits.map((v) => v.id)).toEqual(['v4', 'v1']);
  });

  it('cronômetro meu ligado há 11h conta como esquecido', () => {
    const started = new Date(Date.now() - 11 * 3600 * 1000).toISOString();
    const mt = buildFilaModel([pen({ id: 't', timerRunning: true, timerOperator: 'Ana', timerStartedAt: started })], [], 'Ana', TODAY, Date.now());
    expect(mt.running.id).toBe('t');
    expect(mt.counts.forgotten).toBe(1);
  });
});

describe('faixa de alertas', () => {
  it('monta o texto só com o que existe', () => {
    expect(buildAlertStripText({ overdue: 3, forgotten: 1, visitsToday: 2 })).toBe('3 pendências vencidas · 1 cronômetro esquecido · 2 visitas hoje');
    expect(buildAlertStripText({ overdue: 1 })).toBe('1 pendência vencida');
    expect(buildAlertStripText({})).toBe('');
  });
});

describe('Ctrl+K: ações rápidas', () => {
  const actions = [
    { id: 'new-pen', label: 'Nova pendência', kw: 'nova criar pendencia' },
    { id: 'new-visit', label: 'Nova visita', kw: 'nova criar visita' },
    { id: 'go-calendario', label: 'Ir para Agenda', kw: 'ir agenda calendario' },
  ];
  it('casa todas as palavras, sem acento', () => {
    expect(matchSearchActions('nova visita', actions).map((a) => a.id)).toEqual(['new-visit']);
    expect(matchSearchActions('pendência', actions).map((a) => a.id)).toEqual(['new-pen']);
    expect(matchSearchActions('calendário', actions).map((a) => a.id)).toEqual(['go-calendario']);
  });
  it('vazio devolve todas (até o limite)', () => {
    expect(matchSearchActions('', actions, 2)).toHaveLength(2);
  });
});

describe('contratos de navegação', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  it('menu em seções + Minha fila + barra inferior', () => {
    expect(html).toContain('class="nav-section"');
    expect(html).toContain('id="nav-fila"');
    expect(html).toContain('id="bottomNav"');
    expect(html).toContain('js/fila.js');
  });
  it('service worker inclui fila.js', () => {
    expect(fs.readFileSync('sw.js', 'utf8')).toContain("'js/fila.js'");
  });
});

describe('Minha fila por id (049)', () => {
  it('registro com id é meu mesmo com nome antigo; sem id cai no nome', () => {
    const pens = [
      { id: 'a', status: 'aberto', responsible: 'Ana (antigo)', responsibleId: 'OP-1', deadline: '2026-10-10' },
      { id: 'b', status: 'aberto', responsible: 'Ana', deadline: '2026-10-10' },
      { id: 'c', status: 'aberto', responsible: 'Ana', responsibleId: 'OP-2', deadline: '2026-10-10' },
    ];
    const m = buildFilaModel(pens, [], 'Ana', '2026-10-15', Date.now(), 'OP-1');
    expect(m.now.map((p) => p.id).sort()).toEqual(['a', 'b']);
  });
});
