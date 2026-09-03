// ui.js – Componentes reutilizáveis

const _loadedScripts = new Set();
function loadScript(url) {
  if (_loadedScripts.has(url)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.crossOrigin = 'anonymous';
    s.onload = () => { _loadedScripts.add(url); resolve(); };
    s.onerror = () => reject(new Error('Falha ao carregar: ' + url));
    document.head.appendChild(s);
  });
}

async function loadChartJs() {
  if (typeof Chart !== 'undefined') return;
  await loadScript('https://cdn.jsdelivr.net/npm/chart.js');
}

async function loadFullCalendar() {
  if (typeof FullCalendar !== 'undefined') return;
  await loadScript('https://cdn.jsdelivr.net/npm/fullcalendar@6.1.17/index.global.min.js');
}

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

function showLoading(containerId, message = 'Carregando...') {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = `
    <div class="loading-spinner">
      <div class="spinner"></div>
      <p>${escapeHtml(message)}</p>
    </div>`;
}

function hideLoading(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const spinner = container.querySelector('.loading-spinner');
  if (spinner) spinner.remove();
}

function showSkeleton(containerId, rows = 5) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const rowHtml = Array.from({ length: rows }, () =>
    `<div class="skeleton-row">
      <div class="skeleton skeleton-avatar"></div>
      <div style="flex:1">
        <div class="skeleton skeleton-text"></div>
        <div class="skeleton skeleton-text short"></div>
      </div>
      <div class="skeleton skeleton-badge"></div>
    </div>`
  ).join('');
  container.innerHTML = `<div style="padding:16px">${rowHtml}</div>`;
}

/**
 * Escapa caracteres especiais HTML para prevenir XSS.
 * Use sempre que inserir dados do usuário via innerHTML.
 */
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Valida URLs para uso em href, bloqueando javascript: e afins.
 * Retorna '#' caso a URL seja inválida ou ausente.
 */
function safeUrl(url) {
  if (!url) return '#';
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'javascript:' || parsed.protocol === 'data:' || parsed.protocol === 'vbscript:') {
      return '#';
    }
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:') {
      return trimmed;
    }
    return '#';
  } catch {
    return '#';
  }
}

let _prevFocus = null;
let _modalTrapHandler = null;
let _modalHideTimer = null;

