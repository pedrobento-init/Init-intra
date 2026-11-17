// dashboard.js — painel/overview: filtro de período, widgets, cálculos e gráficos.
// Extraído de app.js sem mudança de lógica; escopo global compartilhado (ver AGENTS.md).

// ── Dashboard Period Filter ─────────────────────────────────────────────────────
let _dashPeriod = 'all';
let _dashCustomStart = '';
let _dashCustomEnd   = '';
let _dashWorkloadPeriod = 'all';

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
  } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'app'); }
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
  } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'app'); }
  renderDashboard();
}
function resetDashWidgets() {
  try {
    if (typeof setCacheKV === 'function') setCacheKV(_dashHiddenKey(), []);
    else if (typeof removeCacheKV === 'function') removeCacheKV(_dashHiddenKey());
  } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'app'); }
  renderDashboard();
  if (typeof showToast === 'function') showToast('Widgets do Dashboard restaurados.', 'success');
}
function _dashHideBtn(id) {
  return `<button class="dash-hide-btn" title="Ocultar widget" data-action="toggleDashWidget" data-arg="${escapeHtml(id)}" data-stop="1">✕</button>`;
}
function dashGoPresentation() {
  navigateTo('reuniao');
  setTimeout(() => { if (typeof enterPresentationMode === 'function') enterPresentationMode(); }, 150);
}
function dashGoToPendenciasByOperator(name) {
  try {
    if (typeof saveFilterState === 'function') saveFilterState('pendencias', { resp: name, search: '', client: '', status: '', priority: '' });
  } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'app'); }
  navigateTo('pendencias');
}
// Selo de comparativo: verde = melhora, vermelho = piora, cinza = estável/sem base.
function _dashDeltaBadge(delta) {
  if (!delta || delta.improved == null || delta.direction === 'flat') {
    return `<span class="dash-delta dash-delta-flat" title="Sem variação relevante">• 0%</span>`;
  }
  const color = delta.improved ? '#16a34a' : '#dc2626';
  const arrow = delta.direction === 'up' ? '↑' : '↓';
  return `<span class="dash-delta" data-sty="color:${color}" title="${delta.improved ? 'Melhora' : 'Piora'} vs. período anterior">${arrow}${delta.pct}%</span>`;
}
// Faixa anterior espelhando getDashDateRange (reaproveita metrics.js quando disponível).
function _getPreviousDashRange() {
  try {
    if (typeof getPreviousDashRange === 'function') {
      return getPreviousDashRange(_dashPeriod, _dashCustomStart, _dashCustomEnd, _brasiliaNow());
    }
  } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'app'); }
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
  } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'app'); }
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
  } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'app'); }
  if (!prev) return { pct: cur ? 100 : 0, direction: cur ? 'up' : 'flat', improved: cur ? higherIsBetter : null };
  const pct = Math.round(((cur - prev) / Math.abs(prev)) * 100);
  const direction = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
  return { pct: Math.abs(pct), direction, improved: direction === 'flat' ? null : (higherIsBetter ? direction === 'up' : direction === 'down') };
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
  // Prazos: mesma conta da tela Prazos e SLA (prazos.js) — os números batem.
  const _pz = (typeof buildPrazosModel === 'function') ? buildPrazosModel(allPens, today).kpis : null;
  const dueToday = activePens.filter(p => p.deadline === today);
  const unassigned = activePens.filter(p => !p.responsible || !p.responsible.trim());
  const recentPens = [...pens]
    .filter(p => !isPendenciaClosed(p.status) && isSameOperator(p.responsibleId, p.responsible, session && session.opId, currentUser))
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
      if (!isSameOperator(p.responsibleId, p.responsible, session && session.opId, currentUser)) return false;
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
      return v && v.date === today && isSameOperator(v.operatorId, v.operator, session && session.opId, currentUser) && v.status !== 'cancelada' && v.status !== 'concluida';
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
    } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'app'); }
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
    else _daySummary = `Hoje: ${plural(dueToday.length, 'pendência vence', 'pendências vencem')}, ${plural(todayVisits.length, 'visita agendada', 'visitas agendadas')}.` + ((_dashCanManage && (_overloaded.length || _onLeaveOps.length)) ? ' Atenção: ' + [..._overloaded.map(o => `${o.name} está sobrecarregado (${o.count} ativas)`), ..._onLeaveOps.map(o => `${o.name} está afastado`)].join('; ') + '.' : '');
  } catch (_) { _daySummary = `Hoje: ${plural(dueToday.length, 'pendência vence', 'pendências vencem')}, ${plural(todayVisits.length, 'visita agendada', 'visitas agendadas')}.`; }
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
      _ovNeutralCount = activePens.filter(p => isSameOperator(p.responsibleId, p.responsible, session && session.opId, currentUser)).length;
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

  const _operationalItems = typeof buildOperationalCenter === 'function'
    ? buildOperationalCenter(visits, allPens, typeof _mstLoad === 'function' ? _mstLoad() : {}, new Date()) : [];
  const _visitMetrics = typeof buildVisitMetrics === 'function' ? buildVisitMetrics(visits, today.slice(0, 7)) : null;

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
        <button type="button" class="period-btn${_dashPeriod==='all'?' active':''}" data-period="all" aria-pressed="${_dashPeriod==='all'}" data-action="setDashPeriod" data-arg="all">Todos</button>
        <button type="button" class="period-btn${_dashPeriod==='week'?' active':''}" data-period="week" aria-pressed="${_dashPeriod==='week'}" data-action="setDashPeriod" data-arg="week">Semana</button>
        <button type="button" class="period-btn${_dashPeriod==='month'?' active':''}" data-period="month" aria-pressed="${_dashPeriod==='month'}" data-action="setDashPeriod" data-arg="month">Mês</button>
        <button type="button" class="period-btn${_dashPeriod==='quarter'?' active':''}" data-period="quarter" aria-pressed="${_dashPeriod==='quarter'}" data-action="setDashPeriod" data-arg="quarter">Trimestre</button>
        <button type="button" class="period-btn${_dashPeriod==='custom'?' active':''}" data-period="custom" aria-pressed="${_dashPeriod==='custom'}" data-action="setDashPeriod" data-arg="custom">Personalizado</button>
        <div id="customDateRange" class="custom-date-range ov-custom" data-sty="display:${_dashPeriod==='custom'?'flex':'none'}">
          <input type="date" id="dashCustomStart" value="${_dashCustomStart}" data-change="setDashCustomDates" class="date-input" aria-label="Data inicial" />
          <span class="ov-until">até</span>
          <input type="date" id="dashCustomEnd" value="${_dashCustomEnd}" data-change="setDashCustomDates" class="date-input" aria-label="Data final" />
        </div>
      </div>
      <div class="dash-export-btns ov-acts">
        <details class="ov-export">
          <summary class="btn btn-secondary btn-sm ov-btn" title="Exportar dados do dashboard">
            <svg class="ov-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 20h16"/></svg>
            Exportar
            <svg class="ov-ico ov-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
          </summary>
          <div class="ov-export-menu" role="menu">
            ${_dashCanManage ? `<button type="button" role="menuitem" data-action="dashExport" data-arg="exportClientsCSV">CSV de clientes</button>` : ''}
            ${_dashCanManage ? `<button type="button" role="menuitem" data-action="dashExport" data-arg="exportPendenciasCSV">CSV de pendências</button>` : ''}
            ${_dashCanManage ? `<button type="button" role="menuitem" data-action="dashExport" data-arg="openHoursReport">Relatório de horas</button>` : ''}
            <button type="button" role="menuitem" data-action="dashExport" data-arg="print">Imprimir / PDF</button>
          </div>
        </details>
        ${_dashCanManage ? `<button type="button" class="btn btn-primary btn-sm ov-btn" data-action="generateMonthlyReport">
          <svg class="ov-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7zM14 3v4h4M9 13h6M9 17h6"/></svg>
          Relatório Mensal
        </button>` : ''}
        ${_dashCanManage ? `<button type="button" class="btn btn-secondary btn-sm ov-btn" title="Abrir reunião em modo apresentação" data-action="dashGoPresentation">
          <svg class="ov-ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/></svg>
          Apresentar</button>` : ''}
        ${_dashCanManage ? `<button type="button" class="btn btn-secondary btn-sm ov-btn" title="Restaurar widgets ocultos" data-action="resetDashWidgets">
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

    ${operationalCenterHtml(_operationalItems)}

    <h2 class="ov-sec-t ov-sec-first" id="ov-meudia">Meu dia</h2>
    ${!_dashIsHidden('fila') ? `
    <section class="card dash-widget ov-panel ov-focus" aria-labelledby="ov-fila">
      ${_dashHideBtn('fila')}
      <div class="ov-ph"><h2 class="ov-h2" id="ov-fila">Minha fila do dia</h2><span class="ov-sub">${myQueue.length + myTodayVisits.length} ${myQueue.length + myTodayVisits.length===1?'item':'itens'}</span></div>
      ${myQueue.length + myTodayVisits.length ? `<ul class="ov-ls">` + myTodayVisits.map(function(v){
        const c = typeof getClientById === 'function' ? getClientById(v.clientId) : null;
        const timeLabel = (v.allDay || !v.time) ? 'Dia inteiro' : escapeHtml(v.time + (v.timeEnd ? ' – ' + v.timeEnd : ''));
        const vstTag = typeof visitStatusTag === 'function' ? visitStatusTag(v.status) : '';
        return `<li class="ov-it" role="button" tabindex="0" data-action="openVisitDetail" data-arg="${escapeHtml(v.id)}">
          ${c ? clientAvatar(c, 34) : `<span class="ov-av" aria-hidden="true">${escapeHtml(_ovInitials(v.clientName))}</span>`}
          <div class="u-3922d3">
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
        return `<li class="ov-it" role="button" tabindex="0" data-action="dashOpenPen" data-arg="${escapeHtml(p.id)}">
          ${c ? clientAvatar(c, 34) : `<span class="ov-av" aria-hidden="true">${escapeHtml(_ovInitials(p.clientName))}</span>`}
          <div class="u-3922d3">
            <div class="ov-tt">${escapeHtml(getPendenciaTitulo(p))}</div>
            <div class="ov-mt"><span>${escapeHtml(p.clientName)||'—'}</span>${priTag}${p.deadline ? `<span>${escapeHtml(formatDate(parseDeadline(p.deadline)))}</span>` : ''}${isOverdue ? `<span class="ov-warn"><svg class="ov-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l9 16H3zM12 10v4M12 17.5v.01"/></svg>Vencida</span>` : ''}${isStale && !isOverdue ? '<span>Parada</span>' : ''}</div>
          </div>
          <div>${stTag}</div>
        </li>`;
      }).join('') + `</ul>` + (myQueue.length>Math.max(0,8-myTodayVisits.length)?`<div class="u-ee028e"><button type="button" class="btn btn-secondary btn-sm ov-btn" data-action="navigateTo" data-arg="pendencias">Ver todas (${myQueue.length})<svg class="ov-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-5-5l5 5-5 5"/></svg></button></div>`:'') : `<p class="ov-empty">Nenhum item urgente.</p>`}
    </section>` : ''}

    <div class="ov-g-day">
      <div class="ov-col">
        ${!_dashIsHidden('recentes') ? `
        <section class="card dash-widget ov-panel" aria-labelledby="ov-rec2">
          ${_dashHideBtn('recentes')}
          <div class="ov-ph"><h2 class="ov-h2" id="ov-rec2">Minhas pendências recentes</h2><button type="button" class="btn btn-secondary btn-sm ov-btn" data-action="navigateTo" data-arg="pendencias">Ver todas<svg class="ov-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-5-5l5 5-5 5"/></svg></button></div>
          ${recentPens.length ? `<ul class="ov-ls">
            ${recentPens.map(p => {
              const c = getClientById(p.clientId);
               const _isClosedR = typeof isPendenciaClosed === 'function' ? isPendenciaClosed : function(s){ return ['concluido','resolvido','cancelado','fechado'].includes(s || ''); };
               const isOverdue = p.deadline && p.deadline < localDateISO() && !_isClosedR(p.status);
              return `<li class="ov-it" role="button" tabindex="0" data-action="dashOpenPen" data-arg="${escapeHtml(p.id)}">
                ${c ? clientAvatar(c, 34) : `<span class="ov-av" aria-hidden="true">${escapeHtml(_ovInitials(p.clientName))}</span>`}
                <div class="u-3922d3">
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
          <div class="ov-ph"><h2 class="ov-h2" id="ov-vis">Próximas visitas</h2><button type="button" class="btn btn-secondary btn-sm ov-btn" data-action="navigateTo" data-arg="visitas">Ver todas<svg class="ov-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-5-5l5 5-5 5"/></svg></button></div>
          ${upcomingVisits.length ? `<ul class="ov-ls">
            ${upcomingVisits.map(v => {
              const c = getClientById(v.clientId);
              const isToday = v.date === today;
              return `<li class="ov-it" role="button" tabindex="0" data-action="dashOpenVisit" data-arg="${escapeHtml(v.id)}">
                ${c ? clientAvatar(c, 34) : `<span class="ov-av" aria-hidden="true">${escapeHtml(_ovInitials(v.clientName))}</span>`}
                <div class="u-3922d3">
                  <div class="ov-tt">${escapeHtml(v.motivo)||'(sem motivo)'}</div>
                  <div class="ov-mt"><span>${escapeHtml(v.clientName)||'—'}</span><span>${escapeHtml(v.operator)||'—'}</span></div>
                </div>
                <div class="ov-when">
                  <small>${(typeof formatVisitNumero === 'function') ? escapeHtml(formatVisitNumero(v)) : ''}</small>
                  <span><b data-sty="${isToday?'color:var(--ov-cyan)':''}">${formatDate(v.date)}</b>${(v.allDay || v.time || v.timeEnd) ? ' <small>' + escapeHtml(formatVisitTimeRange(v)) + '</small>' : ''}</span>
                  <span class="ov-pill" data-sty="--c:${(typeof VISIT_STATUS_MAP!=='undefined'&&VISIT_STATUS_MAP[v.status])?VISIT_STATUS_MAP[v.status].color:'#94a3b8'}">${(typeof VISIT_STATUS_MAP!=='undefined'&&VISIT_STATUS_MAP[v.status])?escapeHtml(VISIT_STATUS_MAP[v.status].label):escapeHtml(v.status||'—')}</span>
                </div>
              </li>`;
            }).join('')}
          </ul>` : `<p class="ov-empty">Nenhuma visita agendada.</p>`}
        </section>` : ''}
      </div>

      <div class="ov-col">
        <section class="card ov-panel" aria-labelledby="ov-acoes">
          <div class="ov-ph"><h2 class="ov-h2" id="ov-acoes">Ações rápidas</h2>${_dashCanManage ? `<button type="button" class="btn btn-secondary btn-sm ov-btn" data-action="dashGoPresentation"><svg class="ov-i" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/></svg>Apresentar reunião</button>` : ''}</div>
          <div class="ov-acts-big">
            ${(typeof isCurrentAdmin === 'function' && isCurrentAdmin()) ? `<button type="button" class="btn btn-primary ov-btn ov-big" data-action="dashGoClientForm"><svg class="ov-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Novo cliente</button>` : ''}
            <button type="button" class="btn btn-secondary ov-btn ov-big" data-action="dashGoPendenciaRapida"><svg class="ov-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Nova pendência</button>
            <button type="button" class="btn btn-secondary ov-btn ov-big" data-action="dashGoVisitForm"><svg class="ov-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Nova visita</button>
          </div>
        </section>
      </div>
    </div>

    ${(_dashCanManage && !_dashIsHidden('reuniao')) ? `
    <section class="card dash-widget ov-panel ov-meet" aria-labelledby="ov-reuniao">
      ${_dashHideBtn('reuniao')}
      <div class="ov-meet-main">
        <div class="ov-meet-title-row">
          <h2 class="ov-h2" id="ov-reuniao">Reunião mensal${_nextMeeting ? ` — ${escapeHtml(_meetingLabel)}` : ''}</h2>${_nextMeeting ? `<span class="ov-chip">${escapeHtml(_nextMeeting.status || '—')}</span>` : ''}
        </div>
        ${_nextMeeting
        ? `<div class="ov-stats"><span><b>${activePens.length}</b> pendências abertas aguardando revisão</span><span><b>${allClients.length}</b> clientes no escopo</span></div>`
        : `<p class="ov-muted">Nenhuma reunião registrada ainda. Use “Iniciar/Continuar Reunião” para começar a deste mês.</p>`}
      </div>
      <div class="dash-export-btns ov-acts ov-meet-acts">
        <button type="button" class="btn btn-secondary btn-sm ov-btn" data-action="dashGoPresentation">
          <svg class="ov-ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/></svg>
          Apresentar</button>
        <button type="button" class="btn btn-primary btn-sm ov-btn" data-action="navigateTo" data-arg="reuniao">${_nextMeeting && _nextMeeting.status === 'aberta' ? 'Continuar Reunião' : 'Iniciar/Continuar Reunião'}</button>
      </div>
    </section>` : ''}

    ${(_dashCanManage && !_dashIsHidden('afastados') && _onLeaveWithCount.length) ? `
    <div class="card dash-widget u-d740d3">
      ${_dashHideBtn('afastados')}
      <div class="section-header"><span class="section-title">Operadores afastados</span></div>
      <div class="u-be2653">
        ${_onLeaveWithCount.map(o => `
          <div class="u-652f8e">
            <span class="u-b2c58d"><strong>${escapeHtml(o.name)}</strong> está afastado — ${plural(o.count, 'pendência aguardando', 'pendências aguardando')} reatribuição</span>
            <button class="btn btn-secondary btn-sm" data-action="dashGoToPendenciasByOperator" data-arg="${escapeHtml(o.name)}">Ver pendências →</button>
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
          <div class="ov-row" role="button" tabindex="0" data-action="viewClient" data-arg="${escapeHtml(r.clientId)}">
            <div class="ov-client"><div class="ov-name">${escapeHtml(r.clientName)}</div><div class="ov-st ov-${_lvl}">${escapeHtml(_lbl)}</div></div>
            <div class="ov-track ov-${_lvl}" aria-hidden="true"><i data-sty="width:${_pct}%"></i></div>
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
          <div class="ov-li" role="button" tabindex="0" data-action="viewClient" data-arg="${escapeHtml(s.clientId)}">
            <span class="ov-av" aria-hidden="true">${escapeHtml(_ovInitials(s.clientName))}</span>
            <span class="ov-name">${escapeHtml(s.clientName)}</span>
            <small>${s.daysSince >= 9999 ? 'Sem contato registrado' : `há ${s.daysSince} dias`}</small>
          </div>`).join('') : `<p class="ov-empty">Todos os clientes ativos recentemente.</p>`}
      </section>` : ''}
      ${(!_dashIsHidden('recorrentes') && _recurrent.length) ? `
      <section class="card dash-widget ov-panel" aria-labelledby="ov-rec">
        ${_dashHideBtn('recorrentes')}
        <div class="ov-ph"><h2 class="ov-h2" id="ov-rec">Pendência recorrente</h2><span class="ov-sub">Top 5</span></div>
        ${_recurrent.length ? _recurrent.map(r => `
          <div class="ov-li" role="button" tabindex="0" data-action="viewClient" data-arg="${escapeHtml(r.clientId)}">
            <span class="ov-name">${escapeHtml(r.clientName)}</span>
            <small>${r.streak} meses seguidos</small>
          </div>`).join('') : `<p class="ov-empty">Nenhum cliente recorrente.</p>`}
      </section>` : ''}
      ${(!_dashIsHidden('aniversarios') && _anniv.length) ? `
      <section class="card dash-widget ov-panel" aria-labelledby="ov-aniv">
        ${_dashHideBtn('aniversarios')}
        <div class="ov-ph"><h2 class="ov-h2" id="ov-aniv">Aniversários de clientes</h2><span class="ov-sub">Mês atual</span></div>
        ${_anniv.length ? _anniv.map(a => `
          <div class="ov-li" role="button" tabindex="0" data-action="viewClient" data-arg="${escapeHtml(a.clientId)}">
            <span class="ov-name">${escapeHtml(a.clientName)}</span>
            <small>${a.years} ${a.years === 1 ? 'ano' : 'anos'}</small>
          </div>`).join('') : `<p class="ov-empty">Nenhum aniversário neste mês.</p>`}
      </section>` : ''}
    </div>

    <h2 class="ov-sec-t" id="ov-ind">Indicadores</h2>
    ${_visitMetrics ? `<section class="card dash-widget ov-panel" aria-labelledby="ov-ind-vis"><div class="ov-ph"><h2 class="ov-h2" id="ov-ind-vis">Visitas concluídas no mês</h2></div><div class="ov-sum">
      <div class="ov-col"><div class="ov-n">${_visitMetrics.avgMinutes === null ? '—' : _visitMetrics.avgMinutes + ' min'}</div><div class="ov-l">tempo médio</div></div>
      <div class="ov-col"><div class="ov-n">${_visitMetrics.topOperator ? escapeHtml(_visitMetrics.topOperator[0]) : '—'}</div><div class="ov-l">${_visitMetrics.topOperator ? _visitMetrics.topOperator[1] + ' visitas' : 'sem operador'}</div></div>
      <div class="ov-col"><div class="ov-n">${_visitMetrics.topClient ? escapeHtml(_visitMetrics.topClient[0]) : '—'}</div><div class="ov-l">${_visitMetrics.topClient ? _visitMetrics.topClient[1] + ' visitas' : 'sem cliente'}</div></div>
      <div class="ov-col"><div class="ov-n">${_visitMetrics.recurrentClients}</div><div class="ov-l">clientes com reincidência</div></div>
    </div></section>` : ''}
    
    ${!_dashIsHidden('stats') ? `<section class="dash-widget ov-kpis u-d461c9" aria-label="Resumo de indicadores">${_dashHideBtn('stats')}` : '<div class="u-6b99de"><div>'}
      <div class="ov-k" role="button" tabindex="0" data-action="navigateTo" data-arg="clientes">
        <b class="stat-value">${clients.length}</b><span>Clientes${_dashPeriod!=='all'?' (período)':''}</span>
      </div>
      <div class="ov-k" role="button" tabindex="0" data-action="navigateTo" data-arg="visitas">
        <b class="stat-value">${visits.length}</b><span>Visitas${_dashPeriod!=='all'?' (período)':''}</span>
      </div>
      <div class="ov-k ov-k-static">
        <b class="stat-value">${avgSlaHours}h</b><span>SLA médio${_dashPeriod!=='all'?' (período)':''} ${_deltaSla ? _dashDeltaBadge(_deltaSla) : ''}</span>
      </div>
      <div class="ov-k ov-k-static">
        <b class="stat-value">${completionRate}%</b><span>Taxa de conclusão ${_deltaComp ? _dashDeltaBadge(_deltaComp) : ''}</span>
      </div>
      <div class="ov-k" role="button" tabindex="0" data-action="navigateTo" data-arg="pendencias">
        <b class="stat-value">${open.length + inProg.length + paused.length}</b><span>Pendências abertas${_dashPeriod!=='all'?' (período)':''} ${_deltaOpen ? _dashDeltaBadge(_deltaOpen) : ''}</span>
      </div>
      <div class="ov-k amber" role="button" tabindex="0" data-action="navigateTo" data-arg="pendencias">
        <b class="stat-value">${critical.length}</b><span>Alta prioridade${_dashPeriod!=='all'?' (período)':''}</span>
      </div>
      <div class="ov-k red" role="button" tabindex="0" data-action="navigateTo" data-arg="prazos" title="Ver por responsável e cliente em Prazos e SLA">
        <b class="stat-value">${_pz ? _pz.vencidas : overdue.length}</b><span>Pendências vencidas →</span>
      </div>
      <div class="ov-k amber" role="button" tabindex="0" data-action="navigateTo" data-arg="prazos" title="Ver em Prazos e SLA">
        <b class="stat-value">${_pz ? _pz.hoje : dueToday.length}</b><span>Vencem hoje →</span>
      </div>
      ${_dashCanManage ? `<div class="ov-k" role="button" tabindex="0" data-action="navigateTo" data-arg="pendencias">
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
        <select id="workloadPeriod" class="form-select ov-sel u-28c0f6" aria-label="Período da carga por operador" data-change="setWorkloadPeriod">
          <option value="all" ${(_dashWorkloadPeriod||'all')==='all'?'selected':''}>Todo período</option>
          <option value="week" ${(_dashWorkloadPeriod||'all')==='week'?'selected':''}>Semana atual</option>
          <option value="month" ${(_dashWorkloadPeriod||'all')==='month'?'selected':''}>Mês atual</option>
        </select>
      </div>
      <div class="ov-sub u-543571">Horas em pendências</div>
      <div id="workloadList" class="u-d04a6e"></div>
    </section>` : ''}
    </div>
    ${!_dashIsHidden('charts') ? `
    <div class="dash-widget u-d461c9">
      ${_dashHideBtn('charts')}
      <div class="ov-g ov-g-b">
      <section class="card dash-widget ov-panel u-7ecbcd" aria-labelledby="ov-pri">
        <div class="ov-ph"><h2 class="ov-h2" id="ov-pri">Distribuição por prioridade</h2></div>
        <div class="ov-cv"><canvas id="chartPriority"></canvas></div>
      </section>
      ${_dashCanManage ? `<section class="card dash-widget ov-panel u-7ecbcd" aria-labelledby="ov-car">
        <div class="ov-ph"><h2 class="ov-h2" id="ov-car">Carga de trabalho por técnico</h2></div>
        <div class="ov-cv"><canvas id="chartWorkload"></canvas></div>
      </section>` : ''}
      </div>
      <div class="ov-g ov-g-c u-1b0f49">
      <section class="card dash-widget ov-panel u-7ecbcd" aria-labelledby="ov-ev6">
        <div class="ov-ph"><h2 class="ov-h2" id="ov-ev6">Evolução dos últimos 6 meses</h2></div>
        <div class="ov-cv"><canvas id="chartEvolution"></canvas></div>
      </section>
      ${_dashCanManage ? `<section class="card dash-widget ov-panel u-7ecbcd" aria-labelledby="ov-rk">
        <div class="ov-ph"><h2 class="ov-h2" id="ov-rk">Ranking de produtividade</h2><span class="ov-sub">Resolvidos</span></div>
        <div class="ov-cv"><canvas id="chartRanking"></canvas></div>
      </section>` : ''}
      </div>
    </div>` : '<div class="dashboard-charts-grid u-6b99de"><div class="card"><canvas id="chartPriority"></canvas></div><div class="card"><canvas id="chartWorkload"></canvas></div><div class="card"><canvas id="chartEvolution"></canvas></div><div class="card"><canvas id="chartRanking"></canvas></div></div>'}

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
        return `<div class="ov-hb"><span class="n">${escapeHtml(op)}</span><div class="ov-bt"><i data-sty="--w:${_pct}%"></i></div><span class="ov-v">${h}h</span></div>`;
      }).join('');
    }
  })();
  
  if (typeof registerActions === 'function' && !window._ovExportOutsideBound) {
    registerActions({
      dashExport: (el, what) => {
        const d = el.closest('details'); if (d) d.open = false;
        if (what === 'print') window.print();
        else if (['exportClientsCSV', 'exportPendenciasCSV', 'openHoursReport'].includes(what) && typeof window[what] === 'function') window[what]();
      },
    });
  }
  if (!window._ovExportOutsideBound) {
    window._ovExportOutsideBound = true;
    document.addEventListener('click', (e) => {
      document.querySelectorAll('details.ov-export[open]').forEach((d) => { if (!d.contains(e.target)) d.open = false; });
    });
  }

  setTimeout(() => renderCharts(pens, visits), 50);
  animateDashboardCounters();
}

function animateDashboardCounters() {
  if (typeof _canAnimate === 'function' ? !_canAnimate() : typeof Motion === 'undefined') return;
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
      Chart.defaults.font.family = "'Manrope', system-ui, sans-serif";
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
