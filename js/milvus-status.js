// milvus-status.js — Status do chamado no Milvus, de volta para o app
// =====================================================================
// O app já abre e finaliza chamados (milvus-chamado.js). Aqui é o caminho
// de volta: o que aconteceu com o chamado LÁ (técnico assumiu, pausou,
// finalizou direto no Milvus). Fluxo: frontend → Edge `milvus-chamado-status`
// (valida JWT + equipe; o código vem do banco) → status atual.
//
// Sem colunas novas: o resultado fica num cache local por visita (cada
// aparelho consulta o seu, com TTL). Única escrita na visita: se o Milvus
// diz "finalizado" e a etapa de finalização do app ainda estava pendente ou
// com erro, ela é dada como feita (evita tentar finalizar de novo e cair
// em "chamado não está em atendimento").

const MILVUS_STATUS_EDGE = 'milvus-chamado-status';
const MILVUS_STATUS_KEY = 'intra_milvus_status_v1';
const MILVUS_STATUS_OFF_KEY = 'intra_milvus_status_off_until';
const MILVUS_STATUS_TTL_OPEN_MS = 15 * 60 * 1000;      // chamado aberto: 15 min
const MILVUS_STATUS_TTL_DONE_MS = 12 * 60 * 60 * 1000; // finalizado: 12 h
const MILVUS_STATUS_MAX_PER_CALL = 25;
const MILVUS_STATUS_RECENT_DAYS = 60;                  // visitas antigas finalizadas saem da varredura

const MILVUS_STATUS_KINDS = {
  aguardando: { label: 'Aguardando no Milvus', tone: 'warn' },
  atendimento: { label: 'Em atendimento no Milvus', tone: 'info' },
  pausado: { label: 'Pausado no Milvus', tone: 'warn' },
  finalizado: { label: 'Finalizado no Milvus', tone: 'ok' },
  cancelado: { label: 'Cancelado no Milvus', tone: 'muted' },
  nao_encontrado: { label: 'Não encontrado no Milvus', tone: 'muted' },
};

// Status textual do Milvus → tipo (puro, testável). Espelha a regra de
// findChamadoStatus na Edge milvus-chamado-create.
function classifyMilvusTicketStatus(status) {
  const s = String(status || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
  if (!s) return 'aguardando';
  if (s.includes('finaliz') || s.includes('conclu') || s.includes('resolvid')) return 'finalizado';
  if (s.includes('cancel')) return 'cancelado';
  if (s.includes('paus')) return 'pausado';
  if (['afazer', 'agatendimento', 'novo', 'aberto', 'agendado', 'semtecnico'].includes(s) || s.startsWith('aguard')) return 'aguardando';
  return 'atendimento';
}

function _mstLoad() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(MILVUS_STATUS_KEY) : null;
    const v = raw ? JSON.parse(raw) : {};
    return v && typeof v === 'object' ? v : {};
  } catch (_) { return {}; }
}

function _mstSave(map) {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(MILVUS_STATUS_KEY, JSON.stringify(map)); } catch (_) {}
}

function getMilvusStatusEntry(visitId) {
  const e = _mstLoad()[visitId];
  return e && typeof e === 'object' ? e : null;
}

/** Linha da Edge → entrada do cache (pura). */
function toMilvusStatusEntry(row, nowIso) {
  return {
    codigo: Number(row.codigo) || null,
    kind: row.found === false ? 'nao_encontrado' : classifyMilvusTicketStatus(row.status),
    status: String(row.status || ''),
    tecnico: String(row.tecnico || ''),
    modificado: row.data_modificacao || null,
    solucao: row.data_solucao || null,
    ultimaLog: row.ultima_log && row.ultima_log.texto ? { texto: String(row.ultima_log.texto), data: row.ultima_log.data || null, tecnico: String(row.ultima_log.tecnico || '') } : null,
    checkedAt: nowIso,
  };
}

