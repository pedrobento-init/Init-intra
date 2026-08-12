// clients.js
const COLORS = ['#1a56db','#3b82f6','#6366f1','#4f46e5','#0891b2','#0f766e','#16a34a','#d97706','#dc2626','#7c3aed'];

let _clientPage = 1;
let _filteredClients = [];
const CLIENT_PAGE_SIZE = 30;

function renderClients() {
  document.getElementById('pageTitle').textContent = 'Clientes';
  const filterState = loadFilterState('clients', {});
  _clientPage = filterState._clientPage || 1;
  setTopbarAction('+ Novo Cliente', '<svg class="topbar-action-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>');
  window._topbarAction = () => openClientForm();

  const clients  = typeof getMyClients === 'function' ? getMyClients() : getClients();
  _filteredClients = clients;
  document.getElementById('contentArea').innerHTML = `
    <div class="search-bar">
      <div class="search-input-wrap" style="flex:1">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input class="form-input" id="clientSearch" placeholder="Buscar cliente..." value="${filterState.search || ''}" oninput="debouncedFilterClientCards()" />
      </div>
      <button class="btn btn-secondary" onclick="openImportClientsModal()" title="Importar clientes de Word/CSV"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Importar</button>
    </div>
    <div class="client-cards-grid" id="clientGrid"></div>`;
  showSkeleton('clientGrid', 8);
  renderClientGrid();
}

window.debouncedFilterClientCards = debounce(filterClientCards, 300);

function filterClientCards() {
  _clientPage = 1;
  const q = document.getElementById('clientSearch').value.toLowerCase();
  saveFilterState('clients', {search: document.getElementById('clientSearch').value, _clientPage: _clientPage});
  const all = typeof getMyClients === 'function' ? getMyClients() : getClients();
  _filteredClients = q ? all.filter(c => c.name?.toLowerCase().includes(q) || c.segment?.toLowerCase().includes(q)) : all;
  renderClientGrid();
}

function renderClientGrid() {
  const grid = document.getElementById('clientGrid');
  if (!grid) return;
  const clients = _filteredClients;
  if (!clients.length) { grid.innerHTML = `<div class="empty-state"><p>Nenhum cliente cadastrado</p><button class="btn btn-primary btn-sm" onclick="openClientForm()">+ Novo Cliente</button></div>`; return; }

  setTimeout(() => {
    const totalPages = Math.ceil(clients.length / CLIENT_PAGE_SIZE);
    if (_clientPage > totalPages) _clientPage = totalPages;
    if (_clientPage < 1) _clientPage = 1;

    const startIdx = (_clientPage - 1) * CLIENT_PAGE_SIZE;
    const pageClients = clients.slice(startIdx, startIdx + CLIENT_PAGE_SIZE);

    grid.innerHTML = pageClients.map(c => {
      const pending = getPendencias().filter(p => p.clientId === c.id && !['concluido','cancelado'].includes(p.status)).length;
      return `<div class="client-card" onclick="viewClient('${escapeHtml(c.id)}')">
      <div class="client-card-logo">${clientAvatar(c, 64)}</div>
      <div class="client-card-name">${escapeHtml(c.name)}</div>
      <div class="client-card-seg">${escapeHtml(c.segment || '')}</div>
      <div class="client-card-footer">
        ${pending > 0 ? `<span class="tag tag-yellow">${pending} pendência${pending>1?'s':''}</span>` : `<span class="tag tag-green">Em dia</span>`}
        <div style="display:flex;gap:4px">
          <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation();openClientForm('${escapeHtml(c.id)}')">Editar</button>
          <button class="btn btn-sm btn-danger" onclick="event.stopPropagation();deleteClientConfirm('${escapeHtml(c.id)}')">✕</button>
        </div>
      </div>
    </div>`;
    }).join('') + (totalPages > 1 ? `
    <div style="grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-top:1px solid var(--border)">
      <div style="font-size:12px;color:var(--text-muted)">Mostrando ${startIdx+1}–${Math.min(startIdx+CLIENT_PAGE_SIZE, clients.length)} de ${clients.length} clientes</div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-sm btn-secondary" ${_clientPage===1?'disabled':''} onclick="_clientPage--;renderClientGrid()">← Anterior</button>
        <span style="font-size:13px;padding:4px 8px;display:flex;align-items:center">${_clientPage} / ${totalPages}</span>
        <button class="btn btn-sm btn-secondary" ${_clientPage===totalPages?'disabled':''} onclick="_clientPage++;renderClientGrid()">Próxima →</button>
      </div>
    </div>
  ` : '');
  }, 10);
}

function viewClient(id) {
  const c = getClientById(id);
  if (!c) return;
  openModal(c.name, `
    <div class="tabs" id="clientTabs">
      <div class="tab active" onclick="switchClientTab('ficha','${id}')">Ficha TI</div>
      <div class="tab" onclick="switchClientTab('procedimentos','${id}')">Procedimentos</div>
      <div class="tab" onclick="switchClientTab('pendencias','${id}')">Pendências</div>
      <div class="tab" onclick="switchClientTab('visitas','${id}')">Visitas</div>
      <div class="tab" onclick="switchClientTab('documentos','${id}')">Anexos / Docs</div>
    </div>
    <div id="clientTabContent"></div>`, 'lg');
  renderClientTab('ficha', id);
}

function switchClientTab(tab, id) {
  document.querySelectorAll('#clientTabs .tab').forEach((t,i) => t.classList.toggle('active', ['ficha','procedimentos','pendencias','visitas','documentos'][i]===tab));
  renderClientTab(tab, id);
}

