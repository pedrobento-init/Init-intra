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
  return all.filter(p => p.clientId === clientId && !isPendenciaClosed(p.status) && !(_meetingState && _meetingState.reviewedIds && _meetingState.reviewedIds.has(p.id)));
}

function _groupOpenPendenciasByClient(pens) {
  const groups = {};
  pens.forEach(p => {
    if (isPendenciaClosed(p.status)) return;
    if (_meetingState && _meetingState.reviewedIds && _meetingState.reviewedIds.has(p.id)) return;
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
  try {
    var _t = typeof getCurrentTeam==='function' ? String(getCurrentTeam()||'').toLowerCase().trim() : 'init';
    if (_t !== 'init') {
      document.getElementById('pageTitle').textContent='Reunião Mensal';
      document.getElementById('contentArea').innerHTML='<div class="empty-state u-a19bf6"><p>Acesso restrito ao time Init.</p></div>';
      if (typeof showToast==='function') showToast('Reunião disponível apenas para o time Init.', 'error');
      return;
    }
  } catch(_){}
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
  // Relatório "anterior": última reunião encerrada de mês estritamente menor
  // (a do mês atual, se encerrada, não é "anterior").
  const _allClosed = (typeof getMyReunioes === 'function' ? getMyReunioes() : [])
    .filter(r => r.status === 'encerrada' && r.relatorio && (r.mesAno || '') < mesAno)
    .sort((a, b) => (b.mesAno || '').localeCompare(a.mesAno || ''));
  const prevMeeting = _allClosed[0] || null;

  const content = document.getElementById('contentArea');
  content.innerHTML = `
    <div class="card u-6a14d8">
      <div class="u-259247">👥</div>
      <h2 class="u-dec9a9">Reunião Mensal</h2>
      <p class="u-a9ef84">${label}</p>

      ${existingMeeting && existingMeeting.status === 'encerrada'
        ? `<div class="u-db9dbe">
            <div class="u-862bee">Esta reunião já foi encerrada</div>
            <div class="u-6cb285">${_formatDateTimeShort(existingMeeting.endedAt)} — ${existingMeeting.relatorio ? 'Relatório disponível' : 'Sem relatório'}</div>
          </div>`
        : ''}

      <div class="u-97edc3">
        <div class="stat-card u-651945">
          <div class="stat-value u-4901c7">${pendenciaCount}</div>
          <div class="stat-label">Pendências abertas</div>
        </div>
        <div class="stat-card u-651945">
          <div class="stat-value u-a2600b">${baseClients.length}</div>
          <div class="stat-label">Clientes</div>
        </div>
        ${baseClients.length > 0 ? `
          <div class="stat-card u-651945">
            <div class="stat-value u-a2600b">${clientesComPend}</div>
            <div class="stat-label">Com pendência</div>
          </div>
        ` : ''}
      </div>

      ${baseClients.length === 0
        ? `<div class="u-6028f5">
            <p class="u-d746c5">Nenhum cliente cadastrado.</p>
          </div>`
        : `<button class="btn btn-primary u-967b9c" data-action="startReuniao" data-arg="${escapeHtml(mesAno)}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            ${existingMeeting && existingMeeting.status === 'encerrada' ? 'Reabrir' : 'Iniciar'} Reunião de ${label}
          </button>`}

      <div class="u-97dc71">
        ${prevMeeting
          ? `<button class="btn btn-secondary" data-action="showMeetingReport" data-arg="${escapeHtml(prevMeeting.id)}">📄 Ver Relatório Anterior</button>` : ''}
        <button class="btn btn-secondary" data-action="openMeetingCompareModal">📊 Comparar meses</button>
      </div>
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
  const today = typeof localDateISO === 'function' ? localDateISO() : new Date().toISOString().slice(0,10);
  const slaMap = typeof getAllSlaStats === 'function' ? getAllSlaStats(getMyPendencias(), today) : {};
  base.forEach(c => {
    const pens = _getOpenPensForClient(c.id);
    const entry = { clientId: c.id, clientName: c.name, clientColor: c.color, clientInitials: c.initials, clientObj: c, pens };
    if (pens.length > 0) com.push(entry); else sem.push(entry);
  });
  // 4. Ordena "com pendência" por SLA: mais vencidas primeiro (via metrics.js)
  if (typeof sortClientsBySla === 'function' && Object.keys(slaMap).length) {
    const comClientsOnly = com.map(e => ({ id: e.clientId, name: e.clientName }));
    const sortedIds = sortClientsBySla(comClientsOnly, slaMap).map(x => x.id);
    com.sort((a,b) => sortedIds.indexOf(a.clientId) - sortedIds.indexOf(b.clientId));
  }
  _meetingState.clients = [...com, ...sem];
}

function _getStreakBadgeHtml(clientId) {
  if (typeof getConsecutiveMeetingStreak !== 'function' || typeof getMyReunioes !== 'function') return '';
  try {
    const reunioes = getMyReunioes().filter(r => r.status === 'encerrada').sort((a,b) => (b.mesAno||'').localeCompare(a.mesAno||''));
    const streak = getConsecutiveMeetingStreak(clientId, reunioes, getMyPendencias());
    if (streak >= 2) return `<span class="tag u-5cd023">🔁 ${streak} meses seguidos</span>`;
  } catch(_) {}
  return '';
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
    ? group.pens.map(p => _meetingPenCard(p)).join('') + _meetingNewPendenciaFooterHtml(group)
    : _meetingEmptyClientHtml(group);

  content.innerHTML = `
    <div class="u-b52906">
      <div class="u-fb0da8">
        <div>
          <h2 class="u-535157">Reunião ${label}</h2>
          <div class="u-bd72d7">
            Iniciada ${_formatDateTimeShort(_meetingState.startedAt)}
          </div>
        </div>
        <div class="u-01ef7f">
          <span class="u-58b17f">${_meetingState.notes.length} notas · ${_meetingState.resolvedIds.length} resolvidas</span>
          <button class="btn btn-secondary btn-sm" data-action="enterPresentationMode">🖥️ Modo Apresentação</button>
          <button class="btn btn-danger btn-sm" data-action="endReuniao">Encerrar Reunião</button>
        </div>
      </div>

      <div class="u-4e8041">
        <button class="btn btn-secondary btn-sm" data-action="openMeetingCompareModal">📊 Comparar meses</button>
        <span class="u-f00580">Fila ordenada por SLA (vencidas primeiro)</span>
      </div>
      <div class="u-1e4a83">
        <div class="u-490594">
          <span>Cliente ${index + 1} de ${clients.length} (${comPendCount} com pendência)</span>
          <span class="u-015a5e">${group.clientObj ? clientAvatar(group.clientObj, 20) : ''}${escapeHtml(group.clientName)}${_getStreakBadgeHtml(group.clientId)}</span>
        </div>
        <div class="u-d53f32">
          <div style="height:100%;width:${Math.round(progress)}%;background:var(--accent);border-radius:4px;transition:width .3s"></div>
        </div>
      </div>

      <div class="u-c342b1" id="meetingPenCards">
        ${cardsHtml}
      </div>

      <div class="u-13313b">
        <button class="btn btn-secondary" ${index === 0 ? 'disabled' : ''} data-action="prevMeetingClient">
          ← Anterior
        </button>
        <button class="btn btn-primary" data-action="nextMeetingClient">
          Próximo cliente →
        </button>
      </div>
    </div>`;
}

let _presentationPrev = null;
function _ensurePresentationStyle(){
  if(document.getElementById('presentationModeStyle')) return;
  var st=document.createElement('style');
  st.id='presentationModeStyle';
  st.textContent='.presentation-mode .card{font-size:1.2em} .presentation-mode #topbar,.presentation-mode .topbar{ display:none !important } .presentation-mode .offline-banner{ display:none !important }';
  document.head.appendChild(st);
}
function enterPresentationMode(){
  _ensurePresentationStyle();
  // Já apresentando: não sobrescreve _presentationPrev, senão o "sair"
  // restauraria o estado oculto (ex.: 2 cliques em Apresentar).
  if (document.body.classList.contains('presentation-mode') || document.getElementById('exitPresentationBtn')) {
    _ensureExitPresentationBtn();
    return;
  }
  var sidebar=document.getElementById('sidebar');
  var main=document.getElementById('mainContent');
  var topbar=document.querySelector('.topbar');
  _presentationPrev={
    sidebarDisplay: sidebar ? sidebar.style.display : '',
    mainMargin: main ? main.style.marginLeft : '',
    bodyClass: document.body.className,
    topbarDisplay: topbar ? topbar.style.display : ''
  };
  if(sidebar) sidebar.style.display='none';
  if(main) main.style.marginLeft='0';
  if(topbar) topbar.style.display='none';
  document.body.classList.add('presentation-mode');
  _ensureExitPresentationBtn();
}
function _ensureExitPresentationBtn(){
  var existing=document.getElementById('exitPresentationBtn');
  if(existing) return existing;
  var btn=document.createElement('button');
  btn.id='exitPresentationBtn';
  btn.type='button';
  btn.textContent='Sair do modo';
  btn.className='btn btn-secondary';
  btn.style.cssText='position:fixed;top:12px;right:12px;z-index:9999';
  btn.dataset.action='exitPresentationMode';
  document.body.appendChild(btn);
  return btn;
}
function exitPresentationMode(){
  var sidebar=document.getElementById('sidebar');
  var main=document.getElementById('mainContent');
  var topbar=document.querySelector('.topbar');
  // Estado salvo corrompido (capturado já apresentando): volta ao padrão
  // em vez de restaurar o modo oculto.
  var corrupt = _presentationPrev && (
    String(_presentationPrev.bodyClass || '').split(/\s+/).indexOf('presentation-mode') !== -1 ||
    _presentationPrev.sidebarDisplay === 'none'
  );
  if(_presentationPrev && !corrupt){
    if(sidebar) sidebar.style.display=_presentationPrev.sidebarDisplay || '';
    if(main) main.style.marginLeft=_presentationPrev.mainMargin || '';
    if(topbar) topbar.style.display=_presentationPrev.topbarDisplay || '';
  } else {
    if(sidebar) sidebar.style.display='';
    if(main) main.style.marginLeft='';
    if(topbar) topbar.style.display='';
  }
  // Remove só a classe do modo: preserva as demais (ex.: tema, modal).
  document.body.classList.remove('presentation-mode');
  _presentationPrev=null;
  var btn=document.getElementById('exitPresentationBtn');
  if(btn) btn.remove();
}

function _meetingInlineFormInnerHtml(cid) {
  const team = _getMeetingTeam();
  const opNames = typeof getOperatorNames === 'function' ? getOperatorNames(team) : [];
  const currentUser = typeof getUser === 'function' ? getUser().name : '';
  return `
        <input class="form-input u-fdf33f" id="meeting-new-assunto-${cid}" maxlength="120" placeholder="Assunto (título)..." />
        <textarea class="form-textarea" id="meeting-new-desc-${cid}" rows="2" placeholder="Descrição detalhada..."></textarea>
        <div class="u-67b198">
          <select class="form-select u-aae040" id="meeting-new-tipo-${cid}">
            ${(() => { var _t = (typeof TIPOS !== 'undefined' ? TIPOS : ['Projeto','Operacional / Interno','Manutenção','Suporte','Gestão','Outro']); try { if (typeof canViewGestao === 'function' && !canViewGestao() && typeof isPendenciaGestao === 'function') _t = _t.filter(function(x){ return !isPendenciaGestao({ tipo: x }); }); } catch (_) {} return _t; })().map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('')}
          </select>
          <select class="form-select u-aae040" id="meeting-new-resp-${cid}">
            ${opNames.length ? opNames.map(n => `<option value="${escapeHtml(n)}" ${n===currentUser?'selected':''}>${escapeHtml(n)}</option>`).join('') : `<option value="${escapeHtml(currentUser)}">${escapeHtml(currentUser)}</option>`}
          </select>
          <button class="btn btn-secondary btn-sm u-86abda" data-action="meetingUseTemplate" data-arg="${cid}">📋 Usar modelo</button>
          <button class="btn btn-primary btn-sm u-86abda" data-action="meetingCreateInlinePendencia" data-arg="${cid}">+ Adicionar</button>
        </div>`;
}

function _meetingEmptyClientHtml(group) {
  const cid = escapeHtml(group.clientId);
  return `
    <div class="card u-3d1fcd">
      <div class="u-0c31f0">✅</div>
      <div class="u-a27006">Sem pendências no momento</div>
      <div class="u-57a63a">Nenhuma pendência aberta para ${escapeHtml(group.clientName)}</div>
      <div class="u-feca31">
        <div class="u-d302d2">Nova pendência para este cliente</div>
        ${_meetingInlineFormInnerHtml(cid)}
      </div>
    </div>`;
}

function _meetingNewPendenciaFooterHtml(group) {
  const cid = escapeHtml(group.clientId);
  return `
    <div class="card u-cc781b">
      <button class="btn btn-secondary btn-sm u-4a2700" data-action="toggleMeetingInlineForm" data-arg="${cid}">+ Nova pendência para este cliente</button>
      <div id="meeting-inline-form-${cid}" class="u-c499dc">
        <div class="u-d302d2">Nova pendência para ${escapeHtml(group.clientName)}</div>
        ${_meetingInlineFormInnerHtml(cid)}
      </div>
    </div>`;
}

function toggleMeetingInlineForm(clientId) {
  const el = document.getElementById('meeting-inline-form-' + clientId);
  if (!el) return;
  el.style.display = getComputedStyle(el).display === 'none' ? 'block' : 'none';
  if (el.style.display === 'block') {
    const ai = document.getElementById('meeting-new-assunto-' + clientId);
    if (ai) ai.focus();
    else { const ta = document.getElementById('meeting-new-desc-' + clientId); if (ta) ta.focus(); }
  }
}

// ── Descrição no card da reunião (puro, testável) ───────────────────────────
// Retorna null quando não há o que exibir: sem descrição, ou sem assunto
// (nesse caso o título do card já é a própria descrição). `long` indica
// texto além do preview → clamp de 3 linhas + botão "ver mais".
const MEETING_DESC_PREVIEW_CHARS = 160;
function getMeetingDescView(p) {
  const assunto = String((p && p.assunto) || '').trim();
  const text = String((p && p.descricao) || '').trim();
  if (!assunto || !text) return null;
  return { text, long: text.length > MEETING_DESC_PREVIEW_CHARS };
}

function meetingToggleDesc(penId) {
  const box = document.getElementById('meeting-desc-' + penId);
  if (!box) return;
  const clamped = box.classList.toggle('is-clamped');
  const btn = document.getElementById('meeting-desc-toggle-' + penId);
  if (btn) btn.textContent = clamped ? 'ver mais' : 'ver menos';
}

function _fmtMeetingDateTime(v) {
  try {
    if (!v) return '—';
    if (typeof formatDateTime === 'function') return formatDateTime(v);
  } catch (_) {}
  return String(v || '—');
}

// Últimas movimentações de responsável/conclusão da pendência (discreto).
// Reaproveita audit_logs (mesma fonte do Histórico); sem tabela nova.
function _meetingPenHistoryHtml(penId) {
  let logs = [];
  try {
    if (typeof getLogs !== 'function') return '';
    logs = getLogs() || [];
    if (typeof filterGestaoLogs === 'function') logs = filterGestaoLogs(logs);
  } catch (_) { return ''; }
  const rows = logs.filter(l => {
    try {
      const t = String(l.type || '').trim().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return t === 'pendencia' && l.targetId === penId &&
        (l.action === 'Reatribuiu' || l.action === 'Corrigiu conclusão');
    } catch (_) { return false; }
  }).sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || ''))).slice(0, 2);
  if (!rows.length) return '';
  return `<div class="meet-hist">` + rows.map(l => {
    const label = l.action === 'Reatribuiu' ? 'Reatribuída de' : 'Conclusão corrigida de';
    return `<div>${label} ${escapeHtml(l.details || '—')} · ${escapeHtml(l.operatorName || 'Sistema')} · ${escapeHtml(_fmtMeetingDateTime(l.timestamp))}</div>`;
  }).join('') + `</div>`;
}

function _meetingPenCard(p) {
  const isReviewed = _meetingState && _meetingState.reviewedIds.has(p.id);
  const isResolved = _meetingState && _meetingState.resolvedIds.includes(p.id);
  const onLeave = typeof isOperatorOnLeave === 'function' ? isOperatorOnLeave(p.responsible) : false;
  const onLeaveBadge = onLeave ? `<span class="tag badge-afastado">🏖️ Afastado</span>` : '';
  const reassignBtn = `<button class="btn btn-sm btn-secondary" data-action="openReassignPendencia" data-arg="${escapeHtml(p.id)}" aria-label="Reatribuir responsável">Reatribuir</button>`;
  const descView = getMeetingDescView(p);
  let _isResolvida = function(s) { return ['concluido', 'resolvido'].indexOf(s || '') !== -1; };
  try { if (typeof isPendenciaResolvida === 'function') _isResolvida = isPendenciaResolvida; } catch (_) {}
  const isDone = _isResolvida(p.status);

  return `
    <div class="card" id="meeting-card-${escapeHtml(p.id)}" style="border-left:4px solid ${
      isReviewed ? '#16a34a' : isResolved ? '#0ea5e9' : (STATUS_PEN_MAP[p.status]?.dot || '#94a3b8')
    }">
      <div class="u-82fba0">
        <div class="u-59eddc">
          <div class="u-ca7d3c">${escapeHtml(getPendenciaTitulo(p))}</div>
          <div class="u-310d79">
            ${priorityTag(p.priority)}
            <span>Resp: ${escapeHtml(p.responsible || '—')}</span>
            ${onLeaveBadge}
            ${reassignBtn}
            ${p.deadline ? `<span>Prazo: ${formatDate(parseDeadline(p.deadline))}</span>` : ''}
          </div>
        </div>
        <div class="u-b71a03">
          <button class="btn btn-sm ${isReviewed ? 'btn-primary' : 'btn-secondary'}" data-action="meetingToggleReviewed" data-arg="${escapeHtml(p.id)}" title="Marcar como revisada">
            ${isReviewed ? '✓ Revisada' : 'Revisar'}
          </button>
        </div>
      </div>

      ${descView ? `
      <div class="meet-desc${descView.long ? ' is-clamped' : ''}" id="meeting-desc-${escapeHtml(p.id)}">${escapeHtml(descView.text)}</div>
      ${descView.long ? `<button type="button" class="meet-desc-toggle" id="meeting-desc-toggle-${escapeHtml(p.id)}" data-action="meetingToggleDesc" data-arg="${escapeHtml(p.id)}">ver mais</button>` : ''}` : ''}

      ${isDone ? `
      <div class="meet-done" id="meeting-done-${escapeHtml(p.id)}">Concluída por <strong>${escapeHtml(p.completedBy || '—')}</strong>${p.completedAt ? ` em ${escapeHtml(_fmtMeetingDateTime(p.completedAt))}` : ''} <button type="button" class="btn btn-sm btn-secondary" data-action="openCorrectCompletion" data-arg="${escapeHtml(p.id)}" aria-label="Corrigir quem concluiu">Corrigir</button></div>` : ''}
      ${_meetingPenHistoryHtml(p.id)}

      <div class="u-866cd5">
        <select class="form-select u-47978e" id="meeting-status-${escapeHtml(p.id)}">
          ${Object.entries(STATUS_PEN_MAP).map(([k, v]) =>
            `<option value="${k}" ${p.status === k ? 'selected' : ''}>${escapeHtml(v.label)}</option>`
          ).join('')}
        </select>
        <button class="btn btn-sm btn-primary" data-action="meetingChangePenStatus" data-arg="${escapeHtml(p.id)}">Atualizar</button>
      </div>

      <div class="u-fdf33f">
        <div class="u-bf992a">
          ${plural((p.notes || []).length, 'nota', 'notas')}${isReviewed ? ' · <span class="u-723892">Revisada</span>' : ''}
        </div>
        ${(p.notes || []).length ? `
          <div class="u-6c5831">
            ${p.notes.slice(-3).map(n => `
              <div class="u-4e420a">
                <strong>${escapeHtml(n.author || '—')}</strong>
                <span class="u-5694e6">${_formatDateTimeShort(n.createdAt)}</span>
                <div class="u-7a21c6">${escapeHtml(n.text || '').substring(0, 200)}${(n.text || '').length > 200 ? '...' : ''}</div>
              </div>
            `).join('')}
            ${p.notes.length > 3 ? `<div class="u-5694e6">... e mais ${plural(p.notes.length - 3, 'nota', 'notas')}</div>` : ''}
          </div>
        ` : ''}
      </div>

      <form class="u-49cd09" data-submit="meetingAddPenNote" data-arg="${escapeHtml(p.id)}">
        <input class="form-input u-5a95af" id="meeting-note-${escapeHtml(p.id)}" placeholder="Nota da reunião..." />
        <button type="submit" class="btn btn-sm btn-secondary">📝 Nota</button>
      </form>
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
    <div class="card u-6a14d8">
      <div class="u-259247">✅</div>
      <h2 class="u-dec9a9">Todos os clientes revisados!</h2>
      <p class="u-a35cc4">${label}</p>

      <div class="u-97edc3">
        <div class="stat-card u-e79a03">
          <div class="stat-value u-e97574">${_meetingState.resolvedIds.length}</div>
          <div class="stat-label">Resolvidas</div>
        </div>
        <div class="stat-card u-e79a03">
          <div class="stat-value u-6d48be">${remainingCount}</div>
          <div class="stat-label">Abertas</div>
        </div>
        <div class="stat-card u-e79a03">
          <div class="stat-value u-1a2f51">${_meetingState.notes.length}</div>
          <div class="stat-label">Notas</div>
        </div>
      </div>

      <div class="u-931053">
        <button class="btn btn-secondary" data-action="renderMeetingFlow">← Voltar ao Carrossel</button>
        <button class="btn btn-danger" data-action="endReuniao">Encerrar Reunião</button>
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
  // Re-render preservando o scroll (rebuild total tirava o usuário do lugar).
  if (typeof preserveScrollAround === 'function') preserveScrollAround(function() { renderMeetingFlow(); });
  else renderMeetingFlow();
}

function meetingChangePenStatus(penId) {
  if (!_meetingState) return;
  const sel = document.getElementById('meeting-status-' + penId);
  if (!sel) return;
  const pen = getPendenciaById(penId);
  if (!pen) return;
  const newStatus = sel.value;
  const wasOpen = !isPendenciaClosed(pen.status);
  // Cópia destacada (não muta o cache antes do save): a transição
  // aberto → resolvido é o que dispara a próxima ocorrência recorrente em
  // savePendencia — mutar a referência viva cegava essa detecção.
  savePendencia({ ...pen, status: newStatus });

  if (wasOpen && _MEETING_CLOSED_STATUSES.includes(newStatus)) {
    if (!_meetingState.resolvedIds.includes(penId)) {
      _meetingState.resolvedIds.push(penId);
    }
  }

  showToast('Status atualizado!', 'success');
  _refreshCurrentGroupPens();
  if (typeof preserveScrollAround === 'function') preserveScrollAround(function() { renderMeetingFlow(); });
  else renderMeetingFlow();
  try { var _sel2 = document.getElementById('meeting-status-' + penId); if (_sel2) _sel2.focus(); } catch (_) {}
  if (typeof updateBadges === 'function') updateBadges();
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
    penDesc: getPendenciaTitulo(getPendenciaById(penId) || {}),
    text,
    author: getUser().name,
    at: new Date().toISOString()
  });

  showToast('Nota registrada!', 'success');
  if (typeof preserveScrollAround === 'function') preserveScrollAround(function() { renderMeetingFlow(); });
  else renderMeetingFlow();
  // Devolve o foco ao campo de nota (fluxo comum: registrar várias em sequência).
  setTimeout(function() { try { var el = document.getElementById('meeting-note-' + penId); if (el) el.focus(); } catch (_) {} }, 30);
}

