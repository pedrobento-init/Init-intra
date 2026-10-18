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
        <button class="btn btn-secondary" onclick="openImportClientsModal()" title="Importar clientes de Word/CSV" style="${(typeof isCurrentAdmin === 'function' && isCurrentAdmin()) ? '' : 'display:none'}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Importar</button>
        ${(typeof isCurrentAdmin === 'function' && isCurrentAdmin()) ? `<button class="btn btn-secondary" onclick="openMilvusClientsImportModal()" title="Importar clientes do Milvus (cria o mapeamento junto)"><svg class="ui-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5M12 15V3"/></svg> Milvus</button>` : ''}
        </div>
      </div>
      <div class="client-cards-grid" id="clientGrid"></div>
    </div>`;
  showSkeleton('clientGrid', 8);
  renderClientGrid();
}

if (typeof window !== 'undefined') window.debouncedFilterClientCards = debounce(filterClientCards, 300);

function filterClientCards() {
  _clientPage = 1;
  const q = document.getElementById('clientSearch').value.toLowerCase();
  saveFilterState('clients', {search: document.getElementById('clientSearch').value, _clientPage: _clientPage});
  const all = typeof getMyClients === 'function' ? getMyClients() : getClients();
  _filteredClients = q ? all.filter(c => c.name?.toLowerCase().includes(q) || c.segment?.toLowerCase().includes(q)) : all;
  renderClientGrid();
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
    const pageClients = clients.slice(startIdx, startIdx + CLIENT_PAGE_SIZE);

    grid.innerHTML = pageClients.map(c => {
      const today = typeof localDateISO === 'function' ? localDateISO() : new Date().toISOString().slice(0,10);
      const sla = typeof getSlaStatsForClient === 'function' ? getSlaStatsForClient(_getPendenciasList(), c.id, today) : { totalAbertas: _getPendenciasList().filter(p => p.clientId === c.id && !isPendenciaClosed(p.status)).length, vencidas: 0, dentroPrazo: 0 };
      if (!sla.dentroPrazo && sla.totalAbertas) sla.dentroPrazo = sla.totalAbertas - sla.vencidas;
      const health = typeof getHealthForClient === 'function' ? getHealthForClient(_getPendenciasList(), c.id, today) : null;
      const pending = sla.totalAbertas;
      const vencidas = sla.vencidas;
      const dentro = sla.dentroPrazo;
      return `<div class="client-card" onclick="viewClient('${escapeHtml(c.id)}')">
      <div class="client-card-logo">${clientAvatar(c, 64)}</div>
      <div class="client-card-name" style="display:flex;align-items:center;gap:6px;justify-content:center">${escapeHtml(c.name)} ${health ? `<span title="${escapeHtml(health.label)} - ${plural(health.totalAbertas, 'aberta', 'abertas')}, ${plural(health.vencidas, 'vencida', 'vencidas')}, média ${health.avgHours ? health.avgHours.toFixed(1)+'h' : '—'}" class="health-dot" style="--c:${health.level === 'red' ? 'var(--st-danger)' : health.level === 'yellow' ? 'var(--st-warn)' : 'var(--st-ok)'}" role="img" aria-label="${escapeHtml(health.label)}"></span>` : ''}</div>
      <div class="client-card-seg">${escapeHtml(c.segment || '')}</div>
      <div class="client-card-footer">
        ${pending > 0 ? `<span class="tag ${vencidas?'tag-red':'tag-yellow'}" title="${pending} aberta${pending>1?'s':''} · ${vencidas} vencida${vencidas===1?'':'s'} · ${dentro} no prazo">${pending} pendência${pending>1?'s':''}${vencidas?` · ${vencidas} vencida${vencidas>1?'s':''}`:''}</span>` : `<span class="tag tag-green">Em dia</span>`}
        <div style="display:flex;gap:4px">
          <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation();openClientForm('${escapeHtml(c.id)}')">Editar</button>
          ${(typeof isCurrentAdmin === 'function' && isCurrentAdmin()) ? `<button class="btn btn-sm btn-danger" onclick="event.stopPropagation();deleteClientConfirm('${escapeHtml(c.id)}')">✕</button>` : ''}
        </div>
      </div>
    </div>`;
    }).join('') + (totalPages > 1 ? `
    <div style="grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-top:1px solid var(--ov-line)">
      <div style="font-size:12px;color:var(--ov-muted)">Mostrando ${startIdx+1}–${Math.min(startIdx+CLIENT_PAGE_SIZE, clients.length)} de ${clients.length} clientes</div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-sm btn-secondary" ${_clientPage===1?'disabled':''} onclick="_clientPage--;renderClientGrid()">← Anterior</button>
        <span style="font-size:13px;padding:4px 8px;display:flex;align-items:center">${_clientPage} / ${totalPages}</span>
        <button class="btn btn-sm btn-secondary" ${_clientPage===totalPages?'disabled':''} onclick="_clientPage++;renderClientGrid()">Próxima →</button>
      </div>
    </div>
  ` : '');
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
      ${item('Saúde', health ? escapeHtml(health.label || '—') : '—', 'is-' + tone)}
      ${item('Abertas', String(sla.totalAbertas || 0), '')}
      ${item('Vencidas', String(sla.vencidas || 0), sla.vencidas ? 'is-danger' : '')}
      ${item('Última visita', past ? escapeHtml(formatDate(past.date)) : '—', '')}
      ${item('Próxima visita', next ? escapeHtml(formatDate(next.date)) : '—', '')}
    </div>`;
  } catch (_) { return ''; }
}

function viewClient(id) {
  const c = getClientById(id);
  if (!c) return;
  openModal(c.name, `
    ${clientSummaryHtml(c)}
    <div class="cs-actions"><button type="button" class="link-btn" onclick="openClientReport('${id}')">Relatório do mês (PDF)</button></div>
    <div class="tabs" id="clientTabs">
      <div class="tab active" onclick="switchClientTab('ficha','${id}')">Ficha TI</div>
      <div class="tab" onclick="switchClientTab('procedimentos','${id}')">Procedimentos</div>
      <div class="tab" onclick="switchClientTab('pendencias','${id}')">Pendências</div>
      <div class="tab" onclick="switchClientTab('visitas','${id}')">Visitas</div>
      <div class="tab" onclick="switchClientTab('inventario','${id}')">Inventário</div>
      <div class="tab" onclick="switchClientTab('chamados','${id}')">Chamados</div>
      <div class="tab" onclick="switchClientTab('checklist','${id}')">Checklist</div>
      <div class="tab" onclick="switchClientTab('documentos','${id}')">Anexos / Docs</div>
      <div class="tab" onclick="switchClientTab('historico','${id}')">Histórico</div>
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
  document.querySelectorAll('#clientTabs .tab').forEach((t,i) => t.classList.toggle('active', ['ficha','procedimentos','pendencias','visitas','inventario','chamados','checklist','documentos','historico'][i]===tab));
  renderClientTab(tab, id);
}