function renderClientTab(tab, id) {
  const c = getClientById(id);
  const el = document.getElementById('clientTabContent');
  if (tab === 'ficha') {
    const ir = (label, val) => `<div class="info-item"><div class="info-key">${label}</div><div class="info-value ${val?'':'empty'}">${val||'Não informado'}</div></div>`;
    el.innerHTML = `
      <div style="display:flex;gap:8px;margin-bottom:16px">
        <button class="btn btn-primary btn-sm" onclick="closeModal();openClientForm('${id}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Editar</button>
        <button class="btn btn-secondary btn-sm" onclick="closeModal();navigateTo('pendencias');setTimeout(()=>openPendenciaForm(null,'${id}'),100)">+ Pendência</button>
      </div>
      <div class="client-detail-section">
        <div class="client-detail-section-title">👤 Identificação</div>
        <div class="info-grid">${ir('CNPJ/CPF',c.cnpj)}${ir('Segmento',c.segment)}${ir('Dono',c.owner)}${ir('Contato Dono',c.ownerPhone)}${ir('Responsável TI',c.responsible)}${ir('Contato',c.responsiblePhone)}${ir('Técnico',c.technician)}</div>
      </div>
      <div class="client-detail-section">
        <div class="client-detail-section-title">🖥️ Servidor</div>
        <div class="info-grid">${ir('Tipo',c.server?.type)}${ir('SO',c.server?.os)}${ir('IP',c.server?.ip)}${ir('Acesso Remoto',c.server?.remoteAccess)}${ir('ID Acesso',c.server?.remoteId)}${ir('Obs',c.server?.notes)}</div>
      </div>
      <div class="client-detail-section">
        <div class="client-detail-section-title">🌐 Hospedagem</div>
        <div class="info-grid">${ir('Provedor',c.hosting?.provider)}${ir('Painel',c.hosting?.panelUrl)}${ir('Usuário',c.hosting?.user)}</div>
      </div>
      <div class="client-detail-section">
        <div class="client-detail-section-title">💾 Backup</div>
        <div class="info-grid">${ir('Frequência',c.backup?.frequency)}${ir('Horário',c.backup?.time)}${ir('Destino',c.backup?.destination)}${ir('Ferramenta',c.backup?.tool)}${ir('Última Verificação',c.backup?.lastCheck)}</div>
      </div>
      <div class="client-detail-section">
        <div class="client-detail-section-title">📧 E-mail</div>
        <div class="info-grid">${ir('Provedor',c.emails?.provider)}${ir('Domínio',c.emails?.domain)}${ir('Servidor',c.emails?.server)}${ir('Porta',c.emails?.port)}${ir('Quota',c.emails?.quota)}</div>
      </div>
      ${(c.licenses||[]).length ? `<div class="client-detail-section"><div class="client-detail-section-title">🔑 Licenças</div><div class="info-grid">${c.licenses.map(l=>`<div class="info-item" style="grid-column:1/-1"><div class="info-key">Software</div><div class="info-value">${escapeHtml(l.software)} ${l.expiry?`<span class="tag tag-yellow">até ${escapeHtml(l.expiry)}</span>`:''}</div>${l.key?`<div style="font-size:12px;color:var(--text-muted);margin-top:4px">Chave: <code style="background:var(--bg-base);padding:2px 6px;border-radius:4px">${escapeHtml(l.key)}</code></div>`:''}</div>`).join('')}</div></div>` : ''}
      ${c.notes ? `<div class="client-detail-section"><div class="client-detail-section-title">📝 Obs</div><div class="timeline-text">${escapeHtml(c.notes)}</div></div>` : ''}`;
  } else if (tab === 'procedimentos') {
    const procs = getProcedures(id);
    el.innerHTML = `<div style="margin-bottom:12px;display:flex;gap:8px">
        <button class="btn btn-primary btn-sm" onclick="openProcedureForm('${id}')">+ Novo Procedimento</button>
      </div>
      ${procs.length ? procs.map(p => `
        <div class="proc-card" id="proc-${escapeHtml(p.id)}">
          <div class="proc-card-header" onclick="toggleProcCard('${escapeHtml(p.id)}')">
            <div style="flex:1;min-width:0">
              <div class="proc-card-title">${escapeHtml(p.title)}</div>
              ${p.category ? `<span class="tag tag-blue" style="margin-top:4px">${escapeHtml(p.category)}</span>` : ''}
            </div>
            <div class="proc-actions" onclick="event.stopPropagation()">
              <button class="btn btn-sm btn-secondary" onclick="openProcedureForm('${escapeHtml(id)}','${escapeHtml(p.id)}')">Editar</button>
              <button class="btn btn-sm btn-danger" onclick="deleteProcedureConfirm('${escapeHtml(p.id)}','${escapeHtml(id)}')">✕</button>
            </div>
          </div>
          <pre class="proc-content">${escapeHtml(p.content)}</pre>
        </div>`).join('') : `<div class="empty-state"><p>Nenhum procedimento cadastrado</p></div>`}`;
  } else if (tab === 'documentos') {
    el.innerHTML = `
      <div class="attachment-section" style="margin-top:0">
        <div class="section-header" style="margin-bottom:12px">
          <span class="section-title">📁 Documentos e Anexos do Cliente (Máx 2MB)</span>
          <label class="btn btn-primary btn-sm" style="cursor:pointer">
            + Enviar Documento
            <input type="file" id="cliFileInput" style="display:none" onchange="handleFileUpload('clients','${id}',this,()=>renderAttachmentList('clients','${id}','cliAttachmentsList'))" />
          </label>
        </div>
        <div class="attachment-list" id="cliAttachmentsList"></div>
      </div>
    `;
    setTimeout(() => renderAttachmentList('clients', id, 'cliAttachmentsList'), 20);
  } else if (tab === 'visitas') {
    const visits = getVisitsByClient(id);
    el.innerHTML = `<div style="margin-bottom:12px;display:flex;gap:8px">
        <button class="btn btn-primary btn-sm" onclick="openVisitForm(null,'${escapeHtml(id)}')">+ Registrar Visita</button>
      </div>
      ${visits.length ? `<div class="table-wrapper"><table><thead><tr><th>Data</th><th>Horário</th><th>Motivo</th><th>Operador</th><th>Status</th><th></th></tr></thead><tbody>${visits.map(v => `<tr>
        <td><strong>${formatDate(v.date)}</strong></td>
        <td>${escapeHtml(typeof formatVisitTimeRange === 'function' ? formatVisitTimeRange(v) : (v.time || '—'))}</td>
        <td>${escapeHtml(v.motivo || '—')}${v.observacoes ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">${escapeHtml(v.observacoes)}</div>` : ''}</td>
        <td>${escapeHtml(v.operator || '—')}</td>
        <td>${typeof visitStatusTag === 'function' ? visitStatusTag(v.status) : escapeHtml(v.status)}</td>
        <td style="text-align:right"><button class="btn btn-sm btn-secondary" onclick="openVisitDetail('${escapeHtml(v.id)}')">Abrir</button></td>
      </tr>`).join('')}</tbody></table></div>` : `<div class="empty-state"><p>Nenhuma visita registrada para este cliente.</p></div>`}`;
  } else {
    const pens = getPendencias().filter(p => p.clientId === id);
    el.innerHTML = `<div style="margin-bottom:12px"><button class="btn btn-primary btn-sm" onclick="closeModal();navigateTo('pendencias');setTimeout(()=>openPendenciaForm(null,'${id}'),100)">+ Nova Pendência</button></div>
      ${pens.length ? `<div class="table-wrapper"><table><thead><tr><th>Tipo</th><th>Descrição</th><th>Responsável</th><th>Status</th><th>Prioridade</th><th>Prazo</th></tr></thead><tbody>${pens.map(p=>`<tr><td>${escapeHtml(p.tipo||'—')}</td><td>${escapeHtml(p.descricao||'—')}</td><td>${escapeHtml(p.responsible||'—')}</td><td>${statusTag(p.status)}</td><td>${priorityTag(p.priority)}</td><td>${p.deadline?formatDate(p.deadline):'—'}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty-state"><p>Nenhuma pendência</p></div>`}`;
  }
}

function openProcedureForm(clientId, procId = null) {
  const p = procId ? getProcedures(clientId).find(x => x.id === procId) : {};
  const templates = typeof getProcedureTemplates === 'function' ? getProcedureTemplates() : [];

  openModal(procId ? 'Editar Procedimento' : 'Novo Procedimento', `
    <form onsubmit="submitProcedureForm(event,'${clientId}','${procId||''}')">
      ${templates.length ? `
        <div style="margin-bottom:14px;padding:10px 12px;background:var(--bg-base);border:1px solid var(--border);border-radius:8px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div>
            <div style="font-size:12px;font-weight:600;color:var(--text-primary)">📋 Carregar do Modelo</div>
            <div style="font-size:11px;color:var(--text-muted)">Preenche o formulário com o padrão selecionado</div>
          </div>
          <div style="display:flex;gap:6px;align-items:center">
            <select class="form-select" id="templatePickerSelect" style="font-size:12px;padding:4px 8px;max-width:220px">
              <option value="">Selecione um modelo...</option>
              ${templates.map(t => `<option value="${t.id}">${escapeHtml(t.title)}${t.category ? ` (${escapeHtml(t.category)})` : ''}</option>`).join('')}
            </select>
            <button type="button" class="btn btn-secondary btn-sm" onclick="loadTemplateIntoProcedureForm()">Carregar</button>
          </div>
        </div>
      ` : ''}
      <div class="form-group"><label class="form-label">Título *</label><input class="form-input" id="procTitleInput" name="title" value="${escapeHtml(p?.title||'')}" required /></div>
      <div class="form-group"><label class="form-label">Categoria</label><input class="form-input" id="procCategoryInput" name="category" value="${escapeHtml(p?.category||'')}" placeholder="Ex: Acesso, Backup, Rede..." /></div>
      <div class="form-group"><label class="form-label">Conteúdo / Passos</label><textarea class="form-textarea" id="procContentInput" name="content" rows="8" placeholder="Descreva o passo a passo...">${escapeHtml(p?.content||'')}</textarea></div>
      <div class="form-actions"><button type="button" class="btn btn-secondary" onclick="viewClient('${clientId}')">Cancelar</button><button type="submit" class="btn btn-primary"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Salvar</button></div>
    </form>`);
}

function loadTemplateIntoProcedureForm() {
  const select = document.getElementById('templatePickerSelect');
  if (!select || !select.value) {
    if (typeof showToast === 'function') showToast('Selecione um modelo para carregar.', 'warning');
    return;
  }
  const tpl = getProcedureTemplateById(select.value);
  if (!tpl) return;

  const titleInp = document.getElementById('procTitleInput');
  const catInp = document.getElementById('procCategoryInput');
  const contentInp = document.getElementById('procContentInput');

  if (titleInp) titleInp.value = tpl.title || '';
  if (catInp) catInp.value = tpl.category || '';
  if (contentInp) contentInp.value = tpl.content || '';

  if (typeof showToast === 'function') showToast(`Modelo "${tpl.title}" carregado no formulário!`, 'success');
}

function submitProcedureForm(e, clientId, procId) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const title = (fd.get('title') || '').toString().trim();
  const category = (fd.get('category') || '').toString().trim();
  const content = (fd.get('content') || '').toString();
  const isNew = !procId;
  saveProcedure({ id: procId || null, clientId, title, category, content });
  showToast('Procedimento salvo!', 'success');
  viewClient(clientId);
  switchClientTab('procedimentos', clientId);
  if (isNew && typeof saveProcedureTemplate === 'function') {
    setTimeout(() => offerSaveProcedureAsTemplate({ title, category, content }), 50);
  }
}

