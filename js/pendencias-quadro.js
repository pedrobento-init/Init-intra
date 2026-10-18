// pendencias-quadro.js – Paginação, patch otimista, arrastar no quadro e cache de render.
// Parte de pendencias.js (dividido para facilitar manutenção). Scripts clássicos:
// carregam logo depois de pendencias.js e compartilham os mesmos globais.
// Nos testes, tests/_parts.cjs junta as partes na mesma ordem.

// ── FASE 3: estado de paginação da lista ─────────────────────────────────────
let _penPage = 0;
const PEN_UI_PAGE_SIZE = 50;
let _penTotal = null;
let _penServerMode = false;
let _penLastSig = '';
let _penCounts = null; // FASE 6: { byStatus, total, vencidas } do banco (modo servidor)
// FASE 6: resumo idêntico ao penStatusSummary, mas dos totais do banco.
function _penSummaryHtml(total, parts, vencidas, scopeLabel) {
  var venc = Number(vencidas) || 0;
  return '<div class="pen-summary" role="status">' +
    '<strong>' + total + '</strong>&nbsp;pendências ' + scopeLabel +
    (parts.length ? ' · ' + parts.join(' · ') : '') +
    ' · <span class="pen-sum-over">' + PEN_ICO_WARN +
    '<strong>' + venc + '</strong> vencida' + (venc === 1 ? '' : 's') +
    '</span></div>';
}
function _penSummaryParts(countFor) {
  return penBoardCols().map(function(col) {
    var n = countFor(col);
    return n ? '<span><strong>' + n + '</strong> ' + escapeHtml(col.label.toLowerCase()) + '</span>' : '';
  }).filter(Boolean);
}
function _penScopeLabel() { return penScope === 'archived' ? 'arquivadas' : 'ativas'; }
function _penServerSummary() {
  var counts = _penCounts || { byStatus: {}, total: 0, vencidas: 0 };
  var parts = _penSummaryParts(function(col) { return counts.byStatus[col.id] || 0; });
  return _penSummaryHtml(counts.total || 0, parts, counts.vencidas || 0, _penScopeLabel());
}
function _penViewSig() {
  var team = '';
  try {
    team = (typeof isTeamAdmin === 'function' && isTeamAdmin() && typeof _selectedTeam !== 'undefined') ? (_selectedTeam || '') : '';
  } catch (_) {}
  return JSON.stringify({
    scope: (typeof penScope !== 'undefined') ? penScope : 'active',
    q: document.getElementById('penSearch')?.value || '',
    cid: document.getElementById('penClient')?.value || '',
    resp: document.getElementById('penResponsible')?.value || '',
    st: document.getElementById('penStatus')?.value || '',
    pr: document.getElementById('penPriority')?.value || '',
    team: team
  });
}
function penGotoPage(d) {
  _penPage = Math.max(0, _penPage + (parseInt(d, 10) || 0));
  renderPenView(false);
}
function _penPagerBar() {
  if (!_penServerMode || _penTotal == null) return '';
  var totalPages = Math.max(1, Math.ceil(_penTotal / PEN_UI_PAGE_SIZE));
  if (_penPage >= totalPages) _penPage = totalPages - 1;
  // 4. Simplificado: se só 1 página, não renderiza nada — o total +
  // breakdown por status já aparecem no resumo abaixo (pen-summary) e no
  // contador junto às abas (pen-scope-count). Evita barra duplicada.
  if(totalPages <= 1){
    return '';
  }
  // Multi-página: mantém navegação, texto enxuto
  return '<div class="pen-pager" role="navigation" aria-label="Paginação de pendências">' +
    '<button class="btn btn-secondary btn-sm" onclick="penGotoPage(-1)"' + (_penPage <= 0 ? ' disabled' : '') + ' title="Página anterior">‹ Anterior</button>' +
    '<span class="pen-pager-info">Página ' + (_penPage + 1) + ' de ' + totalPages + ' · ' + _filteredPens.length + ' de ' + _penTotal + '</span>' +
    '<button class="btn btn-secondary btn-sm" onclick="penGotoPage(1)"' + ((_penPage + 1) >= totalPages ? ' disabled' : '') + ' title="Próxima página">Próxima ›</button>' +
  '</div>';
}

