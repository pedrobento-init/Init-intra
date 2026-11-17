// app.js

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

// ── Export / Import ────────────────────────────────────────────────────────────
function exportData() {
  if (typeof isCurrentAdmin === 'function' && !isCurrentAdmin()) {
    showToast('Apenas administradores podem exportar backup completo.', 'error');
    return;
  }
  const safeOps = (getOperators() || []).map(o => {
    const { pinHash: _pinHash, pinSalt: _pinSalt, pin: _pin, ...rest } = o; // remove segredos do backup
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
        showToast(`Backup local OK, mas ${plural(errors.length, 'erro', 'erros')} no envio à nuvem.`, 'warning', 6000);
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
      // Coluna da 068, só quando há valor: a migration é aplicada à mão, e
      // mandá-la sem condição derruba o envio de TODOS os clientes na janela
      // entre o deploy e o SQL Editor. Mesmo tratamento do address, que
      // também fica fora deste payload.
      ...(c.driveFolderUrl ? { drive_folder_url: c.driveFolderUrl } : {}),
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
// Página efetivamente renderizada por último. O listener de hashchange usa
// isto para não renderizar de novo a página que navigateTo acabou de montar
// (antes, toda navegação renderizava 2x: duplicava toasts/fetches e criava
// corrida no FullCalendar, que podia deixar a Agenda em branco).
let _currentPage = null;

function navigateTo(page) {
  const currentHash = window.location.hash.replace('#', '') || 'dashboard';

  if (typeof isCurrentAdmin === 'function' && !isCurrentAdmin()) {
    if (page === 'historico') {
      if (typeof showToast === 'function') showToast('Apenas administradores podem ver o histórico.', 'error');
      page = 'pendencias';
    }
    // Dashboard liberado p/ todos os perfis (blocos de gestão filtrados em renderDashboard).
  }
  if (page === 'relatorios' && typeof canViewInitOnly === 'function' && !canViewInitOnly()) {
    if (typeof showToast === 'function') showToast('Atendimentos Milvus disponível apenas para o time Init.', 'error');
    page = 'pendencias';
  }
  if (page === 'reuniao' && typeof canViewInitOnly === 'function' && !canViewInitOnly()) {
    if (typeof showToast === 'function') showToast('Reunião disponível apenas para o time Init.', 'error');
    page = 'pendencias';
  }

  // A rolagem é da janela (o content-area não é contêiner de scroll).
  const _changingPage = _currentPage !== page;
  // Rota de item (#chamados/<id>, #projetos/<id>) não é página do menu: acende Pendências
  // e não guarda rolagem, porque cada item abre do topo.
  const _penRotaDe = (h) => (typeof penPaginaRotaDe === 'function' ? penPaginaRotaDe(h) : null);
  const _rota = _penRotaDe(page);
  const _veioDeRota = !!_penRotaDe(_currentPage || '');
  const _navPage = _rota ? 'pendencias' : page;
  if (_changingPage && !_veioDeRota) {
    _pageScrollState[_currentPage || currentHash] = window.scrollY || 0;
  }
  _currentPage = page;

  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  // Modelos vive dentro de Conhecimento (aba): acende o item dela no menu.
  const el = document.getElementById('nav-' + (_navPage === 'templates' ? 'conhecimento' : _navPage));
  if (el) el.classList.add('active');
  // Barra inferior (celular): destaca o destino atual; páginas fora dela
  // acendem o "Mais".
  const _bottom = document.querySelectorAll('.bottom-nav-item');
  if (_bottom.length) {
    const _inBar = ['fila', 'pendencias', 'calendario'].includes(_navPage);
    _bottom.forEach(b => {
      const on = _inBar ? b.dataset.page === _navPage : b.dataset.page === '__more';
      b.classList.toggle('is-active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
  }

  const btn = document.getElementById('topbarActionBtn');
  btn.style.display = 'none';

  if (typeof updateBadges === 'function') updateBadges();

  // Saindo da página do item: o `_pgpAberta` não pode sobreviver, ou um realtime
  // redesenharia a página por cima da tela seguinte.
  if (!_rota && typeof penPaginaFechar === 'function') penPaginaFechar();
  // Volta para a lista: a rolagem é aplicada depois do desenho, em _penRenderAtual,
  // porque a lista pode pintar só depois do requestAnimationFrame lá embaixo.
  if (_veioDeRota && page === 'pendencias' && typeof penPaginaMarcarScrollLista === 'function') {
    penPaginaMarcarScrollLista(_pageScrollState.pendencias || 0);
  }

  if (_rota) {
    // Recarregar a mesma rota (F5 lógico, troca de equipe) não pode recriar o DOM:
    // penPaginaAtualizar captura e devolve rascunho, modo, aba e rolagem.
    if (typeof penPaginaEstaAberta === 'function' && penPaginaEstaAberta(_rota.id)) penPaginaAtualizar(_rota.id);
    else renderPaginaPendencia(_rota.tipo, _rota.id);
  } else if (page === 'fila')      renderFila();
  else if (page === 'dashboard')   { document.getElementById('pageTitle').textContent = 'Dashboard'; renderDashboard(); }
  else if (page === 'prazos')      renderPrazos();
  else if (page === 'vencimentos') renderVencimentos();
  else if (page === 'caixa')       renderCaixaEntrada();
  else if (page === 'conhecimento') renderConhecimento();
  else if (page === 'clientes')    renderClients();
  else if (page === 'templates')   renderTemplates();
  else if (page === 'pendencias')  renderPendencias();
  else if (page === 'calendario')  renderCalendar();
  else if (page === 'visitas')     renderVisitas();
  else if (page === 'reuniao')     renderReuniao();
  else if (page === 'operadores')  renderOperadores();
  else if (page === 'relatorios')  { if(typeof renderRelatorios==='function') renderRelatorios(); else document.getElementById('contentArea').innerHTML='<p>Relatórios em carregamento...</p>'; }
  else if (page === 'equipamentos') renderEquipamentos();
  else if (page === 'historico')   renderLogs();

  window.location.hash = page;
  if (typeof renderAlertStrip === 'function') { try { renderAlertStrip(); } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'app'); } }
  if (typeof refreshPendingStrip === 'function') { try { refreshPendingStrip(); } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'app'); } }

  var ca = document.getElementById('contentArea');
  if (ca) {
    ca.classList.remove('transitioning');
    void ca.offsetWidth;
    ca.classList.add('transitioning');
    requestAnimationFrame(() => {
      // Página nova abre no topo (ou na posição salva ao sair dela);
      // "Recarregar" a mesma página mantém a rolagem atual.
      if (!_changingPage) return;
      const saved = _pageScrollState[page] || 0;
      _pageScrollState[page] = 0;
      window.scrollTo(0, saved);
    });
  }
}

// ── Badges ─────────────────────────────────────────────────────────────────────
function updateBadges() {
  var session = getSession();
  var currentUser = session ? session.name : '';
  var pens = isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam ? getPendenciasByTeam(_selectedTeam) : getMyPendencias();
  var open = pens.filter(function(p) { return !isPendenciaClosed(p.status) && isSameOperator(p.responsibleId, p.responsible, session && session.opId, currentUser); }).length;
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
  } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'app'); }

  try { if (typeof updateVencimentosBadge === 'function') updateVencimentosBadge(); } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'app'); }
  try {
    var cxbadge = document.getElementById('badge-caixa');
    var cxn = (typeof entradasEmailPendentes === 'function') ? entradasEmailPendentes().length : 0;
    if (cxbadge) { cxbadge.textContent = cxn; cxbadge.classList.toggle('hidden', cxn === 0); }
  } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'app'); }
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
  const rows = map => Object.entries(map).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td class="u-f3535d">${fmt(v)}</td></tr>`).join('') || '<tr><td colspan="2" class="u-5872de">Sem registros</td></tr>';
  openModal('Horas trabalhadas', `
    <p class="u-fce332">Total acumulado: <strong class="u-3c6f5e">${fmt(total)}</strong> (timers de pendências)</p>
    <div class="hours-report-grid u-911b26">
      <div>
        <h4 class="u-ccbf48">Por cliente</h4>
        <div class="table-wrapper"><table><thead><tr><th>Cliente</th><th class="u-54c2af">Horas</th></tr></thead><tbody>${rows(clientMap)}</tbody></table></div>
      </div>
      <div>
        <h4 class="u-ccbf48">Por operador</h4>
        <div class="table-wrapper"><table><thead><tr><th>Operador</th><th class="u-54c2af">Horas</th></tr></thead><tbody>${rows(opMap)}</tbody></table></div>
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
    try { initSupabaseRealtime(); } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'app'); }
  }

  var isAdmin = typeof isCurrentAdmin === 'function' && isCurrentAdmin();
  if (!isAdmin) {
    // Dashboard visível p/ todos (blocos de gestão filtrados no render);
    // histórico segue restrito.
    var histNav = document.getElementById('nav-historico');
    if (histNav) histNav.style.display = 'none';
  }
  if (typeof updateRelatoriosVisibility === 'function') updateRelatoriosVisibility();
  if (typeof setSidebarMoreAdmin === 'function') setSidebarMoreAdmin(isAdmin);

  const hash  = window.location.hash.replace('#','');
  const pages = ['fila','dashboard','prazos','vencimentos','conhecimento','clientes','pendencias','caixa','calendario','operadores','relatorios','equipamentos','historico','templates','visitas','reuniao'];
  // Tela inicial: gestão (admin/supervisor) cai no Dashboard; quem está no
  // dia a dia cai na Minha fila.
  const homePage = (typeof isTeamAdmin === 'function' && isTeamAdmin()) ? 'dashboard' : 'fila';
  // Números amigáveis antes da primeira pintura (local, sem rede): evita
  // "#----" transitório no boot e garante backfill mesmo se o sync atrasar.
  try { if (typeof maintainVisitNumeros === 'function') maintainVisitNumeros(); } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'app'); }
  // Rota de item carrega por id: o F5 e o link colado precisam voltar ao mesmo item.
  const _isRota = (h) => typeof penPaginaRotaDe === 'function' && !!penPaginaRotaDe(h);
  navigateTo(pages.includes(hash) || _isRota(hash) ? hash : homePage);
  // Offline-first: a UI já montou a partir do banco local; a sincronização
  // automática roda agora em segundo plano, sem bloquear (toda falha de rede
  // vira fallback local + retry — ver triggerStartupSync em storage.js).
  try { if (typeof triggerStartupSync === 'function') triggerStartupSync('app-start'); } catch (_e) { console.error('[app] sync de inicialização falhou', _e); if (typeof _logSilent === 'function') _logSilent(_e, 'app'); }
  if (!_appStarted) {
    _appStarted = true;
    window.addEventListener('hashchange', () => {
      const p = window.location.hash.replace('#','');
      if ((pages.includes(p) || _isRota(p)) && p !== _currentPage) navigateTo(p);
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
      <img src="logo-initnet.svg" alt="InitNET" class="login-brand" width="176" height="56" />
      <div class="login-title">Init Intra</div>
      <div class="login-subtitle">Acesso restrito — identifique-se</div>
    </div>

    <div class="login-form-wrap">
      <div class="login-card">
        ${!serverOk ? `<div class="login-error u-8062c3">Serviço de autenticação indisponível.<br><span class="u-08bfba">Verifique sua conexão ou contate o suporte.</span></div>` : ''}

        <div class="login-field">
          <label class="login-label">E-mail</label>
          <input type="email" id="loginEmail" class="login-input" autocomplete="email"
            placeholder="seu.email@empresa.com" ${!serverOk ? 'disabled' : ''} />
        </div>

        <div class="login-field">
          <div class="login-label-row">
            <label class="login-label">Senha</label>
            <button type="button" class="login-forgot" data-action="forgotPassword" ${!serverOk ? 'disabled' : ''}>Esqueci minha senha</button>
          </div>
          <input type="password" id="loginPassword" class="login-input" autocomplete="current-password"
            placeholder="Digite sua senha..." ${!serverOk ? 'disabled' : ''} />
        </div>

        <div id="loginError" class="login-error"></div>

        <button id="loginBtn" class="login-btn" data-action="doLogin" ${!serverOk ? 'disabled' : ''}>
          Entrar →
        </button>
      </div>
      <p class="login-footer">
        Init Intra · Sistema Interno · ${new Date().getFullYear()}
      </p>
    </div>
  `;

  // Enter no e-mail pula para a senha; Enter na senha entra (antes era onkeydown no HTML).
  document.getElementById('loginEmail')?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); document.getElementById('loginPassword')?.focus(); }
  });
  document.getElementById('loginPassword')?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') doLogin();
  });

  setTimeout(() => document.getElementById('loginEmail')?.focus(), 100);
  _loginLockCountdown();
}

// Mostra o tempo restante da trava e segura o botão até liberar (a trava em si
// vive em auth.js e sobrevive ao reload; ver o aviso sobre defesa server-side).
let _loginLockTimer = null;
function _loginLockCountdown() {
  if (_loginLockTimer) { clearInterval(_loginLockTimer); _loginLockTimer = null; }
  if (typeof loginLockRemainingMs !== 'function' || loginLockRemainingMs() <= 0) return;
  const tick = () => {
    const errEl = document.getElementById('loginError');
    const btn = document.getElementById('loginBtn');
    const left = loginLockRemainingMs();
    if (left <= 0) {
      clearInterval(_loginLockTimer); _loginLockTimer = null;
      if (errEl) errEl.textContent = '';
      if (btn) btn.disabled = false;
      return;
    }
    if (errEl) { errEl.textContent = 'Muitas tentativas. Aguarde ' + formatLoginLockWait(left) + ' e tente novamente.'; errEl.style.color = '#f87171'; }
    if (btn) btn.disabled = true;
  };
  tick();
  _loginLockTimer = setInterval(tick, 1000);
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
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="u-9cb0f7"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg> Autenticando...';
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
    _loginLockCountdown();
  }
}

async function doLogout() {
  // Alterações ainda não enviadas ficam só neste aparelho: avisa antes de sair.
  try {
    if (typeof getPendingChanges === 'function' && typeof isSupabaseConnected === 'function' && isSupabaseConnected()) {
      const pend = await getPendingChanges();
      if (pend.length && !window.confirm(
        (pend.length === 1 ? 'Há 1 alteração que ainda não foi enviada' : 'Há ' + pend.length + ' alterações que ainda não foram enviadas') +
        ' ao servidor.\n\nElas continuam salvas neste aparelho e sobem no próximo acesso, mas não aparecem para a equipe até lá.\n\nSair mesmo assim?')) return;
    }
  } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'app'); }
  try {
    await authSignOut();
  } catch (err) {
    console.warn('Erro no logout:', err);
  }
  // Garantir limpeza total mesmo se authSignOut falhou
  if (typeof forgetAllClientSecrets === 'function') forgetAllClientSecrets();
  clearSession();
  window._supabaseAuthActive = false;
  // Limpar tokens Supabase do localStorage (safety net adicional)
  try {
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('sb-') && key.endsWith('-auth-token')) {
        localStorage.removeItem(key);
      }
    });
  } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'app'); }
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
  } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'app'); }
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

  // Resolvidas no mês = concluídas no mês (antes contava só as criadas no mês).
  var resolvedPens = pens.filter(function(p) {
    if (!isPendenciaResolvida(p.status)) return false;
    var d = new Date(p.completedAt || p.updatedAt);
    return !isNaN(d.getTime()) && d >= monthStart;
  });
  var activeOps = ops.filter(function(o) { return o.active !== false; });

  // Imprime numa área da própria página: window.open com 'noopener' sempre
  // devolve null, então o pop-up nunca abria ('Permita pop-ups...').
  var html = '<article class="rpt">' +
    '<header class="rpt-head"><div><div class="rpt-brand">Init Intra · Relatório mensal</div><h1>Visão geral da equipe</h1>' +
    '<div class="rpt-period">' + monthNames[now.getMonth()] + ' de ' + now.getFullYear() + '</div></div>' +
    '<div class="rpt-gen">Gerado em ' + new Date().toLocaleDateString('pt-BR') + '</div></header>' +
    '<section class="rpt-kpis u-155a49">' +
      '<div class="rpt-kpi"><b>' + clients.length + '</b><span>Clientes</span></div>' +
      '<div class="rpt-kpi"><b>' + resolvedPens.length + '</b><span>Pendências resolvidas no mês</span></div>' +
      '<div class="rpt-kpi"><b>' + activeOps.length + '</b><span>Técnicos ativos</span></div>' +
    '</section>' +
    '<h2>Produtividade por técnico</h2>' +
    '<table><thead><tr><th>Técnico</th><th class="rpt-num">Pendências resolvidas</th></tr></thead><tbody>' +
    activeOps.map(function(o) {
      var pCnt = resolvedPens.filter(function(p) { return p.responsible === o.name; }).length;
      return '<tr><td><strong>' + escapeHtml(o.name) + '</strong></td><td class="rpt-num">' + pCnt + '</td></tr>';
    }).join('') +
    '</tbody></table>' +
  '</article>';
  if (typeof printHtmlDocument === 'function') printHtmlDocument(html, 'Relatório mensal ' + monthNames[now.getMonth()] + ' ' + now.getFullYear());
}

// ── Ações de delegação deste arquivo (ver js/actions.js) ───────────────────
// Roda no load (defer): a tela de login usa estas ações antes de qualquer
// renderDashboard, então o registro não fica dentro de função de render.
if (typeof registerActions === 'function') {
  registerActions({
    toggleDashWidget: (_el, id) => toggleDashWidget(id),
    resetDashWidgets: () => resetDashWidgets(),
    setDashPeriod: (_el, period) => setDashPeriod(period),
    setDashCustomDates: () => setDashCustomDates(),
    setWorkloadPeriod: (_el, value) => setWorkloadPeriod(value),
    generateMonthlyReport: () => generateMonthlyReport(),
    dashGoPresentation: () => dashGoPresentation(),
    dashGoToPendenciasByOperator: (_el, name) => dashGoToPendenciasByOperator(name),
    dashOpenPen: (_el, id) => {
      navigateTo('pendencias');
      setTimeout(() => { if (typeof openPendenciaDetail === 'function') openPendenciaDetail(id); }, 100);
    },
    dashOpenVisit: (_el, id) => {
      navigateTo('visitas');
      setTimeout(() => { if (typeof openVisitDetail === 'function') openVisitDetail(id); }, 100);
    },
    dashGoClientForm: () => {
      navigateTo('clientes');
      setTimeout(() => { if (typeof openClientForm === 'function') openClientForm(); }, 100);
    },
    dashGoPendenciaRapida: () => {
      navigateTo('pendencias');
      setTimeout(() => { if (typeof openPendenciaRapida === 'function') openPendenciaRapida(); }, 100);
    },
    dashGoVisitForm: () => {
      navigateTo('visitas');
      setTimeout(() => { if (typeof openVisitForm === 'function') openVisitForm(); }, 100);
    },
    navigateTo: (_el, page) => navigateTo(page),
    openVisitDetail: (_el, id) => { if (typeof openVisitDetail === 'function') openVisitDetail(id); },
    viewClient: (_el, id) => { if (typeof viewClient === 'function') viewClient(id); },
    forgotPassword: () => forgotPassword(),
    doLogin: () => doLogin(),
  });
}
