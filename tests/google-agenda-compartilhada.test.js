import { describe, it, expect } from 'vitest';
import { loadHandler } from './helpers/edge-harness.js';
import { eventIdFor, visitHash } from '../supabase/functions/google-agenda/mapping.ts';

// Contrato da agenda compartilhada ("Atendimentos", migration 081) na Edge
// Function google-agenda, rodando o index.ts de verdade com um banco dublê
// em memória. O que se protege aqui:
// - toda visita vai para a compartilhada, MESMO sem técnico com e-mail;
// - a confirmação do robô grava a assinatura da agenda certa (dest), senão
//   uma edição aplicada vinda da compartilhada deixava a agenda pessoal
//   velha para sempre;
// - mudança feita na compartilhada volta para a visita nos dois sentidos.

const SEGREDO = 'segredo-de-teste';
const SHARED = 'c_atendimentos@group.calendar.google.com';
const ENV = {
  SUPABASE_URL: 'https://projeto.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-de-teste',
  SUPABASE_ANON_KEY: 'anon-de-teste',
  AGENDA_SYNC_SECRET: SEGREDO,
  AGENDA_SHARED_CAL: SHARED,
};
const AUTH = { 'x-agenda-secret': SEGREDO };

const hoje = () => new Date().toISOString().slice(0, 10);
const diasAtras = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

// Banco dublê com estado: cobre só o que a google-agenda usa (select com
// eq/neq/in/is/gte/lte/order/limit, update, delete, insert, upsert e
// maybeSingle). Filtros valem para a operação pendente, como no supabase-js.
function fakeDb(tabelas) {
  const store = tabelas;
  for (const t of ['operators', 'visits', 'google_agenda_queue', 'google_agenda_calendars', 'google_agenda_runner', 'google_agenda_shared']) {
    if (!store[t]) store[t] = [];
  }
  return {
    store,
    from: (tabela) => builder(store[tabela]),
  };
}

function builder(rows) {
  let op = 'select';
  let patch = null;
  let novas = null;
  let orderKey = null;
  let limitN = Infinity;
  const preds = [];
  const match = () => {
    let out = rows.filter((r) => preds.every((p) => p(r)));
    if (orderKey) out = out.slice().sort((a, b) => (a[orderKey] > b[orderKey] ? 1 : a[orderKey] < b[orderKey] ? -1 : 0));
    return out.slice(0, limitN);
  };
  const exec = () => {
    if (op === 'update') {
      for (const r of match()) Object.assign(r, patch);
      return { data: null, error: null };
    }
    if (op === 'delete') {
      const mortas = new Set(match());
      for (let i = rows.length - 1; i >= 0; i--) if (mortas.has(rows[i])) rows.splice(i, 1);
      return { data: null, error: null };
    }
    if (op === 'insert') {
      rows.push(...novas);
      return { data: null, error: null };
    }
    if (op === 'upsert') {
      for (const r of novas) {
        const chave = 'id' in r ? 'id' : 'operator_id';
        const ex = rows.find((x) => x[chave] === r[chave]);
        if (ex) Object.assign(ex, r); else rows.push({ ...r });
      }
      return { data: null, error: null };
    }
    return { data: match(), error: null };
  };
  const api = {
    select: () => api,
    eq: (c, v) => { preds.push((r) => r[c] === v); return api; },
    neq: (c, v) => { preds.push((r) => r[c] !== v); return api; },
    in: (c, vs) => { preds.push((r) => vs.includes(r[c])); return api; },
    is: (c, v) => { preds.push((r) => r[c] === v); return api; },
    gte: (c, v) => { preds.push((r) => r[c] >= v); return api; },
    lte: (c, v) => { preds.push((r) => r[c] <= v); return api; },
    order: (c) => { orderKey = c; return api; },
    limit: (n) => { limitN = n; return api; },
    update: (p) => { op = 'update'; patch = p; return api; },
    delete: () => { op = 'delete'; return api; },
    insert: (rs) => { op = 'insert'; novas = rs; return api; },
    upsert: (r) => { op = 'upsert'; novas = [r]; return api; },
    maybeSingle: async () => ({ data: match()[0] ?? null, error: null }),
    then: (res, rej) => Promise.resolve(exec()).then(res, rej),
  };
  return api;
}

async function handlerCom(db, env = ENV) {
  const { handler } = await loadHandler('google-agenda', { env, createClient: () => ({ from: db.from }) });
  return async (body) => {
    const res = await handler(new Request('https://fn.local/', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...AUTH },
      body: JSON.stringify(body),
    }));
    expect(res.status).toBe(200);
    return res.json();
  };
}

