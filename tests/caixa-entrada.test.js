import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

// A caixa (js/caixa-entrada.js) lê e grava as mesmas linhas de
// js/emails-triagem.js, então os dois arquivos rodam juntos no mesmo escopo,
// como no index.html.
const FONTES = ['js/emails-triagem.js', 'js/caixa-entrada.js'].map((f) => fs.readFileSync(f, 'utf8'));

let lista, toasts, undoCb, clientes, acoes, updates, upserts, conectado, elementos;
let invokes, modais, invocacao;

function elemento() {
  return { innerHTML: '', textContent: '', classes: new Set(), classList: { toggle(c, on) { if (on) this._el.classes.add(c); else this._el.classes.delete(c); } } };
}

function carregar() {
  elementos = {};
  for (const id of ['pageTitle', 'contentArea', 'caixaLista', 'caixaConversa', 'caixaTela']) {
    elementos[id] = elemento();
    elementos[id].classList._el = elementos[id];
  }
  const sandbox = {
    console,
    window: { _supabaseAuthActive: true },
    document: { getElementById: (id) => elementos[id] || null },
    DB: { EMAILS_TRIAGEM: 'emails_triagem' },
    dbGet: () => lista,
    dbSet: (_k, v) => { lista = v; },
    getUser: () => ({ name: 'Ana' }),
    isSupabaseConnected: () => conectado,
    filterByTeam: (l) => l,
    showToast: (m, t) => toasts.push([m, t]),
    showUndoToast: (_m, cb) => { undoCb = cb; },
    openPendenciaForm: () => {},
    openModal: (titulo, html) => modais.push({ titulo, html }),
    closeModal: () => {},
    registerActions: (a) => Object.assign(acoes, a),
    getOperatorNames: () => ['Ana', 'Bruno'],
    getMyClients: () => clientes,
    getPendenciaById: () => null,
    markSyncPushFailed: () => {},
    escapeHtml: (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
    formatDateTime: (s) => String(s || ''),
    getClientById: (id) => clientes.find((c) => c.id === id) || null,
    supabaseClient: {
      from: (tabela) => ({
        update: (p) => ({ eq: (_c, id) => { updates.push({ tabela, id, p }); return Promise.resolve({}); } }),
        upsert: (l) => { upserts.push({ tabela, l }); return Promise.resolve({}); }
      }),
      functions: {
        invoke: (nome, opts) => {
          invokes.push({ nome, opts });
          return typeof invocacao === 'function' ? invocacao(nome, opts) : Promise.resolve(invocacao);
        }
      }
    }
  };
  sandbox.globalThis = sandbox;
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  const erro = console.error;
  console.error = () => {};
  try { for (const src of FONTES) vm.runInContext(src, sandbox); } finally { console.error = erro; }
  return sandbox;
}

function entrada(over) {
  return Object.assign({
    id: 'ETR-1',
    de: 'Márcia Prado <marcia@acme.com.br>',
    assunto: 'Impressora não imprime',
    corpo: 'Bom dia, a impressora parou.',
    motivo: 'sem_cliente',
    status: 'pendente',
    pendenciaId: null,
    threadId: 'thread-9',
    messageId: '<m1@acme.com.br>',
    team: 'init',
    recebidoEm: '2026-10-26T12:00:00.000Z',
    tratadoPor: null,
    tratadoEm: null,
    updatedAt: '2026-10-26T12:00:00.000Z'
  }, over);
}

let s;
beforeEach(() => {
  lista = [];
  toasts = [];
  undoCb = null;
  clientes = [{ id: 'CLI-1', name: 'Acme', team: 'suporte' }];
  acoes = {};
  updates = [];
  upserts = [];
  conectado = false;
  invokes = [];
  modais = [];
  // Padrão: envio confirmado, registrado e na mesma conversa.
  invocacao = () => Promise.resolve({ data: { success: true, to: 'marcia@acme.com.br', threaded: true, registrado: true } });
  s = carregar();
});

describe('caixaAgruparConversas', () => {
  it('junta as mensagens do mesmo thread em ordem de chegada', () => {
    const c = s.caixaAgruparConversas([
      entrada({ id: 'B', recebidoEm: '2026-10-26T14:00:00.000Z' }),
      entrada({ id: 'A', recebidoEm: '2026-10-26T10:00:00.000Z' })
    ]);
    expect(c).toHaveLength(1);
    expect(c[0].mensagens.map((m) => m.id)).toEqual(['A', 'B']);
    expect(c[0].ultima.id).toBe('B');
  });

  it('e-mail sem thread vira conversa própria, e a mais recente vem primeiro', () => {
    const c = s.caixaAgruparConversas([
      entrada({ id: 'velho', threadId: null, recebidoEm: '2026-10-20T10:00:00.000Z' }),
      entrada({ id: 'novo', threadId: null, recebidoEm: '2026-10-27T10:00:00.000Z' })
    ]);
    expect(c.map((x) => x.id)).toEqual(['novo', 'velho']);
  });

  it('a conversa segue pendente se qualquer mensagem dela ainda está pendente', () => {
    const [c] = s.caixaAgruparConversas([
      entrada({ id: 'A', status: 'pendente', recebidoEm: '2026-10-26T10:00:00.000Z' }),
      entrada({ id: 'B', status: 'anexado', recebidoEm: '2026-10-26T14:00:00.000Z' })
    ]);
    expect(c.pendente).toBe(true);
  });
});

describe('caixaFiltrar', () => {
  const conversas = () => s.caixaAgruparConversas([
    entrada({ id: 'A', threadId: 't1', status: 'pendente', atribuidoA: 'Ana', assunto: 'Impressora' }),
    entrada({ id: 'B', threadId: 't2', status: 'descartado', atribuidoA: 'Ana', assunto: 'Boleto' }),
    entrada({ id: 'C', threadId: 't3', status: 'pendente', atribuidoA: 'Bruno', assunto: 'Wi-fi', de: 'zeca@x.com' })
  ]);

  it('pendentes mostra só o que aguarda decisão', () => {
    expect(s.caixaFiltrar(conversas(), 'pendentes', '', 'Ana').map((c) => c.id).sort()).toEqual(['t1', 't3']);
  });

  it('minhas mostra o que está com o usuário, decidido ou não', () => {
    expect(s.caixaFiltrar(conversas(), 'minhas', '', 'Ana').map((c) => c.id).sort()).toEqual(['t1', 't2']);
  });

  it('todas inclui as já tratadas', () => {
    expect(s.caixaFiltrar(conversas(), 'todas', '', 'Ana')).toHaveLength(3);
  });

  it('a busca casa assunto ou remetente, sem diferenciar maiúscula', () => {
    expect(s.caixaFiltrar(conversas(), 'todas', 'BOLETO', 'Ana').map((c) => c.id)).toEqual(['t2']);
    expect(s.caixaFiltrar(conversas(), 'todas', 'zeca', 'Ana').map((c) => c.id)).toEqual(['t3']);
  });
});

describe('atribuir', () => {
  it('a primeira atribuição não pede nota', () => {
    const [c] = s.caixaAgruparConversas([entrada()]);
    expect(s.caixaValidarAtribuicao(c, 'Bruno', '')).toBeNull();
  });

  it('transferir de alguém para outro sem motivo é recusado', () => {
    lista = [entrada({ atribuidoA: 'Ana' })];
    expect(s.caixaAtribuirSalvar('thread-9', 'Bruno', '   ')).toBe(false);
    expect(toasts[0][1]).toBe('error');
    expect(lista[0].atribuidoA).toBe('Ana');
  });

  it('transferir com motivo grava a nota', () => {
    lista = [entrada({ atribuidoA: 'Ana' })];
    expect(s.caixaAtribuirSalvar('thread-9', 'Bruno', ' Bruno cuida da Acme ')).toBe(true);
    expect(lista[0].atribuidoA).toBe('Bruno');
    expect(lista[0].atribuicaoNota).toBe('Bruno cuida da Acme');
  });

  it('atribuir não decide a entrada: status e tratadoPor ficam como estavam', () => {
    lista = [entrada()];
    s.caixaAtribuirSalvar('thread-9', 'Bruno', '');
    expect(lista[0].status).toBe('pendente');
    expect(lista[0].tratadoPor).toBeNull();
    expect(lista[0].tratadoEm).toBeNull();
  });

  it('vale para todas as mensagens do thread', () => {
    lista = [entrada({ id: 'A' }), entrada({ id: 'B', recebidoEm: '2026-10-26T13:00:00.000Z' })];
    s.caixaAtribuirSalvar('thread-9', 'Bruno', '');
    expect(lista.map((e) => e.atribuidoA)).toEqual(['Bruno', 'Bruno']);
  });
});

describe('vincular', () => {
  it('a conversa passa para a equipe do cliente', () => {
    lista = [entrada()];
    expect(s.caixaVincularSalvar('thread-9', 'CLI-1')).toBe(true);
    expect(lista[0].clientId).toBe('CLI-1');
    expect(lista[0].team).toBe('suporte');
  });

  it('o robô aprende o remetente pelo domínio do cliente', () => {
    conectado = true;
    lista = [entrada()];
    s.caixaVincularSalvar('thread-9', 'CLI-1');
    const u = upserts.find((x) => x.tabela === 'clientes_remetentes');
    expect(u.l).toMatchObject({ id: 'suporte|acme.com.br', remetente: 'acme.com.br', client_id: 'CLI-1', team: 'suporte' });
  });

  it('sem cliente escolhido, nada muda', () => {
    lista = [entrada()];
    expect(s.caixaVincularSalvar('thread-9', '')).toBe(false);
    expect(lista[0].clientId).toBeUndefined();
  });
});

describe('payload do Supabase', () => {
  it('descartar não manda as colunas da 073: banco sem a migration segue aceitando', () => {
    conectado = true;
    lista = [entrada()];
    s.caixaDescartar('thread-9');
    const p = updates.find((x) => x.tabela === 'emails_triagem').p;
    expect(p.status).toBe('descartado');
    expect(p).not.toHaveProperty('atribuido_a');
    expect(p).not.toHaveProperty('client_id');
  });

  it('atribuir manda só as colunas de atribuição', () => {
    conectado = true;
    lista = [entrada()];
    s.caixaAtribuirSalvar('thread-9', 'Bruno', '');
    const p = updates.find((x) => x.tabela === 'emails_triagem').p;
    expect(p.atribuido_a).toBe('Bruno');
    expect(p.atribuicao_nota).toBeNull();
    expect(p).not.toHaveProperty('client_id');
  });
});

describe('descartar', () => {
  it('descarta as pendentes do thread e o desfazer devolve para pendente', () => {
    lista = [entrada({ id: 'A' }), entrada({ id: 'B', status: 'anexado', recebidoEm: '2026-10-26T13:00:00.000Z' })];
    s.caixaDescartar('thread-9');
    expect(lista.map((e) => e.status)).toEqual(['descartado', 'anexado']);
    undoCb();
    expect(lista.map((e) => e.status)).toEqual(['pendente', 'anexado']);
  });
});

describe('renderCaixaEntrada', () => {
  it('assunto e corpo do e-mail entram escapados', () => {
    lista = [entrada({ assunto: '<img src=x onerror=alert(1)>', corpo: '<script>alert(1)</script>' })];
    s._caixaSelecionada = 'thread-9';
    s.renderCaixaEntrada();
    const html = elementos.caixaLista.innerHTML + elementos.caixaConversa.innerHTML;
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(elementos.caixaConversa.innerHTML).toContain('&lt;script&gt;');
    expect(elementos.caixaTela.classes.has('cx-aberta')).toBe(true);
  });

  it('a ação de selecionar abre a conversa', () => {
    lista = [entrada()];
    acoes.caixaSelecionar(null, 'thread-9');
    expect(elementos.caixaConversa.innerHTML).toContain('Impressora não imprime');
  });

  it('mensagem respondida mostra o selo de resposta enviada', () => {
    lista = [entrada({ status: 'respondido' })];
    s._caixaSelecionada = 'thread-9';
    s.renderCaixaEntrada();
    expect(elementos.caixaConversa.innerHTML).toContain('resposta enviada');
  });
});

describe('responder', () => {
  it('o modal do Responder escapa o assunto do e-mail', () => {
    lista = [entrada({ assunto: '<img src=x onerror=alert(1)>' })];
    s.caixaResponder('thread-9');
    expect(modais).toHaveLength(1);
    expect(modais[0].html).not.toContain('<img');
    expect(modais[0].html).toContain('&lt;img');
    expect(modais[0].html).toContain('marcia@acme.com.br');
  });

  it('sem texto não envia nada', async () => {
    conectado = true;
    lista = [entrada()];
    expect(await s.caixaResponderSalvar('thread-9', '   ')).toBe(false);
    expect(invokes).toHaveLength(0);
    expect(toasts[0][1]).toBe('error');
  });

  it('sem conexão nada é enviado e o erro diz por quê', async () => {
    conectado = false;
    lista = [entrada()];
    expect(await s.caixaResponderSalvar('thread-9', 'Olá Márcia')).toBe(false);
    expect(invokes).toHaveLength(0);
    expect(toasts[0][0]).toMatch(/conexão/);
  });

  it('conversa sem pendente não responde de novo', async () => {
    conectado = true;
    lista = [entrada({ status: 'anexado' })];
    expect(await s.caixaResponderSalvar('thread-9', 'Olá Márcia')).toBe(false);
    expect(invokes).toHaveLength(0);
    expect(toasts[0][0]).toMatch(/tratada/);
  });

  it('sucesso: envia para a pendente mais nova e fecha as pendentes do thread', async () => {
    conectado = true;
    lista = [
      entrada({ id: 'A', recebidoEm: '2026-10-26T10:00:00.000Z' }),
      entrada({ id: 'B', recebidoEm: '2026-10-26T14:00:00.000Z' })
    ];
    expect(await s.caixaResponderSalvar('thread-9', 'Vamos verificar hoje.')).toBe(true);
    expect(invokes).toHaveLength(1);
    expect(invokes[0].nome).toBe('caixa-responder');
    expect(invokes[0].opts.body).toEqual({ email_id: 'B', text: 'Vamos verificar hoje.' });
    expect(lista.map((e) => e.status)).toEqual(['respondido', 'respondido']);
    expect(lista[0].tratadoPor).toBe('Ana');
    expect(toasts[0][1]).toBe('success');
  });

  it('falha do envio mantém a conversa pendente', async () => {
    conectado = true;
    lista = [entrada()];
    invocacao = () => Promise.resolve({ data: { success: false, error: 'SMTP recusou' } });
    expect(await s.caixaResponderSalvar('thread-9', 'Olá Márcia')).toBe(false);
    expect(lista[0].status).toBe('pendente');
    expect(toasts[0][1]).toBe('error');
    expect(toasts[0][0]).toMatch(/SMTP recusou/);
  });

  it('erro de rede também mantém a conversa pendente', async () => {
    conectado = true;
    lista = [entrada()];
    invocacao = () => Promise.reject(new Error('rede fora'));
    expect(await s.caixaResponderSalvar('thread-9', 'Olá Márcia')).toBe(false);
    expect(lista[0].status).toBe('pendente');
    expect(toasts[0][1]).toBe('error');
  });

  it('sem message-id o aviso diz que saiu como conversa nova', async () => {
    conectado = true;
    lista = [entrada({ messageId: null })];
    invocacao = () => Promise.resolve({ data: { success: true, to: 'marcia@acme.com.br', threaded: false, registrado: true } });
    expect(await s.caixaResponderSalvar('thread-9', 'Olá Márcia')).toBe(true);
    expect(toasts[0][0]).toMatch(/conversa nova/);
  });

  it('envio confirmado mas sem registro na base avisa a falha', async () => {
    conectado = true;
    lista = [entrada()];
    invocacao = () => Promise.resolve({ data: { success: true, to: 'marcia@acme.com.br', threaded: true, registrado: false } });
    expect(await s.caixaResponderSalvar('thread-9', 'Olá Márcia')).toBe(true);
    // O e-mail saiu: o app não desfaz, só avisa.
    expect(lista[0].status).toBe('respondido');
    expect(toasts[0][1]).toBe('error');
    expect(toasts[0][0]).toMatch(/registro/);
  });
});
