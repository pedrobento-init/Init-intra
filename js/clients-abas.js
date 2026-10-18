// clients-abas.js – Abas do cliente: pendências, importação e chamados Milvus, inventário, procedimentos.
// Parte de clients.js (dividido para facilitar manutenção). Scripts clássicos:
// carregam logo depois de clients.js e compartilham os mesmos globais.
// Nos testes, tests/_parts.cjs junta as partes na mesma ordem.

// ── Aba Pendências do cliente: abrir detalhe com volta à aba ────────────────
// Contexto de retorno (devolve à aba após fechar) e de origem (reabre a aba
// após salvar na edição). Limpos ao consumir para não vazar entre fluxos.
let _clientPenReturn = null;
let _clientPenOrigin = null;

function openClientPenRow(e, clientId, penId) {
  try {
    if (e && e.target && e.target.closest && e.target.closest('button,select,a,input,textarea,label')) return;
  } catch (_) {}
  openClientPendencia(clientId, penId);
}

function openClientPendencia(clientId, penId) {
  let p = null;
  try { p = (typeof getPendenciaById === 'function') ? getPendenciaById(penId) : null; } catch (_) { p = null; }
  if (!p) {
    _clientPenReturn = null;
    _clientPenOrigin = null;
    if (typeof showToast === 'function') showToast('Não foi possível abrir a pendência. Tente novamente.', 'error');
    return;
  }
  _clientPenReturn = { clientId };
  _clientPenOrigin = { clientId, penId };
  try {
    openPendenciaDetail(penId);
  } catch (_) {
    _clientPenReturn = null;
    _clientPenOrigin = null;
    if (typeof showToast === 'function') showToast('Não foi possível abrir a pendência. Tente novamente.', 'error');
  }
}

// ── Importar clientes do Milvus (prévia → confirmação; admin) ──
let _milvusImportPreview = [];

function _milvusImportStatusTag(st) {
  if (st === 'novo') return '<span class="tag tag-green">Novo</span>';
  if (st === 'existe_cnpj') return '<span class="tag tag-blue">Já existe (CNPJ)</span>';
  return '<span class="tag tag-yellow">Já existe (nome)</span>';
}

async function openMilvusClientsImportModal() {
  openModal('📥 Importar clientes do Milvus', `
    <p style="font-size:13px;color:var(--text-muted);margin:0 0 12px">Novos entram com equipe <strong>init</strong> e vínculo no mapa Milvus. Existentes (mesmo CNPJ ou nome) são pulados.</p>
    <div id="milvusImportBody"><p style="color:var(--text-muted);font-size:12px">Consultando clientes no Milvus…</p></div>`);
  try {
    const data = await previewMilvusClientsImport();
    _milvusImportPreview = data.preview || [];
    const t = data.totals || summarizeImportPreview(_milvusImportPreview.map((p) => ({ status: p.status })));
    const body = document.getElementById('milvusImportBody');
    if (!body) return;
    if (!_milvusImportPreview.length) {
      body.innerHTML = '<div class="empty-state"><p>Nenhum cliente retornado pelo Milvus.</p></div>';
      return;
    }
    body.innerHTML = `
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">${t.total} no Milvus · <strong>${t.novos} novos</strong> · ${t.existeCnpj} por CNPJ · ${t.existeNome} por nome</div>
      <div class="table-wrapper" style="max-height:320px;overflow-y:auto"><table><thead><tr><th></th><th>Nome</th><th>CNPJ</th><th>Status</th></tr></thead><tbody>
      ${_milvusImportPreview.map((p, i) => `<tr>
        <td>${p.status === 'novo' ? `<input type="checkbox" data-mi-idx="${i}" checked />` : ''}</td>
        <td><strong>${escapeHtml(p.nome)}</strong>${p.razao && p.razao !== p.nome ? `<div style="font-size:11px;color:var(--text-muted)">${escapeHtml(p.razao)}</div>` : ''}</td>
        <td style="font-size:12px">${escapeHtml(p.cnpj || '—')}</td>
        <td>${_milvusImportStatusTag(p.status)}</td>
      </tr>`).join('')}</tbody></table></div>
      <div class="form-actions"><button type="button" class="btn btn-secondary" onclick="closeModal()">Cancelar</button><button type="button" class="btn btn-primary" id="milvusImportConfirmBtn" onclick="confirmMilvusClientsImport()">Importar selecionados</button></div>
      <div id="milvusImportMsg" style="font-size:13px;margin-top:8px"></div>`;
  } catch (e) {
    const body = document.getElementById('milvusImportBody');
    if (body) body.innerHTML = '<div class="empty-state"><p>Não foi possível consultar o Milvus. Tente novamente.</p></div>';
  }
}

