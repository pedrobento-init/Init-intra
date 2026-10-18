// storage-visitas.js – Visitas, reuniões, equipamentos, vencimentos, procedimentos e modelos.
// Parte da camada de dados (antes um único storage.js de 3.400 linhas). Scripts
// clássicos: carregam logo depois de storage.js e compartilham os mesmos globais.
// Nos testes, tests/_storage.cjs junta as partes na mesma ordem.

// ── VISITS (Visitas Técnicas) ──
const VISIT_STATUS_MAP = {
  agendada:     { label: 'Agendada',     color: '#0ea5e9' },
  em_andamento: { label: 'Em andamento', color: '#f59e0b' },
  concluida:    { label: 'Concluída',    color: '#16a34a' },
  cancelada:    { label: 'Cancelada',    color: '#94a3b8' },
};


function formatVisitTimeRange(v) {
  if (!v) return '—';
  if (v.allDay) return 'Dia inteiro';
  const start = (v.time || '').toString().slice(0, 5);
  const end = (v.timeEnd || '').toString().slice(0, 5);
  if (start && end) return start + ' – ' + end;
  if (start) return start;
  if (end) return 'até ' + end;
  return '—';
}
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

// ── Número amigável da visita ("Visita #0001") ────────────────────────────
// O UUID (id) segue como identificador técnico. O `numero` (inteiro,
// monotônico, nunca reutilizado) é só exibição, mas persistido e
// sincronizado como campo comum.
// - Alocação local e imediata (offline-first): max(marca persistida,
//   maior numero visível) + 1. A marca só cresce → exclusão não recicla.
// - Multi-dispositivo: dois aparelhos offline podem alocar o mesmo número;
//   maintainVisitNumeros() reconcilia de forma determinística (mantém o
//   registro mais antigo; demais ganham max+1 em ordem) e o sync propaga —
//   converge sem coordenação central.
const VISIT_NUMERO_SEQ_KEY = 'intra_visita_numero_seq';

function _visitNumeroOf(v) {
  const n = Number(v && v.numero);
  return (Number.isInteger(n) && n > 0) ? n : null;
}

function nextVisitNumero() {
  let maxSeen = 0;
  try {
    for (const v of (getVisits() || [])) {
      const n = _visitNumeroOf(v);
      if (n !== null && n > maxSeen) maxSeen = n;
    }
  } catch (_) {}
  let mark = 0;
  try { mark = Number(getCacheKV(VISIT_NUMERO_SEQ_KEY, 0)) || 0; } catch (_) {}
  const next = Math.max(maxSeen, mark) + 1;
  try { setCacheKV(VISIT_NUMERO_SEQ_KEY, next); } catch (_) {}
  return next;
}

// Backfill (visitas antigas/sem número, por createdAt+id — determinístico)
// + reparo de colisões. Idempotente: só preenche nulos e só reenumera
// duplicados. Roda local, sem rede, após boot e após cada sync.
function maintainVisitNumeros() {
  let list = [];
  try { list = getVisits() || []; } catch (_) { return 0; }
  if (!list.length) return 0;
  const byId = new Map();
  let changed = 0;
  const keyOf = (v) => String(v.createdAt || '') + '|' + String(v.id || '');
  // updatedAt acompanha qualquer troca de numero: sem isso o valor reparado
  // nunca fica "mais novo" que o remoto, perde todo merge e nunca é
  // propagado pelo push (loop de renumeração a cada sync).
  const nowIso = new Date().toISOString();
  // 1) Backfill de nulos em ordem determinística (mesma ordem em qualquer
  // aparelho que veja o mesmo conjunto → mesma atribuição).
  const missing = list.filter(v => _visitNumeroOf(v) === null)
    .sort((a, b) => keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0);
  let next = null;
  const alloc = () => {
    if (next === null) {
      let m = 0;
      for (const v of list) { const n = _visitNumeroOf(v); if (n !== null && n > m) m = n; }
      try { m = Math.max(m, Number(getCacheKV(VISIT_NUMERO_SEQ_KEY, 0)) || 0); } catch (_) {}
      next = m;
    }
    next += 1;
    try { setCacheKV(VISIT_NUMERO_SEQ_KEY, next); } catch (_) {}
    return next;
  };
  for (const v of missing) {
    if (!v || !v.id || byId.has(v.id)) continue;
    byId.set(v.id, true);
    v.numero = alloc();
    v.updatedAt = nowIso;
    changed++;
  }
  // 2) Colisões (mesmo número, ids distintos): mantém o mais antigo
  // (createdAt, id); demais ganham max+1 em ordem determinística.
  const seen = new Map();
  const ordered = list.slice().sort((a, b) => keyOf(a) < keyOf(b) ? -1 : 1);
  for (const v of ordered) {
    const n = _visitNumeroOf(v);
    if (n === null || !v.id) continue;
    if (!seen.has(n)) { seen.set(n, v.id); continue; }
    v.numero = alloc();
    v.updatedAt = nowIso;
    changed++;
  }
  if (changed) {
    const prev = (typeof window !== 'undefined' && window._suppressPendingSync) || false;
    if (typeof window !== 'undefined') window._suppressPendingSync = true;
    try { dbSet(DB.VISITS, list); } catch (_) {}
    if (typeof window !== 'undefined') window._suppressPendingSync = prev;
    try { console.debug('[visitas] maintainVisitNumeros: ' + changed + ' ajuste(s) aplicado(s).'); } catch (_) {}
  }
  return changed;
}

