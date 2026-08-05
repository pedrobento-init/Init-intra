// storage.js – Abstração do localStorage

const DB = {
  CLIENTS: 'intra_clients',
  PENDENCIAS: 'intra_pendencias',
  PROCEDURES: 'intra_procedures',
  PROCEDURE_TEMPLATES: 'intra_procedure_templates',
  OPERATORS: 'intra_operators',
  VISITS: 'intra_visits',
  USER: 'intra_user',
  COUNTER: 'intra_counter',
  SESSION: 'intra_session',
  LOGS: 'intra_logs',
};

// ── EQUIPES / PERFIS ──
const TEAMS = {
  INIT: 'init',
  MAM: 'mam',
  POIESIS_1: 'poiesis_1',
  POIESIS_2: 'poiesis_2',
  POIESIS_3: 'poiesis_3',
  POIESIS_4: 'poiesis_4',
  POIESIS_5: 'poiesis_5',
  POIESIS_6: 'poiesis_6',
  BT: 'bt',
};

const TEAM_LABELS = {
  init: 'Init',
  mam: 'MAM',
  poiesis_1: 'Poiesis 1',
  poiesis_2: 'Poiesis 2',
  poiesis_3: 'Poiesis 3',
  poiesis_4: 'Poiesis 4',
  poiesis_5: 'Poiesis 5',
  poiesis_6: 'Poiesis 6',
  bt: 'BT',
};

const TEAM_OPTIONS = [
  { value: 'init', label: 'Init' },
  { value: 'mam', label: 'MAM' },
  { value: 'poiesis_1', label: 'Poiesis 1' },
  { value: 'poiesis_2', label: 'Poiesis 2' },
  { value: 'poiesis_3', label: 'Poiesis 3' },
  { value: 'poiesis_4', label: 'Poiesis 4' },
  { value: 'poiesis_5', label: 'Poiesis 5' },
  { value: 'poiesis_6', label: 'Poiesis 6' },
  { value: 'bt', label: 'BT' },
];

// ── PIN HASH (SHA-256 via crypto.subtle – assíncrono e nativo) ──
async function hashPin(pin, salt) {
  const str = 'intra:' + String(pin) + (salt ? ':' + String(salt) : '');
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}


// ── SESSÃO ──
const SESSION_TTL = 8 * 60 * 60 * 1000; // 8 horas

function getSession() {
  try {
    const cache = typeof getCacheTable === 'function' ? getCacheTable('sessions') : null;
    const s = cache?.value || null;
    if (!s) return null;
    if (Date.now() - s.ts > SESSION_TTL) { clearSession(); return null; }
    // Sessão local só vale com auth remoto ativo
    if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && !window._supabaseAuthActive) {
      return null;
    }
    return s;
  } catch { return null; }
}

function setSession(opId) {
  const op = getOperatorById(opId);
  if (!op) return null;
  const session = {
    opId,
    name:     op.name,
    initials: op.initials || op.name.substring(0, 2).toUpperCase(),
    color:    op.color || '#1a56db',
    role:     op.role || 'Técnico',
    isAdmin:  op.isAdmin === true,
    team:     op.team || 'init',
    ts: Date.now(),
  };
  if (typeof setCacheTable === 'function') setCacheTable('sessions', { key: DB.SESSION, value: session });
  return session;
}

function clearSession() {
  // Limpa via API normal
  if (typeof setCacheTable === 'function') setCacheTable('sessions', { key: DB.SESSION, value: null });
  // Limpa cache em memória diretamente (safety net contra race conditions)
  if (typeof _dbCache !== 'undefined') {
    _dbCache.sessions = { key: DB.SESSION, value: null };
  }
  // Limpa tabela IndexedDB sessions diretamente
  if (typeof idb !== 'undefined' && idb.sessions) {
    idb.sessions.clear().catch(() => {});
  }
}

// ── TEAM HELPERS ──
function getCurrentTeam() {
  const session = getSession();
  return session?.team || 'init';
}

function isTeamAdmin() {
  // Cross-team só para admin real (não basta ser time init)
  return typeof isCurrentAdmin === 'function' ? isCurrentAdmin() : false;
}

function canViewTeam(targetTeam) {
  if (isTeamAdmin()) return true;
  return getCurrentTeam() === (targetTeam || 'init');
}

function filterByTeam(items) {
  if (isTeamAdmin()) return items;
  const myTeam = getCurrentTeam();
  return items.filter(i => (i.team || 'init') === myTeam);
}

const KEY_TO_TABLE = {
  [DB.CLIENTS]: 'clients',
  [DB.PENDENCIAS]: 'pendencias',
  [DB.PROCEDURES]: 'procedures',
  [DB.PROCEDURE_TEMPLATES]: 'procedure_templates',
  [DB.OPERATORS]: 'operators',
  [DB.TICKETS]: 'tickets',
  [DB.VISITS]: 'visits'
};

const KV_TO_V2TABLE = {
  [DB.USER]: 'user_profile',
  [DB.COUNTER]: 'counters',
  [DB.SESSION]: 'sessions',
  [DB.LOGS]: 'audit_logs'
};

function dbGet(key) {
  if (typeof getCacheStore === 'function') {
    if (KEY_TO_TABLE[key]) {
      return getCacheStore(KEY_TO_TABLE[key]);
    }
    if (KV_TO_V2TABLE[key]) {
      const table = KV_TO_V2TABLE[key];
      const entry = typeof getCacheTable === 'function' ? getCacheTable(table) : null;
      return entry?.value ?? (table === 'audit_logs' ? [] : {});
    }
    if (typeof getCacheKV === 'function') return getCacheKV(key, []);
  }
  console.error('dbGet called before IndexedDB is ready for key:', key);
  return [];
}

function dbGetObj(key, def = {}) {
  if (typeof getCacheKV === 'function' && !KV_TO_V2TABLE[key]) {
    return getCacheKV(key, def);
  }
  if (KV_TO_V2TABLE[key]) {
    const table = KV_TO_V2TABLE[key];
    const entry = typeof getCacheTable === 'function' ? getCacheTable(table) : null;
    return entry?.value ?? def;
  }
  console.error('dbGetObj called before IndexedDB is ready for key:', key);
  return def;
}

function dbSet(key, value) {
  if (typeof setCacheStore === 'function') {
    if (KEY_TO_TABLE[key]) {
      setCacheStore(KEY_TO_TABLE[key], value);
    } else if (KV_TO_V2TABLE[key]) {
      const table = KV_TO_V2TABLE[key];
      if (typeof setCacheTable === 'function') setCacheTable(table, { key, value });
    } else {
      setCacheKV(key, value);
    }
    return;
  }
  console.error('dbSet called before IndexedDB is ready for key:', key);
}

function nextId(prefix) {
  let c;
  if (typeof getCacheTable === 'function') {
    const entry = getCacheTable('counters');
    c = entry?.value || {};
    c[prefix] = (c[prefix] || 0) + 1;
    setCacheTable('counters', { key: DB.COUNTER, value: c });
  } else {
    c = dbGetObj(DB.COUNTER, {});
    c[prefix] = (c[prefix] || 0) + 1;
    dbSet(DB.COUNTER, c);
  }
  return `${prefix}-${c[prefix]}`;
}

