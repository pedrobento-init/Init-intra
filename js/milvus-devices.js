// milvus-devices.js — Inventário Milvus (SOMENTE listagem de dispositivos)
// =====================================================================
// O frontend NUNCA acessa o Milvus diretamente e NUNCA vê o token.
// Fluxo: frontend → Edge Function `milvus-devices` (valida JWT + team,
// mesma regra do RLS) → Milvus → upsert → retorno agregado.
// NÃO inclui: softwares, status online/offline, Google, e-mails.

const MILVUS_SYNC_AT_KEY = 'intra_milvus_sync_at_v1';
const MILVUS_MAX_PAGES = 60;

// ── Autorização client-side (defesa em profundidade; o servidor revalida) ──
function canSyncClientDevices(operator, client) {
  if (!operator || !client) return false;
  if (operator.active === false) return false;
  if (operator.isAdmin === true) return true;
  return (operator.team || 'init') === (client.team || 'init');
}

// ── Normalização (espelho do servidor; null-safe, sem licença) ──
function normalizeMilvusDevice(raw, clientId, team) {
  if (!raw || typeof raw !== 'object') return null;
  const num = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  };
  const txt = (v) => (v === null || v === undefined ? '' : String(v));
  const iso = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const d = new Date(String(v));
    return isNaN(d.getTime()) ? null : d.toISOString();
  };
  const mid = num(raw.id);
  if (mid === null) return null;
  // `sistema_operacional_licenca` é ignorado de propósito (pode conter chave).
  return {
    id: clientId + ':milvus-' + mid,
    client_id: clientId,
    team: team || 'init',
    milvus_device_id: mid,
    hostname: txt(raw.hostname),
    apelido: txt(raw.apelido),
    ip_interno: txt(raw.ip_interno),
    ip_externo: txt(raw.ip_externo),
    mac_address: txt(raw.macaddres !== undefined ? raw.macaddres : raw.mac_address),
    // marca ← fabricante quando a API omite (mesma família; placa_mae só
    // entra como último recurso na exibição, via mapMilvusRowToLocal).
    marca: txt(raw.marca) || txt(raw.fabricante),
    fabricante: txt(raw.fabricante),
    is_ativo: raw.is_ativo === undefined || raw.is_ativo === null
      ? true
      : raw.is_ativo === true || raw.is_ativo === 1 || raw.is_ativo === '1',
    data_criacao: iso(raw.data_criacao),
    data_ultima_atualizacao: iso(raw.data_ultima_atualizacao),
    dominio: txt(raw.dominio),
    sistema_operacional: txt(raw.sistema_operacional),
    placa_mae: txt(raw.placa_mae),
    placa_mae_serial: txt(raw.placa_mae_serial),
    processador: txt(raw.processador),
    versao_client: txt(raw.versao_client),
    observacao: txt(raw.observacao),
    usuario_logado: txt(raw.usuario_logado),
    total_processadores: num(raw.total_processadores),
    numero_serial: txt(raw.numero_serial),
    placa_mae_modelo: txt(raw.placa_mae_modelo),
    data_compra: iso(raw.data_compra) ? iso(raw.data_compra).slice(0, 10) : null,
    data_garantia: iso(raw.data_garantia) ? iso(raw.data_garantia).slice(0, 10) : null,
    modelo_notebook: txt(raw.modelo_notebook),
    nome_fantasia: txt(raw.nome_fantasia),
    tipo_dispositivo_id: num(raw.tipo_dispositivo_id),
    tipo_dispositivo_text: txt(raw.tipo_dispositivo_text),
  };
}

// ── Paginação (puros, testáveis) ──
function buildMilvusListPayload(page) {
  return {
    is_paginate: true,
    is_descending: false,
    order_by: 'id',
    total_registros: 1000,
    pagina: page,
  };
}

