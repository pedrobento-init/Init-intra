// Linha do tempo do cliente: pendências, visitas e mensagens já registradas.

function buildClientTimeline(clientId, { pendencias, visitas } = {}) {
  const items = [];
  const add = (item) => items.push(item);

  for (const p of Array.isArray(pendencias) ? pendencias : []) {
    if (!p || p.clientId !== clientId) continue;
    add({
      tipo: 'pendencia',
      data: p.updatedAt || p.createdAt || '',
      titulo: p.assunto || p.title || 'Pendência sem assunto',
      detalhe: p.status || 'Status não informado',
      status: p.status || '',
      id: p.id || '',
    });
    for (const note of Array.isArray(p.notes) ? p.notes : []) {
      if (!note || typeof note.text !== 'string' || !note.text.trim()) continue;
      const canal = String(note.channel || note.canal || '').toLowerCase();
      const tipo = canal === 'whatsapp' || canal === 'email' ? canal : '';
      if (!tipo) continue;
      add({
        tipo,
        data: note.createdAt || '',
        titulo: tipo === 'whatsapp' ? 'Mensagem de WhatsApp' : 'E-mail',
        detalhe: note.text,
        status: note.visibility || '',
        id: p.id || '',
      });
    }
  }

  for (const v of Array.isArray(visitas) ? visitas : []) {
    if (!v || v.clientId !== clientId) continue;
    add({
      tipo: 'visita',
      data: v.date ? String(v.date) + (v.time ? 'T' + v.time : '') : (v.createdAt || ''),
      titulo: v.motivo || 'Visita técnica',
      detalhe: v.relatorio || v.observacoes || v.status || 'Sem detalhes',
      status: v.status || '',
      id: v.id || '',
    });
  }

  return items.map((item, ordem) => ({ item, ordem, time: Date.parse(item.data) }))
    .sort((a, b) => {
      const aValido = Number.isFinite(a.time);
      const bValido = Number.isFinite(b.time);
      if (aValido !== bValido) return aValido ? -1 : 1;
      return (bValido ? b.time - a.time : 0) || a.ordem - b.ordem;
    }).map(({ item }) => item);
}

function clientTimelineHtml(clientId) {
  const pendencias = typeof getPendencias === 'function' ? getPendencias() : [];
  const visitas = typeof getVisits === 'function' ? getVisits() : [];
  const items = buildClientTimeline(clientId, { pendencias, visitas });
  if (!items.length) return '<div class="empty-state"><p>Nenhuma pendência ou visita registrada para este cliente.</p></div>';
  const rotulos = { pendencia: 'Pendência', visita: 'Visita', whatsapp: 'WhatsApp', email: 'E-mail' };
  const statusLabel = (item) => {
    const map = item.tipo === 'visita' ? (typeof VISIT_STATUS_MAP !== 'undefined' ? VISIT_STATUS_MAP : {}) : (typeof STATUS_PEN_MAP !== 'undefined' ? STATUS_PEN_MAP : {});
    return map[item.status] && map[item.status].label || item.status;
  };
  return '<ul class="ov-ls client-timeline" aria-label="Linha do tempo do cliente">' + items.map((item) => {
    const time = Date.parse(item.data);
    const quando = Number.isFinite(time)
      ? (typeof formatDateTime === 'function' ? formatDateTime(item.data) : new Date(time).toLocaleString('pt-BR'))
      : 'Data não informada';
    const kind = item.tipo === 'visita' ? 'visita' : 'pendencia';
    return '<li class="ov-it" role="button" tabindex="0" data-action="clienteTimelineAbrir" data-kind="' + kind + '" data-arg="' + escapeHtml(item.id) + '">' +
      '<div style="min-width:0"><div class="ov-mt"><span>' + escapeHtml(rotulos[item.tipo]) + ' · ' + escapeHtml(quando) + '</span></div>' +
      '<div class="ov-tt">' + escapeHtml(item.titulo) + '</div><div class="ov-mt">' + escapeHtml((item.tipo === 'pendencia' || item.tipo === 'visita') ? statusLabel(item) + (item.detalhe !== item.status ? ' · ' + item.detalhe : '') : item.detalhe) + '</div></div></li>';
  }).join('') + '</ul>';
}

if (typeof registerActions === 'function') registerActions({
  clienteTimelineAbrir: (el, id) => {
    if (typeof closeModal === 'function') closeModal();
    if (el.dataset.kind === 'visita') {
      if (typeof openVisitDetail === 'function') openVisitDetail(id);
    } else if (typeof openPendenciaDetail === 'function') openPendenciaDetail(id);
  },
});

if (typeof module !== 'undefined' && module.exports) module.exports = { buildClientTimeline, clientTimelineHtml };