function openModal(title, bodyHTML, size = '') {
  if (_modalHideTimer) { clearTimeout(_modalHideTimer); _modalHideTimer = null; }
  _prevFocus = document.activeElement;
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = bodyHTML;
  document.getElementById('modal').className = 'modal' + (size ? ' ' + size : '');
  const overlay = document.getElementById('modalOverlay');
  const modal = document.getElementById('modal');
  overlay.style.display = 'flex';
  const focusable = modal.querySelectorAll('button, [href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])');
  if (focusable.length) focusable[0].focus();
  _modalTrapHandler = function(e) {
    if (e.key !== 'Tab') return;
    const els = modal.querySelectorAll('button, [href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!els.length) return;
    const first = els[0], last = els[els.length - 1];
    if (e.shiftKey) { if (document.activeElement === first) { e.preventDefault(); last.focus(); } }
    else { if (document.activeElement === last) { e.preventDefault(); first.focus(); } }
  };
  modal.addEventListener('keydown', _modalTrapHandler);

  if (typeof Motion !== 'undefined') {
    overlay.style.animation = 'none';
    modal.style.animation = 'none';
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    Motion.animate(overlay, { opacity: [0, 1] }, { duration: 0.18, ease: 'easeOut' });
    Motion.animate(modal, isMobile
      ? { opacity: [0, 1], y: [28, 0] }
      : { opacity: [0, 1], scale: [0.96, 1], y: [16, 0] },
      { duration: 0.4, ease: [0.34, 1.56, 0.64, 1] });
  }
}
function closeModal() {
  const modal = document.getElementById('modal');
  const overlay = document.getElementById('modalOverlay');
  if (_modalTrapHandler) { modal.removeEventListener('keydown', _modalTrapHandler); _modalTrapHandler = null; }
  const hide = () => { overlay.style.display = 'none'; };
  if (typeof Motion !== 'undefined' && overlay.style.display !== 'none') {
    Motion.animate(modal, { opacity: [1, 0], scale: [1, 0.98], y: [0, 8] }, { duration: 0.14, ease: 'easeIn' });
    Motion.animate(overlay, { opacity: [1, 0] }, { duration: 0.14, ease: 'easeIn' });
    _modalHideTimer = setTimeout(() => { hide(); _modalHideTimer = null; }, 150);
  } else {
    hide();
  }
  if (_prevFocus && _prevFocus.focus) { _prevFocus.focus(); _prevFocus = null; }
}

function showToast(message, type = 'info') {
  const c = document.getElementById('toastContainer');
  while (c.children.length >= 5) c.firstChild.remove();
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  const iconMap = {
    success: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="16 8 10 16 7 13"/></svg>',
    error: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1a56db" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  };
  const iconSpan = document.createElement('span');
  iconSpan.innerHTML = iconMap[type] || iconMap.info;
  const msgSpan = document.createElement('span');
  msgSpan.textContent = message;
  t.appendChild(iconSpan);
  t.appendChild(msgSpan);
  c.appendChild(t);
  if (typeof Motion !== 'undefined') {
    t.style.animation = 'none';
    Motion.animate(t, { opacity: [0, 1], x: [24, 0] }, { duration: 0.35, ease: 'easeOut' });
  }
  setTimeout(() => {
    if (typeof Motion !== 'undefined') {
      Motion.animate(t, { opacity: [1, 0], x: [0, -24] }, { duration: 0.22, ease: 'easeIn' });
      setTimeout(() => t.remove(), 230);
    } else {
      t.classList.add('removing');
      setTimeout(() => t.remove(), 300);
    }
  }, 3500);
}

function showUndoToast(message, onUndo) {
  const c = document.getElementById('toastContainer');
  while (c.children.length >= 5) c.firstChild.remove();
  const t = document.createElement('div');
  t.className = 'toast info';
  t.style.display = 'flex';
  t.style.alignItems = 'center';
  t.style.gap = '8px';
  t.innerHTML = `<span>${escapeHtml(message)}</span><button class="btn btn-sm btn-secondary" style="margin-left:auto;flex-shrink:0">Desfazer</button>`;
  c.appendChild(t);
  let undone = false;
  const timer = setTimeout(() => { if (!undone) { t.classList.add('removing'); setTimeout(() => t.remove(), 300); } }, 5000);
  t.querySelector('button').onclick = () => { undone = true; clearTimeout(timer); t.remove(); onUndo(); };
}

function saveFilterState(pageKey, state) {
  localStorage.setItem('intra_filter_' + pageKey, JSON.stringify(state));
}
function loadFilterState(pageKey, defaults) {
  try {
    var raw = localStorage.getItem('intra_filter_' + pageKey);
    return raw ? JSON.parse(raw) : (defaults || {});
  } catch (e) { return defaults || {}; }
}

function confirmAction(message, onConfirm) {
  const prevTitle = document.getElementById('modalTitle').textContent;
  const prevBody  = document.getElementById('modalBody').innerHTML;
  const prevClass = document.getElementById('modal').className;
  const wasOpen   = document.getElementById('modalOverlay').style.display !== 'none';

  openModal('Confirmar', `
    <p style="margin-bottom:20px;color:var(--text-secondary)">${message}</p>
    <div class="form-actions">
      <button class="btn btn-secondary" id="confirmCancelBtn">Cancelar</button>
      <button class="btn btn-danger" id="confirmBtn">Confirmar</button>
    </div>`, 'sm');

  document.getElementById('confirmBtn').onclick = () => { closeModal(); onConfirm(); };

  const cancelBtn = document.getElementById('confirmCancelBtn');
  if (wasOpen && cancelBtn) {
    cancelBtn.onclick = () => {
      // Restore previous modal content without hiding overlay
      document.getElementById('modalTitle').textContent = prevTitle;
      document.getElementById('modalBody').innerHTML = prevBody;
      document.getElementById('modal').className = prevClass;
      // Refresh focus trap for restored content
      const modal = document.getElementById('modal');
      if (_modalTrapHandler) { modal.removeEventListener('keydown', _modalTrapHandler); _modalTrapHandler = null; }
      const focusable = modal.querySelectorAll('button, [href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])');
      if (focusable.length) focusable[0].focus();
      _modalTrapHandler = function(e) {
        if (e.key !== 'Tab') return;
        const els = modal.querySelectorAll('button, [href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!els.length) return;
        const first = els[0], last = els[els.length - 1];
        if (e.shiftKey) { if (document.activeElement === first) { e.preventDefault(); last.focus(); } }
        else { if (document.activeElement === last) { e.preventDefault(); first.focus(); } }
      };
      modal.addEventListener('keydown', _modalTrapHandler);
    };
  } else if (cancelBtn) {
    cancelBtn.onclick = () => closeModal();
  }
}

const APP_TIME_ZONE = 'America/Sao_Paulo';
function localDateISO(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIME_ZONE, year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(date);
  const values = {};
  parts.forEach(p => { values[p.type] = p.value; });
  return `${values.year}-${values.month}-${values.day}`;
}
function parseDateOnly(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12) : new Date(value);
}
function formatDate(iso) {
  if (!iso) return '—';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(iso)) ? parseDateOnly(iso) : new Date(iso);
  return date.toLocaleDateString('pt-BR', { timeZone: APP_TIME_ZONE });
}
function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { timeZone: APP_TIME_ZONE, day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
}
function parseDeadline(deadlineStr) {
  if (!deadlineStr) return null;
  return parseDateOnly(deadlineStr);
}

const RECURRENCE_OPTIONS = [
  { value: '', label: 'Não se repete' },
  { value: 'weekly', label: 'Semanal' },
  { value: 'biweekly', label: 'Quinzenal' },
  { value: 'monthly', label: 'Mensal' },
];

function nextRecurrenceDate(baseISO, recurrence) {
  if (!recurrence) return null;
  const base = baseISO ? parseDateOnly(baseISO) : new Date();
  const d = new Date(base.getTime());
  if (recurrence === 'weekly') d.setDate(d.getDate() + 7);
  else if (recurrence === 'biweekly') d.setDate(d.getDate() + 14);
  else if (recurrence === 'monthly') d.setMonth(d.getMonth() + 1);
  else return null;
  return localDateISO(d);
}
function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => showToast('Copiado!', 'success'));
}

