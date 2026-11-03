import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const raizRepo = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const ARQUIVO = path.join(raizRepo, 'js', 'projeto-pagina.js');

// O feed real não é exportado por pendencias-detalhe.js, que é escopo global. Compila só
// o trecho dele: um stub esconderia uma mudança na ordem que a tela precisa inverter.
function feedReal() {
  const fonte = fs.readFileSync(path.join(raizRepo, 'js', 'pendencias-detalhe.js'), 'utf8');
  const ini = fonte.indexOf('function _penFeedItens');
  const fim = fonte.indexOf('/** Marcador discreto', ini);
  return new Function(fonte.slice(ini, fim) + '; return { _penFeedItens, _penValorLabel, _PEN_EVENT_VERBO };')();
}

const escapeReal = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const XSS = '<img src=x onerror=alert(1)>';
const XSS_ESC = '&lt;img src=x onerror=alert(1)&gt;';
const semTags = (html) => html.replace(/<[^>]+>/g, '');

let mod;
let acoes;

function carregar() {
  delete require.cache[ARQUIVO];
  acoes = {};
  globalThis.registerActions = (m) => Object.assign(acoes, m);
  return require(ARQUIVO);
}

function projeto(extra) {
  return { id: 'p1', status: 'aberto', priority: 'media', team: 'init', ...extra };
}

function desenhar(p, estado) {
  const container = { innerHTML: '' };
  mod.renderProjetoPagina(p, container, estado || null);
  return container.innerHTML;
}

function painel(html, chave) {
  const ini = html.indexOf('data-prj-painel="' + chave + '"');
  const prox = html.indexOf('data-prj-painel=', ini + 20);
  return html.slice(ini, prox === -1 ? undefined : prox);
}

beforeEach(() => {
  const feed = feedReal();
  Object.assign(globalThis, feed, {
    escapeHtml: escapeReal,
    // Stubs escapam como os reais: o que se testa é o que esta tela faz com o dado.
    pgpVoltarHtml: (r) => '<a class="pgp-voltar" href="#pendencias">← ' + escapeReal(r) + '</a>',
    pgpSeletoresHtml: () => '<div class="pgp-seletores"><select id="chgStatus"></select></div>',
    pgpAvatarHtml: (n) => '<span class="pgp-avatar" aria-label="' + escapeReal(n) + '"></span>',
    pgpTempoAtras: (iso) => (iso ? 'há 1 h' : ''),
    getPendenciaTitulo: (p) => p.title,
    penDisplayNumber: () => '#001',
    getClientById: () => null,
    getAttachments: () => [],
    renderAttachmentList: vi.fn(),
    formatDate: (d) => 'DATA:' + d,
    parseDeadline: (v) => v,
    isPendenciaClosed: (s) => s === 'resolvido',
    localDateISO: () => '2026-11-02',
    _penRichDesc: escapeReal,
    _penRichNote: escapeReal,
    penPaginaAtualizar: vi.fn(),
    addPendenciaNote: vi.fn(() => true),
    addCheckItem: vi.fn(),
    toggleCheckItem: vi.fn(),
    removeCheckItem: vi.fn(),
    openPendenciaForm: vi.fn(),
    showToast: vi.fn(),
    getUser: () => ({ name: 'Pedro' }),
  });
  mod = carregar();
});

