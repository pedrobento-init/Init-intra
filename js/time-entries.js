// time-entries.js — Lançamentos de horas (migration 048).
// Cada sessão de trabalho vira um registro: quem, quando, quanto, em qual
// pendência/cliente e de onde veio (pausa, ajuste, conclusão, manual).
// É daqui que o relatório mensal tira as horas; a nota na pendência continua
// existindo só como histórico legível. timerTotalSeconds da pendência segue
// como o total exibido no card e acompanha as correções feitas aqui.

const TIME_SOURCES = { timer: 'Cronômetro', ajuste: 'Ajuste', conclusao: 'Conclusão', manual: 'Manual', notas: 'Histórico', visita: 'Visita' };

function getTimeEntries() { return typeof dbGet === 'function' ? dbGet(DB.TIME_ENTRIES) : []; }
function getTimeEntriesByPendencia(penId) {
  return getTimeEntries().filter((e) => e && e.pendenciaId === penId)
    .sort((a, b) => String(b.endedAt).localeCompare(String(a.endedAt)));
}

function _operatorIdByName(name) {
  try { const o = (getOperators() || []).find((x) => x && x.name === name); return o ? o.id : null; } catch (_) { return null; }
}

function _pushTimeEntry(e) {
  if (typeof isSupabaseConnected !== 'function' || !isSupabaseConnected() || typeof window === 'undefined' || !window._supabaseAuthActive) return;
  try {
    const ent = ENTITIES.find((x) => x.table === 'time_entries');
    supabaseClient.from('time_entries').upsert(_mapToRemote(e, ent.fields, ent.optionalFields))
      .then((res) => { if (res.error) { console.warn('⚠️ Supabase horas:', res.error.message); markSyncPushFailed(); } })
      .catch(() => markSyncPushFailed());
  } catch (_) { /* tabela pode não existir ainda (048) — o sync genérico cobre */ }
}

function saveTimeEntry(data) {
  const list = getTimeEntries();
  const now = new Date().toISOString();
  const i = data.id ? list.findIndex((x) => x.id === data.id) : -1;
  const saved = i !== -1
    ? { ...list[i], ...data, updatedAt: now }
    : { source: 'manual', note: '', ...data, id: data.id || nextId('TE'), createdAt: now, updatedAt: now };
  if (i !== -1) list[i] = saved; else list.push(saved);
  dbSet(DB.TIME_ENTRIES, list);
  _pushTimeEntry(saved);
  return saved;
}

function deleteTimeEntry(id) {
  dbSet(DB.TIME_ENTRIES, getTimeEntries().filter((e) => e.id !== id));
  if (typeof _addTombstone === 'function') _addTombstone(DB.TIME_ENTRIES, id);
  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    try {
      supabaseClient.from('time_entries').delete().eq('id', id)
        .then((res) => { if (res.error) markSyncPushFailed(); }).catch(() => markSyncPushFailed());
    } catch (_) {}
  }
}

/**
 * Registra uma sessão encerrada de uma pendência (chamado por pausa, ajuste
 * e conclusão com cronômetro ligado). Nunca lança.
 */
function recordTimeSession(pen, seconds, opts) {
  try {
    const secs = Math.max(0, Math.round(Number(seconds) || 0));
    if (!pen || !secs) return null;
    const o = opts || {};
    const ended = o.endedAt ? new Date(o.endedAt) : new Date();
    const who = o.operatorName || pen.timerOperator || ((typeof getUser === 'function' && getUser()) || {}).name || '';
    return saveTimeEntry({
      pendenciaId: pen.id,
      clientId: pen.clientId || null,
      operatorId: _operatorIdByName(who),
      operatorName: who,
      startedAt: new Date(ended.getTime() - secs * 1000).toISOString(),
      endedAt: ended.toISOString(),
      seconds: Math.min(secs, 86400),
      source: o.source || 'timer',
      team: pen.team || 'init',
    });
  } catch (_) { return null; }
}

/** Soma em segundos (puro). */
function sumTimeEntries(list) {
  return (list || []).reduce((s, e) => s + (Number(e && e.seconds) || 0), 0);
}

// ── Tela "Sessões" (dentro da pendência) ─────────────────────────────────

function _teCanEdit(e) {
  const me = (typeof getUser === 'function' && getUser()) || {};
  return (typeof isCurrentAdmin === 'function' && isCurrentAdmin()) || (e.operatorName && e.operatorName === me.name);
}

function _teFmt(secs) { return typeof formatDurationWords === 'function' ? formatDurationWords(secs) : Math.round(secs / 60) + 'min'; }

