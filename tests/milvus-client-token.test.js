import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const tk = require('../js/milvus-tickets.js');
const clients = require('../js/clients.js');
const schema = require('../js/schema.js');

describe('normalizeMilvusClientToken (só trim, sem transformar)', () => {
  it('remove espaços e preserva caixa', () => {
    expect(clients.normalizeMilvusClientToken('  2JWX2PU  ')).toBe('2JWX2PU');
    expect(clients.normalizeMilvusClientToken('AbC123')).toBe('AbC123');
  });
  it('vazio/null vira string vazia (sync grava NULL)', () => {
    expect(clients.normalizeMilvusClientToken('')).toBe('');
    expect(clients.normalizeMilvusClientToken(null)).toBe('');
    expect(clients.normalizeMilvusClientToken(undefined)).toBe('');
  });
});

describe('schema: clients carrega o token (realtime/merge sem perder)', () => {
  it('mapa remoto→local inclui milvus_client_token', () => {
    const ent = schema.ENTITIES.find((e) => e.table === 'clients');
    expect(ent.fields['milvus_client_token']).toBe('milvusClientToken');
    expect(schema._mapFromRemote({ milvus_client_token: 'ABC123' }, { milvus_client_token: 'milvusClientToken' }))
      .toEqual({ milvusClientToken: 'ABC123' });
  });
});

describe('resolveMilvusTicketsSyncState (contrato sem-token)', () => {
  it('code novo → no-token', () => {
    expect(tk.resolveMilvusTicketsSyncState({ success: false, code: 'MILVUS_CLIENT_TOKEN_NOT_CONFIGURED' }))
      .toEqual({ kind: 'no-token' });
  });
  it('legado unmapped → unmapped (compat pré-deploy)', () => {
    expect(tk.resolveMilvusTicketsSyncState({ success: true, unmapped: true }))
      .toEqual({ kind: 'unmapped' });
  });
  it('ok carrega synced; nulo é ok zerado', () => {
    expect(tk.resolveMilvusTicketsSyncState({ success: true, synced: 7 }))
      .toEqual({ kind: 'ok', synced: 7 });
    expect(tk.resolveMilvusTicketsSyncState(null))
      .toEqual({ kind: 'ok', synced: 0 });
  });
});

describe('sync envia SOMENTE clientId (token nunca sai do backend)', () => {
  const _g = globalThis;
  const _keep = {};
  for (const k of ['isSupabaseConnected', 'supabaseClient', 'getClientById', 'getSession', 'getOperators']) {
    _keep[k] = _g[k];
  }
  afterEach(() => {
    for (const k of Object.keys(_keep)) {
      if (_keep[k] === undefined) delete _g[k];
      else _g[k] = _keep[k];
    }
  });
  it('corpo do invoke é {clientId} — sem token, sem segredo', async () => {
    const bodies = [];
    _g.isSupabaseConnected = () => true;
    _g.supabaseClient = {
      functions: {
        invoke: async (_fn, { body }) => { bodies.push(body); return { data: { success: true, synced: 1 }, error: null }; },
      },
    };
    _g.getClientById = () => ({ id: 'CLI-1', team: 'mam', milvusClientToken: 'ABC123' });
    _g.getSession = () => ({ opId: 'OP-1', team: 'mam', isAdmin: false });
    _g.getOperators = () => [{ id: 'OP-1', team: 'mam', isAdmin: false, active: true }];
    await tk.syncClientMilvusTickets('CLI-1');
    expect(bodies).toEqual([{ clientId: 'CLI-1' }]);
    expect(JSON.stringify(bodies)).not.toContain('ABC123');
    expect(JSON.stringify(bodies).toLowerCase()).not.toContain('token');
    expect(JSON.stringify(bodies)).not.toContain('MILVUS_API_TOKEN');
  });
});
