// operadores.js – Módulo de gestão de operadores

const OP_COLORS = [
  '#1a56db','#3b82f6','#0891b2','#0f766e','#16a34a',
  '#4f46e5','#6366f1','#7c3aed','#d97706','#dc2626'
];

let _opPage = 1;
let _filteredOps = [];
const OP_PAGE_SIZE = 30;

// ── Render principal ──────────────────────────────────────────────────────────
function renderOperadores() {
  document.getElementById('pageTitle').textContent = 'Operadores';
  setTopbarAction('Novo Operador', '<svg class="topbar-action-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>');
  window._topbarAction = () => openOperadorForm();

  const savedFilters = loadFilterState('operadores', {});
  _buildOperadoresPage(savedFilters);
}

function _buildOperadoresPage(savedFilters = {}) {
  var ops = getOperators();
  // Filter by team
  if (!isTeamAdmin()) {
    ops = ops.filter(o => (o.team || 'init') === getCurrentTeam());
  } else if (typeof _selectedTeam !== 'undefined' && _selectedTeam) {
    ops = ops.filter(o => (o.team || 'init') === _selectedTeam);
  }
  var ativos   = ops.filter(o => o.active);
  var inativos = ops.filter(o => !o.active);
  _filteredOps = ops;
  _opPage = 1;

  document.getElementById('contentArea').innerHTML = `
    <div class="op-stats-row">
      <div class="op-stat">
        <span class="op-stat-value">${ops.length}</span>
        <span class="op-stat-label">Total</span>
      </div>
      <div class="op-stat">
        <span class="op-stat-value" style="color:var(--green)">${ativos.length}</span>
        <span class="op-stat-label">Ativos</span>
      </div>
      <div class="op-stat">
        <span class="op-stat-value" style="color:var(--text-muted)">${inativos.length}</span>
        <span class="op-stat-label">Inativos</span>
      </div>
    </div>

    <div class="search-bar">
      <div class="search-input-wrap" style="flex:1">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input class="form-input" id="opSearch" placeholder="Buscar operador..." oninput="debouncedFilterOperadores()" />
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-secondary btn-sm op-filter-btn active" data-filter="todos" onclick="setOpFilter(this,'todos')">Todos</button>
        <button class="btn btn-secondary btn-sm op-filter-btn" data-filter="ativos" onclick="setOpFilter(this,'ativos')">Ativos</button>
        <button class="btn btn-secondary btn-sm op-filter-btn" data-filter="inativos" onclick="setOpFilter(this,'inativos')">Inativos</button>
      </div>
    </div>

    <div class="op-grid" id="opGridWrap"></div>`;

  if (savedFilters.search) document.getElementById('opSearch').value = savedFilters.search;
  if (savedFilters.filter) {
    window._opFilter = savedFilters.filter;
    const activeBtn = document.querySelector(`.op-filter-btn[data-filter="${window._opFilter}"]`);
    if (activeBtn) {
      document.querySelectorAll('.op-filter-btn').forEach(b => b.classList.remove('active'));
      activeBtn.classList.add('active');
    }
  } else {
    window._opFilter = 'todos';
  }

  showSkeleton('opGridWrap', 5);
  filterOperadores();
}

window.debouncedFilterOperadores = debounce(filterOperadores, 300);

