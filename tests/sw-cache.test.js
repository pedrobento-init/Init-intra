import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// SW e Cache Storage: requisiÃ§Ãµes autenticadas (apikey/Authorization) nÃ£o
// podem ser cacheadas â€” a chave da cache Ã© sÃ³ a URL e ignora o Authorization,
// logo dados de um usuÃ¡rio serviriam a outro numa sessÃ£o seguinte offline.
const swSource = fs.readFileSync(fileURLToPath(new URL('../sw.js', import.meta.url)), 'utf8');

const APP_ORIGIN = 'https://app.test';

function loadSW({ fetchImpl } = {}) {
  const listeners = {};
  const cacheStore = new Map();
  const sandbox = {
    console,
    URL,
    Promise,
    setTimeout,
    self: {
      skipWaiting() {},
      clients: { claim() {} },
      location: { origin: APP_ORIGIN },
      addEventListener(type, fn) {
        listeners[type] = fn;
      },
    },
    caches: {
      async open(name) {
        if (!cacheStore.has(name)) cacheStore.set(name, new Map());
        const store = cacheStore.get(name);
        return {
          put: async (req, res) => {
            store.set(typeof req === 'string' ? req : req.url, res);
          },
          keys: async () => [...store.keys()],
          delete: async (k) => store.delete(typeof k === 'string' ? k : k.url),
        };
      },
      async keys() {
        return [...cacheStore.keys()];
      },
      async delete(name) {
        return cacheStore.delete(name);
      },
      async match() {
        return undefined;
      },
    },
    Response: { error: () => ({ type: 'error' }) },
    fetch:
      fetchImpl ||
      (async () => ({
        ok: true,
        status: 200,
        clone() {
          return this;
        },
      })),
  };
  vm.createContext(sandbox);
  vm.runInContext(swSource, sandbox);
  return { listeners, cacheStore };
}

function dispatchFetch(listeners, req) {
  let responded = null;
  const event = {
    request: req,
    respondWith(p) {
      responded = p;
    },
    waitUntil() {},
  };
  listeners.fetch(event);
  return responded;
}

function makeRequest(url, headers = {}) {
  const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    method: 'GET',
    url,
    mode: 'cors',
    headers: { has: (name) => map.has(String(name).toLowerCase()) },
  };
}

describe('sw.js e respostas autenticadas', () => {
  let listeners;
  beforeEach(() => {
    ({ listeners } = loadSW());
  });

  it('registra o handler de fetch', () => {
    expect(typeof listeners.fetch).toBe('function');
  });

  it('NÃƒO intercepta GET do Supabase (apikey/authorization)', () => {
    const withApikey = dispatchFetch(
      listeners,
      makeRequest('https://proj.supabase.co/rest/v1/pendencias?select=*', { apikey: 'anon-key' })
    );
    const withBearer = dispatchFetch(
      listeners,
      makeRequest('https://proj.supabase.co/storage/v1/object/attachments/x.png', {
        authorization: 'Bearer x',
      })
    );
    expect(withApikey).toBeNull();
    expect(withBearer).toBeNull();
  });

  it('intercepta e cacheia assets da mesma origem', async () => {
    const p = dispatchFetch(listeners, makeRequest(APP_ORIGIN + '/js/app.js'));
    expect(p).not.toBeNull();
    await expect(p).resolves.toBeTruthy();
  });

  it('intercepta e cacheia CDN sem credenciais', async () => {
    const p = dispatchFetch(
      listeners,
      makeRequest('https://cdn.jsdelivr.net/npm/dexie@3.2.4/dist/dexie.min.js')
    );
    expect(p).not.toBeNull();
    await expect(p).resolves.toBeTruthy();
  });

  it('ignora requisiÃ§Ãµes nÃ£o-GET', () => {
    const req = makeRequest(APP_ORIGIN + '/rest/v1/x', { apikey: 'k' });
    req.method = 'POST';
    expect(dispatchFetch(listeners, req)).toBeNull();
  });
});

describe('sw.js e imagens de outros domínios', () => {
  let listeners;
  beforeEach(() => {
    ({ listeners } = loadSW());
  });

  // fetch() do SW obedece ao connect-src: interceptar a foto do contato do
  // WhatsApp fazia o CSP barrar a busca e a foto nunca carregava.
  it('não intercepta host fora do connect-src (foto do WhatsApp)', () => {
    const p = dispatchFetch(
      listeners,
      makeRequest('https://pps.whatsapp.net/v/t61.24694-24/foto.jpg?ccb=11-4')
    );
    expect(p).toBeNull();
  });

  it('a lista de hosts do SW é a mesma do connect-src do CSP', () => {
    const vercel = fs.readFileSync(
      fileURLToPath(new URL('../vercel.json', import.meta.url)),
      'utf8'
    );
    const connect = /connect-src ([^;]+)/.exec(vercel)[1];
    const hosts = connect
      .split(/\s+/)
      .filter((h) => h.startsWith('https://'))
      .map((h) => h.replace('https://', '').replace('*.', 'proj.'));
    const re = /SW_HOSTS_CACHEAVEIS = (\/.+\/);/.exec(swSource)[1];
    const regex = vm.runInNewContext(re);
    for (const h of hosts) expect(regex.test(h), h).toBe(true);
    expect(regex.test('pps.whatsapp.net')).toBe(false);
  });

  it('sem rede e sem cópia em cache responde erro de rede, nunca undefined', async () => {
    const { listeners: l } = loadSW({
      fetchImpl: async () => {
        throw new TypeError('offline');
      },
    });
    const local = dispatchFetch(l, makeRequest(APP_ORIGIN + '/js/app.js'));
    await expect(local).resolves.toEqual({ type: 'error' });
    const cdn = dispatchFetch(l, makeRequest('https://cdn.jsdelivr.net/npm/x@1/x.js'));
    await expect(cdn).resolves.toEqual({ type: 'error' });
  });
});
