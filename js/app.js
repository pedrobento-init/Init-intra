// app.js

// ── Dashboard Period Filter ─────────────────────────────────────────────────────
let _dashPeriod = 'all';
let _dashCustomStart = '';
let _dashCustomEnd   = '';
let _dashWorkloadPeriod = 'all';

// ── Team Filter ────────────────────────────────────────────────────────────────
let _selectedTeam = ''; // '' = all teams (for init/admin), specific team for others

function initTeamSelector() {
  const wrap = document.getElementById('teamSelectorWrap');
  const select = document.getElementById('teamSelector');
  if (!wrap || !select) return;
  
  const session = getSession();
  const isAdmin = isTeamAdmin();
  
  if (!isAdmin) {
    const myTeam = session?.team || 'init';
    _selectedTeam = myTeam;
    wrap.style.display = 'flex';
    select.innerHTML = TEAM_OPTIONS
      .filter(t => t.value === myTeam)
      .map(t => `<option value="${t.value}">${t.label}</option>`).join('');
    select.value = myTeam;
    select.disabled = true;
    select.style.opacity = '0.7';
    select.style.cursor = 'not-allowed';
    select.title = 'Sua equipe';
    if (typeof updateRelatoriosVisibility === 'function') updateRelatoriosVisibility();
    return;
  }

  // Admin/Init: show selector
  wrap.style.display = 'block';
  select.disabled = false;
  select.style.opacity = '';
  select.style.cursor = '';
  select.title = '';
  select.innerHTML = '<option value="">Todas as equipes</option>' +
    TEAM_OPTIONS.map(t => `<option value="${t.value}">${t.label}</option>`).join('');
  select.value = _selectedTeam;
  if (typeof updateRelatoriosVisibility === 'function') updateRelatoriosVisibility();
}

function canViewInitOnly() {
  try {
    if (typeof getCurrentTeam === 'function') {
      var t = String(getCurrentTeam() || '').toLowerCase().trim();
      return t === 'init';
    }
    var s = typeof getSession === 'function' ? getSession() : null;
    return String(s?.team || 'init').toLowerCase().trim() === 'init';
  } catch (_) { return false; }
}
function canViewRelatorios() { return canViewInitOnly(); }
function canViewReuniao() { return canViewInitOnly(); }
function updateRelatoriosVisibility() {
  var allowed = canViewInitOnly();
  var navRel = document.getElementById('nav-relatorios');
  if (navRel) navRel.style.display = allowed ? '' : 'none';
  var navReu = document.getElementById('nav-reuniao');
  if (navReu) navReu.style.display = allowed ? '' : 'none';
}
function onTeamChange(value) {
  _selectedTeam = value;
  // Save preference
  if (typeof setCacheKV === 'function') setCacheKV('intra_selected_team', value);
  // Rebuild realtime channel with the team filter
  if (typeof initSupabaseRealtime === 'function') initSupabaseRealtime();
  if (typeof updateRelatoriosVisibility === 'function') updateRelatoriosVisibility();
  // Re-render current page
  const hash = window.location.hash.replace('#','');
  if (hash) navigateTo(hash);
  else navigateTo('dashboard');
}

function getEffectiveTeam() {
  if (isTeamAdmin()) return _selectedTeam;
  return getCurrentTeam();
}

function _brasiliaDateParts(date) {
  const d = date || new Date();
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const obj = {};
  parts.forEach(p => obj[p.type] = parseInt(p.value));
  return { year: obj.year, month: obj.month - 1, day: obj.day };
}

function _brasiliaNow() {
  const p = _brasiliaDateParts();
  return new Date(p.year, p.month, p.day);
}

function _parseItemDate(item) {
  const raw = item.date || item.createdAt || item.updatedAt || 0;
  if (!raw) return new Date(0);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(raw)) ? parseDateOnly(raw) : new Date(raw);
  const bp = _brasiliaDateParts(d);
  return new Date(bp.year, bp.month, bp.day);
}

function setDashPeriod(period) {
  _dashPeriod = period;
  document.querySelectorAll('.period-btn').forEach(b => {
    const _on = b.dataset.period === period;
    b.classList.toggle('active', _on);
    b.setAttribute('aria-pressed', String(_on));
  });
  document.getElementById('customDateRange').style.display = period === 'custom' ? 'flex' : 'none';
  renderDashboard();
}

function setDashCustomDates() {
  const s = document.getElementById('dashCustomStart');
  const e = document.getElementById('dashCustomEnd');
  if (s) _dashCustomStart = s.value;
  if (e) _dashCustomEnd = e.value;
  renderDashboard();
}

function setWorkloadPeriod(v) { _dashWorkloadPeriod = v; renderDashboard(); }

function getDashDateRange() {
  const today = _brasiliaNow();
  let start = null, end = null;

  if (_dashPeriod === 'week') {
    start = new Date(today); start.setDate(today.getDate() - today.getDay() + 1);
    end = new Date(start); end.setDate(start.getDate() + 6);
  } else if (_dashPeriod === 'month') {
    start = new Date(today.getFullYear(), today.getMonth(), 1);
    end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  } else if (_dashPeriod === 'quarter') {
    const q = Math.floor(today.getMonth() / 3);
    start = new Date(today.getFullYear(), q * 3, 1);
    end = new Date(today.getFullYear(), q * 3 + 3, 0);
  } else if (_dashPeriod === 'custom' && _dashCustomStart && _dashCustomEnd) {
    start = new Date(_dashCustomStart + 'T00:00:00');
    end   = new Date(_dashCustomEnd   + 'T23:59:59');
  }
  return { start, end };
}

function itemInDashPeriod(item) {
  if (_dashPeriod === 'all') return true;
  const { start, end } = getDashDateRange();
  if (!start || !end) return true;
  const d = _parseItemDate(item);
  return d >= start && d <= end;
}

// ── Dashboard widgets: personalização + helpers puros (sem duplicar cálculos) ─
const DASH_SILENCE_DAYS_FALLBACK = 30;

function _dashOperatorKey() {
  try {
    const s = typeof getSession === 'function' ? getSession() : null;
    return s?.opId || s?.name || 'anon';
  } catch (_) { return 'anon'; }
}
function _dashHiddenKey() { return 'dash_hidden_widgets_' + _dashOperatorKey(); }
function _getDashHidden() {
  try {
    if (typeof getCacheKV === 'function') return getCacheKV(_dashHiddenKey(), []) || [];
  } catch (_) {}
  return [];
}
function _dashIsHidden(id) {
  try { return _getDashHidden().includes(id); } catch (_) { return false; }
}
function toggleDashWidget(id) {
  try {
    const key = _dashHiddenKey();
    const cur = _getDashHidden();
    const next = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id];
    if (typeof setCacheKV === 'function') setCacheKV(key, next);
  } catch (_) {}
  renderDashboard();
}
function resetDashWidgets() {
  try {
    if (typeof setCacheKV === 'function') setCacheKV(_dashHiddenKey(), []);
    else if (typeof removeCacheKV === 'function') removeCacheKV(_dashHiddenKey());
  } catch (_) {}
  renderDashboard();
  if (typeof showToast === 'function') showToast('Widgets do Dashboard restaurados.', 'success');
}
function _dashHideBtn(id) {
  return `<button class="dash-hide-btn" title="Ocultar widget" onclick="event.stopPropagation();toggleDashWidget('${id}')">✕</button>`;
}
function dashGoPresentation() {
  navigateTo('reuniao');
  setTimeout(() => { if (typeof enterPresentationMode === 'function') enterPresentationMode(); }, 150);
}
function dashGoToPendenciasByOperator(name) {
  try {
    if (typeof saveFilterState === 'function') saveFilterState('pendencias', { resp: name, search: '', client: '', status: '', priority: '' });
  } catch (_) {}
  navigateTo('pendencias');
}
// Selo de comparativo: verde = melhora, vermelho = piora, cinza = estável/sem base.
function _dashDeltaBadge(delta) {
  if (!delta || delta.improved == null || delta.direction === 'flat') {
    return `<span class="dash-delta dash-delta-flat" title="Sem variação relevante">• 0%</span>`;
  }
  const color = delta.improved ? '#16a34a' : '#dc2626';
  const arrow = delta.direction === 'up' ? '↑' : '↓';
  return `<span class="dash-delta" style="color:${color}" title="${delta.improved ? 'Melhora' : 'Piora'} vs. período anterior">${arrow}${delta.pct}%</span>`;
}
// Faixa anterior espelhando getDashDateRange (reaproveita metrics.js quando disponível).
function _getPreviousDashRange() {
  try {
    if (typeof getPreviousDashRange === 'function') {
      return getPreviousDashRange(_dashPeriod, _dashCustomStart, _dashCustomEnd, _brasiliaNow());
    }
  } catch (_) {}
  const today = _brasiliaNow();
  const day = 86400000;
  if (_dashPeriod === 'week') {
    const dow = (today.getDay() + 6) % 7;
    const start = new Date(today.getTime() - dow * day);
    const prevEnd = new Date(start.getTime() - day);
    const prevStart = new Date(prevEnd.getTime() - 6 * day);
    return { start: prevStart, end: prevEnd };
  }
  if (_dashPeriod === 'month') {
    return { start: new Date(today.getFullYear(), today.getMonth() - 1, 1), end: new Date(today.getFullYear(), today.getMonth(), 0) };
  }
  if (_dashPeriod === 'quarter') {
    const q = Math.floor(today.getMonth() / 3);
    return { start: new Date(today.getFullYear(), q * 3 - 3, 1), end: new Date(today.getFullYear(), q * 3, 0) };
  }
  return null;
}
function _filterPensByRange(pens, range) {
  if (!range || !range.start || !range.end) return [];
  return (pens || []).filter(p => {
    const d = _parseItemDate(p);
    return d >= range.start && d <= range.end;
  });
}
function _calcDashStats(pens) {
  try {
    if (typeof calcPeriodStats === 'function') return calcPeriodStats(pens, typeof isPendenciaClosed === 'function' ? isPendenciaClosed : undefined);
  } catch (_) {}
  const isClosed = typeof isPendenciaClosed === 'function' ? isPendenciaClosed : (s => ['concluido','resolvido','cancelado','fechado'].includes(s));
  const active = (pens || []).filter(p => !isClosed(p.status));
  const resolved = (pens || []).filter(p => isPendenciaResolvida(p.status)).length;
  const done = (pens || []).filter(p => isPendenciaResolvida(p.status) && p.createdAt && (p.completedAt || p.updatedAt));
  let total = 0, count = 0;
  done.forEach(p => {
    const h = (new Date(p.completedAt || p.updatedAt) - new Date(p.createdAt)) / 3600000;
    if (h >= 0 && h < 365 * 24) { total += h; count++; }
  });
  return { open: active.length, avgSlaHours: count ? Number((total / count).toFixed(1)) : 0, completionRate: pens?.length ? Math.round((resolved / pens.length) * 100) : 0 };
}
function _calcDashDelta(cur, prev, higherIsBetter) {
  try {
    if (typeof calcPeriodDelta === 'function') return calcPeriodDelta(cur, prev, higherIsBetter);
  } catch (_) {}
  if (!prev) return { pct: cur ? 100 : 0, direction: cur ? 'up' : 'flat', improved: cur ? higherIsBetter : null };
  const pct = Math.round(((cur - prev) / Math.abs(prev)) * 100);
  const direction = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
  return { pct: Math.abs(pct), direction, improved: direction === 'flat' ? null : (higherIsBetter ? direction === 'up' : direction === 'down') };
}

