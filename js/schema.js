// schema.js — Fonte única de verdade das entidades (sync + realtime)
// =============================================================================
// Um único registro declarativo por entidade do Supabase. A partir dele são
// derivados: o mapa de campos (remote -> local) para o sync bidirecional, o
// mapeamento/coerção do Realtime, o filtro por equipe e o refresh da UI.
// Carregado ANTES de supabase-config.js e storage.js.
// =============================================================================

const ENTITIES = [
  {
    table: 'clients',
    dbKey: 'intra_clients',
    label: 'Clientes',
    hasTeam: true,
    sync: true,
    realtime: true,
    fields: {
      id: 'id', name: 'name', cnpj: 'cnpj', segment: 'segment', color: 'color',
      initials: 'initials', logo: 'logo', logo_shape: 'logoShape', owner: 'owner',
      owner_phone: 'ownerPhone', responsible: 'responsible', responsible_phone: 'responsiblePhone',
      technician: 'technician', server: 'server', hosting: 'hosting', backup: 'backup',
      licenses: 'licenses', emails: 'emails', google_sheet_url: 'googleSheetUrl', team: 'team',
      notes: 'notes', attachments: 'attachments', documents: 'documents', created_at: 'createdAt', updated_at: 'updatedAt'
    },
    onChange: () => {
      if ((window.location.hash.replace('#', '') || '') === 'clientes' && document.getElementById('clientGrid') && typeof renderClientGrid === 'function') renderClientGrid();
    }
  },
  {
    table: 'pendencias',
    dbKey: 'intra_pendencias',
    label: 'Pendências',
    hasTeam: true,
    sync: true,
    realtime: true,
    fields: {
      id: 'id', client_id: 'clientId', client_name: 'clientName', tipo: 'tipo', descricao: 'descricao',
      responsible: 'responsible', status: 'status', priority: 'priority', deadline: 'deadline',
      notes: 'notes', link_util: 'linkUtil', team: 'team', attachments: 'attachments',
      checklist: 'checklist', tags: 'tags', recurrence: 'recurrence', visit_id: 'visitId',
      reviewed_in_meeting: 'reviewedInMeeting',
      timer_running: 'timerRunning', timer_started_at: 'timerStartedAt', timer_total_seconds: 'timerTotalSeconds',
      timer_operator: 'timerOperator', completed_at: 'completedAt', created_at: 'createdAt', updated_at: 'updatedAt'
    },
    onChange: () => {
      if (typeof updateBadges === 'function') updateBadges();
      if ((window.location.hash.replace('#', '') || '') === 'pendencias' && document.getElementById('penViewArea') && typeof renderPenView === 'function') renderPenView(false);
    }
  },
  {
    table: 'tickets',
    dbKey: 'intra_tickets',
    label: 'Chamados',
    hasTeam: false,
    sync: true,
    realtime: false,
    fields: {
      id: 'id', client_id: 'clientId', client_name: 'clientName', title: 'title', description: 'description',
      status: 'status', priority: 'priority', technician: 'technician', updates: 'updates', team: 'team',
      attachments: 'attachments', timer_running: 'timerRunning', timer_started_at: 'timerStartedAt',
      timer_total_seconds: 'timerTotalSeconds', timer_operator: 'timerOperator', completed_at: 'completedAt',
      created_at: 'createdAt', updated_at: 'updatedAt'
    }
  },
  {
    table: 'operators',
    dbKey: 'intra_operators',
    label: 'Operadores',
    hasTeam: false,
    sync: true,
    realtime: true,
    fields: {
      id: 'id', name: 'name', initials: 'initials', color: 'color', role: 'role', phone: 'phone',
      email: 'email', is_admin: 'isAdmin', active: 'active', team: 'team', auth_user_id: 'auth_user_id',
      on_leave: 'onLeave',
      created_at: 'createdAt', updated_at: 'updatedAt'
    },
    // pinHash/pinSalt não vêm do mapeamento genérico — são preservados por onMerged
    onMerged: (merged, local, remote) => {
      const localMap = new Map(local.map(o => [o.id, o]));
      const remoteMap = new Map(remote.map(r => [r.id, r]));
      for (const o of merged) {
        const loc = localMap.get(o.id);
        const rem = remoteMap.get(o.id);
        const localTime = new Date(loc?.updatedAt || 0).getTime();
        const remoteTime = new Date(rem?.updated_at || 0).getTime();
        if (localTime >= remoteTime) {
          o.pinHash = loc?.pinHash || null;
          o.pinSalt = loc?.pinSalt || null;
        } else {
          o.pinHash = rem?.pin_hash || loc?.pinHash || null;
          o.pinSalt = rem?.pin_salt || loc?.pinSalt || null;
        }
      }
      return merged;
    },
    buildUpsert: o => ({
      id: o.id, name: o.name, initials: o.initials, color: o.color, role: o.role, phone: o.phone,
      email: o.email, pin_hash: o.pinHash || null, pin_salt: o.pinSalt || null,
      is_admin: o.isAdmin === true, active: o.active !== false, team: o.team || 'init',
      auth_user_id: o.auth_user_id || null, on_leave: o.onLeave === true,
      created_at: o.createdAt || new Date().toISOString(), updated_at: o.updatedAt || new Date().toISOString()
    }),
    mapRow: r => ({
      id: r.id, name: r.name, initials: r.initials, color: r.color, role: r.role, phone: r.phone,
      email: r.email, isAdmin: r.is_admin === true, active: r.active !== false, team: r.team || 'init',
      auth_user_id: r.auth_user_id, onLeave: r.on_leave === true, createdAt: r.created_at, updatedAt: r.updated_at
    }),
    onChange: () => {
      if ((window.location.hash.replace('#', '') || '') === 'operadores' && document.getElementById('opGridWrap') && typeof filterOperadores === 'function') filterOperadores();
    }
  },
  {
    table: 'procedures',
    dbKey: 'intra_procedures',
    label: 'Procedimentos',
    hasTeam: false,
    sync: true,
    realtime: true,
    fields: {
      id: 'id', client_id: 'clientId', title: 'title', category: 'category', content: 'content',
      created_at: 'createdAt', updated_at: 'updatedAt'
    },
    onChange: () => {}
  },
  {
    table: 'visits',
    dbKey: 'intra_visits',
    label: 'Visitas',
    hasTeam: true,
    sync: true,
    realtime: true,
    optional: true,
    fields: {
      id: 'id', client_id: 'clientId', client_name: 'clientName', operator: 'operator', date: 'date',
      time: 'time', time_end: 'timeEnd', all_day: 'allDay', motivo: 'motivo', observacoes: 'observacoes',
      relatorio: 'relatorio', status: 'status', recurrence: 'recurrence', team: 'team',
      categories: 'categories', checklist: 'checklist', created_at: 'createdAt', updated_at: 'updatedAt'
    },
    mapRow: r => ({
      id: r.id, clientId: r.client_id, clientName: r.client_name, operator: r.operator, date: r.date,
      time: r.time, motivo: r.motivo, observacoes: r.observacoes, relatorio: r.relatorio, status: r.status,
      recurrence: r.recurrence, team: r.team, timeEnd: r.time_end, allDay: r.all_day === true,
      categories: r.categories || [], checklist: r.checklist || [],
      createdAt: r.created_at, updatedAt: r.updated_at
    }),
    onChange: () => {
      const h = window.location.hash.replace('#', '') || '';
      if (h === 'visitas' && document.getElementById('visitViewArea') && typeof renderVisitView === 'function') renderVisitView();
      if (h === 'calendario' && typeof refreshCalendar === 'function') refreshCalendar();
    }
  },
  {
    table: 'reunioes',
    dbKey: 'intra_reunioes',
    label: 'Reuniões',
    hasTeam: true,
    sync: true,
    realtime: true,
    optional: true,
    fields: {
      id: 'id', mes_ano: 'mesAno', status: 'status', started_at: 'startedAt', ended_at: 'endedAt',
      team: 'team', relatorio: 'relatorio', participants: 'participants',
      created_at: 'createdAt', updated_at: 'updatedAt'
    },
    mapRow: r => ({
      id: r.id, mesAno: r.mes_ano, status: r.status, startedAt: r.started_at, endedAt: r.ended_at,
      team: r.team, relatorio: r.relatorio, participants: r.participants || [],
      createdAt: r.created_at, updatedAt: r.updated_at
    }),
    onChange: () => {
      const h = window.location.hash.replace('#', '') || '';
      if (h === 'reuniao' && document.getElementById('reuniaoViewArea') && typeof renderReuniaoView === 'function') renderReuniaoView();
    }
  },
  {
    table: 'procedure_templates',
    dbKey: 'intra_procedure_templates',
    label: 'Modelos',
    hasTeam: false,
    sync: true,
    realtime: true,
    fields: {
      id: 'id', title: 'title', category: 'category', content: 'content', created_by: 'createdBy',
      created_at: 'createdAt', updated_at: 'updatedAt'
    },
    onChange: () => {
      if ((window.location.hash.replace('#', '') || '') === 'templates' && document.getElementById('templatesGridWrap') && typeof renderTemplatesGrid === 'function') renderTemplatesGrid();
    }
  },
  {
    table: 'audit_logs',
    dbKey: 'intra_logs',
    label: 'Logs',
    hasTeam: false,
    sync: false,
    realtime: true,
    cacheTable: 'audit_logs',
    mapRow: r => ({
      id: r.id, operatorName: r.operator_name, action: r.action, type: r.type,
      targetId: r.target_id, details: r.details, timestamp: r.timestamp
    }),
    onChange: () => {
      if ((window.location.hash.replace('#', '') || '') === 'historico' && typeof renderLogs === 'function') renderLogs();
    }
  }
];

