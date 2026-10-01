import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);

function setGlobal(name, value) {
  try {
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  } catch (_) { globalThis[name] = value; }
}

const _stores = { clients: [], pendencias: [], operators: [], visits: [] };
const _tables = {};
let _session = null;

setGlobal('window', { _pendingSyncCount: 0, _syncPending: 0, _supabaseAuthActive: false, _suppressPendingSync: true, addEventListener() {}, location: { hash: '' } });
setGlobal('document', { addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] });
setGlobal('navigator', { onLine: true });
setGlobal('getCacheStore', (name) => _stores[name] || []);
setGlobal('setCacheStore', (name, items) => { _stores[name] = Array.isArray(items) ? [...items] : items; });
setGlobal('getCacheKV', (k, d) => d);
setGlobal('setCacheKV', () => {});
setGlobal('getCacheTable', (t) => {
  if (t === 'sessions' && _session) return { key: 's', value: _session };
  if (t === 'audit_logs' && _tables.audit_logs) return _tables.audit_logs;
  return {};
});
setGlobal('setCacheTable', (t, v) => { _tables[t] = v; });
setGlobal('getOperatorNames', () => []);
setGlobal('escapeHtml', (s) => String(s ?? ''));

function mockOps() {
  _stores.operators = [
    { id: 'OP-1', name: 'Pedro', team: 'init', isAdmin: true, active: true },
    { id: 'OP-5', name: 'Felipe', team: 'init', isAdmin: true, active: true, isGestao: true },
    { id: 'OP-9', name: 'Ana', team: 'init', isAdmin: false, active: true, role: 'Técnico' },
    { id: 'OP-10', name: 'Beto', team: 'init', isAdmin: false, active: true },
    { id: 'OP-11', name: 'Paulo', team: 'init', isAdmin: false, active: false },
    { id: 'OP-12', name: 'Lia', team: 'init', isAdmin: false, active: true, onLeave: true },
  ];
}

function mockPen(over = {}) {
  return {
    id: 'PEN-1', clientId: 'CLI-1', clientName: 'BT', tipo: 'Projeto',
    assunto: 'Bitlocker', descricao: 'Ativar bitlocker', responsible: 'Ana',
    status: 'aberto', priority: 'media', team: 'init',
    createdAt: '2026-01-01T10:00:00Z', updatedAt: '2026-01-02T10:00:00Z',
    ...over,
  };
}

describe('updatePendenciaAssignee (regras 404/400/403)', () => {
  let storage;
  beforeEach(() => {
    _stores.clients = [];
    _stores.pendencias = [mockPen()];
    _stores.visits = [];
    delete _tables.audit_logs;
    mockOps();
    _session = { opId: 'OP-9', name: 'Ana', team: 'init', isAdmin: false };
    delete require.cache[require.resolve('../js/storage.js')];
    storage = require('../js/storage.js');
  });

  it('reatribui, mantém completedBy e registra auditoria', () => {
    const r = storage.updatePendenciaAssignee('PEN-1', { responsible: 'Beto' });
    expect(r.changed).toEqual({ responsible: true, completedBy: false });
    expect(storage.getPendenciaById('PEN-1').responsible).toBe('Beto');
    const logs = _tables.audit_logs || [];
    expect(logs.some((l) => l.action === 'Reatribuiu' && l.targetId === 'PEN-1' && l.details === 'Ana → Beto' && l.operatorName === 'Ana')).toBe(true);
  });

  it('permite remover o responsável ("")', () => {
    const r = storage.updatePendenciaAssignee('PEN-1', { responsible: '' });
    expect(r.changed.responsible).toBe(true);
    expect(storage.getPendenciaById('PEN-1').responsible).toBe('');
  });

  it('valor igual = no-op sem log', () => {
    const before = JSON.stringify(_tables.audit_logs || []);
    const r = storage.updatePendenciaAssignee('PEN-1', { responsible: 'Ana' });
    expect(r.changed).toEqual({ responsible: false, completedBy: false });
    expect(JSON.stringify(_tables.audit_logs || [])).toBe(before);
  });

  it('404 em pendência inexistente', () => {
    expect(() => storage.updatePendenciaAssignee('PEN-X', { responsible: 'Beto' })).toThrow(/não encontrada/i);
  });

  it('400 em operador inexistente, inativo ou afastado (responsible)', () => {
    expect(() => storage.updatePendenciaAssignee('PEN-1', { responsible: 'Zé' })).toThrow(/não encontrado/i);
    expect(() => storage.updatePendenciaAssignee('PEN-1', { responsible: 'Paulo' })).toThrow(/inativo/i);
    expect(() => storage.updatePendenciaAssignee('PEN-1', { responsible: 'Lia' })).toThrow(/afastado/i);
  });

  it('403 em pendência Gestão para não-Gestão', () => {
    _stores.pendencias = [mockPen({ id: 'PEN-G', tipo: 'Gestão' })];
    _session = { opId: 'OP-9', name: 'Ana', team: 'init', isAdmin: false };
    expect(() => storage.updatePendenciaAssignee('PEN-G', { responsible: 'Beto' })).toThrow(/negado/i);
    _session = { opId: 'OP-5', name: 'Felipe', team: 'init', isAdmin: true };
    expect(() => storage.updatePendenciaAssignee('PEN-G', { responsible: 'Beto' })).not.toThrow();
  });
});

