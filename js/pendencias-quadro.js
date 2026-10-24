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
    if (area) _penRenderAtual(area);
  } catch (_) {}
}
function _optimisticPenRemove(id) {
  try {
    if (!id) return;
    delete _penOptimistic[id];
    _penOptimisticRemoved[id] = Date.now();
    if (Array.isArray(_filteredPens)) _filteredPens = _filteredPens.filter(function(x) { return !x || x.id !== id; });
    var area = (typeof document !== 'undefined') ? document.getElementById('penViewArea') : null;
    if (area) _penRenderAtual(area);
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
  _bindPenBoardDrag(); // idempotente: liga a delegação de arrasto uma vez só
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
      var sortIcon = sortMode==='prazo' ? PEN_ICO_CAL : sortMode==='prioridade' ? PEN_ICO_BOLT : sortMode==='manual' ? PEN_ICO_DRAG : PEN_ICO_CLK;
      // O ícone muda, o rótulo acessível não mudava: o leitor de tela só
      // ouvia "Ordenar Aberto" e nunca a ordem em vigor. O aria-label
      // sobrepõe o title, então a ordem atual precisa estar nele.
      var sortAria = 'Ordem de ' + col.label + ': ' + penColSortLabel(sortMode) + '. Clique para mudar.';
      // A ordem só ganha nome visível quando sai do padrão: cinco colunas
      // repetindo "criação" seria ruído, e o que o olho precisa saber é quando
      // AQUELA coluna foge do resto. O ícone sozinho era adivinhação.
      var sortCustom = sortMode !== 'criacao';
      var sortWord = sortCustom ? '<span class="kcs-word">' + escapeHtml(penColSortWord(sortMode)) + '</span>' : '';
      var sortTitle = sortMode==='prazo' ? 'Ordenado por prazo (clique para mudar)' : sortMode==='prioridade' ? 'Ordenado por prioridade' : sortMode==='manual' ? 'Ordem manual — arraste os cards para reordenar' : 'Ordenado por criação';
      // Coluna vazia fica estreita (só cabeçalho + área para soltar), para
      // as colunas com cards caberem na tela sem rolagem lateral.
      return '<section class="kanban-col' + (cards.length ? '' : ' is-empty') + '" style="--c:' + penColColor(col.id) + '"' +
        ' aria-label="Coluna ' + escapeHtml(col.label) + ', ' + cards.length + ' pendência' + (cards.length === 1 ? '' : 's') + '"' +
        ' ondragover="event.preventDefault();this.classList.add(\'drag-over\')"' +
        ' ondragleave="this.classList.remove(\'drag-over\')"' +
        ' ondrop="onPenKanbanDrop(event,\'' + col.id + '\')">' +
        '<div class="kanban-col-header">' +
          '<h2 class="kanban-col-title">' +
            '<span class="kb-dot" aria-hidden="true"></span>' +
            // Nome em span próprio para truncar com … e ceder largura ao selo
            // da ordem, em vez de empurrar o cabeçalho para fora da coluna.
            '<span class="kct-nome">' + escapeHtml(col.label) + '</span>' +
          '</h2>' +
          '<span class="kanban-col-aside">' +
            '<span class="kanban-col-count" aria-hidden="true">' + cards.length + '</span>' +
            (cards.length ? '<button class="kanban-col-sort'+(sortCustom ? ' is-custom' : '')+'" data-action="penColSort" data-arg="'+escapeHtml(col.id)+'" title="'+sortTitle+' — Alternar: criação → prazo → prioridade → manual" aria-label="'+escapeHtml(sortAria)+'">'+sortIcon+sortWord+'</button>' : '') +
          '</span>' +
        '</div>' +
        '<div class="kanban-cards">' +
          (cards.length
            ? cards.map(function(p) { return penKanbanCard(p); }).join('')
            : '<div class="kb-col-empty">Nenhuma pendência.<br>Arraste um card para cá.<button type="button" class="kb-col-new" data-action="newPendencia">+ Nova</button></div>') +
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
  if (typeof _canAnimate === 'function' ? !_canAnimate() : typeof Motion === 'undefined') return;
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
  // Aqui havia uma contagem solta ("12h") de slaCountdown com 48h chumbadas:
  // um número sem palavra nenhuma, cujo sentido vivia só no title, e que nem
  // era o SLA configurado. Os selos de resposta e resolução dizem a mesma
  // coisa com todas as letras e, sem `full`, só falam quando exigem ação —
  // no quadro o silêncio é informação. É o mesmo par que a fila já mostra.
  var slaHtml = '';
  if (typeof penRespostaBadge === 'function') slaHtml += penRespostaBadge(p);
  // A violação de prazo já tem dono no card: a data vermelha com ⚠ no rodapé
  // (é o que o comentário do deadline abaixo combina). Por isso o selo de
  // resolução só entra enquanto AINDA dá tempo — "Resolver em 2h" é o aviso
  // que faltava; repetir "Vencida" no meio do card seria dizer duas vezes.
  if (!isOverdue && typeof penResolucaoBadge === 'function') slaHtml += penResolucaoBadge(p);

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
    // Ordem manual (062): só data-*, sem handler inline. Os eventos de arrasto
    // são tratados por delegação em _bindPenBoardDrag() — a catraca de CSP
    // (tests/no-inline-handlers.test.js) não pode crescer.
    ' data-pen-id="' + escapeHtml(p.id) + '"' +
    ' data-pen-col="' + escapeHtml(p.status) + '"' +
    ' data-action="openPendencia" data-arg="' + escapeHtml(p.id) + '"' +
    ' aria-label="' + escapeHtml(num + ' — ' + title) + '">' +
    // O título é um <button> de verdade porque é ele que recebe o foco do
    // teclado — antes o card era uma <article> com onclick e quem navega por
    // Tab não abria chamado nenhum pelo quadro. A <article> não pode virar
    // role="button": ela tem outros botões dentro (⋯, cronômetro).
    '<button type="button" class="kanban-card-title kc-open" data-action="openPendencia" data-arg="' + escapeHtml(p.id) + '" title="' + escapeHtml(title) + '">' +
      '<span class="pen-display-num">' + num + '</span>' + escapeHtml(title) +
      (p.recurrence ? '<span class="kc-recur" title="Repete: ' + escapeHtml(penRecurrenceLabel(p.recurrence)) + ' (a próxima nasce ao concluir)">' + PEN_ICO_REPEAT + '</span>' : '') +
    '</button>' +
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
      // "Parada" sozinha dizia que algo estava errado sem dizer o tamanho do
      // problema — 8 dias e 3 meses pediam a mesma atenção. O prazo agora está
      // no texto, e o title some junto com a necessidade de passar o mouse.
      (isStale ? '<span class="kc-stale">' + escapeHtml(penParadaLabel(p)) + '</span>' : '') +
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
  var id = e.dataTransfer.getData('penId');
  var p = getPendenciaById(id);
  // Soltar no fundo da coluna, já estando nela e em ordem manual: vai p/ o fim.
  // (penMoveTo sozinho não faria nada, porque o status não mudou.)
  if (p && p.status === colId && (_penColSort[colId] || 'criacao') === 'manual') {
    penReorder(id, null, colId);
    return;
  }
  penMoveTo(id, colId);
}

// ── Ordem manual dentro da coluna (migration 062) ──────────────────────────
// Só vale no modo 'manual'; nos outros a ordem é derivada e arrastar dentro da
// coluna não deve mudar nada (o card volta para o lugar e um toast explica).
function _penCardsOfCol(colId) {
  var pens = Array.isArray(_filteredPens) ? _filteredPens : [];
  return _penSortCards(pens.filter(function(p) { return p.status === colId; }), colId);
}

/** Nova `position` para cair ENTRE os vizinhos — sem renumerar a coluna. */
function _penPositionBetween(before, after) {
  // _penPos trata null/''/NaN como "sem posição" — Number(null) seria 0.
  var a = _penPos(before);
  var b = _penPos(after);
  if (a !== null && b !== null) return (a + b) / 2;
  if (a !== null) return a + 1;
  if (b !== null) return b - 1;
  return 0;
}

/**
 * Move `id` para antes de `targetId` na mesma coluna. `targetId` null = fim.
 * Só a pendência arrastada é salva: os vizinhos não mudam de position.
 */
function penReorder(id, targetId, colId) {
  if (!id || id === targetId) return;
  var p = getPendenciaById(id);
  if (!p || p.status !== colId) return;
  var ordem = _penCardsOfCol(colId).filter(function(c) { return c.id !== id; });
  var alvo = targetId ? ordem.findIndex(function(c) { return c.id === targetId; }) : ordem.length;
  if (alvo === -1) return;
  var pos = _penPositionBetween(ordem[alvo - 1] || null, ordem[alvo] || null);
  if (Number(p.position) === pos) return;
  var next = { ...p, position: pos };
  savePendencia(next);
  _optimisticPenUpsert(next);
  renderPenView(false);
}

// Arrasto sobre os cards por DELEGAÇÃO (sem handler inline: a catraca de CSP
// em tests/no-inline-handlers.test.js só pode diminuir). Fora do modo manual
// os eventos passam direto e a coluna trata a mudança de status.
var _penDragBound = false;
function _penDropCard(ev) {
  var el = ev.target && ev.target.closest ? ev.target.closest('.kanban-card[data-pen-id]') : null;
  if (!el) return null;
  var colId = el.getAttribute('data-pen-col') || '';
  return (_penColSort[colId] || 'criacao') === 'manual' ? el : null;
}
function _penClearDropMark() {
  document.querySelectorAll('.kanban-card.kb-drop-before').forEach(function(c) { c.classList.remove('kb-drop-before'); });
}
function _bindPenBoardDrag() {
  if (_penDragBound || typeof document === 'undefined' || !document.addEventListener) return;
  _penDragBound = true;
  document.addEventListener('dragover', function(ev) {
    var el = _penDropCard(ev);
    if (!el) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (!el.classList.contains('kb-drop-before')) { _penClearDropMark(); el.classList.add('kb-drop-before'); }
  });
  document.addEventListener('dragleave', function(ev) {
    var el = ev.target && ev.target.closest ? ev.target.closest('.kanban-card') : null;
    if (el) el.classList.remove('kb-drop-before');
  });
  document.addEventListener('drop', function(ev) {
    var el = _penDropCard(ev);
    if (!el) return;
    ev.preventDefault();
    ev.stopPropagation();
    _penClearDropMark();
    document.querySelectorAll('.kanban-col').forEach(function(c) { c.classList.remove('drag-over'); });
    var id = ev.dataTransfer ? ev.dataTransfer.getData('penId') : '';
    var alvo = el.getAttribute('data-pen-id');
    var colId = el.getAttribute('data-pen-col') || '';
    var p = getPendenciaById(id);
    if (!p) return;
    if (p.status !== colId) { penMoveTo(id, colId); return; } // veio de outra coluna
    penReorder(id, alvo, colId);
  });
}

// Ordenação da coluna por delegação (a catraca de CSP só pode diminuir).
if (typeof registerActions === 'function') {
  registerActions({
    penColSort: (_el, colId) => cyclePenColSort(colId),
  });
}

// Muda o status (arrastar no quadro ou menu ⋯ do card).
// `opts.semDesfazer` existe para o próprio desfazer não oferecer outro.
function penMoveTo(id, colId, opts) {
  var p = getPendenciaById(id);
  if (!p || p.status === colId) return;
  var antes = p.status;
  // Cópia destacada: getPendenciaById devolve a referência viva do cache e
  // mutá-la antes do save cegaria a detecção de transição (oldStatus) que
  // gera a próxima ocorrência recorrente em savePendencia.
  var next = { ...p, status: colId };
  savePendencia(next);
  _optimisticPenUpsert(next); // move o card na hora; o fetch reconcilia depois
  updateBadges();
  renderPenView(false);
  var colLabel = PEN_KANBAN_COLS.find(function(c) { return c.id === colId; });
  var msg = 'Pendência movida para "' + (colLabel ? colLabel.label : colId) + '"';
  // Arrastar erra fácil e o card some da coluna de origem na hora: sem
  // desfazer, só sobra refazer o caminho à mão.
  // Concluir/fechar fica de fora de propósito — a transição pode ter gerado
  // a próxima ocorrência recorrente, e voltar o status não desfaz aquele
  // nascimento. Um "Desfazer" que desfaz pela metade mente.
  var fechado = (typeof isPendenciaClosed === 'function') ? isPendenciaClosed(colId) : false;
  if ((opts && opts.semDesfazer) || fechado || typeof showUndoToast !== 'function') {
    showToast(msg, 'success');
    return;
  }
  showUndoToast(msg, function() {
    // Entre o toast e o clique cabem 5s de outros gestos: se o status mudou,
    // este desfazer é de outra história e não pode engolir o movimento novo.
    var agora = getPendenciaById(id);
    if (!agora || agora.status !== colId) {
      showToast('O status mudou depois disso — nada a desfazer.', 'info');
      return;
    }
    penMoveTo(id, antes, { semDesfazer: true });
  });
}
