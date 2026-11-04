import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { visitFollowupData, createVisitFollowups } = require('../js/visita-acompanhamento.js');

const visit = {
  id: 'v1', clientId: 'c1', clientName: 'Cliente', operator: 'Ana', team: 'init',
  checklist: [{ text: 'Trocar cabo', done: true }, { text: 'Revisar backup', done: false }, { text: 'Atualizar servidor', done: false }],
};

describe('acompanhamento da visita', () => {
  beforeEach(() => {
    globalThis.getPendencias = () => [];
  });

  it('transforma somente os itens pendentes selecionados em pendências vinculadas', () => {
    const saved = [];
    globalThis.savePendencia = data => { saved.push(data); return data; };
    const created = createVisitFollowups(visit, { itemIndexes: [1, 2], responsible: 'Beto', priority: 'alta', note: 'Agendar retorno' });
    expect(created).toHaveLength(2);
    expect(saved.map(p => p.assunto)).toEqual(['Revisar backup', 'Atualizar servidor']);
    expect(saved[0]).toMatchObject({ visitId: 'v1', clientId: 'c1', responsible: 'Beto', priority: 'alta', status: 'aberto', team: 'init' });
    expect(saved[0].descricao).toContain('Agendar retorno');
  });

  it('não duplica acompanhamento aberto da mesma visita e item', () => {
    const data = visitFollowupData(visit, visit.checklist[1]);
    globalThis.getPendencias = () => [{ ...data, id: 'p1' }];
    globalThis.savePendencia = () => { throw new Error('não deveria salvar'); };
    expect(createVisitFollowups(visit, { itemIndexes: [1] })).toEqual([]);
  });

  it('permite acompanhamento manual quando não há checklist', () => {
    const saved = [];
    globalThis.savePendencia = data => { saved.push(data); return data; };
    createVisitFollowups({ ...visit, checklist: [] }, { note: 'Verificar nobreak na próxima semana' });
    expect(saved).toHaveLength(1);
    expect(saved[0].descricao).toContain('Verificar nobreak');
  });

  it('não cria pendência vazia nem para item concluído', () => {
    globalThis.savePendencia = () => { throw new Error('não deveria salvar'); };
    expect(createVisitFollowups(visit, { itemIndexes: [0] })).toEqual([]);
    expect(createVisitFollowups(visit, { itemIndexes: [] })).toEqual([]);
  });
});