/**
 * Quais visitas consultar agora (pura, testável): com chamado criado, cache
 * vencido (TTL por tipo) e, se antigas, só enquanto o chamado não fechou.
 */
function pickVisitsForMilvusStatus(visits, cache, nowMs, opts) {
  const force = new Set((opts && opts.force) || []);
  const max = (opts && opts.max) || MILVUS_STATUS_MAX_PER_CALL;
  const cutoff = new Date(nowMs - MILVUS_STATUS_RECENT_DAYS * 86400000).toISOString().slice(0, 10);
  const due = [];
  for (const v of visits || []) {
    if (!v || !v.id || !(Number(v.milvusChamadoCodigo) > 0)) continue;
    const e = cache && cache[v.id];
    if (force.has(v.id)) { due.push({ v, rank: -1 }); continue; }
    if (e && Number(e.codigo) === Number(v.milvusChamadoCodigo)) {
      const closed = e.kind === 'finalizado' || e.kind === 'cancelado' || e.kind === 'nao_encontrado';
      if (closed && String(v.date || '') < cutoff) continue;
      const ttl = closed ? MILVUS_STATUS_TTL_DONE_MS : MILVUS_STATUS_TTL_OPEN_MS;
      const age = nowMs - new Date(e.checkedAt || 0).getTime();
      if (age < ttl) continue;
    } else if (String(v.date || '') < cutoff && v.milvusFinalizarStatus === 'finalizado') {
      continue;
    }
    due.push({ v, rank: 0 });
  }
  due.sort((a, b) => (a.rank - b.rank) || String(b.v.date || '').localeCompare(String(a.v.date || '')));
  return due.slice(0, max).map((x) => x.v.id);
}

/**
 * Milvus finalizou mas a etapa de finalização do app ficou pendente/erro →
 * dá como feita (pura; null = nada a mudar). 'finalizando' (em voo) não mexe.
 */
function reconcileFinalizeFromMilvus(visit, entry) {
  if (!visit || !entry || entry.kind !== 'finalizado') return null;
  if (Number(entry.codigo) !== Number(visit.milvusChamadoCodigo)) return null;
  if (visit.milvusFinalizarStatus !== 'pendente' && visit.milvusFinalizarStatus !== 'erro') return null;
  return { milvusFinalizarStatus: 'finalizado', milvusFinalizarErro: null };
}

// ── HTML ─────────────────────────────────────────────────────────────────

function _mstAgo(iso) {
  const t = new Date(iso || 0).getTime();
  if (!t) return '';
  const min = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (min < 1) return 'agora';
  if (min < 60) return 'há ' + min + ' min';
  const h = Math.round(min / 60);
  if (h < 24) return 'há ' + h + ' h';
  return 'há ' + Math.round(h / 24) + ' d';
}

function _mstChipInner(entry) {
  if (!entry) return '';
  const k = MILVUS_STATUS_KINDS[entry.kind] || MILVUS_STATUS_KINDS.atendimento;
  const label = entry.kind === 'nao_encontrado' ? k.label : (entry.status ? entry.status : k.label.replace(' no Milvus', ''));
  return '<span class="mst mst--' + k.tone + '" title="' + escapeHtml(k.label + (entry.tecnico ? ' · ' + entry.tecnico : '')) + '">Milvus: ' + escapeHtml(label) + '</span>';
}

/** Chip curto para o card da lista (vazio até a 1ª consulta). */
function milvusStatusChipHtml(visit) {
  if (!visit || !(Number(visit.milvusChamadoCodigo) > 0)) return '';
  const e = getMilvusStatusEntry(visit.id);
  const ok = e && Number(e.codigo) === Number(visit.milvusChamadoCodigo);
  return '<span class="mst-slot" data-mstatus="' + escapeHtml(visit.id) + '">' + (ok ? _mstChipInner(e) : '') + '</span>';
}

