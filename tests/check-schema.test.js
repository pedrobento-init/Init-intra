import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// CRLF: checkout Windows quebra comparação de texto (já aconteceu: rls-055).
const sql = readFileSync(join(__dirname, '..', 'tools', 'check-schema.sql'), 'utf8').replace(
  /\r\n/g,
  '\n'
);

// Tira comentários de linha antes de olhar as instruções.
const codigo = sql
  .split('\n')
  .filter((l) => !l.trim().startsWith('--'))
  .join('\n');
const comandos = codigo
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean);

describe('tools/check-schema.sql (conferência somente leitura)', () => {
  it('traz as consultas esperadas', () => {
    expect(comandos.length).toBeGreaterThanOrEqual(7);
  });

  it('todo comando começa com SELECT', () => {
    for (const c of comandos) expect(c).toMatch(/^select\b/i);
  });

  it('não contém DDL/DML nem comando de efeito colateral', () => {
    const proibido =
      /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|vacuum|reindex|call|execute|set|reset|begin|commit|rollback|notify|listen|lock)\b/i;
    // Literais entre aspas simples (ex.: 'current_op_id') não contam.
    const semLiterais = codigo.replace(/'[^']*'/g, "''");
    expect(semLiterais).not.toMatch(proibido);
  });

  it('não chama função que escreve ou muda estado', () => {
    expect(codigo).not.toMatch(
      /\b(pg_terminate_backend|pg_cancel_backend|set_config|nextval|setval|lo_import|lo_export|pg_read_file)\s*\(/i
    );
  });

  it('cobre RLS, policies, grants, buckets e a função current_op_name', () => {
    expect(sql).toMatch(/relrowsecurity/);
    expect(sql).toMatch(/pg_policies/);
    expect(sql).toMatch(/role_table_grants/);
    expect(sql).toMatch(/storage\.buckets/);
    expect(sql).toMatch(/current_op_name/);
  });

  it('o cabeçalho declara que não tem efeito colateral', () => {
    expect(sql).toMatch(/EFEITO COLATERAL\n--\s+Nenhum/);
  });
});
