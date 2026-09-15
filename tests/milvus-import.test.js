import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const milvus = require('../js/milvus-devices.js');

const ROW = {
  'Nome do dispositivo': 'PB-27',
  'Usuário': 'Não possui',
  'Apelido': 'Kaua',
  'Sistema operacional': 'Microsoft Windows 11 Pro',
  'Processador': '12th Gen Intel(R) Core(TM) i5-1235U',
  'Memória RAM total': '8 GB',
  'Armazenamento interno total': '236.25 GB',
  'Usuário logado': 'Kauã',
  'Modelo do notebook': '82UM',
  'Número do serial': 'PE0BMF84',
  'MAC address': '90:65:84:71:DA:A9',
  'Data de atualização': '14/09/2026',
  'Hora de atualização do dispositivo': '17:17:00',
  'Nome fantasia do cliente': 'PANOBIANCO',
};

describe('parseBrDate', () => {
  it('dd/mm/aaaa e ISO', () => {
    expect(milvus.parseBrDate('14/09/2026')).toBe('2026-09-14');
    expect(milvus.parseBrDate('2026-09-14T10:00:00')).toBe('2026-09-14');
  });
  it('serial do Excel (45000 = 2023-03-15)', () => {
    expect(milvus.parseBrDate(45000)).toBe('2023-03-15');
  });
  it('inválidos viram null', () => {
    expect(milvus.parseBrDate('')).toBeNull();
    expect(milvus.parseBrDate(null)).toBeNull();
    expect(milvus.parseBrDate('sem data')).toBeNull();
  });
});

describe('parseBrTime', () => {
  it('"HH:MM:SS" e fração do Excel (0.5 = 12:00)', () => {
    expect(milvus.parseBrTime('17:17:00')).toBe('17:17:00');
    expect(milvus.parseBrTime('08:05')).toBe('08:05:00');
    expect(milvus.parseBrTime(0.5)).toBe('12:00:00');
  });
  it('inválidos viram null', () => {
    expect(milvus.parseBrTime('')).toBeNull();
    expect(milvus.parseBrTime('agora')).toBeNull();
  });
});

describe('normalizeMilvusExportRow (linha real do export)', () => {
  it('mapeia colunas, extras e data/hora', () => {
    const d = milvus.normalizeMilvusExportRow(ROW);
    expect(d.hostname).toBe('PB-27');
    expect(d.apelido).toBe('Kaua');
    expect(d.sistema_operacional).toBe('Microsoft Windows 11 Pro');
    expect(d.usuario_logado).toBe('Kauã');
    expect(d.modelo_notebook).toBe('82UM');
    expect(d.numero_serial).toBe('PE0BMF84');
    expect(d.mac_address).toBe('90:65:84:71:DA:A9');
    expect(d.nome_fantasia).toBe('PANOBIANCO');
    expect(d.data_ultima_atualizacao).not.toBeNull();
    const dt = new Date(d.data_ultima_atualizacao);
    expect([dt.getFullYear(), dt.getMonth(), dt.getDate(), dt.getHours(), dt.getMinutes()])
      .toEqual([2026, 8, 14, 17, 17]);
    expect(d.observacao).toBe('RAM: 8 GB | Armazenamento: 236.25 GB');
  });
  it('"Não possui" não vira dado; sem fantasia descarta', () => {
    const d = milvus.normalizeMilvusExportRow(ROW);
    expect(d.observacao).not.toContain('Não possui');
    expect(milvus.normalizeMilvusExportRow({ ...ROW, 'Nome fantasia do cliente': '  ' })).toBeNull();
    expect(milvus.normalizeMilvusExportRow(null)).toBeNull();
  });
  it('cabeçalho com outra caixa/variante continua achando', () => {
    const d = milvus.normalizeMilvusExportRow({
      'NOME FANTASIA DO CLIENTE': 'X LTDA',
      'nome do dispositivo': 'PC-1',
    });
    expect(d.nome_fantasia).toBe('X LTDA');
    expect(d.hostname).toBe('PC-1');
  });
});

describe('buildImportDeviceId', () => {
  it('determinístico, único por máquina, null sem chave', () => {
    const d = milvus.normalizeMilvusExportRow(ROW);
    const a = milvus.buildImportDeviceId('CLI-1', d);
    const b = milvus.buildImportDeviceId('CLI-1', d);
    expect(a).toBe(b);
    expect(a.startsWith('CLI-1:imp-')).toBe(true);
    expect(milvus.buildImportDeviceId('CLI-1', d)).not.toBe(
      milvus.buildImportDeviceId('CLI-1', { ...d, numero_serial: 'OUTRO' }));
    expect(milvus.buildImportDeviceId('CLI-1', { numero_serial: '', hostname: '', mac_address: '' })).toBeNull();
  });
});