function parseMilvusPage(data, fallbackPage) {
  if (!data || typeof data !== 'object') throw new Error('Resposta inválida do Milvus');
  const lista = data.lista !== undefined ? data.lista : data.data;
  if (!Array.isArray(lista)) throw new Error('Resposta do Milvus sem lista de dispositivos');
  const pag = (data.meta && data.meta.paginate) || {};
  const current = Number(pag.current_page !== undefined ? pag.current_page : fallbackPage) || fallbackPage;
  const last = Number(pag.last_page !== undefined ? pag.last_page : fallbackPage) || fallbackPage;
  return { list: lista, current: current, last: last };
}

function shouldStopMilvusPaging(current, last, pageCount) {
  if (pageCount >= MILVUS_MAX_PAGES) return true;
  return current >= last;
}

// Classifica erro do Milvus: auth (401/403) nunca repete; 429/5xx/rede
// admitem 1 retry; demais, sem retry.
function classifyMilvusError(status) {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'retry';
  if (typeof status === 'number' && status >= 500 && status < 600) return 'retry';
  if (status === 'timeout' || status === 'network') return 'retry';
  return 'fatal';
}

// Conta upsert sem duplicar: chave (client_id, milvus_device_id).
function diffMilvusUpsert(existingIds, rows) {
  const seen = new Set(existingIds || []);
  let created = 0;
  let updated = 0;
  for (const r of rows || []) {
    if (r && seen.has(r.milvus_device_id)) updated++;
    else if (r) { created++; seen.add(r.milvus_device_id); }
  }
  return { created: created, updated: updated };
}

// Formata o retorno do sync p/ a tela (puro, testável).
function formatMilvusSyncResult(res) {
  const s = Number((res && res.synced)) || 0;
  const c = Number((res && res.created)) || 0;
  const u = Number((res && res.updated)) || 0;
  const un = Array.isArray(res && res.unresolvedNames) ? res.unresolvedNames : [];
  let line = `${s} dispositivos sincronizados · ${c} novos · ${u} atualizados`;
  if (un.length) line += ` · ${un.length} nome(s) sem resolução: ${un.slice(0, 5).join(', ')}${un.length > 5 ? '…' : ''}`;
  return { line: line, unresolved: un.length };
}

// ── Última sincronização (local, por cliente) ──
function getMilvusLastSyncAt(clientId) {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(MILVUS_SYNC_AT_KEY) : null;
    if (!raw) return null;
    const map = JSON.parse(raw);
    return (map && map[clientId]) || null;
  } catch (_) { return null; }
}

function setMilvusLastSyncAt(clientId, iso) {
  try {
    if (typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem(MILVUS_SYNC_AT_KEY);
    const map = raw ? JSON.parse(raw) : {};
    map[clientId] = iso;
    localStorage.setItem(MILVUS_SYNC_AT_KEY, JSON.stringify(map));
  } catch (_) {}
}

// ── Leitura (RLS do Supabase aplica o isolamento; fallback p/ cache) ──
async function getClientDevices(clientId) {
  try {
    if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() &&
        typeof supabaseClient !== 'undefined' && supabaseClient) {
      const { data, error } = await supabaseClient
        .from('client_devices')
        .select('*')
        .eq('client_id', clientId)
        .order('hostname', { ascending: true });
      if (!error && Array.isArray(data)) {
        try {
          if (typeof setCacheStore === 'function') {
            const cached = typeof getCacheStore === 'function' ? getCacheStore('client_devices') : [];
            const others = (cached || []).filter((d) => d && d.client_id !== clientId);
            setCacheStore('client_devices', others.concat(data.map(mapMilvusRowToLocal)));
          }
        } catch (_) {}
        return data.map(mapMilvusRowToLocal);
      }
    }
  } catch (_) {}
  try {
    if (typeof getCacheStore === 'function') {
      return (getCacheStore('client_devices') || []).filter((d) => d && d.client_id === clientId);
    }
  } catch (_) {}
  return [];
}

