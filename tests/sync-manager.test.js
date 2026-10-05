import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const syncMgr = require('../js/sync-manager.js');
const outbox = require('../js/outbox.js');

const { _syncBackoffDelay, shouldApplyRemote } = syncMgr;
const { buildOutboxEntry } = outbox;

describe('SyncManager — LWW por updated_at', () => {
  it('sem local aplica remoto', () => {
    expect(shouldApplyRemote(null, { id: 'a', updatedAt: '2026-01-01T00:00:00.000Z' }, false)).toBe(true);
  });
  it('remoto mais novo vence', () => {
    const local = { id: 'a', updatedAt: '2026-01-01T00:00:00.000Z' };
    const remote = { id: 'a', updatedAt: '2026-01-02T00:00:00.000Z' };
    expect(shouldApplyRemote(local, remote, false)).toBe(true);
  });
  it('local mais novo vence', () => {
    const local = { id: 'a', updatedAt: '2026-01-03T00:00:00.000Z' };
    const remote = { id: 'a', updatedAt: '2026-01-02T00:00:00.000Z' };
    expect(shouldApplyRemote(local, remote, false)).toBe(false);
  });
  it('local na outbox nunca perde (será enviado no drain)', () => {
    const local = { id: 'a', updatedAt: '2026-01-01T00:00:00.000Z' };
    const remote = { id: 'a', updatedAt: '2026-06-01T00:00:00.000Z' };
    expect(shouldApplyRemote(local, remote, true)).toBe(false);
  });
  it('empate usa id como desempate determinístico (clock skew)', () => {
    const t = '2026-01-01T00:00:00.000Z';
    expect(shouldApplyRemote({ id: 'a', updatedAt: t }, { id: 'b', updatedAt: t }, false)).toBe(true);
    expect(shouldApplyRemote({ id: 'b', updatedAt: t }, { id: 'a', updatedAt: t }, false)).toBe(false);
  });
});

describe('SyncManager — backoff exponencial', () => {
  it('cresce com as tentativas e respeita o teto', () => {
    const d0 = _syncBackoffDelay(0);
    const d3 = _syncBackoffDelay(3);
    const d20 = _syncBackoffDelay(20);
    expect(d0).toBeGreaterThanOrEqual(1000);
    expect(d3).toBeGreaterThan(d0);
    expect(d20).toBeLessThanOrEqual(30500);
  });
});

describe('Outbox — construção da entrada', () => {
  it('monta entrada persistente com alvo e payload', () => {
    const e = buildOutboxEntry('pendencias', 'upsert', { id: 'PEN-1', assunto: 'X' });
    expect(e.entity).toBe('pendencias');
    expect(e.op).toBe('upsert');
    expect(e.targetId).toBe('PEN-1');
    expect(e.payload.id).toBe('PEN-1');
    expect(typeof e.createdAt).toBe('string');
  });
  it('sem id não gera entrada válida', () => {
    const e = buildOutboxEntry('pendencias', 'upsert', {});
    expect(e.targetId).toBe('');
  });
});
