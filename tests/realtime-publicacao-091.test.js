import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { fonte, norm } = require('./_fonte.cjs');

// O app assina todas as tabelas realtime num canal só: uma fora da publicação
// faz o Supabase recusar o canal inteiro e a Caixa deixa de atualizar na hora.
describe('migration 091: respostas_prontas na publicação do realtime', () => {
  const sql = fonte('supabase/migrations/091_respostas_prontas_realtime.sql');

  it('adiciona respostas_prontas a supabase_realtime', () => {
    expect(sql).toContain(
      norm('alter publication supabase_realtime add table public.respostas_prontas')
    );
  });

  it('é idempotente: só adiciona quando a tabela ainda não está na publicação', () => {
    expect(sql).toContain(norm('not exists ( select 1 from pg_publication_tables'));
  });

  it('traz verificação e reversão no cabeçalho', () => {
    expect(sql).toContain('VERIFICAR:');
    expect(sql).toContain('REVERTER:');
  });
});