const PRIORITY_MAP = {
  baixa:   { label: 'Baixa',   cls: 'tag-green',  dot: '#16a34a' },
  media:   { label: 'Média',   cls: 'tag-yellow', dot: '#d97706' },
  alta:    { label: 'Alta',    cls: 'tag-red',    dot: '#dc2626' },
  critica: { label: 'Crítica', cls: 'tag-red',    dot: '#dc2626' },
};
const STATUS_PEN_MAP = {
  aberto:             { label: 'Aberto',         cls: 'tag-blue',   dot: '#3b82f6' },
  em_andamento:       { label: 'Em Andamento',   cls: 'tag-indigo', dot: '#6366f1' },
  pausado:            { label: 'Pausado',        cls: 'tag-yellow', dot: '#f59e0b' },
  aguardando:         { label: 'Aguardando',     cls: 'tag-purple', dot: '#7c3aed' },
  aguardando_cliente: { label: 'Aguard. Cliente', cls: 'tag-purple', dot: '#7c3aed' },
  concluido:          { label: 'Concluído',      cls: 'tag-green',  dot: '#16a34a' },
  resolvido:          { label: 'Resolvido',      cls: 'tag-green',  dot: '#16a34a' },
  cancelado:          { label: 'Cancelado',      cls: 'tag-gray',   dot: '#94a3b8' },
  fechado:            { label: 'Fechado',        cls: 'tag-gray',   dot: '#94a3b8' },
};

const PEN_CLOSED_STATUSES = ['concluido', 'resolvido', 'cancelado', 'fechado'];
function isPendenciaClosed(status) { return PEN_CLOSED_STATUSES.includes(status || ''); }

// ── ASSUNTO x DESCRIÇÃO da pendência ─────────────────────────────────────────
// `assunto`: título/resumo curto (obrigatório em novas pendências).
// `descricao`: detalhamento completo (obrigatório em novas pendências).
// Registros antigos podem ter `assunto` vazio — o título cai para `descricao`
// (somente leitura/fallback, sem alterar os dados salvos).
function getPendenciaAssunto(p) { return String((p && p.assunto) || '').trim(); }
function getPendenciaTitulo(p) {
  const a = getPendenciaAssunto(p);
  if (a) return a;
  const d = String((p && p.descricao) || '').trim();
  return d || 'Sem descrição';
}

function isStalePendencia(p, days = 7) {
  if (!p || isPendenciaClosed(p.status)) return false;
  const ref = p.updatedAt || p.createdAt;
  if (!ref) return false;
  return ((Date.now() - new Date(ref).getTime()) / 86400000) >= days;
}

function priorityTag(p) {
  const m = PRIORITY_MAP[p] || { label: p, cls: 'tag-gray', dot: '#94a3b8' };
  return `<span class="tag ${m.cls}"><span class="priority-dot" style="background:${m.dot}"></span>${m.label}</span>`;
}
function statusTag(s) {
  const m = STATUS_PEN_MAP[s] || { label: s, cls: 'tag-gray', dot: '#94a3b8' };
  return `<span class="tag ${m.cls}"><span class="priority-dot" style="background:${m.dot}"></span>${m.label}</span>`;
}

