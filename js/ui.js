// ui.js – Componentes reutilizáveis

const _loadedScripts = new Set();
function loadScript(url, integrity) {
  if (_loadedScripts.has(url)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.crossOrigin = 'anonymous';
    if (integrity) s.integrity = integrity;
    s.onload = () => { _loadedScripts.add(url); resolve(); };
    s.onerror = () => reject(new Error('Falha ao carregar: ' + url));
    document.head.appendChild(s);
  });
}

async function loadChartJs() {
  if (typeof Chart !== 'undefined') return;
  // Versão fixa + SRI: sem versão o CDN entrega sempre a última e uma
  // major nova pode quebrar os gráficos do dia para a noite.
  await loadScript(
    'https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js',
    'sha384-jb8JQMbMoBUzgWatfe6COACi2ljcDdZQ2OxczGA3bGNeWe+6DChMTBJemed7ZnvJ'
  );
}

async function loadFullCalendar() {
  if (typeof FullCalendar !== 'undefined') return;
  await loadScript(
    'https://cdn.jsdelivr.net/npm/fullcalendar@6.1.17/index.global.min.js',
    'sha384-RvFLqUoLENXxwOpLf9+DxOdYK1gR2w9NIQ7uN31j65tKiMpSD6qEJ8Rt6I2WQ/H/'
  );
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
 * "1 pendência" / "2 pendências" / "0 pendências" — no lugar de "pendência(s)".
 * @param {number} n
 * @param {string} singular
 * @param {string} pluralForm
 */
function plural(n, singular, pluralForm) {
  const k = Number(n) || 0;
  return k + ' ' + (k === 1 ? singular : pluralForm);
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
    const isDrawer = !isMobile && /\bdrawer\b/.test(size);
    // Gaveta já aberta (trocando de card): só troca o conteúdo, sem reanimar.
    const wasOpen = overlay.dataset.drawerOpen === '1';
    overlay.dataset.drawerOpen = isDrawer ? '1' : '0';
    if (!(isDrawer && wasOpen)) {
      Motion.animate(overlay, { opacity: [0, 1] }, { duration: 0.18, ease: 'easeOut' });
      Motion.animate(modal, isDrawer
        ? { opacity: [0, 1], x: [40, 0] }
        : isMobile
          ? { opacity: [0, 1], y: [28, 0] }
          : { opacity: [0, 1], scale: [0.96, 1], y: [16, 0] },
        { duration: isDrawer ? 0.25 : 0.4, ease: isDrawer ? 'easeOut' : [0.34, 1.56, 0.64, 1] });
    }
  }
}
function closeModal() {
  const modal = document.getElementById('modal');
  const overlay = document.getElementById('modalOverlay');
  if (_modalTrapHandler) { modal.removeEventListener('keydown', _modalTrapHandler); _modalTrapHandler = null; }
  const hide = () => { overlay.style.display = 'none'; overlay.dataset.drawerOpen = '0'; };
  if (typeof Motion !== 'undefined' && overlay.style.display !== 'none') {
    Motion.animate(modal, { opacity: [1, 0], scale: [1, 0.98], y: [0, 8] }, { duration: 0.14, ease: 'easeIn' });
    Motion.animate(overlay, { opacity: [1, 0] }, { duration: 0.14, ease: 'easeIn' });
    _modalHideTimer = setTimeout(() => { hide(); _modalHideTimer = null; }, 150);
  } else {
    hide();
  }
  if (_prevFocus && _prevFocus.focus) { _prevFocus.focus(); _prevFocus = null; }
  // Volta à aba Pendências do cliente (abertura via openClientPendencia).
  // Adiado: fluxos que fecham e reabrem o modal no mesmo tick (ex.: Editar)
  // mantêm o overlay visível e o retorno é ignorado.
  try {
    if (typeof _clientPenReturn !== 'undefined' && _clientPenReturn && _clientPenReturn.clientId) {
      const _ret = _clientPenReturn;
      _clientPenReturn = null;
      try { if (typeof _clientPenOrigin !== 'undefined') _clientPenOrigin = null; } catch (_) {}
      setTimeout(() => {
        try {
          if (document.getElementById('modalOverlay').style.display !== 'none') return;
          if (typeof getClientById === 'function' && !getClientById(_ret.clientId)) return;
          if (typeof viewClient === 'function') viewClient(_ret.clientId);
          if (typeof switchClientTab === 'function') switchClientTab('pendencias', _ret.clientId);
        } catch (_) {}
      }, 220);
    }
  } catch (_) {}
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

  document.getElementById('confirmBtn').onclick = () => {
    closeModal();
    // Callbacks async (ex: endReuniao) rejeitados viravam unhandled rejection
    // silenciosa — converte em toast visível. Síncronos mantêm o comportamento.
    try {
      var _r = onConfirm();
      if (_r && typeof _r.then === 'function') {
        _r.catch(function(err) {
          if (typeof showToast === 'function') showToast('Erro: ' + (err && err.message ? err.message : err), 'error');
          else console.error(err);
        });
      }
    } catch (err) {
      if (typeof showToast === 'function') showToast('Erro: ' + (err && err.message ? err.message : err), 'error');
      else console.error(err);
    }
  };

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
// ── Convenções visuais centralizadas ────────────────────────────────────────
// Datas: formatDate/formatDateTime (abaixo, com APP_TIME_ZONE) são canônicos —
// código novo deve usá-los; os toLocaleString('pt-BR') espalhados são apenas
// fallbacks defensivos p/ caso ui.js não carregue.
// Paginação client-side (clientes, visitas, operadores): UI_PAGE_SIZE.
// Paginação server-side/edge tem tamanho próprio (pendências 50, atendimentos
// 50/100/200) — não unificar, pois envolve contrato com o servidor.
const UI_PAGE_SIZE = 30;
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
  { value: 'quarterly', label: 'Trimestral' },
  { value: 'yearly', label: 'Anual' },
];

