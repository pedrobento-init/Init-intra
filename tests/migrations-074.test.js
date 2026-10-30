import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// ── 074: a resposta da caixa vira linha ─────────────────────────────────────
// A ação Responder (js/caixa-entrada.js) grava a mensagem enviada em
// emails_triagem com status 'respondido' e fecha as pendentes do thread com o
// mesmo valor. Sem o CHECK novo, o insert falha DEPOIS de o e-mail já ter saído
// — o envio não se desfaz, mas a conversa fica sem registro. Aplicada à mão,
// depois da 073; rodar duas vezes não pode quebrar.

const ler = (rel) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const sql = ler('../supabase/migrations/074_caixa_responder.sql');
const corpo = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

describe('074_caixa_responder', () => {
  it('status ganha respondido sem perder os estados da 066 e da 073', () => {
    const check = corpo.match(/emails_triagem_status_check\s+check \(status in \(([^)]*)\)\)/);
    expect(check).not.toBeNull();
    for (const s of ['pendente', 'virou_chamado', 'anexado', 'respondido', 'descartado']) {
      expect(check[1]).toContain(`'${s}'`);
    }
  });

  it('é idempotente: o CHECK cai antes de voltar', () => {
    expect(corpo.indexOf('drop constraint if exists emails_triagem_status_check'))
      .toBeLessThan(corpo.indexOf('add constraint emails_triagem_status_check'));
  });

  it('não mexe em policy nem em motivo: a 073 continua valendo', () => {
    expect(corpo).not.toMatch(/policy/i);
    expect(corpo).not.toMatch(/motivo/);
  });

  it('traz VERIFICAR e REVERTER, e o REVERTER apaga respondido antes do CHECK antigo', () => {
    expect(sql).toMatch(/-- VERIFICAR:/);
    expect(sql).toMatch(/-- esperado:/);
    const rev = sql.slice(sql.indexOf('-- REVERTER'));
    expect(rev.indexOf("status = 'respondido'"))
      .toBeLessThan(rev.indexOf("check (status in ('pendente', 'virou_chamado', 'anexado', 'descartado'))"));
  });
});
