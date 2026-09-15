import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const bf = require('../js/milvus-token-backfill.js');

const MAP = [
  { milvus_nome: 'PANOBIANCO', client_id: 'CLI-1' },
  { milvus_nome: 'AUS ADVOGADOS', client_id: 'CLI-2' },
  { milvus_nome: 'FANTASMA LTDA', client_id: 'CLI-3' },
  { milvus_nome: 'DUP LTDA', client_id: 'CLI-4' },
];
const MILVUS = [
  { nome: 'PANOBIANCO', token: '2JWX2PU' },
  { nome: '  aus   advogados ', token: 'AAA111' },
  { nome: 'DUP LTDA', token: 'T1' },
  { nome: 'DUP LTDA', token: 'T2' },
  { nome: 'SEM TOKEN', token: '' },
  { nome: '', token: 'ZZZ' },
];

describe('buildBackfillPreview (match exato, sem fuzzy, sem sobrescrita)', () => {
  it('preenche vazio com match exato normalizado', () => {
    const out = bf.buildBackfillPreview(MAP, {}, MILVUS);
    const pano = out.find((r) => r.milvusNome === 'PANOBIANCO');
    expect(pano).toEqual({ milvusNome: 'PANOBIANCO', clientId: 'CLI-1', token: '2JWX2PU', status: 'pronto' });
    const aus = out.find((r) => r.milvusNome === 'AUS ADVOGADOS');
    expect(aus.status).toBe('pronto');
    expect(aus.token).toBe('AAA111');
  });
  it('nunca sobrescreve valor manual', () => {
    const out = bf.buildBackfillPreview(MAP, { 'CLI-1': 'MANUAL9' }, MILVUS);
    expect(out.find((r) => r.milvusNome === 'PANOBIANCO'))
      .toEqual({ milvusNome: 'PANOBIANCO', clientId: 'CLI-1', token: null, status: 'ja_preenchido' });
  });
  it('ausente no Milvus → nao_encontrado; 2 tokens → ambiguo', () => {
    const out = bf.buildBackfillPreview(MAP, {}, MILVUS);
    expect(out.find((r) => r.milvusNome === 'FANTASMA LTDA').status).toBe('nao_encontrado');
    const dup = out.find((r) => r.milvusNome === 'DUP LTDA');
    expect(dup.status).toBe('ambiguo');
    expect(dup.token).toBeNull();
  });
  it('nomes parecidos NÃO casam', () => {
    const out = bf.buildBackfillPreview(
      [{ milvus_nome: 'PANOBIANCO FILIAL', client_id: 'CLI-9' }], {}, MILVUS);
    expect(out[0].status).toBe('nao_encontrado');
  });
  it('linhas sem nome são ignoradas', () => {
    expect(bf.buildBackfillPreview([{ milvus_nome: '  ', client_id: 'CLI-9' }], {}, MILVUS)).toEqual([]);
  });
});

describe('summarizeBackfillPreview', () => {
  it('conta por status', () => {
    expect(bf.summarizeBackfillPreview(bf.buildBackfillPreview(MAP, {}, MILVUS)))
      .toEqual({ total: 4, prontos: 2, jaPreenchidos: 0, naoEncontrados: 1, ambiguos: 1 });
    expect(bf.summarizeBackfillPreview([]))
      .toEqual({ total: 0, prontos: 0, jaPreenchidos: 0, naoEncontrados: 0, ambiguos: 0 });
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
    await expect(bf.previewMilvusTokenBackfill()).rejects.toThrow('Somente administradores');
    await expect(bf.commitMilvusTokenBackfill(['X'])).rejects.toThrow('Somente administradores');
  });
  it('offline não chama a Edge', async () => {
    let called = false;
    _g.isMilvusMappingAdmin = () => true;
    _g.isSupabaseConnected = () => false;
    _g.supabaseClient = { functions: { invoke: async () => { called = true; return {}; } } };
    await expect(bf.previewMilvusTokenBackfill()).rejects.toThrow('Sem conexão');
    expect(called).toBe(false);
  });
  it('preview/commit repassam dry_run/onlyNomes', async () => {
    const bodies = [];
    _g.isMilvusMappingAdmin = () => true;
    _g.isSupabaseConnected = () => true;
    _g.supabaseClient = {
      functions: {
        invoke: async (_fn, { body }) => { bodies.push(body); return { data: { success: true }, error: null }; },
      },
    };
    await bf.previewMilvusTokenBackfill();
    await bf.commitMilvusTokenBackfill(['PANOBIANCO']);
    expect(bodies).toEqual([{ dry_run: true }, { dry_run: false, onlyNomes: ['PANOBIANCO'] }]);
  });
});
