// mapeamento-milvus.js — Tela administrativa "Mapeamento Milvus × Clientes"
// =====================================================================
// Associação SEMPRE explícita (admin escolhe):
//   Milvus.nome_fantasia → milvus_client_map.milvus_nome → client_id → clients.id
// NUNCA há heurística/fuzzy/contém/começa-com: nomes parecidos (ex.: três
// "ACME…") exigem seleção manual. O frontend NUNCA vê o token do Milvus.

let _mapNomes = [];
let _mapApiNomes = [];
let _mapImported = [];
let _mapClients = [];
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
    const row = {
      nome: n.nome,
      quantidadeDispositivos: (typeof n.quantidadeDispositivos === 'number') ? n.quantidadeDispositivos : null,
      clientId: clientId,
      clientName: clientId ? (byId.get(clientId) || null) : null,
      status: clientId ? 'mapeado' : 'pendente',
    };
    if (n.milvusClienteId !== undefined) row.milvusClienteId = n.milvusClienteId;
    if (n.cnpj !== undefined) row.cnpj = n.cnpj;
    if (n.duplicado !== undefined) row.duplicado = n.duplicado === true;
    return row;
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

// Converte texto colado (um nome por linha) em nomes deduplicados.
// Ignora linhas vazias e eventual cabeçalho ("nome"/"nome_fantasia").
// Retorna SOMENTE [{nome, quantidadeDispositivos}] — nada sensível.
function parseMilvusNameList(text) {
  const counts = new Map();
  const lines = String(text || '').split(/\r?\n/);
  for (const line of lines) {
    const nome = normalizeMilvusName(line);
    if (!nome) continue;
    if (/^nome(_fantasia)?$/i.test(nome)) continue;
    const key = nome.toLowerCase();
    const entry = counts.get(key);
    if (entry) entry.quantidadeDispositivos++;
    else counts.set(key, { nome: nome, quantidadeDispositivos: 1 });
  }
  return [...counts.values()].sort((a, b) =>
    b.quantidadeDispositivos - a.quantidadeDispositivos ||
    a.nome.localeCompare(b.nome, 'pt-BR'));
}