// ── SUPABASE CLOUD SYNC HELPERS ──
function _mergeRecords(local, remote, localKeyFromRemote) {
  const merged = [];
  let conflicts = 0;
  const conflictDetails = [];
  const remoteById = new Map(remote.map(r => [r.id, r]));
  for (const loc of local) {
    const rem = remoteById.get(loc.id);
    if (!rem) { merged.push(loc); continue; }
    const localTime = new Date(loc.updatedAt || 0).getTime();
    const remoteTime = new Date(rem.updated_at || 0).getTime();
    if (localTime >= remoteTime) { merged.push(loc); }
    else {
      conflicts++;
      const mapped = {};
      const changedFields = [];
      for (const [rk, lk] of Object.entries(localKeyFromRemote)) {
        mapped[lk] = rem[rk];
        if (loc[lk] !== undefined && rem[rk] !== undefined && String(loc[lk]) !== String(rem[rk])) {
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

function _mapToRemote(record, fieldMap) {
  const out = {};
  for (const [rk, lk] of Object.entries(fieldMap)) out[rk] = record[lk] ?? null;
  return out;
}

function _needsPush(local, remote) {
  if (!remote) return true;
  return new Date(local.updatedAt || 0).getTime() > new Date(remote.updated_at || 0).getTime();
}

/** Janela para manter criações offline locais ainda não vistas no servidor */
const _OFFLINE_PUSH_MS = 10 * 60 * 1000;

/**
 * Merge remoto + local sem ressuscitar deletes do servidor.
 * Mantém local-only só se for criação recente (offline).
 */
async function _syncEntity(dbKey, tableName, remote, fMap, label) {
  const local = dbGet(dbKey) || [];
  const { merged, conflicts, conflictDetails } = _mergeRecords(local, remote, fMap);
  const remoteIds = new Set(remote.map(r => r.id));
  const now = Date.now();
  const cleaned = merged.filter(item => {
    if (remoteIds.has(item.id)) return true;
    const t = new Date(item.updatedAt || item.createdAt || 0).getTime();
    return t > now - _OFFLINE_PUSH_MS;
  });
  dbSet(dbKey, cleaned);
  for (const item of cleaned) {
    const r = remote.find(x => x.id === item.id);
    if (_needsPush(item, r)) {
      await supabaseClient.from(tableName).upsert(_mapToRemote(item, fMap));
    }
  }
  return {
    conflicts,
    conflictDetails: conflictDetails.map(d => ({ ...d, table: label }))
  };
}

let _syncInFlight = null;

async function syncSupabaseToLocal() {
  if (typeof isSupabaseConnected !== 'function' || !isSupabaseConnected()) return;
  if (_syncInFlight) return _syncInFlight;
  _syncInFlight = (async () => {
  let totalConflicts = 0;
  let allConflictDetails = [];
  try {
    // 1. CLIENTS
    const { data: remoteClients, error: cliErr } = await supabaseClient.from('clients').select('*');
    if (cliErr) console.warn('Supabase clients error:', cliErr);
    if (remoteClients) {
      const fMap = { id:'id', name:'name', cnpj:'cnpj', segment:'segment', color:'color', initials:'initials', logo:'logo', logo_shape:'logoShape', owner:'owner', owner_phone:'ownerPhone', responsible:'responsible', responsible_phone:'responsiblePhone', technician:'technician', server:'server', hosting:'hosting', backup:'backup', licenses:'licenses', emails:'emails', google_sheet_url:'googleSheetUrl', team:'team', notes:'notes', attachments:'attachments', created_at:'createdAt', updated_at:'updatedAt' };
      const r = await _syncEntity(DB.CLIENTS, 'clients', remoteClients, fMap, 'Clientes');
      totalConflicts += r.conflicts;
      allConflictDetails.push(...r.conflictDetails);
    }

    // 2. PENDÊNCIAS
    const { data: remotePens, error: penErr } = await supabaseClient.from('pendencias').select('*');
    if (penErr) console.warn('Supabase pendencias error:', penErr);
    if (remotePens) {
      const fMap = { id:'id', client_id:'clientId', client_name:'clientName', tipo:'tipo', descricao:'descricao', responsible:'responsible', status:'status', priority:'priority', deadline:'deadline', notes:'notes', link_util:'linkUtil', team:'team', attachments:'attachments', checklist:'checklist', tags:'tags', timer_running:'timerRunning', timer_started_at:'timerStartedAt', timer_total_seconds:'timerTotalSeconds', timer_operator:'timerOperator', completed_at:'completedAt', created_at:'createdAt', updated_at:'updatedAt' };
      const r = await _syncEntity(DB.PENDENCIAS, 'pendencias', remotePens, fMap, 'Pendências');
      totalConflicts += r.conflicts;
      allConflictDetails.push(...r.conflictDetails);
    }

    // 3. OPERATORS — remoto manda em privilégios; dedupe por e-mail
    const { data: remoteOps, error: opErr } = await supabaseClient
      .from('operators')
      .select('id,name,initials,color,role,phone,email,is_admin,active,team,auth_user_id,created_at,updated_at');
    if (opErr) console.warn('Supabase operators error:', opErr);
    if (remoteOps) {
      const localOps = dbGet(DB.OPERATORS) || [];
      const opFieldMap = { id:'id', name:'name', initials:'initials', color:'color', role:'role', phone:'phone', email:'email', is_admin:'isAdmin', active:'active', team:'team', created_at:'createdAt', updated_at:'updatedAt' };
      const { merged, conflicts, conflictDetails } = _mergeRecords(localOps, remoteOps, opFieldMap);
      totalConflicts += conflicts;
      allConflictDetails.push(...conflictDetails.map(d => ({ ...d, table: 'Operadores' })));
      const localMap = new Map(localOps.map(o => [o.id, o]));
      const remoteMap = new Map(remoteOps.map(r => [r.id, r]));
      const remoteIds = new Set(remoteOps.map(r => r.id));
      const remoteEmails = new Set(remoteOps.map(r => (r.email || '').toLowerCase()).filter(Boolean));
      const now = Date.now();

      for (const o of merged) {
        const loc = localMap.get(o.id);
        const rem = remoteMap.get(o.id);
        if (rem) {
          o.isAdmin = rem.is_admin === true;
          o.active = rem.active !== false;
          o.team = rem.team || 'init';
          o.auth_user_id = rem.auth_user_id || loc?.auth_user_id || null;
          // Hashes de senha não trafegam no sync (auth via Supabase)
          o.pinHash = loc?.pinHash || null;
          o.pinSalt = loc?.pinSalt || null;
        } else {
          o.pinHash = loc?.pinHash || null;
          o.pinSalt = loc?.pinSalt || null;
          o.auth_user_id = loc?.auth_user_id || null;
        }
      }

      const deduped = merged.filter(o => {
        if (remoteIds.has(o.id)) return true;
        const em = (o.email || '').toLowerCase();
        if (em && remoteEmails.has(em)) return false;
        const t = new Date(o.updatedAt || o.createdAt || 0).getTime();
        return t > now - _OFFLINE_PUSH_MS;
      });

      const byEmail = new Map();
      const noEmail = [];
      for (const o of deduped) {
        const em = (o.email || '').toLowerCase();
        if (!em) { noEmail.push(o); continue; }
        const prev = byEmail.get(em);
        if (!prev) { byEmail.set(em, o); continue; }
        const prefer = remoteIds.has(o.id) && !remoteIds.has(prev.id) ? o
          : remoteIds.has(prev.id) && !remoteIds.has(o.id) ? prev
          : (new Date(o.updatedAt || 0) >= new Date(prev.updatedAt || 0) ? o : prev);
        byEmail.set(em, prefer);
      }
      const finalOps = [...byEmail.values(), ...noEmail];
      dbSet(DB.OPERATORS, finalOps);

      for (const o of finalOps) {
        const r = remoteOps.find(x => x.id === o.id);
        if (_needsPush(o, r) && typeof isCurrentAdmin === 'function' && isCurrentAdmin()) {
          await supabaseClient.from('operators').upsert({
            id: o.id, name: o.name, initials: o.initials, color: o.color, role: o.role,
            phone: o.phone, email: o.email,
            is_admin: o.isAdmin === true, active: o.active !== false, team: o.team || 'init',
            auth_user_id: o.auth_user_id || null,
            created_at: o.createdAt || new Date().toISOString(), updated_at: o.updatedAt || new Date().toISOString()
          });
        }
      }
    }

    // 5. PROCEDURES
    const { data: remoteProcs, error: procErr } = await supabaseClient.from('procedures').select('*');
    if (procErr) console.warn('Supabase procedures error:', procErr);
    if (remoteProcs) {
      const fMap = { id:'id', client_id:'clientId', title:'title', category:'category', content:'content', created_at:'createdAt', updated_at:'updatedAt' };
      const r = await _syncEntity(DB.PROCEDURES, 'procedures', remoteProcs, fMap, 'Procedimentos');
      totalConflicts += r.conflicts;
      allConflictDetails.push(...r.conflictDetails);
    }

    // 6. VISITS
    try {
      const { data: remoteVisits, error: visErr } = await supabaseClient.from('visits').select('*');
      if (visErr) {
        console.warn('Supabase visits (sync pulado):', visErr.message);
      } else if (remoteVisits) {
        const fMap = { id:'id', client_id:'clientId', client_name:'clientName', operator:'operator', date:'date', time:'time', motivo:'motivo', observacoes:'observacoes', status:'status', team:'team', categories:'categories', checklist:'checklist', created_at:'createdAt', updated_at:'updatedAt' };
        const r = await _syncEntity(DB.VISITS, 'visits', remoteVisits, fMap, 'Visitas');
        totalConflicts += r.conflicts;
        allConflictDetails.push(...r.conflictDetails);
      }
    } catch (e) {
      console.warn('Supabase visits (sync pulado — tabela ausente?):', e.message);
    }

    // 7. PROCEDURE TEMPLATES
    const { data: remoteTpls, error: tplErr } = await supabaseClient.from('procedure_templates').select('*');
    if (tplErr) console.warn('Supabase procedure_templates error:', tplErr);
    if (remoteTpls) {
      const fMap = { id:'id', title:'title', category:'category', content:'content', created_by:'createdBy', created_at:'createdAt', updated_at:'updatedAt' };
      const r = await _syncEntity(DB.PROCEDURE_TEMPLATES, 'procedure_templates', remoteTpls, fMap, 'Modelos');
      totalConflicts += r.conflicts;
      allConflictDetails.push(...r.conflictDetails);
    }

    // 8. LOGS — só admins leem; merge com raw local
    const { data: remoteLogs, error: logErr } = await supabaseClient.from('audit_logs').select('*').order('timestamp', { ascending: false }).limit(500);
    if (logErr) console.warn('Supabase logs error:', logErr);
    if (remoteLogs && remoteLogs.length > 0) {
      const mapped = remoteLogs.map(l => ({ id: l.id, operatorName: l.operator_name, action: l.action, type: l.type, targetId: l.target_id, details: l.details, timestamp: l.timestamp }));
      const localLogs = _getLogsRaw();
      const allIds = new Map(localLogs.map(l => [l.id || (l.timestamp + l.action), l]));
      for (const l of mapped) { allIds.set(l.id || (l.timestamp + l.action), l); }
      const mergedLogs = [...allIds.values()].sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
      if (typeof setCacheTable === 'function') setCacheTable('audit_logs', mergedLogs);
      else dbSet(DB.LOGS, mergedLogs);
    }

    if (totalConflicts > 0 && typeof showToast === 'function') {
      showToast(`${totalConflicts} registro(s) atualizado(s) pelo servidor.`, 'info');
      if (allConflictDetails.length > 0 && typeof openModal === 'function') {
        const FIELD_LABELS = { name:'Nome', title:'Título', descricao:'Descrição', status:'Status', priority:'Prioridade', responsible:'Responsável', technician:'Técnico', cnpj:'CNPJ', segment:'Segmento', phone:'Telefone', email:'E-mail', notes:'Observações', deadline:'Prazo', content:'Conteúdo' };
        const rows = allConflictDetails.slice(0, 10).map(d => {
          const cells = d.fields.slice(0, 3).map(f => `<span style="color:var(--text-muted)">${FIELD_LABELS[f.field]||f.field}:</span> <s style="color:var(--red);opacity:.6">${escapeHtml(String(f.local||'').substring(0,30))}</s> → <span style="color:var(--green)">${escapeHtml(String(f.remote||'').substring(0,30))}</span>`).join('<br>');
          return `<div style="padding:8px 0;border-bottom:1px solid var(--border)"><strong>${escapeHtml(String(d.name||d.id).substring(0,40))}</strong> <span class="text-muted" style="font-size:11px">(${escapeHtml(d.table)})</span><div style="font-size:12px;margin-top:4px">${cells}</div></div>`;
        }).join('');
        const more = allConflictDetails.length > 10 ? `<p style="font-size:12px;color:var(--text-muted);margin-top:8px">...e mais ${allConflictDetails.length - 10} registro(s).</p>` : '';
        openModal('Conflitos de Sincronização', `<div style="max-height:400px;overflow-y:auto">${rows}${more}</div><p style="font-size:11px;color:var(--text-muted);margin-top:12px">Valores do servidor foram aplicados automaticamente.</p>`, 'lg');
      }
    }
  } catch (err) {
    console.warn('Sincronização Supabase em background:', err);
  } finally {
    _syncInFlight = null;
  }
  })();
  return _syncInFlight;
}

// Sync no load só se já houver sessão autenticada
if (typeof window !== 'undefined') {
  window.addEventListener('load', () => {
    setTimeout(() => {
      if (window._supabaseAuthActive) syncSupabaseToLocal();
    }, 500);
  });
}

// ── HISTÓRICO DE ATIVIDADES ──
function _getLogsRaw() {
  if (typeof getCacheTable === 'function') {
    const data = getCacheTable('audit_logs');
    return Array.isArray(data) ? data : [];
  }
  const v = dbGet(DB.LOGS);
  return Array.isArray(v) ? v : [];
}

function getLogs() {
  if (typeof isCurrentAdmin === 'function' && getSession() && !isCurrentAdmin()) return [];
  return _getLogsRaw();
}

function addLog(action, type, targetId, details) {
  const session = getSession();
  const operatorName = session ? session.name : 'Sistema';
  const log = {
    timestamp: new Date().toISOString(),
    operatorName,
    action,
    type,
    targetId,
    details: details || '',
    operatorId: session?.opId || null
  };

  if (typeof getCacheTable === 'function' && typeof setCacheTable === 'function') {
    const logs = _getLogsRaw();
    logs.unshift(log);
    if (logs.length > 2000) logs.pop();
    setCacheTable('audit_logs', logs);
  } else {
    log.id = nextId('LOG');
    const logs = _getLogsRaw();
    logs.unshift(log);
    if (logs.length > 2000) logs.pop();
    dbSet(DB.LOGS, logs);
  }

  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    supabaseClient.from('audit_logs').insert([{
      id: crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2, 10),
      operator_name: log.operatorName,
      action: log.action,
      type: log.type,
      target_id: log.targetId,
      details: log.details,
      timestamp: log.timestamp
    }]).then(res => { if(res.error) console.warn('⚠️ Supabase log:', res.error.message); })
      .catch(err => console.warn('⚠️ Rede log:', err.message));
  }

  return log;
}

// ── ATTACHMENTS ──
const ATTACHMENT_MAX_SIZE = 2 * 1024 * 1024; // 2MB
const ATTACHMENT_MAX_COUNT = 5;

function getAttachments(type, itemId) {
  // type = 'clients' | 'pendencias'
  const keyMap = { clients: DB.CLIENTS, pendencias: DB.PENDENCIAS };
  const list = dbGet(keyMap[type] || type);
  const item = list.find(i => i.id === itemId);
  return (item && item.attachments) ? item.attachments : [];
}

function addAttachment(type, itemId, fileObj) {
  // fileObj = {name, type, size, data (base64)}
  if (fileObj.size > ATTACHMENT_MAX_SIZE) {
    return { error: 'Arquivo excede o limite de 2MB.' };
  }
  const keyMap = { clients: DB.CLIENTS, pendencias: DB.PENDENCIAS };
  const key = keyMap[type];
  if (!key) return { error: 'Tipo inválido.' };
  const list = dbGet(key);
  const idx = list.findIndex(i => i.id === itemId);
  if (idx === -1) return { error: 'Item não encontrado.' };
  if (!list[idx].attachments) list[idx].attachments = [];
  if (list[idx].attachments.length >= ATTACHMENT_MAX_COUNT) {
    return { error: `Máximo de ${ATTACHMENT_MAX_COUNT} anexos por item.` };
  }
  const att = {
    id: 'ATT-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
    name: fileObj.name,
    mimeType: fileObj.type,
    size: fileObj.size,
    data: fileObj.data,
    uploadedBy: (getSession()?.name) || 'Sistema',
    uploadedAt: new Date().toISOString()
  };
  list[idx].attachments.push(att);
  list[idx].updatedAt = new Date().toISOString();
  dbSet(key, list);
  addLog('Anexou arquivo', type === 'clients' ? 'Cliente' : 'Pendência', itemId, fileObj.name);
  _pushAttachmentsToRemote(type, list[idx]);
  return { success: true, attachment: att };
}

function removeAttachment(type, itemId, attachmentId) {
  const keyMap = { clients: DB.CLIENTS, pendencias: DB.PENDENCIAS };
  const key = keyMap[type];
  if (!key) return false;
  const list = dbGet(key);
  const idx = list.findIndex(i => i.id === itemId);
  if (idx === -1) return false;
  if (!list[idx].attachments) return false;
  const attIdx = list[idx].attachments.findIndex(a => a.id === attachmentId);
  if (attIdx === -1) return false;
  const attName = list[idx].attachments[attIdx].name;
  list[idx].attachments.splice(attIdx, 1);
  list[idx].updatedAt = new Date().toISOString();
  dbSet(key, list);
  addLog('Removeu anexo', type === 'clients' ? 'Cliente' : 'Pendência', itemId, attName);
  _pushAttachmentsToRemote(type, list[idx]);
  return true;
}

function _pushAttachmentsToRemote(type, item) {
  if (!item?.id) return;
  if (typeof isSupabaseConnected !== 'function' || !isSupabaseConnected() || !window._supabaseAuthActive) return;
  const tableMap = { clients: 'clients', pendencias: 'pendencias' };
  const table = tableMap[type];
  if (!table) return;
  const now = item.updatedAt || new Date().toISOString();
  supabaseClient.from(table).update({
    attachments: item.attachments || [],
    updated_at: now
  }).eq('id', item.id).then(res => {
    if (res.error) console.warn('⚠️ Supabase anexos:', res.error.message);
  }).catch(err => console.warn('⚠️ Rede anexos:', err.message));
}

function handleFileUpload(type, itemId, inputElement, callback) {
  const file = inputElement.files[0];
  if (!file) return;
  if (file.size > ATTACHMENT_MAX_SIZE) {
    if (typeof showToast === 'function') showToast('Arquivo excede o limite de 2MB.', 'error');
    inputElement.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = function(ev) {
    const result = addAttachment(type, itemId, {
      name: file.name,
      type: file.type,
      size: file.size,
      data: ev.target.result
    });
    if (result.error) {
      if (typeof showToast === 'function') showToast(result.error, 'error');
    } else {
      if (typeof showToast === 'function') showToast('Arquivo anexado!', 'success');
      if (callback) callback(result.attachment);
    }
    inputElement.value = '';
  };
  reader.readAsDataURL(file);
}

function renderAttachmentList(type, itemId, containerId) {
  const atts = getAttachments(type, itemId);
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!atts.length) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:12px;padding:8px 0">Nenhum anexo.</p>';
    return;
  }
  container.innerHTML = atts.map(a => {
    const isImage = a.mimeType && a.mimeType.startsWith('image/');
    const sizeKB = (a.size / 1024).toFixed(1);
    const icon = isImage ? '🖼️' : a.mimeType?.includes('pdf') ? '📄' : '📎';
    return `<div class="attachment-item">
      ${isImage ? `<img src="${a.data}" class="attachment-thumb" alt="${escapeHtml(a.name)}" onclick="window.open(this.src,'_blank')" />` : `<div class="attachment-icon">${icon}</div>`}
      <div class="attachment-info">
        <div class="attachment-name">${escapeHtml(a.name)}</div>
        <div class="attachment-meta">${sizeKB} KB · ${escapeHtml(a.uploadedBy)} · ${formatDateTime(a.uploadedAt)}</div>
      </div>
      <div class="attachment-actions">
        <a href="${a.data}" download="${escapeHtml(a.name)}" class="btn btn-sm btn-secondary" title="Baixar">⬇</a>
        <button class="btn btn-sm btn-danger" onclick="removeAttachmentUI('${type}','${itemId}','${a.id}','${containerId}')" title="Remover">✕</button>
      </div>
    </div>`;
  }).join('');
}

function removeAttachmentUI(type, itemId, attId, containerId) {
  if (removeAttachment(type, itemId, attId)) {
    if (typeof showToast === 'function') showToast('Anexo removido.', 'info');
    renderAttachmentList(type, itemId, containerId);
  }
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}


// ── CLIENTS ──
function getClients() { return dbGet(DB.CLIENTS); }
function getClientsByTeam(team) {
  const all = getClients();
  if (!team) return all;
  return all.filter(c => (c.team || 'init') === team);
}
function getMyClients() {
  return filterByTeam(getClients());
}
function getClientById(id) { return getClients().find(c => c.id === id) || null; }
function saveClient(data) {
  const clients = getClients();
  const isEdit = !!data.id;
  var now = new Date().toISOString();
  if (!data.team) data.team = getCurrentTeam();
  if (isEdit) {
    const i = clients.findIndex(c => c.id === data.id);
    if (i !== -1) clients[i] = { ...clients[i], ...data, updatedAt: now };
  } else {
    data.id = nextId('CLI');
    data.createdAt = now;
    data.updatedAt = now;
    clients.push(data);
  }
  dbSet(DB.CLIENTS, clients);
  addLog(isEdit ? 'Editou' : 'Criou', 'Cliente', data.id, data.name);

  // Sync Supabase (inclui anexos)
  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    const saved = getClientById(data.id) || data;
    supabaseClient.from('clients').upsert({
      id: saved.id,
      name: saved.name,
      cnpj: saved.cnpj,
      segment: saved.segment,
      color: saved.color,
      initials: saved.initials,
      logo: saved.logo,
      logo_shape: saved.logoShape || 'circle',
      owner: saved.owner,
      owner_phone: saved.ownerPhone,
      responsible: saved.responsible,
      responsible_phone: saved.responsiblePhone,
      technician: saved.technician,
      server: saved.server,
      hosting: saved.hosting,
      backup: saved.backup,
      licenses: saved.licenses,
      emails: saved.emails,
      google_sheet_url: saved.googleSheetUrl || null,
      notes: saved.notes,
      team: saved.team || 'init',
      attachments: saved.attachments || [],
      created_at: saved.createdAt || now,
      updated_at: now
    }).then(res => {
      if (res.error) console.error('❌ Supabase cliente:', res.error);
    }).catch(err => {
      console.error('❌ Erro de rede Supabase cliente:', err.message);
    });
  }

  return data;
}
function deleteClient(id) {
  if (!canDelete()) {
    if (typeof showToast === 'function') showToast('Permissão negada para excluir clientes.', 'error');
    return false;
  }
  const client = getClientById(id);
  const name = client ? client.name : 'Desconhecido';
  dbSet(DB.CLIENTS, getClients().filter(c => c.id !== id));
  addLog('Excluiu', 'Cliente', id, name);

  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    supabaseClient.from('clients').delete().eq('id', id).then(res => { if(res.error) console.error('❌ Supabase excluir cliente:', res.error); });
  }
}

