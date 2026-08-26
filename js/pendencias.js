// pendencias.js

const TIPOS = ['Projeto','Operacional / Interno','Manutenção','Suporte','Outro'];

const PEN_KANBAN_COLS = [
  { id: 'aberto',       label: 'Aberto',       color: '#3b82f6' },
  { id: 'em_andamento', label: 'Em Andamento',  color: '#6366f1' },
  { id: 'pausado',      label: 'Pausado',       color: '#f59e0b' },
  { id: 'aguardando',   label: 'Aguardando',    color: '#d97706' },
  { id: 'concluido',    label: 'Concluído',     color: '#22c55e' },
  { id: 'cancelado',    label: 'Cancelado',     color: '#64748b' },
];

let penView = 'kanban';
let _filteredPens = [];

function renderPendencias() {
  document.getElementById('pageTitle').textContent = 'Pendências';
  setTopbarAction('+ Nova Pendência', '<svg class="topbar-action-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>');
  window._topbarAction = () => openPendenciaForm();

  const saved = loadFilterState('pendencias', {});

  const clients  = isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam ? getClientsByTeam(_selectedTeam) : getMyClients();
  const team     = isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam ? _selectedTeam : getCurrentTeam();
  const opNames  = getOperatorNames(team);

  document.getElementById('contentArea').innerHTML = `
    <div class="search-bar">
      <div class="search-input-wrap filter-grow">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input class="form-input" id="penSearch" placeholder="Buscar..." oninput="savePenFilters();debouncedRenderPenView()" />
      </div>
      <select class="form-select filter-select-md" id="penClient" onchange="savePenFilters();renderPenView()">
        <option value="">Todos os clientes</option>
        ${clients.map(c=>`<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('')}
      </select>
      <select class="form-select filter-select-md" id="penResponsible" onchange="savePenFilters();renderPenView()">
        <option value="">Todos os responsáveis</option>
        ${opNames.map(n=>`<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('')}
      </select>
      <select class="form-select filter-select" id="penStatus" onchange="savePenFilters();renderPenView()">
        <option value="">Todos os status</option>
        <option value="aberto">Aberto</option>
        <option value="em_andamento">Em Andamento</option>
        <option value="pausado">Pausado</option>
        <option value="aguardando">Aguardando</option>
        <option value="concluido">Concluído</option>
        <option value="cancelado">Cancelado</option>
      </select>
      <select class="form-select filter-select-sm" id="penPriority" onchange="savePenFilters();renderPenView()">
        <option value="">Prioridade</option>
        <option value="baixa">Baixa</option>
        <option value="media">Média</option>
        <option value="alta">Alta</option>
        <option value="critica">Crítica</option>
      </select>
    </div>
    <div class="page-action-row">
      <div style="flex:1"></div>
      <button class="btn btn-primary btn-new-action" onclick="openPendenciaForm()" aria-label="Nova Pendência">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Nova Pendência
      </button>
    </div>
    <div id="penViewArea"></div>`;
  if (saved.search) document.getElementById('penSearch').value = saved.search;
  if (saved.client) document.getElementById('penClient').value = saved.client;
  if (saved.resp) document.getElementById('penResponsible').value = saved.resp;
  if (saved.status) document.getElementById('penStatus').value = saved.status;
  if (saved.priority) document.getElementById('penPriority').value = saved.priority;
  showSkeleton('penViewArea', 6);
  renderPenView();
}

function renderPenView(resetPage) {
  var area = document.getElementById('penViewArea');
  if (!area) return;
  setTimeout(function() {
    _filteredPens = getFilteredPendencias();
    renderPenKanban(area);
  }, 10);
}

// ── Kanban drag-and-drop de pendências ───────────────────────────────────────
function isPenMobile() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 768px)').matches;
}