// ── Patch otimista da lista em tela (Parte 2 — state sync) ─────────────────
// Em modo servidor, renderPenView() refetcha do banco e pode trazer dado
// stale (o upsert fire-and-forget ainda não convergiu) — o card "pula de
// volta". Estas helpers aplicam a mudança na hora em _filteredPens +
// re-render do kanban; quando o fetch resolve, _applyOptimisticPens
// reaplica os patches pendentes sobre as linhas do servidor (TTL 8s).
var _penOptimistic = {}; // id -> { data, at, isNew }
var _penOptimisticRemoved = {}; // id -> timestamp (anti-ghost do delete)
var _PEN_OPTIMISTIC_TTL_MS = 8000;
function _optimisticPenUpsert(next, opts) {
  try {
    if (!next || !next.id) return;
    delete _penOptimisticRemoved[next.id];
    _penOptimistic[next.id] = { data: { ...next }, at: Date.now(), isNew: !!(opts && opts.isNew) };
    if (Array.isArray(_filteredPens)) {
      var idx = _filteredPens.findIndex(function(x) { return x && x.id === next.id; });
      if (idx !== -1) {
        _filteredPens[idx] = { ..._filteredPens[idx], ...next };
      } else if (opts && opts.isNew) {
        _filteredPens.unshift({ ...next });
      }
    }
    var area = (typeof document !== 'undefined') ? document.getElementById('penViewArea') : null;
    if (area) renderPenKanban(area);
  } catch (_) {}
}
function _optimisticPenRemove(id) {
  try {
    if (!id) return;
    delete _penOptimistic[id];
    _penOptimisticRemoved[id] = Date.now();
    if (Array.isArray(_filteredPens)) _filteredPens = _filteredPens.filter(function(x) { return !x || x.id !== id; });
    var area = (typeof document !== 'undefined') ? document.getElementById('penViewArea') : null;
    if (area) renderPenKanban(area);
  } catch (_) {}
}
function _clearOptimisticPenRemove(id) {
  try { if (id) delete _penOptimisticRemoved[id]; } catch (_) {}
}
function _applyOptimisticPens(rows) {
  try {
    var now = Date.now();
    var out = (rows || []).filter(function(r) {
      if (!r || !r.id) return true;
      var remAt = _penOptimisticRemoved[r.id];
      if (remAt) {
        if (now - remAt > _PEN_OPTIMISTIC_TTL_MS) delete _penOptimisticRemoved[r.id];
        else return false; // servidor ainda tem o id deletado (ghost) — filtra
      }
      return true;
    }).map(function(r) {
      if (!r || !r.id) return r;
      var o = _penOptimistic[r.id];
      if (!o) return r;
      if (now - o.at > _PEN_OPTIMISTIC_TTL_MS) { delete _penOptimistic[r.id]; return r; }
      try {
        // Servidor com updatedAt >= patch = upsert já convergiu → descarta patch.
        // (updatedAt igual só existe no servidor via nosso próprio upsert.)
        var sT = new Date(r.updatedAt || 0).getTime();
        var oT = new Date((o.data && o.data.updatedAt) || 0).getTime();
        if (sT >= oT) { delete _penOptimistic[r.id]; return r; }
      } catch (_) {}
      return { ...r, ...o.data };
    });
    // Criações ainda não convergidas: injeta na lista para feedback imediato.
    try {
      var seen = {};
      out.forEach(function(r) { if (r && r.id) seen[r.id] = true; });
      Object.keys(_penOptimistic).forEach(function(id) {
        var o = _penOptimistic[id];
        if (!o || !o.isNew || seen[id]) return;
        if (now - o.at > _PEN_OPTIMISTIC_TTL_MS) { delete _penOptimistic[id]; return; }
        out.unshift({ ...o.data });
      });
    } catch (_) {}
    return out;
  } catch (_) { return rows; }
}

// ── Kanban drag-and-drop de pendências ───────────────────────────────────────
// Resumo compacto da situação (usa os mesmos dados filtrados do kanban;
// não cria contagens novas: total + breakdown por status do escopo atual).
function penStatusSummary(pens) {
  var list = pens || [];
  var parts = _penSummaryParts(function(col) {
    return list.filter(function(p) { return p.status === col.id; }).length;
  });
  var vencidas = list.filter(penIsOverdue).length;
  return _penSummaryHtml(list.length, parts, vencidas, _penScopeLabel());
}