function slaCountdown(item, defaultHours) {
  if (!item || !item.createdAt) return null;
  // Regra de negócio: chamado resolvido/fechado nunca está vencido.
  // O status final tem prioridade sobre o SLA/prazo — não gera alerta vermelho.
  try {
    if (typeof isPendenciaClosed === 'function' ? isPendenciaClosed(item.status) : ['concluido', 'resolvido', 'cancelado', 'fechado'].includes(item.status || '')) return null;
  } catch (_) {
    if (['concluido', 'resolvido', 'cancelado', 'fechado'].includes((item && item.status) || '')) return null;
  }
  var created = new Date(item.createdAt).getTime();
  var slaMs = (defaultHours || 24) * 60 * 60 * 1000;
  var deadline = created + slaMs;
  var remaining = deadline - Date.now();
  var total = slaMs;
  var pct = Math.max(0, Math.min(100, (remaining / total) * 100));
  var hoursLeft = Math.max(0, remaining / (1000 * 60 * 60));
  var label = remaining > 0
    ? (hoursLeft >= 1 ? Math.round(hoursLeft) + 'h' : Math.round(remaining / 60000) + 'm')
    : 'Vencido';
  var color = pct > 50 ? 'var(--green)' : pct > 10 ? 'var(--yellow)' : 'var(--red)';
  return { pct: pct, hoursLeft: hoursLeft, label: label, color: color, expired: remaining <= 0 };
}
// Supports logoShape: 'circle' (default) or 'square'
function _safeLogoUrl(url) {
  if (!url) return '#';
  if (/^https?:\/\//i.test(url)) return url;
  if (/^data:image\/(?!svg\+xml)[a-z+-]+;/i.test(url)) return url;
  return '#';
}

function clientAvatar(c, size = 40) {
  const shape = c.logoShape || 'circle';
  const shapeClass = shape === 'square' ? 'client-logo-square' : 'client-logo-circle';
  if (c.logo) {
    return `<img src="${_safeLogoUrl(c.logo)}" class="${shapeClass}" style="width:${size}px;height:${size}px" alt="${escapeHtml(c.name||'')}" />`;
  }
  const borderRadius = shape === 'square' ? '6px' : '50%';
  return `<div style="width:${size}px;height:${size}px;border-radius:${borderRadius};background:${c.color||'#1a56db'};display:flex;align-items:center;justify-content:center;font-size:${Math.round(size*0.35)}px;font-weight:700;color:#fff;flex-shrink:0">${escapeHtml(c.initials||c.name?.substring(0,2).toUpperCase()||'?')}</div>`;
}

// Sidebar toggle + auto-colapso responsivo (desktop/notebook/split-screen)
// - Manual: botão « alterna e salva a preferência (intra_sidebar_collapsed).
// - Automático: ≤1400px colapsa para só-ícones (cobre notebook 1366 e
//   split-screen), salvo se o usuário já escolheu manualmente
//   (a preferência manual sempre vence). 1920+ fica expandido.
// - Mobile (≤768px, off-canvas) não é afetado.
const SIDEBAR_AUTO_BREAKPOINT = 1400;
const SIDEBAR_PREF_KEY = 'intra_sidebar_collapsed';
const _sidebarToggleBtn = document.getElementById('sidebarToggle');

function _getSidebarPref() {
  try {
    if (typeof getCacheKV === 'function') return getCacheKV(SIDEBAR_PREF_KEY, null);
  } catch (_) {}
  return null;
}
function _setSidebarPref(collapsed) {
  try {
    if (typeof setCacheKV === 'function') setCacheKV(SIDEBAR_PREF_KEY, collapsed === true);
  } catch (_) {}
}
function setSidebarCollapsed(collapsed, save) {
  const sidebar = document.getElementById('sidebar');
  const main = document.getElementById('mainContent');
  if (sidebar) sidebar.classList.toggle('collapsed', collapsed === true);
  if (main) main.classList.toggle('expanded', collapsed === true);
  if (_sidebarToggleBtn) _sidebarToggleBtn.title = collapsed ? 'Expandir menu' : 'Recolher menu';
  if (save) _setSidebarPref(collapsed);
}
function _autoSidebarForWidth() {
  try {
    if (window.innerWidth <= 768) return; // mobile off-canvas intacto
    if (_getSidebarPref() !== null) return; // preferência manual vence
    setSidebarCollapsed(window.innerWidth <= SIDEBAR_AUTO_BREAKPOINT, false);
  } catch (_) {}
}
if (_sidebarToggleBtn) {
  _sidebarToggleBtn.addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    setSidebarCollapsed(!(sidebar && sidebar.classList.contains('collapsed')), true);
  });
}
// Padrão pelo breakpoint já no carregamento; preferência salva (IndexedDB)
// é aplicada assim que o banco fica pronto.
_autoSidebarForWidth();
if (typeof window !== 'undefined' && window.matchMedia) {
  try {
    const _sbMedia = window.matchMedia('(max-width: ' + SIDEBAR_AUTO_BREAKPOINT + 'px)');
    if (typeof _sbMedia.addEventListener === 'function') {
      _sbMedia.addEventListener('change', _autoSidebarForWidth);
    } else if (typeof _sbMedia.addListener === 'function') {
      _sbMedia.addListener(_autoSidebarForWidth);
    }
  } catch (_) {}
}
if (typeof _initDBPromise !== 'undefined' && _initDBPromise && typeof _initDBPromise.then === 'function') {
  _initDBPromise.then(() => {
    try {
      const pref = _getSidebarPref();
      if (pref !== null && window.innerWidth > 768) setSidebarCollapsed(pref, false);
    } catch (_) {}
  }).catch(() => {});
}

