// storage-pendencias.js – Clientes, pendências (paginação, contadores, menções) e tickets.
// Parte da camada de dados (antes um único storage.js de 3.400 linhas). Scripts
// clássicos: carregam logo depois de storage.js e compartilham os mesmos globais.
// Nos testes, tests/_storage.cjs junta as partes na mesma ordem.

// ── LINHA DO TEMPO DA PENDÊNCIA (migration 063) ──
// Campos cujo movimento vira evento. Texto, anexos e cronômetro ficam de
// fora de propósito: a linha conta a história do chamado, não cada toque.
const PEN_EVENT_FIELDS = [
  { key: 'status', type: 'status' },
  { key: 'responsible', type: 'responsavel' },
  { key: 'priority', type: 'prioridade' },
  { key: 'deadline', type: 'prazo' },
];
// Teto: a coluna viaja junto do registro em todo sync; um chamado de anos
// não pode engordar o payload sem limite. Corta os mais antigos.
const PEN_MAX_EVENTS = 200;

// ── CLIENTS ──
// Lookup O(1) por id + ordenação memoizados por identidade do array
// (setCacheStore troca a referência a cada escrita): getClients/getClientById
// são chamados N× por render. Semântica idêntica às versões anteriores.
let _clientsArr = null;
let _clientsSorted = null;
let _clientByIdMap = null;
function getClients() {
  const all = dbGet(DB.CLIENTS);
  // Memoiza a ordenação por identidade do array. Retorna slice() para
  // preservar o contrato de "array novo".
  if (_clientsArr !== all || !_clientsSorted) {
    _clientsSorted = (all || []).slice().sort((a, b) =>
      (a.name || '').localeCompare(b.name || '', 'pt-BR', { sensitivity: 'base', numeric: true })
    );
    _clientsArr = all;
    _clientByIdMap = null;
  }
  return _clientsSorted.slice();
}
function getClientsByTeam(team) {
  const all = getClients();
  if (!team) return all;
  return all.filter(c => (c.team || 'init') === team);
}
function getMyClients() {
  return filterByTeam(getClients());
}
// Lookup O(1) por id, memoizado por identidade do array (mesma regra do
// getClients acima): getClientById é chamado N× por render. Semântica
// idêntica ao find — mesmos objetos, null quando não acha.
function getClientById(id) {
  try {
    const all = dbGet(DB.CLIENTS) || [];
    if (_clientsArr !== all || !_clientByIdMap) {
      _clientByIdMap = new Map();
      for (const c of all) { if (c && c.id != null && !_clientByIdMap.has(c.id)) _clientByIdMap.set(c.id, c); }
      _clientsArr = all;
      _clientsSorted = null;
    }
    if (id == null) return null;
    return _clientByIdMap.has(id) ? (_clientByIdMap.get(id) || null) : null;
  } catch (_) {
    try { return (dbGet(DB.CLIENTS) || []).find(c => c && c.id === id) || null; } catch (_) { return null; }
  }
}
function saveClient(data) {
  const clients = getClients();
  const isEdit = !!data.id;
  var now = new Date().toISOString();
  // Autor da edição (exibido no cabeçalho do modal: "Atualizada em ... por ...").
  try {
    var _edSession = typeof getSession === 'function' ? getSession() : null;
    data.updatedBy = (_edSession && _edSession.name) || data.updatedBy || '';
  } catch (_) { data.updatedBy = data.updatedBy || ''; }
  // Criação restrita a admin (backstop além da UI — edição e undo passam).
  if (!isEdit && typeof isCurrentAdmin === 'function' && !isCurrentAdmin()) {
    if (typeof showToast === 'function') showToast('Apenas administradores podem cadastrar clientes.', 'error');
    throw new Error('Permissão negada para criar clientes.');
  }
  if (!data.team) data.team = getCurrentTeam();
  if (isEdit) {
    const i = clients.findIndex(c => c.id === data.id);
    if (i !== -1) clients[i] = _withDirtyFields(clients[i], { ...clients[i], ...data, updatedAt: now });
    else {
      // Undo/restauração: reinsere preservando o id (antes era perdido em silêncio).
      data.createdAt = data.createdAt || now;
      data.updatedAt = now;
      clients.push({ ...data });
    }
  } else {
    data.id = nextId('CLI');
    data.createdAt = now;
    data.updatedAt = now;
    clients.push(data);
  }
  dbSet(DB.CLIENTS, clients);
  addLog(isEdit ? 'Editou' : 'Criou', 'Cliente', data.id, data.name);

  // Sync Supabase
  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    supabaseClient.from('clients').upsert({
      id: data.id,
      name: data.name,
      cnpj: data.cnpj,
      segment: data.segment,
      color: data.color,
      initials: data.initials,
      logo: data.logo,
      logo_shape: data.logoShape || 'circle',
      owner: data.owner,
      owner_phone: data.ownerPhone,
      responsible: data.responsible,
      responsible_phone: data.responsiblePhone,
      technician: data.technician,
      server: data.server,
      hosting: data.hosting,
      backup: data.backup,
      licenses: data.licenses,
      emails: data.emails,
      google_sheet_url: data.googleSheetUrl || null,
      milvus_client_token: data.milvusClientToken || null,
      notes: data.notes,
      team: data.team || 'init',
      attachments: data.attachments || [],
      documents: data.documents || [],
      created_at: data.createdAt || now,
      updated_by: data.updatedBy || null,
      updated_at: now,
      // Coluna da 044: só vai quando preenchida (banco sem a coluna segue salvando o resto).
      ...(data.address ? { address: data.address } : {}),
      // Coluna da 068, condicionada à PRESENÇA da chave, não ao valor: só os
      // fluxos que mexem na pasta mandam a coluna (banco sem a 068 segue
      // salvando o resto), e desvincular precisa mandar null — o push genérico
      // descarta null em coluna opcional (_mapToRemote), então este upsert é o
      // único caminho que apaga o valor no servidor.
      ...('driveFolderUrl' in data ? { drive_folder_url: data.driveFolderUrl || null } : {})
    }).then(res => {
      if (res.error) { console.error('❌ Supabase cliente:', String(res.error.message || res.error)); markSyncPushFailed(); }
    }).catch(err => {
      console.error('❌ Erro de rede Supabase cliente:', String(err.message));
      markSyncPushFailed();
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
  _addTombstone(DB.CLIENTS, id);
  addLog('Excluiu', 'Cliente', id, name);

  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    supabaseClient.from('clients').delete().eq('id', id).then(res => { if(res.error) { console.error('❌ Supabase excluir cliente:', String(res.error.message || res.error)); markSyncPushFailed(); } }).catch(() => markSyncPushFailed());
  }
}

// ── PENDÊNCIAS ──
function getPendencias() { return dbGet(DB.PENDENCIAS); }
function getPendenciasByTeam(team) {
  const all = getPendencias();
  const scoped = !team ? all : all.filter(p => (p.team || 'init') === team);
  return filterGestaoPendencias(scoped);
}
function getMyPendencias() {
  return filterGestaoPendencias(filterByTeam(getPendencias()));
}

// ── FASE 3: paginação server-side por escopo ────────────────────────────────
// Mesma cadeia operador→equipe→cliente→pendência, agora com filtro/ordenação/
// paginação NO BANCO (RLS continua valendo p/ o JWT). Uso: tela de pendências
// quando ONLINE; offline ou falha → caminho local atual (inalterado).
// - scope 'active' (padrão): status NOT IN (fechados)
// - scope 'archived': status IN (fechados) — sob demanda, nunca junto
// - team: não-admin SEMPRE restrito ao próprio team; admin sem filtro vê tudo
//   (RLS is_admin), admin com _selectedTeam restringe àquele team.
const PEN_PAGE_DEFAULT_SIZE = 50;
const PEN_CLOSED_LIST = ['concluido', 'resolvido', 'cancelado', 'fechado'];

function _penServerAvailable() {
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
    if (typeof isSupabaseConnected !== 'function' || !isSupabaseConnected()) return false;
    if (typeof window !== 'undefined' && !window._supabaseAuthActive) return false;
    if (typeof supabaseClient === 'undefined' || !supabaseClient) return false;
    return true;
  } catch (_) { return false; }
}

