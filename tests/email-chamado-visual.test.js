import { createRequire as __partsReq } from 'node:module';
const { partsSource } = __partsReq(import.meta.url)('./_parts.cjs');
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

// ── A cara do chamado que nasceu de e-mail ────────────────────────────────
// A triagem cola um bloco de origem no fim da descrição ("— Aberta pela
// triagem de e-mail do Init Intra. De: ... Recebido em: ..."). Metadado como
// texto corrido entra na busca, entra na prévia do card e obriga quem lê a
// pular aquilo para achar o pedido. Separar na RENDERIZAÇÃO conserta também
// os chamados que já existem — que são os que estão feios hoje.

const _dummyEl = {
  addEventListener() {}, removeEventListener() {}, style: {},
  classList: { add() {}, remove() {}, toggle() {} },
  querySelector: () => null, querySelectorAll: () => [],
  innerHTML: '',
};
const FECHADOS = ['concluido', 'resolvido', 'cancelado', 'fechado'];

const sandbox = {
  console,
  window: { addEventListener() {}, location: { hash: '#pendencias' } },
  navigator: { onLine: true },
  document: {
    addEventListener() {},
    getElementById: () => _dummyEl,
    querySelector: () => _dummyEl,
    querySelectorAll: () => [],
    createElement: () => ({ ..._dummyEl }),
    body: { classList: { add() {}, remove() {}, toggle() {} }, style: {} },
    head: _dummyEl,
  },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  setTimeout: () => 0,
  clearTimeout: () => {},
  timerWidget: () => '',
  STATUS_PEN_MAP: { aberto: { label: 'Aberto', dot: '#2563eb' } },
  isPendenciaClosed: (s) => FECHADOS.includes(s),
  updateBadges: () => {},
  renderPenView: () => {},
  getPendenciaById: () => null,
  savePendencia: () => {},
  updatePendenciaAssignee: () => ({ pen: {} }),
  formatDateTime: (iso) => 'FMT:' + iso,
};
sandbox.globalThis = sandbox;
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
const _quietErr = console.error;
console.error = () => {};
try {
  vm.runInContext(fs.readFileSync('js/ui.js', 'utf8'), sandbox, { filename: 'ui.js' });
  vm.runInContext(partsSource('pendencias'), sandbox, { filename: 'pendencias.js' });
} finally {
  console.error = _quietErr;
}

const { _penOrigemTriagem, _penOrigemHtml } = sandbox;
const penSrc = partsSource('pendencias');
const etrSrc = fs.readFileSync('js/emails-triagem.js', 'utf8');

const DESC = [
  'A impressora da recepção parou.',
  '',
  '— Aberta pela triagem de e-mail do Init Intra.',
  'De: Márcia <marcia@acme.com.br>',
  'Recebido em: 2026-10-26T12:00:00.000Z',
  'Assunto original: impressora não imprime',
].join('\n');

describe('separar o pedido do carimbo da triagem', () => {
  it('o corpo fica só com o que a pessoa escreveu', () => {
    expect(_penOrigemTriagem(DESC).corpo).toBe('A impressora da recepção parou.');
  });

  it('os campos do carimbo viram dados', () => {
    const { origem } = _penOrigemTriagem(DESC);
    expect(origem.canal).toBe('e-mail');
    expect(origem.de).toBe('Márcia <marcia@acme.com.br>');
    expect(origem.recebidoEm).toBe('2026-10-26T12:00:00.000Z');
    expect(origem.assuntoOriginal).toBe('impressora não imprime');
  });

  it('chamado aberto à mão não tem carimbo nenhum', () => {
    const r = _penOrigemTriagem('Trocar o cabo de rede da sala 2.');
    expect(r.origem).toBeNull();
    expect(r.corpo).toBe('Trocar o cabo de rede da sala 2.');
  });

  it('descrição vazia não quebra', () => {
    expect(_penOrigemTriagem('').corpo).toBe('');
    expect(_penOrigemTriagem(null).origem).toBeNull();
    expect(_penOrigemTriagem(undefined).corpo).toBe('');
  });

  it('serve para outro canal com o mesmo carimbo', () => {
    // A triagem de WhatsApp usa a mesma frase, trocando só o canal.
    const d = 'Notebook não liga.\n\n— Aberta pela triagem de WhatsApp do Init Intra.\nDe: Beatriz · +5511999990000\nRecebido em: 2026-10-26T12:00:00.000Z';
    const { origem, corpo } = _penOrigemTriagem(d);
    expect(corpo).toBe('Notebook não liga.');
    expect(origem.canal).toBe('WhatsApp');
    expect(origem.de).toBe('Beatriz · +5511999990000');
  });

  it('texto que menciona a triagem no meio não é confundido com carimbo', () => {
    const d = 'O cliente perguntou como funciona a triagem de e-mail do Init Intra.';
    expect(_penOrigemTriagem(d).origem).toBeNull();
  });

  it('carimbo sem alguns campos não inventa os que faltam', () => {
    const d = 'Pedido.\n\n— Aberta pela triagem de e-mail do Init Intra.\nDe: x@y.com';
    const { origem } = _penOrigemTriagem(d);
    expect(origem.de).toBe('x@y.com');
    expect(origem.recebidoEm).toBe('');
    expect(origem.assuntoOriginal).toBe('');
  });
});

