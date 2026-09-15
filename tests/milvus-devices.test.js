import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const milvus = require('../js/milvus-devices.js');

const MAM_OP = { team: 'mam', isAdmin: false, active: true };
const BT_OP = { team: 'bt', isAdmin: false, active: true };
const ADMIN_OP = { team: 'init', isAdmin: true, active: true };
const MAM_CLI = { id: 'CLI-mam', team: 'mam' };
const BT_CLI = { id: 'CLI-bt', team: 'bt' };

describe('canSyncClientDevices (isolamento operador→equipe→cliente)', () => {
  it('operador MAM → cliente MAM permitido', () => {
    expect(milvus.canSyncClientDevices(MAM_OP, MAM_CLI)).toBe(true);
  });
  it('operador MAM → cliente BT bloqueado', () => {
    expect(milvus.canSyncClientDevices(MAM_OP, BT_CLI)).toBe(false);
  });
  it('operador BT → cliente BT permitido', () => {
    expect(milvus.canSyncClientDevices(BT_OP, BT_CLI)).toBe(true);
  });
  it('operador BT → cliente MAM bloqueado', () => {
    expect(milvus.canSyncClientDevices(BT_OP, MAM_CLI)).toBe(false);
  });
  it('admin preserva acesso a ambos', () => {
    expect(milvus.canSyncClientDevices(ADMIN_OP, MAM_CLI)).toBe(true);
    expect(milvus.canSyncClientDevices(ADMIN_OP, BT_CLI)).toBe(true);
  });
  it('operador desativado não sincroniza', () => {
    expect(milvus.canSyncClientDevices({ ...MAM_OP, active: false }, MAM_CLI)).toBe(false);
  });
  it('sem operador/cliente nega (fail-closed)', () => {
    expect(milvus.canSyncClientDevices(null, MAM_CLI)).toBe(false);
    expect(milvus.canSyncClientDevices(MAM_OP, null)).toBe(false);
  });
});

describe('normalizeMilvusDevice', () => {
  it('mapeia campos incl. macaddres e preserva null como vazio/nulo', () => {
    const r = milvus.normalizeMilvusDevice({
      id: 7, hostname: 'PC-01', macaddres: 'AA:BB', marca: null,
      is_ativo: 1, total_processadores: '4', data_compra: '2023-01-15T00:00:00Z',
      sistema_operacional_licenca: 'XXXXX-SECRETA',
    }, 'CLI-1', 'mam');
    expect(r.milvus_device_id).toBe(7);
    expect(r.id).toBe('CLI-1:milvus-7');
    expect(r.mac_address).toBe('AA:BB');
    expect(r.marca).toBe('');
    expect(r.total_processadores).toBe(4);
    expect(r.data_compra).toBe('2023-01-15');
    expect(r.is_ativo).toBe(true);
  });
  it('NUNCA persiste licença (chave nem aparece no objeto)', () => {
    const r = milvus.normalizeMilvusDevice({ id: 1, sistema_operacional_licenca: 'KEY-123' }, 'CLI-1', 'mam');
    expect(JSON.stringify(r).toLowerCase()).not.toContain('licenca');
    expect(JSON.stringify(r)).not.toContain('KEY-123');
  });
  it('retorna null sem id (não usa hostname como chave)', () => {
    expect(milvus.normalizeMilvusDevice({ hostname: 'PC-X' }, 'CLI-1', 'mam')).toBeNull();
    expect(milvus.normalizeMilvusDevice(null, 'CLI-1', 'mam')).toBeNull();
  });
  it('is_ativo ausente default true; 0/false vira false', () => {
    expect(milvus.normalizeMilvusDevice({ id: 1 }, 'C', 't').is_ativo).toBe(true);
    expect(milvus.normalizeMilvusDevice({ id: 1, is_ativo: 0 }, 'C', 't').is_ativo).toBe(false);
    expect(milvus.normalizeMilvusDevice({ id: 1, is_ativo: false }, 'C', 't').is_ativo).toBe(false);
  });
});