function _penPageScope() {
  // Retorna { team: string|null, adminSeeAll: boolean, canSeeGestao: boolean }.
  var canSeeGestao = false;
  try { canSeeGestao = (typeof canViewGestao === 'function') ? !!canViewGestao() : false; } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'storage-pendencias'); }
  try {
    const admin = (typeof isTeamAdmin === 'function') ? isTeamAdmin() : false;
    const sel = (typeof _selectedTeam !== 'undefined') ? _selectedTeam : '';
    if (admin && sel) return { team: sel, adminSeeAll: false, canSeeGestao: canSeeGestao };
    if (admin) return { team: null, adminSeeAll: true, canSeeGestao: canSeeGestao };
  } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'storage-pendencias'); }
  try {
    if (typeof getCurrentTeam === 'function') return { team: getCurrentTeam(), adminSeeAll: false, canSeeGestao: canSeeGestao };
  } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'storage-pendencias'); }
  return { team: 'init', adminSeeAll: false, canSeeGestao: canSeeGestao };
}

function _sanitizeIlike(s) {
  return String(s || '').replace(/[%_\\]/g, '').replace(/[,()]/g, ' ').trim().slice(0, 80);
}

// Puro e testável: encadeia filtros num builder postgrest (ou mock). Retorna q.
function applyPendenciaPageFilters(q, opts) {
  const o = opts || {};
  if (!o.adminSeeAll && o.team) q = q.eq('team', o.team);
  if (o.scope === 'archived') q = q.in('status', PEN_CLOSED_LIST);
  else q = q.not('status', 'in', '(' + PEN_CLOSED_LIST.join(',') + ')');
  // Gestão: quem não é Gestão nunca recebe linhas Gestão do servidor
  // (defesa em profundidade junto ao RLS; Gestão vê tudo do seu escopo).
  var _canSeeGestao = (typeof o.canSeeGestao === 'boolean')
    ? o.canSeeGestao
    : ((typeof canViewGestao === 'function') ? !!canViewGestao() : true);
  if (!_canSeeGestao) q = q.not('tipo', 'in', '(Gestão,Gestao)');
  if (o.clientId) q = q.eq('client_id', o.clientId);
  if (o.responsible) q = q.eq('responsible', o.responsible);
  if (o.status) q = q.eq('status', o.status);
  if (o.priority) q = q.eq('priority', o.priority);
  const sq = _sanitizeIlike(o.search);
  if (sq) {
    const pat = '%' + sq + '%';
    q = q.or('assunto.ilike.' + pat + ',descricao.ilike.' + pat + ',client_name.ilike.' + pat + ',responsible.ilike.' + pat);
  }
  return q;
}