function renderPenKanban(area) {
  var pens = _filteredPens;
  if (isPenMobile()) {
    area.innerHTML = renderPenMobileGrid(pens);
  } else {
    area.innerHTML = '<div class="kanban-board">' + 
      PEN_KANBAN_COLS.map(function(col) {
        var cards = pens.filter(function(p) { return p.status === col.id; });
        return '<div class="kanban-col"' +
          ' ondragover="event.preventDefault();this.classList.add(\'drag-over\')"' +
          ' ondragleave="this.classList.remove(\'drag-over\')"' +
          ' ondrop="onPenKanbanDrop(event,\'' + col.id + '\')">' +
          '<div class="kanban-col-header">' +
            '<div class="kanban-col-title">' +
              '<span style="width:10px;height:10px;border-radius:50%;background:' + col.color + ';display:inline-block"></span> ' +
              escapeHtml(col.label) +
            '</div>' +
            '<span class="kanban-col-count">' + cards.length + '</span>' +
          '</div>' +
          '<div class="kanban-cards">' +
            (cards.length
              ? cards.map(function(p) { return penKanbanCard(p); }).join('')
              : '<div class="empty-state" style="padding:30px 10px"><p>Nenhuma</p><button class="btn btn-primary btn-sm" onclick="openPendenciaForm()">+ Nova Pendência</button></div>') +
          '</div>' +
        '</div>';
      }).join('') +
    '</div>';
  }
  _applyPenCardMotion(area);
}

function _applyPenCardMotion(area) {
  if (typeof Motion === 'undefined') return;
  area.querySelectorAll('.pen-mobile-card').forEach(function(card) {
    Motion.press(card,
      function() { Motion.animate(card, { scale: 0.97 }, { duration: 0.1 }); },
      function() { Motion.animate(card, { scale: 1 }, { duration: 0.25, ease: 'easeOut' }); }
    );
  });
  area.querySelectorAll('.kanban-card').forEach(function(card) {
    Motion.hover(card,
      function() { Motion.animate(card, { y: -3 }, { duration: 0.2, ease: 'easeOut' }); },
      function() { Motion.animate(card, { y: 0 }, { duration: 0.2, ease: 'easeOut' }); }
    );
  });
}

function penKanbanCard(p) {
  var c = getClientById(p.clientId);
  var isOverdue = p.deadline && p.deadline < localDateISO() && !['concluido','cancelado'].includes(p.status);
  var sla = slaCountdown(p, 48);
  return '<div class="kanban-card"' +
    ' draggable="true"' +
    ' ondragstart="onPenKanbanDragStart(event,\'' + escapeHtml(p.id) + '\')"' +
    ' ondragend="onPenKanbanDragEnd(event)"' +
    ' onclick="openPendenciaDetail(\'' + escapeHtml(p.id) + '\')">' +
    '<div class="kanban-card-title">' + escapeHtml(p.descricao || 'Sem descrição') + '</div>' +
    '<div class="kanban-card-meta">' +
      (c ? clientAvatar(c, 18) : '') + ' ' +
      escapeHtml(p.clientName || '—') +
    '</div>' +
    '<div class="kanban-card-meta" style="margin-top:6px">' +
      priorityTag(p.priority) + ' ' +
      '<span style="font-size:11px">' + escapeHtml(p.responsible || '—') + '</span>' +
      (isOverdue ? ' <span style="color:#dc2626;font-weight:600">⚠️ Vencida</span>' : '') +
      (sla ? ' <span style="color:' + sla.color + ';font-weight:600;font-size:11px">⏱ ' + sla.label + '</span>' : '') +
    '</div>' +
    '<div class="kanban-card-meta" style="margin-top:4px">' +
      timerWidget(p, "pendencia") +
    '</div>' +
    (p.deadline ? '<div class="kanban-card-meta" style="margin-top:4px;font-size:11px">📅 ' + formatDate(parseDeadline(p.deadline)) + '</div>' : '') +
  '</div>';
}

function renderPenMobileGrid(pens) {
  if (!pens.length) {
    return '<div class="card"><div class="empty-state"><p>Nenhuma pendência encontrada.</p><button class="btn btn-primary btn-sm" onclick="openPendenciaForm()">+ Nova Pendência</button></div></div>';
  }
  return '<div class="pen-mobile-grid">' + pens.map(penMobileCard).join('') + '</div>';
}