function offerSaveProcedureAsTemplate(proc) {
  if (!proc || !proc.title) return;
  confirmAction('Deseja salvar este procedimento também como <strong>modelo</strong>?', function() {
    const titleNorm = (proc.title || '').trim().toLowerCase();
    const existing = (typeof getProcedureTemplates === 'function' ? getProcedureTemplates() : [])
      .find(t => (t.title || '').trim().toLowerCase() === titleNorm);
    if (existing) {
      setTimeout(() => {
        confirmAction(
          'Já existe um modelo com o título <strong>' + escapeHtml(proc.title) + '</strong>. Deseja <strong>atualizar</strong> o modelo existente?',
          function() {
            saveProcedureTemplate({
              id: existing.id,
              title: proc.title,
              category: proc.category || '',
              content: proc.content || '',
            });
            showToast('Modelo atualizado!', 'success');
            if (typeof currentHash === 'function' && currentHash() === 'templates' && typeof renderTemplates === 'function') {
              renderTemplates();
            }
          }
        );
        const btn = document.getElementById('confirmBtn');
        if (btn) {
          btn.textContent = 'Atualizar modelo';
          btn.classList.remove('btn-danger');
          btn.classList.add('btn-primary');
        }
        const cancel = document.getElementById('confirmCancelBtn');
        if (cancel) {
          cancel.textContent = 'Criar novo';
          cancel.onclick = function() {
            closeModal();
            saveProcedureTemplate({
              id: null,
              title: proc.title,
              category: proc.category || '',
              content: proc.content || '',
            });
            showToast('Novo modelo criado!', 'success');
            if (typeof currentHash === 'function' && currentHash() === 'templates' && typeof renderTemplates === 'function') {
              renderTemplates();
            }
          };
        }
      }, 50);
      return;
    }
    saveProcedureTemplate({
      id: null,
      title: proc.title,
      category: proc.category || '',
      content: proc.content || '',
    });
    showToast('Modelo criado a partir do procedimento!', 'success');
    if (typeof currentHash === 'function' && currentHash() === 'templates' && typeof renderTemplates === 'function') {
      renderTemplates();
    }
  });
  const btn = document.getElementById('confirmBtn');
  if (btn) {
    btn.textContent = 'Salvar como modelo';
    btn.classList.remove('btn-danger');
    btn.classList.add('btn-primary');
  }
  const cancel = document.getElementById('confirmCancelBtn');
  if (cancel) cancel.textContent = 'Não';
}

