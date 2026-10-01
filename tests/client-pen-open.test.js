import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

// ── Abrir pendência a partir da aba Pendências do cliente ────────────────────
const calls = { detail: [], toast: [] };
let _pen = { id: 'PEN-1', clientId: 'CLI-1', assunto: 'Bitlocker Desativado' };

const sandbox = {
  console,
  window: { addEventListener() {}, location: { hash: '#clientes' } },
  navigator: { onLine: true },
  document: {
    addEventListener() {},
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ style: {} }),
    visibilityState: 'visible',
    body: { classList: { add() {}, remove() {}, toggle() {}, contains: () => false } },
    head: {},
  },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  setTimeout: (fn) => 0,
  clearTimeout: () => {},
  debounce: (fn) => fn,
  getPendenciaById: (id) => (id === _pen.id ? _pen : null),
  openPendenciaDetail: (id) => { calls.detail.push(id); },
  showToast: (msg, type) => { calls.toast.push([msg, type]); },
  escapeHtml: (s) => String(s ?? ''),
  getPendenciaTitulo: (p) => (p && (p.assunto || p.descricao)) || '',
  statusTag: () => '',
  priorityTag: () => '',
  formatDate: (d) => d,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const _quietErr = console.error;
console.error = () => {};
try {
  vm.runInContext(fs.readFileSync('js/clients.js', 'utf8'), sandbox, { filename: 'clients.js' });
  vm.runInContext(
    'globalThis.__t = { openClientPenRow, openClientPendencia, _getReturn: () => _clientPenReturn, _getOrigin: () => _clientPenOrigin };',
    sandbox
  );
} finally {
  console.error = _quietErr;
}
const T = sandbox.__t;

const cellEvent = () => ({ target: { closest: () => null } });
const btnEvent = () => ({ target: { closest: () => ({}) } });

beforeEach(() => {
  calls.detail.length = 0;
  calls.toast.length = 0;
  _pen = { id: 'PEN-1', clientId: 'CLI-1', assunto: 'Bitlocker Desativado' };
});

describe('openClientPenRow (linha clicável)', () => {
  it('abre ao clicar na célula comum', () => {
    T.openClientPenRow(cellEvent(), 'CLI-1', 'PEN-1');
    expect(calls.detail).toEqual(['PEN-1']);
  });

  it('ignora clique em elementos interativos (botão, select, link…)', () => {
    for (const sel of ['button', 'select', 'a', 'input', 'textarea', 'label']) {
      T.openClientPenRow({ target: { closest: (s) => (s.includes(sel) ? {} : null) } }, 'CLI-1', 'PEN-1');
    }
    expect(calls.detail).toEqual([]);
    expect(calls.toast).toEqual([]);
  });

  it('tolera evento ausente (teclado/chamada direta)', () => {
    T.openClientPenRow(null, 'CLI-1', 'PEN-1');
    expect(calls.detail).toEqual(['PEN-1']);
  });
});

describe('openClientPendencia (botão Abrir)', () => {
  it('registra retorno + origem e abre o detalhe', () => {
    T.openClientPendencia('CLI-1', 'PEN-1');
    expect(calls.detail).toEqual(['PEN-1']);
    expect(T._getReturn()).toEqual({ clientId: 'CLI-1' });
    expect(T._getOrigin()).toEqual({ clientId: 'CLI-1', penId: 'PEN-1' });
  });

  it('pendência inexistente: erro amigável, sem abrir, sem contexto', () => {
    T.openClientPendencia('CLI-1', 'PEN-X');
    expect(calls.detail).toEqual([]);
    expect(calls.toast.length).toBe(1);
    expect(calls.toast[0][1]).toBe('error');
    expect(T._getReturn()).toBeNull();
    expect(T._getOrigin()).toBeNull();
  });
});

describe('contrato da tabela e do retorno à aba', () => {
  const clientsSrc = fs.readFileSync('js/clients.js', 'utf8');
  const uiSrc = fs.readFileSync('js/ui.js', 'utf8');
  const penSrc = fs.readFileSync('js/pendencias.js', 'utf8');

  it('coluna de ações com Abrir (focável, aria-label, sem propagar)', () => {
    expect(clientsSrc).toContain("onclick=\"event.stopPropagation();openClientPendencia('");
    expect(clientsSrc).toContain('aria-label="Abrir pendência:');
    expect(clientsSrc).toContain('<th></th></tr></thead>');
  });

  it('linha com tabindex + Enter/Espaço e prazo vazio como "—"', () => {
    expect(clientsSrc).toContain("class=\"cli-pen-row\" tabindex=\"0\"");
    expect(clientsSrc).toContain("event.key==='Enter'||event.key===' '");
    expect(clientsSrc).toContain("${p.deadline?formatDate(p.deadline):'—'}");
  });

  it('closeModal devolve à aba só se o modal seguir fechado (Editar preservado)', () => {
    expect(uiSrc).toContain('_clientPenReturn');
    expect(uiSrc).toContain("getElementById('modalOverlay').style.display !== 'none'");
    expect(uiSrc).toContain("switchClientTab('pendencias'");
  });

  it('save honra a origem da mesma pendência e reabre a aba atualizada', () => {
    expect(penSrc).toContain('_clientPenOrigin.penId === id');
    expect(penSrc).toContain("switchClientTab('pendencias'");
  });

  it('criação segue fluxo normal (sem retorno)', () => {
    expect(penSrc).toContain('if (isNew) {');
  });
});