describe('renderProjetoPagina: escape de dado de usuário', () => {
  it('escapa o título', () => {
    const html = desenhar(projeto({ title: XSS }));
    expect(html).toContain(XSS_ESC);
    expect(html).not.toContain(XSS);
  });

  it('escapa a descrição', () => {
    const html = desenhar(projeto({ title: 't', descricao: XSS }));
    expect(html).toContain(XSS_ESC);
    expect(html).not.toContain(XSS);
  });

  it('escapa a descrição mesmo sem o renderizador rico carregado', () => {
    globalThis._penRichDesc = undefined;
    const html = desenhar(projeto({ title: 't', descricao: XSS }));
    expect(html).not.toContain(XSS);
  });

  it('escapa o texto da nota no feed e no trecho da lateral', () => {
    const html = desenhar(projeto({ title: 't', notes: [{ text: XSS, author: 'Ana', createdAt: '2026-11-01T10:00:00Z' }] }));
    expect(html).not.toContain(XSS);
    expect(html.split(XSS_ESC).length - 1).toBe(2);
  });

  it('escapa o nome do autor, do responsável e o valor de evento', () => {
    const html = desenhar(projeto({
      title: 't',
      responsible: XSS,
      notes: [{ text: 'oi', author: XSS, createdAt: '2026-11-01T10:00:00Z' }],
      events: [{ type: 'responsavel', para: XSS, by: XSS, at: '2026-11-01T11:00:00Z' }],
    }));
    expect(html).not.toContain(XSS);
  });

  it('escapa o texto da etapa também no aria-label do botão de remover', () => {
    const html = desenhar(projeto({ title: 't', checklist: [{ text: '"><script>x</script>', done: false }] }));
    expect(html).not.toContain('<script>');
    expect(html).toContain('aria-label="Remover etapa: &quot;&gt;&lt;script&gt;');
  });

  it('escapa o id do projeto em atributo', () => {
    const html = desenhar(projeto({ id: '"x"', title: 't' }));
    expect(html).not.toContain('data-arg=""x""');
  });
});

describe('renderProjetoPagina: abas', () => {
  it('conta notas e eventos no contador de Atividade', () => {
    const html = desenhar(projeto({
      title: 't',
      notes: [{ text: 'a', createdAt: '2026-11-01T10:00:00Z' }],
      events: [{ type: 'criado', at: '2026-10-01T10:00:00Z' }, { type: 'status', de: 'a', para: 'b', at: '2026-10-02T10:00:00Z' }],
    }));
    expect(html).toContain('<span class="prj-aba-contador">3</span>');
  });

  it('abre em Visão geral quando não há estado', () => {
    const html = desenhar(projeto({ title: 't' }));
    expect(html).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*data-pgp-aba="visao"/);
    expect(html).toMatch(/data-prj-painel="atividade" hidden/);
  });

  it('ignora aba desconhecida vinda do estado', () => {
    const html = desenhar(projeto({ title: 't' }), { aba: 'x', rascunhos: {} });
    expect(html).toMatch(/aria-selected="true"[^>]*data-pgp-aba="visao"/);
  });

  it('prjTrocarAba alterna aria-selected e hidden sem redesenhar', () => {
    const botoes = ['visao', 'atividade'].map((k) => ({ dataset: { pgpAba: k }, setAttribute(a, v) { this[a] = v; } }));
    const paineis = ['visao', 'atividade'].map((k) => ({ dataset: { prjPainel: k }, hidden: false }));
    const raiz = { querySelectorAll: (sel) => (sel.includes('aba') ? botoes : paineis) };
    mod.prjTrocarAba(raiz, 'atividade');
    expect(botoes[1]['aria-selected']).toBe('true');
    expect(botoes[0]['aria-selected']).toBe('false');
    expect(paineis.map((x) => x.hidden)).toEqual([true, false]);
  });
});

describe('renderProjetoPagina: estado de redesenho', () => {
  it('desenha a aba que estava aberta', () => {
    const html = desenhar(projeto({ title: 't' }), { aba: 'atividade', rascunhos: {} });
    expect(html).toMatch(/aria-selected="true"[^>]*data-pgp-aba="atividade"/);
    expect(html).toMatch(/data-prj-painel="visao" hidden/);
    expect(html).not.toMatch(/data-prj-painel="atividade" hidden/);
  });

  // _pgpRestaurarEstado só devolve rascunho a campo presente: sumir com o da aba oculta perde o texto.
  it.each([['visao'], ['atividade']])('mantém os dois campos de rascunho no DOM com a aba %s aberta', (aba) => {
    const html = desenhar(projeto({ title: 't' }), { aba, rascunhos: {} });
    expect(html).toContain('data-pgp-rascunho="prj-etapa"');
    expect(html).toContain('data-pgp-rascunho="prj-nota"');
  });

  it('não inicia os campos com valor, para a restauração da base ser a única fonte', () => {
    const html = desenhar(projeto({ title: 't' }), { aba: 'visao', rascunhos: { 'prj-nota': 'x' } });
    expect(html).toMatch(/<textarea[^>]*data-pgp-rascunho="prj-nota"[^>]*><\/textarea>/);
  });
});