function deleteProcedureConfirm(procId, clientId) {
  var proc = null;
  var all = dbGet(DB.PROCEDURES);
  if (all) proc = all.find(function(p) { return p.id === procId; });
  confirmAction('Excluir este procedimento?', function() {
    var snapshot = proc ? JSON.parse(JSON.stringify(proc)) : null;
    deleteProcedure(procId);
    if (snapshot) {
      showUndoToast('Procedimento removido.', function() {
        saveProcedure(snapshot);
        viewClient(clientId);
        switchClientTab('procedimentos', clientId);
        showToast('Procedimento restaurado.', 'success');
      });
    } else {
      showToast('Excluído.', 'success');
    }
    viewClient(clientId);
    switchClientTab('procedimentos', clientId);
  });
}

function toggleProcCard(id) {
  var card = document.getElementById('proc-' + id);
  if (!card) return;
  card.classList.toggle('expanded');
}

function deleteClientConfirm(id) {
  var c = getClientById(id);
  if (!c) return;
  confirmAction('Excluir cliente <strong>' + escapeHtml(c.name) + '</strong>?', function() {
    var snapshot = JSON.parse(JSON.stringify(c));
    deleteClient(id);
    renderClientGrid();
    updateBadges();
    showUndoToast('Cliente "' + c.name + '" removido.', function() {
      saveClient(snapshot);
      renderClientGrid();
      updateBadges();
      showToast('Cliente restaurado.', 'success');
    });
  });
}