// ── PENDÊNCIAS ──
function getPendencias() { return dbGet(DB.PENDENCIAS); }
function getPendenciasByTeam(team) {
  const all = getPendencias();
  if (!team) return all;
  return all.filter(p => (p.team || 'init') === team);
}
function getMyPendencias() {
  return filterByTeam(getPendencias());
}
function getPendenciaById(id) { return getPendencias().find(p => p.id === id) || null; }
function savePendencia(data) {
  const list = getPendencias();
  const isEdit = !!data.id;
  var now = new Date().toISOString();
  // Herda team do cliente se não informado
  if (!data.team && data.clientId) {
    const client = getClientById(data.clientId);
    if (client) data.team = client.team || 'init';
  }
  if (!data.team) data.team = getCurrentTeam();
  let oldStatus = null;
  if (isEdit) {
    const i = list.findIndex(p => p.id === data.id);
    if (i !== -1) { oldStatus = list[i].status; list[i] = { ...list[i], ...data, updatedAt: now };
    } else {
      data.id = nextId('PEN');
      data.createdAt = now;
      data.updatedAt = now;
      data.status = data.status || 'em_andamento';
      list.push(data);
    }
  } else {
    data.id = nextId('PEN');
    data.createdAt = now;
    data.updatedAt = now;
    data.status = data.status || 'em_andamento';
    list.push(data);
  }
  if (data.status === 'concluido' && oldStatus !== 'concluido') {
    data.completedAt = now;
    const idx = list.findIndex(p => p.id === data.id);
    if (idx !== -1) list[idx].completedAt = data.completedAt;
  }
  dbSet(DB.PENDENCIAS, list);
  addLog(isEdit ? 'Editou' : 'Criou', 'Pendência', data.id, data.descricao);

  // Notificação por e-mail (não bloqueia a operação)
  setTimeout(() => {
    try {
      if (isEdit && typeof notifyPendenciaUpdated === 'function') {
        notifyPendenciaUpdated(data, oldStatus);
      } else if (!isEdit && typeof notifyPendenciaCreated === 'function') {
        notifyPendenciaCreated(data);
      }
    } catch (e) { console.warn('📧 Erro na notificação de pendência:', e); }
  }, 100);

  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    supabaseClient.from('pendencias').upsert({
      id: data.id,
      client_id: data.clientId,
      client_name: data.clientName,
      tipo: data.tipo,
      descricao: data.descricao,
      responsible: data.responsible,
      status: data.status,
      priority: data.priority,
      deadline: data.deadline || null,
      notes: data.notes || [],
      link_util: data.linkUtil || '',
      team: data.team || 'init',
      attachments: data.attachments || [],
      checklist: data.checklist || [],
      tags: data.tags || [],
      timer_running: data.timerRunning === true,
      timer_started_at: data.timerStartedAt || null,
      timer_total_seconds: data.timerTotalSeconds || 0,
      timer_operator: data.timerOperator || null,
      completed_at: data.completedAt || null,
      created_at: data.createdAt || now,
      updated_at: now
    }).then(res => {
      if (res.error) console.warn('⚠️ Supabase pendência (sync pulado — verifique schema):', res.error.message);
    }).catch(err => {
      console.warn('⚠️ Erro de rede Supabase pendência:', err.message);
    });
  }

  return data;
}
function deletePendencia(id) {
  if (!canDelete()) {
    if (typeof showToast === 'function') showToast('Permissão negada para excluir pendências.', 'error');
    return false;
  }
  const pen = getPendenciaById(id);
  const desc = pen ? pen.descricao : 'Desconhecido';
  dbSet(DB.PENDENCIAS, getPendencias().filter(p => p.id !== id));
  addLog('Excluiu', 'Pendência', id, desc);

  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    supabaseClient.from('pendencias').delete().eq('id', id).then(res => { if(res.error) console.error('❌ Supabase excluir pendência:', res.error); });
  }
}
function addPendenciaNote(id, text, author) {
  const list = getPendencias();
  const i = list.findIndex(p => p.id === id);
  if (i === -1) return;
  if (!list[i].notes) list[i].notes = [];
  const note = { text, author, createdAt: new Date().toISOString() };
  list[i].notes.push(note);
  list[i].updatedAt = new Date().toISOString();
  dbSet(DB.PENDENCIAS, list);

  // Notificação por e-mail (não bloqueia a operação)
  setTimeout(() => {
    try {
      if (typeof notifyPendenciaNote === 'function') {
        notifyPendenciaNote(list[i], note);
      }
    } catch (e) { console.warn('📧 Erro na notificação de nota:', e); }
  }, 100);

  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    supabaseClient.from('pendencias').update({
      notes: list[i].notes,
      updated_at: list[i].updatedAt
    }).eq('id', id).then(res => { if(res.error) console.error('❌ Supabase atualizar pendência:', res.error); });
  }
}

