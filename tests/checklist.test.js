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
     'findProceduresByCategoria', 'orderChecklists', 'groupsToFlat',
     'renumberGroups', 'moveItemDir', 'moveItemBefore', 'countItemsByChecklist',
     'checklistCategoriaOptions']
      .forEach(k => expect(typeof mod[k]).toBe('function'));
    expect(mod.CHECKLIST_SEM_PROC).toBe('Geral');
    expect(mod.CHECKLIST_CATEGORIAS)
      .toEqual(['Estações', 'Servidor(es)', 'E-mails', 'Impressora', 'Sistemas', 'Firewall', 'Geral']);
  });

  it('modelo padrão tem 14/9/14 itens, ids únicos e ordem sequencial por checklist', () => {
    const ids = mod.CHECKLIST_MODELO_DEFAULT.map(i => i.id);
    expect(new Set(ids).size).toBe(ids.length);

    ['instalacao', 'troca', 'saida'].forEach(tipo => {
      const itens = mod.CHECKLIST_MODELO_DEFAULT.filter(i => i.tipo === tipo);
      expect(itens.length).toBe(tipo === 'troca' ? 9 : 14);
      expect(itens.every(i => i.ativo === true)).toBe(true);
      expect(itens.every(i => i.texto && i.categoria)).toBe(true);
      expect(itens.map(i => i.ordem)).toEqual(itens.map((_, n) => n + 1));
    });

    // todos os itens apontam para um checklist existente
    const cks = new Set(mod.CHECKLISTS_DEFAULT.map(c => c.id));
    expect(mod.CHECKLIST_MODELO_DEFAULT.every(i => cks.has(i.tipo))).toBe(true);
    expect(mod.CHECKLISTS_DEFAULT.every(c => c.ativo === true)).toBe(true);
  });

  it('ordena os checklists por ordem e depois nome', () => {
    const l = [
      { id: 'b', nome: 'Zebra', ordem: 1 },
      { id: 'a', nome: 'Alpha', ordem: 2 },
      { id: 'c', nome: 'Casca', ordem: 0 },
      null,
    ];
    expect(mod.orderChecklists(l).map(x => x.id)).toEqual(['c', 'b', 'a']);
    expect(mod.orderChecklists(null)).toEqual([]);
  });

  it('agrupa por categoria preservando a ordem do modelo', () => {
    const itens = [
      { id: 'a', categoria: 'Servidor(es)', texto: 'Um', ordem: 1, ativo: true },
      { id: 'b', categoria: 'Estações', texto: 'Dois', ordem: 2, ativo: true },
      { id: 'c', categoria: 'Servidor(es)', texto: 'Três', ordem: 3, ativo: true },
      { id: 'd', categoria: 'Estações', texto: 'Fora', ordem: 4, ativo: false },
    ];
    const grupos = mod.groupChecklistItens(itens);
    expect(grupos.map(g => g.categoria)).toEqual(['Servidor(es)', 'Estações']);
    expect(grupos[0].itens.map(i => i.id)).toEqual(['a', 'c']);
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
    expect(mod.findProceduresByCategoria(procs, 'Geral')).toEqual([]);
    expect(mod.findProceduresByCategoria(procs, '')).toEqual([]);
    expect(mod.findProceduresByCategoria(null, 'Acesso')).toEqual([]);
    // categoria cadastrada mas sem texto -> abre o modal com o aviso de vazio
    expect(mod.findProceduresByCategoria(procs, 'Backup').map(p => p.id)).toEqual(['p3']);
  });

  it('renumberGroups renumera 1..n na ordem de exibição', () => {
    const flat = mod.groupsToFlat(mod.groupChecklistItens([
      { id: 'a', categoria: 'X', ordem: 5, ativo: true },
      { id: 'b', categoria: 'Y', ordem: 9, ativo: true },
      { id: 'c', categoria: 'X', ordem: 1, ativo: true },
    ]));
    // ordem 1 (c) abre o grupo X; grupo Y vem depois; dentro de X: c(1) antes de a(5)
    expect(flat.map(i => i.id)).toEqual(['c', 'a', 'b']);
    const ren = mod.renumberGroups(mod.groupChecklistItens([
      { id: 'a', categoria: 'X', ordem: 5, ativo: true },
      { id: 'b', categoria: 'Y', ordem: 9, ativo: true },
      { id: 'c', categoria: 'X', ordem: 1, ativo: true },
    ]));
    expect(ren.map(i => [i.id, i.ordem])).toEqual([['c', 1], ['a', 2], ['b', 3]]);
  });

  it('sobe/desce item dentro da categoria e recusa fora dos limites', () => {
    const g = mod.groupChecklistItens([
      { id: 'a', categoria: 'X', ordem: 1, ativo: true },
      { id: 'b', categoria: 'X', ordem: 2, ativo: true },
      { id: 'c', categoria: 'Y', ordem: 3, ativo: true },
    ]);
    expect(mod.moveItemDir(g, 'b', -1)[0].itens.map(i => i.id)).toEqual(['b', 'a']);
    expect(mod.moveItemDir(g, 'a', -1)).toBeNull();      // já é o primeiro
    expect(mod.moveItemDir(g, 'c', 1)).toBeNull();       // categoria com 1 item
    expect(mod.moveItemDir(g, 'inexistente', 1)).toBeNull();
    expect(g[0].itens.map(i => i.id)).toEqual(['a', 'b']); // original intocado
  });

  it('moveItemBefore reinserte antes do alvo e troca de categoria', () => {
    const g = mod.groupChecklistItens([
      { id: 'a', categoria: 'X', ordem: 1, ativo: true },
      { id: 'b', categoria: 'X', ordem: 2, ativo: true },
      { id: 'c', categoria: 'Y', ordem: 3, ativo: true },
    ]);
    const antes = mod.moveItemBefore(g, 'c', 'X', 'a');
    expect(antes.map(x => x.categoria)).toEqual(['X']);
    expect(antes[0].itens.map(i => i.id)).toEqual(['c', 'a', 'b']);
    expect(antes[0].itens[0].categoria).toBe('X'); // item trocou de categoria

    const noFim = mod.moveItemBefore(g, 'a', 'Y', null);
    expect(noFim[1].itens.map(i => i.id)).toEqual(['c', 'a']);

    expect(mod.moveItemBefore(g, 'a', 'X', 'a')).toBeNull();  // drop em cima de si
    expect(mod.moveItemBefore(g, 'inexistente', 'X', 'b')).toBeNull();
  });

  it('conta itens ativos/inativos por checklist', () => {
    const itens = [
      { id: 'a', tipo: 'ck1', ativo: true },
      { id: 'b', tipo: 'ck1', ativo: false },
      { id: 'c', tipo: 'ck1', ativo: true },
      { id: 'd', tipo: 'ck2', ativo: true },
    ];
    expect(mod.countItemsByChecklist(itens, 'ck1')).toEqual({ ativos: 2, inativos: 1 });
    expect(mod.countItemsByChecklist(itens, 'ck2')).toEqual({ ativos: 1, inativos: 0 });
    expect(mod.countItemsByChecklist(itens, 'x')).toEqual({ ativos: 0, inativos: 0 });
    expect(mod.countItemsByChecklist(null, 'ck1')).toEqual({ ativos: 0, inativos: 0 });
  });

  it('seletor de categoria sempre traz a atual mesmo fora da lista fixa', () => {
    expect(mod.checklistCategoriaOptions('Estações')).toContain('Estações');
    expect(mod.checklistCategoriaOptions('Hack')).toEqual(['Hack', ...mod.CHECKLIST_CATEGORIAS]);
    expect(mod.checklistCategoriaOptions(null)).toEqual(mod.CHECKLIST_CATEGORIAS);
  });

  it('normaliza categoria para comparação', () => {
    expect(mod.checklistNormCat('  Rede ')).toBe('rede');
    expect(mod.checklistNormCat(null)).toBe('');
    expect(mod.checklistNormCat(undefined)).toBe('');
    expect(mod.checklistNormCat(123)).toBe('123');
  });
});
