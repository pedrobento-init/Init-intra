import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

describe('Checklist (aba do cliente)', () => {
  let mod;

  beforeEach(() => {
    delete require.cache[require.resolve('../js/checklist.js')];
    mod = require('../js/checklist.js');
  });

  it('expõe as funções puras usadas pela UI', () => {
    ['checklistNormCat', 'groupChecklistItens', 'checklistProgress',
     'findProceduresByCategoria', 'checklistTipoLabel', 'checklistTipoDeItem']
      .forEach(k => expect(typeof mod[k]).toBe('function'));
    expect(mod.CHECKLIST_TIPOS.map(t => t.id))
      .toEqual(['instalacao', 'troca', 'saida']);
    expect(mod.CHECKLIST_SEM_PROC).toBe('Geral');
  });

  it('modelo padrão tem 14/9/14 itens, ids únicos e ordem sequencial por tipo', () => {
    const ids = mod.CHECKLIST_MODELO_DEFAULT.map(i => i.id);
    expect(new Set(ids).size).toBe(ids.length);

    ['instalacao', 'troca', 'saida'].forEach(tipo => {
      const itens = mod.CHECKLIST_MODELO_DEFAULT.filter(i => i.tipo === tipo);
      expect(itens.length).toBe(tipo === 'troca' ? 9 : 14);
      expect(itens.every(i => i.ativo === true)).toBe(true);
      expect(itens.every(i => i.texto && i.categoria)).toBe(true);
      expect(itens.map(i => i.ordem)).toEqual(itens.map((_, n) => n + 1));
    });
  });

  it('agrupa por categoria preservando a ordem do modelo', () => {
    const itens = [
      { id: 'a', tipo: 'instalacao', categoria: 'Servidor(es)', texto: 'Um', ordem: 1, ativo: true },
      { id: 'b', tipo: 'instalacao', categoria: 'Estações', texto: 'Dois', ordem: 2, ativo: true },
      { id: 'c', tipo: 'instalacao', categoria: 'Servidor(es)', texto: 'Três', ordem: 3, ativo: true },
      { id: 'd', tipo: 'instalacao', categoria: 'Estações', texto: 'Fora', ordem: 4, ativo: false },
    ];
    const grupos = mod.groupChecklistItens(itens);
    expect(grupos.map(g => g.categoria)).toEqual(['Servidor(es)', 'Estações']);
    expect(grupos[0].itens.map(i => i.id)).toEqual(['a', 'c']);
    // item inativo some do cálculo e da tela
    expect(grupos[1].itens.map(i => i.id)).toEqual(['b']);
    expect(mod.groupChecklistItens(null)).toEqual([]);
  });

  it('progresso conta só os itens marcados (não desmarcados nem inativos)', () => {
    const grupos = mod.groupChecklistItens([
      { id: 'a', categoria: 'Geral', ordem: 1, ativo: true },
      { id: 'b', categoria: 'Geral', ordem: 2, ativo: true },
      { id: 'c', categoria: 'Rede', ordem: 3, ativo: true },
    ]);
    expect(mod.checklistProgress(grupos, new Set())).toEqual({ done: 0, total: 3, pct: 0 });
    expect(mod.checklistProgress(grupos, new Set(['a', 'c']))).toEqual({ done: 2, total: 3, pct: 67 });
    expect(mod.checklistProgress(grupos, ['a', 'b', 'c'])).toEqual({ done: 3, total: 3, pct: 100 });
    expect(mod.checklistProgress([], new Set(['a']))).toEqual({ done: 0, total: 0, pct: 0 });
  });

  it('procedimentos casam com a categoria ignorando caixa e espaços', () => {
    const procs = [
      { id: 'p1', category: 'Acesso', title: 'Criar usuário', content: 'Passo 1' },
      { id: 'p2', category: ' rede ', title: 'Reset', content: 'Passo 2' },
      { id: 'p3', category: 'Backup', title: 'Agendar', content: '' },
    ];
    expect(mod.findProceduresByCategoria(procs, 'ACESSO').map(p => p.id)).toEqual(['p1']);
    expect(mod.findProceduresByCategoria(procs, 'Rede').map(p => p.id)).toEqual(['p2']);
    // categoria que não existe → botão "Ver procedimento" não aparece
    expect(mod.findProceduresByCategoria(procs, 'Geral')).toEqual([]);
    expect(mod.findProceduresByCategoria(procs, '')).toEqual([]);
    expect(mod.findProceduresByCategoria(null, 'Acesso')).toEqual([]);
    // categoria cadastrada mas sem texto → abre o modal com o aviso de vazio
    expect(mod.findProceduresByCategoria(procs, 'Backup').map(p => p.id)).toEqual(['p3']);
  });

  it('resolve tipo do item e rótulo do tipo', () => {
    expect(mod.checklistTipoLabel('instalacao')).toBe('Instalação');
    expect(mod.checklistTipoLabel('troca')).toBe('Troca de usuário');
    expect(mod.checklistTipoLabel('saida')).toBe('Saída de colaborador');
    expect(mod.checklistTipoLabel('x')).toBe('x');
    expect(mod.checklistTipoDeItem('inst-01')).toBe('instalacao');
    expect(mod.checklistTipoDeItem('troca-09')).toBe('troca');
    expect(mod.checklistTipoDeItem('desconhecido')).toBe('');
    expect(mod.checklistTipoDeItem('saida-14', [{ id: 'saida-14', tipo: 'saida' }])).toBe('saida');
  });

  it('itens de instalação cobrem as categorias esperadas (Geral incluída)', () => {
    const cats = new Set(mod.CHECKLIST_MODELO_DEFAULT
      .filter(i => i.tipo === 'instalacao').map(i => i.categoria));
    ['Estações', 'Servidor(es)', 'E-mails', 'Impressora', 'Sistemas', 'Geral']
      .forEach(c => expect(cats.has(c)).toBe(true));
    const catsSaida = new Set(mod.CHECKLIST_MODELO_DEFAULT
      .filter(i => i.tipo === 'saida').map(i => i.categoria));
    ['Firewall', 'E-mails', 'Sistemas', 'Estações', 'Geral', 'Servidor(es)']
      .forEach(c => expect(catsSaida.has(c)).toBe(true));
  });

  it('normaliza categoria para comparação', () => {
    expect(mod.checklistNormCat('  Rede ')).toBe('rede');
    expect(mod.checklistNormCat(null)).toBe('');
    expect(mod.checklistNormCat(undefined)).toBe('');
    expect(mod.checklistNormCat(123)).toBe('123');
  });
});
