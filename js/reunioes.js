// reunioes.js — Reunião Mensal (fluxo em carrossel de pendências por cliente)

const _MEETING_CLOSED_STATUSES = ['concluido', 'resolvido', 'cancelado', 'fechado'];

let _meetingState = null;

function _getCurrentMesAno() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function _getMesAnoLabel(mesAno) {
  const [yStr, mStr] = mesAno.split('-');
  const months = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  return (months[parseInt(mStr) - 1] || mStr) + '/' + yStr;
}

function _getReuniaoId(mesAno) {
  return 'REU-' + mesAno;
}

function _getMeetingBaseClients() {
  if (typeof isTeamAdmin === 'function' && isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam) {
    return getClientsByTeam(_selectedTeam);
  }
  return getMyClients();
}

function _getMeetingTeam() {
  if (typeof isTeamAdmin === 'function' && isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam) return _selectedTeam;
  return getCurrentTeam();
}

function _getOpenPensForClient(clientId) {
  const all = getMyPendencias();
  return all.filter(p => p.clientId === clientId && !isPendenciaClosed(p.status) && !(p.reviewedInMeeting && _meetingState && p.reviewedInMeeting === _meetingState.id));
}

function _groupOpenPendenciasByClient(pens) {
  const groups = {};
  pens.forEach(p => {
    if (isPendenciaClosed(p.status)) return;
    if (p.reviewedInMeeting && _meetingState && p.reviewedInMeeting === _meetingState.id) return;
    const key = p.clientId || p.clientName || '_sem_cliente';
    if (!groups[key]) groups[key] = { clientId: p.clientId, clientName: p.clientName || '—', pens: [] };
    groups[key].pens.push(p);
  });
  return Object.values(groups).sort((a, b) => a.clientName.localeCompare(b.clientName, 'pt-BR', { sensitivity: 'base' }));
}

function _refreshCurrentGroupPens() {
  if (!_meetingState) return;
  const g = _meetingState.clients[_meetingState.index];
  if (!g) return;
  g.pens = _getOpenPensForClient(g.clientId);
}

function renderReuniao() {
  document.getElementById('pageTitle').textContent = 'Reunião Mensal';
  const btn = document.getElementById('topbarActionBtn');
  if (btn) btn.style.display = 'none';

  const mesAno = _getCurrentMesAno();
  const label = _getMesAnoLabel(mesAno);
  const existing = getReuniaoById(_getReuniaoId(mesAno));

  if (existing && existing.status === 'aberta') {
    _resumeMeeting(existing, mesAno);
  } else {
    _renderLanding(mesAno, label, existing);
  }
}

function _renderLanding(mesAno, label, existingMeeting) {
  const baseClients = _getMeetingBaseClients();
  const allOpen = getMyPendencias().filter(p => !isPendenciaClosed(p.status));
  const pendenciaCount = allOpen.length;
  const clientesComPend = baseClients.filter(c => _getOpenPensForClient(c.id).length > 0).length;

  const content = document.getElementById('contentArea');
  content.innerHTML = `
    <div class="card" style="max-width:600px;margin:40px auto;text-align:center;padding:40px">
      <div style="font-size:48px;margin-bottom:16px">👥</div>
      <h2 style="margin:0 0 8px;font-size:20px">Reunião Mensal</h2>
      <p style="font-size:16px;color:var(--text-muted);margin:0 0 24px">${label}</p>

      ${existingMeeting && existingMeeting.status === 'encerrada'
        ? `<div style="padding:12px 16px;background:var(--bg-secondary);border-radius:8px;margin-bottom:20px;border:1px solid var(--border)">
            <div style="font-size:13px;color:var(--text-muted);margin-bottom:6px">Esta reunião já foi encerrada</div>
            <div style="font-size:12px">${_formatDateTimeShort(existingMeeting.endedAt)} — ${existingMeeting.relatorio ? 'Relatório disponível' : 'Sem relatório'}</div>
          </div>`
        : ''}

      <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-bottom:24px">
        <div class="stat-card" style="min-width:120px">
          <div class="stat-value" style="font-size:28px;color:var(--accent)">${pendenciaCount}</div>
          <div class="stat-label">Pendências abertas</div>
        </div>
        <div class="stat-card" style="min-width:120px">
          <div class="stat-value" style="font-size:28px">${baseClients.length}</div>
          <div class="stat-label">Clientes na fila</div>
        </div>
        ${baseClients.length > 0 ? `
          <div class="stat-card" style="min-width:120px">
            <div class="stat-value" style="font-size:28px">${clientesComPend}</div>
            <div class="stat-label">Com pendência</div>
          </div>
        ` : ''}
      </div>

      ${baseClients.length === 0
        ? `<div style="padding:20px;background:var(--bg-secondary);border-radius:8px;margin-bottom:20px">
            <p style="color:var(--text-muted);margin:0">Nenhum cliente cadastrado.</p>
          </div>`
        : `<button class="btn btn-primary" style="padding:12px 32px;font-size:15px" onclick="startReuniao('${mesAno}')">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            Iniciar Reunião de ${label}
          </button>`}

      ${existingMeeting && existingMeeting.status === 'encerrada' && existingMeeting.relatorio
        ? `<button class="btn btn-secondary" style="margin-top:12px" onclick="showMeetingReport('${existingMeeting.id}')">📄 Ver Relatório Anterior</button>`
        : ''}
    </div>`;
}

