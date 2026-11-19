import { describe, it, expect } from 'vitest';
import { loadHandler, reqPost } from './helpers/edge-harness.js';
import { fakeSupabase } from './helpers/fake-supabase.js';

// Ação "conversa" da milvus-chamado-create: chamado avulso aberto da Caixa
// (js/caixa-pendencia.js). Roda o index.ts de verdade. O que importa aqui é o
// que custa caro se quebrar: escopo de equipe antes de tocar o Milvus e a ref
// como chave de idempotência (duplo clique não abre dois chamados).

const ENV = {
  SUPABASE_URL: 'https://projeto.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-de-teste',
  SUPABASE_ANON_KEY: 'anon-de-teste',
  MILVUS_API_TOKEN: 'milvus-token-de-teste',
  MILVUS_API_URL: 'https://milvus.invalido',
};

const OPERADOR = {
  id: 'op-1',
  auth_user_id: 'user-1',
  team: 'init',
  is_admin: false,
  active: true,
  email: 'pedro@initnet.com.br',
};

const CLIENTE = {
  id: 'c1',
  name: 'MMolaw',
  team: 'init',
  emails: ['ti@mmolaw.com.br'],
  responsible_phone: '(11) 3333-4444',
  milvus_client_token: 'tok-cliente',
};

const CORPO = {
  action: 'conversa',
  clientId: 'c1',
  ref: 'CX-abc123def',
  assunto: 'Backup sem rodar desde ontem 22h',
  descricao: 'Cliente avisou pelo WhatsApp.',
  contato: 'Carla Mendes',
  telefone: '11987654321',
};

// fetch do Milvus: listagem (recuperação) e criação, registradas para o teste.
function milvus({ lista = [], criar = () => new Response('321', { status: 200 }) } = {}) {
  const chamadas = [];
  const fetch = async (url, init) => {
    const body = init && init.body ? JSON.parse(init.body) : null;
    chamadas.push({ url: String(url), body });
    if (String(url).endsWith('/api/chamado/listagem'))
      return new Response(JSON.stringify({ lista }), { status: 200 });
    if (String(url).endsWith('/api/chamado/criar')) return criar(body);
    throw new Error('rota inesperada ' + url);
  };
  return { fetch, chamadas };
}

async function carregar({ operador = OPERADOR, cliente = CLIENTE, rede, env = ENV } = {}) {
  const m = rede || milvus();
  const { handler } = await loadHandler('milvus-chamado-create', {
    env,
    createClient: fakeSupabase({
      user: { id: 'user-1' },
      tabelas: { operators: [operador], clients: [cliente], milvus_client_map: [] },
    }),
    fetch: m.fetch,
  });
  return { handler, chamadas: m.chamadas };
}