// ── Export / Import ────────────────────────────────────────────────────────────
function exportData() {
  if (typeof isCurrentAdmin === 'function' && !isCurrentAdmin()) {
    showToast('Apenas administradores podem exportar backup completo.', 'error');
    return;
  }
  const safeOps = (getOperators() || []).map(o => {
    const { pinHash, pinSalt, pin, ...rest } = o;
    return rest;
  });
  const data = {
    exportedAt: new Date().toISOString(),
    clients:    getClients(),
    pendencias: getPendencias(),
    procedures: dbGet('intra_procedures'),
    procedureTemplates: dbGet('intra_procedure_templates'),
    operators:  safeOps,
    visits:     getVisits(),
    tickets:    getTickets(),
    reunioes:   getReunioes(),
    equipamentos: (typeof getEquipamentos === 'function' ? getEquipamentos() : []),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `initintra-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Backup exportado com sucesso!', 'success');
}

function importData() {
  if (!isCurrentAdmin()) {
    showToast('Apenas administradores podem importar dados.', 'error');
    return;
  }
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data.clients || !data.pendencias) throw new Error();
        confirmAction(
          'Isso irá <strong>substituir todos os dados atuais</strong> pelo backup e sincronizar na nuvem. Continuar?',
          () => { _runImportBackup(data); }
        );
      } catch { showToast('Arquivo de backup inválido.', 'error'); }
    };
    reader.readAsText(file);
  };
  input.click();
}

async function _runImportBackup(data) {
  try {
    showToast('Importando backup...', 'info');

    // Restore em massa — não é edição do usuário (não conta como pendência).
    if (typeof window !== 'undefined') window._suppressPendingSync = true;
    try {
      if (data.clients)    dbSet('intra_clients',    data.clients);
      if (data.pendencias) dbSet('intra_pendencias', data.pendencias);
      if (data.procedures) dbSet('intra_procedures', data.procedures);
      if (data.procedureTemplates) dbSet('intra_procedure_templates', data.procedureTemplates);
      if (data.operators)  dbSet('intra_operators',  data.operators);
      if (data.visits)     dbSet('intra_visits',     data.visits);
      if (data.tickets)    dbSet('intra_tickets',    data.tickets);
      if (data.reunioes)   dbSet('intra_reunioes',   data.reunioes);
      if (data.equipamentos) dbSet('intra_equipamentos', data.equipamentos);
    } finally {
      if (typeof window !== 'undefined') window._suppressPendingSync = false;
    }

    const cloudOk = typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive;
    if (cloudOk) {
      showToast('Enviando backup para a nuvem...', 'info');
      const errors = await _pushImportToSupabase(data);
      if (errors.length) {
        if (typeof markSyncPushFailed === 'function') markSyncPushFailed();
        showToast(`Backup local OK, mas ${errors.length} erro(s) no envio à nuvem.`, 'warning', 6000);
      } else {
        showToast('Backup importado e sincronizado!', 'success');
      }
    } else {
      showToast('Backup importado localmente.', 'success');
    }

    addLog('Importou Backup', 'Backup', 'Geral', 'Restaurou backup do sistema');
    navigateTo(typeof isCurrentAdmin === 'function' && isCurrentAdmin() ? 'dashboard' : 'pendencias');
  } catch (err) {
    console.error(err);
    showToast('Erro ao importar: ' + (err.message || err), 'error');
  }
}

async function _pushImportToSupabase(data) {
  const errors = [];
  const chunk = async (table, rows, size = 50) => {
    if (!rows?.length) return;
    for (let i = 0; i < rows.length; i += size) {
      const batch = rows.slice(i, i + size);
      const { error } = await supabaseClient.from(table).upsert(batch);
      if (error) errors.push(`${table}: ${error.message}`);
    }
  };

  const now = new Date().toISOString();

  try {
    await chunk('clients', (data.clients || []).map(c => ({
      id: c.id, name: c.name, cnpj: c.cnpj, segment: c.segment, color: c.color, initials: c.initials,
      logo: c.logo, logo_shape: c.logoShape || 'circle', owner: c.owner, owner_phone: c.ownerPhone,
      responsible: c.responsible, responsible_phone: c.responsiblePhone, technician: c.technician,
      server: c.server, hosting: c.hosting, backup: c.backup, licenses: c.licenses, emails: c.emails,
      google_sheet_url: c.googleSheetUrl || null, milvus_client_token: c.milvusClientToken || null, notes: c.notes, team: c.team || 'init',
      attachments: c.attachments || [], created_at: c.createdAt || now, updated_at: c.updatedAt || now
    })));
  } catch (e) { errors.push('clients: ' + e.message); }

  try {
    await chunk('pendencias', (data.pendencias || []).map(p => ({
      id: p.id, client_id: p.clientId, client_name: p.clientName, tipo: p.tipo, assunto: p.assunto || '', descricao: p.descricao,
      responsible: p.responsible, status: p.status, priority: p.priority, deadline: p.deadline || null,
      notes: p.notes || [], link_util: p.linkUtil || '', team: p.team || 'init',
      attachments: p.attachments || [], checklist: p.checklist || [], tags: p.tags || [],
      recurrence: p.recurrence || null, visit_id: p.visitId || null,
      reviewed_in_meeting: p.reviewedInMeeting || null,
      completed_at: p.completedAt || null, completed_by: p.completedBy || null,
      created_at: p.createdAt || now, updated_at: p.updatedAt || now
    })));
  } catch (e) { errors.push('pendencias: ' + e.message); }

  try {
    await chunk('operators', (data.operators || []).map(o => ({
      id: o.id, name: o.name, initials: o.initials, color: o.color, role: o.role, phone: o.phone,
      email: o.email,
      is_admin: o.isAdmin === true, active: o.active !== false, team: o.team || 'init',
      auth_user_id: o.auth_user_id || null, created_at: o.createdAt || now, updated_at: o.updatedAt || now
    })));
  } catch (e) { errors.push('operators: ' + e.message); }

  try {
    await chunk('procedures', (data.procedures || []).map(p => ({
      id: p.id, client_id: p.clientId, title: p.title, category: p.category, content: p.content,
      created_at: p.createdAt || now, updated_at: p.updatedAt || now
    })));
  } catch (e) { errors.push('procedures: ' + e.message); }

  try {
    await chunk('procedure_templates', (data.procedureTemplates || []).map(t => ({
      id: t.id, title: t.title, category: t.category, content: t.content, created_by: t.createdBy || null,
      created_at: t.createdAt || now, updated_at: t.updatedAt || now
    })));
  } catch (e) { errors.push('procedure_templates: ' + e.message); }

  try {
    await chunk('visits', (data.visits || []).map(v => ({
      id: v.id, client_id: v.clientId, client_name: v.clientName, operator: v.operator,
      date: v.date, time: v.time, time_end: v.timeEnd || null, all_day: v.allDay === true,
      motivo: v.motivo, observacoes: v.observacoes, relatorio: v.relatorio || '', status: v.status,
      recurrence: v.recurrence || null,
      team: v.team || 'init', categories: v.categories || [], checklist: v.checklist || [],
      created_at: v.createdAt || now, updated_at: v.updatedAt || now
    })));
  } catch (e) {
    errors.push('visits: ' + e.message);
  }

  try {
    await chunk('tickets', (data.tickets || []).map(t => ({
      id: t.id, client_id: t.clientId, client_name: t.clientName, title: t.title, description: t.description,
      status: t.status, priority: t.priority, technician: t.technician, updates: t.updates || [],
      team: t.team || 'init', attachments: t.attachments || [],
      timer_running: t.timerRunning === true, timer_started_at: t.timerStartedAt || null,
      timer_total_seconds: t.timerTotalSeconds || 0, timer_operator: t.timerOperator || null,
      completed_at: t.completedAt || null, created_at: t.createdAt || now, updated_at: t.updatedAt || now
    })));
  } catch (e) { errors.push('tickets: ' + e.message); }

  try {
    await chunk('reunioes', (data.reunioes || []).map(r => ({
      id: r.id, mes_ano: r.mesAno || null, status: r.status || 'aberta',
      started_at: r.startedAt || null, ended_at: r.endedAt || null,
      team: r.team || 'init', relatorio: r.relatorio || '', participants: r.participants || [],
      created_at: r.createdAt || now, updated_at: r.updatedAt || now
    })));
  } catch (e) { errors.push('reunioes: ' + e.message); }

  try {
    await chunk('equipamentos', (data.equipamentos || []).map(e => ({
      id: e.id, nome: e.nome || '', numero_serie: e.numeroSerie || '', tipo: e.tipo || 'outro',
      client_id: e.clientId || null, client_name: e.clientName || 'Estoque Initnet',
      os_vinculada: e.osVinculada || null, pendencia_id: e.pendenciaId || null,
      status: (e.status === 'em_uso' ? 'entregue' : (e.status || 'estoque')),
      valor: (e.valor === '' || e.valor == null) ? null : Number(e.valor) || 0,
      data_aquisicao: e.dataAquisicao || null, observacoes: e.observacoes || '',
      team: e.team || 'init', created_at: e.createdAt || now, updated_at: e.updatedAt || now
    })));
  } catch (e) { errors.push('equipamentos: ' + e.message); }

  return errors;
}

// ── Navegação ──────────────────────────────────────────────────────────────────
const _pageScrollState = {};

function navigateTo(page) {
  const contentArea = document.getElementById('contentArea');
  const currentHash = window.location.hash.replace('#', '') || 'dashboard';

  if (page === 'mapeamento-milvus') {
    // Módulo oculto para todos (decisão de produto): acesso direto redireciona.
    if (typeof showToast === 'function') showToast('Módulo desativado.', 'error');
    page = 'dashboard';
  }
  if (typeof isCurrentAdmin === 'function' && !isCurrentAdmin()) {
    if (page === 'historico') {
      if (typeof showToast === 'function') showToast('Apenas administradores podem ver o histórico.', 'error');
      page = 'pendencias';
    }
    // Dashboard liberado p/ todos os perfis (blocos de gestão filtrados em renderDashboard).
  }
  if (page === 'relatorios' && typeof canViewInitOnly === 'function' && !canViewInitOnly()) {
    if (typeof showToast === 'function') showToast('Relatórios disponível apenas para o time Init.', 'error');
    page = 'pendencias';
  }
  if (page === 'reuniao' && typeof canViewInitOnly === 'function' && !canViewInitOnly()) {
    if (typeof showToast === 'function') showToast('Reunião disponível apenas para o time Init.', 'error');
    page = 'pendencias';
  }

  if (currentHash !== page && contentArea) {
    _pageScrollState[currentHash] = contentArea.scrollTop;
  }

  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const el = document.getElementById('nav-' + page);
  if (el) el.classList.add('active');

  const btn = document.getElementById('topbarActionBtn');
  btn.style.display = 'none';

  if (typeof updateBadges === 'function') updateBadges();

  if      (page === 'dashboard')   { document.getElementById('pageTitle').textContent = 'Dashboard'; renderDashboard(); }
  else if (page === 'clientes')    renderClients();
  else if (page === 'templates')   renderTemplates();
  else if (page === 'pendencias')  renderPendencias();
  else if (page === 'calendario')  renderCalendar();
  else if (page === 'visitas')     renderVisitas();
  else if (page === 'reuniao')     renderReuniao();
  else if (page === 'operadores')  renderOperadores();
  else if (page === 'relatorios')  { if(typeof renderRelatorios==='function') renderRelatorios(); else document.getElementById('contentArea').innerHTML='<p>Relatórios em carregamento...</p>'; }
  else if (page === 'equipamentos') renderEquipamentos();
  else if (page === 'mapeamento-milvus') renderMapeamentoMilvus();
  else if (page === 'historico')   renderLogs();

  window.location.hash = page;

  var ca = document.getElementById('contentArea');
  if (ca) {
    ca.classList.remove('transitioning');
    void ca.offsetWidth;
    ca.classList.add('transitioning');
    requestAnimationFrame(() => {
      const saved = _pageScrollState[page];
      if (saved) { ca.scrollTop = saved; _pageScrollState[page] = 0; }
    });
  }
}

// ── Dashboard ──────────────────────────────────────────────────────────────────
function renderDashboard() {
  const allClients  = isTeamAdmin() && _selectedTeam ? getClientsByTeam(_selectedTeam) : getMyClients();
  const allPens     = isTeamAdmin() && _selectedTeam ? getPendenciasByTeam(_selectedTeam) : getMyPendencias();
  const allVisits   = isTeamAdmin() && _selectedTeam ? getVisitsByTeam(_selectedTeam) : getMyVisits();
  const session     = getSession();
  const currentUser = session ? session.name : '';
  const today       = localDateISO();
  // Gate único de gestão: admin + supervisor (viewAll). Operador comum vê
  // só a versão individual do dashboard (blocos marcados abaixo).
  const _dashCanManage = (typeof isTeamAdmin === 'function' && isTeamAdmin()) ? true : false;

  const clients  = allClients.filter(c => itemInDashPeriod(c));
  const pens     = allPens.filter(p => itemInDashPeriod(p));
  const open     = pens.filter(p => p.status === 'aberto');
  const inProg   = pens.filter(p => p.status === 'em_andamento');
  const paused   = pens.filter(p => p.status === 'pausado');
  const critical = pens.filter(p => ['alta','critica'].includes(p.priority) && !isPendenciaClosed(p.status));
  const activePens = pens.filter(p => !isPendenciaClosed(p.status));
  const overdue = activePens.filter(p => p.deadline && p.deadline < today);
  const dueToday = activePens.filter(p => p.deadline === today);
  const unassigned = activePens.filter(p => !p.responsible || !p.responsible.trim());
  const recentPens = [...pens]
    .filter(p => !isPendenciaClosed(p.status) && p.responsible === currentUser)
    .sort((a,b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .slice(0, 5);

  // ── Minha fila do dia (urgência) ───────────────────────────────────────────
  const _tomorrowISO = (function(){ const d = new Date(today + 'T12:00:00'); d.setDate(d.getDate()+1); return d.toISOString().slice(0,10); })();
  let myQueue = [];
  if (typeof getMinhaFilaDoDia === 'function') {
    try { myQueue = getMinhaFilaDoDia(allPens, currentUser, today, { tomorrowISO: _tomorrowISO }); } catch (_) { myQueue = []; }
  } else {
    const P_W = (typeof PRIORITY_WEIGHT !== 'undefined' ? PRIORITY_WEIGHT : { critica:4, alta:3, media:2, baixa:1 });
    const _isClosed = typeof isPendenciaClosed === 'function' ? isPendenciaClosed : function(s){ return ['concluido','resolvido','cancelado','fechado'].includes(s); };
    const _isStale = typeof isStalePendencia === 'function' ? isStalePendencia : function(){ return false; };
    myQueue = (allPens||[]).filter(function(p){
      if (_isClosed(p.status)) return false;
      if ((p.responsible||'') !== currentUser) return false;
      const highPri = ['alta','critica'].includes(p.priority);
      const dueSoon = p.deadline === today || p.deadline === _tomorrowISO || (p.deadline && p.deadline < today);
      const stale = _isStale(p);
      return highPri || dueSoon || stale;
    }).sort(function(a,b){
      const aOver = a.deadline && a.deadline < today ? 1 : 0;
      const bOver = b.deadline && b.deadline < today ? 1 : 0;
      if (bOver !== aOver) return bOver - aOver;
      const aW = P_W[a.priority] || 0; const bW = P_W[b.priority] || 0;
      if (bW !== aW) return bW - aW;
      const aSt = _isStale(a) ? 1 : 0; const bSt = _isStale(b) ? 1 : 0;
      if (bSt !== aSt) return bSt - aSt;
      if (a.deadline && b.deadline && a.deadline !== b.deadline) return a.deadline.localeCompare(b.deadline);
      return new Date(b.updatedAt||0) - new Date(a.updatedAt||0);
    });
  }

  // Visitas de hoje do operador no topo da fila (agendadas/em andamento)
  let myTodayVisits = [];
  if (typeof getTodayVisitsForOperator === 'function') {
    try { myTodayVisits = getTodayVisitsForOperator(allVisits, currentUser, today); } catch (_) { myTodayVisits = []; }
  } else {
    myTodayVisits = (allVisits || []).filter(function (v) {
      return v && v.date === today && (v.operator || '') === currentUser && v.status !== 'cancelada' && v.status !== 'concluida';
    }).sort(function (a, b) {
      const aT = a.allDay ? '' : (a.time || '99');
      const bT = b.allDay ? '' : (b.time || '99');
      return String(aT).localeCompare(String(bT));
    });
  }

  const visits       = allVisits.filter(v => itemInDashPeriod(v));
  const upcomingVisits = [...allVisits]
    .filter(v => v.date >= today && v.status !== 'cancelada' && v.status !== 'concluida')
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.time || '').localeCompare(b.time || ''))
    .slice(0, 5);
  const todayVisits = allVisits.filter(v => v.date === today && v.status !== 'cancelada');

  const opsAtivos = getOperators().filter(o => o.active !== false).length;

  const resolvedPens = pens.filter(p => isPendenciaResolvida(p.status) && p.createdAt && (p.completedAt || p.updatedAt));
  const getHours = (start, end) => (new Date(end) - new Date(start)) / (1000 * 60 * 60);
  let totalHours = 0; let totalCount = 0;
  resolvedPens.forEach(p => {
    const hours = getHours(p.createdAt, p.completedAt || p.updatedAt);
    if (hours >= 0) { totalHours += hours; totalCount++; }
  });
  const avgSlaHours = totalCount > 0 ? (totalHours / totalCount).toFixed(1) : 0;
  const resolvedCount = pens.filter(p => isPendenciaResolvida(p.status)).length;
  const completionRate = pens.length ? Math.round((resolvedCount / pens.length) * 100) : 0;

  // ── Evolução Dashboard: reaproveita pens/overdue/dueToday/etc (sem duplicar) ─
  const _dashOpenCount = open.length + inProg.length + paused.length;
  const _effTeam = typeof getEffectiveTeam === 'function' ? getEffectiveTeam() : '';
  let _allReunioes = [];
  try {
    if (typeof getMyReunioes === 'function') _allReunioes = (isTeamAdmin() && _selectedTeam && typeof getReunioesByTeam === 'function') ? getReunioesByTeam(_selectedTeam) : getMyReunioes();
    else if (typeof getReunioes === 'function') _allReunioes = getReunioes();
  } catch (_) { _allReunioes = []; }
  let _nextMeeting = null;
  try {
    if (typeof getNextMeeting === 'function') _nextMeeting = getNextMeeting(_allReunioes, (isTeamAdmin() && _selectedTeam) ? _selectedTeam : null);
    else {
      const _open = (_allReunioes || []).filter(r => r.status === 'aberta').sort((a,b) => String(a.mesAno||'').localeCompare(String(b.mesAno||'')));
      _nextMeeting = _open[0] || (_allReunioes || []).slice().sort((a,b) => String(b.mesAno||'').localeCompare(String(a.mesAno||'')))[0] || null;
    }
  } catch (_) { _nextMeeting = null; }
  const _meetingLabel = (() => {
    if (!_nextMeeting?.mesAno) return '—';
    try {
      if (typeof _getMesAnoLabel === 'function') return _getMesAnoLabel(_nextMeeting.mesAno);
    } catch (_) {}
    return _nextMeeting.mesAno;
  })();
  // Recorrência: streak >= 2 (reaproveita getConsecutiveMeetingStreak)
  let _recurrent = [];
  try {
    if (typeof getRecurrentClients === 'function') {
      const _sorted = (_allReunioes || []).filter(r => r.status === 'encerrada').sort((a,b) => String(b.mesAno||'').localeCompare(String(a.mesAno||'')));
      _recurrent = getRecurrentClients(allClients, _sorted, allPens, 2, 5);
    } else if (typeof getConsecutiveMeetingStreak === 'function' && typeof getMyReunioes === 'function') {
      const _sorted = (_allReunioes || []).filter(r => r.status === 'encerrada').sort((a,b) => String(b.mesAno||'').localeCompare(String(a.mesAno||'')));
      _recurrent = allClients.map(c => ({ client: c, clientId: c.id, clientName: c.name, streak: getConsecutiveMeetingStreak(c.id, _sorted, allPens) }))
        .filter(r => r.streak > 1).sort((a,b) => b.streak - a.streak).slice(0, 5);
    }
  } catch (_) { _recurrent = []; }
  // Risco: piores scores (reaproveita cálculo de clients.js/metrics.js)
  let _risk = [];
  try {
    if (typeof getRiskRanking === 'function') _risk = getRiskRanking(clients.length ? clients : allClients, pens.length ? pens : allPens, today, 5, typeof isPendenciaClosed === 'function' ? isPendenciaClosed : undefined);
    else if (typeof getHealthForClient === 'function') {
      const _base = clients.length ? clients : allClients;
      const _pens = pens.length ? pens : allPens;
      _risk = _base.map(c => ({ client: c, clientId: c.id, clientName: c.name, health: getHealthForClient(_pens, c.id, today) }))
        .sort((a,b) => ({red:0,yellow:1,green:2}[a.health.level] - {red:0,yellow:1,green:2}[b.health.level]) || (b.health.vencidas - a.health.vencidas))
        .filter(r => r.health.totalAbertas > 0).slice(0, 5);
    }
  } catch (_) { _risk = []; }
  // Silêncio: 30 dias sem contato (usa histórico completo, não o filtro de período)
  let _silent = [];
  try {
    const _days = (typeof DASH_SILENCE_DAYS !== 'undefined' ? DASH_SILENCE_DAYS : (typeof DASH_SILENCE_DAYS_FALLBACK !== 'undefined' ? DASH_SILENCE_DAYS_FALLBACK : 30));
    if (typeof getSilentClients === 'function') _silent = getSilentClients(allClients, allPens, allVisits, _days, today).slice(0, 5);
  } catch (_) { _silent = []; }
  // Aniversários no mês corrente (usa createdAt do cliente)
  let _anniv = [];
  try {
    if (typeof getClientAnniversaries === 'function') _anniv = getClientAnniversaries(allClients, _brasiliaNow()).slice(0, 5);
  } catch (_) { _anniv = []; }
  // Afastados (onLeave) + sobrecarga para o resumo do dia
  let _allOps = [];
  try { _allOps = typeof getOperators === 'function' ? getOperators() : []; } catch (_) { _allOps = []; }
  const _onLeaveOps = _allOps.filter(o => o.onLeave === true && (!_effTeam || !isTeamAdmin() || !_selectedTeam || (o.team || 'init') === _selectedTeam));
  const _onLeaveWithCount = _onLeaveOps.map(o => ({ name: o.name, count: activePens.filter(p => p.responsible === o.name).length }));
  const _loadByResp = {};
  activePens.forEach(p => { const k = p.responsible || 'Sem responsável'; _loadByResp[k] = (_loadByResp[k] || 0) + 1; });
  const _overloaded = Object.entries(_loadByResp).filter(([k, v]) => k !== 'Sem responsável' && v >= 6)
    .map(([name, count]) => ({ name, count })).sort((a,b) => b.count - a.count).slice(0, 2);
  let _daySummary = '';
  try {
    // Operador comum: sem nomes de colegas (gestão de equipe) — só contagens.
    if (typeof buildDaySummary === 'function') _daySummary = buildDaySummary({ dueToday, todayVisits, overloadedOps: (_dashCanManage ? _overloaded : []), onLeaveOps: (_dashCanManage ? _onLeaveOps.map(o => o.name) : []) });
    else _daySummary = `Hoje: ${dueToday.length} pendência(s) vencem, ${todayVisits.length} visita(s) agendada(s).` + ((_dashCanManage && (_overloaded.length || _onLeaveOps.length)) ? ' Atenção: ' + [..._overloaded.map(o => `${o.name} está sobrecarregado (${o.count} ativas)`), ..._onLeaveOps.map(o => `${o.name} está afastado`)].join('; ') + '.' : '');
  } catch (_) { _daySummary = `Hoje: ${dueToday.length} pendência(s) vencem, ${todayVisits.length} visita(s) agendada(s).`; }
  // Comparativo com período anterior (apenas quando há filtro de período)
  let _prevStats = null, _deltaOpen = null, _deltaSla = null, _deltaComp = null;
  if (_dashPeriod !== 'all') {
    const _range = _getPreviousDashRange();
    if (_range && _range.start && _range.end) {
      const _prevPens = _filterPensByRange(allPens, _range);
      _prevStats = _calcDashStats(_prevPens);
      const _curStats = { open: _dashOpenCount, avgSlaHours: Number(avgSlaHours) || 0, completionRate };
      _deltaOpen = _calcDashDelta(_curStats.open, _prevStats.open, false);
      _deltaSla = _calcDashDelta(_curStats.avgSlaHours, _prevStats.avgSlaHours, false);
      _deltaComp = _calcDashDelta(_curStats.completionRate, _prevStats.completionRate, true);
    }
  }

  const periodLabel = {all:'Todos',week:'Esta Semana',month:'Este Mês',quarter:'Este Trimestre',custom:'Personalizado'}[_dashPeriod] || 'Todos';

  // ── Visão geral (redesign): derivados só de apresentação, mesmos dados ──
  const _ovIsOnline = (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) ? true : false;
  const _ovOverTop = (_dashCanManage && _overloaded.length) ? _overloaded[0] : null;
  const _ovOverExtra = (_dashCanManage && _overloaded.length > 1) ? (_overloaded.length - 1) : 0;
  const _ovOverTitle = (_dashCanManage && _overloaded.length) ? _overloaded.map(o => `${o.name} (${o.count})`).join(', ') : '';
  let _ovNeutralCount = 0;
  let _ovNeutralLabel = 'pendências ativas';
  if (!_ovOverTop) {
    if (!_dashCanManage) {
      _ovNeutralCount = activePens.filter(p => p.responsible === currentUser).length;
      _ovNeutralLabel = 'suas pendências ativas';
    } else {
      let _mx = 0;
      Object.entries(_loadByResp).forEach(([k, v]) => { if (k !== 'Sem responsável' && v > _mx) _mx = v; });
      _ovNeutralCount = _mx;
      _ovNeutralLabel = activePens.length ? 'pendências ativas (maior carga)' : 'pendências ativas';
    }
  }
  const _ovRiskLabel = { red: 'Crítico', yellow: 'Atenção', green: 'Saudável' };
  const _ovInitials = (name) => {
    const _n = String(name || '?').trim();
    if (!_n) return '?';
    const _parts = _n.split(/\s+/).filter(Boolean);
    if (_parts.length === 1) return _n.slice(0, 2).toUpperCase();
    return (_parts[0][0] + _parts[1][0]).toUpperCase();
  };

  document.getElementById('contentArea').innerHTML = `
    <div class="ov-wrap">
    <header class="ov-head">
      <h1 class="ov-h1">Visão geral</h1>
      <div class="dash-sync-status ov-sync" title="Fonte dos dados do dashboard">
        <span class="dash-sync-dot ov-dot ${_ovIsOnline ? 'is-online' : ''}"></span>
        <span>${_ovIsOnline ? 'Dados sincronizados' : 'Dados locais'}</span>
      </div>
    </header>
    <div class="ov-bar">
      <div class="period-filter ov-seg" role="group" aria-label="Período">
        <button type="button" class="period-btn${_dashPeriod==='all'?' active':''}" data-period="all" aria-pressed="${_dashPeriod==='all'}" onclick="setDashPeriod('all')">Todos</button>
        <button type="button" class="period-btn${_dashPeriod==='week'?' active':''}" data-period="week" aria-pressed="${_dashPeriod==='week'}" onclick="setDashPeriod('week')">Semana</button>
        <button type="button" class="period-btn${_dashPeriod==='month'?' active':''}" data-period="month" aria-pressed="${_dashPeriod==='month'}" onclick="setDashPeriod('month')">Mês</button>
        <button type="button" class="period-btn${_dashPeriod==='quarter'?' active':''}" data-period="quarter" aria-pressed="${_dashPeriod==='quarter'}" onclick="setDashPeriod('quarter')">Trimestre</button>
        <button type="button" class="period-btn${_dashPeriod==='custom'?' active':''}" data-period="custom" aria-pressed="${_dashPeriod==='custom'}" onclick="setDashPeriod('custom')">Personalizado</button>
        <div id="customDateRange" class="custom-date-range ov-custom" style="display:${_dashPeriod==='custom'?'flex':'none'}">
          <input type="date" id="dashCustomStart" value="${_dashCustomStart}" onchange="setDashCustomDates()" class="date-input" aria-label="Data inicial" />
          <span class="ov-until">até</span>
          <input type="date" id="dashCustomEnd" value="${_dashCustomEnd}" onchange="setDashCustomDates()" class="date-input" aria-label="Data final" />
        </div>
      </div>
      <div class="dash-export-btns ov-acts">
        ${_dashCanManage ? `<button type="button" class="btn btn-secondary btn-sm ov-btn" onclick="exportClientsCSV()">
          <svg class="ov-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 20h16"/></svg>
          CSV Clientes
        </button>` : ''}
        ${_dashCanManage ? `<button type="button" class="btn btn-secondary btn-sm ov-btn" onclick="exportPendenciasCSV()">
          <svg class="ov-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 20h16"/></svg>
          CSV Pendências
        </button>` : ''}
        ${_dashCanManage ? `<button type="button" class="btn btn-secondary btn-sm ov-btn" onclick="openHoursReport()">
          <svg class="ov-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
          Horas
        </button>` : ''}
        <button type="button" class="btn btn-secondary btn-sm ov-btn" onclick="window.print()">
          <svg class="ov-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 9V3h10v6M7 17H5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2M7 14h10v7H7z"/></svg>
          PDF
        </button>
        ${_dashCanManage ? `<button type="button" class="btn btn-primary btn-sm ov-btn" onclick="generateMonthlyReport()">
          <svg class="ov-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7zM14 3v4h4M9 13h6M9 17h6"/></svg>
          Relatório Mensal
        </button>` : ''}
        ${_dashCanManage ? `<button type="button" class="btn btn-secondary btn-sm ov-btn" title="Abrir reunião em modo apresentação" onclick="dashGoPresentation()">
          <svg class="ov-ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/></svg>
          Apresentar</button>` : ''}
        ${_dashCanManage ? `<button type="button" class="btn btn-secondary btn-sm ov-btn" title="Restaurar widgets ocultos" onclick="resetDashWidgets()">
          <svg class="ov-ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/></svg>
          Widgets</button>` : ''}
      </div>
    </div>

    ${!_dashIsHidden('resumo-dia') ? `
    <section class="card dash-widget ov-panel" aria-labelledby="ov-dia">
      ${_dashHideBtn('resumo-dia')}
      <div class="ov-ph"><h2 class="ov-h2" id="ov-dia">Resumo do dia</h2></div>
      <div class="ov-sum">
        <div class="ov-col"><div class="ov-n">${dueToday.length}</div><div class="ov-l">pendências vencem hoje</div></div>
        <div class="ov-col"><div class="ov-n">${todayVisits.length}</div><div class="ov-l">visitas agendadas</div></div>
        <div class="ov-col">${_ovOverTop ? `
          <div class="ov-n" title="${escapeHtml(_ovOverTitle)}">${_ovOverTop.count} <span class="ov-tag">Sobrecarregado</span></div>
          <div class="ov-l">pendências ativas com ${escapeHtml(_ovOverTop.name)}${_ovOverExtra ? ` +${_ovOverExtra}` : ''}</div>` : `
          <div class="ov-n">${_ovNeutralCount}</div>
          <div class="ov-l">${escapeHtml(_ovNeutralLabel)}</div>`}
        </div>
      </div>
    </section>` : ''}

    ${(_dashCanManage && !_dashIsHidden('reuniao')) ? `
    <section class="card dash-widget ov-panel ov-meet" aria-labelledby="ov-reuniao">
      ${_dashHideBtn('reuniao')}
      <div class="ov-meet-main">
        <div class="ov-meet-title-row">
          <h2 class="ov-h2" id="ov-reuniao">Reunião mensal — ${escapeHtml(_meetingLabel)}</h2>${_nextMeeting ? `<span class="ov-chip">${escapeHtml(_nextMeeting.status || '—')}</span>` : ''}
        </div>
        ${_nextMeeting
        ? `<div class="ov-stats"><span><b>${activePens.length}</b> pendências abertas aguardando revisão</span><span><b>${allClients.length}</b> clientes no escopo</span></div>`
        : `<p class="ov-muted">Nenhuma reunião encontrada no escopo. Acesse o módulo para criar.</p>`}
      </div>
      <div class="dash-export-btns ov-acts ov-meet-acts">
        <button type="button" class="btn btn-secondary btn-sm ov-btn" onclick="dashGoPresentation()">
          <svg class="ov-ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/></svg>
          Apresentar</button>
        <button type="button" class="btn btn-primary btn-sm ov-btn" onclick="navigateTo('reuniao')">${_nextMeeting && _nextMeeting.status === 'aberta' ? 'Continuar Reunião' : 'Iniciar/Continuar Reunião'}</button>
      </div>
    </section>` : ''}

    ${(_dashCanManage && !_dashIsHidden('afastados') && _onLeaveWithCount.length) ? `
    <div class="card dash-widget" style="margin-bottom:18px;border-left:4px solid #d97706">
      ${_dashHideBtn('afastados')}
      <div class="section-header"><span class="section-title">Operadores afastados</span></div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${_onLeaveWithCount.map(o => `
          <div style="display:flex;align-items:center;gap:10px;padding:10px;border-radius:8px;background:var(--bg-secondary)">
            <span style="font-size:13px;flex:1"><strong>${escapeHtml(o.name)}</strong> está afastado — ${o.count} pendência(s) aguardando reatribuição</span>
            <button class="btn btn-secondary btn-sm" onclick="dashGoToPendenciasByOperator('${escapeHtml(o.name)}')">Ver pendências →</button>
          </div>`).join('')}
      </div>
    </div>` : ''}

    <div class="ov-grid">
      ${!_dashIsHidden('riscos') ? `
      <section class="card dash-widget ov-panel" aria-labelledby="ov-risco">
        ${_dashHideBtn('riscos')}
        <div class="ov-ph"><h2 class="ov-h2" id="ov-risco">Clientes em risco</h2><span class="ov-sub">Pontuação de saúde</span></div>
        <div class="ov-risk-head" aria-hidden="true"><span>Cliente</span><span></span><span class="ov-num-h">Abertas</span><span class="ov-num-h">Vencidas</span></div>
        ${_risk.length ? _risk.map(r => {
          const _lvl = (r.health && r.health.level === 'yellow') ? 'amber' : (r.health && r.health.level === 'green') ? 'green' : 'red';
          const _lbl = _ovRiskLabel[r.health && r.health.level] || (r.health && r.health.label) || '—';
          const _pct = (r.health && r.health.totalAbertas) ? Math.min(100, Math.round((r.health.vencidas / r.health.totalAbertas) * 100)) : 0;
          return `
          <div class="ov-row" onclick="viewClient('${escapeHtml(r.clientId)}')">
            <div class="ov-client"><div class="ov-name">${escapeHtml(r.clientName)}</div><div class="ov-st ov-${_lvl}">${escapeHtml(_lbl)}</div></div>
            <div class="ov-track ov-${_lvl}" aria-hidden="true"><i style="width:${_pct}%"></i></div>
            <div class="ov-num">${r.health.totalAbertas}</div>
            <div class="ov-num${r.health.vencidas > 0 ? ` ov-${_lvl} is-over` : ''}">${r.health.vencidas}</div>
          </div>`;
        }).join('') : `<p class="ov-empty">Sem risco mapeado.</p>`}
      </section>` : ''}
      ${!_dashIsHidden('silencio') ? `
      <section class="card dash-widget ov-panel" aria-labelledby="ov-silencio">
        ${_dashHideBtn('silencio')}
        <div class="ov-ph"><h2 class="ov-h2" id="ov-silencio">Silêncio do cliente</h2><span class="ov-sub">Mais de 30 dias</span></div>
        ${_silent.length ? _silent.map(s => `
          <div class="ov-li" onclick="viewClient('${escapeHtml(s.clientId)}')">
            <span class="ov-av" aria-hidden="true">${escapeHtml(_ovInitials(s.clientName))}</span>
            <span class="ov-name">${escapeHtml(s.clientName)}</span>
            <small>${s.daysSince >= 9999 ? 'Sem contato registrado' : `há ${s.daysSince} dias`}</small>
          </div>`).join('') : `<p class="ov-empty">Todos os clientes ativos recentemente.</p>`}
      </section>` : ''}
      ${!_dashIsHidden('recorrentes') ? `
      <section class="card dash-widget ov-panel" aria-labelledby="ov-rec">
        ${_dashHideBtn('recorrentes')}
        <div class="ov-ph"><h2 class="ov-h2" id="ov-rec">Pendência recorrente</h2><span class="ov-sub">Top 5</span></div>
        ${_recurrent.length ? _recurrent.map(r => `
          <div class="ov-li" onclick="viewClient('${escapeHtml(r.clientId)}')">
            <span class="ov-name">${escapeHtml(r.clientName)}</span>
            <small>${r.streak} meses seguidos</small>
          </div>`).join('') : `<p class="ov-empty">Nenhum cliente recorrente.</p>`}
      </section>` : ''}
      ${!_dashIsHidden('aniversarios') ? `
      <section class="card dash-widget ov-panel" aria-labelledby="ov-aniv">
        ${_dashHideBtn('aniversarios')}
        <div class="ov-ph"><h2 class="ov-h2" id="ov-aniv">Aniversários de clientes</h2><span class="ov-sub">Mês atual</span></div>
        ${_anniv.length ? _anniv.map(a => `
          <div class="ov-li" onclick="viewClient('${escapeHtml(a.clientId)}')">
            <span class="ov-name">${escapeHtml(a.clientName)}</span>
            <small>${a.years} ${a.years === 1 ? 'ano' : 'anos'}</small>
          </div>`).join('') : `<p class="ov-empty">Nenhum aniversário neste mês.</p>`}
      </section>` : ''}
    </div>

    <h2 class="ov-sec-t" id="ov-ind">Indicadores</h2>
    
    ${!_dashIsHidden('stats') ? `<section class="dash-widget ov-kpis" aria-label="Resumo de indicadores" style="position:relative">${_dashHideBtn('stats')}` : '<div style="display:none"><div>'}
      <div class="ov-k" onclick="navigateTo('clientes')">
        <b class="stat-value">${clients.length}</b><span>Clientes${_dashPeriod!=='all'?' (período)':''}</span>
      </div>
      <div class="ov-k" onclick="navigateTo('visitas')">
        <b class="stat-value">${visits.length}</b><span>Visitas${_dashPeriod!=='all'?' (período)':''}</span>
      </div>
      <div class="ov-k ov-k-static">
        <b class="stat-value">${avgSlaHours}h</b><span>SLA médio${_dashPeriod!=='all'?' (período)':''} ${_deltaSla ? _dashDeltaBadge(_deltaSla) : ''}</span>
      </div>
      <div class="ov-k ov-k-static">
        <b class="stat-value">${completionRate}%</b><span>Taxa de conclusão ${_deltaComp ? _dashDeltaBadge(_deltaComp) : ''}</span>
      </div>
      <div class="ov-k" onclick="navigateTo('pendencias')">
        <b class="stat-value">${open.length + inProg.length + paused.length}</b><span>Pendências abertas${_dashPeriod!=='all'?' (período)':''} ${_deltaOpen ? _dashDeltaBadge(_deltaOpen) : ''}</span>
      </div>
      <div class="ov-k amber" onclick="navigateTo('pendencias')">
        <b class="stat-value">${critical.length}</b><span>Alta prioridade${_dashPeriod!=='all'?' (período)':''}</span>
      </div>
      <div class="ov-k red" onclick="navigateTo('pendencias')">
        <b class="stat-value">${overdue.length}</b><span>Pendências vencidas</span>
      </div>
      <div class="ov-k amber" onclick="navigateTo('pendencias')">
        <b class="stat-value">${dueToday.length}</b><span>Vencem hoje</span>
      </div>
      ${_dashCanManage ? `<div class="ov-k" onclick="navigateTo('pendencias')">
        <b class="stat-value">${unassigned.length}</b><span>Sem responsável</span>
      </div>` : ''}
    ${!_dashIsHidden('stats') ? `</section>` : '</div></div>'}

    <div class="ov-g ov-g-a">
    ${(_dashCanManage && !_dashIsHidden('evolucao')) ? `
    <section class="card dash-widget ov-panel" aria-labelledby="ov-evo">
      ${_dashHideBtn('evolucao')}
      <div class="ov-ph"><h2 class="ov-h2" id="ov-evo">Evolução de clientes</h2><span class="ov-chip">${escapeHtml(periodLabel)}</span></div>
      <div class="ov-fig">
        <div><b>${allClients.length}</b><span>Total cadastrados</span></div>
        <div><b>${clients.length}</b><span>No período</span></div>
        <div><b>${allClients.filter(c => c.status === 'ativo').length}</b><span>Ativos</span></div>
        <div><b>${opsAtivos}</b><span>Técnicos ativos</span></div>
      </div>
    </section>` : ''}

    ${(_dashCanManage && !_dashIsHidden('workload')) ? `
    <section class="card dash-widget ov-panel" aria-labelledby="ov-op">
      ${_dashHideBtn('workload')}
      <div class="ov-ph"><h2 class="ov-h2" id="ov-op">Carga por operador</h2>
        <select id="workloadPeriod" class="form-select ov-sel" style="width:160px" aria-label="Período da carga por operador" onchange="setWorkloadPeriod(this.value)">
          <option value="all" ${(_dashWorkloadPeriod||'all')==='all'?'selected':''}>Todo período</option>
          <option value="week" ${(_dashWorkloadPeriod||'all')==='week'?'selected':''}>Semana atual</option>
          <option value="month" ${(_dashWorkloadPeriod||'all')==='month'?'selected':''}>Mês atual</option>
        </select>
      </div>
      <div class="ov-sub" style="margin-top:-6px">Horas em pendências</div>
      <div id="workloadList" style="padding:12px 0 0"></div>
    </section>` : ''}
    </div>
    ${!_dashIsHidden('charts') ? `
    <div class="dash-widget" style="position:relative">
      ${_dashHideBtn('charts')}
      <div class="ov-g ov-g-b">
      <section class="card dash-widget ov-panel" aria-labelledby="ov-pri" style="display:flex;flex-direction:column">
        <div class="ov-ph"><h2 class="ov-h2" id="ov-pri">Distribuição por prioridade</h2></div>
        <div class="ov-cv"><canvas id="chartPriority"></canvas></div>
      </section>
      ${_dashCanManage ? `<section class="card dash-widget ov-panel" aria-labelledby="ov-car" style="display:flex;flex-direction:column">
        <div class="ov-ph"><h2 class="ov-h2" id="ov-car">Carga de trabalho por técnico</h2></div>
        <div class="ov-cv"><canvas id="chartWorkload"></canvas></div>
      </section>` : ''}
      </div>
      <div class="ov-g ov-g-c" style="margin-top:16px">
      <section class="card dash-widget ov-panel" aria-labelledby="ov-ev6" style="display:flex;flex-direction:column">
        <div class="ov-ph"><h2 class="ov-h2" id="ov-ev6">Evolução dos últimos 6 meses</h2></div>
        <div class="ov-cv"><canvas id="chartEvolution"></canvas></div>
      </section>
      ${_dashCanManage ? `<section class="card dash-widget ov-panel" aria-labelledby="ov-rk" style="display:flex;flex-direction:column">
        <div class="ov-ph"><h2 class="ov-h2" id="ov-rk">Ranking de produtividade</h2><span class="ov-sub">Resolvidos</span></div>
        <div class="ov-cv"><canvas id="chartRanking"></canvas></div>
      </section>` : ''}
      </div>
    </div>` : '<div class="dashboard-charts-grid" style="display:none"><div class="card"><canvas id="chartPriority"></canvas></div><div class="card"><canvas id="chartWorkload"></canvas></div><div class="card"><canvas id="chartEvolution"></canvas></div><div class="card"><canvas id="chartRanking"></canvas></div></div>'}

    <h2 class="ov-sec-t" id="ov-meudia">Meu dia</h2>
    ${!_dashIsHidden('fila') ? `
    <section class="card dash-widget ov-panel ov-focus" aria-labelledby="ov-fila">
      ${_dashHideBtn('fila')}
      <div class="ov-ph"><h2 class="ov-h2" id="ov-fila">Minha fila do dia</h2><span class="ov-sub">${myQueue.length + myTodayVisits.length} ${myQueue.length + myTodayVisits.length===1?'item':'itens'}</span></div>
      ${myQueue.length + myTodayVisits.length ? `<ul class="ov-ls">` + myTodayVisits.map(function(v){
        const c = typeof getClientById === 'function' ? getClientById(v.clientId) : null;
        const timeLabel = (v.allDay || !v.time) ? 'Dia inteiro' : escapeHtml(v.time + (v.timeEnd ? ' – ' + v.timeEnd : ''));
        const vstTag = typeof visitStatusTag === 'function' ? visitStatusTag(v.status) : '';
        return `<li class="ov-it" onclick="openVisitDetail('${v.id}')">
          ${c ? clientAvatar(c, 34) : `<span class="ov-av" aria-hidden="true">${escapeHtml(_ovInitials(v.clientName))}</span>`}
          <div style="min-width:0">
            <div class="ov-tt">${escapeHtml(v.clientName)||'—'}</div>
            <div class="ov-mt"><span>${escapeHtml(v.motivo)||'Visita'}</span><span>${timeLabel}</span></div>
          </div>
          <div>${vstTag}</div>
        </li>`;
      }).join('') + myQueue.slice(0,Math.max(0,8-myTodayVisits.length)).map(function(p){
        const c = typeof getClientById === 'function' ? getClientById(p.clientId) : null;
        const _isClosedQ = typeof isPendenciaClosed === 'function' ? isPendenciaClosed : function(s){ return ['concluido','resolvido','cancelado','fechado'].includes(s || ''); };
        const isOverdue = p.deadline && p.deadline < today && !_isClosedQ(p.status);
        const isStale = typeof isStalePendencia === 'function' ? isStalePendencia(p) : false;
        const priTag = typeof priorityTag === 'function' ? priorityTag(p.priority) : '';
        const stTag = typeof statusTag === 'function' ? statusTag(p.status) : '';
        return `<li class="ov-it" onclick="navigateTo('pendencias');setTimeout(function(){ openPendenciaDetail('${p.id}'); },100)">
          ${c ? clientAvatar(c, 34) : `<span class="ov-av" aria-hidden="true">${escapeHtml(_ovInitials(p.clientName))}</span>`}
          <div style="min-width:0">
            <div class="ov-tt">${escapeHtml(getPendenciaTitulo(p))}</div>
            <div class="ov-mt"><span>${escapeHtml(p.clientName)||'—'}</span>${priTag}${p.deadline ? `<span>${escapeHtml(formatDate(parseDeadline(p.deadline)))}</span>` : ''}${isOverdue ? `<span class="ov-warn"><svg class="ov-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l9 16H3zM12 10v4M12 17.5v.01"/></svg>Vencida</span>` : ''}${isStale && !isOverdue ? '<span>Parada</span>' : ''}</div>
          </div>
          <div>${stTag}</div>
        </li>`;
      }).join('') + `</ul>` + (myQueue.length>Math.max(0,8-myTodayVisits.length)?`<div style="text-align:center;margin-top:8px"><button type="button" class="btn btn-secondary btn-sm ov-btn" onclick="navigateTo('pendencias')">Ver todas (${myQueue.length})<svg class="ov-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-5-5l5 5-5 5"/></svg></button></div>`:'') : `<p class="ov-empty">Nenhum item urgente.</p>`}
    </section>` : ''}

    <div class="ov-g-day">
      <div class="ov-col">
        ${!_dashIsHidden('recentes') ? `
        <section class="card dash-widget ov-panel" aria-labelledby="ov-rec2">
          ${_dashHideBtn('recentes')}
          <div class="ov-ph"><h2 class="ov-h2" id="ov-rec2">Minhas pendências recentes</h2><button type="button" class="btn btn-secondary btn-sm ov-btn" onclick="navigateTo('pendencias')">Ver todas<svg class="ov-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-5-5l5 5-5 5"/></svg></button></div>
          ${recentPens.length ? `<ul class="ov-ls">
            ${recentPens.map(p => {
              const c = getClientById(p.clientId);
               const _isClosedR = typeof isPendenciaClosed === 'function' ? isPendenciaClosed : function(s){ return ['concluido','resolvido','cancelado','fechado'].includes(s || ''); };
               const isOverdue = p.deadline && p.deadline < localDateISO() && !_isClosedR(p.status);
              return `<li class="ov-it" onclick="navigateTo('pendencias');setTimeout(()=>openPendenciaDetail('${p.id}'),100)">
                ${c ? clientAvatar(c, 34) : `<span class="ov-av" aria-hidden="true">${escapeHtml(_ovInitials(p.clientName))}</span>`}
                <div style="min-width:0">
                  <div class="ov-tt">${escapeHtml(getPendenciaTitulo(p))}</div>
                  <div class="ov-mt"><span>${escapeHtml(p.clientName)||'—'}</span><span>${escapeHtml(p.responsible)||'—'}</span>${isOverdue ? `<span class="ov-warn"><svg class="ov-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l9 16H3zM12 10v4M12 17.5v.01"/></svg>Vencida</span>` : ''}</div>
                </div>
                <div>${statusTag(p.status)}</div>
              </li>`;
            }).join('')}
          </ul>` : `<p class="ov-empty">Nenhuma pendência ativa.</p>`}
        </section>` : ''}

        ${!_dashIsHidden('visitas') ? `
        <section class="card dash-widget ov-panel" aria-labelledby="ov-vis">
          ${_dashHideBtn('visitas')}
          <div class="ov-ph"><h2 class="ov-h2" id="ov-vis">Próximas visitas</h2><button type="button" class="btn btn-secondary btn-sm ov-btn" onclick="navigateTo('visitas')">Ver todas<svg class="ov-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-5-5l5 5-5 5"/></svg></button></div>
          ${upcomingVisits.length ? `<ul class="ov-ls">
            ${upcomingVisits.map(v => {
              const c = getClientById(v.clientId);
              const isToday = v.date === today;
              return `<li class="ov-it" onclick="navigateTo('visitas');setTimeout(()=>openVisitDetail('${v.id}'),100)">
                ${c ? clientAvatar(c, 34) : `<span class="ov-av" aria-hidden="true">${escapeHtml(_ovInitials(v.clientName))}</span>`}
                <div style="min-width:0">
                  <div class="ov-tt">${escapeHtml(v.motivo)||'(sem motivo)'}</div>
                  <div class="ov-mt"><span>${escapeHtml(v.clientName)||'—'}</span><span>${escapeHtml(v.operator)||'—'}</span></div>
                </div>
                <div class="ov-when">
                  <small>${(typeof formatVisitNumero === 'function') ? escapeHtml(formatVisitNumero(v)) : ''}</small>
                  <span><b style="${isToday?'color:var(--ov-cyan)':''}">${formatDate(v.date)}</b>${(v.allDay || v.time || v.timeEnd) ? ' <small>' + escapeHtml(formatVisitTimeRange(v)) + '</small>' : ''}</span>
                  <span class="ov-pill" style="--c:${(typeof VISIT_STATUS_MAP!=='undefined'&&VISIT_STATUS_MAP[v.status])?VISIT_STATUS_MAP[v.status].color:'#94a3b8'}">${(typeof VISIT_STATUS_MAP!=='undefined'&&VISIT_STATUS_MAP[v.status])?escapeHtml(VISIT_STATUS_MAP[v.status].label):escapeHtml(v.status||'—')}</span>
                </div>
              </li>`;
            }).join('')}
          </ul>` : `<p class="ov-empty">Nenhuma visita agendada.</p>`}
        </section>` : ''}
      </div>

      <div class="ov-col">
        <section class="card ov-panel" aria-labelledby="ov-acoes">
          <div class="ov-ph"><h2 class="ov-h2" id="ov-acoes">Ações rápidas</h2>${_dashCanManage ? `<button type="button" class="btn btn-secondary btn-sm ov-btn" onclick="dashGoPresentation()"><svg class="ov-i" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/></svg>Apresentar reunião</button>` : ''}</div>
          <div class="ov-acts-big">
            ${(typeof isCurrentAdmin === 'function' && isCurrentAdmin()) ? `<button type="button" class="btn btn-primary ov-btn ov-big" onclick="navigateTo('clientes');setTimeout(()=>openClientForm(),100)"><svg class="ov-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Novo cliente</button>` : ''}
            <button type="button" class="btn btn-secondary ov-btn ov-big" onclick="navigateTo('pendencias');setTimeout(()=>openPendenciaForm(),100)"><svg class="ov-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Nova pendência</button>
            <button type="button" class="btn btn-secondary ov-btn ov-big" onclick="navigateTo('visitas');setTimeout(()=>openVisitForm(),100)"><svg class="ov-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Nova visita</button>
          </div>
        </section>
      </div>
    </div>
    </div>`;

  // ── Carga por operador (timer.js) ──
  (function(){
    const wlEl = document.getElementById('workloadList');
    if (!wlEl) return;
    const getPeriodFilter = () => {
      if (_dashWorkloadPeriod === 'week') {
        const today = _brasiliaNow();
        const start = new Date(today); start.setDate(today.getDate() - today.getDay() + 1);
        const end = new Date(start); end.setDate(start.getDate()+6);
        return p => { const d=_parseItemDate(p); return d>=start && d<=end; };
      }
      if (_dashWorkloadPeriod === 'month') {
        const today=_brasiliaNow();
        const s=new Date(today.getFullYear(), today.getMonth(),1);
        const e=new Date(today.getFullYear(), today.getMonth()+1,0);
        return p => { const d=_parseItemDate(p); return d>=s && d<=e; };
      }
      return null;
    };
    const filterFn = getPeriodFilter();
    const workloadMap = typeof getWorkloadInPeriod === 'function' ? getWorkloadInPeriod(allPens, getElapsedSeconds, filterFn) : {};
    const entries = Object.entries(workloadMap).sort((a,b)=>b[1]-a[1]);
    if (!entries.length) wlEl.innerHTML = '<p class="ov-empty">Sem horas registradas no período.</p>';
    else {
      const _max = Math.max.apply(null, entries.map((e) => e[1])) || 1;
      wlEl.innerHTML = entries.map(([op, secs]) => {
        const h=(secs/3600).toFixed(1);
        const _pct = Math.max(4, Math.round((secs / _max) * 100));
        return `<div class="ov-hb"><span class="n">${escapeHtml(op)}</span><div class="ov-bt"><i style="--w:${_pct}%"></i></div><span class="ov-v">${h}h</span></div>`;
      }).join('');
    }
  })();
  
  setTimeout(() => renderCharts(pens, visits), 50);
  animateDashboardCounters();
}

function animateDashboardCounters() {
  if (typeof Motion === 'undefined') return;
  document.querySelectorAll('.stat-value').forEach(el => {
    const m = (el.textContent || '').match(/^([\d.,]+)(.*)$/);
    if (!m) return;
    const target = parseFloat(m[1].replace(',', '.'));
    const suffix = m[2] || '';
    if (isNaN(target)) return;
    const isInt = Number.isInteger(target);
    Motion.animate(0, target, {
      duration: 0.8,
      ease: 'easeOut',
      onUpdate: v => { el.textContent = (isInt ? Math.round(v) : v.toFixed(1)) + suffix; }
    });
  });
}

function renderCharts(pens, visits) {
  const _alive = (inst) => inst && document.body.contains(inst.canvas);

  const isDark = document.body.classList.contains('dark-theme');
  const textColor = isDark ? '#cbd5e1' : '#4b5563';
  const gridColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)';

  loadChartJs().then(() => {
    if (window.Chart) {
      Chart.defaults.color = textColor;
      Chart.defaults.font.family = "'Inter', sans-serif";
    } else return;

  const activeItems = pens.filter(p => !isPendenciaClosed(p.status));
  const pCount = {baixa:0, media:0, alta:0, critica:0};
  activeItems.forEach(i => { if(pCount[i.priority] !== undefined) pCount[i.priority]++; else pCount.media++; });
  
  const ctx1 = document.getElementById('chartPriority');
  if (ctx1) {
    const newData = [pCount.baixa, pCount.media, pCount.alta, pCount.critica];
    if (_alive(window._dashChart1)) {
      window._dashChart1.data.datasets[0].data = newData;
      window._dashChart1.data.datasets[0].borderColor = isDark ? '#1e293b' : '#ffffff';
      window._dashChart1.update();
    } else {
      if (window._dashChart1) window._dashChart1.destroy();
      window._dashChart1 = new Chart(ctx1, {
        type: 'doughnut',
        data: {
          labels: ['Baixa', 'Média', 'Alta', 'Crítica'],
          datasets: [{
            data: newData,
            backgroundColor: ['#16a34a', '#d97706', '#dc2626', '#991b1b'],
            borderWidth: 2,
            borderColor: isDark ? '#1e293b' : '#ffffff'
          }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
      });
    }
  }

  const ops = typeof getOperators === 'function' ? getOperators() : [];
  const techMap = {};
  const visitMap = {};
  ops.forEach(o => { techMap[o.name] = 0; visitMap[o.name] = 0; });
  pens.filter(p => !isPendenciaClosed(p.status)).forEach(p => {
    if (techMap[p.responsible] !== undefined) techMap[p.responsible]++;
  });
  (visits || []).filter(v => v.status !== 'cancelada' && v.status !== 'concluida').forEach(v => {
    if (visitMap[v.operator] !== undefined) visitMap[v.operator]++;
  });

  const labels = Object.keys(techMap);
  const dataPens = labels.map(l => techMap[l]);
  const dataVisits = labels.map(l => visitMap[l]);

  const ctx2 = document.getElementById('chartWorkload');
  if (ctx2) {
    if (_alive(window._dashChart2)) {
      window._dashChart2.data.labels = labels;
      window._dashChart2.data.datasets[0].data = dataPens;
      window._dashChart2.data.datasets[1].data = dataVisits;
      window._dashChart2.update();
    } else {
      if (window._dashChart2) window._dashChart2.destroy();
      window._dashChart2 = new Chart(ctx2, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [
            { label: 'Pendências ativas', data: dataPens, backgroundColor: '#3b82f6' },
            { label: 'Visitas (a fazer)',  data: dataVisits, backgroundColor: '#0ea5e9' }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: {
            x: { grid: { display: false } },
            y: { grid: { color: gridColor }, beginAtZero: true, ticks: { stepSize: 1 } }
          }
        }
      });
    }
  }

  // 4. Chart Evolution (Monthly trend for last 6 months)
  const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`, label: `${monthNames[d.getMonth()]}/${String(d.getFullYear()).slice(2)}` });
  }

  const openedByMonth = months.map(m => pens.filter(p => p.createdAt && p.createdAt.slice(0,7) === m.key).length);
  const resolvedByMonth = months.map(m => pens.filter(p => isPendenciaResolvida(p.status) && p.updatedAt && p.updatedAt.slice(0,7) === m.key).length);

  const ctx4 = document.getElementById('chartEvolution');
  if (ctx4) {
    if (_alive(window._dashChart4)) {
      window._dashChart4.data.datasets[0].data = openedByMonth;
      window._dashChart4.data.datasets[1].data = resolvedByMonth;
      window._dashChart4.update();
    } else {
      if (window._dashChart4) window._dashChart4.destroy();
      window._dashChart4 = new Chart(ctx4, {
        type: 'line',
        data: {
          labels: months.map(m => m.label),
          datasets: [
            { label: 'Abertos', data: openedByMonth, borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)', fill: true, tension: 0.3 },
            { label: 'Resolvidos', data: resolvedByMonth, borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.1)', fill: true, tension: 0.3 }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom' } },
          scales: {
            x: { grid: { display: false } },
            y: { grid: { color: gridColor }, beginAtZero: true, ticks: { stepSize: 1 } }
          }
        }
      });
    }
  }

  // 5. Chart Ranking (Operator productivity - resolved count)
  const rankMap = {};
  ops.forEach(o => rankMap[o.name] = 0);
  pens.filter(p => isPendenciaResolvida(p.status)).forEach(p => { if (rankMap[p.responsible] !== undefined) rankMap[p.responsible]++; });

  const rankSorted = Object.entries(rankMap).sort((a,b) => b[1] - a[1]);
  const ctx5 = document.getElementById('chartRanking');
  if (ctx5) {
    const newLabels = rankSorted.map(r => r[0]);
    const newData = rankSorted.map(r => r[1]);
    if (_alive(window._dashChart5)) {
      window._dashChart5.data.labels = newLabels;
      window._dashChart5.data.datasets[0].data = newData;
      window._dashChart5.update();
    } else {
      if (window._dashChart5) window._dashChart5.destroy();
      window._dashChart5 = new Chart(ctx5, {
        type: 'bar',
        data: {
          labels: newLabels,
          datasets: [{
            label: 'Resolvidos',
            data: newData,
            backgroundColor: '#10b981',
            borderRadius: 4
          }]
        },
        options: {
          indexAxis: 'y',
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { color: gridColor }, beginAtZero: true, ticks: { stepSize: 1 } },
            y: { grid: { display: false } }
          }
        }
      });
    }
  }
  });
}

