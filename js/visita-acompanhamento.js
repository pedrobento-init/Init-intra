// Continuidade entre visitas: itens pendentes viram acompanhamento acionável.

function visitFollowupData(v, item, responsible, priority, note) {
  const suffix = typeof formatVisitNumero === 'function' ? formatVisitNumero(v) : v.id;
  const text = String(item && item.text || '').trim();
  return {
    clientId: v.clientId,
    clientName: v.clientName,
    tipo: 'Suporte',
    assunto: text || 'Acompanhamento da visita ' + suffix,
    descricao: [text, note, 'Origem: visita ' + suffix].filter(Boolean).join('\n'),
    responsible: responsible || v.operator || '',
    status: 'aberto',
    priority: priority || 'media',
    team: v.team || 'init',
    visitId: v.id,
  };
}

function createVisitFollowups(v, { itemIndexes = [], responsible, priority, note } = {}) {
  if (!v || typeof savePendencia !== 'function') return [];
  const existing = typeof getPendencias === 'function' ? getPendencias() : [];
  const selected = new Set(itemIndexes.map(Number));
  const items = (Array.isArray(v.checklist) ? v.checklist : [])
    .map((item, index) => ({ item, index }))
    .filter(({ item, index }) => item && !item.done && selected.has(index));
  if (!items.length && note && String(note).trim()) items.push({ item: null, index: -1 });
  const created = [];
  for (const { item } of items) {
    const data = visitFollowupData(v, item, responsible, priority, note);
    if (existing.some(p => p && p.visitId === v.id && p.assunto === data.assunto && !['resolvido', 'concluido', 'cancelado', 'fechado'].includes(p.status))) continue;
    created.push(savePendencia(data));
  }
  return created;
}

function previousVisitPendingHtml(v) {
  if (!v || !v.clientId || typeof getVisits !== 'function' || typeof getPendencias !== 'function') return '';
  const previous = getVisits().filter(other => other && other.id !== v.id && other.clientId === v.clientId && other.status === 'concluida' && String(other.date || '') <= String(v.date || ''))
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0];
  if (!previous) return '';
  const pending = getPendencias().filter(p => p && p.visitId === previous.id && !['resolvido', 'concluido', 'cancelado', 'fechado'].includes(p.status));
  if (!pending.length) return '';
  return '<div class="campo-atencao"><strong>Pendências da visita anterior:</strong><ul>' + pending.map(p =>
    '<li>' + escapeHtml(p.assunto || p.descricao || 'Acompanhamento') + ' · ' + escapeHtml(p.responsible || 'Sem responsável') + '</li>').join('') + '</ul></div>';
}

if (typeof module !== 'undefined' && module.exports) module.exports = { visitFollowupData, createVisitFollowups };
