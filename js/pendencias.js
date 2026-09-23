// pendencias.js

const TIPOS = ['Projeto','Operacional / Interno','Manutenção','Suporte','Outro'];

const PEN_KANBAN_COLS = typeof STATUS_PEN_MAP !== 'undefined' ? Object.entries(STATUS_PEN_MAP).map(([id, v]) => ({ id, label: v.label, color: v.dot })) : [];

// Colunas/status ocultos da VISUALIZAÇÃO de Pendências (kanban, resumos e
// grade mobile). Somente apresentação: registros com esses status continuam
// existindo, sincronizando e acessíveis (filtro de status, busca, detalhe,
// dashboard, relatórios). O escopo Ativas/Arquivadas e a lógica de
// sincronização (isPendenciaClosed, PEN_CLOSED_LIST) ficam intactos.
const PEN_HIDDEN_COLS = ['concluido', 'fechado'];
function penColVisible(colOrStatusId) {
  var id = (colOrStatusId && colOrStatusId.id) || colOrStatusId;
  return PEN_HIDDEN_COLS.indexOf(id) === -1;
}
function penBoardCols() {
  var cols = penScope === 'archived'
    ? PEN_KANBAN_COLS.filter(function(c) { return isPendenciaClosed(c.id); })
    : PEN_KANBAN_COLS.filter(function(c) { return !isPendenciaClosed(c.id); });
  return cols.filter(penColVisible);
}

let penView = 'kanban';
let penScope = 'active';
let _filteredPens = [];

// ── 1. HIERARQUIA SLA/Vencido ───────────────────────────────────────────────
// Vermelho só para críticos (aberto/em_andamento). Aguard.* usa âmbar neutro.
const _PEN_SLA_CRITICAL = ['aberto','em_andamento'];
function _slaVisualFor(p, sla){
  if(!sla) return null;
  var isCritical = _PEN_SLA_CRITICAL.indexOf(p.status) !== -1;
  if(sla.expired && !isCritical){
    // Aguardando Terceiro/Cliente/pausado: atraso pode ser esperado → âmbar suave
    return { label: sla.label, color: '#92400e', bg: '#fef3c7', muted: true, expired: true };
  }
  return { label: sla.label, color: sla.color, muted: false, expired: sla.expired };
}
function _overdueVisualFor(p){
  var critical = _PEN_SLA_CRITICAL.indexOf(p.status) !== -1;
  return critical ? { color:'#dc2626', label:'⚠️ Vencida' } : { color:'#92400e', label:'⚠️ Vencida' };
}

// ── 6. ORDENAÇÃO POR COLUNA ────────────────────────────────────────────────
var _penColSort = {}; // colId -> 'criacao'|'prazo'|'prioridade'
const _PEN_PRIORITY_WEIGHT = { critica:4, alta:3, media:2, baixa:1 };
function _penSortCards(cards, colId){
  var mode = _penColSort[colId] || 'criacao';
  var arr = cards.slice();
  if(mode==='prazo'){
    arr.sort(function(a,b){
      var da = a.deadline || '9999-12-31';
      var db = b.deadline || '9999-12-31';
      if(da!==db) return da.localeCompare(db);
      return String(a.createdAt||'').localeCompare(String(b.createdAt||''));
    });
  } else if(mode==='prioridade'){
    arr.sort(function(a,b){
      var wa = _PEN_PRIORITY_WEIGHT[a.priority]||0;
      var wb = _PEN_PRIORITY_WEIGHT[b.priority]||0;
      if(wb!==wa) return wb-wa;
      return String(b.createdAt||'').localeCompare(String(a.createdAt||''));
    });
  } else {
    arr.sort(function(a,b){ return String(a.createdAt||'').localeCompare(String(b.createdAt||'')); });
  }
  return arr;
}
function setPenColSort(colId, mode){
  _penColSort[colId]=mode;
  var area=document.getElementById('penViewArea');
  if(area) renderPenKanban(area);
}
function cyclePenColSort(colId){
  var cur=_penColSort[colId]||'criacao';
  var next= cur==='criacao' ? 'prazo' : cur==='prazo' ? 'prioridade' : 'criacao';
  setPenColSort(colId,next);
}

