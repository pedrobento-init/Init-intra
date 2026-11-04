import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

// Migration 079 em Postgres de verdade (PGlite), com RLS ligado e o login
// simulado pelo claim do JWT. O que não pode quebrar:
//   * só o RESPONSÁVEL registra "Visto", uma vez por pessoa;
//   * quem viu sai do login, nunca de um nome mandado pelo app;
//   * o UPDATE passa pelo RLS de quem chamou (outra equipe não grava).

const ler = (rel) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const M078 = ler('../supabase/migrations/078_chamado_status_automatico.sql');
const M079 = ler('../supabase/migrations/079_chamado_visto.sql');

const ANA = '00000000-0000-0000-0000-0000000000a1';
const BETO = '00000000-0000-0000-0000-0000000000b1';
const CAIO = '00000000-0000-0000-0000-0000000000c1'; // outra equipe

let db;

async function como(uid, fn) {
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${uid || ''}', false); SET ROLE authenticated;`);
  try { return await fn(); } finally { await db.exec('RESET ROLE;'); }
}
const ver = (uid, id = 'P1') => como(uid, async () => (await db.query('SELECT public.marcar_chamado_visto($1) AS r', [id])).rows[0].r);
const pen = async (id = 'P1') => (await db.query('SELECT status, responsible, events, updated_at FROM pendencias WHERE id = $1', [id])).rows[0];
const vistos = async (id = 'P1') => (await pen(id)).events.filter((e) => e.type === 'visto');

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
    CREATE SCHEMA cron;
    CREATE TABLE cron.job (jobid serial PRIMARY KEY, jobname text, schedule text, command text, active boolean DEFAULT true);
    CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE sql
      AS $$ INSERT INTO cron.job (jobname, schedule, command) VALUES (n, s, c) RETURNING jobid $$;
    CREATE FUNCTION cron.unschedule(n text) RETURNS boolean LANGUAGE sql
      AS $$ DELETE FROM cron.job WHERE jobname = n RETURNING true $$;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
      AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    CREATE TABLE operators (id text PRIMARY KEY, name text, team text, auth_user_id uuid);
    CREATE FUNCTION public.current_op_id() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
      AS $$ SELECT o.id FROM public.operators o WHERE o.auth_user_id = auth.uid() LIMIT 1 $$;
    CREATE FUNCTION public.current_op_name() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
      AS $$ SELECT o.name FROM public.operators o WHERE o.auth_user_id = auth.uid() LIMIT 1 $$;
    CREATE FUNCTION public.current_op_team() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
      AS $$ SELECT o.team FROM public.operators o WHERE o.auth_user_id = auth.uid() LIMIT 1 $$;
    CREATE TABLE pendencias (
      id text PRIMARY KEY, team text, tipo text, status text DEFAULT 'aberto', canal text, email_thread_id text,
      solicitante_email text, responsible text DEFAULT '', responsible_id text, notes jsonb DEFAULT '[]',
      events jsonb NOT NULL DEFAULT '[]', timer_running boolean DEFAULT false, recurrence text,
      completed_at timestamptz, completed_by text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
    ALTER TABLE pendencias ENABLE ROW LEVEL SECURITY;
    CREATE POLICY pens_select ON pendencias FOR SELECT TO authenticated USING (team = public.current_op_team());
    CREATE POLICY pens_update ON pendencias FOR UPDATE TO authenticated
      USING (team = public.current_op_team()) WITH CHECK (team = public.current_op_team());
    GRANT SELECT, UPDATE ON pendencias TO authenticated;
    INSERT INTO operators VALUES ('OP-A', 'Ana', 'init', '${ANA}'), ('OP-B', 'Beto', 'init', '${BETO}'), ('OP-C', 'Caio', 'mam', '${CAIO}');
  `);
  await db.exec(M078);
  await db.exec(M079);
  await db.exec(M079); // idempotente
}, 60000); // PGlite sobe devagar com as outras suítes em paralelo

beforeEach(async () => {
  await db.exec(`DELETE FROM pendencias;
    INSERT INTO pendencias (id, team, status, canal, responsible, responsible_id, updated_at)
    VALUES ('P1', 'init', 'aberto', 'email', 'Ana', 'OP-A', '2026-11-01T10:00:00Z');`);
});

describe('079: marcar_chamado_visto', () => {
  it('a primeira abertura pelo responsável grava o Visto com o nome do login', async () => {
    const r = await ver(ANA);
    const [v] = await vistos();
    expect(v).toMatchObject({ type: 'visto', by: 'Ana', by_id: 'OP-A' });
    expect(v.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    // O app aplica o que voltou: os eventos do banco e o updated_at novo (LWW).
    expect(r.events).toEqual((await pen()).events);
    expect(Date.parse(r.updated_at)).toBeGreaterThan(Date.parse('2026-11-01T10:00:00Z'));
  });

  it('abrir de novo não duplica nem mexe no updated_at', async () => {
    await ver(ANA);
    const antes = (await pen()).updated_at;
    expect(await ver(ANA)).toBeNull();
    expect(await vistos()).toHaveLength(1);
    expect((await pen()).updated_at).toEqual(antes);
  });

  it('quem não é o responsável só olha: nada é gravado', async () => {
    expect(await ver(BETO)).toBeNull();
    expect(await vistos()).toEqual([]);
  });

  it('depois de transferido, a primeira abertura do novo responsável também entra', async () => {
    await ver(ANA);
    await db.exec(`UPDATE pendencias SET responsible = 'Beto', responsible_id = 'OP-B' WHERE id = 'P1'`);
    await ver(BETO);
    expect((await vistos()).map((v) => v.by)).toEqual(['Ana', 'Beto']);
  });

  it('RLS vale: responsável de outra equipe no registro não grava', async () => {
    await db.exec(`UPDATE pendencias SET responsible = 'Caio', responsible_id = 'OP-C' WHERE id = 'P1'`);
    expect(await ver(CAIO)).toBeNull();
    expect(await vistos()).toEqual([]);
  });

  it('sem login não grava', async () => {
    expect(await ver(null)).toBeNull();
    expect(await vistos()).toEqual([]);
  });

  it('não muda o status nem os outros eventos', async () => {
    await db.exec(`UPDATE pendencias SET events = '[{"at":"2026-11-01T10:00:00.000Z","by":"Ana","type":"criado","de":null,"para":"aberto"}]' WHERE id = 'P1'`);
    await ver(ANA);
    const p = await pen();
    expect(p.status).toBe('aberto');
    expect(p.events.map((e) => e.type)).toEqual(['criado', 'visto']);
  });

  it('anon não executa', async () => {
    const { rows } = await db.query(`SELECT has_function_privilege('anon', 'public.marcar_chamado_visto(text)', 'execute') AS ok`);
    expect(rows[0].ok).toBe(false);
  });
});
