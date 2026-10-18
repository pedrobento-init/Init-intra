// fila.js – "Minha fila": a tela de quem está no dia a dia.
// O Dashboard é voltado à gestão; aqui o técnico vê só o que é dele e o que
// precisa de ação agora: cronômetro ligado, pendências urgentes, visitas de
// hoje e prazos da semana. Também monta a faixa global de alertas.

const FILA_WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const FILA_MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function _filaAddDays(iso, n) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function _filaClosed(status) {
  if (typeof isPendenciaClosed === 'function') return isPendenciaClosed(status);
  return ['concluido', 'resolvido', 'cancelado', 'fechado'].includes(status || '');
}

/**
 * Modelo puro da fila (testável): recebe listas já filtradas pelo escopo.
 * @returns {{ running: object|null, now: object[], week: object[], visits: object[], counts: object }}
 */
// Mesma pessoa: por id quando o registro e o usuário têm (049); senão pelo nome.
function _filaIsMe(recId, recName, userId, userName) {
  if (recId && userId) return recId === userId;
  return String(recName || '') !== '' && (recName || '') === (userName || '');
}

function buildFilaModel(pens, visits, userName, todayISO, nowMs, userId) {
  const mine = (pens || []).filter((p) => p && !_filaClosed(p.status) && _filaIsMe(p.responsibleId, p.responsible, userId, userName));
  const tomorrow = _filaAddDays(todayISO, 1);
  const in7 = _filaAddDays(todayISO, 7);
  const weight = { critica: 4, alta: 3, media: 2, baixa: 1 };

  const running = (pens || []).find((p) => p && p.timerRunning && _filaIsMe(p.timerOperatorId, p.timerOperator, userId, userName)) || null;

  // "Agora": vencidas, vencendo hoje/amanhã, prioridade alta/crítica.
  const now = mine.filter((p) => {
    const due = p.deadline && p.deadline <= tomorrow;
    return due || p.priority === 'alta' || p.priority === 'critica';
  }).sort((a, b) => {
    const ao = a.deadline && a.deadline < todayISO ? 1 : 0;
    const bo = b.deadline && b.deadline < todayISO ? 1 : 0;
    if (ao !== bo) return bo - ao;
    if ((weight[b.priority] || 0) !== (weight[a.priority] || 0)) return (weight[b.priority] || 0) - (weight[a.priority] || 0);
    return String(a.deadline || '9999').localeCompare(String(b.deadline || '9999'));
  });
  const nowIds = new Set(now.map((p) => p.id));

  // "Esta semana": prazos de depois de amanhã até +7 dias (fora do "agora").
  const week = mine
    .filter((p) => !nowIds.has(p.id) && p.deadline && p.deadline > tomorrow && p.deadline <= in7)
    .sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)));

  const myVisits = (visits || [])
    .filter((v) => v && v.date === todayISO && _filaIsMe(v.operatorId, v.operator, userId, userName) && v.status !== 'concluida' && v.status !== 'cancelada')
    .sort((a, b) => (a.allDay ? 0 : 1) - (b.allDay ? 0 : 1) || String(a.time || '').localeCompare(String(b.time || '')));

  const overdue = mine.filter((p) => p.deadline && p.deadline < todayISO).length;
  const forgotten = (pens || []).filter((p) => {
    if (!p || !p.timerRunning || !p.timerStartedAt) return false;
    if (!_filaIsMe(p.timerOperatorId, p.timerOperator, userId, userName)) return false;
    return ((nowMs || Date.now()) - new Date(p.timerStartedAt).getTime()) / 1000 >= 10 * 3600;
  }).length;

  return { running, now, week, visits: myVisits, counts: { overdue, forgotten, visitsToday: myVisits.length, open: mine.length } };
}

/** Texto da faixa de alertas ("3 vencidas · 1 cronômetro esquecido · 2 visitas hoje"); '' se nada. */
function buildAlertStripText(counts) {
  const c = counts || {};
  const parts = [];
  const pl = (n, s, p) => n + ' ' + (n === 1 ? s : p);
  if (c.overdue) parts.push(pl(c.overdue, 'pendência vencida', 'pendências vencidas'));
  if (c.forgotten) parts.push(pl(c.forgotten, 'cronômetro esquecido', 'cronômetros esquecidos'));
  if (c.visitsToday) parts.push(pl(c.visitsToday, 'visita hoje', 'visitas hoje'));
  if (c.vencimentos) parts.push(pl(c.vencimentos, 'vencimento em 7 dias', 'vencimentos em 7 dias'));
  return parts.join(' · ');
}

