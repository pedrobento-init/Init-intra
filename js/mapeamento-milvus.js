// mapeamento-milvus.js — Tela administrativa "Mapeamento Milvus × Clientes"
// =====================================================================
// Associação SEMPRE explícita (admin escolhe):
//   Milvus.nome_fantasia → milvus_client_map.milvus_nome → client_id → clients.id
// NUNCA há heurística/fuzzy/contém/começa-com: nomes parecidos (ex.: três
// "ACME…") exigem seleção manual. O frontend NUNCA vê o token do Milvus.

let _mapNomes = [];
let _mapRows = [];
let _mapSearch = '';
let _mapFilter = 'todos';

// ── Guard admin (o servidor revalida is_admin; aqui é UX) ──
function isMilvusMappingAdmin() {
  return typeof isCurrentAdmin === 'function' && isCurrentAdmin() === true;
}

// ── Helpers puros (testáveis) ──
function normalizeMilvusName(v) {
  if (typeof v !== 'string') return '';
  return v.trim().replace(/\s+/g, ' ');
}

// Agrega dispositivos em nomes deduplicados (case-insensitive).
// Retorna SOMENTE {nome, quantidadeDispositivos} — nada sensível.
function aggregateMilvusNames(devices) {
  const map = new Map();
  for (const d of devices || []) {
    const nome = normalizeMilvusName(d && d.nome_fantasia);
    if (!nome) continue;
    const key = nome.toLowerCase();
    const entry = map.get(key);
    if (entry) entry.quantidadeDispositivos++;
    else map.set(key, { nome: nome, quantidadeDispositivos: 1 });
  }
  return [...map.values()].sort((a, b) =>
    b.quantidadeDispositivos - a.quantidadeDispositivos ||
    a.nome.localeCompare(b.nome, 'pt-BR'));
}

// Junta nomes do Milvus + mapa salvo + clientes → linhas da tela.
function buildMapeamentoRows(milvusNames, mapRows, clients) {
  const byNome = new Map();
  for (const m of mapRows || []) {
    if (m && m.milvus_nome) byNome.set(String(m.milvus_nome).toLowerCase(), m.client_id);
  }
  const byId = new Map((clients || []).map((c) => [c.id, c.name || c.id]));
  return (milvusNames || []).map((n) => {
    const clientId = byNome.get(String(n.nome).toLowerCase()) || null;
    return {
      nome: n.nome,
      quantidadeDispositivos: n.quantidadeDispositivos || 0,
      clientId: clientId,
      clientName: clientId ? (byId.get(clientId) || null) : null,
      status: clientId ? 'mapeado' : 'pendente',
    };
  });
}

function filterMapeamentoRows(rows, search, filter) {
  const q = (search || '').trim().toLowerCase();
  return (rows || []).filter((r) => {
    if (filter === 'mapeados' && r.status !== 'mapeado') return false;
    if (filter === 'pendentes' && r.status !== 'pendente') return false;
    if (!q) return true;
    return r.nome.toLowerCase().includes(q) ||
      (r.clientName || '').toLowerCase().includes(q);
  });
}

// Valida UMA associação explícita. Retorna:
// {ok:true} | {ok:true, noop:true} | {ok:true, needsConfirm:'reassign'|'client-used'} | {ok:false, error}
function validateMapeamento(nome, clientId, rows) {
  const clean = normalizeMilvusName(nome);
  if (!clean) return { ok: false, error: 'Nome do Milvus inválido.' };
  if (!clientId) return { ok: false, error: 'Selecione um cliente do sistema.' };
  const list = rows || [];
  const same = list.find((r) => r.nome.toLowerCase() === clean.toLowerCase());
  if (same && same.clientId === clientId) return { ok: true, noop: true };
  if (same && same.clientId && same.clientId !== clientId) {
    return { ok: true, needsConfirm: 'reassign' };
  }
  const other = list.find((r) =>
    r.clientId === clientId && r.nome.toLowerCase() !== clean.toLowerCase());
  if (other) return { ok: true, needsConfirm: 'client-used' };
  return { ok: true };
}

