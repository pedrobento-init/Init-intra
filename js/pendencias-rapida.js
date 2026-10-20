// ── Abertura rápida de pendência ──────────────────────────────────────────
// Cliente + assunto e pronto: tipo Suporte, responsável = quem abre,
// prazo pelo SLA da prioridade, descrição = assunto se ficar em branco.
// "Formulário completo" leva o que já foi digitado para o formulário inteiro.

function _penRapidaClientes() {
  const sel = typeof _selectedTeam !== 'undefined' && _selectedTeam;
  return (typeof isTeamAdmin === 'function' && isTeamAdmin() && sel) ? getClientsByTeam(sel) : getMyClients();
}

function openPendenciaRapida(preClientId) {
  const clients = _penRapidaClientes().slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR'));
  const me = (typeof getUser === 'function' && getUser().name) || '';
  const team = typeof isTeamAdmin === 'function' && isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam ? _selectedTeam : getCurrentTeam();
  const ops = typeof getOperatorNames === 'function' ? getOperatorNames(team) : [];
  const opNames = ops.length ? ops : [me];
  openModal('Nova pendência', `
    <form class="pen-rapida" data-submit="penRapidaSubmit" novalidate>
      <div class="form-group"><label class="form-label" for="prCliente">Cliente</label>
        <select class="form-select" id="prCliente" name="clientId">
          <option value="">Interno (sem cliente)</option>
          ${clients.map(c => `<option value="${escapeHtml(c.id)}" ${preClientId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
        </select></div>
      <div class="form-group"><label class="form-label" for="prAssunto">O que precisa ser feito? *</label>
        <input class="form-input" id="prAssunto" name="assunto" maxlength="120" required autocomplete="off" placeholder="Ex.: Impressora do financeiro não imprime" /></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label" for="prCategoria">Categoria</label>
          <select class="form-select" id="prCategoria" name="categoria">${penCategoriaOptionsHtml('')}</select></div>
        <div class="form-group"><label class="form-label" for="prPrioridade">Prioridade</label>
          <select class="form-select" id="prPrioridade" name="priority">
            <option value="baixa">Baixa</option><option value="media" selected>Média</option>
            <option value="alta">Alta</option><option value="critica">Crítica</option>
          </select></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label" for="prSolicitante">Solicitante</label>
          <input class="form-input" id="prSolicitante" name="solicitante" maxlength="120" list="prSolicitanteList" autocomplete="off" placeholder="Quem pediu" />
          ${penSolicitanteDatalistHtml('prSolicitanteList', preClientId)}</div>
        <div class="form-group"><label class="form-label" for="prCanal">Canal</label>
          <select class="form-select" id="prCanal" name="canal">${penCanalOptionsHtml('')}</select></div>
      </div>
      <div class="form-group"><label class="form-label" for="prResp">Responsável</label>
        <select class="form-select" id="prResp" name="responsible">
          ${opNames.map(n => `<option value="${escapeHtml(n)}" ${n === me ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')}
        </select></div>
      <details class="pen-rapida-mais">
        <summary>Detalhes (opcional)</summary>
        <textarea class="form-textarea" name="descricao" rows="3" aria-label="Detalhes" placeholder="Contexto, mensagem de erro, onde acontece…"></textarea>
      </details>
      <input type="hidden" name="deadline" value="" data-sla-auto="1" />
      <p class="sla-hint" data-sla-hint></p>
      <div class="form-actions">
        <button type="button" class="btn btn-link pen-rapida-full" data-action="penRapidaFull">Formulário completo</button>
        <button type="button" class="btn btn-secondary" data-action="closeModal">Cancelar</button>
        <button type="submit" class="btn btn-primary">Criar pendência</button>
      </div>
    </form>`);
  const form = document.querySelector('#modalBody form.pen-rapida');
  if (!form) return;
  slaBindPrazoAuto(form);
  slaBindSolicitante(form, 'prSolicitanteList');
  const assunto = form.querySelector('#prAssunto');
  if (assunto) assunto.focus();
}

/** Lê o formulário rápido e monta a pendência (puro o bastante para teste). */
function penRapidaData(values, today) {
  const v = values || {};
  const assunto = String(v.assunto || '').trim();
  const priority = ['baixa', 'media', 'alta', 'critica'].includes(v.priority) ? v.priority : 'media';
  return {
    clientId: v.clientId || '',
    clientName: v.clientName || '',
    tipo: 'Suporte',
    assunto,
    descricao: String(v.descricao || '').trim() || assunto,
    responsible: v.responsible || '',
    status: 'aberto',
    priority,
    deadline: v.deadline || slaPrazoSugerido(priority, today),
    solicitante: String(v.solicitante || '').trim(),
    canal: v.canal || '',
    categoria: v.categoria || '',
    tags: [],
    recurrence: '',
    linkUtil: '',
  };
}

function _penRapidaValues(form) {
  const fd = new FormData(form);
  const o = {};
  fd.forEach((val, k) => { o[k] = String(val); });
  return o;
}

function submitPendenciaRapida(form) {
  const vals = _penRapidaValues(form);
  if (!String(vals.assunto || '').trim()) {
    showToast('Escreva o que precisa ser feito.', 'error');
    const a = form.querySelector('#prAssunto');
    if (a) a.focus();
    return;
  }
  const client = vals.clientId ? getClientById(vals.clientId) : null;
  if (vals.clientId && !client) { showToast('Cliente inválido.', 'error'); return; }
  if (client && !isTeamAdmin() && (client.team || 'init') !== getCurrentTeam()) {
    showToast('Você não pode criar pendências para clientes de outra equipe.', 'error');
    return;
  }
  vals.clientName = client ? client.name : '';
  const data = penRapidaData(vals, localDateISO());
  const errors = validatePendencia(data);
  if (errors.length) { showToast(errors[0], 'error'); return; }
  try {
    savePendencia(data);
  } catch (err) { showToast('Erro ao salvar pendência: ' + err.message, 'error'); return; }
  closeModal();
  const page = (window.location.hash || '').replace('#', '');
  if (page === 'pendencias' && typeof renderPenView === 'function' && document.getElementById('penViewArea')) {
    try { _penPage = 0; _penLastSig = ''; _optimisticPenUpsert(data, { isNew: true }); } catch (_) {}
    renderPenView(true);
  } else if (page === 'fila' && typeof renderFila === 'function') {
    renderFila();
  }
  if (typeof updateBadges === 'function') updateBadges();
  showToast('Pendência criada!', 'success');
}

/** Leva o que já foi digitado para o formulário completo. */
function penRapidaParaCompleto(form) {
  const v = _penRapidaValues(form);
  const pre = {
    assunto: v.assunto || '', descricao: v.descricao || '', priority: v.priority || 'media',
    responsible: v.responsible || '', solicitante: v.solicitante || '', canal: v.canal || '',
    categoria: v.categoria || '', tipo: 'Suporte', status: 'aberto',
  };
  closeModal();
  openPendenciaForm(null, v.clientId || null, null, pre);
}

if (typeof registerActions === 'function') {
  registerActions({
    newPendencia: () => openPendenciaRapida(),
    penRapidaSubmit: (el) => submitPendenciaRapida(el),
    penRapidaFull: (el) => { const f = el.closest('form'); if (f) penRapidaParaCompleto(f); },
    penSetField: (el, value) => { if (typeof quickUpdatePendenciaField === 'function') quickUpdatePendenciaField(el.dataset.id, el.dataset.field, value); },
    penEditSolicitante: (_el, id) => {
      const p = typeof getPendenciaById === 'function' ? getPendenciaById(id) : null;
      if (!p) return;
      const nome = window.prompt('Solicitante (quem pediu, no cliente):', p.solicitante || '');
      if (nome !== null) quickUpdatePendenciaField(id, 'solicitante', nome);
    },
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { penRapidaData };
}
