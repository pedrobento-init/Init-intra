import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

// ── Equipamentos: helpers puros + camada de dados ──────────────────────────
function mkEl(id) {
  const el = {
    _id: id, innerHTML: '', textContent: '', value: '', disabled: false,
    hidden: false, dataset: {}, checked: false,
    style: {}, attrs: {}, toggled: {},
    setAttribute(k, v) { el.attrs[k] = String(v); },
    getAttribute(k) { return el.attrs[k]; },
    classList: {
      add() {}, remove() {},
      toggle: (k, f) => { el.toggled[k] = !!f; },
      contains: () => false,
    },
    addEventListener() {}, appendChild() {}, remove() {}, click() {},
    contains: () => false,
    querySelector: () => null, querySelectorAll: () => [],
    focus() {},
  };
  return el;
}

function loadEquip(sandbox) {
  vm.runInContext(fs.readFileSync('js/equipamentos.js', 'utf8'), sandbox, { filename: 'equipamentos.js' });
  vm.runInContext(
    'globalThis.__t = { EQUIP_STATUS_MAP, EQUIP_TIPO_OPTIONS, EQUIP_TABS, normEquipStatus, getEquipStatusMeta, getEquipPendenciaId, hasEquipOS, formatEquipValor, calcEquipStats, filterEquipamentos, equipSummaryLine, equipStatusTag, equipOSCell };',
    sandbox
  );
  return sandbox.__t;
}

function baseSandbox(extra) {
  const _el = {};
  const sb = {
    console,
    Promise,
    window: { addEventListener() {}, location: { hash: '#equipamentos' }, innerWidth: 1280, scrollY: 0, scrollX: 0 },
    navigator: { onLine: true },
    document: {
      addEventListener() {},
      createElement: () => mkEl('c'),
      getElementById: (id) => _el[id] || (_el[id] = mkEl(id)),
      querySelector: () => null,
      querySelectorAll: () => [],
      body: mkEl('body'),
      head: mkEl('head'),
    },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    setTimeout: (fn) => 0,
    clearTimeout: () => {},
    debounce: (fn) => fn,
    escapeHtml: (s) => String(s == null ? '' : s),
    formatDate: (iso) => String(iso || ''),
    ...(extra || {}),
  };
  sb.globalThis = sb;
  sb.window.window = sb.window;
  vm.createContext(sb);
  return sb;
}

const FAKE = [
  { id: 'EQP-1', nome: 'Notebook Dell Latitude 5420', numeroSerie: 'DL5420-0091', tipo: 'notebook', clientId: 'c1', clientName: 'MAM', osVinculada: '010', pendenciaId: 'PEN-1', status: 'entregue', valor: 4200, dataAquisicao: '2026-01-10', updatedAt: '2026-09-27T00:00:00.000Z' },
  { id: 'EQP-2', nome: 'Roteador Ubiquiti UDM Pro', numeroSerie: 'UDM-3391', tipo: 'roteador', clientId: 'c2', clientName: 'Lira', osVinculada: '006', pendenciaId: null, status: 'em_manutencao', valor: 3150, dataAquisicao: '2026-02-01', updatedAt: '2026-09-07T00:00:00.000Z' },
  { id: 'EQP-3', nome: 'Notebook Lenovo T14', numeroSerie: 'TP-T14-0532', tipo: 'notebook', clientId: null, clientName: 'Estoque Initnet', osVinculada: null, pendenciaId: null, status: 'estoque', valor: 3600, dataAquisicao: '2026-03-01', updatedAt: '2026-09-10T00:00:00.000Z' },
  { id: 'EQP-4', nome: 'Switch TP-Link 24p', numeroSerie: 'TPL-SW24-08', tipo: 'switch', clientId: 'c3', clientName: 'Podval', osVinculada: null, pendenciaId: null, status: 'baixado', valor: 480, dataAquisicao: '2025-05-01', updatedAt: '2026-08-02T00:00:00.000Z' },
];

describe('equipamentos: status/valor/stats', () => {
  it('mapeia os 4 status com a paleta do sistema', () => {
    const T = loadEquip(baseSandbox());
    expect(T.getEquipStatusMeta('entregue')).toMatchObject({ label: 'Entregue', cls: 'tag-green' });
    expect(T.getEquipStatusMeta('em_manutencao')).toMatchObject({ cls: 'tag-yellow' });
    expect(T.getEquipStatusMeta('estoque')).toMatchObject({ cls: 'tag-blue' });
    expect(T.getEquipStatusMeta('baixado')).toMatchObject({ cls: 'tag-red' });
    expect(T.getEquipStatusMeta('x')).toMatchObject({ cls: 'tag-gray' });
  });

  it('mantém alias legado em_uso → entregue', () => {
    const T = loadEquip(baseSandbox());
    expect(T.normEquipStatus('em_uso')).toBe('entregue');
    expect(T.getEquipStatusMeta('em_uso')).toMatchObject({ label: 'Entregue', cls: 'tag-green' });
    const s = T.calcEquipStats([{ status: 'em_uso', valor: 10 }]);
    expect(s.byStatus.entregue).toBe(1);
    expect(T.filterEquipamentos([{ status: 'em_uso' }], { status: 'entregue' })).toHaveLength(1);
  });

  it('formata valor em BRL e trata vazio', () => {
    const T = loadEquip(baseSandbox());
    expect(T.formatEquipValor(4200)).toContain('4.200');
    expect(T.formatEquipValor('')).toBe('—');
    expect(T.formatEquipValor(null)).toBe('—');
  });

  it('calcula totais e exclui baixados do valor em ativos', () => {
    const T = loadEquip(baseSandbox());
    const s = T.calcEquipStats(FAKE);
    expect(s.total).toBe(4);
    expect(s.byStatus).toMatchObject({ entregue: 1, em_manutencao: 1, estoque: 1, baixado: 1 });
    expect(s.totalValor).toBe(4200 + 3150 + 3600);
  });

  it('gera linha de resumo textual', () => {
    const T = loadEquip(baseSandbox());
    const s = T.calcEquipStats(FAKE);
    const line = T.equipSummaryLine(s);
    expect(line).toContain('4 equipamentos');
    expect(line).toContain('1</b> entregues');
  });
});