function meetingCreateInlinePendencia(clientId) {
  if (!_meetingState) return;
  const g = _meetingState.clients[_meetingState.index];
  if (!g || g.clientId !== clientId) return;
  const assuntoEl = document.getElementById('meeting-new-assunto-' + clientId);
  const descEl = document.getElementById('meeting-new-desc-' + clientId);
  const tipoEl = document.getElementById('meeting-new-tipo-' + clientId);
  const respEl = document.getElementById('meeting-new-resp-' + clientId);
  const assunto = (assuntoEl?.value || '').trim();
  const descricao = (descEl?.value || '').trim();
  if (!assunto) { showToast('Informe o assunto.', 'error'); return; }
  if (!descricao) { showToast('Descreva a pendência.', 'error'); return; }
  const tipo = tipoEl?.value || (typeof TIPOS !== 'undefined' ? TIPOS[0] : 'Outro');
  const responsible = respEl?.value || (typeof getUser === 'function' ? getUser().name : '');
  const wasEmpty = g.pens.length === 0;
  try {
    const data = { clientId, clientName: g.clientName, assunto, descricao, tipo, responsible, status: 'aberto', priority: 'media', reviewedInMeeting: _meetingState.id };
    if (typeof validatePendencia === 'function') {
      const errs = validatePendencia(data);
      if (errs.length) { showToast(errs[0], 'error'); return; }
    }
    const saved = savePendencia(data);
    if (assuntoEl) assuntoEl.value = '';
    if (descEl) descEl.value = '';
    // Inserção imediata no card sem re-render da página inteira
    // Para manter fila estável, atualiza apenas o grupo atual
    const newPen = saved || getPendenciaById(data.id) || data;
    // Garante que não está marcado como revisada no filtro (aparece no card)
    // save já gravou reviewedInMeeting, mas mantemos visível nesta sessão
    g.pens.push(newPen);
    showToast('Pendência criada!', 'success');
    if (typeof updateBadges === 'function') { try { updateBadges(); } catch (_) {} }
    if (wasEmpty) {
      // Cliente sem pendência virou com pendência — re-render leve do card
      renderMeetingFlow();
    } else {
      // Inserção incremental no DOM
      const container = document.getElementById('meetingPenCards');
      if (container) {
        const footer = container.querySelector('.card:last-child');
        const temp = document.createElement('div');
        temp.innerHTML = _meetingPenCard(newPen);
        if (footer && footer.innerHTML.includes('Nova pendência para este cliente')) {
          container.insertBefore(temp.firstElementChild, footer);
        } else {
          container.appendChild(temp.firstElementChild);
        }
        // Limpa textarea já foi feito; mantém formulário recolhido
        const form = document.getElementById('meeting-inline-form-' + clientId);
        if (form) form.style.display = 'none';
      } else {
        renderMeetingFlow();
      }
    }
  } catch (err) { showToast('Erro ao criar pendência: ' + err.message, 'error'); }
}