function openTimeEntries(penId) {
  const p = typeof getPendenciaById === 'function' ? getPendenciaById(penId) : null;
  if (!p) return;
  const list = getTimeEntriesByPendencia(penId);
  const rows = list.map((e) => '<li class="te-row">' +
    '<span class="te-when">' + escapeHtml(typeof formatDateTime === 'function' ? formatDateTime(e.endedAt) : e.endedAt) + '</span>' +
    '<span class="te-who">' + escapeHtml(e.operatorName || '—') + '<small>' + escapeHtml(TIME_SOURCES[e.source] || e.source || '') + (e.note ? ' · ' + escapeHtml(e.note) : '') + '</small></span>' +
    '<b class="te-dur">' + escapeHtml(_teFmt(e.seconds)) + '</b>' +
    (_teCanEdit(e) ? '<span class="te-acts"><button type="button" class="link-btn" data-action="te-edit" data-id="' + escapeHtml(e.id) + '">Corrigir</button>' +
      '<button type="button" class="link-btn te-del" data-action="te-del" data-id="' + escapeHtml(e.id) + '">Excluir</button></span>' : '<span></span>') +
  '</li>').join('');
  openModal('Sessões — ' + escapeHtml(typeof getPendenciaTitulo === 'function' ? getPendenciaTitulo(p) : ''), `
    <div class="te" data-pen="${escapeHtml(penId)}">
      <p class="te-total">Total lançado: <b>${escapeHtml(_teFmt(sumTimeEntries(list)))}</b> em ${list.length} ${list.length === 1 ? 'sessão' : 'sessões'}</p>
      ${list.length ? '<ul class="te-list">' + rows + '</ul>' : '<p class="te-none">Nenhuma sessão registrada ainda.</p>'}
      <form class="te-add" data-action-submit="te-add">
        <b>Lançar horas</b>
        <div class="te-add-row">
          <input class="form-input" type="date" name="dia" value="${escapeHtml(typeof localDateISO === 'function' ? localDateISO() : '')}" required aria-label="Dia" />
          <input class="form-input" type="number" name="h" min="0" max="23" value="0" aria-label="Horas" /><span>h</span>
          <input class="form-input" type="number" name="m" min="0" max="59" value="30" aria-label="Minutos" /><span>min</span>
          <input class="form-input te-note" name="note" placeholder="Observação (opcional)" />
          <button type="submit" class="btn btn-primary btn-sm">Lançar</button>
        </div>
      </form>
    </div>
    <div class="form-actions"><button type="button" class="btn btn-secondary" data-action="openPendencia" data-arg="${escapeHtml(penId)}">Voltar</button></div>`);
  const root = document.querySelector('#modalBody .te');
  if (!root) return;
  root.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-action]');
    if (!b) return;
    const id = b.dataset.id;
    if (b.dataset.action === 'te-del') {
      if (!window.confirm('Excluir esta sessão? O total da pendência diminui junto.')) return;
      const e = getTimeEntries().find((x) => x.id === id);
      deleteTimeEntry(id);
      _teAdjustPenTotal(penId, -(Number(e && e.seconds) || 0));
      openTimeEntries(penId);
    } else if (b.dataset.action === 'te-edit') {
      const e = getTimeEntries().find((x) => x.id === id);
      if (!e) return;
      const cur = Math.round((Number(e.seconds) || 0) / 60);
      const v = window.prompt('Duração correta em minutos:', String(cur));
      if (v === null) return;
      const min = Math.max(0, Math.min(1440, parseInt(v, 10) || 0));
      saveTimeEntry({ id, seconds: min * 60, note: (e.note ? e.note + ' · ' : '') + 'corrigido de ' + cur + 'min' });
      _teAdjustPenTotal(penId, min * 60 - (Number(e.seconds) || 0));
      openTimeEntries(penId);
    }
  });
  root.querySelector('form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const secs = (parseInt(fd.get('h'), 10) || 0) * 3600 + (parseInt(fd.get('m'), 10) || 0) * 60;
    if (!secs) { showToast('Informe a duração.', 'warning'); return; }
    const me = ((typeof getUser === 'function' && getUser()) || {}).name || '';
    const ended = new Date(String(fd.get('dia')) + 'T18:00:00');
    recordTimeSession(p, secs, { source: 'manual', operatorName: me, endedAt: ended.toISOString() });
    const note = String(fd.get('note') || '').trim();
    if (note) { const last = getTimeEntriesByPendencia(penId)[0]; if (last) saveTimeEntry({ id: last.id, note }); }
    _teAdjustPenTotal(penId, secs);
    showToast('Horas lançadas.', 'success');
    openTimeEntries(penId);
  });
}

// Mantém o total do card coerente com as correções.
function _teAdjustPenTotal(penId, deltaSecs) {
  if (!deltaSecs || typeof getPendenciaById !== 'function' || typeof savePendencia !== 'function') return;
  const p = getPendenciaById(penId);
  if (!p) return;
  savePendencia({ ...p, timerTotalSeconds: Math.max(0, (Number(p.timerTotalSeconds) || 0) + deltaSecs) });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { sumTimeEntries, TIME_SOURCES };
}