// ── Badges ─────────────────────────────────────────────────────────────────────
function updateBadges() {
  var session = getSession();
  var currentUser = session ? session.name : '';
  var pens = isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam ? getPendenciasByTeam(_selectedTeam) : getMyPendencias();
  var open = pens.filter(function(p) { return !isPendenciaClosed(p.status) && p.responsible === currentUser; }).length;
  var badge = document.getElementById('badge-pendencias');
  if (badge) { badge.textContent = open; badge.classList.toggle('hidden', open === 0); }

  var visits = isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam ? getVisitsByTeam(_selectedTeam) : getMyVisits();
  var today = localDateISO();
  var upcoming = visits.filter(function(v) { return v.date >= today && (v.status === 'agendada' || v.status === 'em_andamento'); }).length;
  var vbadge = document.getElementById('badge-visitas');
  if (vbadge) { vbadge.textContent = upcoming; vbadge.classList.toggle('hidden', upcoming === 0); }

  try {
    var equips = (typeof getMyEquipamentos === 'function') ? getMyEquipamentos()
      : (typeof getEquipamentos === 'function' ? getEquipamentos() : []);
    if (isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam && typeof getEquipamentosByTeam === 'function') {
      equips = getEquipamentosByTeam(_selectedTeam);
    }
    var inMaint = equips.filter(function(eq) { return eq && eq.status === 'em_manutencao'; }).length;
    var ebadge = document.getElementById('badge-equipamentos');
    if (ebadge) { ebadge.textContent = inMaint; ebadge.classList.toggle('hidden', inMaint === 0); }
  } catch (_) {}

  // badge-chamados removido (módulo descontinuado na interface)
}