function _mstDetailInner(visit, entry, loading) {
  const id = escapeHtml(visit.id);
  const refresh = '<button type="button" class="link-btn mst-refresh" onclick="refreshMilvusStatusFor(\'' + id + '\')"' + (loading ? ' disabled' : '') + '>' + (loading ? 'Consultando…' : '↻ Atualizar') + '</button>';
  if (!entry || Number(entry.codigo) !== Number(visit.milvusChamadoCodigo)) {
    return '<div class="mst-detail"><div class="mst-line"><span class="mst-muted">' + (loading ? 'Consultando o Milvus…' : 'Status no Milvus ainda não consultado.') + '</span>' + refresh + '</div></div>';
  }
  const k = MILVUS_STATUS_KINDS[entry.kind] || MILVUS_STATUS_KINDS.atendimento;
  const fmt = (iso) => { try { return typeof formatDateTime === 'function' ? formatDateTime(iso) : new Date(iso).toLocaleString('pt-BR'); } catch (_) { return ''; } };
  const parts = [];
  if (entry.status && entry.kind !== 'nao_encontrado') parts.push('Status: <b>' + escapeHtml(entry.status) + '</b>');
  if (entry.tecnico) parts.push('Técnico: <b>' + escapeHtml(entry.tecnico) + '</b>');
  if (entry.solucao && entry.kind === 'finalizado') parts.push('Solução: ' + escapeHtml(fmt(entry.solucao)));
  else if (entry.modificado) parts.push('Última mudança: ' + escapeHtml(fmt(entry.modificado)));
  const log = entry.ultimaLog
    ? '<div class="mst-log">“' + escapeHtml(entry.ultimaLog.texto) + '”' + (entry.ultimaLog.tecnico ? ' <span class="mst-muted">— ' + escapeHtml(entry.ultimaLog.tecnico) + '</span>' : '') + '</div>'
    : '';
  const hint = (entry.kind === 'finalizado' && visit.status !== 'concluida' && visit.status !== 'cancelada')
    ? '<div class="mst-hint">O chamado já foi finalizado no Milvus. Conclua a visita aqui com o relatório.</div>'
    : (entry.kind === 'cancelado' && visit.status !== 'cancelada' ? '<div class="mst-hint">O chamado foi cancelado no Milvus.</div>' : '');
  return '<div class="mst-detail">' +
    '<div class="mst-line"><span class="mst mst--' + k.tone + '">' + escapeHtml(k.label) + '</span>' +
    '<span class="mst-muted">verificado ' + escapeHtml(_mstAgo(entry.checkedAt)) + '</span>' + refresh + '</div>' +
    (parts.length ? '<div class="mst-facts">' + parts.join(' · ') + '</div>' : '') + log + hint +
  '</div>';
}

/** Bloco do detalhe da visita (abaixo do nº do chamado). */
function milvusStatusDetailHtml(visit) {
  if (!visit || !(Number(visit.milvusChamadoCodigo) > 0)) return '';
  return '<div data-mstatus-detail="' + escapeHtml(visit.id) + '">' + _mstDetailInner(visit, getMilvusStatusEntry(visit.id), false) + '</div>';
}

function _mstPaint(ids, loading) {
  if (typeof document === 'undefined') return;
  const cache = _mstLoad();
  for (const id of ids) {
    const v = typeof getVisitById === 'function' ? getVisitById(id) : null;
    if (!v) continue;
    const e = cache[id] && Number(cache[id].codigo) === Number(v.milvusChamadoCodigo) ? cache[id] : null;
    const sid = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(id) : id;
    document.querySelectorAll('[data-mstatus="' + sid + '"]').forEach((el) => { el.innerHTML = _mstChipInner(e); });
    document.querySelectorAll('[data-mstatus-detail="' + sid + '"]').forEach((el) => { el.innerHTML = _mstDetailInner(v, e, !!loading); });
  }
}

// ── Consulta ─────────────────────────────────────────────────────────────

let _mstRunning = false;
let _mstLastRun = 0;
let _mstTimer = null;