// Sidebar Mobile (Hamburger & Overlay)
const mobileMenuBtn = document.getElementById('mobileMenuBtn');
const sidebarOverlay = document.getElementById('sidebarOverlay');
const sidebar = document.getElementById('sidebar');

if (mobileMenuBtn && sidebarOverlay && sidebar) {
  const openMobileMenu = () => {
    sidebar.classList.add('mobile-open');
    sidebarOverlay.style.display = 'block';
    document.body.style.overflow = 'hidden';
    setTimeout(() => sidebarOverlay.classList.add('active'), 10);
  };

  const closeMobileMenu = () => {
    sidebar.classList.remove('mobile-open');
    sidebarOverlay.classList.remove('active');
    document.body.style.overflow = '';
    setTimeout(() => {
      if (!sidebar.classList.contains('mobile-open')) {
        sidebarOverlay.style.display = 'none';
      }
    }, 300);
  };

  window.closeMobileMenu = closeMobileMenu;

  mobileMenuBtn.addEventListener('click', () => {
    if (sidebar.classList.contains('mobile-open')) closeMobileMenu();
    else openMobileMenu();
  });
  sidebarOverlay.addEventListener('click', closeMobileMenu);

  sidebar.querySelectorAll('.sidebar-nav a, .btn-logout, .current-user, .btn-export').forEach(item => {
    item.addEventListener('click', () => {
      if (window.innerWidth <= 768) closeMobileMenu();
    });
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 768 && sidebar.classList.contains('mobile-open')) {
      closeMobileMenu();
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && sidebar.classList.contains('mobile-open')) {
      closeMobileMenu();
    }
  });
}

// Modal close on overlay click
document.getElementById('modalOverlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modalOverlay')) closeModal();
});

// Esc fecha modais
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (document.getElementById('modalOverlay').style.display !== 'none') closeModal();
  if (document.getElementById('userModalOverlay').style.display !== 'none')
    document.getElementById('userModalOverlay').style.display = 'none';
  if (document.getElementById('cropModalOverlay').style.display !== 'none' &&
      typeof closeCropModal === 'function') closeCropModal();
});

// User modal
document.getElementById('userQuickBtn').addEventListener('click', () => {
  const session = getSession();
  if (session) {
    openOperadorForm(session.opId);
  } else {
    const u = getUser();
    document.getElementById('userNameInput').value = u.name;
    document.getElementById('userInitialsInput').value = u.initials || '';
    document.getElementById('userModalOverlay').style.display = 'flex';
  }
});
document.getElementById('userModalOverlay').addEventListener('click', e => {
  if (e.target === document.getElementById('userModalOverlay'))
    document.getElementById('userModalOverlay').style.display = 'none';
});

function saveUserConfig() {
  const name     = document.getElementById('userNameInput').value.trim() || 'Suporte TI';
  const initials = document.getElementById('userInitialsInput').value.trim().toUpperCase() || name.substring(0,2).toUpperCase();
  saveUser({ name, initials });
  updateUserUI();
  document.getElementById('userModalOverlay').style.display = 'none';
  showToast('Perfil atualizado!', 'success');
}

function updateUserUI() {
  // Prefer session data (logged-in operator) over stored generic user
  const session = getSession();
  const u = session || getUser();
  document.getElementById('user-name-display').textContent = u.name || 'Suporte TI';
  const initials = u.initials || (u.name ? u.name.substring(0,2).toUpperCase() : 'TI');
  const avatar   = document.getElementById('user-avatar');
  avatar.textContent = initials;
  if (u.color) avatar.style.background = u.color;
  const roleEl = document.getElementById('user-role-display');
  if (roleEl) roleEl.textContent = u.role || 'Técnico';
}

