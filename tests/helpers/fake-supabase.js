// Dublê do @supabase/supabase-js para os testes das Edge Functions.
//
// Cobre só o que as functions usam: auth.getUser (com token no argumento, como
// nas milvus-*, ou com o Authorization do createClient, como na send-email e
// send-push) e o encadeamento from().select().eq().maybeSingle(). O builder é
// "thenable", então `await sb.from(t).select(c)` devolve a lista — é assim que
// a send-email lê os destinatários permitidos.

/**
 * @param tabelas  { operators: [...], clients: [...], ... }
 * @param token    o único Bearer considerado válido; qualquer outro = anônimo
 * @param user     o usuário que o token representa ({ id })
 * @param queries  array onde cada from() registra { tabela, filtros, patch, insert }
 *                 — é como o teste confere o ESCOPO de um update/insert sem
 *                 reimplementar a function.
 */
export function fakeSupabase({ tabelas = {}, token = 'jwt-valido', user = null, queries = [] } = {}) {
  return function createClient(_url, _key, opts = {}) {
    const doHeader = String(opts?.global?.headers?.Authorization ?? '').replace(/^Bearer\s+/i, '');
    return {
      auth: {
        getUser: async (arg) => {
          const t = arg ?? doHeader;
          return t && t === token
            ? { data: { user }, error: null }
            : { data: { user: null }, error: null };
        },
      },
      from: (tabela) => builder(tabelas[tabela] ?? [], tabela, queries),
      // RPC sem regra: as functions testadas aqui só usam rpc para leitura
      // opcional (clientes_do_telefone). Quem precisar de outra resposta
      // envolve o createClient no próprio teste.
      rpc: async () => ({ data: [], error: null }),
    };
  };
}

function builder(linhas, tabela = '', queries = null) {
  let out = linhas.slice();
  const registro = queries ? { tabela, filtros: [], patch: null, insert: null } : null;
  if (registro) queries.push(registro);
  const api = {
    select: () => api,
    eq: (col, val) => {
      if (registro) registro.filtros.push([col, val]);
      out = out.filter((r) => r[col] === val);
      return api;
    },
    in: (col, vals) => {
      if (registro) registro.filtros.push([col, vals, 'in']);
      out = out.filter((r) => vals.includes(r[col]));
      return api;
    },
    not: () => api,
    is: (col, val) => {
      if (registro) registro.filtros.push([col, val, 'is']);
      out = out.filter((r) => r[col] == val);
      return api;
    },
    gte: () => api,
    lte: () => api,
    order: () => api,
    limit: (n) => {
      out = out.slice(0, n);
      return api;
    },
    range: () => api,
    // Fire-and-forget de `last_used_at` no agenda-ics: sem o update o handler
    // estoura antes de montar o .ics.
    update: (patch) => {
      if (registro) registro.patch = patch;
      return api;
    },
    insert: (valor) => {
      if (registro) registro.insert = valor;
      return api;
    },
    delete: () => api,
    upsert: () => api,
    maybeSingle: async () => ({ data: out[0] ?? null, error: null }),
    single: async () => ({
      data: out[0] ?? null,
      error: out[0] ? null : { message: 'no rows returned' },
    }),
    then: (res, rej) => Promise.resolve({ data: out, error: null }).then(res, rej),
  };
  return api;
}
