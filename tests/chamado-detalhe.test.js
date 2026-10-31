import { createRequire as __partsReq } from 'node:module';
const { partsSource } = __partsReq(import.meta.url)('./_parts.cjs');
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

// ── Tela de detalhe do chamado (estilo SAF) ───────────────────────────────
// O que importa aqui é regra, não layout: a resposta só sai pelo canal que
// existe (e-mail/WhatsApp, decidido pelo adaptador de chamado-canal.js), a
// anotação interna nunca sai, a transferência exige motivo e nenhum texto de
// quem pediu entra cru no HTML.

const FECHADOS = ['concluido', 'resolvido', 'cancelado', 'fechado'];
const _escape = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Sandbox mínimo para js/chamado-detalhe.js: só os globais que ele consulta.
// Cada teste troca os espiões; o arquivo é carregado uma vez só.
function criarSandbox() {
  const els = {};
  const sb = {
    console,
    escapeHtml: _escape,
    els,
    document: { getElementById: (id) => els[id] || null },
    getUser: () => ({ name: 'Ana Atendente' }),
    getPendenciaById: () => null,
    addPendenciaNote: () => true,
    showToast: () => {},
    openPendenciaDetail: () => {},
    changePenStatus: () => {},
  };
  sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync('js/chamado-detalhe.js', 'utf8'), sb, { filename: 'chamado-detalhe.js' });
  return sb;
}

const sb = criarSandbox();
let notas;
let envios;
let statusTrocados;

beforeEach(() => {
  notas = [];
  envios = [];
  statusTrocados = [];
  for (const k of Object.keys(sb.els)) delete sb.els[k];
  sb.addPendenciaNote = (id, texto, autor, vis) => { notas.push({ id, texto, autor, vis }); return true; };
  sb.chamadoEnviarResposta = (p, texto) => { envios.push({ id: p.id, texto }); return Promise.resolve(true); };
  sb.chamadoCanalDe = (p) => (p.solicitanteEmail ? 'email' : null);
  sb.changePenStatus = (id) => { statusTrocados.push({ id, status: sb.els.chgStatus && sb.els.chgStatus.value }); };
  sb.getPendenciaById = () => null;
});

describe('chamadoAplicarVariaveis', () => {
  const p = { id: 'p1', solicitante: 'Maria  da Silva', team: 'Suporte' };

  it('substitui as variáveis conhecidas pelos dados do chamado', () => {
    const out = sb.chamadoAplicarVariaveis('Olá {primeiro_nome} ({nome}), protocolo {protocolo}, área {area}, {atendente} em {data_hoje}', p,
      { atendente: 'Ana', hoje: new Date(2026, 9, 30) });
    expect(out).toBe('Olá Maria (Maria  da Silva), protocolo p1, área Suporte, Ana em 30/10/2026');
  });

  it('variável conhecida sem valor vira vazio, não "undefined"', () => {
    expect(sb.chamadoAplicarVariaveis('Oi {nome}!', { id: 'x' }, { atendente: 'Ana' })).toBe('Oi !');
  });

  it('chave desconhecida fica como estava (não some texto do atendente)', () => {
    expect(sb.chamadoAplicarVariaveis('Custo {valor} e {nome}', p, { atendente: 'Ana' })).toBe('Custo {valor} e Maria  da Silva');
  });
});

