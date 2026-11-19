import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// Métricas do painel (js/whatsapp-painel.js). As médias só valem se a regra
// de "1ª resposta" for a do cliente: nota interna e robô não respondem a
// ninguém, e mensagem chegando fora de ordem não pode virar tempo negativo.
let p;

beforeEach(() => {
  globalThis.chamadoTelefoneChave = undefined;
  delete require.cache[require.resolve('../js/whatsapp-painel.js')];
  p = require('../js/whatsapp-painel.js');
});

const MIN = 60 * 1000;
const H = 60 * MIN;
// Datas locais: o painel agrupa por dia e hora do fuso de quem olha.
const T0 = new Date(2026, 10, 3, 9, 0, 0).getTime();
const iso = (ms) => new Date(ms).toISOString();

function msg(over) {
  return Object.assign(
    {
      id: Math.random().toString(36).slice(2),
      canal: 'whatsapp',
      telefone: '5511987654321',
      team: 'init',
      direcao: 'entrada',
      status: 'anexado',
      de: 'Cliente',
    },
    over,
    { recebidoEm: iso(over.t) }
  );
}
const entrada = (t, over) => msg(Object.assign({ t }, over));
const resposta = (t, de = 'Ana', over) => msg(Object.assign({ t, direcao: 'saida', de }, over));
const nota = (t, de = 'Ana') => msg({ t, direcao: 'interna', de });
const robo = (t) => msg({ t, direcao: 'saida', de: 'Atendimento automático' });

const calc = (linhas, extra) =>
  p.wpainelCalcular(
    linhas,
    Object.assign({ desde: T0 - H, ate: T0 + 2 * H, agora: T0 + H }, extra)
  );

describe('tempo de 1ª resposta', () => {
  it('conta da mensagem do cliente até a primeira resposta de gente', () => {
    const r = calc([entrada(T0), resposta(T0 + 5 * MIN), resposta(T0 + 9 * MIN)]);
    expect(r.primeiraRespostaMs).toBe(5 * MIN);
    expect(r.atendentes[0]).toMatchObject({ nome: 'Ana', atendimentos: 1 });
  });

  it('nota interna não é 1ª resposta', () => {
    const r = calc([entrada(T0), nota(T0 + 1 * MIN), resposta(T0 + 10 * MIN, 'Bruno')]);
    expect(r.primeiraRespostaMs).toBe(10 * MIN);
    expect(r.atendentes[0].nome).toBe('Bruno');
  });

  it('o atendimento automático não é 1ª resposta humana', () => {
    const r = calc([entrada(T0), robo(T0 + 2000), resposta(T0 + 20 * MIN)]);
    expect(r.primeiraRespostaMs).toBe(20 * MIN);
  });

  it('conversa sem resposta conta como sem resposta e não puxa a média', () => {
    const r = calc([
      entrada(T0),
      resposta(T0 + 4 * MIN),
      entrada(T0, { telefone: '5521999990000' }),
      robo(T0 + 1000),
    ]);
    expect(r.atendimentos).toBe(2);
    expect(r.semResposta).toBe(1);
    expect(r.primeiraRespostaMs).toBe(4 * MIN);
  });

  it('só nota e robô: sem resposta, e sem atendente', () => {
    const r = calc([entrada(T0), nota(T0 + MIN), robo(T0 + 2 * MIN)]);
    expect(r.primeiraRespostaMs).toBeNull();
    expect(r.semResposta).toBe(1);
    expect(r.atendentes[0].nome).toBe('Sem atendente');
  });

  it('mensagens fora de ordem na lista são ordenadas pela hora de chegada', () => {
    const r = calc([resposta(T0 + 6 * MIN), entrada(T0 + 3 * MIN), entrada(T0)]);
    expect(r.primeiraRespostaMs).toBe(6 * MIN);
    expect(r.atendimentos).toBe(1);
  });

  // A lista vem do sync em qualquer ordem: a resposta do primeiro atendimento
  // não pode virar a 1ª resposta do segundo, nem tempo negativo.
  it('resposta de um atendimento não responde o seguinte, mesmo embaralhada', () => {
    const r = calc([
      resposta(T0 + 50 * MIN),
      entrada(T0 + 40 * MIN, { status: 'anexado' }),
      resposta(T0 + 5 * MIN),
      entrada(T0, { status: 'encerrado', tratadoEm: iso(T0 + 10 * MIN) }),
    ]);
    expect(r.atendimentos).toBe(2);
    expect(r.primeiraRespostaMs).toBe((5 * MIN + 10 * MIN) / 2);
  });

  it('o mesmo telefone em duas equipes são duas conversas', () => {
    const r = calc([entrada(T0), entrada(T0, { team: 'mam' }), resposta(T0 + MIN)]);
    expect(r.atendimentos).toBe(2);
    expect(r.semResposta).toBe(1);
  });

  it('número escrito de dois jeitos é a mesma conversa (com a chave do app)', () => {
    globalThis.chamadoTelefoneChave = (t) => {
      let d = String(t || '').replace(/\D/g, '');
      if ((d.length === 12 || d.length === 13) && d.indexOf('55') === 0) d = d.slice(2);
      if (d.length === 11 && d[2] === '9') d = d.slice(0, 2) + d.slice(3);
      return d.length >= 10 ? d : '';
    };
    const r = calc([entrada(T0), resposta(T0 + 3 * MIN, 'Ana', { telefone: '11987654321' })]);
    expect(r.atendimentos).toBe(1);
    expect(r.primeiraRespostaMs).toBe(3 * MIN);
  });
});

