// pendencias-comando.js – Painel de comando do detalhe, auto-refresh e exports.
// Parte de pendencias.js (dividido para facilitar manutenção). Scripts clássicos:
// carregam logo depois de pendencias.js e compartilham os mesmos globais.
// Nos testes, tests/_parts.cjs junta as partes na mesma ordem.

// ── PAINEL COMANDO: badge de status, dropzone e atalhos (só apresentação) ──
function cmdStatusDotFor(status) {
  try {
    if (typeof STATUS_PEN_MAP !== 'undefined' && STATUS_PEN_MAP[status]) return STATUS_PEN_MAP[status].dot;
  } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'pendencias-comando'); }
  return '#94a3b8';
}
function cmdStatusSync() {
  var sel = document.getElementById('chgStatus');
  var badge = document.getElementById('cmdStatusBadge');
  var wrap = document.querySelector('.pen-cmd');
  if (!sel || !badge) return;
  var st = sel.value;
  var dot = cmdStatusDotFor(st);
  var label = '';
  try {
    label = (typeof STATUS_PEN_MAP !== 'undefined' && STATUS_PEN_MAP[st])
      ? STATUS_PEN_MAP[st].label
      : (sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : st);
  } catch (_) { label = st; }
  badge.innerHTML = '<span class="pen-cmd-dot" aria-hidden="true"></span>' + escapeHtml(label);
  badge.style.setProperty('--st-dot', dot);
  if (wrap) wrap.setAttribute('data-status', st);
}
function cmdStatusPreview(_sel) {
  try { cmdStatusSync(); } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'pendencias-comando'); }
  try { if (typeof showToast === 'function') showToast('Salvando status…', 'info'); } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'pendencias-comando'); }
}
function cmdFocusChecklist() {
  var inp = document.getElementById('newCheckItem');
  if (!inp) return;
  inp.scrollIntoView({ behavior: 'smooth', block: 'center' });
  inp.focus();
}
function cmdRefreshAttCount(penId) {
  try {
    var list = (typeof getAttachments === 'function') ? (getAttachments('pendencias', penId) || []) : [];
    var c = document.getElementById('penAttCounter');
    if (c) {
      c.textContent = list.length ? String(list.length) : '';
      c.classList.toggle('u-6b99de', !list.length);
    }
  } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'pendencias-comando'); }
}
function cmdDropFiles(ev, penId) {
  try {
    var files = (ev && ev.dataTransfer && ev.dataTransfer.files) || [];
    if (!files.length) return;
    var input = document.getElementById('penFileInputSide') || document.getElementById('penFileInput');
    for (var i = 0; i < files.length; i++) {
      try { handleFileUpload('pendencias', penId, { files: [files[i]] }, (function(){ return function(){ renderAttachmentList('pendencias', penId, 'penAttachmentsList'); cmdRefreshAttCount(penId); }; })()); } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'pendencias-comando'); }
    }
    if (input) input.value = '';
  } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'pendencias-comando'); }
}

function renderPenChecklist(id) {
  var p = getPendenciaById(id);
  if (!p) return;
  var list = p.checklist || [];
  var el = document.getElementById('penChecklist');
  var counter = document.getElementById('penCheckCounter');
  var done = list.filter(function (it) { return it && it.done; }).length;
  if (counter) counter.textContent = list.length ? done + '/' + list.length : '';
  var bar = document.getElementById('penCheckProgressBar');
  if (bar) bar.style.width = list.length ? Math.round(done / list.length * 100) + '%' : '0%';
  var lbl = document.getElementById('penCheckProgressLabel');
  if (lbl) lbl.textContent = list.length ? done + '/' + list.length + ' concluídos' : 'Nenhum item — quebre a entrega em passos';
  if (!el) return;
  if (!list.length) {
    el.innerHTML = '<p class="text-muted pen-empty">Nenhum item no checklist.</p>';
    return;
  }
  el.innerHTML = list.map(function(item, i) {
    var isDone = !!(item && item.done);
    return '<div class="pen-check-item' + (isDone ? ' is-done' : '') + '">' +
      '<label class="pen-check-label" title="' + (isDone ? 'Marcar como pendente' : 'Marcar como concluído') + '">' +
      '<input type="checkbox" class="pen-check-box" ' + (isDone ? 'checked' : '') + ' data-change="toggleCheckItem" data-arg="' + escapeHtml(id) + '" data-index="' + i + '" />' +
      '<span class="pen-check-text">' + escapeHtml(item.text) + '</span>' +
      '</label>' +
      '<button class="pen-check-remove" title="Remover item" data-action="removeCheckItem" data-arg="' + escapeHtml(id) + '" data-index="' + i + '">✕</button>' +
    '</div>';
  }).join('');
}

