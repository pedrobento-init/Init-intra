// Central operacional: problemas que pedem ação e indicadores das visitas.

// Teto de segurança do cálculo (não da tela): a lista rola por dentro.
const OPERATIONAL_MAX_ITEMS = 300;

// Categorias dos cartões de resumo, na ordem em que aparecem.
const OPERATIONAL_GROUPS = [
  { id: 'prazos', label: 'Prazos' },
  { id: 'respostas', label: 'Respostas' },
  { id: 'visitas', label: 'Visitas' },
  { id: 'acompanhar', label: 'Acompanhar' },
];
const OPERATIONAL_GROUP_BY_KIND = {
  prazo: 'prazos',
  prazo_proximo: 'prazos',
  resposta_solicitante: 'respostas',
  milvus: 'visitas',
  relatorio: 'visitas',
  atraso: 'visitas',
  andamento: 'visitas',
  conflito: 'visitas',
  deslocamento: 'visitas',
  parada: 'acompanhar',
  reincidencia: 'acompanhar',
};

// Estado da tela (só em memória: ao recarregar volta para "Meus" / "Todos").
let _opcState = { escopo: 'meus', grupo: 'todos' };
let _opcItems = [];

function buildOperationalCenter(visits, pendencias, statusCache, now) {
  const at = now instanceof Date ? now : new Date(now || Date.now());
  const today =
    at.getFullYear() +
    '-' +
    String(at.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(at.getDate()).padStart(2, '0');
  const nowMinutes = at.getHours() * 60 + at.getMinutes();
  const items = [];
  const seenConflicts = new Set();
  const active = (visits || []).filter((v) => v && v.status !== 'cancelada');
  for (const v of active) {
    const cache = statusCache && statusCache[v.id];
    if (v.milvusChamadoCodigo && cache && cache.kind === 'finalizado' && v.status !== 'concluida') {
      items.push({
        kind: 'milvus',
        visitId: v.id,
        title: 'Chamado finalizado no Milvus',
        detail: v.clientName,
      });
    }
    if (v.status === 'concluida' && !String(v.relatorio || '').trim()) {
      items.push({
        kind: 'relatorio',
        visitId: v.id,
        title: 'Visita concluída sem relatório',
        detail: v.clientName,
      });
    }
    if (v.date === today && v.status === 'agendada' && v.time) {
      const start = Number(v.time.slice(0, 2)) * 60 + Number(v.time.slice(3, 5));
      if (nowMinutes - start > 30)
        items.push({
          kind: 'atraso',
          visitId: v.id,
          title: 'Visita ainda não iniciada',
          detail: v.clientName + ' · ' + v.time,
        });
    }
    if (v.status === 'em_andamento' && v.checkinAt) {
      const elapsed = at.getTime() - new Date(v.checkinAt).getTime();
      if (elapsed > 4 * 3600000)
        items.push({
          kind: 'andamento',
          visitId: v.id,
          title: 'Visita em andamento há mais de 4h',
          detail: v.clientName,
        });
    }
    for (const other of typeof findVisitScheduleConflicts === 'function'
      ? findVisitScheduleConflicts(v, active)
      : []) {
      const key = [v.id, other.id].sort().join('|');
      if (seenConflicts.has(key)) continue;
      seenConflicts.add(key);
      items.push({
        kind: 'conflito',
        visitId: v.id,
        title: 'Operadores no mesmo cliente e horário',
        detail: v.clientName + ' · ' + (v.operator || '—') + ' e ' + (other.operator || '—'),
        owner2: other.operator || '',
        owner2Id: other.operatorId || '',
      });
    }
  }
  const byOperator = {};
  for (const v of active.filter((v) => v.date >= today && v.time && v.status !== 'concluida')) {
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
      const gap =
        (new Date(next.date + 'T' + next.time) - new Date(prev.date + 'T' + prevEnd)) / 60000;
      if (gap >= 0 && gap < 30)
        items.push({
          kind: 'deslocamento',
          visitId: next.id,
          title: 'Menos de 30 min para deslocamento',
          detail: (prev.clientName || '—') + ' → ' + (next.clientName || '—'),
        });
    }
  }
  const closed = new Set(['concluido', 'resolvido', 'cancelado', 'fechado']);
  const resolved = (pendencias || []).filter(
    (p) => p && (p.status === 'resolvido' || p.status === 'concluido' || p.status === 'fechado')
  );
  const normalize = (value) =>
    String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  for (const p of pendencias || []) {
    if (!p || closed.has(p.status)) continue;
    // Cliente + assunto: numa lista longa, só o cliente repetia a mesma linha
    // dezenas de vezes e não dava para saber qual pendência era qual.
    const detail = [p.clientName, p.assunto].filter(Boolean).join(' · ');
    if (p.deadline && String(p.deadline).slice(0, 10) < today) {
      items.push({ kind: 'prazo', pendenciaId: p.id, title: 'Pendência vencida', detail });
    } else if (p.deadline) {
      const rawDeadline = String(p.deadline);
      const deadline = new Date(
        rawDeadline.length === 10 ? rawDeadline + 'T23:59:59.999' : rawDeadline
      ).getTime();
      const remaining = deadline - at.getTime();
      if (Number.isFinite(remaining) && remaining >= 0 && remaining <= 24 * 3600000) {
        items.push({
          kind: 'prazo_proximo',
          pendenciaId: p.id,
          title: 'Pendência perto do prazo',
          detail,
        });
      }
    }
    const timeline = (Array.isArray(p.notes) ? p.notes : [])
      .concat(Array.isArray(p.timeline) ? p.timeline : [])
      .filter(Boolean);
    const requesterNotes = timeline.filter(
      (n) =>
        n.visibility === 'solicitante' && Number.isFinite(new Date(n.createdAt || n.at).getTime())
    );
    const latestRequest = requesterNotes.reduce((latest, n) => {
      const time = new Date(n.createdAt || n.at).getTime();
      return !latest || time > latest.time ? { time } : latest;
    }, null);
    const viewedAt = new Date(p.lastViewedAt || p.viewedAt || '').getTime();
    if (
      latestRequest &&
      !timeline.some(
        (n) =>
          n.visibility === 'resposta' &&
          new Date(n.createdAt || n.at).getTime() > latestRequest.time
      ) &&
      !(Number.isFinite(viewedAt) && viewedAt > latestRequest.time)
    ) {
      items.push({
        kind: 'resposta_solicitante',
        pendenciaId: p.id,
        title: 'Solicitante aguarda resposta',
        detail,
      });
    }
    const updatedAt = new Date(p.updatedAt || '').getTime();
    if (Number.isFinite(updatedAt) && at.getTime() - updatedAt >= 7 * 86400000) {
      items.push({
        kind: 'parada',
        pendenciaId: p.id,
        title: 'Pendência parada há 7 dias ou mais',
        detail,
      });
    }
    const subject = normalize(p.assunto || p.tipo);
    if (
      p.clientId &&
      subject &&
      resolved.some((r) => {
        if (
          r.id === p.id ||
          r.clientId !== p.clientId ||
          normalize(r.assunto || r.tipo) !== subject
        )
          return false;
        const resolvedAt = new Date(r.resolvedAt || r.updatedAt || '').getTime();
        const age = at.getTime() - resolvedAt;
        return Number.isFinite(age) && age >= 0 && age <= 30 * 86400000;
      })
    ) {
      items.push({
        kind: 'reincidencia',
        pendenciaId: p.id,
        title: 'Possível reincidência nos últimos 30 dias',
        detail,
      });
    }
  }
  const severity = {
    prazo: 0,
    resposta_solicitante: 0,
    milvus: 0,
    relatorio: 0,
    prazo_proximo: 1,
    atraso: 1,
    andamento: 1,
    conflito: 1,
    deslocamento: 1,
    parada: 2,
    reincidencia: 2,
  };
  const visitById = new Map((visits || []).filter(Boolean).map((v) => [v.id, v]));
  const penById = new Map((pendencias || []).filter(Boolean).map((p) => [p.id, p]));
  // Categoria, gravidade e responsável vão no item para a tela filtrar sem
  // reabrir os registros. Sem o corte antigo de 30: ele escondia alerta em
  // silêncio e o contador mentia; quem limita agora é a altura da lista.
  const decorate = (item) => {
    const rec = item.visitId ? visitById.get(item.visitId) : penById.get(item.pendenciaId);
    return {
      ...item,
      group: OPERATIONAL_GROUP_BY_KIND[item.kind] || 'acompanhar',
      sev: severity[item.kind] ?? 2,
      owner: (rec && (item.visitId ? rec.operator : rec.responsible)) || '',
      ownerId: (rec && (item.visitId ? rec.operatorId : rec.responsibleId)) || '',
    };
  };
  return items
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) => (severity[a.item.kind] ?? 2) - (severity[b.item.kind] ?? 2) || a.index - b.index
    )
    .slice(0, OPERATIONAL_MAX_ITEMS)
    .map((entry) => decorate(entry.item));
}

