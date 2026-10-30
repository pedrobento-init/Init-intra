import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// O módulo é script clássico: depende de globais (dbGet/dbSet/DB...). Aqui
// eles viram um armazenamento em memória, sem Supabase conectado.
let mem;
let rp;
beforeEach(() => {
  mem = {};
  globalThis.DB = { RESPOSTAS_PRONTAS: 'intra_respostas_prontas' };
  globalThis.dbGet = (k) => mem[k];
  globalThis.dbSet = (k, v) => { mem[k] = v; };
  globalThis.isSupabaseConnected = () => false;
  globalThis.getCurrentTeam = () => 'suporte';
  globalThis.getUser = () => ({ name: 'Ana' });
  globalThis.filterByTeam = (l) => l.filter((r) => r.team === 'suporte');
  delete require.cache[require.resolve('../js/respostas-prontas.js')];
  rp = require('../js/respostas-prontas.js');
});

describe('respostas prontas', () => {
  it('não salva sem título ou sem texto', () => {
    expect(rp.salvarRespostaPronta({ titulo: '  ', conteudo: 'x' })).toBeNull();
    expect(rp.salvarRespostaPronta({ titulo: 'x', conteudo: '' })).toBeNull();
    expect(rp.getRespostasProntas()).toEqual([]);
  });

  it('cria na equipe atual com autor', () => {
    const r = rp.salvarRespostaPronta({ titulo: 'Oi', conteudo: 'Recebemos.' });
    expect(r.id).toMatch(/^rp_/);
    expect(r.team).toBe('suporte');
    expect(r.createdBy).toBe('Ana');
  });

  it('edição mantém a equipe original da linha', () => {
    mem.intra_respostas_prontas = [{ id: 'a', titulo: 'T', conteudo: 'C', team: 'campo' }];
    const r = rp.salvarRespostaPronta({ id: 'a', titulo: 'T2', conteudo: 'C2' });
    expect(r.team).toBe('campo');
    expect(rp.getRespostasProntas()).toHaveLength(1);
    expect(rp.getRespostasProntas()[0].titulo).toBe('T2');
  });

  it('exclui pelo id e recusa id inexistente', () => {
    mem.intra_respostas_prontas = [{ id: 'a', titulo: 'T', conteudo: 'C', team: 'suporte' }];
    expect(rp.excluirRespostaPronta('x')).toBe(false);
    expect(rp.excluirRespostaPronta('a')).toBe(true);
    expect(rp.getRespostasProntas()).toEqual([]);
  });

  it('lista só a equipe atual, em ordem de título', () => {
    mem.intra_respostas_prontas = [
      { id: '1', titulo: 'Zeta', conteudo: 'z', team: 'suporte' },
      { id: '2', titulo: 'Alfa', conteudo: 'a', team: 'suporte' },
      { id: '3', titulo: 'Beta', conteudo: 'b', team: 'campo' }
    ];
    expect(rp.respostasProntasDaEquipe().map((r) => r.titulo)).toEqual(['Alfa', 'Zeta']);
  });

  it('inserir acrescenta ao texto já digitado', () => {
    mem.intra_respostas_prontas = [{ id: 'a', titulo: 'T', conteudo: 'Reinicie o roteador.', team: 'suporte' }];
    const ta = { value: 'Olá!  \n', focus() {} };
    globalThis.document = { getElementById: (id) => (id === 'newNoteText' ? ta : null) };
    expect(rp.inserirRespostaPronta('a')).toBe(true);
    expect(ta.value).toBe('Olá!\n\nReinicie o roteador.');
    delete globalThis.document;
  });
});
