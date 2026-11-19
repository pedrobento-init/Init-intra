import { describe, it, expect } from 'vitest';
import { loadHandler, reqPost } from './helpers/edge-harness.js';
import { fakeSupabase } from './helpers/fake-supabase.js';

// whatsapp-iniciar roda de verdade (tests/helpers/edge-harness.js). O que se
// protege aqui é a trava da 076 estendida ao envio ativo: o número só passa se
// for cliente da equipe ou se já escreveu e a equipe enxerga a conversa, e o
// limite por hora segura o volume que derruba número na WAHA.
const ENV = {
  SUPABASE_URL: 'https://projeto.supabase.co',
  SUPABASE_ANON_KEY: 'anon-de-teste',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-de-teste',
  WAHA_BASE_URL: 'https://waha.teste',
  WAHA_API_KEY: 'waha-key-teste',
  WAHA_SESSION: 'default',
};

const OPERADOR = {
  id: 'op-1',
  auth_user_id: 'user-1',
  name: 'Ana',
  active: true,
  team: 'init',
  is_admin: false,
};

const CLIENTE_INIT = {
  id: 'CLI-1',
  name: 'Acme',
  team: 'init',
  owner_phone: '(11) 98765-4321',
  responsible_phone: null,
};
const CLIENTE_MAM = {
  id: 'CLI-2',
  name: 'Outra',
  team: 'mam',
  owner_phone: '(21) 99876-5432',
  responsible_phone: null,
};

function envioRecente(over) {
  return Object.assign(
    { id: 1, operador_id: 'op-1', team: 'init', telefone: '5511900000000' },
    { criado_em: new Date().toISOString() },
    over
  );
}

// A RLS de emails_triagem é o que diz se a equipe "enxerga" a conversa. O
// dublê não tem RLS, então o cliente do operador (chave anon) recebe só as
// linhas da equipe dele, e o service role recebe tudo.
async function chamar({
  body = { telefone: '11987654321', text: 'Olá, aqui é da Init.' },
  operador = OPERADOR,
  clientes = [CLIENTE_INIT, CLIENTE_MAM],
  conversas = [],
  caixa = [],
  envios = [],
  waha = { numberExists: true, chatId: '5511987654321@c.us' },
  envioOk = true,
  semMigration = false,
} = {}) {
  const queries = [];
  const chamadasWaha = [];
  const tabelasAdmin = {
    operators: [operador],
    clients: clientes,
    whatsapp_conversas: conversas,
    emails_triagem: caixa,
    whatsapp_envios_ativos: envios,
  };
  const tabelasOperador = Object.assign({}, tabelasAdmin, {
    emails_triagem: operador.is_admin
      ? caixa
      : caixa.filter((l) => (l.team || 'init') === (operador.team || 'init')),
  });
  const admin = fakeSupabase({ user: { id: 'user-1' }, queries, tabelas: tabelasAdmin });
  const doOperador = fakeSupabase({ user: { id: 'user-1' }, queries, tabelas: tabelasOperador });
  const createClient = (url, key, opts) => {
    const c =
      key === ENV.SUPABASE_SERVICE_ROLE_KEY ? admin(url, key, opts) : doOperador(url, key, opts);
    // clientes_do_telefone (077): devolve os cadastros cuja chave bate.
    c.rpc = async (_nome, { p_chave }) => ({
      data: clientes.filter((cl) =>
        [cl.owner_phone, cl.responsible_phone].some((t) => {
          const d = String(t || '').replace(/\D/g, '');
          return d.length >= 10 && d.slice(0, 2) + d.slice(-8) === p_chave;
        })
      ),
      error: null,
    });
    if (semMigration) {
      // Banco sem a 089: o PostgREST responde erro para a tabela que não existe.
      const from = c.from;
      c.from = (t) => {
        if (t !== 'whatsapp_envios_ativos') return from(t);
        const erro = { data: null, count: null, error: { message: 'relation does not exist' } };
        const b = {
          select: () => b,
          eq: () => b,
          gte: () => b,
          insert: () => b,
          then: (res, rej) => Promise.resolve(erro).then(res, rej),
        };
        return b;
      };
    }
    return c;
  };
  const { handler } = await loadHandler('whatsapp-iniciar', {
    env: ENV,
    createClient,
    fetch: async (url, init) => {
      chamadasWaha.push({
        url: String(url),
        body: init && init.body ? JSON.parse(init.body) : null,
      });
      if (String(url).includes('/check-exists'))
        return new Response(JSON.stringify(waha), { status: 200 });
      return envioOk
        ? new Response(JSON.stringify({ id: 'wa-1' }), { status: 200 })
        : new Response('erro', { status: 500 });
    },
  });
  const res = await handler(reqPost(body, 'jwt-valido'));
  return { res, dados: await res.json(), queries, chamadasWaha };
}