function addCheckItem(id) {
  var input = document.getElementById('newCheckItem');
  var text = input ? input.value.trim() : '';
  if (!text) return;
  var p = getPendenciaById(id);
  if (!p) return;
  if (!p.checklist) p.checklist = [];
  p.checklist.push({ text: text, done: false });
  savePendencia(p);
  if (input) input.value = '';
  renderPenChecklist(id);
  renderPenView(false);
  showToast('Sub-tarefa adicionada.', 'success');
}

function toggleCheckItem(id, index) {
  var p = getPendenciaById(id);
  if (!p || !p.checklist) return;
  p.checklist[index].done = !p.checklist[index].done;
  savePendencia(p);
  renderPenChecklist(id);
  renderPenView(false);
}

function removeCheckItem(id, index) {
  var p = getPendenciaById(id);
  if (!p || !p.checklist) return;
  p.checklist.splice(index, 1);
  savePendencia(p);
  renderPenChecklist(id);
  renderPenView(false);
  showToast('Sub-tarefa removida.', 'info');
}

function openReassignPendencia(penId) {
  const pen = getPendenciaById(penId);
  if (!pen) { if (typeof showToast === 'function') showToast('Pendência não encontrada.', 'error'); return; }
  const eligible = typeof getOperators === 'function' ? getOperators().filter(o => o.active !== false && o.onLeave !== true) : [];
  if (!eligible.length) { if (typeof showToast === 'function') showToast('Nenhum operador disponível para reatribuição.', 'error'); return; }
  const current = pen.responsible || '';
  const team = typeof getCurrentTeam === 'function' ? getCurrentTeam() : null;
  let options = eligible;
  if (team && typeof isTeamAdmin === 'function' && !isTeamAdmin()) {
    const filtered = eligible.filter(o => (o.team || 'init') === team);
    if (filtered.length) options = filtered;
  }
  openModal('Reatribuir pendência', `
    <p class="u-8bf00c">Pendência: <strong>${escapeHtml(getPendenciaTitulo(pen) || pen.id)}</strong><br>Responsável atual: <strong>${escapeHtml(current || '—')}</strong> ${typeof isOperatorOnLeave === 'function' && isOperatorOnLeave(current) ? '<span class="tag badge-afastado">🏖️ Afastado</span>' : ''}</p>
    <div class="form-group">
      <label class="form-label" for="reassignSelect">Novo responsável</label>
      <select class="form-select" id="reassignSelect" aria-label="Novo responsável">
        <option value="">— Sem responsável —</option>
        ${options.map(o => `<option value="${escapeHtml(o.name)}" ${o.name===current?'selected':''}>${escapeHtml(o.name)}</option>`).join('')}
      </select>
    </div>
    <div class="form-actions">
      <button class="btn btn-secondary" data-action="penCmdCloseModal">Cancelar</button>
      <button class="btn btn-primary" data-action="penReassignSave" data-arg="${escapeHtml(penId)}">Salvar</button>
    </div>
  `);
}

function submitReassignPendencia(penId, btn) {
  const enable = () => { try { if (btn) btn.disabled = false; } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'pendencias-comando'); } };
  const pen = getPendenciaById(penId);
  if (!pen) { if (typeof showToast === 'function') showToast('Pendência não encontrada.', 'error'); enable(); return; }
  const sel = document.getElementById('reassignSelect');
  const novo = sel ? sel.value : '';
  if (novo === (pen.responsible || '')) {
    if (typeof showToast === 'function') showToast(novo ? 'Selecione um responsável diferente.' : 'A pendência já está sem responsável.', 'error');
    enable();
    return;
  }
  try {
    const res = updatePendenciaAssignee(penId, { responsible: novo });
    closeModal();
    if (typeof showToast === 'function') showToast(novo ? 'Pendência reatribuída para ' + novo + '!' : 'Responsável removido.', 'success');
    try { _optimisticPenUpsert({ ...res.pen }); } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'pendencias-comando'); } // reflete na lista na hora
  } catch (err) {
    if (typeof showToast === 'function') showToast(err.message || 'Não foi possível reatribuir.', 'error');
    enable();
    return;
  }
  if (typeof renderPenView === 'function' && document.getElementById('penViewArea')) renderPenView(false);
  if (typeof renderMeetingFlow === 'function' && document.getElementById('contentArea') && typeof _meetingState !== 'undefined' && _meetingState) { try { _refreshCurrentGroupPens(); renderMeetingFlow(); } catch(_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'pendencias-comando'); } }
  if (typeof updateBadges === 'function') updateBadges();
}

function _correctCompletionOptions(current) {
  let ops = [];
  try { ops = (typeof getOperators === 'function' ? getOperators() : []) || []; } catch (_) { ops = []; }
  try {
    const team = typeof getCurrentTeam === 'function' ? getCurrentTeam() : null;
    if (team && typeof isTeamAdmin === 'function' && !isTeamAdmin()) {
      const filtered = ops.filter(o => (o.team || 'init') === team);
      if (filtered.length) ops = filtered;
    }
  } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'pendencias-comando'); }
  // Quem concluiu é fato passado: lista todos (vale afastado/inativo).
  return `<option value="">— Não informado —</option>` +
    ops.map(o => `<option value="${escapeHtml(o.name)}" ${o.name===current?'selected':''}>${escapeHtml(o.name)}</option>`).join('');
}