function renderLogs() {
  if (typeof isCurrentAdmin === 'function' && !isCurrentAdmin()) {
    showToast('Apenas administradores podem ver o histórico.', 'error');
    if (typeof navigateTo === 'function') navigateTo('pendencias');
    return;
  }
  document.getElementById('pageTitle').textContent = 'Histórico de Atividades';
  const btn = document.getElementById('topbarActionBtn');
  if (btn) btn.style.display = 'none';

  const content = document.getElementById('contentArea');
  const ops = typeof getOperators === 'function' ? getOperators() : [];
  
  const toolbarHtml = `
    <div class="log-toolbar search-bar">
      <input type="text" id="logSearch" placeholder="Buscar no histórico..." class="form-input filter-grow">
      <select id="logTypeFilter" class="form-select filter-select-sm">
        <option value="">Todos os tipos</option>
        <option value="Cliente">Cliente</option>
        <option value="Pendência">Pendência</option>
        <option value="Procedimento">Procedimento</option>
        <option value="Operador">Operador</option>
        <option value="Sessão">Sessão</option>
        <option value="Backup">Backup</option>
      </select>
      <select id="logOpFilter" class="form-select filter-select-lg">
        <option value="">Todos os operadores</option>
        ${ops.map(o => `<option value="${escapeHtml(o.name)}">${escapeHtml(o.name)}</option>`).join('')}
      </select>
      <div class="filter-date-wrap">
        <span style="font-size:12px;color:var(--text-muted);flex-shrink:0">De:</span>
        <input type="date" id="logDateFrom" class="form-input filter-date" />
      </div>
      <div class="filter-date-wrap">
        <span style="font-size:12px;color:var(--text-muted);flex-shrink:0">Até:</span>
        <input type="date" id="logDateTo" class="form-input filter-date" />
      </div>
      <button class="btn btn-secondary btn-sm" onclick="exportLogsCSV()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        CSV Logs
      </button>
      ${isCurrentAdmin() ? '<button class="btn btn-danger btn-sm" onclick="clearLogs()">Limpar Histórico</button>' : ''}
    </div>
    <div id="logsContainer"></div>
  `;
  content.innerHTML = toolbarHtml;

  function renderList() {
    const term = document.getElementById('logSearch').value.toLowerCase();
    const type = document.getElementById('logTypeFilter').value;
    const op = document.getElementById('logOpFilter').value;
    const dateFrom = document.getElementById('logDateFrom').value;
    const dateTo = document.getElementById('logDateTo').value;
    let logs = typeof getLogs === 'function' ? getLogs() : [];
    
    if (term) {
      logs = logs.filter(l => 
        (l.action && l.action.toLowerCase().includes(term)) ||
        (l.type && l.type.toLowerCase().includes(term)) ||
        (l.details && l.details.toLowerCase().includes(term)) ||
        (l.operatorName && l.operatorName.toLowerCase().includes(term))
      );
    }
    if (type) logs = logs.filter(l => l.type === type);
    if (op) logs = logs.filter(l => l.operatorName === op);
    if (dateFrom) {
      logs = logs.filter(l => l.timestamp && l.timestamp.slice(0, 10) >= dateFrom);
    }
    if (dateTo) {
      logs = logs.filter(l => l.timestamp && l.timestamp.slice(0, 10) <= dateTo);
    }

    const container = document.getElementById('logsContainer');
    if (!logs.length) {
      container.innerHTML = '<div class="empty-state" style="padding:40px"><p>Nenhum registro encontrado.</p></div>';
      return;
    }

    const html = `
      <div class="log-timeline">
          ${logs.map(log => {
            const actionKey = (log.action || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-');
            const actionClass = ['criou','ativou','editou','excluiu','desativou','login','backup','limpou'].includes(actionKey.split('-')[0])
              ? 'log-action-' + actionKey.split('-')[0]
              : 'log-action-default';

            return `
              <div class="log-card">
                <div class="log-dot ${actionClass}" style="background:currentColor"></div>
                <div class="log-header">
                  <span class="log-action-label">${escapeHtml(log.action)}</span>
                  <span class="log-type-badge ${actionClass}">${escapeHtml(log.type)}</span>
                  <span style="flex:1"></span>
                  <span class="log-meta">${formatDateTime(log.timestamp)}</span>
                </div>
                <div class="log-details">${escapeHtml(log.details)}</div>
                <div class="log-meta">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                  ${escapeHtml(log.operatorName || 'Sistema')}
                </div>
              </div>
            `;
          }).join('')}
      </div>
    `;
    container.innerHTML = html;
  }

  document.getElementById('logSearch').addEventListener('input', renderList);
  document.getElementById('logTypeFilter').addEventListener('change', renderList);
  document.getElementById('logOpFilter').addEventListener('change', renderList);
  document.getElementById('logDateFrom').addEventListener('change', renderList);
  document.getElementById('logDateTo').addEventListener('change', renderList);
  
  renderList();
}

function clearLogs() {
  if (typeof isCurrentAdmin === 'function' && !isCurrentAdmin()) {
    showToast('Apenas administradores podem limpar o histórico.', 'error');
    return;
  }
  confirmAction('Tem certeza que deseja apagar todo o histórico de atividades? Esta ação não pode ser desfeita.', async () => {
    if (typeof setCacheTable === 'function') setCacheTable('audit_logs', []);
    else if (typeof dbSet === 'function') dbSet(DB.LOGS, []);
    if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
      try {
        const { error } = await supabaseClient.from('audit_logs').delete().gte('timestamp', '1970-01-01');
        if (error) console.warn('⚠️ Falha ao limpar logs remotos:', error.message);
      } catch (e) {
        console.warn('⚠️ Rede ao limpar logs:', e.message);
      }
    }
    if (typeof addLog === 'function') {
      addLog('Limpou Histórico', 'Histórico', 'Geral', 'Histórico limpo por admin');
    }
    renderLogs();
    showToast('Histórico limpo com sucesso!', 'success');
  });
}