function mapMilvusRowToLocal(r) {
  if (!r || typeof r !== 'object') return r;
  return {
    id: r.id,
    client_id: r.client_id,
    team: r.team,
    milvus_device_id: r.milvus_device_id,
    hostname: r.hostname || '',
    apelido: r.apelido || '',
    fabricante: r.fabricante || '',
    // A API raramente preenche marca/fabricante (vem null); para notebook,
    // placa_mae (ex.: LENOVO) é o melhor sinal disponível — só exibição.
    marca: r.marca || r.fabricante || r.placa_mae || '',
    modelo_notebook: r.modelo_notebook || '',
    sistema_operacional: r.sistema_operacional || '',
    numero_serial: r.numero_serial || '',
    usuario_logado: r.usuario_logado || '',
    tipo_dispositivo_text: r.tipo_dispositivo_text || '',
    ip_interno: r.ip_interno || '',
    ip_externo: r.ip_externo || '',
    is_ativo: r.is_ativo !== false,
    data_ultima_atualizacao: r.data_ultima_atualizacao || r.updated_at || null,
    updatedAt: r.updated_at || null,
  };
}

// ── Sincronização: frontend → Edge Function (nunca Milvus direto) ──
async function syncClientDevices(clientId) {
  if (!clientId) throw new Error('Cliente inválido.');
  const client = typeof getClientById === 'function' ? getClientById(clientId) : null;
  if (!client) throw new Error('Cliente não encontrado.');
  try {
    const session = typeof getSession === 'function' ? getSession() : null;
    const operators = typeof getOperators === 'function' ? getOperators() : [];
    const me = session ? operators.find((o) => o.id === session.opId) : null;
    const opView = me
      ? { team: session.team || me.team, isAdmin: session.isAdmin === true || me.isAdmin === true, active: me.active }
      : { team: session ? session.team : 'init', isAdmin: session ? session.isAdmin === true : false, active: true };
    if (!canSyncClientDevices(opView, client)) {
      throw new Error('Acesso negado a este cliente.');
    }
  } catch (e) {
    if (e && /Acesso negado/.test(e.message)) throw e;
  }
  if (typeof isSupabaseConnected !== 'function' || !isSupabaseConnected() ||
      typeof supabaseClient === 'undefined' || !supabaseClient) {
    throw new Error('Sem conexão com o servidor.');
  }
  const { data, error } = await supabaseClient.functions.invoke('milvus-devices', {
    body: { clientId: clientId },
  });
  if (error) {
    // Mensagem amigável; detalhe técnico fica no log da Edge Function.
    throw new Error('Falha ao sincronizar inventário. Tente novamente.');
  }
  if (data && data.error) throw new Error('Falha ao sincronizar inventário. Tente novamente.');
  try {
    if (data && data.lastSyncAt) setMilvusLastSyncAt(clientId, data.lastSyncAt);
    else setMilvusLastSyncAt(clientId, new Date().toISOString());
  } catch (_) {}
  return data;
}

// ── IMPORTAÇÃO DE PLANILHA (export Excel do Milvus) ─────────────────────
// A API ignora paginação (sempre os 50 primeiros): o inventário completo
// vem do export. Linhas importadas NÃO têm milvus_device_id (o export não
// traz id) → upsert pelo PK `id` determinístico (`<client>:imp-<hash>`).
// Vale a mesma regra do sync: só entra o que estiver mapeado, sem licença.