function penMobileCard(p) {
  const c = getClientById(p.clientId);
  const st = STATUS_PEN_MAP[p.status] || { label: p.status || '—', dot: '#94a3b8' };
  const isOverdue = p.deadline && p.deadline < localDateISO() && !['concluido','cancelado'].includes(p.status);
  const sla = slaCountdown(p, 48);
  return '<div class="pen-mobile-card" style="border-left-color:' + st.dot + '" onclick="openPendenciaDetail(\'' + escapeHtml(p.id) + '\')">' +
    '<div class="pen-mobile-card-top">' +
      '<div class="pen-mobile-card-client">' +
        (c ? clientAvatar(c, 22) : '') +
        '<span>' + escapeHtml(p.clientName || '—') + '</span>' +
      '</div>' +
      statusTag(p.status) +
    '</div>' +
    '<div class="pen-mobile-card-desc">' + escapeHtml(p.descricao || 'Sem descrição') + '</div>' +
    '<div class="pen-mobile-card-meta">' +
      priorityTag(p.priority) +
      '<span>' + escapeHtml(p.responsible || '—') + '</span>' +
      (isOverdue ? '<span class="pen-mobile-overdue">⚠️ Vencida</span>' : '') +
      (sla ? '<span style="color:' + sla.color + ';font-weight:600">⏱ ' + sla.label + '</span>' : '') +
    '</div>' +
    '<div class="pen-mobile-card-footer">' +
      (p.deadline ? '<span>📅 ' + formatDate(parseDeadline(p.deadline)) + '</span>' : '<span>Sem prazo</span>') +
      timerWidget(p, 'pendencia') +
    '</div>' +
  '</div>';
}

function onPenKanbanDragStart(e, id) {
  e.dataTransfer.setData('penId', id);
  e.dataTransfer.effectAllowed = 'move';
  e.currentTarget.classList.add('dragging');
}

function onPenKanbanDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
}

function onPenKanbanDrop(e, colId) {
  e.preventDefault();
  document.querySelectorAll('.kanban-col').forEach(function(c) { c.classList.remove('drag-over'); });
  var id = e.dataTransfer.getData('penId');
  var p = getPendenciaById(id);
  if (!p || p.status === colId) return;
  var oldStatus = p.status;
  p.status = colId;
  savePendencia(p);
  updateBadges();
  renderPenView(false);
  var colLabel = PEN_KANBAN_COLS.find(function(c) { return c.id === colId; });
  showToast('Pendência movida para "' + (colLabel ? colLabel.label : colId) + '"', 'success');
}

function getFilteredPendencias() {
  const q    = (document.getElementById('penSearch')?.value||'').toLowerCase();
  const cid  = document.getElementById('penClient')?.value||'';
  const resp = document.getElementById('penResponsible')?.value||'';
  const st   = document.getElementById('penStatus')?.value||'';
  const pr   = document.getElementById('penPriority')?.value||'';
  var base = isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam ? getPendenciasByTeam(_selectedTeam) : getMyPendencias();
  return base.filter(p => {
    if (q && !p.descricao?.toLowerCase().includes(q) && !p.clientName?.toLowerCase().includes(q) && !p.responsible?.toLowerCase().includes(q)) return false;
    if (cid  && p.clientId   !== cid)  return false;
    if (resp && p.responsible !== resp) return false;
    if (st   && p.status     !== st)   return false;
    if (pr   && p.priority   !== pr)   return false;
    return true;
  });
}

function savePenFilters() {
  saveFilterState('pendencias', {
    search: document.getElementById('penSearch')?.value||'',
    client: document.getElementById('penClient')?.value||'',
    resp: document.getElementById('penResponsible')?.value||'',
    status: document.getElementById('penStatus')?.value||'',
    priority: document.getElementById('penPriority')?.value||'',
    view: penView
  });
}

window.debouncedRenderPenView = debounce(renderPenView, 300);

let _penMobileState = null;
window.addEventListener('resize', debounce(function() {
  const area = document.getElementById('penViewArea');
  if (!area || penView !== 'kanban') return;
  const nowMobile = isPenMobile();
  if (_penMobileState === null) _penMobileState = nowMobile;
  if (nowMobile === _penMobileState) return;
  _penMobileState = nowMobile;
  renderPenView(false);
}, 200));

