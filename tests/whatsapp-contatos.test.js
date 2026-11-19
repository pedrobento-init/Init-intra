import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// Contatos do WhatsApp (js/whatsapp-contatos.js). A lista é o histórico da
// Caixa agrupado por telefone + equipe; o nome editado é por equipe.
let mem;
let wc;

function chave(t) {
  let d = String(t || '').replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.indexOf('55') === 0) d = d.slice(2);
  if (d.length === 11 && d[2] === '9') d = d.slice(0, 2) + d.slice(3);
  return d.length >= 10 ? d : '';
}

beforeEach(() => {
  mem = { intra_whatsapp_contatos: [] };
  globalThis.dbGet = (k) => mem[k];
  globalThis.dbSet = (k, v) => {
    mem[k] = v;
  };
  globalThis.wetqChave = chave;
  globalThis.isSupabaseConnected = () => false;
  globalThis.getUser = () => ({ name: 'Ana' });
  globalThis._addTombstone = () => {};
  globalThis._removeTombstone = () => {};
  delete require.cache[require.resolve('../js/whatsapp-contatos.js')];
  wc = require('../js/whatsapp-contatos.js');
});

const AGORA = Date.parse('2026-11-18T12:00:00Z');
const linha = (over) =>
  Object.assign(
    {
      id: Math.random().toString(36).slice(2),
      canal: 'whatsapp',
      telefone: '5511987654321',
      team: 'init',
      direcao: 'entrada',
      status: 'anexado',
      de: 'Márcia',
      recebidoEm: '2026-11-18T10:00:00Z',
    },
    over
  );

describe('lista de contatos', () => {
  it('agrupa o mesmo número escrito de dois jeitos e guarda o nome do perfil', () => {
    const r = wc.wcontListar(
      [
        linha({ de: '5511987654321', recebidoEm: '2026-11-18T09:00:00Z' }),
        linha({ telefone: '11987654321', de: 'Márcia Souza' }),
      ],
      { agora: AGORA, salvos: [] }
    );
    expect(r).toHaveLength(1);
    expect(r[0].nomePerfil).toBe('Márcia Souza');
    expect(r[0].janelaAberta).toBe(true);
  });

  it('quem nunca escreveu (só a empresa mandou) não é contato', () => {
    const r = wc.wcontListar([linha({ direcao: 'saida', de: 'Ana' })], {
      agora: AGORA,
      salvos: [],
    });
    expect(r).toEqual([]);
  });

  it('o mesmo número em duas equipes são dois contatos, cada um com o seu nome', () => {
    const salvos = [{ id: 'x', telefone: '1187654321', nome: 'Márcia (financeiro)', team: 'mam' }];
    const r = wc.wcontListar([linha(), linha({ team: 'mam' })], { agora: AGORA, salvos });
    const porEquipe = Object.fromEntries(r.map((c) => [c.team, c.nome]));
    expect(porEquipe).toEqual({ init: 'Márcia', mam: 'Márcia (financeiro)' });
  });

  it('vincula cliente pelo telefone só quando um cliente da equipe bate', () => {
    const clientes = [
      { id: 'C1', team: 'init', ownerPhone: '(11) 98765-4321' },
      { id: 'C2', team: 'mam', ownerPhone: '(11) 98765-4321' },
    ];
    const r = wc.wcontListar([linha()], { agora: AGORA, salvos: [], clientes });
    expect(r[0].clientId).toBe('C1');
  });

  it('janela de 24 h fecha depois de um dia sem mensagem do cliente', () => {
    const r = wc.wcontListar([linha({ recebidoEm: '2026-11-17T10:00:00Z' })], {
      agora: AGORA,
      salvos: [],
    });
    expect(r[0].janelaAberta).toBe(false);
  });

  it('busca por dígitos do telefone e por nome do cliente', () => {
    const r = wc.wcontListar([linha(), linha({ telefone: '5521911112222', clientId: 'C9' })], {
      agora: AGORA,
      salvos: [],
    });
    expect(wc.wcontFiltrar(r, '1111-2222')).toHaveLength(1);
    expect(wc.wcontFiltrar(r, 'acme', (id) => (id === 'C9' ? 'Acme' : ''))).toHaveLength(1);
  });
});

describe('nome de exibição', () => {
  it('salva por equipe e telefone normalizado; vazio volta ao nome do perfil', () => {
    expect(wc.wcontSalvarNome('5511987654321', 'init', '  Márcia ').ok).toBe(true);
    expect(mem.intra_whatsapp_contatos[0]).toMatchObject({
      id: 'wct:init:1187654321',
      telefone: '1187654321',
      nome: 'Márcia',
    });
    expect(wc.wcontNome('(11) 98765-4321', 'init')).toBe('Márcia');
    expect(wc.wcontNome('(11) 98765-4321', 'mam')).toBe('');
    wc.wcontSalvarNome('11987654321', 'init', '');
    expect(mem.intra_whatsapp_contatos).toEqual([]);
  });

  it('nome longo demais é recusado', () => {
    expect(wc.wcontSalvarNome('11987654321', 'init', 'x'.repeat(81)).erro).toBeTruthy();
  });
});

describe('aviso antes do envio ativo (o servidor decide de novo)', () => {
  it('cliente da lista ou contato que já escreveu pode; número solto não', () => {
    const contatos = [{ chave: '2133334444' }];
    const clientes = [{ id: 'C1', ownerPhone: '(11) 98765-4321' }];
    expect(wc.wcontPodeIniciar('11 98765-4321', contatos, clientes)).toBe(true);
    expect(wc.wcontPodeIniciar('+55 21 3333-4444', contatos, clientes)).toBe(true);
    expect(wc.wcontPodeIniciar('31 99999-0000', contatos, clientes)).toBe(false);
  });
});