function openClientForm(id = null) {
  const c = id ? getClientById(id) : {};
  const lics = c.licenses || [];
  const esc = v => escapeHtml(v || '');
  openModal(id ? 'Editar Cliente' : 'Novo Cliente', `
    <form id="cliForm" onsubmit="submitClientForm(event,'${id||''}')">
      <div class="form-section">
        <div class="form-section-title">Ícone do Cliente</div>
        <div style="display:flex;align-items:flex-start;gap:16px;margin-bottom:12px">
          <div id="logoPreview">${clientAvatar(c, 60)}</div>
          <div style="flex:1">
            <div class="form-group" style="margin-bottom:8px"><label class="form-label">Cor do avatar</label>
              <div style="display:flex;gap:6px;flex-wrap:wrap" id="colorPicker">
                ${COLORS.map(col=>`<div onclick="selectColor('${col}')" style="width:28px;height:28px;border-radius:50%;background:${col};cursor:pointer;border:3px solid ${(c.color||COLORS[0])===col?'#0f172a':'transparent'}" data-color="${col}"></div>`).join('')}
              </div>
            </div>
          <div class="form-row">
              <div class="form-group"><label class="form-label">Iniciais</label><input class="form-input" id="initialsInput" name="initials" maxlength="3" value="${esc(c.initials)}" oninput="updateLogoPreview()" /></div>
              <div class="form-group"><label class="form-label">URL da Logo (opcional)</label><input class="form-input" name="logo" id="logoUrlInput" value="${esc(c.logo && !c.logo.startsWith('data:') ? c.logo : '')}" placeholder="https://..." oninput="onLogoUrlChange()" /></div>
            </div>
            <div class="logo-upload-zone">
              <input type="file" id="logoFileInput" accept="image/*" style="display:none" onchange="onLogoFileSelected(event)" />
              <button type="button" class="logo-upload-btn" onclick="document.getElementById('logoFileInput').click()">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                Enviar Imagem
              </button>
              <button type="button" class="logo-crop-btn" id="cropBtn" onclick="openCropModal()" style="display:${c.logo?'inline-flex':'none'}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6.13 1L6 16a2 2 0 0 0 2 2h15"/><path d="M1 6.13L16 6a2 2 0 0 1 2 2v15"/></svg>
                Recortar
              </button>
              <button type="button" class="logo-remove-btn" id="removeLogoBtn" onclick="removeClientLogo()" style="display:${c.logo?'inline-flex':'none'}">
                ✕
              </button>
            </div>
            <div class="form-group" style="margin-top:8px">
              <label class="form-label">Formato da Logo</label>
              <div style="display:flex;gap:8px" id="shapePicker">
                <div class="logo-shape-option ${(c.logoShape||'circle')==='circle'?'selected':''}" onclick="selectLogoShape('circle')" data-shape="circle">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>
                  Redondo
                </div>
                <div class="logo-shape-option ${(c.logoShape||'circle')==='square'?'selected':''}" onclick="selectLogoShape('square')" data-shape="square">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="3"/></svg>
                  Quadrado
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="form-section">
        <div class="form-section-title">Identificação</div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Nome *</label><input class="form-input" name="name" value="${esc(c.name)}" required /></div>
          <div class="form-group"><label class="form-label">CNPJ / CPF</label><input class="form-input" name="cnpj" value="${esc(c.cnpj)}" /></div>
        </div>
        <div class="form-group"><label class="form-label">Segmento</label><input class="form-input" name="segment" value="${esc(c.segment)}" /></div>
      </div>
      <div class="form-section">
        <div class="form-section-title">Responsáveis</div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Dono</label><input class="form-input" name="owner" value="${esc(c.owner)}" /></div>
          <div class="form-group"><label class="form-label">Contato</label><input class="form-input" name="ownerPhone" value="${esc(c.ownerPhone)}" /></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Responsável TI</label><input class="form-input" name="responsible" value="${esc(c.responsible)}" /></div>
          <div class="form-group"><label class="form-label">Contato</label><input class="form-input" name="responsiblePhone" value="${esc(c.responsiblePhone)}" /></div>
        </div>
        <div class="form-group"><label class="form-label">Técnico da Equipe</label><input class="form-input" name="technician" value="${esc(c.technician)}" /></div>
      </div>
      <div class="form-section">
        <div class="form-section-title">Servidor</div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Tipo</label>
            <select class="form-select" name="server_type">${['Físico','Virtual','Cloud (AWS)','Cloud (Azure)','Cloud (GCP)','Outro'].map(o=>`<option ${c.server?.type===o?'selected':''}>${o}</option>`).join('')}</select></div>
          <div class="form-group"><label class="form-label">SO</label><input class="form-input" name="server_os" value="${esc(c.server?.os)}" /></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">IP</label><input class="form-input" name="server_ip" value="${esc(c.server?.ip)}" /></div>
          <div class="form-group"><label class="form-label">Acesso Remoto</label>
            <select class="form-select" name="server_remoteAccess">${['AnyDesk','TeamViewer','RDP','SSH','VPN','SSH + VPN','Outro'].map(o=>`<option ${c.server?.remoteAccess===o?'selected':''}>${o}</option>`).join('')}</select></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">ID / Endereço</label><input class="form-input" name="server_remoteId" value="${esc(c.server?.remoteId)}" /></div>
          <div class="form-group"><label class="form-label">Obs</label><input class="form-input" name="server_notes" value="${esc(c.server?.notes)}" /></div>
        </div>
      </div>
      <div class="form-section">
        <div class="form-section-title">Hospedagem</div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Provedor</label><input class="form-input" name="hosting_provider" value="${esc(c.hosting?.provider)}" /></div>
          <div class="form-group"><label class="form-label">URL Painel</label><input class="form-input" name="hosting_panelUrl" value="${esc(c.hosting?.panelUrl)}" /></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Usuário</label><input class="form-input" name="hosting_user" value="${esc(c.hosting?.user)}" /></div>
          <div class="form-group"><label class="form-label">Obs</label><input class="form-input" name="hosting_notes" value="${esc(c.hosting?.notes)}" /></div>
        </div>
      </div>
      <div class="form-section">
        <div class="form-section-title">Backup</div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Frequência</label>
            <select class="form-select" name="backup_frequency">${['Diário','Semanal','Quinzenal','Mensal','Sob demanda'].map(o=>`<option ${c.backup?.frequency===o?'selected':''}>${o}</option>`).join('')}</select></div>
          <div class="form-group"><label class="form-label">Horário</label><input class="form-input" name="backup_time" value="${esc(c.backup?.time)}" /></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Destino</label><input class="form-input" name="backup_destination" value="${esc(c.backup?.destination)}" /></div>
          <div class="form-group"><label class="form-label">Ferramenta</label><input class="form-input" name="backup_tool" value="${esc(c.backup?.tool)}" /></div>
        </div>
        <div class="form-group"><label class="form-label">Última Verificação</label><input type="date" class="form-input" name="backup_lastCheck" value="${esc(c.backup?.lastCheck)}" /></div>
      </div>
      <div class="form-section">
        <div class="form-section-title">E-mail</div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Provedor</label><input class="form-input" name="emails_provider" value="${esc(c.emails?.provider)}" /></div>
          <div class="form-group"><label class="form-label">Domínio</label><input class="form-input" name="emails_domain" value="${esc(c.emails?.domain)}" /></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Servidor</label><input class="form-input" name="emails_server" value="${esc(c.emails?.server)}" /></div>
          <div class="form-group"><label class="form-label">Porta</label><input class="form-input" name="emails_port" value="${esc(c.emails?.port)}" /></div>
        </div>
        <div class="form-group"><label class="form-label">Quota</label><input class="form-input" name="emails_quota" value="${esc(c.emails?.quota)}" /></div>
      </div>
      <div class="form-section">
        <div class="form-section-title">Licenças</div>
        <div id="licContainer">${lics.map((l,i)=>licRow(l,i)).join('')}</div>
        <button type="button" class="btn btn-secondary btn-sm" onclick="addLicRow()">+ Licença</button>
      </div>
      <div class="form-section">
        <div class="form-section-title">Observações Gerais</div>
        <textarea class="form-textarea" name="notes" rows="3">${esc(c.notes)}</textarea>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn-primary"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Salvar</button>
      </div>
    </form>`, 'lg');
  window._selectedColor = c.color || COLORS[0];
  window._selectedLogoShape = c.logoShape || 'circle';
  window._currentLogoData = c.logo || '';
}

