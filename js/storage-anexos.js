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
  } catch (_) {}
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

function getAttachments(type, itemId) {
  // type = 'clients' | 'pendencias' | 'tickets'
  const keyMap = { clients: DB.CLIENTS, pendencias: DB.PENDENCIAS, tickets: DB.TICKETS };
  const list = dbGet(keyMap[type] || type);
  const item = list.find(i => i.id === itemId);
  return (item && item.attachments) ? item.attachments : [];
}

async function _uploadAttachmentToStorage(type, itemId, attId, file) {
  if (typeof isSupabaseConnected !== 'function' || !isSupabaseConnected() || !window._supabaseAuthActive) return null;
  try {
    const path = `${type}/${itemId}/${attId}-${file.name}`;
    const { error } = await supabaseClient.storage.from('attachments').upload(path, file, { upsert: true });
    if (error) { console.warn('Storage upload error:', error.message); return null; }
    const { data } = supabaseClient.storage.from('attachments').getPublicUrl(path);
    return { url: data?.publicUrl || null, path };
  } catch (e) { console.warn('Storage upload exception:', e); return null; }
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
    const keyMap = { clients: DB.CLIENTS, pendencias: DB.PENDENCIAS, tickets: DB.TICKETS };
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
  if (fileObj.size > ATTACHMENT_MAX_SIZE) {
    return { error: 'Arquivo excede o limite de 2MB.' };
  }
  const keyMap = { clients: DB.CLIENTS, pendencias: DB.PENDENCIAS, tickets: DB.TICKETS };
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
    name: fileObj.name,
    mimeType: fileObj.mimeType || fileObj.type,
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
  addLog('Anexou arquivo', type === 'clients' ? 'Cliente' : type === 'pendencias' ? 'Pendência' : 'Chamado', itemId, fileObj.name);
  return { success: true, attachment: att };
}

function removeAttachment(type, itemId, attachmentId) {
  const keyMap = { clients: DB.CLIENTS, pendencias: DB.PENDENCIAS, tickets: DB.TICKETS };
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
  if (att.path && typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    supabaseClient.storage.from('attachments').remove([att.path]).then(res => { if (res.error) console.warn('Storage remove error:', res.error.message); }).catch(() => {});
  }
  return true;
}

function handleFileUpload(type, itemId, inputElement, callback) {
  const file = inputElement.files[0];
  if (!file) return;
  if (file.size > ATTACHMENT_MAX_SIZE) {
    if (typeof showToast === 'function') showToast('Arquivo excede o limite de 2MB.', 'error');
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
    } catch (e) { url = null; }
    if (!url) {
      try {
        data = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.onerror = reject;
          r.readAsDataURL(file);
        });
      } catch (e) { data = null; }
    }
    const result = addAttachment(type, itemId, {
      id: attId, name: file.name, mimeType: file.type, size: file.size, data, url, path
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
    const isImage = a.mimeType && a.mimeType.startsWith('image/');
    const sizeKB = (a.size / 1024).toFixed(1);
    const icon = isImage ? '🖼️' : a.mimeType?.includes('pdf') ? '📄' : '📎';
    const src = a.url || a.data || '';
    return `<div class="attachment-item">
      ${isImage ? `<img src="${src}" class="attachment-thumb" alt="${escapeHtml(a.name)}" onclick="window.open(this.src,'_blank','noopener')" />` : `<div class="attachment-icon">${icon}</div>`}
      <div class="attachment-info">
        <div class="attachment-name">${escapeHtml(a.name)}</div>
        <div class="attachment-meta">${sizeKB} KB · ${escapeHtml(a.uploadedBy)} · ${formatDateTime(a.uploadedAt)}</div>
      </div>
      <div class="attachment-actions">
        <a href="${src}" download="${escapeHtml(a.name)}" class="btn btn-sm btn-secondary" title="Baixar">⬇</a>
        <button class="btn btn-sm btn-danger" onclick="removeAttachmentUI('${type}','${itemId}','${a.id}','${containerId}')" title="Remover">✕</button>
      </div>
    </div>`;
  }).join('');
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
  if (fileObj.size > ATTACHMENT_MAX_SIZE) return { error: 'Arquivo excede o limite de 2MB.' };
  const list = dbGet(DB.CLIENTS);
  const idx = list.findIndex(function(c){ return c.id === clientId; });
  if (idx === -1) return { error: 'Cliente não encontrado.' };
  if (!list[idx].documents) list[idx].documents = [];
  if (list[idx].documents.length >= ATTACHMENT_MAX_COUNT) return { error: 'Máximo de ' + ATTACHMENT_MAX_COUNT + ' documentos por cliente.' };
  var doc = {
    id: fileObj.id || ('DOC-' + Date.now() + '-' + _secureRandStr(4)),
    name: fileObj.name,
    mimeType: fileObj.mimeType || fileObj.type,
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
  addLog('Anexou documento', 'Cliente', clientId, fileObj.name);
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
  if (doc.path && typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    supabaseClient.storage.from('attachments').remove([doc.path]).then(function(res){ if(res.error) console.warn('Storage remove error:', res.error.message); }).catch(function(){});
  }
  return true;
}

