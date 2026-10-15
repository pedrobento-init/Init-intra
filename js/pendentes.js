// pendentes.js — "o que ainda não foi enviado ao servidor", de forma honesta.
// O app é offline-first: sem rede, as alterações ficam no aparelho e sobem no
// próximo sync. Antes só havia um contador (que zerava no reload e não dizia
// O QUE estava pendente). Aqui a lista vem das mesmas fontes que o sync usa:
//  - outbox (pendências salvas offline, com nº de tentativas);
//  - registros alterados depois do último sync bem-sucedido da entidade;
//  - exclusões aguardando envio (tombstones).

const PENDENTES_LABELS = {
  pendencias: 'Pendência', visits: 'Visita', clients: 'Cliente', operators: 'Operador',
  equipamentos: 'Equipamento', procedures: 'Procedimento', procedure_templates: 'Modelo', reunioes: 'Reunião', visit_photos: 'Foto',
};

function _pendTitle(table, r) {
  if (!r) return '—';
  if (table === 'pendencias') return (typeof getPendenciaTitulo === 'function' ? getPendenciaTitulo(r) : (r.assunto || r.descricao)) || r.id;
  if (table === 'visits') return 'Visita · ' + (r.clientName || '—') + (r.date ? ' · ' + r.date.split('-').reverse().join('/') : '');
  if (table === 'reunioes') return 'Reunião ' + (r.mesAno || r.id);
  return r.name || r.nome || r.title || r.assunto || r.id;
}

/**
 * Lista pura (testável).
 * @param {{table:string, dbKey:string, records:object[], lastSyncAt:string|null}[]} sources
 * @param {object[]} outboxRows  entradas da outbox ({entity, targetId, payload, createdAt, attempts})
 * @param {object} tombstones    { dbKey: { id: deletedAtISO } }
 */
function buildPendingList(sources, outboxRows, tombstones) {
  const out = [];
  const seen = new Set();
  const push = (item) => { const k = item.table + ':' + item.id; if (seen.has(k)) return; seen.add(k); out.push(item); };
  for (const o of (outboxRows || [])) {
    if (!o || !o.targetId) continue;
    push({ table: o.entity, id: o.targetId, kind: 'save', title: _pendTitle(o.entity, o.payload), at: (o.payload && o.payload.updatedAt) || o.createdAt, attempts: o.attempts || 0 });
  }
  for (const s of (sources || [])) {
    for (const r of (s.records || [])) {
      if (!r || !r.id) continue;
      const stamp = r.updatedAt || r.createdAt || '';
      // Nunca sincronizou: tudo que existe só aqui está pendente.
      if (!s.lastSyncAt || (stamp && stamp > s.lastSyncAt)) {
        push({ table: s.table, id: r.id, kind: stamp && r.createdAt && r.createdAt > (s.lastSyncAt || '') ? 'create' : 'save', title: _pendTitle(s.table, r), at: stamp, attempts: 0 });
      }
    }
    const tomb = (tombstones && tombstones[s.dbKey]) || {};
    for (const id of Object.keys(tomb)) push({ table: s.table, id, kind: 'delete', title: 'Exclusão de ' + (PENDENTES_LABELS[s.table] || s.table).toLowerCase(), at: tomb[id], attempts: 0 });
  }
  return out.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
}

async function getPendingChanges() {
  let rows = [];
  try {
    if (typeof idb !== 'undefined' && idb && idb.outbox) rows = await idb.outbox.orderBy('seq').toArray();
  } catch (_) { rows = []; }
  const sources = [];
  try {
    (typeof SYNC_ENTITIES !== 'undefined' ? SYNC_ENTITIES : []).forEach((e) => {
      let records = [];
      try { records = dbGet(e.dbKey) || []; } catch (_) { records = []; }
      sources.push({ table: e.table, dbKey: e.dbKey, records: Array.isArray(records) ? records : [], lastSyncAt: typeof _getLastSyncAt === 'function' ? _getLastSyncAt(e.table) : null });
    });
  } catch (_) {}
  let tombs = {};
  try { tombs = typeof _loadTombstones === 'function' ? _loadTombstones() : {}; } catch (_) { tombs = {}; }
  const list = buildPendingList(sources, rows, tombs);
  // Fotos de visita tiradas offline (fila própria, ver visit-photos.js).
  try {
    const q = (typeof getCacheKV === 'function' ? getCacheKV('intra_visit_photos_queue', []) : []) || [];
    for (const ph of q) {
      const v = typeof getVisitById === 'function' ? getVisitById(ph.visitId) : null;
      list.push({ table: 'visit_photos', id: ph.id, kind: 'create', title: 'Foto · Visita ' + ((v && v.clientName) || ''), at: ph.createdAt, attempts: 0 });
    }
  } catch (_) {}
  return list;
}

