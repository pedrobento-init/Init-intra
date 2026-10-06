// js/checklist.js — Aba "Checklist" do modal de cliente
// =============================================================================
// Lista simples de confirmação por cliente (3 tipos: instalação, troca de
// usuário, saída de colaborador). Sem responsável, sem observação por item,
// sem "não se aplica", sem bloqueio para concluir.
//
// Dados (padrão do projeto — ver milvus-tickets.js / saveProcedure):
// - Modelo global `checklist_modelo_itens` (seed da migration 040) e marcações
//   `checklist_marcacoes` vivem no Supabase; cache local em IndexedDB
//   (db.js v9) via getCacheStore/setCacheStore para render síncrono.
// - Escrita OTIMISTA: aplica no cache, tenta o servidor; se falhar, reverte
//   e mostra toast de erro curto. Existir a linha = marcado (desmarcar apaga).
// - Sem outbox: a outbox só drena upsert de entidades em schema.js ENTITIES,
//   então marcações seguem o caminho direto (revertidas em falha/offline).
//
// UI: renderização imperativa (innerHTML + handlers), mesmo estilo das demais
// abas do modal. CSS próprio `.ck-*` em css/styles.css (tema claro/escuro).
// =============================================================================

const CHECKLIST_TIPOS = [
  { id: 'instalacao', label: 'Instalação' },
  { id: 'troca', label: 'Troca de usuário' },
  { id: 'saida', label: 'Saída de colaborador' },
];

const CHECKLIST_STORE_MODELO = 'checklist_modelo_itens';
const CHECKLIST_STORE_MARCACOES = 'checklist_marcacoes';

// Categoria sem botão "Ver procedimento" (regra do produto).
const CHECKLIST_SEM_PROC = 'Geral';

