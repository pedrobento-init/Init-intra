import { describe, it, expect } from 'vitest';
import { loadHandler, reqPost } from './helpers/edge-harness.js';
import { fakeSupabase } from './helpers/fake-supabase.js';

// Os 4 contratos de auth que a Fase 1 registrou como SEM cobertura:
// sem JWT → 401, operador inativo → bloqueado, operador de outra equipe → 403
// e admin passa. Aqui roda o index.ts de verdade (ver tests/helpers/
// edge-harness.js), não uma cópia da regra — se alguém tirar o team-check da
// function, estes testes ficam vermelhos.
//
// O guarda estrutural (tests/edge-functions-guard.test.js) continua valendo:
// ele cobre config.toml/verify_jwt e vazamento de segredo, que são invariantes
// de arquivo; este cobre comportamento.

const ENV = {
  SUPABASE_URL: 'https://projeto.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-de-teste',
  SUPABASE_ANON_KEY: 'anon-de-teste',
  MILVUS_API_TOKEN: 'milvus-token-de-teste',
  MILVUS_API_URL: 'https://milvus.invalido',
  IA_WEBHOOK_URL: 'https://hook.invalido/ia',
  GMAIL_USER: 'robo@initnet.com.br',
  GMAIL_APP_PASSWORD: 'senha-de-app',
  GMAIL_FROM: 'robo@initnet.com.br',
  VAPID_PUBLIC_KEY: 'vapid-pub',
  VAPID_PRIVATE_KEY: 'vapid-priv',
  VAPID_SUBJECT: 'mailto:robo@initnet.com.br',
  APP_URL: 'https://intra.invalido',
};

const ATIVO = {
  id: 'op-1',
  auth_user_id: 'user-1',
  team: 'init',
  is_admin: false,
  active: true,
  email: 'operador@initnet.com.br',
};
const INATIVO = { ...ATIVO, active: false };
const ADMIN = { ...ATIVO, is_admin: true };

// O cliente/visita do teste são de OUTRA equipe: é o que torna o 403 possível.
const tabelas = (operador) => ({
  operators: [operador],
  clients: [{ id: 'c1', name: 'Cliente de outra equipe', team: 'outra', emails: [] }],
  visits: [{ id: 'v1', client_id: 'c1', status: 'agendada', milvus_chamado_codigo: null }],
  milvus_client_map: [],
  visit_photos: [],
});

const dubles = (operador) => ({
  env: ENV,
  createClient: fakeSupabase({ user: { id: 'user-1' }, tabelas: tabelas(operador) }),
  createTransport: () => ({ sendMail: async () => ({ messageId: 'id-de-teste' }) }),
  // Resposta vazia e plausível: nenhuma chamada sai da máquina.
  fetch: async () =>
    new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
});

// `equipe` diz qual é a regra de autorização DEPOIS do gate de operador ativo:
//   cliente → compara a equipe do operador com a do cliente (403)
//   admin   → exige is_admin (403)
//   filtra  → não nega: devolve só o que é da equipe (sem 403 para testar)
//   nenhum  → só exige operador ativo
const FUNCTIONS = [
  { nome: 'milvus-devices', equipe: 'cliente', body: { clientId: 'c1' } },
  { nome: 'milvus-tickets', equipe: 'cliente', body: { clientId: 'c1' } },
  { nome: 'milvus-chamado-create', equipe: 'cliente', body: { visitId: 'v1' } },
  { nome: 'milvus-client-names', equipe: 'admin', body: {} },
  { nome: 'milvus-clients-import', equipe: 'admin', body: {} },
  { nome: 'milvus-token-backfill', equipe: 'admin', body: {} },
  {
    nome: 'update-user-password',
    equipe: 'admin',
    body: { userId: 'user-2', password: 'senha-bem-longa' },
  },
  { nome: 'milvus-atendimentos', equipe: 'filtra', body: {} },
  { nome: 'milvus-chamado-status', equipe: 'filtra', body: { visitIds: ['v1'] } },
  { nome: 'ia-levar', equipe: 'nenhum', body: {} },
  { nome: 'ia-relatorio', equipe: 'nenhum', body: {} },
  { nome: 'send-email', equipe: 'nenhum', body: {} },
  { nome: 'send-push', equipe: 'nenhum', body: {} },
  {
    nome: 'pendencia-responder',
    equipe: 'nenhum',
    body: { pendencia_id: 'p1', text: 'resposta de teste' },
  },
];

/** Status da resposta; se estourar DEPOIS do gate, o gate deixou passar. */
async function status(handler, req) {
  try {
    return (await handler(req)).status;
  } catch {
    return 0;
  }
}

describe('Edge Functions: as 14 com JWT estão na lista', () => {
  it('a lista cobre todas as functions que exigem usuário', async () => {
    const fs = await import('node:fs');
    const dir = new URL('../supabase/functions/', import.meta.url);
    const comJwt = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && fs.existsSync(new URL(`${e.name}/index.ts`, dir)))
      .filter((e) => {
        const src = fs.readFileSync(new URL(`${e.name}/index.ts`, dir), 'utf8');
        // Forma nova (withSupabase faz o gate) ou a antiga, que ainda existe
        // nas functions autenticadas por segredo próprio.
        return /auth:\s*["']user["']/.test(src) || /auth\.getUser\(/.test(src);
      })
      .map((e) => e.name)
      .sort();
    expect(FUNCTIONS.map((f) => f.nome).sort()).toEqual(comJwt);
  });
});

describe('contrato 1 — sem JWT → 401', () => {
  for (const f of FUNCTIONS) {
    it(`${f.nome} recusa quem não mandou Bearer`, async () => {
      const { handler } = await loadHandler(f.nome, dubles(ATIVO));
      expect(await status(handler, reqPost(f.body))).toBe(401);
    });
  }
});

describe('contrato 2 — operador inativo → bloqueado', () => {
  for (const f of FUNCTIONS) {
    it(`${f.nome} recusa operador desativado`, async () => {
      const { handler } = await loadHandler(f.nome, dubles(INATIVO));
      expect([401, 403]).toContain(await status(handler, reqPost(f.body, 'jwt-valido')));
    });
  }
});

describe('contrato 3 — operador de outra equipe → 403', () => {
  for (const f of FUNCTIONS.filter((x) => x.equipe === 'cliente')) {
    it(`${f.nome} nega cliente de outra equipe`, async () => {
      const { handler } = await loadHandler(f.nome, dubles(ATIVO));
      expect(await status(handler, reqPost(f.body, 'jwt-valido'))).toBe(403);
    });
  }
  for (const f of FUNCTIONS.filter((x) => x.equipe === 'admin')) {
    it(`${f.nome} nega operador comum (exige admin)`, async () => {
      const { handler } = await loadHandler(f.nome, dubles(ATIVO));
      expect(await status(handler, reqPost(f.body, 'jwt-valido'))).toBe(403);
    });
  }
});

describe('contrato 4 — admin ativo passa o gate', () => {
  for (const f of FUNCTIONS) {
    it(`${f.nome} deixa o admin entrar`, async () => {
      const { handler } = await loadHandler(f.nome, dubles(ADMIN));
      // O que vem depois (400 por corpo, 404, 200…) é problema de cada
      // function; o contrato aqui é só que a autorização não barrou.
      expect([401, 403]).not.toContain(await status(handler, reqPost(f.body, 'jwt-valido')));
    });
  }
});