// Soma meses sem "estourar" o fim do mês: 31/01 + 1 mês = 28/02 (antes,
// setMonth caía em 03/03 e a série ia escorregando de data).
function _addMonthsClamped(d, months) {
  const day = d.getDate();
  const r = new Date(d.getTime());
  r.setDate(1);
  r.setMonth(r.getMonth() + months);
  const last = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
  r.setDate(Math.min(day, last));
  return r;
}

function nextRecurrenceDate(baseISO, recurrence) {
  if (!recurrence) return null;
  const base = baseISO ? parseDateOnly(baseISO) : new Date();
  let d = new Date(base.getTime());
  if (recurrence === 'weekly') d.setDate(d.getDate() + 7);
  else if (recurrence === 'biweekly') d.setDate(d.getDate() + 14);
  else if (recurrence === 'monthly') d = _addMonthsClamped(d, 1);
  else if (recurrence === 'quarterly') d = _addMonthsClamped(d, 3);
  else if (recurrence === 'yearly') d = _addMonthsClamped(d, 12);
  else return null;
  return localDateISO(d);
}

// Próxima ocorrência que não esteja no passado (pendência concluída com
// atraso não deve nascer já vencida). Para no máximo em 400 passos.
function nextRecurrenceDateFrom(baseISO, recurrence, todayISO) {
  let next = nextRecurrenceDate(baseISO, recurrence);
  let guard = 0;
  while (next && todayISO && next < todayISO && guard++ < 400) next = nextRecurrenceDate(next, recurrence);
  return next;
}
function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => showToast('Copiado!', 'success'));
}

const PRIORITY_MAP = {
  baixa:   { label: 'Baixa',   cls: 'tag-green',  dot: '#16a34a' },
  media:   { label: 'Média',   cls: 'tag-yellow', dot: '#d97706' },
  alta:    { label: 'Alta',    cls: 'tag-red',    dot: '#dc2626' },
  critica: { label: 'Crítica', cls: 'tag-red',    dot: '#991b1b' },
};
const STATUS_PEN_MAP = {
  aberto:             { label: 'Aberto',         cls: 'tag-blue',   dot: '#3b82f6' },
  em_andamento:       { label: 'Em Andamento',   cls: 'tag-indigo', dot: '#6366f1' },
  pausado:            { label: 'Pausado',        cls: 'tag-yellow', dot: '#f59e0b' },
  aguardando:         { label: 'Aguard. Terceiro', cls: 'tag-purple', dot: '#7c3aed' },
  aguardando_cliente: { label: 'Aguard. Cliente', cls: 'tag-purple', dot: '#7c3aed' },
  resolvido:          { label: 'Resolvido',      cls: 'tag-green',  dot: '#16a34a' },
  cancelado:          { label: 'Cancelado',      cls: 'tag-gray',   dot: '#94a3b8' },
};
// 'concluido'/'fechado' saíram das opções (migração p/ resolvido/cancelado),
// mas seguem em PEN_CLOSED_STATUSES/isPendenciaResolvida para não ressuscitar
// nem deixar de contar registros legados.

const PEN_CLOSED_STATUSES = ['concluido', 'resolvido', 'cancelado', 'fechado'];
function isPendenciaClosed(status) { return PEN_CLOSED_STATUSES.includes(status || ''); }
// Êxito (verde): Concluído + Resolvido contam nas métricas de "resolvidas".
// Cancelado/Fechado são finais, mas não contam como resolvidas.
function isPendenciaResolvida(status) { return ['concluido', 'resolvido'].includes(status || ''); }

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
  return `<span class="tag ${m.cls}"><span class="priority-dot" style="background:${m.dot}"></span>${escapeHtml(m.label)}</span>`;
}
function statusTag(s) {
  const m = STATUS_PEN_MAP[s] || { label: s, cls: 'tag-gray', dot: '#94a3b8' };
  return `<span class="tag ${m.cls}"><span class="priority-dot" style="background:${m.dot}"></span>${escapeHtml(m.label)}</span>`;
}