async function confirmMilvusClientsImport() {
  const btn = document.getElementById('milvusImportConfirmBtn');
  const setMsg = (html) => { const m = document.getElementById('milvusImportMsg'); if (m) m.innerHTML = html; };
  const checked = [...document.querySelectorAll('[data-mi-idx]:checked')].map((el) => Number(el.dataset.miIdx));
  const onlyIds = checked
    .map((i) => _milvusImportPreview[i] && _milvusImportPreview[i].status === 'novo' ? _milvusImportPreview[i].milvusId : null)
    .filter((v) => typeof v === 'number');
  if (!onlyIds.length) {
    setMsg('<span style="color:var(--text-muted)">Nenhum cliente novo selecionado.</span>');
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Importando…'; }
  try {
    const res = await commitMilvusClientsImport(onlyIds);
    setMsg(`<span style="color:var(--success,#16a34a)">${plural(res.created, 'cliente importado', 'clientes importados')}${res.skipped && res.skipped.length ? ` · ${plural(res.skipped.length, 'pulado', 'pulados')}` : ''}.</span>`);
    try {
      if (typeof syncSupabaseToLocal === 'function') syncSupabaseToLocal().catch(() => {});
      if (typeof addLog === 'function') addLog('Importou clientes', 'Cliente', 'Milvus', `${plural(res.created, 'novo', 'novos')} do Milvus`);
      // A grade atrás do modal estava ficando stale: reconstrói o filtro e os badges.
      if (typeof _refreshClientsInPlace === 'function') _refreshClientsInPlace();
      if (typeof updateBadges === 'function') updateBadges();
    } catch (_) {}
  } catch (e) {
    setMsg('<span style="color:var(--danger,#dc2626)">Falha na importação. Tente novamente.</span>');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Importar selecionados'; }
  }
}

// ── Últimos chamados Milvus (top 10, compacto; contexto p/ visita) ──
let _milvusTicketsSyncing = {};
let _mticketsReq = null; // token p/ descartar resposta de cliente/aba anterior

function milvusTicketStatusTag(status) {
  const cls = (typeof canonicalStatusClass === 'function') ? canonicalStatusClass(status) : 'tag-gray';
  return `<span class="tag ${cls}">${escapeHtml(status || '—')}</span>`;
}

function _fmtTicketDate(iso) {
  if (!iso) return '—';
  try {
    if (typeof formatDateTime === 'function') return formatDateTime(iso);
  } catch (_) {}
  try { return new Date(iso).toLocaleString('pt-BR'); } catch (_) { return '—'; }
}

function renderClientMilvusTicketsTab(clientId) {
  const el = document.getElementById('clientTabContent');
  if (!el) return;
  let lastSync = null;
  try { lastSync = typeof getMilvusTicketsLastSyncAt === 'function' ? getMilvusTicketsLastSyncAt(clientId) : null; } catch (_) {}
  const lastTxt = lastSync
    ? _fmtTicketDate(lastSync)
    : 'nunca';
  el.innerHTML = `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px;flex-wrap:wrap">
      <span class="mtickets-title">📋 Últimos chamados no Milvus</span>
      <span style="flex:1"></span>
      <button class="btn btn-secondary btn-sm" id="milvusTicketsSyncBtn" onclick="syncClientMilvusTicketsUI('${escapeHtml(clientId)}')">↻ Sincronizar</button>
    </div>
    <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px">Última sincronização: <strong id="milvusTicketsLastSync">${escapeHtml(lastTxt)}</strong> · máx. 10 recentes</div>
    <div id="milvusTicketsMsg" style="font-size:13px;margin-bottom:10px"></div>
    <div id="milvusTicketsList"><p style="color:var(--text-muted);font-size:12px;padding:8px 0">Carregando chamados…</p></div>
    <hr class="divider" style="margin:16px 0" />
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
      <span class="mtickets-title">⏱️ Horas / Atendimentos</span>
    </div>
    <div id="chamadosAtendSection"></div>`;
  loadClientMilvusTicketsUI(clientId);
  try {
    if (typeof renderMilvusAtendimentosInline === 'function') renderMilvusAtendimentosInline(clientId, 'chamadosAtendSection');
  } catch (_) {}
  try {
    if (typeof shouldAutoSyncMilvusTickets === 'function' && shouldAutoSyncMilvusTickets(lastSync, Date.now())) {
      syncClientMilvusTicketsUI(clientId, { silent: true });
    }
  } catch (_) {}
}

async function loadClientMilvusTicketsUI(clientId) {
  const wrap = document.getElementById('milvusTicketsList');
  if (!wrap) return;
  // Token da requisição: troca de cliente/aba invalida a resposta em voo
  // (evita pintar tickets do cliente A no modal do cliente B).
  const myReq = { clientId };
  _mticketsReq = myReq;
  const isStale = () => _mticketsReq !== myReq || !document.getElementById('milvusTicketsList');
  let tickets = [];
  try {
    tickets = typeof getClientMilvusTickets === 'function' ? await getClientMilvusTickets(clientId) : [];
  } catch (_) { tickets = []; }
  if (isStale()) return;
  if (!tickets.length) {
    wrap.innerHTML = '<div class="empty-state" style="padding:16px"><p>Nenhum chamado sincronizado.</p><p style="font-size:12px">Use Sincronizar para buscar os 10 mais recentes.</p></div>';
    return;
  }
  wrap.innerHTML = `<div class="mticket-list">` + tickets.slice(0, 10).map((t) => `
    <div class="mticket-row" onclick="openMilvusTicketDetail('${escapeHtml(clientId)}','${escapeHtml(t.id)}')" title="Ver detalhes">
      <div class="mticket-top">
        <strong class="mticket-code">#${escapeHtml(String(t.codigo != null ? t.codigo : '—'))}</strong>
        <span class="mticket-subject">${escapeHtml(t.assunto || 'Sem assunto')}</span>
        ${milvusTicketStatusTag(t.status)}
      </div>
      <div class="mticket-meta">${_fmtTicketDate(t.data_criacao)}${t.tecnico ? ` · ${escapeHtml(t.tecnico)}` : ''}</div>
    </div>`).join('') + `</div>`;
}

async function syncClientMilvusTicketsUI(clientId, opts) {
  const silent = !!(opts && opts.silent);
  if (_milvusTicketsSyncing[clientId]) return;
  _milvusTicketsSyncing[clientId] = true;
  const btn = document.getElementById('milvusTicketsSyncBtn');
  const setMsg = (html) => { const m = document.getElementById('milvusTicketsMsg'); if (m) m.innerHTML = html; };
  if (btn && !silent) { btn.disabled = true; btn.textContent = 'Sincronizando…'; }
  try {
    const res = await syncClientMilvusTickets(clientId);
    const st = typeof resolveMilvusTicketsSyncState === 'function'
      ? resolveMilvusTicketsSyncState(res)
      : { kind: res && res.unmapped ? 'unmapped' : 'ok', synced: (res && res.synced) || 0 };
    if (st.kind === 'no-token') {
      setMsg('<span style="color:var(--text-muted)">Este cliente ainda não possui token configurado no Milvus.</span>');
    } else if (st.kind === 'unmapped') {
      setMsg('<span style="color:var(--text-muted)">Cliente não possui mapeamento no Milvus.</span>');
    } else if (!silent) {
      const s = (res && res.synced) || 0;
      setMsg(`<span style="color:var(--success,#16a34a)">${plural(s, 'chamado atualizado', 'chamados atualizados')}.</span>`);
    } else {
      setMsg('');
    }
    try {
      const last = typeof getMilvusTicketsLastSyncAt === 'function' ? getMilvusTicketsLastSyncAt(clientId) : null;
      const lastEl = document.getElementById('milvusTicketsLastSync');
      if (last && lastEl) lastEl.textContent = _fmtTicketDate(last);
    } catch (_) {}
    await loadClientMilvusTicketsUI(clientId);
  } catch (e) {
    // Erro discreto; mantém os já sincronizados (não apaga nada).
    if (!silent) setMsg('<span style="color:var(--danger,#dc2626)">Não foi possível atualizar os chamados do Milvus.</span>');
  } finally {
    _milvusTicketsSyncing[clientId] = false;
    if (btn) { btn.disabled = false; btn.textContent = '↻ Sincronizar'; }
  }
}

async function openMilvusTicketDetail(clientId, ticketId) {
  let tickets = [];
  try {
    tickets = typeof getClientMilvusTickets === 'function' ? await getClientMilvusTickets(clientId) : [];
  } catch (_) { tickets = []; }
  const t = tickets.find((x) => x && x.id === ticketId);
  if (!t) return;
  const ir = (label, val) => `<div class="info-item"><div class="info-key">${label}</div><div class="info-value ${val && val !== '—' ? '' : 'empty'}">${val || '—'}</div></div>`;
  const cat = [t.categoria_primaria, t.categoria_secundaria].filter(Boolean).map(escapeHtml).join(' / ') || '—';
  const log = t.ultima_log && (t.ultima_log.texto || t.ultima_log.data)
    ? `<div class="mticket-log-text">${escapeHtml(t.ultima_log.texto || '')}</div><div class="mticket-meta">${_fmtTicketDate(t.ultima_log.data)}${t.ultima_log.tecnico ? ` · ${escapeHtml(t.ultima_log.tecnico)}` : ''}</div>`
    : '<span style="color:var(--text-muted);font-size:13px">—</span>';
  openModal(`#${escapeHtml(String(t.codigo != null ? t.codigo : '—'))} · ${escapeHtml(t.assunto || 'Chamado')}`, `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
      ${milvusTicketStatusTag(t.status)}
      ${t.prioridade ? `<span class="tag tag-yellow">${escapeHtml(t.prioridade)}</span>` : ''}
    </div>
    <div class="info-grid">
      ${ir('Código', escapeHtml(String(t.codigo != null ? t.codigo : '—')))}
      ${ir('Categoria', cat)}
      ${ir('Técnico', escapeHtml(t.tecnico || ''))}
      ${ir('Criado em', _fmtTicketDate(t.data_criacao))}
      ${ir('Modificado em', _fmtTicketDate(t.data_modificacao))}
      ${ir('Solucionado em', t.data_solucao ? _fmtTicketDate(t.data_solucao) : '')}
    </div>
    ${t.descricao ? `<div class="client-detail-section"><div class="client-detail-section-title">📝 Descrição</div><div class="mticket-desc">${escapeHtml(t.descricao)}</div></div>` : ''}
    <div class="client-detail-section mticket-log"><div class="client-detail-section-title">💬 Última interação</div><div>${log}</div></div>`);
}

// ── Inventário Milvus (somente listagem; sem licença, sem status, sem softwares) ──
function renderClientInventoryTab(clientId) {
  const el = document.getElementById('clientTabContent');
  if (!el) return;
  let lastSync = null;
  try { lastSync = typeof getMilvusLastSyncAt === 'function' ? getMilvusLastSyncAt(clientId) : null; } catch (_) {}
  const lastTxt = lastSync
    ? (typeof formatDateTime === 'function' ? formatDateTime(lastSync) : new Date(lastSync).toLocaleString('pt-BR'))
    : 'nunca';
  el.innerHTML = `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
      <button class="btn btn-primary btn-sm" id="milvusSyncBtn" onclick="syncClientInventoryUI('${escapeHtml(clientId)}')">↻ Sincronizar inventário</button>
      <button class="btn btn-secondary btn-sm" onclick="exportClientInventory('${escapeHtml(clientId)}')" title="Exportar inventário (.xlsx)">Exportar planilha</button>
      <label class="btn btn-secondary btn-sm" style="cursor:pointer" title="Importar export Excel do Milvus (.xlsx)">
        📥 Importar planilha
        <input type="file" id="milvusImportFile" accept=".xlsx,.xls" style="display:none" onchange="importClientInventoryUI('${escapeHtml(clientId)}',this)" />
      </label>
      <span style="font-size:12px;color:var(--text-muted)">Última sincronização: <strong id="milvusLastSync">${escapeHtml(lastTxt)}</strong></span>
    </div>
    <div id="milvusSyncMsg" style="font-size:13px;margin-bottom:10px"></div>
    <div class="table-wrapper" id="milvusTableWrap"><p style="color:var(--text-muted);font-size:12px;padding:8px 0">Carregando inventário…</p></div>`;
  loadClientInventoryUI(clientId);
}

async function loadClientInventoryUI(clientId) {
  const wrap = document.getElementById('milvusTableWrap');
  if (!wrap) return;
  let devices = [];
  try {
    devices = typeof getClientDevices === 'function' ? await getClientDevices(clientId) : [];
  } catch (_) { devices = []; }
  if (!devices.length) {
    wrap.innerHTML = '<div class="empty-state"><p>Nenhum dispositivo sincronizado para este cliente.</p></div>';
    return;
  }
  wrap.innerHTML = `<table class="milvus-table"><thead><tr><th>Hostname</th><th>Apelido</th><th>Processador</th><th>Marca</th><th>Modelo</th><th>Sistema operacional</th><th>Nº serial</th><th>Usuário logado</th><th>Tipo</th><th>IP interno</th><th>Status</th><th>Atualizado em</th></tr></thead><tbody>${devices.map((d) => {
    const upd = d.data_ultima_atualizacao || d.updatedAt;
    const updTxt = upd ? (typeof formatDateTime === 'function' ? formatDateTime(upd) : new Date(upd).toLocaleString('pt-BR')) : '—';
    return `<tr><td class="c-main" title="${escapeHtml(d.hostname || '')}"><strong>${escapeHtml(d.hostname || '—')}</strong></td><td>${escapeHtml(d.apelido || '—')}</td><td class="c-so" title="${escapeHtml(d.processador || '')}">${escapeHtml(d.processador || '—')}</td><td>${escapeHtml(d.marca || '—')}</td><td class="c-nowrap" title="${escapeHtml(d.modelo_notebook || '')}">${escapeHtml(d.modelo_notebook || '—')}</td><td class="c-so" title="${escapeHtml(d.sistema_operacional || '')}">${escapeHtml(d.sistema_operacional || '—')}</td><td class="c-nowrap" title="${escapeHtml(d.numero_serial || '')}">${escapeHtml(d.numero_serial || '—')}</td><td>${escapeHtml(d.usuario_logado || '—')}</td><td>${escapeHtml(d.tipo_dispositivo_text || '—')}</td><td class="c-nowrap">${escapeHtml(d.ip_interno || '—')}</td><td>${d.is_ativo !== false ? '<span class="tag tag-green">Ativo</span>' : '<span class="tag tag-red">Inativo</span>'}</td><td class="c-nowrap">${escapeHtml(updTxt)}</td></tr>`;
  }).join('')}</tbody></table>`;
}

async function syncClientInventoryUI(clientId) {
  const btn = document.getElementById('milvusSyncBtn');
  const msg = document.getElementById('milvusSyncMsg');
  if (btn) { btn.disabled = true; btn.textContent = 'Sincronizando inventário…'; }
  if (msg) { msg.innerHTML = '<span style="color:var(--text-muted)">Sincronizando inventário…</span>'; }
  try {
    const res = await syncClientDevices(clientId);
    const fmt = typeof formatMilvusSyncResult === 'function'
      ? formatMilvusSyncResult(res)
      : { line: `${(res && res.synced) || 0} dispositivos sincronizados`, unresolved: 0 };
    if (msg) msg.innerHTML = `<span style="color:var(--success,#16a34a)">${escapeHtml(fmt.line)}</span>`;
    try {
      const last = typeof getMilvusLastSyncAt === 'function' ? getMilvusLastSyncAt(clientId) : null;
      const lastEl = document.getElementById('milvusLastSync');
      if (last && lastEl) lastEl.textContent = typeof formatDateTime === 'function' ? formatDateTime(last) : new Date(last).toLocaleString('pt-BR');
    } catch (_) {}
    await loadClientInventoryUI(clientId);
  } catch (e) {
    // Mensagem amigável; sem token ou detalhe sensível.
    if (msg) msg.innerHTML = '<span style="color:var(--danger,#dc2626)">Não foi possível sincronizar o inventário. Tente novamente.</span>';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '↻ Sincronizar inventário'; }
  }
}

