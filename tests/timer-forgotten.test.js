import { createRequire as __partsReq } from 'node:module';
const { requireParts, partsSource } = __partsReq(import.meta.url)('./_parts.cjs');
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

// Helpers puros do timer.js (o arquivo também registra listeners de DOM,
// por isso roda num sandbox mínimo).
const sandbox = {
  console,
  setInterval: () => 0,
  clearInterval: () => {},
  document: { addEventListener() {}, querySelectorAll: () => [], hidden: false },
  escapeHtml: (s) => String(s ?? ''),
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('js/timer.js', 'utf8'), sandbox, { filename: 'timer.js' });
vm.runInContext(
  'globalThis.__t = { formatTimerCompact, formatTimer, getSessionSeconds, isTimerForgotten, formatDurationWords };',
  sandbox
);
const T = sandbox.__t;
const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();

describe('formatTimerCompact', () => {
  it('até 24h mantém HH:MM:SS', () => {
    expect(T.formatTimerCompact(3 * 3600 + 5 * 60 + 9)).toBe('03:05:09');
  });
  it('acima de 24h vira dias + horas', () => {
    expect(T.formatTimerCompact(213 * 3600 + 6 * 60 + 51)).toBe('8d 21h');
  });
});

describe('cronômetro esquecido', () => {
  it('sessão ligada há 11h é esquecida; há 2h não', () => {
    expect(T.isTimerForgotten({ timerRunning: true, timerStartedAt: hoursAgo(11) })).toBe(true);
    expect(T.isTimerForgotten({ timerRunning: true, timerStartedAt: hoursAgo(2) })).toBe(false);
  });
  it('parado nunca é esquecido (mesmo com total alto)', () => {
    expect(T.isTimerForgotten({ timerRunning: false, timerTotalSeconds: 999999 })).toBe(false);
  });
  it('conta só a sessão atual, não o total acumulado', () => {
    const s = T.getSessionSeconds({ timerRunning: true, timerStartedAt: hoursAgo(1), timerTotalSeconds: 100000 });
    expect(s).toBeGreaterThanOrEqual(3599);
    expect(s).toBeLessThan(3700);
  });
});

describe('formatDurationWords', () => {
  it('dias, horas e minutos legíveis', () => {
    expect(T.formatDurationWords(8 * 86400 + 21 * 3600)).toBe('8 dias e 21h');
    expect(T.formatDurationWords(86400)).toBe('1 dia');
    expect(T.formatDurationWords(14 * 3600 + 5 * 60)).toBe('14h 05min');
    expect(T.formatDurationWords(40 * 60)).toBe('40min');
  });
});

describe('card da pendência (contrato no código)', () => {
  const src = partsSource('pendencias');
  it('cronômetro esquecido abre "parar e ajustar"', () => {
    expect(src).toContain('openTimerAdjust(');
    expect(src).toContain('kb-timer-forgot');
  });
  it('"Parada" some quando o cronômetro está rodando', () => {
    expect(src).toContain('isStalePendencia(p) && !p.timerRunning');
  });
  it('"Vencida" não aparece mais como selo no meio do card', () => {
    expect(src).not.toContain('<span class="kc-overdue"');
  });
});