function _mstCanRun() {
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
    if (typeof isSupabaseConnected !== 'function' || !isSupabaseConnected()) return false;
    if (typeof window !== 'undefined' && !window._supabaseAuthActive) return false;
    if (typeof supabaseClient === 'undefined' || !supabaseClient) return false;
    const off = Number(localStorage.getItem(MILVUS_STATUS_OFF_KEY) || 0);
    if (off && Date.now() < off) return false;
  } catch (_) { return false; }
  return true;
}

/**
 * Consulta o Milvus para as visitas devidas (ou as forçadas). Nunca lança.
 * @param {{ force?: string[] }} [opts]
 */
async function refreshMilvusStatuses(opts) {
  if (_mstRunning || !_mstCanRun() || typeof getVisits !== 'function') return { ok: false };
  const force = (opts && opts.force) || [];
  if (!force.length && Date.now() - _mstLastRun < 60000) return { ok: false, reason: 'throttled' };
  const cache = _mstLoad();
  const ids = pickVisitsForMilvusStatus(typeof getMyVisits === 'function' ? getMyVisits() : getVisits(), cache, Date.now(), { force });
  if (!ids.length) return { ok: true, checked: 0 };
  _mstRunning = true;
  _mstLastRun = Date.now();
  if (force.length) _mstPaint(force, true);
  let checked = 0;
  try {
    const r = await supabaseClient.functions.invoke(MILVUS_STATUS_EDGE, { body: { visitIds: ids } });
    if (r && r.error) {
      // Função ainda não publicada (404): para de tentar por 6 h.
      const st = r.error && r.error.context && r.error.context.status;
      if (st === 404) { try { localStorage.setItem(MILVUS_STATUS_OFF_KEY, String(Date.now() + 6 * 3600000)); } catch (_) {} }
      return { ok: false, reason: 'edge' };
    }
    const rows = (r && r.data && Array.isArray(r.data.statuses)) ? r.data.statuses : [];
    const now = new Date().toISOString();
    const fresh = _mstLoad();
    const changed = new Set();
    for (const row of rows) {
      if (!row || !row.visitId) continue;
      fresh[row.visitId] = toMilvusStatusEntry(row, now);
      checked++;
      const v = typeof getVisitById === 'function' ? getVisitById(row.visitId) : null;
      const patch = reconcileFinalizeFromMilvus(v, fresh[row.visitId]);
      if (patch && typeof saveVisit === 'function') {
        try { saveVisit({ ...v, ...patch }); changed.add(v.id); } catch (_) {}
      }
    }
    _mstSave(fresh);
    if (changed.size && typeof _notifyMilvusVisitUI === 'function') _notifyMilvusVisitUI(changed);
    return { ok: true, checked };
  } catch (_) {
    return { ok: false, reason: 'network' };
  } finally {
    _mstRunning = false;
    _mstPaint(ids, false);
  }
}

/** Botão "Atualizar" do detalhe: consulta esta visita agora. */
function refreshMilvusStatusFor(visitId) {
  if (!_mstCanRun()) {
    if (typeof showToast === 'function') showToast('Sem conexão com o Milvus agora.', 'warning');
    return;
  }
  refreshMilvusStatuses({ force: [visitId] });
}

/** Agenda uma varredura (debounce): chamado ao abrir lista/detalhe. */
function scheduleMilvusStatusRefresh(opts) {
  if (_mstTimer) clearTimeout(_mstTimer);
  _mstTimer = setTimeout(() => { _mstTimer = null; refreshMilvusStatuses(opts); }, 800);
}

if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('visibilitychange', () => {
    try {
      const h = (window.location.hash || '').replace('#', '');
      if (document.visibilityState === 'visible' && (h === 'visitas' || h === 'calendario')) scheduleMilvusStatusRefresh();
    } catch (_) {}
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MILVUS_STATUS_TTL_OPEN_MS,
    MILVUS_STATUS_TTL_DONE_MS,
    classifyMilvusTicketStatus,
    toMilvusStatusEntry,
    pickVisitsForMilvusStatus,
    reconcileFinalizeFromMilvus,
  };
}