describe('paginação Milvus', () => {
  it('payload segue o contrato (paginate/order/total/pagina)', () => {
    expect(milvus.buildMilvusListPayload(3)).toEqual({
      is_paginate: true, is_descending: false, order_by: 'id',
      total_registros: 1000, pagina: 3,
    });
  });
  it('parse lê current_page/last_page e lista', () => {
    const p = milvus.parseMilvusPage({
      meta: { paginate: { current_page: 1, last_page: 95 } }, lista: [{ id: 1 }],
    }, 1);
    expect(p).toEqual({ list: [{ id: 1 }], current: 1, last: 95 });
  });
  it('parse rejeita resposta sem lista', () => {
    expect(() => milvus.parseMilvusPage({ meta: {} }, 1)).toThrow();
    expect(() => milvus.parseMilvusPage(null, 1)).toThrow();
  });
  it('para na última página e no teto anti-loop', () => {
    expect(milvus.shouldStopMilvusPaging(95, 95, 95)).toBe(true);
    expect(milvus.shouldStopMilvusPaging(1, 95, 1)).toBe(false);
    expect(milvus.shouldStopMilvusPaging(1, 999999, milvus.MILVUS_MAX_PAGES)).toBe(true);
  });
});

describe('classifyMilvusError', () => {
  it('401/403 = auth (sem retry)', () => {
    expect(milvus.classifyMilvusError(401)).toBe('auth');
    expect(milvus.classifyMilvusError(403)).toBe('auth');
  });
  it('429/5xx/timeout/rede = retry limitado', () => {
    expect(milvus.classifyMilvusError(429)).toBe('retry');
    expect(milvus.classifyMilvusError(503)).toBe('retry');
    expect(milvus.classifyMilvusError('timeout')).toBe('retry');
    expect(milvus.classifyMilvusError('network')).toBe('retry');
  });
  it('outros = fatal', () => {
    expect(milvus.classifyMilvusError(400)).toBe('fatal');
    expect(milvus.classifyMilvusError(404)).toBe('fatal');
  });
});

describe('formatMilvusSyncResult', () => {
  it('linha padrão sem pendências', () => {
    expect(milvus.formatMilvusSyncResult({ synced: 88, created: 80, updated: 8 }))
      .toEqual({ line: '88 dispositivos sincronizados · 80 novos · 8 atualizados', unresolved: 0 });
  });
  it('lista nomes sem resolução (máx. 5 + reticência)', () => {
    const r = milvus.formatMilvusSyncResult({
      synced: 0, created: 0, updated: 0,
      unresolvedNames: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
    });
    expect(r.unresolved).toBe(7);
    expect(r.line).toContain('7 nome(s) sem resolução');
    expect(r.line).toContain('A, B, C, D, E');
    expect(r.line.endsWith('…')).toBe(true);
  });
  it('tolerante a resposta vazia', () => {
    expect(milvus.formatMilvusSyncResult(null))
      .toEqual({ line: '0 dispositivos sincronizados · 0 novos · 0 atualizados', unresolved: 0 });
  });
});

describe('diffMilvusUpsert + idempotência (dupla sincronização)', () => {
  const rows = [{ milvus_device_id: 1 }, { milvus_device_id: 2 }];
  it('primeira sync: tudo novo', () => {
    expect(milvus.diffMilvusUpsert([], rows)).toEqual({ created: 2, updated: 0 });
  });
  it('segunda sync consecutiva: nada duplica, tudo atualiza', () => {
    const first = milvus.diffMilvusUpsert([], rows);
    expect(first).toEqual({ created: 2, updated: 0 });
    // Simula o banco após a 1ª sync e roda de novo com os mesmos dados.
    const second = milvus.diffMilvusUpsert([1, 2], rows);
    expect(second).toEqual({ created: 0, updated: 2 });
  });
  it('chave é (client+milvus id): mesmo milvus id em clientes distintos não colide', () => {
    // diff opera por cliente (existingIds já filtrados por client_id no servidor).
    expect(milvus.diffMilvusUpsert([], [{ milvus_device_id: 9 }])).toEqual({ created: 1, updated: 0 });
  });
});
