import { createRequire as __storageReq } from 'node:module';
const { requireStorage } = __storageReq(import.meta.url)('./_storage.cjs');
import { describe, it, expect, beforeEach } from 'vitest';

// Linha do tempo do chamado (migration 063): `events` registra o que
// ACONTECEU — status, responsável, prioridade e prazo —, complementar a
// `notes`, que é o que a equipe ESCREVEU. Antes disso o histórico se perdia:
// `oldStatus` existia no save só para disparar recorrência e notificação.

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

const pen = (over = {}) => ({
  id: 'PEN-1', clientId: 'CLI-1', clientName: 'BT', tipo: 'Projeto',
  assunto: 'Bitlocker', descricao: 'Ativar', responsible: 'Ana',
  status: 'aberto', priority: 'media', team: 'init',
  createdAt: '2026-01-01T10:00:00Z', updatedAt: '2026-01-02T10:00:00Z',
  ...over,
});

let storage;
beforeEach(() => {
  _stores.clients = [];
  _stores.visits = [];
  _stores.operators = [{ id: 'OP-9', name: 'Ana', team: 'init', isAdmin: false, active: true }];
  _stores.pendencias = [pen()];
  _session = { opId: 'OP-9', name: 'Ana', team: 'init', isAdmin: false };
  storage = requireStorage();
});

const tipos = (id) => (storage.getPendenciaById(id).events || []).map((e) => e.type);
const ultimo = (id) => {
  const ev = storage.getPendenciaById(id).events || [];
  return ev[ev.length - 1];
};

describe('eventos gerados ao salvar', () => {
  it('mudar o status registra de → para, com autor', () => {
    storage.savePendencia({ ...storage.getPendenciaById('PEN-1'), status: 'em_andamento' });
    const e = ultimo('PEN-1');
    expect(e.type).toBe('status');
    expect([e.de, e.para]).toEqual(['aberto', 'em_andamento']);
    expect(e.by).toBe('Ana');
    expect(e.at).toBeTruthy();
  });

  it('trocar responsável, prioridade e prazo também viram eventos', () => {
    storage.savePendencia({ ...storage.getPendenciaById('PEN-1'), responsible: 'Beto', priority: 'alta', deadline: '2026-03-01' });
    expect(tipos('PEN-1').sort()).toEqual(['prazo', 'prioridade', 'responsavel']);
  });

  it('salvar sem mudar nada não cria evento', () => {
    storage.savePendencia({ ...storage.getPendenciaById('PEN-1') });
    expect(tipos('PEN-1')).toEqual([]);
  });

  it('editar só o texto não cria evento — a linha conta a história, não cada toque', () => {
    storage.savePendencia({ ...storage.getPendenciaById('PEN-1'), descricao: 'outro texto', assunto: 'outro assunto' });
    expect(tipos('PEN-1')).toEqual([]);
  });

  it('pendência nova nasce com o evento "criado"', () => {
    _stores.pendencias = [];
    storage.savePendencia({ clientId: 'CLI-1', assunto: 'Nova', status: 'aberto', team: 'init' });
    const nova = storage.getPendencias()[0];
    expect((nova.events || []).map((e) => e.type)).toEqual(['criado']);
    expect(nova.events[0].para).toBe('aberto');
  });

  it('eventos acumulam na ordem em que aconteceram', () => {
    storage.savePendencia({ ...storage.getPendenciaById('PEN-1'), status: 'em_andamento' });
    storage.savePendencia({ ...storage.getPendenciaById('PEN-1'), priority: 'critica' });
    storage.savePendencia({ ...storage.getPendenciaById('PEN-1'), status: 'resolvido' });
    expect(tipos('PEN-1')).toEqual(['status', 'prioridade', 'status']);
  });

  it('campo que vai de vazio para vazio não gera evento (null vs "")', () => {
    _stores.pendencias = [pen({ deadline: null })];
    storage.savePendencia({ ...storage.getPendenciaById('PEN-1'), deadline: '' });
    expect(tipos('PEN-1')).toEqual([]);
  });
});

describe('teto de eventos', () => {
  it('corta os mais antigos, mantendo os últimos — o registro viaja em todo sync', () => {
    const muitos = Array.from({ length: 205 }, (_, i) => ({ at: '2026-01-01T00:00:00Z', by: 'x', type: 'status', de: 'a', para: 'b' + i }));
    _stores.pendencias = [pen({ events: muitos })];
    storage.savePendencia({ ...storage.getPendenciaById('PEN-1'), status: 'resolvido' });
    const ev = storage.getPendenciaById('PEN-1').events;
    expect(ev.length).toBe(200);
    expect(ev[ev.length - 1].para).toBe('resolvido'); // o novo entrou
    expect(ev[0].para).not.toBe('b0');                // o mais antigo saiu
  });
});