function buildVisitMetrics(visits, ym) {
  const month = (visits || []).filter(
    (v) => v && v.status !== 'cancelada' && String(v.date || '').startsWith(ym)
  );
  const done = month.filter((v) => v.status === 'concluida');
  const durations = done
    .map((v) => (typeof visitDurationMinutes === 'function' ? visitDurationMinutes(v) : null))
    .filter(Number.isFinite);
  const byOperator = {};
  const byClient = {};
  for (const v of done) {
    byOperator[v.operator || 'Não informado'] =
      (byOperator[v.operator || 'Não informado'] || 0) + 1;
    byClient[v.clientName || 'Não informado'] =
      (byClient[v.clientName || 'Não informado'] || 0) + 1;
  }
  const top = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1])[0] || null;
  return {
    total: done.length,
    avgMinutes: durations.length
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : null,
    topOperator: top(byOperator),
    topClient: top(byClient),
    recurrentClients: Object.values(byClient).filter((count) => count > 1).length,
  };
}

// O alerta é "meu" quando o responsável sou eu (por id; sem id, pelo nome).
// Conflito de agenda envolve dois operadores: vale para os dois.
function operationalCenterIsMine(item, who) {
  const w = who || {};
  const same = (id, name) => {
    if (id && w.opId) return id === w.opId;
    const n = String(name || '').trim();
    return n !== '' && n === String(w.name || '').trim();
  };
  return same(item.ownerId, item.owner) || same(item.owner2Id, item.owner2);
}

