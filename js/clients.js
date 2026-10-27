// clients.js
const COLORS = ['#1a56db','#3b82f6','#6366f1','#4f46e5','#0891b2','#0f766e','#16a34a','#d97706','#dc2626','#7c3aed'];

let _clientPage = 1;
let _filteredClients = [];
const CLIENT_PAGE_SIZE = (typeof UI_PAGE_SIZE !== 'undefined') ? UI_PAGE_SIZE : 30;

function _getPendenciasList(){ if(typeof getMyPendencias==='function') return getMyPendencias(); if(typeof getPendencias==='function') return getPendencias(); if(typeof globalThis!=='undefined' && typeof globalThis.getMyPendencias==='function') return globalThis.getMyPendencias(); if(typeof globalThis!=='undefined' && typeof globalThis.getPendencias==='function') return globalThis.getPendencias(); return []; }
function _getHealthForClientProxy(pens,cid,today){ if(typeof getHealthForClient==='function') return getHealthForClient(pens,cid,today); if(typeof globalThis!=='undefined' && typeof globalThis.getHealthForClient==='function') return globalThis.getHealthForClient(pens,cid,today); return null; }
function _calcAvgProxy(arr){ if(typeof calculateAvgResolutionHours==='function') return calculateAvgResolutionHours(arr); if(typeof globalThis!=='undefined' && typeof globalThis.calculateAvgResolutionHours==='function') return globalThis.calculateAvgResolutionHours(arr); return null; }
function _formatDateProxy(d){ if(typeof formatDate==='function') return formatDate(d); if(typeof globalThis!=='undefined' && typeof globalThis.formatDate==='function') return globalThis.formatDate(d); return new Date(d).toLocaleDateString('pt-BR'); }
function _localDateProxy(){ if(typeof localDateISO==='function') return localDateISO(); if(typeof globalThis!=='undefined' && typeof globalThis.localDateISO==='function') return globalThis.localDateISO(); return new Date().toISOString().slice(0,10); }
function buildClientNarrative(clientId) {
  try {
    var allPens = _getPendenciasList().filter(function(p){ return p.clientId===clientId; });
    var today = _localDateProxy();
    var total = allPens.length;
    var firstDate = null;
    if(allPens.length){
      var min = allPens.reduce(function(a,b){ return new Date(a.createdAt)<new Date(b.createdAt)?a:b; });
      firstDate = min.createdAt;
    }
    var avg = null;
    try{
      var concluidas = allPens.filter(function(p){ return ['concluido','resolvido'].includes(p.status); });
      avg = _calcAvgProxy(concluidas);
    }catch(_){}
    var health=null; try{ health=_getHealthForClientProxy(_getPendenciasList(), clientId, today); }catch(_){}
    var desde = firstDate ? _formatDateProxy(firstDate) : '—';
    var mediaText = avg!=null ? avg.toFixed(1)+'h' : 'sem média';
    var statusText = health ? health.emoji+' '+health.label : '—';
    return 'Cliente desde '+desde+' · '+total+' pendências no histórico · média '+mediaText+' · status '+statusText;
  } catch(_){ return ''; }
}

