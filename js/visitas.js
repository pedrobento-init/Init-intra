// visitas.js – Registro e acompanhamento de Visitas Técnicas

const VISIT_PAGE_SIZE = 30;
let _visitPage = 1;
let _filteredVisits = [];

/**
 * Categorias de serviço na visita + pontos de verificação.
 * Ao marcar uma categoria, o checklist correspondente é aplicado.
 */
const VISIT_CHECK_CATEGORIES = {
  nobreak: {
    label: 'Nobreak / Energia',
    color: '#f59e0b',
    items: [
      'Nobreak ligado e em modo online (não bypass)',
      'Carga da bateria / autonomia verificada',
      'Equipamentos críticos plugados no nobreak (não na parede)',
      'Modem/roteador/ONT alimentados e ligados após a troca',
      'Switch/AP e servidor ligados após a troca',
      'Teste de queda de energia (se seguro) ou simulação'
    ]
  },
  rede: {
    label: 'Rede / Link / Modem',
    color: '#0ea5e9',
    items: [
      'Modem/ONT da operadora ligado e com LEDs normais',
      'Link de internet OK (ping / página externa)',
      'Roteador/firewall ligado e acessível',
      'Wi-Fi principal no ar (SSID correto)',
      'Switches com link nos portos críticos',
      'IP fixo / DHCP do cliente validado se aplicável'
    ]
  },
  servidor: {
    label: 'Servidor',
    color: '#8b5cf6',
    items: [
      'Servidor ligado e acessível (local ou remoto)',
      'Serviços críticos rodando (AD, ERP, arquivos…)',
      'Espaço em disco e alertas verificados',
      'Backup recente confere (data/hora)',
      'Acesso remoto (AnyDesk/RDP/VPN) testado'
    ]
  },
  backup: {
    label: 'Backup',
    color: '#16a34a',
    items: [
      'Job de backup ativo e sem falha recente',
      'Destino do backup com espaço',
      'Restauração de teste (amostra) se combinado',
      'Agendamento e notificação de falha OK'
    ]
  },
  estacoes: {
    label: 'Estações / Usuários',
    color: '#6366f1',
    items: [
      'Pelo menos 1 estação de trabalho testada',
      'Login de usuário e pasta de rede OK',
      'Impressão de teste (se houver impressora)',
      'Antivírus/atualizações sem bloqueio crítico'
    ]
  },
  impressao: {
    label: 'Impressão',
    color: '#ec4899',
    items: [
      'Impressora ligada e na rede',
      'Fila de impressão sem erro',
      'Página de teste impressa',
      'Toner/suprimento verificado'
    ]
  },
  telefonia: {
    label: 'Telefonia / PABX',
    color: '#14b8a6',
    items: [
      'PABX/ATA ligado',
      'Linha/tronco com tom',
      'Ramal de teste atende e realiza chamada',
      'Gravação/URA (se houver) operacional'
    ]
  },
  camera: {
    label: 'CFTV / Câmeras',
    color: '#64748b',
    items: [
      'DVR/NVR ligado e gravando',
      'Câmeras online no software',
      'Horário do gravador correto',
      'Espaço de gravação suficiente'
    ]
  },
  geral: {
    label: 'Checklist geral do site',
    color: '#1a56db',
    items: [
      'Ambiente organizado / cabos sem risco',
      'Cliente informado do que foi feito',
      'Pendências restantes registradas no sistema',
      'Fotos ou anotações anexadas se necessário'
    ]
  }
};

function buildVisitChecklistFromCategories(categoryIds, existing) {
  const cats = Array.isArray(categoryIds) ? categoryIds : [];
  const prev = Array.isArray(existing) ? existing : [];
  const prevMap = new Map(prev.map(i => [i.key || (i.category + '|' + i.text), i]));
  const out = [];
  cats.forEach(catId => {
    const cat = VISIT_CHECK_CATEGORIES[catId];
    if (!cat) return;
    cat.items.forEach((text, idx) => {
      const key = catId + '|' + idx;
      const old = prevMap.get(key) || prev.find(p => p.category === catId && p.text === text);
      out.push({
        key,
        category: catId,
        text,
        done: old ? !!old.done : false,
        doneAt: old?.doneAt || null,
        doneBy: old?.doneBy || null
      });
    });
  });
  // Mantém itens manuais (sem category de catálogo)
  prev.forEach(p => {
    if (p.manual && p.text) {
      out.push({
        key: p.key || ('manual|' + p.text),
        category: 'manual',
        text: p.text,
        done: !!p.done,
        doneAt: p.doneAt || null,
        doneBy: p.doneBy || null,
        manual: true
      });
    }
  });
  return out;
}