// ── VISITS (Visitas Técnicas) ──
const VISIT_STATUS_MAP = {
  agendada:     { label: 'Agendada',     color: '#0ea5e9' },
  em_andamento: { label: 'Em andamento', color: '#f59e0b' },
  concluida:    { label: 'Concluída',    color: '#16a34a' },
  cancelada:    { label: 'Cancelada',    color: '#94a3b8' },
};

function getVisits() { return dbGet(DB.VISITS); }
function getVisitsByTeam(team) {
  const all = getVisits();
  if (!team) return all;
  return all.filter(v => (v.team || 'init') === team);
}
function getMyVisits() { return filterByTeam(getVisits()); }
function getVisitById(id) { return getVisits().find(v => v.id === id) || null; }
function getVisitsByClient(clientId) {
  return getVisits().filter(v => v.clientId === clientId)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}
function getVisitsByOperator(operatorName) {
  return getVisits().filter(v => v.operator === operatorName)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}
function saveVisit(data) {
  const list = getVisits();
  const isEdit = !!data.id;
  if (!data.team && data.clientId) {
    const client = getClientById(data.clientId);
    if (client) data.team = client.team || 'init';
  }
  if (!data.team) data.team = getCurrentTeam();
  const now = new Date().toISOString();
  if (isEdit) {
    const i = list.findIndex(v => v.id === data.id);
    if (i !== -1) list[i] = { ...list[i], ...data, updatedAt: now };
    else list.push({ ...data, createdAt: now, updatedAt: now });
  } else {
    data.id = nextId('VIS');
    data.createdAt = now;
    data.updatedAt = now;
    list.push(data);
  }
  dbSet(DB.VISITS, list);
  addLog(isEdit ? 'Editou' : 'Criou', 'Visita', data.id, data.clientName + ' – ' + (data.motivo || ''));

  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    const saved = getVisitById(data.id) || data;
    supabaseClient.from('visits').upsert({
      id: saved.id,
      client_id: saved.clientId,
      client_name: saved.clientName,
      operator: saved.operator,
      date: saved.date,
      time: saved.time || null,
      motivo: saved.motivo,
      observacoes: saved.observacoes || '',
      status: saved.status,
      team: saved.team || 'init',
      categories: saved.categories || [],
      checklist: saved.checklist || [],
      created_at: saved.createdAt || now,
      updated_at: now
    }).then(res => { if (res.error) console.error('❌ Supabase visita:', res.error); });
  }
  return data;
}
function deleteVisit(id) {
  if (!canDelete()) {
    if (typeof showToast === 'function') showToast('Permissão negada para excluir visitas.', 'error');
    return false;
  }
  const v = getVisitById(id);
  const desc = v ? (v.clientName + ' – ' + (v.motivo || '')) : 'Desconhecido';
  dbSet(DB.VISITS, getVisits().filter(x => x.id !== id));
  addLog('Excluiu', 'Visita', id, desc);

  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    supabaseClient.from('visits').delete().eq('id', id).then(res => { if (res.error) console.error('❌ Supabase excluir visita:', res.error); });
  }
}

