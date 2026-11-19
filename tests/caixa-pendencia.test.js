import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

// Pendência e chamado do Milvus abertos do painel da conversa
// (js/caixa-pendencia.js). As regras puras vão por require; o fluxo na tela
// roda a Caixa inteira no mesmo escopo, como no index.html.

const require = createRequire(import.meta.url);
const {
  cxpPendenciasAbertas,
  cxpChamadosMilvusAbertos,
  cxpPendenciaDados,
  cxpFiltrarTickets,
  cxpCodigoDigitado,
  cxpMilvusResultado,
  cxpNovaRef,
} = require('../js/caixa-pendencia.js');

describe('cxpPendenciasAbertas', () => {
  const lista = [
    { id: 'P1', clientId: 'c1', status: 'aberto', createdAt: '2026-11-01' },
    { id: 'P2', clientId: 'c1', status: 'resolvido', createdAt: '2026-11-02' },
    { id: 'P3', clientId: 'c1', status: 'pausado', createdAt: '2026-11-03' },
    { id: 'P4', clientId: 'c2', status: 'aberto', createdAt: '2026-11-04' },
    { id: 'P5', clientId: 'c1', status: 'cancelado', createdAt: '2026-11-05' },
    { id: 'P6', clientId: 'c1', status: 'concluido', createdAt: '2026-11-06' },
  ];

  it('traz só as do cliente que não estão fechadas, as mais novas primeiro', () => {
    expect(cxpPendenciasAbertas(lista, 'c1').map((p) => p.id)).toEqual(['P3', 'P1']);
  });

  it('sem cliente não lista nada (não mistura pendências internas)', () => {
    expect(cxpPendenciasAbertas(lista, '')).toEqual([]);
  });
});

describe('cxpChamadosMilvusAbertos', () => {
  it('deixa de fora finalizado, cancelado e sem código; o mais novo primeiro', () => {
    const lista = [
      { codigo: 10, status: 'Em atendimento' },
      { codigo: 12, status: 'Finalizado' },
      { codigo: 11, status: 'A fazer' },
      { codigo: 13, status: 'Cancelado' },
      { codigo: null, status: 'Novo' },
      { codigo: 9, status: '' },
    ];
    expect(cxpChamadosMilvusAbertos(lista).map((t) => t.codigo)).toEqual([11, 10, 9]);
  });
});

describe('cxpPendenciaDados', () => {
  const ctx = { canal: 'whatsapp', solicitante: 'Carla', descricao: 'Backup falhou' };

  it('monta a pendência de suporte com o que veio da conversa', () => {
    const d = cxpPendenciaDados(
      {
        titulo: '  Backup sem rodar  ',
        clientId: 'c1',
        clientName: 'MMolaw',
        priority: 'alta',
        responsible: 'Pedro',
        deadline: '2026-11-20',
      },
      ctx,
      '2026-11-19'
    );
    expect(d).toMatchObject({
      clientId: 'c1',
      clientName: 'MMolaw',
      tipo: 'Suporte',
      assunto: 'Backup sem rodar',
      descricao: 'Backup falhou',
      responsible: 'Pedro',
      status: 'aberto',
      priority: 'alta',
      deadline: '2026-11-20',
      solicitante: 'Carla',
      canal: 'whatsapp',
    });
    expect(d.milvusChamadoCodigo).toBeUndefined();
  });

  it('prioridade inventada vira média', () => {
    expect(cxpPendenciaDados({ titulo: 'x', priority: 'urgente' }, ctx, '').priority).toBe('media');
  });

  it('descrição vazia na conversa cai no título (a validação exige descrição)', () => {
    expect(cxpPendenciaDados({ titulo: 'Impressora' }, { canal: 'email' }, '').descricao).toBe(
      'Impressora'
    );
  });

  it('guarda o chamado do Milvus só quando é um código válido', () => {
    expect(cxpPendenciaDados({ titulo: 'x', milvusCodigo: 321 }, ctx, '').milvusChamadoCodigo).toBe(
      321
    );
    expect(
      cxpPendenciaDados({ titulo: 'x', milvusCodigo: '-4' }, ctx, '').milvusChamadoCodigo
    ).toBeUndefined();
  });

  it('só leva o fio da conversa quando o contexto manda (primeira pendência)', () => {
    const fio = { emailThreadId: 'whatsapp:5511987654321', solicitanteEmail: '' };
    expect(cxpPendenciaDados({ titulo: 'x' }, { ...ctx, vinculo: fio }, '').emailThreadId).toBe(
      'whatsapp:5511987654321'
    );
    expect(cxpPendenciaDados({ titulo: 'x' }, ctx, '').emailThreadId).toBeUndefined();
  });
});

