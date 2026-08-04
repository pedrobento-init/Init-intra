// global-search.js – Sprint 7: Busca Global + Sprint 9: Status Offline/Online

// ══════════════════════════════════════════════
// SPRINT 7 – BUSCA GLOBAL
// ══════════════════════════════════════════════

let _searchActive = -1;
let _searchResults = [];

function openGlobalSearch() {
  const modal = document.getElementById('globalSearchModal');
  if (!modal) return;
  modal.style.display = 'flex';
  const input = document.getElementById('globalSearchInput');
  if (input) {
    input.value = '';
    input.focus();
    _renderSearchResults('');
  }
  _searchActive = -1;
}

function closeGlobalSearch(e) {
  if (e && e.target !== document.getElementById('globalSearchModal')) return;
  const modal = document.getElementById('globalSearchModal');
  if (modal) modal.style.display = 'none';
  _searchActive = -1;
  _searchResults = [];
}

function _renderSearchResults(query) {
  const container = document.getElementById('searchResultsContainer');
  if (!container) return;

  const q = query.trim().toLowerCase();

  if (!q) {
    container.innerHTML = '<div class="search-empty">Digite para pesquisar…</div>';
    _searchResults = [];
    return;
  }

  // Collect data (respeita filtro de time)
  const clients   = (typeof getMyClients === 'function')   ? getMyClients()
                  : (typeof getClients === 'function')     ? getClients()   : [];
  const pendencias = (typeof getMyPendencias === 'function') ? getMyPendencias()
                   : (typeof getPendencias === 'function')   ? getPendencias() : [];

  const matchClients = clients.filter(c =>
    (c.name || '').toLowerCase().includes(q) ||
    (c.cnpj || '').toLowerCase().includes(q) ||
    (c.segment || '').toLowerCase().includes(q)
  ).slice(0, 5);

  const matchPens = pendencias.filter(p =>
    (p.descricao || '').toLowerCase().includes(q) ||
    (p.clientName || '').toLowerCase().includes(q) ||
    (p.responsible || '').toLowerCase().includes(q)
  ).slice(0, 5);

  _searchResults = [
    ...matchClients.map(c => ({ type: 'client', data: c })),
    ...matchPens.map(p => ({ type: 'pendencia', data: p }))
  ];

  if (_searchResults.length === 0) {
    container.innerHTML = `<div class="search-empty">Nenhum resultado para "<strong>${escapeHtml(query)}</strong>"</div>`;
    return;
  }

  let html = '';

  if (matchClients.length) {
    html += `<div class="search-group-label">Clientes</div>`;
    html += matchClients.map((c, i) => `
      <div class="search-result-item" data-idx="${i}" onclick="selectSearchResult(${i})">
        <div class="search-result-icon" style="background:#eff6ff">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#1a56db" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
        </div>
        <div style="min-width:0;flex:1">
          <div class="search-result-title">${escapeHtml(c.name)}</div>
          <div class="search-result-sub">${escapeHtml(c.segment || '—')} · ${escapeHtml(c.cnpj || '—')}</div>
        </div>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </div>`).join('');
  }

  const clientOffset = matchClients.length;
  if (matchPens.length) {
    html += `<div class="search-group-label">Pendências</div>`;
    html += matchPens.map((p, i) => {
      const idx = clientOffset + i;
      const statusColors = { aberto: '#1a56db', em_andamento: '#6366f1', pausado: '#f59e0b', concluido: '#16a34a', cancelado: '#9ca3af', aguardando: '#7c3aed' };
      const color = statusColors[p.status] || '#9ca3af';
      return `
      <div class="search-result-item" data-idx="${idx}" onclick="selectSearchResult(${idx})">
        <div class="search-result-icon" style="background:#fef9ee">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
        </div>
        <div style="min-width:0;flex:1">
          <div class="search-result-title">${escapeHtml(p.descricao || '(sem descrição)')}</div>
          <div class="search-result-sub">${escapeHtml(p.clientName || '—')} · ${escapeHtml(p.responsible || '—')}</div>
        </div>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </div>`;
    }).join('');
  }

  container.innerHTML = html;
}

