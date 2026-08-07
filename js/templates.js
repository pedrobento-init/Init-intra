// templates.js - Gestão de Modelos de Procedimentos

let _templatesCategoryFilter = '';

function renderTemplates() {
  document.getElementById('pageTitle').textContent = 'Modelos de Procedimentos';
  setTopbarAction('+ Novo Modelo', '<svg class="topbar-action-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>');
  window._topbarAction = () => openTemplateForm();

  const templates = getProcedureTemplates();
  const categories = Array.from(new Set(templates.map(t => t.category).filter(Boolean)));

  document.getElementById('contentArea').innerHTML = `
    <div class="search-bar">
      <div class="search-input-wrap filter-grow">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input class="form-input" id="templateSearch" placeholder="Buscar modelo por título ou conteúdo..." oninput="debouncedFilterTemplatesGrid()" />
      </div>
      <div class="filter-field">
        <select class="form-select" id="templateCategorySelect" onchange="filterTemplatesGrid()">
          <option value="">Todas as categorias</option>
          ${categories.map(cat => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`).join('')}
        </select>
      </div>
    </div>
    <div id="templatesGridWrap"></div>
  `;

  const savedFilters = loadFilterState('templates', {});
  if (savedFilters.search) document.getElementById('templateSearch').value = savedFilters.search;
  if (savedFilters.category) document.getElementById('templateCategorySelect').value = savedFilters.category;

  showSkeleton('templatesGridWrap', 4);
  renderTemplatesGrid();
}

window.debouncedFilterTemplatesGrid = debounce(filterTemplatesGrid, 300);

function filterTemplatesGrid() {
  const search = document.getElementById('templateSearch')?.value || '';
  const category = document.getElementById('templateCategorySelect')?.value || '';
  saveFilterState('templates', {search, category});
  renderTemplatesGrid();
}

function renderTemplatesGrid() {
  const container = document.getElementById('templatesGridWrap');
  if (!container) return;

  setTimeout(() => {
  const query = (document.getElementById('templateSearch')?.value || '').toLowerCase();
  const selectedCat = document.getElementById('templateCategorySelect')?.value || '';

  let templates = getProcedureTemplates();

  if (query) {
    templates = templates.filter(t => 
      (t.title && t.title.toLowerCase().includes(query)) ||
      (t.category && t.category.toLowerCase().includes(query)) ||
      (t.content && t.content.toLowerCase().includes(query))
    );
  }

  if (selectedCat) {
    templates = templates.filter(t => t.category === selectedCat);
  }

  if (!templates.length) {
    container.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><p>Nenhum modelo de procedimento encontrado.</p><button class="btn btn-primary btn-sm" onclick="openTemplateForm()">+ Novo Modelo</button></div>`;
    return;
  }

  container.innerHTML = templates.map(t => `
    <div class="card" style="display:flex;flex-direction:column;justify-content:space-between;padding:16px;border-radius:10px;border:1px solid var(--border);background:var(--bg-surface);box-shadow:var(--shadow-sm)">
      <div>
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:8px">
          <h3 style="font-size:16px;font-weight:600;color:var(--text-primary);margin:0">${escapeHtml(t.title)}</h3>
          ${t.category ? `<span class="tag tag-blue">${escapeHtml(t.category)}</span>` : ''}
        </div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">
          Criado por: <strong>${escapeHtml(t.createdBy || 'Suporte TI')}</strong>
        </div>
        <pre class="proc-content" style="max-height:160px;overflow-y:auto;background:var(--bg-base);padding:10px;border-radius:6px;font-size:12px;white-space:pre-wrap;word-break:break-word;border:1px solid var(--border)">${escapeHtml(t.content || 'Sem conteúdo cadastrado.')}</pre>
      </div>
      <div style="display:flex;gap:8px;margin-top:14px;padding-top:10px;border-top:1px solid var(--border);flex-wrap:wrap">
        <button class="btn btn-sm btn-primary" onclick="openApplyTemplateModal('${escapeHtml(t.id)}')" title="Aplicar este modelo a um ou mais clientes">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Aplicar a Clientes
        </button>
        <button class="btn btn-sm btn-secondary" onclick="openTemplateForm('${escapeHtml(t.id)}')" title="Editar modelo">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Editar
        </button>
        <button class="btn btn-sm btn-danger" onclick="deleteTemplateConfirm('${escapeHtml(t.id)}')" title="Excluir modelo">
          ✕
        </button>
      </div>
    </div>
  `).join('');
  }, 10);
}

function openTemplateForm(id = null) {
  const t = id ? getProcedureTemplateById(id) : {};
  openModal(id ? 'Editar Modelo de Procedimento' : 'Novo Modelo de Procedimento', `
    <form onsubmit="submitTemplateForm(event, '${id || ''}')">
      <div class="form-group">
        <label class="form-label">Título do Modelo *</label>
        <input class="form-input" name="title" value="${escapeHtml(t.title || '')}" placeholder="Ex: Checklist de Backup Semanal" required />
      </div>
      <div class="form-group">
        <label class="form-label">Categoria</label>
        <input class="form-input" name="category" value="${escapeHtml(t.category || '')}" placeholder="Ex: Backup, Acesso, Rede, Servidores..." />
      </div>
      <div class="form-group">
        <label class="form-label">Conteúdo / Passos Padrão *</label>
        <textarea class="form-textarea" name="content" rows="10" placeholder="Descreva os passos reutilizáveis..." required>${escapeHtml(t.content || '')}</textarea>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn-primary"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Salvar Modelo</button>
      </div>
    </form>
  `);
}

