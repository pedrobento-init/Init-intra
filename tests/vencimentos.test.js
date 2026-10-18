import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const V = require('../js/vencimentos.js');

const TODAY = '2026-10-18';
const v = (o) => Object.assign({ id: 'V' + Math.random(), status: 'ativo', tipo: 'ssl', descricao: 'SSL', avisos: [] }, o);

describe('vencimentos', () => {
  it('dias e faixas', () => {
    expect(V.vencDaysLeft(v({ dataVencimento: '2026-10-25' }), TODAY)).toBe(7);
    expect(V.vencBand(-1)).toBe('vencido');
    expect(V.vencBand(7)).toBe('semana');
    expect(V.vencBand(30)).toBe('mes');
    expect(V.vencBand(31)).toBe('depois');
  });

  it('aviso de 30 dias sai uma vez', () => {
    const a = v({ dataVencimento: '2026-11-10' }); // 23 dias
    expect(V.vencAvisoDevido(a, TODAY)).toEqual({ aviso: '30', marcar: ['30'] });
    expect(V.vencAvisoDevido({ ...a, avisos: ['30'] }, TODAY)).toBeNull();
  });

  it('cadastrado já dentro dos 7 dias: manda só o de 7 e marca o de 30 junto', () => {
    expect(V.vencAvisoDevido(v({ dataVencimento: '2026-10-21' }), TODAY)).toEqual({ aviso: '7', marcar: ['30', '7'] });
  });

  it('no dia (ou vencido há até 7 dias) manda o aviso "0"; depois para de insistir', () => {
    expect(V.vencAvisoDevido(v({ dataVencimento: TODAY, avisos: ['30', '7'] }), TODAY)).toEqual({ aviso: '0', marcar: ['0'] });
    expect(V.vencAvisoDevido(v({ dataVencimento: '2026-10-01' }), TODAY)).toBeNull();
    expect(V.vencAvisoDevido(v({ dataVencimento: '2026-12-31' }), TODAY)).toBeNull();
    expect(V.vencAvisoDevido(v({ dataVencimento: TODAY, status: 'encerrado' }), TODAY)).toBeNull();
  });

  it('renovar soma meses ajustando fim de mês', () => {
    expect(V.vencAddMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(V.vencAddMonths('2026-10-18', 12)).toBe('2027-10-18');
  });

  it('modelo: agrupa por faixa, filtra por texto/tipo e esconde encerrados', () => {
    const list = [
      v({ id: 'a', dataVencimento: '2026-10-10', descricao: 'Domínio acme.com.br', tipo: 'dominio', clientName: 'Acme' }),
      v({ id: 'b', dataVencimento: '2026-10-20' }),
      v({ id: 'c', dataVencimento: '2026-11-10' }),
      v({ id: 'd', dataVencimento: '2027-05-01' }),
      v({ id: 'e', dataVencimento: '2026-10-19', status: 'encerrado' }),
    ];
    const m = V.buildVencimentosModel(list, TODAY);
    expect(m.counts).toEqual({ vencido: 1, semana: 1, mes: 1, depois: 1 });
    expect(V.buildVencimentosModel(list, TODAY, { q: 'acme' }).groups.vencido.map((x) => x.v.id)).toEqual(['a']);
    expect(V.buildVencimentosModel(list, TODAY, { tipo: 'dominio' }).counts.semana).toBe(0);
    expect(V.buildVencimentosModel(list, TODAY, { encerrados: true }).groups.encerrado.map((x) => x.v.id)).toEqual(['e']);
  });

  it('urgentes (≤7 dias ou vencidos), por responsável', () => {
    const list = [v({ dataVencimento: '2026-10-20', responsavel: 'Ana' }), v({ dataVencimento: '2026-10-01', responsavel: 'Beto' }), v({ dataVencimento: '2026-12-01', responsavel: 'Ana' })];
    expect(V.countVencimentosUrgentes(list, TODAY)).toBe(2);
    expect(V.countVencimentosUrgentes(list, TODAY, 'Ana')).toBe(1);
  });
});