function _impNormKey(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

function _impPick(row, candidates) {
  const keys = Object.keys(row || {});
  for (const c of candidates) {
    const hit = keys.find((k) => _impNormKey(k) === c);
    if (hit !== undefined) return row[hit];
  }
  return '';
}

function _impClean(v) {
  const t = String(v === null || v === undefined ? '' : v).replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (/^(nao possui|não possui|n\/?a\.?|-+|—+)$/i.test(t)) return '';
  return t;
}

function _impHashStr(s) {
  let h = 5381;
  const str = String(s || '');
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// Excel serial (dias desde 1899-12-30) ou "dd/mm/aaaa" ou ISO → 'YYYY-MM-DD'.
function parseBrDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' && isFinite(v)) {
    const d = new Date(Math.round((v - 25569) * 86400) * 1000);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    const p = (n) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

// "HH:MM[:SS]" ou fração de dia do Excel (0.5 = 12:00) → 'HH:MM:SS'.
function parseBrTime(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' && isFinite(v)) {
    const frac = ((v % 1) + 1) % 1;
    const total = Math.round(frac * 86400);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(Math.floor(total / 3600))}:${p(Math.floor((total % 3600) / 60))}:${p(total % 60)}`;
  }
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    const p = (n) => String(n).padStart(2, '0');
    return `${p(v.getHours())}:${p(v.getMinutes())}:${p(v.getSeconds())}`;
  }
  const m = String(v).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Number(m[1]))}:${p(m[2])}:${p(m[3] || '00')}`;
}

function combineBrDateTime(data, hora) {
  const d = parseBrDate(data);
  if (!d) return null;
  const t = parseBrTime(hora) || '00:00:00';
  const dt = new Date(`${d}T${t}`);
  return isNaN(dt.getTime()) ? null : dt.toISOString();
}

// Linha do Excel (chaves = cabeçalho) → rascunho normalizado ou null
// (sem "Nome fantasia do cliente" não há como vincular → descarta).
function normalizeMilvusExportRow(row) {
  if (!row || typeof row !== 'object') return null;
  const fantasia = _impClean(_impPick(row, ['nome fantasia do cliente']));
  if (!fantasia) return null;
  const hostname = String(_impPick(row, ['nome do dispositivo']) || '').replace(/\s+/g, ' ').trim();
  const usuario = _impClean(_impPick(row, ['usuario']));
  const logado = _impClean(_impPick(row, ['usuario logado']));
  const ram = _impClean(_impPick(row, ['memoria ram total']));
  const storage = _impClean(_impPick(row, ['armazenamento interno total']));
  const extras = [];
  if (ram) extras.push(`RAM: ${ram}`);
  if (storage) extras.push(`Armazenamento: ${storage}`);
  if (usuario && usuario.toLowerCase() !== logado.toLowerCase()) extras.push(`Usuário: ${usuario}`);
  return {
    hostname: hostname,
    apelido: _impClean(_impPick(row, ['apelido'])),
    sistema_operacional: _impClean(_impPick(row, ['sistema operacional'])),
    processador: _impClean(_impPick(row, ['processador'])),
    usuario_logado: logado || usuario,
    modelo_notebook: _impClean(_impPick(row, ['modelo do notebook'])),
    numero_serial: String(_impPick(row, ['numero do serial']) || '').replace(/\s+/g, ' ').trim(),
    mac_address: String(_impPick(row, ['mac address']) || '').replace(/\s+/g, ' ').trim(),
    data_ultima_atualizacao: combineBrDateTime(
      _impPick(row, ['data de atualizacao']), _impPick(row, ['hora de atualizacao do dispositivo'])),
    nome_fantasia: fantasia,
    observacao: extras.join(' | '),
  };
}

// Id determinístico e estável entre reimportações (base: serial|hostname|mac).
function buildImportDeviceId(clientId, draft) {
  const key = [draft.numero_serial, draft.hostname, draft.mac_address]
    .map((s) => String(s || '').toLowerCase())
    .filter(Boolean).join('|');
  if (!key) return null;
  return `${clientId}:imp-${_impHashStr(key)}`;
}

function matchDraftToClient(draft, mappedNames) {
  if (!draft) return false;
  return mappedNames.has(String(draft.nome_fantasia || '').trim().toLowerCase());
}

const _IMP_FILL_COLS = ['hostname', 'apelido', 'sistema_operacional', 'processador',
  'usuario_logado', 'modelo_notebook', 'numero_serial', 'mac_address',
  'data_ultima_atualizacao', 'nome_fantasia'];

// Junta rascunhos com o inventário atual: reaproveita o id da linha
// existente (casa por serial, senão por hostname) e só preenche campos
// que a importação traz — o que veio da API não é apagado.
function mergeImportWithExisting(clientId, team, drafts, existing) {
  const bySerial = new Map();
  const byHost = new Map();
  for (const e of existing || []) {
    if (!e) continue;
    const s = String(e.numero_serial || '').toLowerCase();
    const h = String(e.hostname || '').toLowerCase();
    if (s && !bySerial.has(s)) bySerial.set(s, e);
    if (h && !byHost.has(h)) byHost.set(h, e);
  }
  const now = new Date().toISOString();
  const rows = [];
  let created = 0;
  let updated = 0;
  for (const d of drafts || []) {
    if (!d) continue;
    const s = String(d.numero_serial || '').toLowerCase();
    const h = String(d.hostname || '').toLowerCase();
    const prev = (s && bySerial.get(s)) || (h && byHost.get(h)) || null;
    if (prev) {
      const row = { ...prev };
      for (const c of _IMP_FILL_COLS) {
        if (d[c] !== null && d[c] !== undefined && d[c] !== '') row[c] = d[c];
      }
      if (d.observacao && !(row.observacao || '').includes(d.observacao)) {
        row.observacao = [row.observacao, d.observacao].filter(Boolean).join(' | ');
      }
      row.client_id = clientId;
      row.team = team;
      row.updated_at = now;
      rows.push(row);
      updated++;
    } else {
      const id = buildImportDeviceId(clientId, d);
      if (!id) continue;
      rows.push({
        id: id,
        client_id: clientId,
        team: team,
        milvus_device_id: null,
        hostname: d.hostname || '',
        apelido: d.apelido || '',
        ip_interno: '',
        ip_externo: '',
        mac_address: d.mac_address || '',
        marca: '',
        fabricante: '',
        is_ativo: true,
        data_criacao: null,
        data_ultima_atualizacao: d.data_ultima_atualizacao,
        dominio: '',
        sistema_operacional: d.sistema_operacional || '',
        placa_mae: '',
        placa_mae_serial: '',
        processador: d.processador || '',
        versao_client: '',
        observacao: d.observacao || '',
        usuario_logado: d.usuario_logado || '',
        total_processadores: null,
        numero_serial: d.numero_serial || '',
        placa_mae_modelo: '',
        data_compra: null,
        data_garantia: null,
        modelo_notebook: d.modelo_notebook || '',
        nome_fantasia: d.nome_fantasia || '',
        tipo_dispositivo_id: null,
        tipo_dispositivo_text: '',
        created_at: now,
        updated_at: now,
      });
      created++;
    }
  }
  return { rows: rows, created: created, updated: updated };
}

// Lê o .xlsx no navegador (SheetJS via CDN) → linhas (objetos por cabeçalho).
function readMilvusExportFile(file) {
  return new Promise((resolve, reject) => {
    try {
      if (!file) { reject(new Error('Nenhum arquivo selecionado.')); return; }
      if (file.size > 10 * 1024 * 1024) { reject(new Error('Arquivo excede 10MB.')); return; }
      if (typeof XLSX === 'undefined') { reject(new Error('Leitor de planilha indisponível. Recarregue a página.')); return; }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const wb = XLSX.read(reader.result, { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          if (!ws) { reject(new Error('Planilha vazia ou formato inválido.')); return; }
          const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
          if (!rows.length) { reject(new Error('Planilha vazia ou formato inválido.')); return; }
          const hasFantasia = Object.keys(rows[0]).some((k) => _impNormKey(k) === 'nome fantasia do cliente');
          if (!hasFantasia) { reject(new Error('Coluna "Nome fantasia do cliente" não encontrada.')); return; }
          if (rows.length > 5000) { reject(new Error('Planilha com linhas demais (máx. 5000).')); return; }
          resolve(rows);
        } catch (e) { reject(new Error('Não foi possível ler a planilha.')); }
      };
      reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
      reader.readAsArrayBuffer(file);
    } catch (e) { reject(new Error('Não foi possível ler o arquivo.')); }
  });
}

function _currentOpViewForImport() {
  try {
    const session = typeof getSession === 'function' ? getSession() : null;
    const operators = typeof getOperators === 'function' ? getOperators() : [];
    const me = session ? operators.find((o) => o.id === session.opId) : null;
    if (me) {
      return { team: session.team || me.team, isAdmin: session.isAdmin === true || me.isAdmin === true, active: me.active };
    }
    return { team: session ? session.team : 'init', isAdmin: session ? session.isAdmin === true : false, active: true };
  } catch (_) {
    return { team: 'init', isAdmin: false, active: true };
  }
}

// Orquestra a importação: valida acesso, filtra pelo mapa explícito,
// mescla com o existente e faz upsert em lote (PK `id` → idempotente).
async function importClientDevicesFromRows(clientId, sheetRows) {
  if (!clientId) throw new Error('Cliente inválido.');
  const client = typeof getClientById === 'function' ? getClientById(clientId) : null;
  if (!client) throw new Error('Cliente não encontrado.');
  if (!canSyncClientDevices(_currentOpViewForImport(), client)) {
    throw new Error('Acesso negado a este cliente.');
  }
  if (typeof isSupabaseConnected !== 'function' || !isSupabaseConnected() ||
      typeof supabaseClient === 'undefined' || !supabaseClient) {
    throw new Error('Sem conexão com o servidor.');
  }
  const { data: mapRows } = await supabaseClient
    .from('milvus_client_map').select('milvus_nome').eq('client_id', clientId);
  const mapped = new Set((mapRows || [])
    .map((r) => String(r.milvus_nome || '').trim().toLowerCase()).filter(Boolean));
  const drafts = (sheetRows || []).map(normalizeMilvusExportRow).filter(Boolean);
  const mine = drafts.filter((d) => matchDraftToClient(d, mapped));
  const skipped = drafts.length - mine.length;
  const existing = await getClientDevices(clientId);
  const merged = mergeImportWithExisting(clientId, client.team || 'init', mine, existing);
  for (let i = 0; i < merged.rows.length; i += 200) {
    const batch = merged.rows.slice(i, i + 200);
    const { error } = await supabaseClient.from('client_devices').upsert(batch);
    if (error) throw new Error('Falha ao gravar inventário. Tente novamente.');
  }
  try {
    if (typeof setMilvusLastSyncAt === 'function') setMilvusLastSyncAt(clientId, new Date().toISOString());
    if (typeof addLog === 'function') {
      addLog('Importou planilha', 'Inventário', clientId, `${merged.created} novos · ${merged.updated} atualizados`);
    }
  } catch (_) {}
  return { imported: merged.rows.length, created: merged.created, updated: merged.updated, skipped: skipped };
}

// Export para testes (Node/Vitest).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MILVUS_MAX_PAGES: MILVUS_MAX_PAGES,
    canSyncClientDevices: canSyncClientDevices,
    normalizeMilvusDevice: normalizeMilvusDevice,
    buildMilvusListPayload: buildMilvusListPayload,
    parseMilvusPage: parseMilvusPage,
    shouldStopMilvusPaging: shouldStopMilvusPaging,
    classifyMilvusError: classifyMilvusError,
    diffMilvusUpsert: diffMilvusUpsert,
    parseBrDate: parseBrDate,
    parseBrTime: parseBrTime,
    combineBrDateTime: combineBrDateTime,
    normalizeMilvusExportRow: normalizeMilvusExportRow,
    buildImportDeviceId: buildImportDeviceId,
    matchDraftToClient: matchDraftToClient,
    mergeImportWithExisting: mergeImportWithExisting,
    importClientDevicesFromRows: importClientDevicesFromRows,
    formatMilvusSyncResult: formatMilvusSyncResult,
    mapMilvusRowToLocal: mapMilvusRowToLocal,
  };
}