// Fallback offline/seed ausente — espelha o seed da migration 040_checklist.sql
// (mantenha os dois em sincronia). Usado somente quando o servidor não traz
// linhas para o tipo (primeiro boot, sem conexão ou migração ainda não rodada).
const CHECKLIST_MODELO_DEFAULT = [
  // Instalação (14)
  { id: 'inst-01', tipo: 'instalacao', categoria: 'Estações', texto: 'Instalar atualizações do Windows', ordem: 1, ativo: true },
  { id: 'inst-02', tipo: 'instalacao', categoria: 'Estações', texto: 'Definir nome padrão da máquina', ordem: 2, ativo: true },
  { id: 'inst-03', tipo: 'instalacao', categoria: 'Estações', texto: 'Instalar e ativar antivírus', ordem: 3, ativo: true },
  { id: 'inst-04', tipo: 'instalacao', categoria: 'Estações', texto: 'Configurar AnyDesk e anotar ID na Ficha TI', ordem: 4, ativo: true },
  { id: 'inst-05', tipo: 'instalacao', categoria: 'Estações', texto: 'Ativar backup', ordem: 5, ativo: true },
  { id: 'inst-06', tipo: 'instalacao', categoria: 'Servidor(es)', texto: 'Ingressar na rede/domínio', ordem: 6, ativo: true },
  { id: 'inst-07', tipo: 'instalacao', categoria: 'Servidor(es)', texto: 'Criar usuário', ordem: 7, ativo: true },
  { id: 'inst-08', tipo: 'instalacao', categoria: 'Servidor(es)', texto: 'Mapear pastas de rede', ordem: 8, ativo: true },
  { id: 'inst-09', tipo: 'instalacao', categoria: 'E-mails', texto: 'Configurar e-mail', ordem: 9, ativo: true },
  { id: 'inst-10', tipo: 'instalacao', categoria: 'Impressora', texto: 'Configurar impressoras', ordem: 10, ativo: true },
  { id: 'inst-11', tipo: 'instalacao', categoria: 'Sistemas', texto: 'Instalar sistemas do cliente', ordem: 11, ativo: true },
  { id: 'inst-12', tipo: 'instalacao', categoria: 'Sistemas', texto: 'Testar acesso aos sistemas', ordem: 12, ativo: true },
  { id: 'inst-13', tipo: 'instalacao', categoria: 'Geral', texto: 'Atualizar inventário', ordem: 13, ativo: true },
  { id: 'inst-14', tipo: 'instalacao', categoria: 'Geral', texto: 'Testar com o usuário', ordem: 14, ativo: true },
  // Troca de usuário (9)
  { id: 'troca-01', tipo: 'troca', categoria: 'Servidor(es)', texto: 'Criar usuário e definir permissões', ordem: 1, ativo: true },
  { id: 'troca-02', tipo: 'troca', categoria: 'Servidor(es)', texto: 'Redefinir senhas e acessos', ordem: 2, ativo: true },
  { id: 'troca-03', tipo: 'troca', categoria: 'Servidor(es)', texto: 'Revisar permissões de pastas', ordem: 3, ativo: true },
  { id: 'troca-04', tipo: 'troca', categoria: 'Servidor(es)', texto: 'Migrar ou arquivar arquivos do usuário anterior', ordem: 4, ativo: true },
  { id: 'troca-05', tipo: 'troca', categoria: 'E-mails', texto: 'Atualizar e-mail e assinatura', ordem: 5, ativo: true },
  { id: 'troca-06', tipo: 'troca', categoria: 'Sistemas', texto: 'Transferir licenças e acessos dos sistemas', ordem: 6, ativo: true },
  { id: 'troca-07', tipo: 'troca', categoria: 'Geral', texto: 'Identificar quem sai e quem entra', ordem: 7, ativo: true },
  { id: 'troca-08', tipo: 'troca', categoria: 'Geral', texto: 'Atualizar inventário', ordem: 8, ativo: true },
  { id: 'troca-09', tipo: 'troca', categoria: 'Geral', texto: 'Validar com o gestor', ordem: 9, ativo: true },
  // Saída de colaborador (14)
  { id: 'saida-01', tipo: 'saida', categoria: 'Servidor(es)', texto: 'Desativar usuário e senha', ordem: 1, ativo: true },
  { id: 'saida-02', tipo: 'saida', categoria: 'Servidor(es)', texto: 'Encerrar sessões abertas', ordem: 2, ativo: true },
  { id: 'saida-03', tipo: 'saida', categoria: 'Servidor(es)', texto: 'Fazer backup do perfil', ordem: 3, ativo: true },
  { id: 'saida-04', tipo: 'saida', categoria: 'Servidor(es)', texto: 'Definir quem herda arquivos e pastas', ordem: 4, ativo: true },
  { id: 'saida-05', tipo: 'saida', categoria: 'E-mails', texto: 'Remover do e-mail e WhatsApp corporativo', ordem: 5, ativo: true },
  { id: 'saida-06', tipo: 'saida', categoria: 'E-mails', texto: 'Fazer backup do e-mail', ordem: 6, ativo: true },
  { id: 'saida-07', tipo: 'saida', categoria: 'E-mails', texto: 'Redirecionar e-mail para o gestor', ordem: 7, ativo: true },
  { id: 'saida-08', tipo: 'saida', categoria: 'Firewall', texto: 'Revogar acesso remoto (VPN, AnyDesk, painéis)', ordem: 8, ativo: true },
  { id: 'saida-09', tipo: 'saida', categoria: 'Sistemas', texto: 'Remover de sistemas e licenças', ordem: 9, ativo: true },
  { id: 'saida-10', tipo: 'saida', categoria: 'Sistemas', texto: 'Trocar senhas compartilhadas que ele conhecia', ordem: 10, ativo: true },
  { id: 'saida-11', tipo: 'saida', categoria: 'Estações', texto: 'Receber o equipamento', ordem: 11, ativo: true },
  { id: 'saida-12', tipo: 'saida', categoria: 'Estações', texto: 'Formatar ou reatribuir', ordem: 12, ativo: true },
  { id: 'saida-13', tipo: 'saida', categoria: 'Geral', texto: 'Atualizar inventário', ordem: 13, ativo: true },
  { id: 'saida-14', tipo: 'saida', categoria: 'Geral', texto: 'Gestor confirmou a conclusão', ordem: 14, ativo: true },
];

// ── Funções puras (testadas em tests/checklist.test.js) ──────────────────────