// ── Serviço (Edge + Supabase com RLS do usuário) ──
async function fetchMilvusClientNames() {
  if (!isMilvusMappingAdmin()) throw new Error('Somente administradores.');
  if (typeof isSupabaseConnected !== 'function' || !isSupabaseConnected() ||
      typeof supabaseClient === 'undefined' || !supabaseClient) {
    throw new Error('Sem conexão com o servidor.');
  }
  const { data, error } = await supabaseClient.functions.invoke('milvus-client-names', { body: {} });
  if (error) throw new Error('Falha ao consultar nomes do Milvus. Tente novamente.');
  if (!data || data.success !== true || !Array.isArray(data.nomes)) {
    throw new Error('Falha ao consultar nomes do Milvus. Tente novamente.');
  }
  return data.nomes;
}

async function loadMilvusMap() {
  if (typeof isSupabaseConnected !== 'function' || !isSupabaseConnected() ||
      typeof supabaseClient === 'undefined' || !supabaseClient) {
    return [];
  }
  const { data, error } = await supabaseClient.from('milvus_client_map').select('milvus_nome,client_id');
  if (error) return [];
  return Array.isArray(data) ? data : [];
}

async function saveMilvusMapping(nome, clientId) {
  if (!isMilvusMappingAdmin()) throw new Error('Somente administradores.');
  const clean = normalizeMilvusName(nome);
  if (!clean || !clientId) throw new Error('Nome e cliente são obrigatórios.');
  const { error } = await supabaseClient.from('milvus_client_map')
    .upsert({ milvus_nome: clean, client_id: clientId }, { onConflict: 'milvus_nome' });
  if (error) throw new Error('Falha ao salvar mapeamento. Tente novamente.');
  return true;
}

async function removeMilvusMapping(nome) {
  if (!isMilvusMappingAdmin()) throw new Error('Somente administradores.');
  const clean = normalizeMilvusName(nome);
  if (!clean) throw new Error('Nome inválido.');
  const { error } = await supabaseClient.from('milvus_client_map').delete().eq('milvus_nome', clean);
  if (error) throw new Error('Falha ao remover mapeamento. Tente novamente.');
  return true;
}

// ── Tela ──
function renderMapeamentoMilvus() {
  if (!isMilvusMappingAdmin()) {
    if (typeof showToast === 'function') showToast('Somente administradores podem acessar o mapeamento.', 'error');
    if (typeof navigateTo === 'function') navigateTo('pendencias');
    return;
  }
  document.getElementById('pageTitle').textContent = 'Mapeamento Milvus × Clientes';
  if (typeof setTopbarAction === 'function') setTopbarAction('', '');
  const btn = document.getElementById('topbarActionBtn');
  if (btn) btn.style.display = 'none';
  document.getElementById('contentArea').innerHTML = `
    <p style="font-size:13px;color:var(--text-muted);margin:0 0 12px">
      Associe cada nome encontrado no Milvus a um cliente existente no sistema.
      A sincronização de equipamentos usa somente esses vínculos explícitos.
    </p>
    <div class="search-bar">
      <button class="btn btn-primary btn-sm" id="mapRefreshBtn" onclick="loadMapeamentoData()">🔄 Atualizar nomes do Milvus</button>
      <div class="search-input-wrap" style="flex:1">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input class="form-input" id="mapSearch" placeholder="Buscar por nome do Milvus ou cliente..." value="${typeof escapeHtml === 'function' ? escapeHtml(_mapSearch) : _mapSearch}" oninput="onMapeamentoSearch(this.value)" />
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-secondary btn-sm map-filter-btn${_mapFilter === 'todos' ? ' active' : ''}" onclick="setMapeamentoFilter('todos')">Todos</button>
        <button class="btn btn-secondary btn-sm map-filter-btn${_mapFilter === 'pendentes' ? ' active' : ''}" onclick="setMapeamentoFilter('pendentes')">Pendentes</button>
        <button class="btn btn-secondary btn-sm map-filter-btn${_mapFilter === 'mapeados' ? ' active' : ''}" onclick="setMapeamentoFilter('mapeados')">Mapeados</button>
      </div>
    </div>
    <div id="mapStats" style="font-size:12px;color:var(--text-muted);margin-bottom:10px"></div>
    <div class="table-wrapper" id="mapTableWrap"><p style="color:var(--text-muted);font-size:12px;padding:8px 0">Clique em “Atualizar nomes do Milvus” para começar.</p></div>`;
}