function saveVisit(data) {
  const list = getVisits();
  const isEdit = !!data.id;
  if (!data.team && data.clientId) {
    const client = getClientById(data.clientId);
    if (client) data.team = client.team || 'init';
  }
  if (!data.team) data.team = getCurrentTeam();
  data.allDay = data.allDay === true;
  if (data.allDay) {
    data.time = '';
    data.timeEnd = '';
  } else {
    data.time = data.time || '';
    data.timeEnd = data.timeEnd || '';
  }
  const now = new Date().toISOString();
  let oldStatus = null;
  if (isEdit) {
    const i = list.findIndex(v => v.id === data.id);
    if (i !== -1) { oldStatus = list[i].status; list[i] = { ...list[i], ...data, updatedAt: now }; }
    else list.push({ ...data, createdAt: now, updatedAt: now });
  } else {
    data.id = nextId('VIS');
    data.createdAt = now;
    data.updatedAt = now;
    // Número amigável imediato (offline-first): nunca nulo em criações novas;
    // importações/restaurações que já tragam numero o preservam.
    if (_visitNumeroOf(data) === null) data.numero = nextVisitNumero();
    // Offline-first (integração Milvus): visita nova nasce com o chamado
    // pendente. Visitas antigas (sem o campo) nunca são carimbadas aqui —
    // sem backfill: edições preservam ausência do campo.
    if (!data.milvusChamadoStatus) data.milvusChamadoStatus = 'pendente';
    if (data.milvusChamadoTentativas === undefined) data.milvusChamadoTentativas = 0;
    list.push(data);
  }
  // Finalização Milvus (etapa 2): ao CONCLUIR (transição real) uma visita que
  // já tem chamado criado, marca a finalização como pendente — o processador
  // finaliza em background. O flag vai em `data` E no registro da lista: o
  // merge acima já copiou `data` para `list[i]`, então só `data` não
  // persistiria. Relatórios de visitas antigas (sem codigo ou sem transição
  // nova) nunca entram sozinhos: sem bulk-finalize.
  // A conclusão local jamais é bloqueada por isso (offline-first).
  if (data.status === 'concluida' && oldStatus !== 'concluida'
      && data.milvusChamadoCodigo && Number(data.milvusChamadoCodigo) > 0
      && !data.milvusFinalizarStatus) {
    data.milvusFinalizarStatus = 'pendente';
    if (data.milvusFinalizarTentativas === undefined) data.milvusFinalizarTentativas = 0;
    const j = list.findIndex(v => v.id === data.id);
    if (j !== -1) {
      list[j].milvusFinalizarStatus = data.milvusFinalizarStatus;
      list[j].milvusFinalizarTentativas = data.milvusFinalizarTentativas;
    }
  }
  dbSet(DB.VISITS, list);
  addLog(isEdit ? 'Editou' : 'Criou', 'Visita', data.id, data.clientName + ' – ' + (data.motivo || ''));

  if (data.status === 'concluida' && oldStatus !== 'concluida' && data.recurrence) {
    try {
      const nextDate = nextRecurrenceDate(data.date, data.recurrence);
      // Idempotência: concluir a mesma visita 2× (reload, offline/online, 2
      // dispositivos) não pode duplicar a ocorrência. Chave lógica: mesmo
      // cliente + mesma data + mesmo motivo.
      const already = nextDate && getVisits().some(x => x.id !== data.id
        && (x.clientId || '') === (data.clientId || '')
        && (x.date || '') === nextDate
        && (x.motivo || '') === (data.motivo || ''));
      if (already) {
        console.debug('[recorrência] visita de ' + nextDate + ' já existe — geração pulada (sem duplicar).');
      } else {
        saveVisit({
          clientId: data.clientId,
          clientName: data.clientName,
          operator: data.operator,
          date: nextDate,
          time: data.time,
          timeEnd: data.timeEnd,
          allDay: data.allDay,
          motivo: data.motivo,
          observacoes: data.observacoes,
          status: 'agendada',
          team: data.team || 'init',
          recurrence: data.recurrence,
        });
      }
    } catch (e) { console.warn('⚠️ Erro ao gerar visita recorrente:', e); }
  }

  // Payload remoto da visita a partir do registro MESCLADO (numero, categories,
  // checklist e campos milvus_* preservados) — ver SYNC-07.
  const _idxV = list.findIndex(v => v.id === data.id);
  const _fullV = _idxV !== -1 ? list[_idxV] : data;
  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    supabaseClient.from('visits').upsert({
      id: _fullV.id,
      client_id: _fullV.clientId,
      client_name: _fullV.clientName,
      operator: _fullV.operator,
      date: _fullV.date,
      time: _fullV.allDay ? null : (_fullV.time || null),
      time_end: _fullV.allDay ? null : (_fullV.timeEnd || null),
      all_day: _fullV.allDay === true,
      motivo: _fullV.motivo,
      observacoes: _fullV.observacoes || '',
      relatorio: _fullV.relatorio || '',
      status: _fullV.status,
      recurrence: _fullV.recurrence || null,
      team: _fullV.team || 'init',
      categories: _fullV.categories || [],
      checklist: _fullV.checklist || [],
      numero: _visitNumeroOf(_fullV),
      milvus_chamado_codigo: _fullV.milvusChamadoCodigo ?? null,
      milvus_chamado_status: _fullV.milvusChamadoStatus ?? null,
      milvus_chamado_erro: _fullV.milvusChamadoErro ?? null,
      milvus_chamado_tentativas: _fullV.milvusChamadoTentativas ?? 0,
      milvus_finalizar_status: _fullV.milvusFinalizarStatus ?? null,
      milvus_finalizar_erro: _fullV.milvusFinalizarErro ?? null,
      milvus_finalizar_tentativas: _fullV.milvusFinalizarTentativas ?? 0,
      created_at: _fullV.createdAt,
      updated_at: now
    }).then(res => { if (res.error) { console.error('❌ Supabase visita:', String(res.error.message || res.error)); markSyncPushFailed(); } }).catch(() => markSyncPushFailed());
  }

  // Integração Milvus (fire-and-forget, só em criações): com rede, tenta
  // criar o chamado já; offline, a visita segue 'pendente' no local e o
  // processador retoma no pós-sync/online/boot. Nunca bloqueia nem lança.
  if (!isEdit) {
    try { if (typeof enqueueMilvusChamado === 'function') enqueueMilvusChamado(data.id); } catch (_) {}
  }
  // Finalização Milvus (etapa 2, fire-and-forget): visita concluída com
  // finalização pendente tenta finalizar já; offline/sem rede o processador
  // retoma depois. Nunca bloqueia a conclusão nem lança.
  if (data.status === 'concluida') {
    try { if (typeof enqueueMilvusFinalizar === 'function') enqueueMilvusFinalizar(data.id); } catch (_) {}
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
  _addTombstone(DB.VISITS, id);
  addLog('Excluiu', 'Visita', id, desc);

  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    supabaseClient.from('visits').delete().eq('id', id).then(res => { if (res.error) { console.error('❌ Supabase excluir visita:', res.error); markSyncPushFailed(); } }).catch(() => markSyncPushFailed());
  }
}

