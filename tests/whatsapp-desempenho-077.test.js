import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { chaveTelefone, funcaoAusente, LIMITE_POR_MINUTO, LOTE_MAX } from '../supabase/functions/whatsapp/mensagem.ts';

// Migration 077 em Postgres de verdade (PGlite). O que não pode quebrar:
//   * telefone_chave (SQL) e chaveTelefone (TypeScript) dão a mesma chave —
//     senão o índice acha um cliente e a regra do webhook descarta, ou o
//     contrário, e a mensagem cai como sem_cliente sem ninguém entender por quê;
//   * append_pendencia_note não perde nota e respeita o team lido;
//   * só o service_role chama as funções que leem ou gravam dado.

const ler = (rel) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const M077 = ler('../supabase/migrations/077_whatsapp_desempenho.sql');

let db;
const um = async (sql, params) => (await db.query(sql, params)).rows[0];

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
    CREATE TABLE clients (id text PRIMARY KEY, name text, team text, technician text, owner_phone text, responsible_phone text);
    CREATE TABLE pendencias (id text PRIMARY KEY, team text, notes jsonb DEFAULT '[]', updated_at timestamptz);
  `);
  await db.exec(M077);
  await db.exec(M077); // idempotente
}, 60000); // PGlite sobe devagar com as outras suítes em paralelo

beforeEach(async () => {
  await db.exec('DELETE FROM clients; DELETE FROM pendencias;');
});

describe('077: telefone_chave igual à chaveTelefone do webhook', () => {
  const casos = [
    '5511987654321', '551187654321', '11987654321', '1187654321', '(11) 98765-4321', '+55 (11) 9 8765-4321',
    '11 8765-4321', '21999998888', '4321', '', null, '55', '5521', '987654321', 'abc', '0800 123 4567',
    '551199998888777', '+1 415 555 0100',
  ];

  for (const bruto of casos) {
    it(`mesma chave para ${JSON.stringify(bruto)}`, async () => {
      const { chave } = await um('SELECT public.telefone_chave($1) AS chave', [bruto]);
      // O SQL usa NULL onde o TypeScript usa '': os dois significam "não casa".
      expect(chave ?? '').toBe(chaveTelefone(bruto));
    });
  }
});

describe('077: clientes_do_telefone', () => {
  it('acha pelo telefone do dono e do responsável, em qualquer formato', async () => {
    await db.exec(`INSERT INTO clients (id, name, owner_phone, responsible_phone) VALUES
      ('C1', 'Acme', '(11) 98765-4321', NULL),
      ('C2', 'Beta', NULL, '+55 21 9999-8888'),
      ('C3', 'Gama', '31 3333-4444', NULL)`);
    const ids = async (tel) =>
      (await db.query('SELECT id FROM public.clientes_do_telefone(public.telefone_chave($1)) ORDER BY id', [tel])).rows.map((r) => r.id);
    expect(await ids('5511987654321')).toEqual(['C1']);
    expect(await ids('552199998888')).toEqual(['C2']);
    expect(await ids('5541900000000')).toEqual([]);
  });

  it('devolve os dois quando o número está em dois clientes (a ambiguidade é decidida no webhook)', async () => {
    await db.exec(`INSERT INTO clients (id, name, owner_phone, responsible_phone) VALUES
      ('C1', 'Acme', '11 98765-4321', NULL), ('C2', 'Beta', NULL, '11987654321')`);
    const { rows } = await db.query("SELECT id FROM public.clientes_do_telefone('1187654321') ORDER BY id");
    expect(rows.map((r) => r.id)).toEqual(['C1', 'C2']);
  });

  it('chave vazia ou nula não casa com cadastro sem telefone', async () => {
    await db.exec("INSERT INTO clients (id, name) VALUES ('C1', 'Sem fone')");
    expect((await db.query("SELECT * FROM public.clientes_do_telefone('')")).rows).toEqual([]);
    expect((await db.query('SELECT * FROM public.clientes_do_telefone(NULL)')).rows).toEqual([]);
  });

  it('usa os índices de expressão criados pela migration', async () => {
    const { rows } = await db.query("SELECT indexdef FROM pg_indexes WHERE tablename = 'clients' AND indexname LIKE 'clients_%_phone_chave_idx'");
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => /telefone_chave/.test(r.indexdef))).toBe(true);
  });
});

describe('077: append_pendencia_note', () => {
  const notas = async (id) => (await um('SELECT notes FROM pendencias WHERE id = $1', [id])).notes;
  const anexar = async (id, team, nota) =>
    (await um('SELECT public.append_pendencia_note($1, $2, $3::jsonb) AS ok', [id, team, JSON.stringify(nota)])).ok;

  it('soma a nota no fim sem apagar as anteriores e marca updated_at', async () => {
    await db.exec(`INSERT INTO pendencias (id, team, notes) VALUES ('P1', 'init', '[{"text":"a"}]')`);
    expect(await anexar('P1', 'init', { text: 'b' })).toBe(true);
    expect(await anexar('P1', 'init', { text: 'c' })).toBe(true);
    expect((await notas('P1')).map((n) => n.text)).toEqual(['a', 'b', 'c']);
    expect((await um("SELECT updated_at FROM pendencias WHERE id = 'P1'")).updated_at).not.toBeNull();
  });

  it('team diferente do lido não grava (o chamado mudou de equipe no meio)', async () => {
    await db.exec(`INSERT INTO pendencias (id, team) VALUES ('P1', 'suporte')`);
    expect(await anexar('P1', 'init', { text: 'x' })).toBe(false);
    expect(await notas('P1')).toEqual([]);
  });

  it('team nulo casa com team nulo, como o .is("team", null) antigo', async () => {
    await db.exec(`INSERT INTO pendencias (id, team) VALUES ('P1', NULL)`);
    expect(await anexar('P1', null, { text: 'x' })).toBe(true);
    expect(await anexar('P1', 'init', { text: 'y' })).toBe(false);
    expect((await notas('P1')).map((n) => n.text)).toEqual(['x']);
  });

  it('notes que não é array vira lista nova em vez de quebrar', async () => {
    await db.exec(`INSERT INTO pendencias (id, team, notes) VALUES ('P1', 'init', NULL), ('P2', 'init', '"texto antigo"')`);
    expect(await anexar('P1', 'init', { text: 'x' })).toBe(true);
    expect(await anexar('P2', 'init', { text: 'y' })).toBe(true);
    expect(await notas('P1')).toEqual([{ text: 'x' }]);
    expect(await notas('P2')).toEqual([{ text: 'y' }]);
  });

  it('nota que não é objeto é recusada', async () => {
    await db.exec(`INSERT INTO pendencias (id, team) VALUES ('P1', 'init')`);
    expect(await anexar('P1', 'init', 'só texto')).toBe(false);
    expect(await notas('P1')).toEqual([]);
  });

  it('chamado inexistente devolve false', async () => {
    expect(await anexar('NAO-EXISTE', 'init', { text: 'x' })).toBe(false);
  });
});

describe('077: quem pode chamar', () => {
  const pode = async (role, fn) =>
    (await um(`SELECT has_function_privilege($1, p.oid, 'execute') AS ok FROM pg_proc p
                WHERE p.pronamespace = 'public'::regnamespace AND p.proname = $2`, [role, fn])).ok;

  it('clientes_do_telefone e append_pendencia_note só com service_role', async () => {
    for (const fn of ['clientes_do_telefone', 'append_pendencia_note']) {
      expect(await pode('service_role', fn)).toBe(true);
      expect(await pode('authenticated', fn)).toBe(false);
      expect(await pode('anon', fn)).toBe(false);
    }
  });

  it('telefone_chave fica para authenticated (o índice a avalia no insert do app), não para anon', async () => {
    expect(await pode('authenticated', 'telefone_chave')).toBe(true);
    expect(await pode('anon', 'telefone_chave')).toBe(false);
  });
});

describe('webhook com a 077', () => {
  const webhook = ler('../supabase/functions/whatsapp/index.ts');

  it('funcaoAusente só aceita "função não existe", nunca erro de verdade', () => {
    expect(funcaoAusente({ code: 'PGRST202' })).toBe(true);
    expect(funcaoAusente({ code: '42883' })).toBe(true);
    expect(funcaoAusente({ code: '42501' })).toBe(false); // permissão
    expect(funcaoAusente({ code: '57014' })).toBe(false); // timeout
    expect(funcaoAusente(null)).toBe(false);
  });

  it('casa o cliente e anexa a nota pelas funções da 077, com o caminho antigo só como reserva', () => {
    expect(webhook).toMatch(/rpc\("clientes_do_telefone", \{ p_chave: chave \}\)/);
    expect(webhook).toMatch(/rpc\("append_pendencia_note", \{ p_id: aberto\.id, p_team: aberto\.team, p_nota: nota \}\)/);
    expect(webhook.match(/funcaoAusente\(error\)/g)).toHaveLength(2);
  });

  it('o limite por número vem depois da chave de dedupe e antes de tocar caixa ou chamado', () => {
    const dedupe = webhook.indexOf('from("avisos_enviados").insert');
    const limite = webhook.indexOf('recentesDoNumero(db, m.telefone) >= LIMITE_POR_MINUTO');
    const conversa = webhook.indexOf('from("whatsapp_conversas")');
    expect(dedupe).toBeGreaterThan(-1);
    expect(limite).toBeGreaterThan(dedupe);
    expect(conversa).toBeGreaterThan(limite);
  });

  it('chamado que mudou de equipe manda a mensagem para a caixa em vez de perdê-la', () => {
    const bloco = webhook.slice(webhook.indexOf('if (aberto) {'), webhook.indexOf('const c = await clienteDaMensagem'));
    expect(bloco).toMatch(/if \(!anexo\.naoAchou\) \{[\s\S]*continue;/);
    expect(bloco).not.toMatch(/naoAchou\) continue/);
  });

  it('limites com folga para gente e teto para lote', () => {
    expect(LIMITE_POR_MINUTO).toBeGreaterThanOrEqual(20);
    expect(LOTE_MAX).toBeGreaterThan(1);
  });
});
