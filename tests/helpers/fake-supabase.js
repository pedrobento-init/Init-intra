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
 */
export function fakeSupabase({ tabelas = {}, token = 'jwt-valido', user = null } = {}) {
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
      from: (tabela) => builder(tabelas[tabela] ?? []),
    };
  };
}

function builder(linhas) {
  let out = linhas.slice();
  const api = {
    select: () => api,
    eq: (col, val) => {
      out = out.filter((r) => r[col] === val);
      return api;
    },
    in: (col, vals) => {
      out = out.filter((r) => vals.includes(r[col]));
      return api;
    },
    not: () => api,
    is: () => api,
    gte: () => api,
    lte: () => api,
    order: () => api,
    limit: (n) => {
      out = out.slice(0, n);
      return api;
    },
    range: () => api,
    maybeSingle: async () => ({ data: out[0] ?? null, error: null }),
    single: async () => ({
      data: out[0] ?? null,
      error: out[0] ? null : { message: 'no rows returned' },
    }),
    then: (res, rej) => Promise.resolve({ data: out, error: null }).then(res, rej),
  };
  return api;
}