function _filaScope() {
  const team = (typeof isTeamAdmin === 'function' && isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam) ? _selectedTeam : null;
  const pens = team && typeof getPendenciasByTeam === 'function' ? getPendenciasByTeam(team) : (typeof getMyPendencias === 'function' ? getMyPendencias() : []);
  const visits = team && typeof getVisitsByTeam === 'function' ? getVisitsByTeam(team) : (typeof getMyVisits === 'function' ? getMyVisits() : []);
  const user = (typeof getUser === 'function' && getUser()) || {};
  const today = typeof localDateISO === 'function' ? localDateISO() : new Date().toISOString().slice(0, 10);
  const session = typeof getSession === 'function' ? getSession() : null;
  return { pens, visits, userName: user.name || '', userId: (session && session.opId) || null, today };
}

function _filaDueLabel(p, today) {
  if (!p.deadline) return '';
  const tomorrow = _filaAddDays(today, 1);
  if (p.deadline < today) return '<span class="fila-due is-over">Vencida · ' + escapeHtml(formatDate(p.deadline)) + '</span>';
  if (p.deadline === today) return '<span class="fila-due is-today">Vence hoje</span>';
  if (p.deadline === tomorrow) return '<span class="fila-due is-soon">Vence amanhã</span>';
  return '<span class="fila-due">' + escapeHtml(formatDate(p.deadline)) + '</span>';
}

function _filaPenRow(p, today) {
  const num = typeof penDisplayNumber === 'function' ? penDisplayNumber(p) : '';
  const pri = typeof penPriColor === 'function' ? penPriColor(p.priority) : 'var(--ds-muted)';
  return '<li class="fila-row" data-action="openPendencia" data-arg="' + escapeHtml(p.id) + '">' +
    '<span class="fila-dot" style="--c:' + pri + '" aria-hidden="true"></span>' +
    '<span class="fila-main"><span class="fila-title"><small>' + escapeHtml(num) + '</small>' + escapeHtml(getPendenciaTitulo(p)) + '</span>' +
    '<span class="fila-meta">' + escapeHtml(p.clientName || '—') + '</span></span>' +
    _filaDueLabel(p, today) +
    '</li>';
}

function renderFila() {
  document.getElementById('pageTitle').textContent = 'Minha fila';
  setTopbarAction('Nova Pendência', '<svg class="topbar-action-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>');
  window._topbarAction = () => openPendenciaForm();

  const s = _filaScope();
  const m = buildFilaModel(s.pens, s.visits, s.userName, s.today, undefined, s.userId);
  const d = new Date(s.today + 'T12:00:00');
  const h = new Date().getHours();
  const hello = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  const first = String(s.userName || '').split(' ')[0];

  let timerHtml = '';
  if (m.running) {
    const forgot = typeof isTimerForgotten === 'function' && isTimerForgotten(m.running);
    const secs = typeof getElapsedSeconds === 'function' ? getElapsedSeconds(m.running) : 0;
    const fmt = typeof formatTimerCompact === 'function' ? formatTimerCompact(secs) : '';
    const id = escapeHtml(m.running.id);
    timerHtml = '<section class="ov-panel fila-timer' + (forgot ? ' is-forgot' : '') + '" aria-label="Cronômetro ligado">' +
      '<div class="fila-timer-time"><span class="timer-display" data-format="compact" data-timer-id="' + id + '" data-running="true">' + fmt + '</span>' +
      '<small>' + (forgot ? 'Ligado há muito tempo — esqueceu ligado?' : 'Cronômetro ligado') + '</small></div>' +
      '<div class="fila-timer-what" data-action="openPendencia" data-arg="' + id + '" role="button" tabindex="0"><b>' + escapeHtml(getPendenciaTitulo(m.running)) + '</b><span>' + escapeHtml(m.running.clientName || '') + '</span></div>' +
      '<div class="fila-timer-acts">' +
        (forgot
          ? '<button type="button" class="btn btn-primary btn-sm" data-action="filaAdjust" data-arg="' + id + '">Parar e ajustar</button>'
          : '<button type="button" class="btn btn-secondary btn-sm" data-action="filaPause" data-arg="' + id + '">Pausar</button>') +
      '</div></section>';
  }

  const nowHtml = m.now.length
    ? '<ul class="fila-list">' + m.now.map((p) => _filaPenRow(p, s.today)).join('') + '</ul>'
    : '<div class="empty-state" style="padding:28px 12px"><p>Nada urgente com você agora. 🎉</p><button class="btn btn-secondary btn-sm" data-action="nav" data-arg="pendencias">Ver todas as pendências</button></div>';

  const visitsHtml = m.visits.length
    ? '<ul class="fila-list">' + m.visits.map((v) => '<li class="fila-row" data-action="openVisit" data-arg="' + escapeHtml(v.id) + '">' +
        '<span class="fila-dot" style="--c:var(--ds-cyan)" aria-hidden="true"></span>' +
        '<span class="fila-main"><span class="fila-title">' + escapeHtml(v.clientName || '—') + '</span>' +
        '<span class="fila-meta">' + escapeHtml(v.motivo || '') + '</span></span>' +
        '<span class="fila-due">' + escapeHtml(v.allDay || !v.time ? 'Dia inteiro' : (typeof formatVisitTimeRange === 'function' ? formatVisitTimeRange(v) : v.time)) + '</span></li>').join('') + '</ul>'
    : '<p class="fila-none">Nenhuma visita sua hoje.</p>';

  const weekHtml = m.week.length
    ? '<ul class="fila-list">' + m.week.map((p) => _filaPenRow(p, s.today)).join('') + '</ul>'
    : '<p class="fila-none">Sem prazos nos próximos 7 dias.</p>';

  document.getElementById('contentArea').innerHTML =
    '<div class="ov-wrap fila">' +
      '<p class="fila-hello">' + hello + (first ? ', <b>' + escapeHtml(first) + '</b>' : '') +
        ' · ' + FILA_WEEKDAYS[d.getDay()] + ', ' + d.getDate() + ' de ' + FILA_MONTHS[d.getMonth()] +
        ' · ' + (typeof plural === 'function' ? plural(m.counts.open, 'pendência aberta', 'pendências abertas') : m.counts.open + ' abertas') + ' com você</p>' +
      timerHtml +
      '<div class="fila-grid">' +
        '<section class="ov-panel"><div class="ov-ph"><h2 class="ov-h2">Para fazer agora</h2><span class="ov-muted">' + m.now.length + '</span></div>' + nowHtml + '</section>' +
        '<div class="fila-side">' +
          (typeof roteiroPanelHtml === 'function'
            ? roteiroPanelHtml(s.visits, s.today, s.userName, s.userId)
            : '<section class="ov-panel"><div class="ov-ph"><h2 class="ov-h2">Visitas de hoje</h2><button class="btn btn-secondary btn-sm" data-action="newVisit">+ Visita</button></div>' + visitsHtml + '</section>') +
          '<section class="ov-panel"><div class="ov-ph"><h2 class="ov-h2">Próximos 7 dias</h2></div>' + weekHtml + '</section>' +
        '</div>' +
      '</div>' +
    '</div>';
}