function renderPenKanban(area) {
  var pens = _filteredPens;
  _primePenRenderCache();
  try {
  // FASE 3: no modo servidor o resumo por status refletiria só a página;
  // FASE 6 usa os totais do banco (mesmo markup do resumo local).
  var summaryHtml = _penServerMode ? _penServerSummary() : penStatusSummary(pens);
  var cols = penBoardCols();
  var boardHtml = '<section class="kanban-board" role="region" aria-label="Quadro de pendências">' +
    cols.map(function(col) {
      var rawCards = pens.filter(function(p) { return p.status === col.id; });
      var cards = _penSortCards(rawCards, col.id);
      var sortMode = _penColSort[col.id] || 'criacao';
      // Um único ícone por coluna: o da ordenação atual (antes havia um relógio
      // decorativo fixo ao lado do botão, que também mostrava um relógio).
      var sortIcon = sortMode==='prazo' ? PEN_ICO_CAL : sortMode==='prioridade' ? PEN_ICO_BOLT : PEN_ICO_CLK;
      var sortTitle = sortMode==='prazo' ? 'Ordenado por prazo (clique para mudar)' : sortMode==='prioridade' ? 'Ordenado por prioridade' : 'Ordenado por criação';
      return '<section class="kanban-col" style="--c:' + penColColor(col.id) + '"' +
        ' aria-label="Coluna ' + escapeHtml(col.label) + ', ' + cards.length + ' pendência' + (cards.length === 1 ? '' : 's') + '"' +
        ' ondragover="event.preventDefault();this.classList.add(\'drag-over\')"' +
        ' ondragleave="this.classList.remove(\'drag-over\')"' +
        ' ondrop="onPenKanbanDrop(event,\'' + col.id + '\')">' +
        '<div class="kanban-col-header">' +
          '<h2 class="kanban-col-title">' +
            '<span class="kb-dot" aria-hidden="true"></span>' +
            escapeHtml(col.label) +
          '</h2>' +
          '<span class="kanban-col-aside">' +
            '<span class="kanban-col-count" aria-hidden="true">' + cards.length + '</span>' +
            '<button class="kanban-col-sort" onclick="cyclePenColSort(\''+col.id+'\')" title="'+sortTitle+' — Alternar: criação → prazo → prioridade" aria-label="Ordenar '+escapeHtml(col.label)+'">'+sortIcon+'</button>' +
          '</span>' +
        '</div>' +
        '<div class="kanban-cards">' +
          (cards.length
            ? cards.map(function(p) { return penKanbanCard(p); }).join('')
            : '<div class="empty-state" style="padding:18px 10px"><p>Nenhuma pendência</p><button class="btn btn-secondary btn-sm" onclick="openPendenciaForm()">+ Nova Pendência</button></div>') +
        '</div>' +
      '</section>';
    }).join('') +
  '</section>';
  area.innerHTML = _penPagerBar() +
    '<div class="pen-board">' +
      // Sem botão de tema aqui: o protótipo era uma página solta; no app a
      // topbar já tem o seletor de tema (o botão duplicava a ação).
      '<div class="pen-board-head">' +
        summaryHtml +
      '</div>' +
      // Celular: indicador da coluna visível ao deslizar ("Em Andamento · 2/5").
      '<div class="kb-pager" aria-hidden="true"><span class="kb-pager-label"></span><span class="kb-pager-dots">' +
        cols.map(function(col) { return '<i style="--c:' + penColColor(col.id) + '"></i>'; }).join('') +
      '</span></div>' +
      boardHtml +
    '</div>';
  var board = area.querySelector('.kanban-board');
  if (board) {
    _updateKanbanScrollShadows(board);
    _updateKanbanPager(board);
    board.onscroll = function() { _updateKanbanScrollShadows(board); _updateKanbanPager(board); };
    if (typeof window !== 'undefined') {
      if (window._kanbanResizeHandler) window.removeEventListener('resize', window._kanbanResizeHandler);
      window._kanbanResizeHandler = function() { _updateKanbanScrollShadows(board); };
      window.addEventListener('resize', window._kanbanResizeHandler);
    }
  }
  _applyPenCardMotion(area);
  // Total como contador dentro da aba ativa ("Ativas 5")
  try{
    var cntEl=document.getElementById('penScopeCount');
    if(cntEl){
      var total = _penServerMode && _penTotal!=null ? _penTotal : pens.length;
      cntEl.textContent = total ? String(total) : '';
    }
  }catch(_){}
  } finally {
    _clearPenRenderCache();
  }
}

