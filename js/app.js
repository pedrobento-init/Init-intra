// app.js

// ── Dashboard Period Filter ─────────────────────────────────────────────────────
let _dashPeriod = 'all';
let _dashCustomStart = '';
let _dashCustomEnd   = '';

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
}

function onTeamChange(value) {
  _selectedTeam = value;
  // Save preference
  if (typeof setCacheKV === 'function') setCacheKV('intra_selected_team', value);
  // Rebuild realtime channel with the team filter
  if (typeof initSupabaseRealtime === 'function') initSupabaseRealtime();
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
  document.querySelectorAll('.period-btn').forEach(b => b.classList.toggle('active', b.dataset.period === period));
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

    if (data.clients)    dbSet('intra_clients',    data.clients);
    if (data.pendencias) dbSet('intra_pendencias', data.pendencias);
    if (data.procedures) dbSet('intra_procedures', data.procedures);
    if (data.procedureTemplates) dbSet('intra_procedure_templates', data.procedureTemplates);
    if (data.operators)  dbSet('intra_operators',  data.operators);
    if (data.visits)     dbSet('intra_visits',     data.visits);
    if (data.tickets)    dbSet('intra_tickets',    data.tickets);
    if (data.reunioes)   dbSet('intra_reunioes',   data.reunioes);

    const cloudOk = typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive;
    if (cloudOk) {
      showToast('Enviando backup para a nuvem...', 'info');
      const errors = await _pushImportToSupabase(data);
      if (errors.length) {
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
      google_sheet_url: c.googleSheetUrl || null, notes: c.notes, team: c.team || 'init',
      attachments: c.attachments || [], created_at: c.createdAt || now, updated_at: c.updatedAt || now
    })));
  } catch (e) { errors.push('clients: ' + e.message); }

  try {
    await chunk('pendencias', (data.pendencias || []).map(p => ({
      id: p.id, client_id: p.clientId, client_name: p.clientName, tipo: p.tipo, descricao: p.descricao,
      responsible: p.responsible, status: p.status, priority: p.priority, deadline: p.deadline || null,
      notes: p.notes || [], link_util: p.linkUtil || '', team: p.team || 'init',
      attachments: p.attachments || [], checklist: p.checklist || [], tags: p.tags || [],
      recurrence: p.recurrence || null, visit_id: p.visitId || null,
      reviewed_in_meeting: p.reviewedInMeeting || null,
      completed_at: p.completedAt || null, created_at: p.createdAt || now, updated_at: p.updatedAt || now
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

  return errors;
}

// ── Navegação ──────────────────────────────────────────────────────────────────
const _pageScrollState = {};

function navigateTo(page) {
  const contentArea = document.getElementById('contentArea');
  const currentHash = window.location.hash.replace('#', '') || 'dashboard';

  if (typeof isCurrentAdmin === 'function' && !isCurrentAdmin()) {
    if (page === 'dashboard' || page === 'historico') {
      if (page === 'historico') showToast('Apenas administradores podem ver o histórico.', 'error');
      page = 'pendencias';
    }
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

  const visits       = allVisits.filter(v => itemInDashPeriod(v));
  const upcomingVisits = [...allVisits]
    .filter(v => v.date >= today && v.status !== 'cancelada' && v.status !== 'concluida')
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.time || '').localeCompare(b.time || ''))
    .slice(0, 5);
  const todayVisits = allVisits.filter(v => v.date === today && v.status !== 'cancelada');

  const opsAtivos = getOperators().filter(o => o.active !== false).length;

  const resolvedPens = pens.filter(p => p.status === 'concluido' && p.createdAt && (p.completedAt || p.updatedAt));
  const getHours = (start, end) => (new Date(end) - new Date(start)) / (1000 * 60 * 60);
  let totalHours = 0; let totalCount = 0;
  resolvedPens.forEach(p => {
    const hours = getHours(p.createdAt, p.completedAt || p.updatedAt);
    if (hours >= 0) { totalHours += hours; totalCount++; }
  });
  const avgSlaHours = totalCount > 0 ? (totalHours / totalCount).toFixed(1) : 0;
  const resolvedCount = pens.filter(p => p.status === 'concluido').length;
  const completionRate = pens.length ? Math.round((resolvedCount / pens.length) * 100) : 0;

  const periodLabel = {all:'Todos',week:'Esta Semana',month:'Este Mês',quarter:'Este Trimestre',custom:'Personalizado'}[_dashPeriod] || 'Todos';

  document.getElementById('contentArea').innerHTML = `
    <div class="dash-top-row">
      <div class="period-filter">
        <span class="period-label">Período:</span>
        <button class="period-btn${_dashPeriod==='all'?' active':''}" data-period="all" onclick="setDashPeriod('all')">Todos</button>
        <button class="period-btn${_dashPeriod==='week'?' active':''}" data-period="week" onclick="setDashPeriod('week')">Semana</button>
        <button class="period-btn${_dashPeriod==='month'?' active':''}" data-period="month" onclick="setDashPeriod('month')">Mês</button>
        <button class="period-btn${_dashPeriod==='quarter'?' active':''}" data-period="quarter" onclick="setDashPeriod('quarter')">Trimestre</button>
        <button class="period-btn${_dashPeriod==='custom'?' active':''}" data-period="custom" onclick="setDashPeriod('custom')">Personalizado</button>
        <div id="customDateRange" class="custom-date-range" style="display:${_dashPeriod==='custom'?'flex':'none'}">
          <input type="date" id="dashCustomStart" value="${_dashCustomStart}" onchange="setDashCustomDates()" class="date-input" />
          <span style="color:var(--text-muted);font-size:12px">até</span>
          <input type="date" id="dashCustomEnd" value="${_dashCustomEnd}" onchange="setDashCustomDates()" class="date-input" />
        </div>
      </div>
      <div class="dash-sync-status" title="Fonte dos dados do dashboard">
        <span class="dash-sync-dot ${typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive ? 'is-online' : ''}"></span>
        ${typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive ? 'Dados sincronizados' : 'Dados locais'}
      </div>
      <div class="dash-export-btns">
        <button class="btn btn-secondary btn-sm" onclick="exportClientsCSV()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          CSV Clientes
        </button>
        <button class="btn btn-secondary btn-sm" onclick="exportPendenciasCSV()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          CSV Pendências
        </button>
        <button class="btn btn-secondary btn-sm" onclick="openHoursReport()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          Horas
        </button>
        <button class="btn btn-secondary btn-sm" onclick="window.print()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
          PDF
        </button>
        <button class="btn btn-primary btn-sm" onclick="generateMonthlyReport()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          Relatório Mensal
        </button>
      </div>
    </div>
    
    <div class="stats-grid">
      <div class="stat-card" onclick="navigateTo('clientes')" style="cursor:pointer">
        <div class="stat-icon" style="background:#eff6ff">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1a56db" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        </div>
        <div><div class="stat-value">${clients.length}</div><div class="stat-label">Clientes${_dashPeriod!=='all'?' (período)':''}</div></div>
      </div>
      <div class="stat-card" onclick="navigateTo('pendencias')" style="cursor:pointer">
        <div class="stat-icon" style="background:#eff6ff">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1a56db" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
        </div>
        <div><div class="stat-value" style="color:#1a56db">${open.length + inProg.length + paused.length}</div><div class="stat-label">Pendências abertas${_dashPeriod!=='all'?' (período)':''}</div></div>
      </div>
      <div class="stat-card" onclick="navigateTo('pendencias')" style="cursor:pointer">
        <div class="stat-icon" style="background:#fef2f2">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </div>
        <div><div class="stat-value" style="color:#dc2626">${critical.length}</div><div class="stat-label">Alta prioridade${_dashPeriod!=='all'?' (período)':''}</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:#ecfdf5">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        </div>
        <div><div class="stat-value" style="color:#16a34a">${avgSlaHours}h</div><div class="stat-label">SLA Médio${_dashPeriod!=='all'?' (período)':''}</div></div>
      </div>
      <div class="stat-card" onclick="navigateTo('visitas')" style="cursor:pointer">
        <div class="stat-icon" style="background:#e0f2fe">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0ea5e9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 16H9m10 0h3v-3.15a1 1 0 0 0-.84-.99L16 11l-2.7-3.6a1 1 0 0 0-.8-.4H5.24a2 2 0 0 0-1.8 1.1l-.8 1.63A6 6 0 0 0 2 12.42V16h2"/><circle cx="6.5" cy="16.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/></svg>
        </div>
        <div><div class="stat-value" style="color:#0ea5e9">${visits.length}</div><div class="stat-label">Visitas${_dashPeriod!=='all'?' (período)':''}</div></div>
      </div>
      <div class="stat-card" onclick="navigateTo('pendencias')" style="cursor:pointer">
        <div class="stat-icon" style="background:#fef2f2">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
        </div>
        <div><div class="stat-value" style="color:#dc2626">${overdue.length}</div><div class="stat-label">Pendências vencidas</div></div>
      </div>
      <div class="stat-card" onclick="navigateTo('pendencias')" style="cursor:pointer">
        <div class="stat-icon" style="background:#fff7ed">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ea580c" stroke-width="2"><path d="M12 3v18M3 12h18"/><circle cx="12" cy="12" r="9"/></svg>
        </div>
        <div><div class="stat-value" style="color:#ea580c">${dueToday.length}</div><div class="stat-label">Vencem hoje</div></div>
      </div>
      <div class="stat-card" onclick="navigateTo('pendencias')" style="cursor:pointer">
        <div class="stat-icon" style="background:#fefce8">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ca8a04" stroke-width="2"><circle cx="12" cy="8" r="3"/><path d="M5 21a7 7 0 0 1 14 0"/></svg>
        </div>
        <div><div class="stat-value" style="color:#ca8a04">${unassigned.length}</div><div class="stat-label">Sem responsável</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:#f5f3ff">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" stroke-width="2"><path d="m5 12 4 4L19 6"/><circle cx="12" cy="12" r="9"/></svg>
        </div>
        <div><div class="stat-value" style="color:#7c3aed">${completionRate}%</div><div class="stat-label">Taxa de conclusão</div></div>
      </div>
    </div>

    <div class="card" style="margin-bottom:18px">
      <div class="section-header"><span class="section-title">Evolução de Clientes — ${periodLabel}</span></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(120px,100%),1fr));gap:12px;padding:12px">
        <div style="text-align:center;padding:12px;border-radius:8px;background:var(--bg-secondary)">
          <div style="font-size:24px;font-weight:700;color:#3b82f6">${allClients.length}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px">Total Cadastrados</div>
        </div>
        <div style="text-align:center;padding:12px;border-radius:8px;background:var(--bg-secondary)">
          <div style="font-size:24px;font-weight:700;color:#16a34a">${clients.length}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px">No Período</div>
        </div>
        <div style="text-align:center;padding:12px;border-radius:8px;background:var(--bg-secondary)">
          <div style="font-size:24px;font-weight:700;color:#7c3aed">${allClients.filter(c => c.status === 'ativo').length}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px">Ativos</div>
        </div>
        <div style="text-align:center;padding:12px;border-radius:8px;background:var(--bg-secondary)">
          <div style="font-size:24px;font-weight:700;color:#d97706">${opsAtivos}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px">Técnicos Ativos</div>
        </div>
      </div>
    </div>

    <div class="dashboard-charts-grid">
      <div class="card" style="display:flex; flex-direction:column;">
        <div class="section-header"><span class="section-title">Distribuição por Prioridade</span></div>
        <div style="flex:1; position:relative; min-height:240px;"><canvas id="chartPriority"></canvas></div>
      </div>
      <div class="card" style="display:flex; flex-direction:column;">
        <div class="section-header"><span class="section-title">Carga de Trabalho (Por Técnico)</span></div>
        <div style="flex:1; position:relative; min-height:240px;"><canvas id="chartWorkload"></canvas></div>
      </div>
      <div class="card" style="display:flex; flex-direction:column;">
        <div class="section-header"><span class="section-title">Evolução — Últimos 6 Meses</span></div>
        <div style="flex:1; position:relative; min-height:240px;"><canvas id="chartEvolution"></canvas></div>
      </div>
      <div class="card" style="display:flex; flex-direction:column;">
        <div class="section-header"><span class="section-title">Ranking de Produtividade (Resolvidos)</span></div>
        <div style="flex:1; position:relative; min-height:240px;"><canvas id="chartRanking"></canvas></div>
      </div>
    </div>

    <div class="grid-2">
      <div style="display:flex;flex-direction:column;gap:16px">
        <div class="card">
          <div class="section-header">
            <span class="section-title">Minhas Pendências Recentes</span>
            <button class="btn btn-secondary btn-sm" onclick="navigateTo('pendencias')">Ver todas →</button>
          </div>
          ${recentPens.length ? `<div style="display:flex;flex-direction:column;gap:1px">
            ${recentPens.map(p => {
              const c = getClientById(p.clientId);
               const isOverdue = p.deadline && p.deadline < localDateISO();
              return `<div style="display:flex;align-items:center;gap:10px;padding:10px;border-radius:6px;cursor:pointer;transition:background .15s" onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background=''" onclick="navigateTo('pendencias');setTimeout(()=>openPendenciaDetail('${p.id}'),100)">
                ${c ? clientAvatar(c, 30) : ''}
                <div style="flex:1;min-width:0">
                  <div style="font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(p.descricao)||'(sem descrição)'}</div>
                  <div style="font-size:11px;color:var(--text-muted);margin-top:1px">${escapeHtml(p.clientName)||'—'} · ${escapeHtml(p.responsible)||'—'} ${isOverdue?'· <span style="color:#dc2626">⚠️ Vencida</span>':''}</div>
                </div>
                <div style="display:flex;gap:4px;flex-shrink:0">${statusTag(p.status)}</div>
              </div>`;
            }).join('')}
          </div>` : `<div class="empty-state" style="padding:30px"><p>Nenhuma pendência ativa 🎉</p></div>`}
        </div>

        <div class="card">
          <div class="section-header">
            <span class="section-title">Próximas Visitas${todayVisits.length ? ` <span style="background:#0ea5e9;color:#fff;font-size:10px;padding:2px 6px;border-radius:10px;margin-left:6px">${todayVisits.length} hoje</span>` : ''}</span>
            <button class="btn btn-secondary btn-sm" onclick="navigateTo('visitas')">Ver todas →</button>
          </div>
          ${upcomingVisits.length ? `<div style="display:flex;flex-direction:column;gap:1px">
            ${upcomingVisits.map(v => {
              const c = getClientById(v.clientId);
              const isToday = v.date === today;
              return `<div style="display:flex;align-items:center;gap:10px;padding:10px;border-radius:6px;cursor:pointer;transition:background .15s" onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background=''" onclick="navigateTo('visitas');setTimeout(()=>openVisitDetail('${v.id}'),100)">
                ${c ? clientAvatar(c, 30) : ''}
                <div style="flex:1;min-width:0">
                  <div style="font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(v.motivo)||'(sem motivo)'}</div>
                  <div style="font-size:11px;color:var(--text-muted);margin-top:1px">${escapeHtml(v.clientName)||'—'} · ${escapeHtml(v.operator)||'—'}</div>
                </div>
                <div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px;flex-shrink:0">
                  <span style="font-size:11px;font-weight:600;${isToday?'color:#0ea5e9':''}">${formatDate(v.date)}${(v.allDay || v.time || v.timeEnd) ? ' ' + escapeHtml(formatVisitTimeRange(v)) : ''}</span>
                  <span style="font-size:10px;background:${(typeof VISIT_STATUS_MAP!=='undefined'&&VISIT_STATUS_MAP[v.status])?VISIT_STATUS_MAP[v.status].color:'#94a3b8'}20;color:${(typeof VISIT_STATUS_MAP!=='undefined'&&VISIT_STATUS_MAP[v.status])?VISIT_STATUS_MAP[v.status].color:'#94a3b8'};padding:2px 6px;border-radius:4px;font-weight:600">${(typeof VISIT_STATUS_MAP!=='undefined'&&VISIT_STATUS_MAP[v.status])?VISIT_STATUS_MAP[v.status].label:escapeHtml(v.status||'—')}</span>
                </div>
              </div>`;
            }).join('')}
          </div>` : `<div class="empty-state" style="padding:30px"><p>Nenhuma visita agendada 🚗</p></div>`}
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:16px">
        <div class="card">
          <div class="section-header"><span class="section-title">Ações Rápidas</span></div>
          <div style="display:flex;flex-direction:column;gap:8px">
            <button class="btn btn-primary" style="justify-content:center" onclick="navigateTo('clientes');setTimeout(()=>openClientForm(),100)">+ Novo Cliente</button>
            <button class="btn btn-secondary" style="justify-content:center" onclick="navigateTo('pendencias');setTimeout(()=>openPendenciaForm(),100)">+ Nova Pendência</button>
            <button class="btn btn-secondary" style="justify-content:center;background:#0ea5e9;border-color:#0ea5e9;color:#fff" onclick="navigateTo('visitas');setTimeout(()=>openVisitForm(),100)">+ Nova Visita</button>
          </div>
        </div>
      </div>
    </div>`;
  
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
  const resolvedByMonth = months.map(m => pens.filter(p => p.status === 'concluido' && p.updatedAt && p.updatedAt.slice(0,7) === m.key).length);

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
  pens.filter(p => p.status === 'concluido').forEach(p => { if (rankMap[p.responsible] !== undefined) rankMap[p.responsible]++; });

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

  // badge-chamados removido (módulo descontinuado na interface)
}

function openHoursReport() {
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
    var dashNav = document.getElementById('nav-dashboard');
    if (dashNav) dashNav.style.display = 'none';
    var histNav = document.getElementById('nav-historico');
    if (histNav) histNav.style.display = 'none';
  }
  document.querySelectorAll('.btn-export').forEach(function (btn) {
    btn.style.display = isAdmin ? '' : 'none';
  });

  const hash  = window.location.hash.replace('#','');
  const pages = ['dashboard','clientes','pendencias','calendario','operadores','historico','templates','visitas','reuniao'];
  navigateTo(pages.includes(hash) ? hash : 'dashboard');
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

  // Tenta restaurar sessão do Supabase Auth (única fonte de autenticação)
  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected()) {
    try {
      const { data } = await supabaseClient.auth.getSession();
      const supaSession = data?.session;
      if (supaSession?.user) {
        const authUser = supaSession.user;
        let op = getOperatorByAuthId(authUser.id) || getOperatorByEmail(authUser.email);
        if (!op) {
          op = await _resolveOperatorForAuth(authUser);
        } else {
          op = await _refreshOperatorFromSupabase(op, authUser);
          if (op && !op.auth_user_id) {
            await _linkOperator(op.id, authUser.id, authUser.email);
            op.auth_user_id = authUser.id;
          }
        }
        if (op && op.active !== false) {
          try { await syncSupabaseToLocal(); } catch (_) {}
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
  var clients = isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam ? getClientsByTeam(_selectedTeam) : getMyClients();
  var pens = isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam ? getPendenciasByTeam(_selectedTeam) : getMyPendencias();
  var ops = getOperators().filter(function(o) { return (o.team || 'init') === (isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam ? _selectedTeam : getCurrentTeam()); });
  var now = new Date();
  var monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  var monthNames = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

  var monthPens = pens.filter(function(p) { return new Date(p.createdAt) >= monthStart; });
  var resolvedPens = monthPens.filter(function(p) { return p.status === 'concluido'; });

  var w = window.open('', '_blank', 'width=900,height=700');
  if (!w) {
    showToast('Permita pop-ups para gerar o relatório.', 'error');
    return;
  }
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
      '<div class="kpi-box"><div class="kpi-num" style="color:#16a34a">' + resolvedPens.length + '</div><div class="kpi-label">Pendências Concluídas</div></div>' +
      '<div class="kpi-box"><div class="kpi-num">' + ops.filter(function(o) { return o.active !== false; }).length + '</div><div class="kpi-label">Técnicos Ativos</div></div>' +
    '</div>' +
    '<h2>Produtividade por Técnico</h2>' +
    '<table><thead><tr><th>Técnico</th><th>Pendências Concluídas</th></tr></thead><tbody>' +
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