// ── PROCEDURES ──
function getProcedures(clientId) {
  const all = dbGet(DB.PROCEDURES);
  return clientId ? all.filter(p => p.clientId === clientId) : all;
}
function saveProcedure(data) {
  const list = dbGet(DB.PROCEDURES);
  const isEdit = !!data.id;
  var now = new Date().toISOString();
  if (isEdit) {
    const i = list.findIndex(p => p.id === data.id);
    if (i !== -1) list[i] = { ...list[i], ...data, updatedAt: now };
  } else {
    data.id = nextId('PROC');
    data.createdAt = now;
    data.updatedAt = now;
    list.push(data);
  }
  dbSet(DB.PROCEDURES, list);
  addLog(isEdit ? 'Editou' : 'Criou', 'Procedimento', data.id, data.title);

  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    supabaseClient.from('procedures').upsert({
      id: data.id,
      client_id: data.clientId,
      title: data.title,
      category: data.category,
      content: data.content,
      created_at: data.createdAt || now,
      updated_at: now
    }).then(res => { if(res.error) console.error('❌ Supabase procedimento:', res.error); });
  }

  return data;
}
function deleteProcedure(id) {
  if (!canDelete()) {
    if (typeof showToast === 'function') showToast('Permissão negada para excluir procedimentos.', 'error');
    return false;
  }
  const list = dbGet(DB.PROCEDURES);
  const proc = list.find(p => p.id === id);
  const title = proc ? proc.title : 'Desconhecido';
  dbSet(DB.PROCEDURES, list.filter(p => p.id !== id));
  addLog('Excluiu', 'Procedimento', id, title);

  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    supabaseClient.from('procedures').delete().eq('id', id).then(res => { if(res.error) console.error('❌ Supabase excluir procedimento:', res.error); });
  }
}