async function loadMapeamentoData() {
  const wrap = document.getElementById('mapTableWrap');
  const btn = document.getElementById('mapRefreshBtn');
  const stats = document.getElementById('mapStats');
  if (btn) { btn.disabled = true; btn.textContent = 'Consultando Milvus…'; }
  if (wrap) wrap.innerHTML = '<p style="color:var(--text-muted);font-size:12px;padding:8px 0">Consultando nomes no Milvus…</p>';
  try {
    const [nomes, map] = await Promise.all([fetchMilvusClientNames(), loadMilvusMap()]);
    const clients = typeof getClients === 'function' ? getClients() : [];
    _mapNomes = nomes;
    _mapRows = buildMapeamentoRows(nomes, map, clients);
    renderMapeamentoTable();
  } catch (e) {
    if (wrap) wrap.innerHTML = '<div class="empty-state"><p>Não foi possível consultar os nomes do Milvus. Tente novamente.</p></div>';
    if (stats) stats.textContent = '';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Atualizar nomes do Milvus'; }
  }
}

function onMapeamentoSearch(v) {
  _mapSearch = v || '';
  renderMapeamentoTable();
}

function setMapeamentoFilter(f) {
  _mapFilter = f;
  document.querySelectorAll('.map-filter-btn').forEach((b) => {
    const t = (b.textContent || '').trim().toLowerCase();
    b.classList.toggle('active',
      (f === 'todos' && t === 'todos') ||
      (f === 'pendentes' && t === 'pendentes') ||
      (f === 'mapeados' && t === 'mapeados'));
  });
  renderMapeamentoTable();
}

function renderMapeamentoTable() {
  const wrap = document.getElementById('mapTableWrap');
  const stats = document.getElementById('mapStats');
  if (!wrap) return;
  const clients = typeof getClients === 'function' ? getClients() : [];
  const rows = filterMapeamentoRows(_mapRows, _mapSearch, _mapFilter);
  const mapped = _mapRows.filter((r) => r.status === 'mapeado').length;
  const devs = _mapRows.reduce((s, r) => s + (r.quantidadeDispositivos || 0), 0);
  if (stats) stats.textContent = `${_mapRows.length} nome(s) no Milvus · ${mapped} mapeado(s) · ${_mapRows.length - mapped} pendente(s) · ${devs} dispositivo(s)`;
  if (!_mapRows.length) {
    wrap.innerHTML = '<div class="empty-state"><p>Nenhum nome carregado. Clique em “Atualizar nomes do Milvus”.</p></div>';
    return;
  }
  if (!rows.length) {
    wrap.innerHTML = '<div class="empty-state"><p>Nenhum resultado para o filtro atual.</p></div>';
    return;
  }
  const esc = typeof escapeHtml === 'function' ? escapeHtml : (s) => String(s === null || s === undefined ? '' : s);
  wrap.innerHTML = `<table><thead><tr><th>Nome no Milvus</th><th>Dispositivos</th><th>Cliente do sistema</th><th>Status</th><th></th></tr></thead><tbody>${rows.map((r) => {
    const idx = _mapRows.indexOf(r);
    const opts = `<option value="">Selecionar…</option>` + clients.map((c) =>
      `<option value="${esc(c.id)}"${r.clientId === c.id ? ' selected' : ''}>${esc(c.name || c.id)}</option>`).join('');
    return `<tr><td><strong>${esc(r.nome)}</strong></td><td>${r.quantidadeDispositivos}</td>` +
      `<td><select class="form-select" style="min-width:220px" onchange="onMapeamentoSelectIdx(${idx},this.value)">${opts}</select></td>` +
      `<td>${r.status === 'mapeado' ? '<span class="tag tag-green">Mapeado</span>' : '<span class="tag tag-yellow">Pendente</span>'}</td>` +
      `<td style="text-align:right">${r.status === 'mapeado' ? `<button class="btn btn-sm btn-danger" title="Remover vínculo" onclick="removeMapeamentoUIIdx(${idx})">✕</button>` : ''}</td></tr>`;
  }).join('')}</tbody></table>`;
}

