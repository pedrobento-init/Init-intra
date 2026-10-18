// pendencias-acoes.js – Menu ⋯ do card e ações rápidas da lista.
// Parte de pendencias.js (dividido para facilitar manutenção). Scripts clássicos:
// carregam logo depois de pendencias.js e compartilham os mesmos globais.
// Nos testes, tests/_parts.cjs junta as partes na mesma ordem.

// ── Menu ⋯ do card: mover / atribuir sem abrir o detalhe ───────────────────
function closePenQuickMenu() {
  var m = document.getElementById('penQuickMenu');
  if (m) m.remove();
  document.querySelectorAll('.kc-menu[aria-expanded="true"]').forEach(function(b) { b.setAttribute('aria-expanded', 'false'); });
}

// Itens do menu (puro, testável): status de destino + operadores.
function penQuickMenuModel(p, cols, operators) {
  var statuses = (cols || []).filter(function(c) { return c.id !== p.status; })
    .map(function(c) { return { id: c.id, label: c.label }; });
  var people = (operators || []).filter(function(o) { return o && o.active !== false; })
    .map(function(o) { return { name: o.name, current: o.name === (p.responsible || ''), away: o.onLeave === true }; });
  return { statuses: statuses, people: people };
}

function openPenQuickMenu(ev, id) {
  if (ev) { ev.stopPropagation(); ev.preventDefault(); }
  var btn = ev && ev.currentTarget;
  var already = btn && btn.getAttribute('aria-expanded') === 'true';
  closePenQuickMenu();
  if (already) return;
  var p = getPendenciaById(id);
  if (!p) return;
  var team = (typeof isTeamAdmin === 'function' && isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam) ? _selectedTeam
    : (typeof getCurrentTeam === 'function' ? getCurrentTeam() : null);
  var ops = (typeof getOperators === 'function' ? getOperators() : []).filter(function(o) { return !team || (o.team || 'init') === team; });
  // Ativas: colunas do quadro + "Resolvido" (concluir direto do card).
  var cols = PEN_KANBAN_COLS.filter(function(c) { return !isPendenciaClosed(c.id) || c.id === 'resolvido'; });
  var m = penQuickMenuModel(p, cols, ops);
  var sid = escapeHtml(id);
  var menu = document.createElement('div');
  menu.id = 'penQuickMenu';
  menu.className = 'pen-quick-menu';
  menu.dataset.openY = String(window.scrollY || 0);
  menu.dataset.openW = String(window.innerWidth || 0);
  menu.setAttribute('role', 'menu');
  menu.innerHTML =
    '<div class="pqm-label">Mover para</div>' +
    m.statuses.map(function(s) {
      return '<button type="button" role="menuitem" onclick="closePenQuickMenu();penMoveTo(\'' + sid + '\',\'' + s.id + '\')">' +
        '<span class="pqm-dot" style="--c:' + penColColor(s.id) + '"></span>' + escapeHtml(s.label) + '</button>';
    }).join('') +
    '<div class="pqm-label">Atribuir a</div>' +
    '<div class="pqm-scroll">' +
    m.people.map(function(o) {
      var n = escapeHtml(o.name);
      // Afastado não pode receber (updatePendenciaAssignee recusa): desabilitado.
      return '<button type="button" role="menuitemradio" aria-checked="' + o.current + '"' + (o.current || o.away ? ' disabled' : '') +
        ' onclick="closePenQuickMenu();penQuickAssign(\'' + sid + '\',\'' + n.replace(/&#39;/g, '\\&#39;') + '\')">' +
        '<span class="pqm-check">' + (o.current ? '✓' : '') + '</span>' + n + (o.away ? ' <small>afastado</small>' : '') + '</button>';
    }).join('') +
    '</div>' +
    '<div class="pqm-sep"></div>' +
    '<button type="button" role="menuitem" onclick="closePenQuickMenu();openPendenciaDetail(\'' + sid + '\')">Abrir detalhes</button>';
  document.body.appendChild(menu);
  if (btn) {
    btn.setAttribute('aria-expanded', 'true');
    var r = btn.getBoundingClientRect();
    var w = menu.offsetWidth, h = menu.offsetHeight;
    var left = Math.min(window.innerWidth - w - 8, Math.max(8, r.right - w));
    var top = r.bottom + 4;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 4);
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
  }
  var first = menu.querySelector('button:not([disabled])');
  if (first) first.focus();
}