function meetingUseTemplate(clientId) {
  const templates = typeof getProcedureTemplates === 'function' ? getProcedureTemplates() : [];
  if (!templates.length) { showToast('Nenhum modelo cadastrado.', 'warning'); return; }
  const g = _meetingState?.clients[_meetingState.index];
  const clientName = g ? g.clientName : clientId;
  openModal(`Usar modelo — ${escapeHtml(clientName)}`, `
    <div class="u-36e4e3">
      ${templates.map(t => `
        <button class="card u-31f934" data-action="meetingApplyTemplate" data-client="${escapeHtml(clientId)}" data-template="${escapeHtml(t.id)}">
          <div class="u-160b06">${escapeHtml(t.title)}</div>
          ${t.category ? `<span class="tag tag-blue u-0d5be0">${escapeHtml(t.category)}</span>` : ''}
          <div class="u-3c10e2">${escapeHtml((t.content||'').slice(0,120))}</div>
        </button>`).join('')}
    </div>
    <div class="form-actions u-56f435"><button class="btn btn-secondary" data-action="meetingCloseModalAndRender">Voltar</button></div>
  `);
}

function meetingApplyTemplate(clientId, templateId) {
  const tpl = typeof getProcedureTemplateById === 'function' ? getProcedureTemplateById(templateId) : null;
  if (!tpl) return;
  closeModal();
  // Re-render first to ensure textarea exists, then fill
  renderMeetingFlow();
  setTimeout(() => {
    const ai = document.getElementById('meeting-new-assunto-' + clientId);
    if (ai && !ai.value) ai.value = tpl.title || '';
    const ta = document.getElementById('meeting-new-desc-' + clientId);
    if (ta) { ta.value = tpl.content || tpl.title || ''; ta.focus(); }
    showToast(`Modelo "${tpl.title}" carregado`, 'success');
  }, 30);
}