function startReuniao(mesAno) {
  const id = _getReuniaoId(mesAno);
  const now = new Date().toISOString();
  const session = getSession();
  const participants = session ? [session.name] : [];

  const existing = getReuniaoById(id);
  let meeting;
  if (existing) {
    existing.status = 'aberta';
    existing.startedAt = existing.startedAt || now;
    existing.participants = participants;
    meeting = saveReuniao(existing);
  } else {
    meeting = saveReuniao({
      id,
      mesAno,
      status: 'aberta',
      startedAt: now,
      team: getCurrentTeam(),
      relatorio: '',
      participants,
    });
  }

  _meetingState = {
    id: meeting.id,
    mesAno,
    startedAt: meeting.startedAt,
    reviewedIds: new Set(),
    resolvedIds: [],
    notes: [],
    clients: [],
    index: 0,
  };

  _buildClientList();
  _meetingState.index = 0;
  renderMeetingFlow();
}

function _resumeMeeting(meeting, mesAno) {
  _meetingState = {
    id: meeting.id,
    mesAno: meeting.mesAno || mesAno,
    startedAt: meeting.startedAt,
    reviewedIds: new Set(),
    resolvedIds: [],
    notes: [],
    clients: [],
    index: 0,
  };
  _buildClientList();
  renderMeetingFlow();
}

function _buildClientList() {
  if (!_meetingState) return;
  const base = _getMeetingBaseClients().slice().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base', numeric: true }));
  const com = [];
  const sem = [];
  base.forEach(c => {
    const pens = _getOpenPensForClient(c.id);
    const entry = { clientId: c.id, clientName: c.name, clientColor: c.color, clientInitials: c.initials, clientObj: c, pens };
    if (pens.length > 0) com.push(entry); else sem.push(entry);
  });
  _meetingState.clients = [...com, ...sem];
}

