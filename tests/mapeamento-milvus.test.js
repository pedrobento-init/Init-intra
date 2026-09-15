import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const map = require('../js/mapeamento-milvus.js');

const CLIENTS = [
  { id: 'CLI-1', name: 'ACME LTDA' },
  { id: 'CLI-2', name: 'ACME SERVICOS LTDA' },
  { id: 'CLI-3', name: 'ACME MATRIZ' },
];

describe('normalizeMilvusName', () => {
  it('trim + colapsa espaços; não-string vira vazio', () => {
    expect(map.normalizeMilvusName('  ACME   LTDA  ')).toBe('ACME LTDA');
    expect(map.normalizeMilvusName(null)).toBe('');
    expect(map.normalizeMilvusName(123)).toBe('');
  });
});

describe('aggregateMilvusNames (deduplicação, sem heurística)', () => {
  it('agrupa por igualdade exata (case-insensitive) e conta', () => {
    const out = map.aggregateMilvusNames([
      { nome_fantasia: 'EMPRESA ABC LTDA' },
      { nome_fantasia: 'empresa abc ltda' },
      { nome_fantasia: 'EMPRESA XYZ LTDA' },
    ]);
    expect(out).toEqual([
      { nome: 'EMPRESA ABC LTDA', quantidadeDispositivos: 2 },
      { nome: 'EMPRESA XYZ LTDA', quantidadeDispositivos: 1 },
    ]);
  });
  it('NÃO aproxima nomes parecidos (ACME x3 = 3 linhas)', () => {
    const out = map.aggregateMilvusNames([
      { nome_fantasia: 'ACME LTDA' },
      { nome_fantasia: 'ACME SERVICOS LTDA' },
      { nome_fantasia: 'ACME MATRIZ' },
    ]);
    expect(out.map((o) => o.nome).sort()).toEqual(
      ['ACME LTDA', 'ACME MATRIZ', 'ACME SERVICOS LTDA'].sort(),
    );
    expect(out.every((o) => o.quantidadeDispositivos === 1)).toBe(true);
  });
  it('ignora vazios e nunca vaza licença/dados sensíveis', () => {
    const out = map.aggregateMilvusNames([
      { nome_fantasia: '  ' },
      { nome_fantasia: null },
      { nome_fantasia: 'OK LTDA', sistema_operacional_licenca: 'KEY-9', hostname: 'PC-1' },
    ]);
    expect(out).toEqual([{ nome: 'OK LTDA', quantidadeDispositivos: 1 }]);
    expect(JSON.stringify(out).toLowerCase()).not.toContain('licenca');
    expect(JSON.stringify(out)).not.toContain('KEY-9');
    expect(JSON.stringify(out)).not.toContain('PC-1');
  });
});

describe('parseMilvusNameList (colagem da planilha)', () => {
  it('um por linha, trim, ignora vazias e cabeçalho', () => {
    const out = map.parseMilvusNameList('nome_fantasia\n  ACME LTDA \n\nACME LTDA\nBT ADVOGADOS\n');
    expect(out).toEqual([
      { nome: 'ACME LTDA', quantidadeDispositivos: 2 },
      { nome: 'BT ADVOGADOS', quantidadeDispositivos: 1 },
    ]);
  });
  it('texto vazio vira lista vazia', () => {
    expect(map.parseMilvusNameList('')).toEqual([]);
    expect(map.parseMilvusNameList(null)).toEqual([]);
  });
});

describe('mergeMilvusNameSources (API + lista, sem aproximação)', () => {
  it('união por igualdade exata, quantidade = maior das fontes', () => {
    const out = map.mergeMilvusNameSources(
      [{ nome: 'ACME LTDA', quantidadeDispositivos: 50 }],
      [{ nome: 'acme ltda', quantidadeDispositivos: 14 }, { nome: 'NOVA LTDA', quantidadeDispositivos: 3 }],
    );
    expect(out).toEqual([
      { nome: 'ACME LTDA', quantidadeDispositivos: 50 },
      { nome: 'NOVA LTDA', quantidadeDispositivos: 3 },
    ]);
  });
  it('nomes parecidos continuam separados', () => {
    const out = map.mergeMilvusNameSources(
      [],
      [{ nome: 'BOTTINI-DF', quantidadeDispositivos: 1 }, { nome: 'BOTTINI-SP', quantidadeDispositivos: 1 }],
    );
    expect(out).toHaveLength(2);
  });
});

describe('buildMapeamentoRows', () => {
  it('cruza nome→mapa→cliente com status mapeado/pendente', () => {
    const rows = map.buildMapeamentoRows(
      [{ nome: 'ACME LTDA', quantidadeDispositivos: 14 }, { nome: 'NOVA LTDA', quantidadeDispositivos: 3 }],
      [{ milvus_nome: 'ACME LTDA', client_id: 'CLI-1' }],
      CLIENTS,
    );
    expect(rows).toEqual([
      { nome: 'ACME LTDA', quantidadeDispositivos: 14, clientId: 'CLI-1', clientName: 'ACME LTDA', status: 'mapeado' },
      { nome: 'NOVA LTDA', quantidadeDispositivos: 3, clientId: null, clientName: null, status: 'pendente' },
    ]);
  });
});

describe('filterMapeamentoRows', () => {
  const rows = [
    { nome: 'ACME LTDA', quantidadeDispositivos: 1, clientId: 'CLI-1', clientName: 'ACME LTDA', status: 'mapeado' },
    { nome: 'NOVA LTDA', quantidadeDispositivos: 1, clientId: null, clientName: null, status: 'pendente' },
  ];
  it('filtra por status e busca (nome ou cliente)', () => {
    expect(map.filterMapeamentoRows(rows, '', 'mapeados')).toHaveLength(1);
    expect(map.filterMapeamentoRows(rows, '', 'pendentes')).toHaveLength(1);
    expect(map.filterMapeamentoRows(rows, 'nova', 'todos')).toHaveLength(1);
    expect(map.filterMapeamentoRows(rows, 'acme', 'todos')).toHaveLength(1);
    expect(map.filterMapeamentoRows(rows, 'zzz', 'todos')).toHaveLength(0);
  });
});

describe('validateMapeamento (anti-ambiguidade)', () => {
  const rows = [
    { nome: 'ACME LTDA', quantidadeDispositivos: 1, clientId: 'CLI-1', clientName: 'ACME LTDA', status: 'mapeado' },
    { nome: 'NOVA LTDA', quantidadeDispositivos: 1, clientId: null, clientName: null, status: 'pendente' },
  ];
  it('bloqueia sem nome ou sem cliente', () => {
    expect(map.validateMapeamento('', 'CLI-1', rows).ok).toBe(false);
    expect(map.validateMapeamento('NOVA LTDA', '', rows).ok).toBe(false);
  });
  it('re-salvar o mesmo vínculo é noop idempotente', () => {
    expect(map.validateMapeamento('ACME LTDA', 'CLI-1', rows)).toEqual({ ok: true, noop: true });
  });
  it('trocar cliente de nome já mapeado exige confirmação (não decide sozinho)', () => {
    expect(map.validateMapeamento('ACME LTDA', 'CLI-2', rows))
      .toEqual({ ok: true, needsConfirm: 'reassign' });
  });
  it('cliente já usado em outro nome exige confirmação', () => {
    expect(map.validateMapeamento('NOVA LTDA', 'CLI-1', rows))
      .toEqual({ ok: true, needsConfirm: 'client-used' });
  });
  it('mapeamento novo e livre passa direto', () => {
    expect(map.validateMapeamento('NOVA LTDA', 'CLI-2', rows)).toEqual({ ok: true });
  });
});