function visitChecklistProgress(v) {
  const list = v?.checklist || [];
  if (!list.length) return null;
  const done = list.filter(i => i.done).length;
  return { done, total: list.length, pct: Math.round((done / list.length) * 100) };
}

function renderVisitas() {
  document.getElementById('pageTitle').textContent = 'Visitas Técnicas';
  setTopbarAction('+ Nova Visita', '<svg class="topbar-action-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 16H9m10 0h3v-3.15a1 1 0 0 0-.84-.99L16 11l-2.7-3.6a1 1 0 0 0-.8-.4H5.24a2 2 0 0 0-1.8 1.1l-.8 1.63A6 6 0 0 0 2 12.42V16h2"/><circle cx="6.5" cy="16.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/></svg>');
  window._topbarAction = () => openVisitForm();

  const clients  = isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam ? getClientsByTeam(_selectedTeam) : getMyClients();
  const team     = isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam ? _selectedTeam : getCurrentTeam();
  const opNames  = getOperatorNames(team);

  document.getElementById('contentArea').innerHTML = `
    <div class="search-bar" style="flex-wrap:wrap;gap:10px">
      <div class="search-input-wrap" style="flex:1;min-width:180px">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input class="form-input" id="visitSearch" placeholder="Buscar por cliente, motivo..." oninput="saveVisitFilters();debouncedRenderVisitView()" />
      </div>
      <select class="form-select" id="visitClient" style="width:180px" onchange="saveVisitFilters();renderVisitView()">
        <option value="">Todos os clientes</option>
        ${clients.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('')}
      </select>
      <select class="form-select" id="visitOperator" style="width:200px" onchange="saveVisitFilters();renderVisitView()">
        <option value="">Todos os operadores</option>
        ${opNames.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('')}
      </select>
      <select class="form-select" id="visitStatus" style="width:160px" onchange="saveVisitFilters();renderVisitView()">
        <option value="">Todos os status</option>
        <option value="agendada">Agendada</option>
        <option value="em_andamento">Em andamento</option>
        <option value="concluida">Concluída</option>
        <option value="cancelada">Cancelada</option>
      </select>
      <input type="date" class="form-input" id="visitFrom" style="width:140px" onchange="saveVisitFilters();renderVisitView()" title="De" />
      <input type="date" class="form-input" id="visitTo" style="width:140px" onchange="saveVisitFilters();renderVisitView()" title="Até" />
    </div>
    <div id="visitStats" style="margin-bottom:14px"></div>
    <div id="visitViewArea"></div>`;

  const saved = loadFilterState('visitas', {});
  if (saved.search)   document.getElementById('visitSearch').value   = saved.search;
  if (saved.client)   document.getElementById('visitClient').value   = saved.client;
  if (saved.operator) document.getElementById('visitOperator').value = saved.operator;
  if (saved.status)   document.getElementById('visitStatus').value   = saved.status;
  if (saved.from)     document.getElementById('visitFrom').value     = saved.from;
  if (saved.to)       document.getElementById('visitTo').value       = saved.to;
  showSkeleton('visitViewArea', 6);
  renderVisitView();
}

window.debouncedRenderVisitView = debounce(() => renderVisitView(), 300);

function saveVisitFilters() {
  const state = {
    search:   document.getElementById('visitSearch')?.value || '',
    client:   document.getElementById('visitClient')?.value || '',
    operator: document.getElementById('visitOperator')?.value || '',
    status:   document.getElementById('visitStatus')?.value || '',
    from:     document.getElementById('visitFrom')?.value || '',
    to:       document.getElementById('visitTo')?.value || '',
  };
  saveFilterState('visitas', state);
}