const ana = { id: 'OP-1', name: 'Ana', email: 'ana@empresa.com', active: true };
const visita = (over = {}) => ({
  id: 'VIS-1',
  numero: 10,
  client_name: 'Padaria Central',
  motivo: 'Visita mensal',
  observacoes: null,
  date: hoje(),
  time: '09:00',
  time_end: null,
  all_day: false,
  status: 'agendada',
  operator: 'Ana',
  operator_id: 'OP-1',
  google_hash: null,
  google_hash_shared: null,
  levar: null,
  ...over,
});

describe('google-agenda compartilhada — begin', () => {
  it('visita na fila sai para a agenda pessoal E para a compartilhada', async () => {
    const db = fakeDb({ operators: [ana], visits: [visita()], google_agenda_queue: [{ seq: 1, visit_id: 'VIS-1' }] });
    const call = await handlerCom(db);
    const res = await call({ action: 'begin', runner_email: 'agenda@empresa.com' });

    expect(res.calendars).toContainEqual({ op: 'OP-1', cal: 'ana@empresa.com' });
    expect(res.calendars).toContainEqual({ op: 'shared', cal: SHARED });
    const dests = res.push.map((p) => [p.dest, p.cal]).sort();
    expect(dests).toEqual([['personal', 'ana@empresa.com'], ['shared', SHARED]]);
    for (const p of res.push) {
      expect(p.event_id).toBe(eventIdFor('VIS-1'));
      expect(p.event.summary).toContain('Padaria Central');
      expect(typeof p.hash).toBe('string');
    }
  });

  it('visita de técnico sem e-mail vai só para a compartilhada', async () => {
    const beto = { id: 'OP-2', name: 'Beto', email: null, active: true };
    const db = fakeDb({ operators: [beto], visits: [visita({ operator: 'Beto', operator_id: 'OP-2' })], google_agenda_queue: [{ seq: 1, visit_id: 'VIS-1' }] });
    const call = await handlerCom(db);
    const res = await call({ action: 'begin' });

    expect(res.push).toHaveLength(1);
    expect(res.push[0]).toMatchObject({ dest: 'shared', cal: SHARED });
  });

  it('já igual nas duas agendas: fila esvaziada sem enviar nada', async () => {
    const v = visita();
    const h = await visitHash(v);
    v.google_hash = h;
    v.google_hash_shared = h;
    const db = fakeDb({ operators: [ana], visits: [v], google_agenda_queue: [{ seq: 7, visit_id: 'VIS-1' }] });
    const call = await handlerCom(db);
    const res = await call({ action: 'begin' });

    expect(res.push).toEqual([]);
    expect(db.store.google_agenda_queue).toEqual([]);
  });

  it('visita cancelada sai da compartilhada só se um dia entrou (hash gravado)', async () => {
    const db = fakeDb({
      operators: [ana],
      visits: [
        visita({ id: 'VIS-1', status: 'cancelada', google_hash: 'h1', google_hash_shared: 'h1' }),
        visita({ id: 'VIS-2', status: 'cancelada', google_hash: null, google_hash_shared: null }),
      ],
      google_agenda_queue: [{ seq: 1, visit_id: 'VIS-1' }, { seq: 2, visit_id: 'VIS-2' }],
    });
    const call = await handlerCom(db);
    const res = await call({ action: 'begin' });

    const remocoes = res.push.filter((p) => p.dest === 'shared');
    expect(remocoes).toHaveLength(1);
    expect(remocoes[0]).toMatchObject({ visit_id: 'VIS-1', cal: null, remove_from: [SHARED], hash: null });
  });

  it('sem AGENDA_SHARED_CAL, o comportamento é o de antes da 081', async () => {
    const db = fakeDb({ operators: [ana], visits: [visita()], google_agenda_queue: [{ seq: 1, visit_id: 'VIS-1' }] });
    const env = { ...ENV };
    delete env.AGENDA_SHARED_CAL;
    const call = await handlerCom(db, env);
    const res = await call({ action: 'begin' });

    expect(res.calendars).toEqual([{ op: 'OP-1', cal: 'ana@empresa.com' }]);
    expect(res.push.map((p) => p.dest)).toEqual(['personal']);
  });
});

