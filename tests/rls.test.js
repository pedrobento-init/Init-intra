import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// RLS testado em Postgres de verdade (PGlite, em memória): aplica a
// migration 042 sobre tabelas mínimas com as mesmas colunas usadas nas
// regras, já "sujas" com policies abertas antigas, e confere cada perfil.
const MIGRATION = fs.readFileSync(new URL('../supabase/migrations/042_rls_completo.sql', import.meta.url), 'utf8');
const MIGRATION_047 = fs.readFileSync(new URL('../supabase/migrations/047_remove_pin_hash.sql', import.meta.url), 'utf8');

const UID = {
  admin: '00000000-0000-0000-0000-00000000000a',
  ana: '00000000-0000-0000-0000-0000000000a1',   // técnica init
  beto: '00000000-0000-0000-0000-0000000000b1',  // técnico mam
  gil: '00000000-0000-0000-0000-0000000000c1',   // Gestão (init)
  inativo: '00000000-0000-0000-0000-0000000000d1',
  novo: '00000000-0000-0000-0000-0000000000e1',  // 1º login, ainda sem vínculo
  semCadastro: '00000000-0000-0000-0000-0000000000f1',
};

let db;

async function as(who, sql, params) {
  // Cada consulta numa transação com o papel e o JWT do usuário (como o PostgREST faz).
  return db.transaction(async (tx) => {
    if (who === 'anon') {
      await tx.exec('SET LOCAL ROLE anon');
    } else {
      const email = who === 'novo' ? 'novo@init.com' : who + '@init.com';
      await tx.query("SELECT set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)",
        [UID[who], JSON.stringify({ sub: UID[who], email, role: 'authenticated' })]);
      await tx.exec('SET LOCAL ROLE authenticated');
    }
    return tx.query(sql, params || []);
  });
}

const ids = async (who, table) => (await as(who, `SELECT id FROM public.${table} ORDER BY id`)).rows.map((r) => r.id);

