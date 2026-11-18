import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

// Filas na Caixa (js/whatsapp-filas.js). Roda junto com a caixa no mesmo
// escopo, como no index.html. O que se trava aqui: "na fila" é a mesma regra
// do banco (087), o recorte por departamento não esconde e-mail sem querer,
// o "Pegar próximo" só marca a conversa que o BANCO devolveu, e nome de
// operador no modal passa por escapeHtml.

const FONTES = [
  'js/chamado-canal.js',
  'js/emails-triagem.js',
  'js/caixa-entrada.js',
  'js/whatsapp-filas.js',
].map((f) => fs.readFileSync(f, 'utf8'));

let lista, toasts, rpcs, rpcResposta, conectado, sessao, guardado;

function carregar() {
  const sandbox = {
    console,
    window: { _supabaseAuthActive: true },
    document: { getElementById: () => null },
    DB: { EMAILS_TRIAGEM: 'emails_triagem' },
    dbGet: () => lista,
    dbSet: (_k, v) => {
      lista = v;
    },
    getUser: () => ({ name: 'Ana' }),
    getSession: () => sessao,
    getCurrentTeam: () => 'init',
    isSupabaseConnected: () => conectado,
    filterByTeam: (l) => l,
    showToast: (m, t) => toasts.push([m, t]),
    openModal: () => {},
    closeModal: () => {},
    registerActions: () => {},
    getOperatorNames: () => ['Ana', 'Bruno'],
    markSyncPushFailed: () => {},
    setInterval: () => 1,
    setTimeout: () => 1,
    localStorage: {
      getItem: (k) => (k in guardado ? guardado[k] : null),
      setItem: (k, v) => {
        guardado[k] = String(v);
      },
      removeItem: (k) => {
        delete guardado[k];
      },
    },
    escapeHtml: (s) =>
      String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;'),
    supabaseClient: {
      rpc: async (nome, args) => {
        rpcs.push([nome, args]);
        return rpcResposta;
      },
      from: () => ({
        update: () => ({ eq: () => Promise.resolve({}) }),
      }),
    },
  };
  sandbox.globalThis = sandbox;
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  for (const src of FONTES) vm.runInContext(src, sandbox);
  return sandbox;
}

function zap(id, telefone, over = {}) {
  return {
    id,
    de: 'Cliente',
    assunto: 'oi',
    corpo: 'oi',
    status: 'pendente',
    canal: 'whatsapp',
    telefone,
    direcao: 'entrada',
    team: 'init',
    recebidoEm: '2026-11-18T12:00:00.000Z',
    ...over,
  };
}

let s;
beforeEach(() => {
  lista = [];
  toasts = [];
  rpcs = [];
  rpcResposta = { data: null, error: null };
  conectado = true;
  sessao = { opId: 'op-ana', name: 'Ana', isAdmin: false };
  guardado = {};
  s = carregar();
});

const conversas = (linhas) => s.caixaAgruparConversas(linhas);

describe('wfilaNaFila', () => {
  it('pendente sem responsável está na fila; com responsável aberto, não', () => {
    const [livre] = conversas([zap('A', '5511900000001')]);
    const [comDono] = conversas([zap('B', '5511900000002', { atribuidoA: 'Bruno' })]);
    expect(s.wfilaNaFila(livre)).toBe(true);
    expect(s.wfilaNaFila(comDono)).toBe(false);
  });

  it('dono de um ciclo já encerrado não segura a mensagem nova', () => {
    const [c] = conversas([
      zap('A', '5511900000001', {
        status: 'encerrado',
        atribuidoA: 'Bruno',
        recebidoEm: '2026-11-17T12:00:00.000Z',
      }),
      zap('B', '5511900000001'),
    ]);
    expect(s.wfilaNaFila(c)).toBe(true);
  });

  it('e-mail nunca está na fila do WhatsApp', () => {
    const [c] = conversas([{ id: 'E', de: 'x@y.com', status: 'pendente', threadId: 't' }]);
    expect(s.wfilaNaFila(c)).toBe(false);
  });
});

describe('wfilaContar e wfilaFiltrarConversas', () => {
  const linhas = () => [
    zap('S1', '5511900000001', { departamento: 'suporte' }),
    zap('C1', '5511900000002', { departamento: 'comercial', atribuidoA: 'Bruno' }),
    zap('N1', '5511900000003'),
    zap('X1', '5511900000004', { departamento: 'poiesis', status: 'encerrado' }),
    { id: 'E', de: 'x@y.com', status: 'pendente', threadId: 't' },
  ];

  it('conta por departamento só o WhatsApp em atendimento, e quantos estão na fila', () => {
    const n = s.wfilaContar(conversas(linhas()));
    expect(n.todos).toEqual({ total: 3, fila: 2 });
    expect(n.suporte).toEqual({ total: 1, fila: 1 });
    expect(n.comercial).toEqual({ total: 1, fila: 0 });
    expect(n.sem).toEqual({ total: 1, fila: 1 });
    expect(n.poiesis).toEqual({ total: 0, fila: 0 });
  });

  it('"todos" não esconde o e-mail; um departamento mostra só aquela fila', () => {
    const cs = conversas(linhas());
    expect(s.wfilaFiltrarConversas(cs, 'todos', false)).toHaveLength(5);
    expect(s.wfilaFiltrarConversas(cs, 'comercial', false).map((c) => c.ultima.id)).toEqual(['C1']);
    expect(s.wfilaFiltrarConversas(cs, 'sem', false).map((c) => c.ultima.id)).toEqual(['N1']);
  });

  it('"na fila" corta quem já tem responsável e o e-mail', () => {
    const ids = s
      .wfilaFiltrarConversas(conversas(linhas()), 'todos', true)
      .map((c) => c.ultima.id)
      .sort();
    expect(ids).toEqual(['N1', 'S1']);
  });
});