function getFilteredVisits() {
  const base = isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam
    ? getVisitsByTeam(_selectedTeam)
    : getMyVisits();
  const q   = (document.getElementById('visitSearch')?.value || '').toLowerCase();
  const cid = document.getElementById('visitClient')?.value || '';
  const op  = document.getElementById('visitOperator')?.value || '';
  const st  = document.getElementById('visitStatus')?.value || '';
  const fr  = document.getElementById('visitFrom')?.value || '';
  const to  = document.getElementById('visitTo')?.value || '';
  return base.filter(v => {
    if (q && !(v.motivo || '').toLowerCase().includes(q)
         && !(v.clientName || '').toLowerCase().includes(q)
         && !(v.observacoes || '').toLowerCase().includes(q)
         && !(v.operator || '').toLowerCase().includes(q)) return false;
    if (cid && v.clientId !== cid) return false;
    if (op  && v.operator !== op) return false;
    if (st  && v.status   !== st)  return false;
    if (fr  && (v.date || '') < fr) return false;
    if (to  && (v.date || '') > to) return false;
    return true;
  }).sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.time || '').localeCompare(a.time || ''));
}

function renderVisitView(resetPage) {
  const area = document.getElementById('visitViewArea');
  if (!area) return;
  setTimeout(() => {
    if (resetPage !== false) _visitPage = 1;
    _filteredVisits = getFilteredVisits();
    renderVisitStats();
    renderVisitTable(area);
  }, 10);
}

function renderVisitStats() {
  const wrap = document.getElementById('visitStats');
  if (!wrap) return;
  const team = isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam ? _selectedTeam : getCurrentTeam();
  const ops = getOperatorNames(team);
  const today = new Date().toISOString().slice(0, 10);
  const base = isTeamAdmin() && _selectedTeam ? getVisitsByTeam(_selectedTeam) : getMyVisits();
  const total    = base.length;
  const todayN   = base.filter(v => v.date === today).length;
  const upcoming = base.filter(v => v.date >= today && v.status === 'agendada').length;
  const doneMonth = base.filter(v => {
    if (!v.date || v.status !== 'concluida') return false;
    const d = new Date(v.date);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }).length;
  wrap.innerHTML = `
    <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">
      <div class="stat-card"><div class="stat-label">Total de visitas</div><div class="stat-value">${total}</div></div>
      <div class="stat-card"><div class="stat-label">Hoje</div><div class="stat-value" style="color:#0ea5e9">${todayN}</div></div>
      <div class="stat-card"><div class="stat-label">Agendadas (futuras)</div><div class="stat-value" style="color:#f59e0b">${upcoming}</div></div>
      <div class="stat-card"><div class="stat-label">Concluídas no mês</div><div class="stat-value" style="color:#16a34a">${doneMonth}</div></div>
    </div>`;
}

function visitStatusTag(st) {
  const m = VISIT_STATUS_MAP[st] || { label: st || '—', color: '#94a3b8' };
  return `<span class="tag" style="background:${m.color}20;color:${m.color};border:1px solid ${m.color}40;font-weight:600">${escapeHtml(m.label)}</span>`;
}