// Indicador de coluna (celular): qual coluna está no centro da tela.
function _updateKanbanPager(board) {
  try {
    var pager = board && board.parentNode ? board.parentNode.querySelector('.kb-pager') : null;
    if (!pager) return;
    var cols = board.querySelectorAll('.kanban-col');
    if (!cols.length) return;
    var mid = board.scrollLeft + board.clientWidth / 2, idx = 0;
    cols.forEach(function(c, i) { if (c.offsetLeft <= mid) idx = i; });
    var title = cols[idx].querySelector('.kanban-col-title');
    var count = cols[idx].querySelector('.kanban-col-count');
    var lbl = pager.querySelector('.kb-pager-label');
    if (lbl) lbl.textContent = (title ? title.textContent.trim() : '') + (count ? ' (' + count.textContent + ')' : '') + ' · ' + (idx + 1) + '/' + cols.length;
    pager.querySelectorAll('.kb-pager-dots i').forEach(function(d, i) { d.classList.toggle('is-on', i === idx); });
  } catch (_) {}
}

// Indicador de scroll horizontal: sombra na borda do lado com coluna oculta.
function _updateKanbanScrollShadows(board) {
  if (!board) return;
  try {
    var max = board.scrollWidth - board.clientWidth;
    board.classList.toggle('has-scroll-left', board.scrollLeft > 4);
    board.classList.toggle('has-scroll-right', max > 4 && board.scrollLeft < max - 4);
  } catch (_) {}
}

function _penReducedMotion() {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (_) { return false; }
}

function _applyPenCardMotion(area) {
  if (typeof Motion === 'undefined') return;
  if (_penReducedMotion()) return;
  area.querySelectorAll('.kanban-card').forEach(function(card) {
    if (card.dataset.motionHoverBound) return;
    card.dataset.motionHoverBound = '1';
    Motion.hover(card,
      function() { Motion.animate(card, { y: -3 }, { duration: 0.2, ease: 'easeOut' }); },
      function() { Motion.animate(card, { y: 0 }, { duration: 0.2, ease: 'easeOut' }); }
    );
    // Fallback nativo: garante que o card volte ao estado original mesmo se
    // o Motion.hover não disparar o leave (ex: drag, pointer rápido, ou falha da lib)
    var resetHover = function() {
      try { Motion.animate(card, { y: 0 }, { duration: 0.15, ease: 'easeOut' }); } catch(_) {}
      // Limpeza do inline style que o Motion deixa (evita ficar em translateY(-3px))
      setTimeout(function(){
        if (!card.matches(':hover')) card.style.transform = '';
      }, 220);
    };
    card.addEventListener('mouseleave', resetHover);
    card.addEventListener('pointerleave', resetHover);
    card.addEventListener('dragend', resetHover);
    card.addEventListener('blur', resetHover);
  });
}

// ── Cache por render (FASE 1 — memoização) ─────────────────────────────────
// penKanbanCard roda 1× por card; sem cache cada card reordenava
// a lista inteira (getPendenciaDisplayNumber) e varria clientes com find
// (getClientById) → O(n² log n) por render. O cache é primado 1× em
// renderPenKanban (único ponto de render da lista) e limpo ao fim.
// Fora do render (modal, busca, calendário, export) o fallback calcula direto,
// com resultado idêntico — só mais lento para chamadas isoladas (irrelevante).
let _penNumCache = null;    // Map<penId, '#NNN'> | null
let _penClientCache = null; // Map<clientId, client> | null
function _primePenRenderCache() {
  try {
    const all = (typeof getPendencias === 'function') ? getPendencias() : [];
    _penNumCache = (typeof getPendenciaDisplayMap === 'function')
      ? getPendenciaDisplayMap(all) : null;
    _penClientCache = new Map();
    const clients = (typeof getClients === 'function') ? getClients() : [];
    for (const c of clients) { if (c && c.id != null && !_penClientCache.has(c.id)) _penClientCache.set(c.id, c); }
  } catch (_) { _penNumCache = null; _penClientCache = null; }
}
function _clearPenRenderCache() { _penNumCache = null; _penClientCache = null; }
function _penRenderClient(clientId) {
  try {
    if (_penClientCache && _penClientCache.has(clientId)) return _penClientCache.get(clientId) || null;
  } catch (_) {}
  return (typeof getClientById === 'function') ? getClientById(clientId) : null;
}