function renderMeetingFlow() {
  if (!_meetingState) return;
  const content = document.getElementById('contentArea');
  const { clients, index, mesAno } = _meetingState;
  const label = _getMesAnoLabel(mesAno);

  if (clients.length === 0) {
    _renderMeetingComplete();
    return;
  }

  if (index >= clients.length) {
    _renderMeetingComplete();
    return;
  }

  const group = clients[index];
  const progress = ((index) / clients.length) * 100;
  const comPendCount = clients.filter(c => c.pens.length > 0).length;

  const cardsHtml = group.pens.length > 0
    ? group.pens.map(p => _meetingPenCard(p)).join('')
    : _meetingEmptyClientHtml(group);

  content.innerHTML = `
    <div style="max-width:800px;margin:0 auto">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px">
        <div>
          <h2 style="margin:0;font-size:18px">Reunião ${label}</h2>
          <div style="font-size:12px;color:var(--text-muted);margin-top:4px">
            Iniciada ${_formatDateTimeShort(_meetingState.startedAt)}
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <span style="font-size:13px;color:var(--text-muted)">${_meetingState.notes.length} notas · ${_meetingState.resolvedIds.length} resolvidas</span>
          <button class="btn btn-danger btn-sm" onclick="endReuniao()">Encerrar Reunião</button>
        </div>
      </div>

      <div style="background:var(--bg-secondary);border-radius:8px;padding:4px;margin-bottom:20px">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;font-size:13px;font-weight:600">
          <span>Cliente ${index + 1} de ${clients.length} (${comPendCount} com pendência)</span>
          <span style="display:flex;align-items:center;gap:8px">${group.clientObj ? clientAvatar(group.clientObj, 20) : ''}${escapeHtml(group.clientName)}</span>
        </div>
        <div style="height:4px;background:var(--border);border-radius:4px;overflow:hidden">
          <div style="height:100%;width:${Math.round(progress)}%;background:var(--accent);border-radius:4px;transition:width .3s"></div>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:12px;margin-bottom:20px" id="meetingPenCards">
        ${cardsHtml}
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center">
        <button class="btn btn-secondary" ${index === 0 ? 'disabled' : ''} onclick="prevMeetingClient()">
          ← Anterior
        </button>
        <button class="btn btn-primary" onclick="nextMeetingClient()">
          Próximo cliente →
        </button>
      </div>
    </div>`;
}

function _meetingEmptyClientHtml(group) {
  const team = _getMeetingTeam();
  const opNames = typeof getOperatorNames === 'function' ? getOperatorNames(team) : [];
  const currentUser = typeof getUser === 'function' ? getUser().name : '';
  const cid = escapeHtml(group.clientId);
  return `
    <div class="card" style="text-align:center;padding:24px">
      <div style="font-size:32px;margin-bottom:8px">✅</div>
      <div style="font-weight:600;margin-bottom:4px">Sem pendências no momento</div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:16px">Nenhuma pendência aberta para ${escapeHtml(group.clientName)}</div>
      <div style="text-align:left;border:1px solid var(--border);border-radius:8px;padding:12px;background:var(--bg-secondary)">
        <div style="font-size:12px;font-weight:600;margin-bottom:8px">Nova pendência para este cliente</div>
        <textarea class="form-textarea" id="meeting-new-desc-${cid}" rows="2" placeholder="Nova pendência para este cliente..."></textarea>
        <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
          <select class="form-select" id="meeting-new-tipo-${cid}" style="flex:1;min-width:140px">
            ${(typeof TIPOS !== 'undefined' ? TIPOS : ['Projeto','Operacional / Interno','Manutenção','Suporte','Outro']).map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('')}
          </select>
          <select class="form-select" id="meeting-new-resp-${cid}" style="flex:1;min-width:140px">
            ${opNames.length ? opNames.map(n => `<option value="${escapeHtml(n)}" ${n===currentUser?'selected':''}>${escapeHtml(n)}</option>`).join('') : `<option value="${escapeHtml(currentUser)}">${escapeHtml(currentUser)}</option>`}
          </select>
          <button class="btn btn-primary btn-sm" onclick="meetingCreateInlinePendencia('${cid}')" style="white-space:nowrap">+ Adicionar</button>
        </div>
      </div>
    </div>`;
}