let _licIdx = 10;
function licRow(l={}, i=0) {
  const esc = v => escapeHtml(v || '');
  return `<div class="form-row" id="lr${i}" style="align-items:end;margin-bottom:8px">
    <div class="form-group" style="margin-bottom:0"><label class="form-label">Software</label><input class="form-input" name="ls_${i}" value="${esc(l.software)}" /></div>
    <div class="form-group" style="margin-bottom:0"><label class="form-label">Chave</label><input class="form-input" name="lk_${i}" value="${esc(l.key)}" /></div>
    <div class="form-group" style="margin-bottom:0"><label class="form-label">Validade</label><input type="date" class="form-input" name="le_${i}" value="${esc(l.expiry)}" /></div>
    <button type="button" class="btn btn-danger btn-sm" style="flex-shrink:0" onclick="document.getElementById('lr${i}').remove()">✕</button>
  </div>`;
}
function addLicRow() {
  const d = document.createElement('div');
  d.innerHTML = licRow({}, _licIdx++);
  document.getElementById('licContainer').appendChild(d.firstElementChild);
}
function selectColor(col) {
  window._selectedColor = col;
  document.querySelectorAll('#colorPicker div').forEach(d => {
    d.style.border = `3px solid ${d.dataset.color === col ? '#0f172a' : 'transparent'}`;
  });
  updateLogoPreview();
}
function updateLogoPreview() {
  const initials = document.getElementById('initialsInput')?.value || '';
  const color = window._selectedColor || COLORS[0];
  const logo = window._currentLogoData || document.getElementById('logoUrlInput')?.value || '';
  const logoShape = window._selectedLogoShape || 'circle';
  const p = document.getElementById('logoPreview');
  if (p) p.innerHTML = clientAvatar({ initials, color, logo, logoShape }, 60);
  // Show/hide crop and remove buttons
  const hasLogo = !!logo;
  const cropBtn = document.getElementById('cropBtn');
  const removeBtn = document.getElementById('removeLogoBtn');
  if (cropBtn) cropBtn.style.display = hasLogo ? 'inline-flex' : 'none';
  if (removeBtn) removeBtn.style.display = hasLogo ? 'inline-flex' : 'none';
}

function selectLogoShape(shape) {
  window._selectedLogoShape = shape;
  document.querySelectorAll('#shapePicker .logo-shape-option').forEach(el => {
    el.classList.toggle('selected', el.dataset.shape === shape);
  });
  updateLogoPreview();
}

// ── Logo URL change handler ──
function onLogoUrlChange() {
  const url = (document.getElementById('logoUrlInput')?.value || '').trim();
  if (url && !/^https?:\/\//i.test(url) && !/^data:image\//i.test(url)) {
    window._currentLogoData = '';
  } else {
    window._currentLogoData = url;
  }
  updateLogoPreview();
}

