// calendar.js

let _fcInstance = null;

const PRIORITY_COLORS = {
  baixa:   { bg: '#16a34a', text: '#fff' },
  media:   { bg: '#d97706', text: '#fff' },
  alta:    { bg: '#dc2626', text: '#fff' },
  critica: { bg: '#991b1b', text: '#fff' },
};

// ── Regra visual única dos eventos de pendência (precedência documentada) ────
// 1. Preenchimento = prioridade (legenda: Crítica #991b1b, Alta #dc2626,
//    Média #d97706, Baixa #16a34a) — mesma PRIORITY_COLORS da legenda.
// 2. Borda = Vencida (#991b1b + largura 3, como a legenda) quando vencida;
//    senão igual ao preenchimento (sem cor de status: a legenda não tem cores
//    de status, e o status aparece no tooltip/detalhe).
// 3. Vencida = deadline < hoje (data; deadline é DATE, sem hora) e status não
//    final — mesma regra dos cards (isPendenciaClosed). Prioridade nunca muda
//    por vencimento: Alta+Vencida mantém o vermelho da prioridade + borda.
// Retorna { fill, border, width, overdue }.
function penEventColors(p) {
  const fill = (PRIORITY_COLORS[p.priority] || PRIORITY_COLORS.media).bg;
  const overdue = !!p.deadline && p.deadline < localDateISO() && !isPendenciaClosed(p.status);
  return { fill, border: overdue ? '#991b1b' : fill, width: overdue ? 3 : 2, overdue };
}

const VISIT_COLORS = {
  agendada:     { bg: '#0ea5e9', border: '#0284c7' },
  em_andamento: { bg: '#f59e0b', border: '#d97706' },
  concluida:    { bg: '#16a34a', border: '#15803d' },
  cancelada:    { bg: '#94a3b8', border: '#64748b' },
};

// ── Agenda: cor do ponto por tipo/prioridade (mesma legenda da grade) ────────
function agDotFor(kind, priority) {
  if (kind === 'visit') return '#0ea5e9';
  return (PRIORITY_COLORS[priority] || PRIORITY_COLORS.media).bg;
}
// Escape local da Agenda (usa o global quando existe).
function _agEsc(s) {
  if (typeof escapeHtml === 'function') return escapeHtml(s);
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
// Chip de evento da grade (mock Agenda): ponto + título; vencida ganha selo.
function agChipHtml(kind, title, dot, overdue) {
  return '<div class="ag-chip' + (overdue ? ' overdue' : '') + '" style="--dot:' + dot + '"><span>' + _agEsc(title) + '</span></div>';
}

// ── Agenda: view-models puros da sidebar (testáveis, sem DOM/storage) ───────
var _AG_MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
function _agParseDay(dateStr) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || ''));
  if (!m) return null;
  return { y: +m[1], m: +m[2], d: +m[3] };
}
function agDayMonth(dateStr) {
  var p = _agParseDay(dateStr);
  if (!p) return '—';
  return p.d + ' ' + (_AG_MONTHS_SHORT[p.m - 1] || '');
}
function _agDiffDays(aStr, bStr) {
  var a = _agParseDay(aStr), b = _agParseDay(bStr);
  if (!a || !b) return null;
  var ms = Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d);
  return Math.round(ms / 86400000);
}
// Pendências vencidas (abertas, deadline < hoje), mais antigas primeiro.
function agOverdueItems(pens, todayStr) {
  return (pens || [])
    .filter(function (p) { return p && p.deadline && String(p.deadline) < String(todayStr); })
    .sort(function (a, b) { return String(a.deadline).localeCompare(String(b.deadline)); })
    .map(function (p) {
      return { id: p.id, title: p.title || p.assunto || p.descricao || 'Sem título', date: p.deadline, meta: 'Venceu em ' + agDayMonth(p.deadline), dot: agDotFor('pendencia', p.priority), priority: p.priority || 'media', kind: 'pendencia' };
    });
}
// Itens dos próximos 7 dias (pendências por deadline + visitas por data).
function agNext7Items(pens, visits, todayStr) {
  var out = [];
  (pens || []).forEach(function (p) {
    if (!p || !p.deadline) return;
    var diff = _agDiffDays(todayStr, String(p.deadline).slice(0, 10));
    if (diff == null || diff < 0 || diff > 7) return;
    out.push({ id: p.id, title: p.title || p.assunto || p.descricao || 'Sem título', date: String(p.deadline).slice(0, 10), diff: diff, dot: agDotFor('pendencia', p.priority), priority: p.priority || 'media', kind: 'pendencia', meta: agDayMonth(p.deadline) + (diff === 0 ? ' · hoje' : '') });
  });
  (visits || []).forEach(function (v) {
    if (!v || !v.date) return;
    var diff = _agDiffDays(todayStr, String(v.date).slice(0, 10));
    if (diff == null || diff < 0 || diff > 7) return;
    out.push({ id: v.id, title: 'Visita — ' + (v.clientName || '—'), date: String(v.date).slice(0, 10), diff: diff, dot: agDotFor('visit'), priority: '', kind: 'visit', meta: agDayMonth(v.date) + (diff === 0 ? ' · hoje' : '') });
  });
  out.sort(function (a, b) { return a.diff - b.diff || String(a.title).localeCompare(String(b.title)); });
  return out;
}
// Visitas recorrentes agrupadas por cliente: frequência + ocorrências no mês.
function agRecurringGroups(visits, monthKey) {
  var groups = {};
  (visits || []).forEach(function (v) {
    if (!v || !v.recurrence) return;
    var key = v.clientId || v.clientName || '?';
    if (!groups[key]) groups[key] = { clientId: v.clientId, clientName: v.clientName || '—', recurrence: v.recurrence, count: 0, visitId: v.id };
    if (monthKey && String(v.date || '').slice(0, 7) === monthKey) groups[key].count++;
    groups[key].visitId = v.id;
  });
  var labels = { weekly: 'Semanal', biweekly: 'Quinzenal', monthly: 'Mensal' };
  return Object.values(groups).sort(function (a, b) { return String(a.clientName).localeCompare(String(b.clientName)); }).map(function (g) {
    return { clientId: g.clientId, clientName: g.clientName, visitId: g.visitId, meta: (labels[g.recurrence] || 'Recorrente') + ' · ' + g.count + ' no mês' };
  });
}

