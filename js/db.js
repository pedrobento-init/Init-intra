// db.js - Serviço de Banco de Dados IndexedDB utilizando Dexie.js

const idb = new Dexie('InitIntraDB');

idb.version(1).stores({
  clients: 'id, name, segment',
  pendencias: 'id, clientId, status, priority',
  procedures: 'id, clientId, category',
  procedure_templates: 'id, category',
  operators: 'id, email, role',
  tickets: 'id, clientId, status',
  keyvalue: 'key'
});

idb.version(2).stores({
  user_profile: 'key',
  counters: 'key',
  sessions: 'key',
  audit_logs: '++id, type, target, timestamp, operatorId'
});

idb.version(3).stores({
  visits: 'id, clientId, operator, status, date'
});

idb.version(4).stores({
  reunioes: 'id, status, mesAno'
});

idb.version(5).stores({
  client_devices: 'id, client_id, milvus_device_id'
});

idb.version(6).stores({
  client_milvus_tickets: 'id, client_id, codigo'
});

idb.version(7).stores({
  equipamentos: 'id, clientId, status, tipo'
});

// v8 (offline-first): fila persistente de operações (outbox pattern).
// Aditiva — não toca nas tabelas existentes, upgrade seguro.
idb.version(8).stores({
  outbox: '++seq, entity, targetId, createdAt'
});

// v9: checklist do cliente — modelo global (por tipo) + marcações
// por cliente. Aditiva, mesmo padrão das versões anteriores.
idb.version(9).stores({
  checklist_modelo_itens: 'id, tipo, ordem',
  checklist_marcacoes: 'id, clientId, itemId'
});

// v10: entidade "checklists" (nome/ativo/ordem) — os itens passam a
// apontar para ela pelo campo `tipo` (id do checklist).
idb.version(10).stores({
  checklists: 'id, ativo, ordem'
});

// v11: vencimentos (licenças, SSL, domínios, garantias…). Aditiva.
idb.version(11).stores({
  vencimentos: 'id, clientId, dataVencimento'
});

// v12: lançamentos de horas (uma linha por sessão de trabalho). Aditiva.
idb.version(12).stores({
  time_entries: 'id, pendenciaId, clientId, endedAt'
});

// Cache síncrono em memória para garantir compatibilidade imediata com toda a UI
const _dbCache = {
  clients: [],
  pendencias: [],
  procedures: [],
  procedure_templates: [],
  operators: [],
  visits: [],
  reunioes: [],
  equipamentos: [],
  client_devices: [],
  client_milvus_tickets: [],
  checklists: [],
  vencimentos: [],
  time_entries: [],
  checklist_modelo_itens: [],
  checklist_marcacoes: [],
  keyvalue: {},
  user_profile: {},
  counters: {},
  sessions: {},
  audit_logs: []
};

let _dbReady = false;
const _storeWriteQueues = {};
// Store cuja leitura falhou no boot: o cache fica vazio, mas o IndexedDB pode
// ter linhas. Sem esta marca, a primeira setCacheStore faria bulkDelete das
// "stale" (= todas) e apagaria dados que nunca foram lidos.
const _dbLoadFailed = {};

/**
 * Inicialização e migração de dados do localStorage para o IndexedDB
 */