describe('completedBy (quem concluiu)', () => {
  let storage;
  beforeEach(() => {
    _stores.clients = [];
    _stores.pendencias = [mockPen({ id: 'PEN-2', status: 'resolvido', responsible: 'Ana', completedAt: '2026-02-01T10:00:00Z', completedBy: 'Ana' })];
    _stores.visits = [];
    delete _tables.audit_logs;
    mockOps();
    _session = { opId: 'OP-9', name: 'Ana', team: 'init', isAdmin: false };
    delete require.cache[require.resolve('../js/storage.js')];
    storage = require('../js/storage.js');
  });

  it('corrige quem concluiu e registra auditoria (completedAt intacto)', () => {
    const r = storage.updatePendenciaAssignee('PEN-2', { completedBy: 'Beto' });
    expect(r.changed.completedBy).toBe(true);
    const p = storage.getPendenciaById('PEN-2');
    expect(p.completedBy).toBe('Beto');
    expect(p.completedAt).toBe('2026-02-01T10:00:00Z');
    const logs = _tables.audit_logs || [];
    expect(logs.some((l) => l.action === 'Corrigiu conclusão' && l.details === 'Ana → Beto')).toBe(true);
  });

  it('aceita afastado como fato passado e permite limpar', () => {
    expect(() => storage.updatePendenciaAssignee('PEN-2', { completedBy: 'Lia' })).not.toThrow();
    expect(storage.getPendenciaById('PEN-2').completedBy).toBe('Lia');
    storage.updatePendenciaAssignee('PEN-2', { completedBy: '' });
    expect(storage.getPendenciaById('PEN-2').completedBy).toBe('');
  });

  it('barra completedBy em pendência aberta e operador inexistente', () => {
    _stores.pendencias.push(mockPen({ id: 'PEN-3', status: 'aberto' }));
    expect(() => storage.updatePendenciaAssignee('PEN-3', { completedBy: 'Beto' })).toThrow(/concluída/i);
    expect(() => storage.updatePendenciaAssignee('PEN-2', { completedBy: 'Zé' })).toThrow(/não encontrado/i);
  });

  it('concluir carimba completedBy = responsável e completedAt', () => {
    _stores.pendencias = [mockPen({ id: 'PEN-4', status: 'aberto', responsible: 'Beto' })];
    storage.savePendencia({ ...storage.getPendenciaById('PEN-4'), status: 'resolvido' });
    const p = storage.getPendenciaById('PEN-4');
    expect(p.completedBy).toBe('Beto');
    expect(p.completedAt).toBeTruthy();
  });

  it('legado concluído sem completedBy exibe vazio (sem inventar)', () => {
    _stores.pendencias = [mockPen({ id: 'PEN-5', status: 'resolvido', responsible: 'Ana' })];
    expect(storage.getPendenciaById('PEN-5').completedBy || '').toBe('');
  });
});

describe('contrato: migração, mapa e card', () => {
  it('migração 038 cria completed_by sem backfill', () => {
    const sql = fs.readFileSync('supabase/migrations/038_pendencia_completed_by.sql', 'utf8');
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS completed_by/i);
    expect(sql).not.toMatch(/UPDATE\s+public\.pendencias\s+SET\s+completed_by/i);
  });

  it('card da reunião exibe bloco concluída + corrigir + histórico', async () => {
    const { ENTITIES } = await import('../js/schema.js');
    const pen = ENTITIES.find((e) => e.table === 'pendencias');
    expect(pen.fields.completed_by).toBe('completedBy');
    const src = fs.readFileSync('js/reunioes.js', 'utf8');
    expect(src).toContain('meeting-done-${escapeHtml(p.id)}');
    expect(src).toContain("onclick=\"openCorrectCompletion('${escapeHtml(p.id)}')\"");
    expect(src).toContain('_meetingPenHistoryHtml(p.id)');
    expect(src).toContain('Corrigiu conclusão');
  });

  it('CSS do bloco concluída/histórico existe', () => {
    const css = fs.readFileSync('css/styles.css', 'utf8');
    expect(css).toContain('.meet-done');
    expect(css).toContain('.meet-hist');
  });
});