// Tudo que a tela precisa, sem DOM: separa por escopo, conta por categoria e
// aplica o filtro. Categoria sem item no escopo atual volta para "todos".
function operationalCenterView(items, state, who) {
  const all = items || [];
  const mine = all.filter((i) => operationalCenterIsMine(i, who));
  const escopo = state && state.escopo === 'equipe' ? 'equipe' : 'meus';
  const scoped = escopo === 'meus' ? mine : all;
  const counts = { todos: scoped.length };
  for (const g of OPERATIONAL_GROUPS) counts[g.id] = scoped.filter((i) => i.group === g.id).length;
  const grupo = state && counts[state.grupo] ? state.grupo : 'todos';
  const shown = grupo === 'todos' ? scoped : scoped.filter((i) => i.group === grupo);
  return { escopo, grupo, mine: mine.length, team: all.length, scoped, counts, shown };
}

function _opcGroupLabel(id) {
  const g = OPERATIONAL_GROUPS.find((x) => x.id === id);
  return g ? g.label : id;
}

function _opcWho() {
  const s = typeof getSession === 'function' ? getSession() : null;
  if (s) return { opId: s.opId, name: s.name };
  const u = typeof getUser === 'function' ? getUser() : null;
  return { opId: '', name: (u && u.name) || '' };
}