// Título da página (topbar + cabeçalho interno).
function calendarPageTitle() { return 'Agenda'; }

// Views lógicas da Agenda: month | week | list. O switcher próprio chama
// agSetView; o FullCalendar é só o motor (sem toolbar nativa).
let _agView = null;
function agIsMobileWidth() {
  try { return (typeof window !== 'undefined' ? window.innerWidth : 1024) <= 768; }
  catch (_) { return false; }
}
function agDefaultView() { return agIsMobileWidth() ? 'list' : 'month'; }
function agFcView(logical) {
  if (logical === 'week') return 'timeGridWeek';
  if (logical === 'list') return agIsMobileWidth() ? 'listMonth' : 'listWeek';
  return 'dayGridMonth';
}
function agSetView(v) {
  if (['month', 'week', 'list'].indexOf(v) === -1) return;
  _agView = v;
  try { if (_fcInstance) _fcInstance.changeView(agFcView(v)); } catch (_) {}
  _paintAgNav();
  renderAgendaSide();
}
function agNav(dir) {
  try { if (_fcInstance) _fcInstance[dir === 'prev' ? 'prev' : 'next'](); } catch (_) {}
}
function agToday() {
  try { if (_fcInstance) _fcInstance.today(); } catch (_) {}
}
function _paintAgNav() {
  try {
    var cur = _agView || agDefaultView();
    document.querySelectorAll('.ag-nav [data-view]').forEach(function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-view') === cur);
    });
  } catch (_) {}
}

// Baixa o FullCalendar com timeout: sem isso, uma CDN lenta/travada no 1º
// acesso deixava a grade vazia para sempre (promise pendente, sem erro).
function _loadFullCalendarWithTimeout(ms) {
  return Promise.race([
    loadFullCalendar(),
    new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error('timeout FullCalendar')); }, ms || 15000);
    }),
  ]);
}

function toggleCalFilters(e) {
  if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
  var box = document.getElementById('calFilters');
  var btn = document.getElementById('calFiltersToggle');
  if (!box || !btn) return;
  var isOpen = box.dataset.open === '1';
  box.dataset.open = isOpen ? '0' : '1';
  btn.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
}
function closeCalFilters() {
  try {
    var box = document.getElementById('calFilters');
    var btn = document.getElementById('calFiltersToggle');
    if (!box || box.dataset.open !== '1') return;
    box.dataset.open = '0';
    if (btn) btn.setAttribute('aria-expanded', 'false');
  } catch (_) {}
}
if (typeof window !== 'undefined' && !window._calFiltersBound && typeof document !== 'undefined' && document.addEventListener) {
  window._calFiltersBound = true;
  document.addEventListener('click', function (e) {
    try {
      var box = document.getElementById('calFilters');
      var btn = document.getElementById('calFiltersToggle');
      if (!box || box.dataset.open !== '1') return;
      if (box.contains(e.target) || (btn && btn.contains(e.target))) return;
      closeCalFilters();
    } catch (_) {}
  });
  document.addEventListener('keydown', function (e) {
    try {
      if (e && e.key === 'Escape') closeCalFilters();
    } catch (_) {}
  });
}