function _meetingPenCard(p) {
  const isReviewed = _meetingState && _meetingState.reviewedIds.has(p.id);
  const isResolved = _meetingState && _meetingState.resolvedIds.includes(p.id);

  return `
    <div class="card" id="meeting-card-${escapeHtml(p.id)}" style="border-left:4px solid ${
      isReviewed ? '#16a34a' : isResolved ? '#0ea5e9' : (STATUS_PEN_MAP[p.status]?.dot || '#94a3b8')
    }">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px">
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:14px;margin-bottom:4px">${escapeHtml(p.descricao || 'Sem descrição')}</div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12px;color:var(--text-muted)">
            ${priorityTag(p.priority)}
            <span>Resp: ${escapeHtml(p.responsible || '—')}</span>
            ${p.deadline ? `<span>Prazo: ${formatDate(parseDeadline(p.deadline))}</span>` : ''}
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0">
          <button class="btn btn-sm ${isReviewed ? 'btn-primary' : 'btn-secondary'}" onclick="meetingToggleReviewed('${escapeHtml(p.id)}')" title="Marcar como revisada">
            ${isReviewed ? '✓ Revisada' : 'Revisar'}
          </button>
        </div>
      </div>

      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <select class="form-select" id="meeting-status-${escapeHtml(p.id)}" style="width:160px;font-size:12px">
          ${Object.entries(STATUS_PEN_MAP).map(([k, v]) =>
            `<option value="${k}" ${p.status === k ? 'selected' : ''}>${escapeHtml(v.label)}</option>`
          ).join('')}
        </select>
        <button class="btn btn-sm btn-primary" onclick="meetingChangePenStatus('${escapeHtml(p.id)}')">Atualizar</button>
      </div>

      <div style="margin-bottom:8px">
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">
          ${(p.notes || []).length} nota(s)${isReviewed ? ' · <span style="color:#16a34a">Revisada</span>' : ''}
        </div>
        ${(p.notes || []).length ? `
          <div style="max-height:100px;overflow-y:auto;font-size:12px;border:1px solid var(--border);border-radius:6px;padding:8px;background:var(--bg-secondary)">
            ${p.notes.slice(-3).map(n => `
              <div style="margin-bottom:6px">
                <strong>${escapeHtml(n.author || '—')}</strong>
                <span style="color:var(--text-muted);font-size:11px">${_formatDateTimeShort(n.createdAt)}</span>
                <div style="margin-top:2px">${escapeHtml(n.text || '').substring(0, 200)}${(n.text || '').length > 200 ? '...' : ''}</div>
              </div>
            `).join('')}
            ${p.notes.length > 3 ? `<div style="color:var(--text-muted);font-size:11px">... e mais ${p.notes.length - 3} nota(s)</div>` : ''}
          </div>
        ` : ''}
      </div>

      <div style="display:flex;gap:6px">
        <input class="form-input" id="meeting-note-${escapeHtml(p.id)}" placeholder="Nota da reunião..." style="flex:1;font-size:12px" onkeydown="if(event.key==='Enter'){event.preventDefault();meetingAddPenNote('${escapeHtml(p.id)}')}" />
        <button class="btn btn-sm btn-secondary" onclick="meetingAddPenNote('${escapeHtml(p.id)}')">📝 Nota</button>
      </div>
    </div>`;
}

function prevMeetingClient() {
  if (!_meetingState || _meetingState.index <= 0) return;
  _meetingState.index--;
  renderMeetingFlow();
}

function nextMeetingClient() {
  if (!_meetingState) return;
  if (_meetingState.index < _meetingState.clients.length - 1) {
    _meetingState.index++;
    renderMeetingFlow();
  } else {
    _renderMeetingComplete();
  }
}

function _renderMeetingComplete() {
  if (!_meetingState) return;
  const content = document.getElementById('contentArea');
  const label = _getMesAnoLabel(_meetingState.mesAno);
  const remaining = getMyPendencias().filter(p => !isPendenciaClosed(p.status));
  const remainingCount = remaining.length;

  content.innerHTML = `
    <div class="card" style="max-width:600px;margin:40px auto;text-align:center;padding:40px">
      <div style="font-size:48px;margin-bottom:16px">✅</div>
      <h2 style="margin:0 0 8px;font-size:20px">Todos os clientes revisados!</h2>
      <p style="color:var(--text-muted);margin:0 0 20px">${label}</p>

      <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-bottom:24px">
        <div class="stat-card" style="min-width:100px">
          <div class="stat-value" style="font-size:24px;color:#16a34a">${_meetingState.resolvedIds.length}</div>
          <div class="stat-label">Resolvidas</div>
        </div>
        <div class="stat-card" style="min-width:100px">
          <div class="stat-value" style="font-size:24px;color:#f59e0b">${remainingCount}</div>
          <div class="stat-label">Abertas</div>
        </div>
        <div class="stat-card" style="min-width:100px">
          <div class="stat-value" style="font-size:24px;color:var(--accent)">${_meetingState.notes.length}</div>
          <div class="stat-label">Notas</div>
        </div>
      </div>

      <div style="display:flex;gap:8px;justify-content:center">
        <button class="btn btn-secondary" onclick="renderMeetingFlow()">← Voltar ao Carrossel</button>
        <button class="btn btn-danger" onclick="endReuniao()">Encerrar Reunião</button>
      </div>
    </div>`;
}

