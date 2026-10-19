// visit-signature.js – Assinatura do cliente na visita
// Coletada ao concluir (ou depois, no detalhe), guardada na própria visita
// (assinatura = PNG em data URL, ~10-30 KB; migration 054) e impressa no
// relatório da visita. Funciona offline: vai junto com o sync da visita.

const SIGNATURE_RE = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;
const SIGNATURE_MAX_W = 600;
const _sigPads = {};

function isValidSignature(dataUrl) {
  return typeof dataUrl === 'string' && dataUrl.length < 400000 && SIGNATURE_RE.test(dataUrl);
}

function signaturePadHtml(id, name) {
  return '<div class="sig-field">' +
    '<input class="form-input" id="' + id + 'Nome" placeholder="Nome de quem assina" maxlength="80" value="' + escapeHtml(name || '') + '" autocomplete="off" />' +
    '<div class="sig-pad"><canvas id="' + id + '" aria-label="Área para assinar com o dedo ou o mouse"></canvas>' +
      '<span class="sig-hint" aria-hidden="true">Assine aqui</span>' +
      '<button type="button" class="sig-clear" data-action="sigClear" data-arg="' + id + '">Limpar</button>' +
    '</div></div>';
}

function initSignaturePad(id) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  const ctx = canvas.getContext('2d');
  ctx.lineWidth = 2.4 * dpr;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#0f172a';
  const pad = { canvas, ctx, dirty: false, drawing: false, last: null };
  _sigPads[id] = pad;
  const pos = (ev) => { const r = canvas.getBoundingClientRect(); return { x: (ev.clientX - r.left) * dpr, y: (ev.clientY - r.top) * dpr }; };
  canvas.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    canvas.setPointerCapture(ev.pointerId);
    pad.drawing = true;
    pad.last = pos(ev);
    ctx.beginPath(); ctx.arc(pad.last.x, pad.last.y, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fillStyle = ctx.strokeStyle; ctx.fill();
    if (!pad.dirty) { pad.dirty = true; canvas.parentNode.classList.add('is-signed'); }
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (!pad.drawing) return;
    const p = pos(ev);
    ctx.beginPath(); ctx.moveTo(pad.last.x, pad.last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    pad.last = p;
  });
  const end = () => { pad.drawing = false; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
}

function clearSignaturePad(id) {
  const pad = _sigPads[id];
  if (!pad) return;
  pad.ctx.clearRect(0, 0, pad.canvas.width, pad.canvas.height);
  pad.dirty = false;
  pad.canvas.parentNode.classList.remove('is-signed');
}

/** { dataUrl, nome } ou null se não assinou. PNG reduzido a 600px de largura. */
function readSignaturePad(id) {
  const pad = _sigPads[id];
  if (!pad || !pad.dirty) return null;
  const src = pad.canvas;
  const scale = Math.min(1, SIGNATURE_MAX_W / src.width);
  const out = document.createElement('canvas');
  out.width = Math.round(src.width * scale);
  out.height = Math.round(src.height * scale);
  out.getContext('2d').drawImage(src, 0, 0, out.width, out.height);
  const nome = (document.getElementById(id + 'Nome')?.value || '').trim().slice(0, 80);
  return { dataUrl: out.toDataURL('image/png'), nome };
}

function signatureFields(sig) {
  if (!sig || !isValidSignature(sig.dataUrl)) return {};
  return { assinatura: sig.dataUrl, assinaturaNome: sig.nome || '', assinaturaEm: new Date().toISOString() };
}

