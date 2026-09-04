// metrics.js — Funções puras de agregação (SLA, saúde, carga, comparativo)
// Reaproveitadas por reunioes.js, clients.js, pendencias.js, app.js e testes.
// Sem dependência de DOM — podem rodar em Node/Vitest.

// ── Thresholds de saúde — ajuste aqui ───────────────────────────────────────
// 🟢 Verde: 0 vencidas e média < 48h e até 3 abertas
// 🟡 Amarelo: até 2 vencidas e média < 120h e até 8 abertas
// 🔴 Vermelho: demais
const HEALTH_THRESHOLDS = {
  greenMaxVencidas: 0,
  greenMaxAbertas: 3,
  greenMaxAvgHours: 48,
  yellowMaxVencidas: 2,
  yellowMaxAbertas: 8,
  yellowMaxAvgHours: 120,
};

// ── Status de êxito (puro, testável; espelha isPendenciaResolvida de ui.js) ───
// Concluído + Resolvido contam como "resolvidas" no Dashboard.
// Cancelado/Fechado são finais, mas não contam como resolvidas.
function isPendenciaResolvida(status) { return ['concluido', 'resolvido'].includes(status || ''); }

// ── SLA por cliente ─────────────────────────────────────────────────────────
function _isOverduePure(p, todayISO, isClosedFn) {
  if (!p.deadline) return false;
  if (isClosedFn(p.status)) return false;
  return p.deadline < todayISO;
}

function getSlaStatsForClient(pendencias, clientId, todayISO, isClosedFn) {
  const isClosed = isClosedFn || (s => ['concluido','resolvido','cancelado','fechado'].includes(s));
  const abertas = pendencias.filter(p => p.clientId === clientId && !isClosed(p.status));
  const vencidas = abertas.filter(p => _isOverduePure(p, todayISO, isClosed)).length;
  return { totalAbertas: abertas.length, vencidas, dentroPrazo: abertas.length - vencidas };
}

function getAllSlaStats(pendencias, todayISO, isClosedFn) {
  const isClosed = isClosedFn || (s => ['concluido','resolvido','cancelado','fechado'].includes(s));
  const map = {};
  pendencias.forEach(p => {
    if (isClosed(p.status)) return;
    const cid = p.clientId || '_sem_cliente';
    if (!map[cid]) map[cid] = { totalAbertas: 0, vencidas: 0, dentroPrazo: 0, clientName: p.clientName || cid };
    map[cid].totalAbertas++;
    if (_isOverduePure(p, todayISO, isClosed)) map[cid].vencidas++;
  });
  Object.values(map).forEach(v => { v.dentroPrazo = v.totalAbertas - v.vencidas; });
  return map;
}

// Ordenação da fila: mais vencidas primeiro, depois mais abertas, depois nome
function sortClientsBySla(clients, slaMap) {
  return clients.slice().sort((a, b) => {
    const sa = slaMap[a.id] || { vencidas: 0, totalAbertas: 0 };
    const sb = slaMap[b.id] || { vencidas: 0, totalAbertas: 0 };
    if (sb.vencidas !== sa.vencidas) return sb.vencidas - sa.vencidas;
    if (sb.totalAbertas !== sa.totalAbertas) return sb.totalAbertas - sa.totalAbertas;
    return (a.name || '').localeCompare(b.name || '', 'pt-BR', { sensitivity: 'base', numeric: true });
  });
}

// ── Tempo médio de resolução ────────────────────────────────────────────────
function calculateAvgResolutionHours(pendenciasConcluidas) {
  if (!pendenciasConcluidas.length) return null;
  let total = 0, count = 0;
  pendenciasConcluidas.forEach(p => {
    if (!p.createdAt || (!p.completedAt && !p.updatedAt)) return;
    const end = p.completedAt || p.updatedAt;
    const h = (new Date(end) - new Date(p.createdAt)) / 3600000;
    if (h >= 0 && h < 365*24) { total += h; count++; }
  });
  return count ? total / count : null;
}

