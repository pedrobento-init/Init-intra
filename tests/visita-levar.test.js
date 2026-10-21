import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
import { visitHash, visitToEvent } from '../supabase/functions/google-agenda/mapping.ts';

const { levarSugestoes, levarMescla, levarNormaliza, levarTexto, LEVAR_REGRAS_PADRAO } = createRequire(import.meta.url)('../js/visita-levar.js');

describe('o que levar: sugestões pelo motivo', () => {
  it('formatação sugere pendrive e HD de backup, sem ligar para acento/maiúscula', () => {
    const s = levarSugestoes('FORMATAÇÃO de máquina', LEVAR_REGRAS_PADRAO);
    expect(s).toContain('Pendrive bootável do Windows');
    expect(s).toContain('HD externo para backup');
  });
  it('palavra inteira com plural: "impressoras" casa; "redefinir senha" não casa com "rede"', () => {
    expect(levarSugestoes('Configurar impressoras', LEVAR_REGRAS_PADRAO)).toContain('Cabo USB de impressora');
    expect(levarSugestoes('Redefinir senha do e-mail', LEVAR_REGRAS_PADRAO)).toEqual([]);
  });
  it('duas regras no mesmo motivo não repetem item; regra inativa não conta', () => {
    const s = levarSugestoes('Formatação e backup', LEVAR_REGRAS_PADRAO);
    expect(s.filter((t) => t === 'HD externo para backup')).toHaveLength(1);
    expect(levarSugestoes('backup', [{ palavras: 'backup', itens: ['HD'], ativo: false }])).toEqual([]);
  });
  it('observações prévias também sugerem, não só o motivo', () => {
    const v = { motivo: 'Visita de rotina', observacoes: 'Ver a impressora do faturamento, que parou de puxar papel' };
    expect(levarSugestoes(v.motivo, LEVAR_REGRAS_PADRAO)).toEqual([]);
    expect(levarSugestoes(levarTexto(v), LEVAR_REGRAS_PADRAO)).toContain('Cabo USB de impressora');
  });
  it('palavra que só existe nas observações não vaza para outra regra', () => {
    const v = { motivo: 'Conversar com o cliente', observacoes: 'Ele quer redefinir a senha do e-mail' };
    expect(levarSugestoes(levarTexto(v), LEVAR_REGRAS_PADRAO)).toEqual([]);
  });
  it('texto junta motivo e observações mesmo com um dos dois vazio', () => {
    expect(levarNormaliza(levarTexto({ motivo: 'Formatação' }))).toBe('formatacao');
    expect(levarNormaliza(levarTexto({ observacoes: 'Levar switch' }))).toBe('levar switch');
    expect(levarNormaliza(levarTexto(null))).toBe('');
  });
  it('mescla mantém o que já está (e marcado), e respeita o que o técnico tirou', () => {
    const lista = [{ t: 'HD externo para backup', ok: true }];
    const ign = new Set([levarNormaliza('Pendrive com drivers')]);
    const out = levarMescla(lista, levarSugestoes('formatar', LEVAR_REGRAS_PADRAO), ign);
    expect(out[0]).toEqual({ t: 'HD externo para backup', ok: true });
    expect(out.map((i) => i.t)).not.toContain('Pendrive com drivers');
    expect(out.map((i) => i.t)).toContain('Pendrive bootável do Windows');
  });
  it('seed da 058 é o mesmo do app (offline sugere igual)', () => {
    const sql = fs.readFileSync(new URL('../supabase/migrations/058_visita_levar.sql', import.meta.url), 'utf8');
    for (const r of LEVAR_REGRAS_PADRAO) {
      expect(sql).toContain(`('${r.id}'`);
      for (const it of r.itens) expect(sql).toContain(JSON.stringify(it));
    }
  });
});

describe('o que levar na agenda Google', () => {
  const v = { id: 'VIS-1', client_name: 'Acme', motivo: 'Formatação', date: '2026-10-20', time: '09:00', status: 'agendada' };
  it('lista vai na descrição com ☐/☑', () => {
    const ev = visitToEvent({ ...v, levar: [{ t: 'Pendrive', ok: true }, { t: 'HD externo', ok: false }] });
    expect(ev.description).toContain('O que levar:\n☑ Pendrive\n☐ HD externo');
  });
  it('sem lista o hash é o mesmo de antes (nada reenviado); marcar item muda o hash', async () => {
    const h = await visitHash(v);
    expect(await visitHash({ ...v, levar: [] })).toBe(h);
    expect(await visitHash({ ...v, levar: null })).toBe(h);
    const a = await visitHash({ ...v, levar: [{ t: 'Pendrive', ok: false }] });
    expect(a).not.toBe(h);
    expect(await visitHash({ ...v, levar: [{ t: 'Pendrive', ok: true }] })).not.toBe(a);
  });
});