function selectSearchResult(idx) {
  const result = _searchResults[idx];
  if (!result) return;

  const modal = document.getElementById('globalSearchModal');
  if (modal) modal.style.display = 'none';

  switch (result.type) {
    case 'client':
      navigateTo('clientes');
      setTimeout(() => {
        if (typeof viewClient === 'function') viewClient(result.data.id);
      }, 120);
      break;
    case 'pendencia':
      navigateTo('pendencias');
      setTimeout(() => {
        if (typeof openPendenciaDetail === 'function') openPendenciaDetail(result.data.id);
      }, 120);
      break;
  }
}

function _highlightSearchItem(idx) {
  const items = document.querySelectorAll('.search-result-item');
  items.forEach(el => el.classList.remove('active'));
  if (idx >= 0 && idx < items.length) {
    items[idx].classList.add('active');
    items[idx].scrollIntoView({ block: 'nearest' });
  }
}

// Keyboard navigation
document.addEventListener('keydown', (e) => {
  // Ctrl+K or Cmd+K to open search
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    const modal = document.getElementById('globalSearchModal');
    if (modal && modal.style.display === 'none') {
      openGlobalSearch();
    } else {
      closeGlobalSearch({ target: modal });
    }
    return;
  }

  const modal = document.getElementById('globalSearchModal');
  if (!modal || modal.style.display === 'none') return;

  if (e.key === 'Escape') {
    closeGlobalSearch({ target: modal });
    return;
  }

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    _searchActive = Math.min(_searchActive + 1, _searchResults.length - 1);
    _highlightSearchItem(_searchActive);
    return;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    _searchActive = Math.max(_searchActive - 1, 0);
    _highlightSearchItem(_searchActive);
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    if (_searchActive >= 0) selectSearchResult(_searchActive);
    return;
  }
});

// Live search input
document.addEventListener('input', (e) => {
  if (e.target && e.target.id === 'globalSearchInput') {
    _searchActive = -1;
    _renderSearchResults(e.target.value);
  }
});

// ══════════════════════════════════════════════
// SPRINT 9 – STATUS OFFLINE / ONLINE
// ══════════════════════════════════════════════

let _wasOffline = false;
let _onlineTimeout = null;

function _updateConnectionStatus(isOnline) {
  const banner  = document.getElementById('offlineBanner');
  const dot     = document.getElementById('connStatusDot');
  const msg     = document.getElementById('offlineBannerMsg');
  const syncBtn = document.getElementById('syncNowBtn');

  if (!banner) return;

  if (!isOnline) {
    _wasOffline = true;
    banner.className = 'offline-banner offline visible';
    if (msg) msg.textContent = 'Sem conexão – modo offline ativo';
    if (syncBtn) syncBtn.style.display = 'none';
    if (dot) { dot.classList.add('offline'); dot.title = 'Offline'; }
  } else {
    if (dot) { dot.classList.remove('offline'); dot.title = 'Online'; }
    if (_wasOffline) {
      // Just came back online
      _wasOffline = false;
      banner.className = 'offline-banner online visible';
      if (msg) msg.textContent = '✓ Conexão restaurada';
      if (syncBtn) syncBtn.style.display = 'inline-block';
      // Auto-hide after 5s
      clearTimeout(_onlineTimeout);
      _onlineTimeout = setTimeout(() => {
        banner.classList.remove('visible');
      }, 5000);
    } else {
      banner.classList.remove('visible');
    }
  }
}

function syncNow() {
  const syncBtn = document.getElementById('syncNowBtn');
  if (syncBtn) {
    syncBtn.textContent = '⏳ Sincronizando…';
    syncBtn.disabled = true;
  }
  // Trigger Supabase sync if available
  const syncFn = typeof syncSupabaseToLocal === 'function'
    ? syncSupabaseToLocal()
    : Promise.resolve();

  syncFn.then(() => {
    showToast('Sincronizado com sucesso!', 'success');
    const banner = document.getElementById('offlineBanner');
    if (banner) banner.classList.remove('visible');
  }).catch(() => {
    showToast('Erro ao sincronizar. Tente novamente.', 'error');
    if (syncBtn) {
      syncBtn.textContent = '↻ Sincronizar';
      syncBtn.disabled = false;
    }
  });
}

// Listen to browser online/offline events
window.addEventListener('online',  () => _updateConnectionStatus(true));
window.addEventListener('offline', () => _updateConnectionStatus(false));

// Initial check
window.addEventListener('DOMContentLoaded', () => {
  _updateConnectionStatus(navigator.onLine);
});