function penQuickAssign(id, name) {
  try {
    var res = updatePendenciaAssignee(id, { responsible: name });
    try { _optimisticPenUpsert({ ...res.pen }); } catch (_) {}
    showToast(name ? 'Atribuída a ' + name + '.' : 'Responsável removido.', 'success');
  } catch (err) {
    showToast((err && err.message) || 'Não foi possível atribuir.', 'error');
    return;
  }
  if (document.getElementById('penViewArea')) renderPenView(false);
}

if (typeof document !== 'undefined' && document.addEventListener && !(typeof window !== 'undefined' && window._penQuickMenuBound)) {
  if (typeof window !== 'undefined') window._penQuickMenuBound = true;
  document.addEventListener('click', function(e) {
    var m = document.getElementById('penQuickMenu');
    if (m && !m.contains(e.target)) closePenQuickMenu();
  });
  document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closePenQuickMenu(); });
  // Rolagem/redimensionamento só fecham o menu se a página mudou DE VERDADE
  // desde a abertura. O evento `scroll` chega no frame seguinte: uma rolagem
  // de inércia no celular (ou o scroll que leva o card à vista antes do
  // toque) fechava o menu que a pessoa tinha acabado de abrir.
  window.addEventListener('scroll', function () {
    var m = document.getElementById('penQuickMenu');
    if (m && Math.abs((window.scrollY || 0) - Number(m.dataset.openY || 0)) > 48) closePenQuickMenu();
  }, { passive: true });
  window.addEventListener('resize', function () {
    var m = document.getElementById('penQuickMenu');
    // Só largura: o teclado do celular muda apenas a altura.
    if (m && window.innerWidth !== Number(m.dataset.openW || 0)) closePenQuickMenu();
  });
}

function getFilteredPendencias() {
  const q    = (document.getElementById('penSearch')?.value||'').toLowerCase();
  const cid  = document.getElementById('penClient')?.value||'';
  const resp = document.getElementById('penResponsible')?.value||'';
  const st   = document.getElementById('penStatus')?.value||'';
  const pr   = document.getElementById('penPriority')?.value||'';
  var base = isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam ? getPendenciasByTeam(_selectedTeam) : getMyPendencias();
  // Defesa em profundidade: getters já filtram Gestão, mas garante que nenhum
  // caminho (cache/otimista) vaze Gestão para não-Gestão.
  try {
    if (typeof filterGestaoPendencias === 'function') base = filterGestaoPendencias(base);
    else if (typeof canViewPendencia === 'function') base = base.filter(canViewPendencia);
  } catch (_) {}
  return base.filter(p => {
    if (q && !p.assunto?.toLowerCase().includes(q) && !p.descricao?.toLowerCase().includes(q) && !p.clientName?.toLowerCase().includes(q) && !p.responsible?.toLowerCase().includes(q)) return false;
    if (cid  && p.clientId   !== cid)  return false;
    if (resp && p.responsible !== resp) return false;
    if (st   && p.status     !== st)   return false;
    if (pr   && p.priority   !== pr)   return false;
    if (penScope === 'archived' && !isPendenciaClosed(p.status)) return false;
    if (penScope === 'active' && isPendenciaClosed(p.status)) return false;
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
    savedFilterName: document.getElementById('penSavedFilter')?.value||'',
    view: penView
  });
  try{ _penUpdateMoreFiltersBadge(); }catch(_){}
}

function setPenScope(scope) {
  penScope = scope;
  renderPendencias();
}

