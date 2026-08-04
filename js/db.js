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

// Cache síncrono em memória para garantir compatibilidade imediata com toda a UI
const _dbCache = {
  clients: [],
  pendencias: [],
  procedures: [],
  procedure_templates: [],
  operators: [],
  visits: [],
  keyvalue: {},
  user_profile: {},
  counters: {},
  sessions: {},
  audit_logs: []
};

let _dbReady = false;

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
      console.log('📦 Migrando dados do localStorage para o IndexedDB...');

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
      console.log('✅ Migração para IndexedDB concluída com sucesso!');
    }

    // Carregar dados armazenados para o cache em memória
    _dbCache.clients = await idb.clients.toArray();
    _dbCache.pendencias = await idb.pendencias.toArray();
    _dbCache.procedures = await idb.procedures.toArray();
    _dbCache.procedure_templates = await idb.procedure_templates.toArray();
    _dbCache.operators = await idb.operators.toArray();
    _dbCache.visits = await idb.visits.toArray();

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

    // Load v2 tables into cache
    const userProfile = await idb.user_profile.toArray();
    _dbCache.user_profile = userProfile.length ? userProfile[0] : {};

    const counters = await idb.counters.toArray();
    _dbCache.counters = counters.length ? counters[0] : {};

    const sessions = await idb.sessions.toArray();
    _dbCache.sessions = sessions.length ? sessions[0] : {};

    _dbCache.audit_logs = await idb.audit_logs.toArray();

    _dbReady = true;
    console.log('⚡ IndexedDB carregado no cache com sucesso.');
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
    idb.transaction('rw', idb[storeName], async () => {
      await idb[storeName].clear();
      if (data && data.length) {
        await idb[storeName].bulkPut(data);
      }
    }).catch(err => console.error(`❌ Erro ao persistir ${storeName} no IndexedDB:`, err));
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
    idb.transaction('rw', idb[tableName], async () => {
      await idb[tableName].clear();
      if (data.length) await idb[tableName].bulkPut(data);
    }).catch(err => console.error(`❌ Erro ao persistir ${tableName}:`, err));
  } else if (data && typeof data === 'object' && data.key) {
    idb.transaction('rw', idb[tableName], async () => {
      await idb[tableName].put(data);
    }).catch(err => console.error(`❌ Erro ao persistir ${tableName}:`, err));
  }
}

// Iniciar conexão com o banco de dados IndexedDB
const _initDBPromise = initIndexedDB();
