import { describe, it, expect } from 'vitest';
import { loadHandler } from './helpers/edge-harness.js';
import { fakeSupabase } from './helpers/fake-supabase.js';

// Contrato de fora das quatro functions que autenticam por segredo próprio.
// O guarda estrutural (tests/edge-functions-server.test.js) trava a forma do
// código; aqui roda o index.ts de verdade e confere o que o Apps Script, o
// pg_cron e o app de calendário veem: 405 no método errado, 401/404 secos,
// 400 no corpo inválido e 200 com o .ics. Sem isto, mover a checagem do
// segredo para depois da primeira query não quebrava teste nenhum.

const ENV = {
  SUPABASE_URL: 'https://projeto.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-de-teste',
  SUPABASE_ANON_KEY: 'anon-de-teste',
  APP_URL: 'https://intra.invalido',
};

const TOKEN = 'a'.repeat(43); // formato do calendar_feeds: 40–60 de [A-Za-z0-9_-]

const duble = (tabelas = {}, env = ENV) => ({
  env,
  createClient: fakeSupabase({ tabelas }),
  createTransport: () => ({ sendMail: async () => ({ messageId: 'id-de-teste' }) }),
  fetch: async () => new Response('{}', { status: 200 }),
});

/** Request cru, com os headers da autenticação própria de cada function. */
function req(method, { url = 'https://fn.local/', headers = {}, body } = {}) {
  return new Request(url, { method, headers, body });
}

const postJson = (body, headers = {}) =>
  req('POST', {
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body ?? {}),
  });

/** Status da resposta; 0 = o handler estourou (gate deixou passar). */
async function status(handler, request) {
  try {
    return (await handler(request)).status;
  } catch {
    return 0;
  }
}

