import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

// Acessos da Ficha TI (migration 043) em Postgres de verdade: cifrados fora
// do registro, revelação só por RPC (com auditoria) e app antigo neutralizado.
const read = (f) => fs.readFileSync(new URL('../supabase/migrations/' + f, import.meta.url), 'utf8');
const UID = { ana: '00000000-0000-0000-0000-0000000000a1', beto: '00000000-0000-0000-0000-0000000000b1' };
let db;

async function as(who, sql, params) {
  return db.transaction(async (tx) => {
    await tx.query("SELECT set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)",
      [UID[who], JSON.stringify({ sub: UID[who], role: 'authenticated' })]);
    await tx.exec('SET LOCAL ROLE authenticated');
    return tx.query(sql, params || []);
  });
}
const client = async (id) => (await db.query('SELECT server, licenses FROM clients WHERE id = $1', [id])).rows[0];

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated;
    CREATE SCHEMA vault;
    CREATE TABLE vault.decrypted_secrets (name text, decrypted_secret text);
    INSERT INTO vault.decrypted_secrets VALUES ('client_secrets_key', 'chave-de-teste-com-32-caracteres!!');

    CREATE TABLE operators (id text PRIMARY KEY, name text, email text, auth_user_id uuid, is_admin boolean DEFAULT false,
      active boolean DEFAULT true, team text DEFAULT 'init', updated_at timestamptz DEFAULT now());
    CREATE TABLE clients (id text PRIMARY KEY, name text, team text DEFAULT 'init',
      server jsonb DEFAULT '{}', licenses jsonb DEFAULT '[]', updated_at timestamptz DEFAULT now());
    CREATE TABLE procedures (id text PRIMARY KEY, client_id text);
    CREATE TABLE pendencias (id text PRIMARY KEY, team text, tipo text);
    CREATE TABLE procedure_templates (id text PRIMARY KEY);
    CREATE TABLE audit_logs (id bigserial PRIMARY KEY, operator_name text, action text, type text, target_id text, details text, timestamp timestamptz DEFAULT now());
    GRANT USAGE ON SCHEMA public TO anon, authenticated;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
    GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;

    INSERT INTO operators (id, name, auth_user_id, team) VALUES ('op-ana', 'Ana', '${UID.ana}', 'init'), ('op-beto', 'Beto', '${UID.beto}', 'mam');
    -- Estado de antes: acessos em texto no registro.
    INSERT INTO clients (id, name, team, server, licenses) VALUES
      ('c1', 'Acme', 'init', '{"ip":"10.0.0.1","remoteAccess":"AnyDesk","remoteId":"123 456 789"}',
       '[{"software":"Windows Server","key":"AAAA-BBBB","expiry":"2027-01-01"},{"software":"Office"}]');
  `);
  await db.exec(read('042_rls_completo.sql'));
  await db.exec(read('043_client_secrets.sql'));
  await db.exec(read('046_calendar_feeds.sql'));
});

describe('migração dos acessos existentes', () => {
  it('tira o ID e a chave do registro e deixa só as marcas', async () => {
    const c = await client('c1');
    expect(c.server).toEqual({ ip: '10.0.0.1', remoteAccess: 'AnyDesk', remoteIdSet: true });
    expect(c.licenses[0]).toMatchObject({ software: 'Windows Server', expiry: '2027-01-01', hasKey: true });
    expect(c.licenses[0].key).toBeUndefined();
    expect(c.licenses[0].kid).toMatch(/^[0-9a-f]{32}$/);
    expect(c.licenses[1]).toEqual({ software: 'Office' });
  });

  it('o que fica guardado está cifrado (não é o texto)', async () => {
    const r = await db.query("SELECT encode(remote_id, 'escape') AS raw FROM client_secrets WHERE client_id = 'c1'");
    expect(r.rows[0].raw).not.toContain('123 456 789');
  });
});

describe('revelar (RPC) e auditoria', () => {
  it('técnico da equipe revela o ID e a chave; cada revelação vai para a auditoria', async () => {
    const rid = await as('ana', "SELECT public.reveal_client_secret('c1', 'remote_id') AS v");
    expect(rid.rows[0].v).toBe('123 456 789');
    const kid = (await client('c1')).licenses[0].kid;
    const key = await as('ana', "SELECT public.reveal_client_secret('c1', 'license', $1) AS v", [kid]);
    expect(key.rows[0].v).toBe('AAAA-BBBB');
    const logs = await db.query("SELECT operator_name, action, target_id, details FROM audit_logs ORDER BY id");
    expect(logs.rows).toEqual([
      { operator_name: 'Ana', action: 'Revelou acesso', target_id: 'c1', details: 'ID de acesso remoto' },
      { operator_name: 'Ana', action: 'Revelou acesso', target_id: 'c1', details: 'Chave de licença: Windows Server' },
    ]);
  });

  it('outra equipe não revela, e a tabela de segredos não é legível pela API', async () => {
    await expect(as('beto', "SELECT public.reveal_client_secret('c1', 'remote_id')")).rejects.toThrow(/Acesso negado/);
    await expect(as('ana', 'SELECT * FROM client_secrets')).rejects.toThrow(/permission denied/);
  });
});

describe('gravação', () => {
  it('app antigo mandando o ID em texto: o banco tira e guarda cifrado', async () => {
    await as('ana', `UPDATE clients SET server = '{"ip":"10.0.0.1","remoteAccess":"AnyDesk","remoteId":"999"}' WHERE id = 'c1'`);
    expect((await client('c1')).server.remoteId).toBeUndefined();
    expect((await as('ana', "SELECT public.reveal_client_secret('c1', 'remote_id') AS v")).rows[0].v).toBe('999');
  });

  it('quando tira um acesso, o registro fica mais novo que o enviado (o aparelho troca a cópia local)', async () => {
    const sent = '2026-10-18T12:00:00.000Z';
    await as('ana', `UPDATE clients SET server = '{"remoteId":"777"}', updated_at = $1 WHERE id = 'c1'`, [sent]);
    const r = await db.query("SELECT updated_at FROM clients WHERE id = 'c1'");
    expect(new Date(r.rows[0].updated_at).getTime()).toBeGreaterThan(Date.parse(sent));
    // Save sem acesso nenhum não mexe no horário.
    const plain = '2030-01-01T00:00:00.000Z';
    await as('ana', `UPDATE clients SET server = '{"ip":"1","remoteIdSet":true}', updated_at = $1 WHERE id = 'c1'`, [plain]);
    const r2 = await db.query("SELECT updated_at FROM clients WHERE id = 'c1'");
    expect(new Date(r2.rows[0].updated_at).toISOString()).toBe(plain);
    await as('ana', `UPDATE clients SET server = '{"remoteId":"999"}' WHERE id = 'c1'`);
  });

  it('save sem o ID (app novo) mantém o guardado', async () => {
    await as('ana', `UPDATE clients SET server = '{"ip":"10.0.0.2","remoteIdSet":true}' WHERE id = 'c1'`);
    const c = await client('c1');
    expect(c.server).toEqual({ ip: '10.0.0.2', remoteIdSet: true });
    expect((await as('ana', "SELECT public.reveal_client_secret('c1', 'remote_id') AS v")).rows[0].v).toBe('999');
  });

  it('licença com kid e sem chave mantém a chave; licença removida apaga a chave', async () => {
    const kid = (await client('c1')).licenses[0].kid;
    await as('ana', `UPDATE clients SET licenses = $1 WHERE id = 'c1'`, [JSON.stringify([{ software: 'Windows Server', kid, key: '' }])]);
    expect((await client('c1')).licenses[0]).toMatchObject({ kid, hasKey: true });
    await as('ana', "UPDATE clients SET licenses = '[]' WHERE id = 'c1'");
    const r = await db.query("SELECT license_keys FROM client_secrets WHERE client_id = 'c1'");
    expect(r.rows[0].license_keys).toEqual({});
  });

  it('set_client_remote_id troca e remove (com auditoria)', async () => {
    await as('ana', "SELECT public.set_client_remote_id('c1', '555')");
    expect((await as('ana', "SELECT public.reveal_client_secret('c1', 'remote_id') AS v")).rows[0].v).toBe('555');
    await as('ana', "SELECT public.set_client_remote_id('c1', '')");
    expect((await client('c1')).server.remoteIdSet).toBe(false);
    expect((await as('ana', "SELECT public.reveal_client_secret('c1', 'remote_id') AS v")).rows[0].v).toBeNull();
    const acts = (await db.query("SELECT action FROM audit_logs WHERE details = 'ID de acesso remoto' AND action <> 'Revelou acesso' ORDER BY id")).rows.map((x) => x.action);
    expect(acts).toEqual(['Alterou acesso', 'Removeu acesso']);
  });
});

describe('link de agenda (046)', () => {
  it('cada um recebe o próprio token; trocar invalida o anterior; ninguém lê a tabela', async () => {
    const t1 = (await as('ana', 'SELECT public.my_calendar_feed_token() AS t')).rows[0].t;
    expect(t1).toMatch(/^[A-Za-z0-9_-]{40,60}$/);
    expect((await as('ana', 'SELECT public.my_calendar_feed_token() AS t')).rows[0].t).toBe(t1);
    const t2 = (await as('ana', 'SELECT public.my_calendar_feed_token(true) AS t')).rows[0].t;
    expect(t2).not.toBe(t1);
    const tb = (await as('beto', 'SELECT public.my_calendar_feed_token() AS t')).rows[0].t;
    expect(tb).not.toBe(t2);
    await expect(as('ana', 'SELECT * FROM calendar_feeds')).rejects.toThrow(/permission denied/);
  });

  it('operador desativado perde o link', async () => {
    await db.exec("UPDATE operators SET active = false WHERE id = 'op-beto'");
    const r = await db.query("SELECT count(*)::int AS n FROM calendar_feeds WHERE operator_id = 'op-beto'");
    expect(r.rows[0].n).toBe(0);
  });
});