// ── PROCEDURE TEMPLATES ──
function getProcedureTemplates() {
  return dbGet(DB.PROCEDURE_TEMPLATES);
}
function getProcedureTemplateById(id) {
  return getProcedureTemplates().find(t => t.id === id) || null;
}
function saveProcedureTemplate(data) {
  const list = dbGet(DB.PROCEDURE_TEMPLATES);
  const isEdit = !!data.id;
  const currentUser = typeof getUser === 'function' ? getUser() : null;
  const author = data.createdBy || (currentUser ? currentUser.name : 'Suporte TI');
  var now = new Date().toISOString();

  if (isEdit) {
    const i = list.findIndex(t => t.id === data.id);
    if (i !== -1) list[i] = { ...list[i], ...data, createdBy: author, updatedAt: now };
  } else {
    data.id = nextId('TPL');
    data.createdBy = author;
    data.createdAt = now;
    data.updatedAt = now;
    list.push(data);
  }
  dbSet(DB.PROCEDURE_TEMPLATES, list);
  addLog(isEdit ? 'Editou' : 'Criou', 'Modelo Procedimento', data.id, data.title);

  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    supabaseClient.from('procedure_templates').upsert({
      id: data.id,
      title: data.title,
      category: data.category,
      content: data.content,
      created_by: data.createdBy,
      created_at: data.createdAt || now,
      updated_at: now
    }).then(res => { if(res.error) console.error('❌ Supabase modelo procedimento:', res.error); });
  }

  return data;
}
function deleteProcedureTemplate(id) {
  if (!canDelete()) {
    if (typeof showToast === 'function') showToast('Permissão negada para excluir modelos de procedimento.', 'error');
    return false;
  }
  const list = dbGet(DB.PROCEDURE_TEMPLATES);
  const tpl = list.find(t => t.id === id);
  const title = tpl ? tpl.title : 'Desconhecido';
  dbSet(DB.PROCEDURE_TEMPLATES, list.filter(t => t.id !== id));
  addLog('Excluiu', 'Modelo Procedimento', id, title);

  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    supabaseClient.from('procedure_templates').delete().eq('id', id).then(res => { if(res.error) console.error('❌ Supabase excluir modelo procedimento:', res.error); });
  }
  return true;
}

// ── USER ──
function getUser() {
  const session = getSession();
  if (session) return { name: session.name, initials: session.initials, color: session.color, role: session.role };
  if (typeof getCacheTable === 'function') {
    const entry = getCacheTable('user_profile');
    return entry?.value || { name: 'Suporte TI', initials: 'TI' };
  }
  return dbGetObj(DB.USER, { name: 'Suporte TI', initials: 'TI' });
}

function saveUser(data) {
  if (typeof setCacheTable === 'function') {
    setCacheTable('user_profile', { key: DB.USER, value: data });
  } else {
    dbSet(DB.USER, data);
  }
}