describe('agenda-ics — token na query, 404 seco', () => {
  it('recusa método que não é GET/HEAD com 405', async () => {
    const { handler } = await loadHandler('agenda-ics', duble());
    expect(await status(handler, postJson({}))).toBe(405);
  });

  it('sem token, com token fora do formato e com token desconhecido: 404', async () => {
    const { handler } = await loadHandler('agenda-ics', duble());
    expect(await status(handler, req('GET'))).toBe(404);
    expect(await status(handler, req('GET', { url: `https://fn.local/?t=curto` }))).toBe(404);
    expect(await status(handler, req('GET', { url: `https://fn.local/?t=${TOKEN}` }))).toBe(404);
  });

  it('operador desativado também é 404, sem revelar que o feed existe', async () => {
    const { handler } = await loadHandler(
      'agenda-ics',
      duble({
        calendar_feeds: [{ operator_id: 'op-1', token: TOKEN }],
        operators: [{ id: 'op-1', name: 'Fulano', active: false }],
      })
    );
    expect(await status(handler, req('GET', { url: `https://fn.local/?t=${TOKEN}` }))).toBe(404);
  });

  it('operador ativo e sem visitas: 200 com o calendário e os headers preservados', async () => {
    const { handler } = await loadHandler(
      'agenda-ics',
      duble({
        calendar_feeds: [{ operator_id: 'op-1', token: TOKEN }],
        operators: [{ id: 'op-1', name: 'Fulano', active: true }],
        visits: [],
      })
    );
    const res = await handler(req('GET', { url: `https://fn.local/?t=${TOKEN}` }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/calendar');
    expect(res.headers.get('cache-control')).toBe('private, max-age=900');
    expect(await res.text()).toContain('BEGIN:VCALENDAR');
  });

  it('HEAD devolve os mesmos headers sem corpo', async () => {
    const { handler } = await loadHandler(
      'agenda-ics',
      duble({
        calendar_feeds: [{ operator_id: 'op-1', token: TOKEN }],
        operators: [{ id: 'op-1', name: 'Fulano', active: true }],
        visits: [],
      })
    );
    const res = await handler(req('HEAD', { url: `https://fn.local/?t=${TOKEN}` }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/calendar');
    expect(await res.text()).toBe('');
  });
});

describe('avisos-prazo — x-cron-secret', () => {
  const ENV_CRON = { ...ENV, AVISOS_CRON_SECRET: 'segredo-de-teste' };

  it('recusa método que não é POST com 405', async () => {
    const { handler } = await loadHandler('avisos-prazo', duble({}, ENV_CRON));
    expect(await status(handler, req('GET'))).toBe(405);
  });

  it('sem header e com segredo errado: 401', async () => {
    const { handler } = await loadHandler('avisos-prazo', duble({}, ENV_CRON));
    expect(await status(handler, postJson({}))).toBe(401);
    expect(await status(handler, postJson({}, { 'x-cron-secret': 'errado' }))).toBe(401);
  });

  it('sem AVISOS_CRON_SECRET configurado, todo pedido é 401', async () => {
    const { handler } = await loadHandler('avisos-prazo', duble({}, ENV));
    expect(await status(handler, postJson({}, { 'x-cron-secret': '' }))).toBe(401);
  });

  it('com segredo certo e Gmail ausente: 500, sem tentar enviar', async () => {
    const { handler } = await loadHandler(
      'avisos-prazo',
      duble({}, { ...ENV, AVISOS_CRON_SECRET: 'segredo-de-teste' })
    );
    const res = await handler(postJson({}, { 'x-cron-secret': 'segredo-de-teste' }));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/GMAIL/) });
  });
});

describe('google-agenda — x-agenda-secret', () => {
  const ENV_AGENDA = { ...ENV, AGENDA_SYNC_SECRET: 'segredo-de-teste' };
  const SECRET = { 'x-agenda-secret': 'segredo-de-teste' };

  it('recusa método que não é POST com 405', async () => {
    const { handler } = await loadHandler('google-agenda', duble({}, ENV_AGENDA));
    expect(await status(handler, req('GET'))).toBe(405);
  });

  it('sem header e com segredo errado: 401', async () => {
    const { handler } = await loadHandler('google-agenda', duble({}, ENV_AGENDA));
    expect(await status(handler, postJson({ action: 'begin' }))).toBe(401);
    expect(await status(handler, postJson({ action: 'begin' }, { 'x-agenda-secret': 'errado' }))).toBe(401);
  });

  it('JSON inválido e ação desconhecida: 400', async () => {
    const { handler } = await loadHandler('google-agenda', duble({}, ENV_AGENDA));
    expect(await status(handler, postJson('{', SECRET))).toBe(400);
    expect(await status(handler, postJson({ action: 'nao-existe' }, SECRET))).toBe(400);
  });
});

describe('robo — x-agenda-secret e as nove ações', () => {
  const ENV_AGENDA = { ...ENV, AGENDA_SYNC_SECRET: 'segredo-de-teste' };
  const SECRET = { 'x-agenda-secret': 'segredo-de-teste' };

  it('recusa método que não é POST com 405', async () => {
    const { handler } = await loadHandler('robo', duble({}, ENV_AGENDA));
    expect(await status(handler, req('GET'))).toBe(405);
  });

  it('sem header e com segredo errado: 401', async () => {
    const { handler } = await loadHandler('robo', duble({}, ENV_AGENDA));
    expect(await status(handler, postJson({ action: 'resumo' }))).toBe(401);
    expect(await status(handler, postJson({ action: 'resumo' }, { 'x-agenda-secret': 'errado' }))).toBe(401);
  });

  it('JSON inválido e ação desconhecida: 400', async () => {
    const { handler } = await loadHandler('robo', duble({}, ENV_AGENDA));
    expect(await status(handler, postJson('{', SECRET))).toBe(400);
    expect(await status(handler, postJson({ action: 'nao-existe' }, SECRET))).toBe(400);
  });

  // As ações são o contrato com o Robo.gs: se uma sair do switch, o robô que a
  // chama recebe 400 e a tarefa da noite para em silêncio. Testar as nove de
  // ponta a ponta exigiria um dublê de banco inteiro; a lista basta para o
  // regresso que importa (ação removida ou renomeada).
  it('o switch mantém as nove ações do Robo.gs', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(
      new URL('../supabase/functions/robo/index.ts', import.meta.url),
      'utf8'
    );
    for (const acao of [
      'vencimentos',
      'dominios',
      'resumo',
      'indicadores',
      'backup',
      'backups',
      'triagem',
      'pastas',
      'pastas-resultado',
    ]) {
      expect(src).toContain(`case "${acao}":`);
    }
  });
});
