// equipamentos.js – Gestão de equipamentos (Initnet + clientes)
// Padrão: Vanilla SPA + IndexedDB offline-first (Dexie) + Supabase opcional.
// UI segue Pendências: search-bar, abas de status, tabela, modal, tags.

const EQUIP_STATUS_MAP = {
  entregue:      { label: 'Entregue',      cls: 'tag-green',  dot: '#16a34a' },
  em_manutencao: { label: 'Em manutenção', cls: 'tag-yellow', dot: '#d97706' },
  estoque:       { label: 'Estoque',       cls: 'tag-blue',   dot: '#1a56db' },
  baixado:       { label: 'Baixado',       cls: 'tag-red',    dot: '#dc2626' },
};

// Alias legado: antes o status "entregue" se chamava "em_uso". Registros
// antigos (locais ou remotos) ainda podem trazer 'em_uso' — normaliza para
// o valor atual sem perder o registro.
function normEquipStatus(status) {
  return status === 'em_uso' ? 'entregue' : (status || '');
}

const EQUIP_TIPO_OPTIONS = [
  'notebook', 'desktop', 'monitor', 'celular', 'roteador',
  'switch', 'impressora', 'servidor', 'nobreak', 'outro',
];

const EQUIP_TABS = [
  { value: '', label: 'Todos' },
  { value: 'entregue', label: 'Entregue' },
  { value: 'em_manutencao', label: 'Em manutenção' },
  { value: 'estoque', label: 'Estoque' },
  { value: 'baixado', label: 'Baixados' },
];

const EQUIP_PAGE_SIZE = (typeof UI_PAGE_SIZE !== 'undefined') ? UI_PAGE_SIZE : 30;

let _equipTab = '';
let _equipPage = 1;
let _equipFilter = { client: '', tipo: '', from: '', to: '', onlyWithOS: false };
let _filteredEquips = [];

// ── Helpers puros (testáveis) ─────────────────────────────────────────────
function getEquipStatusMeta(status) {
  const s = normEquipStatus(status);
  return EQUIP_STATUS_MAP[s] || { label: status || '—', cls: 'tag-gray', dot: '#94a3b8' };
}

// Pendência vinculada ao equipamento (novo campo `pendenciaId` + legado:
// antes o id da pendência era guardado direto em `osVinculada`).
function getEquipPendenciaId(e) {
  if (!e) return null;
  if (e.pendenciaId) return e.pendenciaId;
  const os = String(e.osVinculada || '').trim();
  if (!os) return null;
  try {
    if (typeof getPendenciaById === 'function' && getPendenciaById(os)) return os;
  } catch (_) {}
  return null;
}

function hasEquipOS(e) {
  if (!e) return false;
  if (e.osVinculada && String(e.osVinculada).trim()) return true;
  return !!getEquipPendenciaId(e);
}

function formatEquipValor(v) {
  const n = Number(v);
  if (v === '' || v == null || isNaN(n)) return '—';
  try {
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  } catch (_) {
    return 'R$ ' + String(Math.round(n));
  }
}

function calcEquipStats(list) {
  const arr = list || [];
  const byStatus = { entregue: 0, em_manutencao: 0, estoque: 0, baixado: 0 };
  let totalValor = 0;
  for (const e of arr) {
    const s = normEquipStatus(e && e.status);
    if (s && byStatus[s] !== undefined) byStatus[s]++;
    if (e && s !== 'baixado') {
      const n = Number(e.valor);
      if (!isNaN(n)) totalValor += n;
    }
  }
  return { total: arr.length, byStatus, totalValor };
}