function meetingToggleReviewed(penId) {
  if (!_meetingState) return;
  const pen = getPendenciaById(penId);
  if (!pen) return;

  if (_meetingState.reviewedIds.has(penId)) {
    _meetingState.reviewedIds.delete(penId);
    pen.reviewedInMeeting = null;
  } else {
    _meetingState.reviewedIds.add(penId);
    pen.reviewedInMeeting = _meetingState.id;
  }
  savePendencia(pen);
  _refreshCurrentGroupPens();
  renderMeetingFlow();
}

function meetingChangePenStatus(penId) {
  if (!_meetingState) return;
  const sel = document.getElementById('meeting-status-' + penId);
  if (!sel) return;
  const pen = getPendenciaById(penId);
  if (!pen) return;
  const newStatus = sel.value;
  const wasOpen = !isPendenciaClosed(pen.status);
  pen.status = newStatus;
  savePendencia(pen);

  if (wasOpen && _MEETING_CLOSED_STATUSES.includes(newStatus)) {
    if (!_meetingState.resolvedIds.includes(penId)) {
      _meetingState.resolvedIds.push(penId);
    }
  }

  showToast('Status atualizado!', 'success');
  _refreshCurrentGroupPens();
  renderMeetingFlow();
}

function meetingAddPenNote(penId) {
  if (!_meetingState) return;
  const input = document.getElementById('meeting-note-' + penId);
  if (!input) return;
  const text = input.value.trim();
  if (!text) { showToast('Escreva algo antes de registrar.', 'error'); return; }

  addPendenciaNote(penId, text, getUser().name);
  _meetingState.notes.push({
    penId,
    penDesc: (getPendenciaById(penId) || {}).descricao || '',
    text,
    author: getUser().name,
    at: new Date().toISOString()
  });

  showToast('Nota registrada!', 'success');
  renderMeetingFlow();
}

function meetingCreateInlinePendencia(clientId) {
  if (!_meetingState) return;
  const g = _meetingState.clients[_meetingState.index];
  if (!g || g.clientId !== clientId) return;
  const descEl = document.getElementById('meeting-new-desc-' + clientId);
  const tipoEl = document.getElementById('meeting-new-tipo-' + clientId);
  const respEl = document.getElementById('meeting-new-resp-' + clientId);
  const descricao = (descEl?.value || '').trim();
  if (!descricao) { showToast('Descreva a pendência.', 'error'); return; }
  const tipo = tipoEl?.value || (typeof TIPOS !== 'undefined' ? TIPOS[0] : 'Outro');
  const responsible = respEl?.value || (typeof getUser === 'function' ? getUser().name : '');
  try {
    const data = { clientId, clientName: g.clientName, descricao, tipo, responsible, status: 'aberto', priority: 'media' };
    if (typeof validatePendencia === 'function') {
      const errs = validatePendencia(data);
      if (errs.length) { showToast(errs[0], 'error'); return; }
    }
    savePendencia(data);
    if (descEl) descEl.value = '';
    _refreshCurrentGroupPens();
    showToast('Pendência criada!', 'success');
    renderMeetingFlow();
  } catch (err) { showToast('Erro ao criar pendência: ' + err.message, 'error'); }
}