function openMeetingCompareModal() {
  const reunioes = (typeof getMyReunioes === 'function' ? getMyReunioes() : []).filter(r => r.status === 'encerrada').sort((a,b)=>(b.mesAno||'').localeCompare(a.mesAno||''));
  if (reunioes.length < 2) { showToast('É preciso ter pelo menos 2 reuniões encerradas para comparar.', 'warning'); return; }
  const opts = reunioes.map(r => `<option value="${escapeHtml(r.mesAno)}">${escapeHtml(_getMesAnoLabel(r.mesAno))} — ${escapeHtml(r.id)}</option>`).join('');
  openModal('Comparativo mês a mês', `
    <div class="u-266909">
      <div class="form-group u-97445a"><label class="form-label">Mês A</label><select class="form-select" id="compareMesA">${opts}</select></div>
      <div class="form-group u-97445a"><label class="form-label">Mês B</label><select class="form-select" id="compareMesB">${opts}</select></div>
    </div>
    <button class="btn btn-primary" data-action="renderMeetingCompare">Comparar</button>
    <div id="meetingCompareResult" class="u-1b0f49"></div>
  `);
  // Default: two most recent
  setTimeout(() => {
    const a = document.getElementById('compareMesA');
    const b = document.getElementById('compareMesB');
    if (a && reunioes[1]) a.value = reunioes[1].mesAno;
    if (b && reunioes[0]) b.value = reunioes[0].mesAno;
  }, 10);
}

