import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

// Migration 078 em Postgres de verdade (PGlite). O que não pode quebrar:
//   * resposta do cliente tira o chamado de Aguard. Cliente / Pausado, e só a
//     resposta NOVA do cliente — nota da equipe ou array regravado não conta;
//   * a rodada de 7 dias só pega chamado (canal externo), nunca projeto, nunca
//     cronômetro ligado, nunca recorrente que o banco não sabe regerar;
//   * toda mudança automática deixa evento com motivo na linha do tempo.

const ler = (rel) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const M078 = ler('../supabase/migrations/078_chamado_status_automatico.sql');

const AGORA = '2026-11-04T12:00:00Z';
const DIAS_ATRAS = (d) => new Date(Date.parse(AGORA) - d * 86400000).toISOString();

let db;
const um = async (sql, params) => (await db.query(sql, params)).rows[0];
const pen = (id) => um('SELECT status, events, completed_at, completed_by FROM pendencias WHERE id = $1', [id]);

async function inserir(p) {
  const c = {
    id: 'P1', status: 'aguardando_cliente', canal: 'email', email_thread_id: null, solicitante_email: 'cli@acme.com.br',
    responsible: 'Ana', notes: [], events: [], timer_running: false, recurrence: null, created_at: DIAS_ATRAS(30), ...p,
  };
  await db.query(
    `INSERT INTO pendencias (id, team, status, canal, email_thread_id, solicitante_email, responsible, notes, events,
       timer_running, recurrence, created_at, updated_at)
     VALUES ($1, 'init', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)`,
    [c.id, c.status, c.canal, c.email_thread_id, c.solicitante_email, c.responsible, JSON.stringify(c.notes),
      JSON.stringify(c.events), c.timer_running, c.recurrence, c.created_at],
  );
}

const notaCliente = (at = AGORA) => ({ text: 'segue o print', author: 'Márcia', createdAt: at, visibility: 'solicitante' });
const notaEquipe = (at = AGORA, vis = 'resposta') => ({ text: 'verificando', author: 'Ana', createdAt: at, visibility: vis });

// A mesma forma de gravar do robô e do webhook: lê o array, soma a nota, regrava.
async function anexar(id, nota) {
  await db.query(`UPDATE pendencias SET notes = notes || $2::jsonb, updated_at = now() WHERE id = $1`, [id, JSON.stringify([nota])]);
}

const rodar = async (agora = AGORA) =>
  (await db.query('SELECT * FROM public.chamados_sem_interacao($1::timestamptz) ORDER BY id', [agora])).rows;