describe('058 no Postgres', () => {
  let db;
  const as = async (uid, sql) => {
    await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub = '${uid}'`);
    try { return await db.query(sql); } finally { await db.exec('RESET ROLE; RESET request.jwt.claim.sub'); }
  };
  const ADMIN = '00000000-0000-0000-0000-00000000000a';
  const TEC = '00000000-0000-0000-0000-0000000000a1';

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
      CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO authenticated;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      CREATE TABLE operators (id text PRIMARY KEY, name text, email text, auth_user_id uuid, is_admin boolean DEFAULT false, active boolean DEFAULT true);
      CREATE FUNCTION current_op_id() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
        AS $$ SELECT o.id FROM operators o WHERE o.auth_user_id = auth.uid() LIMIT 1 $$;
      CREATE FUNCTION current_op_is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
        AS $$ SELECT EXISTS (SELECT 1 FROM operators o WHERE o.auth_user_id = auth.uid() AND o.is_admin AND COALESCE(o.active, true)) $$;
      GRANT EXECUTE ON FUNCTION current_op_id(), current_op_is_admin() TO authenticated;
      CREATE TABLE visits (id text PRIMARY KEY, client_name text, operator text, operator_id text, date date, "time" time,
        time_end time, all_day boolean DEFAULT false, motivo text, observacoes text, status text, numero integer,
        relatorio text, updated_at timestamptz DEFAULT now());
      INSERT INTO operators VALUES ('OP-A', 'Admin', 'a@x', '${ADMIN}', true), ('OP-T', 'Téc', 't@x', '${TEC}', false);
    `);
    await db.exec(fs.readFileSync(new URL('../supabase/migrations/057_google_agenda.sql', import.meta.url), 'utf8'));
    const m058 = fs.readFileSync(new URL('../supabase/migrations/058_visita_levar.sql', import.meta.url), 'utf8');
    await db.exec(m058);
    await db.exec(m058); // idempotente
    await db.exec(`INSERT INTO google_agenda_runner (email) VALUES ('robo@x')`);
  }, 60000);

  it('todos leem as regras; só admin grava', async () => {
    expect((await as(TEC, 'SELECT count(*)::int AS n FROM levar_regras')).rows[0].n).toBe(LEVAR_REGRAS_PADRAO.length);
    await expect(as(TEC, `INSERT INTO levar_regras (id, palavras) VALUES ('x', 'teste')`)).rejects.toThrow(/row-level security/);
    expect((await as(TEC, `UPDATE levar_regras SET palavras = 'x' RETURNING id`)).rows).toEqual([]);
    expect((await as(TEC, `DELETE FROM levar_regras RETURNING id`)).rows).toEqual([]);
    await as(ADMIN, `INSERT INTO levar_regras (id, palavras, itens) VALUES ('lv-teste', 'teste', '["Item"]')`);
    expect((await as(ADMIN, `DELETE FROM levar_regras WHERE id = 'lv-teste' RETURNING id`)).rows).toEqual([{ id: 'lv-teste' }]);
  });

  it('rodar de novo não desfaz edição do admin', async () => {
    await db.exec(`UPDATE levar_regras SET palavras = 'formatar pc' WHERE id = 'lv-formatacao'`);
    await db.exec(fs.readFileSync(new URL('../supabase/migrations/058_visita_levar.sql', import.meta.url), 'utf8'));
    expect((await db.query(`SELECT palavras FROM levar_regras WHERE id = 'lv-formatacao'`)).rows[0].palavras).toBe('formatar pc');
  });

  it('marcar item da lista põe a visita na fila da agenda Google', async () => {
    await db.exec(`INSERT INTO visits (id, operator_id, date, status, levar) VALUES ('VIS-9', 'OP-T', '2026-10-20', 'agendada', '[{"t":"Pendrive","ok":false}]')`);
    await db.exec('DELETE FROM google_agenda_queue');
    await db.exec(`UPDATE visits SET levar = '[{"t":"Pendrive","ok":true}]' WHERE id = 'VIS-9'`);
    expect((await db.query('SELECT visit_id FROM google_agenda_queue')).rows).toEqual([{ visit_id: 'VIS-9' }]);
  });
});