function _penFields() {
  try {
    if (typeof ENTITIES !== 'undefined') {
      const e = ENTITIES.find(x => x.table === 'pendencias');
      if (e && e.fields) return e.fields;
    }
  } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'storage-pendencias'); }
  return null;
}

// ── Ordenação da fila no servidor ─────────────────────────────────────────
// A fila ordenava só as linhas já carregadas enquanto o cabeçalho prometia a
// tabela inteira. Agora a coluna viaja para o ORDER BY — mas só as que o
// banco ordena IGUAL ao comparador local. Ficam de fora, de propósito:
//   · título, que é derivado (assunto, com a descrição como reserva);
//   · status e prioridade, que pedem a ordem de negócio e não a alfabética
//     ("alta" < "baixa" < "crítica" < "média" seria mentira).
// Para essas três a ordem segue local, e a fila passa a dizer isso na tela.
// Protocolo não é coluna nenhuma: o número de exibição é a posição na ordem
// de criação, então ordenar por ele É ordenar por created_at.
// Atenção: `solicitante` é optionalField — num banco sem a migration 056 o
// ORDER BY falha e renderPenView cai no caminho local inteiro. Degrada para
// a tela de antes, que é o mesmo destino de qualquer falha de consulta.
const PEN_SORT_REMOTE = {
  numero: 'created_at',
  data: 'created_at',
  cliente: 'client_name',
  solicitante: 'solicitante',
  responsavel: 'responsible',
  prazo: 'deadline',
};
/** Coluna do banco para a coluna da fila, ou null se a ordem fica local. */
function penSortRemoteCol(colId) {
  if (!colId) return null;
  return Object.prototype.hasOwnProperty.call(PEN_SORT_REMOTE, colId) ? PEN_SORT_REMOTE[colId] : null;
}

async function fetchPendenciasPage(opts) {

  const o = Object.assign({ scope: 'active', page: 0, pageSize: PEN_PAGE_DEFAULT_SIZE }, opts || {});
  const sc = _penPageScope();
  const page = Math.max(0, parseInt(o.page, 10) || 0);
  const pageSize = Math.min(200, Math.max(1, parseInt(o.pageSize, 10) || PEN_PAGE_DEFAULT_SIZE));
  const fields = _penFields();
  if (!fields) throw new Error('Schema de pendências indisponível');
  let q = supabaseClient.from('pendencias').select('*', { count: 'exact' });
  q = applyPendenciaPageFilters(q, {
    scope: o.scope === 'archived' ? 'archived' : 'active',
    team: sc.team, adminSeeAll: sc.adminSeeAll, canSeeGestao: sc.canSeeGestao,
    clientId: o.clientId || '', responsible: o.responsible || '',
    status: o.status || '', priority: o.priority || '', search: o.search || ''
  });
  const sortCol = penSortRemoteCol(o.sort && o.sort.col);
  if (sortCol) {
    // nullsFirst:false mantém o "vazio por último" que a fila faz local, nos
    // dois sentidos; o id desempata para a página não variar entre consultas.
    const asc = !(o.sort && o.sort.dir === 'desc');
    q = q.order(sortCol, { ascending: asc, nullsFirst: false }).order('id', { ascending: true });
  } else {
    q = q.order('created_at', { ascending: false }).order('id', { ascending: true });
  }
  const from = page * pageSize;
  const res = await q.range(from, from + pageSize - 1);
  if (res.error) throw new Error(res.error.message || 'Falha na consulta paginada');
  const rows = (res.data || []).map(r => _mapFromRemote(r, fields));
  return { rows, total: (typeof res.count === 'number') ? res.count : rows.length, page, pageSize };
}

// ── FASE 6: contadores no banco ────────────────────────────────────────────
// Totais por status do escopo SEM trazer as linhas: consulta `status` +
// `deadline` (poucos bytes por registro) com os mesmos team/scope da
// paginação (+ RLS). Agregação local via countPendenciaStatuses (pura,
// testada) — inclui `vencidas` (prazo anterior a hoje, status aberto) p/ a
// linha-resumo do quadro Kanban.
// PostgREST não faz GROUP BY sem RPC — esta é a forma sem criar backend.
const PEN_CLOSED_FOR_COUNT = ['concluido', 'resolvido', 'cancelado', 'fechado'];
function countPendenciaStatuses(statusRows, todayISO) {
  const byStatus = {};
  const today = todayISO ? String(todayISO) : '';
  let total = 0;
  let vencidas = 0;
  for (const r of (statusRows || [])) {
    const s = (r && r.status) || 'aberto';
    byStatus[s] = (byStatus[s] || 0) + 1;
    total++;
    const dl = r && r.deadline;
    if (dl && today && String(dl) < today && PEN_CLOSED_FOR_COUNT.indexOf(s) === -1) vencidas++;
  }
  return { byStatus, total, vencidas };
}