function openHoursReport() {
  if (typeof canExport === 'function' && !canExport()) {
    if (typeof showToast === 'function') showToast('Relatório restrito a administradores/supervisores.', 'error');
    return;
  }
  const pens = isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam ? getPendenciasByTeam(_selectedTeam) : getMyPendencias();
  const clientMap = {};
  const opMap = {};
  let total = 0;
  pens.forEach(p => {
    const secs = (typeof getElapsedSeconds === 'function') ? getElapsedSeconds(p) : (p.timerTotalSeconds || 0);
    const h = secs / 3600;
    if (h <= 0) return;
    total += h;
    const ck = p.clientName || p.clientId || 'Sem cliente';
    clientMap[ck] = (clientMap[ck] || 0) + h;
    const ok = p.responsible || 'Sem responsável';
    opMap[ok] = (opMap[ok] || 0) + h;
  });
  const fmt = h => h.toFixed(1) + 'h';
  const rows = map => Object.entries(map).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td style="text-align:right;font-weight:600">${fmt(v)}</td></tr>`).join('') || '<tr><td colspan="2" style="color:var(--text-muted)">Sem registros</td></tr>';
  openModal('Horas trabalhadas', `
    <p style="font-size:13px;color:var(--text-muted);margin:0 0 14px">Total acumulado: <strong style="color:var(--text-primary)">${fmt(total)}</strong> (timers de pendências)</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px" class="hours-report-grid">
      <div>
        <h4 style="margin:0 0 8px;font-size:13px;font-weight:700">Por cliente</h4>
        <div class="table-wrapper"><table><thead><tr><th>Cliente</th><th style="text-align:right">Horas</th></tr></thead><tbody>${rows(clientMap)}</tbody></table></div>
      </div>
      <div>
        <h4 style="margin:0 0 8px;font-size:13px;font-weight:700">Por operador</h4>
        <div class="table-wrapper"><table><thead><tr><th>Operador</th><th style="text-align:right">Horas</th></tr></thead><tbody>${rows(opMap)}</tbody></table></div>
      </div>
    </div>
  `, 'lg');
}

function updateDashboardBadge() { updateBadges(); }

function topbarAction() {
  if (typeof window._topbarAction === 'function') window._topbarAction();
}

function refreshPage() {
  const hash = window.location.hash.replace('#', '') || 'dashboard';
  navigateTo(hash);
}

// ── Login / Logout ─────────────────────────────────────────────────────────────
let _appStarted = false;

function _startApp() {
  if (typeof getCacheKV === 'function') {
    _selectedTeam = getCacheKV('intra_selected_team', '');
  }
  initTeamSelector();
  updateUserUI();
  updateBadges();

  if (typeof initSupabaseRealtime === 'function') {
    try { initSupabaseRealtime(); } catch (_) {}
  }

  var isAdmin = typeof isCurrentAdmin === 'function' && isCurrentAdmin();
  if (!isAdmin) {
    // Dashboard visível p/ todos (blocos de gestão filtrados no render);
    // histórico segue restrito.
    var histNav = document.getElementById('nav-historico');
    if (histNav) histNav.style.display = 'none';
  }
  // Mapeamento Milvus × Clientes oculto para todos (decisão de produto):
  // a rota segue funcional via #mapeamento-milvus, só sai do menu.
  var mapNav = document.getElementById('nav-mapeamento-milvus');
  if (mapNav) mapNav.style.display = 'none';
  if (typeof updateRelatoriosVisibility === 'function') updateRelatoriosVisibility();
  document.querySelectorAll('.btn-export').forEach(function (btn) {
    btn.style.display = isAdmin ? '' : 'none';
  });

  const hash  = window.location.hash.replace('#','');
  const pages = ['dashboard','clientes','pendencias','calendario','operadores','relatorios','equipamentos','mapeamento-milvus','historico','templates','visitas','reuniao'];
  // Números amigáveis antes da primeira pintura (local, sem rede): evita
  // "#----" transitório no boot e garante backfill mesmo se o sync atrasar.
  try { if (typeof maintainVisitNumeros === 'function') maintainVisitNumeros(); } catch (_) {}
  navigateTo(pages.includes(hash) ? hash : 'dashboard');
  // Offline-first: a UI já montou a partir do banco local; a sincronização
  // automática roda agora em segundo plano, sem bloquear (toda falha de rede
  // vira fallback local + retry — ver triggerStartupSync em storage.js).
  try { if (typeof triggerStartupSync === 'function') triggerStartupSync('app-start'); } catch (_) {}
  if (!_appStarted) {
    _appStarted = true;
    window.addEventListener('hashchange', () => {
      const p = window.location.hash.replace('#','');
      if (pages.includes(p)) navigateTo(p);
    });
  }
}

function forgotPassword() {
  const email = document.getElementById('loginEmail')?.value?.trim();
  if (!email) {
    alert('Digite seu e-mail no campo acima para receber o link de redefinição.');
    return;
  }
  if (typeof isSupabaseConnected !== 'function' || !isSupabaseConnected()) {
    alert('Serviço temporariamente indisponível. Tente novamente mais tarde.');
    return;
  }
  authResetPassword(email)
    .then(() => {
      alert('Se o e-mail estiver cadastrado, você receberá um link de redefinição.\nVerifique a caixa de entrada e o spam.');
    })
    .catch(() => {
      alert('Não foi possível enviar o e-mail agora. Tente novamente ou contate um administrador.');
    });
}

function showLoginScreen() {
  const overlay = document.getElementById('loginOverlay');
  const content = document.getElementById('loginContent');
  overlay.style.display = 'block';

  const serverOk = typeof isSupabaseConnected === 'function' && isSupabaseConnected();

  content.innerHTML = `
    <div class="login-header">
      <div class="login-logo">
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
          <text x="50%" y="54%" dominant-baseline="central" text-anchor="middle" fill="#fff" font-family="Inter,sans-serif" font-weight="800" font-size="22">I</text>
        </svg>
      </div>
      <div class="login-title">Init Intra</div>
      <div class="login-subtitle">Acesso restrito — identifique-se</div>
    </div>

    <div class="login-form-wrap">
      <div class="login-card">
        ${!serverOk ? `<div class="login-error" style="margin-bottom:12px;text-align:center">Serviço de autenticação indisponível.<br><span style="font-size:11px;opacity:0.8">Verifique sua conexão ou contate o suporte.</span></div>` : ''}

        <div class="login-field">
          <label class="login-label">E-mail</label>
          <input type="email" id="loginEmail" class="login-input" autocomplete="email"
            placeholder="seu.email@empresa.com" ${!serverOk ? 'disabled' : ''}
            onkeydown="if(event.key==='Enter'){event.preventDefault();document.getElementById('loginPassword').focus()}" />
        </div>

        <div class="login-field">
          <div class="login-label-row">
            <label class="login-label">Senha</label>
            <button type="button" class="login-forgot" onclick="forgotPassword()" ${!serverOk ? 'disabled' : ''}>Esqueci minha senha</button>
          </div>
          <input type="password" id="loginPassword" class="login-input" autocomplete="current-password"
            placeholder="Digite sua senha..." ${!serverOk ? 'disabled' : ''}
            onkeydown="if(event.key==='Enter')doLogin()" />
        </div>

        <div id="loginError" class="login-error"></div>

        <button id="loginBtn" class="login-btn" onclick="doLogin()" ${!serverOk ? 'disabled' : ''}>
          Entrar →
        </button>
      </div>
      <p class="login-footer">
        Init Intra · Sistema Interno · ${new Date().getFullYear()}
      </p>
    </div>
  `;

  setTimeout(() => document.getElementById('loginEmail')?.focus(), 100);
}

async function doLogin() {
  const email    = document.getElementById('loginEmail')?.value?.trim() || '';
  const password = document.getElementById('loginPassword')?.value || '';
  const errEl    = document.getElementById('loginError');
  const btn      = document.getElementById('loginBtn');

  if (typeof isSupabaseConnected !== 'function' || !isSupabaseConnected()) {
    if (errEl) errEl.textContent = 'Serviço de autenticação indisponível.';
    return;
  }
  if (!email) {
    if (errEl) errEl.textContent = 'Digite seu e-mail.';
    return;
  }
  if (!password) {
    if (errEl) errEl.textContent = 'Digite sua senha.';
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation:spin 1s linear infinite"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg> Autenticando...';
  }
  if (errEl) errEl.textContent = '';

  try {
    const result = await authSignIn(email, password);
    const op = result.operator;

    addLog('Login', 'Sessão', op.id, op.name);
    document.getElementById('loginOverlay').style.display = 'none';
    _startApp();
    showToast(`Bem-vindo, ${op.name}!`, 'success');

    if ('Notification' in window && Notification.permission === 'default') {
      setTimeout(() => Notification.requestPermission(), 3000);
    }
  } catch (err) {
    var raw = err.message || '';
    var msg = 'Não foi possível entrar. Verifique seus dados e tente novamente.';
    if (raw.includes('Muitas tentativas')) {
      msg = raw;
    } else if (raw.includes('não cadastrado') || raw.includes('desativado') || raw.includes('Contate')) {
      msg = raw;
    } else if (raw.includes('Email not confirmed') || raw.includes('email_not_confirmed')) {
      msg = 'E-mail ainda não confirmado. Verifique sua caixa de entrada.';
    } else if (raw.includes('Invalid login credentials') || raw.includes('invalid_credentials')) {
      msg = 'E-mail ou senha incorretos.';
    } else if (raw.includes('fetch') || raw.includes('network') || raw.includes('Failed to fetch')) {
      msg = 'Sem conexão com o servidor. Verifique sua internet.';
    } else if (raw.includes('Informe')) {
      msg = raw;
    }
    if (errEl) errEl.textContent = msg;
    if (errEl) errEl.style.color = '#f87171';
    const input = document.getElementById('loginPassword');
    if (input) { input.value = ''; input.focus(); }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = 'Entrar →';
    }
  }
}

async function doLogout() {
  try {
    await authSignOut();
  } catch (err) {
    console.warn('Erro no logout:', err);
  }
  // Garantir limpeza total mesmo se authSignOut falhou
  clearSession();
  window._supabaseAuthActive = false;
  // Limpar tokens Supabase do localStorage (safety net adicional)
  try {
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('sb-') && key.endsWith('-auth-token')) {
        localStorage.removeItem(key);
      }
    });
  } catch (_) {}
  showLoginScreen();
}

// ── Boot offline-first: rede no boot nunca bloqueia a UI ──────────────────────
// Leituras de operador no restore de sessão tocam a rede; com backend fora do
// ar elas pendurariam o boot. Com timeout próprio, o app cai para o operador
// local e segue; o sync de fundo (via _startApp) alinha quando voltar.
const BOOT_OP_TIMEOUT_MS = 8000;
function _bootOpWithTimeout(promise, fallback) {
  try {
    if (typeof _withSyncTimeout === 'function') {
      return _withSyncTimeout(promise, BOOT_OP_TIMEOUT_MS, 'boot-operador').then(
        (v) => (v === undefined ? fallback : v),
        () => fallback
      );
    }
  } catch (_) {}
  return Promise.resolve(promise).then(
    (v) => (v === undefined ? fallback : v),
    () => fallback
  );
}

// ── Init ───────────────────────────────────────────────────────────────────────
(async function init() {
  if (typeof _initDBPromise !== 'undefined') {
    try { await _initDBPromise; } catch(e) { console.error('Erro ao inicializar IndexedDB:', e); }
  }

  if (!(typeof isSupabaseConnected === 'function' && isSupabaseConnected())) seedDemoData();

  // Listener de auth sempre registrado (antes do restore)
  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && typeof authOnStateChange === 'function') {
    authOnStateChange((event, supabaseSession) => {
      if (event === 'SIGNED_OUT') {
        clearSession();
        window._supabaseAuthActive = false;
        showLoginScreen();
        return;
      }
      if (event === 'TOKEN_REFRESHED' && supabaseSession?.user) {
        window._supabaseAuthActive = true;
      }
    });
  }

  // Tenta restaurar sessão do Supabase Auth (única fonte de autenticação).
  // Offline-first: getSession() do Auth é leitura local (rápida); já as
  // leituras de operador tocam a rede e têm timeout próprio para nunca
  // bloquear a UI. A sincronização roda DEPOIS, em background via _startApp.
  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected()) {
    try {
      const { data } = await supabaseClient.auth.getSession();
      const supaSession = data?.session;
      if (supaSession?.user) {
        const authUser = supaSession.user;
        let op = getOperatorByAuthId(authUser.id) || getOperatorByEmail(authUser.email);
        if (!op) {
          op = await _bootOpWithTimeout(_resolveOperatorForAuth(authUser), null);
        } else {
          op = await _bootOpWithTimeout(_refreshOperatorFromSupabase(op, authUser), op);
          if (op && !op.auth_user_id) {
            await _bootOpWithTimeout(_linkOperator(op.id, authUser.id, authUser.email), null);
            op.auth_user_id = authUser.id;
          }
        }
        if (op && op.active !== false) {
          setSession(op.id);
          window._supabaseAuthActive = true;
          _startApp();
          return;
        }
        await authSignOut();
      }
    } catch (e) {
      console.warn('⚠️ Erro ao restaurar sessão Supabase:', e.message);
    }
  }

  // Sem sessão Supabase — sempre exibe tela de login
  showLoginScreen();
})();

function generateMonthlyReport() {
  if (typeof canExport === 'function' && !canExport()) {
    if (typeof showToast === 'function') showToast('Relatório restrito a administradores/supervisores.', 'error');
    return;
  }
  var clients = isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam ? getClientsByTeam(_selectedTeam) : getMyClients();
  var pens = isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam ? getPendenciasByTeam(_selectedTeam) : getMyPendencias();
  var ops = getOperators().filter(function(o) { return (o.team || 'init') === (isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam ? _selectedTeam : getCurrentTeam()); });
  var now = new Date();
  var monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  var monthNames = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

  var monthPens = pens.filter(function(p) { return new Date(p.createdAt) >= monthStart; });
  var resolvedPens = monthPens.filter(function(p) { return isPendenciaResolvida(p.status); });

  var w = window.open('', '_blank', 'width=900,height=700,noopener');
  if (!w) {
    showToast('Permita pop-ups para gerar o relatório.', 'error');
    return;
  }
  try { w.opener = null; } catch (_) {}
  w.document.write(
    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Relatório Mensal — Init Intra</title>' +
    '<style>' +
      'body{font-family:Arial,sans-serif;color:#1e293b;padding:40px;max-width:800px;margin:0 auto}' +
      'h1{font-size:24px;margin-bottom:4px}h2{font-size:18px;border-bottom:2px solid #1a56db;padding-bottom:6px;margin:24px 0 12px}' +
      '.date{color:#64748b;font-size:13px;margin-bottom:20px}' +
      'table{width:100%;border-collapse:collapse;margin-bottom:16px}' +
      'th{text-align:left;padding:6px 10px;background:#f1f5f9;font-size:11px;text-transform:uppercase;color:#64748b}' +
      'td{padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:13px}' +
      '.kpi{display:flex;gap:16px;margin-bottom:20px}' +
      '.kpi-box{flex:1;padding:16px;border-radius:8px;text-align:center;border:1px solid #e2e8f0}' +
      '.kpi-num{font-size:28px;font-weight:700}.kpi-label{font-size:11px;color:#64748b;text-transform:uppercase}' +
      '@media print{.kpi-box{border-color:#ccc}}' +
    '</style></head><body>' +
    '<h1>Init Intra — Relatório Mensal</h1>' +
    '<div class="date">' + monthNames[now.getMonth()] + ' de ' + now.getFullYear() + ' — Gerado em ' + new Date().toLocaleDateString('pt-BR') + '</div>' +
    '<div class="kpi">' +
      '<div class="kpi-box"><div class="kpi-num" style="color:#3b82f6">' + clients.length + '</div><div class="kpi-label">Clientes Totais</div></div>' +
      '<div class="kpi-box"><div class="kpi-num" style="color:#16a34a">' + resolvedPens.length + '</div><div class="kpi-label">Pendências Resolvidas</div></div>' +
      '<div class="kpi-box"><div class="kpi-num">' + ops.filter(function(o) { return o.active !== false; }).length + '</div><div class="kpi-label">Técnicos Ativos</div></div>' +
    '</div>' +
    '<h2>Produtividade por Técnico</h2>' +
    '<table><thead><tr><th>Técnico</th><th>Pendências Resolvidas</th></tr></thead><tbody>' +
    ops.filter(function(o) { return o.active !== false; }).map(function(o) {
      var pCnt = resolvedPens.filter(function(p) { return p.responsible === o.name; }).length;
      return '<tr><td><strong>' + escapeHtml(o.name) + '</strong></td><td>' + pCnt + '</td></tr>';
    }).join('') +
    '</tbody></table>' +
    '<p style="font-size:11px;color:#94a3b8;text-align:center;margin-top:30px">Init Intra — Sistema de Gestão Interna</p>' +
    '<script>window.print()</' + 'script>' +
    '</body></html>'
  );
  w.document.close();
}