// ── Score de saúde ──────────────────────────────────────────────────────────
function calculateHealthScore({ totalAbertas, vencidas, avgHours }) {
  // avgHours pode ser null (sem concluídas) — trata como 0 para não penalizar
  const avg = avgHours == null ? 0 : avgHours;
  let level, emoji, color, label;
  if (vencidas <= HEALTH_THRESHOLDS.greenMaxVencidas && totalAbertas <= HEALTH_THRESHOLDS.greenMaxAbertas && avg <= HEALTH_THRESHOLDS.greenMaxAvgHours) {
    level = 'green'; emoji = '🟢'; color = '#16a34a'; label = 'Saudável';
  } else if (vencidas <= HEALTH_THRESHOLDS.yellowMaxVencidas && totalAbertas <= HEALTH_THRESHOLDS.yellowMaxAbertas && avg <= HEALTH_THRESHOLDS.yellowMaxAvgHours) {
    level = 'yellow'; emoji = '🟡'; color = '#d97706'; label = 'Atenção';
  } else {
    level = 'red'; emoji = '🔴'; color = '#dc2626'; label = 'Crítico';
  }
  return { level, emoji, color, label, totalAbertas, vencidas, avgHours: avg };
}

function getHealthForClient(pendencias, clientId, todayISO, isClosedFn) {
  const sla = getSlaStatsForClient(pendencias, clientId, todayISO, isClosedFn);
  const concluidas = pendencias.filter(p => p.clientId === clientId && isPendenciaResolvida(p.status));
  const avg = calculateAvgResolutionHours(concluidas);
  return calculateHealthScore({ totalAbertas: sla.totalAbertas, vencidas: sla.vencidas, avgHours: avg });
}

// ── Carga por operador (timer.js) ───────────────────────────────────────────
function getWorkloadByOperator(pendencias, getElapsedSecondsFn) {
  const map = {};
  pendencias.forEach(p => {
    const secs = getElapsedSecondsFn(p) || 0;
    if (secs <= 0) return;
    const key = p.timerOperator || p.responsible || 'Sem responsável';
    map[key] = (map[key] || 0) + secs;
  });
  return map; // operator -> totalSeconds
}

function getWorkloadInPeriod(pendencias, getElapsedSecondsFn, periodFilterFn) {
  const filtered = periodFilterFn ? pendencias.filter(periodFilterFn) : pendencias;
  return getWorkloadByOperator(filtered, getElapsedSecondsFn);
}

// ── Comparativo mês a mês ───────────────────────────────────────────────────
function compareMeetings(mesA, mesB, pendencias, clients) {
  // Conta pendências vinculadas a cada reunião via reviewedInMeeting == REU-YYYY-MM
  // e snapshot atual de abertas por cliente
  const idA = 'REU-' + mesA;
  const idB = 'REU-' + mesB;
  const today = new Date().toISOString().slice(0,10);
  const isClosed = s => ['concluido','resolvido','cancelado','fechado'].includes(s);
  return clients.map(c => {
    const pensA = pendencias.filter(p => p.clientId === c.id && p.reviewedInMeeting === idA);
    const pensB = pendencias.filter(p => p.clientId === c.id && p.reviewedInMeeting === idB);
    const abertasA = pensA.filter(p => !isClosed(p.status)).length;
    const fechadasA = pensA.filter(p => isClosed(p.status)).length;
    const abertasB = pensB.filter(p => !isClosed(p.status)).length;
    const fechadasB = pensB.filter(p => isClosed(p.status)).length;
    return {
      clientId: c.id, clientName: c.name,
      abertasA, fechadasA,
      abertasB, fechadasB,
      deltaAbertas: abertasB - abertasA,
      totalReviewedA: pensA.length, totalReviewedB: pensB.length,
    };
  }).filter(r => r.totalReviewedA > 0 || r.totalReviewedB > 0);
}

