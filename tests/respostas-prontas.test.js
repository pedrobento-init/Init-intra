import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// O módulo é script clássico: depende de globais (dbGet/dbSet/DB...). Aqui
// eles viram um armazenamento em memória, sem Supabase conectado.
let mem;
let rp;
beforeEach(() => {
  mem = {};
  globalThis.DB = { RESPOSTAS_PRONTAS: 'intra_respostas_prontas' };
  globalThis.dbGet = (k) => mem[k];
  globalThis.dbSet = (k, v) => { mem[k] = v; };
  globalThis.isSupabaseConnected = () => false;
  globalThis.getCurrentTeam = () => 'suporte';
  globalThis.getUser = () => ({ name: 'Ana' });
  globalThis.filterByTeam = (l) => l.filter((r) => r.team === 'suporte');
  delete require.cache[require.resolve('../js/respostas-prontas.js')];
  rp = require('../js/respostas-prontas.js');
});

describe('respostas prontas', () => {
  it('não salva sem título ou sem texto', () => {
    expect(rp.salvarRespostaPronta({ titulo: '  ', conteudo: 'x' })).toBeNull();
    expect(rp.salvarRespostaPronta({ titulo: 'x', conteudo: '' })).toBeNull();
    expect(rp.getRespostasProntas()).toEqual([]);
  });

  it('cria na equipe atual com autor', () => {
    const r = rp.salvarRespostaPronta({ titulo: 'Oi', conteudo: 'Recebemos.' });
    expect(r.id).toMatch(/^rp_/);
    expect(r.team).toBe('suporte');
    expect(r.createdBy).toBe('Ana');
  });

  it('edição mantém a equipe original da linha', () => {
    mem.intra_respostas_prontas = [{ id: 'a', titulo: 'T', conteudo: 'C', team: 'campo' }];
    const r = rp.salvarRespostaPronta({ id: 'a', titulo: 'T2', conteudo: 'C2' });
    expect(r.team).toBe('campo');
    expect(rp.getRespostasProntas()).toHaveLength(1);
    expect(rp.getRespostasProntas()[0].titulo).toBe('T2');
  });

  it('exclui pelo id e recusa id inexistente', () => {
    mem.intra_respostas_prontas = [{ id: 'a', titulo: 'T', conteudo: 'C', team: 'suporte' }];
    expect(rp.excluirRespostaPronta('x')).toBe(false);
    expect(rp.excluirRespostaPronta('a')).toBe(true);
    expect(rp.getRespostasProntas()).toEqual([]);
  });

  it('lista só a equipe atual, em ordem de título', () => {
    mem.intra_respostas_prontas = [
      { id: '1', titulo: 'Zeta', conteudo: 'z', team: 'suporte' },
      { id: '2', titulo: 'Alfa', conteudo: 'a', team: 'suporte' },
      { id: '3', titulo: 'Beta', conteudo: 'b', team: 'campo' }
    ];
    expect(rp.respostasProntasDaEquipe().map((r) => r.titulo)).toEqual(['Alfa', 'Zeta']);
  });

  it('inserir acrescenta ao texto já digitado', () => {
    mem.intra_respostas_prontas = [{ id: 'a', titulo: 'T', conteudo: 'Reinicie o roteador.', team: 'suporte' }];
    const ta = { value: 'Olá!  \n', focus() {} };
    globalThis.document = { getElementById: (id) => (id === 'newNoteText' ? ta : null) };
    expect(rp.inserirRespostaPronta('a')).toBe(true);
    expect(ta.value).toBe('Olá!\n\nReinicie o roteador.');
    delete globalThis.document;
  });
});

// O detalhe do chamado vive no #modalBody: qualquer openModal() aqui o
// substitui e leva junto o #newNoteText. Estes testes trancam o seletor no
// painel do composer.
describe('seletor no composer do chamado', () => {
  let acoes, ta, painel, chamadas;
  beforeEach(() => {
    chamadas = { openModal: 0, closeModal: 0, toast: [] };
    globalThis.escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    globalThis.openModal = () => { chamadas.openModal++; };
    globalThis.closeModal = () => { chamadas.closeModal++; };
    globalThis.showToast = (m) => { chamadas.toast.push(m); };
    globalThis.registerActions = (m) => { acoes = m; };
    ta = { value: 'Bom dia, João.', focus() {} };
    painel = { innerHTML: '', hidden: true };
    globalThis.document = { getElementById: (id) => ({ newNoteText: ta, rpPainel: painel })[id] || null };
    mem.intra_respostas_prontas = [{ id: 'a', titulo: 'Roteador', conteudo: 'Reinicie o roteador.', team: 'suporte' }];
    delete require.cache[require.resolve('../js/respostas-prontas.js')];
    rp = require('../js/respostas-prontas.js');
  });

  afterEach(() => {
    for (const k of ['document', 'escapeHtml', 'openModal', 'closeModal', 'showToast', 'registerActions']) delete globalThis[k];
  });

  it('abre no painel do composer, sem trocar o modal do chamado', () => {
    acoes.rpAbrir();
    expect(chamadas.openModal).toBe(0);
    expect(painel.hidden).toBe(false);
    expect(painel.innerHTML).toContain('data-action="rpInserir" data-arg="a"');
    expect(ta.value).toBe('Bom dia, João.');
  });

  it('o mesmo botão fecha o painel aberto', () => {
    acoes.rpAbrir();
    acoes.rpAbrir();
    expect(painel.hidden).toBe(true);
    expect(painel.innerHTML).toBe('');
  });

  it('inserir mantém o texto digitado, fecha só o painel e não fecha o chamado', () => {
    acoes.rpAbrir();
    acoes.rpInserir(null, 'a');
    expect(ta.value).toBe('Bom dia, João.\n\nReinicie o roteador.');
    expect(painel.hidden).toBe(true);
    expect(chamadas.closeModal).toBe(0);
    expect(chamadas.toast).toEqual([]);
  });

  it('salvar recarrega o painel com a resposta nova, sem abrir modal', () => {
    const campos = { rpId: { value: '' }, rpTitulo: { value: 'Senha Wi-Fi' }, rpConteudo: { value: 'Troque a senha.' } };
    globalThis.document = { getElementById: (id) => ({ newNoteText: ta, rpPainel: painel, ...campos })[id] || null };
    acoes.rpSalvar();
    expect(chamadas.openModal).toBe(0);
    expect(painel.innerHTML).toContain('Senha Wi-Fi');
    expect(rp.getRespostasProntas()).toHaveLength(2);
  });

  it('editar preenche o form do painel com a resposta escolhida', () => {
    acoes.rpEditar(null, 'a');
    expect(painel.innerHTML).toContain('id="rpId" value="a"');
    expect(painel.innerHTML).toContain('Editar resposta');
    expect(chamadas.openModal).toBe(0);
  });

  it('escapa título e texto da resposta no painel', () => {
    mem.intra_respostas_prontas = [{ id: 'x"y', titulo: '<img src=x onerror=alert(1)>', conteudo: '<script>1</script>', team: 'suporte' }];
    acoes.rpAbrir();
    expect(painel.innerHTML).not.toContain('<img');
    expect(painel.innerHTML).not.toContain('<script>');
    expect(painel.innerHTML).toContain('data-arg="x&quot;y"');
  });

  it('sem chamado aberto cai no modal para gerenciar as respostas', () => {
    globalThis.document = { getElementById: () => null };
    acoes.rpAbrir();
    expect(chamadas.openModal).toBe(1);
  });
});
