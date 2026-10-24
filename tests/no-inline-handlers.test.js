import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

// Catraca da migração para eventos por delegação (js/actions.js): handler
// inline no HTML (onclick=...) obriga o CSP a liberar 'unsafe-inline'.
// - Arquivos já convertidos não podem voltar a ter handler inline.
// - O total restante só pode diminuir (ao converter uma tela, baixe o teto).
const HANDLER = /\bon(click|change|input|submit|keydown|keyup|blur|focus|drop|dragover|dragleave)=/g;
const CLEAN = ['js/prazos.js', 'js/roteiro.js', 'js/fila.js', 'js/vencimentos.js', 'js/conhecimento.js', 'js/actions.js', 'js/error-log.js', 'js/time-entries.js', 'index.html'];
const CEILING = 381;

const count = (f) => (fs.readFileSync(f, 'utf8').match(HANDLER) || []).length;

describe('handlers inline (CSP)', () => {
  it('telas convertidas seguem sem onclick/onchange/... no HTML', () => {
    for (const f of CLEAN) expect(count(f), f).toBe(0);
  });

  it('o total restante não cresce', () => {
    const files = fs.readdirSync('js').filter((f) => f.endsWith('.js')).map((f) => 'js/' + f).concat(['index.html']);
    const total = files.reduce((s, f) => s + count(f), 0);
    expect(total).toBeLessThanOrEqual(CEILING);
  });

  it('menu lateral e barra inferior navegam por data-action', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    expect(html).not.toMatch(/class="nav-item"[^>]*onclick=/);
    expect(html).not.toMatch(/class="bottom-nav-item"[^>]*onclick="navigateTo/);
  });
});