// ── Streak N meses seguidos ─────────────────────────────────────────────────
function getConsecutiveMeetingStreak(clientId, reunioesSortedDesc, pendencias) {
  // reunioesSortedDesc: [{mesAno, status, id}] ordenadas do mais recente para o mais antigo, apenas encerradas/abertas
  // Conta quantas reuniões consecutivas o cliente teve pendência com reviewedInMeeting preenchido
  let streak = 0;
  for (const r of reunioesSortedDesc) {
    const mid = r.id || ('REU-' + r.mesAno);
    const has = pendencias.some(p => p.clientId === clientId && p.reviewedInMeeting === mid);
    if (has) streak++;
    else break;
  }
  return streak;
}

// ── Minha fila do dia (Dashboard) ───────────────────────────────────────────
const PRIORITY_WEIGHT = { critica: 4, alta: 3, media: 2, baixa: 1 };

function _addDaysISO(iso, days) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function getMinhaFilaDoDia(pendencias, userName, todayISO, opts) {
  opts = opts || {};
  const isClosed = opts.isClosedFn || function(s) { return ['concluido','resolvido','cancelado','fechado'].includes(s); };
  const isStale = opts.isStaleFn || function(p) {
    if (!p || isClosed(p.status)) return false;
    const ref = p.updatedAt || p.createdAt;
    if (!ref) return false;
    return ((Date.now() - new Date(ref).getTime()) / 86400000) >= 7;
  };
  const tomorrowISO = opts.tomorrowISO || _addDaysISO(todayISO, 1);
  const filtered = (pendencias || []).filter(function(p) {
    if (isClosed(p.status)) return false;
    if ((p.responsible || '') !== (userName || '')) return false;
    const highPri = ['alta','critica'].includes(p.priority);
    const dueSoon = p.deadline === todayISO || p.deadline === tomorrowISO || (p.deadline && p.deadline < todayISO);
    const stale = isStale(p);
    return highPri || dueSoon || stale === true;
  });
  filtered.sort(function(a, b) {
    const aOver = a.deadline && a.deadline < todayISO ? 1 : 0;
    const bOver = b.deadline && b.deadline < todayISO ? 1 : 0;
    if (bOver !== aOver) return bOver - aOver;
    const aW = PRIORITY_WEIGHT[a.priority] || 0;
    const bW = PRIORITY_WEIGHT[b.priority] || 0;
    if (bW !== aW) return bW - aW;
    const aStale = isStale(a) ? 1 : 0;
    const bStale = isStale(b) ? 1 : 0;
    if (bStale !== aStale) return bStale - aStale;
    if (a.deadline && b.deadline && a.deadline !== b.deadline) return a.deadline.localeCompare(b.deadline);
    return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
  });
  return filtered;
}

