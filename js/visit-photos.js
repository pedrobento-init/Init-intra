// visit-photos.js — fotos da visita (câmera do celular → relatório).
// Sem coluna nova no banco: as fotos vivem no Supabase Storage (bucket
// `attachments`, pasta visits/<id>/, o mesmo bucket dos anexos de pendência).
// Offline-first: a foto é comprimida no aparelho e entra numa fila local;
// sobe quando houver conexão e só sai da fila com confirmação do upload.

const VISIT_PHOTO_MAX_DIM = 1600;      // lado maior após compressão (px)
const VISIT_PHOTO_QUALITY = 0.72;      // JPEG
const VISIT_PHOTO_MAX_INPUT = 15 * 1024 * 1024; // arquivo original
const VISIT_PHOTO_MAX_PER_VISIT = 12;
const VISIT_PHOTO_QUEUE_KEY = 'intra_visit_photos_queue';
const VISIT_PHOTO_BUCKET = 'attachments';

/** Tamanho final mantendo proporção (puro, testável). */
function visitPhotoScaledSize(w, h, max) {
  const m = max || VISIT_PHOTO_MAX_DIM;
  if (!w || !h) return { w: 0, h: 0 };
  if (w <= m && h <= m) return { w: Math.round(w), h: Math.round(h) };
  const k = m / Math.max(w, h);
  return { w: Math.round(w * k), h: Math.round(h * k) };
}

function visitPhotoPath(visitId, photoId) { return 'visits/' + visitId + '/' + photoId + '.jpg'; }

function _vpQueue() {
  try { return (typeof getCacheKV === 'function' ? getCacheKV(VISIT_PHOTO_QUEUE_KEY, []) : []) || []; } catch (_) { return []; }
}
function _vpSaveQueue(q) {
  try { if (typeof setCacheKV === 'function') setCacheKV(VISIT_PHOTO_QUEUE_KEY, q); } catch (_) {}
  try { if (typeof refreshPendingStrip === 'function') refreshPendingStrip(); } catch (_) {}
}
function _vpOnline() {
  return !(typeof navigator !== 'undefined' && navigator.onLine === false)
    && typeof isSupabaseConnected === 'function' && isSupabaseConnected()
    && typeof window !== 'undefined' && window._supabaseAuthActive;
}

// Comprime no aparelho: redimensiona e reencoda em JPEG. Uma foto de 4–8 MB
// do celular vira ~200–400 KB (sobe rápido no 4G e não pesa no cache).
async function compressVisitPhoto(file) {
  const bmp = typeof createImageBitmap === 'function'
    ? await createImageBitmap(file, { imageOrientation: 'from-image' })
    : await new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = rej; img.src = URL.createObjectURL(file); });
  const size = visitPhotoScaledSize(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = size.w; canvas.height = size.h;
  canvas.getContext('2d').drawImage(bmp, 0, 0, size.w, size.h);
  try { if (bmp.close) bmp.close(); } catch (_) {}
  return canvas.toDataURL('image/jpeg', VISIT_PHOTO_QUALITY);
}