function endReuniao() {
  if (!_meetingState) return;

  confirmAction('Encerrar esta reunião e gerar o relatório?', async () => {
    const now = new Date().toISOString();
    const meeting = getReuniaoById(_meetingState.id);
    if (!meeting) { showToast('Reunião não encontrada.', 'error'); return; }

    const allOpen = getMyPendencias().filter(p => !isPendenciaClosed(p.status));
    const resolvedCount = _meetingState.resolvedIds.length;
    const remainingCount = allOpen.length;
    const notesCount = _meetingState.notes.length;

    const label = _getMesAnoLabel(_meetingState.mesAno);

    let relatorio = `RELATÓRIO DA REUNIÃO MENSAL — ${label}\n`;
    relatorio += `Data: ${_formatDateTimeShort(now)}\n`;
    relatorio += `Início: ${_formatDateTimeShort(_meetingState.startedAt)}\n`;
    relatorio += `Duração: ${_calcDuration(_meetingState.startedAt, now)}\n`;
    relatorio += `\n─── RESUMO ───\n`;
    relatorio += `• Pendências resolvidas na reunião: ${resolvedCount}\n`;
    relatorio += `• Pendências que permanecem abertas: ${remainingCount}\n`;
    relatorio += `• Notas registradas: ${notesCount}\n`;

    if (_meetingState.resolvedIds.length) {
      relatorio += `\n─── PENDÊNCIAS RESOLVIDAS ───\n`;
      _meetingState.resolvedIds.forEach(id => {
        const p = getPendenciaById(id);
        relatorio += `• ${p ? (p.descricao || p.id) : id}\n`;
      });
    }

    if (notesCount > 0) {
      relatorio += `\n─── NOTAS DA REUNIÃO ───\n`;
      _meetingState.notes.forEach(n => {
        relatorio += `[${n.author}] ${n.penDesc ? n.penDesc.substring(0, 60) + ': ' : ''}${n.text}\n`;
      });
    }

    if (remainingCount > 0) {
      relatorio += `\n─── PENDÊNCIAS PENDENTES ───\n`;
      allOpen.forEach(p => {
        relatorio += `• ${escapeHtml(p.descricao || p.id)} — ${escapeHtml(p.responsible || '—')} [${p.status}]\n`;
      });
    }

    relatorio += `\n─── FIM DO RELATÓRIO ───\n`;

    meeting.status = 'encerrada';
    meeting.endedAt = now;
    meeting.relatorio = relatorio;
    saveReuniao(meeting);

    addLog('Encerrou Reunião', 'Reunião', meeting.id, `${label} — ${resolvedCount} resolvidas, ${remainingCount} abertas`);

    _meetingState = null;

    showToast('Reunião encerrada! Relatório gerado.', 'success');
    _renderLanding(_getCurrentMesAno(), _getMesAnoLabel(_getCurrentMesAno()), meeting);
  });
}

function showMeetingReport(meetingId) {
  const m = getReuniaoById(meetingId);
  if (!m || !m.relatorio) { showToast('Relatório não encontrado.', 'error'); return; }

  openModal('Relatório da Reunião', `
    <div style="white-space:pre-wrap;font-size:13px;line-height:1.6;max-height:500px;overflow-y:auto;padding:12px;background:var(--bg-secondary);border-radius:8px;border:1px solid var(--border)">${escapeHtml(m.relatorio)}</div>
    <div class="form-actions" style="margin-top:16px">
      <button class="btn btn-secondary" onclick="closeModal()">Fechar</button>
      <button class="btn btn-primary" onclick="copyToClipboard(document.querySelector('.modal-body div[style*=white-space]').textContent)">Copiar Relatório</button>
    </div>
  `);
}

function _formatDateTimeShort(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function _calcDuration(start, end) {
  if (!start || !end) return '—';
  const ms = new Date(end) - new Date(start);
  const mins = Math.floor(ms / 60000);
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hrs === 0) return rem + 'min';
  return `${hrs}h${rem ? ' ' + rem + 'min' : ''}`;
}
