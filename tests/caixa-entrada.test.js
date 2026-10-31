import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

// A caixa (js/caixa-entrada.js) lê e grava as mesmas linhas de
// js/emails-triagem.js, então os dois arquivos rodam juntos no mesmo escopo,
// como no index.html.
// js/chamado-canal.js vem antes, como no index.html: a caixa usa dele a chave
// de telefone e a formatação do número.
const FONTES = ['js/chamado-canal.js', 'js/emails-triagem.js', 'js/caixa-entrada.js'].map((f) => fs.readFileSync(f, 'utf8'));

let lista, toasts, undoCb, clientes, acoes, updates, upserts, conectado, elementos, formAberto;

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
    openPendenciaForm: (...args) => { formAberto = args; },
    openModal: () => {},
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
      })
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
  formAberto = null;
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
});

describe('corpo e prévia', () => {
  it('corta a citação da resposta anterior e separa a assinatura', () => {
    const r = s.caixaCorpoLimpo('Segue o print.\n--\nMárcia\nAcme\nEm seg, 26 de out, Ana escreveu:\n> texto velho');
    expect(r.texto).toBe('Segue o print.');
    expect(r.assinatura).toBe('Márcia\nAcme');
  });

  it('prévia pula a saudação e corta texto longo com reticências', () => {
    expect(s.caixaPrevia('Bom dia,\nA impressora parou.')).toBe('A impressora parou.');
    expect(s.caixaPrevia('x'.repeat(50), 10)).toBe('x'.repeat(9) + '…');
  });

  it('rótulo de espera em minutos, horas e dias', () => {
    const agora = Date.parse('2026-10-26T12:00:00Z');
    expect(s.caixaEsperaRotulo('2026-10-26T11:55:00Z', agora)).toBe('há 5 min');
    expect(s.caixaEsperaRotulo('2026-10-26T09:00:00Z', agora)).toBe('há 3 h');
    expect(s.caixaEsperaRotulo('2026-10-25T12:00:00Z', agora)).toBe('há 1 dia');
    expect(s.caixaEsperaRotulo('', agora)).toBe('');
  });
});

describe('sugestão de cliente', () => {
  const conv = (id, de, clientId) => ({ id, clientId: clientId || null, ultima: { id: 'm-' + id, de } });

  it('domínio corporativo já vinculado sugere o mesmo cliente', () => {
    const alvo = conv('t1', 'Márcia <marcia@acme.com.br>');
    const outra = conv('t2', 'José <jose@acme.com.br>', 'CLI-1');
    expect(s.caixaSugerirCliente(alvo, [alvo, outra])).toBe('CLI-1');
  });

  it('gmail de outra pessoa não vira sugestão', () => {
    const alvo = conv('t1', 'Márcia <marcia@gmail.com>');
    const outra = conv('t2', 'José <jose@gmail.com>', 'CLI-1');
    expect(s.caixaSugerirCliente(alvo, [alvo, outra])).toBeNull();
  });

  it('conversa já vinculada não recebe sugestão', () => {
    const alvo = conv('t1', 'Márcia <marcia@acme.com.br>', 'CLI-2');
    expect(s.caixaSugerirCliente(alvo, [alvo, conv('t2', 'x@acme.com.br', 'CLI-1')])).toBeNull();
  });

  it('histórico traz só outras conversas do mesmo endereço', () => {
    const alvo = conv('t1', 'Márcia <marcia@acme.com.br>');
    const todas = [alvo, conv('t2', 'marcia@acme.com.br'), conv('t3', 'jose@acme.com.br')];
    expect(s.caixaHistoricoRemetente(alvo, todas).map((c) => c.id)).toEqual(['t2']);
  });
});

describe('contagem e não lidas', () => {
  it('conta conversas por filtro', () => {
    const convs = s.caixaAgruparConversas([entrada(), entrada({ id: 'ETR-2', threadId: 'thread-8', status: 'convertido' })]);
    const n = s.caixaContarFiltros(convs, 'Ana');
    expect(n.todas).toBe(2);
    expect(n.pendentes).toBe(1);
  });

  it('mensagem nova no thread volta a conversa para não lida', () => {
    const c = { id: 't1', ultima: { id: 'm2' } };
    expect(s.caixaNaoLida(c, { t1: 'm1' })).toBe(true);
    expect(s.caixaNaoLida(c, { t1: 'm2' })).toBe(false);
  });
});