function renderVisitTable(area) {
  const wrap = area || document.getElementById('visitViewArea');
  if (!wrap) return;
  const visits = _filteredVisits;
  if (!visits.length) {
    wrap.innerHTML = `<div class="card"><div class="empty-state"><p>Nenhuma visita encontrada.</p><button class="btn btn-primary btn-sm" onclick="openVisitForm()">+ Nova Visita</button></div></div>`;
    return;
  }
  const totalPages = Math.ceil(visits.length / VISIT_PAGE_SIZE);
  if (_visitPage > totalPages) _visitPage = totalPages;
  if (_visitPage < 1) _visitPage = 1;
  const startIdx = (_visitPage - 1) * VISIT_PAGE_SIZE;
  const pageVisits = visits.slice(startIdx, startIdx + VISIT_PAGE_SIZE);

  wrap.innerHTML = `<div class="table-wrapper"><table class="pen-table visit-table">
    <thead><tr>
      <th class="col-date">Data</th>
      <th class="col-client">Cliente</th>
      <th class="col-desc">Motivo</th>
      <th class="col-resp">Operador</th>
      <th class="col-status">Status</th>
      <th class="col-actions"></th>
    </tr></thead>
    <tbody>${pageVisits.map(v => {
      const c = getClientById(v.clientId);
      const color = c?.color || '#2563eb';
      return `<tr>
        <td data-label="Data" class="col-date" style="white-space:nowrap"><strong>${v.date ? formatDate(v.date) : '—'}</strong>${v.time ? `<div style="font-size:11px;color:var(--text-muted)">⏰ ${escapeHtml(v.time)}</div>` : ''}</td>
        <td data-label="Cliente" class="col-client">
          <div style="display:flex;align-items:center;gap:8px">
            ${c ? clientAvatar(c, 24) : ''}
            <span class="client-badge" style="background:${escapeHtml(color)}20;color:${escapeHtml(color)};border:1px solid ${escapeHtml(color)}40">${escapeHtml(v.clientName)||'—'}</span>
          </div>
        </td>
        <td data-label="Motivo" class="col-desc"><div class="col-desc-value"><span style="font-size:13px">${escapeHtml(v.motivo)||'—'}</span>${(v.categories||[]).length ? `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px">${(v.categories||[]).map(cid => { const c=VISIT_CHECK_CATEGORIES[cid]; return c?`<span class="tag" style="font-size:10px;background:${c.color}18;color:${c.color};border:1px solid ${c.color}40">${escapeHtml(c.label)}</span>`:''; }).join('')}</div>` : ''}${(() => { const pr=visitChecklistProgress(v); return pr?`<div style="font-size:11px;color:var(--text-muted);margin-top:2px">☑ ${pr.pct}% (${pr.done}/${pr.total})</div>`:''; })()}${v.observacoes ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">${escapeHtml(v.observacoes)}</div>` : ''}</div></td>
        <td data-label="Operador" class="col-resp"><span class="resp-badge">${escapeHtml(v.operator)||'—'}</span></td>
        <td data-label="Status" class="col-status">${visitStatusTag(v.status)}</td>
        <td class="col-actions">
          <div style="display:flex;gap:4px">
            <button class="btn btn-sm btn-secondary" onclick="openVisitDetail('${escapeHtml(v.id)}')">Abrir</button>
            <button class="btn btn-sm btn-danger" onclick="deleteVisitConfirm('${escapeHtml(v.id)}')">&#10005;</button>
          </div>
        </td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>
  ${totalPages > 1 ? `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-top:1px solid var(--border)">
      <div style="font-size:12px;color:var(--text-muted)">Mostrando ${startIdx+1}–${Math.min(startIdx+VISIT_PAGE_SIZE, visits.length)} de ${visits.length} visitas</div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-sm btn-secondary" ${_visitPage===1?'disabled':''} onclick="_visitPage--;renderVisitView(false)">← Anterior</button>
        <span style="font-size:13px;padding:4px 8px;display:flex;align-items:center">${_visitPage} / ${totalPages}</span>
        <button class="btn btn-sm btn-secondary" ${_visitPage===totalPages?'disabled':''} onclick="_visitPage++;renderVisitView(false)">Próxima →</button>
      </div>
    </div>` : ''}`;
}

function openVisitForm(id = null, preClientId = null, preDate = null) {
  const v = id ? getVisitById(id) : {};
  const clients = isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam ? getClientsByTeam(_selectedTeam) : getMyClients();
  const team    = isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam ? _selectedTeam : getCurrentTeam();
  const opNames = getOperatorNames(team);
  const currentOp = v.operator || getUser().name;
  const selectedCats = Array.isArray(v.categories) ? v.categories : [];

  openModal(id ? 'Editar Visita' : 'Nova Visita', `
    <form onsubmit="submitVisitForm(event,'${escapeHtml(id||'')}')">
      <div class="form-row">
        <div class="form-group"><label class="form-label">Cliente</label>
          <select class="form-select" name="clientId" required>
            <option value="">Selecione...</option>
            ${clients.map(c => `<option value="${escapeHtml(c.id)}" ${((v.clientId||preClientId)===c.id)?'selected':''}>${escapeHtml(c.name)}</option>`).join('')}
          </select></div>
        <div class="form-group"><label class="form-label">Operador *</label>
          <select class="form-select" name="operator" required>
            ${opNames.length
              ? opNames.map(n => `<option value="${escapeHtml(n)}" ${currentOp===n?'selected':''}>${escapeHtml(n)}</option>`).join('')
              : `<option value="${escapeHtml(currentOp)}">${escapeHtml(currentOp)}</option>`
            }
          </select></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Data *</label>
          <input type="date" class="form-input" name="date" value="${escapeHtml(v.date || preDate || new Date().toISOString().slice(0,10))}" required /></div>
        <div class="form-group"><label class="form-label">Horário</label>
          <input type="time" class="form-input" name="time" value="${escapeHtml(v.time || '')}" /></div>
      </div>
      <div class="form-group"><label class="form-label">Motivo da visita *</label>
        <input class="form-input" name="motivo" value="${escapeHtml(v.motivo || '')}" placeholder="Ex: Troca de nobreak, manutenção de rede..." required /></div>

      <div class="form-group">
        <label class="form-label">Categorias do serviço <span style="font-weight:400;color:var(--text-muted)">(gera checklist de verificação)</span></label>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          ${Object.entries(VISIT_CHECK_CATEGORIES).map(([cid, cat]) => `
            <label style="display:flex;align-items:center;gap:6px;padding:6px 10px;border-radius:8px;border:1px solid ${selectedCats.includes(cid) ? cat.color : 'var(--border)'};background:${selectedCats.includes(cid) ? cat.color + '14' : 'var(--bg-secondary)'};cursor:pointer;font-size:12px;font-weight:500">
              <input type="checkbox" name="categories" value="${escapeHtml(cid)}" ${selectedCats.includes(cid) ? 'checked' : ''}
                onchange="refreshVisitFormChecklistPreview()" style="accent-color:${cat.color}" />
              <span style="color:${cat.color}">${escapeHtml(cat.label)}</span>
            </label>
          `).join('')}
        </div>
        <div id="visitChecklistPreview" style="margin-top:12px"></div>
      </div>

      <div class="form-group"><label class="form-label">Observações</label>
        <textarea class="form-textarea" name="observacoes" rows="3" placeholder="Detalhes, o que foi feito, pendências...">${escapeHtml(v.observacoes || '')}</textarea></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Status</label>
          <select class="form-select" name="status">
            ${Object.entries(VISIT_STATUS_MAP).map(([k,m]) => `<option value="${k}" ${(v.status||'agendada')===k?'selected':''}>${escapeHtml(m.label)}</option>`).join('')}
          </select></div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn-primary"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Salvar</button>
      </div>
    </form>`);
  window._visitFormExistingChecklist = Array.isArray(v.checklist) ? v.checklist : [];
  refreshVisitFormChecklistPreview();
}

function refreshVisitFormChecklistPreview() {
  const el = document.getElementById('visitChecklistPreview');
  if (!el) return;
  const boxes = document.querySelectorAll('input[name="categories"]:checked');
  const cats = Array.from(boxes).map(b => b.value);
  if (!cats.length) {
    el.innerHTML = '<p class="text-muted" style="font-size:12px;margin:0">Selecione categorias (ex.: Nobreak + Rede) para gerar os pontos de verificação no local.</p>';
    return;
  }
  const items = buildVisitChecklistFromCategories(cats, window._visitFormExistingChecklist || []);
  const byCat = {};
  items.forEach(i => {
    if (!byCat[i.category]) byCat[i.category] = [];
    byCat[i.category].push(i);
  });
  el.innerHTML = Object.keys(byCat).map(cid => {
    const cat = VISIT_CHECK_CATEGORIES[cid] || { label: cid, color: '#64748b' };
    return `<div style="margin-bottom:10px;padding:10px 12px;border-radius:8px;border:1px solid ${cat.color}33;background:${cat.color}0a">
      <div style="font-size:12px;font-weight:700;color:${cat.color};margin-bottom:6px">${escapeHtml(cat.label)}</div>
      <ul style="margin:0;padding-left:18px;font-size:12px;color:var(--text-secondary);line-height:1.55">
        ${byCat[cid].map(i => `<li>${escapeHtml(i.text)}</li>`).join('')}
      </ul>
    </div>`;
  }).join('') + `<p style="font-size:11px;color:var(--text-muted);margin:4px 0 0">Na visita, marque cada item no detalhe. Concluir com itens abertos gera alerta.</p>`;
}

function submitVisitForm(e, id) {
  e.preventDefault();
  try {
    const fd = new FormData(e.target);
    const g  = k => (fd.get(k) || '').toString();
    const clientId = g('clientId');
    const client   = clientId ? getClientById(clientId) : null;
    if (clientId && !client) {
      showToast('Cliente inválido.', 'error');
      return;
    }
    if (client && !isTeamAdmin() && (client.team || 'init') !== getCurrentTeam()) {
      showToast('Você não pode registrar visitas para clientes de outra equipe.', 'error');
      return;
    }
    const motivo = g('motivo').trim();
    if (!motivo) { showToast('Informe o motivo da visita.', 'error'); return; }

    const categories = fd.getAll('categories').map(String);
    const existing = id ? (getVisitById(id)?.checklist || []) : (window._visitFormExistingChecklist || []);
    const checklist = buildVisitChecklistFromCategories(categories, existing);
    const status = g('status') || 'agendada';

    if (status === 'concluida' && checklist.length) {
      const open = checklist.filter(i => !i.done);
      if (open.length) {
        const names = open.slice(0, 4).map(i => '• ' + i.text).join('\n');
        const more = open.length > 4 ? `\n…e mais ${open.length - 4}` : '';
        if (!confirm(`Ainda há ${open.length} ponto(s) de verificação em aberto:\n\n${names}${more}\n\nConcluir mesmo assim?`)) {
          return;
        }
      }
    }

    const data = {
      id: id || null,
      clientId,
      clientName: client?.name || '',
      operator: g('operator'),
      date: g('date'),
      time: g('time'),
      motivo,
      observacoes: g('observacoes').trim(),
      status,
      categories,
      checklist
    };
    saveVisit(data);
    closeModal();
    if (document.getElementById('visitViewArea')) renderVisitView();
    if (typeof refreshCalendar === 'function' && document.getElementById('calendarContainer')) refreshCalendar();
    if (typeof updateBadges === 'function') updateBadges();
    showToast(id ? 'Visita atualizada!' : 'Visita registrada!', 'success');
  } catch (err) {
    showToast('Erro ao salvar visita: ' + err.message, 'error');
  }
}

function openVisitDetail(id) {
  const v = getVisitById(id);
  if (!v) return;
  const c = getClientById(v.clientId);
  const pr = visitChecklistProgress(v);
  openModal(`Visita ${escapeHtml(v.id)}`, `
    <div class="ticket-info-grid">
      <div class="ticket-info-item"><div class="ticket-info-label">Cliente</div><div class="ticket-info-value">${c ? `<div style="display:flex;align-items:center;gap:6px">${clientAvatar(c,22)}<span>${escapeHtml(v.clientName)}</span></div>` : escapeHtml(v.clientName)||'—'}</div></div>
      <div class="ticket-info-item"><div class="ticket-info-label">Operador</div><div class="ticket-info-value">${escapeHtml(v.operator)||'—'}</div></div>
      <div class="ticket-info-item"><div class="ticket-info-label">Data</div><div class="ticket-info-value">${v.date ? formatDate(v.date) : '—'}${v.time ? ` <span style="color:var(--text-muted)">⏰ ${escapeHtml(v.time)}</span>` : ''}</div></div>
      <div class="ticket-info-item"><div class="ticket-info-label">Status</div><div class="ticket-info-value">${visitStatusTag(v.status)}</div></div>
    </div>
    <hr class="divider"/>
    <div class="form-group"><label class="form-label">Motivo</label>
      <div class="timeline-text">${escapeHtml(v.motivo)||'—'}</div></div>
    ${(v.categories||[]).length ? `<div class="form-group"><label class="form-label">Categorias</label>
      <div style="display:flex;gap:6px;flex-wrap:wrap">${(v.categories||[]).map(cid => {
        const cat = VISIT_CHECK_CATEGORIES[cid];
        return cat ? `<span class="tag" style="background:${cat.color}18;color:${cat.color};border:1px solid ${cat.color}40">${escapeHtml(cat.label)}</span>` : '';
      }).join('')}</div></div>` : ''}
    ${v.observacoes ? `<div class="form-group"><label class="form-label">Observações</label><div class="timeline-text">${escapeHtml(v.observacoes)}</div></div>` : ''}

    <div class="form-group">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px">
        <label class="form-label" style="margin:0">Checklist de verificação no local</label>
        <span id="visitCheckProgressLabel" style="font-size:12px;font-weight:600;color:${pr ? (pr.pct===100?'#16a34a':'#f59e0b') : 'var(--text-muted)'}">${pr ? `${pr.done}/${pr.total} · ${pr.pct}%` : ''}</span>
      </div>
      <div id="visitCheckProgressBar" style="height:6px;background:var(--border);border-radius:99px;overflow:hidden;margin-bottom:10px;${pr ? '' : 'display:none'}">
        <div id="visitCheckProgressFill" style="height:100%;width:${pr ? pr.pct : 0}%;background:${pr && pr.pct===100?'#16a34a':'#0ea5e9'};transition:width .2s"></div>
      </div>
      <div id="visitChecklistBox">${renderVisitChecklistHtml(v)}</div>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        <input class="form-input" id="visitManualCheck" placeholder="Item manual extra..." style="flex:1;min-width:160px" />
        <button type="button" class="btn btn-secondary btn-sm" onclick="addVisitManualCheck('${escapeHtml(id)}')">+ Item</button>
      </div>
    </div>

    <div class="form-group"><label class="form-label">Alterar status</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <select class="form-select" id="chgVisitStatus" style="width:200px">
          ${Object.entries(VISIT_STATUS_MAP).map(([k,mm]) => `<option value="${k}" ${v.status===k?'selected':''}>${escapeHtml(mm.label)}</option>`).join('')}
        </select>
        <button class="btn btn-primary btn-sm" onclick="changeVisitStatus('${escapeHtml(id)}')">Atualizar</button>
        <button class="btn btn-secondary btn-sm" onclick="closeModal();openVisitForm('${escapeHtml(id)}')">✎ Editar</button>
      </div>
    </div>
  `, 'lg');
}

function renderVisitChecklistHtml(v) {
  const list = v.checklist || [];
  if (!list.length) {
    return `<p class="text-muted" style="font-size:12px;margin:0">Nenhum checklist. Edite a visita e marque categorias (ex.: <strong>Nobreak</strong> + <strong>Rede</strong>) para não esquecer o modem da operadora após a troca.</p>`;
  }
  const byCat = {};
  list.forEach((item, index) => {
    const cid = item.category || 'geral';
    if (!byCat[cid]) byCat[cid] = [];
    byCat[cid].push({ item, index });
  });
  return Object.keys(byCat).map(cid => {
    const cat = VISIT_CHECK_CATEGORIES[cid] || { label: cid === 'manual' ? 'Itens manuais' : cid, color: '#64748b' };
    const rows = byCat[cid];
    const doneN = rows.filter(r => r.item.done).length;
    return `<div style="margin-bottom:12px;border:1px solid ${cat.color}30;border-radius:10px;overflow:hidden">
      <div style="padding:8px 12px;background:${cat.color}12;display:flex;justify-content:space-between;align-items:center">
        <strong style="font-size:12px;color:${cat.color}">${escapeHtml(cat.label)}</strong>
        <span style="font-size:11px;color:var(--text-muted)">${doneN}/${rows.length}</span>
      </div>
      <div style="padding:4px 10px 8px">
        ${rows.map(({ item, index }) => `
          <label style="display:flex;align-items:flex-start;gap:10px;padding:8px 4px;cursor:pointer;border-bottom:1px solid var(--border);font-size:13px">
            <input type="checkbox" ${item.done ? 'checked' : ''} onchange="toggleVisitCheckItem('${escapeHtml(v.id)}',${index})"
              style="margin-top:2px;accent-color:${cat.color};width:16px;height:16px;flex-shrink:0" />
            <span style="flex:1;${item.done ? 'text-decoration:line-through;color:var(--text-muted)' : ''}">${escapeHtml(item.text)}</span>
            ${item.manual ? `<button type="button" class="btn btn-sm btn-danger" style="padding:2px 6px;font-size:10px" onclick="event.preventDefault();removeVisitCheckItem('${escapeHtml(v.id)}',${index})">✕</button>` : ''}
          </label>
        `).join('')}
      </div>
    </div>`;
  }).join('');
}

function toggleVisitCheckItem(id, index) {
  const v = getVisitById(id);
  if (!v || !v.checklist || !v.checklist[index]) return;
  const item = v.checklist[index];
  item.done = !item.done;
  if (item.done) {
    item.doneAt = new Date().toISOString();
    item.doneBy = (typeof getUser === 'function' ? getUser()?.name : null) || null;
  } else {
    item.doneAt = null;
    item.doneBy = null;
  }
  saveVisit(v);
  const fresh = getVisitById(id);
  const box = document.getElementById('visitChecklistBox');
  if (box) box.innerHTML = renderVisitChecklistHtml(fresh);
  const pr = visitChecklistProgress(fresh);
  const lab = document.getElementById('visitCheckProgressLabel');
  const bar = document.getElementById('visitCheckProgressBar');
  const fill = document.getElementById('visitCheckProgressFill');
  if (pr && lab) {
    lab.textContent = `${pr.done}/${pr.total} · ${pr.pct}%`;
    lab.style.color = pr.pct === 100 ? '#16a34a' : '#f59e0b';
  }
  if (pr && bar && fill) {
    bar.style.display = '';
    fill.style.width = pr.pct + '%';
    fill.style.background = pr.pct === 100 ? '#16a34a' : '#0ea5e9';
  }
  if (document.getElementById('visitViewArea')) renderVisitView(false);
}

function addVisitManualCheck(id) {
  const input = document.getElementById('visitManualCheck');
  const text = (input?.value || '').trim();
  if (!text) return;
  const v = getVisitById(id);
  if (!v) return;
  if (!v.checklist) v.checklist = [];
  v.checklist.push({
    key: 'manual|' + Date.now(),
    category: 'manual',
    text,
    done: false,
    manual: true
  });
  saveVisit(v);
  if (input) input.value = '';
  openVisitDetail(id);
  if (document.getElementById('visitViewArea')) renderVisitView(false);
  showToast('Item adicionado.', 'success');
}

function removeVisitCheckItem(id, index) {
  const v = getVisitById(id);
  if (!v || !v.checklist) return;
  v.checklist.splice(index, 1);
  saveVisit(v);
  openVisitDetail(id);
  if (document.getElementById('visitViewArea')) renderVisitView(false);
}

function changeVisitStatus(id) {
  const v = getVisitById(id);
  if (!v) return;
  const next = document.getElementById('chgVisitStatus').value;
  if (next === 'concluida' && (v.checklist || []).length) {
    const open = v.checklist.filter(i => !i.done);
    if (open.length) {
      const names = open.slice(0, 5).map(i => '• ' + i.text).join('\n');
      const more = open.length > 5 ? `\n…e mais ${open.length - 5}` : '';
      if (!confirm(`Checklist incompleto (${open.length} em aberto):\n\n${names}${more}\n\nEx.: após trocar nobreak, confira se o modem da operadora voltou.\n\nConcluir mesmo assim?`)) {
        return;
      }
    }
  }
  v.status = next;
  saveVisit(v);
  showToast('Status atualizado!', 'success');
  openVisitDetail(id);
  if (document.getElementById('visitViewArea')) renderVisitView(false);
  if (typeof refreshCalendar === 'function' && document.getElementById('calendarContainer')) refreshCalendar();
  if (typeof updateBadges === 'function') updateBadges();
}

function deleteVisitConfirm(id) {
  const v = getVisitById(id);
  if (!v) return;
  confirmAction('Excluir esta visita?', function() {
    const snapshot = JSON.parse(JSON.stringify(v));
    deleteVisit(id);
    renderVisitView();
    if (typeof refreshCalendar === 'function' && document.getElementById('calendarContainer')) refreshCalendar();
    if (typeof updateBadges === 'function') updateBadges();
    showUndoToast('Visita removida.', function() {
      saveVisit(snapshot);
      renderVisitView();
      if (typeof refreshCalendar === 'function' && document.getElementById('calendarContainer')) refreshCalendar();
      if (typeof updateBadges === 'function') updateBadges();
      showToast('Visita restaurada.', 'success');
    });
  });
}
