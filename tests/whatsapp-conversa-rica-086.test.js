import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

// Migration 086 em Postgres de verdade (PGlite). O que não pode quebrar:
//   * recibo (ack) só avança, mesmo com eventos do WAHA fora de ordem;
//   * recibo, citação e reações são do servidor: o que o app (authenticated)
//     grava nessas colunas é desfeito em silêncio, sem derrubar o resto do
//     update — o push do sync não pode falhar por causa delas.

const M086 = fs
  .readFileSync(
    fileURLToPath(
      new URL('../supabase/migrations/086_whatsapp_conversa_rica.sql', import.meta.url)
    ),
    'utf8'
  )
  .replace(/\r\n/g, '\n');

let db;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    -- emails_triagem como as migrations anteriores a deixam (só o que a 086 usa).
    CREATE TABLE emails_triagem (
      id text PRIMARY KEY, team text NOT NULL DEFAULT 'init', canal text, telefone text,
      direcao text, status text NOT NULL DEFAULT 'pendente', message_id text, corpo text,
      updated_at timestamptz NOT NULL DEFAULT now());
    GRANT SELECT, INSERT, UPDATE, DELETE ON emails_triagem TO authenticated, service_role;
  `);
  await db.exec(M086);
  await db.exec(M086); // idempotente
}, 60000);

beforeEach(async () => {
  await db.exec('DELETE FROM emails_triagem');
});

async function como(papel, sql, params) {
  let out;
  await db.transaction(async (tx) => {
    await tx.exec(`SET LOCAL ROLE ${papel}`);
    out = await tx.query(sql, params);
  });
  return out.rows;
}

const linha = async (id) =>
  (
    await db.query(
      'SELECT ack, citacao, reacao_contato, reacao_equipe, status FROM emails_triagem WHERE id = $1',
      [id]
    )
  ).rows[0];

describe('086: recibo só avança', () => {
  it('"entregue" depois de "lida" não volta atrás', async () => {
    await db.query("INSERT INTO emails_triagem (id, canal, ack) VALUES ('s1', 'whatsapp', 3)");
    await db.query("UPDATE emails_triagem SET ack = 2 WHERE id = 's1'");
    expect((await linha('s1')).ack).toBe(3);
  });

  it('erro atrasado não apaga uma mensagem já entregue', async () => {
    await db.query("INSERT INTO emails_triagem (id, canal, ack) VALUES ('s1', 'whatsapp', 2)");
    await db.query("UPDATE emails_triagem SET ack = -1 WHERE id = 's1'");
    expect((await linha('s1')).ack).toBe(2);
  });
});

describe('086: colunas do servidor', () => {
  it('o app não muda recibo nem reação, e o resto do update passa', async () => {
    await como(
      'service_role',
      "INSERT INTO emails_triagem (id, canal, ack, reacao_contato) VALUES ('s1', 'whatsapp', 3, '👍')"
    );
    await como(
      'authenticated',
      "UPDATE emails_triagem SET ack = 0, reacao_contato = '😢', reacao_equipe = '❤️', status = 'encerrado' WHERE id = 's1'"
    );
    expect(await linha('s1')).toEqual({
      ack: 3,
      citacao: null,
      reacao_contato: '👍',
      reacao_equipe: null,
      status: 'encerrado',
    });
  });

  it('insert do app entra sem citação forjada', async () => {
    await como(
      'authenticated',
      `INSERT INTO emails_triagem (id, canal, citacao, reacao_equipe)
       VALUES ('a1', 'whatsapp', '{"id":"x","texto":"forjado"}', '👍')`
    );
    const l = await linha('a1');
    expect(l.citacao).toBeNull();
    expect(l.reacao_equipe).toBeNull();
  });

  it('upsert do sync com valor velho não sobrescreve o que o servidor gravou', async () => {
    await como(
      'service_role',
      "INSERT INTO emails_triagem (id, canal, ack) VALUES ('s1', 'whatsapp', 3)"
    );
    await como(
      'authenticated',
      `INSERT INTO emails_triagem (id, canal, ack) VALUES ('s1', 'whatsapp', 1)
       ON CONFLICT (id) DO UPDATE SET ack = excluded.ack`
    );
    expect((await linha('s1')).ack).toBe(3);
  });

  it('o servidor (service role) grava normalmente', async () => {
    await como('service_role', "INSERT INTO emails_triagem (id, canal) VALUES ('s1', 'whatsapp')");
    await como(
      'service_role',
      "UPDATE emails_triagem SET ack = 3, reacao_equipe = '👍' WHERE id = 's1'"
    );
    const l = await linha('s1');
    expect([l.ack, l.reacao_equipe]).toEqual([3, '👍']);
  });
});