// ── REUNIÕES (Reunião Mensal) ──
function getReunioes() { return dbGet(DB.REUNIOES); }
function getReunioesByTeam(team) {
  const all = getReunioes();
  if (!team) return all;
  return all.filter(r => (r.team || 'init') === team);
}
function getMyReunioes() { return filterByTeam(getReunioes()); }
function getReuniaoById(id) { return getReunioes().find(r => r.id === id) || null; }
function saveReuniao(data) {
  const list = getReunioes();
  const isEdit = !!data.id;
  const now = new Date().toISOString();
  if (!data.team) data.team = getCurrentTeam();
  if (isEdit) {
    const i = list.findIndex(r => r.id === data.id);
    if (i !== -1) list[i] = { ...list[i], ...data, updatedAt: now };
    else list.push({ ...data, createdAt: now, updatedAt: now });
  } else {
    data.id = nextId('REU');
    data.createdAt = now;
    data.updatedAt = now;
    list.push(data);
  }
  dbSet(DB.REUNIOES, list);
  addLog(isEdit ? 'Editou' : 'Criou', 'Reunião', data.id, data.mesAno || '');

  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    supabaseClient.from('reunioes').upsert({
      id: data.id,
      mes_ano: data.mesAno || null,
      status: data.status || 'aberta',
      started_at: data.startedAt || null,
      ended_at: data.endedAt || null,
      team: data.team || 'init',
      relatorio: data.relatorio || '',
      participants: data.participants || [],
      created_at: data.createdAt || now,
      updated_at: now
    }).then(res => {
      if (res.error) { console.warn('⚠️ Supabase reunião (sync pulado — verifique schema):', res.error.message); markSyncPushFailed(); }
    }).catch(err => {
      console.warn('⚠️ Erro de rede Supabase reunião:', err.message);
      markSyncPushFailed();
    });
  }

  return data;
}
function deleteReuniao(id) {
  if (!canDelete()) {
    if (typeof showToast === 'function') showToast('Permissão negada para excluir reuniões.', 'error');
    return false;
  }
  const r = getReuniaoById(id);
  const desc = r ? r.mesAno : 'Desconhecida';
  dbSet(DB.REUNIOES, getReunioes().filter(x => x.id !== id));
  _addTombstone(DB.REUNIOES, id);
  addLog('Excluiu', 'Reunião', id, desc);

  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    supabaseClient.from('reunioes').delete().eq('id', id).then(res => { if (res.error) { console.error('❌ Supabase excluir reunião:', res.error); markSyncPushFailed(); } }).catch(() => markSyncPushFailed());
  }
}

