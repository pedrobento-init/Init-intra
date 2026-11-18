// operadores.js – Módulo de gestão de operadores

const OP_COLORS = [
  '#1a56db',
  '#3b82f6',
  '#0891b2',
  '#0f766e',
  '#16a34a',
  '#4f46e5',
  '#6366f1',
  '#7c3aed',
  '#d97706',
  '#dc2626',
];

function _opHash(str) {
  var s = String(str || '')
    .toLowerCase()
    .trim();
  var h = 0;
  for (var i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}
function getOpAvatarColor(opOrName) {
  var name = typeof opOrName === 'string' ? opOrName : (opOrName && opOrName.name) || '';
  var idx = _opHash(name || '?') % OP_COLORS.length;
  return OP_COLORS[idx];
}
function _opKebabIcon() {
  return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>';
}
function _opTrashIcon() {
  return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
}
function _opKeyIcon() {
  return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="7.5" cy="7.5" r="3.5"/><path d="M10.5 10.5 L21 21"/><path d="M15 21l3-3-3-3"/><path d="M19 11a7 7 0 1 1-7-7"/></svg>';
}
function _opLeaveIcon() {
  return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 8a4 4 0 1 0-8 0 4 4 0 0 0 8 0z"/><path d="M4 20a8 8 0 0 1 16 0"/><line x1="4" y1="4" x2="20" y2="20"/></svg>';
}
function toggleOpMenu(id) {
  var menu = document.getElementById('opMenu-' + id);
  if (!menu) return;
  var isOpen = menu.dataset.open === '1';
  document.querySelectorAll('.op-kebab-menu[data-open="1"]').forEach(function (m) {
    m.dataset.open = '0';
    m.style.display = 'none';
    var c = m.closest && m.closest('.op-card');
    if (c) c.classList.remove('op-card--menu-open');
  });
  document.querySelectorAll('.op-kebab-btn[aria-expanded="true"]').forEach(function (b) {
    b.setAttribute('aria-expanded', 'false');
  });
  if (isOpen) return;
  menu.dataset.open = '1';
  menu.style.display = 'flex';
  var card = menu.closest && menu.closest('.op-card');
  if (card) card.classList.add('op-card--menu-open');
  var wrap = menu.closest('.op-kebab-wrap');
  if (wrap) {
    var b2 = wrap.querySelector('.op-kebab-btn');
    if (b2) b2.setAttribute('aria-expanded', 'true');
  }
}
function _closeOpMenus(e) {
  if (e.target.closest && e.target.closest('.op-kebab-wrap')) return;
  document.querySelectorAll('.op-kebab-menu[data-open="1"]').forEach(function (m) {
    m.dataset.open = '0';
    m.style.display = 'none';
    var c = m.closest && m.closest('.op-card');
    if (c) c.classList.remove('op-card--menu-open');
  });
  document.querySelectorAll('.op-kebab-btn[aria-expanded="true"]').forEach(function (b) {
    b.setAttribute('aria-expanded', 'false');
  });
}
if (typeof window !== 'undefined' && !window._opMenuBound) {
  window._opMenuBound = true;
  document.addEventListener('click', _closeOpMenus);
}

let _opPage = 1;
let _filteredOps = [];
const OP_PAGE_SIZE = typeof UI_PAGE_SIZE !== 'undefined' ? UI_PAGE_SIZE : 30;

// ── Render principal ──────────────────────────────────────────────────────────
function renderOperadores() {
  document.getElementById('pageTitle').textContent = 'Operadores';
  // Leitura liberada a todos; o CTA administrativo só existe para admin
  // (não-admin recebe botão morto se exibido — ver openOperadorForm).
  if (typeof isCurrentAdmin === 'function' && isCurrentAdmin()) {
    setTopbarAction(
      'Novo Operador',
      '<svg class="topbar-action-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'
    );
    window._topbarAction = () => openOperadorForm();
  } else {
    const _btn = document.getElementById('topbarActionBtn');
    if (_btn) _btn.style.display = 'none';
    window._topbarAction = null;
  }

  const savedFilters = loadFilterState('operadores', {});
  _buildOperadoresPage(savedFilters);
}

function _buildOperadoresPage(savedFilters = {}) {
  var ops = getOperators();
  // Filter by team
  if (!isTeamAdmin()) {
    ops = ops.filter((o) => (o.team || 'init') === getCurrentTeam());
  } else if (typeof _selectedTeam !== 'undefined' && _selectedTeam) {
    ops = ops.filter((o) => (o.team || 'init') === _selectedTeam);
  }
  var ativos = ops.filter((o) => o.active);
  var inativos = ops.filter((o) => !o.active);
  _filteredOps = ops;
  _opPage = 1;

  // [UI] Alterado para seguir padrão Dashboard: wrapper .ov-wrap + header ov-head/ov-h1
  // (stats/search/grid idênticos por classe — só containers/classes visuais).
  document.getElementById('contentArea').innerHTML = `
    <div class="ov-wrap">
      <div class="op-stats-row">
        <div class="op-stat">
          <span class="op-stat-value">${ops.length}</span>
          <span class="op-stat-label">Total</span>
        </div>
        <div class="op-stat">
          <span class="op-stat-value u-39617d">${ativos.length}</span>
          <span class="op-stat-label">Ativos</span>
        </div>
        <div class="op-stat">
          <span class="op-stat-value u-1711ed">${inativos.length}</span>
          <span class="op-stat-label">Inativos</span>
        </div>
      </div>

      <div class="search-bar page-toolbar">
        <div class="search-input-wrap pt-search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input class="form-input" id="opSearch" placeholder="Buscar operador..." data-input="debouncedFilterOperadores" />
        </div>
        <div class="pt-filter pt-seg pt-full" role="group" aria-label="Filtrar operadores">
          <button class="btn btn-secondary btn-sm op-filter-btn active" data-filter="todos" data-action="setOpFilter">Todos</button>
          <button class="btn btn-secondary btn-sm op-filter-btn" data-filter="ativos" data-action="setOpFilter">Ativos</button>
          <button class="btn btn-secondary btn-sm op-filter-btn" data-filter="inativos" data-action="setOpFilter">Inativos</button>
        </div>
      </div>

      <div class="op-grid" id="opGridWrap"></div>
    </div>`;

  if (savedFilters.search) document.getElementById('opSearch').value = savedFilters.search;
  if (savedFilters.filter) {
    window._opFilter = savedFilters.filter;
    const activeBtn = document.querySelector(`.op-filter-btn[data-filter="${window._opFilter}"]`);
    if (activeBtn) {
      document.querySelectorAll('.op-filter-btn').forEach((b) => b.classList.remove('active'));
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
  document.querySelectorAll('.op-filter-btn').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  filterOperadores();
}

function filterOperadores() {
  _opPage = 1;
  const q = (document.getElementById('opSearch')?.value || '').toLowerCase();
  let ops = getOperators();
  // Filter by team (admin sees all, others see only their team)
  if (!isTeamAdmin()) {
    ops = ops.filter((o) => (o.team || 'init') === getCurrentTeam());
  } else if (typeof _selectedTeam !== 'undefined' && _selectedTeam) {
    ops = ops.filter((o) => (o.team || 'init') === _selectedTeam);
  }
  if (window._opFilter === 'ativos') ops = ops.filter((o) => o.active);
  if (window._opFilter === 'inativos') ops = ops.filter((o) => !o.active);
  if (q)
    ops = ops.filter((o) => o.name?.toLowerCase().includes(q) || o.role?.toLowerCase().includes(q));
  _filteredOps = ops;
  saveFilterState('operadores', {
    search: document.getElementById('opSearch')?.value || '',
    filter: window._opFilter,
  });
  _renderOpGrid();
}

function _renderOpGrid() {
  const grid = document.getElementById('opGridWrap');
  if (!grid) return;
  const ops = _filteredOps;
  if (!ops.length) {
    const _canCreate = typeof isCurrentAdmin === 'function' && isCurrentAdmin();
    grid.innerHTML = `<div class="empty-state"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg><p>Nenhum operador encontrado</p>${_canCreate ? '<button class="btn btn-primary btn-sm" data-action="openOperadorForm">+ Novo Operador</button>' : ''}</div>`;
    return;
  }

  const totalPages = Math.ceil(ops.length / OP_PAGE_SIZE);
  if (_opPage > totalPages) _opPage = totalPages;
  if (_opPage < 1) _opPage = 1;

  const startIdx = (_opPage - 1) * OP_PAGE_SIZE;
  const pageOps = ops.slice(startIdx, startIdx + OP_PAGE_SIZE);

  // Count active tasks per operator
  const pens = (typeof getPendencias === 'function' ? getPendencias() : []).filter(
    (p) => !isPendenciaClosed(p.status)
  );
  const session = getSession();
  const isAdminUser = isCurrentAdmin();

  grid.innerHTML =
    pageOps
      .map((op) => {
        const penCount = pens.filter((p) => p.responsible === op.name).length;
        // Defesa: registro sem nome/iniciais não pode travar a grade no skeleton.
        const initials = op.initials || (op.name || '?').substring(0, 2).toUpperCase() || '?';
        const color = op.color || getOpAvatarColor(op.name);
        const isActive = op.active !== false;
        const isSelf = session && session.opId === op.id;
        // 1. Ação principal sempre visível + menu ⋮ para secundárias
        let actionsHtml = '';
        let kebabItems = '';
        if (isAdminUser || isSelf) {
          actionsHtml += `<button class="btn btn-secondary btn-sm op-edit-btn" data-action="openOperadorForm" data-arg="${escapeHtml(op.id)}" data-stop="1"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Editar</button>`;
        }
        if (isAdminUser) {
          kebabItems += `
        <button class="op-kebab-item" data-action="opToggleActive" data-arg="${escapeHtml(op.id)}" data-stop="1" title="${isActive ? 'Desativar' : 'Ativar'}">
          ${
            isActive
              ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>`
              : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 8 12 14 14"/></svg>`
          }
          <span>${isActive ? 'Desativar' : 'Ativar'}</span>
        </button>`;
          if (op.email) {
            kebabItems += `<button class="op-kebab-item" data-action="opResendInvite" data-arg="${escapeHtml(op.id)}" data-stop="1" title="Reenviar convite"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg><span>Reenviar convite</span></button>`;
          }
          kebabItems += `<button class="op-kebab-item op-kebab-item--danger" data-action="opDeleteConfirm" data-arg="${escapeHtml(op.id)}" data-stop="1" title="Excluir">${_opTrashIcon()}<span>Excluir</span></button>`;
        }
        if (kebabItems) {
          actionsHtml += `<div class="op-kebab-wrap"><button class="btn btn-secondary btn-sm op-kebab-btn" data-action="toggleOpMenu" data-arg="${escapeHtml(op.id)}" data-stop="1" aria-label="Mais ações" aria-expanded="false">${_opKebabIcon()}</button><div class="op-kebab-menu u-6b99de" id="opMenu-${escapeHtml(op.id)}" data-open="0">${kebabItems}</div></div>`;
        }

        return `
      <div class="op-card ${isActive ? '' : 'op-card--inactive'} u-3b6a3a" role="button" tabindex="0" data-action="openOpPendencias" data-arg="${escapeHtml(op.id)}">
        <div class="op-card-header">
          <div class="op-avatar" data-sty="background:${escapeHtml(color)}">${opAvatarFoto(op) || escapeHtml(initials)}${isActive ? `<i class="pres-dot pres-dot--${typeof presencaStatusDe === 'function' ? presencaStatusDe(op.id) : 'offline'}" data-pres-op="${escapeHtml(op.id)}" aria-hidden="true"></i>` : ''}</div>
          <div class="u-c87525">
            <div class="op-card-badge ${isActive ? 'op-badge-active' : 'op-badge-inactive'}">
              ${isActive ? 'Ativo' : 'Inativo'}
            </div>
            ${op.onLeave ? `<span class="tag badge-afastado">${_opLeaveIcon()} Afastado</span>` : ''}
          </div>
        </div>
        <div class="op-card-name">${escapeHtml(op.name)}</div>
        <div class="op-card-role">${escapeHtml(op.role || 'Técnico')}</div>
        ${op.phone ? `<div class="op-card-contact"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13 19.79 19.79 0 0 1 1.61 4.38 2 2 0 0 1 3.58 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.18 6.18l1.97-1.97a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg> ${escapeHtml(op.phone)}</div>` : ''}
        ${op.email ? `<div class="op-card-contact"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg> ${escapeHtml(op.email)}</div>` : ''}
        <div class="op-card-tasks">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
          <span>${penCount} pendência${penCount === 1 ? '' : 's'}</span>
          ${penCount > 0 ? '<span class="op-tasks-link">Ver →</span>' : '<span class="op-tasks-empty" aria-hidden="true"></span>'}
        </div>
        ${actionsHtml ? `<div class="op-card-actions">${actionsHtml}</div>` : ''}
      </div>`;
      })
      .join('') +
    (totalPages > 1
      ? `
    <div class="u-048982">
      <div class="u-8ff086">Mostrando ${startIdx + 1}–${Math.min(startIdx + OP_PAGE_SIZE, ops.length)} de ${ops.length} operadores</div>
      <div class="u-49cd09">
        <button class="btn btn-sm btn-secondary" ${_opPage === 1 ? 'disabled' : ''} data-action="opPageDelta" data-arg="-1">← Anterior</button>
        <span class="u-48936d">${_opPage} / ${totalPages}</span>
        <button class="btn btn-sm btn-secondary" ${_opPage === totalPages ? 'disabled' : ''} data-action="opPageDelta" data-arg="1">Próxima →</button>
      </div>
    </div>
  `
      : '');
}

// ── Toggle ativo/inativo ──────────────────────────────────────────────────────
function toggleOp(id) {
  if (!isCurrentAdmin()) {
    showToast('Apenas administradores podem desativar/ativar operadores.', 'error');
    return;
  }
  toggleOperatorActive(id);
  _refreshOpListKeepPage(); // preserva busca/filtro/página (filterOperadores puro resetaria a página)
  _refreshOpStats(); // header Total/Ativos/Inativos acompanha o toggle na hora
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
  confirmAction('Excluir operador <strong>' + escapeHtml(op.name) + '</strong>?', function () {
    var snapshot = JSON.parse(JSON.stringify(op));
    deleteOperator(id);
    if (getOperatorById(id)) {
      showToast('Não foi possível excluir este operador.', 'error');
      return;
    }
    _refreshOpListKeepPage();
    _refreshOpStats();
    showUndoToast('Operador "' + op.name + '" removido.', function () {
      // saveOperator é async (hash); só atualiza a UI após persistir.
      Promise.resolve(saveOperator(snapshot))
        .then(function () {
          _refreshOpListKeepPage();
          _refreshOpStats();
          showToast('Operador restaurado.', 'success');
        })
        .catch(function (err) {
          showToast(
            'Falha ao restaurar operador: ' + (err && err.message ? err.message : err),
            'error'
          );
        });
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
    showToast(
      `📧 Convite (redefinição de senha) enviado para ${op.email}.\nO operador define a senha ao clicar no link.`,
      'success',
      6000
    );
  } else {
    showToast(`Falha ao enviar convite: ${result.message}`, 'error', 6000);
  }
}

function _updateOpStats() {
  // rebuild full page to refresh counters
  _buildOperadoresPage();
}

// Atualiza os contadores do header (Total/Ativos/Inativos) no lugar, sem
// rebuild da página — preserva busca, filtro, paginação e scroll.
function _refreshOpStats() {
  try {
    var ops = typeof getOperators === 'function' ? getOperators() : [];
    if (typeof isTeamAdmin === 'function' && !isTeamAdmin()) {
      ops = ops.filter(function (o) {
        return (
          (o.team || 'init') === (typeof getCurrentTeam === 'function' ? getCurrentTeam() : 'init')
        );
      });
    } else if (typeof _selectedTeam !== 'undefined' && _selectedTeam) {
      ops = ops.filter(function (o) {
        return (o.team || 'init') === _selectedTeam;
      });
    }
    var vals = document.querySelectorAll('.op-stats-row .op-stat-value');
    if (!vals || vals.length < 3) {
      _updateOpStats();
      return;
    } // fallback: rebuild
    vals[0].textContent = ops.length;
    vals[1].textContent = ops.filter(function (o) {
      return o.active;
    }).length;
    vals[2].textContent = ops.filter(function (o) {
      return !o.active;
    }).length;
  } catch (_) {
    try {
      _updateOpStats();
    } catch (_e) {
      if (typeof _logSilent === 'function') _logSilent(_e, 'operadores');
    }
  }
}

// Reaplica busca/filtro atuais à grade preservando a página (filterOperadores
// puro sempre volta para a página 1). Não toca no header nem no scroll.
function _refreshOpListKeepPage() {
  try {
    if (!document.getElementById('opGridWrap')) return;
    var pg = typeof _opPage === 'number' && _opPage > 0 ? _opPage : 1;
    if (typeof filterOperadores === 'function') filterOperadores(); // reseta para 1
    _opPage = pg;
    if (typeof _renderOpGrid === 'function') _renderOpGrid(); // fixa se passou do total
  } catch (_e) {
    if (typeof _logSilent === 'function') _logSilent(_e, 'operadores');
  }
}

// ── Foto do operador ─────────────────────────────────────────────────────────
// A foto vive como data URL na própria linha (coluna photo, migration 084),
// reduzida a 256x256 antes de guardar. O valor só vira <img> se passar neste
// filtro: data URL raster. SVG fica de fora, pois pode carregar script.
const OP_FOTO_LADO = 256;
const OP_FOTO_MAX_ORIGEM = 8 * 1024 * 1024;
const OP_FOTO_MAX_CHARS = 150000; // mesmo teto do CHECK da migration 084

function opFotoSegura(v) {
  const s = String(v || '');
  if (s.length > OP_FOTO_MAX_CHARS) return '';
  return /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s) ? s : '';
}

// Recorte quadrado centralizado: { sx, sy, lado } na imagem de origem.
function opFotoRecorte(largura, altura) {
  const lado = Math.min(largura, altura);
  return { sx: Math.floor((largura - lado) / 2), sy: Math.floor((altura - lado) / 2), lado };
}

function opAvatarFoto(op) {
  const foto = opFotoSegura(op && op.photo);
  return foto
    ? `<img class="op-avatar-img" src="${escapeHtml(foto)}" alt="" draggable="false" />`
    : '';
}

// ── Formulário ───────────────────────────────────────────────────────────────
const _OP_ICO = {
  camera:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
  user: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  phone:
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
  mail: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>',
  shield:
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  lock: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  note: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></svg>',
  eye: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
  trash:
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m5 0V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2"/></svg>',
};

function _opSecao(icone, titulo, descricao, corpo) {
  return `<section class="opf-card">
    <div class="opf-card-head"><span class="opf-card-ico">${icone}</span>
      <div><div class="opf-card-title">${titulo}</div>${descricao ? `<div class="opf-card-sub">${descricao}</div>` : ''}</div>
    </div>
    <div class="opf-card-body">${corpo}</div>
  </section>`;
}

function _opSwitch(name, id, marcado, titulo, descricao) {
  return `<label class="opf-toggle" for="${id}">
    <input type="checkbox" name="${name}" id="${id}" ${marcado ? 'checked' : ''} data-change="updateOpPreview" />
    <span class="opf-switch" aria-hidden="true"></span>
    <span class="opf-toggle-txt"><b>${titulo}</b><small>${descricao}</small></span>
  </label>`;
}

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
  const selColor = op?.color || getOpAvatarColor(op?.name || '') || OP_COLORS[0];
  const isSelf = session && session.opId === op.id;
  // Trocar a própria senha pede a atual, conferida no Supabase Auth (online).
  const hasCurrentPassword = !!(
    op.email &&
    typeof isSupabaseConnected === 'function' &&
    isSupabaseConnected() &&
    window._supabaseAuthActive
  );
  const esc = (v) => escapeHtml(v || '');
  const foto = opFotoSegura(op?.photo);

  const currentPasswordHtml =
    isSelf && hasCurrentPassword
      ? `
    <div class="form-group">
      <label class="form-label">Senha atual <span class="opf-opt">(só para trocar a senha)</span></label>
      <input class="form-input" type="password" name="currentPwd" id="opCurrentPwd" autocomplete="current-password" placeholder="Necessária se for definir uma senha nova" />
    </div>`
      : '';

  const adminBanner = isAdminUser
    ? `<div class="opf-banner">${_opKeyIcon()} Modo Administrador — você pode editar todos os campos</div>`
    : '';

  const dados = `
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="opNameInput">Nome *</label>
        <input class="form-input" name="name" id="opNameInput" value="${esc(op?.name)}" required placeholder="Ex: Pedro Bento" data-input="updateOpPreview" />
      </div>
      <div class="form-group">
        <label class="form-label" for="opInitialsInput">Iniciais</label>
        <input class="form-input" name="initials" id="opInitialsInput" maxlength="3" value="${esc(op?.initials)}" placeholder="Ex: PB" data-input="updateOpPreview" />
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="opRoleInput">Cargo / Função</label>
        <input class="form-input" name="role" id="opRoleInput" value="${esc(op?.role || 'Técnico')}" placeholder="Ex: Técnico, Analista..." data-input="updateOpPreview" ${isAdminUser ? '' : 'readonly'} />
      </div>
      ${
        isAdminUser
          ? `<div class="form-group">
        <label class="form-label" for="opTeamSelect">Equipe *</label>
        <select class="form-select" name="team" id="opTeamSelect" required data-change="updateOpPreview">
          ${TEAM_OPTIONS.map((o) => `<option value="${o.value}" ${(op?.team || 'init') === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
        </select>
      </div>`
          : `<div class="form-group">
        <label class="form-label">Equipe</label>
        <div class="opf-readonly">${esc((TEAM_OPTIONS.find((o) => o.value === (op?.team || 'init')) || {}).label || op?.team || 'init')}</div>
        <input type="hidden" name="team" value="${esc(op?.team || 'init')}" />
      </div>`
      }
    </div>
    <div class="form-group">
      <label class="form-label">Cor do avatar <span class="opf-opt">(aparece quando não há foto)</span></label>
      <div class="opf-colors" id="opColorPicker">
        ${OP_COLORS.map((col) => {
          const sel = selColor === col;
          return `<button type="button" class="opf-color${sel ? ' is-sel' : ''}" data-action="selectOpColor" data-arg="${escapeHtml(col)}" aria-label="Cor ${col}" aria-pressed="${sel ? 'true' : 'false'}" data-sty="background:${col}" data-color="${col}"></button>`;
        }).join('')}
      </div>
    </div>`;

  const contato = `
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="opPhoneInput">Telefone / WhatsApp</label>
        <div class="opf-field"><span class="opf-field-ico">${_OP_ICO.phone}</span>
          <input class="form-input" name="phone" id="opPhoneInput" value="${esc(op?.phone)}" placeholder="(11) 99999-9999" autocomplete="tel" /></div>
      </div>
      <div class="form-group">
        <label class="form-label" for="opEmailInput">E-mail</label>
        <div class="opf-field"><span class="opf-field-ico">${_OP_ICO.mail}</span>
          <input class="form-input" type="email" name="email" id="opEmailInput" value="${esc(op?.email)}" placeholder="nome@initnet.com.br" autocomplete="email" /></div>
      </div>
    </div>`;

  const permissoes = isAdminUser
    ? `<div class="opf-toggles">
        ${_opSwitch('isAdmin', 'opIsAdmin', op && op.isAdmin === true, 'Administrador', 'Acesso total: cria operadores, edita qualquer perfil e vê todas as equipes.')}
        ${_opSwitch('isGestao', 'opIsGestao', op && op.isGestao === true, 'Gestão', 'Vê e cria pendências do tipo Gestão (nem administrador vê sem isso).')}
        ${_opSwitch('onLeave', 'opOnLeave', op && op.onLeave === true, 'Afastado', 'Férias, licença ou atestado: aparece como afastado nas atribuições.')}
      </div>
      <div class="form-group opf-status">
        <label class="form-label" for="opStatusSelect">Situação do cadastro</label>
        <select class="form-select" name="active" id="opStatusSelect" data-change="updateOpPreview">
          <option value="1" ${op?.active !== false ? 'selected' : ''}>Ativo — pode entrar e receber atribuições</option>
          <option value="0" ${op?.active === false ? 'selected' : ''}>Inativo — sem acesso, histórico preservado</option>
        </select>
      </div>`
    : `<input type="hidden" name="active" value="${op?.active !== false ? '1' : '0'}" />
       <input type="hidden" name="isAdmin" value="${op?.isAdmin ? '1' : '0'}" />
       <p class="opf-note">Perfil e permissões são definidos por um administrador.</p>`;

  const senha = `
    ${currentPasswordHtml}
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="opNewPwd">Nova senha</label>
        <div class="opf-field opf-field--pwd">
          <input class="form-input" type="password" name="newPwd" id="opNewPwd" minlength="8" autocomplete="new-password" data-input="opPwdMeter" placeholder="${id ? 'Deixe vazio para não alterar' : 'Mín. 8 caracteres'}" ${!id ? 'required' : ''} />
          <button type="button" class="opf-eye" data-action="opTogglePwd" aria-label="Mostrar ou ocultar a senha">${_OP_ICO.eye}</button>
        </div>
        <div class="opf-meter" id="opPwdMeter" data-level="0" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
        <div class="opf-meter-txt" id="opPwdMeterTxt"></div>
      </div>
      <div class="form-group">
        <label class="form-label" for="opConfirmPwd">Confirmar senha</label>
        <input class="form-input" type="password" name="confirmPwd" id="opConfirmPwd" minlength="8" autocomplete="new-password" placeholder="${id ? 'Repita a nova senha' : 'Repita a senha'}" ${!id ? 'required' : ''} />
      </div>
    </div>
    <p class="opf-note">Senha gerenciada pelo sistema de autenticação. Mínimo de 8 caracteres.</p>`;

  const notas = `<textarea class="form-textarea" name="notes" id="opNotesInput" rows="3" maxlength="500" data-input="updateOpPreview" placeholder="Especialidades, turnos, ramal, contato de emergência...">${esc(op?.notes)}</textarea>
    <div class="opf-count"><span id="opNotesCount">0</span>/500</div>`;

  openModal(
    id ? 'Editar Operador' : 'Novo Operador',
    `
    <form id="opForm" class="ov-form opf" data-submit="submitOperadorForm" data-arg="${escapeHtml(id || '')}">
      ${adminBanner}
      <header class="opf-hero">
        <div class="opf-cover" id="opCover" data-sty="--opf-cor:${selColor}"></div>
        <div class="opf-hero-row">
          <div class="opf-photo">
            <div id="opAvatarPreview" class="opf-avatar" data-sty="background:${selColor}">${
              foto
                ? `<img class="op-avatar-img" src="${escapeHtml(foto)}" alt="" draggable="false" />`
                : esc(op?.initials || (op?.name ? op.name.substring(0, 2).toUpperCase() : '?'))
            }</div>
            <button type="button" class="opf-photo-btn" data-action="opPhotoPick" aria-label="Escolher foto do operador" title="Escolher foto">${_OP_ICO.camera}</button>
            <input type="file" id="opPhotoInput" class="opf-file" accept="image/jpeg,image/png,image/webp" data-change="opPhotoSelected" tabindex="-1" />
          </div>
          <div class="opf-hero-info">
            <div class="opf-hero-name" id="opHeroName">${esc(op?.name) || 'Novo operador'}</div>
            <div class="opf-hero-role" id="opHeroRole">${esc(op?.role || 'Técnico')}</div>
            <div class="opf-chips" id="opHeroChips"></div>
          </div>
        </div>
        <div class="opf-photo-actions">
          <button type="button" class="btn btn-secondary btn-sm" data-action="opPhotoPick">${_OP_ICO.camera} <span id="opPhotoPickTxt">${foto ? 'Trocar foto' : 'Enviar foto'}</span></button>
          <button type="button" class="btn btn-secondary btn-sm opf-photo-rm" id="opPhotoRm" data-action="opPhotoRemove" ${foto ? '' : 'hidden'}>${_OP_ICO.trash} Remover</button>
          <span class="opf-opt">JPG, PNG ou WebP · recortada em quadrado</span>
        </div>
      </header>

      ${_opSecao(_OP_ICO.user, 'Dados pessoais', 'Como a pessoa aparece nas atribuições e no histórico.', dados)}
      ${_opSecao(_OP_ICO.phone, 'Contato', 'Usado para avisos e para falar com o operador.', contato)}
      ${_opSecao(_OP_ICO.shield, 'Perfil e permissões', isAdminUser ? 'O que o operador pode fazer no portal.' : '', permissoes)}
      ${_opSecao(_OP_ICO.note, 'Observações', 'Visível apenas para quem edita operadores.', notas)}
      ${_opSecao(_OP_ICO.lock, 'Senha de acesso', id ? 'Deixe em branco para manter a senha atual.' : 'Defina a senha do primeiro acesso.', senha)}

      <div class="form-actions opf-actions">
        <button type="button" class="btn btn-secondary" data-action="closeModal">Cancelar</button>
        <button type="submit" class="btn btn-primary"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> ${id ? 'Salvar alterações' : 'Cadastrar operador'}</button>
      </div>
    </form>`,
    'opf-modal'
  );

  window._selectedOpColor = selColor;
  window._opPhotoData = foto; // foto atual do formulário ('' = sem foto)
  window._opPhotoChanged = false; // só vai no save se mexeram (não zera a de quem não tocou)
  updateOpPreview();
}

function selectOpColor(col) {
  window._selectedOpColor = col;
  document.querySelectorAll('#opColorPicker .opf-color').forEach(function (btn) {
    const isSel = btn.dataset.color === col;
    btn.classList.toggle('is-sel', isSel);
    btn.setAttribute('aria-pressed', isSel ? 'true' : 'false');
  });
  updateOpPreview();
}

function _opChip(texto, tom) {
  return `<span class="opf-chip opf-chip--${tom}">${texto}</span>`;
}

function updateOpPreview() {
  const form = document.getElementById('opForm');
  if (!form) return;
  const val = (id) => (document.getElementById(id) ? document.getElementById(id).value : '');
  const name = val('opNameInput').trim();
  const initials = (
    val('opInitialsInput').trim() || (name ? name.substring(0, 2) : '?')
  ).toUpperCase();
  const color = window._selectedOpColor || OP_COLORS[0];
  const foto = window._opPhotoData || '';

  const preview = document.getElementById('opAvatarPreview');
  if (preview) {
    preview.style.background = color;
    if (foto) {
      let img = preview.querySelector('img');
      if (!img) {
        preview.textContent = '';
        img = document.createElement('img');
        img.className = 'op-avatar-img';
        img.alt = '';
        img.draggable = false;
        preview.appendChild(img);
      }
      if (img.getAttribute('src') !== foto) img.setAttribute('src', foto);
    } else {
      preview.textContent = initials;
    }
  }
  const cover = document.getElementById('opCover');
  if (cover) cover.style.setProperty('--opf-cor', color);

  const nomeEl = document.getElementById('opHeroName');
  if (nomeEl) nomeEl.textContent = name || 'Novo operador';
  const cargoEl = document.getElementById('opHeroRole');
  if (cargoEl) cargoEl.textContent = val('opRoleInput').trim() || 'Técnico';

  const pickTxt = document.getElementById('opPhotoPickTxt');
  if (pickTxt) pickTxt.textContent = foto ? 'Trocar foto' : 'Enviar foto';
  const rm = document.getElementById('opPhotoRm');
  if (rm) rm.hidden = !foto;

  const chips = document.getElementById('opHeroChips');
  if (chips) {
    const marcado = (id) => !!(document.getElementById(id) && document.getElementById(id).checked);
    const fixo = (n) => {
      const el = form.elements[n];
      return el && el.type === 'hidden' ? el.value : null;
    };
    const status = document.getElementById('opStatusSelect');
    const ativo = status ? status.value !== '0' : fixo('active') !== '0';
    const admin = document.getElementById('opIsAdmin')
      ? marcado('opIsAdmin')
      : fixo('isAdmin') === '1';
    const teamSel = document.getElementById('opTeamSelect');
    const equipe = teamSel ? teamSel.options[teamSel.selectedIndex].textContent : '';
    chips.innerHTML =
      _opChip(ativo ? 'Ativo' : 'Inativo', ativo ? 'ok' : 'off') +
      (admin ? _opChip('Administrador', 'adm') : '') +
      (marcado('opIsGestao') ? _opChip('Gestão', 'ges') : '') +
      (marcado('opOnLeave') ? _opChip('Afastado', 'afa') : '') +
      (equipe ? _opChip(escapeHtml(equipe), 'eq') : '');
  }

  const cont = document.getElementById('opNotesCount');
  if (cont) cont.textContent = String(val('opNotesInput').length);
}

function opPhotoPick() {
  const i = document.getElementById('opPhotoInput');
  if (i) i.click();
}

function opPhotoRemove() {
  window._opPhotoData = '';
  window._opPhotoChanged = true;
  const i = document.getElementById('opPhotoInput');
  if (i) i.value = '';
  const prev = document.getElementById('opAvatarPreview');
  if (prev) prev.textContent = '';
  updateOpPreview();
}

// Lê o arquivo, recorta no centro e reduz para OP_FOTO_LADO. Devolve o data URL
// JPEG. Separado do evento para dar para testar com um canvas falso.
function opFotoReduzir(img, doc) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const r = opFotoRecorte(w, h);
  const canvas = (doc || document).createElement('canvas');
  canvas.width = OP_FOTO_LADO;
  canvas.height = OP_FOTO_LADO;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // PNG transparente vira JPEG sem fundo preto
  ctx.fillRect(0, 0, OP_FOTO_LADO, OP_FOTO_LADO);
  ctx.drawImage(img, r.sx, r.sy, r.lado, r.lado, 0, 0, OP_FOTO_LADO, OP_FOTO_LADO);
  return canvas.toDataURL('image/jpeg', 0.85);
}

function opPhotoSelected(ev) {
  const input = ev && ev.target;
  const file = input && input.files && input.files[0];
  if (!file) return;
  input.value = ''; // permite escolher o mesmo arquivo de novo
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
    showToast('Use uma imagem JPG, PNG ou WebP.', 'error');
    return;
  }
  if (file.size > OP_FOTO_MAX_ORIGEM) {
    showToast('A imagem passa de 8 MB. Escolha uma menor.', 'error');
    return;
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = function () {
    URL.revokeObjectURL(url);
    try {
      const data = opFotoSegura(opFotoReduzir(img));
      if (!data) throw new Error('foto reduzida fora do formato');
      window._opPhotoData = data;
      window._opPhotoChanged = true;
      updateOpPreview();
    } catch (_e) {
      if (typeof _logSilent === 'function') _logSilent(_e, 'operadores');
      showToast('Não foi possível processar esta imagem.', 'error');
    }
  };
  img.onerror = function () {
    URL.revokeObjectURL(url);
    showToast('Não foi possível ler esta imagem.', 'error');
  };
  img.src = url;
}

function opTogglePwd() {
  const campos = ['opNewPwd', 'opConfirmPwd', 'opCurrentPwd']
    .map((i) => document.getElementById(i))
    .filter(Boolean);
  const mostrar = campos.length && campos[0].type === 'password';
  campos.forEach((c) => {
    c.type = mostrar ? 'text' : 'password';
  });
}

// Nível 0–4 da senha nova: só orienta, a regra de verdade é o mínimo de 8.
function opForcaSenha(s) {
  const v = String(s || '');
  if (!v) return 0;
  let n = 0;
  if (v.length >= 8) n++;
  if (v.length >= 12) n++;
  if (/[a-z]/.test(v) && /[A-Z]/.test(v)) n++;
  if (/\d/.test(v) && /[^A-Za-z0-9]/.test(v)) n++;
  return v.length < 8 ? Math.min(n, 1) : Math.max(n, 1);
}

function opPwdMeter() {
  const nivel = opForcaSenha((document.getElementById('opNewPwd') || {}).value);
  const m = document.getElementById('opPwdMeter');
  if (m) m.dataset.level = String(nivel);
  const t = document.getElementById('opPwdMeterTxt');
  if (t) t.textContent = ['', 'Fraca', 'Razoável', 'Boa', 'Forte'][nivel];
}

async function submitOperadorForm(e, id) {
  e.preventDefault();
  try {
    const fd = new FormData(e.target);
    const g = (k) => fd.get(k) || '';
    const name = g('name').trim();
    if (!name) {
      showToast('Nome é obrigatório.', 'error');
      return;
    }

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

    // Trocar a PRÓPRIA senha exige a atual, conferida no Supabase Auth (quem
    // pegar o aparelho desbloqueado não troca a senha do dono).
    if (
      isSelf &&
      existing &&
      g('newPwd').trim() &&
      existing.email &&
      typeof isSupabaseConnected === 'function' &&
      isSupabaseConnected() &&
      window._supabaseAuthActive
    ) {
      const currentPwd = g('currentPwd').trim();
      if (!currentPwd) {
        showToast('Para trocar a senha, digite a senha atual.', 'error');
        return;
      }
      try {
        const { error } = await supabaseClient.auth.signInWithPassword({
          email: existing.email,
          password: currentPwd,
        });
        if (error) {
          showToast('Senha atual incorreta.', 'error');
          return;
        }
      } catch (_) {
        showToast('Não foi possível conferir a senha atual agora.', 'error');
        return;
      }
    }

    const initials = g('initials').trim() || name.substring(0, 2).toUpperCase();

    // Handle password
    const newPwd = g('newPwd').trim();
    const confirmPwd = g('confirmPwd').trim();

    if (!id && !newPwd) {
      showToast('A senha é obrigatória para novos operadores.', 'error');
      return;
    }

    if (newPwd || confirmPwd) {
      if (newPwd !== confirmPwd) {
        showToast('As senhas não coincidem.', 'error');
        return;
      }
      if (newPwd.length < 8) {
        showToast('A senha deve ter pelo menos 8 caracteres.', 'error');
        return;
      }
    }

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

    // Gestão: só admin altera; demais preservam o valor atual.
    const isGestaoVal = isAdminUser
      ? fd.get('isGestao') !== null
      : existing
        ? existing.isGestao === true
        : false;

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
      color: window._selectedOpColor || getOpAvatarColor(name) || OP_COLORS[0],
      role: g('role') || 'Técnico',
      phone: g('phone'),
      email: g('email'),
      notes: g('notes'),
      active: activeVal,
      isAdmin: isAdminVal,
      isGestao: isGestaoVal,
      onLeave: onLeaveVal,
      team: g('team') || 'init',
    };
    // Só entra se mexeram na foto: a chave ausente preserva a que já existe no
    // merge do saveOperator (undefined sobrescreveria). '' = removida → null.
    if (window._opPhotoChanged === true) opData.photo = opFotoSegura(window._opPhotoData) || null;

    const opErrors = validateOperator(opData);
    if (opErrors.length) {
      showToast(opErrors[0], 'error');
      return;
    }

    // Anti duplo-submit: a sequência abaixo tem awaits longos (hash + rede).
    var _opSubmitBtn = null;
    try {
      _opSubmitBtn = e.target.querySelector('button[type="submit"]');
    } catch (_e) {
      if (typeof _logSilent === 'function') _logSilent(_e, 'operadores');
    }
    if (_opSubmitBtn) _opSubmitBtn.disabled = true;
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
        const { data: resetData, error: resetErr } = await supabaseClient.functions.invoke(
          'update-user-password',
          {
            body: { userId: existing.auth_user_id, password: newPwd },
          }
        );
        if (resetErr || (resetData && resetData.error)) {
          authMsg =
            'Operador salvo, mas a senha de login não pôde ser atualizada. Tente novamente.';
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
          const opIdx = list.findIndex(
            (o) => o.email?.toLowerCase() === opData.email.toLowerCase()
          );
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
                if (linkErr)
                  console.warn('⚠️ Falha ao vincular auth_user_id no Supabase:', linkErr.message);
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

    if (_opSubmitBtn) _opSubmitBtn.disabled = false;
    closeModal();
    // Refresh no lugar: preserva busca/filtro/página/scroll (rebuild perdia tudo).
    if (typeof _refreshOpListKeepPage === 'function') _refreshOpListKeepPage();
    else if (typeof filterOperadores === 'function') filterOperadores();
    if (typeof _refreshOpStats === 'function') _refreshOpStats();
    if (authMsg) {
      showToast(authMsg, authMsg.startsWith('✅') ? 'success' : 'warning', 6000);
    } else {
      showToast(id ? 'Operador atualizado!' : 'Operador cadastrado!', 'success');
    }
  } catch (err) {
    try {
      var _b = e.target.querySelector('button[type="submit"]');
      if (_b) _b.disabled = false;
    } catch (_e) {
      if (typeof _logSilent === 'function') _logSilent(_e, 'operadores');
    }
    showToast('Erro ao salvar operador: ' + err.message, 'error');
  }
}

// ── Helper: lista de nomes para selects em outros módulos ────────────────────
function getOperatorNames(team) {
  const ops = getOperators().filter((o) => o.active !== false);
  if (!team) return ops.map((o) => o.name);
  return ops.filter((o) => (o.team || 'init') === team).map((o) => o.name);
}

function isOperatorOnLeave(name) {
  if (!name) return false;
  const ops = getOperators();
  const byName = ops.find((o) => o.name === name);
  if (byName) return byName.onLeave === true;
  const byId = typeof getOperatorById === 'function' ? getOperatorById(name) : null;
  return byId ? byId.onLeave === true : false;
}

// ── Modal: pendências por operador ───────────────────────────────
function openOpPendencias(opId) {
  const op = getOperatorById(opId);
  if (!op) return;

  const allPens = (typeof getPendencias === 'function' ? getPendencias() : []).filter(
    (p) => p.responsible === op.name
  );
  const activePens = allPens.filter((p) => !isPendenciaClosed(p.status));
  const donePens = allPens.filter((p) => isPendenciaClosed(p.status));

  const renderPenList = (list) => {
    if (!list.length) return '<p class="text-muted u-c278f3">Nenhuma pendência.</p>';
    return list
      .map((p) => {
        const c = getClientById(p.clientId);
        const color = c?.color || '#2563eb';
        const isOverdue = p.deadline && p.deadline < localDateISO() && !isPendenciaClosed(p.status);
        return `
        <div class="opd-pendencia-delay-card"
             role="button" tabindex="0"
             data-action="opOpenPendenciaDelayed" data-arg="${escapeHtml(p.id)}">
          ${c ? clientAvatar(c, 28) : ''}
          <div class="u-59eddc">
            <div class="u-1a8e72">${escapeHtml(getPendenciaTitulo(p))}</div>
            <div class="u-cdf4b4">
              <span class="client-badge" data-sty="background:${escapeHtml(color)}20;color:${escapeHtml(color)};border:1px solid ${escapeHtml(color)}40">${escapeHtml(p.clientName || '—')}</span>
              ${p.deadline ? `· <span data-sty="${isOverdue ? 'color:#dc2626;font-weight:600' : ''}">${formatDate(parseDeadline(p.deadline))}</span>` : ''}
            </div>
          </div>
          <div class="u-0ddf6f">${statusTag(p.status)} ${priorityTag(p.priority)}</div>
        </div>`;
      })
      .join('');
  };

  const color = op.color || '#1a56db';
  const initials = op.initials || op.name.substring(0, 2).toUpperCase();

  openModal(
    op.name,
    `
    <div class="op-detail-header u-e2fe7f">
      <div class="op-avatar" data-sty="background:${escapeHtml(color)}">${opAvatarFoto(op) || escapeHtml(initials)}</div>
      <div class="u-59eddc">
        <div class="u-7a6d8a">${escapeHtml(op.name)} ${op.onLeave ? `<span class="tag badge-afastado">${_opLeaveIcon()} Afastado</span>` : ''}</div>
        <div class="u-865c33">${escapeHtml(op.role || 'Técnico')}</div>
      </div>
      <div class="u-3de8f9">
        <div class="u-84703d">
          <div class="u-d56d52">${activePens.length}</div>
          <div class="u-808b6c">Ativos</div>
        </div>
        <div class="u-84703d">
          <div class="u-e07a88">${donePens.length}</div>
          <div class="u-808b6c">Concluídos</div>
        </div>
      </div>
    </div>

    <div class="u-5329cf">
      📌 Pendências Ativas (${activePens.length})
    </div>
    ${renderPenList(activePens)}

    ${
      donePens.length
        ? `
    <hr class="divider"/>
    <div class="u-c7d537">
      ✅ Concluídas (${donePens.length})
    </div>
    ${renderPenList(donePens)}
    `
        : ''
    }

    <div class="form-actions u-1b0f49">
      <button class="btn btn-secondary" data-action="closeModal">Fechar</button>
      <button class="btn btn-primary" data-action="opNewPendenciaDelayed">+ Nova Pendência</button>
    </div>
  `,
    'lg'
  );
}

// ── Auto-refresh global (preserva filtros/paginação/scroll) ──
function _refreshOperadoresInPlace() {
  try {
    var q = (document.getElementById('opSearch')?.value || '').toLowerCase();
    var ops = typeof getOperators === 'function' ? getOperators() : [];
    if (typeof isTeamAdmin === 'function' && !isTeamAdmin()) {
      ops = ops.filter(function (o) {
        return (
          (o.team || 'init') === (typeof getCurrentTeam === 'function' ? getCurrentTeam() : 'init')
        );
      });
    } else if (typeof _selectedTeam !== 'undefined' && _selectedTeam) {
      ops = ops.filter(function (o) {
        return (o.team || 'init') === _selectedTeam;
      });
    }
    if (window._opFilter === 'ativos')
      ops = ops.filter(function (o) {
        return o.active;
      });
    if (window._opFilter === 'inativos')
      ops = ops.filter(function (o) {
        return !o.active;
      });
    if (q)
      ops = ops.filter(function (o) {
        return (
          (o.name || '').toLowerCase().indexOf(q) !== -1 ||
          (o.role || '').toLowerCase().indexOf(q) !== -1
        );
      });
    _filteredOps = ops;
    preserveScrollAround(function () {
      _renderOpGrid();
    });
  } catch (_) {
    try {
      _renderOpGrid();
    } catch (_e) {
      if (typeof _logSilent === 'function') _logSilent(_e, 'operadores');
    }
  }
}
(function () {
  if (typeof window === 'undefined' || typeof onDataChanged !== 'function') return;
  if (window._opAutoRefresh) return;
  window._opAutoRefresh = true;
  onDataChanged('operadores', function () {
    var h = window.location.hash.replace('#', '') || 'dashboard';
    if (h !== 'operadores') return;
    _refreshOperadoresInPlace();
  });
  // Mudança de sessão/permissões: refresh suave em vez de reload total
  // (reload perdia filtros, scroll, modal e estado Milvus).
  onDataChanged('session', function () {
    try {
      if (typeof updateUserUI === 'function') updateUserUI();
      if (typeof initTeamSelector === 'function') initTeamSelector();
      if (typeof updateBadges === 'function') updateBadges();
    } catch (_e) {
      if (typeof _logSilent === 'function') _logSilent(_e, 'operadores');
    }
    try {
      var h =
        ((typeof window !== 'undefined' && window.location && window.location.hash) || '').replace(
          '#',
          ''
        ) || 'dashboard';
      if (typeof navigateTo === 'function') navigateTo(h);
      else if (typeof refreshPage === 'function') refreshPage();
      else window.location.reload();
    } catch (_) {
      try {
        window.location.reload();
      } catch (_e) {
        if (typeof _logSilent === 'function') _logSilent(_e, 'operadores');
      }
    }
  });
})();

// Ações da tela de operadores (clique/enter/input/submit por delegação em js/actions.js).
if (typeof registerActions === 'function') {
  registerActions({
    debouncedFilterOperadores: () => {
      if (typeof debouncedFilterOperadores === 'function') debouncedFilterOperadores();
    },
    setOpFilter: (el) => {
      if (el && typeof setOpFilter === 'function') setOpFilter(el, el.dataset.filter);
    },
    openOperadorForm: (_el, id) => {
      if (typeof openOperadorForm === 'function') openOperadorForm(id || null);
    },
    selectOpColor: (_el, col) => {
      if (typeof selectOpColor === 'function') selectOpColor(col);
    },
    updateOpPreview: () => {
      if (typeof updateOpPreview === 'function') updateOpPreview();
    },
    opPhotoPick: () => opPhotoPick(),
    opPhotoRemove: () => opPhotoRemove(),
    opPhotoSelected: (_el, _v, ev) => opPhotoSelected(ev),
    opTogglePwd: () => opTogglePwd(),
    opPwdMeter: () => opPwdMeter(),
    submitOperadorForm: (el, id, ev) => {
      if (typeof submitOperadorForm === 'function') submitOperadorForm(ev, id || '');
    },
    openOpPendencias: (_el, id) => {
      if (typeof openOpPendencias === 'function') openOpPendencias(id);
    },
    opPageDelta: (_el, d) => {
      _opPage += parseInt(d, 10) || 0;
      if (typeof _renderOpGrid === 'function') _renderOpGrid();
    },
    toggleOpMenu: (_el, id) => {
      if (typeof toggleOpMenu === 'function') toggleOpMenu(id);
    },
    opToggleActive: (_el, id) => {
      if (typeof toggleOpMenu === 'function') toggleOpMenu(id);
      toggleOp(id);
    },
    opResendInvite: (_el, id) => {
      if (typeof toggleOpMenu === 'function') toggleOpMenu(id);
      resendOperatorInvite(id);
    },
    opDeleteConfirm: (_el, id) => {
      if (typeof toggleOpMenu === 'function') toggleOpMenu(id);
      deleteOpConfirm(id);
    },
    // Fechar o modal, ir para a lista e só então abrir o detalhe: a lista
    // precisa renderizar antes de o detalhe procurar o registro.
    opOpenPendenciaDelayed: (_el, id) => {
      if (typeof closeModal === 'function') closeModal();
      if (typeof navigateTo === 'function') navigateTo('pendencias');
      setTimeout(() => {
        if (typeof openPendenciaDetail === 'function') openPendenciaDetail(id);
      }, 100);
    },
    opNewPendenciaDelayed: () => {
      if (typeof closeModal === 'function') closeModal();
      if (typeof navigateTo === 'function') navigateTo('pendencias');
      setTimeout(() => {
        if (typeof openPendenciaForm === 'function') openPendenciaForm(null, null);
      }, 100);
    },
  });
}
