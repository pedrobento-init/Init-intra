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
  const concluidas = pendencias.filter(p => p.clientId === clientId && ['concluido','resolvido'].includes(p.status));
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    HEALTH_THRESHOLDS,
    getSlaStatsForClient, getAllSlaStats, sortClientsBySla,
    calculateAvgResolutionHours, calculateHealthScore, getHealthForClient,
    getWorkloadByOperator, getWorkloadInPeriod,
    compareMeetings, getConsecutiveMeetingStreak,
  };
}
