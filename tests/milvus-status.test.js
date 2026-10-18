import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const S = require('../js/milvus-status.js');

const NOW = Date.parse('2026-10-15T12:00:00Z');
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

describe('classifyMilvusTicketStatus', () => {
  it('reconhece os status do Milvus', () => {
    expect(S.classifyMilvusTicketStatus('Finalizado')).toBe('finalizado');
    expect(S.classifyMilvusTicketStatus('A fazer')).toBe('aguardando');
    expect(S.classifyMilvusTicketStatus('Ag. atendimento')).toBe('aguardando');
    expect(S.classifyMilvusTicketStatus('Sem técnico')).toBe('aguardando');
    expect(S.classifyMilvusTicketStatus('Pausado')).toBe('pausado');
    expect(S.classifyMilvusTicketStatus('Cancelado')).toBe('cancelado');
    expect(S.classifyMilvusTicketStatus('Atendendo')).toBe('atendimento');
  });
});

describe('pickVisitsForMilvusStatus', () => {
  const v = (over) => Object.assign({ id: 'V' + Math.random(), date: '2026-10-14', milvusChamadoCodigo: 100 }, over);

  it('sem chamado não consulta; sem cache consulta', () => {
    const a = v({ id: 'A', milvusChamadoCodigo: null });
    const b = v({ id: 'B' });
    expect(S.pickVisitsForMilvusStatus([a, b], {}, NOW)).toEqual(['B']);
  });

  it('respeita o TTL: aberto 15 min, finalizado 12 h', () => {
    const vs = [v({ id: 'open-fresh' }), v({ id: 'open-old' }), v({ id: 'done-fresh' }), v({ id: 'done-old' })];
    const cache = {
      'open-fresh': { codigo: 100, kind: 'atendimento', checkedAt: iso(5 * 60e3) },
      'open-old': { codigo: 100, kind: 'atendimento', checkedAt: iso(20 * 60e3) },
      'done-fresh': { codigo: 100, kind: 'finalizado', checkedAt: iso(2 * 3600e3) },
      'done-old': { codigo: 100, kind: 'finalizado', checkedAt: iso(13 * 3600e3) },
    };
    expect(S.pickVisitsForMilvusStatus(vs, cache, NOW).sort()).toEqual(['done-old', 'open-old']);
  });

  it('visita antiga com chamado fechado sai da varredura; forçada entra sempre', () => {
    const old = v({ id: 'old', date: '2026-05-01' });
    const cache = { old: { codigo: 100, kind: 'finalizado', checkedAt: iso(48 * 3600e3) } };
    expect(S.pickVisitsForMilvusStatus([old], cache, NOW)).toEqual([]);
    expect(S.pickVisitsForMilvusStatus([old], cache, NOW, { force: ['old'] })).toEqual(['old']);
  });

  it('código mudou: o cache não vale', () => {
    const a = v({ id: 'A', milvusChamadoCodigo: 200 });
    const cache = { A: { codigo: 100, kind: 'atendimento', checkedAt: iso(1000) } };
    expect(S.pickVisitsForMilvusStatus([a], cache, NOW)).toEqual(['A']);
  });

  it('limita a 25 por chamada, mais recentes primeiro', () => {
    const vs = Array.from({ length: 30 }, (_, i) => v({ id: 'V' + i, date: '2026-10-' + String(i % 28 + 1).padStart(2, '0') }));
    const ids = S.pickVisitsForMilvusStatus(vs, {}, NOW);
    expect(ids).toHaveLength(25);
    expect(ids[0]).toBe('V27');
  });
});

describe('reconcileFinalizeFromMilvus', () => {
  const e = { codigo: 100, kind: 'finalizado' };
  it('Milvus finalizado + finalização pendente/erro no app → dá como finalizado', () => {
    expect(S.reconcileFinalizeFromMilvus({ milvusChamadoCodigo: 100, milvusFinalizarStatus: 'erro' }, e)).toEqual({ milvusFinalizarStatus: 'finalizado', milvusFinalizarErro: null });
    expect(S.reconcileFinalizeFromMilvus({ milvusChamadoCodigo: 100, milvusFinalizarStatus: 'pendente' }, e)).not.toBeNull();
  });
  it('não mexe em voo, já finalizado, outro código ou Milvus aberto', () => {
    expect(S.reconcileFinalizeFromMilvus({ milvusChamadoCodigo: 100, milvusFinalizarStatus: 'finalizando' }, e)).toBeNull();
    expect(S.reconcileFinalizeFromMilvus({ milvusChamadoCodigo: 100, milvusFinalizarStatus: 'finalizado' }, e)).toBeNull();
    expect(S.reconcileFinalizeFromMilvus({ milvusChamadoCodigo: 101, milvusFinalizarStatus: 'erro' }, e)).toBeNull();
    expect(S.reconcileFinalizeFromMilvus({ milvusChamadoCodigo: 100, milvusFinalizarStatus: 'erro' }, { codigo: 100, kind: 'atendimento' })).toBeNull();
  });
});

describe('toMilvusStatusEntry', () => {
  it('não encontrado vira nao_encontrado', () => {
    expect(S.toMilvusStatusEntry({ codigo: 5, found: false }, 'x').kind).toBe('nao_encontrado');
  });
  it('guarda técnico, datas e última log', () => {
    const e = S.toMilvusStatusEntry({ codigo: 5, found: true, status: 'Atendendo', tecnico: 'Ana', data_modificacao: 'm', ultima_log: { texto: 'Trocado HD', tecnico: 'Ana' } }, 'now');
    expect(e).toMatchObject({ codigo: 5, kind: 'atendimento', tecnico: 'Ana', modificado: 'm', ultimaLog: { texto: 'Trocado HD' }, checkedAt: 'now' });
  });
});