describe('tempo de atendimento e separação de atendimentos', () => {
  it('termina ao encerrar, pela hora do encerramento', () => {
    const r = calc([
      entrada(T0, { status: 'encerrado', tratadoEm: iso(T0 + 30 * MIN) }),
      resposta(T0 + 5 * MIN),
    ]);
    expect(r.atendimentoMs).toBe(30 * MIN);
    expect(r.encerrados).toBe(1);
  });

  it('mensagem depois do encerramento abre outro atendimento', () => {
    const r = calc([
      entrada(T0, { status: 'encerrado', tratadoEm: iso(T0 + 10 * MIN) }),
      resposta(T0 + 2 * MIN),
      entrada(T0 + 40 * MIN, { status: 'pendente' }),
    ]);
    expect(r.atendimentos).toBe(2);
    expect(r.semResposta).toBe(1);
    expect(r.atendimentoMs).toBe(10 * MIN);
  });

  it('12 h sem mensagem separam atendimentos mesmo sem encerrar', () => {
    const r = calc(
      [entrada(T0), resposta(T0 + 10 * MIN), entrada(T0 + 13 * H), resposta(T0 + 13 * H + MIN)],
      { ate: T0 + 20 * H, agora: T0 + 14 * H }
    );
    expect(r.atendimentos).toBe(2);
    // O primeiro terminou na última mensagem dele; o segundo segue aberto.
    expect(r.encerrados).toBe(1);
    expect(r.atendimentoMs).toBe(10 * MIN);
    expect(r.primeiraRespostaMs).toBe((10 * MIN + MIN) / 2);
  });

  it('atendimento aberto não entra na média de atendimento', () => {
    const r = calc([entrada(T0), resposta(T0 + 5 * MIN)]);
    expect(r.atendimentoMs).toBeNull();
  });

  it('conversa descartada não conta como atendimento', () => {
    const r = calc([entrada(T0, { status: 'descartado' })]);
    expect(r.atendimentos).toBe(0);
    expect(r.descartados).toBe(1);
    expect(r.semResposta).toBe(0);
  });

  it('conversa iniciada pela empresa é atendimento ativo, sem 1ª resposta', () => {
    const r = calc([resposta(T0, 'Ana'), entrada(T0 + 30 * MIN), resposta(T0 + 31 * MIN)]);
    expect(r.atendimentos).toBe(1);
    expect(r.ativos).toBe(1);
    expect(r.primeiraRespostaMs).toBeNull();
    expect(r.semResposta).toBe(0);
    expect(r.atendentes[0]).toMatchObject({ nome: 'Ana', ativos: 1 });
  });

  it('atendimento que começou fora do período não entra', () => {
    const r = calc([entrada(T0 - 3 * H), resposta(T0 - 3 * H + MIN)]);
    expect(r.atendimentos).toBe(0);
  });
});

describe('volume e situação agora', () => {
  it('volume por dia preenche os dias sem mensagem e por hora conta só entradas', () => {
    const desde = new Date(2026, 10, 1).getTime();
    const ate = new Date(2026, 10, 4).getTime();
    const r = p.wpainelCalcular(
      [entrada(T0), entrada(T0 + 5 * MIN), resposta(T0 + 6 * MIN), entrada(T0 - 24 * H)],
      { desde, ate, agora: T0 + H }
    );
    expect(r.dias.map((d) => d.total)).toEqual([0, 1, 2]);
    expect(r.horas[9]).toBe(3);
    expect(r.horas.reduce((s, v) => s + v, 0)).toBe(3);
  });

  it('aberta, aguardando e sem atendente seguem o estado atual', () => {
    const r = calc([
      // aguardando, sem atendente
      entrada(T0, { status: 'pendente' }),
      // respondida e atribuída
      entrada(T0, { telefone: '5521911112222', atribuidoA: 'Ana' }),
      resposta(T0 + MIN, 'Ana', { telefone: '5521911112222' }),
      // encerrada: não está aberta
      entrada(T0, { telefone: '5531911112222', status: 'encerrado', tratadoEm: iso(T0 + MIN) }),
      // só nota depois do cliente: continua aguardando
      entrada(T0 + 10 * MIN, { telefone: '5541911112222', atribuidoA: 'Bruno' }),
      nota(T0 + 11 * MIN, 'Bruno'),
    ]);
    expect(r.abertas).toBe(3);
    expect(r.aguardando).toBe(2);
    expect(r.semAtendente).toBe(1);
    expect(r.maiorEsperaMs).toBe(H);
  });
});

describe('formatação e extensão', () => {
  it('duração legível', () => {
    expect(p.wpainelDuracao(null)).toBe('—');
    expect(p.wpainelDuracao(20 * 1000)).toBe('< 1 min');
    expect(p.wpainelDuracao(80 * MIN)).toBe('1 h 20 min');
    expect(p.wpainelDuracao(51 * H)).toBe('2 d 3 h');
  });

  it('sem fonte de avaliações o bloco some; fonte que falha também', () => {
    expect(p._wpainelAvaliacoes({})).toBeNull();
    p.wpainelRegistrarAvaliacoes(() => {
      throw new Error('tabela 088 não existe');
    });
    expect(p._wpainelAvaliacoes({})).toBeNull();
    p.wpainelRegistrarAvaliacoes(() => ({ media: 4.5, total: 12 }));
    expect(p._wpainelAvaliacoes({})).toEqual({ media: 4.5, total: 12 });
  });
});