describe('matchDraftToClient', () => {
  it('casa exato normalizado (caixa/espaço), sem aproximação', () => {
    const d = milvus.normalizeMilvusExportRow(ROW);
    expect(milvus.matchDraftToClient(d, new Set(['panobianco']))).toBe(true);
    expect(milvus.matchDraftToClient(d, new Set(['panobianco filial']))).toBe(false);
    expect(milvus.matchDraftToClient(d, new Set())).toBe(false);
  });
});

describe('mergeImportWithExisting', () => {
  const draft = milvus.normalizeMilvusExportRow(ROW);
  it('linha nova ganha id imp-* e milvus_device_id null', () => {
    const r = milvus.mergeImportWithExisting('CLI-1', 'mam', [draft], []);
    expect(r.created).toBe(1);
    expect(r.updated).toBe(0);
    expect(r.rows[0].id.startsWith('CLI-1:imp-')).toBe(true);
    expect(r.rows[0].milvus_device_id).toBeNull();
    expect(r.rows[0].team).toBe('mam');
  });
  it('casa com linha da API pelo serial: reaproveita id e preserva o que a planilha não traz', () => {
    const api = {
      id: 'CLI-1:milvus-99', client_id: 'CLI-1', team: 'mam', milvus_device_id: 99,
      hostname: 'PB-27', numero_serial: 'PE0BMF84', ip_interno: '10.0.0.5',
      sistema_operacional: '', observacao: '', apelido: '',
    };
    const r = milvus.mergeImportWithExisting('CLI-1', 'mam', [draft], [api]);
    expect(r.created).toBe(0);
    expect(r.updated).toBe(1);
    expect(r.rows[0].id).toBe('CLI-1:milvus-99');
    expect(r.rows[0].milvus_device_id).toBe(99);
    expect(r.rows[0].ip_interno).toBe('10.0.0.5');
    expect(r.rows[0].sistema_operacional).toBe('Microsoft Windows 11 Pro');
    expect(r.rows[0].observacao).toContain('RAM: 8 GB');
  });
  it('reimportação é idempotente (mesmos ids)', () => {
    const r1 = milvus.mergeImportWithExisting('CLI-1', 'mam', [draft], []);
    const r2 = milvus.mergeImportWithExisting('CLI-1', 'mam', [draft], r1.rows);
    expect(r2.created).toBe(0);
    expect(r2.updated).toBe(1);
    expect(r2.rows[0].id).toBe(r1.rows[0].id);
  });
});

describe('importClientDevicesFromRows (orquestração)', () => {
  const _g = globalThis;
  const _keep = {};
  for (const k of ['isSupabaseConnected', 'supabaseClient', 'getClientById', 'getSession', 'getOperators', 'getClientDevices', 'setMilvusLastSyncAt', 'addLog']) {
    _keep[k] = _g[k];
  }
  afterEach(() => {
    for (const k of Object.keys(_keep)) {
      if (_keep[k] === undefined) delete _g[k];
      else _g[k] = _keep[k];
    }
  });
  function _stub(upsertCalls, mapRows) {
    _g.isSupabaseConnected = () => true;
    _g.supabaseClient = {
      from: (table) => {
        if (table === 'milvus_client_map') {
          return { select: () => ({ eq: async () => ({ data: mapRows, error: null }) }) };
        }
        return { upsert: async (rows) => { upsertCalls.push(rows); return { error: null }; } };
      },
    };
    _g.getClientById = () => ({ id: 'CLI-1', team: 'mam' });
    _g.getSession = () => ({ opId: 'OP-1', team: 'mam', isAdmin: false });
    _g.getOperators = () => [{ id: 'OP-1', team: 'mam', isAdmin: false, active: true }];
    _g.getClientDevices = async () => [];
    _g.setMilvusLastSyncAt = () => {};
    _g.addLog = () => {};
  }
  it('filtra pelo mapa e faz upsert (PK id)', async () => {
    const calls = [];
    _stub(calls, [{ milvus_nome: 'PANOBIANCO' }]);
    const res = await milvus.importClientDevicesFromRows('CLI-1', [ROW, { ...ROW, 'Nome fantasia do cliente': 'OUTRO' }]);
    expect(res).toEqual({ imported: 1, created: 1, updated: 0, skipped: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0][0].id.startsWith('CLI-1:imp-')).toBe(true);
  });
  it('mapa vazio: tudo ignorado, nenhum upsert', async () => {
    const calls = [];
    _stub(calls, []);
    const res = await milvus.importClientDevicesFromRows('CLI-1', [ROW]);
    expect(res).toEqual({ imported: 0, created: 0, updated: 0, skipped: 1 });
    expect(calls).toHaveLength(0);
  });
  it('sem acesso ao cliente: nega', async () => {
    const calls = [];
    _stub(calls, [{ milvus_nome: 'PANOBIANCO' }]);
    _g.getOperators = () => [{ id: 'OP-1', team: 'bt', isAdmin: false, active: true }];
    _g.getSession = () => ({ opId: 'OP-1', team: 'bt', isAdmin: false });
    await expect(milvus.importClientDevicesFromRows('CLI-1', [ROW])).rejects.toThrow('Acesso negado');
    expect(calls).toHaveLength(0);
  });
});