function renderCalendar() {
  document.getElementById('pageTitle').textContent = calendarPageTitle();
  setTopbarAction('Nova Pendência', '<svg class="topbar-action-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>');
  window._topbarAction = () => openPendenciaForm();
  if (typeof updateBadges === 'function') updateBadges();

  const clients = isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam ? getClientsByTeam(_selectedTeam) : getMyClients();
  const team    = isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam ? _selectedTeam : getCurrentTeam();
  const opNames = getOperatorNames(team);

  document.getElementById('contentArea').innerHTML = `
    <div class="ag-head">
      <div>
        <h1 class="ag-title">Agenda</h1>
        <div class="ag-sub">Visitas, prazos e pendências administrativas</div>
      </div>
      <div class="nav ag-nav">
        <div class="ag-nav-group">
          <button class="ghost" onclick="agNav('prev')" aria-label="Período anterior">‹</button>
          <button onclick="agToday()">Hoje</button>
          <button class="ghost" onclick="agNav('next')" aria-label="Próximo período">›</button>
        </div>
        <div class="ag-nav-group ag-filter-group">
          <button id="calFiltersToggle" onclick="toggleCalFilters(event)" aria-expanded="false" aria-controls="calFilters" title="Filtros">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="11" y1="18" x2="13" y2="18"/></svg>
            Filtros
          </button>
          <div class="cal-filters" id="calFilters" data-open="0">
            <select class="form-select" id="calType" onchange="refreshCalendar()" title="Tipo de evento">
              <option value="all">Pendências + Visitas</option>
              <option value="pendencias">Apenas Pendências</option>
              <option value="visitas">Apenas Visitas</option>
            </select>
            <select class="form-select" id="calClient" onchange="refreshCalendar()">
              <option value="">Todos os clientes</option>
              ${clients.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('')}
            </select>
            <select class="form-select" id="calResponsible" onchange="refreshCalendar()">
              <option value="">Todos os responsáveis</option>
              ${opNames.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('')}
            </select>
            <select class="form-select" id="calStatus" onchange="refreshCalendar()">
              <option value="">Todos os status</option>
              ${Object.entries(STATUS_PEN_MAP).map(([k,v])=>`<option value="${k}">${escapeHtml(v.label)}</option>`).join('')}
            </select>
            <select class="form-select" id="calPriority" onchange="refreshCalendar()">
              <option value="">Prioridade</option>
              <option value="baixa">Baixa</option>
              <option value="media">Média</option>
              <option value="alta">Alta</option>
              <option value="critica">Crítica</option>
            </select>
            <div class="cal-menu-actions">
              <button class="btn btn-primary btn-sm" onclick="closeCalFilters();openPendenciaForm()">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Nova Pendência
              </button>
              <button class="btn btn-primary btn-sm" onclick="closeCalFilters();openVisitForm()">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 16H9m10 0h3v-3.15a1 1 0 0 0-.84-.99L16 11l-2.7-3.6a1 1 0 0 0-.8-.4H5.24a2 2 0 0 0-1.8 1.1l-.8 1.63A6 6 0 0 0 2 12.42V16h2"/><circle cx="6.5" cy="16.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/></svg>
                Nova Visita
              </button>
              <button class="btn btn-secondary btn-sm" onclick="closeCalFilters();exportCalendarICS()" title="Baixar calendário em .ics (Google/Outlook)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                iCal
              </button>
            </div>
          </div>
        </div>
        <span class="ag-nav-sep"></span>
        <button data-view="month" onclick="agSetView('month')">Mês</button>
        <button data-view="week" onclick="agSetView('week')">Semana</button>
        <button data-view="list" onclick="agSetView('list')">Lista</button>
      </div>
    </div>
    <div class="legend ag-legend" id="calLegend">
      <div class="legend-item"><span class="swatch" style="background:#0ea5e9"></span>Visita</div>
      <div class="legend-div"></div>
      <div class="legend-item"><span class="swatch" style="background:#991b1b"></span>Crítica</div>
      <div class="legend-item"><span class="swatch" style="background:#dc2626"></span>Alta</div>
      <div class="legend-item"><span class="swatch" style="background:#d97706"></span>Média</div>
      <div class="legend-item"><span class="swatch" style="background:#16a34a"></span>Baixa</div>
      <div class="legend-div"></div>
      <div class="legend-item"><span class="swatch" style="background:#b3122a"></span>Vencida</div>
    </div>
    <div class="ag-layout">
      <div class="card ag-cal-card">
        <div id="calendarContainer"></div>
      </div>
      <div class="side ag-side" id="agendaSide"></div>
    </div>
  `;

  const savedFilters = loadFilterState('calendar', {});
  if (savedFilters.type) document.getElementById('calType').value = savedFilters.type;
  if (savedFilters.client) document.getElementById('calClient').value = savedFilters.client;
  if (savedFilters.responsible) document.getElementById('calResponsible').value = savedFilters.responsible;
  if (savedFilters.status) document.getElementById('calStatus').value = savedFilters.status;
  if (savedFilters.priority) document.getElementById('calPriority').value = savedFilters.priority;

  initFullCalendar();
}