async function initIndexedDB() {
  try {
    const legacyKeys = {
      clients: 'intra_clients',
      pendencias: 'intra_pendencias',
      procedures: 'intra_procedures',
      procedure_templates: 'intra_procedure_templates',
      operators: 'intra_operators',
      tickets: 'intra_tickets',
      user: 'intra_user',
      counter: 'intra_counter',
      session: 'intra_session',
      logs: 'intra_logs'
    };

    let hasLegacyData = false;
    for (const key of Object.values(legacyKeys)) {
      if (localStorage.getItem(key) !== null) {
        hasLegacyData = true;
        break;
      }
    }

    if (hasLegacyData) {
      console.debug('📦 Migrando dados do localStorage para o IndexedDB...');

      const parseLS = (k, def = null) => {
        try {
          const raw = localStorage.getItem(k);
          return raw ? JSON.parse(raw) : def;
        } catch { return def; }
      };

      const legacyClients = parseLS(legacyKeys.clients, []);
      const legacyPendencias = parseLS(legacyKeys.pendencias, []);
      const legacyProcedures = parseLS(legacyKeys.procedures, []);
      const legacyTemplates = parseLS(legacyKeys.procedure_templates, []);
      const legacyOperators = parseLS(legacyKeys.operators, []);
      const legacyTickets = parseLS(legacyKeys.tickets, []);

      if (legacyClients.length) await idb.clients.bulkPut(legacyClients);
      if (legacyPendencias.length) await idb.pendencias.bulkPut(legacyPendencias);
      if (legacyProcedures.length) await idb.procedures.bulkPut(legacyProcedures);
      if (legacyTemplates.length) await idb.procedure_templates.bulkPut(legacyTemplates);
      if (legacyOperators.length) await idb.operators.bulkPut(legacyOperators);
      if (legacyTickets.length) await idb.tickets.bulkPut(legacyTickets);

      const kvItems = [
        { key: 'intra_user', value: parseLS(legacyKeys.user, {}) },
        { key: 'intra_counter', value: parseLS(legacyKeys.counter, {}) },
        { key: 'intra_session', value: parseLS(legacyKeys.session, null) },
        { key: 'intra_logs', value: parseLS(legacyKeys.logs, []) }
      ];

      for (const item of kvItems) {
        if (item.value !== null && item.value !== undefined) {
          await idb.keyvalue.put(item);
        }
      }

      // Limpar localStorage após importar com sucesso
      for (const key of Object.values(legacyKeys)) {
        localStorage.removeItem(key);
      }
      console.debug('✅ Migração para IndexedDB concluída com sucesso!');
    }

    // Carregar dados armazenados para o cache em memória. Cada store tem o
    // próprio try/catch: uma falha isolada não esvazia os demais caches (e
    // registra a marca para o setCacheStore não apagar linhas que não leu).
    const _loadStore = async (name, loader) => {
      try { _dbCache[name] = await loader(); }
      catch (_e) { _dbLoadFailed[name] = true; console.warn('⚠️ Falha ao carregar store "' + name + '" do IndexedDB (mantida a tabela):', _e); }
    };
    await _loadStore('clients', () => idb.clients.toArray());
    await _loadStore('pendencias', () => idb.pendencias.toArray());
    await _loadStore('procedures', () => idb.procedures.toArray());
    await _loadStore('procedure_templates', () => idb.procedure_templates.toArray());
    await _loadStore('operators', () => idb.operators.toArray());
    await _loadStore('visits', () => idb.visits.toArray());
    await _loadStore('reunioes', () => idb.reunioes.toArray());
    await _loadStore('equipamentos', () => idb.equipamentos.toArray());
    await _loadStore('client_devices', () => idb.client_devices.toArray());
    await _loadStore('client_milvus_tickets', () => idb.client_milvus_tickets.toArray());
    await _loadStore('checklist_modelo_itens', () => idb.checklist_modelo_itens.toArray());
    await _loadStore('checklist_marcacoes', () => idb.checklist_marcacoes.toArray());
    await _loadStore('checklists', () => idb.checklists.toArray());
    await _loadStore('vencimentos', () => idb.vencimentos.toArray());
    await _loadStore('time_entries', () => idb.time_entries.toArray());

    const allKV = await idb.keyvalue.toArray();
    allKV.forEach(item => {
      _dbCache.keyvalue[item.key] = item.value;
    });

    // Migrate v1 keyvalue entries to v2 dedicated tables
    const kvMigrations = [
      { key: 'intra_user', table: 'user_profile' },
      { key: 'intra_counter', table: 'counters' },
      { key: 'intra_session', table: 'sessions' },
      { key: 'intra_logs', table: 'audit_logs' }
    ];

    for (const { key, table } of kvMigrations) {
      const val = _dbCache.keyvalue[key];
      if (val !== undefined && val !== null) {
        if (table === 'audit_logs' && Array.isArray(val)) {
          if (val.length) await idb.audit_logs.bulkPut(val.map((entry, i) => ({ ...entry, id: entry.id || i + 1 })));
        } else {
          await idb[table].put({ key, value: val });
        }
        _dbCache[table] = table === 'audit_logs' ? val : { key, value: val };
        delete _dbCache.keyvalue[key];
        await idb.keyvalue.delete(key);
      }
    }

    // Load v2 tables into cache (mesma proteção por store do boot)
    try {
      const userProfile = await idb.user_profile.toArray();
      _dbCache.user_profile = userProfile.length ? userProfile[0] : {};
    } catch (_e) { _dbLoadFailed.user_profile = true; console.warn('⚠️ Falha ao carregar store "user_profile":', _e); }

    try {
      const counters = await idb.counters.toArray();
      _dbCache.counters = counters.length ? counters[0] : {};
    } catch (_e) { _dbLoadFailed.counters = true; console.warn('⚠️ Falha ao carregar store "counters":', _e); }

    try {
      const sessions = await idb.sessions.toArray();
      _dbCache.sessions = sessions.length ? sessions[0] : {};
    } catch (_e) { _dbLoadFailed.sessions = true; console.warn('⚠️ Falha ao carregar store "sessions":', _e); }

    try {
      _dbCache.audit_logs = await idb.audit_logs.toArray();
    } catch (_e) { _dbLoadFailed.audit_logs = true; console.warn('⚠️ Falha ao carregar store "audit_logs":', _e); }

    _dbReady = true;
    console.debug('⚡ IndexedDB carregado no cache com sucesso.');
  } catch (err) {
    console.error('❌ Erro durante a inicialização/migração do IndexedDB:', err);
  }
}