describe('canal da entrada', () => {
  const whats = (over) => entrada(Object.assign({ canal: 'whatsapp', telefone: '5511987654321', threadId: null, de: 'Márcia Prado', corpo: 'Oi, a impressora parou' }, over));

  it('entrada sem canal conta como e-mail: linha anterior à 075 não muda de lugar', () => {
    const [c] = s.caixaAgruparConversas([entrada()]);
    expect(s.caixaCanalEntrada(entrada())).toBe('email');
    expect(c.canal).toBe('email');
    expect(c.id).toBe('thread-9');
  });

  it('telefone preenchido basta para ser WhatsApp, mesmo sem a coluna canal', () => {
    expect(s.caixaCanalEntrada(entrada({ telefone: '5511987654321' }))).toBe('whatsapp');
  });

  it('o mesmo telefone escrito com e sem 55 e nono dígito é uma conversa só', () => {
    const c = s.caixaAgruparConversas([
      whats({ id: 'A', telefone: '5511987654321', recebidoEm: '2026-10-26T10:00:00.000Z' }),
      whats({ id: 'B', telefone: '(11) 8765-4321', recebidoEm: '2026-10-26T11:00:00.000Z' })
    ]);
    expect(c).toHaveLength(1);
    expect(c[0].id).toBe('whatsapp:1187654321');
    expect(c[0].canal).toBe('whatsapp');
    expect(c[0].mensagens.map((m) => m.id)).toEqual(['A', 'B']);
  });

  it('telefone não colide com thread id do e-mail', () => {
    const c = s.caixaAgruparConversas([whats({ id: 'A', telefone: '1187654321' }), entrada({ id: 'B', threadId: '1187654321' })]);
    expect(c).toHaveLength(2);
  });

  it('o filtro de canal separa e-mail de WhatsApp, e "todos" devolve tudo', () => {
    const convs = s.caixaAgruparConversas([entrada(), whats({ id: 'W' })]);
    expect(s.caixaFiltrarCanal(convs, 'whatsapp').map((c) => c.canal)).toEqual(['whatsapp']);
    expect(s.caixaFiltrarCanal(convs, 'email').map((c) => c.id)).toEqual(['thread-9']);
    expect(s.caixaFiltrarCanal(convs, 'todos')).toHaveLength(2);
  });

  it('conversa sem canal entra no filtro de e-mail', () => {
    expect(s.caixaFiltrarCanal([{ id: 'x' }], 'email')).toHaveLength(1);
  });

  it('a busca acha a conversa pelo telefone em qualquer formato', () => {
    const convs = s.caixaAgruparConversas([entrada(), whats({ id: 'W' })]);
    expect(s.caixaFiltrar(convs, 'todas', '98765-4321', 'Ana').map((c) => c.canal)).toEqual(['whatsapp']);
  });

  it('a ação de canal troca o filtro e valor desconhecido volta para todos', () => {
    lista = [entrada(), whats({ id: 'W', assunto: 'Wi-fi caiu' })];
    acoes.caixaCanal(null, 'whatsapp');
    expect(s._caixaCanal).toBe('whatsapp');
    expect(elementos.caixaLista.innerHTML).not.toContain('Impressora não imprime');
    acoes.caixaCanal(null, 'fax');
    expect(s._caixaCanal).toBe('todos');
  });

  it('nome e corpo do WhatsApp entram escapados na lista e na conversa', () => {
    lista = [whats({ id: 'W', de: '<img src=x onerror=alert(1)>', corpo: '<script>alert(1)</script>', assunto: '' })];
    s._caixaSelecionada = 'whatsapp:1187654321';
    s.renderCaixaEntrada();
    const html = elementos.caixaLista.innerHTML + elementos.caixaConversa.innerHTML;
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(elementos.caixaConversa.innerHTML).toContain('&lt;script&gt;');
  });

  it('remetente que é só o número aparece formatado', () => {
    expect(s._caixaNomeDe({ de: '5511987654321', telefone: '5511987654321' }, 'whatsapp')).toBe('(11) 98765-4321');
    expect(s._caixaNomeDe({ de: 'Márcia', telefone: '5511987654321' }, 'whatsapp')).toBe('Márcia');
  });

  it('corpo do WhatsApp não perde linha com "--" nem "> ", que no e-mail seriam assinatura e citação', () => {
    const r = s.caixaCorpoLimpo('Oi\r\n--\r\n> segue', 'whatsapp');
    expect(r.texto).toBe('Oi\n--\n> segue');
    expect(r.assinatura).toBe('');
  });
});