// ── Cor canônica por status (fonte única p/ badges) ─────────────────────────
// STATUS_PEN_MAP é a referência visual; chamados do Milvus (texto livre da
// API) usam o mesmo vocabulário: verde=finalizado, azul=aberto,
// índigo=em atendimento, amarelo=pausado, roxo=aguardando/conferência,
// cinza=cancelado/sem leitura. Centraliza para não divergir por tela.
function canonicalStatusClass(s) {
  const t = String(s === null || s === undefined ? '' : (s.text !== undefined ? s.text : s)).toLowerCase();
  if (!t) return 'tag-gray';
  if (/finaliz|conclu|resolv|fechado/.test(t)) return 'tag-green';
  if (/cancel/.test(t)) return 'tag-gray';
  if (/paus/.test(t)) return 'tag-yellow';
  if (/confer[eê]ncia|aguard/.test(t)) return 'tag-purple';
  if (/andamento|atend/.test(t)) return 'tag-indigo';
  if (/agend/.test(t)) return 'tag-blue';
  if (/aberto|pendente|fazer/.test(t)) return 'tag-blue';
  return 'tag-gray';
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
  if (/^https?:\/\//i.test(url)) { try { return new URL(url).href; } catch { return '#'; } }
  if (/^data:image\/(?!svg\+xml)[a-z+-]+;/i.test(url)) return url;
  return '#';
}

function clientAvatar(c, size = 40) {
  const shape = c.logoShape || 'circle';
  const shapeClass = shape === 'square' ? 'client-logo-square' : 'client-logo-circle';
  if (c.logo) {
    return `<img src="${escapeHtml(_safeLogoUrl(c.logo))}" class="${shapeClass}" style="width:${size}px;height:${size}px" alt="${escapeHtml(c.name||'')}" />`;
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

// Menu recolhido (só ícones): rótulo flutuante na hora, com o nome do item e
// a seção (Dia a dia, Cadastros, Gestão). O `title` nativo demora ~1s e não
// mostra a seção; ele vira aria-label para o leitor de tela continuar lendo.
(function _initSidebarTips() {
  const nav = document.querySelector('.sidebar-nav');
  if (!nav || typeof document.createElement !== 'function') return;
  let tip = null;
  let section = '';
  Array.prototype.forEach.call(nav.children || [], (el) => {
    if (el.classList && el.classList.contains('nav-section')) { section = (el.textContent || '').trim(); return; }
    if (!el.classList || !el.classList.contains('nav-item')) return;
    const label = el.querySelector('span:not(.badge)');
    el.dataset.tip = (label && label.textContent.trim()) || el.getAttribute('title') || '';
    el.dataset.tipSection = section;
    if (el.getAttribute('title')) { el.setAttribute('aria-label', el.getAttribute('title')); el.removeAttribute('title'); }
  });
  const show = (item) => {
    const sb = document.getElementById('sidebar');
    if (!sb || !sb.classList.contains('collapsed') || !item.dataset.tip) return;
    if (!tip) { tip = document.createElement('div'); tip.className = 'sidebar-tip'; tip.setAttribute('aria-hidden', 'true'); document.body.appendChild(tip); }
    tip.innerHTML = escapeHtml(item.dataset.tip) + (item.dataset.tipSection ? '<small>' + escapeHtml(item.dataset.tipSection) + '</small>' : '');
    const r = item.getBoundingClientRect();
    tip.style.top = Math.round(r.top + r.height / 2) + 'px';
    tip.style.left = Math.round(sb.getBoundingClientRect().right + 8) + 'px';
    tip.classList.add('is-on');
  };
  const hide = () => { if (tip) tip.classList.remove('is-on'); };
  nav.addEventListener('mouseover', (e) => { const it = e.target.closest && e.target.closest('.nav-item'); if (it) show(it); else hide(); });
  nav.addEventListener('mouseleave', hide);
  nav.addEventListener('focusin', (e) => { const it = e.target.closest && e.target.closest('.nav-item'); if (it) show(it); });
  nav.addEventListener('focusout', hide);
  nav.addEventListener('click', hide);
  nav.addEventListener('scroll', hide);
})();

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

  sidebar.querySelectorAll('.sidebar-nav a, .btn-logout, .current-user').forEach(item => {
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
  // Modal filho (Checklist → "Ver procedimento") tem prioridade: fecha só ele.
  try {
    const ck = document.getElementById('ckProcOverlay');
    if (ck && ck.style.display !== 'none' && typeof closeChecklistProc === 'function') {
      closeChecklistProc();
      return;
    }
  } catch (_) {}
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

// ── AUDITORIA (Histórico de Atividades) ─────────────────────────────────────
// Filtros por pessoa, tipo de registro, ação e período; agrupado por dia;
// "carregar mais" (100 por vez); clique abre o registro; busca no servidor
// além dos últimos 500 que o sync traz para o aparelho.
const AUDIT_PAGE = 100;

function _auditNorm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

/** Valores distintos para os filtros (puro). */
function auditFacets(logs) {
  const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  return {
    types: uniq((logs || []).map((l) => l.type)),
    actions: uniq((logs || []).map((l) => l.action)),
    people: uniq((logs || []).map((l) => l.operatorName || 'Sistema')),
  };
}

/** Filtro puro. f = { q, type, action, person, from, to } (datas YYYY-MM-DD, fuso local). */
function filterAuditLogs(logs, f) {
  const o = f || {};
  const q = _auditNorm(o.q);
  const day = (l) => (l.timestamp ? (typeof localDateISO === 'function' ? localDateISO(new Date(l.timestamp)) : String(l.timestamp).slice(0, 10)) : '');
  return (logs || []).filter((l) => {
    if (o.type && l.type !== o.type) return false;
    if (o.action && l.action !== o.action) return false;
    if (o.person && (l.operatorName || 'Sistema') !== o.person) return false;
    if (o.from && day(l) < o.from) return false;
    if (o.to && day(l) > o.to) return false;
    if (q && ![l.action, l.type, l.details, l.operatorName, l.targetId].some((v) => _auditNorm(v).includes(q))) return false;
    return true;
  }).sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
}

/** Agrupa por dia (já ordenado) com rótulo Hoje/Ontem/data (puro). */
function groupAuditLogsByDay(logs, todayISO) {
  const d = new Date(todayISO + 'T12:00:00');
  d.setDate(d.getDate() - 1);
  const yesterday = d.toISOString().slice(0, 10);
  const groups = [];
  let cur = null;
  for (const l of (logs || [])) {
    const key = l.timestamp ? (typeof localDateISO === 'function' ? localDateISO(new Date(l.timestamp)) : String(l.timestamp).slice(0, 10)) : '—';
    if (!cur || cur.key !== key) {
      const label = key === todayISO ? 'Hoje' : key === yesterday ? 'Ontem' : (key === '—' ? 'Sem data' : key.split('-').reverse().join('/'));
      cur = { key, label, items: [] };
      groups.push(cur);
    }
    cur.items.push(l);
  }
  return groups;
}

// Abre o registro citado no log, quando ainda existe.
function openAuditTarget(type, id) {
  const t = _auditNorm(type);
  try {
    if (t === 'pendencia' && getPendenciaById(id)) return openPendenciaDetail(id);
    if (t === 'visita' && getVisitById(id)) return openVisitDetail(id);
    if (t === 'cliente' && getClientById(id)) return viewClient(id);
  } catch (_) {}
  showToast('Registro não encontrado (pode ter sido excluído).', 'info');
}

let _auditState = { f: {}, shown: AUDIT_PAGE, remote: null };

function renderLogs() {
  if (typeof isCurrentAdmin === 'function' && !isCurrentAdmin()) {
    showToast('Apenas administradores podem ver o histórico.', 'error');
    if (typeof navigateTo === 'function') navigateTo('pendencias');
    return;
  }
  document.getElementById('pageTitle').textContent = 'Histórico de Atividades';
  const btn = document.getElementById('topbarActionBtn');
  if (btn) btn.style.display = 'none';
  _auditState = { f: {}, shown: AUDIT_PAGE, remote: null };

  const facets = auditFacets(_auditLocalLogs());
  const opt = (arr, all) => '<option value="">' + all + '</option>' + arr.map((v) => '<option value="' + escapeHtml(v) + '">' + escapeHtml(v) + '</option>').join('');
  document.getElementById('contentArea').innerHTML = `
    <div class="log-toolbar search-bar page-toolbar">
      <div class="search-input-wrap pt-search">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" id="logSearch" placeholder="Buscar em ações, detalhes, IDs…" class="form-input">
      </div>
      <select id="logOpFilter" class="form-select filter-select-lg pt-filter" aria-label="Pessoa">${opt(facets.people, 'Todas as pessoas')}</select>
      <select id="logTypeFilter" class="form-select filter-select-sm pt-filter" aria-label="Tipo de registro">${opt(facets.types, 'Todos os tipos')}</select>
      <select id="logActionFilter" class="form-select filter-select-sm pt-filter" aria-label="Ação">${opt(facets.actions, 'Todas as ações')}</select>
      <div class="filter-date-wrap pt-filter">
        <span style="font-size:12px;color:var(--text-muted);flex-shrink:0">De:</span>
        <input type="date" id="logDateFrom" class="form-input filter-date" />
      </div>
      <div class="filter-date-wrap pt-filter">
        <span style="font-size:12px;color:var(--text-muted);flex-shrink:0">Até:</span>
        <input type="date" id="logDateTo" class="form-input filter-date" />
      </div>
      <div class="pt-actions">
      <button class="btn btn-secondary btn-sm" onclick="exportLogsCSV()" title="Exporta o que está filtrado">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        CSV
      </button>
      ${isCurrentAdmin() && typeof openClientErrors === 'function' ? '<button class="btn btn-secondary btn-sm" onclick="openClientErrors()" title="Falhas que o app registrou nos aparelhos">Erros do app</button>' : ''}
      ${isCurrentAdmin() ? '<button class="btn btn-danger btn-sm" onclick="clearLogs()">Limpar Histórico</button>' : ''}
      </div>
    </div>
    <div class="audit-quick" role="group" aria-label="Período rápido">
      <button type="button" class="vis-chip" data-p="today" onclick="auditQuickPeriod('today')">Hoje</button>
      <button type="button" class="vis-chip" data-p="7" onclick="auditQuickPeriod('7')">7 dias</button>
      <button type="button" class="vis-chip" data-p="30" onclick="auditQuickPeriod('30')">30 dias</button>
      <button type="button" class="vis-chip" data-p="" onclick="auditQuickPeriod('')">Tudo</button>
    </div>
    <div class="audit-summary" id="auditSummary" aria-live="polite"></div>
    <div id="logsContainer"></div>`;

  const rerender = () => { _auditState.shown = AUDIT_PAGE; _auditState.remote = null; _renderAuditList(); };
  document.getElementById('logSearch').addEventListener('input', typeof debounce === 'function' ? debounce(rerender, 200) : rerender);
  ['logTypeFilter', 'logOpFilter', 'logActionFilter', 'logDateFrom', 'logDateTo'].forEach((id) => document.getElementById(id).addEventListener('change', rerender));
  _renderAuditList();
}

function _auditLocalLogs() {
  let logs = typeof getLogs === 'function' ? getLogs() : [];
  // Gestão: esconde logs de pendência Gestão de quem não é Gestão.
  try {
    if (typeof filterGestaoLogs === 'function') logs = filterGestaoLogs(logs);
    else if (typeof canViewGestao === 'function' && !canViewGestao() && typeof isGestaoLog === 'function') logs = logs.filter((l) => !isGestaoLog(l));
  } catch (_) {}
  return logs;
}

function _auditFilters() {
  const v = (id) => (document.getElementById(id) || {}).value || '';
  return { q: v('logSearch'), type: v('logTypeFilter'), action: v('logActionFilter'), person: v('logOpFilter'), from: v('logDateFrom'), to: v('logDateTo') };
}

function auditQuickPeriod(p) {
  const today = localDateISO();
  const from = document.getElementById('logDateFrom');
  const to = document.getElementById('logDateTo');
  if (!from || !to) return;
  if (!p) { from.value = ''; to.value = ''; }
  else if (p === 'today') { from.value = today; to.value = today; }
  else { const d = new Date(today + 'T12:00:00'); d.setDate(d.getDate() - (Number(p) - 1)); from.value = d.toISOString().slice(0, 10); to.value = today; }
  document.querySelectorAll('.audit-quick .vis-chip').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.p === p)));
  _auditState.shown = AUDIT_PAGE; _auditState.remote = null;
  _renderAuditList();
}

// Logs filtrados atuais (locais + os trazidos do servidor, sem duplicar).
function _auditCurrentList() {
  const f = _auditFilters();
  const base = _auditLocalLogs();
  const extra = _auditState.remote || [];
  const ids = new Set(base.map((l) => l.id));
  return filterAuditLogs(base.concat(extra.filter((l) => !ids.has(l.id))), f);
}

function _renderAuditList() {
  const container = document.getElementById('logsContainer');
  if (!container) return;
  const list = _auditCurrentList();
  const people = new Set(list.map((l) => l.operatorName || 'Sistema')).size;
  const sum = document.getElementById('auditSummary');
  const online = typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive;
  if (sum) {
    sum.innerHTML = '<b>' + plural(list.length, 'registro', 'registros') + '</b> · ' + plural(people, 'pessoa', 'pessoas') +
      (online && !_auditState.remote ? ' · <button type="button" class="link-btn" onclick="auditFetchRemote(this)" title="O aparelho guarda só os últimos 500 registros">Buscar também no servidor</button>' : '') +
      (_auditState.remote ? ' · inclui registros do servidor' : '');
  }
  if (!list.length) {
    container.innerHTML = '<div class="empty-state" style="padding:40px"><p>Nenhum registro encontrado com esses filtros.</p></div>';
    return;
  }
  const page = list.slice(0, _auditState.shown);
  const groups = groupAuditLogsByDay(page, localDateISO());
  const actionClass = (log) => {
    const k = _auditNorm(log.action).split(/\s+/)[0];
    return ['criou', 'ativou', 'editou', 'excluiu', 'desativou', 'login', 'backup', 'limpou'].includes(k) ? 'log-action-' + k : 'log-action-default';
  };
  const time = (iso) => { try { return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } };
  const canOpen = (l) => ['pendencia', 'visita', 'cliente'].includes(_auditNorm(l.type)) && l.targetId;
  container.innerHTML = groups.map((g) =>
    '<section class="audit-day"><h3 class="audit-day-label">' + escapeHtml(g.label) + ' <small>' + g.items.length + '</small></h3>' +
    '<div class="log-timeline">' + g.items.map((log) => {
      const cls = actionClass(log);
      return '<div class="log-card">' +
        '<div class="log-dot ' + cls + '" style="background:currentColor"></div>' +
        '<div class="log-header">' +
          '<span class="log-action-label">' + escapeHtml(log.action) + '</span>' +
          '<span class="log-type-badge ' + cls + '">' + escapeHtml(log.type) + '</span>' +
          '<span style="flex:1"></span>' +
          '<span class="log-meta">' + escapeHtml(time(log.timestamp)) + '</span>' +
        '</div>' +
        '<div class="log-details">' + escapeHtml(log.details) + '</div>' +
        '<div class="log-meta">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' +
          escapeHtml(log.operatorName || 'Sistema') +
          (canOpen(log) ? ' · <button type="button" class="link-btn" onclick="openAuditTarget(\'' + escapeHtml(log.type) + '\',\'' + escapeHtml(log.targetId) + '\')">Abrir</button>' : '') +
        '</div>' +
      '</div>';
    }).join('') + '</div></section>').join('') +
    (list.length > page.length
      ? '<div style="text-align:center;padding:12px"><button type="button" class="btn btn-secondary" onclick="_auditState.shown+=' + AUDIT_PAGE + ';_renderAuditList()">Carregar mais (' + (list.length - page.length) + ' restantes)</button></div>'
      : '');
}

// Busca no servidor com os mesmos filtros (até 1.000 registros) — o
// aparelho guarda só os últimos 500 do sync.
async function auditFetchRemote(btn) {
  if (btn) btn.disabled = true;
  const f = _auditFilters();
  try {
    let q = supabaseClient.from('audit_logs').select('*').order('timestamp', { ascending: false }).limit(1000);
    if (f.type) q = q.eq('type', f.type);
    if (f.action) q = q.eq('action', f.action);
    if (f.person) q = q.eq('operator_name', f.person);
    if (f.from) q = q.gte('timestamp', new Date(f.from + 'T00:00:00').toISOString());
    if (f.to) q = q.lte('timestamp', new Date(f.to + 'T23:59:59.999').toISOString());
    const { data, error } = await q;
    if (error) throw error;
    let rows = (data || []).map((l) => ({ id: l.id, operatorName: l.operator_name, action: l.action, type: l.type, targetId: l.target_id, details: l.details, timestamp: l.timestamp }));
    try { if (typeof filterGestaoLogs === 'function') rows = filterGestaoLogs(rows); } catch (_) {}
    _auditState.remote = rows;
    _auditState.shown = AUDIT_PAGE;
    _renderAuditList();
  } catch (_) {
    showToast('Não foi possível buscar no servidor.', 'error');
    if (btn) btn.disabled = false;
  }
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

function _themeIconSvg(isDark) {
  return isDark
    ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
    : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
}

function _applyThemeUI(isDark) {
  document.body.classList.toggle('dark-theme', !!isDark);
  const btn = document.getElementById('themeToggleBtn');
  if (btn) btn.innerHTML = _themeIconSvg(!!isDark);
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme && typeof metaTheme.setAttribute === 'function') {
    metaTheme.setAttribute('content', isDark ? '#0b0f19' : '#1a56db');
  }
}

function _storedTheme() {
  const t = localStorage.getItem('intra_theme');
  return (t === 'dark' || t === 'light') ? t : null;
}

function _systemThemeIsDark() {
  return typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)').matches : false;
}

function initTheme() {
  _applyThemeUI((_storedTheme() || (_systemThemeIsDark() ? 'dark' : 'light')) === 'dark');
  if (typeof window === 'undefined' || !window.matchMedia) return;
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = function() { if (!_storedTheme()) _applyThemeUI(_systemThemeIsDark()); };
  if (mq.addEventListener) mq.addEventListener('change', onChange);
  else if (mq.addListener) mq.addListener(onChange);
}

function toggleTheme() {
  const isDark = document.body.classList.toggle('dark-theme');
  localStorage.setItem('intra_theme', isDark ? 'dark' : 'light');
  _applyThemeUI(isDark);

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
// Helper unico de celula (delimitador ";", padrao pt-BR) usado por TODOS os
// exportadores (exportCSV, relatorio de visitas, acerto de equipamentos,
// inventario Milvus). Duas protecoes:
//  1) escape estrutural: valor com ";", aspa ou quebra de linha vira campo
//     entre aspas (sem isso a coluna desalinha e a linha quebra);
//  2) neutralizacao de formula: celula iniciada por =, +, -, @, tab ou CR
//     ganha marcador de texto (a planilha ignora ao exibir), exceto
//     numeros puros ("-12.5" continua sendo numero).
function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+@\t\r]|^-/.test(s) && !/^-\d+(?:[.,]\d+)?$/.test(s)) s = "'" + s;
  s = s.replace(/"/g, '""');
  return /[;\n\r"]/.test(s) ? '"' + s + '"' : s;
}
function csvRow(cells) {
  return cells.map(csvCell).join(';');
}

function exportCSV(filename, headers, rows) {
  const csvContent = "\uFEFF" + csvRow(headers) + "\n" + rows.map(csvRow).join("\n");
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
  _syncTopbarMoreAction(text);
}

// ── TOPBAR MORE MENU (mobile ≤768px: ações em menu suspenso) ─────────────────
// Espelha o rótulo/visibilidade da ação principal no item do menu mobile.
function _syncTopbarMoreAction(text) {
  try {
    const item = document.getElementById('topbarMoreAction');
    if (!item) return;
    const btn = document.getElementById('topbarActionBtn');
    const hasAction = !!btn && btn.style.display !== 'none';
    item.style.display = hasAction ? '' : 'none';
    if (text) {
      const label = item.querySelector('.topbar-more-action-text');
      if (label) label.textContent = text;
    }
  } catch (_) {}
}
function toggleTopbarMoreMenu(e) {
  if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
  const menu = document.getElementById('topbarMoreMenu');
  const btn = document.getElementById('topbarMoreBtn');
  if (!menu || !btn) return;
  _syncTopbarMoreAction();
  const willOpen = menu.hidden || menu.dataset.open !== '1';
  menu.hidden = !willOpen;
  menu.dataset.open = willOpen ? '1' : '0';
  btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
}
function closeTopbarMoreMenu() {
  try {
    const menu = document.getElementById('topbarMoreMenu');
    const btn = document.getElementById('topbarMoreBtn');
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    menu.dataset.open = '0';
    if (btn) btn.setAttribute('aria-expanded', 'false');
  } catch (_) {}
}
if (typeof window !== 'undefined' && !window._topbarMoreBound && typeof document !== 'undefined' && document.addEventListener) {
  window._topbarMoreBound = true;
  document.addEventListener('click', function (e) {
    try {
      const menu = document.getElementById('topbarMoreMenu');
      const btn = document.getElementById('topbarMoreBtn');
      if (!menu || menu.hidden) return;
      if (menu.contains(e.target) || (btn && btn.contains(e.target))) return;
      closeTopbarMoreMenu();
    } catch (_) {}
  });
  document.addEventListener('keydown', function (e) {
    try {
      if (e && e.key === 'Escape') closeTopbarMoreMenu();
    } catch (_) {}
  });
}

function exportClientsCSV() {
  if (typeof canExport === 'function' && !canExport()) {
    if (typeof showToast === 'function') showToast('Exportação restrita a administradores/supervisores.', 'error');
    return;
  }
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
  if (typeof canExport === 'function' && !canExport()) {
    if (typeof showToast === 'function') showToast('Exportação restrita a administradores/supervisores.', 'error');
    return;
  }
  const pens = (typeof getMyPendencias === 'function') ? getMyPendencias()
    : (typeof filterGestaoPendencias === 'function' && typeof getPendencias === 'function' ? filterGestaoPendencias(getPendencias()) : (typeof getPendencias === 'function' ? getPendencias() : []));
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
  // Na tela de histórico, exporta exatamente o que está filtrado.
  const logs = (document.getElementById('logsContainer') && typeof _auditCurrentList === 'function') ? _auditCurrentList() : (function(){
    var _l = typeof getLogs === 'function' ? getLogs() : [];
    try {
      if (typeof filterGestaoLogs === 'function') return filterGestaoLogs(_l);
      if (typeof canViewGestao === 'function' && !canViewGestao() && typeof isGestaoLog === 'function') return _l.filter(l => !isGestaoLog(l));
    } catch (_) {}
    return _l;
  })();
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

  // Alt + 1..9 -> Navegar entre abas
  if (e.altKey && !e.ctrlKey && !e.metaKey) {
    var tabMap = { '1':'dashboard','2':'pendencias','3':'calendario','4':'clientes','5':'templates','6':'operadores','7':'visitas','8':'equipamentos','9':'historico' };
    var page = tabMap[e.key];
    if (page === 'historico' && typeof isCurrentAdmin === 'function' && !isCurrentAdmin()) return;
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
    else if (page === 'equipamentos' && typeof openEquipForm === 'function') openEquipForm();
    else if (typeof openPendenciaForm === 'function') openPendenciaForm();
  }
});