// ── File upload handler ──
function onLogoFileSelected(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showToast('Selecione um arquivo de imagem válido.', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = function(ev) {
    window._currentLogoData = ev.target.result;
    // Clear URL input since we're using uploaded file
    const urlInput = document.getElementById('logoUrlInput');
    if (urlInput) urlInput.value = '';
    updateLogoPreview();
    // Automatically open crop modal
    openCropModal();
  };
  reader.readAsDataURL(file);
}

// ── Remove logo ──
function removeClientLogo() {
  window._currentLogoData = '';
  const urlInput = document.getElementById('logoUrlInput');
  if (urlInput) urlInput.value = '';
  const fileInput = document.getElementById('logoFileInput');
  if (fileInput) fileInput.value = '';
  updateLogoPreview();
  showToast('Logo removida.', 'info');
}

// ── Cropper.js integration ──
let _cropper = null;

function openCropModal() {
  const src = window._currentLogoData || document.getElementById('logoUrlInput')?.value || '';
  if (!src) {
    showToast('Nenhuma imagem para recortar. Envie ou defina uma URL primeiro.', 'error');
    return;
  }
  const img = document.getElementById('cropImage');
  if (_cropper) { _cropper.destroy(); _cropper = null; }

  let cropperInitializing = false;
  const initCropper = async function() {
    if (cropperInitializing || _cropper) return;
    cropperInitializing = true;
    try {
      await loadCropper();
      _cropper = new Cropper(img, {
        aspectRatio: 1,
        viewMode: 1,
        dragMode: 'move',
        autoCropArea: 0.85,
        responsive: true,
        background: true,
        guides: true,
        center: true,
        highlight: false,
        cropBoxMovable: true,
        cropBoxResizable: true,
        toggleDragModeOnDblclick: false,
      });
    } catch (err) {
      showToast('Não foi possível carregar o recorte de imagem.', 'error');
      closeCropModal();
    } finally {
      cropperInitializing = false;
    }
  };

  // Register handlers before src: data URLs may already be cached/complete.
  img.onload = initCropper;
  img.onerror = function() {
    showToast('Não foi possível carregar a imagem. Verifique a URL ou envie um arquivo.', 'error');
    closeCropModal();
  };
  img.src = '';
  document.getElementById('cropModalOverlay').style.display = 'flex';
  img.src = src;
  if (img.complete && img.naturalWidth) initCropper();
}

function closeCropModal() {
  document.getElementById('cropModalOverlay').style.display = 'none';
  if (_cropper) { _cropper.destroy(); _cropper = null; }
}

function cropperRotate(deg) {
  if (_cropper) _cropper.rotate(deg);
}
function cropperZoom(ratio) {
  if (_cropper) _cropper.zoom(ratio);
}
function cropperReset() {
  if (_cropper) _cropper.reset();
}

function applyCrop() {
  if (!_cropper) return;
  const canvas = _cropper.getCroppedCanvas({
    width: 256,
    height: 256,
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'high',
  });
  if (!canvas) {
    showToast('Erro ao recortar a imagem.', 'error');
    return;
  }
  const dataUrl = canvas.toDataURL('image/png');
  window._currentLogoData = dataUrl;
  // Clear URL input since we now have cropped data
  const urlInput = document.getElementById('logoUrlInput');
  if (urlInput) urlInput.value = '';
  closeCropModal();
  updateLogoPreview();
  showToast('Logo recortada com sucesso!', 'success');
}

function submitClientForm(e, id) {
  e.preventDefault();
  try {
    const fd = new FormData(e.target);
    const g = k => fd.get(k) || '';
    const lics = [];
    document.querySelectorAll('[id^="lr"]').forEach(row => {
      const i = row.id.replace('lr','');
      const s = fd.get(`ls_${i}`);
      if (s) lics.push({ software: s, key: fd.get(`lk_${i}`), expiry: fd.get(`le_${i}`) });
    });
    const logoValue = window._currentLogoData || g('logo');
    const clientData = {
      id: id||null, name:g('name'), cnpj:g('cnpj'), segment:g('segment'),
      color: window._selectedColor||COLORS[0], initials:g('initials'), logo: logoValue,
      logoShape: window._selectedLogoShape||'circle',
      owner:g('owner'), ownerPhone:g('ownerPhone'), responsible:g('responsible'),
      responsiblePhone:g('responsiblePhone'), technician:g('technician'),
      server:{type:g('server_type'),os:g('server_os'),ip:g('server_ip'),remoteAccess:g('server_remoteAccess'),remoteId:g('server_remoteId'),notes:g('server_notes')},
      hosting:{provider:g('hosting_provider'),panelUrl:g('hosting_panelUrl'),user:g('hosting_user'),notes:g('hosting_notes')},
      backup:{frequency:g('backup_frequency'),time:g('backup_time'),destination:g('backup_destination'),tool:g('backup_tool'),lastCheck:g('backup_lastCheck')},
      emails:{provider:g('emails_provider'),domain:g('emails_domain'),server:g('emails_server'),port:g('emails_port'),quota:g('emails_quota')},
      licenses:lics, notes:g('notes'),
    };
    if (typeof validateClient === 'function') {
      const errors = validateClient(clientData);
      if (errors.length) { showToast(errors[0], 'error'); return; }
    }
    saveClient(clientData);
    closeModal(); renderClientGrid(); updateBadges();
    showToast(id ? 'Cliente atualizado!' : 'Cliente cadastrado!', 'success');
  } catch (err) { showToast('Erro ao salvar cliente: ' + err.message, 'error'); }
}

// ── IMPORTADOR DE CLIENTES (Word / CSV / Colar) ──
const CLIENT_IMPORT_FIELDS = [
  { key: 'skip', label: '— Ignorar coluna —' },
  { key: 'name', label: 'Nome *', required: true },
  { key: 'cnpj', label: 'CNPJ / CPF' },
  { key: 'segment', label: 'Segmento' },
  { key: 'owner', label: 'Dono' },
  { key: 'ownerPhone', label: 'Telefone Dono' },
  { key: 'responsible', label: 'Responsável TI' },
  { key: 'responsiblePhone', label: 'Telefone Resp.' },
  { key: 'technician', label: 'Técnico' },
  { key: 'notes', label: 'Observações' },
  { key: 'team', label: 'Equipe' },
];

let _importRows = [];
let _importHasHeader = true;

function openImportClientsModal() {
  openModal('Importar Clientes', `
    <div style="margin-bottom:16px">
      <div style="font-size:13px;font-weight:600;margin-bottom:8px">1. Envie ou cole os dados</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px">
        <label class="btn btn-secondary" style="cursor:pointer">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg> Escolher arquivo (.docx, .csv, .txt)
          <input type="file" id="importFileInput" accept=".docx,.csv,.txt" style="display:none" onchange="handleImportFile(this)" />
        </label>
        <span style="font-size:12px;color:var(--text-muted);display:flex;align-items:center">ou</span>
        <button class="btn btn-secondary" onclick="document.getElementById('importPasteArea').style.display='block'"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Colar texto</button>
      </div>
      <textarea id="importPasteArea" class="form-textarea" rows="6" placeholder="Cole aqui os dados copiados do Word ou Excel...&#10;Exemplo:&#10;Nome | CNPJ | Segmento&#10;Padaria Central | 12.345.678/0001-90 | Alimentação" style="display:none;margin-bottom:8px" oninput="handleImportPaste(this.value)"></textarea>
    </div>
    <div id="importPreviewWrap" style="display:none">
      <div style="font-size:13px;font-weight:600;margin-bottom:8px">2. Preview e mapeamento de colunas</div>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;margin-bottom:8px;cursor:pointer">
        <input type="checkbox" id="importHasHeader" checked onchange="_importHasHeader=this.checked;renderImportPreview()" />
        Primeira linha é cabeçalho
      </label>
      <div id="importPreviewTable" style="max-height:300px;overflow:auto;border:1px solid var(--border);border-radius:6px;margin-bottom:12px"></div>
      <div id="importStats" style="font-size:12px;color:var(--text-muted);margin-bottom:12px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary" id="importBtn" onclick="executeClientImport()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Importar Clientes</button>
      </div>
    </div>
  `, 'lg');
}

async function handleImportFile(input) {
  const file = input.files[0];
  if (!file) return;
  const ext = file.name.split('.').pop().toLowerCase();
  const reader = new FileReader();

  if (ext === 'docx') {
    reader.onload = async function(e) {
      try {
        const arrayBuffer = e.target.result;
        const result = await mammoth.convertToHtml({ arrayBuffer });
        const html = result.value;
        _importRows = extractRowsFromHtmlTable(html);
        if (!_importRows.length) {
          const textResult = await mammoth.extractRawText({ arrayBuffer });
          _importRows = parseDelimitedText(textResult.value);
        }
        renderImportPreview();
      } catch (err) {
        showToast('Erro ao ler .docx: ' + err.message, 'error');
      }
    };
    reader.readAsArrayBuffer(file);
  } else {
    reader.onload = function(e) {
      _importRows = parseDelimitedText(e.target.result);
      renderImportPreview();
    };
    reader.readAsText(file);
  }
}

function handleImportPaste(text) {
  if (!text || text.trim().length < 3) return;
  _importRows = parseDelimitedText(text);
  renderImportPreview();
}

function parseDelimitedText(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const firstLine = lines[0];
  let delim = '\t';
  const counts = {
    '\t': (firstLine.match(/\t/g) || []).length,
    ';': (firstLine.match(/;/g) || []).length,
    '|': (firstLine.match(/\|/g) || []).length,
    ',': (firstLine.match(/,/g) || []).length,
  };
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (best[1] > 0) delim = best[0];

  return lines.map(line => {
    if (delim === ',') return parseCsvLine(line);
    return line.split(delim).map(c => c.trim());
  });
}

function parseCsvLine(line) {
  const cells = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];
    if (inQuotes) {
      if (char === '"') {
        if (next === '"') { cell += '"'; i++; }
        else { inQuotes = false; }
      } else {
        cell += char;
      }
    } else {
      if (char === '"') { inQuotes = true; }
      else if (char === ',') { cells.push(cell.trim()); cell = ''; }
      else { cell += char; }
    }
  }
  cells.push(cell.trim());
  return cells;
}

