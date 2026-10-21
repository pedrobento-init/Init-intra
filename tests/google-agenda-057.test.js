import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// Migration 057 em Postgres de verdade (PGlite): o trigger de visits põe na
// fila do robô só o que aparece na agenda, nunca o que a própria sincronização
// grava (google_hash), e nunca impede a visita de ser salva.
const M057 = fs.readFileSync(new URL('../supabase/migrations/057_google_agenda.sql', import.meta.url), 'utf8');

let db;
const fila = async () => (await db.query('SELECT visit_id, old_operator_id, old_operator FROM google_agenda_queue ORDER BY seq')).rows;

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
  await db.exec(M057); // idempotente
  await db.exec(`INSERT INTO operators VALUES
    ('OP-1', 'Ana', 'ana@empresa.com', '00000000-0000-0000-0000-0000000000a1'),
    ('OP-2', 'Beto', NULL, '00000000-0000-0000-0000-0000000000b1');`);
}, 60000); // PGlite sobe devagar com as outras suítes em paralelo

beforeEach(async () => {
  await db.exec(`DELETE FROM google_agenda_runner; DELETE FROM visits; DELETE FROM google_agenda_queue;
    DELETE FROM google_agenda_calendars; INSERT INTO google_agenda_runner (email) VALUES ('agenda@empresa.com');`);
});

describe('057: fila do robô da agenda Google', () => {
  it('criar, mudar horário/técnico e excluir entram na fila com o técnico antigo', async () => {
    await db.exec(`INSERT INTO visits (id, operator, operator_id, date, "time", status) VALUES ('VIS-1', 'Ana', 'OP-1', '2026-10-20', '09:00', 'agendada')`);
    await db.exec(`UPDATE visits SET "time" = '10:00', operator = 'Beto', operator_id = 'OP-2' WHERE id = 'VIS-1'`);
    await db.exec(`DELETE FROM visits WHERE id = 'VIS-1'`);
    expect(await fila()).toEqual([
      { visit_id: 'VIS-1', old_operator_id: null, old_operator: null },
      { visit_id: 'VIS-1', old_operator_id: 'OP-1', old_operator: 'Ana' },
      { visit_id: 'VIS-1', old_operator_id: 'OP-2', old_operator: 'Beto' },
    ]);
  });

  it('gravar só google_hash, updated_at ou relatório não entra (sem loop)', async () => {
    await db.exec(`INSERT INTO visits (id, operator_id, date, status) VALUES ('VIS-2', 'OP-1', '2026-10-20', 'agendada')`);
    await db.exec('DELETE FROM google_agenda_queue');
    await db.exec(`UPDATE visits SET google_hash = 'abc', updated_at = now(), relatorio = 'ok' WHERE id = 'VIS-2'`);
    await db.exec(`UPDATE visits SET "time" = NULL WHERE id = 'VIS-2'`); // NULL → NULL
    expect(await fila()).toEqual([]);
  });

  it('robô não instalado: fila não cresce, e a visita salva', async () => {
    await db.exec('DELETE FROM google_agenda_runner');
    await db.exec(`INSERT INTO visits (id, date) VALUES ('VIS-3', '2026-10-20')`);
    expect(await fila()).toEqual([]);
    expect((await db.query(`SELECT id FROM visits WHERE id = 'VIS-3'`)).rows).toHaveLength(1);
  });

  it('app não lê as tabelas do robô; só o próprio estado pela RPC', async () => {
    for (const t of ['google_agenda_queue', 'google_agenda_calendars', 'google_agenda_runner']) {
      const g = await db.query(`SELECT has_table_privilege('authenticated', '${t}', 'SELECT') AS ok`);
      expect(g.rows[0].ok).toBe(false);
    }
    await db.exec(`INSERT INTO google_agenda_calendars (operator_id, calendar_id, ok, last_error) VALUES ('OP-1', 'ana@empresa.com', false, 'Agenda não compartilhada')`);
    await db.exec(`SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1'`);
    const ana = (await db.query('SELECT my_google_agenda_status() AS s')).rows[0].s;
    expect(ana).toMatchObject({ runner_email: 'agenda@empresa.com', my_email: 'ana@empresa.com', ok: false, error: 'Agenda não compartilhada' });
    await db.exec(`SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1'`);
    const beto = (await db.query('SELECT my_google_agenda_status() AS s')).rows[0].s;
    expect(beto).toMatchObject({ my_email: null, ok: false, error: null });
    await db.exec(`RESET request.jwt.claim.sub`);
  });
});