// ── EQUIPAMENTOS ──
function getEquipamentos() { return dbGet(DB.EQUIPAMENTOS); }
function getEquipamentosByTeam(team) {
  const all = getEquipamentos();
  if (!team) return all;
  return all.filter(e => (e.team || 'init') === team);
}
function getMyEquipamentos() { return filterByTeam(getEquipamentos()); }
function getEquipamentoById(id) { return getEquipamentos().find(e => e.id === id) || null; }
function getEquipamentosByClient(clientId) {
  return getEquipamentos().filter(e => e.clientId === clientId)
    .sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR', { sensitivity: 'base' }));
}
function saveEquipamento(data) {
  const list = getEquipamentos();
  const isEdit = !!data.id;
  const now = new Date().toISOString();
  // Alias legado: 'em_uso' → 'entregue'.
  if (data.status === 'em_uso') data.status = 'entregue';
  // Resgata vínculo legado (id de pendência digitado em osVinculada).
  if (!data.pendenciaId && data.osVinculada) {
    try {
      const maybe = String(data.osVinculada).trim();
      if (maybe && typeof getPendenciaById === 'function' && getPendenciaById(maybe)) data.pendenciaId = maybe;
    } catch (_) {}
  }
  if (!data.team && data.clientId && data.clientId !== '__estoque__') {
    const client = typeof getClientById === 'function' ? getClientById(data.clientId) : null;
    if (client) data.team = client.team || 'init';
  }
  if (!data.team) data.team = typeof getCurrentTeam === 'function' ? getCurrentTeam() : 'init';
  // Estoque Initnet é valor interno: sem vínculo de cliente.
  if (data.clientId === '__estoque__' || data.clientId === 'estoque-initnet') {
    data.clientId = null;
    data.clientName = 'Estoque Initnet';
  }
  if (!data.clientName && data.clientId) {
    const client = typeof getClientById === 'function' ? getClientById(data.clientId) : null;
    if (client) data.clientName = client.name;
  }
  if (isEdit) {
    const i = list.findIndex(e => e.id === data.id);
    if (i !== -1) list[i] = { ...list[i], ...data, updatedAt: now };
    else list.push({ ...data, createdAt: data.createdAt || now, updatedAt: now });
  } else {
    data.id = nextId('EQP');
    data.createdAt = now;
    data.updatedAt = now;
    list.push(data);
  }
  dbSet(DB.EQUIPAMENTOS, list);
  if (typeof addLog === 'function') addLog(isEdit ? 'Editou' : 'Criou', 'Equipamento', data.id, data.nome || '');

  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && typeof window !== 'undefined' && window._supabaseAuthActive) {
    try {
      supabaseClient.from('equipamentos').upsert({
        id: data.id,
        nome: data.nome || '',
        numero_serie: data.numeroSerie || '',
        tipo: data.tipo || 'outro',
        client_id: data.clientId || null,
        client_name: data.clientName || 'Estoque Initnet',
        os_vinculada: data.osVinculada || null,
        pendencia_id: data.pendenciaId || null,
        status: data.status || 'estoque',
        valor: (data.valor === '' || data.valor == null) ? null : Number(data.valor) || 0,
        data_aquisicao: data.dataAquisicao || null,
        observacoes: data.observacoes || '',
        team: data.team || 'init',
        created_at: data.createdAt || now,
        updated_at: now
      }).then(res => { if (res.error) { console.warn('⚠️ Supabase equipamento:', res.error.message); markSyncPushFailed(); } })
        .catch(() => markSyncPushFailed());
    } catch (_) { /* tabela pode não existir ainda — sync genérico cobre quando existir */ }
  }

  return data;
}
function deleteEquipamento(id) {
  if (typeof canDelete === 'function' && !canDelete()) {
    if (typeof showToast === 'function') showToast('Permissão negada para excluir equipamentos.', 'error');
    return false;
  }
  const eq = getEquipamentoById(id);
  const desc = eq ? (eq.nome || 'Desconhecido') : 'Desconhecido';
  dbSet(DB.EQUIPAMENTOS, getEquipamentos().filter(e => e.id !== id));
  _addTombstone(DB.EQUIPAMENTOS, id);
  if (typeof addLog === 'function') addLog('Excluiu', 'Equipamento', id, desc);

  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && typeof window !== 'undefined' && window._supabaseAuthActive) {
    try {
      supabaseClient.from('equipamentos').delete().eq('id', id)
        .then(res => { if (res.error) { console.warn('⚠️ Supabase excluir equipamento:', res.error.message); markSyncPushFailed(); } })
        .catch(() => markSyncPushFailed());
    } catch (_) {}
  }
}

