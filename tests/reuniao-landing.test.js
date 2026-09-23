import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

// ── Landing da Reunião: rótulos e relatório anterior ─────────────────────────
const sandbox = {
  console,
  window: { addEventListener() {}, location: { hash: '#reuniao' } },
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
};
sandbox.globalThis = sandbox;
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
const _quietErr = console.error;
console.error = () => {};
try {
  vm.runInContext(fs.readFileSync('js/reunioes.js', 'utf8'), sandbox, { filename: 'reunioes.js' });
  vm.runInContext('globalThis.__t = { _getMesAnoLabel, _getReuniaoId };', sandbox);
} finally {
  console.error = _quietErr;
}
const T = sandbox.__t;

describe('rótulo do mês', () => {
  it('_getMesAnoLabel com maiúscula: Setembro/2026', () => {
    expect(T._getMesAnoLabel('2026-09')).toBe('Setembro/2026');
    expect(T._getMesAnoLabel('2026-01')).toBe('Janeiro/2026');
  });

  it('id da reunião deriva do mês', () => {
    expect(T._getReuniaoId('2026-09')).toBe('REU-2026-09');
  });
});

describe('contrato da landing (pontos de atenção)', () => {
  const src = fs.readFileSync('js/reunioes.js', 'utf8');

  it('reunião encerrada oferece "Reabrir", não "Iniciar"', () => {
    expect(src).toContain("? 'Reabrir' : 'Iniciar'} Reunião de");
  });

  it('"Ver Relatório Anterior" aponta à última encerrada de mês menor', () => {
    expect(src).toContain('prevMeeting');
    expect(src).toMatch(/\(r\.mesAno \|\| ''\) < mesAno/);
    expect(src).toContain("showMeetingReport('${prevMeeting.id}')");
  });

  it('contador renomeado para "Clientes" (sem "na fila")', () => {
    expect(src).not.toContain('Clientes na fila');
  });

  it('modal do relatório indica o mês', () => {
    expect(src).toContain("openModal('Relatório — ' + _getMesAnoLabel(m.mesAno || '')");
  });
});
