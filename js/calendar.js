// calendar.js

let _fcInstance = null;

const PRIORITY_COLORS = {
  baixa:   { bg: '#16a34a', text: '#fff' },
  media:   { bg: '#d97706', text: '#fff' },
  alta:    { bg: '#dc2626', text: '#fff' },
  critica: { bg: '#991b1b', text: '#fff' },
};

const STATUS_COLORS = {
  aberto:        '#3b82f6',
  em_andamento:  '#6366f1',
  pausado:       '#f59e0b',
  aguardando:    '#7c3aed',
  concluido:     '#16a34a',
  cancelado:     '#94a3b8',
};

const VISIT_COLORS = {
  agendada:     { bg: '#0ea5e9', border: '#0284c7' },
  em_andamento: { bg: '#f59e0b', border: '#d97706' },
  concluida:    { bg: '#16a34a', border: '#15803d' },
  cancelada:    { bg: '#94a3b8', border: '#64748b' },
};

function renderCalendar() {
  document.getElementById('pageTitle').textContent = 'Calendário de Prazos';
  setTopbarAction('+ Adicionar Pendência', '<svg class="topbar-action-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>');
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
        <option value="aberto">Aberto</option>
        <option value="em_andamento">Em Andamento</option>
        <option value="pausado">Pausado</option>
        <option value="aguardando">Aguardando</option>
        <option value="concluido">Concluído</option>
        <option value="cancelado">Cancelado</option>
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
        Adicionar Pendência
      </button>
      <button class="btn btn-primary btn-sm btn-new-visit" onclick="openVisitForm()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 16H9m10 0h3v-3.15a1 1 0 0 0-.84-.99L16 11l-2.7-3.6a1 1 0 0 0-.8-.4H5.24a2 2 0 0 0-1.8 1.1l-.8 1.63A6 6 0 0 0 2 12.42V16h2"/><circle cx="6.5" cy="16.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/></svg>
        Nova Visita
      </button>
    </div>
    <div class="card" style="padding:0;overflow:hidden">
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
    if (!st && ['concluido', 'cancelado'].includes(p.status)) return false;
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
    const color = PRIORITY_COLORS[p.priority] || PRIORITY_COLORS.media;
    const isOverdue = p.deadline < localDateISO() && !['concluido', 'cancelado'].includes(p.status);
    const statusColor = STATUS_COLORS[p.status] || '#94a3b8';
    const borderColor = isOverdue ? '#dc2626' : statusColor;

    return {
      id: 'PEN-' + p.id,
      title: p.descricao || '(sem descrição)',
      start: p.deadline,
      allDay: true,
      backgroundColor: color.bg,
      textColor: color.text,
      borderColor: borderColor,
      borderWidth: isOverdue ? 3 : 2,
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
        isOverdue: isOverdue,
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

async function initFullCalendar() {
  const container = document.getElementById('calendarContainer');
  if (!container) return;

  // Carrega o CDN do FullCalendar
  await loadFullCalendar();

  if (typeof FullCalendar === 'undefined') {
    container.innerHTML = '<div class="empty-state"><p>Erro ao carregar FullCalendar. Recarregue a página.</p></div>';
    return;
  }

  const events = getCalendarEvents();

  // Se nao tem eventos e queremos evitar tela vazia: mostra o calendario mesmo vazio
  // (antes so renderizava se houvesse pendência com deadline — agr mostra sempre)

  const isDark = document.body.classList.contains('dark-theme');
  const isMobile = window.innerWidth <= 768;

  if (_fcInstance) {
    _fcInstance.destroy();
    _fcInstance = null;
  }

  _fcInstance = new FullCalendar.Calendar(container, {
    locale: 'pt-br',
    initialView: isMobile ? 'listWeek' : 'dayGridMonth',
    headerToolbar: isMobile ? {
      left: 'prev,next',
      center: 'title',
      right: 'listWeek,dayGridMonth',
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
    dayMaxEvents: isMobile ? 2 : 4,
    nowIndicator: true,
    height: 'auto',
    eventContent: function(arg) {
      const props = arg.event.extendedProps;
      if (props.kind !== 'visit') return true; // pendências: default
      const client = typeof getClientById === 'function' ? getClientById(props.clientId) : null;
      const avatar = client ? (typeof clientAvatar === 'function' ? clientAvatar(client, 20) : props.clientName) : props.clientName;
      const name = props.clientName || '—';
      return { html: '<div class="fc-visit-content"><span class="fc-visit-icon">🚗</span>' + avatar + '<span class="fc-visit-name">' + name + '</span></div>' };
    },
    eventClick: function(info) {
      info.jsEvent.preventDefault();
      const props = info.event.extendedProps;
      if (props.kind === 'visit') {
        if (typeof openVisitDetail === 'function') openVisitDetail(props.visitId);
      } else {
        if (typeof openPendenciaDetail === 'function') openPendenciaDetail(props.penId);
      }
    },
    dateClick: function(info) {
      const dateStr = info.dateStr;
      if (typeof openPendenciaForm === 'function') {
        openPendenciaForm(null, null, dateStr);
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
  _fcInstance.removeAllEvents();
  _fcInstance.addEventSource(events);
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
    container.style.setProperty('--fc-today-bg-color', 'rgba(26,86,219,0.08)');
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
