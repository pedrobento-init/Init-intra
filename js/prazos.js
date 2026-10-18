// prazos.js – "Prazos e SLA": visão de gestão dos prazos das pendências.
// Complementa a Minha fila (que mostra só o que é do técnico): aqui o
// gestor vê, por responsável ou por cliente, o que venceu, o que vence hoje
// e nos próximos dias, o que está sem prazo e quanto foi entregue no prazo.

const PRAZOS_SOON_DAYS = 3;     // "vence em breve" = até 3 dias
const PRAZOS_HIT_WINDOW = 30;   // cumprimento: concluídas nos últimos 30 dias
const PRAZOS_GROUP_KEY = 'intra_prazos_group_v1';

function _prazosClosed(status) {
  if (typeof isPendenciaClosed === 'function') return isPendenciaClosed(status);
  return ['concluido', 'resolvido', 'cancelado', 'fechado'].includes(status || '');
}

function _prazosResolved(status) {
  return ['concluido', 'resolvido'].includes(status || '');
}

/** Dias entre duas datas YYYY-MM-DD (b - a). */
function prazosDaysBetween(a, b) {
  const ta = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10));
  const tb = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10));
  return Math.round((tb - ta) / 86400000);
}

/** Data local YYYY-MM-DD de um ISO (completedAt é timestamp). */
function _prazosLocalDate(iso) {
  if (!iso) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** Faixa do prazo de uma pendência aberta: vencida | hoje | breve | semana | futuro | sem_prazo. */
function classifyDeadline(p, todayISO) {
  if (!p || !p.deadline) return 'sem_prazo';
  const d = prazosDaysBetween(todayISO, String(p.deadline).slice(0, 10));
  if (d < 0) return 'vencida';
  if (d === 0) return 'hoje';
  if (d <= PRAZOS_SOON_DAYS) return 'breve';
  if (d <= 7) return 'semana';
  return 'futuro';
}

/**
 * Modelo puro do painel (testável).
 * @param {object[]} pens  pendências já no escopo (equipe)
 * @param {string} todayISO
 * @param {{groupBy?: 'responsavel'|'cliente'}} [opts]
 */
function buildPrazosModel(pens, todayISO, opts) {
  const groupBy = (opts && opts.groupBy) === 'cliente' ? 'cliente' : 'responsavel';
  const since = (() => {
    const d = new Date(todayISO + 'T12:00:00');
    d.setDate(d.getDate() - PRAZOS_HIT_WINDOW);
    return _prazosLocalDate(d.toISOString());
  })();
  const keyOf = (p) => groupBy === 'cliente'
    ? { key: p.clientId || '_sem', label: p.clientName || 'Sem cliente' }
    : { key: p.responsible || '_sem', label: p.responsible || 'Sem responsável' };

  const kpis = { abertas: 0, vencidas: 0, hoje: 0, breve: 0, semPrazo: 0, noPrazo: 0, entregues: 0, pct: null };
  const groups = new Map();
  const group = (p) => {
    const k = keyOf(p);
    if (!groups.has(k.key)) {
      groups.set(k.key, { key: k.key, label: k.label, abertas: 0, vencidas: 0, hoje: 0, breve: 0, semPrazo: 0, piorAtraso: 0, noPrazo: 0, entregues: 0, pct: null, items: [] });
    }
    return groups.get(k.key);
  };

  for (const p of pens || []) {
    if (!p) continue;
    if (_prazosClosed(p.status)) {
      // Cumprimento: só o que tinha prazo e foi entregue na janela.
      if (!_prazosResolved(p.status) || !p.deadline) continue;
      const done = _prazosLocalDate(p.completedAt || p.updatedAt);
      if (!done || done < since || done > todayISO) continue;
      const g = group(p);
      const ok = done <= String(p.deadline).slice(0, 10);
      g.entregues++; kpis.entregues++;
      if (ok) { g.noPrazo++; kpis.noPrazo++; }
      continue;
    }
    const band = classifyDeadline(p, todayISO);
    const g = group(p);
    g.abertas++; kpis.abertas++;
    if (band === 'vencida') {
      g.vencidas++; kpis.vencidas++;
      g.piorAtraso = Math.max(g.piorAtraso, -prazosDaysBetween(todayISO, String(p.deadline).slice(0, 10)));
    } else if (band === 'hoje') { g.hoje++; kpis.hoje++; }
    else if (band === 'breve') { g.breve++; kpis.breve++; }
    else if (band === 'sem_prazo') { g.semPrazo++; kpis.semPrazo++; }
    g.items.push({ p, band });
  }

  const order = { vencida: 0, hoje: 1, breve: 2, semana: 3, futuro: 4, sem_prazo: 5 };
  const list = [...groups.values()];
  for (const g of list) {
    g.pct = g.entregues ? Math.round((g.noPrazo / g.entregues) * 100) : null;
    g.items.sort((a, b) => (order[a.band] - order[b.band]) ||
      String(a.p.deadline || '9999').localeCompare(String(b.p.deadline || '9999')));
  }
  kpis.pct = kpis.entregues ? Math.round((kpis.noPrazo / kpis.entregues) * 100) : null;
  // Quem tem mais risco primeiro; grupos só com entregues (nada aberto) por último.
  list.sort((a, b) => (b.vencidas - a.vencidas) || (b.hoje - a.hoje) || (b.breve - a.breve) ||
    (b.abertas - a.abertas) || a.label.localeCompare(b.label, 'pt-BR', { sensitivity: 'base' }));
  return { groupBy, kpis, groups: list };
}

// ── Tela ────────────────────────────────────────────────────────────────

let _prazosGroupBy = null;
let _prazosOpen = new Set();
let _prazosOnlyRisk = false;

function _prazosLoadGroup() {
  if (_prazosGroupBy) return _prazosGroupBy;
  let v = 'responsavel';
  try { v = localStorage.getItem(PRAZOS_GROUP_KEY) || v; } catch (_) {}
  _prazosGroupBy = v === 'cliente' ? 'cliente' : 'responsavel';
  return _prazosGroupBy;
}

function setPrazosGroup(v) {
  _prazosGroupBy = v === 'cliente' ? 'cliente' : 'responsavel';
  _prazosOpen = new Set();
  try { localStorage.setItem(PRAZOS_GROUP_KEY, _prazosGroupBy); } catch (_) {}
  renderPrazos();
}

function togglePrazosRisk() {
  _prazosOnlyRisk = !_prazosOnlyRisk;
  renderPrazos();
}

// A chave vai no data-key (nome com apóstrofo quebraria um onclick inline).
function togglePrazosGroup(btn) {
  const row = btn && btn.closest ? btn.closest('.pz-group') : null;
  if (!row) return;
  const key = row.dataset.key;
  if (_prazosOpen.has(key)) _prazosOpen.delete(key); else _prazosOpen.add(key);
  const open = _prazosOpen.has(key);
  row.classList.toggle('is-open', open);
  btn.setAttribute('aria-expanded', String(open));
}

function _prazosScope() {
  const team = (typeof isTeamAdmin === 'function' && isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam) ? _selectedTeam : null;
  const pens = team && typeof getPendenciasByTeam === 'function' ? getPendenciasByTeam(team) : (typeof getMyPendencias === 'function' ? getMyPendencias() : []);
  const today = typeof localDateISO === 'function' ? localDateISO() : new Date().toISOString().slice(0, 10);
  return { pens, today };
}

function _prazosBandLabel(p, band, today) {
  if (band === 'sem_prazo') return '<span class="fila-due">Sem prazo</span>';
  const d = prazosDaysBetween(today, String(p.deadline).slice(0, 10));
  if (band === 'vencida') return '<span class="fila-due is-over">' + (-d === 1 ? 'Venceu ontem' : 'Venceu há ' + (-d) + ' dias') + '</span>';
  if (band === 'hoje') return '<span class="fila-due is-today">Vence hoje</span>';
  if (band === 'breve') return '<span class="fila-due is-soon">' + (d === 1 ? 'Vence amanhã' : 'Em ' + d + ' dias') + '</span>';
  return '<span class="fila-due">' + escapeHtml(formatDate(p.deadline)) + '</span>';
}

function _prazosItemRow(it, today, groupBy) {
  const p = it.p;
  const num = typeof penDisplayNumber === 'function' ? penDisplayNumber(p) : '';
  const pri = typeof penPriColor === 'function' ? penPriColor(p.priority) : 'var(--ds-muted)';
  const title = typeof getPendenciaTitulo === 'function' ? getPendenciaTitulo(p) : (p.assunto || '');
  const other = groupBy === 'cliente' ? (p.responsible || 'Sem responsável') : (p.clientName || 'Sem cliente');
  return '<li class="fila-row" onclick="openPendenciaDetail(\'' + escapeHtml(p.id) + '\')">' +
    '<span class="fila-dot" style="--c:' + pri + '" aria-hidden="true"></span>' +
    '<span class="fila-main"><span class="fila-title"><small>' + escapeHtml(num) + '</small>' + escapeHtml(title) + '</span>' +
    '<span class="fila-meta">' + escapeHtml(other) + '</span></span>' +
    _prazosBandLabel(p, it.band, today) + '</li>';
}

function _prazosPct(pct) {
  if (pct === null) return '<span class="pz-pct is-none" title="Nada com prazo entregue nos últimos 30 dias">—</span>';
  const cls = pct >= 85 ? 'is-ok' : pct >= 60 ? 'is-warn' : 'is-bad';
  return '<span class="pz-pct ' + cls + '">' + pct + '%</span>';
}

function renderPrazos() {
  document.getElementById('pageTitle').textContent = 'Prazos e SLA';
  const groupBy = _prazosLoadGroup();
  const s = _prazosScope();
  const m = buildPrazosModel(s.pens, s.today, { groupBy });
  const k = m.kpis;
  const groups = _prazosOnlyRisk ? m.groups.filter((g) => g.vencidas || g.hoje || g.breve) : m.groups.filter((g) => g.abertas || g.entregues);
  const who = groupBy === 'cliente' ? 'cliente' : 'responsável';

  const kpi = (n, label, cls, extra) => '<div class="ov-k ov-k-static ' + (cls || '') + '"><b>' + n + '</b><span>' + label + (extra ? ' <small>' + extra + '</small>' : '') + '</span></div>';
  const groupHtml = groups.map((g) => {
    const open = _prazosOpen.has(g.key);
    const chips = [
      g.vencidas ? '<span class="pz-chip is-over">' + g.vencidas + ' vencida' + (g.vencidas === 1 ? '' : 's') + '</span>' : '',
      g.hoje ? '<span class="pz-chip is-today">' + g.hoje + ' hoje</span>' : '',
      g.breve ? '<span class="pz-chip is-soon">' + g.breve + ' em breve</span>' : '',
      g.semPrazo ? '<span class="pz-chip">' + g.semPrazo + ' sem prazo</span>' : '',
    ].join('');
    const items = g.items.filter((it) => !_prazosOnlyRisk || ['vencida', 'hoje', 'breve'].includes(it.band));
    return '<li class="pz-group' + (open ? ' is-open' : '') + '" data-key="' + escapeHtml(g.key) + '">' +
      '<button type="button" class="pz-head" aria-expanded="' + open + '" onclick="togglePrazosGroup(this)">' +
        '<svg class="pz-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>' +
        '<span class="pz-name">' + escapeHtml(g.label) + '</span>' +
        '<span class="pz-chips">' + chips + '</span>' +
        '<span class="pz-open" title="Abertas">' + g.abertas + '<small> abertas</small></span>' +
        '<span class="pz-late" title="Maior atraso">' + (g.piorAtraso ? g.piorAtraso + 'd<small> atraso</small>' : '') + '</span>' +
        _prazosPct(g.pct) +
      '</button>' +
      '<ul class="fila-list pz-items">' + (items.length ? items.map((it) => _prazosItemRow(it, s.today, groupBy)).join('') : '<li class="pz-empty">Nada em aberto.</li>') + '</ul>' +
    '</li>';
  }).join('');

  document.getElementById('contentArea').innerHTML =
    '<div class="ov-wrap prazos">' +
      '<div class="ov-bar">' +
        '<div class="ov-seg" role="group" aria-label="Agrupar por">' +
          '<button type="button" class="period-btn' + (groupBy === 'responsavel' ? ' active' : '') + '" aria-pressed="' + (groupBy === 'responsavel') + '" onclick="setPrazosGroup(\'responsavel\')">Por responsável</button>' +
          '<button type="button" class="period-btn' + (groupBy === 'cliente' ? ' active' : '') + '" aria-pressed="' + (groupBy === 'cliente') + '" onclick="setPrazosGroup(\'cliente\')">Por cliente</button>' +
        '</div>' +
        '<label class="pz-toggle"><input type="checkbox"' + (_prazosOnlyRisk ? ' checked' : '') + ' onchange="togglePrazosRisk()"> Só com risco</label>' +
      '</div>' +
      '<div class="ov-kpis pz-kpis">' +
        kpi(k.vencidas, 'Vencidas', k.vencidas ? 'red' : '') +
        kpi(k.hoje, 'Vencem hoje', k.hoje ? 'amber' : '') +
        kpi(k.breve, 'Próximos ' + PRAZOS_SOON_DAYS + ' dias') +
        kpi(k.semPrazo, 'Sem prazo') +
        kpi(k.pct === null ? '—' : k.pct + '%', 'Entregues no prazo', '', k.entregues ? '(' + k.noPrazo + ' de ' + k.entregues + ', 30 dias)' : '(30 dias)') +
      '</div>' +
      '<section class="card ov-panel">' +
        '<div class="ov-ph"><h2 class="ov-h2">Por ' + who + '</h2><span class="ov-sub">' + k.abertas + ' em aberto · % no prazo nos últimos 30 dias</span></div>' +
        (groupHtml ? '<ul class="pz-list">' + groupHtml + '</ul>'
          : '<div class="empty-state"><p>' + (_prazosOnlyRisk ? 'Nenhum prazo em risco. 🎉' : 'Nenhuma pendência em aberto.') + '</p></div>') +
      '</section>' +
    '</div>';
}

// Atualiza sozinho quando pendências mudam (local, sync ou realtime).
(function () {
  if (typeof window === 'undefined' || typeof onDataChanged !== 'function' || window._prazosAutoRefresh) return;
  window._prazosAutoRefresh = true;
  onDataChanged('pendencias', function () {
    try {
      if ((window.location.hash || '').replace('#', '') !== 'prazos') return;
      if (typeof preserveScrollAround === 'function') preserveScrollAround(renderPrazos); else renderPrazos();
    } catch (_) {}
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildPrazosModel, classifyDeadline, prazosDaysBetween, PRAZOS_SOON_DAYS };
}