function getFilteredCalendarPendencias() {
  const cid  = document.getElementById('calClient')?.value || '';
  const resp = document.getElementById('calResponsible')?.value || '';
  const st   = document.getElementById('calStatus')?.value || '';
  const pr   = document.getElementById('calPriority')?.value || '';
  // Escopo por equipe: mesma base da listagem (pendencias.js) e das visitas
  // acima — getMyPendencias() = filterByTeam; admin com time selecionado usa
  // getPendenciasByTeam. Sem isso o calendário lia getPendencias() global.
  // (Segurança real continua no RLS/banco; aqui só se apresenta o permitido.)
  const scoped = (typeof isTeamAdmin === 'function' && isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam && typeof getPendenciasByTeam === 'function')
    ? getPendenciasByTeam(_selectedTeam)
    : (typeof getMyPendencias === 'function' ? getMyPendencias()
      : (typeof getPendencias === 'function' ? getPendencias() : []));
  return scoped.filter(p => {
    if (!p.deadline) return false;
    if (!st && isPendenciaClosed(p.status)) return false;
    if (cid  && p.clientId   !== cid)   return false;
    if (resp && p.responsible !== resp) return false;
    if (st   && p.status     !== st)    return false;
    if (pr   && p.priority   !== pr)    return false;
    return true;
  });
}

function getFilteredCalendarVisits() {
  const cid  = document.getElementById('calClient')?.value || '';
  const resp = document.getElementById('calResponsible')?.value || '';
  const base = isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam ? getVisitsByTeam(_selectedTeam) : getMyVisits();
  return base.filter(v => {
    if (!v.date) return false;
    if (cid  && v.clientId !== cid) return false;
    if (resp && v.operator !== resp) return false;
    return true;
  });
}

function mapPendenciasToEvents(pendencias) {
  return pendencias.map(p => {
    const ev = penEventColors(p);

    return {
      id: 'PEN-' + p.id,
      title: getPendenciaTitulo(p),
      start: p.deadline,
      allDay: true,
      backgroundColor: ev.fill,
      textColor: '#fff',
      borderColor: ev.border,
      borderWidth: ev.width,
      classNames: ['fc-event-pendencia'],
      extendedProps: {
        kind: 'pendencia',
        penId: p.id,
        clientId: p.clientId,
        clientName: p.clientName,
        responsible: p.responsible,
        status: p.status,
        priority: p.priority,
        tipo: p.tipo,
        isOverdue: ev.overdue,
        evFill: ev.fill,
        evBorder: ev.border,
      },
    };
  });
}

function mapVisitsToEvents(visits) {
  return visits.map(v => {
    const c = VISIT_COLORS[v.status] || VISIT_COLORS.agendada;
    const rangeLabel = typeof formatVisitTimeRange === 'function' ? formatVisitTimeRange(v) : (v.time || '');
    const timeLabel = rangeLabel && rangeLabel !== '—' ? ' ⏰' + rangeLabel : '';
    const allDay = v.allDay === true || !v.time;
    let start = v.date;
    let end = undefined;
    if (!allDay && v.date && v.time) {
      const tStart = (v.time || '').toString().slice(0, 5);
      start = v.date + 'T' + tStart + ':00';
      if (v.timeEnd) {
        const tEnd = (v.timeEnd || '').toString().slice(0, 5);
        end = v.date + 'T' + tEnd + ':00';
      }
    }
    const visitNum = (typeof formatVisitNumero === 'function') ? formatVisitNumero(v) + ' · ' : '';
    return {
      id: 'VIS-' + v.id,
      title: '🚗 ' + visitNum + (v.clientName || '—'),
      start,
      end,
      allDay,
      backgroundColor: c.bg,
      textColor: '#fff',
      borderColor: c.border,
      borderWidth: 2,
      classNames: ['fc-event-visit'],
      extendedProps: {
        kind: 'visit',
        visitId: v.id,
        clientId: v.clientId,
        clientName: v.clientName,
        operator: v.operator,
        status: v.status,
        motivo: v.motivo,
        time: v.time,
        timeEnd: v.timeEnd,
        allDay: v.allDay === true,
        observacoes: v.observacoes,
      },
    };
  });
}

