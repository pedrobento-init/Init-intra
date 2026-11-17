import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// PERF-01: pulls fora do loop genérico não usam select('*') em tabela que cresce.
const read = (f) =>
  readFileSync(new URL('../js/' + f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

describe('PERF-01 — colunas explícitas', () => {
  it('audit_logs seleciona só o que o mapRow consome', () => {
    const src = read('storage.js');
    expect(src).toMatch(
      /from\('audit_logs'\)\.select\('id,operator_name,action,type,target_id,details,timestamp'\)/
    );
    expect(src).not.toMatch(/from\('audit_logs'\)\.select\('\*'\)/);
  });
  it('checklist.js não faz select("*") nos três pulls', () => {
    const src = read('checklist.js');
    expect(src).not.toMatch(/\.select\('\*'\)/);
    expect(src).toMatch(/CK_COLS_MODELO/);
    expect(src).toMatch(/CK_COLS_MARCACOES/);
  });
  it('o pull genérico continua paginado por .range()', () => {
    const src = read('storage.js');
    expect(src).toMatch(/\.range\(from, from \+ SYNC_PAGE_SIZE - 1\)/);
  });
});