async function denied(who, sql, params) {
  try { await as(who, sql, params); return false; } catch (e) { return /row-level security|permission denied/.test(e.message); }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated;

    CREATE TABLE operators (id text PRIMARY KEY, name text, email text, auth_user_id uuid, is_admin boolean DEFAULT false,
      active boolean DEFAULT true, team text DEFAULT 'init', phone text, pin_hash text, pin_salt text, updated_at timestamptz DEFAULT now());
    CREATE TABLE clients (id text PRIMARY KEY, name text, team text DEFAULT 'init');
    CREATE TABLE pendencias (id text PRIMARY KEY, client_id text, team text DEFAULT 'init', tipo text DEFAULT 'tarefa', notes jsonb DEFAULT '[]', responsible text, timer_operator text, updated_at timestamptz DEFAULT now());
    CREATE TABLE visits (id text PRIMARY KEY, team text DEFAULT 'init', operator text, updated_at timestamptz DEFAULT now());
    CREATE TABLE procedures (id text PRIMARY KEY, client_id text, title text);
    CREATE TABLE procedure_templates (id text PRIMARY KEY);
    CREATE TABLE audit_logs (id text PRIMARY KEY, operator_name text, action text);
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
    GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated; -- padrão do Supabase

    -- Estado "sujo" de produção: policies abertas, inclusive com nome inesperado.
    ALTER TABLE equipamentos ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "equipamentos all" ON equipamentos FOR ALL USING (true) WITH CHECK (true);
    ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "clients all" ON clients FOR ALL USING (true) WITH CHECK (true);
    CREATE POLICY "criada no painel" ON clients FOR SELECT USING (true);
    ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "logs_insert" ON audit_logs FOR INSERT TO authenticated WITH CHECK (true);
  `);

  // Dados de antes da migration (procedures ainda sem coluna team).
  await db.exec("INSERT INTO clients VALUES ('c-init', 'Acme', 'init'), ('c-mam', 'Zeta', 'mam'); INSERT INTO procedures (id, client_id, title) VALUES ('pr-init', 'c-init', 'a'), ('pr-mam', 'c-mam', 'b'), ('pr-orfao', 'c-sumiu', 'c');");
  await db.exec(MIGRATION);
  await db.exec(MIGRATION_047);
  // Rodar de novo não pode quebrar (idempotente).
  await db.exec(MIGRATION);

  await db.exec(`
    INSERT INTO operators (id, name, email, auth_user_id, is_admin, is_gestao, active, team) VALUES
      ('op-admin', 'Admin', 'admin@init.com', '${UID.admin}', true, false, true, 'init'),
      ('op-ana', 'Ana', 'ana@init.com', '${UID.ana}', false, false, true, 'init'),
      ('op-beto', 'Beto', 'beto@init.com', '${UID.beto}', false, false, true, 'mam'),
      ('op-gil', 'Gil', 'gil@init.com', '${UID.gil}', false, true, true, 'init'),
      ('op-inativo', 'Ina', 'inativo@init.com', '${UID.inativo}', false, false, false, 'init'),
      ('op-novo', 'Novo', 'novo@init.com', NULL, false, false, true, 'init');
    INSERT INTO pendencias VALUES ('p-init', 'c-init', 'init', 'tarefa'), ('p-mam', 'c-mam', 'mam', 'tarefa'), ('p-gestao', 'c-init', 'init', 'Gestão');
    INSERT INTO visits VALUES ('v-init', 'init'), ('v-mam', 'mam');
    INSERT INTO equipamentos VALUES ('e-init', 'init'), ('e-mam', 'mam');
    INSERT INTO procedures (id, client_id, title, team) VALUES ('kb-init', NULL, 'artigo init', 'init'), ('kb-mam', NULL, 'artigo mam', 'mam');
    INSERT INTO milvus_client_map VALUES ('m-init', 'c-init'), ('m-mam', 'c-mam');
    INSERT INTO checklists VALUES ('ck1');
    INSERT INTO audit_logs VALUES ('l1', 'Ana', 'Criou');
    INSERT INTO email_notifications VALUES ('n1');
    INSERT INTO tickets VALUES ('t1');
  `);
});

describe('anon (chave pública, sem login)', () => {
  it('não lê nem grava nenhuma tabela do app', async () => {
    for (const t of ['clients', 'pendencias', 'visits', 'equipamentos', 'operators', 'procedures', 'audit_logs']) {
      expect(await denied('anon', `SELECT * FROM public.${t}`), t).toBe(true);
    }
    expect(await denied('anon', "INSERT INTO clients (id, name) VALUES ('x', 'x')")).toBe(true);
  });
});

describe('isolamento por equipe', () => {
  it('técnico vê só a própria equipe (policies abertas antigas foram removidas)', async () => {
    expect(await ids('ana', 'clients')).toEqual(['c-init']);
    expect(await ids('ana', 'visits')).toEqual(['v-init']);
    expect(await ids('ana', 'equipamentos')).toEqual(['e-init']);
    expect(await ids('beto', 'clients')).toEqual(['c-mam']);
    expect(await ids('beto', 'milvus_client_map')).toEqual(['m-mam']);
  });

  it('admin vê todas as equipes', async () => {
    expect(await ids('admin', 'clients')).toEqual(['c-init', 'c-mam']);
    // Gestão fica fora até para admin comum (regra da 037).
    expect(await ids('admin', 'pendencias')).toEqual(['p-init', 'p-mam']);
  });

  it('não grava em outra equipe nem "muda" um registro para outra equipe', async () => {
    expect(await denied('ana', "INSERT INTO visits (id, team) VALUES ('v-x', 'mam')")).toBe(true);
    expect(await denied('ana', "UPDATE clients SET team = 'mam' WHERE id = 'c-init'")).toBe(true);
    const r = await as('ana', "UPDATE clients SET name = 'Zeta 2' WHERE id = 'c-mam'");
    expect(r.affectedRows).toBe(0); // invisível: nem acha a linha
  });

  it('cria e edita na própria equipe; excluir é só admin', async () => {
    await as('ana', "INSERT INTO visits (id, team) VALUES ('v-ana', 'init')");
    expect((await as('ana', "UPDATE visits SET team = 'init' WHERE id = 'v-ana'")).affectedRows).toBe(1);
    expect((await as('ana', "DELETE FROM visits WHERE id = 'v-ana'")).affectedRows).toBe(0);
    expect((await as('admin', "DELETE FROM visits WHERE id = 'v-ana'")).affectedRows).toBe(1);
  });

  it('operador inativo e usuário sem cadastro não veem dados', async () => {
    expect(await ids('inativo', 'clients')).toEqual([]);
    expect(await ids('semCadastro', 'clients')).toEqual([]);
    expect(await ids('semCadastro', 'operators')).toEqual([]);
  });
});

describe('Gestão', () => {
  it('pendência tipo Gestão só para is_gestao (nem admin comum)', async () => {
    expect(await ids('ana', 'pendencias')).toEqual(['p-init']);
    expect(await ids('gil', 'pendencias')).toEqual(['p-gestao', 'p-init']);
    expect(await denied('ana', "INSERT INTO pendencias (id, team, tipo) VALUES ('p-x', 'init', 'Gestão')")).toBe(true);
  });
});

describe('procedimentos e base de conhecimento', () => {
  it('com cliente: pela equipe do cliente; órfão só admin; artigo sem cliente pela equipe do artigo', async () => {
    expect(await ids('ana', 'procedures')).toEqual(['kb-init', 'pr-init']);
    expect(await ids('beto', 'procedures')).toEqual(['kb-mam', 'pr-mam']);
    expect(await ids('admin', 'procedures')).toEqual(['kb-init', 'kb-mam', 'pr-init', 'pr-mam', 'pr-orfao']);
    expect(await denied('ana', "INSERT INTO procedures (id, client_id, team) VALUES ('kb-x', NULL, 'mam')")).toBe(true);
    await as('ana', "INSERT INTO procedures (id, client_id, team, title) VALUES ('kb-ana', NULL, 'init', 'novo')");
  });

  it('backfill: procedimento antigo herda a equipe do cliente', async () => {
    const r = await db.query("SELECT team FROM procedures WHERE id = 'pr-mam'");
    expect(r.rows[0].team).toBe('mam');
  });
});

describe('operadores', () => {
  it('técnico não se promove a admin/Gestão nem troca de equipe', async () => {
    await as('ana', "UPDATE operators SET is_admin = true, is_gestao = true, team = 'mam', phone = '9999' WHERE id = 'op-ana'");
    const r = await db.query("SELECT is_admin, is_gestao, team, phone FROM operators WHERE id = 'op-ana'");
    expect(r.rows[0]).toEqual({ is_admin: false, is_gestao: false, team: 'init', phone: '9999' });
  });

  it('não cria operador nem edita o de outra pessoa', async () => {
    expect(await denied('ana', "INSERT INTO operators (id, name, auth_user_id, team) VALUES ('op-fake', 'X', '" + UID.ana + "', 'mam')")).toBe(true);
    expect((await as('ana', "UPDATE operators SET phone = '1' WHERE id = 'op-beto'")).affectedRows).toBe(0);
  });

  it('upsert do próprio perfil (como o app faz) passa', async () => {
    await as('ana', `INSERT INTO operators (id, name, auth_user_id, is_admin, is_gestao, team, phone) VALUES ('op-ana', 'Ana', '${UID.ana}', false, false, 'init', '777')
      ON CONFLICT (id) DO UPDATE SET phone = EXCLUDED.phone`);
    const r = await db.query("SELECT phone FROM operators WHERE id = 'op-ana'");
    expect(r.rows[0].phone).toBe('777');
  });

  it('1º login: vincula o próprio auth_user_id pelo e-mail', async () => {
    const before = await as('novo', "SELECT id FROM operators WHERE email = 'novo@init.com'");
    expect(before.rows.map((x) => x.id)).toEqual(['op-novo']);
    await as('novo', `UPDATE operators SET auth_user_id = '${UID.novo}' WHERE id = 'op-novo'`);
    const r = await db.query("SELECT auth_user_id FROM operators WHERE id = 'op-novo'");
    expect(r.rows[0].auth_user_id).toBe(UID.novo);
  });
});

describe('auditoria e legados', () => {
  it('log só em nome próprio; leitura só admin', async () => {
    await as('ana', "INSERT INTO audit_logs VALUES ('l2', 'Ana', 'Editou')");
    expect(await denied('ana', "INSERT INTO audit_logs VALUES ('l3', 'Beto', 'Forjou')")).toBe(true);
    expect(await ids('ana', 'audit_logs')).toEqual([]);
    expect(await ids('admin', 'audit_logs')).toEqual(['l1', 'l2']);
  });

  it('tickets só admin; email_notifications ninguém pelo app', async () => {
    expect(await ids('ana', 'tickets')).toEqual([]);
    expect(await ids('admin', 'tickets')).toEqual(['t1']);
    expect(await ids('admin', 'email_notifications')).toEqual([]);
  });

  it('checklists: todos leem, só admin escreve', async () => {
    expect(await ids('ana', 'checklists')).toEqual(['ck1']);
    expect(await denied('ana', "INSERT INTO checklists VALUES ('ck2')")).toBe(true);
  });
});

describe('verificação pós-migração (as consultas do fim do arquivo)', () => {
  it('nenhuma policy aberta, nenhuma para anon/PUBLIC', async () => {
    const r = await db.query(`SELECT tablename, policyname FROM pg_policies
      WHERE schemaname = 'public' AND (qual = 'true' OR with_check = 'true' OR NOT (roles @> ARRAY['authenticated']::name[]))`);
    expect(r.rows).toEqual([]);
  });
  it('anon sem nenhum privilégio de tabela', async () => {
    const r = await db.query("SELECT table_name FROM information_schema.role_table_grants WHERE grantee = 'anon' AND table_schema = 'public'");
    expect(r.rows).toEqual([]);
  });
});

describe('hash de senha (047)', () => {
  it('app antigo mandando pin_hash: o banco grava sem o hash', async () => {
    await as('ana', "UPDATE operators SET pin_hash = 'abc', pin_salt = 'xy', phone = '5' WHERE id = 'op-ana'");
    const r = await db.query("SELECT pin_hash, pin_salt, phone FROM operators WHERE id = 'op-ana'");
    expect(r.rows[0]).toEqual({ pin_hash: null, pin_salt: null, phone: '5' });
  });
});

describe('lançamentos de horas (048)', () => {
  beforeAll(async () => {
    const notes = JSON.stringify([
      { text: '⏸ Ana pausou. Tempo sessão: 01:30:00. Total: 01:30:00.', author: 'Ana', createdAt: '2026-10-02T15:00:00Z' },
      { text: 'Sessão registrada: 00:45:00. Total: 02:15:00.', author: 'Ana', createdAt: '2026-10-03T12:00:00Z' },
      { text: 'Conversei com o cliente.', author: 'Ana', createdAt: '2026-10-03T13:00:00Z' },
    ]);
    await db.query("INSERT INTO pendencias (id, client_id, team, tipo, notes) VALUES ('p-horas', 'c-init', 'init', 'tarefa', $1::jsonb)", [notes]);
    const sql = fs.readFileSync(new URL('../supabase/migrations/048_time_entries.sql', import.meta.url), 'utf8');
    await db.exec(sql);
    await db.exec(sql); // idempotente: não duplica
  });

  it('backfill: cada sessão das notas vira um lançamento, com início calculado', async () => {
    const r = await db.query("SELECT seconds, source, operator_id, client_id, started_at, ended_at FROM time_entries WHERE pendencia_id = 'p-horas' ORDER BY ended_at");
    expect(r.rows.map((x) => x.seconds)).toEqual([5400, 2700]);
    expect(r.rows[0]).toMatchObject({ source: 'notas', operator_id: 'op-ana', client_id: 'c-init' });
    expect(new Date(r.rows[0].ended_at) - new Date(r.rows[0].started_at)).toBe(5400 * 1000);
  });

  it('equipe vê; outra equipe não; corrigir só o próprio (ou admin)', async () => {
    expect((await as('ana', "SELECT id FROM time_entries WHERE pendencia_id = 'p-horas'")).rows).toHaveLength(2);
    expect((await as('beto', 'SELECT id FROM time_entries')).rows).toHaveLength(0);
    await as('gil', "INSERT INTO time_entries (id, pendencia_id, operator_id, ended_at, seconds, source, team) VALUES ('te-gil', 'p-horas', 'op-gil', now(), 600, 'manual', 'init')");
    expect((await as('ana', "UPDATE time_entries SET seconds = 1 WHERE id = 'te-gil'")).affectedRows).toBe(0);
    expect((await as('gil', "UPDATE time_entries SET seconds = 900 WHERE id = 'te-gil'")).affectedRows).toBe(1);
    expect((await as('admin', "DELETE FROM time_entries WHERE id = 'te-gil'")).affectedRows).toBe(1);
  });
});

describe('pessoas por id (049)', () => {
  beforeAll(async () => {
    await db.exec("INSERT INTO visits (id, team, operator) VALUES ('v-ana', 'init', 'Ana'), ('v-fantasma', 'init', 'Ninguém')");
    await db.exec("UPDATE pendencias SET responsible = 'Ana', timer_operator = 'Ana' WHERE id = 'p-init'");
    await db.exec(fs.readFileSync(new URL('../supabase/migrations/049_operator_ids.sql', import.meta.url), 'utf8'));
  });

  it('backfill: o id vem do nome; nome desconhecido fica sem id', async () => {
    const v = await db.query("SELECT id, operator_id FROM visits WHERE id IN ('v-ana','v-fantasma') ORDER BY id");
    expect(v.rows).toEqual([{ id: 'v-ana', operator_id: 'op-ana' }, { id: 'v-fantasma', operator_id: null }]);
    const p = await db.query("SELECT responsible_id, timer_operator_id FROM pendencias WHERE id = 'p-init'");
    expect(p.rows[0]).toEqual({ responsible_id: 'op-ana', timer_operator_id: 'op-ana' });
  });

  it('gravação só com o nome (app antigo) ganha o id; trocar o nome troca o id', async () => {
    await as('ana', "INSERT INTO visits (id, team, operator) VALUES ('v-nova', 'init', 'ana ')");
    expect((await db.query("SELECT operator_id FROM visits WHERE id = 'v-nova'")).rows[0].operator_id).toBe('op-ana');
    await as('ana', "UPDATE visits SET operator = 'Gil' WHERE id = 'v-nova'");
    expect((await db.query("SELECT operator_id FROM visits WHERE id = 'v-nova'")).rows[0].operator_id).toBe('op-gil');
  });

  it('renomear o operador reescreve o nome nos registros dele', async () => {
    await db.exec("UPDATE operators SET name = 'Ana Paula' WHERE id = 'op-ana'");
    const v = await db.query("SELECT operator, operator_id FROM visits WHERE id = 'v-ana'");
    expect(v.rows[0]).toEqual({ operator: 'Ana Paula', operator_id: 'op-ana' });
    expect((await db.query("SELECT responsible FROM pendencias WHERE id = 'p-init'")).rows[0].responsible).toBe('Ana Paula');
    await db.exec("UPDATE operators SET name = 'Ana' WHERE id = 'op-ana'");
  });

  it('nome repetido entre ativos é bloqueado', async () => {
    await expect(db.exec("INSERT INTO operators (id, name, team) VALUES ('op-ana2', 'ANA', 'init')")).rejects.toThrow(/unique|duplicate/i);
  });
});