function extractRowsFromHtmlTable(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const tables = doc.querySelectorAll('table');
  if (!tables.length) return [];
  let bestTable = tables[0];
  let bestRows = 0;
  tables.forEach(t => { if (t.rows.length > bestRows) { bestRows = t.rows.length; bestTable = t; } });
  return Array.from(bestTable.rows).map(row => Array.from(row.cells).map(c => c.textContent.trim()));
}

function renderImportPreview() {
  const wrap = document.getElementById('importPreviewWrap');
  const tableDiv = document.getElementById('importPreviewTable');
  const statsDiv = document.getElementById('importStats');
  const importBtn = document.getElementById('importBtn');
  if (!_importRows.length || !tableDiv) return;

  wrap.style.display = 'block';
  const hasHeader = document.getElementById('importHasHeader')?.checked ?? true;
  const headerRow = hasHeader ? _importRows[0] : _importRows[0].map((_, i) => `Col ${i + 1}`);
  const dataRows = hasHeader ? _importRows.slice(1) : _importRows;
  const validRows = dataRows.filter(r => r.some(c => c.trim()));

  // Build column mapping dropdowns
  const mapHtml = headerRow.map((h, i) => `
    <select class="form-select" id="importCol_${i}" style="font-size:11px;padding:2px 6px;max-width:140px" onchange="updateImportMapping()">
      ${CLIENT_IMPORT_FIELDS.map(f => `<option value="${f.key}">${f.label}</option>`).join('')}
    </select>
  `).join('');

  // Auto-detect mapping
  setTimeout(() => {
    headerRow.forEach((h, i) => {
      const lower = h.toLowerCase();
      const select = document.getElementById(`importCol_${i}`);
      if (!select) return;
      for (const f of CLIENT_IMPORT_FIELDS) {
        const keywords = {
          name: ['nome', 'razão social', 'empresa', 'cliente'],
          cnpj: ['cnpj', 'cpf', 'documento'],
          segment: ['segmento', 'ramo', 'área'],
          owner: ['dono', 'proprietário', 'owner'],
          ownerPhone: ['tel dono', 'fone dono', 'telefone dono'],
          responsible: ['resp', 'responsável', 'ti'],
          responsiblePhone: ['tel resp', 'fone resp'],
          technician: ['técnico', 'tecnico', 'tech'],
          notes: ['obs', 'notas', 'observação'],
          team: ['equipe', 'time', 'team'],
        };
        const kw = keywords[f.key];
        if (kw && kw.some(k => lower.includes(k))) {
          select.value = f.key;
          break;
        }
      }
    });
    updateImportMapping();
  }, 50);

  // Show preview (first 8 rows)
  const previewRows = validRows.slice(0, 8);
  const colCount = headerRow.length;
  tableDiv.innerHTML = `
    <table style="font-size:12px;width:100%;border-collapse:collapse">
      <thead>
        <tr style="background:var(--bg-base)">
          <th style="padding:6px 8px;border-bottom:2px solid var(--border);font-size:10px;text-transform:uppercase;color:var(--text-muted);position:sticky;top:0;background:var(--bg-base)">#</th>
          ${headerRow.map((h, i) => `<th style="padding:6px 8px;border-bottom:2px solid var(--border);position:sticky;top:0;background:var(--bg-base)"><div style="margin-bottom:4px;font-weight:600">${escapeHtml(h)}</div>${mapHtml.split('</select>')[i] + '</select>'}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${previewRows.map((row, ri) => `<tr style="border-bottom:1px solid var(--border)">
          <td style="padding:4px 8px;color:var(--text-muted);font-size:11px">${ri + 1}</td>
          ${row.map((c, ci) => `<td style="padding:4px 8px;${ci >= colCount ? 'display:none' : ''}">${escapeHtml(c)}</td>`).join('')}
          ${Array(Math.max(0, colCount - row.length)).fill('<td style="padding:4px 8px;color:var(--text-muted)">—</td>').join('')}
        </tr>`).join('')}
        ${validRows.length > 8 ? `<tr><td colspan="${colCount + 1}" style="padding:8px;text-align:center;color:var(--text-muted);font-size:11px">...e mais ${validRows.length - 8} linha(s)</td></tr>` : ''}
      </tbody>
    </table>
  `;

  statsDiv.textContent = `${validRows.length} linha(s) para importar · ${headerRow.length} coluna(s)`;
  if (importBtn) importBtn.style.display = validRows.length ? 'inline-flex' : 'none';
}

function updateImportMapping() {}

function executeClientImport() {
  const hasHeader = document.getElementById('importHasHeader')?.checked ?? true;
  const dataRows = hasHeader ? _importRows.slice(1) : _importRows;
  const validRows = dataRows.filter(r => r.some(c => c.trim()));
  const headerRow = hasHeader ? _importRows[0] : _importRows[0].map((_, i) => `Col ${i + 1}`);

  const mapping = {};
  headerRow.forEach((_, i) => {
    const sel = document.getElementById(`importCol_${i}`);
    if (sel && sel.value && sel.value !== 'skip') {
      mapping[i] = sel.value;
    }
  });

  if (!Object.values(mapping).includes('name')) {
    showToast('Mapeie pelo menos uma coluna como "Nome" para importar.', 'error');
    return;
  }

  let created = 0;
  let skipped = 0;
  const currentTeam = getCurrentTeam();

  for (const row of validRows) {
    const clientData = {
      team: currentTeam,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      initials: '',
      server: {}, hosting: {}, backup: {}, emails: {}, licenses: [],
    };
    for (const [colIdx, fieldKey] of Object.entries(mapping)) {
      const idx = parseInt(colIdx);
      const val = row[idx] || '';
      if (fieldKey === 'name') {
        clientData.name = val;
        clientData.initials = val.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
      } else {
        clientData[fieldKey] = val;
      }
    }
    if (!clientData.name || !clientData.name.trim()) { skipped++; continue; }
    if (typeof validateClient === 'function') {
      const errors = validateClient(clientData);
      if (errors.length) { skipped++; continue; }
    }
    saveClient(clientData);
    created++;
  }

  closeModal();
  renderClientGrid();
  updateBadges();
  showToast(`${created} cliente(s) importado(s)${skipped ? ` · ${skipped} linha(s) ignoradas` : ''}`, 'success');
}