// ── Funções de manipulação do cache + persistência IndexedDB ──

function getCacheStore(storeName) {
  return _dbCache[storeName] || [];
}

function setCacheStore(storeName, items) {
  const data = Array.isArray(items) ? [...items] : items;
  _dbCache[storeName] = data;

  if (idb[storeName]) {
    const previous = _storeWriteQueues[storeName] || Promise.resolve();
    // FASE 5: sem clear() integral — upsert + remove só chaves obsoletas.
    // Todos os chamadores passam o array COMPLETO (lista, filtrada ou merge),
    // então o resultado final é idêntico ao clear+bulkPut, com ~metade do I/O.
    _storeWriteQueues[storeName] = previous.then(() => idb.transaction('rw', idb[storeName], async () => {
      if (!Array.isArray(data)) return;
      const keep = new Set(data.map(d => d && (d.id ?? d.key)));
      const keys = await idb[storeName].toCollection().primaryKeys();
      // Leitura do boot falhou: o cache não sabe o que existe — só faz upsert,
      // nunca apaga (as "stale" podem ser linhas que não foram lidas).
      const stale = _dbLoadFailed[storeName] ? [] : keys.filter(k => !keep.has(k));
      if (stale.length) await idb[storeName].bulkDelete(stale);
      if (data.length) await idb[storeName].bulkPut(data);
      else if (!_dbLoadFailed[storeName]) await idb[storeName].clear();
    })).catch(err => console.error(`❌ Erro ao persistir ${storeName} no IndexedDB:`, err));
  }
}

function getCacheKV(key, defaultValue = null) {
  return _dbCache.keyvalue[key] !== undefined ? _dbCache.keyvalue[key] : defaultValue;
}

function setCacheKV(key, value) {
  _dbCache.keyvalue[key] = value;
  idb.keyvalue.put({ key, value }).catch(err => console.error(`❌ Erro ao salvar chave ${key} no IndexedDB:`, err));
}

function removeCacheKV(key) {
  delete _dbCache.keyvalue[key];
  idb.keyvalue.delete(key).catch(err => console.error(`❌ Erro ao remover chave ${key} no IndexedDB:`, err));
}

// ── Funções para tabelas v2 dedicadas ──

function getCacheTable(tableName) {
  return _dbCache[tableName] || (Array.isArray(_dbCache[tableName]) ? [] : {});
}

function setCacheTable(tableName, data) {
  _dbCache[tableName] = data;
  if (Array.isArray(data)) {
    const previous = _storeWriteQueues[tableName] || Promise.resolve();
    // FASE 5: idem setCacheStore — sem clear() integral.
    _storeWriteQueues[tableName] = previous.then(() => idb.transaction('rw', idb[tableName], async () => {
      const keep = new Set(data.map(d => d && (d.id ?? d.key)));
      const keys = await idb[tableName].toCollection().primaryKeys();
      const stale = _dbLoadFailed[tableName] ? [] : keys.filter(k => !keep.has(k));
      if (stale.length) await idb[tableName].bulkDelete(stale);
      if (data.length) await idb[tableName].bulkPut(data);
      else if (!_dbLoadFailed[tableName]) await idb[tableName].clear();
    })).catch(err => console.error(`❌ Erro ao persistir ${tableName}:`, err));
  } else if (data && typeof data === 'object' && data.key) {
    idb.transaction('rw', idb[tableName], async () => {
      await idb[tableName].put(data);
    }).catch(err => console.error(`❌ Erro ao persistir ${tableName}:`, err));
  }
}

// Iniciar conexão com o banco de dados IndexedDB
const _initDBPromise = initIndexedDB();