function renderMeetingCompare() {
  const mesA = document.getElementById('compareMesA')?.value;
  const mesB = document.getElementById('compareMesB')?.value;
  if (!mesA || !mesB) { showToast('Selecione os dois meses.', 'error'); return; }
  if (mesA === mesB) { showToast('Selecione meses diferentes.', 'error'); return; }
  const clients = _getMeetingBaseClients();
  const pendencias = getMyPendencias();
  const rows = typeof compareMeetings === 'function' ? compareMeetings(mesA, mesB, pendencias, clients) : [];
  const el = document.getElementById('meetingCompareResult');
  if (!rows.length) { el.innerHTML = '<p class="u-aad8e6">Nenhum cliente com pendência vinculada a essas reuniões.</p>'; return; }
  el.innerHTML = `
    <div class="table-wrapper"><table><thead><tr><th>Cliente</th><th>${escapeHtml(_getMesAnoLabel(mesA))}</th><th>${escapeHtml(_getMesAnoLabel(mesB))}</th><th>Δ</th></tr></thead>
    <tbody>${rows.map(r => `
      <tr>
        <td>${escapeHtml(r.clientName)}</td>
        <td>${r.abertasA} abertas / ${r.fechadasA} fechadas <span class="u-749148">(${r.totalReviewedA} vistas)</span></td>
        <td>${r.abertasB} abertas / ${r.fechadasB} fechadas <span class="u-749148">(${r.totalReviewedB} vistas)</span></td>
        <td style="font-weight:700;color:${r.deltaAbertas>0?'#dc2626':r.deltaAbertas<0?'#16a34a':'var(--text-muted)'}">${r.deltaAbertas>0?'+':''}${r.deltaAbertas}</td>
      </tr>`).join('')}</tbody></table></div>
    <p class="u-8a0402">Base: pendências com reviewedInMeeting == REU-mês. Δ = abertas B - abertas A.</p>
  `;
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
        relatorio += `• ${p ? (getPendenciaTitulo(p) || p.id) : id}\n`;
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
        relatorio += `• ${escapeHtml(getPendenciaTitulo(p) || p.id)} — ${escapeHtml(p.responsible || '—')} [${p.status}]\n`;
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
    if (typeof updateBadges === 'function') { try { updateBadges(); } catch (_) {} }
    _renderLanding(_getCurrentMesAno(), _getMesAnoLabel(_getCurrentMesAno()), meeting);
  });
}