function renderClients() {
  document.getElementById('pageTitle').textContent = 'Clientes';
  const filterState = loadFilterState('clients', {});
  _clientPage = filterState._clientPage || 1;
  _clientView = filterState.view === 'cartoes' ? 'cartoes' : 'lista';
  _clientSort = filterState.sort || 'nome';
  // Criação restrita a admin (não-admin edita, mas não cadastra).
  if (typeof isCurrentAdmin === 'function' && isCurrentAdmin()) {
    setTopbarAction('Novo Cliente', '<svg class="topbar-action-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>');
    window._topbarAction = () => openClientForm();
  } else {
    const _btn = document.getElementById('topbarActionBtn');
    if (_btn) _btn.style.display = 'none';
    window._topbarAction = null;
  }

  const clients  = typeof getMyClients === 'function' ? getMyClients() : getClients();
  _filteredClients = clients;
  // [UI] Alterado para seguir padrão Dashboard: wrapper .ov-wrap + header ov-head/ov-h1
  // (apenas containers/classes visuais; IDs e handlers intactos).
  document.getElementById('contentArea').innerHTML = `
    <div class="ov-wrap">
      <div class="search-bar page-toolbar">
        <div class="search-input-wrap pt-search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input class="form-input" id="clientSearch" placeholder="Buscar cliente..." value="${filterState.search || ''}" oninput="debouncedFilterClientCards()" />
        </div>
        <div class="pt-actions">
        <div class="cl-view" role="group" aria-label="Modo de exibição">
          <button type="button" class="cl-view-btn${_clientView === 'lista' ? ' is-on' : ''}" aria-pressed="${_clientView === 'lista'}" data-action="clientView" data-arg="lista" title="Lista"><svg class="ui-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg> Lista</button>
          <button type="button" class="cl-view-btn${_clientView === 'cartoes' ? ' is-on' : ''}" aria-pressed="${_clientView === 'cartoes'}" data-action="clientView" data-arg="cartoes" title="Cartões"><svg class="ui-ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg> Cartões</button>
        </div>
        <button class="btn btn-secondary" onclick="openImportClientsModal()" title="Importar clientes de Word/CSV" style="${(typeof isCurrentAdmin === 'function' && isCurrentAdmin()) ? '' : 'display:none'}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Importar</button>
        ${(typeof isCurrentAdmin === 'function' && isCurrentAdmin()) ? `<button class="btn btn-secondary" onclick="openMilvusClientsImportModal()" title="Importar clientes do Milvus (cria o mapeamento junto)"><svg class="ui-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5M12 15V3"/></svg> Milvus</button>` : ''}
        </div>
      </div>
      <div class="${_clientView === 'lista' ? 'cl-list' : 'client-cards-grid'}" id="clientGrid"></div>
    </div>`;
  showSkeleton('clientGrid', 8);
  renderClientGrid();
}

if (typeof window !== 'undefined') window.debouncedFilterClientCards = debounce(filterClientCards, 300);

function filterClientCards() {
  _clientPage = 1;
  const q = document.getElementById('clientSearch').value.toLowerCase();
  _saveClientFilterState();
  const all = typeof getMyClients === 'function' ? getMyClients() : getClients();
  _filteredClients = q ? all.filter(c => c.name?.toLowerCase().includes(q) || c.segment?.toLowerCase().includes(q)) : all;
  renderClientGrid();
}

