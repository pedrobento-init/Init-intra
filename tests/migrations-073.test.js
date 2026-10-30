import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// ── 073: emails_triagem vira a caixa de entrada ───────────────────────────
// Migration aplicada à mão no SQL Editor: rodar duas vezes não pode quebrar, e
// o robô novo grava linha com motivo nulo e status 'anexado' — se um dos dois
// faltar, a caixa perde a mensagem (o chamado continua, mas a linha some).

const ler = (rel) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const sql = ler('../supabase/migrations/073_caixa_entrada.sql');
const corpo = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

describe('073_caixa_entrada', () => {
  it('status aceita anexado sem perder os estados da 066', () => {
    const check = corpo.match(/emails_triagem_status_check\s+check \(status in \(([^)]*)\)\)/);
    expect(check).not.toBeNull();
    for (const s of ['pendente', 'virou_chamado', 'anexado', 'descartado']) expect(check[1]).toContain(`'${s}'`);
  });

  it('motivo deixa de ser obrigatório: linha que virou chamado não tem motivo', () => {
    expect(corpo).toMatch(/alter column motivo drop not null/);
  });

  it('não recria o CHECK de motivo — o da 070 (com auto_resposta) continua valendo', () => {
    expect(corpo).not.toMatch(/emails_triagem_motivo_check/);
  });

  it('é idempotente: constraint cai antes de voltar, colunas e índice com if not exists', () => {
    expect(corpo.indexOf('drop constraint if exists emails_triagem_status_check'))
      .toBeLessThan(corpo.indexOf('add constraint emails_triagem_status_check'));
    for (const c of ['client_id', 'atribuido_a', 'atribuido_em', 'atribuicao_nota']) {
      expect(corpo).toMatch(new RegExp(`add column if not exists ${c}\\b`));
    }
    expect(corpo).toMatch(/create index if not exists emails_triagem_thread_idx/);
  });

  it('não mexe em policy: o RLS por team da 066 cobre as colunas novas', () => {
    expect(corpo).not.toMatch(/policy/i);
  });

  it('traz VERIFICAR e REVERTER, e o REVERTER apaga as linhas novas antes do CHECK antigo', () => {
    expect(sql).toMatch(/-- VERIFICAR:/);
    expect(sql).toMatch(/-- esperado:/);
    const rev = sql.slice(sql.indexOf('-- REVERTER'));
    expect(rev.indexOf("status = 'anexado' or motivo is null"))
      .toBeLessThan(rev.indexOf("check (status in ('pendente', 'virou_chamado', 'descartado'))"));
    expect(rev).toMatch(/alter column motivo set not null/);
  });
});