// ── Faixa global de alertas (abaixo da topbar) ─────────────────────────────
// Dispensável por dia: some até a meia-noite, ou antes se os números mudarem.
function _alertStripKey(text) { return 'intra_alert_dismissed_' + (typeof localDateISO === 'function' ? localDateISO() : '') + '_' + text; }

function renderAlertStrip() {
  const el = document.getElementById('alertStrip');
  if (!el) return;
  let text = '';
  try {
    const s = _filaScope();
    const counts = buildFilaModel(s.pens, s.visits, s.userName, s.today, undefined, s.userId).counts;
    // Vencimentos sob a responsabilidade do usuário (licença, SSL, domínio…).
    if (typeof countVencimentosUrgentes === 'function' && typeof getMyVencimentos === 'function') {
      counts.vencimentos = countVencimentosUrgentes(getMyVencimentos(), s.today, s.userName, s.userId);
    }
    text = buildAlertStripText(counts);
  } catch (_) { text = ''; }
  let dismissed = false;
  try { dismissed = !!sessionStorage.getItem(_alertStripKey(text)); } catch (_) {}
  if (!text || dismissed) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.innerHTML =
    '<button type="button" class="alert-strip-main" data-action="nav" data-arg="fila" title="Abrir Minha fila">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l9 16H3zM12 10v4M12 17.5v.01"/></svg>' +
      // "Com você": a faixa conta só o que é do usuário (o aviso de prazos
      // do sistema conta a equipe toda).
      '<span>Com você: ' + escapeHtml(text) + '</span></button>' +
    '<button type="button" class="alert-strip-close" aria-label="Dispensar alertas de hoje" data-action="dismissAlerts">×</button>';
  el.dataset.text = text;
}

function dismissAlertStrip() {
  const el = document.getElementById('alertStrip');
  if (!el) return;
  try { sessionStorage.setItem(_alertStripKey(el.dataset.text || ''), '1'); } catch (_) {}
  el.hidden = true;
}

// Atualização automática: mudança em pendências/visitas (local ou sync)
// repinta a faixa e, se aberta, a própria fila.
(function () {
  if (typeof window === 'undefined' || typeof onDataChanged !== 'function' || window._filaAutoRefresh) return;
  window._filaAutoRefresh = true;
  const refresh = function () {
    try { renderAlertStrip(); } catch (_) {}
    try { if ((window.location.hash || '').replace('#', '') === 'fila') renderFila(); } catch (_) {}
  };
  onDataChanged('pendencias', refresh);
  onDataChanged('visitas', refresh);
})();

if (typeof registerActions === 'function') {
  registerActions({
    filaAdjust: (_el, id) => openTimerAdjust(id),
    filaPause: (el, id) => { toggleTimer('pendencia', id, el); renderFila(); },
    dismissAlerts: () => dismissAlertStrip(),
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildFilaModel, buildAlertStripText };
}
