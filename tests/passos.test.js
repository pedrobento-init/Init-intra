import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const P = require('../js/passos.js');

// Texto como o do modelo "Ativar Bitlocker" que já existe no banco: um passo
// por linha, sem recuo, e quebra de linha só visual.
const LEGADO = '1) Primeiro acesse o executar e digite "gpedit.msc".\n2) Irá abrir a janela de Editor de Política de Grupo Local.\n3) Clique no botão "Ligar Bitlocker".';

describe('passo a passo — leitura do texto', () => {
  it('modelo antigo (uma linha por passo) abre como passos, sem conversão', () => {
    const d = P.procParseSteps(LEGADO);
    expect(d.intro).toBe('');
    expect(d.steps.map((s) => s.text)).toEqual([
      'Primeiro acesse o executar e digite "gpedit.msc".',
      'Irá abrir a janela de Editor de Política de Grupo Local.',
      'Clique no botão "Ligar Bitlocker".',
    ]);
  });

  it('texto antes do primeiro passo é introdução; linhas abaixo do passo são detalhe', () => {
    const d = P.procParseSteps('Precisa de admin local.\r\n\r\n1. Abrir o console\n   Win+R → mmc\n\n   Confirmar UAC\n2. Fechar');
    expect(d.intro).toBe('Precisa de admin local.');
    expect(d.steps[0]).toEqual({ text: 'Abrir o console', detail: 'Win+R → mmc\n\nConfirmar UAC' });
    expect(d.steps[1]).toEqual({ text: 'Fechar', detail: '' });
  });

  it('"1.5 GB" no meio do texto não vira passo (ponto exige espaço depois)', () => {
    const d = P.procParseSteps('1) Conferir espaço\n1.5 GB livres no mínimo');
    expect(d.steps).toHaveLength(1);
    expect(d.steps[0].detail).toBe('1.5 GB livres no mínimo');
  });

  it('com passos numerados, marcador "-" é detalhe; sem número, o marcador é o passo', () => {
    expect(P.procParseSteps('1) Rede\n- conferir cabo\n2) DNS').steps.map((s) => s.text)).toEqual(['Rede', 'DNS']);
    expect(P.procParseSteps('- Item A\n• Item B').steps.map((s) => s.text)).toEqual(['Item A', 'Item B']);
  });
});

describe('passo a passo — gravação do texto', () => {
  it('ida e volta preserva introdução, passos e detalhes', () => {
    const doc = { intro: 'Antes: pedir o PIN.', steps: [{ text: 'Abrir gpedit', detail: 'Win+R\n2) não é passo' }, { text: 'Ligar BitLocker', detail: '' }] };
    const txt = P.procSerializeSteps(doc);
    expect(txt).toBe('Antes: pedir o PIN.\n\n1) Abrir gpedit\n   Win+R\n   2) não é passo\n2) Ligar BitLocker');
    expect(P.procParseSteps(txt)).toEqual({ intro: doc.intro, steps: doc.steps });
  });

  it('passo vazio é descartado e a numeração é refeita', () => {
    const txt = P.procSerializeSteps({ intro: '', steps: [{ text: 'A' }, { text: '  ', detail: '' }, { text: 'B' }] });
    expect(txt).toBe('1) A\n2) B');
  });

  it('o texto gravado continua virando o mesmo checklist de pendência', () => {
    // templateStepsToChecklist (pendencias-detalhe.js) lê só as linhas marcadas.
    const txt = P.procSerializeSteps({ intro: 'Obs', steps: [{ text: 'Criar conta', detail: 'no AD' }, { text: 'Liberar VPN' }] });
    const marked = txt.split('\n').map((l) => l.trim()).map((l) => l.match(/^(?:\d+\s*[.)-]|[-*•▪☐□])\s*(.+)$/)).filter(Boolean).map((m) => m[1]);
    expect(marked).toEqual(['Criar conta', 'Liberar VPN']);
  });
});

describe('passo a passo — colar e exibir', () => {
  it('colar lista numerada cria um passo por número; texto solto, um por linha', () => {
    expect(P.procStepsFromPaste('1) A\n2) B').map((s) => s.text)).toEqual(['A', 'B']);
    expect(P.procStepsFromPaste('Abrir\n\nFechar\n').map((s) => s.text)).toEqual(['Abrir', 'Fechar']);
  });

  it('aspas viram chip de copiar e o resto é escapado (XSS)', () => {
    const h = P.procInlineHtml('Digite "gpedit.msc" <img src=x onerror=alert(1)>');
    expect(h).toContain('data-action="psCopy" data-arg="gpedit.msc"');
    expect(h).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(h).not.toContain('<img');
  });

  it('conteúdo do chip com aspas simples ou tags não fura o atributo', () => {
    const h = P.procInlineHtml("`a' onmouseover='x` e \"<b>\"");
    expect(h).not.toMatch(/data-arg="[^"]*'[^"]*"/);
    expect(h).not.toContain('<b>');
  });

  it('só http(s) vira link', () => {
    expect(P.procInlineHtml('ver https://exemplo.com/a.')).toContain('href="https://exemplo.com/a"');
    expect(P.procInlineHtml('javascript:alert(1)')).not.toContain('href');
  });
});