// Número amigável de exibição (#001...). Só apresentação: usa a função pura
// getPendenciaDisplayNumber (metrics.js) sobre a lista atual; o id interno
// (PEN-...) segue intacto em onclick, banco, sync e exports.
function penDisplayNumber(p) {
  try {
    if (p && _penNumCache && _penNumCache.has(p.id)) return _penNumCache.get(p.id);
    if (p && typeof getPendenciaDisplayNumber === 'function' && typeof getPendencias === 'function') {
      return getPendenciaDisplayNumber(getPendencias(), p.id);
    }
  } catch (_) {}
  return '#---';
}

// Rodapé do card: cronômetro ativo → tempo decorrido em verde; senão o
// botão "Iniciar" (play em círculo verde). toggleTimer() já cuida de mover
// a pendência para Em andamento e de pausar/retomar.
function penTimerCell(p) {
  var closed = (typeof isPendenciaClosed === 'function') ? isPendenciaClosed(p.status) : false;
  var worker = null;
  try { if (typeof getCurrentWorker === 'function') worker = getCurrentWorker(p); } catch (_) {}
  var running = !!(p && p.timerRunning) || !!worker;
  var secs = 0;
  try { if (typeof getElapsedSeconds === 'function') secs = getElapsedSeconds(p); } catch (_) {}
  // Formato curto no card: "8d 21h" em vez de "213:06:51".
  var fmt = (typeof formatTimerCompact === 'function') ? formatTimerCompact(secs)
    : (typeof formatTimer === 'function') ? formatTimer(secs) : '';
  if (running || (closed && secs > 0)) {
    if (!fmt) return '';
    var display = '<span class="kb-timer timer-display" data-format="compact" data-timer-id="' + escapeHtml(p.id) + '" data-running="' + (running ? 'true' : 'false') + '"' +
      ' title="' + (running ? 'Cronômetro ativo' : 'Tempo total trabalhado') + '">' + fmt + '</span>';
    // Sessão ligada há muito tempo: provável esquecimento — alerta âmbar e
    // atalho para parar registrando só o tempo real.
    var forgotten = running && typeof isTimerForgotten === 'function' && isTimerForgotten(p);
    if (forgotten) {
      var ago = (typeof formatDurationWords === 'function' && typeof getSessionSeconds === 'function')
        ? formatDurationWords(getSessionSeconds(p)) : '';
      return '<button type="button" class="kb-timer-forgot" onclick="event.stopPropagation();openTimerAdjust(\'' + escapeHtml(p.id) + '\')"' +
        ' title="Cronômetro ligado há ' + escapeHtml(ago) + ' — esqueceu ligado? Clique para parar e ajustar o tempo."' +
        ' aria-label="Cronômetro ligado há ' + escapeHtml(ago) + '. Parar e ajustar tempo">' +
        PEN_ICO_WARN + display + '</button>';
    }
    return display;
  }
  if (closed) return '';
  var label = 'Iniciar cronômetro de ' + penDisplayNumber(p);
  return '<button class="kb-go" type="button" onclick="event.stopPropagation();toggleTimer(\'pendencia\',\'' + escapeHtml(p.id) + '\',this)"' +
    ' aria-label="' + escapeHtml(label) + '">' +
    '<span class="kb-play" aria-hidden="true">' + PEN_ICO_PLAY + '</span>Iniciar</button>';
}