// Lista (padrão) ou cartões; ordenação da lista por nome, abertas ou vencidas.
var _clientView = 'lista';
var _clientSort = 'nome';
function _saveClientFilterState() {
  var el = document.getElementById('clientSearch');
  saveFilterState('clients', { search: el ? el.value : '', _clientPage: _clientPage, view: _clientView, sort: _clientSort });
}
function setClientView(view) {
  _clientView = view === 'cartoes' ? 'cartoes' : 'lista';
  _saveClientFilterState();
  var grid = document.getElementById('clientGrid');
  if (grid) grid.className = _clientView === 'lista' ? 'cl-list' : 'client-cards-grid';
  document.querySelectorAll('.cl-view-btn').forEach(function(b, i) {
    var on = (i === 0) === (_clientView === 'lista');
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-pressed', String(on));
  });
  renderClientGrid();
}
function setClientSort(key) {
  _clientSort = _clientSort === key && key !== 'nome' ? 'nome' : key;
  _clientPage = 1;
  _saveClientFilterState();
  renderClientGrid();
}
if (typeof registerActions === 'function') {
  registerActions({
    clientView: (_el, v) => setClientView(v),
    clientSort: (_el, k) => setClientSort(k),
    clientEdit: (_el, id) => openClientForm(id),
    clientDelete: (_el, id) => deleteClientConfirm(id),
    driveLink: (_el, id) => openDriveFolderPrompt(id),
    driveSave: (_el, id) => submitDriveFolderLink(id),
    driveUnlink: (_el, id) => removeDriveFolderConfirm(id),
    // Cancelar volta para a ficha: o prompt substituiu o #modalBody dela.
    driveCancel: (_el, id) => { viewClient(id); switchClientTab('documentos', id); },
  });
}
function _clientRowStats(c, pens, today) {
  var sla = typeof getSlaStatsForClient === 'function' ? getSlaStatsForClient(pens, c.id, today) : { totalAbertas: pens.filter(function(p) { return p.clientId === c.id && !isPendenciaClosed(p.status); }).length, vencidas: 0, dentroPrazo: 0 };
  var health = typeof getHealthForClient === 'function' ? getHealthForClient(pens, c.id, today) : null;
  return { abertas: sla.totalAbertas || 0, vencidas: sla.vencidas || 0, health: health };
}
function _renderClientTable(grid, pageClients, statsById) {
  var isAdmin = typeof isCurrentAdmin === 'function' && isCurrentAdmin();
  var arrow = function(k) { return _clientSort === k ? ' <span aria-hidden="true">↓</span>' : ''; };
  var sortAttr = function(k) { return _clientSort === k ? ' aria-sort="descending"' : ''; };
  var rows = pageClients.map(function(c) {
    var st = statsById[c.id];
    var h = st.health;
    var lvl = h ? (h.level === 'red' ? 'danger' : h.level === 'yellow' ? 'warn' : 'ok') : '';
    return '<tr class="cl-row" tabindex="0" data-action="openClient" data-arg="' + escapeHtml(c.id) + '">' +
      '<td><div class="cl-name">' + clientAvatar(c, 30) + '<div><div class="cl-title">' + escapeHtml(c.name) + '</div>' +
        (c.segment ? '<div class="cl-seg">' + escapeHtml(c.segment) + '</div>' : '') + '</div></div></td>' +
      '<td>' + (h ? '<span class="cl-health" style="--c:var(--st-' + lvl + ')"><i aria-hidden="true"></i>' + escapeHtml(h.label) + '</span>' : '—') + '</td>' +
      '<td class="cl-num">' + st.abertas + '</td>' +
      '<td class="cl-num' + (st.vencidas ? ' is-over' : '') + '">' + st.vencidas + '</td>' +
      '<td class="cl-acts"><button class="btn btn-sm btn-secondary" data-action="clientEdit" data-arg="' + escapeHtml(c.id) + '">Editar</button></td>' +
      (isAdmin ? '<td class="cl-del"><button type="button" class="cl-del-btn" title="Excluir cliente" aria-label="Excluir ' + escapeHtml(c.name) + '" data-action="clientDelete" data-arg="' + escapeHtml(c.id) + '"><svg class="ui-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg></button></td>' : '') +
    '</tr>';
  }).join('');
  grid.innerHTML = '<div class="table-wrapper"><table class="cl-table"><thead><tr>' +
    '<th' + sortAttr('nome') + '><button type="button" class="cl-sort" data-action="clientSort" data-arg="nome">Cliente' + arrow('nome') + '</button></th>' +
    '<th>Saúde</th>' +
    '<th class="cl-num"' + sortAttr('abertas') + '><button type="button" class="cl-sort" data-action="clientSort" data-arg="abertas">Abertas' + arrow('abertas') + '</button></th>' +
    '<th class="cl-num"' + sortAttr('vencidas') + '><button type="button" class="cl-sort" data-action="clientSort" data-arg="vencidas">Vencidas' + arrow('vencidas') + '</button></th>' +
    '<th><span class="sr-only">Editar</span></th>' + (isAdmin ? '<th><span class="sr-only">Excluir</span></th>' : '') +
    '</tr></thead><tbody>' + rows + '</tbody></table></div>';
}

