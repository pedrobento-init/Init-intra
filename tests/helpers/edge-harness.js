// Carrega uma Edge Function de verdade dentro do vitest.
//
// As functions importam de https://deno.land/..., https://esm.sh/... e npm:...
// — por isso a Fase 1 só conseguiu travar o invariante estrutural
// (tests/edge-functions-guard.test.js).
//
// Há duas formas de function no repositório, e o harness carrega as duas:
//   - `withSupabase`: `export default { fetch: withSupabase({ auth }, handle) }`,
//     a forma que o AGENTS.md manda usar. O wrapper é quem faz o gate de JWT,
//     então o stub daqui emula esse gate e monta o `ctx` (supabaseAdmin,
//     userClaims) a partir do dublê do teste.
//   - `serve()`: a forma antiga, ainda nas 4 functions que autenticam por
//     segredo próprio (agenda-ics, avisos-prazo, google-agenda, robo).
//
// Aqui o esbuild (já vem com o vite) empacota o index.ts trocando esses
// especificadores por stubs: serve() guarda o handler em vez de abrir porta,
// createClient() devolve o dublê do teste, withSupabase faz o gate e nodemailer
// não manda e-mail. O bundle roda dentro de uma função cujos parâmetros
// sombreiam `Deno` e `fetch`, então nada escapa para a rede nem para o
// ambiente.
//
// O que isto cobre que o guarda estrutural não cobre: os 4 contratos de auth
// (sem JWT → 401, inativo → bloqueado, outra equipe → 403, admin passa).

import esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fnDir = fileURLToPath(new URL('../../supabase/functions/', import.meta.url));

const STUBS = {
  serve: 'export function serve(h) { __inject.handler = h; }',
  supabase:
    'export function createClient(url, key, opts) { return __inject.createClient(url, key, opts); }',
  nodemailer: 'export default { createTransport: (opts) => __inject.createTransport(opts) };',
  supabaseServer:
    'export function withSupabase(cfg, handle) { return __inject.withSupabase(cfg, handle); }',
};

const stubPlugin = {
  name: 'edge-stubs',
  setup(build) {
    build.onResolve({ filter: /^https:\/\/deno\.land\// }, () => ({
      path: 'serve',
      namespace: 'stub',
    }));
    build.onResolve({ filter: /^https:\/\/esm\.sh\// }, () => ({
      path: 'supabase',
      namespace: 'stub',
    }));
    build.onResolve({ filter: /^npm:@supabase\/server/ }, () => ({
      path: 'supabaseServer',
      namespace: 'stub',
    }));
    build.onResolve({ filter: /^npm:/ }, () => ({ path: 'nodemailer', namespace: 'stub' }));
    build.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
      contents: STUBS[args.path],
      loader: 'js',
    }));
  },
};

const bundles = new Map();

async function bundleOf(name) {
  if (!bundles.has(name)) {
    const out = await esbuild.build({
      entryPoints: [path.join(fnDir, name, 'index.ts')],
      bundle: true,
      write: false,
      format: 'cjs',
      platform: 'node',
      target: 'node20',
      plugins: [stubPlugin],
      logLevel: 'silent',
    });
    bundles.set(name, out.outputFiles[0].text);
  }
  return bundles.get(name);
}

/**
 * Devolve o handler que a function registrou em serve(), já com os dublês.
 * `env` é o Deno.env do teste; `fetch` e `createTransport` lançam se a function
 * tentar usá-los sem o teste ter pedido — chamada de rede em teste é bug.
 */
export async function loadHandler(
  name,
  { env = {}, createClient, createTransport, fetch: fetchImpl } = {}
) {
  const code = await bundleOf(name);
  const logs = [];
  const injectCreateClient =
    createClient ??
    (() => {
      throw new Error(`${name}: createClient() inesperado no teste`);
    });
  const inject = {
    handler: null,
    createClient: injectCreateClient,
    // Emula o withSupabase real: ele é quem verifica o JWT (auth: "user") e
    // entrega o ctx pronto. Sem isso o 401 do contrato 1 nunca aconteceria no
    // teste, porque a function migrada não tem mais esse gate no próprio código.
    withSupabase: (cfg, handle) => async (req) => {
      let ctx = { supabaseAdmin: null, userClaims: null };
      if (cfg?.auth === 'user') {
        const token = String(req.headers.get('Authorization') ?? '').replace(
          /^Bearer\s+/i,
          ''
        );
        if (!token) return new Response('Unauthorized', { status: 401 });
        const anon = injectCreateClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {});
        const { data } = await anon.auth.getUser(token);
        if (!data?.user) return new Response('Unauthorized', { status: 401 });
        ctx = {
          supabase: injectCreateClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
            global: { headers: { Authorization: `Bearer ${token}` } },
          }),
          supabaseAdmin: injectCreateClient(
            env.SUPABASE_URL,
            env.SUPABASE_SERVICE_ROLE_KEY,
            {}
          ),
          userClaims: { id: data.user.id },
        };
      } else {
        ctx = {
          supabase: injectCreateClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {}),
          supabaseAdmin: injectCreateClient(
            env.SUPABASE_URL,
            env.SUPABASE_SERVICE_ROLE_KEY,
            {}
          ),
          userClaims: null,
        };
      }
      return handle(req, ctx);
    },
    createTransport:
      createTransport ??
      (() => {
        throw new Error(`${name}: nodemailer inesperado no teste`);
      }),
  };
  const Deno = { env: { get: (k) => env[k], toObject: () => ({ ...env }) } };
  const fakeFetch =
    fetchImpl ??
    ((url) => {
      throw new Error(`${name}: fetch() inesperado no teste (${url})`);
    });
  // Silencioso, mas guardado: os testes de segredo conferem o que foi logado.
  const fakeConsole = {
    log: (...a) => logs.push(a.join(' ')),
    error: (...a) => logs.push(a.join(' ')),
    warn: (...a) => logs.push(a.join(' ')),
    info: (...a) => logs.push(a.join(' ')),
    debug: (...a) => logs.push(a.join(' ')),
  };
  const run = new Function(
    '__inject',
    'Deno',
    'fetch',
    'console',
    'module',
    'exports',
    'require',
    code
  );
  const mod = { exports: {} };
  run(inject, Deno, fakeFetch, fakeConsole, mod, mod.exports, (m) => {
    throw new Error(`${name}: require("${m}") inesperado`);
  });
  // `serve()` na forma antiga; `export default { fetch }` na forma withSupabase.
  const handler = inject.handler ?? mod.exports?.default?.fetch;
  if (typeof handler !== 'function') {
    throw new Error(`${name}: nem serve() nem export default registraram handler`);
  }
  return { handler, logs };
}

/** Request POST com ou sem Bearer. */
export function reqPost(body, token) {
  return new Request('https://fn.local/', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
}