function operationalCenterHtml(items) {
  _opcItems = items || [];
  const v = operationalCenterView(_opcItems, _opcState, _opcWho());
  const plural = (n) => n + ' ' + (n === 1 ? 'alerta' : 'alertas');
  const seg = (id, label, n) =>
    '<button type="button" class="opc-seg-btn" aria-pressed="' +
    (v.escopo === id) +
    '" data-action="operacionalEscopo" data-arg="' +
    id +
    '">' +
    label +
    ' <b>' +
    n +
    '</b></button>';
  const card = (id, label) =>
    '<button type="button" class="opc-card' +
    (v.grupo === id ? ' is-on' : '') +
    '" aria-pressed="' +
    (v.grupo === id) +
    '"' +
    (v.counts[id] ? '' : ' disabled') +
    ' data-action="operacionalGrupo" data-arg="' +
    id +
    '"><span class="opc-n">' +
    v.counts[id] +
    '</span><span class="opc-l">' +
    label +
    '</span></button>';
  const row = (item) =>
    '<li class="ov-it" role="button" tabindex="0" data-action="operacionalAbrir" data-kind="' +
    (item.visitId ? 'visita' : 'pendencia') +
    '" data-arg="' +
    escapeHtml(item.visitId || item.pendenciaId) +
    '">' +
    '<div class="u-3922d3"><div class="ov-tt"><i class="opc-dot opc-dot--s' +
    (item.sev ?? 2) +
    '" aria-hidden="true"></i>' +
    escapeHtml(item.title) +
    '</div><div class="ov-mt"><span>' +
    escapeHtml(item.detail || '') +
    '</span>' +
    (v.escopo === 'equipe' && item.owner
      ? '<span class="opc-own">Resp.: ' + escapeHtml(item.owner) + '</span>'
      : '') +
    '</div></div><span class="ov-warn">Revisar</span></li>';

  let corpo;
  if (!_opcItems.length) {
    corpo = '<p class="ov-empty">Nenhum problema operacional encontrado.</p>';
  } else if (!v.scoped.length) {
    corpo =
      '<p class="ov-empty">Nenhum alerta seu. Há ' +
      plural(v.team) +
      ' na equipe. <button type="button" class="link-btn" data-action="operacionalEscopo" data-arg="equipe">Ver a equipe</button></p>';
  } else {
    corpo =
      '<ul class="ov-ls ov-operational-list opc-list">' +
      v.shown.map(row).join('') +
      '</ul>' +
      '<div class="opc-foot">' +
      plural(v.shown.length) +
      (v.grupo === 'todos' ? '' : ' em ' + _opcGroupLabel(v.grupo)) +
      '</div>';
  }
  return (
    '<section class="card dash-widget ov-panel opc" aria-labelledby="ov-central">' +
    '<div class="ov-ph"><h2 class="ov-h2" id="ov-central">Central operacional</h2><span class="ov-sub">' +
    plural(v.scoped.length) +
    '</span></div>' +
    (_opcItems.length
      ? '<div class="opc-seg" role="group" aria-label="Escopo">' +
        seg('meus', 'Meus', v.mine) +
        seg('equipe', 'Equipe', v.team) +
        '</div>' +
        '<div class="opc-cards" role="group" aria-label="Categorias">' +
        card('todos', 'Todos') +
        OPERATIONAL_GROUPS.map((g) => card(g.id, g.label)).join('') +
        '</div>'
      : '') +
    corpo +
    '</section>'
  );
}

// Redesenha só a Central (sem refazer o dashboard) e devolve o foco ao botão
// clicado, que o outerHTML destrói.
function _opcRedraw(focusAction, focusArg) {
  const el = document.querySelector('section[aria-labelledby="ov-central"]');
  if (!el) return;
  el.outerHTML = operationalCenterHtml(_opcItems);
  const novo = document.querySelector(
    '[data-action="' + focusAction + '"][data-arg="' + focusArg + '"]'
  );
  if (novo && typeof novo.focus === 'function') novo.focus();
}

if (typeof registerActions === 'function')
  registerActions({
    operacionalAbrir: (el, id) =>
      el.dataset.kind === 'visita' ? openVisitDetail(id) : openPendenciaDetail(id),
    operacionalEscopo: (_el, escopo) => {
      _opcState = { escopo: escopo === 'equipe' ? 'equipe' : 'meus', grupo: 'todos' };
      _opcRedraw('operacionalEscopo', _opcState.escopo);
    },
    operacionalGrupo: (_el, grupo) => {
      // Clicar na categoria já ativa volta para "todos".
      _opcState = { ..._opcState, grupo: _opcState.grupo === grupo ? 'todos' : grupo };
      _opcRedraw('operacionalGrupo', _opcState.grupo === 'todos' ? 'todos' : grupo);
    },
  });

if (typeof module !== 'undefined' && module.exports)
  module.exports = {
    buildOperationalCenter,
    buildVisitMetrics,
    operationalCenterIsMine,
    operationalCenterView,
    OPERATIONAL_GROUPS,
  };