describe('checklist', () => {
  it('calcula o progresso pelos itens marcados', () => {
    expect(mod.prjProgressoChecklist({ checklist: [{ done: true }, { done: false }, { done: true }, { done: false }] }))
      .toEqual({ feitos: 2, total: 4, percentual: 50 });
  });

  it('não divide por zero sem etapas', () => {
    expect(mod.prjProgressoChecklist({})).toEqual({ feitos: 0, total: 0, percentual: 0 });
  });

  it('mostra X de Y e a barra de progresso', () => {
    const html = desenhar(projeto({ title: 't', checklist: [{ text: 'a', done: true }, { text: 'b', done: false }] }));
    expect(html).toContain('1 de 2');
    expect(html).toContain('<progress class="prj-progresso" value="1" max="2"');
  });

  it('marca como feita só a etapa concluída', () => {
    const html = desenhar(projeto({ title: 't', checklist: [{ text: 'a', done: true }, { text: 'b', done: false }] }));
    expect(html.split('prj-etapa-feita').length - 1).toBe(1);
    expect(html.split(' checked').length - 1).toBe(1);
  });

  it('sem etapas não mostra barra, e o campo de adicionar continua', () => {
    const html = desenhar(projeto({ title: 't' }));
    expect(html).not.toContain('<progress');
    expect(html).toContain('id="newCheckItem"');
  });

  // addCheckItem lê este id e o teclado delegado ignora Enter em input: sem form, Enter não adiciona.
  it('o campo de adicionar etapa fica dentro de um form com submit delegado', () => {
    const html = desenhar(projeto({ title: 't' }));
    expect(html).toMatch(/<form[^>]*data-submit="prjAdicionarEtapa"[^>]*data-arg="p1"[\s\S]*id="newCheckItem"[\s\S]*<\/form>/);
  });

  it('adicionar chama addCheckItem e redesenha a página', () => {
    acoes.prjAdicionarEtapa({}, 'p1');
    expect(globalThis.addCheckItem).toHaveBeenCalledWith('p1');
    expect(globalThis.penPaginaAtualizar).toHaveBeenCalledWith('p1');
  });

  it('marcar converte o índice em número e redesenha a página', () => {
    acoes.prjMarcarEtapa({ dataset: { id: 'p1', indice: '2' } }, true);
    expect(globalThis.toggleCheckItem).toHaveBeenCalledWith('p1', 2);
    expect(globalThis.penPaginaAtualizar).toHaveBeenCalledWith('p1');
  });

  it('remover converte o índice em número e redesenha a página', () => {
    acoes.prjRemoverEtapa({ dataset: { id: 'p1' } }, '1');
    expect(globalThis.removeCheckItem).toHaveBeenCalledWith('p1', 1);
    expect(globalThis.penPaginaAtualizar).toHaveBeenCalledWith('p1');
  });
});