function renderClientGrid() {
  const grid = document.getElementById('clientGrid');
  if (!grid) return;
  const clients = _filteredClients;
  if (!clients.length) { grid.innerHTML = `<div class="empty-state"><p>Nenhum cliente cadastrado</p>${(typeof isCurrentAdmin === 'function' && isCurrentAdmin()) ? '<button class="btn btn-primary btn-sm" onclick="openClientForm()">+ Novo Cliente</button>' : ''}</div>`; return; }

  setTimeout(() => {
    const totalPages = Math.ceil(clients.length / CLIENT_PAGE_SIZE);
    if (_clientPage > totalPages) _clientPage = totalPages;
    if (_clientPage < 1) _clientPage = 1;

    const startIdx = (_clientPage - 1) * CLIENT_PAGE_SIZE;
    const _today = typeof localDateISO === 'function' ? localDateISO() : new Date().toISOString().slice(0,10);
    const _pens = _getPendenciasList();
    const statsById = {};
    clients.forEach(c => { statsById[c.id] = _clientRowStats(c, _pens, _today); });
    const sorted = clients.slice().sort((a, b) => {
      if (_clientSort === 'abertas' || _clientSort === 'vencidas') {
        const d = statsById[b.id][_clientSort] - statsById[a.id][_clientSort];
        if (d) return d;
      }
      return String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR');
    });
    const pageClients = sorted.slice(startIdx, startIdx + CLIENT_PAGE_SIZE);
    const _pager = totalPages > 1 ? `
    <div style="grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-top:1px solid var(--ov-line)">
      <div style="font-size:12px;color:var(--ov-muted)">Mostrando ${startIdx+1}–${Math.min(startIdx+CLIENT_PAGE_SIZE, clients.length)} de ${clients.length} clientes</div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-sm btn-secondary" ${_clientPage===1?'disabled':''} onclick="_clientPage--;renderClientGrid()">← Anterior</button>
        <span style="font-size:13px;padding:4px 8px;display:flex;align-items:center">${_clientPage} / ${totalPages}</span>
        <button class="btn btn-sm btn-secondary" ${_clientPage===totalPages?'disabled':''} onclick="_clientPage++;renderClientGrid()">Próxima →</button>
      </div>
    </div>
  ` : '';
    if (_clientView === 'lista') {
      _renderClientTable(grid, pageClients, statsById);
      if (_pager) grid.insertAdjacentHTML('beforeend', _pager);
      return;
    }

    grid.innerHTML = pageClients.map(c => {
      const today = typeof localDateISO === 'function' ? localDateISO() : new Date().toISOString().slice(0,10);
      const sla = typeof getSlaStatsForClient === 'function' ? getSlaStatsForClient(_getPendenciasList(), c.id, today) : { totalAbertas: _getPendenciasList().filter(p => p.clientId === c.id && !isPendenciaClosed(p.status)).length, vencidas: 0, dentroPrazo: 0 };
      if (!sla.dentroPrazo && sla.totalAbertas) sla.dentroPrazo = sla.totalAbertas - sla.vencidas;
      const health = typeof getHealthForClient === 'function' ? getHealthForClient(_getPendenciasList(), c.id, today) : null;
      const pending = sla.totalAbertas;
      const vencidas = sla.vencidas;
      const dentro = sla.dentroPrazo;
      return `<div class="client-card" role="button" tabindex="0" onclick="viewClient('${escapeHtml(c.id)}')">
      <div class="client-card-logo">${clientAvatar(c, 64)}</div>
      <div class="client-card-name" style="display:flex;align-items:center;gap:6px;justify-content:center">${escapeHtml(c.name)} ${health ? `<span title="${health.motivos && health.motivos.length ? escapeHtml(health.label + ' (' + health.nota + '/100): ' + health.motivos.join('; ')) : `${escapeHtml(health.label)} - ${plural(health.totalAbertas, 'aberta', 'abertas')}, ${plural(health.vencidas, 'vencida', 'vencidas')}, média ${health.avgHours ? health.avgHours.toFixed(1)+'h' : '—'}`}" class="health-dot" style="--c:${health.level === 'red' ? 'var(--st-danger)' : health.level === 'yellow' ? 'var(--st-warn)' : 'var(--st-ok)'}" role="img" aria-label="${escapeHtml(health.label)}"></span>` : ''}</div>
      <div class="client-card-seg">${escapeHtml(c.segment || '')}</div>
      <div class="client-card-footer">
        ${pending > 0 ? `<span class="tag ${vencidas?'tag-red':'tag-yellow'}" title="${pending} aberta${pending>1?'s':''} · ${vencidas} vencida${vencidas===1?'':'s'} · ${dentro} no prazo">${pending} pendência${pending>1?'s':''}${vencidas?` · ${vencidas} vencida${vencidas>1?'s':''}`:''}</span>` : `<span class="tag tag-green">Em dia</span>`}
        <div style="display:flex;gap:4px">
          <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation();openClientForm('${escapeHtml(c.id)}')">Editar</button>
          ${(typeof isCurrentAdmin === 'function' && isCurrentAdmin()) ? `<button class="btn btn-sm btn-danger" onclick="event.stopPropagation();deleteClientConfirm('${escapeHtml(c.id)}')">✕</button>` : ''}
        </div>
      </div>
    </div>`;
    }).join('') + _pager;
  }, 10);
}

