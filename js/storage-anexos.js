// storage-anexos.js – Histórico de atividades, anexos (Storage) e documentos do cliente.
// Parte da camada de dados (antes um único storage.js de 3.400 linhas). Scripts
// clássicos: carregam logo depois de storage.js e compartilham os mesmos globais.
// Nos testes, tests/_storage.cjs junta as partes na mesma ordem.

// ── HISTÓRICO DE ATIVIDADES ──
function getLogs() {
  if (typeof getCacheTable === 'function') {
    const data = getCacheTable('audit_logs');
    return Array.isArray(data) ? data : [];
  }
  const v = dbGet(DB.LOGS);
  return Array.isArray(v) ? v : [];
}

function addLog(action, type, targetId, details) {
  const session = getSession();
  const operatorName = session ? session.name : 'Sistema';
  // Gestão: nunca persiste assunto/descrição de Gestão no histórico.
  // O log guarda só o marcador restrito; a leitura (renderLogs/export)
  // ainda filtra por canViewGestao() como defesa em profundidade.
  var safeDetails = details || '';
  try {
    var _t = String(type || '').trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (_t === 'pendencia' && typeof isPendenciaGestao === 'function' && typeof getPendenciaById === 'function') {
      var _lp = getPendenciaById(targetId);
      if (isPendenciaGestao(_lp)) safeDetails = '[Gestão – restrito]';
    }
  } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'storage-anexos'); }
  const log = {
    id: nextId('LOG'),
    timestamp: new Date().toISOString(),
    operatorName,
    action,
    type,
    targetId,
    details: safeDetails,
    operatorId: session?.opId || null
  };

  if (typeof getCacheTable === 'function' && typeof setCacheTable === 'function') {
    const logs = getLogs();
    logs.unshift(log);
    const uniqueLogs = [...new Map(logs.map(item => [item.id || `${item.timestamp}-${item.action}-${item.targetId}`, item])).values()];
    if (uniqueLogs.length > 2000) uniqueLogs.length = 2000;
    setCacheTable('audit_logs', uniqueLogs);
  } else {
    const logs = getLogs();
    logs.unshift(log);
    if (logs.length > 2000) logs.pop();
    dbSet(DB.LOGS, logs);
  }

  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    supabaseClient.from('audit_logs').insert([{
      id: log.id,
      operator_name: log.operatorName,
      action: log.action,
      type: log.type,
      target_id: log.targetId,
      details: log.details,
      timestamp: log.timestamp
    }]).then(res => { if(res.error) console.warn('⚠️ Supabase log:', res.error.message); })
      .catch(err => console.warn('⚠️ Rede log:', err.message));
  }

  return log;
}

// ── ATTACHMENTS ──
const ATTACHMENT_MAX_SIZE = 2 * 1024 * 1024; // 2MB
const ATTACHMENT_MAX_COUNT = 5;

