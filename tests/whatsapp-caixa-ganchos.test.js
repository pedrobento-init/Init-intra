import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

// Os ganchos da 089 na Caixa: a Caixa (js/caixa-entrada.js) roda junto com
// js/whatsapp-etiquetas.js e js/whatsapp-contatos.js no mesmo escopo, como no
// index.html. Sem esses dois arquivos a Caixa tem de seguir igual — é o que
// tests/caixa-entrada.test.js já cobre, carregando só ela.
const FONTES = [
  'js/chamado-canal.js',
  'js/emails-triagem.js',
  'js/caixa-entrada.js',
  'js/whatsapp-etiquetas.js',
  'js/whatsapp-contatos.js',
].map((f) => fs.readFileSync(f, 'utf8'));

let mem, elementos;

function elemento() {
  const el = { innerHTML: '', textContent: '', classList: { toggle() {} } };
  return el;
}

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
    elementos[id] = elemento();
  const sandbox = {
    console,
    window: { _supabaseAuthActive: false },
    document: { getElementById: (id) => elementos[id] || null },
    DB: { EMAILS_TRIAGEM: 'emails_triagem' },
    dbGet: (k) => mem[k] || [],
    dbSet: (k, v) => {
      mem[k] = v;
    },
    getUser: () => ({ name: 'Ana' }),
    isSupabaseConnected: () => false,
    filterByTeam: (l) => l,
    getCurrentTeam: () => 'init',
    registerActions: () => {},
    getMyClients: () => [],
    getClientById: () => null,
    getPendenciaById: () => null,
    escapeHtml: (s) =>
      String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;'),
    formatDateTime: (s) => String(s || ''),
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const src of FONTES) vm.runInContext(src, sandbox);
  return sandbox;
}

function whats(over) {
  return Object.assign(
    {
      id: 'W1',
      canal: 'whatsapp',
      telefone: '5511987654321',
      threadId: 'whatsapp:5511987654321',
      de: 'Márcia',
      direcao: 'entrada',
      corpo: 'Oi, preciso de ajuda',
      status: 'pendente',
      team: 'init',
      recebidoEm: '2026-11-18T10:00:00.000Z',
    },
    over
  );
}

let s;
beforeEach(() => {
  mem = {
    emails_triagem: [
      whats(),
      whats({
        id: 'W2',
        telefone: '5521911112222',
        threadId: 'whatsapp:5521911112222',
        de: 'Paulo',
      }),
    ],
    intra_whatsapp_etiquetas: [{ id: 'e-fin', nome: 'Financeiro', cor: 'verde', team: 'init' }],
    intra_whatsapp_conversa_etiquetas: [
      { id: 'a1', telefone: '1187654321', etiquetaId: 'e-fin', team: 'init' },
    ],
    intra_whatsapp_contatos: [],
  };
  s = carregar();
});

describe('Caixa com etiquetas e contatos (089)', () => {
  it('o item da lista mostra a etiqueta da conversa', () => {
    s.renderCaixaEntrada();
    const html = elementos.caixaLista.innerHTML;
    expect(html).toContain('wetq-cor-verde');
    expect(html).toContain('Financeiro');
  });

  it('filtrar pela etiqueta deixa só a conversa marcada, e as contagens seguem', () => {
    s._wetqFiltro = 'e-fin';
    s.renderCaixaEntrada();
    expect(elementos.caixaLista.innerHTML).toContain('Márcia');
    expect(elementos.caixaLista.innerHTML).not.toContain('Paulo');
    expect(elementos.caixaTabs.innerHTML).toMatch(/Em atendimento <span class="cx-tab-n">1</);
    expect(elementos.caixaCanalChips.innerHTML).toContain('data-change="wetqFiltro"');
  });

  it('o cabeçalho da conversa aberta mostra as etiquetas e o botão de etiquetas', () => {
    s._caixaSelecionada = 'whatsapp:1187654321';
    s.renderCaixaEntrada();
    const html = elementos.caixaConversa.innerHTML;
    expect(html).toContain('data-action="wetqAbrir"');
    expect(html).toMatch(/cx-conv-id.*Financeiro/s);
  });

  it('nome editado em Contatos aparece no lugar do nome do perfil', () => {
    mem.intra_whatsapp_contatos = [
      { id: 'c', telefone: '1187654321', nome: 'Márcia (Acme)', team: 'init' },
    ];
    s.renderCaixaEntrada();
    expect(elementos.caixaLista.innerHTML).toContain('Márcia (Acme)');
  });

  // whatsapp-iniciar grava só a saída, com "de" = quem atendeu: sem o gancho,
  // a lista mostrava a Ana como se fosse o contato.
  it('conversa que a empresa começou mostra o telefone, não o nome de quem enviou', () => {
    mem.emails_triagem = [
      whats({ id: 'A1', direcao: 'saida', de: 'Ana', status: 'anexado', corpo: 'Ana: Olá' }),
    ];
    s.renderCaixaEntrada();
    const html = elementos.caixaLista.innerHTML;
    expect(html).toContain('(11) 98765-4321');
    expect(html).not.toMatch(/class="cx-nm">Ana</);
  });
});