async function fetchPendenciaStatusCounts(scope) {
  const sc = _penPageScope();
  let q = supabaseClient.from('pendencias').select('status,deadline');
  q = applyPendenciaPageFilters(q, {
    scope: scope === 'archived' ? 'archived' : 'active',
    team: sc.team, adminSeeAll: sc.adminSeeAll, canSeeGestao: sc.canSeeGestao
  });
  const res = await q;
  if (res.error) throw new Error(res.error.message || 'Falha na contagem');
  const today = (typeof localDateISO === 'function')
    ? localDateISO()
    : new Date().toISOString().slice(0, 10);
  return countPendenciaStatuses(res.data || [], today);
}
function getPendenciaById(id) { return getPendencias().find(p => p.id === id) || null; }
function uniquePendenciaId(list) {
  let id;
  do {
    id = `PEN-${Date.now().toString(36)}-${_secureRandStr(6)}`;
  } while (list.some(p => p.id === id));
  return id;
}
// Colunas da 056 (remoto, local). Antes da migration o banco não as tem.
const _PEN_056_COLS = [['solicitante', 'solicitante'], ['canal', 'canal'], ['categoria', 'categoria'],
  ['first_response_due', 'firstResponseDue'], ['first_response_at', 'firstResponseAt'], ['first_response_by', 'firstResponseBy']];
let _penWarned056 = false;
function _penMissingColumn(err) {
  return !!err && (err.code === 'PGRST204' || err.code === '42703' || /column/i.test(err.message || ''));
}
function _penHas056(row) { return _PEN_056_COLS.some(function (c) { return c[0] in row; }); }
function _penWithout056(row) {
  const out = Object.assign({}, row);
  _PEN_056_COLS.forEach(function (c) { delete out[c[0]]; });
  return out;
}