// ── SEC-10: allowlist de anexos (extensão + MIME, coerentes entre si) ───────
// Por que: só checar tamanho deixava subir .html/.svg/.exe — e svg/html abertos
// numa aba rodam script no nosso domínio (XSS). `file.type` vem do navegador/SO
// e é falsificável, então ele sozinho não decide: a extensão manda, e o MIME
// declarado, se existir, tem que ser um dos aceitos para ela. É defesa de
// cliente; o bucket privado + links assinados (022) continuam sendo a barreira
// real. Conteúdo (magic bytes) não é inspecionado aqui.
const ATTACHMENT_ALLOWED_TYPES = {
  png:  ['image/png'],
  jpg:  ['image/jpeg', 'image/pjpeg'],
  jpeg: ['image/jpeg', 'image/pjpeg'],
  webp: ['image/webp'],
  gif:  ['image/gif'],
  pdf:  ['application/pdf'],
  txt:  ['text/plain'],
  csv:  ['text/csv', 'text/plain', 'application/csv', 'application/vnd.ms-excel'], // Windows reporta csv como ms-excel
  doc:  ['application/msword'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  xls:  ['application/vnd.ms-excel'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ppt:  ['application/vnd.ms-powerpoint'],
  pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  odt:  ['application/vnd.oasis.opendocument.text'],
  ods:  ['application/vnd.oasis.opendocument.spreadsheet'],
  odp:  ['application/vnd.oasis.opendocument.presentation'],
  rtf:  ['application/rtf', 'text/rtf'],
  zip:  ['application/zip', 'application/x-zip-compressed'],
};
// Imagens que o app mostra inline (svg fica de fora de propósito: executa script).
const ATTACHMENT_IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif'];
// Extensão perigosa em QUALQUER posição do nome barra o arquivo (a.exe.pdf).
const ATTACHMENT_DANGEROUS_EXTS = [
  'html', 'htm', 'xhtml', 'shtml', 'svg', 'svgz', 'xml', 'xsl', 'js', 'mjs', 'cjs', 'jsx', 'ts',
  'exe', 'dll', 'msi', 'bat', 'cmd', 'com', 'scr', 'pif', 'cpl', 'lnk', 'ps1', 'psm1', 'vbs', 'vbe', 'wsf', 'wsh',
  'jar', 'apk', 'app', 'dmg', 'sh', 'bash', 'php', 'asp', 'aspx', 'jsp', 'py', 'rb', 'pl', 'hta', 'swf',
  'docm', 'xlsm', 'pptm', 'reg', 'iso', 'msc', 'crx',
];

/** Nome seguro: sem caminho, sem controle/caracteres especiais, sem ponto inicial, tamanho limitado. */
function sanitizeAttachmentName(name) {
  let n = String(name == null ? '' : name);
  n = n.split(/[\\/]/).pop();                       // só o último segmento
  // controle, zero-width e bidi (RLO faz "fdp.exe" parecer "exe.pdf"), por código para não depender de regex com controle
  n = Array.from(n).filter((ch) => {
    const c = ch.charCodeAt(0);
    return !(c <= 0x1f || c === 0x7f || (c >= 0x200b && c <= 0x200f) || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069) || c === 0xfeff);
  }).join('');
  n = n.replace(/[<>:"|?*`'$%&;=#{}[\]^~!@+,]/g, '_').replace(/\s+/g, ' ').trim();
  n = n.replace(/^\.+/, '');                        // sem arquivo oculto / "..": o ponto inicial cai fora
  if (n.length > 100) {
    const i = n.lastIndexOf('.');
    const ext = i > 0 && n.length - i <= 10 ? n.slice(i) : '';
    n = n.slice(0, 100 - ext.length) + ext;
  }
  return n;
}

/**
 * Valida um arquivo antes de aceitar/enviar. Entrada: { name, type|mimeType, size }.
 * Saída: { ok:true, name, ext, mime } ou { ok:false, error } (mensagem em pt-BR).
 */
function validateAttachmentFile(file) {
  if (!file || typeof file !== 'object') return { ok: false, error: 'Arquivo inválido.' };
  const name = sanitizeAttachmentName(file.name);
  if (!name) return { ok: false, error: 'Nome de arquivo inválido.' };
  const size = Number(file.size);
  if (!Number.isFinite(size) || size < 0) return { ok: false, error: 'Tamanho de arquivo inválido.' };
  if (size > ATTACHMENT_MAX_SIZE) return { ok: false, error: 'Arquivo excede o limite de 2MB.' };
  const parts = name.toLowerCase().split('.');
  if (parts.length < 2 || !parts[parts.length - 1]) {
    return { ok: false, error: 'O arquivo precisa ter extensão (ex.: .pdf, .png).' };
  }
  const exts = parts.slice(1);
  const bad = exts.find((e) => ATTACHMENT_DANGEROUS_EXTS.indexOf(e) !== -1);
  if (bad) return { ok: false, error: 'Tipo de arquivo não permitido (.' + bad + ').' };
  const ext = exts[exts.length - 1];
  const allowed = Object.prototype.hasOwnProperty.call(ATTACHMENT_ALLOWED_TYPES, ext) ? ATTACHMENT_ALLOWED_TYPES[ext] : null;
  if (!allowed) {
    return { ok: false, error: 'Tipo de arquivo não permitido (.' + ext + '). Use imagem, PDF, texto, CSV ou documento do Office.' };
  }
  const declared = String(file.mimeType || file.type || '').split(';')[0].trim().toLowerCase();
  // Vazio/genérico é comum (csv, docx no Windows): cai para o MIME canônico da extensão.
  if (declared && declared !== 'application/octet-stream' && allowed.indexOf(declared) === -1) {
    return { ok: false, error: 'O conteúdo declarado (' + declared + ') não confere com a extensão .' + ext + '.' };
  }
  return { ok: true, name, ext, mime: (declared && declared !== 'application/octet-stream') ? declared : allowed[0] };
}

/** Registro já gravado (inclusive legado): pode ser mostrado/baixado? */
function attachmentRecordAllowed(a) {
  if (!a || !a.name) return false;
  return validateAttachmentFile({ name: a.name, mimeType: a.mimeType, size: 0 }).ok;
}

/** Só raster conhecido vira <img>; svg/html nunca. */
function attachmentIsRasterImage(a) {
  if (!attachmentRecordAllowed(a)) return false;
  const v = validateAttachmentFile({ name: a.name, mimeType: a.mimeType, size: 0 });
  return ATTACHMENT_IMAGE_EXTS.indexOf(v.ext) !== -1 && v.mime.indexOf('image/') === 0;
}

/** URL que pode ir para window.open: https ou data: de imagem raster (nunca svg/html). */
function isSafeAttachmentOpenUrl(u) {
  if (typeof u !== 'string') return false;
  if (/^https:\/\//i.test(u)) return true;
  return /^data:image\/(png|jpe?g|webp|gif)[;,]/i.test(u);
}

function getAttachments(type, itemId) {
  // type = 'clients' | 'pendencias'
  const keyMap = { clients: DB.CLIENTS, pendencias: DB.PENDENCIAS };
  const list = dbGet(keyMap[type] || type);
  const item = list.find(i => i.id === itemId);
  return (item && item.attachments) ? item.attachments : [];
}

async function _uploadAttachmentToStorage(type, itemId, attId, file) {
  if (typeof isSupabaseConnected !== 'function' || !isSupabaseConnected() || !window._supabaseAuthActive) return null;
  const v = validateAttachmentFile(file);
  if (!v.ok) return null; // nunca sobe tipo fora da allowlist
  try {
    const path = `${type}/${itemId}/${attId}-${v.name}`;
    const { error } = await supabaseClient.storage.from('attachments').upload(path, file, { upsert: true });
    if (error) { console.warn('Storage upload error:', error.message); return null; }
    const { data } = supabaseClient.storage.from('attachments').getPublicUrl(path);
    return { url: data?.publicUrl || null, path };
  } catch (e) { console.warn('Storage upload exception:', e); return null; }
}

// ── Links assinados (bucket privado desde a 022) ────────────────────────────
// O link público gravado em `url` não abre mais. Para mostrar ou baixar, o
// app pede um link assinado (1 h) a partir do caminho no bucket, em lote e
// com cache: re-renderizar não pede de novo. Fotos da visita usam o mesmo.
const STORAGE_URL_TTL = 3600;
const _storageUrlCache = new Map(); // bucket/path → { url, exp }

/** Caminho no bucket: `path` gravado ou, em anexo antigo, tirado do link público. */
function attachmentStoragePath(a) {
  if (!a) return null;
  if (a.path) return a.path;
  const m = typeof a.url === 'string' && a.url.match(/\/storage\/v1\/object\/public\/attachments\/([^?#]+)/);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch (_) { return m[1]; }
}

/** { path: signedUrl } para os caminhos pedidos (os que falharem ficam de fora). */
async function signedStorageUrls(paths, bucket) {
  const b = bucket || 'attachments';
  const now = Date.now();
  const out = {};
  const missing = [];
  for (const p of new Set(paths || [])) {
    if (!p) continue;
    const c = _storageUrlCache.get(b + '/' + p);
    if (c && c.exp > now) out[p] = c.url; else missing.push(p);
  }
  if (!missing.length || typeof supabaseClient === 'undefined' || !supabaseClient
      || typeof isSupabaseConnected !== 'function' || !isSupabaseConnected()
      || (typeof window !== 'undefined' && !window._supabaseAuthActive)) return out;
  try {
    const { data, error } = await supabaseClient.storage.from(b).createSignedUrls(missing, STORAGE_URL_TTL);
    if (!error && Array.isArray(data)) {
      for (const d of data) {
        if (!d || !d.path || !d.signedUrl) continue;
        out[d.path] = d.signedUrl;
        _storageUrlCache.set(b + '/' + d.path, { url: d.signedUrl, exp: now + (STORAGE_URL_TTL - 300) * 1000 });
      }
    }
  } catch (e) { if (typeof _logSilent === 'function') _logSilent(e, 'storage-anexos'); }
  return out;
}

function forgetSignedStorageUrl(path, bucket) { _storageUrlCache.delete((bucket || 'attachments') + '/' + path); }

/** Imagem ou link de um anexo: data URL (ainda não enviado) ou link assinado preenchido depois. */
function _attachmentLinkAttrs(a) {
  if (a.data) return { src: a.data, signed: '' };
  const path = attachmentStoragePath(a);
  if (path) return { src: '', signed: ' data-att-path="' + escapeHtml(path) + '"' };
  return { src: a.url || '', signed: '' };
}

/** Preenche imagens e links de download marcados com data-att-path. */
async function fillSignedAttachmentLinks(container) {
  if (!container || !container.querySelectorAll) return;
  const els = Array.from(container.querySelectorAll('[data-att-path]'));
  if (!els.length) return;
  const urls = await signedStorageUrls(els.map((el) => el.getAttribute('data-att-path')));
  for (const el of els) {
    const u = urls[el.getAttribute('data-att-path')];
    if (el.tagName === 'IMG') {
      if (u) el.src = u;
    } else if (u) {
      // download= faz o Storage mandar o arquivo com o nome original.
      el.href = u + '&download=' + encodeURIComponent(el.getAttribute('data-att-name') || '');
      el.removeAttribute('aria-disabled');
      el.title = 'Baixar';
    } else {
      el.title = 'Disponível quando estiver online';
    }
  }
}

// ── FASE 2: backfill incremental base64 → Storage (compatível) ──────────────
// Anexos antigos (ou criados offline) têm só `data` (dataURL embutido, pesado:
// viaja em todo select/sync/cache). Quando ONLINE, sobe o conteúdo p/ o mesmo
// bucket/path de sempre e troca por url/path, zerando `data`. Render e
// download preferem `url` e funcionam com ambos (renderAttachmentList:715) —
// nada quebra se a migração não rodar (offline) ou falhar (mantém `data`).
// Sem spam: persiste via dbSet; o sync de fundo propaga pelo _needsPush.
function _dataUrlToBlob(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const m = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!m) return null;
  try {
    const mime = m[1] || 'application/octet-stream';
    const raw = m[3] || '';
    const bin = (typeof atob === 'function' ? atob(raw)
      : Buffer.from(raw, 'base64').toString('binary'));
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    if (typeof Blob === 'function') return new Blob([bytes], { type: mime });
    return null;
  } catch (_) { return null; }
}

async function migrateAttachmentDataToStorage(type, itemId) {
  try {
    if (typeof isSupabaseConnected !== 'function' || !isSupabaseConnected()
        || (typeof window !== 'undefined' && !window._supabaseAuthActive)) return 0;
    if (typeof File === 'undefined' || typeof supabaseClient === 'undefined') return 0;
    const keyMap = { clients: DB.CLIENTS, pendencias: DB.PENDENCIAS };
    const key = keyMap[type];
    if (!key) return 0;
    const list = dbGet(key);
    const idx = list.findIndex(i => i.id === itemId);
    if (idx === -1 || !Array.isArray(list[idx].attachments)) return 0;
    let migrated = 0;
    for (const att of list[idx].attachments) {
      if (!att || !att.data || att.url || att._migrating) continue;
      att._migrating = true;
      try {
        const blob = _dataUrlToBlob(att.data);
        if (!blob) continue;
        const file = new File([blob], att.name || 'anexo', { type: att.mimeType || blob.type });
        const up = await _uploadAttachmentToStorage(type, itemId, att.id, file);
        if (up && up.url) {
          att.url = up.url; att.path = up.path; att.data = null; migrated++;
        }
      } catch (_) { /* mantém base64 — tenta de novo na próxima vez */ }
      finally { delete att._migrating; }
    }
    if (migrated) {
      list[idx].updatedAt = new Date().toISOString();
      dbSet(key, list); // sync de fundo propaga (sem e-mail de "atualizado")
    }
    return migrated;
  } catch (_) { return 0; }
}

function addAttachment(type, itemId, fileObj) {
  // fileObj = {name, mimeType/type, size, data (base64) | url, path}
  const v = validateAttachmentFile(fileObj);
  if (!v.ok) return { error: v.error };
  const keyMap = { clients: DB.CLIENTS, pendencias: DB.PENDENCIAS };
  const key = keyMap[type];
  if (!key) return { error: 'Tipo inválido.' };
  const list = dbGet(key);
  const idx = list.findIndex(i => i.id === itemId);
  if (idx === -1) return { error: 'Item não encontrado.' };
  if (!list[idx].attachments) list[idx].attachments = [];
  if (list[idx].attachments.length >= ATTACHMENT_MAX_COUNT) {
    return { error: `Máximo de ${ATTACHMENT_MAX_COUNT} anexos por item.` };
  }
  const att = {
    id: fileObj.id || ('ATT-' + Date.now() + '-' + _secureRandStr(4)),
    name: v.name,
    mimeType: v.mime,
    size: fileObj.size,
    data: fileObj.data || null,
    url: fileObj.url || null,
    path: fileObj.path || null,
    uploadedBy: (getSession()?.name) || 'Sistema',
    uploadedAt: new Date().toISOString()
  };
  list[idx].attachments.push(att);
  list[idx].updatedAt = new Date().toISOString();
  dbSet(key, list);
  addLog('Anexou arquivo', type === 'clients' ? 'Cliente' : type === 'pendencias' ? 'Pendência' : 'Chamado', itemId, v.name);
  return { success: true, attachment: att };
}

function removeAttachment(type, itemId, attachmentId) {
  const keyMap = { clients: DB.CLIENTS, pendencias: DB.PENDENCIAS };
  const key = keyMap[type];
  if (!key) return false;
  const list = dbGet(key);
  const idx = list.findIndex(i => i.id === itemId);
  if (idx === -1) return false;
  if (!list[idx].attachments) return false;
  const attIdx = list[idx].attachments.findIndex(a => a.id === attachmentId);
  if (attIdx === -1) return false;
  const att = list[idx].attachments[attIdx];
  const attName = att.name;
  list[idx].attachments.splice(attIdx, 1);
  list[idx].updatedAt = new Date().toISOString();
  dbSet(key, list);
  addLog('Removeu anexo', type === 'clients' ? 'Cliente' : type === 'pendencias' ? 'Pendência' : 'Chamado', itemId, attName);
  const attPath = attachmentStoragePath(att);
  if (attPath && typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    forgetSignedStorageUrl(attPath);
    supabaseClient.storage.from('attachments').remove([attPath]).then(res => { if (res.error) console.warn('Storage remove error:', res.error.message); }).catch(() => {});
  }
  return true;
}

function handleFileUpload(type, itemId, inputElement, callback) {
  const file = inputElement.files[0];
  if (!file) return;
  const check = validateAttachmentFile(file);
  if (!check.ok) {
    if (typeof showToast === 'function') showToast(check.error, 'error');
    inputElement.value = '';
    return;
  }
  inputElement.value = '';
  (async () => {
    const attId = 'ATT-' + Date.now() + '-' + _secureRandStr(4);
    let url = null, path = null, data = null;
    try {
      const up = await _uploadAttachmentToStorage(type, itemId, attId, file);
      if (up) { url = up.url; path = up.path; }
    } catch (_e) { url = null; }
    if (!url) {
      try {
        data = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.onerror = reject;
          r.readAsDataURL(file);
        });
      } catch (_e) { data = null; }
    }
    const result = addAttachment(type, itemId, {
      id: attId, name: check.name, mimeType: check.mime, size: file.size, data, url, path
    });
    if (result && result.error) {
      if (typeof showToast === 'function') showToast(result.error, 'error');
    } else {
      if (typeof showToast === 'function') showToast('Arquivo anexado!', 'success');
      if (callback) callback(result.attachment);
    }
  })();
}

function renderAttachmentList(type, itemId, containerId) {
  const atts = getAttachments(type, itemId);
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!atts.length) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:12px;padding:8px 0">Nenhum anexo.</p>';
    return;
  }
  // FASE 2: 1× por container, migra base64→Storage em fundo e re-renderiza
  // só se algo mudou (comportamento idêntico se offline/falha).
  if (!container._attBackfillDone && atts.some(a => a && a.data && !a.url)
      && typeof migrateAttachmentDataToStorage === 'function') {
    container._attBackfillDone = true;
    migrateAttachmentDataToStorage(type, itemId).then(n => {
      if (n > 0 && container.isConnected) renderAttachmentList(type, itemId, containerId);
    }).catch(() => {});
  }
  container.innerHTML = atts.map(a => {
    const blocked = !attachmentRecordAllowed(a); // legado fora da allowlist: sem miniatura nem link
    const isImage = attachmentIsRasterImage(a);
    const sizeKB = (a.size / 1024).toFixed(1);
    const icon = blocked ? '🚫' : isImage ? '🖼️' : a.mimeType?.includes('pdf') ? '📄' : '📎';
    const l = blocked ? { src: '', signed: '' } : _attachmentLinkAttrs(a);
    const href = blocked ? `aria-disabled="true" title="Tipo de arquivo bloqueado"` : l.signed ? `aria-disabled="true" title="Carregando…"` : `href="${escapeHtml(l.src)}" title="Baixar"`;
    return `<div class="attachment-item">
      ${isImage ? `<img src="${escapeHtml(l.src)}"${l.signed} class="attachment-thumb" alt="${escapeHtml(a.name)}" data-action="attOpenFull" />` : `<div class="attachment-icon">${icon}</div>`}
      <div class="attachment-info">
        <div class="attachment-name">${escapeHtml(a.name)}</div>
        <div class="attachment-meta">${sizeKB} KB · ${escapeHtml(a.uploadedBy)} · ${formatDateTime(a.uploadedAt)}</div>
      </div>
      <div class="attachment-actions">
        <a ${href}${l.signed} data-att-name="${escapeHtml(a.name)}" download="${escapeHtml(a.name)}" class="btn btn-sm btn-secondary">⬇</a>
        <button class="btn btn-sm btn-danger" data-action="removeAttachmentUI" data-arg="${escapeHtml(type)}" data-item-id="${escapeHtml(itemId)}" data-att-id="${escapeHtml(a.id)}" data-container-id="${escapeHtml(containerId)}" title="Remover">✕</button>
      </div>
    </div>`;
  }).join('');
  fillSignedAttachmentLinks(container);
}

function removeAttachmentUI(type, itemId, attId, containerId) {
  if (removeAttachment(type, itemId, attId)) {
    if (typeof showToast === 'function') showToast('Anexo removido.', 'info');
    renderAttachmentList(type, itemId, containerId);
  }
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ── CLIENT DOCUMENTS (permanentes, campo documents) ──
function getClientDocuments(clientId) {
  const c = getClientById(clientId);
  return (c && c.documents) ? c.documents : [];
}

function addClientDocument(clientId, fileObj) {
  const v = validateAttachmentFile(fileObj);
  if (!v.ok) return { error: v.error };
  const list = dbGet(DB.CLIENTS);
  const idx = list.findIndex(function(c){ return c.id === clientId; });
  if (idx === -1) return { error: 'Cliente não encontrado.' };
  if (!list[idx].documents) list[idx].documents = [];
  if (list[idx].documents.length >= ATTACHMENT_MAX_COUNT) return { error: 'Máximo de ' + ATTACHMENT_MAX_COUNT + ' documentos por cliente.' };
  var doc = {
    id: fileObj.id || ('DOC-' + Date.now() + '-' + _secureRandStr(4)),
    name: v.name,
    mimeType: v.mime,
    size: fileObj.size,
    data: fileObj.data || null,
    url: fileObj.url || null,
    path: fileObj.path || null,
    uploadedBy: (getSession && getSession()?.name) || 'Sistema',
    uploadedAt: new Date().toISOString()
  };
  list[idx].documents.push(doc);
  list[idx].updatedAt = new Date().toISOString();
  dbSet(DB.CLIENTS, list);
  addLog('Anexou documento', 'Cliente', clientId, v.name);
  return { success: true, document: doc };
}

function removeClientDocument(clientId, docId) {
  const list = dbGet(DB.CLIENTS);
  const idx = list.findIndex(function(c){ return c.id === clientId; });
  if (idx === -1) return false;
  if (!list[idx].documents) return false;
  var dIdx = list[idx].documents.findIndex(function(d){ return d.id === docId; });
  if (dIdx === -1) return false;
  var doc = list[idx].documents[dIdx];
  var docName = doc.name;
  list[idx].documents.splice(dIdx, 1);
  list[idx].updatedAt = new Date().toISOString();
  dbSet(DB.CLIENTS, list);
  addLog('Removeu documento', 'Cliente', clientId, docName);
  var docPath = attachmentStoragePath(doc);
  if (docPath && typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    forgetSignedStorageUrl(docPath);
    supabaseClient.storage.from('attachments').remove([docPath]).then(function(res){ if(res.error) console.warn('Storage remove error:', res.error.message); }).catch(function(){});
  }
  return true;
}

function renderClientDocumentsList(clientId, containerId) {
  var docs = getClientDocuments(clientId);
  var container = document.getElementById(containerId);
  if (!container) return;
  if (!docs.length) { container.innerHTML = '<p style="color:var(--text-muted);font-size:12px;padding:8px 0">Nenhum documento permanente.</p>'; return; }
  container.innerHTML = docs.map(function(a){
    var blocked = !attachmentRecordAllowed(a);
    var isImage = attachmentIsRasterImage(a);
    var sizeKB = (a.size / 1024).toFixed(1);
    var icon = blocked ? '🚫' : isImage ? '🖼️' : a.mimeType && a.mimeType.includes('pdf') ? '📄' : '📎';
    var l = blocked ? { src: '', signed: '' } : _attachmentLinkAttrs(a);
    var href = blocked ? 'aria-disabled="true" title="Tipo de arquivo bloqueado"' : l.signed ? 'aria-disabled="true" title="Carregando…"' : 'href="' + escapeHtml(l.src) + '" title="Baixar"';
    return '<div class="attachment-item">' +
      (isImage ? '<img src="' + escapeHtml(l.src) + '"' + l.signed + ' class="attachment-thumb" alt="' + escapeHtml(a.name) + '" data-action="attOpenFull" />' : '<div class="attachment-icon">' + icon + '</div>') +
      '<div class="attachment-info"><div class="attachment-name">' + escapeHtml(a.name) + '</div><div class="attachment-meta">' + sizeKB + ' KB · ' + escapeHtml(a.uploadedBy) + ' · ' + formatDateTime(a.uploadedAt) + '</div></div>' +
      '<div class="attachment-actions"><a ' + href + l.signed + ' data-att-name="' + escapeHtml(a.name) + '" download="' + escapeHtml(a.name) + '" class="btn btn-sm btn-secondary">⬇</a><button class="btn btn-sm btn-danger" data-action="removeClientDocumentUI" data-arg="' + escapeHtml(clientId) + '" data-att-id="' + escapeHtml(a.id) + '" data-container-id="' + escapeHtml(containerId) + '" title="Remover">✕</button></div></div>';
  }).join('');
  fillSignedAttachmentLinks(container);
}

function removeClientDocumentUI(clientId, docId, containerId) {
  if (removeClientDocument(clientId, docId)) {
    if (typeof showToast === 'function') showToast('Documento removido.', 'info');
    renderClientDocumentsList(clientId, containerId);
  }
}

function handleClientDocumentUpload(clientId, inputElement, callback) {
  var file = inputElement.files[0];
  if (!file) return;
  var check = validateAttachmentFile(file);
  if (!check.ok) { if (typeof showToast === 'function') showToast(check.error, 'error'); inputElement.value=''; return; }
  inputElement.value='';
  (async function(){
    var docId = 'DOC-' + Date.now() + '-' + _secureRandStr(4);
    var url=null,path=null,data=null;
    try { var up = await _uploadAttachmentToStorage('clients', clientId, docId, file); if(up){ url=up.url; path=up.path; } } catch(_e){ url=null; }
    if (!url) {
      try { data = await new Promise(function(resolve,reject){ var r=new FileReader(); r.onload=function(){ resolve(r.result); }; r.onerror=reject; r.readAsDataURL(file); }); } catch(_e){ data=null; }
    }
    var result = addClientDocument(clientId, { id:docId, name:check.name, mimeType:check.mime, size:file.size, data:data, url:url, path:path });
    if (result && result.error) { if (typeof showToast==='function') showToast(result.error,'error'); }
    else { if (typeof showToast==='function') showToast('Documento anexado!', 'success'); if (callback) callback(result.document); renderClientDocumentsList(clientId, 'cliDocumentsList'); }
  })();
}

if (typeof registerActions === 'function') {
  registerActions({
    attOpenFull: (el) => { if (isSafeAttachmentOpenUrl(el.src)) window.open(el.src, '_blank', 'noopener'); },
    removeAttachmentUI: (el) => removeAttachmentUI(el.dataset.arg, el.dataset.itemId, el.dataset.attId, el.dataset.containerId),
    removeClientDocumentUI: (el) => removeClientDocumentUI(el.dataset.arg, el.dataset.attId, el.dataset.containerId),
  });
}