// Entidades que participam do sync bidirecional (na ordem de processamento)
const SYNC_ENTITIES = ENTITIES.filter(e => e.sync !== false);

// ── Funções puras de mapeamento/merge (sem dependência de DOM) ──

function _valuesDiffer(a, b) {
  if (a !== null && typeof a === 'object' && b !== null && typeof b === 'object') {
    return JSON.stringify(a) !== JSON.stringify(b);
  }
  return String(a) !== String(b);
}

// remote -> local (usado no Realtime e na leitura do Supabase)
function _mapFromRemote(remote, fieldMap) {
  const out = {};
  for (const [rk, lk] of Object.entries(fieldMap)) out[lk] = remote[rk];
  return out;
}

// local -> remote (usado no push/upsert)
function _mapToRemote(record, fieldMap) {
  const out = {};
  for (const [rk, lk] of Object.entries(fieldMap)) out[rk] = record[lk] ?? null;
  return out;
}

function _mergeRecords(local, remote, localKeyFromRemote) {
  const merged = [];
  let conflicts = 0;
  const conflictDetails = [];
  const remoteById = new Map(remote.map(r => [r.id, r]));
  for (const loc of local) {
    const rem = remoteById.get(loc.id);
    // Supabase is authoritative for records that no longer exist remotely.
    // Keeping these local orphans makes deleted records reappear on the next push.
    if (!rem) { continue; }
    const localTime = new Date(loc.updatedAt || 0).getTime();
    const remoteTime = new Date(rem.updated_at || 0).getTime();
    if (localTime > remoteTime) { merged.push(loc); }
    else {
      conflicts++;
      const mapped = {};
      const changedFields = [];
      for (const [rk, lk] of Object.entries(localKeyFromRemote)) {
        mapped[lk] = rem[rk];
        if (loc[lk] !== undefined && rem[rk] !== undefined && _valuesDiffer(loc[lk], rem[rk])) {
          changedFields.push({ field: lk, local: loc[lk], remote: rem[rk] });
        }
      }
      if (changedFields.length) conflictDetails.push({ id: loc.id, name: loc.name || loc.title || loc.descricao || loc.id, fields: changedFields });
      merged.push({ ...loc, ...mapped });
    }
    remoteById.delete(loc.id);
  }
  for (const rem of remoteById.values()) {
    const mapped = {};
    for (const [rk, lk] of Object.entries(localKeyFromRemote)) mapped[lk] = rem[rk];
    merged.push(mapped);
  }
  return { merged, conflicts, conflictDetails };
}

function _needsPush(local, remote) {
  if (!remote) return true;
  return new Date(local.updatedAt || 0).getTime() > new Date(remote.updated_at || 0).getTime();
}

// Export para testes (Node/Vitest). Em browser, `module` não existe e os
// identificadores acima ficam disponíveis no escopo global dos scripts.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ENTITIES, SYNC_ENTITIES, _valuesDiffer, _mapFromRemote, _mapToRemote, _mergeRecords, _needsPush };
}
