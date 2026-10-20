import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// Migration 055 em Postgres de verdade (PGlite): as policies foram reescritas
// para calcular os helpers uma vez por consulta. Aqui se prova que
// (1) cada perfil lê e grava EXATAMENTE o mesmo que antes, tabela por tabela;
// (2) nenhum helper ficou sendo chamado por linha;
// (3) num projeto sem a liberação automática de tabelas (Supabase novo),
//     o app passa a ter acesso só pelos GRANTs da 055;
// (4) a leitura leve do sync fica bem mais rápida.
const mig = (n) => fs.readFileSync(new URL('../supabase/migrations/' + n, import.meta.url), 'utf8');
const BEFORE = ['042_rls_completo.sql', '045_vencimentos.sql', '048_time_entries.sql', '050_client_errors.sql', '053_push_subscriptions.sql'].map(mig);
const M055 = mig('055_grants_rls_rapido.sql');

const UID = {
  admin: '00000000-0000-0000-0000-00000000000a',
  ana: '00000000-0000-0000-0000-0000000000a1',   // técnica init
  beto: '00000000-0000-0000-0000-0000000000b1',  // técnico mam
  gil: '00000000-0000-0000-0000-0000000000c1',   // Gestão (init)
  inativo: '00000000-0000-0000-0000-0000000000d1',
  novo: '00000000-0000-0000-0000-0000000000e1',  // 1º login, ainda sem vínculo
  semCadastro: '00000000-0000-0000-0000-0000000000f1',
};
const PROFILES = ['anon', ...Object.keys(UID)];
const TABLES = ['operators', 'clients', 'pendencias', 'visits', 'procedures', 'procedure_templates', 'audit_logs',
  'reunioes', 'tickets', 'equipamentos', 'client_devices', 'milvus_client_map', 'client_milvus_tickets', 'checklists',
  'checklist_modelo_itens', 'checklist_marcacoes', 'vencimentos', 'time_entries', 'client_errors', 'push_subscriptions'];