// Une nomes da API + lista colada (chave exata, sem aproximação).
// Quantidade = maior das duas fontes (null = fora da amostra: não conta).
// Extras (id/CNPJ/duplicado) vêm da API e são preservados no conflito.
function mergeMilvusNameSources(apiNames, importedNames) {
  const map = new Map();
  for (const n of (apiNames || []).concat(importedNames || [])) {
    if (!n || !n.nome) continue;
    const key = String(n.nome).toLowerCase();
    const entry = map.get(key);
    const q = (typeof n.quantidadeDispositivos === 'number') ? n.quantidadeDispositivos : null;
    if (entry) {
      if (q !== null && (entry.quantidadeDispositivos === null || q > entry.quantidadeDispositivos)) {
        entry.quantidadeDispositivos = q;
      }
    } else {
      const obj = { nome: n.nome, quantidadeDispositivos: q };
      if (n.milvusClienteId !== undefined) obj.milvusClienteId = n.milvusClienteId;
      if (n.cnpj !== undefined) obj.cnpj = n.cnpj;
      if (n.duplicado !== undefined) obj.duplicado = n.duplicado === true;
      map.set(key, obj);
    }
  }
  return [...map.values()].sort((a, b) =>
    (b.quantidadeDispositivos ?? -1) - (a.quantidadeDispositivos ?? -1) ||
    a.nome.localeCompare(b.nome, 'pt-BR'));
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

// Clientes direto do Supabase (RLS: admin vê todos) — o cache local
// pode estar incompleto/desatualizado e esconder clientes do select.
async function loadMapeamentoClients() {
  try {
    if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() &&
        typeof supabaseClient !== 'undefined' && supabaseClient) {
      const { data, error } = await supabaseClient
        .from('clients')
        .select('id,name,team')
        .order('name', { ascending: true });
      if (!error && Array.isArray(data) && data.length) return data;
    }
  } catch (_) {}
  try {
    if (typeof getClients === 'function') return getClients();
  } catch (_) {}
  return [];
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
      <button class="btn btn-secondary btn-sm" id="mapTokensBtn" onclick="openMilvusTokenBackfillModal()" title="Preenche o token vazio a partir da lista do Milvus (prévia antes)">🔑 Preencher tokens</button>
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
    <details style="margin-bottom:12px;border:1px solid var(--border);border-radius:8px;padding:8px 12px">
      <summary style="cursor:pointer;font-size:13px;font-weight:600">📋 Importar lista de nomes (planilha do Milvus)</summary>
      <p style="font-size:12px;color:var(--text-muted);margin:8px 0">Cole um nome por linha. A lista é unida aos nomes da API sem nenhuma aproximação automática — o vínculo continua manual.</p>
      <textarea class="form-textarea" id="mapImportText" rows="4" placeholder="EMPRESA ABC LTDA&#10;EMPRESA XYZ LTDA" style="width:100%"></textarea>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn btn-secondary btn-sm" onclick="importMilvusNameList()">Importar nomes</button>
        <button class="btn btn-secondary btn-sm" onclick="clearMilvusNameList()">Limpar lista importada</button>
      </div>
    </details>
    <div class="table-wrapper" id="mapTableWrap"><p style="color:var(--text-muted);font-size:12px;padding:8px 0">Clique em “Atualizar nomes do Milvus” para começar.</p></div>`;
}

// ── Backfill de tokens (prévia → confirmação; admin) ──
let _tokenBackfillPreview = [];

function _tokenBackfillStatusTag(st) {
  if (st === 'pronto') return '<span class="tag tag-green">Pronto p/ preencher</span>';
  if (st === 'ja_preenchido') return '<span class="tag tag-blue">Já preenchido</span>';
  if (st === 'ambiguo') return '<span class="tag tag-yellow">Ambíguo (2+ tokens)</span>';
  return '<span class="tag tag-gray">Não encontrado</span>';
}

async function openMilvusTokenBackfillModal() {
  openModal('🔑 Preencher tokens do Milvus', `
    <p style="font-size:13px;color:var(--text-muted);margin:0 0 12px">Preenche o token vazio a partir da lista do Milvus (match exato, sem aproximação). Valores manuais nunca são sobrescritos; ambíguos ficam para decisão manual.</p>
    <div id="tokenBackfillBody"><p style="color:var(--text-muted);font-size:12px">Consultando tokens no Milvus…</p></div>`);
  try {
    const data = await previewMilvusTokenBackfill();
    _tokenBackfillPreview = data.preview || [];
    const t = data.totals || summarizeBackfillPreview(_tokenBackfillPreview);
    const body = document.getElementById('tokenBackfillBody');
    if (!body) return;
    if (!_tokenBackfillPreview.length) {
      body.innerHTML = '<div class="empty-state"><p>Nenhum vínculo no mapa para avaliar.</p></div>';
      return;
    }
    body.innerHTML = `
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">${t.total} vínculo(s) · <strong>${t.prontos} pronto(s)</strong> · ${t.jaPreenchidos} preenchidos · ${t.naoEncontrados} não encontrados · ${t.ambiguos} ambíguos</div>
      <div class="table-wrapper" style="max-height:320px;overflow-y:auto"><table><thead><tr><th></th><th>Nome Milvus</th><th>Token</th><th>Status</th></tr></thead><tbody>
      ${_tokenBackfillPreview.map((p, i) => `<tr>
        <td>${p.status === 'pronto' ? `<input type="checkbox" data-tb-idx="${i}" checked />` : ''}</td>
        <td><strong>${escapeHtml(p.milvusNome)}</strong></td>
        <td style="font-size:12px">${p.token ? `<code style="background:var(--bg-base);padding:2px 6px;border-radius:4px">${escapeHtml(p.token)}</code>` : '—'}</td>
        <td>${_tokenBackfillStatusTag(p.status)}</td>
      </tr>`).join('')}</tbody></table></div>
      <div class="form-actions"><button type="button" class="btn btn-secondary" onclick="closeModal()">Cancelar</button><button type="button" class="btn btn-primary" id="tokenBackfillConfirmBtn" onclick="confirmMilvusTokenBackfill()">Preencher selecionados</button></div>
      <div id="tokenBackfillMsg" style="font-size:13px;margin-top:8px"></div>`;
  } catch (e) {
    const body = document.getElementById('tokenBackfillBody');
    if (body) body.innerHTML = '<div class="empty-state"><p>Não foi possível consultar o Milvus. Tente novamente.</p></div>';
  }
}

async function confirmMilvusTokenBackfill() {
  const btn = document.getElementById('tokenBackfillConfirmBtn');
  const setMsg = (html) => { const m = document.getElementById('tokenBackfillMsg'); if (m) m.innerHTML = html; };
  const onlyNomes = [...document.querySelectorAll('[data-tb-idx]:checked')]
    .map((el) => _tokenBackfillPreview[Number(el.dataset.tbIdx)])
    .filter((p) => p && p.status === 'pronto')
    .map((p) => p.milvusNome);
  if (!onlyNomes.length) {
    setMsg('<span style="color:var(--text-muted)">Nenhum item pronto selecionado.</span>');
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Preenchendo…'; }
  try {
    const res = await commitMilvusTokenBackfill(onlyNomes);
    setMsg(`<span style="color:var(--success,#16a34a)">${res.filled} token(s) preenchido(s)${res.skipped && res.skipped.length ? ` · ${res.skipped.length} pulado(s)` : ''}.</span>`);
  } catch (e) {
    setMsg('<span style="color:var(--danger,#dc2626)">Falha ao preencher. Tente novamente.</span>');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Preencher selecionados'; }
  }
}

async function loadMapeamentoData() {
  const wrap = document.getElementById('mapTableWrap');
  const btn = document.getElementById('mapRefreshBtn');
  const stats = document.getElementById('mapStats');
  if (btn) { btn.disabled = true; btn.textContent = 'Consultando Milvus…'; }
  if (wrap) wrap.innerHTML = '<p style="color:var(--text-muted);font-size:12px;padding:8px 0">Consultando nomes no Milvus…</p>';
  try {
    const [nomes, map, clients] = await Promise.all([fetchMilvusClientNames(), loadMilvusMap(), loadMapeamentoClients()]);
    _mapApiNomes = nomes;
    _mapClients = clients;
    _mapLastMap = map;
    refreshMapeamentoRows();
  } catch (e) {
    if (wrap) wrap.innerHTML = '<div class="empty-state"><p>Não foi possível consultar os nomes do Milvus. Tente novamente.</p></div>';
    if (stats) stats.textContent = '';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Atualizar nomes do Milvus'; }
  }
}

let _mapLastMap = [];

function refreshMapeamentoRows() {
  _mapNomes = mergeMilvusNameSources(_mapApiNomes, _mapImported);
  _mapRows = buildMapeamentoRows(_mapNomes, _mapLastMap, _mapClients);
  renderMapeamentoTable();
}

function importMilvusNameList() {
  const ta = document.getElementById('mapImportText');
  const parsed = parseMilvusNameList(ta ? ta.value : '');
  if (!parsed.length) {
    if (typeof showToast === 'function') showToast('Nenhum nome válido na lista.', 'warning');
    return;
  }
  _mapImported = parsed;
  refreshMapeamentoRows();
  if (typeof showToast === 'function') showToast(`${parsed.length} nome(s) importado(s)!`, 'success');
}

function clearMilvusNameList() {
  _mapImported = [];
  const ta = document.getElementById('mapImportText');
  if (ta) ta.value = '';
  refreshMapeamentoRows();
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
  const clients = _mapClients;
  const rows = filterMapeamentoRows(_mapRows, _mapSearch, _mapFilter);
  const mapped = _mapRows.filter((r) => r.status === 'mapeado').length;
  const devs = _mapRows.reduce((s, r) => s + (r.quantidadeDispositivos || 0), 0);
  if (stats) stats.textContent = `${_mapRows.length} nome(s) no Milvus · ${mapped} mapeado(s) · ${_mapRows.length - mapped} pendente(s) · ${devs} dispositivo(s)` +
    (_mapImported.length ? ` · ${_mapImported.length} da lista importada` : '');
  if (!_mapRows.length) {
    wrap.innerHTML = '<div class="empty-state"><p>Nenhum nome carregado. Clique em “Atualizar nomes do Milvus”.</p></div>';
    return;
  }
  if (!rows.length) {
    wrap.innerHTML = '<div class="empty-state"><p>Nenhum resultado para o filtro atual.</p></div>';
    return;
  }
  const esc = typeof escapeHtml === 'function' ? escapeHtml : (s) => String(s === null || s === undefined ? '' : s);
  wrap.innerHTML = `<table><thead><tr><th>Nome no Milvus</th><th>ID</th><th>Dispositivos</th><th>Cliente do sistema</th><th>Status</th><th></th></tr></thead><tbody>${rows.map((r) => {
    const idx = _mapRows.indexOf(r);
    const opts = `<option value="">Selecionar…</option>` + clients.map((c) =>
      `<option value="${esc(c.id)}"${r.clientId === c.id ? ' selected' : ''}>${esc(c.name || c.id)}</option>`).join('');
    const qtd = (typeof r.quantidadeDispositivos === 'number') ? r.quantidadeDispositivos : '—';
    const sub = [r.cnpj ? `CNPJ ${esc(r.cnpj)}` : '', r.duplicado ? '⚠ 2+ cadastros no Milvus — confira o CNPJ' : '']
      .filter(Boolean).join(' · ');
    return `<tr><td><strong>${esc(r.nome)}</strong>${sub ? `<div style="font-size:11px;color:var(--text-muted)">${sub}</div>` : ''}</td>` +
      `<td>${r.milvusClienteId !== undefined && r.milvusClienteId !== null ? esc(String(r.milvusClienteId)) : '—'}</td>` +
      `<td>${qtd}</td>` +
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
      const c = _mapClients.find((x) => x.id === clientId);
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
    parseMilvusNameList: parseMilvusNameList,
    mergeMilvusNameSources: mergeMilvusNameSources,
    buildMapeamentoRows: buildMapeamentoRows,
    filterMapeamentoRows: filterMapeamentoRows,
    validateMapeamento: validateMapeamento,
    loadMapeamentoClients: loadMapeamentoClients,
  };
}