const enviosDeTexto = (chamadas) => chamadas.filter((c) => c.url.includes('/api/sendText'));

describe('whatsapp-iniciar: quem pode receber', () => {
  it('cliente cadastrado da equipe recebe, com o nome de quem atende', async () => {
    const { res, chamadasWaha, queries } = await chamar();
    expect(res.status).toBe(200);
    const textos = enviosDeTexto(chamadasWaha);
    expect(textos).toHaveLength(1);
    expect(textos[0].body.chatId).toBe('5511987654321@c.us');
    expect(textos[0].body.text).toBe('Ana: Olá, aqui é da Init.');
    const ins = queries.find((q) => q.tabela === 'emails_triagem' && q.insert);
    expect(ins.insert).toMatchObject({
      direcao: 'saida',
      canal: 'whatsapp',
      team: 'init',
      client_id: 'CLI-1',
      thread_id: 'whatsapp:5511987654321',
      atribuido_a: 'Ana',
    });
  });

  it('número fora da equipe é recusado sem tocar na WAHA', async () => {
    const { res, dados, chamadasWaha } = await chamar({
      body: { telefone: '21998765432', text: 'oi' },
    });
    expect(res.status).toBe(403);
    expect(dados.code).toBe('not_allowed_number');
    expect(chamadasWaha).toEqual([]);
  });

  it('número qualquer, que nunca escreveu e não é cliente, é recusado', async () => {
    const { res, chamadasWaha } = await chamar({
      body: { telefone: '31991112222', text: 'promoção!' },
    });
    expect(res.status).toBe(403);
    expect(chamadasWaha).toEqual([]);
  });

  // O que o navegador manda sobre o cliente não conta: só o banco decide.
  it('client_id e team do body não liberam número de outra equipe', async () => {
    const { res } = await chamar({
      body: { telefone: '21998765432', text: 'oi', client_id: 'CLI-1', team: 'mam' },
    });
    expect(res.status).toBe(403);
  });

  it('quem já escreveu e a equipe enxerga na caixa recebe no número exato do webhook', async () => {
    const { res, chamadasWaha } = await chamar({
      clientes: [],
      body: { telefone: '(41) 9988-7766', text: 'Retornando' },
      conversas: [{ telefone: '554199887766' }],
      caixa: [{ id: 'e1', canal: 'whatsapp', telefone: '554199887766', team: 'init' }],
    });
    expect(res.status).toBe(200);
    // Sem consulta à WAHA: o número já é o que ela entregou no webhook.
    expect(chamadasWaha.some((c) => c.url.includes('check-exists'))).toBe(false);
    expect(enviosDeTexto(chamadasWaha)[0].body.chatId).toBe('554199887766@c.us');
  });

  // A 076 não tem equipe: só ela deixaria a equipe A puxar conversa com quem
  // só falou com a equipe B.
  it('quem só escreveu para outra equipe é recusado', async () => {
    const { res, chamadasWaha } = await chamar({
      clientes: [],
      body: { telefone: '41999887766', text: 'oi' },
      conversas: [{ telefone: '5541999887766' }],
      caixa: [{ id: 'e1', canal: 'whatsapp', telefone: '5541999887766', team: 'mam' }],
    });
    expect(res.status).toBe(403);
    expect(chamadasWaha).toEqual([]);
  });

  it('admin pode iniciar com cliente de outra equipe, e a conversa nasce na equipe do cliente', async () => {
    const { res, queries } = await chamar({
      operador: Object.assign({}, OPERADOR, { is_admin: true }),
      body: { telefone: '21998765432', text: 'oi' },
      waha: { numberExists: true, chatId: '5521998765432@c.us' },
    });
    expect(res.status).toBe(200);
    expect(queries.find((q) => q.tabela === 'emails_triagem' && q.insert).insert.team).toBe('mam');
  });

  it('número sem WhatsApp devolve 422 e não envia', async () => {
    const { res, dados, chamadasWaha } = await chamar({ waha: { numberExists: false } });
    expect(res.status).toBe(422);
    expect(dados.code).toBe('not_on_whatsapp');
    expect(enviosDeTexto(chamadasWaha)).toEqual([]);
  });

  it('operador inativo não envia', async () => {
    const { res, chamadasWaha } = await chamar({
      operador: Object.assign({}, OPERADOR, { active: false }),
    });
    expect(res.status).toBe(401);
    expect(chamadasWaha).toEqual([]);
  });

  it('texto vazio e telefone inválido são recusados antes de tudo', async () => {
    expect((await chamar({ body: { telefone: '11987654321', text: '  ' } })).res.status).toBe(400);
    expect((await chamar({ body: { telefone: '123', text: 'oi' } })).res.status).toBe(400);
  });
});