beforeAll(async () => {
  db = new PGlite();
  // pg_cron não existe no PGlite: o esquema mínimo que a migration usa.
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
    CREATE SCHEMA cron;
    CREATE TABLE cron.job (jobid serial PRIMARY KEY, jobname text, schedule text, command text, active boolean DEFAULT true);
    CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE sql
      AS $$ INSERT INTO cron.job (jobname, schedule, command) VALUES (n, s, c) RETURNING jobid $$;
    CREATE FUNCTION cron.unschedule(n text) RETURNS boolean LANGUAGE sql
      AS $$ DELETE FROM cron.job WHERE jobname = n RETURNING true $$;
    CREATE TABLE pendencias (
      id text PRIMARY KEY, team text, status text DEFAULT 'aberto', canal text, email_thread_id text,
      solicitante_email text, responsible text DEFAULT '', notes jsonb DEFAULT '[]', events jsonb NOT NULL DEFAULT '[]',
      timer_running boolean DEFAULT false, recurrence text, completed_at timestamptz, completed_by text,
      created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
  `);
  await db.exec(M078);
  await db.exec(M078); // idempotente
}, 60000); // PGlite sobe devagar com as outras suítes em paralelo

beforeEach(async () => {
  await db.exec('DELETE FROM pendencias;');
});

describe('078: resposta do cliente devolve o chamado para a equipe', () => {
  it('Aguard. Cliente vira Em Andamento quando chega mensagem do cliente', async () => {
    await inserir({ status: 'aguardando_cliente' });
    await anexar('P1', notaCliente());
    const p = await pen('P1');
    expect(p.status).toBe('em_andamento');
    expect(p.events).toHaveLength(1);
    expect(p.events[0]).toMatchObject({ by: 'Sistema', type: 'status', de: 'aguardando_cliente', para: 'em_andamento', motivo: 'Cliente respondeu' });
    // Mesmo formato do toISOString() do app: a linha do tempo ordena por instante.
    expect(p.events[0].at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('Pausado também volta para Em Andamento', async () => {
    await inserir({ status: 'pausado' });
    await anexar('P1', notaCliente());
    expect((await pen('P1')).status).toBe('em_andamento');
  });

  for (const status of ['aberto', 'em_andamento', 'aguardando', 'resolvido', 'cancelado']) {
    it(`não mexe em chamado ${status}`, async () => {
      await inserir({ status });
      await anexar('P1', notaCliente());
      const p = await pen('P1');
      expect(p.status).toBe(status);
      expect(p.events).toEqual([]);
    });
  }

  it('resposta ou anotação da equipe não conta como retorno do cliente', async () => {
    await inserir({ status: 'aguardando_cliente' });
    await anexar('P1', notaEquipe(AGORA, 'resposta'));
    await anexar('P1', notaEquipe(AGORA, 'interna'));
    expect((await pen('P1')).status).toBe('aguardando_cliente');
  });

  it('regravar o array com a mesma nota antiga do cliente não é resposta nova', async () => {
    await inserir({ status: 'aguardando_cliente', notes: [notaCliente(DIAS_ATRAS(3)), notaEquipe(DIAS_ATRAS(2))] });
    // O app sobe o registro inteiro (savePendencia): notes vai igual, só muda outro campo.
    await db.query(`UPDATE pendencias SET notes = notes, responsible = 'Beto' WHERE id = 'P1'`);
    expect((await pen('P1')).status).toBe('aguardando_cliente');
  });

  it('se a mesma gravação já muda o status, vale o que quem gravou escolheu', async () => {
    await inserir({ status: 'aguardando_cliente' });
    await db.query(`UPDATE pendencias SET notes = notes || $1::jsonb, status = 'resolvido' WHERE id = 'P1'`, [JSON.stringify([notaCliente()])]);
    const p = await pen('P1');
    expect(p.status).toBe('resolvido');
    expect(p.events).toEqual([]);
  });

  it('linha do tempo não passa do teto de 200 eventos e guarda os mais novos', async () => {
    const antigos = Array.from({ length: 200 }, (_, i) => ({ at: DIAS_ATRAS(10), by: 'Ana', type: 'prazo', de: null, para: String(i) }));
    await inserir({ status: 'aguardando_cliente', events: antigos });
    await anexar('P1', notaCliente());
    const { events } = await pen('P1');
    expect(events).toHaveLength(200);
    expect(events[0].para).toBe('1');
    expect(events[199].motivo).toBe('Cliente respondeu');
  });
});

describe('078: 7 dias sem interação', () => {
  it('Aguard. Cliente sem retorno vira Resolvido, com quem e quando concluiu', async () => {
    await inserir({ status: 'aguardando_cliente', notes: [notaEquipe(DIAS_ATRAS(8))] });
    expect(await rodar()).toEqual([{ id: 'P1', de: 'aguardando_cliente', para: 'resolvido' }]);
    const p = await pen('P1');
    expect(p.status).toBe('resolvido');
    expect(new Date(p.completed_at).toISOString()).toBe(new Date(AGORA).toISOString());
    expect(p.completed_by).toBe('Ana');
    expect(p.events.at(-1)).toMatchObject({ by: 'Sistema', de: 'aguardando_cliente', para: 'resolvido', motivo: 'Sem retorno do cliente em 7 dias' });
  });

  it('Em Andamento parado vira Pausado', async () => {
    await inserir({ status: 'em_andamento', notes: [notaEquipe(DIAS_ATRAS(9))] });
    expect(await rodar()).toEqual([{ id: 'P1', de: 'em_andamento', para: 'pausado' }]);
    const p = await pen('P1');
    expect(p.status).toBe('pausado');
    expect(p.completed_at).toBeNull();
    expect(p.events.at(-1).motivo).toBe('Sem interação em 7 dias');
  });

  it('6 dias ainda não é parado', async () => {
    await inserir({ status: 'em_andamento', notes: [notaEquipe(DIAS_ATRAS(6))] });
    expect(await rodar()).toEqual([]);
  });

  it('nota recente de qualquer lado conta como interação', async () => {
    await inserir({ id: 'P1', status: 'em_andamento', notes: [notaEquipe(DIAS_ATRAS(20)), notaCliente(DIAS_ATRAS(2))] });
    await inserir({ id: 'P2', status: 'aguardando_cliente', notes: [notaEquipe(DIAS_ATRAS(3), 'interna')] });
    expect(await rodar()).toEqual([]);
  });

  it('evento recente conta como interação: pedir informação reinicia o prazo', async () => {
    await inserir({
      status: 'aguardando_cliente', notes: [notaEquipe(DIAS_ATRAS(20))],
      events: [{ at: DIAS_ATRAS(1), by: 'Ana', type: 'status', de: 'em_andamento', para: 'aguardando_cliente' }],
    });
    expect(await rodar()).toEqual([]);
  });

  it('abrir o chamado (evento visto) não é atender: não segura a pausa', async () => {
    await inserir({ status: 'em_andamento', notes: [notaEquipe(DIAS_ATRAS(9))], events: [{ at: DIAS_ATRAS(1), by: 'Ana', type: 'visto' }] });
    expect(await rodar()).toEqual([{ id: 'P1', de: 'em_andamento', para: 'pausado' }]);
  });

  it('chamado recém-aberto sem nota nenhuma não é parado', async () => {
    await inserir({ status: 'em_andamento', created_at: DIAS_ATRAS(2) });
    expect(await rodar()).toEqual([]);
  });

  it('projeto ou tarefa interna (sem canal) fica de fora', async () => {
    await inserir({ status: 'em_andamento', canal: '', solicitante_email: null });
    expect(await rodar()).toEqual([]);
    expect((await pen('P1')).status).toBe('em_andamento');
  });

  it('chamado de WhatsApp antigo, sem canal preenchido, entra pela thread', async () => {
    await inserir({ status: 'em_andamento', canal: null, solicitante_email: null, email_thread_id: 'whatsapp:5511987654321' });
    expect(await rodar()).toEqual([{ id: 'P1', de: 'em_andamento', para: 'pausado' }]);
  });

  it('cronômetro ligado é trabalho em curso: não pausa nem resolve', async () => {
    await inserir({ id: 'P1', status: 'em_andamento', timer_running: true });
    await inserir({ id: 'P2', status: 'aguardando_cliente', timer_running: true });
    expect(await rodar()).toEqual([]);
  });

  it('recorrente aguardando o cliente não é resolvida pelo banco (a próxima ocorrência nasce no app)', async () => {
    await inserir({ status: 'aguardando_cliente', recurrence: 'mensal' });
    expect(await rodar()).toEqual([]);
  });

  for (const status of ['aberto', 'pausado', 'aguardando', 'resolvido', 'cancelado']) {
    it(`não mexe em ${status}`, async () => {
      await inserir({ status });
      expect(await rodar()).toEqual([]);
    });
  }

  it('data torta numa nota não derruba a rodada dos outros chamados', async () => {
    await inserir({ id: 'P1', status: 'em_andamento', notes: [{ text: 'x', createdAt: '2026-13-45T99:00:00Z' }, { text: 'y', createdAt: 'ontem' }] });
    await inserir({ id: 'P2', status: 'em_andamento' });
    expect((await rodar()).map((r) => r.id)).toEqual(['P1', 'P2']);
  });

  it('rodar de novo não repete: o que mudou deixou de estar nos status da regra', async () => {
    await inserir({ status: 'em_andamento' });
    await rodar();
    expect(await rodar()).toEqual([]);
    expect((await pen('P1')).events).toHaveLength(1);
  });

  it('pausado pela rodada volta para Em Andamento quando o cliente escreve', async () => {
    await inserir({ status: 'em_andamento' });
    await rodar();
    await anexar('P1', notaCliente());
    const p = await pen('P1');
    expect(p.status).toBe('em_andamento');
    expect(p.events.map((e) => e.motivo)).toEqual(['Sem interação em 7 dias', 'Cliente respondeu']);
  });
});

describe('078: agendamento e permissões', () => {
  it('agenda uma vez só, de hora em hora, mesmo aplicando a migration duas vezes', async () => {
    const { rows } = await db.query(`SELECT schedule, command FROM cron.job WHERE jobname = 'chamados-sem-interacao'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].schedule).toBe('17 * * * *');
    expect(rows[0].command).toContain('public.chamados_sem_interacao()');
  });

  it('operador não chama a rodada pelo PostgREST', async () => {
    const r = await um(`SELECT has_function_privilege('authenticated', 'public.chamados_sem_interacao(timestamptz, integer)', 'execute') AS ok`);
    expect(r.ok).toBe(false);
    const a = await um(`SELECT has_function_privilege('anon', 'public.chamados_sem_interacao(timestamptz, integer)', 'execute') AS ok`);
    expect(a.ok).toBe(false);
  });
});
