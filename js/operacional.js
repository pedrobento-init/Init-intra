// Central operacional: problemas que pedem ação e indicadores das visitas.

function buildOperationalCenter(visits, pendencias, statusCache, now) {
  const at = now instanceof Date ? now : new Date(now || Date.now());
  const today = at.getFullYear() + '-' + String(at.getMonth() + 1).padStart(2, '0') + '-' + String(at.getDate()).padStart(2, '0');
  const nowMinutes = at.getHours() * 60 + at.getMinutes();
  const items = [];
  const seenConflicts = new Set();
  const active = (visits || []).filter(v => v && v.status !== 'cancelada');
  for (const v of active) {
    const cache = statusCache && statusCache[v.id];
    if (v.milvusChamadoCodigo && cache && cache.kind === 'finalizado' && v.status !== 'concluida') {
      items.push({ kind: 'milvus', visitId: v.id, title: 'Chamado finalizado no Milvus', detail: v.clientName });
    }
    if (v.status === 'concluida' && !String(v.relatorio || '').trim()) {
      items.push({ kind: 'relatorio', visitId: v.id, title: 'Visita concluída sem relatório', detail: v.clientName });
    }
    if (v.date === today && v.status === 'agendada' && v.time) {
      const start = Number(v.time.slice(0, 2)) * 60 + Number(v.time.slice(3, 5));
      if (nowMinutes - start > 30) items.push({ kind: 'atraso', visitId: v.id, title: 'Visita ainda não iniciada', detail: v.clientName + ' · ' + v.time });
    }
    if (v.status === 'em_andamento' && v.checkinAt) {
      const elapsed = at.getTime() - new Date(v.checkinAt).getTime();
      if (elapsed > 4 * 3600000) items.push({ kind: 'andamento', visitId: v.id, title: 'Visita em andamento há mais de 4h', detail: v.clientName });
    }
    for (const other of typeof findVisitScheduleConflicts === 'function' ? findVisitScheduleConflicts(v, active) : []) {
      const key = [v.id, other.id].sort().join('|');
      if (seenConflicts.has(key)) continue;
      seenConflicts.add(key);
      items.push({ kind: 'conflito', visitId: v.id, title: 'Operadores no mesmo cliente e horário', detail: v.clientName + ' · ' + (v.operator || '—') + ' e ' + (other.operator || '—') });
    }
  }
  const byOperator = {};
  for (const v of active.filter(v => v.date >= today && v.time && v.status !== 'concluida')) {
    const key = v.operator || '';
    (byOperator[key] || (byOperator[key] = [])).push(v);
  }
  for (const list of Object.values(byOperator)) {
    list.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      const next = list[i];
      if (prev.clientId === next.clientId) continue;
      const prevEnd = prev.timeEnd || prev.time;
      const gap = (new Date(next.date + 'T' + next.time) - new Date(prev.date + 'T' + prevEnd)) / 60000;
      if (gap >= 0 && gap < 30) items.push({ kind: 'deslocamento', visitId: next.id, title: 'Menos de 30 min para deslocamento', detail: (prev.clientName || '—') + ' → ' + (next.clientName || '—') });
    }
  }
  const closed = new Set(['concluido', 'resolvido', 'cancelado', 'fechado']);
  const resolved = (pendencias || []).filter(p => p && (p.status === 'resolvido' || p.status === 'concluido' || p.status === 'fechado'));
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  for (const p of pendencias || []) {
    if (!p || closed.has(p.status)) continue;
    const detail = p.clientName || p.assunto;
    if (p.deadline && String(p.deadline).slice(0, 10) < today) {
      items.push({ kind: 'prazo', pendenciaId: p.id, title: 'Pendência vencida', detail });
    } else if (p.deadline) {
      const rawDeadline = String(p.deadline);
      const deadline = new Date(rawDeadline.length === 10 ? rawDeadline + 'T23:59:59.999' : rawDeadline).getTime();
      const remaining = deadline - at.getTime();
      if (Number.isFinite(remaining) && remaining >= 0 && remaining <= 24 * 3600000) {
        items.push({ kind: 'prazo_proximo', pendenciaId: p.id, title: 'Pendência perto do prazo', detail });
      }
    }
    const timeline = (Array.isArray(p.notes) ? p.notes : []).concat(Array.isArray(p.timeline) ? p.timeline : []).filter(Boolean);
    const requesterNotes = timeline.filter(n => n.visibility === 'solicitante' && Number.isFinite(new Date(n.createdAt || n.at).getTime()));
    const latestRequest = requesterNotes.reduce((latest, n) => {
      const time = new Date(n.createdAt || n.at).getTime();
      return !latest || time > latest.time ? { time } : latest;
    }, null);
    const viewedAt = new Date(p.lastViewedAt || p.viewedAt || '').getTime();
    if (latestRequest && !timeline.some(n => n.visibility === 'resposta' && new Date(n.createdAt || n.at).getTime() > latestRequest.time)
      && !(Number.isFinite(viewedAt) && viewedAt > latestRequest.time)) {
      items.push({ kind: 'resposta_solicitante', pendenciaId: p.id, title: 'Solicitante aguarda resposta', detail });
    }
    const updatedAt = new Date(p.updatedAt || '').getTime();
    if (Number.isFinite(updatedAt) && at.getTime() - updatedAt >= 7 * 86400000) {
      items.push({ kind: 'parada', pendenciaId: p.id, title: 'Pendência parada há 7 dias ou mais', detail });
    }
    const subject = normalize(p.assunto || p.tipo);
    if (p.clientId && subject && resolved.some(r => {
      if (r.id === p.id || r.clientId !== p.clientId || normalize(r.assunto || r.tipo) !== subject) return false;
      const resolvedAt = new Date(r.resolvedAt || r.updatedAt || '').getTime();
      const age = at.getTime() - resolvedAt;
      return Number.isFinite(age) && age >= 0 && age <= 30 * 86400000;
    })) {
      items.push({ kind: 'reincidencia', pendenciaId: p.id, title: 'Possível reincidência nos últimos 30 dias', detail });
    }
  }
  const severity = { prazo: 0, resposta_solicitante: 0, milvus: 0, relatorio: 0, prazo_proximo: 1, atraso: 1, andamento: 1, conflito: 1, deslocamento: 1, parada: 2, reincidencia: 2 };
  return items.map((item, index) => ({ item, index })).sort((a, b) => (severity[a.item.kind] ?? 2) - (severity[b.item.kind] ?? 2) || a.index - b.index).slice(0, 30).map(entry => entry.item);
}