describe('cliente pelo telefone', () => {
  it('casa o número do WhatsApp com o telefone do dono no cadastro', () => {
    const cl = [{ id: 'CLI-1', ownerPhone: '(11) 98765-4321' }, { id: 'CLI-2', ownerPhone: '(21) 3333-4444' }];
    expect(s.caixaClientePorTelefone('5511987654321', cl)).toBe('CLI-1');
  });

  it('casa também o telefone do responsável', () => {
    expect(s.caixaClientePorTelefone('11987654321', [{ id: 'CLI-3', responsiblePhone: '1187654321' }])).toBe('CLI-3');
  });

  it('dois clientes com o mesmo número é ambíguo e não sugere nenhum', () => {
    const cl = [{ id: 'CLI-1', ownerPhone: '11987654321' }, { id: 'CLI-2', responsiblePhone: '(11) 98765-4321' }];
    expect(s.caixaClientePorTelefone('5511987654321', cl)).toBeNull();
  });

  it('número curto demais não casa com nada', () => {
    expect(s.caixaClientePorTelefone('4321', [{ id: 'CLI-1', ownerPhone: '4321' }])).toBeNull();
  });

  it('a sugestão da conversa de WhatsApp vem do cadastro de clientes', () => {
    clientes = [{ id: 'CLI-1', name: 'Acme', team: 'suporte', ownerPhone: '(11) 98765-4321' }];
    const conversa = { id: 'whatsapp:1187654321', canal: 'whatsapp', telefone: '5511987654321', clientId: null, ultima: { de: 'Márcia' } };
    expect(s.caixaSugerirCliente(conversa, [conversa])).toBe('CLI-1');
  });

  it('o histórico do WhatsApp junta outras conversas do mesmo telefone', () => {
    const alvo = { id: 'w1', canal: 'whatsapp', telefone: '5511987654321' };
    const todas = [alvo, { id: 'w2', canal: 'whatsapp', telefone: '1187654321' }, { id: 'w3', canal: 'whatsapp', telefone: '21999998888' }];
    expect(s.caixaHistoricoRemetente(alvo, todas).map((c) => c.id)).toEqual(['w2']);
  });

  it('vincular conversa de WhatsApp não ensina domínio ao robô', () => {
    conectado = true;
    lista = [entrada({ canal: 'whatsapp', telefone: '5511987654321', threadId: null, de: 'Márcia' })];
    expect(s.caixaVincularSalvar('whatsapp:1187654321', 'CLI-1')).toBe(true);
    expect(upserts.find((x) => x.tabela === 'clientes_remetentes')).toBeUndefined();
  });
});

describe('abrir chamado do WhatsApp', () => {
  it('abre o formulário com canal e telefone no thread id, sem e-mail de resposta', () => {
    lista = [entrada({ id: 'W', canal: 'whatsapp', telefone: '5511987654321', threadId: null, de: 'Márcia', assunto: '', corpo: 'A impressora parou', clientId: 'CLI-1' })];
    s.caixaAbrirChamado('whatsapp:1187654321');
    const [pendId, clientId, , prefill] = formAberto;
    expect(pendId).toBeNull();
    expect(clientId).toBe('CLI-1');
    expect(prefill).toMatchObject({
      canal: 'whatsapp',
      emailThreadId: 'whatsapp:5511987654321',
      solicitante: 'Márcia',
      solicitanteEmail: '',
      assunto: 'WhatsApp de Márcia',
      descricao: 'A impressora parou',
      etrEntrada: 'W'
    });
  });

  it('conversa de WhatsApp já tratada não abre formulário', () => {
    lista = [entrada({ canal: 'whatsapp', telefone: '5511987654321', threadId: null, status: 'convertido' })];
    s.caixaAbrirChamado('whatsapp:1187654321');
    expect(formAberto).toBeNull();
    expect(toasts[0][1]).toBe('error');
  });
});