function penKanbanCard(p) {
  var c = _penRenderClient(p.clientId);
  var clientName = p.clientName || (c && c.name) || '—';
  var isOverdue = penIsOverdue(p);
  // "Parada" (sem atualização há 7+ dias) contradiz um cronômetro rodando;
  // nesse caso o alerta certo é o de cronômetro esquecido, no rodapé.
  var isStale = isStalePendencia(p) && !p.timerRunning;
  var title = getPendenciaTitulo(p);
  var num = penDisplayNumber(p);
  var sla = (typeof slaCountdown === 'function') ? slaCountdown(p, 48) : null;
  var slaHtml = (sla && !sla.expired && sla.label)
    ? '<span class="kc-sla" title="SLA restante">' + sla.label + '</span>' : '';

  // Vencida aparece só aqui (data vermelha + ⚠), não repetida no meio do card.
  var deadlineHtml = p.deadline
    ? '<span class="kc-deadline' + (isOverdue ? ' is-overdue' : '') + '" title="' + (isOverdue ? 'Vencida — prazo' : 'Prazo') + '">' +
        (isOverdue ? PEN_ICO_WARN : PEN_ICO_CAL) + formatDate(parseDeadline(p.deadline)) +
        (isOverdue ? '<span class="sr-only"> (Vencida)</span>' : '') + '</span>'
    : '<span class="kc-deadline is-empty" title="Sem prazo">' + PEN_ICO_CAL + 'Sem prazo</span>';

  return '<article class="kanban-card"' +
    ' style="border-left:4px solid ' + penColColor(p.status) + '"' +
    ' draggable="true"' +
    ' ondragstart="onPenKanbanDragStart(event,\'' + escapeHtml(p.id) + '\')"' +
    ' ondragend="onPenKanbanDragEnd(event)"' +
    ' onclick="openPendenciaDetail(\'' + escapeHtml(p.id) + '\')"' +
    ' aria-label="' + escapeHtml(num + ' — ' + title) + '">' +
    '<div class="kanban-card-title" title="' + escapeHtml(title) + '">' +
      '<span class="pen-display-num">' + num + '</span>' + escapeHtml(title) +
      (p.recurrence ? '<span class="kc-recur" title="Repete: ' + escapeHtml(penRecurrenceLabel(p.recurrence)) + ' (a próxima nasce ao concluir)">' + PEN_ICO_REPEAT + '</span>' : '') +
    '</div>' +
    '<button type="button" class="kc-menu" aria-label="Ações rápidas de ' + escapeHtml(num) + '" aria-haspopup="menu" aria-expanded="false"' +
      ' onclick="openPenQuickMenu(event,\'' + escapeHtml(p.id) + '\')" ondragstart="event.preventDefault()">' + PEN_ICO_DOTS + '</button>' +
    '<div class="kanban-card-meta">' +
      '<span class="kc-client" title="' + escapeHtml(clientName) + '">' +
        '<span class="kc-av" aria-hidden="true">' + penInitials(clientName) + '</span>' +
        '<span class="kc-client-name">' + escapeHtml(clientName) + '</span>' +
      '</span>' +
      '<span class="kb-pill" style="--c:' + penPriColor(p.priority) + '">' + escapeHtml(penPriLabel(p.priority)) + '</span>' +
      (p.responsible
        ? '<span class="kc-resp" title="Responsável">' + PEN_ICO_USER + escapeHtml(p.responsible) + '</span>'
        : '<span class="kc-resp kc-resp--empty" title="Sem responsável definido">○ Sem responsável</span>') +
      (isStale ? '<span class="kc-stale" title="Sem atualização há 7+ dias">Parada</span>' : '') +
      slaHtml +
    '</div>' +
    '<div class="kanban-card-foot">' +
      deadlineHtml +
      penTimerCell(p) +
    '</div>' +
  '</article>';
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
  penMoveTo(e.dataTransfer.getData('penId'), colId);
}

// Muda o status (arrastar no quadro ou menu ⋯ do card).
function penMoveTo(id, colId) {
  var p = getPendenciaById(id);
  if (!p || p.status === colId) return;
  // Cópia destacada: getPendenciaById devolve a referência viva do cache e
  // mutá-la antes do save cegaria a detecção de transição (oldStatus) que
  // gera a próxima ocorrência recorrente em savePendencia.
  var next = { ...p, status: colId };
  savePendencia(next);
  _optimisticPenUpsert(next); // move o card na hora; o fetch reconcilia depois
  updateBadges();
  renderPenView(false);
  var colLabel = PEN_KANBAN_COLS.find(function(c) { return c.id === colId; });
  showToast('Pendência movida para "' + (colLabel ? colLabel.label : colId) + '"', 'success');
}