describe('o cartão de origem', () => {
  it('sem origem, não desenha nada', () => {
    expect(_penOrigemHtml(null)).toBe('');
  });

  it('a data ISO não é jogada crua na tela', () => {
    // formatDateTime real vem do ui.js carregado no sandbox; o que importa é
    // que o ISO do robô não chega ao olho de ninguém.
    const html = _penOrigemHtml(_penOrigemTriagem(DESC).origem);
    expect(html).not.toContain('2026-10-26T12:00:00.000Z');
    expect(html).toContain('2026');
  });

  it('data que o Date não entende sai crua, sem quebrar', () => {
    const html = _penOrigemHtml({ canal: 'e-mail', de: 'x', recebidoEm: 'ontem', assuntoOriginal: '' });
    expect(html).toContain('ontem');
  });

  it('campo vazio não vira linha vazia', () => {
    const html = _penOrigemHtml({ canal: 'e-mail', de: 'x@y.com', recebidoEm: '', assuntoOriginal: '' });
    expect(html).toContain('x@y.com');
    expect(html).not.toContain('<dt>Recebido</dt>');
  });

  it('o que veio do e-mail é escapado antes de virar HTML', () => {
    // O remetente é texto de fora: é o caminho clássico de XSS.
    const html = _penOrigemHtml({ canal: 'e-mail', de: '<img src=x onerror=alert(1)>', recebidoEm: '', assuntoOriginal: '' });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});

describe('a caixa de entradas de e-mail', () => {
  it('some inteira quando não há nada pendente', () => {
    // Painel vazio todo dia vira ruído, e aí ninguém lê no dia que importa.
    expect(etrSrc).toContain("if (!lista.length) { node.innerHTML = ''; return; }");
  });

  it('mostra só o que ninguém tratou', () => {
    expect(etrSrc).toContain("e.status === 'pendente'");
  });

  it('respeita o escopo de equipe', () => {
    expect(etrSrc).toContain('filterByTeam(lista)');
  });

  it('descartar grava quem decidiu, em vez de apagar', () => {
    expect(etrSrc).toContain("status: 'descartado'");
    expect(etrSrc).toContain('tratadoPor:');
    expect(etrSrc).not.toContain(".delete()");
  });

  it('a entrada só é marcada depois que o chamado existe', () => {
    // Marcar na abertura do formulário perderia o e-mail se a pessoa
    // desistisse no meio.
    expect(penSrc).toContain('emailTriagemMarcarAberta(data.id)');
    expect(etrSrc).toContain("_emailTriagemSalvar(id, { status: 'virou_chamado', pendenciaId: pendenciaId })");
  });

  it('não adivinha o cliente ao abrir o chamado', () => {
    // O motivo de a entrada estar na caixa é ninguém saber de quem é.
    expect(etrSrc).toContain('openPendenciaForm(null, null, null, {');
  });

  it('tudo que veio do e-mail passa por escapeHtml', () => {
    expect(etrSrc).toContain('escapeHtml(e.assunto');
    expect(etrSrc).toContain('escapeHtml(e.de');
    expect(etrSrc).toContain('escapeHtml(e.id)');
  });

  it('as ações vão por delegação, não por onclick inline', () => {
    // AGENTS.md: onclick no markup obriga o CSP a liberar 'unsafe-inline'.
    expect(etrSrc).toContain("data-action=\"etrAbrir\"");
    expect(etrSrc).toContain('registerActions({');
    expect(etrSrc).not.toMatch(/onclick=/);
  });
});