describe('whatsapp-iniciar: limite por hora', () => {
  it('no limite do operador devolve 429 e não envia', async () => {
    const envios = Array.from({ length: 20 }, (_, i) => envioRecente({ id: i + 1 }));
    const { res, dados, chamadasWaha } = await chamar({ envios });
    expect(res.status).toBe(429);
    expect(dados.code).toBe('rate_limited');
    expect(chamadasWaha).toEqual([]);
  });

  it('um abaixo do limite ainda envia e registra a tentativa', async () => {
    const envios = Array.from({ length: 19 }, (_, i) => envioRecente({ id: i + 1 }));
    const { res, queries } = await chamar({ envios });
    expect(res.status).toBe(200);
    const reserva = queries.find((q) => q.tabela === 'whatsapp_envios_ativos' && q.insert);
    expect(reserva.insert).toMatchObject({ operador_id: 'op-1', team: 'init' });
  });

  it('o limite da equipe vale mesmo com o operador folgado', async () => {
    const envios = Array.from({ length: 60 }, (_, i) =>
      envioRecente({ id: i + 1, operador_id: 'op-' + (i + 2) })
    );
    const { res, dados } = await chamar({ envios });
    expect(res.status).toBe(429);
    expect(dados.code).toBe('team_rate_limited');
  });

  it('sem a migration 089 recusa tudo (sem contagem não há limite)', async () => {
    const { res, dados, chamadasWaha } = await chamar({ semMigration: true });
    expect(res.status).toBe(503);
    expect(dados.code).toBe('migration_missing');
    expect(chamadasWaha).toEqual([]);
  });

  it('a contagem é do operador e da equipe, não do body', async () => {
    const { queries } = await chamar({ body: { telefone: '11987654321', text: 'oi', team: 'x' } });
    const contagens = queries.filter((q) => q.tabela === 'whatsapp_envios_ativos' && !q.insert);
    expect(contagens.map((q) => q.filtros[0])).toEqual([
      ['operador_id', 'op-1'],
      ['team', 'init'],
    ]);
  });
});