function submitTemplateForm(e, id) {
  e.preventDefault();
  try {
    const fd = new FormData(e.target);
    const title = fd.get('title');
    const category = fd.get('category');
    const content = fd.get('content');

    const data = { id: id || null, title, category, content };
    const errors = validateTemplate(data);
    if (errors.length) { showToast(errors[0], 'error'); return; }

    saveProcedureTemplate(data);

    closeModal();
    renderTemplates();
    showToast(id ? 'Modelo atualizado com sucesso!' : 'Novo modelo criado!', 'success');
  } catch (err) { showToast('Erro ao salvar modelo: ' + err.message, 'error'); }
}

function deleteTemplateConfirm(id) {
  var tpl = getProcedureTemplateById(id);
  if (!tpl) return;
  confirmAction('Deseja realmente excluir o modelo <strong>' + escapeHtml(tpl.title) + '</strong>?', function() {
    var snapshot = JSON.parse(JSON.stringify(tpl));
    if (deleteProcedureTemplate(id)) {
      renderTemplates();
      showUndoToast('Modelo "' + tpl.title + '" removido.', function() {
        saveProcedureTemplate(snapshot);
        renderTemplates();
        showToast('Modelo restaurado.', 'success');
      });
    }
  });
}

/**
 * Modal para aplicar um modelo a múltiplos clientes de uma vez
 */
function openApplyTemplateModal(templateId) {
  const tpl = getProcedureTemplateById(templateId);
  if (!tpl) return;
  const clients = isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam ? getClientsByTeam(_selectedTeam) : getMyClients();

  if (!clients.length) {
    showToast('Nenhum cliente cadastrado no sistema.', 'warning');
    return;
  }

  openModal(`Aplicar Modelo: ${escapeHtml(tpl.title)}`, `
    <form onsubmit="submitApplyTemplate(event, '${templateId}')">
      <p style="font-size:13px;color:var(--text-muted);margin-bottom:12px">
        Selecione os clientes que receberão uma cópia deste procedimento:
      </p>

      <div style="margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;background:var(--bg-base);padding:8px 12px;border-radius:6px;border:1px solid var(--border)">
        <label style="display:flex;align-items:center;gap:8px;font-weight:600;font-size:13px;cursor:pointer">
          <input type="checkbox" id="selectAllClientsBtn" onchange="toggleSelectAllClients(this)" />
          Selecionar Todos os Clientes
        </label>
        <span style="font-size:12px;color:var(--text-muted)" id="selectedClientsCount">0 selecionados</span>
      </div>

      <div style="max-height:280px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;padding:8px;display:flex;flex-direction:column;gap:6px">
        ${clients.map(c => `
          <label style="display:flex;align-items:center;gap:10px;padding:6px 10px;border-radius:4px;cursor:pointer;background:var(--bg-surface);transition:background 0.15s" class="client-apply-row">
            <input type="checkbox" name="client_ids" value="${c.id}" onchange="updateSelectedClientsCount()" />
            <div style="display:flex;align-items:center;gap:8px;flex:1">
              ${clientAvatar(c, 24)}
              <span style="font-size:13px;font-weight:500;color:var(--text-primary)">${escapeHtml(c.name)}</span>
              ${c.segment ? `<span class="tag tag-blue" style="font-size:10px;padding:1px 6px">${escapeHtml(c.segment)}</span>` : ''}
            </div>
          </label>
        `).join('')}
      </div>

      <div class="form-actions" style="margin-top:16px">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn-primary"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Aplicar aos Clientes Selecionados</button>
      </div>
    </form>
  `);
}

function toggleSelectAllClients(masterCheckbox) {
  const checkboxes = document.querySelectorAll('input[name="client_ids"]');
  checkboxes.forEach(cb => { cb.checked = masterCheckbox.checked; });
  updateSelectedClientsCount();
}

function updateSelectedClientsCount() {
  const selected = document.querySelectorAll('input[name="client_ids"]:checked').length;
  const countEl = document.getElementById('selectedClientsCount');
  if (countEl) countEl.textContent = `${selected} selecionado${selected !== 1 ? 's' : ''}`;

  const all = document.querySelectorAll('input[name="client_ids"]').length;
  const master = document.getElementById('selectAllClientsBtn');
  if (master) master.checked = selected > 0 && selected === all;
}

function submitApplyTemplate(e, templateId) {
  e.preventDefault();
  const tpl = getProcedureTemplateById(templateId);
  if (!tpl) return;

  const checkboxes = document.querySelectorAll('input[name="client_ids"]:checked');
  const clientIds = Array.from(checkboxes).map(cb => cb.value);

  if (!clientIds.length) {
    showToast('Selecione pelo menos um cliente para aplicar o modelo.', 'warning');
    return;
  }

  let count = 0;
  clientIds.forEach(clientId => {
    saveProcedure({
      id: null,
      clientId: clientId,
      title: tpl.title,
      category: tpl.category || '',
      content: tpl.content || ''
    });
    count++;
  });

  closeModal();
  showToast(`Procedimento "${escapeHtml(tpl.title)}" aplicado a ${count} cliente(s)!`, 'success');
}