// ── Bottom-sheet do dia ─────────────────────────────────────────────────────
function openCalendarDaySheet(dateStr) {
  const type = document.getElementById('calType')?.value || 'all';
  const allPens = type === 'visitas' ? [] : getFilteredCalendarPendencias().filter(p => p.deadline === dateStr);
  const allVisits = type === 'pendencias' ? [] : getFilteredCalendarVisits().filter(v => v.date === dateStr);
  const total = allPens.length + allVisits.length;
  const title = formatDate(dateStr) + (total ? ` — ${total} evento(s)` : ' — sem eventos');

  let html = `<div style="max-height:60vh;overflow-y:auto">`;
  if (!total) {
    html += `<p style="font-size:13px;color:var(--text-muted);padding:12px;text-align:center">Nenhum evento neste dia.</p>`;
  } else {
    if (allVisits.length) {
      html += `<div style="font-size:11px;font-weight:700;color:var(--text-secondary);margin:8px 0 6px">Visitas (${allVisits.length})</div>`;
      html += allVisits.map(v => {
        const c = typeof getClientById === 'function' ? getClientById(v.clientId) : null;
        return `<div style="display:flex;gap:8px;align-items:center;padding:8px 10px;border:1px solid var(--border);border-radius:6px;margin-bottom:6px;cursor:pointer" onclick="closeModal();openVisitDetail('${escapeHtml(v.id)}')">
          ${c ? clientAvatar(c, 24) : ''}<div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:600">${escapeHtml(v.clientName||'—')}</div><div style="font-size:11px;color:var(--text-muted)">${escapeHtml(v.motivo||'—')} · ${escapeHtml(v.operator||'—')} ${formatVisitTimeRange(v)!=='—'?'· '+escapeHtml(formatVisitTimeRange(v)):''}</div></div>${visitStatusTag(v.status)}</div>`;
      }).join('');
    }
    if (allPens.length) {
      html += `<div style="font-size:11px;font-weight:700;color:var(--text-secondary);margin:8px 0 6px">Pendências (${allPens.length})</div>`;
      html += allPens.map(p => {
        const c = typeof getClientById === 'function' ? getClientById(p.clientId) : null;
        return `<div style="display:flex;gap:8px;align-items:center;padding:8px 10px;border:1px solid var(--border);border-radius:6px;margin-bottom:6px;cursor:pointer" onclick="closeModal();openPendenciaDetail('${escapeHtml(p.id)}')">
          ${c ? clientAvatar(c, 24) : ''}<div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:500">${escapeHtml(getPendenciaTitulo(p))}</div><div style="font-size:11px;color:var(--text-muted)">${escapeHtml(p.clientName||'—')} · ${escapeHtml(p.responsible||'—')}</div></div><div style="display:flex;gap:4px">${priorityTag(p.priority)} ${statusTag(p.status)}</div></div>`;
      }).join('');
    }
  }
  html += `</div>`;
  html += `<div style="display:flex;gap:8px;margin-top:14px;padding-top:12px;border-top:1px solid var(--border)"><button class="btn btn-primary btn-sm" onclick="closeModal();openPendenciaForm(null,null,'${escapeHtml(dateStr)}')">+ Pendência em ${escapeHtml(dateStr)}</button><button class="btn btn-secondary btn-sm" style="background:#0ea5e9;border-color:#0ea5e9;color:#fff" onclick="closeModal();openVisitForm(null,'${escapeHtml(dateStr)}')">+ Visita em ${escapeHtml(dateStr)}</button><button class="btn btn-secondary btn-sm" style="margin-left:auto" onclick="closeModal()">Fechar</button></div>`;

  openModal(title, html, 'sm');
  // Acessibilidade: bottom-sheet em mobile
  const modal = document.getElementById('modal');
  if (window.innerWidth <= 768) {
    modal.style.marginTop = 'auto';
    modal.style.borderRadius = '16px 16px 0 0';
    modal.style.maxHeight = '75vh';
  }
}

