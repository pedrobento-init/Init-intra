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

function renderCalendar() {
  document.getElementById('pageTitle').textContent = 'Calendário de Prazos';
  setTopbarAction('Nova Pendência', '<svg class="topbar-action-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>');
  window._topbarAction = () => openPendenciaForm();
  if (typeof updateBadges === 'function') updateBadges();

  const clients = isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam ? getClientsByTeam(_selectedTeam) : getMyClients();
  const team    = isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam ? _selectedTeam : getCurrentTeam();
  const opNames = getOperatorNames(team);

  document.getElementById('contentArea').innerHTML = `
    <div class="search-bar">
      <select class="form-select filter-select-md" id="calType" onchange="refreshCalendar()" title="Tipo de evento">
        <option value="all">Pendências + Visitas</option>
        <option value="pendencias">Apenas Pendências</option>
        <option value="visitas">Apenas Visitas</option>
      </select>
      <select class="form-select filter-select-md" id="calClient" onchange="refreshCalendar()">
        <option value="">Todos os clientes</option>
        ${clients.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('')}
      </select>
      <select class="form-select filter-select-md" id="calResponsible" onchange="refreshCalendar()">
        <option value="">Todos os responsáveis</option>
        ${opNames.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('')}
      </select>
      <select class="form-select filter-select" id="calStatus" onchange="refreshCalendar()">
        <option value="">Todos os status</option>
        ${Object.entries(STATUS_PEN_MAP).map(([k,v])=>`<option value="${k}">${escapeHtml(v.label)}</option>`).join('')}
      </select>
      <select class="form-select filter-select-sm" id="calPriority" onchange="refreshCalendar()">
        <option value="">Prioridade</option>
        <option value="baixa">Baixa</option>
        <option value="media">Média</option>
        <option value="alta">Alta</option>
        <option value="critica">Crítica</option>
      </select>
      <button class="btn btn-primary btn-sm btn-new-action" onclick="openPendenciaForm()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Nova Pendência
      </button>
      <button class="btn btn-primary btn-sm btn-new-visit" onclick="openVisitForm()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 16H9m10 0h3v-3.15a1 1 0 0 0-.84-.99L16 11l-2.7-3.6a1 1 0 0 0-.8-.4H5.24a2 2 0 0 0-1.8 1.1l-.8 1.63A6 6 0 0 0 2 12.42V16h2"/><circle cx="6.5" cy="16.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/></svg>
        Nova Visita
      </button>
      <button class="btn btn-secondary btn-sm" onclick="exportCalendarICS()" title="Baixar calendário em .ics (Google/Outlook)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        iCal
      </button>
    </div>
    <div class="card" style="padding:0;overflow:hidden">
      <div class="cal-legend" id="calLegend" style="display:flex;gap:12px;flex-wrap:wrap;padding:10px 16px;border-bottom:1px solid var(--border);font-size:11px;align-items:center;background:var(--bg-secondary)">
        <span style="font-weight:700;color:var(--text-secondary)">Legenda:</span>
        <span style="display:inline-flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:2px;background:#0ea5e9;display:inline-block"></span> Visita</span>
        <span style="display:inline-flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:2px;background:#991b1b;display:inline-block"></span> Crítica</span>
        <span style="display:inline-flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:2px;background:#dc2626;display:inline-block"></span> Alta</span>
        <span style="display:inline-flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:2px;background:#d97706;display:inline-block"></span> Média</span>
        <span style="display:inline-flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:2px;background:#16a34a;display:inline-block"></span> Baixa</span>
        <span style="display:inline-flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:2px;background:#dc2626;display:inline-block;border:2px solid #991b1b"></span> Vencida</span>
      </div>
      <div id="calendarContainer" style="padding:16px"></div>
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
  return getPendencias().filter(p => {
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
    return {
      id: 'VIS-' + v.id,
      title: '🚗 ' + (v.clientName || '—'),
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

// ── Heatmap: conta deadlines por dia ────────────────────────────────────────
function getDeadlineHeatMap() {
  const map = {};
  try {
    const pens = getFilteredCalendarPendencias();
    pens.forEach(p => {
      const d = p.deadline;
      if (!d) return;
      map[d] = (map[d] || 0) + 1;
    });
  } catch(_) {}
  return map;
}
function getHeatLevel(count) {
  if (!count) return 0;
  if (count === 1) return 1;
  if (count === 2) return 2;
  if (count >= 3) return 3;
  return 0;
}

// ── Bottom-sheet do dia ─────────────────────────────────────────────────────
function openCalendarDaySheet(dateStr) {
  const heatMap = getDeadlineHeatMap();
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

  await loadFullCalendar();

  if (typeof FullCalendar === 'undefined') {
    container.innerHTML = '<div class="empty-state"><p>Erro ao carregar FullCalendar. Recarregue a página.</p></div>';
    return;
  }

  const events = getCalendarEvents();
  const heatMap = getDeadlineHeatMap();

  const isDark = document.body.classList.contains('dark-theme');
  const isMobile = window.innerWidth <= 768;

  if (_fcInstance) {
    _fcInstance.destroy();
    _fcInstance = null;
  }

  // Injeta CSS dedicado do calendário (heatmap, fim de semana, hoje, altura adaptativa)
  let calStyle = document.getElementById('calCustomStyle');
  if (!calStyle) {
    calStyle = document.createElement('style');
    calStyle.id = 'calCustomStyle';
    document.head.appendChild(calStyle);
  }
  calStyle.textContent = `
    .fc .fc-daygrid-day.fc-day-weekend { background: rgba(148,163,184,0.10) !important; }
    .fc .fc-col-header-cell.fc-day-sat, .fc .fc-col-header-cell.fc-day-sun { background: rgba(148,163,184,0.18) !important; color:#475569 !important; }
    .dark-theme .fc .fc-col-header-cell.fc-day-sat, .dark-theme .fc .fc-col-header-cell.fc-day-sun { color: var(--text-secondary) !important; }
    .dark-theme .fc .fc-daygrid-day.fc-day-weekend { background: rgba(71,85,105,0.18) !important; }
    .fc .fc-day-today { background: rgba(26,86,219,0.10) !important; border: 2px solid #1a56db !important; }
    .fc .fc-day-today .fc-daygrid-day-number { background:#1a56db;color:#fff;border-radius:50%;width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;font-weight:800; }
    .fc .fc-button.fc-today-button { background:#1a56db !important;border-color:#1a56db !important;color:#fff !important;font-weight:700 !important;box-shadow:0 2px 8px rgba(26,86,219,0.35) !important; }
    .fc .fc-button.fc-today-button:hover { background:#1444b8 !important; }
    .fc-day-heat-1 { background: rgba(220,38,38,0.06) !important; }
    .fc-day-heat-2 { background: rgba(220,38,38,0.12) !important; }
    .fc-day-heat-3 { background: rgba(220,38,38,0.20) !important; }
    .fc-daygrid-day.fc-day-no-events { min-height: 60px !important; }
    .fc-daygrid-day.fc-day-no-events .fc-daygrid-day-frame { min-height: 60px !important; }
    .fc-daygrid-day { cursor: pointer; }
    @media (max-width:768px){
      .fc .fc-daygrid-event { padding:1px 2px !important; }
      .fc-event-compact .fc-event-title { display:none !important; }
      .fc-event-compact .fc-event-badge { width:8px;height:8px;border-radius:50%;display:inline-block !important; }
    }
  `;

  _fcInstance = new FullCalendar.Calendar(container, {
    locale: 'pt-br',
    initialView: isMobile ? 'dayGridMonth' : 'dayGridMonth',
    headerToolbar: isMobile ? {
      left: 'prev,next',
      center: 'title',
      right: 'today',
    } : {
      left: 'prev,next today',
      center: 'title',
      right: 'dayGridMonth,timeGridWeek,listWeek',
    },
    buttonText: {
      today: 'Hoje',
      month: 'Mês',
      week: 'Semana',
      list: 'Lista',
      prev: '‹',
      next: '›',
    },
    events: events,
    eventDisplay: 'block',
    dayMaxEvents: isMobile ? 3 : 4,
    moreLinkContent: function(args){ return '+' + args.num + ' mais'; },
    nowIndicator: true,
    height: 'auto',
    fixedWeekCount: false,
    showNonCurrentDates: true,
    eventContent: function(arg) {
      const props = arg.event.extendedProps;
      // Mobile compacto: se coluna muito estreita, mostra só badge
      try {
        const colWidth = arg.el.closest('.fc-daygrid-day')?.offsetWidth || 0;
        const isCompact = isMobile || colWidth < 90;
        if (isCompact && props.kind === 'pendencia') {
          // Mesma regra central (penEventColors), lida das props calculadas no mapa.
          const fill = props.evFill || (PRIORITY_COLORS[props.priority] || PRIORITY_COLORS.media).bg;
          const border = props.evBorder || (props.isOverdue ? '#991b1b' : fill);
          return { html: '<span class="fc-event-badge" style="width:8px;height:8px;border-radius:50%;background:' + fill + ';border:2px solid ' + border + ';display:inline-block"></span>' };
        }
      } catch(_){}
      if (props.kind !== 'visit') return true;
      const client = typeof getClientById === 'function' ? getClientById(props.clientId) : null;
      const avatar = client ? (typeof clientAvatar === 'function' ? clientAvatar(client, 20) : props.clientName) : props.clientName;
      const name = props.clientName || '—';
      return { html: '<div class="fc-visit-content"><span class="fc-visit-icon">🚗</span>' + avatar + '<span class="fc-visit-name">' + name + '</span></div>' };
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
      const dateStr = info.date.toISOString().slice(0,10);
      const d = info.date;
      // Fim de semana
      const day = d.getDay();
      if (day === 0 || day === 6) {
        info.el.classList.add('fc-day-weekend');
      }
      // Heatmap
      const cnt = heatMap[dateStr] || 0;
      const lvl = getHeatLevel(cnt);
      if (lvl) info.el.classList.add('fc-day-heat-' + lvl);
      if (lvl) info.el.title = cnt + ' pendência(s) com vencimento neste dia';
      // Altura adaptativa: marca dias sem evento
      const hasEvents = events.some(ev => {
        const evDate = (ev.start || '').toString().slice(0,10);
        return evDate === dateStr;
      });
      if (!hasEvents) info.el.classList.add('fc-day-no-events');
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
      // Reaplica altura adaptativa após view montar
      setTimeout(()=> {
        document.querySelectorAll('.fc-daygrid-day').forEach(el=>{
          const dateStr = el.getAttribute('data-date');
          if (!dateStr) return;
          const has = events.some(ev => (ev.start||'').toString().slice(0,10)===dateStr);
          if (!has) el.classList.add('fc-day-no-events');
        });
      }, 30);
    },
  });

  _fcInstance.render();
  applyCalendarDarkMode(isDark);
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
  const heatMap = getDeadlineHeatMap();
  _fcInstance.removeAllEvents();
  _fcInstance.addEventSource(events);
  // Reaplica heatmap e altura adaptativa
  setTimeout(()=>{
    document.querySelectorAll('.fc-daygrid-day').forEach(el=>{
      const dateStr = el.getAttribute('data-date');
      if (!dateStr) return;
      el.classList.remove('fc-day-heat-1','fc-day-heat-2','fc-day-heat-3','fc-day-no-events');
      const day = new Date(dateStr+'T12:00:00').getDay();
      if (day===0||day===6) el.classList.add('fc-day-weekend');
      const cnt = heatMap[dateStr]||0;
      const lvl = getHeatLevel(cnt);
      if (lvl) el.classList.add('fc-day-heat-'+lvl);
      const has = events.some(ev => (ev.start||'').toString().slice(0,10)===dateStr);
      if (!has) el.classList.add('fc-day-no-events');
    });
  }, 30);
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