async function addVisitPhotos(visitId, files) {
  const list = Array.from(files || []).filter((f) => f && /^image\//.test(f.type || ''));
  if (!list.length) { showToast('Escolha uma imagem.', 'error'); return 0; }
  const existing = (await listVisitPhotos(visitId)).length;
  const room = VISIT_PHOTO_MAX_PER_VISIT - existing;
  if (room <= 0) { showToast('Máximo de ' + VISIT_PHOTO_MAX_PER_VISIT + ' fotos por visita.', 'error'); return 0; }
  const me = (typeof getUser === 'function' && getUser() && getUser().name) || '';
  const q = _vpQueue();
  let added = 0;
  for (const f of list.slice(0, room)) {
    if (f.size > VISIT_PHOTO_MAX_INPUT) { showToast('"' + f.name + '" é grande demais (máx. 15 MB).', 'error'); continue; }
    try {
      const dataUrl = await compressVisitPhoto(f);
      q.push({ id: 'VP-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6), visitId, name: f.name || 'foto.jpg', dataUrl, by: me, createdAt: new Date().toISOString() });
      added++;
    } catch (_) { showToast('Não foi possível ler "' + (f.name || 'a imagem') + '".', 'error'); }
  }
  _vpSaveQueue(q);
  if (added && typeof addLog === 'function') addLog('Anexou foto', 'Visita', visitId, plural(added, 'foto', 'fotos'));
  if (added) showToast(plural(added, 'foto adicionada', 'fotos adicionadas') + (_vpOnline() ? '.' : ' — sobe quando houver conexão.'), 'success');
  flushVisitPhotos();
  return added;
}

let _vpFlushing = false;
async function flushVisitPhotos() {
  if (_vpFlushing || !_vpOnline()) return { sent: 0 };
  _vpFlushing = true;
  let sent = 0;
  try {
    for (const item of _vpQueue()) {
      try {
        const blob = typeof _dataUrlToBlob === 'function' ? _dataUrlToBlob(item.dataUrl) : null;
        if (!blob) continue;
        const { error } = await supabaseClient.storage.from(VISIT_PHOTO_BUCKET)
          .upload(visitPhotoPath(item.visitId, item.id), blob, { upsert: true, contentType: 'image/jpeg' });
        if (error) throw error;
        _vpSaveQueue(_vpQueue().filter((x) => x.id !== item.id));
        sent++;
      } catch (_) { break; } // tenta de novo no próximo `online`
    }
  } finally { _vpFlushing = false; }
  if (sent) { try { if (typeof emitDataChanged === 'function') emitDataChanged('visitas', { photos: sent }); } catch (_) {} }
  return { sent };
}

/** Fotos da visita: enviadas (Storage) + aguardando envio (fila local). */
async function listVisitPhotos(visitId) {
  const pending = _vpQueue().filter((x) => x.visitId === visitId)
    .map((x) => ({ id: x.id, name: x.name, url: x.dataUrl, pending: true, createdAt: x.createdAt }));
  let remote = [];
  if (_vpOnline()) {
    try {
      const { data, error } = await supabaseClient.storage.from(VISIT_PHOTO_BUCKET).list('visits/' + visitId, { limit: 100, sortBy: { column: 'created_at', order: 'asc' } });
      if (!error && Array.isArray(data)) {
        remote = data.filter((o) => o && o.name && !o.name.startsWith('.')).map((o) => {
          const path = 'visits/' + visitId + '/' + o.name;
          const pub = supabaseClient.storage.from(VISIT_PHOTO_BUCKET).getPublicUrl(path);
          return { id: o.name.replace(/\.jpg$/i, ''), name: o.name, url: pub && pub.data ? pub.data.publicUrl : '', path, pending: false, createdAt: o.created_at };
        });
      }
    } catch (_) { remote = []; }
  }
  const ids = new Set(remote.map((r) => r.id));
  return remote.concat(pending.filter((p) => !ids.has(p.id)));
}

async function deleteVisitPhoto(visitId, photoId, path) {
  if (!window.confirm('Excluir esta foto?')) return;
  const q = _vpQueue();
  if (q.some((x) => x.id === photoId)) {
    _vpSaveQueue(q.filter((x) => x.id !== photoId));
  } else if (path && _vpOnline()) {
    const { error } = await supabaseClient.storage.from(VISIT_PHOTO_BUCKET).remove([path]);
    if (error) { showToast('Não foi possível excluir a foto.', 'error'); return; }
  } else {
    showToast('Sem conexão: tente excluir quando estiver online.', 'error');
    return;
  }
  if (typeof addLog === 'function') addLog('Removeu foto', 'Visita', visitId, photoId);
  renderVisitPhotos(visitId);
}

// ── UI: bloco "Fotos" no detalhe da visita ────────────────────────────────
function visitPhotosSectionHtml(visitId) {
  const id = escapeHtml(visitId);
  return '<div class="form-group vp-section" style="margin-top:16px">' +
    '<div class="vp-head"><label class="form-label" style="margin:0">Fotos</label>' +
    '<label class="btn btn-secondary btn-sm vp-add">' +
      '<svg class="ui-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>' +
      ' Adicionar foto' +
      '<input type="file" accept="image/*" capture="environment" multiple hidden onchange="addVisitPhotos(\'' + id + '\', this.files).then(() => renderVisitPhotos(\'' + id + '\')); this.value=\'\'" />' +
    '</label></div>' +
    '<div class="vp-grid" id="vpGrid-' + id + '"><p class="vp-empty">Carregando…</p></div>' +
  '</div>';
}

async function renderVisitPhotos(visitId) {
  const grid = document.getElementById('vpGrid-' + visitId);
  if (!grid) return;
  const photos = await listVisitPhotos(visitId);
  if (!photos.length) { grid.innerHTML = '<p class="vp-empty">Nenhuma foto. No celular, "Adicionar foto" abre a câmera.</p>'; return; }
  grid.innerHTML = photos.map((p) => {
    const pid = escapeHtml(p.id);
    return '<figure class="vp-item' + (p.pending ? ' is-pending' : '') + '">' +
      '<button type="button" class="vp-thumb" onclick="openVisitPhotoViewer(\'' + escapeHtml(visitId) + '\',\'' + pid + '\')" aria-label="Ampliar foto">' +
        '<img src="' + escapeHtml(p.url) + '" alt="Foto da visita" loading="lazy" /></button>' +
      (p.pending ? '<figcaption>Aguardando envio</figcaption>' : '') +
      '<button type="button" class="vp-del" aria-label="Excluir foto" onclick="deleteVisitPhoto(\'' + escapeHtml(visitId) + '\',\'' + pid + '\',\'' + escapeHtml(p.path || '') + '\')">×</button>' +
    '</figure>';
  }).join('');
}

async function openVisitPhotoViewer(visitId, photoId) {
  const photos = await listVisitPhotos(visitId);
  const p = photos.find((x) => x.id === photoId);
  if (!p) return;
  const box = document.createElement('div');
  box.className = 'vp-viewer';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Foto da visita');
  box.innerHTML = '<img src="' + escapeHtml(p.url) + '" alt="Foto da visita" /><button type="button" class="vp-viewer-close" aria-label="Fechar">×</button>';
  const close = () => { box.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  box.addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(box);
}

if (typeof window !== 'undefined' && !window._vpBound) {
  window._vpBound = true;
  window.addEventListener('online', () => { flushVisitPhotos(); });
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') flushVisitPhotos(); });
}

if (typeof module !== 'undefined' && module.exports) module.exports = { visitPhotoScaledSize, visitPhotoPath };
