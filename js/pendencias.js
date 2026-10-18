// pendencias.js

const TIPOS = ['Projeto','Operacional / Interno','Manutenção','Suporte','Gestão','Outro'];

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

// ── Quadro Kanban · design system "Meu dia" ────────────────────────────────
// Tokens --kb-* e regras .pen-board vivem em css/styles.css (seção
// "[UI] PENDÊNCIAS · QUADRO KANBAN"); referência visual em
// referencia/pendencias-kanban.html. Cores das colunas são as do protótipo
// (Aberto=accent, Em andamento=cyan, Pausado=amber, Aguard.terceiro=violet,
// Aguard.cliente=green) — STATUS_PEN_MAP continua sendo a referência de
// rótulo/badge no resto do app.
const PEN_COL_COLOR = {
  aberto: 'var(--kb-accent)',
  em_andamento: 'var(--kb-cyan)',
  pausado: 'var(--kb-amber)',
  aguardando: 'var(--kb-violet)',
  aguardando_cliente: 'var(--kb-green)',
  resolvido: 'var(--kb-green)',
  cancelado: 'var(--kb-muted)'
};
function penColColor(statusId) { return PEN_COL_COLOR[statusId] || 'var(--kb-muted)'; }

const PEN_PRI_COLOR = {
  critica: 'var(--kb-red)',
  alta: 'var(--kb-amber)',
  media: 'var(--kb-muted)',
  baixa: 'var(--kb-green)'
};
function penPriColor(priority) { return PEN_PRI_COLOR[priority] || 'var(--kb-muted)'; }
function penPriLabel(priority) {
  if (typeof PRIORITY_MAP !== 'undefined' && PRIORITY_MAP[priority]) return PRIORITY_MAP[priority].label;
  return priority || '—';
}

// Vencida = prazo anterior a hoje e status ainda aberto (calculado, não salvo).
function penIsOverdue(p) {
  if (!p || !p.deadline) return false;
  try { if (typeof isPendenciaClosed === 'function' && isPendenciaClosed(p.status)) return false; }
  catch (_) { if (['concluido','resolvido','cancelado','fechado'].indexOf(p.status) !== -1) return false; }
  var today = (typeof localDateISO === 'function') ? localDateISO() : new Date().toISOString().slice(0, 10);
  return String(p.deadline) < today;
}