describe('chamadoRotuloComposer', () => {
  it('diz o canal quando a resposta sai por e-mail', () => {
    expect(sb.chamadoRotuloComposer({ solicitante: 'João' }, 'email')).toBe('Responder a João por E-mail');
  });

  it('diz o canal quando a resposta sai por WhatsApp', () => {
    expect(sb.chamadoRotuloComposer({ solicitante: 'João' }, 'whatsapp')).toBe('Responder a João por WhatsApp');
  });

  it('sem canal avisa que não há por onde responder', () => {
    expect(sb.chamadoRotuloComposer({ solicitante: 'João' }, null)).toBe('Responder a João — sem canal de resposta');
  });

  it('o nome de quem pediu sai escapado no composer', () => {
    const html = sb.chamadoComposerHtml({ id: 'p1', solicitante: '<img src=x onerror=alert(1)>', solicitanteEmail: 'a@b.c' });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});

describe('chamadoComposerHtml', () => {
  const html = sb.chamadoComposerHtml({ id: 'p1', solicitante: 'João', solicitanteEmail: 'j@x.com' });

  it('tem os três botões de resposta e nenhum de IA', () => {
    expect(html).toContain('data-arg="responder"');
    expect(html).toContain('data-arg="pedir_info"');
    expect(html).toContain('data-arg="encerrar"');
    expect(html).not.toMatch(/\bIA\b/);
  });

  it('não usa handler inline', () => {
    expect(html).not.toMatch(/\son[a-z]+=/i);
  });

  it('sem canal o composer fica marcado e explica que a resposta não sai', () => {
    const semCanal = sb.chamadoComposerHtml({ id: 'p2', solicitante: 'João' });
    expect(semCanal).toContain('is-sem-canal');
    expect(semCanal).toContain('sem canal de resposta');
  });
});

describe('chamadoValidarTransferencia', () => {
  const p = { responsible: 'Ana' };

  it('exige alguém para receber', () => {
    expect(sb.chamadoValidarTransferencia(p, '', 'motivo')).toBe('Escolha para quem transferir.');
  });

  it('não transfere para quem já está com o chamado', () => {
    expect(sb.chamadoValidarTransferencia(p, 'Ana', 'motivo')).toBe('O chamado já está com Ana.');
  });

  it('exige motivo, mesmo com destino válido', () => {
    expect(sb.chamadoValidarTransferencia(p, 'Bruno', '   ')).toMatch(/motivo/);
  });

  it('com destino e motivo, libera', () => {
    expect(sb.chamadoValidarTransferencia(p, 'Bruno', 'Ana de férias')).toBeNull();
  });
});

describe('chamadoNotaInterna', () => {
  it('grava como interna e nunca envia ao solicitante', () => {
    sb.els.chamadoNotaTexto = { value: ' @Bruno olha isso ' };
    sb.getPendenciaById = () => ({ id: 'p1', solicitanteEmail: 'j@x.com' });
    expect(sb.chamadoNotaInterna('p1')).toBe(true);
    expect(notas).toEqual([{ id: 'p1', texto: '@Bruno olha isso', autor: 'Ana Atendente', vis: 'interna' }]);
    expect(envios).toEqual([]);
  });

  it('texto vazio não grava nada', () => {
    sb.els.chamadoNotaTexto = { value: '   ' };
    expect(sb.chamadoNotaInterna('p1')).toBe(false);
    expect(notas).toEqual([]);
  });
});

describe('chamadoResponderAcao', () => {
  it('com canal, grava como resposta (conta para o SLA) e envia o texto já com variáveis', () => {
    sb.els.newNoteText = { value: 'Oi {primeiro_nome}' };
    sb.getPendenciaById = () => ({ id: 'p1', solicitante: 'João Souza', solicitanteEmail: 'j@x.com' });
    expect(sb.chamadoResponderAcao('p1', 'responder')).toBe(true);
    expect(notas).toEqual([{ id: 'p1', texto: 'Oi João', autor: 'Ana Atendente', vis: 'resposta' }]);
    expect(envios).toEqual([{ id: 'p1', texto: 'Oi João' }]);
    expect(sb.els.newNoteText.value).toBe('');
  });

  it('sem canal, grava a resposta e não tenta enviar', () => {
    sb.els.newNoteText = { value: 'Resolvido por telefone' };
    sb.getPendenciaById = () => ({ id: 'p1', solicitante: 'João' });
    expect(sb.chamadoResponderAcao('p1', 'responder')).toBe(true);
    expect(notas).toHaveLength(1);
    expect(envios).toEqual([]);
  });

  it('texto vazio não grava nem envia', () => {
    sb.els.newNoteText = { value: '  ' };
    sb.getPendenciaById = () => ({ id: 'p1', solicitanteEmail: 'j@x.com' });
    expect(sb.chamadoResponderAcao('p1', 'responder')).toBe(false);
    expect(notas).toEqual([]);
    expect(envios).toEqual([]);
  });

  it('pedir informação deixa o chamado aguardando o cliente', () => {
    sb.els.newNoteText = { value: 'Qual o número do contrato?' };
    sb.els.chgStatus = { value: 'aberto' };
    sb.getPendenciaById = () => ({ id: 'p1', solicitanteEmail: 'j@x.com' });
    sb.chamadoResponderAcao('p1', 'pedir_info');
    expect(statusTrocados).toEqual([{ id: 'p1', status: 'aguardando_cliente' }]);
  });

  it('encerrar marca o chamado como resolvido', () => {
    sb.els.newNoteText = { value: 'Feito.' };
    sb.els.chgStatus = { value: 'aberto' };
    sb.getPendenciaById = () => ({ id: 'p1', solicitanteEmail: 'j@x.com' });
    sb.chamadoResponderAcao('p1', 'encerrar');
    expect(statusTrocados).toEqual([{ id: 'p1', status: 'resolvido' }]);
  });

  it('sem o adaptador de canal, cai no envio por e-mail antigo', () => {
    const canalDe = sb.chamadoCanalDe;
    const enviar = sb.chamadoEnviarResposta;
    delete sb.chamadoCanalDe;
    delete sb.chamadoEnviarResposta;
    const porEmail = [];
    sb.penResponderPorEmail = (id, texto) => porEmail.push({ id, texto });
    try {
      sb.els.newNoteText = { value: 'Oi' };
      sb.getPendenciaById = () => ({ id: 'p1', solicitanteEmail: 'j@x.com' });
      sb.chamadoResponderAcao('p1', 'responder');
      expect(porEmail).toEqual([{ id: 'p1', texto: 'Oi' }]);
    } finally {
      sb.chamadoCanalDe = canalDe;
      sb.chamadoEnviarResposta = enviar;
      delete sb.penResponderPorEmail;
    }
  });
});

describe('cabeçalho e cartões', () => {
  it('assunto e nome de quem pediu entram escapados', () => {
    const p = { id: 'p1', assunto: '<script>x</script>', solicitante: '"><b>', status: 'aberto', priority: 'alta' };
    const html = sb.chamadoCabecalhoHtml(p, {}) + sb.chamadoCartoesHtml(p, null);
    expect(html).not.toContain('<script>x');
    expect(html).not.toContain('"><b>');
  });

  it('prioridade fora da lista não injeta classe arbitrária', () => {
    const html = sb.chamadoCabecalhoHtml({ id: 'p1', priority: 'alta" onmouseover="x' }, {});
    expect(html).not.toContain('onmouseover');
    expect(html).toContain('chd-pri-nenhuma');
  });
});

// ── Item do chat (pendencias-detalhe.js) ──────────────────────────────────
// Carrega as partes de pendências num vm, como tests/email-chamado-visual.
const _dummyEl = {
  addEventListener() {}, removeEventListener() {}, style: {},
  classList: { add() {}, remove() {}, toggle() {} },
  querySelector: () => null, querySelectorAll: () => [],
  innerHTML: '',
};
const pen = {
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
pen.globalThis = pen;
pen.window.window = pen.window;
vm.createContext(pen);
const _quietErr = console.error;
console.error = () => {};
try {
  vm.runInContext(fs.readFileSync('js/ui.js', 'utf8'), pen, { filename: 'ui.js' });
  vm.runInContext(partsSource('pendencias'), pen, { filename: 'pendencias.js' });
} finally {
  console.error = _quietErr;
}

describe('_penChatItemHtml', () => {
  it('escapa autor e texto da nota', () => {
    const html = pen._penChatItemHtml({ author: '<b>x</b>', text: '<img src=x onerror=alert(1)>', visibility: 'resposta', createdAt: '2026-10-30' }, 'Ana');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<b>x</b>');
  });

  it('nota interna ganha a classe e a etiqueta "Interna"', () => {
    const html = pen._penChatItemHtml({ author: 'Ana', text: 'só a equipe', visibility: 'interna', createdAt: '' }, 'Ana');
    expect(html).toContain('is-interna');
    expect(html).toContain('Interna');
    expect(html).toContain('is-equipe');
  });

  it('nota sem visibility é tratada como interna (anterior à separação)', () => {
    const html = pen._penChatItemHtml({ author: 'Ana', text: 'antiga', createdAt: '' }, 'Bruno');
    expect(html).toContain('is-interna');
  });

  it('fala de quem pediu fica do lado do solicitante, sem etiqueta de interna', () => {
    const html = pen._penChatItemHtml({ author: 'João', text: 'oi', visibility: 'solicitante', createdAt: '' }, 'Ana');
    expect(html).toContain('is-solicitante');
    expect(html).not.toContain('is-equipe');
    expect(html).not.toContain('is-interna');
  });

  it('resposta da equipe vai para o lado da equipe e não é interna', () => {
    const html = pen._penChatItemHtml({ author: 'Ana', text: 'oi', visibility: 'resposta', createdAt: '' }, 'Ana');
    expect(html).toContain('is-equipe');
    expect(html).not.toContain('is-interna');
  });
});