function openPendenciaDetail(id) {
  const p = getPendenciaById(id);
  if (!p) return;
  const c = getClientById(p.clientId);
  openModal(`${escapeHtml(p.id)} – ${escapeHtml(p.descricao)||'Pendência'}`, `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;align-items:center">
      <select class="form-select filter-select" id="chgStatus">
        ${Object.entries(STATUS_PEN_MAP).map(([k,v])=>`<option value="${k}" ${p.status===k?'selected':''}>${escapeHtml(v.label)}</option>`).join('')}
      </select>
      <button class="btn btn-primary btn-sm" onclick="changePenStatus('${escapeHtml(id)}')">Atualizar Status</button>
      <button class="btn btn-secondary btn-sm" onclick="closeModal();openPendenciaForm('${escapeHtml(id)}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Editar</button>
      <div style="margin-left:auto" class="timer-row">${timerWidget(p, 'pendencia')}</div>
    </div>
    <div class="ticket-info-grid">
      <div class="ticket-info-item"><div class="ticket-info-label">Cliente</div><div class="ticket-info-value">${c?`<div style="display:flex;align-items:center;gap:6px">${clientAvatar(c,22)}<span>${escapeHtml(p.clientName)}</span></div>`:escapeHtml(p.clientName)||'—'}</div></div>
      <div class="ticket-info-item"><div class="ticket-info-label">Tipo</div><div class="ticket-info-value">${escapeHtml(p.tipo)||'—'}</div></div>
      <div class="ticket-info-item"><div class="ticket-info-label">Responsável</div><div class="ticket-info-value">${escapeHtml(p.responsible)||'—'}</div></div>
      <div class="ticket-info-item"><div class="ticket-info-label">Prioridade</div><div class="ticket-info-value">${priorityTag(p.priority)}</div></div>
      <div class="ticket-info-item"><div class="ticket-info-label">Prazo</div><div class="ticket-info-value">${p.deadline?formatDate(parseDeadline(p.deadline)):'Sem prazo'}</div></div>
      <div class="ticket-info-item"><div class="ticket-info-label">Aberto em</div><div class="ticket-info-value">${formatDate(p.createdAt)}</div></div>
      <div class="ticket-info-item"><div class="ticket-info-label">Trabalhando agora</div><div class="ticket-info-value">${getCurrentWorker(p) ? workerBadgeHTML(p) + ' — ' + timerDisplayHTML(p) : '<span style="color:var(--text-muted)">Ninguém</span>'}</div></div>
      <div class="ticket-info-item"><div class="ticket-info-label">Tempo acumulado</div><div class="ticket-info-value">${formatTimer(getElapsedSeconds(p))}</div></div>
    </div>
    ${p.linkUtil && safeUrl(p.linkUtil) !== '#' ?`<div class="form-group"><label class="form-label">Link Útil</label><a href="${safeUrl(p.linkUtil)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm">🔗 Abrir link</a></div>`:''}
    
    <hr class="divider"/>
    <div class="attachment-section">
      <div class="section-header" style="margin-bottom:8px">
        <span class="section-title">📎 Anexos (Máx 2MB por arquivo)</span>
        <label class="btn btn-secondary btn-sm" style="cursor:pointer">
          + Anexar Arquivo
          <input type="file" id="penFileInput" style="display:none" onchange="handleFileUpload('pendencias','${id}',this,()=>renderAttachmentList('pendencias','${id}','penAttachmentsList'))" />
        </label>
      </div>
      <div class="attachment-list" id="penAttachmentsList"></div>
    </div>

    <hr class="divider"/>
    <div class="section-header"><span class="section-title">Notas da Atualização (Ata)</span></div>
    <div class="timeline" id="penTimeline">
      ${(p.notes||[]).length ? (p.notes).map(n=>`
        <div class="timeline-item">
          <div class="timeline-dot">&#x270F;&#xFE0F;</div>
          <div class="timeline-content">
            <div class="timeline-meta">👤 <strong>${escapeHtml(n.author)}</strong> · ${formatDateTime(n.createdAt)}</div>
            <div class="timeline-text">${escapeHtml(n.text)}</div>
          </div>
        </div>`).join('') : '<p class="text-muted">Nenhuma nota ainda.</p>'}
    </div>
    <hr class="divider"/>
    <div class="section-header"><span class="section-title">☑ Checklist</span></div>
    <div id="penChecklist"></div>
    <div style="display:flex;gap:6px;margin-top:8px">
      <input class="form-input" id="newCheckItem" placeholder="Nova sub-tarefa..." onkeydown="if(event.key==='Enter'){event.preventDefault();addCheckItem('${escapeHtml(id)}')}" />
      <button class="btn btn-sm btn-primary" onclick="addCheckItem('${escapeHtml(id)}')">+</button>
    </div>
    <hr class="divider"/>
    <div class="form-group pen-note-compose"><label class="form-label">Nova Nota</label>
      <textarea class="form-textarea" id="newNoteText" rows="3" placeholder="O que foi feito? Decisões tomadas?"></textarea></div>
    <div class="pen-note-actions">
      <button type="button" class="btn btn-primary" onclick="submitPenNote('${escapeHtml(id)}')">&#x1F4DD; Registrar Nota</button>
    </div>
  `);
  setTimeout(() => {
    renderAttachmentList('pendencias', id, 'penAttachmentsList');
    renderPenChecklist(id);
  }, 20);
}