function setOpFilter(btn, filter) {
  window._opFilter = filter;
  document.querySelectorAll('.op-filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  filterOperadores();
}

function filterOperadores() {
  _opPage = 1;
  const q = (document.getElementById('opSearch')?.value || '').toLowerCase();
  let ops = getOperators();
  // Filter by team (admin sees all, others see only their team)
  if (!isTeamAdmin()) {
    ops = ops.filter(o => (o.team || 'init') === getCurrentTeam());
  } else if (typeof _selectedTeam !== 'undefined' && _selectedTeam) {
    ops = ops.filter(o => (o.team || 'init') === _selectedTeam);
  }
  if (window._opFilter === 'ativos')   ops = ops.filter(o => o.active);
  if (window._opFilter === 'inativos') ops = ops.filter(o => !o.active);
  if (q) ops = ops.filter(o => o.name?.toLowerCase().includes(q) || o.role?.toLowerCase().includes(q));
  _filteredOps = ops;
  saveFilterState('operadores', {search: document.getElementById('opSearch')?.value || '', filter: window._opFilter});
  _renderOpGrid();
}

function _renderOpGrid() {
  const grid = document.getElementById('opGridWrap');
  if (!grid) return;
  const ops = _filteredOps;
  if (!ops.length) {
    grid.innerHTML = `<div class="empty-state"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg><p>Nenhum operador encontrado</p><button class="btn btn-primary btn-sm" onclick="openOperadorForm()">+ Novo Operador</button></div>`;
    return;
  }

  const totalPages = Math.ceil(ops.length / OP_PAGE_SIZE);
  if (_opPage > totalPages) _opPage = totalPages;
  if (_opPage < 1) _opPage = 1;

  const startIdx = (_opPage - 1) * OP_PAGE_SIZE;
  const pageOps = ops.slice(startIdx, startIdx + OP_PAGE_SIZE);

  // Count active tasks per operator
  const pens = (typeof getPendencias === 'function' ? getPendencias() : []).filter(p => !isPendenciaClosed(p.status));
  const session = getSession();
  const isAdminUser = isCurrentAdmin();

  grid.innerHTML = pageOps.map(op => {
    const penCount = pens.filter(p => p.responsible === op.name).length;
    const initials  = op.initials || op.name.substring(0, 2).toUpperCase();
    const color     = op.color || OP_COLORS[0];
    const isActive  = op.active !== false;
    const isSelf = session && session.opId === op.id;
    let actionsHtml = '';
    if (isAdminUser || isSelf) {
      actionsHtml += `<button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();openOperadorForm('${escapeHtml(op.id)}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Editar</button>`;
    }
    if (isAdminUser) {
      actionsHtml += `
        <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();toggleOp('${escapeHtml(op.id)}')" title="${isActive ? 'Desativar' : 'Ativar'}">
          ${isActive
            ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>`
            : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 8 12 14 14"/></svg>`
          }
          ${isActive ? 'Desativar' : 'Ativar'}
        </button>
        ${op.email ? `<button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();resendOperatorInvite('${escapeHtml(op.id)}')" title="Reenviar convite por e-mail">📧 Reenviar</button>` : ''}
        <button class="btn btn-danger btn-sm" onclick="event.stopPropagation();deleteOpConfirm('${escapeHtml(op.id)}')">&#10005;</button>
      `;
    }

    return `
      <div class="op-card ${isActive ? '' : 'op-card--inactive'}" style="cursor:pointer" onclick="openOpPendencias('${escapeHtml(op.id)}')">
        <div class="op-card-header">
          <div class="op-avatar" style="background:${color}">${escapeHtml(initials)}</div>
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
            <div class="op-card-badge ${isActive ? 'op-badge-active' : 'op-badge-inactive'}">
              ${isActive ? 'Ativo' : 'Inativo'}
            </div>
            ${op.onLeave ? `<span class="tag badge-afastado">🏖️ Afastado</span>` : ''}
          </div>
        </div>
        <div class="op-card-name">${escapeHtml(op.name)}</div>
        <div class="op-card-role">${escapeHtml(op.role || 'Técnico')}</div>
        ${op.phone ? `<div class="op-card-contact"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13 19.79 19.79 0 0 1 1.61 4.38 2 2 0 0 1 3.58 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.18 6.18l1.97-1.97a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg> ${escapeHtml(op.phone)}</div>` : ''}
        ${op.email ? `<div class="op-card-contact"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg> ${escapeHtml(op.email)}</div>` : ''}
        <div class="op-card-tasks">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
          <span>${penCount} pendência(s)</span>
          ${penCount > 0 ? '<span style="margin-left:auto;font-size:10px;color:var(--accent);font-weight:600">Ver →</span>' : ''}
        </div>
        ${actionsHtml ? `<div class="op-card-actions" style="display:flex;gap:6px;margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">${actionsHtml}</div>` : ''}
      </div>`;
  }).join('') + (totalPages > 1 ? `
    <div style="grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-top:1px solid var(--border)">
      <div style="font-size:12px;color:var(--text-muted)">Mostrando ${startIdx+1}–${Math.min(startIdx+OP_PAGE_SIZE, ops.length)} de ${ops.length} operadores</div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-sm btn-secondary" ${_opPage===1?'disabled':''} onclick="_opPage--;_renderOpGrid()">← Anterior</button>
        <span style="font-size:13px;padding:4px 8px;display:flex;align-items:center">${_opPage} / ${totalPages}</span>
        <button class="btn btn-sm btn-secondary" ${_opPage===totalPages?'disabled':''} onclick="_opPage++;_renderOpGrid()">Próxima →</button>
      </div>
    </div>
  ` : '');
}

// ── Toggle ativo/inativo ──────────────────────────────────────────────────────
function toggleOp(id) {
  if (!isCurrentAdmin()) {
    showToast('Apenas administradores podem desativar/ativar operadores.', 'error');
    return;
  }
  toggleOperatorActive(id);
  filterOperadores();
  const op = getOperatorById(id);
  showToast(`${op?.name} ${op?.active ? 'ativado' : 'desativado'}.`, 'info');
}

// ── Excluir ──────────────────────────────────────────────────────────────────
function deleteOpConfirm(id) {
  if (!isCurrentAdmin()) {
    showToast('Apenas administradores podem excluir operadores.', 'error');
    return;
  }
  var op = getOperatorById(id);
  if (!op) return;
  confirmAction('Excluir operador <strong>' + escapeHtml(op.name) + '</strong>?', function() {
    var snapshot = JSON.parse(JSON.stringify(op));
    deleteOperator(id);
    filterOperadores();
    _updateOpStats();
    showUndoToast('Operador "' + op.name + '" removido.', function() {
      saveOperator(snapshot);
      filterOperadores();
      _updateOpStats();
      showToast('Operador restaurado.', 'success');
    });
  });
}

// ── Reenviar convite de Auth para um operador local ─────────────────────────
async function resendOperatorInvite(operatorId) {
  if (!isCurrentAdmin()) {
    showToast('Apenas administradores podem reenviar convites.', 'error');
    return;
  }
  const op = getOperatorById(operatorId);
  if (!op || !op.email) {
    showToast('Operador sem e-mail cadastrado.', 'error');
    return;
  }
  showToast(`Enviando convite para ${op.email}...`, 'info', 2500);
  const result = await authResendInvite(op.email);
  if (result.ok) {
    showToast(`📧 Convite (redefinição de senha) enviado para ${op.email}.\nO operador define a senha ao clicar no link.`, 'success', 6000);
  } else {
    showToast(`Falha ao enviar convite: ${result.message}`, 'error', 6000);
  }
}

function _updateOpStats() {
  const ops = getOperators();
  // rebuild full page to refresh counters
  _buildOperadoresPage();
}

// ── Formulário ───────────────────────────────────────────────────────────────
function openOperadorForm(id = null) {
  const session = getSession();
  const isAdminUser = isCurrentAdmin();

  if (id && !isAdminUser && session?.opId !== id) {
    showToast('Você só pode editar o seu próprio perfil.', 'error');
    return;
  }
  if (!id && !isAdminUser) {
    showToast('Apenas administradores podem criar novos operadores.', 'error');
    return;
  }

  const op = id ? getOperatorById(id) : {};
  const selColor = op?.color || OP_COLORS[0];
  const isSelf = session && session.opId === op.id;
  const hasCurrentPassword = !!op.pinHash;
  const esc = v => escapeHtml(v || '');

  const currentPasswordHtml = (isSelf && hasCurrentPassword) ? `
    <div class="form-row" style="margin-bottom: 12px;">
      <div class="form-group" style="width:100%">
        <label class="form-label">Senha atual *</label>
        <input class="form-input" type="password" name="currentPwd" id="opCurrentPwd" required placeholder="Digite sua senha atual para confirmar" />
      </div>
    </div>
  ` : '';

  const adminBanner = isAdminUser 
    ? `<div style="padding:8px 12px;background:rgba(26,86,219,0.1);border:1px solid rgba(26,86,219,0.3);border-radius:6px;margin-bottom:12px;font-size:12px;color:var(--accent);font-weight:600">🔑 Modo Administrador — você pode editar todos os campos</div>`
    : '';

  openModal(id ? 'Editar Operador' : 'Novo Operador', `
    <form id="opForm" onsubmit="submitOperadorForm(event,'${id||''}')">
      ${adminBanner}
      <div style="display:flex;align-items:center;gap:20px;margin-bottom:22px;padding:16px;background:var(--bg-base);border-radius:var(--radius)">
        <div id="opAvatarPreview" style="width:64px;height:64px;border-radius:50%;background:${selColor};display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;color:#fff;flex-shrink:0;transition:background .2s">
          ${esc(op?.initials || (op?.name ? op.name.substring(0,2).toUpperCase() : '?'))}
        </div>
        <div style="flex:1">
          <div class="form-group" style="margin-bottom:6px"><label class="form-label">Cor do avatar</label>
            <div style="display:flex;gap:6px;flex-wrap:wrap" id="opColorPicker">
              ${OP_COLORS.map(col => `<div onclick="selectOpColor('${col}')" style="width:26px;height:26px;border-radius:50%;background:${col};cursor:pointer;border:3px solid ${selColor===col?'#0f172a':'transparent'};transition:border-color .15s" data-color="${col}"></div>`).join('')}
            </div>
          </div>
        </div>
      </div>

      <div class="form-section">
        <div class="form-section-title">Dados Pessoais</div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Nome *</label>
            <input class="form-input" name="name" id="opNameInput" value="${esc(op?.name)}" required placeholder="Ex: Pedro" oninput="updateOpPreview()" />
          </div>
          <div class="form-group">
            <label class="form-label">Iniciais</label>
            <input class="form-input" name="initials" id="opInitialsInput" maxlength="3" value="${esc(op?.initials)}" placeholder="Ex: PE" oninput="updateOpPreview()" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group" style="flex:1">
            <label class="form-label">Cargo / Função</label>
            <input class="form-input" name="role" value="${esc(op?.role || 'Técnico')}" placeholder="Ex: Técnico, Analista..." ${isAdminUser ? '' : 'readonly'} />
          </div>
        </div>
        ${isAdminUser ? `
        <div class="form-row">
          <div class="form-group" style="flex:1">
            <label class="form-label">Equipe *</label>
            <select class="form-select" name="team" required>
              ${TEAM_OPTIONS.map(o => `<option value="${o.value}" ${(op?.team||'init')===o.value?'selected':''}>${o.label}</option>`).join('')}
            </select>
          </div>
          <div class="form-group" style="flex:1">
            <label class="form-label">Status</label>
            <select class="form-select" name="active">
              <option value="1" ${op?.active !== false ? 'selected' : ''}>Ativo</option>
              <option value="0" ${op?.active === false ? 'selected' : ''}>Inativo</option>
            </select>
          </div>
        </div>
        <div class="form-group" style="display:flex;align-items:center;gap:8px;margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
          <input type="checkbox" name="isAdmin" id="opIsAdmin" ${op?.isAdmin ? 'checked' : ''} style="width:18px;height:18px;cursor:pointer" />
          <label for="opIsAdmin" class="form-label" style="margin-bottom:0;cursor:pointer;font-weight:600">Perfil Administrador</label>
        </div>
        <div class="form-group" style="display:flex;align-items:center;gap:8px;margin-top:8px">
          <input type="checkbox" name="onLeave" id="opOnLeave" ${op?.onLeave ? 'checked' : ''} style="width:18px;height:18px;cursor:pointer" />
          <label for="opOnLeave" class="form-label" style="margin-bottom:0;cursor:pointer">🏖️ Afastado (onLeave)</label>
        </div>
        ` : `
        <input type="hidden" name="team" value="${op?.team||'init'}" />
        <input type="hidden" name="active" value="${op?.active !== false ? '1' : '0'}" />
        <input type="hidden" name="isAdmin" value="${op?.isAdmin ? '1' : '0'}" />
        `}
      </div>

      <div class="form-section">
        <div class="form-section-title">Contato</div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Telefone / WhatsApp</label>
            <input class="form-input" name="phone" value="${esc(op?.phone)}" placeholder="(11) 99999-9999" />
          </div>
          <div class="form-group">
            <label class="form-label">E-mail</label>
            <input class="form-input" type="email" name="email" value="${esc(op?.email)}" placeholder="nome@initnet.com.br" />
          </div>
        </div>
      </div>

      <div class="form-section">
        <div class="form-section-title">Observações</div>
        <textarea class="form-textarea" name="notes" rows="2" placeholder="Especialidades, turnos, etc...">${esc(op?.notes)}</textarea>
      </div>

      <div class="form-section">
        <div class="form-section-title">Senha de Acesso</div>
        ${currentPasswordHtml}
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Nova senha</label>
            <input class="form-input" type="password" name="newPwd" id="opNewPwd" minlength="8" autocomplete="new-password" placeholder="${id ? 'Deixe vazio para não alterar' : 'Mín. 8 caracteres'}" ${!id ? 'required' : ''} />
          </div>
          <div class="form-group">
            <label class="form-label">Confirmar senha</label>
            <input class="form-input" type="password" name="confirmPwd" id="opConfirmPwd" minlength="8" autocomplete="new-password" placeholder="${id ? 'Repita a nova senha' : 'Repita a senha'}" ${!id ? 'required' : ''} />
          </div>
        </div>
        <p style="font-size:11px;color:var(--text-muted);margin-top:-8px">Senha gerenciada pelo sistema de autenticação. Mínimo 8 caracteres.</p>
      </div>

      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn-primary"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Salvar</button>
      </div>
    </form>`, 'sm');

  window._selectedOpColor = selColor;
}

function selectOpColor(col) {
  window._selectedOpColor = col;
  document.querySelectorAll('#opColorPicker div').forEach(d => {
    d.style.border = `3px solid ${d.dataset.color === col ? '#0f172a' : 'transparent'}`;
  });
  updateOpPreview();
}

function updateOpPreview() {
  const name     = document.getElementById('opNameInput')?.value || '';
  const initials = document.getElementById('opInitialsInput')?.value ||
                   (name ? name.substring(0, 2).toUpperCase() : '?');
  const color    = window._selectedOpColor || OP_COLORS[0];
  const preview  = document.getElementById('opAvatarPreview');
  if (preview) {
    preview.style.background = color;
    preview.textContent = initials;
  }
}

async function submitOperadorForm(e, id) {
  e.preventDefault();
  try {
    const fd = new FormData(e.target);
    const g  = k => fd.get(k) || '';
    const name = g('name').trim();
    if (!name) { showToast('Nome é obrigatório.', 'error'); return; }

    const session = getSession();
  const isAdminUser = typeof isCurrentAdmin === 'function' ? isCurrentAdmin() : false;
    const isSelf = session && session.opId === id;

    if (id && !isAdminUser && !isSelf) {
      showToast('Permissão negada.', 'error');
      return;
    }
    if (!id && !isAdminUser) {
      showToast('Apenas administradores podem cadastrar operadores.', 'error');
      return;
    }

    const existing = id ? getOperatorById(id) : null;

    if (isSelf && existing && existing.pinHash) {
      const currentPwd = g('currentPwd').trim();
      if (!currentPwd) {
        showToast('A senha atual é necessária para salvar as alterações.', 'error');
        return;
      }
      const currentHash = await hashPin(currentPwd, existing.pinSalt);
      if (currentHash !== existing.pinHash) {
        showToast('Senha atual incorreta.', 'error');
        return;
      }
    }

    const initials = g('initials').trim() || name.substring(0, 2).toUpperCase();

    // Handle password
    const newPwd     = g('newPwd').trim();
    const confirmPwd = g('confirmPwd').trim();
    
    if (!id && !newPwd) {
      showToast('A senha é obrigatória para novos operadores.', 'error');
      return;
    }

    if (newPwd || confirmPwd) {
      if (newPwd !== confirmPwd) { showToast('As senhas não coincidem.', 'error'); return; }
      if (newPwd.length < 8)    { showToast('A senha deve ter pelo menos 8 caracteres.', 'error'); return; }
    }

    const pinHash = newPwd ? undefined : (existing?.pinHash || null);

    let activeVal = true;
    if (isAdminUser) {
      activeVal = g('active') !== '0';
    } else if (existing) {
      activeVal = existing.active !== false;
    }

    let isAdminVal = false;
    if (isAdminUser) {
      isAdminVal = fd.get('isAdmin') !== null;
    } else if (existing) {
      isAdminVal = existing.isAdmin === true;
    }

    let onLeaveVal = false;
    if (isAdminUser) {
      onLeaveVal = fd.get('onLeave') !== null;
    } else if (existing) {
      onLeaveVal = existing.onLeave === true;
    }

    const opData = {
      id: id || null,
      name,
      initials,
      color:  window._selectedOpColor || OP_COLORS[0],
      role:   g('role') || 'Técnico',
      phone:  g('phone'),
      email:  g('email'),
      notes:  g('notes'),
      active: activeVal,
      isAdmin: isAdminVal,
      onLeave: onLeaveVal,
      team:   g('team') || 'init',
      pinHash,
      pinSalt: existing?.pinSalt,
      pin: newPwd
    };

    const opErrors = validateOperator(opData);
    if (opErrors.length) { showToast(opErrors[0], 'error'); return; }

    await saveOperator(opData);

    // Atualizar senha no Supabase Auth (para o próprio operador logado)
    let authMsg = null;
    if (id && isSelf && newPwd && existing?.auth_user_id) {
      try {
        const { error } = await supabaseClient.auth.updateUser({ password: newPwd });
        if (error) {
          authMsg = 'Perfil salvo, mas a senha de login não pôde ser atualizada. Tente novamente.';
        }
      } catch (_) {
        authMsg = 'Perfil salvo, mas a senha de login não pôde ser atualizada. Tente novamente.';
      }
    } else if (id && isAdminUser && newPwd && existing?.auth_user_id) {
      // Admin alterando senha de outro operador — via Edge Function (service role)
      try {
        const { data: resetData, error: resetErr } = await supabaseClient.functions.invoke('update-user-password', {
          body: { userId: existing.auth_user_id, password: newPwd }
        });
        if (resetErr || (resetData && resetData.error)) {
          authMsg = 'Operador salvo, mas a senha de login não pôde ser atualizada. Tente novamente.';
        }
      } catch (_) {
        authMsg = 'Operador salvo, mas a senha de login não pôde ser atualizada. Tente novamente.';
      }
    }

    // Criar usuário no Supabase Auth (apenas para novos operadores, se conectado)
    if (!id && opData.email && newPwd) {
      if (typeof authCreateUser === 'function') {
        const result = await authCreateUser(opData.email, newPwd);
        if (result.ok) {
          // Vínculo automático com o operador recém-criado
           const list = dbGet(DB.OPERATORS);
          const opIdx = list.findIndex(o => o.email?.toLowerCase() === opData.email.toLowerCase());
          if (opIdx !== -1 && result.authUserId && !list[opIdx].auth_user_id) {
            list[opIdx].auth_user_id = result.authUserId;
            list[opIdx].updatedAt = new Date().toISOString();
            dbSet(DB.OPERATORS, list);
            if (typeof supabaseClient !== 'undefined' && supabaseClient) {
              try {
                const { error: linkErr } = await supabaseClient
                  .from('operators')
                  .update({ auth_user_id: result.authUserId, updated_at: new Date().toISOString() })
                  .eq('id', list[opIdx].id);
                if (linkErr) console.warn('⚠️ Falha ao vincular auth_user_id no Supabase:', linkErr.message);
              } catch (linkErr) {
                console.warn('⚠️ Erro ao vincular auth_user_id no Supabase:', linkErr.message);
              }
            }
          }
          if (result.needsEmailConfirm) {
            authMsg = `E-mail de confirmação enviado. O operador só entrará após confirmar.`;
          } else {
            authMsg = `Operador e acesso de login criados com sucesso.`;
          }
        } else if (result.reason === 'duplicate') {
          authMsg = `Já existe login com esse e-mail. O operador foi salvo; o vínculo ocorre no primeiro acesso.`;
        } else {
          authMsg = `Operador salvo, mas o login não pôde ser criado. Contate o suporte.`;
        }
      }
    }

    closeModal();
    _buildOperadoresPage();
    if (authMsg) {
      showToast(authMsg, authMsg.startsWith('✅') ? 'success' : 'warning', 6000);
    } else {
      showToast(id ? 'Operador atualizado!' : 'Operador cadastrado!', 'success');
    }
  } catch (err) { showToast('Erro ao salvar operador: ' + err.message, 'error'); }
}


// ── Helper: lista de nomes para selects em outros módulos ────────────────────
function getOperatorNames(team) {
  const ops = getOperators().filter(o => o.active !== false);
  if (!team) return ops.map(o => o.name);
  return ops.filter(o => (o.team || 'init') === team).map(o => o.name);
}

function isOperatorOnLeave(name) {
  if (!name) return false;
  const ops = getOperators();
  const byName = ops.find(o => o.name === name);
  if (byName) return byName.onLeave === true;
  const byId = typeof getOperatorById === 'function' ? getOperatorById(name) : null;
  return byId ? byId.onLeave === true : false;
}

// ── Modal: pendências por operador ───────────────────────────────
function openOpPendencias(opId) {
  const op = getOperatorById(opId);
  if (!op) return;

  const allPens = (typeof getPendencias === 'function' ? getPendencias() : []).filter(p => p.responsible === op.name);
  const activePens = allPens.filter(p => !isPendenciaClosed(p.status));
  const donePens   = allPens.filter(p => isPendenciaClosed(p.status));

  const renderPenList = (list) => {
    if (!list.length) return '<p class="text-muted" style="padding:8px 0;font-size:13px">Nenhuma pendência.</p>';
    return list.map(p => {
      const c = getClientById(p.clientId);
      const color = c?.color || '#2563eb';
        const isOverdue = p.deadline && p.deadline < localDateISO() && !isPendenciaClosed(p.status);
      return `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;border:1px solid var(--border);margin-bottom:8px;cursor:pointer;transition:border-color .15s;background:var(--bg-surface)"
             onmouseover="this.style.borderColor='#1a56db'" onmouseout="this.style.borderColor='var(--border)'"
             onclick="closeModal();navigateTo('pendencias');setTimeout(()=>openPendenciaDetail('${escapeHtml(p.id)}'),100)">
          ${c ? clientAvatar(c, 28) : ''}
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(getPendenciaTitulo(p))}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px">
              <span class="client-badge" style="background:${escapeHtml(color)}20;color:${escapeHtml(color)};border:1px solid ${escapeHtml(color)}40">${escapeHtml(p.clientName || '—')}</span>
              ${p.deadline ? `· <span style="${isOverdue ? 'color:#dc2626;font-weight:600' : ''}">${formatDate(parseDeadline(p.deadline))}</span>` : ''}
            </div>
          </div>
          <div style="display:flex;gap:4px;flex-shrink:0">${statusTag(p.status)} ${priorityTag(p.priority)}</div>
        </div>`;
    }).join('');
  };

  const color = op.color || '#1a56db';
  const initials = op.initials || op.name.substring(0, 2).toUpperCase();

  openModal(op.name, `
    <div class="op-detail-header" style="display:flex;align-items:center;gap:14px;padding:14px 16px;background:var(--bg-base);border-radius:var(--radius);margin-bottom:20px">
      <div style="width:52px;height:52px;border-radius:50%;background:${escapeHtml(color)};display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;color:#fff;flex-shrink:0">${escapeHtml(initials)}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:16px;font-weight:700">${escapeHtml(op.name)} ${op.onLeave ? `<span class="tag badge-afastado">🏖️ Afastado</span>` : ''}</div>
        <div style="font-size:12px;color:var(--text-muted)">${escapeHtml(op.role || 'Técnico')}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <div style="text-align:center;padding:8px 12px;background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius-sm)">
          <div style="font-size:18px;font-weight:700;color:var(--accent)">${activePens.length}</div>
          <div style="font-size:10px;color:var(--text-muted)">Ativos</div>
        </div>
        <div style="text-align:center;padding:8px 12px;background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius-sm)">
          <div style="font-size:18px;font-weight:700;color:var(--green)">${donePens.length}</div>
          <div style="font-size:10px;color:var(--text-muted)">Concluídos</div>
        </div>
      </div>
    </div>

    <div style="font-size:11px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">
      📌 Pendências Ativas (${activePens.length})
    </div>
    ${renderPenList(activePens)}

    ${donePens.length ? `
    <hr class="divider"/>
    <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">
      ✅ Concluídas (${donePens.length})
    </div>
    ${renderPenList(donePens)}
    ` : ''}

    <div class="form-actions" style="margin-top:16px">
      <button class="btn btn-secondary" onclick="closeModal()">Fechar</button>
      <button class="btn btn-primary" onclick="closeModal();navigateTo('pendencias');setTimeout(()=>openPendenciaForm(null,null),100)">+ Nova Pendência</button>
    </div>
  `, 'lg');
}