async function newDb({ defaultGrants }) {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated;

    CREATE TABLE operators (id text PRIMARY KEY, name text, email text, auth_user_id uuid, is_admin boolean DEFAULT false,
      active boolean DEFAULT true, team text DEFAULT 'init', phone text, updated_at timestamptz DEFAULT now());
    CREATE TABLE clients (id text PRIMARY KEY, name text, team text DEFAULT 'init');
    CREATE TABLE pendencias (id text PRIMARY KEY, client_id text, team text DEFAULT 'init', tipo text DEFAULT 'tarefa',
      notes jsonb DEFAULT '[]', responsible text, timer_operator text, updated_at timestamptz DEFAULT now());
    CREATE TABLE visits (id text PRIMARY KEY, team text DEFAULT 'init', operator text, updated_at timestamptz DEFAULT now());
    CREATE TABLE procedures (id text PRIMARY KEY, client_id text, title text);
    CREATE TABLE procedure_templates (id text PRIMARY KEY);
    CREATE TABLE audit_logs (id bigserial PRIMARY KEY, operator_name text, action text);
    CREATE TABLE reunioes (id text PRIMARY KEY, team text DEFAULT 'init');
    CREATE TABLE tickets (id text PRIMARY KEY);
    CREATE TABLE equipamentos (id text PRIMARY KEY, team text DEFAULT 'init');
    CREATE TABLE client_devices (id text PRIMARY KEY, team text DEFAULT 'init');
    CREATE TABLE milvus_client_map (id text PRIMARY KEY, client_id text);
    CREATE TABLE client_milvus_tickets (id text PRIMARY KEY, team text DEFAULT 'init');
    CREATE TABLE checklists (id text PRIMARY KEY);
    CREATE TABLE checklist_modelo_itens (id text PRIMARY KEY);
    CREATE TABLE checklist_marcacoes (id text PRIMARY KEY, team text DEFAULT 'init');
    CREATE TABLE email_notifications (id text PRIMARY KEY);
    GRANT USAGE ON SCHEMA public TO anon, authenticated;
  `);
  // Supabase antigo: toda tabela nova vinha liberada para anon/authenticated.
  if (defaultGrants) await db.exec('GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated; GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;');
  for (const sql of BEFORE) await db.exec(sql);
  await db.exec(`
    INSERT INTO operators (id, name, email, auth_user_id, is_admin, is_gestao, active, team) VALUES
      ('op-admin', 'Admin', 'admin@init.com', '${UID.admin}', true, false, true, 'init'),
      ('op-ana', 'Ana', 'ana@init.com', '${UID.ana}', false, false, true, 'init'),
      ('op-beto', 'Beto', 'beto@init.com', '${UID.beto}', false, false, true, 'mam'),
      ('op-gil', 'Gil', 'gil@init.com', '${UID.gil}', false, true, true, 'init'),
      ('op-inativo', 'Ina', 'inativo@init.com', '${UID.inativo}', false, false, false, 'init'),
      ('op-novo', 'Novo', 'novo@init.com', NULL, false, false, true, 'init');
    INSERT INTO clients VALUES ('c-init', 'Acme', 'init'), ('c-mam', 'Zeta', 'mam');
    INSERT INTO pendencias (id, client_id, team, tipo) VALUES ('p-init', 'c-init', 'init', 'tarefa'), ('p-mam', 'c-mam', 'mam', 'tarefa'),
      ('p-gestao', 'c-init', 'init', 'Gestão'), ('p-gestao-mam', 'c-mam', 'mam', 'Gestao'), ('p-semteam', 'c-init', NULL, 'tarefa');
    INSERT INTO visits (id, team) VALUES ('v-init', 'init'), ('v-mam', 'mam');
    INSERT INTO procedures (id, client_id, title, team) VALUES ('pr-init', 'c-init', 'a', 'init'), ('pr-mam', 'c-mam', 'b', 'mam'),
      ('pr-orfao', 'c-sumiu', 'c', 'init'), ('kb-init', NULL, 'artigo', 'init'), ('kb-mam', NULL, 'artigo', 'mam');
    INSERT INTO procedure_templates VALUES ('tpl1');
    INSERT INTO audit_logs (operator_name, action) VALUES ('Ana', 'Criou'), ('Beto', 'Editou');
    INSERT INTO reunioes VALUES ('r-init', 'init'), ('r-mam', 'mam');
    INSERT INTO tickets VALUES ('t1');
    INSERT INTO equipamentos VALUES ('e-init', 'init'), ('e-mam', 'mam');
    INSERT INTO client_devices VALUES ('d-init', 'init'), ('d-mam', 'mam');
    INSERT INTO milvus_client_map VALUES ('m-init', 'c-init'), ('m-mam', 'c-mam'), ('m-orfao', 'c-sumiu');
    INSERT INTO client_milvus_tickets VALUES ('cmt-init', 'init'), ('cmt-mam', 'mam');
    INSERT INTO checklists VALUES ('ck1');
    INSERT INTO checklist_modelo_itens VALUES ('cki1');
    INSERT INTO checklist_marcacoes VALUES ('ckm-init', 'init'), ('ckm-mam', 'mam');
    INSERT INTO vencimentos (id, client_id, data_vencimento, team) VALUES ('vc-init', 'c-init', '2026-12-01', 'init'), ('vc-mam', 'c-mam', '2026-12-01', 'mam');
    INSERT INTO time_entries (id, operator_id, ended_at, seconds, team) VALUES ('te-ana', 'op-ana', now(), 60, 'init'),
      ('te-gil', 'op-gil', now(), 60, 'init'), ('te-beto', 'op-beto', now(), 60, 'mam');
    INSERT INTO client_errors (operator_id, message) VALUES ('op-ana', 'erro');
    INSERT INTO push_subscriptions (endpoint, operator_id, p256dh, auth) VALUES ('https://push/ana', 'op-ana', 'k', 'a'), ('https://push/beto', 'op-beto', 'k', 'a');
  `);
  return db;
}

// Roda como o PostgREST: papel + JWT na transação. Sempre desfaz (rollback).
async function probe(db, who, sql) {
  let out;
  try {
    await db.transaction(async (tx) => {
      if (who === 'anon') {
        await tx.exec('SET LOCAL ROLE anon');
      } else {
        await tx.query("SELECT set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)",
          [UID[who], JSON.stringify({ sub: UID[who], email: who + '@init.com', role: 'authenticated' })]);
        await tx.exec('SET LOCAL ROLE authenticated');
      }
      const r = await tx.query(sql);
      out = /^\s*select/i.test(sql) ? r.rows.map((x) => String(x.id ?? x.endpoint)).sort() : r.affectedRows;
      await tx.rollback();
    });
  } catch (e) {
    if (out === undefined) out = /row-level security|permission denied/.test(e.message) ? 'NEGADO' : 'ERRO: ' + e.message;
  }
  return out;
}

// Gravações de teste: dentro e fora da equipe, Gestão, papel, nome de outra pessoa...
const WRITES = [
  ...['clients', 'visits', 'reunioes', 'equipamentos', 'client_devices', 'client_milvus_tickets', 'checklist_marcacoes'].flatMap((t) => {
    const extra = t === 'clients' ? ', name' : '';
    const val = t === 'clients' ? ", 'x'" : '';
    return [
      `INSERT INTO ${t} (id, team${extra}) VALUES ('w-init', 'init'${val})`,
      `INSERT INTO ${t} (id, team${extra}) VALUES ('w-mam', 'mam'${val})`,
      `UPDATE ${t} SET team = team`,
      `UPDATE ${t} SET team = 'mam'`,
      `DELETE FROM ${t}`,
    ];
  }),
  "INSERT INTO vencimentos (id, data_vencimento, team) VALUES ('w-init', '2026-12-01', 'init')",
  "INSERT INTO vencimentos (id, data_vencimento, team) VALUES ('w-mam', '2026-12-01', 'mam')",
  "UPDATE vencimentos SET team = 'mam'", 'UPDATE vencimentos SET descricao = descricao', 'DELETE FROM vencimentos',
  "INSERT INTO pendencias (id, team, tipo) VALUES ('w1', 'init', 'tarefa')",
  "INSERT INTO pendencias (id, team, tipo) VALUES ('w2', 'mam', 'tarefa')",
  "INSERT INTO pendencias (id, team, tipo) VALUES ('w3', 'init', 'Gestão')",
  "INSERT INTO pendencias (id, team, tipo) VALUES ('w4', NULL, 'tarefa')",
  'UPDATE pendencias SET responsible = responsible', "UPDATE pendencias SET tipo = 'Gestão'", "UPDATE pendencias SET team = 'mam'",
  'DELETE FROM pendencias',
  "INSERT INTO procedures (id, client_id, team) VALUES ('w1', 'c-init', 'init')",
  "INSERT INTO procedures (id, client_id, team) VALUES ('w2', 'c-mam', 'init')",
  "INSERT INTO procedures (id, client_id, team) VALUES ('w3', NULL, 'init')",
  "INSERT INTO procedures (id, client_id, team) VALUES ('w4', NULL, 'mam')",
  "INSERT INTO procedures (id, client_id, team) VALUES ('w5', 'c-sumiu', 'init')",
  'UPDATE procedures SET title = title', "UPDATE procedures SET client_id = 'c-mam'", 'DELETE FROM procedures',
  "INSERT INTO milvus_client_map VALUES ('w1', 'c-init')", "INSERT INTO milvus_client_map VALUES ('w2', 'c-mam')",
  'UPDATE milvus_client_map SET client_id = client_id', "UPDATE milvus_client_map SET client_id = 'c-mam'", 'DELETE FROM milvus_client_map',
  ...['procedure_templates', 'checklists', 'checklist_modelo_itens', 'tickets'].flatMap((t) => [
    `INSERT INTO ${t} VALUES ('w1')`, `UPDATE ${t} SET id = id`, `DELETE FROM ${t}`,
  ]),
  "UPDATE operators SET phone = '1'", "UPDATE operators SET is_admin = true, team = 'mam'",
  `UPDATE operators SET auth_user_id = '${UID.novo}' WHERE id = 'op-novo'`,
  "INSERT INTO operators (id, name, team) VALUES ('op-x', 'X', 'init')",
  `INSERT INTO operators (id, name, auth_user_id, is_admin, is_gestao, team) VALUES ('op-ana', 'Ana', '${UID.ana}', false, false, 'init') ON CONFLICT (id) DO UPDATE SET phone = '2'`,
  'DELETE FROM operators',
  "INSERT INTO audit_logs (operator_name, action) VALUES ('Ana', 'x')",
  "INSERT INTO audit_logs (operator_name, action) VALUES ('Beto', 'x')",
  "UPDATE audit_logs SET action = 'y'", 'DELETE FROM audit_logs',
  "INSERT INTO time_entries (id, operator_id, ended_at, seconds, team) VALUES ('w1', 'op-ana', now(), 1, 'init')",
  "INSERT INTO time_entries (id, operator_id, ended_at, seconds, team) VALUES ('w2', 'op-beto', now(), 1, 'mam')",
  'UPDATE time_entries SET seconds = 5', 'DELETE FROM time_entries',
  "INSERT INTO client_errors (operator_id, message) VALUES ('op-ana', 'x')",
  "INSERT INTO client_errors (operator_id, message) VALUES ('op-beto', 'x')",
  "INSERT INTO client_errors (operator_id, message) VALUES (NULL, 'x')",
  'DELETE FROM client_errors',
  "INSERT INTO push_subscriptions (endpoint, operator_id, p256dh, auth) VALUES ('w1', 'op-ana', 'k', 'a')",
  "INSERT INTO push_subscriptions (endpoint, operator_id, p256dh, auth) VALUES ('w2', 'op-beto', 'k', 'a')",
  "UPDATE push_subscriptions SET auth = 'b'", 'DELETE FROM push_subscriptions',
];

async function snapshot(db) {
  const snap = {};
  for (const who of PROFILES) {
    for (const t of TABLES) snap[`${who} lê ${t}`] = await probe(db, who, `SELECT * FROM public.${t}`);
    for (const sql of WRITES) snap[`${who}: ${sql}`] = await probe(db, who, sql);
  }
  return snap;
}

describe('055 mantém as mesmas regras de acesso', () => {
  let antes;
  let depois;
  let db;
  beforeAll(async () => {
    db = await newDb({ defaultGrants: true });
    antes = await snapshot(db);
    await db.exec(M055);
    depois = await snapshot(db);
  }, 120000);

  it('cada perfil lê e grava exatamente o mesmo que antes (leituras e gravações)', () => {
    expect(Object.keys(depois).length).toBeGreaterThan(900);
    expect(depois).toEqual(antes);
  });

  it('o retrato cobre os casos que importam (sanidade)', () => {
    expect(antes['ana lê clients']).toEqual(['c-init']);
    expect(antes['beto lê clients']).toEqual(['c-mam']);
    expect(antes['gil lê pendencias']).toEqual(['p-gestao', 'p-gestao-mam', 'p-init', 'p-semteam']);
    expect(antes['admin lê pendencias']).toEqual(['p-init', 'p-mam', 'p-semteam']);
    expect(antes['ana lê procedures']).toEqual(['kb-init', 'pr-init']);
    expect(antes['admin lê milvus_client_map']).toEqual(['m-init', 'm-mam', 'm-orfao']);
    expect(antes['inativo lê clients']).toEqual([]);
    expect(antes['anon lê clients']).toBe('NEGADO');
    expect(antes["ana: INSERT INTO visits (id, team) VALUES ('w-mam', 'mam')"]).toBe('NEGADO');
    expect(antes["ana: INSERT INTO audit_logs (operator_name, action) VALUES ('Beto', 'x')"]).toBe('NEGADO');
    expect(antes['ana: UPDATE time_entries SET seconds = 5']).toBe(1);
    expect(antes['admin: UPDATE time_entries SET seconds = 5']).toBe(3);
    expect(Object.values(antes).filter((v) => typeof v === 'string' && v.startsWith('ERRO'))).toEqual([]);
  });

  it('rodar de novo não muda nada (idempotente)', async () => {
    await db.exec(M055);
    for (const who of ['ana', 'gil', 'admin']) {
      for (const t of ['clients', 'pendencias', 'procedures', 'operators']) {
        expect(await probe(db, who, `SELECT * FROM public.${t}`)).toEqual(antes[`${who} lê ${t}`]);
      }
    }
  });

  it('nenhuma policy chama helper ou auth.* por linha (tudo dentro de SELECT)', async () => {
    const r = await db.query(`SELECT tablename, policyname, qual, with_check FROM pg_policies WHERE schemaname = 'public'`);
    const porLinha = r.rows.filter((p) => {
      const expr = ((p.qual || '') + ' ' + (p.with_check || ''))
        .replace(/\(\s*SELECT\s+(public\.)?(current_op_\w+|auth\.\w+)\(\)/g, '');
      return /(current_op_\w+|can_see_\w+|auth\.uid|auth\.jwt)\(/.test(expr);
    });
    expect(porLinha.map((p) => p.tablename + '.' + p.policyname)).toEqual([]);
    expect(r.rows.length).toBeGreaterThan(60);
    // A consulta de VERIFICAÇÃO (a) do fim da migration, como o admin vai rodar no painel.
    const check = M055.match(/-- a\)[^\n]*\n((?:--[^\n]*\n)*?--[^\n]*;)\n/)[1].replace(/^--\s?/gm, '').trim().replace(/;$/, '');
    expect((await db.query(check)).rows).toEqual([]);
    // ...e ela acusa uma policy por linha, se alguém criar uma.
    await db.exec('CREATE POLICY teste_por_linha ON public.tickets FOR SELECT TO authenticated USING (public.current_op_is_admin())');
    expect((await db.query(check)).rows.map((x) => x.policyname)).toEqual(['teste_por_linha']);
    await db.exec('DROP POLICY teste_por_linha ON public.tickets');
  });
});

describe('055 em projeto sem liberação automática de tabelas', () => {
  let db;
  beforeAll(async () => {
    db = await newDb({ defaultGrants: false });
  }, 60000);

  it('antes da 055 o app não lê as tabelas antigas; depois lê pela regra de equipe', async () => {
    expect(await probe(db, 'ana', 'SELECT * FROM public.clients')).toBe('NEGADO');
    await db.exec(M055);
    expect(await probe(db, 'ana', 'SELECT * FROM public.clients')).toEqual(['c-init']);
    expect(await probe(db, 'ana', "INSERT INTO visits (id, team) VALUES ('w', 'init')")).toBe(1);
    expect(await probe(db, 'ana', "INSERT INTO audit_logs (operator_name, action) VALUES ('Ana', 'x')")).toBe(1);
    expect(await probe(db, 'ana', 'SELECT * FROM public.operators')).toHaveLength(6);
  });

  it('logs sem UPDATE; tabelas só do servidor e anon continuam fechadas', async () => {
    expect(await probe(db, 'admin', "UPDATE audit_logs SET action = 'y'")).toBe('NEGADO');
    expect(await probe(db, 'admin', 'SELECT * FROM public.email_notifications')).toBe('NEGADO');
    expect(await probe(db, 'anon', 'SELECT * FROM public.clients')).toBe('NEGADO');
    const anon = await db.query("SELECT table_name FROM information_schema.role_table_grants WHERE grantee = 'anon' AND table_schema = 'public'");
    expect(anon.rows).toEqual([]);
    const srv = await db.query("SELECT count(DISTINCT table_name)::int AS n FROM information_schema.role_table_grants WHERE grantee = 'service_role' AND table_schema = 'public'");
    expect(srv.rows[0].n).toBe(TABLES.length + 1); // + email_notifications
  });
});

describe('055 deixa a leitura leve do sync mais rápida', () => {
  it('20 mil pendências: helpers uma vez por consulta, não por linha', async () => {
    const db = await newDb({ defaultGrants: true });
    await db.exec("INSERT INTO pendencias (id, team) SELECT 'bulk-' || g, CASE WHEN g % 3 = 0 THEN 'mam' ELSE 'init' END FROM generate_series(1, 20000) g; ANALYZE;");
    const tempo = async () => db.transaction(async (tx) => {
      await tx.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [UID.ana]);
      await tx.exec('SET LOCAL ROLE authenticated');
      await tx.query('SELECT id, updated_at FROM pendencias'); // aquece
      const t = performance.now();
      const r = await tx.query('SELECT id, updated_at FROM pendencias');
      return { ms: performance.now() - t, n: r.rows.length };
    });
    const antes = await tempo();
    await db.exec(M055);
    const depois = await tempo();
    expect(depois.n).toBe(antes.n);
    expect(depois.ms * 3).toBeLessThan(antes.ms);
  }, 120000);
});