function renderClientDocumentsList(clientId, containerId) {
  var docs = getClientDocuments(clientId);
  var container = document.getElementById(containerId);
  if (!container) return;
  if (!docs.length) { container.innerHTML = '<p style="color:var(--text-muted);font-size:12px;padding:8px 0">Nenhum documento permanente.</p>'; return; }
  container.innerHTML = docs.map(function(a){
    var isImage = a.mimeType && a.mimeType.startsWith('image/');
    var sizeKB = (a.size / 1024).toFixed(1);
    var icon = isImage ? '🖼️' : a.mimeType && a.mimeType.includes('pdf') ? '📄' : '📎';
    var src = a.url || a.data || '';
    return '<div class="attachment-item">' +
      (isImage ? '<img src="' + src + '" class="attachment-thumb" alt="' + escapeHtml(a.name) + '" onclick="window.open(this.src,\'_blank\',\'noopener\')" />' : '<div class="attachment-icon">' + icon + '</div>') +
      '<div class="attachment-info"><div class="attachment-name">' + escapeHtml(a.name) + '</div><div class="attachment-meta">' + sizeKB + ' KB · ' + escapeHtml(a.uploadedBy) + ' · ' + formatDateTime(a.uploadedAt) + '</div></div>' +
      '<div class="attachment-actions"><a href="' + src + '" download="' + escapeHtml(a.name) + '" class="btn btn-sm btn-secondary" title="Baixar">⬇</a><button class="btn btn-sm btn-danger" onclick="removeClientDocumentUI(\'' + clientId + '\',\'' + a.id + '\',\'' + containerId + '\')" title="Remover">✕</button></div></div>';
  }).join('');
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
  if (file.size > ATTACHMENT_MAX_SIZE) { if (typeof showToast === 'function') showToast('Arquivo excede o limite de 2MB.', 'error'); inputElement.value=''; return; }
  inputElement.value='';
  (async function(){
    var docId = 'DOC-' + Date.now() + '-' + _secureRandStr(4);
    var url=null,path=null,data=null;
    try { var up = await _uploadAttachmentToStorage('clients', clientId, docId, file); if(up){ url=up.url; path=up.path; } } catch(e){ url=null; }
    if (!url) {
      try { data = await new Promise(function(resolve,reject){ var r=new FileReader(); r.onload=function(){ resolve(r.result); }; r.onerror=reject; r.readAsDataURL(file); }); } catch(e){ data=null; }
    }
    var result = addClientDocument(clientId, { id:docId, name:file.name, mimeType:file.type, size:file.size, data:data, url:url, path:path });
    if (result && result.error) { if (typeof showToast==='function') showToast(result.error,'error'); }
    else { if (typeof showToast==='function') showToast('Documento anexado!', 'success'); if (callback) callback(result.document); renderClientDocumentsList(clientId, 'cliDocumentsList'); }
  })();
}