describe('busca de chamado do Milvus', () => {
  const tickets = [
    { codigo: 26030, assunto: 'Backup do servidor' },
    { codigo: 26001, assunto: 'Licença Office' },
    { codigo: null, assunto: 'sem código' },
  ];

  it('acha por código, com ou sem #, e por assunto', () => {
    expect(cxpFiltrarTickets(tickets, '#2603').map((t) => t.codigo)).toEqual([26030]);
    expect(cxpFiltrarTickets(tickets, 'licen').map((t) => t.codigo)).toEqual([26001]);
  });

  it('nunca oferece chamado sem código', () => {
    expect(cxpFiltrarTickets(tickets, '').map((t) => t.codigo)).toEqual([26030, 26001]);
  });

  it('número digitado vale como código; texto e zero não', () => {
    expect(cxpCodigoDigitado(' #26100 ')).toBe(26100);
    expect(cxpCodigoDigitado('abc')).toBeNull();
    expect(cxpCodigoDigitado('0')).toBeNull();
  });
});

describe('cxpMilvusResultado', () => {
  it('sucesso traz o código; recuperado diz que o chamado já existia', () => {
    expect(cxpMilvusResultado({ success: true, codigo: 12 })).toEqual({
      ok: true,
      codigo: 12,
      recuperado: false,
    });
    expect(cxpMilvusResultado({ success: true, codigo: 12, recovered: true }).recuperado).toBe(
      true
    );
  });

  it('cliente sem token tem mensagem própria', () => {
    expect(cxpMilvusResultado({ code: 'MILVUS_CLIENT_TOKEN_NOT_CONFIGURED' }).msg).toMatch(/token/);
  });

  it('erro de rede no invoke não vira sucesso', () => {
    expect(cxpMilvusResultado(null, new Error('timeout')).ok).toBe(false);
  });
});

it('cxpNovaRef sai no formato que a Edge aceita', () => {
  expect(cxpNovaRef('ab$c-12_3!xyz')).toBe('CX-abc-12_3xyz');
  expect(cxpNovaRef()).toMatch(/^CX-[A-Za-z0-9_-]{6,64}$/);
});

// ── Na tela ────────────────────────────────────────────────────────────────

const FONTES = [
  'js/chamado-canal.js',
  'js/emails-triagem.js',
  'js/caixa-entrada.js',
  'js/caixa-pendencia.js',
].map((f) => fs.readFileSync(f, 'utf8'));

let mem, elementos, acoes, salvas, toasts, invocacoes, respostaMilvus, pendencias, tickets;

const CONV = 'whatsapp:1187654321';