// ── Faixa "N alterações aguardando envio" (abaixo da topbar) ───────────────
let _pendStripTimer = null;
function refreshPendingStrip() {
  clearTimeout(_pendStripTimer);
  _pendStripTimer = setTimeout(_paintPendingStrip, 250);
}
async function _paintPendingStrip() {
  const el = document.getElementById('pendingStrip');
  if (!el) return;
  // Sem servidor configurado não há "pendente de envio": tudo é local mesmo.
  if (typeof isSupabaseConnected !== 'function' || !isSupabaseConnected()) { el.hidden = true; return; }
  let list = [];
  try { list = await getPendingChanges(); } catch (_) { list = []; }
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (!list.length) { el.hidden = true; el.innerHTML = ''; return; }
  const n = list.length;
  el.hidden = false;
  el.classList.toggle('is-offline', offline);
  el.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>' +
    '<span class="ps-text"><b>' + (typeof plural === 'function' ? plural(n, 'alteração', 'alterações') : n + ' alterações') + '</b> aguardando envio' + (offline ? ' — sem conexão, sobem quando a rede voltar' : '') + '</span>' +
    '<button type="button" class="btn btn-secondary btn-sm" onclick="openPendingChanges()">Ver lista</button>' +
    (offline ? '' : '<button type="button" class="btn btn-primary btn-sm" onclick="pendingSyncNow(this)">Enviar agora</button>');
}

async function openPendingChanges() {
  const list = await getPendingChanges();
  const fmt = (iso) => { try { return iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'; } catch (_) { return '—'; } };
  const kindLbl = { create: 'Criado', save: 'Alterado', delete: 'Excluído' };
  const body = list.length
    ? '<ul class="pend-list">' + list.map((it) =>
        '<li><span class="pend-kind pend-kind--' + it.kind + '">' + kindLbl[it.kind] + '</span>' +
        '<span class="pend-main"><b>' + escapeHtml(it.title) + '</b><small>' + escapeHtml(PENDENTES_LABELS[it.table] || it.table) + ' · ' + escapeHtml(fmt(it.at)) +
        (it.attempts ? ' · ' + plural(it.attempts, 'tentativa', 'tentativas') : '') + '</small></span></li>').join('') + '</ul>'
    : '<div class="empty-state"><p>Tudo enviado. Nada pendente neste aparelho.</p></div>';
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  openModal('Aguardando envio', '<p class="pend-intro">Estas alterações estão salvas <b>neste aparelho</b> e sobem para o servidor no próximo sincronismo. Não feche a sessão (Sair) antes disso.</p>' + body +
    '<div class="form-actions"><button type="button" class="btn btn-secondary" onclick="closeModal()">Fechar</button>' +
    (offline || !list.length ? '' : '<button type="button" class="btn btn-primary" onclick="closeModal();pendingSyncNow()">Enviar agora</button>') + '</div>', 'sm');
}

async function pendingSyncNow(btn) {
  if (btn) btn.disabled = true;
  try {
    if (typeof outboxDrain === 'function') await outboxDrain();
    if (typeof syncNow === 'function') await syncNow();
    else if (typeof syncSupabaseToLocal === 'function') await syncSupabaseToLocal();
  } catch (_) {}
  if (btn) btn.disabled = false;
  refreshPendingStrip();
}

if (typeof window !== 'undefined' && !window._pendStripBound) {
  window._pendStripBound = true;
  ['online', 'offline', 'sync:update'].forEach((ev) => window.addEventListener(ev, refreshPendingStrip));
  try {
    if (typeof onDataChanged === 'function') ['pendencias', 'visitas', 'clientes', 'operadores', 'equipamentos', 'reunioes', 'templates', 'procedimentos', 'sync-status'].forEach((n) => onDataChanged(n, refreshPendingStrip));
  } catch (_) {}
}

if (typeof module !== 'undefined' && module.exports) module.exports = { buildPendingList };