describe('equipamentos: filtros', () => {
  it('filtra por aba de status', () => {
    const T = loadEquip(baseSandbox());
    expect(T.filterEquipamentos(FAKE, { status: 'entregue' }).map(e => e.id)).toEqual(['EQP-1']);
    expect(T.filterEquipamentos(FAKE, { status: '' })).toHaveLength(4);
  });

  it('busca por nome, série, OS e cliente', () => {
    const T = loadEquip(baseSandbox());
    expect(T.filterEquipamentos(FAKE, { search: 'dell latitude' })).toHaveLength(1);
    expect(T.filterEquipamentos(FAKE, { search: 'udm-3391' })).toHaveLength(1);
    expect(T.filterEquipamentos(FAKE, { search: '010' })).toContainEqual(expect.objectContaining({ id: 'EQP-1' }));
    expect(T.filterEquipamentos(FAKE, { search: 'pen-1' })).toContainEqual(expect.objectContaining({ id: 'EQP-1' }));
    expect(T.filterEquipamentos(FAKE, { search: 'podval' })).toHaveLength(1);
  });

  it('filtra por cliente, tipo e estoque interno', () => {
    const T = loadEquip(baseSandbox());
    expect(T.filterEquipamentos(FAKE, { client: 'c1' }).map(e => e.id)).toEqual(['EQP-1']);
    expect(T.filterEquipamentos(FAKE, { client: '__estoque__' }).map(e => e.id)).toEqual(['EQP-3']);
    expect(T.filterEquipamentos(FAKE, { tipo: 'notebook' })).toHaveLength(2);
    expect(T.filterEquipamentos(FAKE, { onlyWithOS: true })).toHaveLength(2);
  });

  it('filtra por período de aquisição', () => {
    const T = loadEquip(baseSandbox());
    expect(T.filterEquipamentos(FAKE, { from: '2026-02-01', to: '2026-03-01' })).toHaveLength(2);
  });

  it('renderiza badge de status com dot colorido', () => {
    const T = loadEquip(baseSandbox());
    const html = T.equipStatusTag('em_manutencao');
    expect(html).toContain('tag-yellow');
    expect(html).toContain('Em manutenção');
  });

  it('separa OS digitada do vínculo com pendência', () => {
    const sb = baseSandbox({
      getPendenciaById: (id) => (id === 'PEN-1' ? { id: 'PEN-1' } : null),
      penDisplayNumber: () => '#010',
    });
    const T = loadEquip(sb);
    // Com vínculo: texto da OS vira link para a pendência.
    expect(T.getEquipPendenciaId(FAKE[0])).toBe('PEN-1');
    expect(T.hasEquipOS(FAKE[0])).toBe(true);
    expect(T.hasEquipOS(FAKE[2])).toBe(false);
    const linked = T.equipOSCell(FAKE[0]);
    expect(linked).toContain('os-link');
    expect(linked).toContain('010');
    // Só texto, sem vínculo: sem link.
    const plain = T.equipOSCell(FAKE[1]);
    expect(plain).toContain('006');
    expect(plain).not.toContain('os-link');
    // Legado: id de pendência em osVinculada ainda resolve o vínculo.
    expect(T.getEquipPendenciaId({ osVinculada: 'PEN-1' })).toBe('PEN-1');
  });
});

describe('equipamentos: schema/sync', () => {
  it('declara a entidade equipamentos como opcional no schema', async () => {
    const src = fs.readFileSync('js/schema.js', 'utf8');
    expect(src).toContain("table: 'equipamentos'");
    expect(src).toContain("dbKey: 'intra_equipamentos'");
    expect(src).toContain('optional: true');
  });

  it('persiste via Dexie v7 + expõe CRUD no storage', async () => {
    const dbSrc = fs.readFileSync('js/db.js', 'utf8');
    expect(dbSrc).toContain('equipamentos');
    expect(dbSrc).toContain('idb.version(7)');
    const stSrc = fs.readFileSync('js/storage.js', 'utf8');
    for (const fn of ['getEquipamentos', 'getMyEquipamentos', 'getEquipamentoById', 'saveEquipamento', 'deleteEquipamento']) {
      expect(stSrc).toContain('function ' + fn);
    }
    expect(stSrc).toContain('pendencia_id');
    const schemaSrc = fs.readFileSync('js/schema.js', 'utf8');
    expect(schemaSrc).toContain('pendencia_id');
  });
});
