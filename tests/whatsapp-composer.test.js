import { createRequire as __partsReq } from 'node:module';
const { partsSource } = __partsReq(import.meta.url)('./_parts.cjs');
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

// ── Responder por WhatsApp pela tela do chamado ───────────────────────────
// A caixa "Enviar por WhatsApp" só pode aparecer em chamado que VEIO do
// WhatsApp, e só pode vir marcada enquanto a janela de 24 h da Meta está
// aberta. Marcada fora da janela, o técnico escreve, o envio é recusado e ele
// descobre depois que o cliente nunca recebeu.

const _dummyEl = {
  addEventListener() {}, removeEventListener() {}, style: {},
  classList: { add() {}, remove() {}, toggle() {} },
  querySelector: () => null, querySelectorAll: () => [],
  innerHTML: '',
};
const STATUS = { aberto: { label: 'Aberto', dot: '#2563eb' } };
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
  STATUS_PEN_MAP: STATUS,
  isPendenciaClosed: (s) => FECHADOS.includes(s),
  updateBadges: () => {},
  renderPenView: () => {},
  getPendenciaById: () => null,
  savePendencia: () => {},
  updatePendenciaAssignee: () => ({ pen: {} }),
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

const { _penWhatsTelefone, _penWhatsJanela } = sandbox;
const penSrc = partsSource('pendencias');
const ABERTURA = '2026-10-26T09:00:00.000Z';
const nota = (visibility, createdAt) => ({ text: 'oi', author: 'Beatriz', createdAt, visibility });

describe('de quem é a conversa deste chamado', () => {
  it('chamado de WhatsApp mostra o telefone formatado', () => {
    const t = _penWhatsTelefone({ emailThreadId: 'whatsapp:5511999990000' });
    expect(t.digitos).toBe('5511999990000');
    expect(t.legivel).toBe('+55 (11) 99999-0000');
  });

  it('fixo de oito dígitos também formata', () => {
    expect(_penWhatsTelefone({ emailThreadId: 'whatsapp:551144786171' }).legivel)
      .toBe('+55 (11) 4478-6171');
  });

  it('número de fora do Brasil fica cru, com o +', () => {
    expect(_penWhatsTelefone({ emailThreadId: 'whatsapp:14155550123456' }).legivel)
      .toBe('+14155550123456');
  });

  it('chamado de e-mail não vira chamado de WhatsApp', () => {
    expect(_penWhatsTelefone({ emailThreadId: '<CAF=abc@mail.gmail.com>' })).toBeNull();
  });

  it('chamado aberto à mão não tem conversa nenhuma', () => {
    expect(_penWhatsTelefone({})).toBeNull();
    expect(_penWhatsTelefone({ emailThreadId: null })).toBeNull();
    expect(_penWhatsTelefone(null)).toBeNull();
  });

  it('número incompleto não vira caixa de envio', () => {
    // Sem país não dá para mandar; melhor a caixa não aparecer do que aparecer
    // e mandar para outra pessoa.
    expect(_penWhatsTelefone({ emailThreadId: 'whatsapp:1199999000' })).toBeNull();
  });
});

describe('o aviso da janela de 24 h', () => {
  it('chamado recém-aberto tem janela aberta, contada da abertura', () => {
    // A primeira mensagem virou o chamado, não uma nota: contar só as notas
    // diria "fechada" no momento em que ela está mais aberta.
    const j = _penWhatsJanela({ createdAt: ABERTURA, notes: [] }, new Date('2026-10-26T10:00:00.000Z'));
    expect(j.aberta).toBe(true);
    expect(j.restam).toBe('23h');
  });

  it('última hora aparece em minutos, não em "0h"', () => {
    const j = _penWhatsJanela({ createdAt: ABERTURA, notes: [] }, new Date('2026-10-27T08:30:00.000Z'));
    expect(j.aberta).toBe(true);
    expect(j.restam).toBe('30 min');
  });

  it('passadas as 24 h a janela fecha', () => {
    const j = _penWhatsJanela({ createdAt: ABERTURA, notes: [] }, new Date('2026-10-27T10:00:00.000Z'));
    expect(j.aberta).toBe(false);
    expect(j.restam).toBe('');
  });

  it('mensagem nova do cliente reabre a janela', () => {
    const p = { createdAt: ABERTURA, notes: [nota('solicitante', '2026-10-27T08:00:00.000Z')] };
    expect(_penWhatsJanela(p, new Date('2026-10-27T10:00:00.000Z')).aberta).toBe(true);
  });

  it('nossa resposta não reabre a janela', () => {
    // Só a fala do CLIENTE reabre. Contar a nossa deixaria a janela aberta para
    // sempre: cada resposta nossa esticaria o prazo que a Meta não estica.
    const p = { createdAt: ABERTURA, notes: [nota('resposta', '2026-10-27T08:00:00.000Z')] };
    expect(_penWhatsJanela(p, new Date('2026-10-27T10:00:00.000Z')).aberta).toBe(false);
  });

  it('anotação interna também não reabre', () => {
    const p = { createdAt: ABERTURA, notes: [nota('interna', '2026-10-27T08:00:00.000Z')] };
    expect(_penWhatsJanela(p, new Date('2026-10-27T10:00:00.000Z')).aberta).toBe(false);
  });

  it('chamado sem data alguma sai fechado', () => {
    expect(_penWhatsJanela({ notes: [] }, new Date(ABERTURA)).aberta).toBe(false);
  });

  it('notes que não é lista não derruba a tela', () => {
    const j = _penWhatsJanela({ createdAt: ABERTURA, notes: null }, new Date('2026-10-26T10:00:00.000Z'));
    expect(j.aberta).toBe(true);
  });
});

describe('o que a tela monta', () => {
  it('a caixa de WhatsApp só nasce marcada com a janela aberta', () => {
    expect(penSrc).toContain("${_waJanela.aberta ? 'checked' : 'disabled'}");
  });

  it('anotação interna esconde o envio por WhatsApp', () => {
    // Caixa marcada numa aba "só a equipe vê" manda ao cliente o que era
    // combinado interno.
    expect(penSrc).toContain("penNoteWhatsWrap");
    expect(penSrc).toContain("whatsWrap.style.display = alvo === 'interna' ? 'none' : ''");
  });

  it('o envio só sai de nota pública e com a caixa habilitada', () => {
    expect(penSrc).toContain("_boxWa.checked && !_boxWa.disabled");
    expect(penSrc).toContain("vis === 'resposta' && !!(_boxWa");
  });

  it('o telefone é escapado antes de entrar no HTML', () => {
    expect(penSrc).toContain('escapeHtml(_waTelefone.legivel)');
  });

  it('a function recebe só o id do chamado, nunca o telefone', () => {
    // O destinatário é decisão do servidor: ele relê o email_thread_id com a
    // chave de serviço. Mandar o número daqui abriria o envio a qualquer número.
    expect(penSrc).toContain("invoke('whatsapp-responder', { body: { pendencia_id: id, text: text } })");
    expect(penSrc).not.toContain('telefone: _waTelefone');
  });

  it('a fala do cliente no feed diz por onde chegou', () => {
    expect(penSrc).toContain('Chegou por WhatsApp, na conversa do chamado');
    expect(penSrc).toContain('Chegou por e-mail, na conversa do chamado');
  });
});