// ── Busca global helpers (puros) ────────────────────────────────────────────
function _escapeForSnippet(str) {
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
  let snippet = _escapeForSnippet(before) + '<mark>' + _escapeForSnippet(match) + '</mark>' + _escapeForSnippet(after);
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

// ── Dashboard: comparativo com período anterior ─────────────────────────────
// Períodos espelham getDashDateRange() de app.js (week/month/quarter/custom).
// refDate: Date (default hoje). customStart/customEnd: 'YYYY-MM-DD'.
function getPreviousDashRange(period, customStart, customEnd, refDate) {
  const today = refDate ? new Date(refDate.getTime()) : new Date();
  today.setHours(0, 0, 0, 0);
  const day = 86400000;
  if (period === 'week') {
    const dow = (today.getDay() + 6) % 7; // segunda=0
    const start = new Date(today.getTime() - dow * day);
    const prevEnd = new Date(start.getTime() - day);
    const prevStart = new Date(prevEnd.getTime() - 6 * day);
    prevEnd.setHours(23, 59, 59, 999);
    return { start: prevStart, end: prevEnd };
  }
  if (period === 'month') {
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const end = new Date(today.getFullYear(), today.getMonth(), 0);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }
  if (period === 'quarter') {
    const q = Math.floor(today.getMonth() / 3);
    const start = new Date(today.getFullYear(), q * 3 - 3, 1);
    const end = new Date(today.getFullYear(), q * 3, 0);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }
  if (period === 'custom' && customStart && customEnd) {
    const s = new Date(customStart + 'T00:00:00');
    const e = new Date(customEnd + 'T23:59:59');
    if (isNaN(s) || isNaN(e) || e < s) return null;
    const len = e.getTime() - s.getTime();
    const prevEnd = new Date(s.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - len);
    return { start: prevStart, end: prevEnd };
  }
  return null; // 'all' não tem anterior
}

// current/previous: números. higherIsBetter define o que é melhora.
// Retorna { pct, direction: 'up'|'down'|'flat', improved: bool|null }
function calcPeriodDelta(current, previous, higherIsBetter) {
  const cur = Number(current) || 0;
  const prev = Number(previous) || 0;
  if (prev === 0 && cur === 0) return { pct: 0, direction: 'flat', improved: null };
  if (prev === 0) return { pct: 100, direction: 'up', improved: higherIsBetter === true };
  const pct = Math.round(((cur - prev) / Math.abs(prev)) * 100);
  const direction = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
  let improved = null;
  if (direction !== 'flat') {
    improved = higherIsBetter ? direction === 'up' : direction === 'down';
  }
  return { pct: Math.abs(pct), direction, improved };
}

function _parseDashItemDate(item) {
  const raw = item.date || item.createdAt || item.updatedAt || 0;
  if (!raw) return new Date(0);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(raw))) {
    const m = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  return new Date(raw);
}

function filterItemsByDateRange(items, start, end) {
  if (!start || !end) return (items || []).slice();
  return (items || []).filter((it) => {
    const d = _parseDashItemDate(it);
    return d >= start && d <= end;
  });
}

// Agregado reutilizado pelo comparativo (evita duplicar lógica do Dashboard).
// Retorna { open, avgSlaHours, completionRate }
function calcPeriodStats(pens, isClosedFn) {
  const isClosed = isClosedFn || ((s) => ['concluido', 'resolvido', 'cancelado', 'fechado'].includes(s));
  const list = pens || [];
  const active = list.filter((p) => !isClosed(p.status));
  const open = active.length;
  const resolved = list.filter((p) => isPendenciaResolvida(p.status)).length;
  const completionRate = list.length ? Math.round((resolved / list.length) * 100) : 0;
  const done = list.filter((p) => isPendenciaResolvida(p.status) && p.createdAt && (p.completedAt || p.updatedAt));
  let total = 0; let count = 0;
  done.forEach((p) => {
    const h = (new Date(p.completedAt || p.updatedAt) - new Date(p.createdAt)) / 3600000;
    if (h >= 0 && h < 365 * 24) { total += h; count++; }
  });
  const avgSlaHours = count > 0 ? Number((total / count).toFixed(1)) : 0;
  return { open, avgSlaHours, completionRate };
}

// ── Dashboard: silêncio do cliente ──────────────────────────────────────────
const DASH_SILENCE_DAYS = 30;

function _toTime(v) {
  if (!v) return 0;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return new Date(String(v) + 'T12:00:00').getTime();
  const t = new Date(v).getTime();
  return isNaN(t) ? 0 : t;
}

function getClientLastContact(clientId, pendencias, visits, nowMs) {
  const now = nowMs || Date.now();
  void now;
  let last = 0;
  (pendencias || []).forEach((p) => {
    if (p.clientId !== clientId) return;
    last = Math.max(last, _toTime(p.createdAt), _toTime(p.updatedAt));
    (p.notes || []).forEach((n) => { last = Math.max(last, _toTime(n.createdAt || n.timestamp)); });
  });
  (visits || []).forEach((v) => {
    if (v.clientId !== clientId) return;
    last = Math.max(last, _toTime(v.date), _toTime(v.createdAt), _toTime(v.updatedAt));
  });
  return last || null;
}