async function initFullCalendar() {
  const container = document.getElementById('calendarContainer');
  if (!container) return;

  // Feedback imediato: no 1º acesso o FullCalendar vem do CDN e a grade
  // ficava vazia sem explicação enquanto baixava (ou para sempre, se
  // a rede falhava — sem try/catch o erro era silencioso).
  container.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>Carregando calendário…</p></div>';
  try {
    await _loadFullCalendarWithTimeout(15000);
  } catch (_) {
    container.innerHTML = '<div class="empty-state"><p>Não foi possível carregar o calendário. Verifique sua conexão.</p><button class="btn btn-secondary btn-sm" onclick="initFullCalendar()">Tentar novamente</button></div>';
    return;
  }

  if (typeof FullCalendar === 'undefined') {
    container.innerHTML = '<div class="empty-state"><p>Erro ao carregar FullCalendar.</p><button class="btn btn-secondary btn-sm" onclick="initFullCalendar()">Tentar novamente</button></div>';
    return;
  }

  const events = getCalendarEvents();

  const isDark = document.body.classList.contains('dark-theme');

  if (_fcInstance) {
    _fcInstance.destroy();
    _fcInstance = null;
  }
  if (!_agView) _agView = agDefaultView();

  // Estilo da Agenda vive em css/styles.css (seção AGENDA); sem <style> injetado.

  _fcInstance = new FullCalendar.Calendar(container, {
    locale: 'pt-br',
    initialView: agFcView(_agView),
    // Navegação própria no cabeçalho da Agenda (agNav/agToday/agSetView).
    headerToolbar: false,
    events: events,
    eventDisplay: 'block',
    dayMaxEvents: 3,
    moreLinkContent: function(args){ return '+' + args.num + ' mais'; },
    nowIndicator: true,
    height: 'auto',
    fixedWeekCount: false,
    showNonCurrentDates: true,
    eventContent: function(arg) {
      const props = arg.event.extendedProps;
      if (props.kind === 'visit') {
        return { html: agChipHtml('visit', props.clientName || 'Visita', agDotFor('visit'), false) };
      }
      // Mesma regra central (penEventColors), lida das props calculadas no mapa.
      const fill = props.evFill || (PRIORITY_COLORS[props.priority] || PRIORITY_COLORS.media).bg;
      return { html: agChipHtml('pendencia', arg.event.title, fill, !!props.isOverdue) };
    },
    eventClick: function(info) {
      info.jsEvent.preventDefault();
      info.jsEvent.stopPropagation();
      const props = info.event.extendedProps;
      if (props.kind === 'visit') {
        if (typeof openVisitDetail === 'function') openVisitDetail(props.visitId);
      } else {
        if (typeof openPendenciaDetail === 'function') openPendenciaDetail(props.penId);
      }
    },
    dateClick: function(info) {
      openCalendarDaySheet(info.dateStr);
    },
    moreLinkClick: function(info){
      info.jsEvent.preventDefault();
      openCalendarDaySheet(info.date.toISOString().slice(0,10));
      return 'none';
    },
    dayCellDidMount: function(info){
      const d = info.date;
      // Fim de semana com fundo suave (visual da Agenda)
      const day = d.getDay();
      if (day === 0 || day === 6) {
        info.el.classList.add('fc-day-weekend');
      }
    },
    eventDidMount: function(info) {
      const props = info.event.extendedProps;
      let title = info.event.title;
      if (props.kind === 'visit') {
        const statusLabel = (typeof VISIT_STATUS_MAP !== 'undefined' && VISIT_STATUS_MAP[props.status]?.label) || props.status;
        const range = typeof formatVisitTimeRange === 'function' ? formatVisitTimeRange(props) : (props.time || '');
        title = `🚗 Visita: ${props.motivo || '—'}\nCliente: ${props.clientName || '—'}\nOperador: ${props.operator || '—'}\nStatus: ${statusLabel}${range && range !== '—' ? '\nHorário: ' + range : ''}`;
      } else {
        const statusLabel = STATUS_PEN_MAP[props.status]?.label || props.status;
        const priorityLabel = PRIORITY_MAP[props.priority]?.label || props.priority;
        const overdueText = props.isOverdue ? '⚠️ VENCIDA! ' : '';
        title = `${overdueText}${info.event.title}\nCliente: ${props.clientName || '—'}\nResponsável: ${props.responsible || '—'}\nStatus: ${statusLabel}\nPrioridade: ${priorityLabel}`;
      }
      info.el.title = title;
    },
    viewDidMount: function() {
      applyCalendarDarkMode(isDark);
    },
    datesSet: function() {
      renderAgendaSide();
    },
  });

  _fcInstance.render();
  applyCalendarDarkMode(isDark);
  _paintAgNav();
  renderAgendaSide();
}

