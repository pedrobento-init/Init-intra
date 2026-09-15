import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const imp = require('../js/milvus-clients-import.js');

describe('normalizeImportCnpj / normalizeImportName', () => {
  it('só dígitos; minúsculo e espaços colapsados', () => {
    expect(imp.normalizeImportCnpj('19.033.684/0001-56')).toBe('19033684000156');
    expect(imp.normalizeImportCnpj(null)).toBe('');
    expect(imp.normalizeImportName('  ACME   LTDA  ')).toBe('acme ltda');
    expect(imp.normalizeImportName(null)).toBe('');
  });
});

describe('matchMilvusClientToLocal (sem fuzzy: CNPJ ou nome exato)', () => {
  const index = imp.buildLocalClientIndex([
    { id: 'CLI-1', name: 'ACME LTDA', cnpj: '19033684000156' },
    { id: 'CLI-2', name: 'Beta SA', cnpj: '' },
  ]);
  it('CNPJ tem precedência sobre nome', () => {
    expect(imp.matchMilvusClientToLocal({ nome: 'Outro Nome', cnpj: '19.033.684/0001-56' }, index)).toBe('existe_cnpj');
  });
  it('nome igual (normalizado) → existe_nome', () => {
    expect(imp.matchMilvusClientToLocal({ nome: '  acme  LTDA ', cnpj: '' }, index)).toBe('existe_nome');
    expect(imp.matchMilvusClientToLocal({ nome: 'BETA sa', cnpj: '' }, index)).toBe('existe_nome');
  });
  it('nomes parecidos NÃO casam', () => {
    expect(imp.matchMilvusClientToLocal({ nome: 'ACME SERVICOS LTDA', cnpj: '' }, index)).toBe('novo');
    expect(imp.matchMilvusClientToLocal({ nome: 'ACME', cnpj: '' }, index)).toBe('novo');
  });
  it('novo de verdade', () => {
    expect(imp.matchMilvusClientToLocal({ nome: 'Nova Empresa', cnpj: '11111111000111' }, index)).toBe('novo');
  });
});

describe('clientInitialsForName (mesmo padrão do cadastro)', () => {
  it('primeiras letras, máx 2, maiúsculas', () => {
    expect(imp.clientInitialsForName('Panobianco Academia')).toBe('PA');
    // Nome de 1 palavra: 1 letra (idêntico ao auto-preenchimento de clients.js:1353).
    expect(imp.clientInitialsForName('BT')).toBe('B');
    expect(imp.clientInitialsForName('')).toBe('CL');
  });
});

describe('summarizeImportPreview', () => {
  it('conta por status', () => {
    expect(imp.summarizeImportPreview([
      { status: 'novo' }, { status: 'novo' },
      { status: 'existe_cnpj' }, { status: 'existe_nome' },
    ])).toEqual({ total: 4, novos: 2, existeCnpj: 1, existeNome: 1 });
    expect(imp.summarizeImportPreview([])).toEqual({ total: 0, novos: 0, existeCnpj: 0, existeNome: 0 });
  });
});

describe('service guards (admin + online + erro amigável)', () => {
  const _g = globalThis;
  const _keep = {};
  for (const k of ['isMilvusMappingAdmin', 'isCurrentAdmin', 'isSupabaseConnected', 'supabaseClient']) {
    _keep[k] = _g[k];
  }
  afterEach(() => {
    for (const k of Object.keys(_keep)) {
      if (_keep[k] === undefined) delete _g[k];
      else _g[k] = _keep[k];
    }
  });
  it('não-admin não consulta nem confirma', async () => {
    _g.isMilvusMappingAdmin = () => false;
    _g.isCurrentAdmin = () => false;
    _g.isSupabaseConnected = () => true;
    _g.supabaseClient = { functions: { invoke: async () => ({ data: { success: true }, error: null }) } };
    await expect(imp.previewMilvusClientsImport()).rejects.toThrow('Somente administradores');
    await expect(imp.commitMilvusClientsImport([1])).rejects.toThrow('Somente administradores');
  });
  it('offline não chama a Edge', async () => {
    let called = false;
    _g.isMilvusMappingAdmin = () => true;
    _g.isSupabaseConnected = () => false;
    _g.supabaseClient = { functions: { invoke: async () => { called = true; return {}; } } };
    await expect(imp.previewMilvusClientsImport()).rejects.toThrow('Sem conexão');
    expect(called).toBe(false);
  });
  it('erro da Edge vira mensagem amigável (sem vazar nada)', async () => {
    _g.isMilvusMappingAdmin = () => true;
    _g.isSupabaseConnected = () => true;
    _g.supabaseClient = { functions: { invoke: async () => ({ data: null, error: { message: 'TOKEN_XYZ interno' } }) } };
    await expect(imp.previewMilvusClientsImport()).rejects.toThrow('Falha na importação de clientes');
  });
  it('preview/commit repassam dry_run/onlyIds', async () => {
    const bodies = [];
    _g.isMilvusMappingAdmin = () => true;
    _g.isSupabaseConnected = () => true;
    _g.supabaseClient = {
      functions: {
        invoke: async (_fn, { body }) => { bodies.push(body); return { data: { success: true }, error: null }; },
      },
    };
    await imp.previewMilvusClientsImport();
    await imp.commitMilvusClientsImport([907519]);
    expect(bodies).toEqual([{ dry_run: true }, { dry_run: false, onlyIds: [907519] }]);
  });
});