function getSavedPenFilters() {
  return (typeof getCacheKV === 'function' ? getCacheKV('intra_pen_saved_filters', []) : []) || [];
}

function saveCurrentPenFilter() {
  const name = window.prompt('Nome do filtro:');
  if (!name || !name.trim()) return;
  const list = getSavedPenFilters();
  const filter = {
    name: name.trim(),
    search: document.getElementById('penSearch')?.value || '',
    client: document.getElementById('penClient')?.value || '',
    resp: document.getElementById('penResponsible')?.value || '',
    status: document.getElementById('penStatus')?.value || '',
    priority: document.getElementById('penPriority')?.value || '',
  };
  const idx = list.findIndex(f => f.name === filter.name);
  if (idx !== -1) list[idx] = filter; else list.push(filter);
  if (typeof setCacheKV === 'function') setCacheKV('intra_pen_saved_filters', list);
  try {
    if (document.getElementById('penSavedFilter')) document.getElementById('penSavedFilter').value = filter.name;
  } catch (_) {}
  if (typeof savePenFilters === 'function') { try { savePenFilters(); } catch (_) {} }
  renderPendencias();
  showToast('Filtro salvo!', 'success');
}

function applySavedPenFilter() {
  const sel = document.getElementById('penSavedFilter');
  const name = sel?.value;
  if (!name) return;
  const f = getSavedPenFilters().find(x => x.name === name);
  if (!f) return;
  // Aplica TODOS os campos (inclusive vazios): sem isso, trocar de um filtro
  // com busca/cliente para um filtro salvo sem esses campos mantinha os valores
  // antigos "grudados", parecendo que o filtro não foi aplicado/limpo.
  if (document.getElementById('penSearch')) document.getElementById('penSearch').value = f.search || '';
  if (document.getElementById('penClient')) document.getElementById('penClient').value = f.client || '';
  if (document.getElementById('penResponsible')) document.getElementById('penResponsible').value = f.resp || '';
  if (document.getElementById('penStatus')) document.getElementById('penStatus').value = f.status || '';
  if (document.getElementById('penPriority')) document.getElementById('penPriority').value = f.priority || '';
  if (typeof savePenFilters === 'function') savePenFilters();
  try { _penUpdateMoreFiltersBadge(); } catch (_) {}
  if (typeof renderPenView === 'function') renderPenView(false);
}

function clearPenFilters() {
  // Limpa todos os filtros ativos (busca, selects e filtro salvo) + estado
  // persistido, e re-renderiza. O botão ✕ Limpar sempre faz algo visível,
  // mesmo sem filtro salvo selecionado.
  try {
    if (document.getElementById('penSearch')) document.getElementById('penSearch').value = '';
    if (document.getElementById('penClient')) document.getElementById('penClient').value = '';
    if (document.getElementById('penResponsible')) document.getElementById('penResponsible').value = '';
    if (document.getElementById('penStatus')) document.getElementById('penStatus').value = '';
    if (document.getElementById('penPriority')) document.getElementById('penPriority').value = '';
    if (document.getElementById('penSavedFilter')) document.getElementById('penSavedFilter').value = '';
  } catch (_) {}
  if (typeof savePenFilters === 'function') { try { savePenFilters(); } catch (_) {} }
  try { _penUpdateMoreFiltersBadge(); } catch (_) {}
  if (typeof renderPenView === 'function') { try { renderPenView(); } catch (_) {} }
}