function changePenStatus(id) {
  const p = getPendenciaById(id);
  p.status = document.getElementById('chgStatus').value;
  savePendencia(p);
  updateBadges();
  showToast('Status atualizado!', 'success');
  openPendenciaDetail(id);
  if (typeof renderPenView === 'function' && document.getElementById('penViewArea')) renderPenView(false);
  if (typeof refreshCalendar === 'function' && document.getElementById('calendarContainer')) refreshCalendar();
}

function submitPenNote(id) {
  const text = document.getElementById('newNoteText').value.trim();
  if (!text) { showToast('Escreva algo antes de registrar.', 'error'); return; }
  addPendenciaNote(id, text, getUser().name);
  showToast('Nota registrada!', 'success');
  openPendenciaDetail(id);
  renderPenView(false);
}

function openPendenciaForm(id = null, preClientId = null, preDate = null) {
  const p           = id ? getPendenciaById(id) : {};
  const clients     = isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam ? getClientsByTeam(_selectedTeam) : getMyClients();
  const opNames     = getOperatorNames(isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam ? _selectedTeam : getCurrentTeam());
  const currentResp = p.responsible || getUser().name;

  openModal(id ? 'Editar Pendência' : 'Nova Pendência', `
    <form onsubmit="submitPendenciaForm(event,'${escapeHtml(id||'')}')">
      <div class="form-row">
        <div class="form-group"><label class="form-label">Cliente</label>
          <select class="form-select" name="clientId">
            <option value="">Sem cliente</option>
            ${clients.map(c=>`<option value="${escapeHtml(c.id)}" ${((p.clientId||preClientId)===c.id)?'selected':''}>${escapeHtml(c.name)}</option>`).join('')}
          </select></div>
        <div class="form-group"><label class="form-label">Tipo de Ação</label>
          <select class="form-select" name="tipo">
            ${TIPOS.map(t=>`<option ${p.tipo===t?'selected':''}>${escapeHtml(t)}</option>`).join('')}
          </select></div>
      </div>
      <div class="form-group"><label class="form-label">Descrição da Pendência *</label>
        <textarea class="form-textarea" name="descricao" rows="3" placeholder="Descreva o que precisa ser feito..." required>${escapeHtml(p.descricao||'')}</textarea></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Responsável</label>
          <select class="form-select" name="responsible">
            ${opNames.length
              ? opNames.map(name => `<option value="${escapeHtml(name)}" ${currentResp===name?'selected':''}>${escapeHtml(name)}</option>`).join('')
              : `<option value="${escapeHtml(currentResp)}">${escapeHtml(currentResp)}</option>`
            }
          </select></div>
        <div class="form-group"><label class="form-label">Status</label>
          <select class="form-select" name="status">
            ${Object.entries(STATUS_PEN_MAP).map(([k,v])=>`<option value="${k}" ${(p.status||'aberto')===k?'selected':''}>${escapeHtml(v.label)}</option>`).join('')}
          </select></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Prioridade</label>
          <select class="form-select" name="priority">
            <option value="baixa"  ${p.priority==='baixa'?'selected':''}>Baixa</option>
            <option value="media"  ${(!p.priority||p.priority==='media')?'selected':''}>Média</option>
            <option value="alta"   ${p.priority==='alta'?'selected':''}>Alta</option>
            <option value="critica"${p.priority==='critica'?'selected':''}>Crítica</option>
          </select></div>
        <div class="form-group"><label class="form-label">Prazo Limite</label>
          <input type="date" class="form-input" name="deadline" value="${escapeHtml(p.deadline||preDate||'')}" /></div>
      </div>
      <div class="form-group"><label class="form-label">Link Útil (opcional)</label>
        <input class="form-input" name="linkUtil" value="${escapeHtml(p.linkUtil||'')}" placeholder="https://..." /></div>
      <div class="form-group"><label class="form-label">Tags (separadas por vírgula)</label>
        <input class="form-input" name="tags" value="${escapeHtml((p.tags||[]).join(', '))}" placeholder="Ex: urgente, firewall, vpn" /></div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn-primary"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Salvar</button>
      </div>
    </form>`);
}