function initTheme() {
  const theme = localStorage.getItem('intra_theme');
  const btn = document.getElementById('themeToggleBtn');
  
  if (theme === 'dark') {
    document.body.classList.add('dark-theme');
    if (btn) {
      btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>';
    }
  } else {
    document.body.classList.remove('dark-theme');
    if (btn) {
      btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
    }
  }
}

function toggleTheme() {
  const isDark = document.body.classList.toggle('dark-theme');
  localStorage.setItem('intra_theme', isDark ? 'dark' : 'light');
  
  const btn = document.getElementById('themeToggleBtn');
  if (btn) {
    if (isDark) {
      btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>';
    } else {
      btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
    }
  }
  
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.setAttribute('content', isDark ? '#0b0f19' : '#1a56db');
  }

  // Re-render dashboard charts if currently on dashboard
  const currentHash = (window.location.hash || '#dashboard').replace('#', '');
  if (currentHash === 'dashboard' && typeof renderDashboard === 'function') {
    renderDashboard();
  }
  if (currentHash === 'calendario' && typeof initFullCalendar === 'function') {
    setTimeout(() => initFullCalendar(), 50);
  }
}

const themeToggleBtn = document.getElementById('themeToggleBtn');
if (themeToggleBtn) {
  themeToggleBtn.addEventListener('click', toggleTheme);
}
initTheme();

// ── CSV EXPORTERS ──────────────────────────────────────────────────────────────
function exportCSV(filename, headers, rows) {
  const csvContent = "\uFEFF" + headers.join(";") + "\n" + rows.map(r => r.join(";")).join("\n");
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename + '.csv';
  a.click();
  URL.revokeObjectURL(url);
  showToast(filename + ' exportado com sucesso!', 'success');
}

// ── TOPBAR ACTION (texto + ícone) ────────────────────────────────────────────
function setTopbarAction(text, iconSvg) {
  const btn = document.getElementById('topbarActionBtn');
  if (!btn) return;
  btn.style.display = 'inline-flex';
  const txt = btn.querySelector('.topbar-action-text');
  const ico = btn.querySelector('.topbar-action-icon');
  if (txt) txt.textContent = text;
  if (ico && iconSvg) ico.outerHTML = iconSvg;
}

function exportClientsCSV() {
  const clients = typeof getClients === 'function' ? getClients() : [];
  const headers = ['ID', 'Nome', 'CNPJ/CPF', 'Segmento', 'Telefone Dono', 'Telefone Resp.', 'Responsável TI', 'Técnico', 'Data Cadastro'];
  const rows = clients.map(c => [
    c.id, 
    c.name || '', 
    c.cnpj || '', 
    c.segment || '', 
    c.ownerPhone || '', 
    c.responsiblePhone || '',
    c.responsible || '',
    c.technician || '',
    formatDate(c.createdAt)
  ]);
  exportCSV('clientes_init_intra', headers, rows);
}

function exportPendenciasCSV() {
  const pens = typeof getPendencias === 'function' ? getPendencias() : [];
  const headers = ['ID', 'Cliente', 'Assunto', 'Descrição', 'Status', 'Prioridade', 'Responsável', 'Criado Em', 'Prazo'];
  const rows = pens.map(p => [
    p.id,
    p.clientName || '',
    p.assunto ? String(p.assunto).replace(/\n/g, ' ') : '',
    p.descricao ? p.descricao.replace(/\n/g, ' ') : '',
    p.status || '', 
    p.priority || '', 
    p.responsible || '', 
    formatDateTime(p.createdAt), 
    formatDate(p.deadline)
  ]);
  exportCSV('pendencias_init_intra', headers, rows);
}

function exportLogsCSV() {
  if (typeof isCurrentAdmin === 'function' && !isCurrentAdmin()) {
    showToast('Apenas administradores podem exportar o histórico.', 'error');
    return;
  }
  const logs = typeof getLogs === 'function' ? getLogs() : [];
  const headers = ['Data/Hora', 'Ação', 'Tipo', 'Detalhes', 'Operador'];
  const rows = logs.map(l => [
    formatDateTime(l.timestamp),
    l.action || '',
    l.type || '',
    l.details ? l.details.replace(/\n/g, ' ') : '',
    l.operatorName || 'Sistema'
  ]);
  exportCSV('historico_init_intra', headers, rows);
}