describe('milvus-chamado-create — ação conversa', () => {
  it('cria o chamado com o texto da Caixa, o contato e o marcador da ref', async () => {
    const { handler, chamadas } = await carregar();
    const res = await handler(reqPost(CORPO, 'jwt-valido'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, codigo: 321, ref: 'CX-abc123def' });
    const criar = chamadas.find((c) => c.url.endsWith('/api/chamado/criar'));
    expect(criar.body).toMatchObject({
      cliente_id: 'tok-cliente',
      chamado_assunto: 'Backup sem rodar desde ontem 22h',
      chamado_contato: 'Carla Mendes',
      chamado_telefone: '11987654321',
      chamado_tecnico: 'pedro@initnet.com.br',
    });
    expect(criar.body.chamado_descricao).toContain('Cliente avisou pelo WhatsApp.');
    expect(criar.body.chamado_descricao).toContain('[ref:CX-abc123def]');
  });

  it('a categoria do chamado da conversa não é a da visita técnica', async () => {
    const env = {
      ...ENV,
      MILVUS_DEFAULT_CATEGORIA_PRIMARIA: 'Visita técnica',
      MILVUS_DEFAULT_CATEGORIA_SECUNDARIA: 'Visita agendada',
      MILVUS_DEFAULT_CATEGORIA_ID: '7',
      MILVUS_CONVERSA_CATEGORIA_PRIMARIA: 'Suporte',
      MILVUS_CONVERSA_CATEGORIA_SECUNDARIA: 'Atendimento',
      MILVUS_CONVERSA_CATEGORIA_ID: '2',
    };
    const { handler, chamadas } = await carregar({ env });
    await handler(reqPost(CORPO, 'jwt-valido'));
    const criar = chamadas.find((c) => c.url.endsWith('/api/chamado/criar'));
    expect(criar.body).toMatchObject({
      chamado_categoria_primaria: 'Suporte',
      chamado_categoria_secundaria: 'Atendimento',
      categoria_id: 2,
    });
  });

  it('sem categoria própria da conversa, segue o padrão de antes (compatível)', async () => {
    const env = {
      ...ENV,
      MILVUS_DEFAULT_CATEGORIA_PRIMARIA: 'Visita técnica',
      MILVUS_DEFAULT_CATEGORIA_SECUNDARIA: 'Visita agendada',
      MILVUS_DEFAULT_CATEGORIA_ID: '7',
    };
    const { handler, chamadas } = await carregar({ env });
    await handler(reqPost(CORPO, 'jwt-valido'));
    const criar = chamadas.find((c) => c.url.endsWith('/api/chamado/criar'));
    expect(criar.body).toMatchObject({
      chamado_categoria_primaria: 'Visita técnica',
      chamado_categoria_secundaria: 'Visita agendada',
      categoria_id: 7,
    });
  });

  it('adota o chamado já criado com a mesma ref em vez de abrir outro', async () => {
    const rede = milvus({ lista: [{ codigo: 77, descricao: 'x\n[ref:CX-abc123def]' }] });
    const { handler, chamadas } = await carregar({ rede });
    const res = await handler(reqPost(CORPO, 'jwt-valido'));
    expect(await res.json()).toMatchObject({ success: true, recovered: true, codigo: 77 });
    expect(chamadas.some((c) => c.url.endsWith('/api/chamado/criar'))).toBe(false);
  });

  it('nega cliente de outra equipe antes de qualquer chamada ao Milvus', async () => {
    const { handler, chamadas } = await carregar({ cliente: { ...CLIENTE, team: 'outra' } });
    const res = await handler(reqPost(CORPO, 'jwt-valido'));
    expect(res.status).toBe(403);
    expect(chamadas).toHaveLength(0);
  });

  it('admin abre chamado para cliente de outra equipe', async () => {
    const { handler } = await carregar({
      operador: { ...OPERADOR, is_admin: true },
      cliente: { ...CLIENTE, team: 'outra' },
    });
    const res = await handler(reqPost(CORPO, 'jwt-valido'));
    expect((await res.json()).success).toBe(true);
  });

  it('recusa ref fora do formato (vira texto na descrição e filtro de busca)', async () => {
    const { handler, chamadas } = await carregar();
    const res = await handler(reqPost({ ...CORPO, ref: 'VIS-1] [ref:outra' }, 'jwt-valido'));
    expect(res.status).toBe(400);
    expect(chamadas).toHaveLength(0);
  });

  it('recusa assunto vazio', async () => {
    const { handler } = await carregar();
    const res = await handler(reqPost({ ...CORPO, assunto: '   ' }, 'jwt-valido'));
    expect(res.status).toBe(400);
  });

  it('cliente sem token nem mapa no Milvus devolve o código de não configurado', async () => {
    const { handler, chamadas } = await carregar({
      cliente: { ...CLIENTE, milvus_client_token: null },
    });
    const res = await handler(reqPost(CORPO, 'jwt-valido'));
    expect(await res.json()).toMatchObject({
      success: false,
      code: 'MILVUS_CLIENT_TOKEN_NOT_CONFIGURED',
    });
    expect(chamadas).toHaveLength(0);
  });

  it('Milvus fora do ar vira 502 transitório, sem código', async () => {
    const rede = milvus({ criar: () => new Response('erro', { status: 503 }) });
    const { handler } = await carregar({ rede });
    const res = await handler(reqPost(CORPO, 'jwt-valido'));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ success: false, code: 'MILVUS_UNAVAILABLE' });
  });

  it('o fluxo da visita continua exigindo visitId', async () => {
    const { handler } = await carregar();
    const res = await handler(reqPost({ action: 'criar' }, 'jwt-valido'));
    expect(res.status).toBe(400);
  });
});
