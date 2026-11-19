import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

// Migration 088 em Postgres de verdade (PGlite). O que não pode quebrar:
//   * a configuração da automação só é gravada por admin (cada mensagem
//     automática sai do número da empresa) e cada equipe só lê a sua;
//   * a nota de satisfação não é gravável pelo app — só o webhook, com
//     service_role — e cada equipe só lê as suas;
//   * whatsapp_conversas continua sem policy;
//   * a migration roda de novo sem erro, e sem pg_cron só avisa.

const M088 = fs
  .readFileSync(
    fileURLToPath(new URL('../supabase/migrations/088_whatsapp_automacao.sql', import.meta.url)),
    'utf8'
  )
  .replace(/\r\n/g, '\n');

let db;

async function como(quem, sql, params) {
  return db.transaction(async (tx) => {
    if (quem === 'service') {
      await tx.exec('SET LOCAL ROLE service_role');
    } else {
      await tx.query("SELECT set_config('app.op', $1, true)", [quem]);
      await tx.exec('SET LOCAL ROLE authenticated');
    }
    return tx.query(sql, params || []);
  });
}

async function negado(quem, sql, params) {
  try {
    await como(quem, sql, params);
    return false;
  } catch (e) {
    return /row-level security|permission denied/.test(e.message);
  }
}

beforeAll(async () => {
  db = new PGlite();
  // Helpers da 011 simplificados: o "operador logado" vem de app.op.
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO authenticated, service_role, anon;
    CREATE TABLE operators (id text PRIMARY KEY, team text, is_admin boolean);
    INSERT INTO operators VALUES ('admin', 'init', true), ('ana', 'init', false), ('beto', 'mam', false);
    CREATE FUNCTION public.current_op_is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
      $$ SELECT coalesce((SELECT is_admin FROM operators WHERE id = current_setting('app.op', true)), false) $$;
    CREATE FUNCTION public.current_op_team() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS
      $$ SELECT coalesce((SELECT team FROM operators WHERE id = current_setting('app.op', true)), 'init') $$;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
    CREATE TABLE whatsapp_conversas (telefone text PRIMARY KEY, ultima_em timestamptz);
    ALTER TABLE whatsapp_conversas ENABLE ROW LEVEL SECURITY;
  `);
  await db.exec(M088);
  await db.exec(M088); // idempotente
  await db.exec(
    'GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role; GRANT USAGE ON SCHEMA public TO service_role;'
  );
}, 60000);

describe('088: whatsapp_automacao', () => {
  it('nasce tudo desligado', async () => {
    await como('admin', "INSERT INTO whatsapp_automacao (team) VALUES ('init')");
    const { rows } = await como(
      'admin',
      "SELECT horario_ativo, saudacao_ativa, encerramento_ativo, pesquisa_ativa, inatividade_ativa FROM whatsapp_automacao WHERE team = 'init'"
    );
    expect(Object.values(rows[0])).toEqual([false, false, false, false, false]);
  });

  it('técnico não grava nem a configuração da própria equipe', async () => {
    expect(await negado('ana', "INSERT INTO whatsapp_automacao (team) VALUES ('mam')")).toBe(true);
    const { affectedRows } = await como(
      'ana',
      "UPDATE whatsapp_automacao SET saudacao_ativa = true WHERE team = 'init'"
    );
    expect(affectedRows).toBe(0);
  });

  it('cada equipe lê só a sua; admin lê todas', async () => {
    await como(
      'admin',
      "INSERT INTO whatsapp_automacao (team) VALUES ('mam') ON CONFLICT DO NOTHING"
    );
    const ana = await como('ana', 'SELECT team FROM whatsapp_automacao ORDER BY team');
    expect(ana.rows.map((r) => r.team)).toEqual(['init']);
    const admin = await como('admin', 'SELECT team FROM whatsapp_automacao ORDER BY team');
    expect(admin.rows.map((r) => r.team)).toEqual(['init', 'mam']);
  });

  it('o banco recusa inatividade sem prazo e lembrete depois do encerramento', async () => {
    await expect(
      como('admin', "UPDATE whatsapp_automacao SET inatividade_ativa = true WHERE team = 'init'")
    ).rejects.toThrow(/whatsapp_automacao_formato/);
    await expect(
      como(
        'admin',
        "UPDATE whatsapp_automacao SET inatividade_lembrete_min = 60, inatividade_encerrar_min = 30 WHERE team = 'init'"
      )
    ).rejects.toThrow(/whatsapp_automacao_formato/);
  });
});

describe('088: whatsapp_avaliacoes', () => {
  it('o app não grava nota (nem admin); o service_role grava', async () => {
    const ins =
      "INSERT INTO whatsapp_avaliacoes (team, telefone, nota) VALUES ('init', '55119', 5)";
    expect(await negado('ana', ins)).toBe(true);
    expect(await negado('admin', ins)).toBe(true);
    await como('service', ins);
    await como(
      'service',
      "INSERT INTO whatsapp_avaliacoes (team, telefone, nota) VALUES ('mam', '55119', 2)"
    );
  });

  it('nota fora de 1 a 5 é recusada', async () => {
    await expect(
      como(
        'service',
        "INSERT INTO whatsapp_avaliacoes (team, telefone, nota) VALUES ('init', '1', 6)"
      )
    ).rejects.toThrow();
  });

  it('cada equipe lê só as suas', async () => {
    const beto = await como('beto', 'SELECT nota FROM whatsapp_avaliacoes');
    expect(beto.rows.map((r) => r.nota)).toEqual([2]);
    const ana = await como('ana', 'SELECT nota FROM whatsapp_avaliacoes');
    expect(ana.rows.map((r) => r.nota)).toEqual([5]);
  });
});

describe('088: whatsapp_conversas', () => {
  it('ganha as colunas do estado e continua sem policy', async () => {
    const cols = await db.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'whatsapp_conversas' ORDER BY column_name`
    );
    expect(cols.rows.map((r) => r.column_name)).toEqual(
      expect.arrayContaining([
        'fora_horario_em',
        'encerrada_em',
        'pesquisa_ate',
        'pesquisa_team',
        'pesquisa_operador',
        'inatividade_lembrete_em',
      ])
    );
    const pol = await db.query(
      "SELECT count(*)::int AS n FROM pg_policies WHERE tablename = 'whatsapp_conversas'"
    );
    expect(pol.rows[0].n).toBe(0);
  });
});
