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
  for (const p of pendencias || []) {
    if (!p || p.status === 'concluido' || p.status === 'resolvido' || p.status === 'cancelado') continue;
    if (p.deadline && String(p.deadline).slice(0, 10) < today) items.push({ kind: 'prazo', pendenciaId: p.id, title: 'Pendência vencida', detail: p.clientName || p.assunto });
  }
  return items.slice(0, 30);
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
    (items.length ? '<ul class="ov-ls">' + items.map(item => {
      return '<li class="ov-it" role="button" tabindex="0" data-action="operacionalAbrir" data-kind="' + (item.visitId ? 'visita' : 'pendencia') + '" data-arg="' + escapeHtml(item.visitId || item.pendenciaId) + '">' +
        '<div style="min-width:0"><div class="ov-tt">' + escapeHtml(item.title) + '</div><div class="ov-mt"><span>' + escapeHtml(item.detail || '') + '</span></div></div><span class="ov-warn">Revisar</span></li>';
    }).join('') + '</ul>' : '<p class="ov-empty">Nenhum problema operacional encontrado.</p>') + '</section>';
}

if (typeof registerActions === 'function') registerActions({
  operacionalAbrir: (el, id) => el.dataset.kind === 'visita' ? openVisitDetail(id) : openPendenciaDetail(id),
});

if (typeof module !== 'undefined' && module.exports) module.exports = { buildOperationalCenter, buildVisitMetrics };
