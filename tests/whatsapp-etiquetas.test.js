import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);

// Etiquetas do WhatsApp (js/whatsapp-etiquetas.js, migration 089). A regra que
// importa: a etiqueta é da CONVERSA (telefone normalizado + equipe), não da
// mensagem, e não atravessa equipe.
let mem;
let wetq;

// Mesma regra de js/chamado-canal.js: sem 55 e sem o nono dígito.
function chave(t) {
  let d = String(t || '').replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.indexOf('55') === 0) d = d.slice(2);
  if (d.length === 11 && d[2] === '9') d = d.slice(0, 2) + d.slice(3);
  return d.length >= 10 ? d : '';
}

beforeEach(() => {
  mem = {
    intra_whatsapp_etiquetas: [
      { id: 'e-fin', nome: 'Financeiro', cor: 'verde', team: 'init' },
      { id: 'e-urg', nome: 'Urgente', cor: 'vermelho', team: 'init' },
      { id: 'e-mam', nome: 'VIP', cor: 'roxo', team: 'mam' },
    ],
    intra_whatsapp_conversa_etiquetas: [],
  };
  globalThis.dbGet = (k) => mem[k];
  globalThis.dbSet = (k, v) => {
    mem[k] = v;
  };
  globalThis.chamadoTelefoneChave = chave;
  globalThis.isSupabaseConnected = () => false;
  globalThis.getCurrentTeam = () => 'init';
  globalThis.getUser = () => ({ name: 'Ana' });
  globalThis.filterByTeam = (l) => l.filter((r) => (r.team || 'init') === 'init');
  globalThis.escapeHtml = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
  globalThis._addTombstone = () => {};
  globalThis._removeTombstone = () => {};
  delete require.cache[require.resolve('../js/whatsapp-etiquetas.js')];
  wetq = require('../js/whatsapp-etiquetas.js');
});

function conversa(telefone, team, canal = 'whatsapp') {
  return {
    id: 'whatsapp:' + chave(telefone),
    canal,
    telefone,
    ultima: { team, telefone },
    mensagens: [{ team, telefone }],
  };
}

describe('etiqueta mora na conversa', () => {
  it('marcar com o número num formato vale para o mesmo número escrito de outro jeito', () => {
    expect(wetq.wetqAlternar('5511987654321', 'init', 'e-fin')).toBe(true);
    const c = conversa('(11) 8765-4321', 'init');
    expect(wetq.wetqDaConversa(c).map((e) => e.nome)).toEqual(['Financeiro']);
  });

  it('marcar de novo desmarca', () => {
    wetq.wetqAlternar('11987654321', 'init', 'e-fin');
    expect(wetq.wetqAlternar('11987654321', 'init', 'e-fin')).toBe(false);
    expect(mem.intra_whatsapp_conversa_etiquetas).toEqual([]);
  });

  it('o mesmo par conversa+etiqueta tem id fixo (dois aparelhos não duplicam)', () => {
    wetq.wetqAlternar('11987654321', 'init', 'e-fin');
    expect(mem.intra_whatsapp_conversa_etiquetas[0].id).toBe(
      wetq.wetqIdAplicada('init', '1187654321', 'e-fin')
    );
  });

  it('etiqueta de outra equipe é recusada antes de ir ao banco', () => {
    expect(wetq.wetqAlternar('11987654321', 'init', 'e-mam')).toBeNull();
    expect(mem.intra_whatsapp_conversa_etiquetas).toEqual([]);
  });

  it('a etiqueta de uma equipe não aparece na conversa do mesmo número em outra equipe', () => {
    wetq.wetqAlternar('11987654321', 'init', 'e-fin');
    expect(wetq.wetqDaConversa(conversa('11987654321', 'mam'))).toEqual([]);
  });

  it('e-mail nunca tem etiqueta', () => {
    wetq.wetqAlternar('11987654321', 'init', 'e-fin');
    expect(wetq.wetqDaConversa(conversa('11987654321', 'init', 'email'))).toEqual([]);
  });
});