// ── OPERATORS ──
function getOperators() { return dbGet(DB.OPERATORS); }
function getOperatorById(id) { return getOperators().find(o => o.id === id) || null; }
function getOperatorByEmail(email) {
  if (!email) return null;
  const e = email.trim().toLowerCase();
  return getOperators().find(o => o.email?.toLowerCase() === e) || null;
}
function getOperatorByAuthId(authUserId) {
  if (!authUserId) return null;
  return getOperators().find(o => o.auth_user_id === authUserId) || null;
}
async function saveOperator(data) {
  const list = getOperators();
  if (data.id === null || data.id === undefined || data.id === '') delete data.id;
  const isEdit = !!data.id;
  const existing = isEdit ? list.find(o => o.id === data.id) : null;
  
  var now = new Date().toISOString();

  // Preserve existing pinSalt or generate new one
  if (!data.pinSalt && existing?.pinSalt) {
    data.pinSalt = existing.pinSalt;
  }
  if (!data.pinSalt) {
    data.pinSalt = Array.from(crypto.getRandomValues(new Uint8Array(8))).map(b => b.toString(16).padStart(2,'0')).join('');
  }
  
  // Compute new hash only if a new pin was provided
  if (data.pin) {
    data.pinHash = await hashPin(data.pin, data.pinSalt);
    delete data.pin;
  } else if (!data.pinHash && existing?.pinHash) {
    // Preserve existing password when not changing it
    data.pinHash = existing.pinHash;
  }

  let savedOp;
  if (isEdit) {
    const i = list.findIndex(o => o.id === data.id);
    if (i !== -1) {
      list[i] = { ...list[i], ...data, updatedAt: now };
      savedOp = list[i];
    } else {
      savedOp = data;
    }
  } else {
    data.id = nextId('OP');
    data.createdAt = now;
    data.updatedAt = now;
    data.active = true;
    list.push(data);
    savedOp = data;
  }
  dbSet(DB.OPERATORS, list);
  
  // Sync the current session if this operator is the one logged in
  const session = getSession();
  if (session && session.opId === savedOp.id) {
    setSession(savedOp.id);
    if (typeof updateUserUI === 'function') updateUserUI();
  }
  
  addLog(isEdit ? 'Editou' : 'Criou', 'Operador', savedOp.id, savedOp.name);

  // Sync to Supabase (sem pin_hash/pin_salt — senha só no Auth)
  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    const payload = {
      id: savedOp.id,
      name: savedOp.name,
      initials: savedOp.initials,
      color: savedOp.color,
      role: savedOp.role,
      phone: savedOp.phone,
      email: savedOp.email,
      is_admin: savedOp.isAdmin === true,
      active: savedOp.active !== false,
      team: savedOp.team || 'init',
      auth_user_id: savedOp.auth_user_id || null,
      created_at: savedOp.createdAt || now,
      updated_at: now
    };
    supabaseClient.from('operators').upsert(payload).then(res => {
      if (res.error) {
        console.warn('⚠️ Sync operador:', res.error.message);
      }
    }).catch(() => {});
  }

  return savedOp;
}
function deleteOperator(id) {
  if (!canManageOps()) {
    if (typeof showToast === 'function') showToast('Permissão negada para excluir operadores.', 'error');
    return false;
  }
  const op = getOperatorById(id);
  const name = op ? op.name : 'Desconhecido';
  dbSet(DB.OPERATORS, getOperators().filter(o => o.id !== id));
  addLog('Excluiu', 'Operador', id, name);

  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    supabaseClient.from('operators').delete().eq('id', id).then(res => { if(res.error) console.error('❌ Supabase excluir operador:', res.error); });
  }
}
function toggleOperatorActive(id) {
  const list = getOperators();
  const i = list.findIndex(o => o.id === id);
  if (i !== -1) {
    list[i].active = !list[i].active;
    dbSet(DB.OPERATORS, list);
    addLog(list[i].active ? 'Ativou' : 'Desativou', 'Operador', id, list[i].name);

    if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
      supabaseClient.from('operators').update({ active: list[i].active }).eq('id', id).then(res => { if(res.error) console.error('❌ Supabase toggle operador:', res.error); });
    }
  }
}

function isCurrentAdmin() {
  const session = getSession();
  if (!session) return false;
  const op = getOperatorById(session.opId);
  return op ? (op.isAdmin === true && op.active !== false) : false;
}

const PERMISSIONS = {
  admin:    { delete: true, editAll: true, manageOps: true, viewAll: true, export: true },
  supervisor: { delete: false, editAll: true, manageOps: false, viewAll: true, export: true },
  tecnico:  { delete: false, editAll: false, manageOps: false, viewAll: false, export: false }
};

function getCurrentPermissions() {
  const session = getSession();
  if (!session) return PERMISSIONS.tecnico;
  const op = getOperatorById(session.opId);
  if (!op || op.active === false) return PERMISSIONS.tecnico;
  if (op.isAdmin) return PERMISSIONS.admin;
  const roleLower = (op.role || '').toLowerCase();
  if (roleLower.includes('supervisor') || roleLower.includes('gerente') || roleLower.includes('coordenador')) return PERMISSIONS.supervisor;
  return PERMISSIONS.tecnico;
}

function canDelete() { return getCurrentPermissions().delete; }
function canEditAll() { return getCurrentPermissions().editAll; }
function canManageOps() { return getCurrentPermissions().manageOps; }
function canViewAll() { return getCurrentPermissions().viewAll; }
function canExport() { return getCurrentPermissions().export; }

function resetOperatorPassword(opId) {
  if (!isCurrentAdmin()) return false;
  const list = getOperators();
  const i = list.findIndex(o => o.id === opId);
  if (i !== -1) {
    list[i].pinHash = null;
    list[i].updatedAt = new Date().toISOString();
    dbSet(DB.OPERATORS, list);
    // If the reset operator is the current session, update it
    const session = getSession();
    if (session && session.opId === opId) {
      setSession(opId);
    }
    return true;
  }
  return false;
}