async function onMapeamentoSelectIdx(idx, clientId) {
  const row = _mapRows[idx];
  if (!row) return;
  if (!clientId) return;
  const v = validateMapeamento(row.nome, clientId, _mapRows);
  if (!v.ok) {
    if (typeof showToast === 'function') showToast(v.error, 'error');
    renderMapeamentoTable();
    return;
  }
  if (v.noop) return;
  const apply = async () => {
    try {
      await saveMilvusMapping(row.nome, clientId);
      const clients = typeof getClients === 'function' ? getClients() : [];
      const c = clients.find((x) => x.id === clientId);
      row.clientId = clientId;
      row.clientName = c ? (c.name || clientId) : clientId;
      row.status = 'mapeado';
      if (typeof showToast === 'function') showToast('Mapeamento salvo!', 'success');
    } catch (e) {
      if (typeof showToast === 'function') showToast('Falha ao salvar mapeamento. Tente novamente.', 'error');
    }
    renderMapeamentoTable();
  };
  if (v.needsConfirm === 'reassign') {
    if (typeof confirmAction === 'function') {
      confirmAction(`“<strong>${typeof escapeHtml === 'function' ? escapeHtml(row.nome) : row.nome}</strong>” já está vinculado a outro cliente. Deseja <strong>trocar</strong> o vínculo?`, apply);
      return;
    }
  }
  if (v.needsConfirm === 'client-used') {
    if (typeof confirmAction === 'function') {
      confirmAction('Este cliente já está vinculado a outro nome do Milvus. Deseja <strong>vincular também</strong> a este nome?', apply);
      return;
    }
  }
  await apply();
}

function removeMapeamentoUIIdx(idx) {
  const row = _mapRows[idx];
  if (!row) return;
  const doRemove = async () => {
    try {
      await removeMilvusMapping(row.nome);
      row.clientId = null;
      row.clientName = null;
      row.status = 'pendente';
      if (typeof showToast === 'function') showToast('Vínculo removido.', 'info');
    } catch (e) {
      if (typeof showToast === 'function') showToast('Falha ao remover vínculo. Tente novamente.', 'error');
    }
    renderMapeamentoTable();
  };
  if (typeof confirmAction === 'function') {
    confirmAction(`Remover o vínculo de “<strong>${typeof escapeHtml === 'function' ? escapeHtml(row.nome) : row.nome}</strong>”?<br><span style="font-size:12px">Os dispositivos já sincronizados são mantidos; novas sincronizações ignorarão esse nome.</span>`, doRemove);
  } else {
    doRemove();
  }
}

// Export para testes (Node/Vitest).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizeMilvusName: normalizeMilvusName,
    aggregateMilvusNames: aggregateMilvusNames,
    buildMapeamentoRows: buildMapeamentoRows,
    filterMapeamentoRows: filterMapeamentoRows,
    validateMapeamento: validateMapeamento,
  };
}