describe('feed de atividade', () => {
  const comFeed = () => projeto({
    title: 't',
    notes: [
      { text: 'nota-antiga', author: 'Ana', createdAt: '2026-10-01T10:00:00Z' },
      { text: 'nota-nova', author: 'Bia', createdAt: '2026-11-01T10:00:00Z' },
    ],
    events: [{ type: 'prioridade', de: 'baixa', para: 'alta', by: 'Caio', at: '2026-10-15T10:00:00Z' }],
  });

  it('ordena do mais recente para o mais antigo, misturando notas e eventos', () => {
    const html = painel(desenhar(comFeed()), 'atividade');
    const nova = html.indexOf('nota-nova');
    const evento = html.indexOf('mudou a prioridade');
    const antiga = html.indexOf('nota-antiga');
    expect(nova).toBeGreaterThan(-1);
    expect(nova).toBeLessThan(evento);
    expect(evento).toBeLessThan(antiga);
  });

  it('descreve evento em texto com de e para', () => {
    expect(painel(desenhar(comFeed()), 'atividade')).toContain('mudou a prioridade: baixa → alta');
  });

  it('atribui ao Sistema o item sem autor', () => {
    const html = painel(desenhar(projeto({ title: 't', events: [{ type: 'criado', at: '2026-10-01T10:00:00Z' }] })), 'atividade');
    expect(html).toContain('<strong class="prj-feed-autor">Sistema</strong>');
  });

  it('a última atualização da lateral mostra o item mais recente', () => {
    const html = desenhar(comFeed());
    const lateral = html.slice(html.indexOf('<aside'), html.indexOf('</aside>'));
    expect(lateral).toContain('nota-nova');
    expect(lateral).toContain('Bia');
    expect(lateral).not.toContain('nota-antiga');
  });

  it('corta o trecho longo da última atualização', () => {
    const html = desenhar(projeto({ title: 't', notes: [{ text: 'x'.repeat(300), createdAt: '2026-11-01T10:00:00Z' }] }));
    const lateral = html.slice(html.indexOf('<aside'), html.indexOf('</aside>'));
    expect(lateral).toContain('x'.repeat(120) + '…');
    expect(lateral).not.toContain('x'.repeat(121));
  });
});

describe('publicar atualização', () => {
  function campo(valor) {
    const el = { value: valor, focus: vi.fn() };
    globalThis.document = { getElementById: (id) => (id === 'prjNovaNota' ? el : null) };
    return el;
  }

  it('grava como nota interna, com o autor logado', () => {
    campo('  avanço  ');
    acoes.prjPublicar({}, 'p1');
    expect(globalThis.addPendenciaNote).toHaveBeenCalledWith('p1', 'avanço', 'Pedro', 'interna');
  });

  // A captura de estado relê o campo: limpar depois devolveria o texto já publicado.
  it('limpa o campo antes de redesenhar', () => {
    const el = campo('avanço');
    let valorAoRedesenhar;
    globalThis.penPaginaAtualizar = vi.fn(() => { valorAoRedesenhar = el.value; });
    acoes.prjPublicar({}, 'p1');
    expect(valorAoRedesenhar).toBe('');
  });

  it('mantém o texto e avisa quando a gravação falha', () => {
    const el = campo('avanço');
    globalThis.addPendenciaNote = vi.fn(() => false);
    acoes.prjPublicar({}, 'p1');
    expect(el.value).toBe('avanço');
    expect(globalThis.showToast).toHaveBeenCalledWith(expect.any(String), 'error');
    expect(globalThis.penPaginaAtualizar).not.toHaveBeenCalled();
  });

  it('não grava texto vazio', () => {
    const el = campo('   ');
    acoes.prjPublicar({}, 'p1');
    expect(globalThis.addPendenciaNote).not.toHaveBeenCalled();
    expect(el.focus).toHaveBeenCalled();
  });
});

describe('lateral', () => {
  const lateral = (html) => html.slice(html.indexOf('<aside'), html.indexOf('</aside>'));

  it('mostra "Sem prazo · Definir" sem data, e Definir abre o formulário', () => {
    const html = lateral(desenhar(projeto({ title: 't' })));
    expect(semTags(html)).toContain('Sem prazo · Definir');
    expect(html).toMatch(/data-action="prjEditar" data-arg="p1">Definir<\/button>/);
  });

  it('mostra a data formatada quando há prazo', () => {
    const html = lateral(desenhar(projeto({ title: 't', deadline: '2026-12-01' })));
    expect(html).toContain('DATA:2026-12-01');
    expect(html).not.toContain('Sem prazo');
  });

  it('avisa por extenso quando o prazo venceu e o projeto segue aberto', () => {
    expect(lateral(desenhar(projeto({ title: 't', deadline: '2026-10-01' })))).toContain('atrasado');
  });

  it('não acusa atraso em projeto já resolvido', () => {
    expect(lateral(desenhar(projeto({ title: 't', status: 'resolvido', deadline: '2026-10-01' })))).not.toContain('atrasado');
  });

  it('o cliente abre pela ação existente, com botão real', () => {
    globalThis.getClientById = () => ({ id: 'c1', name: 'Acme' });
    const html = lateral(desenhar(projeto({ title: 't', clientId: 'c1' })));
    expect(html).toMatch(/<button[^>]*data-action="openClient" data-arg="c1">Acme<\/button>/);
  });

  it('mostra responsável e equipe juntos', () => {
    globalThis.TEAM_LABELS = { init: 'Init' };
    const html = semTags(lateral(desenhar(projeto({ title: 't', responsible: 'Ana' }))));
    delete globalThis.TEAM_LABELS;
    expect(html).toContain('Ana · Init');
  });
});