function savePendencia(data) {
  // Gestão: só Felipe/Joarli criam ou convertem para Gestão.
  try {
    var _isGest = (typeof isPendenciaGestao === 'function') ? isPendenciaGestao(data) : false;
    var _canG = (typeof canViewGestao === 'function') ? canViewGestao() : true;
    if (_isGest && !_canG) throw new Error('Apenas Gestão (Felipe e Joarli) pode criar pendências do tipo Gestão.');
    if (!!data.id && typeof getPendenciaById === 'function') {
      var _old = getPendenciaById(data.id);
      var _wasGest = (typeof isPendenciaGestao === 'function') ? isPendenciaGestao(_old) : false;
      if ((_wasGest || _isGest) && !_canG) throw new Error('Apenas Gestão (Felipe e Joarli) pode editar pendências do tipo Gestão.');
    }
  } catch (e) {
    if (e && e.message && e.message.indexOf('Apenas Gestão') === 0) throw e;
  }
  const list = getPendencias();
  const isEdit = !!data.id;
  var now = new Date().toISOString();
  // Herda team do cliente se não informado
  if (!data.team && data.clientId) {
    const client = getClientById(data.clientId);
    if (client) data.team = client.team || 'init';
  }
  if (!data.team) data.team = getCurrentTeam();
  // Pessoas por id (049): o id acompanha o nome gravado.
  if ('responsible' in data) data.responsibleId = (typeof operatorIdByName === 'function') ? operatorIdByName(data.responsible) : null;
  if ('timerOperator' in data) data.timerOperatorId = (typeof operatorIdByName === 'function') ? operatorIdByName(data.timerOperator) : null;
  // Safety: status final nunca mantém timer rodando (evita tempo fantasma
  // quando a conclusão chega por kanban, reunião, import ou outro caller
  // que não passou pelo auto-stop de changePenStatus).
  try {
    var _sClosed = (typeof isPendenciaClosed === 'function') ? isPendenciaClosed(data.status) : ['concluido', 'resolvido', 'cancelado', 'fechado'].indexOf(data.status || '') !== -1;
    if (_sClosed && data.timerRunning) {
      var _sEl = 0;
      if (data.timerStartedAt) { _sEl = Math.max(0, Math.floor((Date.now() - new Date(data.timerStartedAt).getTime()) / 1000)); }
      data.timerTotalSeconds = (Number(data.timerTotalSeconds) || 0) + _sEl;
      if (typeof timerClosedSessionNote === 'function') data.notes = [...(data.notes || []), timerClosedSessionNote(data.timerOperator, _sEl, data.timerTotalSeconds)];
      if (typeof recordTimeSession === 'function') recordTimeSession({ ...data }, _sEl, { source: 'conclusao' });
      data.timerRunning = false;
      data.timerStartedAt = null;
      data.timerOperator = null;
    }
  } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'storage-pendencias'); }
  let oldStatus = null;
  // Linha do tempo (063): o que ACONTECEU, complementar a `notes`, que é o
  // que a equipe ESCREVEU. Só campos que contam uma história — texto, anexos
  // e cronômetro ficam de fora para a linha não virar ruído.
  var _penEventos = function (antes, depois, quando, quem) {
    var out = [];
    PEN_EVENT_FIELDS.forEach(function (f) {
      var de = antes ? (antes[f.key] ?? null) : null;
      var para = depois ? (depois[f.key] ?? null) : null;
      if (de === para) return;
      if ((de === null || de === '') && (para === null || para === '')) return;
      out.push({ at: quando, by: quem || '', type: f.type, de: de, para: para });
    });
    return out;
  };
  var _penComEventos = function (registro, novos) {
    if (!novos || !novos.length) return registro;
    var atual = Array.isArray(registro.events) ? registro.events : [];
    registro.events = atual.concat(novos).slice(-PEN_MAX_EVENTS);
    return registro;
  };
  // SLA (056): prazo da 1ª resposta e registro da 1ª resposta (js/sla.js).
  var _slaActor = '';
  try { _slaActor = typeof getUser === 'function' ? (getUser().name || '') : ''; } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'storage-pendencias'); }
  var _sla = function (prev, cur) {
    try { if (typeof slaOnSave === 'function') slaOnSave(prev, cur, now, _slaActor); } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'storage-pendencias'); }
    ['firstResponseDue', 'firstResponseAt', 'firstResponseBy'].forEach(function (k) { if (cur[k] && cur !== data) data[k] = cur[k]; });
    return cur;
  };
  if (isEdit) {
    const i = list.findIndex(p => p.id === data.id);
    if (i !== -1) {
      oldStatus = list[i].status;
      var _antes = list[i];
      var _depois = _sla(_antes, { ...list[i], ...data, updatedAt: now });
      _penComEventos(_depois, _penEventos(_antes, _depois, now, _slaActor));
      // O payload remoto nasce do registro mesclado (812ab0d) — sem isto os
      // eventos novos ficariam só no cache local.
      data.events = _depois.events;
      list[i] = _withDirtyFields(_antes, _depois);
    } else {
      // Undo/restauração: o id original já vem no snapshot — preservá-lo
      // mantém links, anexos e visitId. Só gera id novo quando não há um.
      if (!data.id) data.id = uniquePendenciaId(list);
      data.createdAt = data.createdAt || now;
      data.updatedAt = now;
      data.status = data.status || 'em_andamento';
      list.push(data);
    }
  } else {
    data.id = uniquePendenciaId(list);
    data.createdAt = now;
    data.updatedAt = now;
    data.status = data.status || 'em_andamento';
    _sla(null, data);
    _penComEventos(data, [{ at: now, by: _slaActor || '', type: 'criado', de: null, para: data.status }]);
    list.push(data);
  }
  // Êxito agora é 'resolvido' ('concluido' legado conta igual): a transição
  // para resolvida dispara completedAt + próxima ocorrência recorrente.
  var _isResolvida = function(s) { return ['concluido', 'resolvido'].indexOf(s || '') !== -1; };
  try { if (typeof isPendenciaResolvida === 'function') _isResolvida = isPendenciaResolvida; } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'storage-pendencias'); }
  const justConcluded = _isResolvida(data.status) && !_isResolvida(oldStatus);
  if (justConcluded) {
    data.completedAt = now;
    const idx = list.findIndex(p => p.id === data.id);
    if (idx !== -1) list[idx].completedAt = data.completedAt;
    // Quem concluiu: responsável atual (ou usuário da sessão). Correções
    // posteriores usam updatePendenciaAssignee; legados ficam sem valor.
    if (!data.completedBy) {
      try {
        data.completedBy = data.responsible || (typeof getUser === 'function' ? (getUser().name || '') : '') || '';
      } catch (_) { data.completedBy = data.completedBy || data.responsible || ''; }
      if (!data.completedBy) delete data.completedBy;
      else if (idx !== -1) list[idx].completedBy = data.completedBy;
    }
  }
  dbSet(DB.PENDENCIAS, list);
  // Gestão: histórico nunca recebe assunto/descrição (só marcador restrito).
  var _logDetails = (data.assunto || '').trim() || data.descricao;
  try {
    if (typeof isPendenciaGestao === 'function' && isPendenciaGestao(data)) _logDetails = '[Gestão – restrito]';
  } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'storage-pendencias'); }
  addLog(isEdit ? 'Editou' : 'Criou', 'Pendência', data.id, _logDetails);

  if (justConcluded && data.recurrence) {
    try {
      // Concluída com atraso: a próxima não nasce já vencida (pula ciclos passados).
      const _todayRec = typeof localDateISO === 'function' ? localDateISO() : null;
      const nextDeadline = typeof nextRecurrenceDateFrom === 'function'
        ? nextRecurrenceDateFrom(data.deadline || data.completedAt, data.recurrence, _todayRec)
        : nextRecurrenceDate(data.deadline || data.completedAt, data.recurrence);
      // Idempotência (idem visitas): mesma chave lógica — cliente + deadline
      // + assunto — impede duplicata em conclusão repetida/offline/2 devices.
      const penKey = p => ((p.assunto || '').trim() || p.descricao);
      const already = nextDeadline && getPendencias().some(x => x.id !== data.id
        && (x.clientId || '') === (data.clientId || '')
        && (x.deadline || '') === nextDeadline
        && penKey(x) === penKey(data));
      if (already) {
        console.debug('[recorrência] pendência de ' + nextDeadline + ' já existe — geração pulada (sem duplicar).');
      } else {
        savePendencia({
          clientId: data.clientId,
          clientName: data.clientName,
          tipo: data.tipo,
          assunto: data.assunto || '',
          descricao: data.descricao,
          responsible: data.responsible,
          status: 'aberto',
          priority: data.priority,
          deadline: nextDeadline,
          linkUtil: data.linkUtil || '',
          tags: data.tags || [],
          team: data.team || 'init',
          recurrence: data.recurrence,
          solicitante: data.solicitante, canal: data.canal, categoria: data.categoria,
          // O checklist da rotina (ex.: passos do backup) segue para a próxima,
          // desmarcado — antes a nova ocorrência nascia sem checklist.
          checklist: (Array.isArray(data.checklist) ? data.checklist : [])
            .filter(function (it) { return it && String(it.text || '').trim(); })
            .map(function (it) { return { text: it.text, done: false }; }),
        });
      }
    } catch (e) { console.warn('⚠️ Erro ao gerar pendência recorrente:', e); }
  }

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

  // Push fire-and-forget + outbox: offline ou falha de conectividade
  // enfileira a operação (drain no `online`); erro de dados (4xx/schema)
  // NÃO enfileira para não repetir escrita inválida em loop.
  // O payload remoto sai do registro MESCLADO (fonte completa), nunca do objeto
  // parcial montado no form: sem isso, campos ausentes do form subiriam como
  // []/null e o pull/realtime espalharia o zeramento para todos os aparelhos (SYNC-06).
  const _idx = list.findIndex(p => p.id === data.id);
  const _full = _idx !== -1 ? list[_idx] : data;
  var _remotePen = {
    id: _full.id,
    client_id: _full.clientId,
    client_name: _full.clientName,
    tipo: _full.tipo,
    assunto: _full.assunto || '',
    descricao: _full.descricao,
    responsible: _full.responsible,
    status: _full.status,
    priority: _full.priority,
    deadline: _full.deadline || null,
    notes: _full.notes || [],
    link_util: _full.linkUtil || '',
    team: _full.team || 'init',
    attachments: _full.attachments || [],
    checklist: _full.checklist || [],
    tags: _full.tags || [],
    recurrence: _full.recurrence || null,
    visit_id: _full.visitId || null,
    reviewed_in_meeting: _full.reviewedInMeeting || null,
    timer_running: _full.timerRunning === true,
    timer_started_at: _full.timerStartedAt || null,
    timer_total_seconds: _full.timerTotalSeconds || 0,
    timer_operator: _full.timerOperator || null,
    completed_at: _full.completedAt || null,
    completed_by: _full.completedBy || null,
    created_at: _full.createdAt || now,
    updated_at: now
  };
  // Atendimento e SLA (056): só vão quando o registro tem o campo, e caem
  // fora num 2º envio se o banco ainda não tiver as colunas (PGRST204).
  _PEN_056_COLS.forEach(function (c) { if (_full[c[1]] !== undefined) _remotePen[c[0]] = _full[c[1]] || null; });
  function _enqueuePen(reason) {
    try {
      if (typeof Outbox !== 'undefined' && Outbox && typeof Outbox.enqueue === 'function') Outbox.enqueue('pendencias', 'upsert', _full);
      else if (typeof outboxEnqueue === 'function') outboxEnqueue('pendencias', 'upsert', _full);
    } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'storage-pendencias'); }
    try { if (typeof markSyncPushFailed === 'function' && reason !== 'offline-counted') markSyncPushFailed(); } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'storage-pendencias'); }
  }
  try {
    var _penOnline = !(typeof navigator !== 'undefined' && navigator.onLine === false);
    var _penConn = !(typeof isSupabaseConnected === 'function' && (!isSupabaseConnected() || !window._supabaseAuthActive));
    if (!_penOnline || !_penConn) {
      _enqueuePen('offline-counted'); // dbSet acima já contou 1 pendência
    } else if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
      supabaseClient.from('pendencias').upsert(_remotePen).then(res => {
        if (res && res.error && _penMissingColumn(res.error) && _penHas056(_remotePen)) {
          if (!_penWarned056) { _penWarned056 = true; console.warn('⚠️ Supabase pendências sem as colunas da migration 056 — enviando sem solicitante/canal/categoria/SLA.'); }
          return supabaseClient.from('pendencias').upsert(_penWithout056(_remotePen));
        }
        return res;
      }).then(res => {
        if (res && res.error) {
          console.warn('⚠️ Supabase pendência (sync pulado — verifique schema):', res.error.message);
          if (typeof _isConnectivityError === 'function' && _isConnectivityError(res.error)) _enqueuePen('push-failed');
          else if (typeof markSyncPushFailed === 'function') markSyncPushFailed();
        }
      }).catch(err => {
        console.warn('⚠️ Erro de rede Supabase pendência:', err.message);
        _enqueuePen('push-failed');
      });
    }
  } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'storage-pendencias'); }

  return data;
}