// ── @MENÇÃO: fallback se storage.js não carregou (ex: testes) ──
function _getOpNamesFallback(){
  try{
    if(typeof getOperatorNames==='function') return getOperatorNames();
    if(typeof globalThis!=='undefined' && typeof globalThis.getOperatorNames==='function') return globalThis.getOperatorNames();
    if(typeof getOperators==='function') return getOperators().map(function(o){return o.name;});
    if(typeof globalThis!=='undefined' && typeof globalThis.getOperators==='function') return globalThis.getOperators().map(function(o){return o.name;});
  }catch(_){}
  return [];
}
function _escapeHtmlFallback(str){
  if(typeof escapeHtml==='function') return escapeHtml(str);
  if(typeof globalThis!=='undefined' && typeof globalThis.escapeHtml==='function') return globalThis.escapeHtml(str);
  if(str==null) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
if (typeof parseMentionedOperators !== 'function') {
  var parseMentionedOperators = function(text) {
    if (!text) return [];
    var names = _getOpNamesFallback();
    if (!names.length) return [];
    var regex = /@([A-Za-zÀ-ÿ0-9_]+)/g, mentions=[], m; while((m=regex.exec(text))!==null) mentions.push(m[1]);
    if(!mentions.length) return [];
    var result=[], seen=new Set();
    mentions.forEach(function(tok){ var tl=tok.toLowerCase(); names.forEach(function(n){ var nl=n.toLowerCase(), parts=nl.split(/\s+/); var ok=parts.some(function(p){return p===tl;})||nl===tl; if(ok&&!seen.has(n)){seen.add(n); result.push(n);} }); });
    return result;
  };
}
if (typeof highlightMentions !== 'function') {
  var highlightMentions = function(text) {
    var esc = _escapeHtmlFallback(text);
    var names=_getOpNamesFallback();
    if(!names.length) return esc;
    return esc.replace(/@([A-Za-zÀ-ÿ0-9_]+)/g, function(match,p1){ var tl=p1.toLowerCase(); var isMention=names.some(function(n){ var parts=n.toLowerCase().split(/\s+/); return parts.some(function(p){return p===tl;})||n.toLowerCase()===tl; }); if(isMention) return '<span style="background:#dbeafe;color:#1e40af;padding:1px 4px;border-radius:4px;font-weight:600">@'+p1+'</span>'; return match; });
  };
}

// ── TEMPLATE SUGGESTION HELPERS (puras) ──
function _tokenizeWords(str) {
  return String(str||'').toLowerCase().split(/\s+/).map(function(w){ return w.replace(/[^a-zà-ÿ0-9]/gi,''); }).filter(function(w){ return w.length>2; });
}
function suggestTemplateForDescription(descText, templates) {
  var words = _tokenizeWords(descText);
  if (!words.length || !templates || !templates.length) return null;
  var best=null, bestScore=-1;
  templates.forEach(function(t){
    var tplText = ((t.title||'')+' '+(t.category||'')+' '+(t.content||'')).toLowerCase();
    var matches = words.filter(function(w){ return tplText.includes(w); }).length;
    var meets = matches>=2 || matches>=words.length*0.5;
    if (meets && matches>bestScore) { bestScore=matches; best=t; }
  });
  return best;
}
function applyTemplateSuggestion(tplId) {
  var tpl = typeof getProcedureTemplateById==='function'?getProcedureTemplateById(tplId):null;
  if(!tpl) return;
  var ta = document.querySelector('textarea[name="descricao"]');
  if(ta){ ta.value = tpl.content||''; ta.dispatchEvent(new Event('input',{bubbles:true})); if(typeof showToast==='function') showToast('Modelo "'+tpl.title+'" aplicado!','success'); var sug=document.getElementById('templateSuggestion'); if(sug) sug.style.display='none'; }
}

function _penActiveFilterCount(){
  var c=0;
  if(document.getElementById('penResponsible')?.value) c++;
  if(document.getElementById('penStatus')?.value) c++;
  if(document.getElementById('penPriority')?.value) c++;
  if(document.getElementById('penSavedFilter')?.value) c++;
  return c;
}
function _penUpdateMoreFiltersBadge(){
  var badge=document.getElementById('penMoreFiltersBadge');
  if(!badge) return;
  var n=_penActiveFilterCount();
  badge.textContent=n?String(n):'';
  badge.style.display=n?'inline-flex':'none';
}
function togglePenMoreFilters(){
  var panel=document.getElementById('penMoreFiltersPanel');
  var btn=document.getElementById('penMoreFiltersBtn');
  if(!panel||!btn) return;
  var open=panel.style.display!=='none' && panel.style.display!=='';
  // Close if open
  if(!panel.classList.contains('hidden') && panel.style.display!=='none' && getComputedStyle(panel).display!=='none' && panel.dataset.open==='1'){
    panel.dataset.open='0'; panel.style.display='none'; btn.setAttribute('aria-expanded','false');
    return;
  }
  // Toggle via dataset
  var isOpen=panel.dataset.open==='1';
  panel.dataset.open=isOpen?'0':'1';
  panel.style.display=isOpen?'none':'flex';
  btn.setAttribute('aria-expanded', isOpen?'false':'true');
}
function _closePenMoreFiltersOnOutside(e){
  var panel=document.getElementById('penMoreFiltersPanel');
  var btn=document.getElementById('penMoreFiltersBtn');
  if(!panel||!btn) return;
  if(panel.dataset.open!=='1') return;
  if(panel.contains(e.target) || btn.contains(e.target)) return;
  panel.dataset.open='0'; panel.style.display='none'; btn.setAttribute('aria-expanded','false');
}
if(typeof window!=='undefined' && !window._penMoreFiltersBound){
  window._penMoreFiltersBound=true;
  document.addEventListener('click', _closePenMoreFiltersOnOutside);
}

function renderPendencias() {
  document.getElementById('pageTitle').textContent = 'Pendências';
  setTopbarAction('Nova Pendência', '<svg class="topbar-action-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>');
  window._topbarAction = () => openPendenciaForm();

  const saved = loadFilterState('pendencias', {});

  const clients  = isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam ? getClientsByTeam(_selectedTeam) : getMyClients();
  const team     = isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam ? _selectedTeam : getCurrentTeam();
  const opNames  = getOperatorNames(team);

  document.getElementById('contentArea').innerHTML = `
    <div class="search-bar pen-search-bar">
      <div class="search-input-wrap filter-grow">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input class="form-input" id="penSearch" placeholder="Buscar..." oninput="savePenFilters();debouncedRenderPenView();_penUpdateMoreFiltersBadge()" />
      </div>
      <select class="form-select filter-select-md" id="penClient" onchange="savePenFilters();renderPenView();_penUpdateMoreFiltersBadge()">
        <option value="">Todos os clientes</option>
        ${clients.map(c=>`<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('')}
      </select>
      <button class="btn btn-secondary pen-more-btn" id="penMoreFiltersBtn" onclick="togglePenMoreFilters()" aria-expanded="false" aria-controls="penMoreFiltersPanel" title="Mais filtros">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="11" y1="18" x2="13" y2="18"/></svg>
        Mais filtros
        <span class="pen-more-badge" id="penMoreFiltersBadge" style="display:none"></span>
      </button>
      <div class="pen-more-panel" id="penMoreFiltersPanel" data-open="0" style="display:none">
        <select class="form-select filter-select-md" id="penResponsible" onchange="savePenFilters();renderPenView();_penUpdateMoreFiltersBadge()">
          <option value="">Todos os responsáveis</option>
          ${opNames.map(n=>`<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('')}
        </select>
        <select class="form-select filter-select" id="penStatus" onchange="savePenFilters();renderPenView();_penUpdateMoreFiltersBadge()">
          <option value="">Todos os status</option>
          ${Object.entries(STATUS_PEN_MAP).map(([k,v])=>`<option value="${k}">${escapeHtml(v.label)}</option>`).join('')}
        </select>
        <select class="form-select filter-select-sm" id="penPriority" onchange="savePenFilters();renderPenView();_penUpdateMoreFiltersBadge()">
          <option value="">Prioridade</option>
          <option value="baixa">Baixa</option>
          <option value="media">Média</option>
          <option value="alta">Alta</option>
          <option value="critica">Crítica</option>
        </select>
        <select class="form-select filter-select" id="penSavedFilter" onchange="applySavedPenFilter();_penUpdateMoreFiltersBadge()">
          <option value="">Filtros salvos...</option>
          ${getSavedPenFilters().map(f => `<option value="${escapeHtml(f.name)}">${escapeHtml(f.name)}</option>`).join('')}
        </select>
        <button class="btn btn-secondary btn-sm" onclick="saveCurrentPenFilter()" title="Salvar filtro atual">💾</button>
        <button class="btn btn-secondary btn-sm" onclick="deleteSavedPenFilter()" title="Remover filtro salvo">✕</button>
      </div>
    </div>
    <div class="page-action-row pen-scope-row">
      <div class="view-toggles pen-scope-tabs" role="tablist" aria-label="Escopo das pendências">
        <button role="tab" aria-selected="${penScope==='active'}" class="pen-scope-tab ${penScope==='active'?'is-active':''}" onclick="setPenScope('active')">Ativas</button>
        <button role="tab" aria-selected="${penScope==='archived'}" class="pen-scope-tab ${penScope==='archived'?'is-active':''}" onclick="setPenScope('archived')">Arquivadas</button>
      </div>
      <span class="pen-scope-count" id="penScopeCount" aria-live="polite"></span>
    </div>
    <div id="penSlaSummary" style="margin-bottom:12px"></div>
    <div id="penViewArea"></div>`;
  if (saved.search) document.getElementById('penSearch').value = saved.search;
  if (saved.client) document.getElementById('penClient').value = saved.client;
  if (saved.resp) document.getElementById('penResponsible').value = saved.resp;
  if (saved.status) document.getElementById('penStatus').value = saved.status;
  if (saved.priority) document.getElementById('penPriority').value = saved.priority;
  // restore saved filter select value if matches saved filters
  try{
    var savedName = saved.savedFilterName || '';
    if(savedName && document.getElementById('penSavedFilter')) document.getElementById('penSavedFilter').value = savedName;
  }catch(_){}
  setTimeout(function(){ _penUpdateMoreFiltersBadge(); }, 30);
  showSkeleton('penViewArea', 6);
  renderPenView();
}

// Chips de cliente: toggle com estado pressionado. Clicar filtra pelo cliente
// (chip fica destacado); clicar de novo limpa para todos os clientes.
function penClientChipState(selectedId, chipId) {
  return (selectedId && chipId && String(selectedId) === String(chipId)) ? ' is-active' : '';
}
function togglePenClientChip(clientId) {
  var sel = document.getElementById('penClient');
  if (!sel) return;
  sel.value = (sel.value === clientId) ? '' : clientId;
  if (typeof savePenFilters === 'function') savePenFilters();
  if (typeof renderPenView === 'function') renderPenView(false);
}

function _renderPendenciaSlaSummary() {
  const el = document.getElementById('penSlaSummary');
  if (!el) return;
  const today = typeof localDateISO === 'function' ? localDateISO() : new Date().toISOString().slice(0,10);
  const slaMap = typeof getAllSlaStats === 'function' ? getAllSlaStats(getPendencias(), today) : {};
  const entries = Object.entries(slaMap).sort((a,b)=> b[1].vencidas - a[1].vencidas || b[1].totalAbertas - a[1].totalAbertas);
  if (!entries.length) { el.innerHTML=''; return; }
  var _collapsed = el.dataset.collapsed !== '0';
  var _limit = _collapsed ? 4 : entries.length;
  var visible = entries.slice(0, _limit);
  var overflow = entries.length - visible.length;
  var _selClient = document.getElementById('penClient')?.value || '';
  el.innerHTML = `<div class="pen-client-carousel-wrap">`+
    `<div class="pen-client-carousel" id="penClientCarousel" role="region" aria-label="Resumo por cliente">`+
      visible.map(function(entry){
        var cid=entry[0], s=entry[1];
        var c=getClientById(cid);
        var name=escapeHtml(c?c.name:s.clientName);
        var hasVenc = s.vencidas>0;
        var dotColor = hasVenc ? '#dc2626' : '#16a34a';
        var chipState = penClientChipState(_selClient, cid);
        var pressed = chipState ? 'true' : 'false';
        return `<button class="pen-client-chip${chipState}" aria-pressed="${pressed}" onclick="togglePenClientChip('${escapeHtml(cid)}')" title="${name} · ${s.totalAbertas} abertas, ${s.vencidas} vencidas (clique para filtrar; de novo para limpar)">`+
          `<span class="pen-chip-dot" style="background:${dotColor}"></span>`+
          `<span class="pen-chip-name">${name}</span>`+
          `<span class="pen-chip-counts">${s.totalAbertas}·<span style="color:${hasVenc?'#dc2626':'var(--text-muted)'}">${s.vencidas}v</span></span>`+
        `</button>`;
      }).join('')+
    `</div>`+
    (entries.length>4 ? `<button class="btn btn-secondary btn-sm pen-chip-toggle" onclick="(function(el){el.dataset.collapsed=el.dataset.collapsed==='0'?'1':'0';_renderPendenciaSlaSummary()})(document.getElementById('penSlaSummary'))" aria-expanded="${_collapsed?'false':'true'}">${_collapsed ? 'Ver mais ('+entries.length+')' : 'Ver menos'}</button>` : '')+
  `</div>`;
  // scroll shadows
  setTimeout(function(){
    var car=document.getElementById('penClientCarousel');
    if(!car) return;
    function upd(){
      var max=car.scrollWidth - car.clientWidth;
      car.classList.toggle('has-scroll-left', car.scrollLeft>4);
      car.classList.toggle('has-scroll-right', max>4 && car.scrollLeft < max-4);
      el.classList.toggle('has-scroll-left', car.scrollLeft>4);
      el.classList.toggle('has-scroll-right', max>4 && car.scrollLeft < max-4);
    }
    car.onscroll=upd; upd();
  },30);
}

function renderPenView(resetPage) {
  var area = document.getElementById('penViewArea');
  if (!area) return;
  var sig = _penViewSig();
  if (resetPage || sig !== _penLastSig) { _penPage = 0; _penLastSig = sig; }
  // FASE 3: online → página do banco (filtros/ordenação/paginação no servidor,
  // escopo do time sempre aplicado + RLS). Offline/falha → caminho local atual.
  if (typeof _penServerAvailable === 'function' && _penServerAvailable()
      && typeof fetchPendenciasPage === 'function') {
    _penServerMode = true;
    area.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>Carregando pendências…</p></div>';
    var pageReq = fetchPendenciasPage({
      scope: penScope, page: _penPage, pageSize: PEN_UI_PAGE_SIZE,
      clientId: document.getElementById('penClient')?.value || '',
      responsible: document.getElementById('penResponsible')?.value || '',
      status: document.getElementById('penStatus')?.value || '',
      priority: document.getElementById('penPriority')?.value || '',
      search: document.getElementById('penSearch')?.value || ''
    });
    // FASE 6: totais por status vêm do banco (só coluna status), não da página.
    var countReq = (typeof fetchPendenciaStatusCounts === 'function')
      ? fetchPendenciaStatusCounts(penScope) : Promise.resolve(null);
    Promise.all([pageReq, countReq]).then(function (arr) {
      if (sig !== _penLastSig) return; // filtro mudou durante o fetch — descarta
      _filteredPens = _applyOptimisticPens(arr[0].rows);
      _penTotal = arr[0].total;
      _penCounts = arr[1];
      _renderPendenciaSlaSummary();
      renderPenKanban(area);
    }).catch(function () {
      _penServerMode = false; _penTotal = null; _penCounts = null;
      _filteredPens = getFilteredPendencias();
      _renderPendenciaSlaSummary();
      renderPenKanban(area);
    });
    return;
  }
  _penServerMode = false; _penTotal = null; _penCounts = null;
  setTimeout(function() {
    _filteredPens = getFilteredPendencias();
    _renderPendenciaSlaSummary();
    renderPenKanban(area);
  }, 10);
}

// ── FASE 3: estado de paginação da lista ─────────────────────────────────────
let _penPage = 0;
const PEN_UI_PAGE_SIZE = 50;
let _penTotal = null;
let _penServerMode = false;
let _penLastSig = '';
let _penCounts = null; // FASE 6: { byStatus, total } do banco (modo servidor)
// FASE 6: resumo idêntico ao penStatusSummary, mas dos totais do banco.
function _penServerSummary() {
  var counts = _penCounts || { byStatus: {}, total: 0 };
  var cols = penBoardCols();
  var parts = cols.map(function(col) {
    var n = counts.byStatus[col.id] || 0;
    return n ? '<span><strong>' + n + '</strong> ' + escapeHtml(col.label.toLowerCase()) + '</span>' : '';
  }).filter(Boolean);
  var scopeLabel = penScope === 'archived' ? 'arquivadas' : 'ativas';
  return '<div class="pen-summary" role="status"><strong>' + counts.total + '</strong>&nbsp;pendências ' + scopeLabel + (parts.length ? ' · ' + parts.join(' · ') : '') + '</div>';
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
function isPenMobile() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 768px)').matches;
}

// Resumo compacto da situação (usa os mesmos dados filtrados do kanban;
// não cria contagens novas: total + breakdown por status do escopo atual).
function penStatusSummary(pens) {
  var list = pens || [];
  var cols = penBoardCols();
  var parts = cols.map(function(col) {
    var n = list.filter(function(p) { return p.status === col.id; }).length;
    return n ? '<span><strong>' + n + '</strong> ' + escapeHtml(col.label.toLowerCase()) + '</span>' : '';
  }).filter(Boolean);
  var scopeLabel = penScope === 'archived' ? 'arquivadas' : 'ativas';
  return '<div class="pen-summary" role="status"><strong>' + list.length + '</strong>&nbsp;pendências ' + scopeLabel + (parts.length ? ' · ' + parts.join(' · ') : '') + '</div>';
}

function renderPenKanban(area) {
  var pens = _filteredPens;
  _primePenRenderCache();
  try {
  // FASE 3: no modo servidor o resumo por status refletiria só a página;
  // FASE 6 usa os totais do banco (mesmo markup do resumo local).
  var summaryHtml = _penServerMode ? _penServerSummary() : penStatusSummary(pens);
  if (isPenMobile()) {
    area.innerHTML = _penPagerBar() + summaryHtml + renderPenMobileGrid(pens);
  } else {
    var cols = penBoardCols();
    area.innerHTML = _penPagerBar() + summaryHtml + '<div class="kanban-board">' +
      cols.map(function(col) {
        var rawCards = pens.filter(function(p) { return p.status === col.id; });
        var cards = _penSortCards(rawCards, col.id);
        var sortMode = _penColSort[col.id] || 'criacao';
        var sortIcon = sortMode==='prazo' ? '📅' : sortMode==='prioridade' ? '⚡' : '🕒';
        var sortTitle = sortMode==='prazo' ? 'Ordenado por prazo (clique para mudar)' : sortMode==='prioridade' ? 'Ordenado por prioridade' : 'Ordenado por criação';
        return '<div class="kanban-col"' +
          ' ondragover="event.preventDefault();this.classList.add(\'drag-over\')"' +
          ' ondragleave="this.classList.remove(\'drag-over\')"' +
          ' ondrop="onPenKanbanDrop(event,\'' + col.id + '\')">' +
          '<div class="kanban-col-header">' +
            '<div class="kanban-col-title">' +
              '<span style="width:10px;height:10px;border-radius:50%;background:' + col.color + ';display:inline-block"></span> ' +
              escapeHtml(col.label) +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:6px">' +
              '<button class="kanban-col-sort" onclick="cyclePenColSort(\''+col.id+'\')" title="'+sortTitle+' — Alternar: criação → prazo → prioridade" aria-label="Ordenar '+escapeHtml(col.label)+'">'+sortIcon+'</button>' +
              '<span class="kanban-col-count">' + cards.length + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="kanban-cards">' +
            (cards.length
              ? cards.map(function(p) { return penKanbanCard(p); }).join('')
              : '<div class="empty-state" style="padding:18px 10px"><p>Nenhuma pendência</p><button class="btn btn-secondary btn-sm" onclick="openPendenciaForm()">+ Nova Pendência</button></div>') +
          '</div>' +
        '</div>';
      }).join('') +
    '</div>';
    var board = area.querySelector('.kanban-board');
    if (board) {
      _updateKanbanScrollShadows(board);
      board.onscroll = function() { _updateKanbanScrollShadows(board); };
      if (typeof window !== 'undefined') {
        if (window._kanbanResizeHandler) window.removeEventListener('resize', window._kanbanResizeHandler);
        window._kanbanResizeHandler = function() { _updateKanbanScrollShadows(board); };
        window.addEventListener('resize', window._kanbanResizeHandler);
      }
    }
  }
  _applyPenCardMotion(area);
  // Número abaixo da aba ativa (só o total; o rótulo vive na própria aba)
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

// Indicador de scroll horizontal: sombra na borda do lado com coluna oculta.
function _updateKanbanScrollShadows(board) {
  if (!board) return;
  try {
    var max = board.scrollWidth - board.clientWidth;
    board.classList.toggle('has-scroll-left', board.scrollLeft > 4);
    board.classList.toggle('has-scroll-right', max > 4 && board.scrollLeft < max - 4);
  } catch (_) {}
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
// penKanbanCard/penMobileCard rodam 1× por card; sem cache cada card reordenava
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

function penKanbanCard(p) {
  var c = _penRenderClient(p.clientId);
  var isOverdue = p.deadline && p.deadline < localDateISO() && !isPendenciaClosed(p.status);
  var isStale = isStalePendencia(p);
  var rawSla = slaCountdown(p, 48);
  var sla = _slaVisualFor(p, rawSla);
  var overdueVis = isOverdue ? _overdueVisualFor(p) : null;
  var onLeave = typeof isOperatorOnLeave === 'function' ? isOperatorOnLeave(p.responsible) : false;
  var onLeaveBadge = onLeave ? '<span class="tag badge-afastado">🏖️ Afastado</span>' : '';
  var reassignBtn = onLeave ? '<button class="btn btn-sm btn-secondary" onclick="event.stopPropagation();openReassignPendencia(\'' + escapeHtml(p.id) + '\')">Reatribuir</button>' : '';
  var pri = priorityTag(p.priority);
  var respHtml = p.responsible
    ? '<span class="kc-resp" title="Responsável">👤 ' + escapeHtml(p.responsible) + '</span>'
    : '<span class="kc-resp kc-resp--empty" title="Sem responsável definido">○ Sem responsável</span>';
  var slaHtml = '';
  if(sla){
    var slaCls = sla.muted ? 'kc-sla kc-sla--muted' : 'kc-sla';
    slaHtml = '<span class="'+slaCls+'" style="color:'+sla.color+';font-weight:600" title="'+(sla.expired?'SLA vencido (48h)':'SLA restante (48h)')+'">⏱ '+sla.label+'</span>';
  }
  var overdueHtml = isOverdue ? '<span class="kc-overdue" style="color:'+overdueVis.color+';font-weight:600" title="Prazo vencido">'+overdueVis.label+'</span>' : '';
  var staleHtml = (isStale && !isOverdue) ? '<span class="kc-stale" title="Sem atualização há 7+ dias">🕓 Parada</span>' : '';
  var deadlineHtml = p.deadline
    ? '<span class="kc-deadline'+(isOverdue?' is-overdue':'')+'" title="'+(isOverdue?'Prazo vencido':'Prazo')+'">📅 '+formatDate(parseDeadline(p.deadline))+'</span>'
    : '<span class="kc-deadline is-empty" title="Sem prazo">📅 Sem prazo</span>';
  // Faixa lateral com a cor do status (mesmo padrão do card mobile):
  // identifica a coluna de relance sem depender só do cabeçalho.
  var _stDot = (typeof STATUS_PEN_MAP !== 'undefined' && STATUS_PEN_MAP[p.status]) ? STATUS_PEN_MAP[p.status].dot : '#94a3b8';
  return '<div class="kanban-card"' +
    ' style="border-left:3px solid '+_stDot+'"' +
    ' draggable="true"' +
    ' ondragstart="onPenKanbanDragStart(event,\'' + escapeHtml(p.id) + '\')"' +
    ' ondragend="onPenKanbanDragEnd(event)"' +
    ' onclick="openPendenciaDetail(\'' + escapeHtml(p.id) + '\')">' +
    '<div class="kanban-card-title" title="' + escapeHtml(getPendenciaTitulo(p)) + '"><span class="pen-display-num">' + penDisplayNumber(p) + '</span>' + escapeHtml(getPendenciaTitulo(p)) + '</div>' +
    '<div class="kanban-card-compact">' +
      '<span class="kc-client" title="'+escapeHtml(p.clientName||'—')+'">' + (c?clientAvatar(c,16):'') + '<span class="kc-client-name">' + escapeHtml(p.clientName||'—') + '</span></span>' +
      '<span class="kc-pri">'+pri+'</span>' +
      respHtml +
      overdueHtml + staleHtml + slaHtml +
      onLeaveBadge + reassignBtn +
    '</div>' +
    '<div class="kanban-card-compact kanban-card-compact--bottom">' +
      deadlineHtml +
      '<span class="kc-timer">'+timerWidget(p,"pendencia")+'</span>' +
    '</div>' +
  '</div>';
}

function renderPenMobileGrid(pens) {
  var visible = (pens || []).filter(function(p) { return penColVisible(p.status); });
  if (!visible.length) {
    return '<div class="card"><div class="empty-state"><p>Nenhuma pendência encontrada.</p><button class="btn btn-primary btn-sm" onclick="openPendenciaForm()">+ Nova Pendência</button></div></div>';
  }
  return '<div class="pen-mobile-grid">' + visible.map(penMobileCard).join('') + '</div>';
}

function penMobileCard(p) {
  const c = _penRenderClient(p.clientId);
  const st = STATUS_PEN_MAP[p.status] || { label: p.status || '—', dot: '#94a3b8' };
  const isOverdue = p.deadline && p.deadline < localDateISO() && !isPendenciaClosed(p.status);
  const isStale = isStalePendencia(p);
  const rawSla = slaCountdown(p, 48);
  const sla = _slaVisualFor(p, rawSla);
  const overdueVis = isOverdue ? _overdueVisualFor(p) : null;
  const onLeave = typeof isOperatorOnLeave === 'function' ? isOperatorOnLeave(p.responsible) : false;
  const onLeaveBadge = onLeave ? '<span class="tag badge-afastado">🏖️ Afastado</span>' : '';
  const reassignBtn = onLeave ? '<button class="btn btn-sm btn-secondary" onclick="event.stopPropagation();openReassignPendencia(\'' + escapeHtml(p.id) + '\')">Reatribuir</button>' : '';
  var slaHtml = sla ? '<span style="color:'+sla.color+';font-weight:600" title="'+(sla.expired?'SLA vencido':'SLA restante')+'">⏱ SLA '+sla.label+'</span>' : '';
  var overdueHtml = isOverdue ? '<span style="color:'+overdueVis.color+';font-weight:600" title="Prazo vencido">'+overdueVis.label+'</span>' : '';
  return '<div class="pen-mobile-card" style="border-left-color:' + st.dot + '" onclick="openPendenciaDetail(\'' + escapeHtml(p.id) + '\')">' +
    '<div class="pen-mobile-card-top">' +
      '<div class="pen-mobile-card-client">' +
        (c ? clientAvatar(c, 22) : '') +
        '<span>' + escapeHtml(p.clientName || '—') + '</span>' +
      '</div>' +
      statusTag(p.status) +
    '</div>' +
    '<div class="pen-mobile-card-desc" title="' + escapeHtml(getPendenciaTitulo(p)) + '"><span class="pen-display-num">' + penDisplayNumber(p) + '</span>' + escapeHtml(getPendenciaTitulo(p)) + '</div>' +
    '<div class="pen-mobile-card-meta">' +
      priorityTag(p.priority) +
      (p.responsible
        ? '<span title="Responsável">👤 ' + escapeHtml(p.responsible) + '</span>'
        : '<span style="color:var(--text-muted)" title="Sem responsável definido">○ Sem responsável</span>') +
      onLeaveBadge + reassignBtn +
      overdueHtml +
      (isStale && !isOverdue ? '<span style="color:#d97706;font-weight:600" title="Sem atualização há 7+ dias">🕓 Parada</span>' : '') +
      slaHtml +
    '</div>' +
    '<div class="pen-mobile-card-footer">' +
      (p.deadline
        ? '<span' + (isOverdue ? ' style="color:'+overdueVis.color+';font-weight:600" title="Prazo vencido"' : ' title="Prazo"') + '>📅 ' + formatDate(parseDeadline(p.deadline)) + '</span>'
        : '<span style="color:var(--text-muted)" title="Sem prazo">📅 Sem prazo</span>') +
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

function getFilteredPendencias() {
  const q    = (document.getElementById('penSearch')?.value||'').toLowerCase();
  const cid  = document.getElementById('penClient')?.value||'';
  const resp = document.getElementById('penResponsible')?.value||'';
  const st   = document.getElementById('penStatus')?.value||'';
  const pr   = document.getElementById('penPriority')?.value||'';
  var base = isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam ? getPendenciasByTeam(_selectedTeam) : getMyPendencias();
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
  renderPendencias();
  showToast('Filtro salvo!', 'success');
}

function applySavedPenFilter() {
  const name = document.getElementById('penSavedFilter')?.value;
  if (!name) return;
  const f = getSavedPenFilters().find(x => x.name === name);
  if (!f) return;
  if (f.search) document.getElementById('penSearch').value = f.search;
  if (f.client) document.getElementById('penClient').value = f.client;
  if (f.resp) document.getElementById('penResponsible').value = f.resp;
  if (f.status) document.getElementById('penStatus').value = f.status;
  if (f.priority) document.getElementById('penPriority').value = f.priority;
  renderPenView(false);
}

function deleteSavedPenFilter() {
  const name = document.getElementById('penSavedFilter')?.value;
  if (!name) return;
  const list = getSavedPenFilters().filter(f => f.name !== name);
  if (typeof setCacheKV === 'function') setCacheKV('intra_pen_saved_filters', list);
  renderPendencias();
  showToast('Filtro removido.', 'info');
}

if (typeof window !== 'undefined') window.debouncedRenderPenView = debounce(renderPenView, 300);

let _penMobileState = null;
if (typeof window !== 'undefined') window.addEventListener('resize', debounce(function() {
  const area = document.getElementById('penViewArea');
  if (!area || penView !== 'kanban') return;
  const nowMobile = isPenMobile();
  if (_penMobileState === null) _penMobileState = nowMobile;
  if (nowMobile === _penMobileState) return;
  _penMobileState = nowMobile;
  renderPenView(false);
}, 200));

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

function openPendenciaDetail(id) {
  const p = getPendenciaById(id);
  if (!p) return;
  const c = getClientById(p.clientId);
  const _worker = (typeof getCurrentWorker === 'function') ? getCurrentWorker(p) : null;
  const _ft = _penFriendlyTime(p);
  const _attCount = (typeof getAttachments === 'function') ? (getAttachments('pendencias', id) || []).length : 0;
  openModal(`${penDisplayNumber(p)} – ${escapeHtml(getPendenciaTitulo(p))}`, `
    <div class="pen-detail">
    <div class="pen-detail-actions">
      <div class="pen-status-block">
        <label class="pen-section-label" for="chgStatus">Status</label>
        <div class="pen-status-wrap">
        <select class="form-select pen-status-select" id="chgStatus" title="Status da pendência">
          ${(STATUS_PEN_MAP[p.status] ? '' : `<option value="${escapeHtml(p.status || '')}" selected disabled>${escapeHtml({ concluido: 'Concluído', fechado: 'Fechado' }[p.status] || p.status || '—')} (antigo)</option>`) + Object.entries(STATUS_PEN_MAP).map(([k,v])=>`<option value="${k}" ${p.status===k?'selected':''}>${escapeHtml(v.label)}</option>`).join('')}
        </select>
        <button class="btn btn-secondary btn-sm" onclick="changePenStatus('${escapeHtml(id)}')">Atualizar Status</button>
        </div>
      </div>
      <div class="pen-header-btns">
        <button class="btn btn-primary btn-sm pen-btn-secondary" title="Editar todos os campos" onclick="closeModal();openPendenciaForm('${escapeHtml(id)}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Editar</button>
        <button class="btn btn-secondary btn-sm pen-btn-secondary" title="Criar uma cópia desta pendência" onclick="duplicatePendencia('${escapeHtml(id)}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Duplicar</button>
        <div class="timer-row">${timerWidget(p, 'pendencia')}</div>
      </div>
    </div>
    <div class="pen-work ${_worker ? 'is-working' : 'is-free'}" title="${_worker ? _escapeHtmlFallback(_worker) + ' está trabalhando nesta pendência' : 'Ninguém trabalhando agora'}">
      <span class="pen-work-dot" aria-hidden="true"></span>
      <div class="pen-work-text">
        <span class="pen-work-label">Trabalhando agora</span>
        <span class="pen-work-value">${_worker
          ? `<strong>${_escapeHtmlFallback(_worker)}</strong> <span class="pen-work-time">${timerDisplayHTML(p)}</span>`
          : `<strong>Ninguém</strong> <span class="pen-work-hint">· Disponível</span>`}</span>
      </div>
      <div class="pen-work-side">
        <span class="pen-work-label">Tempo acumulado</span>
        <span class="pen-time" title="Tempo total exato: ${_escapeHtmlFallback(_ft.exact)}">⏱ ${_escapeHtmlFallback(_ft.friendly)}</span>
      </div>
    </div>
    <div class="pen-section-label">Propriedades</div>
    <dl class="pen-props">
      <div class="pen-prop"><dt>Cliente</dt><dd>${c?`<span class="pen-client">${clientAvatar(c,22)}<span>${escapeHtml(p.clientName)}</span></span>`:escapeHtml(p.clientName)||'—'}</dd></div>
      <div class="pen-prop"><dt>Tipo</dt><dd>${escapeHtml(p.tipo)||'—'}</dd></div>
      <div class="pen-prop"><dt>Responsável</dt><dd><span class="pen-inline-wrap">${escapeHtml(p.responsible)||'—'}<button class="pen-inline-edit" title="Alterar responsável" onclick="openReassignPendencia('${escapeHtml(id)}')">✏️</button></span></dd></div>
      <div class="pen-prop"><dt>Prioridade</dt><dd><span class="pen-inline-wrap">${priorityTag(p.priority)}<select class="pen-inline-select" title="Alterar prioridade" onchange="quickUpdatePendenciaField('${escapeHtml(id)}','priority',this.value)">${['baixa','media','alta','critica'].map(v=>`<option value="${v}" ${p.priority===v?'selected':''}>${v==='baixa'?'Baixa':v==='media'?'Média':v==='alta'?'Alta':'Crítica'}</option>`).join('')}</select></span></dd></div>
      <div class="pen-prop"><dt>Prazo</dt><dd><span class="pen-inline-wrap">${p.deadline?formatDate(parseDeadline(p.deadline)):'Sem prazo'}<input type="date" class="pen-inline-date" title="Alterar prazo" value="${escapeHtml(p.deadline||'')}" onchange="quickUpdatePendenciaField('${escapeHtml(id)}','deadline',this.value)" /></span></dd></div>
      <div class="pen-prop"><dt>Aberto em</dt><dd>${formatDate(p.createdAt)}</dd></div>
    </dl>
    <div class="ticket-info-item pen-assunto" style="margin-top:12px"><div class="ticket-info-label">Assunto</div><div class="ticket-info-value">${escapeHtml(getPendenciaAssunto(p))||'<span style="color:var(--text-muted)">Não preenchido (registro anterior à separação assunto/descrição)</span>'}</div></div>
    <div class="pen-desc-block"><div class="pen-section-label">Descrição</div><div class="pen-desc">${_penRichDesc(p.descricao)||'—'}</div></div>
    ${p.linkUtil && safeUrl(p.linkUtil) !== '#' ?`<div class="form-group"><label class="form-label">Link Útil</label><a href="${safeUrl(p.linkUtil)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" title="${escapeHtml(p.linkUtil)}">🔗 Abrir link</a></div>`:''}
    
    <hr class="divider"/>
    <div class="attachment-section pen-attachments">
      <div class="section-header pen-sec-head">
        <span class="section-title">📎 Anexos${_attCount ? ` (${_attCount})` : ''}</span>
        <label class="btn btn-secondary btn-sm" style="cursor:pointer" title="Anexar arquivo (máx 2MB)">
          + Anexar
          <input type="file" id="penFileInput" style="display:none" onchange="handleFileUpload('pendencias','${id}',this,()=>renderAttachmentList('pendencias','${id}','penAttachmentsList'))" />
        </label>
      </div>
      <div class="pen-hint">Máx 2MB por arquivo</div>
      <div class="attachment-list" id="penAttachmentsList"></div>
    </div>

    <hr class="divider"/>
    <div class="section-header pen-sec-head"><span class="section-title">Notas da Atualização</span></div>
    <div class="timeline pen-timeline" id="penTimeline">
      ${(p.notes||[]).length ? (p.notes).map(n=>`
        <div class="timeline-item">
          <div class="timeline-dot">&#x270F;&#xFE0F;</div>
          <div class="timeline-content">
            <div class="timeline-meta">👤 <strong>${escapeHtml(n.author)}</strong> · ${formatDateTime(n.createdAt)}</div>
            <div class="timeline-text pen-note-text">${_penRichNote(n.text)}</div>
          </div>
        </div>`).join('') : '<p class="text-muted">Nenhuma nota ainda.</p>'}
    </div>
    <hr class="divider"/>
    <div class="section-header pen-sec-head"><span class="section-title">☑ Checklist</span><span class="pen-count" id="penCheckCounter"></span></div>
    <div id="penChecklist"></div>
    <div class="pen-check-add">
      <input class="form-input" id="newCheckItem" placeholder="Adicionar item..." onkeydown="if(event.key==='Enter'){event.preventDefault();addCheckItem('${escapeHtml(id)}')}" />
      <button class="btn btn-sm btn-secondary" title="Adicionar item ao checklist" onclick="addCheckItem('${escapeHtml(id)}')">+ Adicionar</button>
    </div>
    <hr class="divider"/>
    <div class="form-group pen-note-compose"><label class="form-label">Nova Nota</label>
      <textarea class="form-textarea" id="newNoteText" rows="3" placeholder="O que foi feito? Decisões tomadas?"></textarea></div>
    <div class="pen-note-actions">
      <button type="button" class="btn btn-primary" onclick="submitPenNote('${escapeHtml(id)}')">&#x1F4DD; Registrar Nota</button>
    </div>
    </div>
  `);
  setTimeout(() => {
    renderAttachmentList('pendencias', id, 'penAttachmentsList');
    renderPenChecklist(id);
    var ta = document.getElementById('newNoteText');
    if (ta && !ta.dataset.clipboardBound) {
      ta.dataset.clipboardBound='1';
      ta.addEventListener('paste', function(e){
        if(!e.clipboardData || !e.clipboardData.items) return;
        var items=e.clipboardData.items;
        for(var i=0;i<items.length;i++){
          var item=items[i];
          if(item.type && item.type.startsWith('image/')){
            e.preventDefault();
            var file=item.getAsFile();
            if(!file) continue;
            if(!file.name) { try{ Object.defineProperty(file,'name',{value:'clipboard-'+Date.now()+'.png'}); }catch(_){ file.name='clipboard-'+Date.now()+'.png'; } }
            (async function(f){
              var attId='ATT-'+Date.now()+'-'+_secureRandStr(4);
              var url=null,path=null,data=null;
              try{ var up=await _uploadAttachmentToStorage('pendencias', id, attId, f); if(up){ url=up.url; path=up.path; } }catch(_){}
              if(!url){
                try{ data=await new Promise(function(res,rej){ var r=new FileReader(); r.onload=function(){res(r.result);}; r.onerror=rej; r.readAsDataURL(f); }); }catch(_){}
              }
              var result=addAttachment('pendencias', id, {id:attId, name:f.name, mimeType:f.type, size:f.size, data:data, url:url, path:path});
              if(result && result.error){ if(typeof showToast==='function') showToast(result.error,'error'); }
              else { if(typeof showToast==='function') showToast('Imagem anexada via clipboard','success'); renderAttachmentList('pendencias', id, 'penAttachmentsList'); }
            })(file);
            break;
          }
        }
      });
    }
  }, 20);
}

function changePenStatus(id) {
  const p = getPendenciaById(id);
  if (!p) return;
  const newStatus = document.getElementById('chgStatus').value;
  // Cópia destacada (ver onPenKanbanDrop): preserva a detecção de transição
  // que gera a próxima ocorrência recorrente em savePendencia.
  const next = { ...p, status: newStatus };
  // Auto-stop: concluir/cancelar/fechar com timer rodando congela o tempo
  // acumulado em vez de deixar o cronômetro fantasma acumulando.
  try {
    var _closed = (typeof isPendenciaClosed === 'function') ? isPendenciaClosed(newStatus) : ['concluido', 'resolvido', 'cancelado', 'fechado'].includes(newStatus || '');
    if (_closed && p.timerRunning) {
      var _el = 0;
      if (p.timerStartedAt) { _el = Math.max(0, Math.floor((Date.now() - new Date(p.timerStartedAt).getTime()) / 1000)); }
      next.timerTotalSeconds = (Number(p.timerTotalSeconds) || 0) + _el;
      next.timerRunning = false;
      next.timerStartedAt = null;
      next.timerOperator = null;
    }
  } catch (_) {}
  savePendencia(next);
  _optimisticPenUpsert(next); // reflete na lista na hora; o fetch reconcilia depois
  updateBadges();
  showToast('Status atualizado!', 'success');
  openPendenciaDetail(id);
  if (typeof renderPenView === 'function' && document.getElementById('penViewArea')) renderPenView(false);
  if (typeof refreshCalendar === 'function' && document.getElementById('calendarContainer')) refreshCalendar();
}

function submitPenNote(id) {
  const ta = document.getElementById('newNoteText');
  const text = (ta ? ta.value : '').trim();
  if (!text) { showToast('Escreva algo antes de registrar.', 'error'); return; }
  const ok = addPendenciaNote(id, text, getUser().name);
  if (!ok) { showToast('Não foi possível salvar a nota (pendência não encontrada). Texto mantido.', 'error'); return; }
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
      <div class="form-group"><label class="form-label">Assunto *</label>
        <input class="form-input" name="assunto" maxlength="120" placeholder="Título/resumo da pendência..." value="${escapeHtml(p.assunto||'')}" required /></div>
      <div class="form-group"><label class="form-label">Descrição da Pendência *</label>
        <textarea class="form-textarea" name="descricao" rows="4" placeholder="Descreva em detalhes o que precisa ser feito..." required>${escapeHtml(p.descricao||'')}</textarea><div id="templateSuggestion" class="template-suggestion" style="display:none"></div></div>
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
      <div class="form-row">
        <div class="form-group"><label class="form-label">Recorrência</label>
          <select class="form-select" name="recurrence">
            ${RECURRENCE_OPTIONS.map(o => `<option value="${o.value}" ${(p.recurrence||'')===o.value?'selected':''}>${escapeHtml(o.label)}</option>`).join('')}
          </select></div>
        <div class="form-group"><label class="form-label">Link Útil (opcional)</label>
          <input class="form-input" name="linkUtil" value="${escapeHtml(p.linkUtil||'')}" placeholder="https://..." /></div>
      </div>
      <div class="form-group"><label class="form-label">Tags (separadas por vírgula)</label>
        <input class="form-input" name="tags" value="${escapeHtml((p.tags||[]).join(', '))}" placeholder="Ex: urgente, firewall, vpn" /></div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn-primary"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Salvar</button>
      </div>
    </form>`);
  setTimeout(function(){
    var ta=document.querySelector('textarea[name="descricao"]');
    var sug=document.getElementById('templateSuggestion');
    if(!ta||!sug) return;
    ta.addEventListener('input', function(){
      var txt=ta.value||'';
      var tpls=typeof getProcedureTemplates==='function'?getProcedureTemplates():[];
      var best=suggestTemplateForDescription(txt, tpls);
      if(best){
        sug.style.display='block';
        sug.innerHTML="Usar modelo '"+escapeHtml(best.title)+"'? <button class=\"btn btn-sm btn-primary\" onclick=\"applyTemplateSuggestion('"+escapeHtml(best.id)+"')\">Aplicar</button>";
      } else { sug.style.display='none'; sug.innerHTML=''; }
    });
  }, 30);
}

function submitPendenciaForm(e, id) {
  e.preventDefault();
  try {
    const fd = new FormData(e.target);
    const g  = k => fd.get(k)||'';
    const assunto = g('assunto').trim();
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
      assunto, descricao, responsible: g('responsible'), status: g('status'),
      priority: g('priority'), deadline: g('deadline'),
      linkUtil: safeUrl(linkUtil) !== '#' ? linkUtil : '',
      tags: tagsRaw,
      recurrence: g('recurrence'),
    };
    const errors = validatePendencia(data);
    if (errors.length) { showToast(errors[0], 'error'); return; }
    const isNew = !id;
    savePendencia(data); // preenche data.id/data.createdAt/data.updatedAt no create
    closeModal();
    if (isNew) {
      // Criado cai na página 0: volta para ela e injeta otimista até convergir.
      _penPage = 0; _penLastSig = '';
      _optimisticPenUpsert(data, { isNew: true });
      renderPenView(true);
    } else {
      _optimisticPenUpsert(data);
      renderPenView(false);
    }
    updateBadges();
    showToast(id?'Pendência atualizada!':'Pendência criada!', 'success');
  } catch (err) { showToast('Erro ao salvar pendência: ' + err.message, 'error'); }
}

function duplicatePendencia(id) {
  const p = getPendenciaById(id);
  if (!p) return;
  const created = savePendencia({
    clientId: p.clientId,
    clientName: p.clientName,
    tipo: p.tipo,
    assunto: ((p.assunto || '').trim() || p.descricao || '') + ' (cópia)',
    descricao: p.descricao || '',
    responsible: p.responsible,
    status: 'aberto',
    priority: p.priority,
    deadline: p.deadline,
    linkUtil: p.linkUtil,
    tags: p.tags || [],
    team: p.team || 'init',
    recurrence: p.recurrence,
  });
  closeModal();
  // Cópia é um create: volta para a página 0 e injeta otimista até convergir.
  _penPage = 0; _penLastSig = '';
  if (created) _optimisticPenUpsert(created, { isNew: true });
  renderPenView(true);
  updateBadges();
  showToast('Pendência duplicada!', 'success');
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
    _optimisticPenRemove(id); // some da lista na hora (anti-ghost até o delete convergir)
    renderPenView(false);
    updateBadges();
    showUndoToast('Pendência removida.', function() {
      savePendencia(snapshot); // storage preserva o id original (links/anexos intactos)
      _clearOptimisticPenRemove(id);
      _optimisticPenUpsert(snapshot, { isNew: true }); // reaparece na hora
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
  var counter = document.getElementById('penCheckCounter');
  var done = list.filter(function (it) { return it && it.done; }).length;
  if (counter) counter.textContent = list.length ? done + '/' + list.length : '';
  if (!el) return;
  if (!list.length) {
    el.innerHTML = '<p class="text-muted pen-empty">Nenhum item no checklist.</p>';
    return;
  }
  el.innerHTML = list.map(function(item, i) {
    var isDone = !!(item && item.done);
    return '<div class="pen-check-item' + (isDone ? ' is-done' : '') + '">' +
      '<label class="pen-check-label" title="' + (isDone ? 'Marcar como pendente' : 'Marcar como concluído') + '">' +
      '<input type="checkbox" class="pen-check-box" ' + (isDone ? 'checked' : '') + ' onchange="toggleCheckItem(\'' + escapeHtml(id) + '\',' + i + ')" />' +
      '<span class="pen-check-text">' + escapeHtml(item.text) + '</span>' +
      '</label>' +
      '<button class="pen-check-remove" title="Remover item" onclick="removeCheckItem(\'' + escapeHtml(id) + '\',' + i + ')">✕</button>' +
    '</div>';
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

function openReassignPendencia(penId) {
  const pen = getPendenciaById(penId);
  if (!pen) { if (typeof showToast === 'function') showToast('Pendência não encontrada.', 'error'); return; }
  const eligible = typeof getOperators === 'function' ? getOperators().filter(o => o.active !== false && o.onLeave !== true) : [];
  if (!eligible.length) { if (typeof showToast === 'function') showToast('Nenhum operador disponível para reatribuição.', 'error'); return; }
  const current = pen.responsible || '';
  const team = typeof getCurrentTeam === 'function' ? getCurrentTeam() : null;
  let options = eligible;
  if (team && typeof isTeamAdmin === 'function' && !isTeamAdmin()) {
    const filtered = eligible.filter(o => (o.team || 'init') === team);
    if (filtered.length) options = filtered;
  }
  openModal('Reatribuir pendência', `
    <p style="font-size:13px;margin-bottom:12px">Pendência: <strong>${escapeHtml(getPendenciaTitulo(pen) || pen.id)}</strong><br>Responsável atual: <strong>${escapeHtml(current || '—')}</strong> ${typeof isOperatorOnLeave === 'function' && isOperatorOnLeave(current) ? '<span class="tag badge-afastado">🏖️ Afastado</span>' : ''}</p>
    <div class="form-group">
      <label class="form-label">Novo responsável *</label>
      <select class="form-select" id="reassignSelect">
        ${options.map(o => `<option value="${escapeHtml(o.name)}" ${o.name===current?'selected':''}>${escapeHtml(o.name)}</option>`).join('')}
      </select>
    </div>
    <div class="form-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="submitReassignPendencia('${escapeHtml(penId)}')">Salvar</button>
    </div>
  `);
}

function submitReassignPendencia(penId) {
  const pen = getPendenciaById(penId);
  if (!pen) return;
  const sel = document.getElementById('reassignSelect');
  const novo = sel ? sel.value : '';
  if (!novo) { if (typeof showToast === 'function') showToast('Selecione um operador.', 'error'); return; }
  if (novo === pen.responsible) { if (typeof showToast === 'function') showToast('Selecione um responsável diferente.', 'error'); return; }
  const old = pen.responsible;
  pen.responsible = novo;
  savePendencia(pen);
  if (typeof addLog === 'function') addLog('Reatribuiu', 'Pendência', pen.id, old + ' → ' + novo);
  closeModal();
  if (typeof showToast === 'function') showToast('Pendência reatribuída para ' + novo + '!', 'success');
  try { _optimisticPenUpsert({ ...pen }); } catch (_) {} // reflete na lista na hora
  if (typeof renderPenView === 'function' && document.getElementById('penViewArea')) renderPenView(false);
  if (typeof renderMeetingFlow === 'function' && document.getElementById('contentArea') && typeof _meetingState !== 'undefined' && _meetingState) { try { _refreshCurrentGroupPens(); renderMeetingFlow(); } catch(_) {} }
  if (typeof updateBadges === 'function') updateBadges();
}

function meetingReassignPen(penId) { return openReassignPendencia(penId); }

// ── Auto-refresh global (preserva filtros/paginação/scroll) ──
(function(){
  if(typeof window==='undefined' || typeof onDataChanged!=='function') return;
  if(window._pendAutoRefresh) return;
  window._pendAutoRefresh=true;
  onDataChanged('pendencias', function(){
    var h=(window.location.hash.replace('#','')||'dashboard');
    if(h!=='pendencias' && h!=='dashboard' && h!=='calendario') return;
    try{ preserveScrollAround(function(){
      if(document.getElementById('penViewArea') && typeof renderPenView==='function') renderPenView(false);
      // Dashboard visível: números/gráficos acompanham sem navegar e voltar.
      if(h==='dashboard' && typeof renderDashboard==='function' && document.getElementById('contentArea')) renderDashboard();
    }); }catch(_){}
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { suggestTemplateForDescription, _tokenizeWords, parseMentionedOperators, highlightMentions };
}