// ── ATALHOS DE TECLADO GLOBAIS ──
document.addEventListener('keydown', e => {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) {
    if (e.key === 'Escape') closeModal();
    return;
  }

  // Alt + 1..8 -> Navegar entre abas
  if (e.altKey && !e.ctrlKey && !e.metaKey) {
    var tabMap = { '1':'dashboard','2':'pendencias','3':'calendario','4':'clientes','5':'templates','6':'operadores','7':'visitas','8':'historico' };
    var page = tabMap[e.key];
    if (page === 'historico' && typeof isCurrentAdmin === 'function' && !isCurrentAdmin()) return;
    if (page === 'dashboard' && typeof isCurrentAdmin === 'function' && !isCurrentAdmin()) return;
    if (page && typeof navigateTo === 'function') { e.preventDefault(); navigateTo(page); }
  }

  // Alt + N -> Criar Novo Item (conforme aba atual)
  if (e.altKey && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    var page = window.location.hash.replace('#', '') || 'dashboard';
    if (page === 'clientes' && typeof openClientForm === 'function') openClientForm();
    else if (page === 'pendencias' && typeof openPendenciaForm === 'function') openPendenciaForm();
    else if (page === 'calendario' && typeof openPendenciaForm === 'function') openPendenciaForm();
    else if (page === 'operadores' && typeof openOperadorForm === 'function') openOperadorForm();
    else if (typeof openPendenciaForm === 'function') openPendenciaForm();
  }
});

// ── ALERTAS PROATIVOS DE PRAZOS ──
function checkOverdueAlerts() {
  if (typeof getSession === 'function' && !getSession()) return;
  if (typeof getPendencias !== 'function') return;
  const pens = typeof getMyPendencias === 'function' ? getMyPendencias() : getPendencias();
  const now = new Date();
  const todayStr = localDateISO(now);
  
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = localDateISO(tomorrow);

  const overdue = pens.filter(p => p.deadline && p.deadline <= todayStr && !isPendenciaClosed(p.status));
  const dueTomorrow = pens.filter(p => p.deadline && p.deadline === tomorrowStr && !isPendenciaClosed(p.status));

  if (overdue.length > 0 || dueTomorrow.length > 0) {
    let msg = '';
    if (overdue.length > 0 && dueTomorrow.length > 0) {
      msg = `⚠️ ${overdue.length} pendência(s) vencida(s) e ${dueTomorrow.length} vencendo amanhã!`;
    } else if (overdue.length > 0) {
      msg = `⚠️ Você possui ${overdue.length} pendência(s) vencida(s) ou vencendo hoje!`;
    } else {
      msg = `⏰ Você possui ${dueTomorrow.length} pendência(s) vencendo amanhã!`;
    }

    showToast(msg, overdue.length > 0 ? 'error' : 'info');

    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Init Intra – Alerta de Prazos', {
        body: msg,
        icon: 'icon.svg'
      });
    } else if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  // Render persistent banner if on dashboard or pendencias page
  renderOverdueBanner(overdue.length, dueTomorrow.length);
}

function renderOverdueBanner(overdueCount, dueTomorrowCount) {
  const existing = document.getElementById('overdueBanner');
  if (existing) existing.remove();

  if (overdueCount === 0 && dueTomorrowCount === 0) return;

  const hash = window.location.hash.replace('#', '') || 'dashboard';
  if (!['dashboard', 'pendencias', 'calendario'].includes(hash)) return;

  const contentArea = document.getElementById('contentArea');
  if (!contentArea) return;

  const banner = document.createElement('div');
  banner.id = 'overdueBanner';
  banner.className = 'overdue-banner';
  banner.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px">
      <span style="font-size:16px">${overdueCount > 0 ? '🚨' : '⏰'}</span>
      <span>
        ${overdueCount > 0 ? `<strong>${overdueCount} pendência(s) vencida(s)</strong>.` : ''}
        ${dueTomorrowCount > 0 ? ` ${dueTomorrowCount} pendência(s) vencendo amanhã.` : ''}
      </span>
    </div>
    <button class="btn btn-secondary btn-sm" style="background:rgba(0,0,0,0.05)" onclick="navigateTo('pendencias')">Ver Pendências →</button>
  `;

  contentArea.insertBefore(banner, contentArea.firstChild);
}

window.addEventListener('load', () => setTimeout(checkOverdueAlerts, 1500));

// ── PWA Install Prompt ─────────────────────────────────────────────────────────
let _deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  _deferredInstall = e;
});

function promptInstall() {
  if (!_deferredInstall) { showToast('Instale o app pelo menu do navegador.', 'info'); return; }
  _deferredInstall.prompt();
  _deferredInstall.userChoice.then(r => {
    if (r.outcome === 'accepted') showToast('App instalado com sucesso!', 'success');
    _deferredInstall = null;
  });
}