async function importClientInventoryUI(clientId, input) {
  const file = input && input.files && input.files[0];
  if (input) input.value = '';
  if (!file) return;
  const setMsg = (html) => { const m = document.getElementById('milvusSyncMsg'); if (m) m.innerHTML = html; };
  try {
    setMsg('<span style="color:var(--text-muted)">Lendo planilha…</span>');
    const rows = await readMilvusExportFile(file);
    setMsg(`<span style="color:var(--text-muted)">Importando ${plural(rows.length, 'linha', 'linhas')}…</span>`);
    const res = await importClientDevicesFromRows(clientId, rows);
    setMsg(`<span style="color:var(--success,#16a34a)">${res.imported} dispositivos importados · ${res.created} novos · ${res.updated} atualizados${res.skipped ? ` · ${res.skipped} de outros clientes, ignorados` : ''}</span>`);
    try {
      const last = typeof getMilvusLastSyncAt === 'function' ? getMilvusLastSyncAt(clientId) : null;
      const lastEl = document.getElementById('milvusLastSync');
      if (last && lastEl) lastEl.textContent = typeof formatDateTime === 'function' ? formatDateTime(last) : new Date(last).toLocaleString('pt-BR');
    } catch (_) {}
    await loadClientInventoryUI(clientId);
  } catch (e) {
    setMsg(`<span style="color:var(--danger,#dc2626)">${escapeHtml((e && e.message) || 'Não foi possível importar a planilha.')}</span>`);
  }
}