describe('google-agenda compartilhada — finish', () => {
  it('edição na compartilhada muda a visita e grava google_hash_shared, não google_hash', async () => {
    const v = visita();
    const h = await visitHash(v);
    v.google_hash = h;
    v.google_hash_shared = h;
    // Agenda já liberada antes (sem backfill nesta rodada, que zera o hash).
    const db = fakeDb({ operators: [ana], visits: [v], google_agenda_shared: [{ id: 1, calendar_id: SHARED, ok: true }] });
    const call = await handlerCom(db);
    const res = await call({
      action: 'finish',
      calendars: [{ op: 'shared', ok: true }],
      changes: [{
        op: 'shared',
        event: {
          id: eventIdFor('VIS-1'),
          status: 'confirmed',
          start: { dateTime: `${hoje()}T14:00:00-03:00`, timeZone: 'America/Sao_Paulo' },
          end: { dateTime: `${hoje()}T15:00:00-03:00`, timeZone: 'America/Sao_Paulo' },
        },
      }],
      pushed: [],
    });

    expect(res.applied).toBe(1);
    const v2 = db.store.visits[0];
    expect(v2.time).toBe('14:00');
    expect(v2.time_end).toBe('15:00');
    expect(v2.google_hash_shared).toBe(await visitHash(v2));
    // A assinatura pessoal ficou velha de propósito: a próxima fila atualiza a agenda da Ana.
    expect(v2.google_hash).toBe(h);
  });

  it('edição na compartilhada é ignorada quando o site tem mudança ainda não enviada', async () => {
    const v = visita({ google_hash: 'velho', google_hash_shared: 'velho' });
    const db = fakeDb({ operators: [ana], visits: [v] });
    const call = await handlerCom(db);
    const res = await call({
      action: 'finish',
      calendars: [],
      changes: [{ op: 'shared', event: { id: eventIdFor('VIS-1'), status: 'confirmed', start: { dateTime: `${hoje()}T14:00:00-03:00` } } }],
      pushed: [],
    });

    expect(res.applied).toBe(0);
    expect(db.store.visits[0].time).toBe('09:00');
  });

  it('evento apagado na compartilhada cancela a visita agendada', async () => {
    const v = visita();
    const h = await visitHash(v);
    v.google_hash = h;
    v.google_hash_shared = h;
    const db = fakeDb({ operators: [ana], visits: [v] });
    const call = await handlerCom(db);
    const res = await call({
      action: 'finish',
      calendars: [],
      changes: [{ op: 'shared', event: { id: eventIdFor('VIS-1'), status: 'cancelled' } }],
      pushed: [],
    });

    expect(res.applied).toBe(1);
    expect(db.store.visits[0].status).toBe('cancelada');
    expect(db.store.visits[0].google_hash_shared).toBeNull();
    // O evento continua na agenda pessoal até a próxima fila: a assinatura dela não muda aqui.
    expect(db.store.visits[0].google_hash).toBe(h);
  });

  it('confirmação do push grava a assinatura do destino certo', async () => {
    const v = visita();
    const h = await visitHash(v);
    const db = fakeDb({ operators: [ana], visits: [v], google_agenda_queue: [{ seq: 3, visit_id: 'VIS-1', attempts: 0 }] });
    const call = await handlerCom(db);
    await call({
      action: 'finish',
      calendars: [],
      changes: [],
      pushed: [
        { seq: 3, visit_id: 'VIS-1', ok: true, hash: h, dest: 'shared' },
        { seq: 3, visit_id: 'VIS-1', ok: true, hash: h, dest: 'personal' },
      ],
    });

    expect(db.store.visits[0].google_hash_shared).toBe(h);
    expect(db.store.visits[0].google_hash).toBe(h);
    expect(db.store.google_agenda_queue).toEqual([]);
  });

  it('robô de antes da 081 (sem dest no retorno) confirma a agenda pessoal', async () => {
    const v = visita();
    const h = await visitHash(v);
    const db = fakeDb({ operators: [ana], visits: [v], google_agenda_queue: [{ seq: 3, visit_id: 'VIS-1', attempts: 0 }] });
    const call = await handlerCom(db);
    await call({ action: 'finish', calendars: [], changes: [], pushed: [{ seq: 3, visit_id: 'VIS-1', ok: true, hash: h }] });

    expect(db.store.visits[0].google_hash).toBe(h);
    expect(db.store.visits[0].google_hash_shared).toBeNull();
  });

  it('primeira ok da compartilhada registra o estado e enfileira as visitas recentes', async () => {
    const db = fakeDb({
      operators: [ana],
      visits: [
        visita({ id: 'VIS-1', date: hoje() }),
        visita({ id: 'VIS-2', date: diasAtras(20) }),
        visita({ id: 'VIS-3', date: hoje(), status: 'cancelada' }),
      ],
    });
    const call = await handlerCom(db);
    await call({ action: 'finish', calendars: [{ op: 'shared', ok: true }], changes: [], pushed: [] });

    expect(db.store.google_agenda_shared[0]).toMatchObject({ calendar_id: SHARED, ok: true });
    expect(db.store.google_agenda_queue.map((q) => q.visit_id)).toEqual(['VIS-1']);
  });

  it('erro de acesso da compartilhada fica registrado para o app mostrar', async () => {
    const db = fakeDb({ operators: [ana], visits: [] });
    const call = await handlerCom(db);
    await call({
      action: 'finish',
      calendars: [{ op: 'shared', ok: false, access: true, error: 'Agenda não compartilhada' }],
      changes: [],
      pushed: [],
    });

    expect(db.store.google_agenda_shared[0]).toMatchObject({ ok: false, last_error: 'Agenda não compartilhada' });
  });
});
