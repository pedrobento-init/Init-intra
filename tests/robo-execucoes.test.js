import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

// ── Painel do robô (071) ────────────────────────────────────────────────────
// js/robo-execucoes.js num sandbox. O que importa travar: o painel acusa robô
// parado e falha atual, mas não grita por falha antiga já superada — aviso
// falso faz o pessoal parar de olhar, e aí o aviso verdadeiro passa batido.

const nodes = {};
const store = {};
const sandbox = {
  console,
  window: { _supabaseAuthActive: true },
  document: { getElementById: (id) => nodes[id] || null },
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  },
  isSupabaseConnected: () => true,
  supabaseClient: { from: () => { throw new Error('rede não deveria ser chamada'); } },
  escapeHtml: (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
  formatDateTime: (s) => s,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('js/robo-execucoes.js', 'utf8'), sandbox, { filename: 'robo-execucoes.js' });

const AGORA = Date.parse('2026-10-29T12:00:00.000Z');
const minAtras = (m) => new Date(AGORA - m * 60000).toISOString();
const rodada = (acao, min, over = {}) => Object.assign({
  acao, inicio: minAtras(min), ok: true, erro: null, resultado: null,
}, over);

describe('roboSituacao', () => {
  it('usa a rodada mais nova de cada ação', () => {
    const s = sandbox.roboSituacao([rodada('triagem', 2), rodada('triagem', 7), rodada('backup', 30)], AGORA);
    expect(s.acoes.map((a) => a.acao)).toEqual(['triagem', 'backup']);
    expect(s.acoes[0].ultima.inicio).toBe(minAtras(2));
    expect(s.acoes[0].rodadas).toBe(2);
  });

  it('marca parado quando a última triagem passou de 30 min', () => {
    expect(sandbox.roboSituacao([rodada('triagem', 31)], AGORA).parado).toBe(true);
    expect(sandbox.roboSituacao([rodada('triagem', 29)], AGORA).parado).toBe(false);
  });

  it('marca parado quando há rodadas mas nenhuma de triagem', () => {
    const s = sandbox.roboSituacao([rodada('backup', 1)], AGORA);
    expect(s.parado).toBe(true);
    expect(s.ultimaTriagem).toBe(null);
  });

  it('sem nenhuma linha não acusa parado (migration ausente ou sem dados)', () => {
    expect(sandbox.roboSituacao([], AGORA).parado).toBe(false);
  });

  it('falha antiga seguida de sucesso não entra em falhando', () => {
    const s = sandbox.roboSituacao([
      rodada('triagem', 2),
      rodada('triagem', 7, { ok: false, erro: 'timeout' }),
    ], AGORA);
    expect(s.falhando).toEqual([]);
    expect(s.acoes[0].falhas).toBe(1);
  });

  it('falha na rodada mais nova entra em falhando', () => {
    const s = sandbox.roboSituacao([
      rodada('triagem', 2),
      rodada('briefing', 3, { ok: false, erro: 'x' }),
      rodada('briefing', 60, { ok: false, erro: 'x' }),
    ], AGORA);
    expect(s.falhando).toEqual(['briefing']);
    expect(s.acoes[1].falhas).toBe(2);
  });
});

describe('_rbxIdade', () => {
  it('formata em agora, minutos, horas e dias', () => {
    expect(sandbox._rbxIdade(minAtras(0), AGORA)).toBe('agora');
    expect(sandbox._rbxIdade(minAtras(5), AGORA)).toBe('há 5 min');
    expect(sandbox._rbxIdade(minAtras(180), AGORA)).toBe('há 3 h');
    expect(sandbox._rbxIdade(minAtras(60 * 72), AGORA)).toBe('há 3 d');
  });

  it('data inválida vira traço', () => {
    expect(sandbox._rbxIdade('lixo', AGORA)).toBe('—');
  });
});

describe('renderRoboExecucoes', () => {
  beforeEach(() => {
    nodes.penRoboStatus = { innerHTML: 'antigo' };
    for (const k of Object.keys(store)) delete store[k];
  });

  // Cache "fresco" impede a busca na rede durante o teste.
  const comCache = (linhas) => {
    vm.runInContext('_rbxCache.em = Date.now(); _rbxCache.linhas = ' + JSON.stringify(linhas) + ';', sandbox);
  };

  it('sem linhas limpa o painel', () => {
    comCache([]);
    sandbox.renderRoboExecucoes();
    expect(nodes.penRoboStatus.innerHTML).toBe('');
  });

  it('escapa o erro vindo do banco', () => {
    const agora = Date.now();
    comCache([{ acao: 'triagem', inicio: new Date(agora - 60000).toISOString(), ok: false, erro: '<img src=x onerror=alert(1)>', resultado: null }]);
    sandbox.renderRoboExecucoes();
    const html = nodes.penRoboStatus.innerHTML;
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('com problema abre o painel mesmo com preferência de fechado', () => {
    store.intra_rbx_fechada = '1';
    comCache([{ acao: 'triagem', inicio: new Date(Date.now() - 60000).toISOString(), ok: false, erro: 'x', resultado: null }]);
    sandbox.renderRoboExecucoes();
    const html = nodes.penRoboStatus.innerHTML;
    expect(html).toContain('is-problema');
    expect(html).not.toContain('is-fechada');
    expect(html).toContain('rbx-lista');
  });

  it('tudo ok fica fechado por padrão', () => {
    comCache([{ acao: 'triagem', inicio: new Date(Date.now() - 60000).toISOString(), ok: true, erro: null, resultado: { lidos: 3 } }]);
    sandbox.renderRoboExecucoes();
    const html = nodes.penRoboStatus.innerHTML;
    expect(html).toContain('is-fechada');
    expect(html).toContain('Robô ok');
    expect(html).not.toContain('rbx-lista');
  });
});