describe('anexos', () => {
  it('sem anexos, a seção não existe', () => {
    const html = desenhar(projeto({ title: 't' }));
    expect(html).not.toContain('Anexos');
    expect(globalThis.renderAttachmentList).not.toHaveBeenCalled();
  });

  it('com anexos, desenha a seção dentro da Visão geral', () => {
    globalThis.getAttachments = () => [{ id: 'a1' }];
    expect(painel(desenhar(projeto({ title: 't' })), 'visao')).toContain('id="prjAnexosLista"');
  });

  // renderAttachmentList procura o container por id: antes do innerHTML ele não existe.
  it('preenche a lista só depois de o container estar no innerHTML', () => {
    globalThis.getAttachments = () => [{ id: 'a1' }];
    const container = { innerHTML: '' };
    let tinhaContainer = false;
    globalThis.renderAttachmentList = vi.fn(() => { tinhaContainer = container.innerHTML.includes('prjAnexosLista'); });
    mod.renderProjetoPagina(projeto({ title: 't' }), container, null);
    expect(globalThis.renderAttachmentList).toHaveBeenCalledWith('pendencias', 'p1', 'prjAnexosLista');
    expect(tinhaContainer).toBe(true);
  });
});

describe('o que esta tela não tem', () => {
  it.each(['timer', 'SLA', 'Transferir', 'Compartilhar', 'Cancelar', 'Canal', 'Solicitante', 'Categoria', 'Assunto', 'Tempo'])('não mostra %s', (termo) => {
    const html = desenhar(projeto({ title: 't', timeSpent: 100, sla: {}, canal: 'x', solicitante: 'y', category: 'z' }));
    expect(semTags(html).toLowerCase()).not.toContain(termo.toLowerCase());
    expect(html).not.toContain('data-action="' + termo);
  });

  it('o feed só grava nota interna: não há opção de resposta ao cliente', () => {
    const html = desenhar(projeto({ title: 't' }));
    expect(html).not.toMatch(/resposta/i);
  });
});

describe('estrutura', () => {
  it('não tem handler inline', () => {
    const html = desenhar(projeto({
      title: 't', checklist: [{ text: 'a', done: false }], notes: [{ text: 'n', createdAt: '2026-11-01T10:00:00Z' }],
    }));
    expect(html).not.toMatch(/\son[a-z]+=/i);
  });

  it('tem link real de volta à lista com o número do projeto', () => {
    const html = desenhar(projeto({ title: 't' }));
    expect(html).toContain('href="#pendencias"');
    expect(semTags(html)).toContain('Projetos internos›#001');
  });

  it('Editar abre o formulário existente', () => {
    expect(desenhar(projeto({ title: 't' }))).toMatch(/<button[^>]*data-action="prjEditar" data-arg="p1">Editar<\/button>/);
    acoes.prjEditar({}, 'p1');
    expect(globalThis.openPendenciaForm).toHaveBeenCalledWith('p1');
  });

  it('todo campo editável tem rótulo ligado por for', () => {
    const html = desenhar(projeto({ title: 't' }));
    expect(html).toContain('for="newCheckItem"');
    expect(html).toContain('for="prjNovaNota"');
  });

  it('não define nome global fora do prefixo prj', () => {
    const fonte = fs.readFileSync(ARQUIVO, 'utf8').replace(/\r\n/g, '\n');
    const nomes = [...fonte.matchAll(/^(?:function|const|let|var)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
    expect(nomes.length).toBeGreaterThan(0);
    expect(nomes.filter((n) => !/^(prj|PRJ_|_prj)/.test(n) && n !== 'renderProjetoPagina')).toEqual([]);
  });
});