describe('wfilaProximaDaFila (modo local)', () => {
  it('a mais antiga da fila, respeitando o departamento', () => {
    const cs = conversas([
      zap('S1', '5511900000001', { departamento: 'suporte', recebidoEm: '2026-11-18T10:00:00Z' }),
      zap('C1', '5511900000002', { departamento: 'comercial', recebidoEm: '2026-11-18T09:00:00Z' }),
      zap('N1', '5511900000003', { recebidoEm: '2026-11-18T11:00:00Z' }),
    ]);
    expect(s.wfilaProximaDaFila(cs, null).ultima.id).toBe('C1');
    expect(s.wfilaProximaDaFila(cs, 'suporte').ultima.id).toBe('S1');
    // lista de departamentos inclui a conversa sem departamento
    expect(s.wfilaProximaDaFila(cs, ['poiesis']).ultima.id).toBe('N1');
    expect(s.wfilaProximaDaFila([], null)).toBeNull();
  });
});

describe('wfilaPegarProximo', () => {
  it('chama a função do banco com o departamento escolhido e marca só a conversa devolvida', async () => {
    lista = [zap('A', '5511900000001'), zap('B', '5511900000002')];
    rpcResposta = { data: '5511900000002', error: null };
    s.wfilaPegarProximo();
    await new Promise((r) => setImmediate(r));
    expect(rpcs).toEqual([['whatsapp_pegar_proximo', { p_departamento: null, p_team: null }]]);
    expect(lista.find((e) => e.id === 'B').atribuidoA).toBe('Ana');
    expect(lista.find((e) => e.id === 'A').atribuidoA).toBeUndefined();
    expect(s._caixaSelecionada).toBe('whatsapp:' + s.chamadoTelefoneChave('5511900000002'));
  });

  it('fila vazia avisa e não marca nada', async () => {
    lista = [zap('A', '5511900000001', { atribuidoA: 'Bruno' })];
    await s.wfilaPegarProximo();
    expect(toasts.at(-1)[0]).toMatch(/Ninguém na fila/);
    expect(lista[0].atribuidoA).toBe('Bruno');
  });

  it('banco sem a 087: diz que falta a migration em vez de fingir que pegou', async () => {
    lista = [zap('A', '5511900000001')];
    rpcResposta = { data: null, error: { code: 'PGRST202', message: 'not found' } };
    await s.wfilaPegarProximo();
    expect(toasts.at(-1)).toEqual([expect.stringMatching(/migration 087/), 'error']);
    expect(lista[0].atribuidoA).toBeUndefined();
  });

  it('sem servidor (modo local), pega a mais antiga da fila na própria tela', async () => {
    conectado = false;
    lista = [
      zap('A', '5511900000001', { recebidoEm: '2026-11-18T12:00:00Z' }),
      zap('B', '5511900000002', { recebidoEm: '2026-11-18T08:00:00Z' }),
    ];
    await s.wfilaPegarProximo();
    expect(rpcs).toEqual([]);
    expect(lista.find((e) => e.id === 'B').atribuidoA).toBe('Ana');
    expect(lista.find((e) => e.id === 'A').atribuidoA).toBeUndefined();
  });
});

describe('pausa e sinal de vida', () => {
  it('em pausa o tique não manda sinal; ao voltar, manda disponível', async () => {
    s.wfilaAlternarPausa();
    expect(s.wfilaEmPausa()).toBe(true);
    expect(rpcs.at(-1)).toEqual(['whatsapp_atendente_ping', { p_disponivel: false }]);
    rpcs = [];
    s._wfilaTique();
    expect(rpcs).toEqual([]);
    s.wfilaAlternarPausa();
    expect(rpcs.at(-1)).toEqual(['whatsapp_atendente_ping', { p_disponivel: true }]);
  });
});

describe('configuração (admin)', () => {
  it('nome de operador vai escapado para o HTML do modal', () => {
    const html = s.wfilaConfigHTML('init', null, [], ['<img src=x onerror=alert(1)>'], Date.now());
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('marca online só quem está disponível e mandou sinal há pouco', () => {
    const agora = Date.parse('2026-11-18T12:00:00Z');
    const html = s.wfilaConfigHTML(
      'init',
      { rodizio_ativo: true, limite_simultaneo: 4 },
      [
        {
          operador: 'Ana',
          disponivel: true,
          visto_em: '2026-11-18T11:59:00Z',
          recebe_rodizio: true,
        },
        { operador: 'Bruno', disponivel: true, visto_em: '2026-11-18T11:00:00Z' },
      ],
      ['Ana', 'Bruno'],
      agora
    );
    expect(html.match(/wfila-online on/g)).toHaveLength(1);
    expect(html).toMatch(/name="rodizio" checked/);
    expect(html).toMatch(/name="recebe:0" checked/);
  });

  it('o form vira as linhas do banco: departamentos marcados, limite vazio = o da equipe', () => {
    const campos = {
      rodizio: 'on',
      limite: '250',
      'recebe:0': 'on',
      'dep:0:comercial': 'on',
      'lim:0': '',
      'lim:1': '2',
    };
    const r = s.wfilaConfigDoForm((k) => campos[k] ?? null, 'init', ['Ana', 'Bruno']);
    expect(r.config).toEqual({ team: 'init', rodizio_ativo: true, limite_simultaneo: 100 });
    expect(r.atendentes).toEqual([
      {
        team: 'init',
        operador: 'Ana',
        recebe_rodizio: true,
        departamentos: ['comercial'],
        limite: null,
      },
      { team: 'init', operador: 'Bruno', recebe_rodizio: false, departamentos: [], limite: 2 },
    ]);
  });
});