// Lista clientes sem contato há >= days (ordenados pelo mais silencioso).
// nowISO: 'YYYY-MM-DD' opcional para testes determinísticos.
function getSilentClients(clients, pendencias, visits, days, nowISO) {
  const threshold = days == null ? DASH_SILENCE_DAYS : days;
  const now = nowISO ? new Date(nowISO + 'T12:00:00').getTime() : Date.now();
  const out = [];
  (clients || []).forEach((c) => {
    const last = getClientLastContact(c.id, pendencias, visits, now);
    const daysSince = last ? Math.floor((now - last) / 86400000) : 9999;
    if (daysSince >= threshold) out.push({ client: c, clientId: c.id, clientName: c.name, lastContact: last, daysSince });
  });
  out.sort((a, b) => b.daysSince - a.daysSince);
  return out;
}

// ── Dashboard: aniversário de cliente (mês corrente) ────────────────────────
// Usa createdAt do cliente. Retorna [{ client, years }] ordenado por years desc.
function getClientAnniversaries(clients, refDate) {
  const ref = refDate ? new Date(refDate.getTime()) : new Date();
  const month = ref.getMonth();
  const year = ref.getFullYear();
  const out = [];
  (clients || []).forEach((c) => {
    if (!c.createdAt) return;
    const d = new Date(c.createdAt);
    if (isNaN(d)) return;
    if (d.getMonth() !== month) return;
    const years = year - d.getFullYear();
    if (years < 1) return;
    out.push({ client: c, clientId: c.id, clientName: c.name, years, since: c.createdAt });
  });
  out.sort((a, b) => b.years - a.years || String(a.clientName).localeCompare(String(b.clientName), 'pt-BR'));
  return out;
}

// ── Dashboard: recorrência (top N meses seguidos) ───────────────────────────
function getRecurrentClients(clients, reunioesSortedDesc, pendencias, minStreak, limit) {
  const min = minStreak == null ? 2 : minStreak;
  const lim = limit == null ? 5 : limit;
  const out = [];
  (clients || []).forEach((c) => {
    const streak = getConsecutiveMeetingStreak(c.id, reunioesSortedDesc || [], pendencias || []);
    if (streak >= min) out.push({ client: c, clientId: c.id, clientName: c.name, streak });
  });
  out.sort((a, b) => b.streak - a.streak || String(a.clientName).localeCompare(String(b.clientName), 'pt-BR'));
  return out.slice(0, lim);
}

// ── Dashboard: ranking de risco (piores scores primeiro) ────────────────────
function getRiskRanking(clients, pendencias, todayISO, limit, isClosedFn) {
  const lim = limit == null ? 5 : limit;
  const today = todayISO || new Date().toISOString().slice(0, 10);
  const rankWeight = { red: 0, yellow: 1, green: 2 };
  const rows = (clients || []).map((c) => {
    const health = getHealthForClient(pendencias || [], c.id, today, isClosedFn);
    return { client: c, clientId: c.id, clientName: c.name, health };
  });
  rows.sort((a, b) => {
    const wa = rankWeight[a.health.level] ?? 9;
    const wb = rankWeight[b.health.level] ?? 9;
    if (wa !== wb) return wa - wb;
    if (b.health.vencidas !== a.health.vencidas) return b.health.vencidas - a.health.vencidas;
    if (b.health.totalAbertas !== a.health.totalAbertas) return b.health.totalAbertas - a.health.totalAbertas;
    const avgA = a.health.avgHours || 0; const avgB = b.health.avgHours || 0;
    if (avgB !== avgA) return avgB - avgA;
    return String(a.clientName).localeCompare(String(b.clientName), 'pt-BR');
  });
  // Mantém apenas quem tem algo aberto (evita poluir com saudáveis zerados),
  // mas se ninguém tiver pendência, retorna os primeiros mesmo assim.
  const withOpen = rows.filter((r) => r.health.totalAbertas > 0);
  return (withOpen.length ? withOpen : rows).slice(0, lim);
}