function submitPendenciaForm(e, id) {
  e.preventDefault();
  try {
    const fd = new FormData(e.target);
    const g  = k => fd.get(k)||'';
    const descricao = g('descricao').trim();
    const linkUtil = g('linkUtil').trim();
    const clientId = g('clientId');
    const client   = clientId ? getClientById(clientId) : null;
    if (clientId && !client) {
      showToast('Cliente inválido.', 'error');
      return;
    }
    if (client && !isTeamAdmin() && (client.team || 'init') !== getCurrentTeam()) {
      showToast('Você não pode criar pendências para clientes de outra equipe.', 'error');
      return;
    }
    const tagsRaw = g('tags').split(',').map(function(t){return t.trim();}).filter(Boolean);
    const data = {
      id: id||null, clientId, clientName: client?.name||'', tipo: g('tipo'),
      descricao, responsible: g('responsible'), status: g('status'),
      priority: g('priority'), deadline: g('deadline'),
      linkUtil: safeUrl(linkUtil) !== '#' ? linkUtil : '',
      tags: tagsRaw,
    };
    const errors = validatePendencia(data);
    if (errors.length) { showToast(errors[0], 'error'); return; }
    savePendencia(data);
    closeModal();
    renderPenView(false);
    updateBadges();
    showToast(id?'Pendência atualizada!':'Pendência criada!', 'success');
  } catch (err) { showToast('Erro ao salvar pendência: ' + err.message, 'error'); }
}

function deletePendenciaConfirm(id) {
  var p = getPendenciaById(id);
  if (!p) return;
  confirmAction('Excluir esta pendência?', function() {
    var snapshot = JSON.parse(JSON.stringify(p));
    if (!deletePendencia(id)) {
      showToast('Não foi possível excluir esta pendência.', 'error');
      return;
    }
    renderPenView(false);
    updateBadges();
    showUndoToast('Pendência removida.', function() {
      savePendencia(snapshot);
      renderPenView(false);
      updateBadges();
      showToast('Pendência restaurada.', 'success');
    });
  });
}

function renderPenChecklist(id) {
  var p = getPendenciaById(id);
  if (!p) return;
  var list = p.checklist || [];
  var el = document.getElementById('penChecklist');
  if (!el) return;
  if (!list.length) {
    el.innerHTML = '<p class="text-muted" style="font-size:12px;padding:4px 0">Nenhuma sub-tarefa.</p>';
    return;
  }
  el.innerHTML = list.map(function(item, i) {
    return '<label style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer;font-size:13px">' +
      '<input type="checkbox" ' + (item.done ? 'checked' : '') + ' onchange="toggleCheckItem(\'' + escapeHtml(id) + '\',' + i + ')" style="accent-color:var(--accent);width:16px;height:16px" />' +
      '<span style="' + (item.done ? 'text-decoration:line-through;color:var(--text-muted)' : '') + '">' + escapeHtml(item.text) + '</span>' +
      '<button class="btn btn-sm btn-danger" onclick="removeCheckItem(\'' + escapeHtml(id) + '\',' + i + ')" style="margin-left:auto;padding:2px 6px;font-size:10px">✕</button>' +
    '</label>';
  }).join('');
}

function addCheckItem(id) {
  var input = document.getElementById('newCheckItem');
  var text = input ? input.value.trim() : '';
  if (!text) return;
  var p = getPendenciaById(id);
  if (!p) return;
  if (!p.checklist) p.checklist = [];
  p.checklist.push({ text: text, done: false });
  savePendencia(p);
  if (input) input.value = '';
  renderPenChecklist(id);
  renderPenView(false);
  showToast('Sub-tarefa adicionada.', 'success');
}

function toggleCheckItem(id, index) {
  var p = getPendenciaById(id);
  if (!p || !p.checklist) return;
  p.checklist[index].done = !p.checklist[index].done;
  savePendencia(p);
  renderPenChecklist(id);
  renderPenView(false);
}

function removeCheckItem(id, index) {
  var p = getPendenciaById(id);
  if (!p || !p.checklist) return;
  p.checklist.splice(index, 1);
  savePendencia(p);
  renderPenChecklist(id);
  renderPenView(false);
  showToast('Sub-tarefa removida.', 'info');
}
