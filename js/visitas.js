// visitas.js – Registro e acompanhamento de Visitas Técnicas

const VISIT_PAGE_SIZE = 30;
let _visitPage = 1;
let _filteredVisits = [];

function renderVisitas() {
  document.getElementById('pageTitle').textContent = 'Visitas Técnicas';
  setTopbarAction('+ Nova Visita', '<svg class="topbar-action-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 16H9m10 0h3v-3.15a1 1 0 0 0-.84-.99L16 11l-2.7-3.6a1 1 0 0 0-.8-.4H5.24a2 2 0 0 0-1.8 1.1l-.8 1.63A6 6 0 0 0 2 12.42V16h2"/><circle cx="6.5" cy="16.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/></svg>');
  window._topbarAction = () => openVisitForm();

  const clients  = isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam ? getClientsByTeam(_selectedTeam) : getMyClients();
  const team     = isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam ? _selectedTeam : getCurrentTeam();
  const opNames  = getOperatorNames(team);

  const _nowRpt = new Date();
  window._visitReportDefaultMonth = `${_nowRpt.getFullYear()}-${String(_nowRpt.getMonth() + 1).padStart(2, '0')}`;

  document.getElementById('contentArea').innerHTML = `
    <div class="search-bar" style="flex-wrap:wrap;gap:10px">
      <div class="search-input-wrap" style="flex:1;min-width:180px">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input class="form-input" id="visitSearch" placeholder="Buscar por cliente, motivo..." oninput="saveVisitFilters();debouncedRenderVisitView()" />
      </div>
      <select class="form-select" id="visitClient" style="width:180px" onchange="saveVisitFilters();renderVisitView()">
        <option value="">Todos os clientes</option>
        ${clients.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('')}
      </select>
      <select class="form-select" id="visitOperator" style="width:200px" onchange="saveVisitFilters();renderVisitView()">
        <option value="">Todos os operadores</option>
        ${opNames.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('')}
      </select>
      <select class="form-select" id="visitStatus" style="width:160px" onchange="saveVisitFilters();renderVisitView()">
        <option value="">Todos os status</option>
        <option value="agendada">Agendada</option>
        <option value="em_andamento">Em andamento</option>
        <option value="concluida">Concluída</option>
        <option value="cancelada">Cancelada</option>
      </select>
      <input type="date" class="form-input" id="visitFrom" style="width:140px" onchange="saveVisitFilters();renderVisitView()" title="De" />
      <input type="date" class="form-input" id="visitTo" style="width:140px" onchange="saveVisitFilters();renderVisitView()" title="Até" />
      <button type="button" class="btn btn-secondary btn-sm" onclick="openVisitMonthReportModal()" title="Relatório mensal para Google Sheets">
        Relatório do mês
      </button>
    </div>
    <div id="visitStats" style="margin-bottom:14px"></div>
    <div id="visitViewArea"></div>`;

  const saved = loadFilterState('visitas', {});
  if (saved.search)   document.getElementById('visitSearch').value   = saved.search;
  if (saved.client)   document.getElementById('visitClient').value   = saved.client;
  if (saved.operator) document.getElementById('visitOperator').value = saved.operator;
  if (saved.status)   document.getElementById('visitStatus').value   = saved.status;
  if (saved.from)     document.getElementById('visitFrom').value     = saved.from;
  if (saved.to)       document.getElementById('visitTo').value       = saved.to;
  showSkeleton('visitViewArea', 6);
  renderVisitView();
}

window.debouncedRenderVisitView = debounce(() => renderVisitView(), 300);

function saveVisitFilters() {
  const state = {
    search:   document.getElementById('visitSearch')?.value || '',
    client:   document.getElementById('visitClient')?.value || '',
    operator: document.getElementById('visitOperator')?.value || '',
    status:   document.getElementById('visitStatus')?.value || '',
    from:     document.getElementById('visitFrom')?.value || '',
    to:       document.getElementById('visitTo')?.value || '',
  };
  saveFilterState('visitas', state);
}