function deleteSavedPenFilter() {
  const sel = document.getElementById('penSavedFilter');
  const name = sel?.value;
  // Sem filtro salvo selecionado, o ✕ age como "limpar filtros ativos" para
  // nunca parecer que "não funciona" (antes era early-return silencioso).
  if (!name) { clearPenFilters(); return; }
  const list = getSavedPenFilters().filter(f => f.name !== name);
  if (typeof setCacheKV === 'function') setCacheKV('intra_pen_saved_filters', list);
  // Se o estado persistido apontava para o filtro excluído, limpa a referência
  // para o select não tentar restaurar um valor inexistente após o re-render.
  try {
    if (typeof loadFilterState === 'function' && typeof saveFilterState === 'function') {
      const st = loadFilterState('pendencias', {}) || {};
      if (st.savedFilterName === name) {
        st.savedFilterName = '';
        saveFilterState('pendencias', st);
      }
    }
  } catch (_) {}
  renderPendencias();
  showToast('Filtro removido.', 'info');
}

if (typeof window !== 'undefined') window.debouncedRenderPenView = debounce(renderPenView, 300);

function _penRichDesc(text) {
  try {
    if (typeof renderRichText === 'function') return renderRichText(text);
    if (typeof globalThis !== 'undefined' && typeof globalThis.renderRichText === 'function') return globalThis.renderRichText(text);
  } catch (_) {}
  return _escapeHtmlFallback(text);
}
function _penRichNote(text) {
  try {
    if (typeof renderRichNoteText === 'function') return renderRichNoteText(text);
    if (typeof globalThis !== 'undefined' && typeof globalThis.renderRichNoteText === 'function') return globalThis.renderRichNoteText(text);
  } catch (_) {}
  try {
    if (typeof highlightMentions === 'function') return highlightMentions(text);
  } catch (_) {}
  return _escapeHtmlFallback(text);
}
function _penFriendlyTime(p) {
  var secs = 0;
  try { secs = (typeof getElapsedSeconds === 'function') ? getElapsedSeconds(p) : 0; } catch (_) {}
  var exact = '00:00:00';
  try { exact = (typeof formatTimer === 'function') ? formatTimer(secs) : exact; } catch (_) {}
  var friendly = exact;
  try {
    if (typeof formatElapsedFriendly === 'function') friendly = formatElapsedFriendly(secs);
    else if (typeof globalThis !== 'undefined' && typeof globalThis.formatElapsedFriendly === 'function') friendly = globalThis.formatElapsedFriendly(secs);
  } catch (_) {}
  return { secs: secs, exact: exact, friendly: friendly };
}
// Edição inline: passa pelas MESMAS validações/regras do form
// (validatePendencia + savePendencia). Só campos seguros: priority,
// deadline, responsible, status.
function quickUpdatePendenciaField(id, field, value) {
  var p = (typeof getPendenciaById === 'function') ? getPendenciaById(id) : null;
  if (!p) return;
  if (['priority', 'deadline', 'responsible'].indexOf(field) === -1) return;
  if (field === 'priority' && ['baixa', 'media', 'alta', 'critica'].indexOf(value) === -1) {
    if (typeof showToast === 'function') showToast('Prioridade inválida.', 'error');
    openPendenciaDetail(id);
    return;
  }
  if (field === 'deadline' && value && !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    if (typeof showToast === 'function') showToast('Data inválida.', 'error');
    return;
  }
  if (field === 'responsible') {
    value = String(value || '').trim();
    if (!value) { if (typeof showToast === 'function') showToast('Selecione um responsável.', 'error'); return; }
  }
  p[field] = value;
  var errors = [];
  try { errors = (typeof validatePendencia === 'function') ? (validatePendencia(p) || []) : []; } catch (_) {}
  if (errors.length) {
    if (typeof showToast === 'function') showToast(errors[0], 'error');
    openPendenciaDetail(id);
    return;
  }
  savePendencia(p);
  if (typeof updateBadges === 'function') { try { updateBadges(); } catch (_) {} }
  if (typeof showToast === 'function') showToast('Atualizado!', 'success');
  openPendenciaDetail(id);
  if (typeof renderPenView === 'function' && document.getElementById('penViewArea')) { try { renderPenView(false); } catch (_) {} }
  if (typeof refreshCalendar === 'function' && document.getElementById('calendarContainer')) { try { refreshCalendar(); } catch (_) {} }
}
