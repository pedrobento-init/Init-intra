import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// Migration 081 (agenda compartilhada) em Postgres de verdade (PGlite),
// por cima da 057. O que ela promete:
// - visits.google_hash_shared existe e gravá-la NÃO põe a visita na fila do
//   robô (o trigger da 057 compara uma lista fixa de campos — senão cada
//   confirmação de envio reenfileirava a própria visita, num loop);
// - google_agenda_shared é invisível para o app (só service_role);
// - my_google_agenda_status() passa a trazer shared_ok/shared_error.
const M057 = fs.readFileSync(new URL('../supabase/migrations/057_google_agenda.sql', import.meta.url), 'utf8');
const M081 = fs.readFileSync(new URL('../supabase/migrations/081_agenda_compartilhada.sql', import.meta.url), 'utf8');

let db;
const fila = async () => (await db.query('SELECT visit_id FROM google_agenda_queue ORDER BY seq')).rows;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE TABLE operators (id text PRIMARY KEY, name text, email text, auth_user_id uuid, active boolean DEFAULT true);
    CREATE FUNCTION current_op_id() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
      AS $$ SELECT o.id FROM operators o WHERE o.auth_user_id = auth.uid() LIMIT 1 $$;
    CREATE TABLE visits (id text PRIMARY KEY, client_name text, operator text, operator_id text, date date, "time" time,
      time_end time, all_day boolean DEFAULT false, motivo text, observacoes text, status text, numero integer,
      relatorio text, updated_at timestamptz DEFAULT now());
  `);
  await db.exec(M057);
  await db.exec(M081);
  await db.exec(M081); // idempotente
  await db.exec(`INSERT INTO operators VALUES
    ('OP-1', 'Ana', 'ana@empresa.com', '00000000-0000-0000-0000-0000000000a1');`);
}, 60000); // PGlite sobe devagar com as outras suítes em paralelo

beforeEach(async () => {
  await db.exec(`DELETE FROM google_agenda_runner; DELETE FROM visits; DELETE FROM google_agenda_queue;
    DELETE FROM google_agenda_calendars; DELETE FROM google_agenda_shared;
    INSERT INTO google_agenda_runner (email) VALUES ('agenda@empresa.com');`);
});

describe('081: agenda compartilhada', () => {
  it('gravar só google_hash_shared não entra na fila (sem loop)', async () => {
    await db.exec(`INSERT INTO visits (id, operator_id, date, status) VALUES ('VIS-1', 'OP-1', '2026-10-20', 'agendada')`);
    await db.exec('DELETE FROM google_agenda_queue');
    await db.exec(`UPDATE visits SET google_hash_shared = 'abc', updated_at = now() WHERE id = 'VIS-1'`);
    expect(await fila()).toEqual([]);
  });

  it('mudança de verdade continua entrando na fila', async () => {
    await db.exec(`INSERT INTO visits (id, operator_id, date, status) VALUES ('VIS-2', 'OP-1', '2026-10-20', 'agendada')`);
    await db.exec('DELETE FROM google_agenda_queue');
    await db.exec(`UPDATE visits SET "time" = '10:00', google_hash_shared = 'abc' WHERE id = 'VIS-2'`);
    expect(await fila()).toEqual([{ visit_id: 'VIS-2' }]);
  });

  it('app não lê google_agenda_shared; o estado vem pela RPC', async () => {
    const g = await db.query(`SELECT has_table_privilege('authenticated', 'google_agenda_shared', 'SELECT') AS ok`);
    expect(g.rows[0].ok).toBe(false);
    await db.exec(`INSERT INTO google_agenda_shared (calendar_id, ok, last_error) VALUES ('c_x@group.calendar.google.com', false, 'Agenda não compartilhada')`);
    await db.exec(`SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1'`);
    const ana = (await db.query('SELECT my_google_agenda_status() AS s')).rows[0].s;
    expect(ana).toMatchObject({ shared_ok: false, shared_error: 'Agenda não compartilhada' });
    await db.exec(`RESET request.jwt.claim.sub`);
  });

  it('sem linha na google_agenda_shared, shared_ok vem nulo (não configurada)', async () => {
    await db.exec(`SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1'`);
    const ana = (await db.query('SELECT my_google_agenda_status() AS s')).rows[0].s;
    expect(ana.shared_ok).toBeNull();
    expect(ana.shared_error).toBeNull();
    await db.exec(`RESET request.jwt.claim.sub`);
  });
});