describe('filtro da Caixa por etiqueta', () => {
  const aplicadas = [
    { id: 'a1', telefone: '1187654321', etiquetaId: 'e-fin', team: 'init' },
    { id: 'a2', telefone: '2133334444', etiquetaId: 'e-urg', team: 'init' },
  ];
  const lista = () => [
    conversa('5511987654321', 'init'),
    conversa('2133334444', 'init'),
    conversa('11987654321', 'init', 'email'),
    conversa('5511987654321', 'mam'),
  ];

  it('sem etiqueta escolhida devolve tudo', () => {
    expect(wetq.wetqFiltrarConversas(lista(), '', aplicadas)).toHaveLength(4);
  });

  it('com etiqueta, só as conversas marcadas, na equipe certa', () => {
    const r = wetq.wetqFiltrarConversas(lista(), 'e-fin', aplicadas);
    expect(r).toHaveLength(1);
    expect(r[0].ultima.team).toBe('init');
    expect(r[0].canal).toBe('whatsapp');
  });

  it('etiqueta sem conversa nenhuma devolve lista vazia', () => {
    expect(wetq.wetqFiltrarConversas(lista(), 'e-mam', aplicadas)).toEqual([]);
  });

  // Admin vê a conversa agrupada com linhas de duas equipes: vale a marca de
  // qualquer uma delas.
  it('conversa com linhas de duas equipes casa pela marca de qualquer uma', () => {
    const c = conversa('5511987654321', 'mam');
    c.mensagens.push({ team: 'init', telefone: '5511987654321' });
    expect(wetq.wetqFiltrarConversas([c], 'e-fin', aplicadas)).toHaveLength(1);
  });
});

describe('cadastro de etiquetas', () => {
  it('não aceita nome vazio, cor fora da paleta nem nome repetido na equipe', () => {
    expect(wetq.wetqSalvarEtiqueta({ nome: ' ', cor: 'azul' }).erro).toBeTruthy();
    expect(wetq.wetqSalvarEtiqueta({ nome: 'Nova', cor: '#ff0000' }).erro).toBeTruthy();
    expect(wetq.wetqSalvarEtiqueta({ nome: 'financeiro', cor: 'azul' }).erro).toMatch(/Já existe/);
  });

  it('o mesmo nome pode existir em outra equipe', () => {
    const r = wetq.wetqSalvarEtiqueta({ nome: 'Financeiro', cor: 'azul', team: 'mam' });
    expect(r.etiqueta.team).toBe('mam');
  });

  it('cria na equipe atual, com autor', () => {
    const r = wetq.wetqSalvarEtiqueta({ nome: 'Retorno', cor: 'amarelo' });
    expect(r.etiqueta).toMatchObject({
      nome: 'Retorno',
      cor: 'amarelo',
      team: 'init',
      createdBy: 'Ana',
    });
  });

  it('apagar a etiqueta tira ela das conversas', () => {
    wetq.wetqAlternar('11987654321', 'init', 'e-fin');
    wetq.wetqExcluirEtiqueta('e-fin');
    expect(mem.intra_whatsapp_conversa_etiquetas).toEqual([]);
    expect(mem.intra_whatsapp_etiquetas.map((e) => e.id)).not.toContain('e-fin');
  });

  it('o nome da etiqueta é escapado no chip', () => {
    const html = wetq.wetqChipsHTML([{ id: 'x', nome: '<img src=x>', cor: 'azul' }]);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('cor desconhecida vinda do banco vira cinza, nunca classe livre', () => {
    const html = wetq.wetqChipsHTML([{ id: 'x', nome: 'a', cor: 'azul" onclick="x' }]);
    expect(html).toContain('wetq-cor-cinza');
    expect(html).not.toContain('onclick');
  });

  // A cor vai para classe CSS; o CHECK da 089 é a mesma lista. Se uma mudar
  // sem a outra, o banco recusa a etiqueta ou a tela mostra cinza.
  it('a paleta do app é a mesma do CHECK da migration 089', () => {
    const sql = fs.readFileSync('supabase/migrations/089_whatsapp_etiquetas_contatos.sql', 'utf8');
    const m = /cor in \(([^)]*)\)/.exec(sql);
    const doBanco = m[1].match(/'([a-z]+)'/g).map((s) => s.replace(/'/g, ''));
    expect(doBanco.sort()).toEqual(Object.keys(wetq.WETQ_CORES).sort());
    const css = fs.readFileSync('css/whatsapp.css', 'utf8');
    for (const cor of doBanco) expect(css).toContain('.wetq-cor-' + cor);
  });
});