function openCorrectCompletion(penId) {
  const pen = getPendenciaById(penId);
  if (!pen) { if (typeof showToast === 'function') showToast('Pendência não encontrada.', 'error'); return; }
  let _isResolvida = function(s) { return ['concluido', 'resolvido'].indexOf(s || '') !== -1; };
  try { if (typeof isPendenciaResolvida === 'function') _isResolvida = isPendenciaResolvida; } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'pendencias-comando'); }
  if (!_isResolvida(pen.status)) { if (typeof showToast === 'function') showToast('Só é possível informar quem concluiu em pendência concluída.', 'error'); return; }
  const current = pen.completedBy || '';
  let quando = '—';
  try { quando = (typeof formatDateTime === 'function' ? formatDateTime(pen.completedAt) : String(pen.completedAt || '—')); } catch (_) { quando = String(pen.completedAt || '—'); }
  openModal('Corrigir quem concluiu', `
    <p class="u-8bf00c">Pendência: <strong>${escapeHtml(getPendenciaTitulo(pen) || pen.id)}</strong><br>Concluída em: <strong>${escapeHtml(quando)}</strong></p>
    <div class="form-group">
      <label class="form-label" for="correctCompletedBySelect">Quem concluiu</label>
      <select class="form-select" id="correctCompletedBySelect" aria-label="Quem concluiu">
        ${_correctCompletionOptions(current)}
      </select>
    </div>
    <div class="form-actions">
      <button class="btn btn-secondary" data-action="penCmdCloseModal">Cancelar</button>
      <button class="btn btn-primary" data-action="penCorrectSave" data-arg="${escapeHtml(penId)}">Salvar</button>
    </div>
  `);
}

function submitCorrectCompletion(penId, btn) {
  const enable = () => { try { if (btn) btn.disabled = false; } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'pendencias-comando'); } };
  const pen = getPendenciaById(penId);
  if (!pen) { if (typeof showToast === 'function') showToast('Pendência não encontrada.', 'error'); enable(); return; }
  const sel = document.getElementById('correctCompletedBySelect');
  const novo = sel ? sel.value : '';
  if (novo === (pen.completedBy || '')) { if (typeof showToast === 'function') showToast('Nenhuma alteração a salvar.', 'error'); enable(); return; }
  try {
    updatePendenciaAssignee(penId, { completedBy: novo });
    closeModal();
    if (typeof showToast === 'function') showToast(novo ? 'Quem concluiu atualizado para ' + novo + '.' : 'Quem concluiu removido.', 'success');
  } catch (err) {
    if (typeof showToast === 'function') showToast(err.message || 'Não foi possível salvar.', 'error');
    enable();
    return;
  }
  if (typeof renderMeetingFlow === 'function' && document.getElementById('contentArea') && typeof _meetingState !== 'undefined' && _meetingState) { try { _refreshCurrentGroupPens(); renderMeetingFlow(); } catch(_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'pendencias-comando'); } }
  if (typeof updateBadges === 'function') updateBadges();
}

function meetingReassignPen(penId) { return openReassignPendencia(penId); }

// ── Auto-refresh global (preserva filtros/paginação/scroll) ──
(function(){
  if(typeof window==='undefined' || typeof onDataChanged!=='function') return;
  if(window._pendAutoRefresh) return;
  window._pendAutoRefresh=true;
  onDataChanged('pendencias', function(){
    var h=(window.location.hash.replace('#','')||'dashboard');
    if(h!=='pendencias' && h!=='dashboard' && h!=='calendario') return;
    try{ preserveScrollAround(function(){
      if(document.getElementById('penViewArea') && typeof renderPenView==='function') renderPenView(false);
      // Dashboard visível: números/gráficos acompanham sem navegar e voltar.
      if(h==='dashboard' && typeof renderDashboard==='function' && document.getElementById('contentArea')) renderDashboard();
    }); }catch(_e){ if (typeof _logSilent === 'function') _logSilent(_e, 'pendencias-comando'); }
  });
})();

if (typeof registerActions === 'function') {
  registerActions({
    // actions.js entrega el.checked no change — os ids vêm do data-arg/data-index.
    toggleCheckItem: (el) => toggleCheckItem(el.dataset.arg, Number(el.dataset.index)),
    removeCheckItem: (el, id) => removeCheckItem(id, Number(el.dataset.index)),
    penCmdCloseModal: () => closeModal(),
    // Desabilita o botão uma vez clicado (evita duplo submit) e passa o botão adiante.
    penReassignSave: (el, penId) => { el.disabled = true; submitReassignPendencia(penId, el); },
    penCorrectSave: (el, penId) => { el.disabled = true; submitCorrectCompletion(penId, el); },
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { suggestTemplateForDescription, _tokenizeWords, parseMentionedOperators, highlightMentions };
}
