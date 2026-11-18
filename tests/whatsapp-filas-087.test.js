import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

// Migration 087 em Postgres de verdade (PGlite). O que não pode quebrar:
//   * "Pegar próximo" entrega a conversa mais antiga da fila, uma vez só: o
//     segundo operador nunca pega a mesma (a trava por conversa está na
//     função; aqui, com uma conexão só, o que dá para provar é a sequência e o
//     update condicional);
//   * a RLS por equipe vale dentro das funções (SECURITY INVOKER);
//   * configuração e atendentes só o admin grava; o ping grava só a linha de
//     quem chamou.

const ler = (rel) =>
  fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const M087 = ler('../supabase/migrations/087_whatsapp_filas.sql');

const UID = {
  admin: '00000000-0000-0000-0000-0000000000a0',
  ana: '00000000-0000-0000-0000-0000000000a1',
  bia: '00000000-0000-0000-0000-0000000000a2',
  beto: '00000000-0000-0000-0000-0000000000b1',
};

let db;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    CREATE TABLE operators (id text PRIMARY KEY, name text, auth_user_id uuid, is_admin boolean DEFAULT false,
      active boolean DEFAULT true, team text DEFAULT 'init');
    CREATE FUNCTION current_op_is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
      AS $$ SELECT EXISTS (SELECT 1 FROM operators o WHERE o.auth_user_id = auth.uid() AND o.is_admin AND COALESCE(o.active, true)) $$;
    CREATE FUNCTION current_op_team() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
      AS $$ SELECT o.team FROM operators o WHERE o.auth_user_id = auth.uid() AND COALESCE(o.active, true) LIMIT 1 $$;
    CREATE FUNCTION current_op_name() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
      AS $$ SELECT o.name FROM operators o WHERE o.auth_user_id = auth.uid() LIMIT 1 $$;
    GRANT EXECUTE ON FUNCTION current_op_is_admin(), current_op_team(), current_op_name() TO authenticated;

    -- emails_triagem como as migrations 066/073/075/082 a deixam (só o que a 087 usa).
    CREATE TABLE emails_triagem (
      id text PRIMARY KEY, team text NOT NULL DEFAULT 'init', canal text, telefone text,
      direcao text, status text NOT NULL DEFAULT 'pendente', atribuido_a text, atribuido_em timestamptz,
      atribuicao_nota text, recebido_em timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now());
    ALTER TABLE emails_triagem ENABLE ROW LEVEL SECURITY;
    GRANT SELECT, INSERT, UPDATE, DELETE ON emails_triagem TO authenticated;
    CREATE POLICY emails_triagem_select ON emails_triagem FOR SELECT TO authenticated
      USING ((SELECT current_op_is_admin()) OR COALESCE(team, 'init') = (SELECT current_op_team()));
    CREATE POLICY emails_triagem_update ON emails_triagem FOR UPDATE TO authenticated
      USING ((SELECT current_op_is_admin()) OR COALESCE(team, 'init') = (SELECT current_op_team()))
      WITH CHECK ((SELECT current_op_is_admin()) OR COALESCE(team, 'init') = (SELECT current_op_team()));

    INSERT INTO operators (id, name, auth_user_id, is_admin, team) VALUES
      ('op-admin', 'Admin', '${UID.admin}', true, 'init'),
      ('op-ana', 'Ana', '${UID.ana}', false, 'init'),
      ('op-bia', 'Bia', '${UID.bia}', false, 'init'),
      ('op-beto', 'Beto', '${UID.beto}', false, 'mam');
  `);
  await db.exec(M087);
  await db.exec(M087); // idempotente
}, 60000);

beforeEach(async () => {
  await db.exec(
    'DELETE FROM emails_triagem; DELETE FROM whatsapp_atendentes; DELETE FROM whatsapp_filas_config;'
  );
});

// Roda como o PostgREST: papel + JWT na transação.
async function como(quem, sql, params) {
  let out;
  await db.transaction(async (tx) => {
    if (quem === 'anon') await tx.exec('SET LOCAL ROLE anon');
    else {
      await tx.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [UID[quem]]);
      await tx.exec('SET LOCAL ROLE authenticated');
    }
    out = await tx.query(sql, params);
  });
  return out.rows;
}

async function falha(quem, sql, params) {
  try {
    await como(quem, sql, params);
    return null;
  } catch (e) {
    return e.message;
  }
}

// Uma mensagem do cliente. `min` = minutos atrás.
function msg(id, telefone, min, extra = {}) {
  const linha = {
    id,
    team: 'init',
    canal: 'whatsapp',
    telefone,
    direcao: 'entrada',
    status: 'pendente',
    atribuido_a: null,
    departamento: null,
    recebido_em: new Date(Date.now() - min * 60_000).toISOString(),
    ...extra,
  };
  const cols = Object.keys(linha);
  return db.query(
    `INSERT INTO emails_triagem (${cols.join(', ')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(', ')})`,
    cols.map((c) => linha[c])
  );
}

const pegar = async (quem, dep = null, team = null) =>
  (await como(quem, 'SELECT whatsapp_pegar_proximo($1, $2) AS tel', [dep, team]))[0].tel;

const donos = async (telefone) =>
  (
    await db.query('SELECT id, atribuido_a FROM emails_triagem WHERE telefone = $1 ORDER BY id', [
      telefone,
    ])
  ).rows.map((r) => [r.id, r.atribuido_a]);

describe('087: whatsapp_pegar_proximo', () => {
  it('entrega a conversa mais antiga da fila e grava o nome em todas as mensagens abertas dela', async () => {
    await msg('a1', '5511900000001', 10);
    await msg('a2', '5511900000001', 2);
    await msg('b1', '5511900000002', 30);
    expect(await pegar('ana')).toBe('5511900000002');
    expect(await donos('5511900000002')).toEqual([['b1', 'Ana']]);
    expect(await donos('5511900000001')).toEqual([
      ['a1', null],
      ['a2', null],
    ]);
  });

  it('dois operadores em sequência nunca pegam a mesma conversa', async () => {
    await msg('a1', '5511900000001', 10);
    await msg('b1', '5511900000002', 30);
    const primeiro = await pegar('ana');
    const segundo = await pegar('bia');
    expect(primeiro).toBe('5511900000002');
    expect(segundo).toBe('5511900000001');
    expect(await pegar('ana')).toBeNull();
  });

  it('fila vazia devolve NULL e não mexe em nada', async () => {
    await msg('a1', '5511900000001', 10, { atribuido_a: 'Bia' });
    expect(await pegar('ana')).toBeNull();
    expect(await donos('5511900000001')).toEqual([['a1', 'Bia']]);
  });

  it('conversa com responsável aberto não está na fila, mesmo com mensagem nova sem nome', async () => {
    await msg('a1', '5511900000001', 10, { atribuido_a: 'Bia', status: 'anexado' });
    await msg('a2', '5511900000001', 1);
    expect(await pegar('ana')).toBeNull();
  });

  it('conversa encerrada fecha o ciclo: a mensagem nova volta para a fila e o histórico fica com quem atendeu', async () => {
    await msg('a1', '5511900000001', 600, { atribuido_a: 'Bia', status: 'encerrado' });
    await msg('a2', '5511900000001', 1);
    expect(await pegar('ana')).toBe('5511900000001');
    expect(await donos('5511900000001')).toEqual([
      ['a1', 'Bia'],
      ['a2', 'Ana'],
    ]);
  });

  it('respeita a equipe: operador de outra equipe não enxerga nem pega', async () => {
    await msg('a1', '5511900000001', 10);
    expect(await pegar('beto')).toBeNull();
    // nem passando a equipe alheia de propósito
    expect(await pegar('beto', null, 'init')).toBeNull();
    expect(await donos('5511900000001')).toEqual([['a1', null]]);
  });

  it('com departamento, pega só daquela fila', async () => {
    await msg('s1', '5511900000001', 30, { departamento: 'suporte' });
    await msg('c1', '5511900000002', 10, { departamento: 'comercial' });
    expect(await pegar('ana', 'comercial')).toBe('5511900000002');
  });

  it('sem departamento, usa os do atendente e inclui conversa sem departamento', async () => {
    await db.exec(
      "INSERT INTO whatsapp_atendentes (team, operador, departamentos) VALUES ('init', 'Ana', '{suporte}')"
    );
    await msg('c1', '5511900000002', 60, { departamento: 'comercial' });
    await msg('n1', '5511900000003', 30);
    await msg('s1', '5511900000001', 10, { departamento: 'suporte' });
    expect(await pegar('ana')).toBe('5511900000003');
    expect(await pegar('ana')).toBe('5511900000001');
    expect(await pegar('ana')).toBeNull(); // a de comercial não é dela
    expect(await pegar('bia')).toBe('5511900000002'); // Bia sem linha = todas
  });

  it('recusa departamento que não existe', async () => {
    expect(await falha('ana', "SELECT whatsapp_pegar_proximo('financeiro')")).toMatch(
      /departamento inválido/
    );
  });

  it('anon não executa', async () => {
    expect(await falha('anon', 'SELECT whatsapp_pegar_proximo()')).toMatch(/permission denied/);
  });
});

describe('087: whatsapp_atribuir_se_livre', () => {
  it('atribui conversa livre e recusa a que já tem responsável aberto', async () => {
    await msg('a1', '5511900000001', 10);
    const atribuir = (op) =>
      db
        .query("SELECT whatsapp_atribuir_se_livre('init', '5511900000001', $1) AS ok", [op])
        .then((r) => r.rows[0].ok);
    expect(await atribuir('Ana')).toBe(true);
    expect(await atribuir('Bia')).toBe(false);
    expect(await donos('5511900000001')).toEqual([['a1', 'Ana']]);
  });

  it('serializa por conversa com trava de transação (a garantia contra dois cliques juntos)', () => {
    expect(M087).toMatch(/pg_advisory_xact_lock\(\s*hashtextextended\(/);
    expect(M087).toMatch(/whatsapp_pegar_proximo[\s\S]*security invoker/);
    expect(M087).toMatch(/whatsapp_atribuir_se_livre\([\s\S]*?security invoker/);
  });
});

describe('087: configuração e atendentes', () => {
  it('só admin grava a configuração da equipe; o operador lê a da própria equipe', async () => {
    expect(
      await falha(
        'ana',
        "INSERT INTO whatsapp_filas_config (team, rodizio_ativo) VALUES ('init', true)"
      )
    ).toMatch(/row-level security/);
    await como(
      'admin',
      "INSERT INTO whatsapp_filas_config (team, rodizio_ativo) VALUES ('init', true)"
    );
    expect(await como('ana', 'SELECT team, rodizio_ativo FROM whatsapp_filas_config')).toEqual([
      { team: 'init', rodizio_ativo: true },
    ]);
    expect(await como('beto', 'SELECT team FROM whatsapp_filas_config')).toEqual([]);
  });

  it('limite fora de 1..100 é recusado', async () => {
    expect(
      await falha(
        'admin',
        "INSERT INTO whatsapp_filas_config (team, limite_simultaneo) VALUES ('init', 0)"
      )
    ).toMatch(/check/i);
  });

  it('operador não se coloca no rodízio sozinho', async () => {
    expect(
      await falha(
        'ana',
        "INSERT INTO whatsapp_atendentes (team, operador, recebe_rodizio) VALUES ('init', 'Ana', true)"
      )
    ).toMatch(/row-level security/);
  });

  it('o ping grava só a linha de quem chamou, fora do rodízio até o admin marcar', async () => {
    await como('ana', 'SELECT whatsapp_atendente_ping(true)');
    const [linha] = (await db.query('SELECT * FROM whatsapp_atendentes')).rows;
    expect(linha).toMatchObject({
      team: 'init',
      operador: 'Ana',
      disponivel: true,
      recebe_rodizio: false,
    });
    expect(linha.visto_em).not.toBeNull();
    // o admin marca; o ping seguinte não desfaz a configuração
    await como(
      'admin',
      "UPDATE whatsapp_atendentes SET recebe_rodizio = true, departamentos = '{comercial}' WHERE operador = 'Ana'"
    );
    await como('ana', 'SELECT whatsapp_atendente_ping(false)');
    expect((await db.query('SELECT * FROM whatsapp_atendentes')).rows[0]).toMatchObject({
      disponivel: false,
      recebe_rodizio: true,
      departamentos: ['comercial'],
    });
  });

  it('departamento fora da lista é recusado na mensagem e no atendente', async () => {
    await expect(msg('x1', '5511900000009', 1, { departamento: 'financeiro' })).rejects.toThrow(
      /check/i
    );
    await expect(
      db.query(
        "INSERT INTO whatsapp_atendentes (team, operador, departamentos) VALUES ('init', 'X', '{financeiro}')"
      )
    ).rejects.toThrow(/check/i);
  });
});