function _agMonthKey(d) {
  try {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  } catch (_) { return ''; }
}
function _agPriBadge(priority) {
  var label = (typeof PRIORITY_MAP !== 'undefined' && PRIORITY_MAP[priority]) ? PRIORITY_MAP[priority].label : (priority || '');
  if (!label) return '';
  return '<span class="badge ' + String(priority || '') + '">' + ((typeof escapeHtml === 'function') ? escapeHtml(label.toLowerCase()) : label) + '</span>';
}
// Sidebar da Agenda: Vencidas + Próximos 7 dias + Visitas recorrentes.
function renderAgendaSide() {
  var box = document.getElementById('agendaSide');
  if (!box) return;
  var esc = _agEsc;
  var todayStr = (typeof localDateISO === 'function') ? localDateISO() : new Date().toISOString().slice(0, 10);
  var pens = [], visits = [];
  try { pens = getFilteredCalendarPendencias(); } catch (_) { pens = []; }
  try { visits = getFilteredCalendarVisits(); } catch (_) { visits = []; }
  var monthKey = todayStr.slice(0, 7);
  try { if (_fcInstance && typeof _fcInstance.getDate === 'function') monthKey = _agMonthKey(_fcInstance.getDate()); } catch (_) {}
  var isClosed = (typeof isPendenciaClosed === 'function') ? isPendenciaClosed : function () { return false; };
  var openPens = pens.filter(function (p) { return !isClosed(p.status); });

  var html = '';
  var overdue = agOverdueItems(openPens, todayStr).slice(0, 5);
  if (overdue.length) {
    html += '<div class="card ag-card"><h2 class="ag-card-danger">Vencidas <span class="count">— resolver primeiro</span></h2><ul class="plist">' +
      overdue.map(function (o) {
        return '<li onclick="openPendenciaDetail(\'' + esc(o.id) + '\')"><div class="pbar" style="background:#b3122a"></div>' +
          '<div class="ptext"><div class="ttitle">' + esc(o.title) + '</div><div class="tmeta">' + esc(o.meta) + '</div></div></li>';
      }).join('') + '</ul></div>';
  }
  var next7 = agNext7Items(openPens, visits, todayStr).slice(0, 6);
  html += '<div class="card ag-card"><h2>Próximos 7 dias <span class="count">' + next7.length + (next7.length === 1 ? ' item' : ' itens') + '</span></h2>' +
    (next7.length
      ? '<ul class="plist">' + next7.map(function (o) {
        var fn = o.kind === 'visit' ? 'openVisitDetail' : 'openPendenciaDetail';
        var badge = o.kind === 'visit' ? '' : _agPriBadge(o.priority);
        return '<li onclick="' + fn + '(\'' + esc(o.id) + '\')"><div class="pbar" style="background:' + o.dot + '"></div>' +
          '<div class="ptext"><div class="ttitle">' + esc(o.title) + badge + '</div><div class="tmeta">' + esc(o.meta) + '</div></div></li>';
      }).join('') + '</ul>'
      : '<div class="empty-state" style="padding:12px 4px 4px"><p>Nada nos próximos 7 dias 🎉</p></div>') +
    '</div>';
  var rec = agRecurringGroups(visits, monthKey);
  if (rec.length) {
    html += '<div class="card ag-card"><h2>Visitas recorrentes</h2><ul class="plist">' +
      rec.map(function (g) {
        return '<li onclick="openVisitDetail(\'' + esc(g.visitId) + '\')"><div class="pbar" style="background:#0ea5e9"></div>' +
          '<div class="ptext"><div class="ttitle">' + esc(g.clientName) + '</div><div class="tmeta">' + esc(g.meta) + '</div></div></li>';
      }).join('') + '</ul></div>';
  }
  box.innerHTML = html;
}

function getCalendarEvents() {
  const type = document.getElementById('calType')?.value || 'all';
  const events = [];
  if (type === 'all' || type === 'pendencias') {
    events.push(...mapPendenciasToEvents(getFilteredCalendarPendencias()));
  }
  if (type === 'all' || type === 'visitas') {
    events.push(...mapVisitsToEvents(getFilteredCalendarVisits()));
  }
  return events;
}