function duplicateProcedure(clientId, procId) {
  const p = getProcedures(clientId).find(x => x.id === procId);
  if (!p) return;
  saveProcedure({ clientId, title: (p.title || '') + ' (cópia)', category: p.category, content: p.content });
  renderClientTab('procedimentos', clientId);
  showToast('Procedimento duplicado!', 'success');
}

function openProcedureForm(clientId, procId = null) {
  const p = procId ? getProcedures(clientId).find(x => x.id === procId) : {};
  const templates = typeof getProcedureTemplates === 'function' ? getProcedureTemplates() : [];

  openModal(procId ? 'Editar Procedimento' : 'Novo Procedimento', `
    <form class="ov-form" onsubmit="submitProcedureForm(event,'${clientId}','${procId||''}')">
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
  // Barreira antes mesmo do modal: não-admin não abre confirmação, não gera
  // undo e não encosta no deleteClient (que também é guardado). Vale mesmo
  // offline — nenhuma exclusão entra na fila.
  if (typeof isCurrentAdmin === 'function' && !isCurrentAdmin()) {
    if (typeof showToast === 'function') showToast('Apenas administradores podem excluir clientes.', 'error');
    return;
  }
  var c = getClientById(id);
  if (!c) return;
  confirmAction('Excluir cliente <strong>' + escapeHtml(c.name) + '</strong>?', function() {
    var snapshot = JSON.parse(JSON.stringify(c));
    deleteClient(id);
    _refreshClientsInPlace(); // reconstrói _filteredClients (busca ativa) em vez de renderizar o array stale
    updateBadges();
    showUndoToast('Cliente "' + c.name + '" removido.', function() {
      saveClient(snapshot);
      _refreshClientsInPlace();
      updateBadges();
      showToast('Cliente restaurado.', 'success');
    });
  });
}