function filterEquipamentos(list, f) {
  const o = f || {};
  const q = String(o.search || '').trim().toLowerCase();
  return (list || []).filter(e => {
    if (!e) return false;
    if (o.status && normEquipStatus(e.status) !== normEquipStatus(o.status)) return false;
    if (o.client) {
      if (o.client === '__estoque__') {
        if (e.clientId) return false;
      } else if (e.clientId !== o.client) return false;
    }
    if (o.tipo && e.tipo !== o.tipo) return false;
    if (o.onlyWithOS && !hasEquipOS(e)) return false;
    if (o.from && (e.dataAquisicao || '') < o.from) return false;
    if (o.to && (e.dataAquisicao || '') > o.to) return false;
    if (q) {
      const hay = [
        e.nome, e.numeroSerie, e.clientName, e.osVinculada, e.pendenciaId, e.tipo, e.observacoes,
      ].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function equipSummaryLine(stats) {
  const b = (stats && stats.byStatus) || {};
  return `${stats ? stats.total : 0} equipamentos · ` +
    `<b>${b.entregue || b.em_uso || 0}</b> entregues · ` +
    `<b>${b.em_manutencao || 0}</b> em manutenção · ` +
    `<b>${b.estoque || 0}</b> em estoque · ` +
    `<b>${b.baixado || 0}</b> baixados`;
}

// ── Acesso respeitando equipe ─────────────────────────────────────────────
function _equipBaseList() {
  try {
    if (typeof isTeamAdmin === 'function' && isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam) {
      return getEquipamentosByTeam(_selectedTeam);
    }
  } catch (_) {}
  try {
    if (typeof getMyEquipamentos === 'function') return getMyEquipamentos();
  } catch (_) {}
  try {
    if (typeof getEquipamentos === 'function') return getEquipamentos();
  } catch (_) {}
  return [];
}

function _equipClients() {
  try {
    if (typeof isTeamAdmin === 'function' && isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam) {
      return getClientsByTeam(_selectedTeam);
    }
  } catch (_) {}
  try {
    if (typeof getMyClients === 'function') return getMyClients();
  } catch (_) {}
  try {
    if (typeof getClients === 'function') return getClients();
  } catch (_) {}
  return [];
}

// Migra registros locais legados (idempotente, silenciosa): status
// 'em_uso' vira 'entregue'; osVinculada que era id de pendência gera o
// pendenciaId (mantendo o texto original em osVinculada).
function _migrateEquipLocalAliases() {
  let list = [];
  try {
    list = (typeof getEquipamentos === 'function') ? getEquipamentos() : [];
  } catch (_) { return; }
  if (!Array.isArray(list) || !list.length) return;
  let changed = false;
  const now = new Date().toISOString();
  for (const e of list) {
    if (!e) continue;
    // updatedAt acompanha a troca: sem o bump o remoto (antigo) venceria o
    // merge e o status legado voltaria (mesmo padrão da migração de visitas).
    if (e.status === 'em_uso') { e.status = 'entregue'; e.updatedAt = now; changed = true; }
    if (!e.pendenciaId && e.osVinculada) {
      try {
        if (typeof getPendenciaById === 'function' && getPendenciaById(String(e.osVinculada).trim())) {
          e.pendenciaId = String(e.osVinculada).trim();
          e.updatedAt = e.updatedAt || now;
          changed = true;
        }
      } catch (_) {}
    }
  }
  if (changed) {
    try {
      if (typeof dbSet !== 'undefined' && typeof DB !== 'undefined') dbSet(DB.EQUIPAMENTOS, list);
    } catch (_) {}
  }
}

// ── Render principal ──────────────────────────────────────────────────────
function renderEquipamentos() {
  if (typeof document === 'undefined') return;
  document.getElementById('pageTitle').textContent = 'Equipamentos';
  if (typeof setTopbarAction === 'function') {
    setTopbarAction('Novo Equipamento', '<svg class="topbar-action-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>');
  }
  if (typeof window !== 'undefined') window._topbarAction = () => openEquipForm();

  let saved = {};
  try { saved = loadFilterState('equipamentos', {}); } catch (_) {}
  _equipTab = normEquipStatus(saved.status || '');

  // Migração local one-shot: 'em_uso' → 'entregue' + resgata vínculo legado
  // (id de pendência guardado em osVinculada) para o campo pendenciaId.
  try { _migrateEquipLocalAliases(); } catch (_) {}
  _equipFilter = {
    client: saved.client || '',
    tipo: saved.tipo || '',
    from: saved.from || '',
    to: saved.to || '',
    onlyWithOS: saved.onlyWithOS === true,
  };

  const clients = _equipClients();
  document.getElementById('contentArea').innerHTML = `
    <div class="stats-grid" id="equipStats"></div>
    <div class="search-bar equip-search-bar">
      <div class="search-input-wrap filter-grow">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input class="form-input" id="equipSearch" placeholder="Buscar equipamento, OS ou cliente..." oninput="saveEquipFilters();debouncedRenderEquipView()" aria-label="Buscar equipamento" />
      </div>
      <select class="form-select filter-select-md" id="equipClient" onchange="saveEquipFilters();renderEquipView()" aria-label="Filtrar por cliente">
        <option value="">Todos os clientes</option>
        <option value="__estoque__">Estoque Initnet</option>
        ${clients.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('')}
      </select>
      <select class="form-select filter-select" id="equipTipo" onchange="saveEquipFilters();renderEquipView()" aria-label="Filtrar por tipo">
        <option value="">Todos os tipos</option>
        ${EQUIP_TIPO_OPTIONS.map(t => `<option value="${t}">${escapeHtml(t[0].toUpperCase() + t.slice(1))}</option>`).join('')}
      </select>
      <button class="btn btn-secondary" id="equipMoreFiltersBtn" onclick="toggleEquipMoreFilters(event)" aria-expanded="false" aria-controls="equipMoreFiltersPanel" title="Mais filtros">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="11" y1="18" x2="13" y2="18"/></svg>
        Mais filtros
        <span class="pen-more-badge" id="equipMoreFiltersBadge" style="display:none"></span>
      </button>
      <div class="pen-more-panel" id="equipMoreFiltersPanel" data-open="0" style="display:none">
        <div class="filter-date-wrap">
          <span style="font-size:12px;color:var(--text-muted);flex-shrink:0">De:</span>
          <input type="date" id="equipFrom" class="form-input filter-date" onchange="saveEquipFilters();renderEquipView();_equipUpdateMoreFiltersBadge()" />
        </div>
        <div class="filter-date-wrap">
          <span style="font-size:12px;color:var(--text-muted);flex-shrink:0">Até:</span>
          <input type="date" id="equipTo" class="form-input filter-date" onchange="saveEquipFilters();renderEquipView();_equipUpdateMoreFiltersBadge()" />
        </div>
        <label style="display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--text-secondary);white-space:nowrap">
          <input type="checkbox" id="equipOnlyOS" onchange="saveEquipFilters();renderEquipView();_equipUpdateMoreFiltersBadge()" /> Somente com OS
        </label>
      </div>
      <button class="btn btn-secondary" onclick="exportEquipamentosPlanilha()" title="Exportar planilha de acerto (OS, cliente, serviço, valor)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Planilha
      </button>
    </div>
    <div class="page-action-row pen-scope-row">
      <div class="view-toggles pen-scope-tabs" role="tablist" aria-label="Filtrar por status">
        ${EQUIP_TABS.map(t => `<button role="tab" aria-selected="${_equipTab === t.value}" class="pen-scope-tab ${_equipTab === t.value ? 'is-active' : ''}" onclick="setEquipTab('${t.value}')">${escapeHtml(t.label)}</button>`).join('')}
      </div>
      <span class="pen-scope-count" id="equipScopeCount" aria-live="polite"></span>
    </div>
    <div id="equipViewArea"></div>`;

  if (saved.search) document.getElementById('equipSearch').value = saved.search;
  if (_equipFilter.client) document.getElementById('equipClient').value = _equipFilter.client;
  if (_equipFilter.tipo) document.getElementById('equipTipo').value = _equipFilter.tipo;
  if (_equipFilter.from && document.getElementById('equipFrom')) document.getElementById('equipFrom').value = _equipFilter.from;
  if (_equipFilter.to && document.getElementById('equipTo')) document.getElementById('equipTo').value = _equipFilter.to;
  if (_equipFilter.onlyWithOS && document.getElementById('equipOnlyOS')) document.getElementById('equipOnlyOS').checked = true;
  if (typeof showSkeleton === 'function') showSkeleton('equipViewArea', 6);
  renderEquipView();
}

if (typeof window !== 'undefined' && typeof debounce === 'function' && !window.debouncedRenderEquipView) {
  window.debouncedRenderEquipView = debounce(() => renderEquipView(false), 300);
} else if (typeof window !== 'undefined' && !window.debouncedRenderEquipView) {
  window.debouncedRenderEquipView = () => renderEquipView(false);
}

function saveEquipFilters() {
  try {
    const clientEl = document.getElementById('equipClient');
    const tipoEl = document.getElementById('equipTipo');
    const fromEl = document.getElementById('equipFrom');
    const toEl = document.getElementById('equipTo');
    const osEl = document.getElementById('equipOnlyOS');
    if (clientEl) _equipFilter.client = clientEl.value || '';
    if (tipoEl) _equipFilter.tipo = tipoEl.value || '';
    if (fromEl) _equipFilter.from = fromEl.value || '';
    if (toEl) _equipFilter.to = toEl.value || '';
    if (osEl) _equipFilter.onlyWithOS = !!osEl.checked;
    saveFilterState('equipamentos', {
      search: document.getElementById('equipSearch')?.value || '',
      client: _equipFilter.client || '',
      tipo: _equipFilter.tipo || '',
      status: _equipTab || '',
      from: _equipFilter.from || '',
      to: _equipFilter.to || '',
      onlyWithOS: !!_equipFilter.onlyWithOS,
    });
  } catch (_) {}
}

function setEquipTab(status) {
  _equipTab = status || '';
  try { saveEquipFilters(); } catch (_) {}
  renderEquipView();
}

function toggleEquipMoreFilters(e) {
  if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
  const panel = document.getElementById('equipMoreFiltersPanel');
  const btn = document.getElementById('equipMoreFiltersBtn');
  if (!panel || !btn) return;
  const isOpen = panel.dataset.open === '1';
  panel.dataset.open = isOpen ? '0' : '1';
  panel.style.display = isOpen ? 'none' : 'flex';
  btn.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
}

function _equipActiveFilterCount() {
  let c = 0;
  if (_equipFilter.from) c++;
  if (_equipFilter.to) c++;
  if (_equipFilter.onlyWithOS) c++;
  return c;
}
function _equipUpdateMoreFiltersBadge() {
  const badge = document.getElementById('equipMoreFiltersBadge');
  if (!badge) return;
  const n = _equipActiveFilterCount();
  badge.textContent = n ? String(n) : '';
  badge.style.display = n ? 'inline-flex' : 'none';
}
if (typeof window !== 'undefined' && !window._equipMoreFiltersBound && typeof document !== 'undefined' && document.addEventListener) {
  window._equipMoreFiltersBound = true;
  document.addEventListener('click', function (e) {
    try {
      const panel = document.getElementById('equipMoreFiltersPanel');
      const btn = document.getElementById('equipMoreFiltersBtn');
      if (!panel || !btn || panel.dataset.open !== '1') return;
      if (panel.contains(e.target) || btn.contains(e.target)) return;
      panel.dataset.open = '0';
      panel.style.display = 'none';
      btn.setAttribute('aria-expanded', 'false');
    } catch (_) {}
  });
}

function getFilteredEquipamentos() {
  const base = _equipBaseList();
  const q = (typeof document !== 'undefined' && document.getElementById('equipSearch')?.value) || '';
  return filterEquipamentos(base, {
    search: q,
    status: _equipTab,
    client: _equipFilter.client,
    tipo: _equipFilter.tipo,
    from: _equipFilter.from,
    to: _equipFilter.to,
    onlyWithOS: _equipFilter.onlyWithOS,
  }).sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
}

function renderEquipView(resetPage) {
  const area = typeof document !== 'undefined' ? document.getElementById('equipViewArea') : null;
  if (!area) return;
  const run = () => {
    if (resetPage !== false) _equipPage = 1;
    _filteredEquips = getFilteredEquipamentos();
    renderEquipStats();
    // Re-marca aba ativa (navegação pode ter restaurado estado)
    try {
      document.querySelectorAll('.pen-scope-tabs .pen-scope-tab').forEach((btn, i) => {
        const v = EQUIP_TABS[i] ? EQUIP_TABS[i].value : '';
        const on = _equipTab === v;
        btn.classList.toggle('is-active', on);
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
      });
    } catch (_) {}
    renderEquipTable(area);
    _equipUpdateMoreFiltersBadge();
  };
  if (typeof setTimeout === 'function' && typeof window !== 'undefined') setTimeout(run, 10);
  else run();
}

function renderEquipStats() {
  const wrap = typeof document !== 'undefined' ? document.getElementById('equipStats') : null;
  if (!wrap) return;
  const stats = calcEquipStats(_equipBaseList());
  const b = stats.byStatus;
  wrap.innerHTML = `
    <div class="stat-card">
      <div class="stat-icon" style="background:#eff6ff">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1a56db" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
      </div>
      <div><div class="stat-value">${stats.total}</div><div class="stat-label">Total de equipamentos</div></div>
    </div>
    <div class="stat-card">
      <div class="stat-icon" style="background:#ecfdf5">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="16 8 10 16 7 13"/></svg>
      </div>
      <div><div class="stat-value" style="color:#16a34a">${b.entregue}</div><div class="stat-label">Entregues</div></div>
    </div>
    <div class="stat-card">
      <div class="stat-icon" style="background:#fff7ed">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
      </div>
      <div><div class="stat-value" style="color:#d97706">${b.em_manutencao}</div><div class="stat-label">Em manutenção</div></div>
    </div>
    <div class="stat-card">
      <div class="stat-icon" style="background:#fef2f2">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
      </div>
      <div><div class="stat-value" style="color:#dc2626">${b.baixado}</div><div class="stat-label">Baixados</div></div>
    </div>
    <div class="stat-card">
      <div class="stat-icon" style="background:#f5f3ff">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
      </div>
      <div><div class="stat-value" style="font-size:20px">${formatEquipValor(stats.totalValor)}</div><div class="stat-label">Valor total em ativos</div></div>
    </div>`;
  const countEl = document.getElementById('equipScopeCount');
  if (countEl) countEl.innerHTML = equipSummaryLine(stats);
}

function equipStatusTag(status) {
  const m = getEquipStatusMeta(status);
  const esc = (typeof escapeHtml === 'function') ? escapeHtml : (s => String(s == null ? '' : s));
  return `<span class="tag ${m.cls}"><span class="priority-dot" style="background:${m.dot}"></span>${esc(m.label)}</span>`;
}

function equipClientCell(e) {
  const esc = (typeof escapeHtml === 'function') ? escapeHtml : (s => String(s == null ? '' : s));
  if (!e.clientId) {
    return `<span class="client-tag"><span class="client-dot" style="background:#4aa3ff"></span>${esc(e.clientName || 'Estoque Initnet')}</span>`;
  }
  let color = '#1a56db';
  try {
    const c = (typeof getClientById === 'function') ? getClientById(e.clientId) : null;
    if (c && c.color) color = c.color;
  } catch (_) {}
  return `<span class="client-tag"><span class="client-dot" style="background:${esc(color)}"></span>${esc(e.clientName || '—')}</span>`;
}

function equipOSCell(e) {
  const esc = (typeof escapeHtml === 'function') ? escapeHtml : (s => String(s == null ? '' : s));
  const osText = e && e.osVinculada ? String(e.osVinculada).trim() : '';
  const penId = getEquipPendenciaId(e);
  if (!osText && !penId) return '<span style="color:var(--text-muted)">—</span>';
  // Com pendência vinculada, o texto da OS vira link para o card.
  if (penId) {
    let penLabel = '';
    try {
      if (typeof getPendenciaById === 'function') {
        const p = getPendenciaById(penId);
        if (p && typeof penDisplayNumber === 'function') penLabel = penDisplayNumber(p);
      }
    } catch (_) {}
    const shown = osText || penLabel || penId;
    const title = penLabel && osText && penLabel !== osText ? `Pendência ${penLabel}` : 'Abrir pendência vinculada';
    return `<a href="#" class="os-link" title="${esc(title)}" onclick="event.preventDefault();goToEquipOS('${esc(penId)}')">${esc(shown)} 🔗</a>`;
  }
  return esc(osText);
}

// Rótulo amigável da pendência vinculada (para o form/menu).
function _equipPenLabel(p) {
  let num = p.id;
  try { if (typeof penDisplayNumber === 'function') num = penDisplayNumber(p); } catch (_) {}
  const title = (p.assunto || p.descricao || '').toString().slice(0, 40);
  return `${num} · ${p.clientName || ''} · ${title}`;
}

function _equipActivePens() {
  try {
    const all = (typeof getMyPendencias === 'function' ? getMyPendencias() : (typeof getPendencias === 'function' ? getPendencias() : []));
    return all
      .filter(p => { try { return typeof isPendenciaClosed === 'function' ? !isPendenciaClosed(p.status) : true; } catch (_) { return true; } })
      .slice(0, 200);
  } catch (_) { return []; }
}

function renderEquipTable(area) {
  const wrap = area || document.getElementById('equipViewArea');
  if (!wrap) return;
  const esc = (typeof escapeHtml === 'function') ? escapeHtml : (s => String(s == null ? '' : s));
  const fmtDate = (typeof formatDate === 'function') ? formatDate : (v => String(v || '—'));
  const list = _filteredEquips || [];
  if (!list.length) {
    wrap.innerHTML = `<div class="empty-state" style="padding:40px;text-align:center">
      <p>Nenhum equipamento encontrado.</p>
      <p style="color:var(--text-muted);font-size:12.5px">Ajuste os filtros ou cadastre um novo equipamento.</p>
      <br><button class="btn btn-primary btn-sm" onclick="openEquipForm()">+ Novo Equipamento</button></div>`;
    return;
  }
  const totalPages = Math.max(1, Math.ceil(list.length / EQUIP_PAGE_SIZE));
  if (_equipPage > totalPages) _equipPage = totalPages;
  if (_equipPage < 1) _equipPage = 1;
  const startIdx = (_equipPage - 1) * EQUIP_PAGE_SIZE;
  const page = list.slice(startIdx, startIdx + EQUIP_PAGE_SIZE);
  wrap.innerHTML = `
    <div class="table-wrapper"><table aria-label="Equipamentos">
      <thead><tr>
        <th>Equipamento</th><th>OS vinculada</th><th>Cliente</th><th>Status</th>
        <th style="text-align:right">Valor</th><th>Última atualização</th><th style="width:40px"></th>
      </tr></thead>
      <tbody>
        ${page.map(e => `
          <tr>
            <td><div class="eq-name">${esc(e.nome || '—')}</div>
              <div class="eq-sub">Nº série: ${esc(e.numeroSerie || '—')}${e.tipo ? ` · ${esc(e.tipo)}` : ''}</div></td>
            <td>${equipOSCell(e)}</td>
            <td>${equipClientCell(e)}</td>
            <td>${equipStatusTag(e.status)}</td>
            <td class="value" style="text-align:right;font-weight:600">${esc(formatEquipValor(e.valor))}</td>
            <td style="white-space:nowrap">${esc(e.updatedAt ? fmtDate(e.updatedAt) : '—')}</td>
            <td class="row-menu"><button class="btn-icon" title="Ações" aria-label="Ações do equipamento" onclick="toggleEquipMenu(event,'${esc(e.id)}')">⋮</button></td>
          </tr>`).join('')}
      </tbody>
    </table></div>
    ${totalPages > 1 ? `
    <div class="vis-pager" style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;font-size:12.5px;color:var(--text-muted)">
      <div>Mostrando ${startIdx + 1}–${Math.min(startIdx + EQUIP_PAGE_SIZE, list.length)} de ${list.length}</div>
      <div style="display:flex;gap:6px;align-items:center">
        <button class="btn btn-sm btn-secondary" ${_equipPage === 1 ? 'disabled' : ''} onclick="_equipPage--;renderEquipView(false)">← Anterior</button>
        <span>${_equipPage} / ${totalPages}</span>
        <button class="btn btn-sm btn-secondary" ${_equipPage === totalPages ? 'disabled' : ''} onclick="_equipPage++;renderEquipView(false)">Próxima →</button>
      </div>
    </div>` : ''}`;
}

// ── Menu ⋮ ──────────────────────────────────────────────────────────────────
function toggleEquipMenu(e, id) {
  if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
  try { closeEquipMenu(); } catch (_) {}
  const btn = e && e.currentTarget ? e.currentTarget : null;
  const rect = btn && btn.getBoundingClientRect ? btn.getBoundingClientRect() : { bottom: 0, right: 0 };
  const menu = document.createElement('div');
  menu.id = 'equipRowMenu';
  menu.className = 'equip-row-menu';
  const q = s => String(s).replace(/'/g, "\\'");
  menu.innerHTML = `
    <button onclick="closeEquipMenu();openEquipForm('${q(id)}')">✏️ Editar</button>
    <button onclick="closeEquipMenu();openEquipLinkModal('${q(id)}')">🔗 Vincular pendência</button>
    ${(() => { try { const eq = getEquipamentoById(id); const penId = getEquipPendenciaId(eq); return penId ? `<button onclick="closeEquipMenu();goToEquipOS('${q(penId)}')">↗ Ver pendência</button>` : ''; } catch (_) { return ''; } })()}
    <button class="danger" onclick="closeEquipMenu();deleteEquipFlow('${q(id)}')">🗑️ Excluir</button>`;
  menu.style.top = (rect.bottom + window.scrollY + 4) + 'px';
  menu.style.left = Math.max(8, (rect.right + window.scrollX - 170)) + 'px';
  document.body.appendChild(menu);
  setTimeout(() => {
    document.addEventListener('click', closeEquipMenu, { once: true });
  }, 0);
}
function closeEquipMenu() {
  const m = document.getElementById('equipRowMenu');
  if (m) m.remove();
}

// ── Navegação OS → Pendências ───────────────────────────────────────────────
function goToEquipOS(osId) {
  if (!osId) return;
  try {
    if (typeof navigateTo === 'function') navigateTo('pendencias');
  } catch (_) {}
  let tries = 0;
  const tick = () => {
    tries++;
    try {
      const p = (typeof getPendenciaById === 'function') ? getPendenciaById(osId) : null;
      if (p && document.getElementById('penViewArea') && typeof openPendenciaDetail === 'function') {
        openPendenciaDetail(osId);
        return;
      }
    } catch (_) {}
    if (tries < 25) setTimeout(tick, 120);
    else if (typeof showToast === 'function') showToast('OS não encontrada (pode ter sido excluída).', 'warning');
  };
  tick();
}

// ── Menu separado: vincular/desvincular pendência ───────────────────────────
function openEquipLinkModal(id) {
  const eq = (typeof getEquipamentoById === 'function') ? getEquipamentoById(id) : null;
  if (!eq) return;
  const esc = (typeof escapeHtml === 'function') ? escapeHtml : (s => String(s == null ? '' : s));
  const pens = _equipActivePens();
  const cur = getEquipPendenciaId(eq);
  openModal('Vincular pendência', `
    <form onsubmit="submitEquipLink(event,'${esc(eq.id)}')">
      <p style="font-size:13px;color:var(--text-secondary);margin:0 0 12px">Equipamento: <strong style="color:var(--text-primary)">${esc(eq.nome || '—')}</strong>${eq.osVinculada ? ` · OS <strong style="color:var(--text-primary)">${esc(eq.osVinculada)}</strong>` : ''}</p>
      <div class="form-group"><label class="form-label" for="eqLinkPen">Pendência</label>
        <select class="form-select" id="eqLinkPen">
          <option value="">— Nenhuma (desvincular) —</option>
          ${pens.map(p => `<option value="${esc(p.id)}" ${cur === p.id ? 'selected' : ''}>${esc(_equipPenLabel(p))}</option>`).join('')}
        </select></div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn-primary">Vincular</button>
      </div>
    </form>`);
}

function submitEquipLink(e, id) {
  if (e && typeof e.preventDefault === 'function') e.preventDefault();
  const eq = (typeof getEquipamentoById === 'function') ? getEquipamentoById(id) : null;
  if (!eq) return;
  const penId = document.getElementById('eqLinkPen')?.value || null;
  try {
    if (typeof saveEquipamento === 'function') saveEquipamento({ ...eq, pendenciaId: penId });
  } catch (err) {
    if (typeof showToast === 'function') showToast('Erro ao vincular: ' + (err && err.message ? err.message : err), 'error');
    return;
  }
  if (typeof closeModal === 'function') closeModal();
  if (typeof showToast === 'function') showToast(penId ? 'Pendência vinculada!' : 'Pendência desvinculada.', 'success');
  renderEquipView(false);
}

// ── Form (modal) ────────────────────────────────────────────────────────────
function openEquipForm(id) {
  const eq = id && typeof getEquipamentoById === 'function' ? getEquipamentoById(id) : null;
  const clients = _equipClients();
  const pens = _equipActivePens();
  const esc = (typeof escapeHtml === 'function') ? escapeHtml : (s => String(s == null ? '' : s));
  const curPen = getEquipPendenciaId(eq);
  openModal(eq ? 'Editar Equipamento' : 'Novo Equipamento', `
    <form onsubmit="submitEquipForm(event,'${esc(eq?.id || '')}')">
      <div class="form-group"><label class="form-label" for="eqNome">Nome *</label>
        <input class="form-input" id="eqNome" required maxlength="120" placeholder='Ex: Notebook Dell Latitude 5420' value="${esc(eq?.nome || '')}" /></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label" for="eqSerie">Número de série</label>
          <input class="form-input" id="eqSerie" maxlength="80" value="${esc(eq?.numeroSerie || '')}" /></div>
        <div class="form-group"><label class="form-label" for="eqTipo">Tipo</label>
          <select class="form-select" id="eqTipo">
            ${EQUIP_TIPO_OPTIONS.map(t => `<option value="${t}" ${(eq?.tipo || 'outro') === t ? 'selected' : ''}>${esc(t[0].toUpperCase() + t.slice(1))}</option>`).join('')}
          </select></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label" for="eqCliente">Cliente</label>
          <select class="form-select" id="eqCliente">
            <option value="__estoque__" ${!eq?.clientId ? 'selected' : ''}>Estoque Initnet</option>
            ${clients.map(c => `<option value="${esc(c.id)}" ${eq?.clientId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select></div>
        <div class="form-group"><label class="form-label" for="eqOS">OS vinculada</label>
          <input class="form-input" id="eqOS" maxlength="60" placeholder="Ex: 010, OS-123..." value="${esc(eq?.osVinculada || '')}" /></div>
      </div>
      <div class="form-group"><label class="form-label" for="eqPendencia">Vincular pendência <span style="text-transform:none;letter-spacing:0;font-weight:400">(menu separado — opcional)</span></label>
        <select class="form-select" id="eqPendencia">
          <option value="">— Nenhuma —</option>
          ${pens.map(p => `<option value="${esc(p.id)}" ${curPen === p.id ? 'selected' : ''}>${esc(_equipPenLabel(p))}</option>`).join('')}
        </select></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label" for="eqStatus">Status *</label>
          <select class="form-select" id="eqStatus" required>
            ${Object.entries(EQUIP_STATUS_MAP).map(([k, m]) => `<option value="${k}" ${(eq?.status || 'estoque') === k ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}
          </select></div>
        <div class="form-group"><label class="form-label" for="eqValor">Valor (R$)</label>
          <input class="form-input" id="eqValor" type="number" min="0" step="0.01" value="${eq?.valor ?? ''}" placeholder="0" /></div>
      </div>
      <div class="form-group"><label class="form-label" for="eqDataAq">Data de aquisição</label>
        <input class="form-input" id="eqDataAq" type="date" value="${esc(eq?.dataAquisicao || '')}" /></div>
      <div class="form-group"><label class="form-label" for="eqObs">Observações</label>
        <textarea class="form-textarea" id="eqObs" rows="3" placeholder="Patrimônio, acessórios, estado...">${esc(eq?.observacoes || '')}</textarea></div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn-primary">${eq ? 'Salvar' : 'Cadastrar'}</button>
      </div>
    </form>`);
}

function submitEquipForm(e, id) {
  if (e && typeof e.preventDefault === 'function') e.preventDefault();
  const val = (fid) => (document.getElementById(fid)?.value || '').trim();
  const nome = val('eqNome');
  if (!nome) {
    if (typeof showToast === 'function') showToast('Informe o nome do equipamento.', 'error');
    return;
  }
  const clientSel = document.getElementById('eqCliente')?.value || '__estoque__';
  let clientName = 'Estoque Initnet';
  if (clientSel && clientSel !== '__estoque__') {
    try {
      const c = (typeof getClientById === 'function') ? getClientById(clientSel) : null;
      if (c) clientName = c.name;
    } catch (_) {}
  }
  const rawValor = document.getElementById('eqValor')?.value;
  const rawStatus = normEquipStatus(document.getElementById('eqStatus')?.value || 'estoque') || 'estoque';
  const data = {
    id: id || undefined,
    nome,
    numeroSerie: val('eqSerie'),
    tipo: document.getElementById('eqTipo')?.value || 'outro',
    clientId: clientSel === '__estoque__' ? null : (clientSel || null),
    clientName,
    osVinculada: val('eqOS') || null,
    pendenciaId: document.getElementById('eqPendencia')?.value || null,
    status: rawStatus,
    valor: (rawValor === '' || rawValor == null) ? '' : Number(rawValor),
    dataAquisicao: document.getElementById('eqDataAq')?.value || '',
    observacoes: document.getElementById('eqObs')?.value || '',
  };
  try {
    if (typeof saveEquipamento === 'function') saveEquipamento(data);
    else return;
  } catch (err) {
    if (typeof showToast === 'function') showToast('Erro ao salvar: ' + (err && err.message ? err.message : err), 'error');
    return;
  }
  if (typeof closeModal === 'function') closeModal();
  if (typeof showToast === 'function') showToast(id ? 'Equipamento atualizado!' : 'Equipamento cadastrado!', 'success');
  renderEquipView(false);
  if (typeof updateBadges === 'function') { try { updateBadges(); } catch (_) {} }
}

function deleteEquipFlow(id) {
  let eq = null;
  try { eq = (typeof getEquipamentoById === 'function') ? getEquipamentoById(id) : null; } catch (_) {}
  const name = (eq && eq.nome) || 'este equipamento';
  const doDelete = () => {
    let snapshot = null;
    try { snapshot = eq ? { ...eq } : null; } catch (_) {}
    try {
      if (typeof deleteEquipamento === 'function') deleteEquipamento(id);
    } catch (err) {
      if (typeof showToast === 'function') showToast('Erro ao excluir: ' + (err && err.message ? err.message : err), 'error');
      return;
    }
    renderEquipView(false);
    if (typeof updateBadges === 'function') { try { updateBadges(); } catch (_) {} }
    if (snapshot && typeof showUndoToast === 'function') {
      showUndoToast(`"${snapshot.nome}" excluído.`, () => {
        try {
          if (typeof saveEquipamento === 'function') saveEquipamento({ ...snapshot, id: undefined });
          // Reinsere com o mesmo id para não quebrar vínculos (undo fiel).
          const list = (typeof getEquipamentos === 'function') ? getEquipamentos() : [];
          const last = list[list.length - 1];
          if (last && snapshot.id && last.id !== snapshot.id) {
            const idx = list.findIndex(x => x.id === last.id);
            if (idx !== -1) {
              list[idx] = { ...snapshot };
              if (typeof dbSet !== 'undefined' && typeof DB !== 'undefined') dbSet(DB.EQUIPAMENTOS, list);
            }
          }
          renderEquipView(false);
        } catch (_) {}
      });
    } else if (typeof showToast === 'function') {
      showToast('Equipamento excluído.', 'success');
    }
  };
  if (typeof confirmAction === 'function') {
    confirmAction(`Excluir <strong>"${(typeof escapeHtml === 'function' ? escapeHtml(name) : name)}"</strong>? Esta ação pode ser desfeita em 5s.`, doDelete);
  } else {
    doDelete();
  }
}

// ── Planilha de acerto (layout "OS | Cliente | Serviço | Saída | Valor | Devolvido | Obs") ──
// Colunas espelham a planilha de acerto usada no dia a dia:
// - OS: texto digitado; sem texto, cai para o número da pendência vinculada.
// - Serviço: nome (+ nº de série).
// - Saída/Devolvido: controle manual na planilha (sem campo no sistema).
// - Total a Acertar: soma dos valores dos NÃO baixados (igual ao card de ativos).
function equipOSExportLabel(e) {
  const typed = (e && e.osVinculada) ? String(e.osVinculada).trim() : '';
  if (typed) return typed;
  const penId = getEquipPendenciaId(e);
  if (penId) {
    try {
      if (typeof getPendenciaById === 'function' && typeof penDisplayNumber === 'function') {
        const p = getPendenciaById(penId);
        if (p) return penDisplayNumber(p);
      }
    } catch (_) {}
    return penId;
  }
  return '';
}

function equipServicoExportLabel(e) {
  const nome = (e && e.nome) ? String(e.nome).trim() : '—';
  const serie = (e && e.numeroSerie) ? String(e.numeroSerie).trim() : '';
  return serie ? `${nome} (${serie})` : nome;
}

// Pura e testável: monta título + cabeçalho + linhas + total (valores
// numéricos; cada escritor — xlsx ou CSV — formata à sua maneira).
function buildEquipAcertoSheet(list, dateLabel) {
  const stamp = dateLabel || (typeof localDateISO === 'function' ? localDateISO() : new Date().toISOString().slice(0, 10));
  let titleDate = stamp;
  try {
    if (/^\d{4}-\d{2}-\d{2}$/.test(stamp) && typeof formatDate === 'function') titleDate = formatDate(stamp);
  } catch (_) {}
  const title = `Equipamentos — Acerto (${titleDate})`;
  const header = ['Ordem de Serviço', 'Cliente', 'Serviço a ser feito', 'Saída', 'Valor', 'Devolvido', 'Observações'];
  const arr = list || [];
  const rows = arr.map(e => ([
    equipOSExportLabel(e),
    (e && e.clientName) || '—',
    equipServicoExportLabel(e),
    '',
    Number((e && e.valor) === '' || (e && e.valor) == null ? 0 : e.valor) || 0,
    '☐',
    (e && e.observacoes) || '',
  ]));
  let total = 0;
  for (const e of arr) {
    if (normEquipStatus(e && e.status) === 'baixado') continue;
    const n = Number((e && e.valor) === '' || (e && e.valor) == null ? 0 : e.valor);
    if (!isNaN(n)) total += n;
  }
  rows.push(['', '', '', 'Total a Acertar:', total, '', '']);
  return { title, header, rows, total };
}

// ── Design da planilha (puro: só manipula o objeto ws, sem depender do XLSX) ──
const ACERTO_NCOLS = 7;
function _acertoAddr(r, c) {
  let s = '';
  let n = c;
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s + (r + 1);
}
function _acertoCell(ws, r, c) {
  const a = _acertoAddr(r, c);
  if (!ws[a]) ws[a] = { t: 's', v: '' };
  if (!ws[a].s) ws[a].s = {};
  return ws[a];
}
function _acertoBorder(color) {
  const b = { style: 'thin', color: { rgb: color } };
  return { top: b, bottom: b, left: b, right: b };
}
// meta: { dataCount } (nº de linhas de dados, sem o total).
// Layout: linha 1 título mesclado, linha 2 cabeçalho, dados, linha de total.
function applyAcertoDesign(ws, meta) {
  const n = Math.max(0, (meta && meta.dataCount) || 0);
  const TITLE = 0, HEADER = 1, FIRST = 2, LAST = FIRST + n - 1, TOTAL = FIRST + n;
  const GRID = 'D9D9D9';

  ws['!merges'] = [{ s: { r: TITLE, c: 0 }, e: { r: TITLE, c: ACERTO_NCOLS - 1 } }];
  ws['!cols'] = [{ wch: 16 }, { wch: 22 }, { wch: 50 }, { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 40 }];
  ws['!rows'] = [{ hpt: 26 }, { hpt: 20 }];
  ws['!autofilter'] = { ref: `A${HEADER + 1}:G${LAST + 1}` };
  try { ws['!views'] = [{ state: 'frozen', ySplit: HEADER + 1 }]; } catch (_) {}

  // Título
  const t = _acertoCell(ws, TITLE, 0);
  t.s.font = { name: 'Calibri', sz: 14, bold: true, color: { rgb: 'FFFFFF' } };
  t.s.fill = { patternType: 'solid', fgColor: { rgb: '1F4E79' } };
  t.s.alignment = { horizontal: 'center', vertical: 'center' };

  // Cabeçalho
  for (let c = 0; c < ACERTO_NCOLS; c++) {
    const cell = _acertoCell(ws, HEADER, c);
    cell.s.font = { name: 'Calibri', sz: 11, bold: true, color: { rgb: 'FFFFFF' } };
    cell.s.fill = { patternType: 'solid', fgColor: { rgb: '2E75B6' } };
    cell.s.alignment = { horizontal: 'center', vertical: 'center', wrapText: true };
    cell.s.border = _acertoBorder('1F4E79');
  }

  // Dados (zebrado) + total em destaque
  for (let r = FIRST; r <= TOTAL; r++) {
    const isTotal = r === TOTAL;
    for (let c = 0; c < ACERTO_NCOLS; c++) {
      const cell = _acertoCell(ws, r, c);
      cell.s.font = { name: 'Calibri', sz: 11, bold: isTotal, color: { rgb: isTotal ? '1F4E79' : '262626' } };
      cell.s.fill = { patternType: 'solid', fgColor: { rgb: isTotal ? 'FFF2CC' : ((r - FIRST) % 2 ? 'F2F2F2' : 'FFFFFF') } };
      cell.s.border = _acertoBorder(GRID);
      cell.s.alignment = { vertical: 'center' };
      if (c === 4) cell.s.alignment.horizontal = 'right';
      else if (c === 0 || c === 3 || c === 5) cell.s.alignment.horizontal = 'center';
      if (c === 2 || c === 6) cell.s.alignment.wrapText = true;
      if (c === 4 && typeof cell.v === 'number') { cell.t = 'n'; cell.z = '"R$" #,##0.00'; }
    }
  }
  return ws;
}

function exportEquipamentosPlanilha() {
  try {
    if (typeof canExport === 'function' && !canExport()) {
      if (typeof showToast === 'function') showToast('Exportação restrita a administradores/supervisores.', 'error');
      return;
    }
  } catch (_) {}
  const list = (_filteredEquips && _filteredEquips.length) ? _filteredEquips : getFilteredEquipamentos();
  if (!list.length) {
    if (typeof showToast === 'function') showToast('Nada para exportar com os filtros atuais.', 'warning');
    return;
  }
  const sheet = buildEquipAcertoSheet(list);
  const stamp = (typeof localDateISO === 'function' ? localDateISO() : new Date().toISOString().slice(0, 10));
  // .xlsx real quando o SheetJS (CDN) está carregado; senão CSV (offline).
  try {
    if (typeof XLSX !== 'undefined' && XLSX && XLSX.utils && typeof XLSX.writeFile === 'function') {
      const ws = XLSX.utils.aoa_to_sheet([[sheet.title], sheet.header, ...sheet.rows]);
      applyAcertoDesign(ws, { dataCount: sheet.rows.length - 1 });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Equipamentos');
      XLSX.writeFile(wb, `equipamentos_acerto_${stamp}.xlsx`, { cellStyles: true });
      if (typeof showToast === 'function') showToast('Planilha exportada com sucesso!', 'success');
      return;
    }
  } catch (_) { /* cai para o CSV abaixo */ }
  const fmtNum = n => (n == null || isNaN(Number(n))) ? '' : String(Number(n).toFixed(2)).replace('.', ',');
  const cell = v => String(v == null ? '' : v).replace(/;/g, ',').replace(/\r?\n/g, ' ');
  const lines = [
    cell(sheet.title),
    sheet.header.join(';'),
    ...sheet.rows.map(r => [cell(r[0]), cell(r[1]), cell(r[2]), cell(r[3]), fmtNum(r[4]), cell(r[5]), cell(r[6])].join(';')),
  ];
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `equipamentos_acerto_${stamp}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  if (typeof showToast === 'function') showToast('Planilha (CSV) exportada com sucesso!', 'success');
}

function exportEquipamentosCSV() {
  try {
    if (typeof canExport === 'function' && !canExport()) {
      if (typeof showToast === 'function') showToast('Exportação restrita a administradores/supervisores.', 'error');
      return;
    }
  } catch (_) {}
  const list = _filteredEquips && _filteredEquips.length ? _filteredEquips : getFilteredEquipamentos();
  const headers = ['Nome', 'Nº Série', 'Tipo', 'Cliente', 'OS', 'Pendência vinculada', 'Status', 'Valor', 'Aquisição', 'Atualizado em'];
  const rows = list.map(eq => [
    (eq.nome || '').replace(/;/g, ','),
    (eq.numeroSerie || '').replace(/;/g, ','),
    eq.tipo || '',
    (eq.clientName || '').replace(/;/g, ','),
    (eq.osVinculada || '').replace(/;/g, ','),
    getEquipPendenciaId(eq) || '',
    (getEquipStatusMeta(eq.status).label || eq.status || ''),
    (eq.valor === '' || eq.valor == null) ? '' : String(eq.valor).replace('.', ','),
    eq.dataAquisicao || '',
    eq.updatedAt || eq.createdAt || '',
  ]);
  if (typeof exportCSV === 'function') exportCSV('equipamentos_init_intra', headers, rows);
}

// Export para testes (Node/Vitest). Em browser, `module` não existe e as
// funções acima ficam disponíveis no escopo global dos scripts.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    EQUIP_STATUS_MAP, EQUIP_TIPO_OPTIONS, EQUIP_TABS,
    normEquipStatus, getEquipStatusMeta, getEquipPendenciaId, hasEquipOS,
    formatEquipValor, calcEquipStats, filterEquipamentos, equipSummaryLine,
    equipOSExportLabel, equipServicoExportLabel, buildEquipAcertoSheet, applyAcertoDesign,
  };
}
