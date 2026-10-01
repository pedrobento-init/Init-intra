import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

// ── Descrição da pendência no card da reunião ────────────────────────────────
function makeClassList(initial) {
  const s = new Set(initial || []);
  return {
    add: (c) => s.add(c),
    remove: (c) => s.delete(c),
    contains: (c) => s.has(c),
    toggle: (c) => {
      if (s.has(c)) { s.delete(c); return false; }
      s.add(c);
      return true;
    },
  };
}

const registry = {};
const sandbox = {
  console,
  window: { addEventListener() {}, location: { hash: '#reuniao' } },
  navigator: { onLine: true },
  document: {
    addEventListener() {},
    getElementById: (id) => registry[id] || null,
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
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const _quietErr = console.error;
console.error = () => {};
try {
  vm.runInContext(fs.readFileSync('js/reunioes.js', 'utf8'), sandbox, { filename: 'reunioes.js' });
  vm.runInContext('globalThis.__t = { getMeetingDescView, meetingToggleDesc };', sandbox);
} finally {
  console.error = _quietErr;
}
const T = sandbox.__t;

function stubDescEls(clamped) {
  registry['meeting-desc-PEN-1'] = {
    classList: makeClassList(clamped ? ['meet-desc', 'is-clamped'] : ['meet-desc']),
  };
  registry['meeting-desc-toggle-PEN-1'] = { textContent: clamped ? 'ver mais' : 'ver menos' };
}

describe('getMeetingDescView (puro)', () => {
  it('null sem descrição (nada renderiza, sem "undefined")', () => {
    expect(T.getMeetingDescView({ id: 'a', assunto: 'X' })).toBeNull();
    expect(T.getMeetingDescView({ id: 'a', assunto: 'X', descricao: '' })).toBeNull();
    expect(T.getMeetingDescView({ id: 'a', assunto: 'X', descricao: '   ' })).toBeNull();
    expect(T.getMeetingDescView(null)).toBeNull();
  });

  it('null sem assunto (título já é a descrição, evita duplicar)', () => {
    expect(T.getMeetingDescView({ id: 'a', assunto: '', descricao: 'Detalhe aqui' })).toBeNull();
    expect(T.getMeetingDescView({ id: 'a', descricao: 'Detalhe aqui' })).toBeNull();
  });

  it('curta: exibe sem clamp', () => {
    expect(T.getMeetingDescView({ assunto: 'A', descricao: '  Texto curto  ' })).toEqual({
      text: 'Texto curto',
      long: false,
    });
  });

  it('longa (>160 chars): exibe com clamp + ver mais', () => {
    const text = 'x'.repeat(161);
    expect(T.getMeetingDescView({ assunto: 'A', descricao: text })).toEqual({ text, long: true });
    expect(T.getMeetingDescView({ assunto: 'A', descricao: 'y'.repeat(160) }).long).toBe(false);
  });
});

describe('meetingToggleDesc', () => {
  it('alterna clamp e rótulo ver mais/ver menos', () => {
    stubDescEls(true);
    T.meetingToggleDesc('PEN-1');
    expect(registry['meeting-desc-PEN-1'].classList.contains('is-clamped')).toBe(false);
    expect(registry['meeting-desc-toggle-PEN-1'].textContent).toBe('ver menos');
    T.meetingToggleDesc('PEN-1');
    expect(registry['meeting-desc-PEN-1'].classList.contains('is-clamped')).toBe(true);
    expect(registry['meeting-desc-toggle-PEN-1'].textContent).toBe('ver mais');
  });

  it('ignora ids inexistentes sem quebrar', () => {
    expect(() => T.meetingToggleDesc('INEXISTENTE')).not.toThrow();
  });
});

describe('contrato do card e do CSS', () => {
  const src = fs.readFileSync('js/reunioes.js', 'utf8');
  const css = fs.readFileSync('css/styles.css', 'utf8');

  it('descrição escapa HTML e fica entre cabeçalho e select de status', () => {
    const idxDesc = src.indexOf('meeting-desc-${escapeHtml(p.id)}');
    const idxSelect = src.indexOf('meeting-status-${escapeHtml(p.id)}');
    expect(idxDesc).toBeGreaterThan(-1);
    expect(idxSelect).toBeGreaterThan(idxDesc);
    expect(src).toContain('${escapeHtml(descView.text)}');
    expect(src).not.toContain('${descView.text}');
    expect(src).not.toContain('${p.descricao}');
  });

  it('botão ver mais só para descrições longas', () => {
    expect(src).toContain("descView.long ? `<button type=\"button\" class=\"meet-desc-toggle\"");
    expect(src).toContain("onclick=\"meetingToggleDesc('${escapeHtml(p.id)}')\"");
  });

  it('apresentação: fonte maior, sem clamp, sem botão', () => {
    expect(css).toContain('.presentation-mode .meet-desc');
    expect(css).toContain('.presentation-mode .meet-desc-toggle { display: none; }');
  });

  it('preserva quebras com pre-wrap e quebra textos longos', () => {
    expect(css).toMatch(/\.meet-desc\s*\{[^}]*white-space:\s*pre-wrap/);
    expect(css).toMatch(/\.meet-desc\s*\{[^}]*overflow-wrap:\s*anywhere/);
  });
});