// Iniciais do cliente p/ avatar do card (mesmo formato do protótipo:
// "Galvão e Raça" → GR, "Battaglia & Vidilli" → BV — conectores curtos são
// pulados para não virar "GE"/"BV" errado).
const PEN_INITIALS_STOP = { e: 1, a: 1, o: 1, de: 1, da: 1, do: 1, das: 1, dos: 1, em: 1, no: 1, na: 1, nos: 1, nas: 1, and: 1, for: 1, of: 1 };
function penInitials(name) {
  var parts = String(name || '').replace(/&/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  var second = '';
  for (var i = 1; i < parts.length; i++) {
    if (!PEN_INITIALS_STOP[parts[i].toLowerCase()]) { second = parts[i].charAt(0); break; }
  }
  var a = parts[0].charAt(0) || '';
  var b = second || parts[0].charAt(1) || '';
  return (a + b).toUpperCase();
}

// Ícones de traço (stroke 1.8) reutilizados pelos cards/resumo.
const PEN_ICO_WARN = '<svg class="kb-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l9 16H3zM12 10v4M12 17.5v.01"/></svg>';
const PEN_ICO_CAL = '<svg class="kb-ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';
const PEN_ICO_PLAY = '<svg class="kb-ico kb-ico--fill" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z"/></svg>';
const PEN_ICO_CLK = '<svg class="kb-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
const PEN_ICO_USER = '<svg class="kb-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>';
const PEN_ICO_DOTS = '<svg class="kb-ico kb-ico--fill" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';
const PEN_ICO_REPEAT = '<svg class="kb-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/></svg>';
function penRecurrenceLabel(r) {
  var o = (typeof RECURRENCE_OPTIONS !== 'undefined' ? RECURRENCE_OPTIONS : []).find(function(x) { return x.value === r; });
  return o ? o.label : 'Recorrente';
}
const PEN_ICO_BOLT = '<svg class="kb-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 3L5 14h6l-1 7 8-11h-6z"/></svg>';

let penView = 'kanban';
let penScope = 'active';
let _filteredPens = [];

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
    <div class="search-bar pen-search-bar page-toolbar">
      <div class="search-input-wrap pt-search">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input class="form-input" id="penSearch" placeholder="Buscar..." oninput="savePenFilters();debouncedRenderPenView();_penUpdateMoreFiltersBadge()" />
      </div>
      <select class="form-select filter-select-md pt-filter pt-full" id="penClient" onchange="savePenFilters();renderPenView();_penUpdateMoreFiltersBadge()">
        <option value="">Todos os clientes</option>
        ${clients.map(c=>`<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('')}
      </select>
      <button class="btn btn-secondary pen-more-btn pt-filter" id="penMoreFiltersBtn" onclick="togglePenMoreFilters()" aria-expanded="false" aria-controls="penMoreFiltersPanel" title="Mais filtros">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="11" y1="18" x2="13" y2="18"/></svg>
        Mais filtros
        <span class="pen-more-badge" id="penMoreFiltersBadge" style="display:none"></span>
      </button>
      <button class="btn btn-secondary pen-more-btn pt-filter" id="penClearFiltersBtn" onclick="clearPenFilters()" title="Limpar todos os filtros" aria-label="Limpar filtros">
        ✕ Limpar
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
        <button class="btn btn-secondary btn-sm" onclick="saveCurrentPenFilter()" title="Salvar filtro atual" aria-label="Salvar filtro atual"><svg class="ui-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/></svg></button>
        <button class="btn btn-secondary btn-sm" onclick="deleteSavedPenFilter()" title="Remover filtro salvo">✕</button>
      </div>
    </div>
    <div class="page-action-row pen-scope-row">
      <div class="view-toggles pen-scope-tabs" role="tablist" aria-label="Escopo das pendências">
        <button role="tab" aria-selected="${penScope==='active'}" class="pen-scope-tab ${penScope==='active'?'is-active':''}" onclick="setPenScope('active')">Ativas${penScope==='active' ? '<span class="pen-scope-count" id="penScopeCount" aria-live="polite"></span>' : ''}</button>
        <button role="tab" aria-selected="${penScope==='archived'}" class="pen-scope-tab ${penScope==='archived'?'is-active':''}" onclick="setPenScope('archived')">Arquivadas${penScope==='archived' ? '<span class="pen-scope-count" id="penScopeCount" aria-live="polite"></span>' : ''}</button>
      </div>
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

// Cards de cliente: toggle com estado pressionado. Clicar filtra pelo cliente
// (card fica destacado, igual ao select "Todos os clientes"); clicar de novo limpa.
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

function _penClientById(cid) {
  try { return (typeof getClientById === 'function') ? getClientById(cid) : null; }
  catch (_) { return null; }
}

// Clientes com pendências abertas: mais vencidas, depois mais abertas, depois nome.
function _penClientSlaEntries() {
  var today = typeof localDateISO === 'function' ? localDateISO() : new Date().toISOString().slice(0,10);
  var slaMap = typeof getAllSlaStats === 'function' ? getAllSlaStats(getPendencias(), today) : {};
  return Object.entries(slaMap).filter(function(e){ return e[1].totalAbertas > 0; }).sort(function(a,b){
    if (b[1].vencidas !== a[1].vencidas) return b[1].vencidas - a[1].vencidas;
    if (b[1].totalAbertas !== a[1].totalAbertas) return b[1].totalAbertas - a[1].totalAbertas;
    var ca = _penClientById(a[0]), cb = _penClientById(b[0]);
    var na = (ca && ca.name) || a[1].clientName || '';
    var nb = (cb && cb.name) || b[1].clientName || '';
    return String(na).localeCompare(String(nb), 'pt-BR', { sensitivity:'base', numeric:true });
  });
}

function _penClientCard(entry, selClient) {
  var cid = entry[0], s = entry[1];
  var c = _penClientById(cid);
  var name = c ? c.name : (s.clientName || cid);
  var safeName = escapeHtml(name);
  var total = s.totalAbertas | 0;
  var venc = s.vencidas | 0;
  var segs = Math.min(Math.max(total, 1), 6);
  var reds = Math.min(venc, segs);
  var bars = '';
  for (var i = 0; i < segs; i++) bars += `<i class="pen-cv-seg${i < reds ? ' is-venc' : ''}"></i>`;
  var active = penClientChipState(selClient, cid);
  return `<button class="pen-cv-card${active}" aria-pressed="${active ? 'true' : 'false'}" `+
    `onclick="togglePenClientChip('${escapeHtml(cid)}')" `+
    `title="Filtrar por ${safeName}: ${total} abertas, ${venc} vencidas">`+
      `<span class="pen-cv-head">`+
        `<span class="pen-cv-badge" aria-hidden="true">${escapeHtml(penInitials(name))}</span>`+
        `<span class="pen-cv-name" title="${safeName}">${safeName}</span>`+
      `</span>`+
      `<span class="pen-cv-foot">`+
        `<span class="pen-cv-bar" aria-hidden="true">${bars}</span>`+
        // Antes: "2" solto + "2 venc." — o número sozinho não dizia o que contava.
        (venc > 0
          ? `<span class="pen-cv-venc">${venc}/${total} venc.</span>`
          : `<span class="pen-cv-ondia">${total} em dia</span>`)+
      `</span>`+
    `</button>`;
}

// Só esmaece a borda direita quando a lista realmente rola (poucos cards = sem fade).
function _penCvUpdateStrip() {
  var list = document.getElementById('penClientStrip');
  if (!list) return;
  list.classList.toggle('is-scrollable', (list.scrollWidth - list.clientWidth) > 4);
}
if (typeof window !== 'undefined' && !window._penCvStripBound) {
  window._penCvStripBound = true;
  window.addEventListener('resize', _penCvUpdateStrip);
}

function _renderPendenciaSlaSummary() {
  const el = document.getElementById('penSlaSummary');
  if (!el) return;
  const entries = _penClientSlaEntries();
  if (!entries.length) { el.innerHTML=''; return; }
  var _collapsed = el.dataset.collapsed !== '0';
  var _limit = _collapsed ? 4 : entries.length;
  var visible = entries.slice(0, _limit);
  var _selClient = document.getElementById('penClient')?.value || '';
  el.innerHTML = `<div class="pen-cv-row">`+
    `<div class="pen-cv-label"><span>Clientes</span><span>por vencidas</span></div>`+
    `<div class="pen-cv-list" id="penClientStrip" role="group" aria-label="Clientes por vencidas">`+
      visible.map(function(entry){ return _penClientCard(entry, _selClient); }).join('')+
    `</div>`+
    (entries.length>4 ? `<button class="btn btn-secondary btn-sm pen-cv-more" onclick="(function(el){el.dataset.collapsed=el.dataset.collapsed==='0'?'1':'0';_renderPendenciaSlaSummary()})(document.getElementById('penSlaSummary'))" aria-expanded="${_collapsed?'false':'true'}">${_collapsed ? 'Ver todos ('+entries.length+')' : 'Ver menos'}</button>` : '')+
  `</div>`;
  _penCvUpdateStrip();
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
