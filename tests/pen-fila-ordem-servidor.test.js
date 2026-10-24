import { createRequire as __storageReq } from 'node:module';
const { requireStorage } = __storageReq(import.meta.url)('./_storage.cjs');
import { describe, it, expect, beforeEach } from 'vitest';

// ── Ordenação da fila no servidor ─────────────────────────────────────────
// A fila ordenava só as linhas já carregadas enquanto o cabeçalho prometia a
// tabela inteira. A coluna agora viaja para o ORDER BY nas colunas que o
// banco ordena igual ao comparador local; nas outras a fila diz o alcance.

// Builder mock que registra as chamadas encadeáveis (padrão de pagination.test.js).
function mockQ(resposta) {
  const calls = [];
  const q = {};
  for (const m of ['eq', 'in', 'not', 'or', 'order', 'select']) {
    q[m] = (...args) => { calls.push([m, ...args]); return q; };
  }
  q.range = (...args) => { calls.push(['range', ...args]); return Promise.resolve(resposta); };
  q.calls = calls;
  return q;
}
const orders = (q) => q.calls.filter(([m]) => m === 'order').map(([, col, opts]) => [col, opts]);

let storage;
let ultimaQ;
beforeEach(() => {
  globalThis.getOperatorNames = () => [];
  globalThis.escapeHtml = (s) => String(s ?? '');
  globalThis.ENTITIES = [{ table: 'pendencias', fields: { id: 'id', created_at: 'createdAt' } }];
  globalThis.supabaseClient = {
    from: () => { ultimaQ = mockQ({ data: [], count: 0, error: null }); return ultimaQ; },
  };
  storage = requireStorage();
});

describe('penSortRemoteCol: quem o banco sabe ordenar', () => {
  it('as colunas que são coluna de verdade viajam para o ORDER BY', () => {
    expect(storage.penSortRemoteCol('data')).toBe('created_at');
    expect(storage.penSortRemoteCol('cliente')).toBe('client_name');
    expect(storage.penSortRemoteCol('solicitante')).toBe('solicitante');
    expect(storage.penSortRemoteCol('responsavel')).toBe('responsible');
    expect(storage.penSortRemoteCol('prazo')).toBe('deadline');
  });

  it('Protocolo é a posição na ordem de criação, então vira created_at', () => {
    expect(storage.penSortRemoteCol('numero')).toBe('created_at');
  });

  it('título é derivado: o banco não tem essa coluna para ordenar', () => {
    expect(storage.penSortRemoteCol('titulo')).toBe(null);
  });

  it('status e prioridade pedem ordem de negócio, não alfabética', () => {
    // No banco "alta" < "baixa" < "critica" < "media" — o contrário do que vale.
    expect(storage.penSortRemoteCol('status')).toBe(null);
    expect(storage.penSortRemoteCol('prioridade')).toBe(null);
  });

  it('nada fora da lista entra, nem o que vem do Object.prototype', () => {
    expect(storage.penSortRemoteCol('')).toBe(null);
    expect(storage.penSortRemoteCol(null)).toBe(null);
    expect(storage.penSortRemoteCol('drop table')).toBe(null);
    expect(storage.penSortRemoteCol('constructor')).toBe(null);
    expect(storage.penSortRemoteCol('toString')).toBe(null);
  });
});

describe('fetchPendenciasPage: a ordem vira ORDER BY', () => {
  it('sem sort, mantém a ordem padrão de antes (mais novo primeiro)', async () => {
    await storage.fetchPendenciasPage({ scope: 'active', page: 0, pageSize: 50 });
    expect(orders(ultimaQ)).toEqual([
      ['created_at', { ascending: false }],
      ['id', { ascending: true }],
    ]);
  });

  it('coluna do banco: ordena por ela, com vazio por último e id de desempate', async () => {
    await storage.fetchPendenciasPage({ sort: { col: 'prazo', dir: 'asc' } });
    expect(orders(ultimaQ)).toEqual([
      ['deadline', { ascending: true, nullsFirst: false }],
      ['id', { ascending: true }],
    ]);
  });

  it('desc inverte a coluna, mas o vazio segue no fim', async () => {
    await storage.fetchPendenciasPage({ sort: { col: 'cliente', dir: 'desc' } });
    expect(orders(ultimaQ)[0]).toEqual(['client_name', { ascending: false, nullsFirst: false }]);
  });

  it('coluna que o banco não ordena cai na ordem padrão, sem inventar ORDER BY', async () => {
    await storage.fetchPendenciasPage({ sort: { col: 'prioridade', dir: 'desc' } });
    expect(orders(ultimaQ)).toEqual([
      ['created_at', { ascending: false }],
      ['id', { ascending: true }],
    ]);
  });

  it('a paginação segue igual: a ordem não mexe no range', async () => {
    await storage.fetchPendenciasPage({ page: 2, pageSize: 50, sort: { col: 'prazo', dir: 'asc' } });
    expect(ultimaQ.calls.find(([m]) => m === 'range')).toEqual(['range', 100, 149]);
  });
});