function showMeetingReport(meetingId) {
  const m = getReuniaoById(meetingId);
  if (!m || !m.relatorio) { showToast('Relatório não encontrado.', 'error'); return; }

  openModal('Relatório — ' + _getMesAnoLabel(m.mesAno || ''), `
    <div class="u-4b7bca">${escapeHtml(m.relatorio)}</div>
    <div class="form-actions u-1b0f49">
      <button class="btn btn-secondary" data-action="closeModal">Fechar</button>
      <button class="btn btn-primary" data-action="meetingCopyReport">Copiar Relatório</button>
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

// Ações da Reunião Mensal (delegação via js/actions.js). closeModal é ação global.
if (typeof registerActions === 'function') {
  registerActions({
    startReuniao: (_el, mesAno) => startReuniao(mesAno),
    showMeetingReport: (_el, id) => showMeetingReport(id),
    openMeetingCompareModal: () => openMeetingCompareModal(),
    enterPresentationMode: () => enterPresentationMode(),
    exitPresentationMode: () => exitPresentationMode(),
    endReuniao: () => endReuniao(),
    prevMeetingClient: () => prevMeetingClient(),
    nextMeetingClient: () => nextMeetingClient(),
    renderMeetingFlow: () => renderMeetingFlow(),
    renderMeetingCompare: () => renderMeetingCompare(),
    meetingToggleReviewed: (_el, id) => meetingToggleReviewed(id),
    meetingToggleDesc: (_el, id) => meetingToggleDesc(id),
    meetingChangePenStatus: (_el, id) => meetingChangePenStatus(id),
    meetingAddPenNote: (_el, penId) => meetingAddPenNote(penId),
    meetingUseTemplate: (_el, cid) => meetingUseTemplate(cid),
    meetingApplyTemplate: (el) => meetingApplyTemplate(el.dataset.client, el.dataset.template),
    meetingCreateInlinePendencia: (_el, cid) => meetingCreateInlinePendencia(cid),
    toggleMeetingInlineForm: (_el, cid) => toggleMeetingInlineForm(cid),
    openReassignPendencia: (_el, id) => { if (typeof openReassignPendencia === 'function') openReassignPendencia(id); },
    openCorrectCompletion: (_el, id) => { if (typeof openCorrectCompletion === 'function') openCorrectCompletion(id); },
    meetingCloseModalAndRender: () => { closeModal(); renderMeetingFlow(); },
    meetingCopyReport: () => {
      const box = document.querySelector('.modal-body div[style*=white-space]');
      if (box && typeof copyToClipboard === 'function') copyToClipboard(box.textContent);
    },
  });
}