// Resumo no topo do cliente: o essencial antes das 9 abas (saúde, pendências
// abertas/vencidas, última e próxima visita).
function clientSummaryHtml(c) {
  try {
    const today = typeof localDateISO === 'function' ? localDateISO() : new Date().toISOString().slice(0, 10);
    const pens = _getPendenciasList();
    const sla = typeof getSlaStatsForClient === 'function'
      ? getSlaStatsForClient(pens, c.id, today)
      : { totalAbertas: pens.filter(p => p.clientId === c.id && !isPendenciaClosed(p.status)).length, vencidas: 0 };
    const health = typeof getHealthForClient === 'function' ? getHealthForClient(pens, c.id, today) : null;
    const visits = (typeof getVisits === 'function' ? getVisits() : []).filter(v => v.clientId === c.id);
    const past = visits.filter(v => v.date && v.date <= today && v.status !== 'cancelada').sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    const next = visits.filter(v => v.date && v.date > today && v.status === 'agendada').sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];
    const tone = !health ? 'ok' : health.level === 'red' ? 'danger' : health.level === 'yellow' ? 'warn' : 'ok';
    const item = (label, value, cls) => `<div class="cs-item${cls ? ' ' + cls : ''}"><span>${label}</span><b>${value}</b></div>`;
    return `<div class="client-summary">
      ${item('Saúde', health ? escapeHtml((health.label || '—') + (health.nota != null ? ' · ' + health.nota : '')) : '—', 'is-' + tone)}
      ${item('Abertas', String(sla.totalAbertas || 0), '')}
      ${item('Vencidas', String(sla.vencidas || 0), sla.vencidas ? 'is-danger' : '')}
      ${item('Última visita', past ? escapeHtml(formatDate(past.date)) : '—', '')}
      ${item('Próxima visita', next ? escapeHtml(formatDate(next.date)) : '—', '')}
    </div>${typeof saudeMotivosHtml === 'function' ? saudeMotivosHtml(health) : ''}`;
  } catch (_) { return ''; }
}

function viewClient(id) {
  const c = getClientById(id);
  if (!c) return;
  openModal(c.name, `
    ${clientSummaryHtml(c)}
    <div class="cs-actions"><button type="button" class="link-btn" onclick="openClientReport('${id}')">Relatório do mês (PDF)</button></div>
    <div class="tabs" id="clientTabs" role="tablist" aria-label="Seções do cliente">
      <button type="button" role="tab" aria-selected="true" class="tab active" onclick="switchClientTab('ficha','${id}')">Ficha TI</button>
      <button type="button" role="tab" aria-selected="false" class="tab" onclick="switchClientTab('procedimentos','${id}')">Procedimentos</button>
      <button type="button" role="tab" aria-selected="false" class="tab" onclick="switchClientTab('pendencias','${id}')">Pendências</button>
      <button type="button" role="tab" aria-selected="false" class="tab" onclick="switchClientTab('visitas','${id}')">Visitas</button>
      <button type="button" role="tab" aria-selected="false" class="tab" onclick="switchClientTab('inventario','${id}')">Inventário</button>
      <button type="button" role="tab" aria-selected="false" class="tab" data-client-tab="backups" data-client-id="${escapeHtml(id)}">Backups</button>
      <button type="button" role="tab" aria-selected="false" class="tab" onclick="switchClientTab('chamados','${id}')">Chamados</button>
      <button type="button" role="tab" aria-selected="false" class="tab" onclick="switchClientTab('checklist','${id}')">Checklist</button>
      <button type="button" role="tab" aria-selected="false" class="tab" onclick="switchClientTab('documentos','${id}')">Anexos / Docs</button>
      <button type="button" role="tab" aria-selected="false" class="tab" onclick="switchClientTab('historico','${id}')">Histórico</button>
    </div>
    <div id="clientTabContent"></div>`, 'lg');
  // Cabeçalho: nome + "Atualizada em DD/MM/AAAA por <usuário>" (updated_at/updated_by).
  try {
    const _t = document.getElementById('modalTitle');
    const _sub = cfUpdatedMeta(c);
    if (_t) _t.innerHTML = `<span class="cf-title-main">${escapeHtml(c.name)}</span>${_sub ? `<span class="cf-title-sub">${_sub}</span>` : ''}`;
  } catch (_) {}
  renderClientTab('ficha', id);
}

function switchClientTab(tab, id) {
  document.querySelectorAll('#clientTabs .tab').forEach((t,i) => { const on = ['ficha','procedimentos','pendencias','visitas','inventario','backups','chamados','checklist','documentos','historico'][i]===tab; t.classList.toggle('active', on); t.setAttribute('aria-selected', on ? 'true' : 'false'); });
  renderClientTab(tab, id);
}