function getFilteredVisits() {
  const base = isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam
    ? getVisitsByTeam(_selectedTeam)
    : getMyVisits();
  const q   = (document.getElementById('visitSearch')?.value || '').toLowerCase();
  const cid = document.getElementById('visitClient')?.value || '';
  const op  = document.getElementById('visitOperator')?.value || '';
  const st  = document.getElementById('visitStatus')?.value || '';
  const fr  = document.getElementById('visitFrom')?.value || '';
  const to  = document.getElementById('visitTo')?.value || '';
  return base.filter(v => {
    if (q && !(v.motivo || '').toLowerCase().includes(q)
         && !(v.clientName || '').toLowerCase().includes(q)
         && !(v.observacoes || '').toLowerCase().includes(q)
         && !(v.operator || '').toLowerCase().includes(q)) return false;
    if (cid && v.clientId !== cid) return false;
    if (op  && v.operator !== op) return false;
    if (st  && v.status   !== st)  return false;
    if (fr  && (v.date || '') < fr) return false;
    if (to  && (v.date || '') > to) return false;
    return true;
  }).sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.time || '').localeCompare(a.time || ''));
}

function renderVisitView(resetPage) {
  const area = document.getElementById('visitViewArea');
  if (!area) return;
  setTimeout(() => {
    if (resetPage !== false) _visitPage = 1;
    _filteredVisits = getFilteredVisits();
    renderVisitStats();
    renderVisitTable(area);
  }, 10);
}

function renderVisitStats() {
  const wrap = document.getElementById('visitStats');
  if (!wrap) return;
  const team = isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam ? _selectedTeam : getCurrentTeam();
  const ops = getOperatorNames(team);
  const today = localDateISO();
  const base = isTeamAdmin() && _selectedTeam ? getVisitsByTeam(_selectedTeam) : getMyVisits();
  const total    = base.length;
  const todayN   = base.filter(v => v.date === today).length;
  const upcoming = base.filter(v => v.date >= today && v.status === 'agendada').length;
  const doneMonth = base.filter(v => {
    if (!v.date || v.status !== 'concluida') return false;
    const d = parseDateOnly(v.date);
    const now = _brasiliaNow();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }).length;
  wrap.innerHTML = `
    <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">
      <div class="stat-card"><div class="stat-label">Total de visitas</div><div class="stat-value">${total}</div></div>
      <div class="stat-card"><div class="stat-label">Hoje</div><div class="stat-value" style="color:#0ea5e9">${todayN}</div></div>
      <div class="stat-card"><div class="stat-label">Agendadas (futuras)</div><div class="stat-value" style="color:#f59e0b">${upcoming}</div></div>
      <div class="stat-card"><div class="stat-label">Concluídas no mês</div><div class="stat-value" style="color:#16a34a">${doneMonth}</div></div>
    </div>`;
}

function visitStatusTag(st) {
  const m = VISIT_STATUS_MAP[st] || { label: st || '—', color: '#94a3b8' };
  return `<span class="tag" style="background:${m.color}20;color:${m.color};border:1px solid ${m.color}40;font-weight:600">${escapeHtml(m.label)}</span>`;
}