// Comparação de categoria ignora caixa/espaços (a aba Procedimentos guarda a
// categoria como texto livre).
function checklistNormCat(v) {
  return String(v == null ? '' : v).trim().toLowerCase();
}

// Itens ativos agrupados por categoria, NA ORDEM do modelo (1ª ocorrência).
function groupChecklistItens(itens) {
  const groups = [];
  const byCat = new Map();
  (Array.isArray(itens) ? itens : []).forEach(it => {
    if (!it || it.ativo === false) return;
    const key = String(it.categoria || 'Geral');
    let g = byCat.get(key);
    if (!g) { g = { categoria: key, itens: [] }; byCat.set(key, g); groups.push(g); }
    g.itens.push(it);
  });
  groups.forEach(g => g.itens.sort((a, b) => (a.ordem || 0) - (b.ordem || 0)));
  return groups;
}

// Progresso do tipo atual: itens desmarcados não entram; item inativo some.
function checklistProgress(grupos, marcadoSet) {
  const set = marcadoSet instanceof Set ? marcadoSet : new Set(marcadoSet || []);
  let done = 0, total = 0;
  (grupos || []).forEach(g => (g.itens || []).forEach(it => {
    total++;
    if (set.has(it.id)) done++;
  }));
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

// Procedimentos do cliente cuja categoria casa com a do grupo.
function findProceduresByCategoria(procedures, categoria) {
  const alvo = checklistNormCat(categoria);
  if (!alvo) return [];
  return (Array.isArray(procedures) ? procedures : [])
    .filter(p => p && checklistNormCat(p.category) === alvo);
}

function checklistTipoLabel(tipo) {
  const t = (CHECKLIST_TIPOS || []).find(x => x.id === tipo);
  return t ? t.label : tipo;
}

function checklistTipoDeItem(itemId, modelo) {
  const src = Array.isArray(modelo) && modelo.length ? modelo : CHECKLIST_MODELO_DEFAULT;
  const found = src.find(i => i && i.id === itemId);
  return found ? found.tipo : '';
}

// ── Cache local ───────────────────────────────────────────────────────────────

function _ckCache(store) {
  try {
    if (typeof getCacheStore === 'function') return getCacheStore(store) || [];
  } catch (_) {}
  return [];
}

function _ckSetCache(store, rows) {
  try {
    if (typeof setCacheStore === 'function') { setCacheStore(store, rows); return true; }
  } catch (_) {}
  return false;
}

function _ckSupabaseReady() {
  try {
    return typeof isSupabaseConnected === 'function' && isSupabaseConnected()
      && typeof supabaseClient !== 'undefined' && supabaseClient
      && typeof window !== 'undefined' && window._supabaseAuthActive === true;
  } catch (_) { return false; }
}

function _ckToast(msg, type) {
  try { if (typeof showToast === 'function') showToast(msg, type || 'error'); } catch (_) {}
}

// ── Leituras ─────────────────────────────────────────────────────────────────

// Itens ATIVOS de um tipo, na ordem do modelo. Se o servidor/local não tiver
// linhas para o tipo, cai no modelo built-in (offline / seed pendente).
function getChecklistItens(tipo) {
  const cached = _ckCache(CHECKLIST_STORE_MODELO).filter(i => i && i.tipo === tipo);
  const src = cached.length ? cached : CHECKLIST_MODELO_DEFAULT.filter(i => i.tipo === tipo);
  return src
    .filter(i => i && i.ativo !== false)
    .slice()
    .sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
}

// Pull do modelo (1× por sessão) — traz itens novos/desativados do servidor.
let _ckModeloLoaded = false;
async function loadChecklistModelo() {
  if (_ckModeloLoaded) return true;
  try {
    if (_ckSupabaseReady()) {
      const res = await supabaseClient
        .from('checklist_modelo_itens')
        .select('*')
        .order('ordem', { ascending: true });
      if (res && !res.error && Array.isArray(res.data) && res.data.length) {
        _ckSetCache(CHECKLIST_STORE_MODELO, res.data);
        _ckModeloLoaded = true;
        return true;
      }
      if (res && !res.error && Array.isArray(res.data)) { _ckModeloLoaded = true; return true; }
    }
  } catch (_) {}
  return false;
}

// Marcações locais de um cliente (linhas = itens marcados).
function getChecklistMarcacoes(clientId) {
  return _ckCache(CHECKLIST_STORE_MARCACOES).filter(m => m && m.clientId === clientId);
}

function checklistMarcadoSet(clientId) {
  return new Set(getChecklistMarcacoes(clientId).map(m => m.itemId));
}

function _ckSetMarcacoesLocal(clientId, rows) {
  const others = _ckCache(CHECKLIST_STORE_MARCACOES).filter(m => m && m.clientId !== clientId);
  _ckSetCache(CHECKLIST_STORE_MARCACOES, others.concat(rows));
}

// Pull das marcações do cliente (troca de aba/dispositivo pega o estado novo).
let _ckSaving = 0;
let _ckPendingReload = false;
async function loadChecklistMarcacoes(clientId) {
  if (!clientId) return false;
  if (_ckSaving > 0) { _ckPendingReload = true; return false; }
  try {
    if (_ckSupabaseReady()) {
      const res = await supabaseClient
        .from('checklist_marcacoes')
        .select('*')
        .eq('client_id', clientId);
      if (res && !res.error && Array.isArray(res.data)) {
        if (_ckSaving > 0) { _ckPendingReload = true; return false; }
        _ckSetMarcacoesLocal(clientId, res.data);
        return true;
      }
      if (res && res.error) console.warn('⚠️ Checklist marcações:', res.error.message);
    }
  } catch (_) {}
  return false;
}

// ── Escritas (otimistas, com rollback) ────────────────────────────────────────

// Marca (marcado=true) ou desmarca (false). Linha existe = marcado.
// Sucesso → true; falha → rollback local + toast e false.
async function saveChecklistMarcacao(clientId, itemId, marcado) {
  if (!clientId || !itemId) return false;
  const snapshot = getChecklistMarcacoes(clientId).map(m => ({ ...m }));
  const next = snapshot.filter(m => m.itemId !== itemId);

  if (marcado) {
    const client = typeof getClientById === 'function' ? getClientById(clientId) : null;
    next.push({
      id: clientId + '::' + itemId,
      clientId,
      itemId,
      team: (client && client.team) || 'init',
      marcadoPor: (typeof getSession === 'function' && getSession()) ? getSession().name : '',
      marcadoEm: new Date().toISOString(),
    });
  }
  _ckSetMarcacoesLocal(clientId, next);

  if (!_ckSupabaseReady()) {
    _ckSetMarcacoesLocal(clientId, snapshot);
    _ckToast('Sem conexão — alteração não salva.', 'error');
    return false;
  }

  _ckSaving++;
  try {
    let error = null;
    if (marcado) {
      const row = next.find(m => m.itemId === itemId);
      const res = await supabaseClient.from('checklist_marcacoes').upsert({
        id: row.id,
        client_id: clientId,
        item_id: itemId,
        team: row.team || 'init',
        marcado_por: row.marcadoPor || '',
        marcado_em: row.marcadoEm,
      });
      error = res && res.error;
    } else {
      const res = await supabaseClient
        .from('checklist_marcacoes')
        .delete()
        .eq('client_id', clientId)
        .eq('item_id', itemId);
      error = res && res.error;
    }
    if (error) throw new Error(error.message || String(error));
    return true;
  } catch (err) {
    _ckSetMarcacoesLocal(clientId, snapshot);
    _ckToast('Não foi possível salvar: ' + (err && err.message ? err.message : err), 'error');
    return false;
  } finally {
    _ckSaving--;
    if (_ckSaving === 0 && _ckPendingReload) {
      _ckPendingReload = false;
      try { await loadChecklistMarcacoes(clientId); } catch (_) {}
    }
  }
}

// Desmarca tudo do tipo atual do cliente (só aquele tipo).
async function limparChecklist(clientId, tipo) {
  if (!clientId) return false;
  const snapshot = getChecklistMarcacoes(clientId).map(m => ({ ...m }));
  const ids = new Set(getChecklistItens(tipo).map(i => i.id));
  // Itens do tipo mesmo desativados (sumiram da tela, mas podem ter marcação)
  CHECKLIST_MODELO_DEFAULT.forEach(i => { if (i.tipo === tipo) ids.add(i.id); });
  _ckCache(CHECKLIST_STORE_MODELO).forEach(i => { if (i && i.tipo === tipo) ids.add(i.id); });

  const alvo = snapshot.filter(m => ids.has(m.itemId));
  if (!alvo.length) return true;
  _ckSetMarcacoesLocal(clientId, snapshot.filter(m => !ids.has(m.itemId)));

  if (!_ckSupabaseReady()) {
    _ckSetMarcacoesLocal(clientId, snapshot);
    _ckToast('Sem conexão — alteração não salva.', 'error');
    return false;
  }

  _ckSaving++;
  try {
    const res = await supabaseClient
      .from('checklist_marcacoes')
      .delete()
      .eq('client_id', clientId)
      .in('item_id', Array.from(ids));
    if (res && res.error) throw new Error(res.error.message || String(res.error));
    return true;
  } catch (err) {
    _ckSetMarcacoesLocal(clientId, snapshot);
    _ckToast('Não foi possível limpar: ' + (err && err.message ? err.message : err), 'error');
    return false;
  } finally {
    _ckSaving--;
    if (_ckSaving === 0 && _ckPendingReload) {
      _ckPendingReload = false;
      try { await loadChecklistMarcacoes(clientId); } catch (_) {}
    }
  }
}

// ── Estado da aba (em sessão: tipo atual por cliente) ─────────────────────────

const _ckTipoByClient = {};

function checklistTipoAtual(clientId) {
  return _ckTipoByClient[clientId] || 'instalacao';
}

function setChecklistTipo(clientId, tipo) {
  if (!CHECKLIST_TIPOS.some(t => t.id === tipo)) return;
  _ckTipoByClient[clientId] = tipo;
  renderClientChecklistTab(clientId);
  // Devolve o foco ao botão de tipo (o render reconstrói o DOM).
  try {
    const btn = document.querySelector('.ck-seg-btn[data-ck-tipo="' + tipo + '"]');
    if (btn) btn.focus();
  } catch (_) {}
}

function _ckCompute(clientId, tipo) {
  const grupos = groupChecklistItens(getChecklistItens(tipo));
  const marcado = checklistMarcadoSet(clientId);
  const stats = checklistProgress(grupos, marcado);
  return { grupos, marcado, ...stats };
}

// Repinta só o que muda ao marcar/desmarcar (contadores, barra e aviso),
// preservando foco/scroll da lista.
function ckRefreshStats(clientId, tipo) {
  const root = document.getElementById('clientTabContent');
  if (!root) return;
  const { grupos, marcado, done, total, pct } = _ckCompute(clientId, tipo);

  grupos.forEach(g => {
    const elCount = root.querySelector('[data-ck-count="' + g.categoria.replace(/"/g, '') + '"]');
    if (elCount) {
      const d = g.itens.filter(it => marcado.has(it.id)).length;
      elCount.textContent = d + '/' + g.itens.length;
    }
  });

  const txt = root.querySelector('#ckProgText');
  if (txt) txt.textContent = done + ' de ' + total + ' itens';
  const pctEl = root.querySelector('#ckProgPct');
  if (pctEl) pctEl.textContent = pct + '%';
  const fill = root.querySelector('#ckProgFill');
  if (fill) {
    fill.style.width = pct + '%';
    fill.classList.toggle('is-done', pct === 100);
  }
  const ok = root.querySelector('#ckOk');
  if (ok) ok.classList.toggle('is-on', total > 0 && pct === 100);
}

function _ckIsChecklistTabActive() {
  try {
    const active = document.querySelector('#clientTabs .tab.active');
    const oc = active ? (active.getAttribute('onclick') || '') : '';
    return /switchClientTab\('checklist'/.test(oc);
  } catch (_) { return false; }
}

// Assinatura do estado visível (itens + quais estão marcados) para decidir
// se o pull do servidor exige repintar a aba.
function _ckSignature(clientId, tipo) {
  const { grupos, marcado } = _ckCompute(clientId, tipo);
  return JSON.stringify([
    grupos.map(g => [g.categoria, g.itens.map(i => i.id)]),
    Array.from(marcado).sort(),
  ]);
}

// Pull em segundo plano; só repinta se a aba continuar aberta no mesmo tipo
// e o estado (marcas) tiver mudado — evita perder foco/scroll sem motivo.
async function _ckBackgroundLoad(clientId, tipo) {
  try {
    const before = _ckSignature(clientId, tipo);
    await loadChecklistModelo();
    await loadChecklistMarcacoes(clientId);
    if (checklistTipoAtual(clientId) !== tipo) return;
    if (!_ckIsChecklistTabActive()) return;
    if (_ckSignature(clientId, tipo) !== before) renderClientChecklistTab(clientId);
  } catch (_) { /* pull é best-effort: a aba já mostrou o estado local */ }
}

// ── Render ───────────────────────────────────────────────────────────────────

function renderClientChecklistTab(clientId) {
  const el = document.getElementById('clientTabContent');
  if (!el) return;
  const tipo = checklistTipoAtual(clientId);
  const cid = String(clientId == null ? '' : clientId).replace(/'/g, "\\'");
  const { grupos, marcado, done, total, pct } = _ckCompute(clientId, tipo);
  const procs = typeof getProcedures === 'function' ? getProcedures(clientId) : [];

  const segBtns = CHECKLIST_TIPOS.map(t => `
    <button type="button" class="ck-seg-btn${t.id === tipo ? ' is-on' : ''}" data-ck-tipo="${t.id}"
      aria-pressed="${t.id === tipo}" onclick="setChecklistTipo('${cid}','${t.id}')">${escapeHtml(t.label)}</button>`).join('');

  const groupsHtml = grupos.map(g => {
    const d = g.itens.filter(it => marcado.has(it.id)).length;
    const temProc = g.categoria !== CHECKLIST_SEM_PROC
      && findProceduresByCategoria(procs, g.categoria).length > 0;
    const rows = g.itens.map(it => {
      const on = marcado.has(it.id);
      return `<label class="ck-item${on ? ' is-done' : ''}" data-ck-row="${escapeHtml(it.id)}">
        <input type="checkbox" class="ck-box" data-ck-item="${escapeHtml(it.id)}"${on ? ' checked' : ''}
          aria-label="${escapeHtml(it.texto)}" />
        <span class="ck-text">${escapeHtml(it.texto)}</span>
      </label>`;
    }).join('');
    return `<section class="ck-group">
      <header class="ck-group-head">
        <h3 class="ck-group-title">${escapeHtml(g.categoria)}</h3>
        <span class="ck-count" data-ck-count="${escapeHtml(g.categoria)}">${d}/${g.itens.length}</span>
        <span class="ck-sp"></span>
        ${temProc ? `<button type="button" class="ck-proc-btn" onclick="openChecklistProc('${cid}','${escapeHtml(g.categoria).replace(/'/g, "\\'")}')">Ver procedimento</button>` : ''}
      </header>
      <div class="ck-list">${rows}</div>
    </section>`;
  }).join('');

  el.innerHTML = `
    <div class="ck-seg" role="group" aria-label="Tipo de checklist">${segBtns}</div>
    <div class="ck-prog">
      <div class="ck-prog-main">
        <div class="ck-prog-top"><span id="ckProgText">${done} de ${total} itens</span><b id="ckProgPct">${pct}%</b></div>
        <div class="ck-track"><i id="ckProgFill" class="${pct === 100 ? 'is-done' : ''}" style="width:${pct}%"></i></div>
      </div>
      <button type="button" class="btn btn-secondary btn-sm" onclick="clearChecklistConfirm('${cid}')">Desmarcar tudo</button>
    </div>
    <div class="ck-ok${total > 0 && pct === 100 ? ' is-on' : ''}" id="ckOk" role="status">Tudo confirmado. Nada pendente neste checklist.</div>
    <div class="ck-groups">${groupsHtml || '<div class="empty-state"><p>Nenhum item neste checklist.</p></div>'}</div>
    <p class="ck-hint">O estado fica salvo por cliente e por tipo — marque conforme for concluindo.</p>`;

  el.querySelectorAll('[data-ck-item]').forEach(cb => {
    cb.addEventListener('change', () => ckOnToggle(clientId, tipo, cb));
  });

  _ckBackgroundLoad(clientId, tipo);
}

function ckOnToggle(clientId, tipo, cb) {
  const itemId = cb.getAttribute('data-ck-item');
  const marcado = cb.checked;
  const row = cb.closest ? cb.closest('.ck-item') : null;
  if (row) row.classList.toggle('is-done', marcado);
  ckRefreshStats(clientId, tipo);

  cb.disabled = true;
  Promise.resolve(saveChecklistMarcacao(clientId, itemId, marcado)).then(ok => {
    cb.disabled = false;
    if (ok) return;
    // Rollback visual (o snapshot local já foi restaurado pela escrita).
    cb.checked = !marcado;
    if (row) row.classList.toggle('is-done', !marcado);
    ckRefreshStats(clientId, tipo);
  }).catch(() => {
    cb.disabled = false;
    cb.checked = !marcado;
    if (row) row.classList.toggle('is-done', !marcado);
    ckRefreshStats(clientId, tipo);
  });
}

// "Desmarcar tudo": confirmação simples (confirmAction) e reabre a aba.
function clearChecklistConfirm(clientId) {
  const tipo = checklistTipoAtual(clientId);
  const n = getChecklistItens(tipo).length;
  if (!n) return;
  confirmAction('Desmarcar todos os itens de <strong>' + escapeHtml(checklistTipoLabel(tipo))
    + '</strong>? Os ' + n + ' itens voltam a ficar pendentes.', async () => {
      await limparChecklist(clientId, tipo);
      try {
        if (typeof viewClient === 'function') viewClient(clientId);
        if (typeof switchClientTab === 'function') switchClientTab('checklist', clientId);
      } catch (_) {}
    });
}

// ── Modal "Ver procedimento" (overlay próprio: o openModal é único e abrir
//    outro destruiria o modal do cliente) ─────────────────────────────────────

function _ckProcOverlay() {
  try { return document.getElementById('ckProcOverlay'); } catch (_) { return null; }
}

function openChecklistProc(clientId, categoria) {
  const ov = _ckProcOverlay();
  if (!ov) return;
  const procs = typeof getProcedures === 'function' ? findProceduresByCategoria(getProcedures(clientId), categoria) : [];
  const comTexto = procs.filter(p => String(p.content || '').trim());
  const title = document.getElementById('ckProcTitle');
  const body = document.getElementById('ckProcBody');
  if (title) title.textContent = categoria;

  let html = '';
  if (!comTexto.length) {
    html = `<p class="ck-proc-empty">Nenhuma instrução cadastrada para ${escapeHtml(categoria)} neste cliente. Cadastre na aba Procedimentos.</p>`;
  } else {
    html = comTexto.map(p => {
      const head = comTexto.length > 1
        ? `<div class="ck-proc-name">${escapeHtml(p.title || 'Procedimento')}</div>` : '';
      return head + `<pre class="ck-proc-text">${escapeHtml(String(p.content || '').trim())}</pre>`;
    }).join('');
  }
  if (body) body.innerHTML = html;

  ov.style.display = 'flex';
  const closeBtn = document.getElementById('ckProcClose');
  if (closeBtn) closeBtn.focus();
}

function closeChecklistProc() {
  const ov = _ckProcOverlay();
  if (ov) ov.style.display = 'none';
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    try {
      const ov = document.getElementById('ckProcOverlay');
      if (ov) ov.addEventListener('click', e => { if (e.target === ov) closeChecklistProc(); });
      const btn = document.getElementById('ckProcClose');
      if (btn) btn.addEventListener('click', closeChecklistProc);
    } catch (_) {}
  });
}

// Export para testes (Node/Vitest). Em browser os identificadores acima ficam
// no escopo global dos scripts.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CHECKLIST_TIPOS,
    CHECKLIST_MODELO_DEFAULT,
    CHECKLIST_SEM_PROC,
    checklistNormCat,
    groupChecklistItens,
    checklistProgress,
    findProceduresByCategoria,
    checklistTipoLabel,
    checklistTipoDeItem,
  };
}
