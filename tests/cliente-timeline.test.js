import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let timeline;
let acoes;

beforeEach(() => {
  acoes = {};
  globalThis.registerActions = (map) => Object.assign(acoes, map);
  globalThis.escapeHtml = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  globalThis.getPendencias = () => [];
  globalThis.getVisits = () => [];
  delete require.cache[require.resolve('../js/cliente-timeline.js')];
  timeline = require('../js/cliente-timeline.js');
});

afterEach(() => {
  for (const key of ['registerActions', 'escapeHtml', 'getPendencias', 'getVisits', 'formatDateTime', 'closeModal', 'openPendenciaDetail', 'openVisitDetail']) delete globalThis[key];
});

describe('linha do tempo do cliente', () => {
  it('une apenas itens do cliente e ordena do mais recente ao antigo', () => {
    const items = timeline.buildClientTimeline('c1', {
      pendencias: [
        { id: 'p1', clientId: 'c1', assunto: 'Servidor', status: 'aberto', createdAt: '2026-11-01T10:00:00Z' },
        { id: 'p2', clientId: 'c2', assunto: 'Outro cliente', createdAt: '2026-11-03T10:00:00Z' },
      ],
      visitas: [
        { id: 'v1', clientId: 'c1', motivo: 'Manutenção', status: 'concluida', relatorio: 'Tudo certo', date: '2026-11-02', time: '09:30' },
        { id: 'v2', clientId: 'c2', date: '2026-11-03' },
      ],
    });
    expect(items.map((item) => item.id)).toEqual(['v1', 'p1']);
    expect(items[0]).toMatchObject({ tipo: 'visita', titulo: 'Manutenção', detalhe: 'Tudo certo', status: 'concluida' });
    expect(items[1]).toMatchObject({ tipo: 'pendencia', titulo: 'Servidor', detalhe: 'aberto', status: 'aberto' });
  });

  it('tolera datas inválidas ou ausentes sem perder os itens', () => {
    const items = timeline.buildClientTimeline('c1', {
      pendencias: [{ id: 'p1', clientId: 'c1', createdAt: 'não é data' }, null],
      visitas: [{ id: 'v1', clientId: 'c1' }, { id: 'v2', clientId: 'c1', date: '2026-11-01' }],
    });
    expect(items.map((item) => item.id)).toEqual(['v2', 'p1', 'v1']);
  });

  it('inclui somente notas de WhatsApp e e-mail já identificadas', () => {
    const items = timeline.buildClientTimeline('c1', {
      pendencias: [{
        id: 'p1', clientId: 'c1', createdAt: '2026-11-01',
        notes: [
          { text: 'Recebido pelo WhatsApp', channel: 'whatsapp', createdAt: '2026-11-03T12:00:00Z' },
          { text: 'Resposta enviada', canal: 'email', createdAt: '2026-11-02T12:00:00Z' },
          { text: 'Anotação interna', createdAt: '2026-11-04' },
          null,
        ],
      }],
      visitas: [],
    });
    expect(items.map((item) => item.tipo)).toEqual(['whatsapp', 'email', 'pendencia']);
    expect(items[0].detalhe).toBe('Recebido pelo WhatsApp');
    expect(items[1].detalhe).toBe('Resposta enviada');
  });

  it('mostra estado vazio útil', () => {
    expect(timeline.clientTimelineHtml('c1')).toContain('Nenhuma pendência ou visita registrada para este cliente.');
  });

  it('escapa todos os dados e cria itens clicáveis por delegação', () => {
    globalThis.getPendencias = () => [{ id: 'p"><img src=x>', clientId: 'c1', assunto: '<script>alert(1)</script>', status: 'aberto & aguardando', createdAt: 'inválida' }];
    globalThis.getVisits = () => [{ id: 'v1', clientId: 'c1', motivo: 'Rede <b>lenta</b>', relatorio: 'Relatório & conclusão', date: '2026-11-02' }];
    const html = timeline.clientTimelineHtml('c1');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>lenta</b>');
    expect(html).toContain('Relatório &amp; conclusão');
    expect(html).toContain('aberto &amp; aguardando');
    expect(html).toContain('Data não informada');
    expect(html).toContain('data-action="clienteTimelineAbrir" data-kind="pendencia" data-arg="p&quot;&gt;&lt;img src=x&gt;"');
    expect(html).toContain('data-action="clienteTimelineAbrir" data-kind="visita" data-arg="v1"');
  });

  it('fecha o modal e abre o detalhe correspondente', () => {
    const chamadas = [];
    globalThis.closeModal = () => chamadas.push('fechar');
    globalThis.openPendenciaDetail = (id) => chamadas.push('pendencia:' + id);
    globalThis.openVisitDetail = (id) => chamadas.push('visita:' + id);
    acoes.clienteTimelineAbrir({ dataset: { kind: 'pendencia' } }, 'p1');
    acoes.clienteTimelineAbrir({ dataset: { kind: 'visita' } }, 'v1');
    expect(chamadas).toEqual(['fechar', 'pendencia:p1', 'fechar', 'visita:v1']);
  });
});