function buildVisitMetrics(visits, ym) {
  const month = (visits || []).filter(v => v && v.status !== 'cancelada' && String(v.date || '').startsWith(ym));
  const done = month.filter(v => v.status === 'concluida');
  const durations = done.map(v => typeof visitDurationMinutes === 'function' ? visitDurationMinutes(v) : null).filter(Number.isFinite);
  const byOperator = {};
  const byClient = {};
  for (const v of done) {
    byOperator[v.operator || 'Não informado'] = (byOperator[v.operator || 'Não informado'] || 0) + 1;
    byClient[v.clientName || 'Não informado'] = (byClient[v.clientName || 'Não informado'] || 0) + 1;
  }
  const top = obj => Object.entries(obj).sort((a, b) => b[1] - a[1])[0] || null;
  return {
    total: done.length,
    avgMinutes: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
    topOperator: top(byOperator),
    topClient: top(byClient),
    recurrentClients: Object.values(byClient).filter(count => count > 1).length,
  };
}

function operationalCenterHtml(items) {
  return '<section class="card dash-widget ov-panel" aria-labelledby="ov-central">' +
    '<div class="ov-ph"><h2 class="ov-h2" id="ov-central">Central operacional</h2><span class="ov-sub">' + items.length + ' ' + (items.length === 1 ? 'alerta' : 'alertas') + '</span></div>' +
    (items.length ? '<ul class="ov-ls ov-operational-list">' + items.map(item => {
      return '<li class="ov-it" role="button" tabindex="0" data-action="operacionalAbrir" data-kind="' + (item.visitId ? 'visita' : 'pendencia') + '" data-arg="' + escapeHtml(item.visitId || item.pendenciaId) + '">' +
        '<div style="min-width:0"><div class="ov-tt">' + escapeHtml(item.title) + '</div><div class="ov-mt"><span>' + escapeHtml(item.detail || '') + '</span></div></div><span class="ov-warn">Revisar</span></li>';
    }).join('') + '</ul>' : '<p class="ov-empty">Nenhum problema operacional encontrado.</p>') + '</section>';
}

if (typeof registerActions === 'function') registerActions({
  operacionalAbrir: (el, id) => el.dataset.kind === 'visita' ? openVisitDetail(id) : openPendenciaDetail(id),
});

if (typeof module !== 'undefined' && module.exports) module.exports = { buildOperationalCenter, buildVisitMetrics };