// ── VENCIMENTOS ──
function getVencimentos() { return dbGet(DB.VENCIMENTOS); }
function getMyVencimentos() {
  const team = (typeof isTeamAdmin === 'function' && isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam) ? _selectedTeam : null;
  const all = getVencimentos();
  if (team) return all.filter(v => (v.team || 'init') === team);
  return filterByTeam(all);
}
function getVencimentoById(id) { return getVencimentos().find(v => v.id === id) || null; }
function _pushVencimento(data) {
  if (typeof isSupabaseConnected !== 'function' || !isSupabaseConnected() || typeof window === 'undefined' || !window._supabaseAuthActive) return;
  try {
    const e = ENTITIES.find(x => x.table === 'vencimentos');
    supabaseClient.from('vencimentos').upsert(_mapToRemote(data, e.fields, e.optionalFields))
      .then(res => { if (res.error) { console.warn('⚠️ Supabase vencimento:', res.error.message); markSyncPushFailed(); } })
      .catch(() => markSyncPushFailed());
  } catch (_) { /* tabela pode não existir ainda — o sync genérico cobre */ }
}
/** @param {{ silent?: boolean }} [opts] silent: sem log (marcação interna de aviso enviado) */
function saveVencimento(data, opts) {
  const list = getVencimentos();
  const isEdit = !!data.id;
  const now = new Date().toISOString();
  if (data.clientId) {
    const client = typeof getClientById === 'function' ? getClientById(data.clientId) : null;
    if (client) { data.clientName = client.name; if (!data.team) data.team = client.team || 'init'; }
  } else {
    data.clientId = null;
    data.clientName = data.clientName || 'Interno';
  }
  if (!data.team) data.team = typeof getCurrentTeam === 'function' ? getCurrentTeam() : 'init';
  let saved;
  if (isEdit) {
    const i = list.findIndex(v => v.id === data.id);
    saved = i !== -1 ? { ...list[i], ...data, updatedAt: now } : { ...data, createdAt: data.createdAt || now, updatedAt: now };
    if (i !== -1) list[i] = saved; else list.push(saved);
  } else {
    saved = { status: 'ativo', avisos: [], historico: [], ...data, id: nextId('VEN'), createdAt: now, updatedAt: now };
    list.push(saved);
  }
  dbSet(DB.VENCIMENTOS, list);
  if (!(opts && opts.silent) && typeof addLog === 'function') addLog(isEdit ? 'Editou' : 'Criou', 'Vencimento', saved.id, saved.descricao || '');
  _pushVencimento(saved);
  return saved;
}
function deleteVencimento(id) {
  if (typeof canDelete === 'function' && !canDelete()) {
    if (typeof showToast === 'function') showToast('Permissão negada para excluir vencimentos.', 'error');
    return false;
  }
  const cur = getVencimentoById(id);
  dbSet(DB.VENCIMENTOS, getVencimentos().filter(v => v.id !== id));
  _addTombstone(DB.VENCIMENTOS, id);
  if (typeof addLog === 'function') addLog('Excluiu', 'Vencimento', id, cur ? cur.descricao : '');
  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && typeof window !== 'undefined' && window._supabaseAuthActive) {
    try {
      supabaseClient.from('vencimentos').delete().eq('id', id)
        .then(res => { if (res.error) { console.warn('⚠️ Supabase excluir vencimento:', res.error.message); markSyncPushFailed(); } })
        .catch(() => markSyncPushFailed());
    } catch (_) {}
  }
  return true;
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
      updated_at: now,
      // Artigo da base (sem cliente) leva a equipe — a RLS da 042 decide por ela.
      ...(list.find(p => p.id === data.id)?.team ? { team: list.find(p => p.id === data.id).team } : {})
    }).then(res => { if(res.error) { console.error('❌ Supabase procedimento:', res.error); markSyncPushFailed(); } }).catch(() => markSyncPushFailed());
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
  _addTombstone(DB.PROCEDURES, id);
  addLog('Excluiu', 'Procedimento', id, title);

  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    supabaseClient.from('procedures').delete().eq('id', id).then(res => { if(res.error) { console.error('❌ Supabase excluir procedimento:', res.error); markSyncPushFailed(); } }).catch(() => markSyncPushFailed());
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
    }).then(res => { if(res.error) { console.error('❌ Supabase modelo procedimento:', res.error); markSyncPushFailed(); } }).catch(() => markSyncPushFailed());
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
  _addTombstone(DB.PROCEDURE_TEMPLATES, id);
  addLog('Excluiu', 'Modelo Procedimento', id, title);

  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    supabaseClient.from('procedure_templates').delete().eq('id', id).then(res => { if(res.error) { console.error('❌ Supabase excluir modelo procedimento:', res.error); markSyncPushFailed(); } }).catch(() => markSyncPushFailed());
  }
  return true;
}
