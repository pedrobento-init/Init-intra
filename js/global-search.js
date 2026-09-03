// global-search.js – Sprint 7: Busca Global + Sprint 9: Status Offline/Online

// ══════════════════════════════════════════════
// SPRINT 7 – BUSCA GLOBAL
// ══════════════════════════════════════════════

let _searchActive = -1;
let _searchResults = [];

// ── Helpers puros (testáveis) ───────────────────────────────────────────────
function _snippetEscapeHtml(str) {
  if (typeof escapeHtml === 'function') return escapeHtml(str);
  if (str == null) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function getNoteSnippet(text, query, radius) {
  if (!text || !query) return null;
  radius = radius == null ? 60 : radius;
  const lowerText = String(text).toLowerCase();
  const lowerQ = String(query).toLowerCase();
  const idx = lowerText.indexOf(lowerQ);
  if (idx === -1) return null;
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + query.length + radius);
  const before = text.slice(start, idx);
  const match = text.slice(idx, idx + query.length);
  const after = text.slice(idx + query.length, end);
  let snippet = _snippetEscapeHtml(before) + '<mark>' + _snippetEscapeHtml(match) + '</mark>' + _snippetEscapeHtml(after);
  if (start > 0) snippet = '…' + snippet;
  if (end < text.length) snippet = snippet + '…';
  return snippet;
}
function parseSearchShortcuts(query) {
  const q = String(query || '');
  const regex = /(\w+):("[^"]+"|\S+)/g;
  const filters = {};
  let m;
  while ((m = regex.exec(q)) !== null) {
    const key = m[1].toLowerCase();
    let val = m[2];
    if (val.length >= 2 && val[0] === '"' && val[val.length - 1] === '"') val = val.slice(1, -1);
    filters[key] = val;
  }
  const remainingText = q.replace(regex, '').trim().replace(/\s+/g, ' ').trim();
  return { filters, remainingText };
}
function _getPendingSyncCountSafe() {
  if (typeof getPendingSyncCount === 'function') return getPendingSyncCount();
  if (typeof window !== 'undefined') return window._pendingSyncCount || window._syncPending || 0;
  return 0;
}
function _getPendingSyncText() {
  const cnt = _getPendingSyncCountSafe();
  if (cnt > 0) return cnt + ' alterações aguardando sincronizar';
  return null;
}
// Reflete o contador real no banner (o reset do sync já chama isso;
// aqui é a garantia para syncs disparados em background).
function _refreshSyncBannerSafe() {
  try {
    if (typeof _refreshSyncBanner === 'function') { _refreshSyncBanner(); return; }
  } catch (_) {}
  try {
    if (typeof _updateConnectionStatus === 'function') {
      _updateConnectionStatus(typeof navigator !== 'undefined' ? navigator.onLine : true);
    }
  } catch (_) {}
}
// Dispara o sync tolerando retorno não-Promise e sempre refresca o banner.
function _triggerBackgroundSync(logLabel) {
  try {
    if (typeof syncSupabaseToLocal !== 'function') return;
    const p = syncSupabaseToLocal();
    if (p && typeof p.then === 'function') {
      p.then(
        () => _refreshSyncBannerSafe(),
        (err) => { console.warn(logLabel, err); _refreshSyncBannerSafe(); }
      );
    } else {
      _refreshSyncBannerSafe();
    }
  } catch (err) { console.warn(logLabel, err); }
}

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

  const raw = String(query || '');
  const parsed = parseSearchShortcuts(raw);
  const filters = parsed.filters || {};
  const remainingText = parsed.remainingText || '';
  const q = remainingText.trim().toLowerCase();
  const hasFilters = Object.keys(filters).length > 0;

  if (!q && !hasFilters) {
    container.innerHTML = '<div class="search-empty">Digite para pesquisar…</div>';
    _searchResults = [];
    return;
  }

  // Collect data (respeita filtro de time)
  const clients   = (typeof getMyClients === 'function')   ? getMyClients()
                  : (typeof getClients === 'function')     ? getClients()   : [];
  const pendencias = (typeof getMyPendencias === 'function') ? getMyPendencias()
                   : (typeof getPendencias === 'function')   ? getPendencias() : [];

  const clienteFilter = filters.cliente || filters.clientes || filters.client || null;
  const statusFilter = filters.status || null;

  const matchClients = clients.filter(c => {
    if (clienteFilter) {
      const cf = String(clienteFilter).toLowerCase();
      const inName = (c.name || '').toLowerCase().includes(cf);
      const inSeg = (c.segment || '').toLowerCase().includes(cf);
      if (!inName && !inSeg) return false;
      if (!q) return true;
    } else if (!q) return false;
    if (!q) return true;
    return (c.name || '').toLowerCase().includes(q) ||
           (c.cnpj || '').toLowerCase().includes(q) ||
           (c.segment || '').toLowerCase().includes(q);
  }).slice(0, 5);

  const matchPens = pendencias.filter(p => {
    if (statusFilter && String(p.status || '').toLowerCase() !== String(statusFilter).toLowerCase()) return false;
    if (clienteFilter && !(p.clientName || '').toLowerCase().includes(String(clienteFilter).toLowerCase())) return false;
    if (!q) return true;
    const inAssunto = (p.assunto || '').toLowerCase().includes(q);
    const inDescricao = (p.descricao || '').toLowerCase().includes(q);
    const inClient = (p.clientName || '').toLowerCase().includes(q);
    const inResp = (p.responsible || '').toLowerCase().includes(q);
    const inNotes = Array.isArray(p.notes) && p.notes.some(n => String(n.text || '').toLowerCase().includes(q));
    return inAssunto || inDescricao || inClient || inResp || inNotes;
  }).slice(0, 5);

  _searchResults = [
    ...matchClients.map(c => ({ type: 'client', data: c })),
    ...matchPens.map(p => ({ type: 'pendencia', data: p }))
  ];

  if (_searchResults.length === 0) {
    const esc = typeof escapeHtml === 'function' ? escapeHtml(raw) : raw;
    let emptyHtml = `<div class="search-empty">Nenhum resultado para "<strong>${esc}</strong>"</div>`;
    if (hasFilters) {
      const badges = Object.entries(filters).map(function(entry){ const k=entry[0], v=entry[1]; const ek = typeof escapeHtml==='function'?escapeHtml(k):k; const ev=typeof escapeHtml==='function'?escapeHtml(v):v; return '<span class="tag tag-blue" style="font-size:11px">'+ek+':'+ev+'</span>'; }).join(' ');
      emptyHtml = '<div style="display:flex;gap:6px;padding:6px 18px;flex-wrap:wrap">'+badges+'</div>' + emptyHtml;
    }
    container.innerHTML = emptyHtml;
    return;
  }

  let html = '';

  if (hasFilters) {
    html += '<div style="display:flex;gap:6px;padding:6px 18px;flex-wrap:wrap">';
    Object.entries(filters).forEach(function(entry){
      const k=entry[0], v=entry[1];
      const ek = typeof escapeHtml==='function'?escapeHtml(k):k;
      const ev = typeof escapeHtml==='function'?escapeHtml(v):v;
      html += '<span class="tag tag-blue" style="font-size:11px">'+ek+':'+ev+'</span>';
    });
    html += '</div>';
  }

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
      const color = (typeof STATUS_PEN_MAP !== 'undefined' && STATUS_PEN_MAP[p.status]?.dot) || '#9ca3af';
      let preview = '';
      if (q && Array.isArray(p.notes)) {
        const hit = p.notes.find(n => String(n.text||'').toLowerCase().includes(q));
        if (hit) {
          const snippet = getNoteSnippet(hit.text, remainingText, 60);
          if (snippet) preview = '<div class="search-result-sub" style="font-size:11px;margin-top:2px;white-space:normal;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">'+snippet+'</div>';
        }
      }
      return `
      <div class="search-result-item" data-idx="${idx}" onclick="selectSearchResult(${idx})">
        <div class="search-result-icon" style="background:#fef9ee">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
        </div>
        <div style="min-width:0;flex:1">
          <div class="search-result-title">${escapeHtml(getPendenciaTitulo(p))}</div>
          <div class="search-result-sub">${escapeHtml(p.clientName || '—')} · ${escapeHtml(p.responsible || '—')}</div>
          ${preview}
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
if (typeof document !== 'undefined') document.addEventListener('keydown', (e) => {
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
if (typeof document !== 'undefined') document.addEventListener('input', (e) => {
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

  const pendingText = _getPendingSyncText();
  const pendingCount = _getPendingSyncCountSafe();

  if (!isOnline) {
    _wasOffline = true;
    banner.className = 'offline-banner offline visible';
    if (msg) msg.textContent = pendingCount > 0 ? pendingText : 'Sem conexão – modo offline ativo';
    if (syncBtn) syncBtn.style.display = 'none';
    if (dot) { dot.classList.add('offline'); dot.title = 'Offline'; }
  } else {
    if (dot) { dot.classList.remove('offline'); dot.title = 'Online'; }
    if (pendingCount > 0) {
      banner.className = 'offline-banner offline visible';
      if (msg) msg.textContent = pendingText;
      if (syncBtn) syncBtn.style.display = 'inline-block';
      if (_wasOffline) {
        _wasOffline = false;
        if (window._supabaseAuthActive) {
          _triggerBackgroundSync('Sincronização após reconexão:');
        }
      }
      return;
    }
    if (_wasOffline) {
      // Just came back online
      _wasOffline = false;
      banner.className = 'offline-banner online visible';
      if (msg) msg.textContent = '✓ Conexão restaurada';
      if (syncBtn) syncBtn.style.display = 'inline-block';
      if (window._supabaseAuthActive) {
        _triggerBackgroundSync('Sincronização após reconexão:');
      }
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
  const _raw = typeof syncSupabaseToLocal === 'function'
    ? syncSupabaseToLocal()
    : null;
  const syncFn = (_raw && typeof _raw.then === 'function') ? _raw : Promise.resolve();

  syncFn.then(() => {
    showToast('Sincronizado com sucesso!', 'success');
    _refreshSyncBannerSafe();
    if (syncBtn) {
      syncBtn.textContent = '↻ Sincronizar';
      syncBtn.disabled = false;
    }
  }).catch(() => {
    showToast('Erro ao sincronizar. Tente novamente.', 'error');
    _refreshSyncBannerSafe();
    if (syncBtn) {
      syncBtn.textContent = '↻ Sincronizar';
      syncBtn.disabled = false;
    }
  });
}

// Listen to browser online/offline events
if (typeof window !== 'undefined') {
  window.addEventListener('online',  () => _updateConnectionStatus(true));
  window.addEventListener('offline', () => _updateConnectionStatus(false));
}
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && typeof navigator !== 'undefined' && navigator.onLine && typeof window !== 'undefined' && window._supabaseAuthActive && typeof syncSupabaseToLocal === 'function') {
    _triggerBackgroundSync('Sincronização ao retornar à aba:');
  }
});

// Initial check
if (typeof window !== 'undefined') window.addEventListener('DOMContentLoaded', () => {
  _updateConnectionStatus(typeof navigator !== 'undefined' ? navigator.onLine : true);
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseSearchShortcuts, getNoteSnippet, _getPendingSyncCountSafe, _getPendingSyncText, _refreshSyncBannerSafe, _triggerBackgroundSync };
}