function carregar() {
  elementos = {};
  for (const id of [
    'pageTitle',
    'contentArea',
    'caixaLista',
    'caixaConversa',
    'caixaTela',
    'caixaCanalChips',
    'caixaTabs',
  ])
    elementos[id] = { innerHTML: '', textContent: '', classList: { toggle() {} } };
  acoes = {};
  salvas = [];
  toasts = [];
  invocacoes = [];
  const clientes = [
    { id: 'c1', name: 'MMolaw <b>', team: 'init' },
    { id: 'c2', name: 'Outra', team: 'outra' },
  ];
  const sandbox = {
    console,
    window: { _supabaseAuthActive: true },
    document: { getElementById: (id) => elementos[id] || null },
    DB: { EMAILS_TRIAGEM: 'emails_triagem' },
    dbGet: (k) => mem[k] || [],
    dbSet: (k, v) => {
      mem[k] = v;
    },
    getUser: () => ({ name: 'Pedro' }),
    isSupabaseConnected: () => true,
    supabaseClient: {
      functions: {
        invoke: async (fn, opts) => {
          invocacoes.push([fn, opts.body]);
          return { data: respostaMilvus, error: null };
        },
      },
      from: () => ({ update: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
    },
    filterByTeam: (l) => l,
    getCurrentTeam: () => 'init',
    isTeamAdmin: () => false,
    registerActions: (a) => Object.assign(acoes, a),
    getMyClients: () => clientes,
    getClientById: (id) => clientes.find((c) => c.id === id) || null,
    getOperatorNames: () => ['Pedro', 'Bruno'],
    getMyPendencias: () => pendencias,
    getPendenciaById: (id) => pendencias.find((p) => p.id === id) || null,
    savePendencia: (d) => {
      if (!d.id) d.id = 'PEN-0099';
      salvas.push(d);
      return d;
    },
    validatePendencia: (d) => (d.assunto ? [] : ['Assunto é obrigatório.']),
    slaPrazoSugerido: (p) => (p === 'alta' ? '2026-11-20' : '2026-11-21'),
    localDateISO: () => '2026-11-19',
    showToast: (m, t) => toasts.push([m, t]),
    updateBadges: () => {},
    escapeHtml: (s) =>
      String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;'),
    formatDateTime: (s) => String(s || ''),
    STATUS_PEN_MAP: { aberto: { label: 'Aberto' }, pausado: { label: 'Pausado' } },
  };
  if (tickets) {
    sandbox.getClientMilvusTickets = async (id) => (id === 'c1' ? tickets : []);
    sandbox.syncClientMilvusTickets = async () => {
      tickets = tickets.concat([{ codigo: 26200, assunto: 'Chamado novo', status: 'Novo' }]);
      return { synced: 1 };
    };
  }
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const src of FONTES) vm.runInContext(src, sandbox);
  return sandbox;
}

// Abrir a conversa também avisa o "visto" por outra function: só interessa a do Milvus.
const doMilvus = () => invocacoes.filter(([fn]) => fn === 'milvus-chamado-create');

let s;
beforeEach(() => {
  mem = {
    emails_triagem: [
      {
        id: 'W1',
        canal: 'whatsapp',
        telefone: '5511987654321',
        threadId: 'whatsapp:5511987654321',
        de: 'Carla Mendes',
        direcao: 'entrada',
        corpo: 'Backup sem rodar desde ontem 22h',
        status: 'pendente',
        clientId: 'c1',
        team: 'init',
        recebidoEm: '2026-11-18T10:00:00.000Z',
      },
    ],
  };
  pendencias = [
    { id: 'PEN-0071', clientId: 'c1', status: 'aberto', assunto: 'Backup sem notícia' },
    { id: 'PEN-0025', clientId: 'c1', status: 'pausado', assunto: 'Cancelamento <script>' },
    { id: 'PEN-0030', clientId: 'c1', status: 'resolvido', assunto: 'Velha' },
  ];
  respostaMilvus = { success: true, codigo: 26100 };
  tickets = null;
  s = carregar();
  s._caixaSelecionada = CONV;
});

const painel = () => elementos.caixaConversa.innerHTML;

describe('Caixa — painel de detalhes', () => {
  it('mostra as pendências abertas do cliente sem precisar abrir formulário', () => {
    s.renderCaixaEntrada();
    expect(painel()).toContain('Pendências abertas de MMolaw &lt;b&gt;');
    expect(painel()).toContain('#71 · Aberto');
    expect(painel()).toContain('Cancelamento &lt;script&gt;');
    expect(painel()).not.toContain('Velha');
  });

  it('tem os botões de criar pendência e chamado no Milvus', () => {
    s.renderCaixaEntrada();
    expect(painel()).toContain('data-action="cxpAbrir"');
    expect(painel()).toContain('data-tipo="milvus"');
  });

  it('abre o formulário com título, cliente, responsável e prazo do SLA já preenchidos', () => {
    acoes.cxpAbrir({ dataset: { tipo: 'pendencia' } }, CONV);
    const h = painel();
    expect(h).toContain('Nova pendência');
    expect(h).toContain('Origem: WhatsApp · Carla Mendes');
    expect(h).toContain('<option value="c1" selected>');
    expect(h).toContain('<option value="Pedro" selected>');
    expect(h).toContain('value="2026-11-21"');
  });

  it('prioridade alta recalcula o prazo pelo SLA enquanto a data não foi escolhida à mão', () => {
    acoes.cxpAbrir({ dataset: { tipo: 'pendencia' } }, CONV);
    acoes.cxpPrioridade(null, 'alta');
    expect(painel()).toContain('value="2026-11-20"');
    acoes.cxpPrazo(null, '2026-12-01');
    acoes.cxpPrioridade(null, 'baixa');
    expect(painel()).toContain('value="2026-12-01"');
  });

  it('o que foi digitado sobrevive ao redesenho do sync', () => {
    acoes.cxpAbrir({ dataset: { tipo: 'pendencia' } }, CONV);
    acoes.cxpCampo({ dataset: { campo: 'titulo' } }, 'Título <novo>');
    s.renderCaixaEntrada();
    expect(painel()).toContain('value="Título &lt;novo&gt;"');
  });

  it('criar pendência leva o fio da conversa e marca a mensagem como chamado', () => {
    acoes.cxpAbrir({ dataset: { tipo: 'pendencia' } }, CONV);
    acoes.cxpMilvusEscolher(null, '26030');
    acoes.cxpCriarPendencia(null, CONV);
    expect(salvas).toHaveLength(1);
    expect(salvas[0]).toMatchObject({
      clientId: 'c1',
      canal: 'whatsapp',
      solicitante: 'Carla Mendes',
      emailThreadId: 'whatsapp:5511987654321',
      milvusChamadoCodigo: 26030,
    });
    expect(mem.emails_triagem[0]).toMatchObject({
      status: 'virou_chamado',
      pendenciaId: 'PEN-0099',
    });
    expect(painel()).not.toContain('Nova pendência');
  });

  it('conversa que já tem chamado não passa o fio para a pendência nova', () => {
    mem.emails_triagem[0].pendenciaId = 'PEN-0071';
    mem.emails_triagem[0].status = 'anexado';
    acoes.cxpAbrir({ dataset: { tipo: 'pendencia' } }, CONV);
    acoes.cxpCriarPendencia(null, CONV);
    expect(salvas[0].emailThreadId).toBeUndefined();
    expect(mem.emails_triagem[0].pendenciaId).toBe('PEN-0071');
  });

  it('recusa cliente de outra equipe', () => {
    acoes.cxpAbrir({ dataset: { tipo: 'pendencia' } }, CONV);
    acoes.cxpCliente(null, 'c2');
    acoes.cxpCriarPendencia(null, CONV);
    expect(salvas).toHaveLength(0);
    expect(toasts.at(-1)[1]).toBe('error');
  });

  it('chamado no Milvus sai pela Edge com a ref e vincula à pendência da conversa', async () => {
    mem.emails_triagem[0].pendenciaId = 'PEN-0071';
    mem.emails_triagem[0].status = 'anexado';
    acoes.cxpAbrir({ dataset: { tipo: 'milvus' } }, CONV);
    expect(painel()).toContain('<option value="PEN-0071" selected>');
    await s.cxpCriarMilvus(CONV);
    expect(doMilvus()).toHaveLength(1);
    const [fn, body] = doMilvus()[0];
    expect(fn).toBe('milvus-chamado-create');
    expect(body).toMatchObject({
      action: 'conversa',
      clientId: 'c1',
      contato: 'Carla Mendes',
      telefone: '5511987654321',
    });
    expect(body.ref).toMatch(/^CX-/);
    expect(salvas.at(-1)).toMatchObject({ id: 'PEN-0071', milvusChamadoCodigo: 26100 });
    expect(toasts.at(-1)[0]).toContain('#26100');
  });

  it('falha do Milvus mantém o formulário aberto com a mesma ref para tentar de novo', async () => {
    respostaMilvus = { success: false, code: 'MILVUS_UNAVAILABLE' };
    acoes.cxpAbrir({ dataset: { tipo: 'milvus' } }, CONV);
    await s.cxpCriarMilvus(CONV);
    respostaMilvus = { success: true, codigo: 5 };
    await s.cxpCriarMilvus(CONV);
    expect(doMilvus()).toHaveLength(2);
    expect(doMilvus()[0][1].ref).toBe(doMilvus()[1][1].ref);
    expect(toasts[0][1]).toBe('error');
  });
});

describe('Caixa — chamados abertos no Milvus', () => {
  const espera = () => new Promise((r) => setTimeout(r, 0));

  beforeEach(() => {
    tickets = [
      { codigo: 26030, assunto: 'Backup do servidor', status: 'Em atendimento', tecnico: 'Bruno' },
      { codigo: 26001, assunto: 'Licença <Office>', status: 'A fazer' },
      { codigo: 25900, assunto: 'Antigo', status: 'Finalizado' },
    ];
    pendencias[0].milvusChamadoCodigo = 26030;
    s = carregar();
    s._caixaSelecionada = CONV;
  });

  it('lista os abertos do cliente junto das pendências, sem abrir formulário', async () => {
    s.renderCaixaEntrada();
    expect(painel()).toContain('Carregando chamados');
    await espera();
    const h = painel();
    expect(h).toContain('Chamados abertos no Milvus de MMolaw &lt;b&gt;');
    expect(h).toContain('#26030 · Em atendimento · Bruno');
    expect(h).toContain('Licença &lt;Office&gt;');
    expect(h).not.toContain('Antigo');
  });

  it('mostra qual pendência já cuida do chamado', async () => {
    s.renderCaixaEntrada();
    await espera();
    expect(painel()).toMatch(/data-arg="PEN-0071">Pendência #71/);
    expect(painel()).toContain('Sem pendência vinculada');
  });

  it('redesenhar não dispara uma leitura nova a cada mensagem', async () => {
    let leituras = 0;
    const ler = s.getClientMilvusTickets;
    s.getClientMilvusTickets = (id) => {
      leituras++;
      return ler(id);
    };
    s.renderCaixaEntrada();
    s.renderCaixaEntrada();
    await espera();
    s.renderCaixaEntrada();
    expect(leituras).toBe(1);
  });

  it('"Atualizar do Milvus" sincroniza e relê a lista', async () => {
    s.renderCaixaEntrada();
    await espera();
    await s.cxpMilvusAtualizar('c1');
    await espera();
    expect(painel()).toContain('#26200');
  });
});