// ── Detalhe da visita ──
function visitSignatureSectionHtml(v) {
  if (!v) return '';
  if (isValidSignature(v.assinatura)) {
    const when = v.assinaturaEm ? new Date(v.assinaturaEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
    return '<div class="form-group sig-view"><label class="form-label">Assinatura do cliente</label>' +
      '<div class="sig-img"><img src="' + escapeHtml(v.assinatura) + '" alt="Assinatura de ' + escapeHtml(v.assinaturaNome || 'cliente') + '" /></div>' +
      '<div class="sig-meta">' + escapeHtml(v.assinaturaNome || 'Sem nome') + (when ? ' · ' + escapeHtml(when) : '') + '</div></div>';
  }
  if (v.status !== 'concluida') return '';
  return '<div class="form-group sig-view"><label class="form-label">Assinatura do cliente</label>' +
    '<button type="button" class="btn btn-sm btn-secondary" data-action="visitSign" data-arg="' + escapeHtml(v.id) + '">✍️ Coletar assinatura</button></div>';
}

function openVisitSignatureModal(id) {
  const v = getVisitById(id);
  if (!v) return;
  openModal('Assinatura do cliente', '<p style="font-size:13px;color:var(--text-secondary);margin:0 0 10px">' +
      escapeHtml(v.clientName || '') + ' · ' + escapeHtml(v.motivo || 'Visita') + '</p>' +
    signaturePadHtml('visitSigOnly', '') +
    '<div class="form-actions">' +
      '<button type="button" class="btn btn-secondary" data-action="openVisit" data-arg="' + escapeHtml(id) + '">Voltar</button>' +
      '<button type="button" class="btn btn-primary" data-action="visitSignSave" data-arg="' + escapeHtml(id) + '">Salvar assinatura</button>' +
    '</div>');
  setTimeout(() => initSignaturePad('visitSigOnly'), 60);
}

function saveVisitSignatureOnly(id) {
  const v = getVisitById(id);
  const sig = readSignaturePad('visitSigOnly');
  if (!v) return;
  if (!sig) { showToast('Peça para o cliente assinar no quadro.', 'error'); return; }
  saveVisit({ ...v, ...signatureFields(sig) });
  showToast('Assinatura salva.', 'success');
  openVisitDetail(id);
}

// ── Relatório da visita (impressão / PDF) ──
function visitReportHtml(v) {
  const e = escapeHtml;
  const num = typeof formatVisitNumero === 'function' ? formatVisitNumero(v) : '';
  const time = typeof formatVisitTimeRange === 'function' ? formatVisitTimeRange(v) : '';
  const row = (k, val) => '<tr><th>' + e(k) + '</th><td>' + val + '</td></tr>';
  const sig = isValidSignature(v.assinatura)
    ? '<div class="rpt-sig"><img src="' + e(v.assinatura) + '" alt="Assinatura" /><div class="rpt-sig-line">' +
        e(v.assinaturaNome || 'Cliente') + (v.assinaturaEm ? ' · ' + e(new Date(v.assinaturaEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })) : '') + '</div></div>'
    : '<div class="rpt-sig rpt-sig--blank"><div class="rpt-sig-line">Assinatura do cliente</div></div>';
  return '<article class="rpt">' +
    '<header class="rpt-head"><div><div class="rpt-brand">Init · Relatório de visita técnica</div>' +
      '<h1>' + e(v.clientName || 'Cliente') + '</h1>' +
      '<div class="rpt-period">' + e(v.date ? formatDate(v.date) : '—') + (time ? ' · ' + e(time) : '') + (num ? ' · ' + e(num) : '') + '</div></div>' +
      '<div class="rpt-gen">Gerado em ' + e(new Date().toLocaleDateString('pt-BR')) + '</div></header>' +
    '<table class="rpt-kv">' +
      row('Técnico', e(v.operator || '—')) +
      row('Motivo', e(v.motivo || '—')) +
      (v.observacoes ? row('Observações', e(v.observacoes).replace(/\n/g, '<br>')) : '') +
    '</table>' +
    '<h2>O que foi feito</h2>' +
    '<p class="rpt-text">' + (v.relatorio ? e(v.relatorio).replace(/\n/g, '<br>') : '<em>Sem relatório.</em>') + '</p>' +
    sig +
  '</article>';
}

function printVisitReport(id) {
  const v = getVisitById(id);
  if (!v || typeof printHtmlDocument !== 'function') return;
  const num = typeof formatVisitNumero === 'function' ? formatVisitNumero(v) : '';
  printHtmlDocument(visitReportHtml(v), 'Visita ' + (num || v.id) + ' - ' + (v.clientName || ''));
}

if (typeof registerActions === 'function') {
  registerActions({
    sigClear: (_el, id) => clearSignaturePad(id),
    visitSign: (_el, id) => openVisitSignatureModal(id),
    visitSignSave: (_el, id) => saveVisitSignatureOnly(id),
    visitPrint: (_el, id) => printVisitReport(id),
  });
}

if (typeof module !== 'undefined' && module.exports) module.exports = { isValidSignature, signatureFields };