function refreshCalendar() {
  if (!_fcInstance) return;
  const type        = document.getElementById('calType')?.value || 'all';
  const client      = document.getElementById('calClient')?.value || '';
  const responsible = document.getElementById('calResponsible')?.value || '';
  const status      = document.getElementById('calStatus')?.value || '';
  const priority    = document.getElementById('calPriority')?.value || '';
  saveFilterState('calendar', {type, client, responsible, status, priority});
  const events = getCalendarEvents();
  _fcInstance.removeAllEvents();
  _fcInstance.addEventSource(events);
  renderAgendaSide();
}

function applyCalendarDarkMode(isDark) {
  const container = document.getElementById('calendarContainer');
  if (!container) return;
  if (isDark) {
    container.style.setProperty('--fc-bg-event', 'rgba(255,255,255,0.06)');
    container.style.setProperty('--fc-border-color', 'rgba(255,255,255,0.1)');
    container.style.setProperty('--fc-button-bg-color', 'rgba(255,255,255,0.06)');
    container.style.setProperty('--fc-button-border-color', 'rgba(255,255,255,0.12)');
    container.style.setProperty('--fc-button-hover-bg-color', 'rgba(26,86,219,0.25)');
    container.style.setProperty('--fc-button-hover-border-color', '#3b82f6');
    container.style.setProperty('--fc-button-active-bg-color', '#1a56db');
    container.style.setProperty('--fc-button-active-border-color', '#1a56db');
    container.style.setProperty('--fc-today-bg-color', 'rgba(26,86,219,0.12)');
    container.style.setProperty('--fc-page-bg-color', 'transparent');
    container.style.setProperty('--fc-neutral-bg-color', 'rgba(255,255,255,0.04)');
    container.style.setProperty('--fc-list-event-hover-bg-color', 'rgba(255,255,255,0.06)');
    const table = container.querySelector('.fc');
    if (table) table.style.color = '#e2e8f0';
    const title = container.querySelector('.fc-toolbar-title');
    if (title) title.style.color = '#f1f5f9';
  } else {
    container.style.removeProperty('--fc-bg-event');
    container.style.removeProperty('--fc-border-color');
    container.style.removeProperty('--fc-button-bg-color');
    container.style.removeProperty('--fc-button-border-color');
    container.style.removeProperty('--fc-button-hover-bg-color');
    container.style.removeProperty('--fc-button-hover-border-color');
    container.style.removeProperty('--fc-button-active-bg-color');
    container.style.removeProperty('--fc-button-active-border-color');
    container.style.removeProperty('--fc-today-bg-color');
    container.style.removeProperty('--fc-page-bg-color');
    container.style.removeProperty('--fc-neutral-bg-color');
    container.style.removeProperty('--fc-list-event-hover-bg-color');
    const table = container.querySelector('.fc');
    if (table) table.style.color = '';
    const title = container.querySelector('.fc-toolbar-title');
    if (title) title.style.color = '';
  }
}

function _icsEscape(str) {
  return String(str || '').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n');
}
function _icsDate(dateStr) {
  return String(dateStr || '').replace(/-/g, '');
}
function exportCalendarICS() {
  const pens = getFilteredCalendarPendencias();
  const visits = getFilteredCalendarVisits();
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Init Intra//PT'];
  pens.forEach(p => {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:pen-${p.id}`);
    lines.push(`DTSTART;VALUE=DATE:${_icsDate(p.deadline)}`);
    lines.push(`SUMMARY:${_icsEscape(getPendenciaTitulo(p))}`);
    lines.push(`DESCRIPTION:${_icsEscape((p.clientName || '') + ' — ' + (p.responsible || ''))}`);
    lines.push('END:VEVENT');
  });
  visits.forEach(v => {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:vis-${v.id}`);
    const allDay = v.allDay === true || !v.time;
    if (allDay) {
      lines.push(`DTSTART;VALUE=DATE:${_icsDate(v.date)}`);
    } else {
      const t = (v.time || '').toString().slice(0, 5).replace(':', '');
      lines.push(`DTSTART:${_icsDate(v.date)}T${t}00`);
    }
    lines.push(`SUMMARY:${_icsEscape('Visita: ' + (v.clientName || ''))}`);
    lines.push(`DESCRIPTION:${_icsEscape((v.motivo || '') + ' — ' + (v.operator || ''))}`);
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'init-intra-calendario.ics';
  a.click();
  URL.revokeObjectURL(url);
  showToast('Calendário .ics exportado!', 'success');
}