// ── Dashboard: próxima reunião ──────────────────────────────────────────────
// Prioriza status === 'aberta' ordenada por mesAno asc; senão a mais recente.
function getNextMeeting(reunioes, team) {
  const list = (reunioes || []).filter((r) => !team || (r.team || 'init') === team);
  if (!list.length) return null;
  const open = list.filter((r) => r.status === 'aberta').sort((a, b) => String(a.mesAno || '').localeCompare(String(b.mesAno || '')));
  if (open.length) return open[0];
  return list.slice().sort((a, b) => String(b.mesAno || '').localeCompare(String(a.mesAno || '')))[0] || null;
}

// ── Dashboard: resumo do dia (template puro, sem IA) ────────────────────────
function buildDaySummary({ dueToday, todayVisits, overloadedOps, onLeaveOps }) {
  const d = (dueToday || []).length != null ? (Array.isArray(dueToday) ? dueToday.length : dueToday) : 0;
  const v = (todayVisits || []).length != null ? (Array.isArray(todayVisits) ? todayVisits.length : todayVisits) : 0;
  let s = `Hoje: ${d} pendência(s) vencem, ${v} visita(s) agendada(s).`;
  const extras = [];
  (overloadedOps || []).forEach((o) => {
    const name = typeof o === 'string' ? o : o.name;
    const n = typeof o === 'object' && o.count != null ? ` (${o.count} ativas)` : '';
    extras.push(`${name} está sobrecarregado${n}`);
  });
  (onLeaveOps || []).forEach((o) => {
    const name = typeof o === 'string' ? o : o.name;
    extras.push(`${name} está afastado`);
  });
  if (extras.length) s += ' Atenção: ' + extras.join('; ') + '.';
  return s;
}

// ── ASSUNTO x DESCRIÇÃO da pendência (puro, testável) ────────────────────────
// Espelha os helpers globais de ui.js: `assunto` é o título; registros antigos
// sem `assunto` usam `descricao` como fallback de leitura.
function getPendenciaAssunto(p) { return String((p && p.assunto) || '').trim(); }
function getPendenciaTitulo(p) {
  const a = getPendenciaAssunto(p);
  if (a) return a;
  const d = String((p && p.descricao) || '').trim();
  return d || 'Sem descrição';
}

// ── Número amigável de exibição da pendência (#001, #002, ...) ───────────────
// SOMENTE apresentação: o id interno (ex: PEN-xxxx) continua intacto e é o
// único usado em banco, sync, URLs e lógica. A numeração é a posição (1-based)
// na lista ordenada por createdAt asc (desempate por id), sem buracos: ao
// excluir uma pendência, as posteriores "andam" um número. Não persiste nada.
function getPendenciaDisplayNumber(pendencias, id) {
  const list = Array.isArray(pendencias) ? pendencias.slice() : [];
  list.sort((a, b) => {
    const byDate = String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    if (byDate !== 0) return byDate;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
  const idx = list.findIndex((p) => p.id === id);
  if (idx === -1) return '#---';
  return '#' + String(idx + 1).padStart(3, '0');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    HEALTH_THRESHOLDS, DASH_SILENCE_DAYS,
    getSlaStatsForClient, getAllSlaStats, sortClientsBySla,
    calculateAvgResolutionHours, calculateHealthScore, getHealthForClient,
    getWorkloadByOperator, getWorkloadInPeriod,
    compareMeetings, getConsecutiveMeetingStreak,
    PRIORITY_WEIGHT, getMinhaFilaDoDia, getNoteSnippet, parseSearchShortcuts,
    getPreviousDashRange, calcPeriodDelta, filterItemsByDateRange, calcPeriodStats,
    getClientLastContact, getSilentClients, getClientAnniversaries,
    getRecurrentClients, getRiskRanking, getNextMeeting, buildDaySummary,
    getPendenciaDisplayNumber, getPendenciaAssunto, getPendenciaTitulo,
    isPendenciaResolvida,
  };
}