function renderVisitTable(area) {
  const wrap = area || document.getElementById('visitViewArea');
  if (!wrap) return;
  const visits = _filteredVisits;
  if (!visits.length) {
    wrap.innerHTML = `<div class="card"><div class="empty-state"><p>Nenhuma visita encontrada.</p><button class="btn btn-primary btn-sm" onclick="openVisitForm()">+ Nova Visita</button></div></div>`;
    return;
  }
  const totalPages = Math.ceil(visits.length / VISIT_PAGE_SIZE);
  if (_visitPage > totalPages) _visitPage = totalPages;
  if (_visitPage < 1) _visitPage = 1;
  const startIdx = (_visitPage - 1) * VISIT_PAGE_SIZE;
  const pageVisits = visits.slice(startIdx, startIdx + VISIT_PAGE_SIZE);

  wrap.innerHTML = `<div class="table-wrapper"><table class="pen-table visit-table">
    <thead><tr>
      <th class="col-date">Data</th>
      <th class="col-client">Cliente</th>
      <th class="col-desc">Motivo</th>
      <th class="col-resp">Operador</th>
      <th class="col-status">Status</th>
      <th class="col-actions"></th>
    </tr></thead>
    <tbody>${pageVisits.map(v => {
      const c = getClientById(v.clientId);
      const color = c?.color || '#2563eb';
      return `<tr>
        <td data-label="Data" class="col-date">
          <div class="visit-date-cell">
            <span class="visit-date-main">${v.date ? formatDate(v.date) : '—'}</span>
            ${(v.allDay || v.time || v.timeEnd) ? `<span class="visit-date-time">${escapeHtml(formatVisitTimeRange(v))}</span>` : ''}
          </div>
        </td>
        <td data-label="Cliente" class="col-client">
          <div style="display:flex;align-items:center;gap:8px">
            ${c ? clientAvatar(c, 24) : ''}
            <span class="client-badge" style="background:${escapeHtml(color)}20;color:${escapeHtml(color)};border:1px solid ${escapeHtml(color)}40">${escapeHtml(v.clientName)||'—'}</span>
          </div>
        </td>
        <td data-label="Motivo" class="col-desc col-motivo">
          <div class="col-desc-value col-motivo-value">
            <span class="visit-motivo-text">${escapeHtml(v.motivo)||'—'}</span>
            ${v.observacoes ? `<span class="visit-motivo-obs">${escapeHtml(v.observacoes)}</span>` : ''}
          </div>
        </td>
        <td data-label="Operador" class="col-resp"><span class="resp-badge">${escapeHtml(v.operator)||'—'}</span></td>
        <td data-label="Status" class="col-status">${visitStatusTag(v.status)}</td>
        <td class="col-actions">
          <div style="display:flex;gap:4px">
            <button class="btn btn-sm btn-secondary" onclick="openVisitDetail('${escapeHtml(v.id)}')">Abrir</button>
            <button class="btn btn-sm btn-danger" onclick="deleteVisitConfirm('${escapeHtml(v.id)}')">&#10005;</button>
          </div>
        </td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>
  ${totalPages > 1 ? `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-top:1px solid var(--border)">
      <div style="font-size:12px;color:var(--text-muted)">Mostrando ${startIdx+1}–${Math.min(startIdx+VISIT_PAGE_SIZE, visits.length)} de ${visits.length} visitas</div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-sm btn-secondary" ${_visitPage===1?'disabled':''} onclick="_visitPage--;renderVisitView(false)">← Anterior</button>
        <span style="font-size:13px;padding:4px 8px;display:flex;align-items:center">${_visitPage} / ${totalPages}</span>
        <button class="btn btn-sm btn-secondary" ${_visitPage===totalPages?'disabled':''} onclick="_visitPage++;renderVisitView(false)">Próxima →</button>
      </div>
    </div>` : ''}`;
}

function openVisitForm(id = null, preClientId = null, preDate = null) {
  const v = id ? getVisitById(id) : {};
  const clients = isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam ? getClientsByTeam(_selectedTeam) : getMyClients();
  const team    = isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam ? _selectedTeam : getCurrentTeam();
  const opNames = getOperatorNames(team);
  const currentOp = v.operator || getUser().name;
  const allDay = v.allDay === true;
  const timeStart = (v.time || '').toString().slice(0, 5);
  const timeEnd = (v.timeEnd || '').toString().slice(0, 5);

  openModal(id ? 'Editar Visita' : 'Nova Visita', `
    <form onsubmit="submitVisitForm(event,'${escapeHtml(id||'')}')">
      <div class="form-row">
        <div class="form-group"><label class="form-label">Cliente</label>
          <select class="form-select" name="clientId" required>
            <option value="">Selecione...</option>
            ${clients.map(c => `<option value="${escapeHtml(c.id)}" ${((v.clientId||preClientId)===c.id)?'selected':''}>${escapeHtml(c.name)}</option>`).join('')}
          </select></div>
        <div class="form-group"><label class="form-label">Operador *</label>
          <select class="form-select" name="operator" required>
            ${opNames.length
              ? opNames.map(n => `<option value="${escapeHtml(n)}" ${currentOp===n?'selected':''}>${escapeHtml(n)}</option>`).join('')
              : `<option value="${escapeHtml(currentOp)}">${escapeHtml(currentOp)}</option>`
            }
          </select></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Data *</label>
          <input type="date" class="form-input" name="date" value="${escapeHtml(v.date || preDate || localDateISO())}" required /></div>
        <div class="form-group" style="display:flex;align-items:flex-end;padding-bottom:2px">
          <label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;cursor:pointer;user-select:none;padding:10px 12px;border:1px solid var(--border);border-radius:8px;width:100%;background:var(--bg-base)">
            <input type="checkbox" id="visitAllDay" name="allDay" ${allDay ? 'checked' : ''} onchange="toggleVisitAllDayFields()" style="width:16px;height:16px;accent-color:var(--accent)" />
            Dia inteiro
          </label>
        </div>
      </div>
      <div class="form-row" id="visitTimeFields" style="${allDay ? 'opacity:.45;pointer-events:none' : ''}">
        <div class="form-group"><label class="form-label">Horário de início</label>
          <input type="time" class="form-input" id="visitTimeStart" name="time" value="${escapeHtml(timeStart)}" ${allDay ? 'disabled' : ''} /></div>
        <div class="form-group"><label class="form-label">Horário de fim</label>
          <input type="time" class="form-input" id="visitTimeEnd" name="timeEnd" value="${escapeHtml(timeEnd)}" ${allDay ? 'disabled' : ''} /></div>
      </div>
      <div class="form-group"><label class="form-label">Motivo da visita *</label>
        <input class="form-input" name="motivo" value="${escapeHtml(v.motivo || '')}" placeholder="Ex: Manutenção preventiva, instalação de equipamento..." required /></div>
      <div class="form-group"><label class="form-label">Observações</label>
        <textarea class="form-textarea" name="observacoes" rows="3" placeholder="Detalhes, o que foi feito, pendências...">${escapeHtml(v.observacoes || '')}</textarea></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Status</label>
          <select class="form-select" name="status">
            ${Object.entries(VISIT_STATUS_MAP).map(([k,m]) => `<option value="${k}" ${(v.status||'agendada')===k?'selected':''}>${escapeHtml(m.label)}</option>`).join('')}
          </select></div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn-primary"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Salvar</button>
      </div>
    </form>`);
}

function toggleVisitAllDayFields() {
  const allDay = document.getElementById('visitAllDay')?.checked;
  const wrap = document.getElementById('visitTimeFields');
  const start = document.getElementById('visitTimeStart');
  const end = document.getElementById('visitTimeEnd');
  if (wrap) {
    wrap.style.opacity = allDay ? '.45' : '';
    wrap.style.pointerEvents = allDay ? 'none' : '';
  }
  if (start) start.disabled = !!allDay;
  if (end) end.disabled = !!allDay;
}

function submitVisitForm(e, id) {
  e.preventDefault();
  try {
    const fd = new FormData(e.target);
    const g  = k => (fd.get(k) || '').toString();
    const clientId = g('clientId');
    const client   = clientId ? getClientById(clientId) : null;
    if (clientId && !client) {
      showToast('Cliente inválido.', 'error');
      return;
    }
    if (client && !isTeamAdmin() && (client.team || 'init') !== getCurrentTeam()) {
      showToast('Você não pode registrar visitas para clientes de outra equipe.', 'error');
      return;
    }
    const motivo = g('motivo').trim();
    if (!motivo) { showToast('Informe o motivo da visita.', 'error'); return; }
    const allDay = document.getElementById('visitAllDay')?.checked === true;
    let time = g('time').slice(0, 5);
    let timeEnd = g('timeEnd').slice(0, 5);
    if (allDay) {
      time = '';
      timeEnd = '';
    } else if (time && timeEnd && timeEnd < time) {
      showToast('Horário de fim deve ser igual ou depois do início.', 'error');
      return;
    }
    const data = {
      id: id || null,
      clientId,
      clientName: client?.name || '',
      operator: g('operator'),
      date: g('date'),
      time,
      timeEnd,
      allDay,
      motivo,
      observacoes: g('observacoes').trim(),
      status: g('status') || 'agendada',
    };
    saveVisit(data);
    closeModal();
    if (document.getElementById('visitViewArea')) renderVisitView();
    if (typeof refreshCalendar === 'function' && document.getElementById('calendarContainer')) refreshCalendar();
    if (typeof updateBadges === 'function') updateBadges();
    showToast(id ? 'Visita atualizada!' : 'Visita registrada!', 'success');
  } catch (err) {
    showToast('Erro ao salvar visita: ' + err.message, 'error');
  }
}

function openVisitDetail(id) {
  const v = getVisitById(id);
  if (!v) return;
  const c = getClientById(v.clientId);
  const m = VISIT_STATUS_MAP[v.status] || { label: v.status, color: '#94a3b8' };
  openModal(`Visita ${escapeHtml(v.id)}`, `
    <div class="ticket-info-grid">
      <div class="ticket-info-item"><div class="ticket-info-label">Cliente</div><div class="ticket-info-value">${c ? `<div style="display:flex;align-items:center;gap:6px">${clientAvatar(c,22)}<span>${escapeHtml(v.clientName)}</span></div>` : escapeHtml(v.clientName)||'—'}</div></div>
      <div class="ticket-info-item"><div class="ticket-info-label">Operador</div><div class="ticket-info-value">${escapeHtml(v.operator)||'—'}</div></div>
      <div class="ticket-info-item"><div class="ticket-info-label">Data</div><div class="ticket-info-value">${v.date ? formatDate(v.date) : '—'}</div></div>
      <div class="ticket-info-item"><div class="ticket-info-label">Horário</div><div class="ticket-info-value">${escapeHtml(formatVisitTimeRange(v))}</div></div>
      <div class="ticket-info-item"><div class="ticket-info-label">Status</div><div class="ticket-info-value">${visitStatusTag(v.status)}</div></div>
    </div>
    <hr class="divider"/>
    <div class="form-group"><label class="form-label">Motivo</label>
      <div class="timeline-text">${escapeHtml(v.motivo)||'—'}</div></div>
    ${v.observacoes ? `<div class="form-group"><label class="form-label">Observações</label><div class="timeline-text">${escapeHtml(v.observacoes)}</div></div>` : ''}
    <div class="form-group"><label class="form-label">Alterar status</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <select class="form-select" id="chgVisitStatus" style="width:200px">
          ${Object.entries(VISIT_STATUS_MAP).map(([k,mm]) => `<option value="${k}" ${v.status===k?'selected':''}>${escapeHtml(mm.label)}</option>`).join('')}
        </select>
        <button class="btn btn-primary btn-sm" onclick="changeVisitStatus('${escapeHtml(id)}')">Atualizar</button>
        <button class="btn btn-secondary btn-sm" onclick="closeModal();openVisitForm('${escapeHtml(id)}')">✎ Editar</button>
      </div>
    </div>
  `);
}

function changeVisitStatus(id) {
  const v = getVisitById(id);
  if (!v) return;
  v.status = document.getElementById('chgVisitStatus').value;
  saveVisit(v);
  showToast('Status atualizado!', 'success');
  openVisitDetail(id);
  if (document.getElementById('visitViewArea')) renderVisitView(false);
  if (typeof refreshCalendar === 'function' && document.getElementById('calendarContainer')) refreshCalendar();
  if (typeof updateBadges === 'function') updateBadges();
}

function deleteVisitConfirm(id) {
  const v = getVisitById(id);
  if (!v) return;
  confirmAction('Excluir esta visita?', function() {
    const snapshot = JSON.parse(JSON.stringify(v));
    deleteVisit(id);
    renderVisitView();
    if (typeof refreshCalendar === 'function' && document.getElementById('calendarContainer')) refreshCalendar();
    if (typeof updateBadges === 'function') updateBadges();
    showUndoToast('Visita removida.', function() {
      saveVisit(snapshot);
      renderVisitView();
      if (typeof refreshCalendar === 'function' && document.getElementById('calendarContainer')) refreshCalendar();
      if (typeof updateBadges === 'function') updateBadges();
      showToast('Visita restaurada.', 'success');
    });
  });
}

function openVisitMonthReportModal() {
  const now = new Date();
  const def = window._visitReportDefaultMonth || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  openModal('Relatório mensal de visitas', `
    <form onsubmit="return false;">
      <p style="font-size:13px;color:var(--text-muted);margin:0 0 16px;line-height:1.5">
        Exporta o relatório do mês com <strong>capa</strong>, <strong>resumo por cliente</strong> e <strong>detalhe das visitas</strong>.
        O Excel sai formatado (pronto para enviar). O CSV serve para importar no Google Sheets.
      </p>
      <div class="form-group">
        <label class="form-label">Mês de referência</label>
        <input type="month" class="form-input" name="month" id="visitReportMonth" value="${escapeHtml(def)}" required />
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px">
        <button type="button" class="btn btn-primary" onclick="exportVisitMonthReport('excel')" style="justify-content:center">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M8 13h8M8 17h8M8 9h2"/></svg>
          Excel (.xls)
        </button>
        <button type="button" class="btn btn-secondary" onclick="exportVisitMonthReport('csv')" style="justify-content:center">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          CSV (Sheets)
        </button>
      </div>
      <div class="form-actions" style="margin-top:14px">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Fechar</button>
      </div>
    </form>`);
}

function _visitReportCsvCell(val) {
  const s = (val == null ? '' : String(val)).replace(/\r?\n/g, ' ').replace(/"/g, '""');
  return `"${s}"`;
}

function _visitReportEscHtml(val) {
  return String(val == null ? '' : val)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _visitReportMonthLabel(yStr, mStr) {
  const months = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const m = Number(mStr) - 1;
  return (months[m] || mStr) + ' de ' + yStr;
}

function _visitReportCollect(monthInput) {
  const [yStr, mStr] = monthInput.split('-');
  const prefix = monthInput;
  const base = isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam
    ? getVisitsByTeam(_selectedTeam)
    : getMyVisits();

  const visits = base
    .filter(v => (v.date || '').startsWith(prefix))
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.time || '').localeCompare(b.time || '') || (a.clientName || '').localeCompare(b.clientName || ''));

  const byClient = {};
  const byStatus = {};
  visits.forEach(v => {
    const key = v.clientId || v.clientName || '_sem_cliente';
    if (!byClient[key]) {
      byClient[key] = { clientName: v.clientName || '—', count: 0, motivos: [], operators: new Set() };
    }
    byClient[key].count += 1;
    if (v.motivo) byClient[key].motivos.push(v.motivo);
    if (v.operator) byClient[key].operators.add(v.operator);
    const st = v.status || '—';
    byStatus[st] = (byStatus[st] || 0) + 1;
  });

  const summary = Object.values(byClient)
    .sort((a, b) => b.count - a.count || a.clientName.localeCompare(b.clientName));

  const statusLabel = st => (typeof VISIT_STATUS_MAP !== 'undefined' && VISIT_STATUS_MAP[st]?.label) || st || '—';
  const team = isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam
    ? _selectedTeam
    : (typeof getCurrentTeam === 'function' ? getCurrentTeam() : '');
  const user = typeof getUser === 'function' ? getUser() : null;

  return { yStr, mStr, visits, summary, byStatus, statusLabel, team, user };
}

function _visitReportDownload(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportVisitMonthReport(format) {
  const monthInput = (document.getElementById('visitReportMonth')?.value || '').trim();
  if (!/^\d{4}-\d{2}$/.test(monthInput)) {
    showToast('Selecione um mês válido.', 'error');
    return;
  }

  const data = _visitReportCollect(monthInput);
  if (!data.visits.length) {
    showToast('Nenhuma visita neste mês.', 'error');
    return;
  }

  if (format === 'excel') {
    _exportVisitMonthExcel(data);
  } else {
    _exportVisitMonthCsv(data);
  }
  closeModal();
}

function _exportVisitMonthCsv(data) {
  const { yStr, mStr, visits, summary, statusLabel } = data;
  const lines = [];
  lines.push(['SEÇÃO', 'Cliente', 'Qtd visitas', 'Motivos', 'Operadores'].map(_visitReportCsvCell).join(';'));
  summary.forEach(row => {
    lines.push([
      'RESUMO',
      row.clientName,
      String(row.count),
      row.motivos.join(' | '),
      [...row.operators].join(', '),
    ].map(_visitReportCsvCell).join(';'));
  });
  lines.push('');
  lines.push(['SEÇÃO', 'Data', 'Início', 'Fim', 'Duração', 'Cliente', 'Motivo', 'Operador', 'Status'].map(_visitReportCsvCell).join(';'));
  visits.forEach(v => {
    lines.push([
      'DETALHE',
      v.date || '',
      v.allDay ? 'Dia inteiro' : ((v.time || '').toString().slice(0, 5)),
      v.allDay ? '' : ((v.timeEnd || '').toString().slice(0, 5)),
      formatVisitTimeRange(v),
      v.clientName || '',
      v.motivo || '',
      v.operator || '',
      statusLabel(v.status),
    ].map(_visitReportCsvCell).join(';'));
  });
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  _visitReportDownload(`relatorio_visitas_${yStr}_${mStr}.csv`, blob);
  showToast(`CSV de ${mStr}/${yStr} exportado (${visits.length} visitas).`, 'success');
}

function _exportVisitMonthExcel(data) {
  const { yStr, mStr, visits, summary, byStatus, statusLabel, team, user } = data;
  const monthLabel = _visitReportMonthLabel(yStr, mStr);
  const genAt = new Date();
  const genStr = genAt.toLocaleString('pt-BR');
  const operatorName = (user && user.name) || '—';
  const teamLabel = team || 'Todas';
  const concluida = byStatus['concluida'] || 0;
  const agendada = byStatus['agendada'] || 0;
  const andamento = byStatus['em_andamento'] || 0;
  const cancelada = byStatus['cancelada'] || 0;
  const clientsN = summary.length;

  const th = 'background:#1a56db;color:#ffffff;font-weight:700;font-size:11pt;padding:10px 12px;border:1px solid #1341a8;text-align:left;';
  const td = 'padding:8px 12px;border:1px solid #d0d7de;font-size:10.5pt;vertical-align:top;';
  const tdAlt = td + 'background:#f3f6fb;';
  const kpiBox = 'border:1px solid #d0d7de;background:#f8fafc;padding:12px 14px;text-align:center;';
  const kpiVal = 'font-size:18pt;font-weight:800;color:#1a56db;';
  const kpiLab = 'font-size:9pt;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.03em;';

  let summaryRows = '';
  summary.forEach((row, i) => {
    const s = i % 2 ? tdAlt : td;
    summaryRows += `<tr>
      <td style="${s}">${_visitReportEscHtml(row.clientName)}</td>
      <td style="${s}text-align:center;font-weight:700;color:#1a56db;">${row.count}</td>
      <td style="${s}">${_visitReportEscHtml(row.motivos.join(' · ') || '—')}</td>
      <td style="${s}">${_visitReportEscHtml([...row.operators].join(', ') || '—')}</td>
    </tr>`;
  });

  let detailRows = '';
  visits.forEach((v, i) => {
    const s = i % 2 ? tdAlt : td;
    const d = v.date ? (typeof formatDate === 'function' ? formatDate(v.date) : v.date) : '—';
    detailRows += `<tr>
      <td style="${s}white-space:nowrap;">${_visitReportEscHtml(d)}</td>
      <td style="${s}white-space:nowrap;">${_visitReportEscHtml(v.allDay ? 'Dia inteiro' : ((v.time || '').toString().slice(0, 5) || '—'))}</td>
      <td style="${s}white-space:nowrap;">${_visitReportEscHtml(v.allDay ? '—' : ((v.timeEnd || '').toString().slice(0, 5) || '—'))}</td>
      <td style="${s}white-space:nowrap;">${_visitReportEscHtml(formatVisitTimeRange(v))}</td>
      <td style="${s}">${_visitReportEscHtml(v.clientName || '—')}</td>
      <td style="${s}">${_visitReportEscHtml(v.motivo || '—')}</td>
      <td style="${s}">${_visitReportEscHtml(v.operator || '—')}</td>
      <td style="${s}">${_visitReportEscHtml(statusLabel(v.status))}</td>
    </tr>`;
  });

  const html = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="UTF-8" />
<!--[if gte mso 9]><xml>
 <x:ExcelWorkbook>
  <x:ExcelWorksheets>
   <x:ExcelWorksheet>
    <x:Name>Relatório Visitas</x:Name>
    <x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
   </x:ExcelWorksheet>
  </x:ExcelWorksheets>
 </x:ExcelWorkbook>
</xml><![endif]-->
<style>
  body { font-family: Calibri, Arial, sans-serif; color: #0f172a; }
  table { border-collapse: collapse; }
</style>
</head>
<body>
  <table style="width:100%;border-collapse:collapse;margin-bottom:18px;">
    <tr>
      <td colspan="4" style="background:#1a56db;color:#fff;padding:22px 24px;border:none;">
        <div style="font-size:11pt;font-weight:600;letter-spacing:.08em;opacity:.9;text-transform:uppercase;">Init Intra</div>
        <div style="font-size:22pt;font-weight:800;margin-top:4px;">Relatório de Visitas Técnicas</div>
        <div style="font-size:13pt;margin-top:6px;opacity:.95;">${_visitReportEscHtml(monthLabel)}</div>
      </td>
    </tr>
    <tr>
      <td colspan="4" style="background:#e8eefc;padding:10px 24px;border:none;font-size:10pt;color:#334155;">
        Gerado em <strong>${_visitReportEscHtml(genStr)}</strong>
        &nbsp;·&nbsp; Por <strong>${_visitReportEscHtml(operatorName)}</strong>
        &nbsp;·&nbsp; Equipe <strong>${_visitReportEscHtml(teamLabel)}</strong>
      </td>
    </tr>
  </table>

  <table style="width:100%;border-collapse:separate;border-spacing:10px;margin-bottom:8px;">
    <tr>
      <td style="${kpiBox}"><div style="${kpiVal}">${visits.length}</div><div style="${kpiLab}">Total visitas</div></td>
      <td style="${kpiBox}"><div style="${kpiVal}">${clientsN}</div><div style="${kpiLab}">Clientes</div></td>
      <td style="${kpiBox}"><div style="${kpiVal};color:#16a34a">${concluida}</div><div style="${kpiLab}">Concluídas</div></td>
      <td style="${kpiBox}"><div style="${kpiVal};color:#f59e0b">${agendada}</div><div style="${kpiLab}">Agendadas</div></td>
      <td style="${kpiBox}"><div style="${kpiVal};color:#0ea5e9">${andamento}</div><div style="${kpiLab}">Em andamento</div></td>
      <td style="${kpiBox}"><div style="${kpiVal};color:#94a3b8">${cancelada}</div><div style="${kpiLab}">Canceladas</div></td>
    </tr>
  </table>

  <table style="width:100%;margin:18px 0 8px;">
    <tr><td style="font-size:14pt;font-weight:800;color:#1a56db;border-bottom:3px solid #1a56db;padding:0 0 8px;">1. Resumo por cliente</td></tr>
  </table>
  <table style="width:100%;border-collapse:collapse;">
    <thead>
      <tr>
        <th style="${th}">Cliente</th>
        <th style="${th}text-align:center;width:90px;">Qtd</th>
        <th style="${th}">Motivos</th>
        <th style="${th}">Operadores</th>
      </tr>
    </thead>
    <tbody>
      ${summaryRows}
    </tbody>
  </table>

  <table style="width:100%;margin:28px 0 8px;">
    <tr><td style="font-size:14pt;font-weight:800;color:#1a56db;border-bottom:3px solid #1a56db;padding:0 0 8px;">2. Detalhamento das visitas</td></tr>
  </table>
  <table style="width:100%;border-collapse:collapse;">
    <thead>
      <tr>
        <th style="${th}">Data</th>
        <th style="${th}">Início</th>
        <th style="${th}">Fim</th>
        <th style="${th}">Duração</th>
        <th style="${th}">Cliente</th>
        <th style="${th}">Motivo</th>
        <th style="${th}">Operador</th>
        <th style="${th}">Status</th>
      </tr>
    </thead>
    <tbody>
      ${detailRows}
    </tbody>
  </table>

  <table style="width:100%;margin-top:28px;">
    <tr>
      <td style="font-size:9pt;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:10px;">
        Documento gerado automaticamente pelo Init Intra · Relatório de visitas · ${_visitReportEscHtml(monthLabel)}
      </td>
    </tr>
  </table>
</body>
</html>`;

  const blob = new Blob(['\uFEFF' + html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  _visitReportDownload(`Relatorio_Visitas_${yStr}_${mStr}.xls`, blob);
  showToast(`Excel de ${monthLabel} exportado (${visits.length} visitas).`, 'success');
}