// ── Assignee / quem concluiu da pendência ("API" da camada de dados) ───────
// Regra de permissão (simples e documentada): quem pode VER a pendência
// (canViewPendencia — inclui a trava Gestão) pode reatribuir/corrigir; toda
// mudança vai para a auditoria (addLog). O vínculo com a reunião é garantido
// pelo contexto da UI (só há botão nas pendências exibidas).
// patch: { responsible?, completedBy? } — undefined = não toca; '' = limpa.
// Retorna { pen, changed }. Erros (throw, mensagens claras):
// - 'Pendência não encontrada.' (404) | 'Operador "X" não encontrado ou
//   indisponível.' (400) | 'Acesso negado a esta pendência.' (403).
function _findAnyOperator(name) {
  const nm = String(name || '').trim();
  if (!nm) return null;
  let ops = [];
  try { ops = (typeof getOperators === 'function' ? getOperators() : []) || []; } catch (_) { ops = []; }
  if (!ops.length) return { name: nm, _unverified: true };
  return ops.find(o => o && String(o.name || '') === nm) || null;
}

function updatePendenciaAssignee(penId, patch) {
  const pen = (typeof getPendenciaById === 'function') ? getPendenciaById(penId) : null;
  if (!pen) throw new Error('Pendência não encontrada.');
  try {
    if (typeof canViewPendencia === 'function' && !canViewPendencia(pen)) {
      throw new Error('Acesso negado a esta pendência.');
    }
  } catch (e) { if (e && /negado/i.test(e.message || '')) throw e; }
  const p = patch || {};
  const changed = { responsible: false, completedBy: false };
  let nextResponsible = pen.responsible;
  let nextCompletedBy = pen.completedBy;

  if (Object.prototype.hasOwnProperty.call(p, 'responsible')) {
    const v = (p.responsible === null || p.responsible === undefined) ? '' : String(p.responsible).trim();
    if (v === (pen.responsible || '')) { /* igual: sem mudança, sem log */ }
    else {
      if (v) {
        const any = _findAnyOperator(v);
        if (any && !any._unverified) {
          if (any.active === false) throw new Error('Operador "' + v + '" está inativo.');
          if (any.onLeave === true) throw new Error('Operador "' + v + '" está afastado.');
        } else if (!any) {
          throw new Error('Operador "' + v + '" não encontrado ou indisponível.');
        }
      }
      nextResponsible = v;
      changed.responsible = true;
    }
  }
  if (Object.prototype.hasOwnProperty.call(p, 'completedBy')) {
    let _isResolvida = function(s) { return ['concluido', 'resolvido'].indexOf(s || '') !== -1; };
    try { if (typeof isPendenciaResolvida === 'function') _isResolvida = isPendenciaResolvida; } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'storage-pendencias'); }
    if (!_isResolvida(pen.status)) throw new Error('Só é possível informar quem concluiu em pendência concluída.');
    const v = (p.completedBy === null || p.completedBy === undefined) ? '' : String(p.completedBy).trim();
    if (v === (pen.completedBy || '')) { /* igual: sem mudança, sem log */ }
    else {
      if (v) {
        // Quem concluiu é fato passado: basta o operador existir (vale
        // afastado/inativo); só barra nome inexistente.
        if (!_findAnyOperator(v)) throw new Error('Operador "' + v + '" não encontrado.');
      }
      nextCompletedBy = v;
      changed.completedBy = true;
    }
  }
  if (!changed.responsible && !changed.completedBy) {
    return { pen: getPendenciaById(penId), changed };
  }
  const saved = savePendencia({ ...pen, responsible: nextResponsible, completedBy: nextCompletedBy });
  try {
    if (typeof addLog === 'function') {
      if (changed.responsible) addLog('Reatribuiu', 'Pendência', penId, (pen.responsible || '—') + ' → ' + (nextResponsible || '—'));
      if (changed.completedBy) addLog('Corrigiu conclusão', 'Pendência', penId, (pen.completedBy || '—') + ' → ' + (nextCompletedBy || '—'));
    }
  } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'storage-pendencias'); }
  return { pen: saved, changed };
}
function deletePendencia(id) {
  if (!canDelete()) {
    if (typeof showToast === 'function') showToast('Permissão negada para excluir pendências.', 'error');
    return false;
  }
  const pen = getPendenciaById(id);
  const desc = pen ? ((pen.assunto || '').trim() || pen.descricao || 'Desconhecido') : 'Desconhecido';
  const remaining = getPendencias().filter(p => p.id !== id);
  if (remaining.length === getPendencias().length) return false;
  dbSet(DB.PENDENCIAS, remaining);
  _addTombstone(DB.PENDENCIAS, id);
  // Gestão: addLog central já não encontraria o registro (deletado) — redige aqui.
  var _delDesc = desc;
  try {
    if (typeof isPendenciaGestao === 'function' && pen && isPendenciaGestao(pen)) _delDesc = '[Gestão – restrito]';
  } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'storage-pendencias'); }
  addLog('Excluiu', 'Pendência', id, _delDesc);

  var _penConnected = typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive;

  // O que estava enfileirado para este id não pode sobreviver à exclusão: o
  // drain seguinte faria upsert e recriaria no servidor o registro apagado.
  // Offline, o delete entra na fila no lugar do upsert (o enqueue deduplica
  // por targetId), para a exclusão não depender só do tombstone.
  try {
    if (typeof Outbox !== 'undefined' && Outbox) {
      if (_penConnected) Outbox.removeTarget(id);
      else Outbox.enqueue('pendencias', 'delete', { id: id });
    }
  } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'storage-pendencias'); }

  if (_penConnected) {
    supabaseClient.from('pendencias').delete().eq('id', id).then(res => { if(res.error) { console.error('❌ Supabase excluir pendência:', res.error); markSyncPushFailed(); } }).catch(() => markSyncPushFailed());
  }
  return true;
}
// ── @MENÇÃO HELPERS ──
function _getOperatorNamesList() {
  try {
    if (typeof getOperatorNames === 'function') return getOperatorNames();
    if (typeof globalThis !== 'undefined' && typeof globalThis.getOperatorNames === 'function') return globalThis.getOperatorNames();
    if (typeof getOperators === 'function') return getOperators().map(function(o){ return o.name; });
    if (typeof globalThis !== 'undefined' && typeof globalThis.getOperators === 'function') return globalThis.getOperators().map(function(o){ return o.name; });
  } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'storage-pendencias'); }
  return [];
}
function _escapeHtmlLocal(str){
  if (typeof escapeHtml === 'function') return escapeHtml(str);
  if (typeof globalThis !== 'undefined' && typeof globalThis.escapeHtml === 'function') return globalThis.escapeHtml(str);
  if (str == null) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function parseMentionedOperators(text) {
  if (!text) return [];
  var names = _getOperatorNamesList();
  if (!names.length) return [];
  var regex = /@([A-Za-zÀ-ÿ0-9_]+)/g;
  var mentions = [];
  var m;
  while ((m = regex.exec(text)) !== null) mentions.push(m[1]);
  if (!mentions.length) return [];
  var result = [];
  var seen = new Set();
  mentions.forEach(function(tok){
    var tokLower = tok.toLowerCase();
    names.forEach(function(n){
      var nLower = n.toLowerCase();
      var parts = nLower.split(/\s+/);
      var matches = parts.some(function(p){ return p === tokLower; }) || nLower === tokLower;
      if (matches && !seen.has(n)) { seen.add(n); result.push(n); }
    });
  });
  return result;
}

function highlightMentions(text) {
  var esc = _escapeHtmlLocal(text);
  var names = _getOperatorNamesList();
  if (!names.length) return esc;
  return esc.replace(/@([A-Za-zÀ-ÿ0-9_]+)/g, function(match, p1){
    var tokLower = p1.toLowerCase();
    var isMention = names.some(function(n){
      var parts = n.toLowerCase().split(/\s+/);
      return parts.some(function(part){ return part === tokLower; }) || n.toLowerCase() === tokLower;
    });
    if (isMention) return '<span style="background:#dbeafe;color:#1e40af;padding:1px 4px;border-radius:4px;font-weight:600">@' + p1 + '</span>';
    return match;
  });
}

/**
 * Acrescenta uma mensagem ao feed.
 * @param visibility 'resposta' (vai para quem pediu) | 'interna' (só a equipe).
 *   Default 'resposta': é o que o time já fazia antes da separação existir,
 *   então o hábito de hoje continua valendo e o SLA não muda de sentido.
 *   Nota sem o campo (anterior a esta mudança) é lida como INTERNA — fail-closed
 *   para o dia em que o solicitante enxergar o chamado.
 */
function addPendenciaNote(id, text, author, visibility) {
  const list = getPendencias();
  const i = list.findIndex(p => p.id === id);
  if (i === -1) return false;
  if (!list[i].notes) list[i].notes = [];
  var mentionedOperators = parseMentionedOperators(text);
  var _vis = visibility === 'interna' ? 'interna' : 'resposta';
  const note = { text, author, createdAt: new Date().toISOString(), mentionedOperators, visibility: _vis };
  const _prevSla = { ...list[i], notes: list[i].notes.slice() };
  list[i].notes.push(note);
  list[i].updatedAt = new Date().toISOString();
  // 1ª resposta (056): só a nota marcada como resposta conta — ver slaOnSave.
  try { if (typeof slaOnSave === 'function') slaOnSave(_prevSla, list[i], list[i].updatedAt, author); } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'storage-pendencias'); }
  const _respondeuAgora = !_prevSla.firstResponseAt && !!list[i].firstResponseAt;
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
    }).eq('id', id).then(res => { if(res.error) { console.error('❌ Supabase atualizar pendência:', res.error); markSyncPushFailed(); } }).catch(() => markSyncPushFailed());
    // Separado da nota: se o banco ainda não tiver a 056, só isto falha.
    if (_respondeuAgora) {
      supabaseClient.from('pendencias').update({ first_response_at: list[i].firstResponseAt, first_response_by: list[i].firstResponseBy || null })
        .eq('id', id).then(res => { if (res.error && !_penMissingColumn(res.error) && typeof _logSilent === 'function') _logSilent(new Error(res.error.message), 'storage-pendencias:1a-resposta'); })
        .catch(() => {});
    }
  }
  return true;
}