// ── ALERTAS PROATIVOS DE PRAZOS ──
// Só avisa do que vence hoje ou amanhã. Pendência já vencida/atrasada não gera
// mais alerta (pedido do Pedro); ela segue aparecendo no dashboard e nas listas.
function checkOverdueAlerts() {
  if (typeof getSession === 'function' && !getSession()) return;
  if (typeof getPendencias !== 'function') return;
  const pens = typeof getMyPendencias === 'function' ? getMyPendencias() : getPendencias();
  const now = new Date();
  const todayStr = localDateISO(now);

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = localDateISO(tomorrow);

  const dueToday = pens.filter(p => p.deadline && p.deadline === todayStr && !isPendenciaClosed(p.status));
  const dueTomorrow = pens.filter(p => p.deadline && p.deadline === tomorrowStr && !isPendenciaClosed(p.status));

  if (dueToday.length > 0 || dueTomorrow.length > 0) {
    let msg = '';
    if (dueToday.length > 0 && dueTomorrow.length > 0) {
      msg = `⏰ ${plural(dueToday.length, 'pendência vence', 'pendências vencem')} hoje e ${dueTomorrow.length} amanhã!`;
    } else if (dueToday.length > 0) {
      msg = `⏰ Você possui ${plural(dueToday.length, 'pendência', 'pendências')} vencendo hoje!`;
    } else {
      msg = `⏰ Você possui ${plural(dueTomorrow.length, 'pendência', 'pendências')} vencendo amanhã!`;
    }

    showToast(msg, 'info');

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
  renderOverdueBanner(dueToday.length, dueTomorrow.length);
}

function renderOverdueBanner(dueTodayCount, dueTomorrowCount) {
  const existing = document.getElementById('overdueBanner');
  if (existing) existing.remove();

  if (dueTodayCount === 0 && dueTomorrowCount === 0) return;

  const hash = window.location.hash.replace('#', '') || 'dashboard';
  if (!['dashboard', 'pendencias', 'calendario'].includes(hash)) return;

  const contentArea = document.getElementById('contentArea');
  if (!contentArea) return;

  const banner = document.createElement('div');
  banner.id = 'overdueBanner';
  banner.className = 'overdue-banner';
  banner.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px">
      <span style="font-size:16px">⏰</span>
      <span>
        ${dueTodayCount > 0 ? `<strong>${plural(dueTodayCount, 'pendência vence', 'pendências vencem')} hoje</strong>.` : ''}
        ${dueTomorrowCount > 0 ? ` ${plural(dueTomorrowCount, 'pendência', 'pendências')} vencendo amanhã.` : ''}
      </span>
    </div>
    <button class="btn btn-secondary btn-sm" style="background:rgba(0,0,0,0.05)" onclick="navigateTo('pendencias')">Ver Pendências →</button>
  `;

  contentArea.insertBefore(banner, contentArea.firstChild);
}

window.addEventListener('load', () => setTimeout(checkOverdueAlerts, 1500));

// ── PWA Install Prompt ─────────────────────────────────────────────────────────
let _deferredInstall = null;
function _setInstallBtnVisible(v) {
  try { const b = document.getElementById('installAppBtn'); if (b) b.style.display = v ? '' : 'none'; } catch (_) {}
  refreshSidebarMore();
}

// ── Menu "Mais opções" (rodapé da sidebar) ────────────────────────────────────
// Exportar/Importar (só admin) e Instalar app (só quando o navegador oferece)
// vivem num popover. Cada item controla a própria visibilidade; o botão
// "Mais opções" só aparece se houver ao menos um item visível.
function setSidebarMoreAdmin(isAdmin) {
  ['exportDataBtn', 'importDataBtn'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = isAdmin ? '' : 'none';
  });
  refreshSidebarMore();
}

function refreshSidebarMore() {
  const btn = document.getElementById('sidebarMoreBtn');
  const menu = document.getElementById('sidebarMoreMenu');
  if (!btn || !menu) return;
  const any = Array.from(menu.querySelectorAll('.sidebar-more-item')).some(el => el.style.display !== 'none');
  btn.style.display = any ? '' : 'none';
  if (!any) closeSidebarMore();
}

function closeSidebarMore() {
  const btn = document.getElementById('sidebarMoreBtn');
  const menu = document.getElementById('sidebarMoreMenu');
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

function openSidebarMore() {
  const btn = document.getElementById('sidebarMoreBtn');
  const menu = document.getElementById('sidebarMoreMenu');
  if (!btn || !menu) return;
  menu.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  // A sidebar tem overflow:hidden, então o popover é fixed e abre ao lado do
  // botão, alinhado pela base (o botão fica no rodapé).
  const r = btn.getBoundingClientRect();
  const sidebar = document.getElementById('sidebar') || btn.closest('.sidebar');
  const sr = sidebar ? sidebar.getBoundingClientRect() : r;
  const mobile = window.innerWidth <= 768;
  const left = mobile ? r.left : sr.right + 6;
  const bottom = mobile ? window.innerHeight - r.top + 6 : window.innerHeight - r.bottom;
  menu.style.left = Math.max(8, left) + 'px';
  menu.style.bottom = Math.max(8, bottom) + 'px';
  const first = Array.from(menu.querySelectorAll('.sidebar-more-item')).find(el => el.style.display !== 'none');
  if (first) first.focus();
}

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('sidebarMoreBtn');
  const menu = document.getElementById('sidebarMoreMenu');
  if (!btn || !menu) return;
  btn.addEventListener('click', e => {
    e.stopPropagation();
    if (menu.hidden) openSidebarMore(); else closeSidebarMore();
  });
  menu.addEventListener('click', e => {
    const item = e.target.closest('.sidebar-more-item');
    if (!item) return;
    closeSidebarMore();
    if (window.innerWidth <= 768 && typeof window.closeMobileMenu === 'function') window.closeMobileMenu();
    const fn = window[item.dataset.moreAction];
    if (typeof fn === 'function') fn();
  });
  menu.addEventListener('keydown', e => {
    const items = Array.from(menu.querySelectorAll('.sidebar-more-item')).filter(el => el.style.display !== 'none');
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  });
  document.addEventListener('click', e => {
    if (!menu.hidden && !menu.contains(e.target) && e.target !== btn) closeSidebarMore();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !menu.hidden) { closeSidebarMore(); btn.focus(); }
  });
  window.addEventListener('resize', closeSidebarMore);
  refreshSidebarMore();
});
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  _deferredInstall = e;
  _setInstallBtnVisible(true);
});
window.addEventListener('appinstalled', () => {
  _deferredInstall = null;
  _setInstallBtnVisible(false);
});

function promptInstall() {
  if (!_deferredInstall) { showToast('Instale o app pelo menu do navegador.', 'info'); return; }
  _deferredInstall.prompt();
  _deferredInstall.userChoice.then(r => {
    if (r.outcome === 'accepted') showToast('App instalado com sucesso!', 'success');
    _deferredInstall = null;
    _setInstallBtnVisible(false);
  });
}

// ── RICH TEXT (links) + TEMPO AMIGÁVEL ───────────────────────────────────────
// Evolução da renderização de textos do usuário (descrição/notas/checklist):
// antes era só escapeHtml (URL virava texto puro e podia estourar o container).
// Agora: escapa tudo (anti-XSS) e converte URLs/e-mails em <a> clicáveis via
// safeUrl. URLs muito longas (>60 chars) viram "🔗 Abrir link" com a URL
// completa no title/tooltip + href intacto (DOM preserva a URL original).
// Palavras normais não são afetadas: a quebra longa vive só no <a> via CSS
// (.rich-link { overflow-wrap:anywhere; word-break:break-word }).
function _richEsc(str) {
  if (typeof escapeHtml === 'function') return escapeHtml(str);
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function _richMentionNames() {
  try {
    if (typeof getOperatorNames === 'function') {
      var n = getOperatorNames();
      if (n && n.length) return n;
    }
  } catch (_) {}
  return [];
}
function _richApplyMentions(escapedChunk) {
  var names = _richMentionNames();
  if (!names.length) return escapedChunk;
  return String(escapedChunk).replace(/@([A-Za-zÀ-ÿ0-9_]+)/g, function (match, p1) {
    var tl = String(p1).toLowerCase();
    var isMention = names.some(function (n) {
      var parts = String(n).toLowerCase().split(/\s+/);
      return parts.some(function (p) { return p === tl; }) || String(n).toLowerCase() === tl;
    });
    if (isMention) return '<span style="background:#dbeafe;color:#1e40af;padding:1px 4px;border-radius:4px;font-weight:600">@' + p1 + '</span>';
    return match;
  });
}
function renderRichText(text) {
  var raw = String(text == null ? '' : text);
  if (!raw) return '';
  var re = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
  var out = '', last = 0, m;
  var safeFn = (typeof safeUrl === 'function') ? safeUrl : function () { return '#'; };
  while ((m = re.exec(raw)) !== null) {
    out += _richEsc(raw.slice(last, m.index));
    var tok = m[0];
    // Separa pontuação final (".", ",", ")", etc.) do link.
    var trail = '';
    var tm = tok.match(/[.,;:!?)\]}'"”’]+$/);
    var clean = tok;
    if (tm) { trail = tm[0]; clean = tok.slice(0, tok.length - trail.length); }
    if (!clean) { out += _richEsc(tok); last = m.index + tok.length; continue; }
    var href = clean;
    var isEmail = false;
    if (/^www\./i.test(clean)) href = 'https://' + clean;
    else if (!/^https?:\/\//i.test(clean) && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) { href = 'mailto:' + clean; isEmail = true; }
    var safe = safeFn(href);
    if (safe === '#') { out += _richEsc(clean) + _richEsc(trail); }
    else if (!isEmail && clean.length > 60) {
      out += '<a href="' + _richEsc(safe) + '" target="_blank" rel="noopener noreferrer" class="rich-link rich-link--short" title="' + _richEsc(clean) + '">🔗 Abrir link</a>' + _richEsc(trail);
    } else {
      out += '<a href="' + _richEsc(safe) + '" target="_blank" rel="noopener noreferrer" class="rich-link" title="' + _richEsc(clean) + '">' + _richEsc(clean) + '</a>' + _richEsc(trail);
    }
    last = m.index + tok.length;
  }
  out += _richEsc(raw.slice(last));
  return out;
}
// Mesma coisa + @menções (só fora dos <a>, para não quebrar href).
function renderRichNoteText(text) {
  var html = renderRichText(text);
  if (html.indexOf('<a ') === -1) return _richApplyMentions(html);
  var parts = html.split(/(<a\b[^>]*>.*?<\/a>)/g);
  for (var i = 0; i < parts.length; i++) {
    if (!/^<a\b/i.test(parts[i])) parts[i] = _richApplyMentions(parts[i]);
  }
  return parts.join('');
}
// Formatação amigável do tempo acumulado (só apresentação; o cálculo continua
// em getElapsedSeconds/formatTimer). 0 → "Nenhum tempo registrado".
function formatElapsedFriendly(totalSeconds) {
  var s = Number(totalSeconds) || 0;
  if (s < 0) s = 0;
  if (s === 0) return 'Nenhum tempo registrado';
  if (s < 60) return 'menos de 1 min';
  var m = Math.floor(s / 60);
  var h = Math.floor(m / 60);
  var rm = m % 60;
  if (h === 0) return m + 'min';
  if (rm === 0) return h + 'h';
  return h + 'h ' + String(rm).padStart(2, '0') + 'min';
}