// ── SEED ──
function seedDemoData() {
  // Nunca seedar em produção / com backend configurado
  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected()) return;
  if (localStorage.getItem('intra_allow_demo_seed') !== '1') return;
  if (getClients().length > 0) return;

  // Operadores não são mais seedados — cadastro manual / login Auth

  const clients = [
    {
      id: 'CLI-1', createdAt: '2025-01-10T10:00:00Z', updatedAt: '2025-01-10T10:00:00Z', team: 'init',
      name: 'Padaria Central', cnpj: '12.345.678/0001-90', segment: 'Alimentação',
      color: '#f97316', initials: 'PC',
      owner: 'Carlos Mendes', ownerPhone: '(11) 99999-1111',
      responsible: 'Ana Lima', responsiblePhone: '(11) 98888-2222',
      technician: 'João Silva',
      server: { type: 'Físico', os: 'Windows Server 2019', ip: '192.168.1.10', remoteAccess: 'AnyDesk', remoteId: '123456789', notes: 'Senha padrão no cofre' },
      hosting: { provider: 'HostGator', panelUrl: 'https://painel.hostgator.com', user: 'padaria@email.com', notes: 'Plano Business' },
      backup: { frequency: 'Diário', time: '23:00', destination: 'HD Externo + Google Drive', tool: 'Acronis', lastCheck: '2025-04-20', notes: '' },
      licenses: [{ software: 'Windows Server 2019', key: 'XXXXX-XXXXX-XXXXX', expiry: '2027-12-31' }],
      emails: { provider: 'Google Workspace', domain: 'padariacentral.com.br', server: 'smtp.gmail.com', port: '587', quota: '30GB/usuário' },
      notes: 'Cliente prioritário. Não realizar manutenção em horário comercial sem aviso prévio.'
    },
    {
      id: 'CLI-2', createdAt: '2025-02-15T10:00:00Z', updatedAt: '2025-02-15T10:00:00Z', team: 'init',
      name: 'Distribuidora Ômega', cnpj: '98.765.432/0001-10', segment: 'Distribuição',
      color: '#6366f1', initials: 'DΩ',
      owner: 'Roberto Prado', ownerPhone: '(11) 97777-3333',
      responsible: 'Fernanda Costa', responsiblePhone: '(11) 96666-4444',
      technician: 'Maria Santos',
      server: { type: 'Cloud (AWS)', os: 'Ubuntu 22.04', ip: '54.12.34.56', remoteAccess: 'SSH + VPN', remoteId: '', notes: 'Acesso via chave SSH' },
      hosting: { provider: 'AWS', panelUrl: 'https://console.aws.amazon.com', user: 'admin@omega.com.br', notes: 'EC2 t3.medium' },
      backup: { frequency: 'Semanal', time: '02:00 Domingo', destination: 'S3 Bucket', tool: 'AWS Backup', lastCheck: '2025-04-14', notes: '' },
      licenses: [],
      emails: { provider: 'Microsoft 365', domain: 'omega.com.br', server: 'outlook.office365.com', port: '993', quota: '50GB/usuário' },
      notes: 'Qualquer mudança precisa de aprovação do Roberto.'
    },
    {
      id: 'CLI-3', createdAt: '2025-03-01T10:00:00Z', updatedAt: '2025-03-01T10:00:00Z', team: 'init',
      name: 'Al Marques', cnpj: '11.222.333/0001-44', segment: 'Varejo',
      color: '#22c55e', initials: 'AM',
      owner: 'Al Marques', ownerPhone: '(11) 91111-5555',
      responsible: 'Al Marques', responsiblePhone: '(11) 91111-5555',
      technician: 'João Silva',
      server: { type: 'Físico', os: 'Windows 11', ip: '192.168.0.5', remoteAccess: 'TeamViewer', remoteId: '987654321', notes: '' },
      hosting: { provider: '', panelUrl: '', user: '', notes: '' },
      backup: { frequency: 'Mensal', time: '', destination: 'HD Externo', tool: 'Manual', lastCheck: '2025-03-01', notes: '' },
      licenses: [],
      emails: { provider: 'Gmail', domain: 'gmail.com', server: '', port: '', quota: '' },
      notes: ''
    }
  ];

  const procedures = [
    {
      id: 'PROC-1', clientId: 'CLI-1', createdAt: '2025-01-15T10:00:00Z', updatedAt: '2025-01-15T10:00:00Z',
      title: 'Acesso remoto via AnyDesk', category: 'Acesso',
      content: '1. Abrir AnyDesk\n2. Inserir ID: 123456789\n3. Solicitar senha ao responsável (Carlos Mendes)\n4. Aceitar a conexão no computador do cliente\n\nObservação: Sempre avisar antes de conectar.'
    },
    {
      id: 'PROC-2', clientId: 'CLI-1', createdAt: '2025-01-16T10:00:00Z', updatedAt: '2025-01-16T10:00:00Z',
      title: 'Verificação do backup diário', category: 'Backup',
      content: '1. Acessar o servidor via AnyDesk\n2. Abrir o Acronis True Image\n3. Verificar o log do último backup (deve ser às 23h)\n4. Confirmar que o backup no Google Drive está sincronizado\n5. Registrar verificação na planilha de controle'
    },
    {
      id: 'PROC-3', clientId: 'CLI-2', createdAt: '2025-02-20T10:00:00Z', updatedAt: '2025-02-20T10:00:00Z',
      title: 'Acesso SSH ao servidor AWS', category: 'Acesso',
      content: '1. Conectar à VPN da Ômega\n2. Abrir terminal: ssh -i ~/.ssh/omega.pem ubuntu@54.12.34.56\n3. Senha da VPN disponível no cofre\n\nATENÇÃO: Nunca fazer sudo rm sem aprovação do Roberto Prado.'
    }
  ];

  const procedureTemplates = [
    {
      id: 'TPL-1', createdAt: '2025-01-10T10:00:00Z', updatedAt: '2025-01-10T10:00:00Z',
      title: 'Verificação Padrão de Backup', category: 'Backup',
      createdBy: 'Felipe',
      content: '1. Acessar o servidor via Acesso Remoto.\n2. Abrir o software de backup (ex: Acronis, AWS Backup, Veeam).\n3. Verificar status do último job executado.\n4. Validar espaço disponível no destino do backup.\n5. Registrar resultado da verificação.'
    },
    {
      id: 'TPL-2', createdAt: '2025-01-12T10:00:00Z', updatedAt: '2025-01-12T10:00:00Z',
      title: 'Configuração de Acesso Remoto Padrão', category: 'Acesso',
      createdBy: 'Pedro',
      content: '1. Instalar o aplicativo de acesso remoto no estação/servidor.\n2. Definir senha não supervisionada / permanente segura.\n3. Cadastrar ID no sistema e salvar no cofre de senhas.\n4. Realizar teste de conexão antes de liberar ao suporte.'
    },
    {
      id: 'TPL-3', createdAt: '2025-01-15T10:00:00Z', updatedAt: '2025-01-15T10:00:00Z',
      title: 'Checklist de Onboarding de Novo Usuário', category: 'Usuários',
      createdBy: 'Giovane',
      content: '1. Criar conta de e-mail corporativo.\n2. Cadastrar usuário no Active Directory / Servidor de Arquivos.\n3. Aplicar permissões de pastas conforme departamento.\n4. Configurar conta no smartphone/notebook do usuário.\n5. Enviar credenciais temporárias de forma segura.'
    }
  ];

  dbSet(DB.CLIENTS, clients);
  dbSet(DB.PROCEDURES, procedures);
  if (getProcedureTemplates().length === 0) {
    dbSet(DB.PROCEDURE_TEMPLATES, procedureTemplates);
  }
  const currentCounters = dbGetObj(DB.COUNTER, { CLI: 3, PEN: 0, PROC: 3, OP: 0 });
  dbSet(DB.COUNTER, { ...currentCounters, CLI: 3, PEN: 0, PROC: 3, TPL: 3, OP: 0 });
}

// ── VALIDAÇÃO ──
const Validators = {
  cpf(v) {
    if (!v) return true;
    const d = v.replace(/\D/g, '');
    if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += parseInt(d[i]) * (10 - i);
    let rev = 11 - (sum % 11);
    if (rev === 10 || rev === 11) rev = 0;
    if (rev !== parseInt(d[9])) return false;
    sum = 0;
    for (let i = 0; i < 10; i++) sum += parseInt(d[i]) * (11 - i);
    rev = 11 - (sum % 11);
    if (rev === 10 || rev === 11) rev = 0;
    return rev === parseInt(d[10]);
  },

  cnpj(v) {
    if (!v) return true;
    const d = v.replace(/\D/g, '');
    if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
    const weights1 = [5,4,3,2,9,8,7,6,5,4,3,2];
    const weights2 = [6,5,4,3,2,9,8,7,6,5,4,3,2];
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += parseInt(d[i]) * weights1[i];
    let rem = sum % 11;
    const digit1 = rem < 2 ? 0 : 11 - rem;
    if (parseInt(d[12]) !== digit1) return false;
    sum = 0;
    for (let i = 0; i < 13; i++) sum += parseInt(d[i]) * weights2[i];
    rem = sum % 11;
    const digit2 = rem < 2 ? 0 : 11 - rem;
    return parseInt(d[13]) === digit2;
  },

  email(v) {
    if (!v) return true;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
  },

  phone(v) {
    if (!v) return true;
    const d = v.replace(/\D/g, '');
    return d.length >= 10 && d.length <= 11;
  },

  required(v) {
    return v && v.trim().length > 0;
  }
};

function validateClient(data) {
  const errors = [];
  if (!Validators.required(data.name)) errors.push('Nome é obrigatório.');
  // CNPJ/CPF é opcional e aceita qualquer valor (não validamos dígitos verificadores)
  if (data.ownerPhone && !Validators.phone(data.ownerPhone)) errors.push('Telefone do proprietário inválido.');
  if (data.responsiblePhone && !Validators.phone(data.responsiblePhone)) errors.push('Telefone do responsável inválido.');
  return errors;
}

function validatePendencia(data) {
  const errors = [];
  if (!Validators.required(data.descricao)) errors.push('Descrição é obrigatória.');
  if (data.linkUtil && !/^https?:\/\//.test(data.linkUtil) && !/^mailto:/.test(data.linkUtil)) errors.push('Link inválido (use https://...).');
  return errors;
}

function validateOperator(data) {
  const errors = [];
  if (!Validators.required(data.name)) errors.push('Nome é obrigatório.');
  if (data.email && !Validators.email(data.email)) errors.push('E-mail inválido.');
  if (data.phone && !Validators.phone(data.phone)) errors.push('Telefone inválido.');
  if (data.initials && data.initials.length > 3) errors.push('Iniciais devem ter no máximo 3 caracteres.');
  if (data.email) {
    const email = data.email.trim().toLowerCase();
    const dup = getOperators().find(o => o.email?.toLowerCase() === email && o.id !== data.id);
    if (dup) errors.push(`Já existe um operador com o e-mail ${data.email} (${dup.name}).`);
  }
  return errors;
}



function validateTemplate(data) {
  const errors = [];
  if (!Validators.required(data.title)) errors.push('Título é obrigatório.');
  if (!Validators.required(data.content)) errors.push('Conteúdo é obrigatório.');
  return errors;
}
