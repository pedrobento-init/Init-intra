// js/checklist.js — Aba "Checklist" do modal de cliente
// =============================================================================
// DOIS MODOS NA MESMA ABA (estado em memória por cliente):
//
// 1) USO  — seletor com os checklists ATIVOS, barra de progresso,
//    "Desmarcar tudo", grupos por categoria e itens de confirmação.
//    Salva marcação/desmarcação de forma OTIMISTA (falhou → revert + toast).
//    Sem checklist ativo → estado vazio com "+ Novo checklist".
//
// 2) GERENCIAR (botão "Gerenciar") — modelos, valem para TODOS os clientes
//    (aviso fixo no topo). Criar/duplicar/renomear/ativar/excluir checklists
//    e editar os itens (texto, categoria, ordem por arrastar E por botões
//    ↑/↓, remover = soft delete). Salva a cada alteração, com toast.
//    Permissão padrão: SÓ ADMIN (isCurrentAdmin() no cliente + RLS
//    current_op_is_admin() no servidor) — não-admin vê tudo em leitura.
//    "Ver como técnico" volta para o modo de uso (prévia).
//
// DADOS (padrão do projeto — ver milvus-tickets.js / saveProcedure):
//   checklists            -> public.checklists      (migration 041)
//   checklist_modelo_itens-> itens (campo `tipo` = id do checklist; 040/041)
//   checklist_marcacoes   -> estado por cliente (linha existe = marcado)
// Cache local em IndexedDB (db.js v9/v10) via getCacheStore/setCacheStore.
// Escrita sempre: aplica local -> tenta servidor -> falhou desfaz + toast.
// Fora do ar/outbox: nada de fila; se não há conexão a alteração é
// revertida (não há perda silenciosa no próximo pull).
// =============================================================================

const CHECKLIST_STORE = 'checklists';
const CHECKLIST_STORE_MODELO = 'checklist_modelo_itens';
const CHECKLIST_STORE_MARCACOES = 'checklist_marcacoes';

// Categoria sem botão "Ver procedimento" (regra do produto).
const CHECKLIST_SEM_PROC = 'Geral';

// Seletor de categoria do modo Gerenciar (mesmas da aba Procedimentos).
const CHECKLIST_CATEGORIAS = ['Estações', 'Servidor(es)', 'E-mails', 'Impressora', 'Sistemas', 'Firewall', 'Geral'];

// Fallback offline / migração ainda não aplicada (espelha o seed da 041).
const CHECKLISTS_DEFAULT = [
  { id: 'instalacao', nome: 'Instalação', ativo: true, ordem: 1 },
  { id: 'troca', nome: 'Troca de usuário', ativo: true, ordem: 2 },
  { id: 'saida', nome: 'Saída de colaborador', ativo: true, ordem: 3 },
];

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

// Itens ativos agrupados por categoria, NA ORDEM do modelo (a categoria do
// menor `ordem` abre o grupo; dentro do grupo ordena por `ordem`).
function groupChecklistItens(itens) {
  const groups = [];
  const byCat = new Map();
  (Array.isArray(itens) ? itens : [])
    .map((it, idx) => ({ it, idx }))
    .sort((x, y) => ((x.it && x.it.ordem) || 0) - ((y.it && y.it.ordem) || 0) || x.idx - y.idx)
    .forEach(({ it }) => {
      if (!it || it.ativo === false) return;
      const key = String(it.categoria || 'Geral');
      let g = byCat.get(key);
      if (!g) { g = { categoria: key, itens: [] }; byCat.set(key, g); groups.push(g); }
      g.itens.push(it);
    });
  return groups;
}

// Progresso do checklist: itens desmarcados não entram; item inativo some.
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

// Lista de checklists na ordem de exibição (ordem, depois nome).
function orderChecklists(list) {
  return (Array.isArray(list) ? list : [])
    .filter(c => c && c.id)
    .slice()
    .sort((a, b) => (a.ordem || 0) - (b.ordem || 0)
      || String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
}

// Concatena os grupos na ordem de exibição.
function groupsToFlat(groups) {
  return (Array.isArray(groups) ? groups : []).reduce((acc, g) => acc.concat(g.itens || []), []);
}

// Atribui `ordem` 1..n seguindo a ordem de exibição dos grupos.
function renumberGroups(groups) {
  let n = 0;
  return groupsToFlat(groups).map(it => ({ ...it, ordem: ++n }));
}

function _cloneGroups(groups) {
  return (Array.isArray(groups) ? groups : [])
    .map(g => ({ categoria: g.categoria, itens: (g.itens || []).map(i => ({ ...i })) }));
}

// Sobe/desce um item DENTRO da própria categoria (null quando não dá).
function moveItemDir(groups, id, dir) {
  const g = _cloneGroups(groups);
  const step = Number(dir) < 0 ? -1 : 1;
  for (const grp of g) {
    const i = grp.itens.findIndex(x => x.id === id);
    if (i < 0) continue;
    const j = i + step;
    if (j < 0 || j >= grp.itens.length) return null;
    const tmp = grp.itens[i];
    grp.itens[i] = grp.itens[j];
    grp.itens[j] = tmp;
    return g;
  }
  return null;
}

// Move `fromId` para ANTES de `beforeId` na categoria `toCategoria`
// (beforeId null = final). Aceita mover entre categorias (o item muda
// de categoria junto) — usado pelo arrastar-e-soltar.
function moveItemBefore(groups, fromId, toCategoria, beforeId) {
  if (!fromId || fromId === beforeId) return null;
  const g = _cloneGroups(groups);
  let moved = null;
  for (const grp of g) {
    const i = grp.itens.findIndex(x => x.id === fromId);
    if (i >= 0) { moved = grp.itens.splice(i, 1)[0]; break; }
  }
  if (!moved) return null;

  let alvo = g.find(x => checklistNormCat(x.categoria) === checklistNormCat(toCategoria));
  const catNome = alvo ? alvo.categoria : String(toCategoria || CHECKLIST_SEM_PROC);
  if (!alvo) { alvo = { categoria: catNome, itens: [] }; g.push(alvo); }

  const pos = beforeId ? alvo.itens.findIndex(x => x.id === beforeId) : -1;
  if (pos >= 0) alvo.itens.splice(pos, 0, moved);
  else alvo.itens.push(moved);
  moved.categoria = catNome;

  // grupos que ficaram vazios não devem aparecer
  return g.filter(x => x.itens.length > 0);
}

// Quantidade de itens ativos/inativos de um checklist.
function countItemsByChecklist(items, checklistId) {
  let ativos = 0, inativos = 0;
  (Array.isArray(items) ? items : []).forEach(i => {
    if (!i || i.tipo !== checklistId) return;
    if (i.ativo === false) inativos++; else ativos++;
  });
  return { ativos, inativos };
}

function checklistCategoriaOptions(atual) {
  const cats = CHECKLIST_CATEGORIAS.slice();
  const cur = String(atual == null ? '' : atual);
  if (cur && !cats.some(c => checklistNormCat(c) === checklistNormCat(cur))) cats.unshift(cur);
  return cats;
}

// ── Infra de cache/conexão ───────────────────────────────────────────────────

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

function _ckSnapshot(store) {
  return _ckCache(store).map(x => ({ ...x }));
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

function _ckNewId(prefix) {
  try { if (typeof nextId === 'function') return nextId(prefix); } catch (_) {}
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function ckIsAdmin() {
  try { return typeof isCurrentAdmin === 'function' && isCurrentAdmin() === true; } catch (_) { return false; }
}

// Escreve local -> servidor; servidor falhou/offline -> desfaz + toast.
// apply() muta o cache, revert() restaura o snapshot, remote() pode lançar.
async function _ckPersist(apply, revert, remote, failMsg) {
  apply();
  if (!_ckSupabaseReady()) {
    revert();
    _ckToast('Sem conexão — alteração não salva.');
    return false;
  }
  _ckSaving++;
  try {
    const res = await remote();
    if (res && res.error) throw new Error(res.error.message || String(res.error));
    return true;
  } catch (err) {
    revert();
    _ckToast((failMsg || 'Não foi possível salvar') + ': ' + (err && err.message ? err.message : err));
    return false;
  } finally {
    _ckSaving--;
    if (_ckSaving === 0 && _ckPendingReload) {
      _ckPendingReload = false;
      const alvo = _ckReloadFor;
      _ckReloadFor = null;
      if (alvo) { try { await loadChecklistMarcacoes(alvo); } catch (_) {} }
    }
  }
}

// ── Leituras ─────────────────────────────────────────────────────────────────

// Estamos no modo fallback (migração 040/041 não aplicada / offline puro)?
function _ckUsingDefaults() {
  return _ckCache(CHECKLIST_STORE).length === 0;
}

// Todos os checklists (ativos e inativos), na ordem de exibição.
function getChecklists() {
  const cached = _ckCache(CHECKLIST_STORE);
  if (cached.length) return orderChecklists(cached);
  return orderChecklists(CHECKLISTS_DEFAULT);
}

function getActiveChecklists() {
  return getChecklists().filter(c => c.ativo !== false);
}

function getChecklistById(id) {
  return getChecklists().find(c => c.id === id) || null;
}

function getChecklistNome(id) {
  const c = getChecklistById(id);
  return c ? c.nome : id;
}

// Itens ATIVOS de um checklist, na ordem do modelo.
function getChecklistItens(tipo) {
  const cached = _ckCache(CHECKLIST_STORE_MODELO).filter(i => i && i.tipo === tipo);
  if (cached.length) {
    return cached.filter(i => i.ativo !== false)
      .slice().sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
  }
  if (_ckUsingDefaults()) {
    return CHECKLIST_MODELO_DEFAULT.filter(i => i.tipo === tipo && i.ativo !== false)
      .slice().sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
  }
  return [];
}

// Todos os itens (inclusive inativos) — usado pelo modo Gerenciar.
function getChecklistItensAll(tipo) {
  const cached = _ckCache(CHECKLIST_STORE_MODELO).filter(i => i && i.tipo === tipo);
  if (cached.length) return cached.slice().sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
  if (_ckUsingDefaults()) {
    return CHECKLIST_MODELO_DEFAULT.filter(i => i.tipo === tipo)
      .slice().sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
  }
  return [];
}

// Pull do modelo (1× por sessão).
let _ckModeloLoaded = false;
async function loadChecklistModelo() {
  if (_ckModeloLoaded) return true;
  try {
    if (_ckSupabaseReady()) {
      const res = await supabaseClient
        .from('checklist_modelo_itens')
        .select('*')
        .order('ordem', { ascending: true });
      if (res && !res.error && Array.isArray(res.data)) {
        _ckSetCache(CHECKLIST_STORE_MODELO, res.data);
        _ckModeloLoaded = true;
        return true;
      }
      if (res && res.error) console.warn('⚠️ Checklist itens:', res.error.message);
    }
  } catch (_) {}
  return false;
}

// Pull dos checklists (1× por sessão; pode ser forçado).
async function loadChecklists(force) {
  if (_ckChecklistsLoaded && !force) return true;
  try {
    if (_ckSupabaseReady()) {
      const res = await supabaseClient.from('checklists').select('*').order('ordem', { ascending: true });
      if (res && !res.error && Array.isArray(res.data)) {
        _ckSetCache(CHECKLIST_STORE, res.data);
        _ckChecklistsLoaded = true;
        return true;
      }
      if (res && res.error) console.warn('⚠️ Checklists:', res.error.message);
    }
  } catch (_) {}
  return false;
}
let _ckChecklistsLoaded = false;

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

let _ckSaving = 0;
let _ckPendingReload = false;
let _ckReloadFor = null;

// Pull das marcações do cliente (troca de aba/dispositivo pega o estado novo).
async function loadChecklistMarcacoes(clientId) {
  if (!clientId) return false;
  if (_ckSaving > 0) { _ckPendingReload = true; _ckReloadFor = clientId; return false; }
  try {
    if (_ckSupabaseReady()) {
      const res = await supabaseClient
        .from('checklist_marcacoes')
        .select('*')
        .eq('client_id', clientId);
      if (res && !res.error && Array.isArray(res.data)) {
        if (_ckSaving > 0) { _ckPendingReload = true; _ckReloadFor = clientId; return false; }
        _ckSetMarcacoesLocal(clientId, res.data);
        return true;
      }
      if (res && res.error) console.warn('⚠️ Checklist marcações:', res.error.message);
    }
  } catch (_) {}
  return false;
}

// Marcações de TODOS os clientes (modo Gerenciar: quantos clientes já
// marcaram um item / um checklist). null = ainda não carregou/falhou.
let _ckAllMarks = null;
async function loadAllChecklistMarcacoes() {
  try {
    if (!_ckSupabaseReady()) return false;
    const res = await supabaseClient.from('checklist_marcacoes').select('item_id, client_id');
    if (res && !res.error && Array.isArray(res.data)) {
      _ckAllMarks = res.data.map(r => ({ itemId: r.item_id, clientId: r.client_id }));
      return true;
    }
  } catch (_) {}
  return false;
}

// Clientes distintos que marcaram um item (null = desconhecido).
function ckMarcacoesDoItem(itemId) {
  if (!_ckAllMarks) return null;
  return new Set(_ckAllMarks.filter(m => m.itemId === itemId).map(m => m.clientId)).size;
}

// Clientes distintos que marcaram QUALQUER item do checklist (null = desconhecido).
function ckMarcacoesDoChecklist(checklistId) {
  if (!_ckAllMarks) return null;
  const ids = new Set(getChecklistItensAll(checklistId).map(i => i.id));
  return new Set(_ckAllMarks.filter(m => ids.has(m.itemId)).map(m => m.clientId)).size;
}

// ── Escritas ─────────────────────────────────────────────────────────────────

// Marca/desmarca um item. Linha existe = marcado.
async function saveChecklistMarcacao(clientId, itemId, marcado) {
  if (!clientId || !itemId) return false;
  const snap = getChecklistMarcacoes(clientId).map(m => ({ ...m }));
  const local = snap.filter(m => m.itemId !== itemId);
  if (marcado) {
    const cliente = typeof getClientById === 'function' ? getClientById(clientId) : null;
    const sess = typeof getSession === 'function' ? getSession() : null;
    local.push({
      id: clientId + '::' + itemId,
      clientId,
      itemId,
      team: (cliente && cliente.team) || 'init',
      marcadoPor: sess ? sess.name : '',
      marcadoEm: new Date().toISOString(),
    });
  }
  return _ckPersist(
    () => _ckSetMarcacoesLocal(clientId, local),
    () => _ckSetMarcacoesLocal(clientId, snap),
    async () => {
      if (marcado) {
        const row = local.find(m => m.itemId === itemId);
        return supabaseClient.from('checklist_marcacoes').upsert({
          id: row.id,
          client_id: clientId,
          item_id: itemId,
          team: row.team || 'init',
          marcado_por: row.marcadoPor || '',
          marcado_em: row.marcadoEm,
        });
      }
      return supabaseClient.from('checklist_marcacoes').delete()
        .eq('client_id', clientId).eq('item_id', itemId);
    },
    'Não foi possível salvar'
  );
}

// Desmarca tudo do checklist atual do cliente.
async function limparChecklist(clientId, checklistId) {
  if (!clientId || !checklistId) return false;
  const snap = _ckSnapshot(CHECKLIST_STORE_MARCACOES);
  const ids = new Set(getChecklistItensAll(checklistId).map(i => i.id));
  if (!_ckUsingDefaults()) {
    _ckCache(CHECKLIST_STORE_MODELO).forEach(i => { if (i && i.tipo === checklistId) ids.add(i.id); });
  } else {
    CHECKLIST_MODELO_DEFAULT.forEach(i => { if (i.tipo === checklistId) ids.add(i.id); });
  }
  const alvo = snap.filter(m => m.clientId === clientId && ids.has(m.itemId));
  if (!alvo.length) return true;

  return _ckPersist(
    () => _ckSetMarcacoesLocal(clientId, snap.filter(m => !(m.clientId === clientId && ids.has(m.itemId)))),
    () => _ckSetCache(CHECKLIST_STORE_MARCACOES, snap),
    () => supabaseClient.from('checklist_marcacoes').delete()
      .eq('client_id', clientId).in('item_id', Array.from(ids)),
    'Não foi possível limpar'
  );
}

// Upsert genérico de uma linha do checklist (nome/ativo/ordem...).
async function saveChecklistRow(row, failMsg) {
  if (!row || !row.id) return false;
  const snap = _ckSnapshot(CHECKLIST_STORE);
  const prox = snap.some(x => x.id === row.id)
    ? snap.map(x => (x.id === row.id ? { ...x, ...row } : x))
    : snap.concat([row]);
  return _ckPersist(
    () => _ckSetCache(CHECKLIST_STORE, prox),
    () => _ckSetCache(CHECKLIST_STORE, snap),
    () => supabaseClient.from('checklists').upsert({ ...row, updated_at: new Date().toISOString() }),
    failMsg || 'Não foi possível salvar'
  );
}

// Cria checklist novo (em branco ou duplicando outro, itens incluídos).
async function createChecklist({ nome, duplicarDe }) {
  const nm = String(nome || '').trim();
  if (!nm) return { ok: false, motivo: 'Informe o nome do checklist.' };
  const lista = getChecklists();
  const id = _ckNewId('CK');
  const row = {
    id,
    nome: nm,
    ativo: true,
    ordem: (lista.reduce((mx, c) => Math.max(mx, c.ordem || 0), 0) || 0) + 1,
  };
  const origem = duplicarDe ? getChecklistItensAll(duplicarDe) : [];
  const novos = origem.map(it => ({ ...it, id: _ckNewId('CKI'), tipo: id }));

  const snapCk = _ckSnapshot(CHECKLIST_STORE);
  const snapIt = _ckSnapshot(CHECKLIST_STORE_MODELO);
  const ok = await _ckPersist(
    () => {
      _ckSetCache(CHECKLIST_STORE, snapCk.concat([row]));
      if (novos.length) _ckSetCache(CHECKLIST_STORE_MODELO, snapIt.concat(novos));
    },
    () => { _ckSetCache(CHECKLIST_STORE, snapCk); _ckSetCache(CHECKLIST_STORE_MODELO, snapIt); },
    async () => {
      const r1 = await supabaseClient.from('checklists').upsert({ ...row, updated_at: new Date().toISOString() });
      if (r1 && r1.error) return r1;
      if (novos.length) return supabaseClient.from('checklist_modelo_itens').upsert(novos);
      return null;
    },
    'Não foi possível criar'
  );
  return { ok, id: ok ? id : null };
}

// Exclui de vez (só quando não há NENHUMA marcação — conferido antes).
async function deleteChecklist(id) {
  if (!id) return false;
  const snapCk = _ckSnapshot(CHECKLIST_STORE);
  const snapIt = _ckSnapshot(CHECKLIST_STORE_MODELO);
  return _ckPersist(
    () => {
      _ckSetCache(CHECKLIST_STORE, snapCk.filter(c => c.id !== id));
      _ckSetCache(CHECKLIST_STORE_MODELO, snapIt.filter(i => i.tipo !== id));
    },
    () => { _ckSetCache(CHECKLIST_STORE, snapCk); _ckSetCache(CHECKLIST_STORE_MODELO, snapIt); },
    // itens e marcações caem em cascata (FKs ON DELETE CASCADE)
    () => supabaseClient.from('checklists').delete().eq('id', id),
    'Não foi possível excluir'
  );
}

// Adiciona item ao final do seu grupo (ordem global máxima + 1).
async function addChecklistItem(checklistId, { texto, categoria }) {
  const txt = String(texto == null ? '' : texto).trim();
  if (!txt) return { ok: false, motivo: 'Digite o texto do item.' };
  const cat = String(categoria || CHECKLIST_SEM_PROC).trim() || CHECKLIST_SEM_PROC;
  const atual = getChecklistItensAll(checklistId);
  const item = {
    id: _ckNewId('CKI'),
    tipo: checklistId,
    categoria: cat,
    texto: txt,
    ordem: (atual.reduce((mx, i) => Math.max(mx, i.ordem || 0), 0) || 0) + 1,
    ativo: true,
  };
  const snap = _ckSnapshot(CHECKLIST_STORE_MODELO);
  const ok = await _ckPersist(
    () => _ckSetCache(CHECKLIST_STORE_MODELO, snap.concat([item])),
    () => _ckSetCache(CHECKLIST_STORE_MODELO, snap),
    () => supabaseClient.from('checklist_modelo_itens').upsert({ ...item, updated_at: new Date().toISOString() }),
    'Não foi possível adicionar'
  );
  return { ok, id: ok ? item.id : null };
}

// Edita texto e/ou categoria de um item.
async function saveChecklistItem(patch, failMsg) {
  if (!patch || !patch.id) return false;
  const snap = _ckSnapshot(CHECKLIST_STORE_MODELO);
  const prox = snap.map(x => (x.id === patch.id ? { ...x, ...patch } : x));
  return _ckPersist(
    () => _ckSetCache(CHECKLIST_STORE_MODELO, prox),
    () => _ckSetCache(CHECKLIST_STORE_MODELO, snap),
    () => supabaseClient.from('checklist_modelo_itens')
      .upsert({ ...patch, updated_at: new Date().toISOString() }),
    failMsg || 'Não foi possível salvar'
  );
}

// Remove item = soft delete (ativo false) para preservar o histórico.
async function softRemoveChecklistItem(itemId) {
  return saveChecklistItem({ id: itemId, ativo: false }, 'Não foi possível remover');
}

// Aplica uma nova ordem (grupos já montados pelo modo Gerenciar).
async function reorderChecklistItems(checklistId, novosGrupos) {
  const flat = renumberGroups(novosGrupos);
  const snap = _ckSnapshot(CHECKLIST_STORE_MODELO);
  const atual = new Map(snap.filter(i => i.tipo === checklistId).map(i => [i.id, i.ordem]));
  const mudou = flat.filter(i => atual.get(i.id) !== i.ordem);
  if (!mudou.length) return true;
  const prox = snap.map(i => {
    const n = mudou.find(x => x.id === i.id);
    return n ? { ...i, ordem: n.ordem } : i;
  });
  return _ckPersist(
    () => _ckSetCache(CHECKLIST_STORE_MODELO, prox),
    () => _ckSetCache(CHECKLIST_STORE_MODELO, snap),
    () => supabaseClient.from('checklist_modelo_itens')
      .upsert(mudou.map(i => ({ id: i.id, ordem: i.ordem, updated_at: new Date().toISOString() }))),
    'Não foi possível salvar a ordem'
  );
}

// ── Estado da aba (em sessão) ────────────────────────────────────────────────

const _ckSelByClient = {};   // checklist escolhido na tela de uso
const _ckModeByClient = {};  // 'uso' | 'gerir'
const _ckAdmSel = {};        // checklist selecionado no modo Gerenciar
let _ckNovoAberto = false;   // formulário "+ Novo checklist" visível
let _ckRefocus = '';         // 'add' → devolve foco ao campo de novo item
let _ckDragId = null;        // item em arraste (drag & drop)

function checklistSelAtual(clientId) {
  const ativos = getActiveChecklists();
  if (!ativos.length) return null;
  const atual = _ckSelByClient[clientId];
  if (atual && ativos.some(c => c.id === atual)) return atual;
  _ckSelByClient[clientId] = ativos[0].id;
  return ativos[0].id;
}

function setChecklistSel(clientId, id) {
  if (!getActiveChecklists().some(c => c.id === id)) return;
  _ckSelByClient[clientId] = id;
  renderClientChecklistTab(clientId);
}

function checklistModo(clientId) {
  return _ckModeByClient[clientId] === 'gerir' ? 'gerir' : 'uso';
}

// Troca entre uso e gerenciamento (também usado pelo estado vazio e pelo
// "Ver como técnico"). Em 'gerir' puxa marcações globais p/ contagens.
// `abrirNovo` já abre o formulário "+ Novo checklist" (estado vazio).
function setChecklistMode(clientId, modo, abrirNovo) {
  _ckModeByClient[clientId] = modo === 'gerir' ? 'gerir' : 'uso';
  _ckNovoAberto = modo === 'gerir' && abrirNovo === true;
  renderClientChecklistTab(clientId);
  if (modo === 'gerir') {
    Promise.all([loadChecklists(true), loadChecklistModelo(), loadAllChecklistMarcacoes()])
      .then(() => {
        if (checklistModo(clientId) !== 'gerir') return;
        if (!_ckIsChecklistTabActive()) return;
        renderClientChecklistTab(clientId);
      })
      .catch(() => {});
  }
}

function _ckCompute(clientId, checklistId) {
  const grupos = groupChecklistItens(getChecklistItens(checklistId));
  const marcado = checklistMarcadoSet(clientId);
  const stats = checklistProgress(grupos, marcado);
  return { grupos, marcado, ...stats };
}

// Repinta só o que muda ao marcar/desmarcar (preserva foco/scroll).
function ckRefreshStats(clientId, checklistId) {
  const root = document.getElementById('clientTabContent');
  if (!root) return;
  const { grupos, marcado, done, total, pct } = _ckCompute(clientId, checklistId);

  grupos.forEach(g => {
    const elCount = root.querySelector('[data-ck-count="' + String(g.categoria).replace(/"/g, '') + '"]');
    if (elCount) elCount.textContent = g.itens.filter(it => marcado.has(it.id)).length + '/' + g.itens.length;
  });

  const txt = root.querySelector('#ckProgText');
  if (txt) txt.textContent = done + ' de ' + total + ' itens';
  const pctEl = root.querySelector('#ckProgPct');
  if (pctEl) pctEl.textContent = pct + '%';
  const fill = root.querySelector('#ckProgFill');
  if (fill) { fill.style.width = pct + '%'; fill.classList.toggle('is-done', pct === 100); }
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

function _ckSignature(clientId, checklistId) {
  const { grupos, marcado } = _ckCompute(clientId, checklistId);
  return JSON.stringify([
    grupos.map(g => [g.categoria, g.itens.map(i => i.id)]),
    Array.from(marcado).sort(),
  ]);
}

// Pull em segundo plano; repinta a aba só se algo visível tiver mudado.
async function _ckBackgroundLoad(clientId, checklistId) {
  try {
    const before = _ckSignature(clientId, checklistId);
    await loadChecklists();
    await loadChecklistModelo();
    await loadChecklistMarcacoes(clientId);
    if (checklistSelAtual(clientId) !== checklistId) return;
    if (checklistModo(clientId) !== 'uso') return;
    if (!_ckIsChecklistTabActive()) return;
    if (_ckSignature(clientId, checklistId) !== before) renderClientChecklistTab(clientId);
  } catch (_) { /* pull é best-effort: a aba já mostra o estado local */ }
}

// ── Render: entrada da aba ───────────────────────────────────────────────────

function renderClientChecklistTab(clientId) {
  const el = document.getElementById('clientTabContent');
  if (!el) return;
  _ckEnsureLocal();
  if (checklistModo(clientId) === 'gerir') { _ckRenderGerir(clientId, el); return; }
  _ckRenderUso(clientId, el);
}

// Materializa o modelo built-in no cache local quando ainda não há nada
// (migração 040/041 não aplicada ou primeiro acesso offline). Assim as
// edições do modo Gerenciar têm linhas para alterar e o servidor é quem
// acusa o erro se as tabelas não existirem.
function _ckEnsureLocal() {
  if (_ckCache(CHECKLIST_STORE).length) return;
  _ckSetCache(CHECKLIST_STORE, CHECKLISTS_DEFAULT.map(c => ({ ...c })));
  _ckSetCache(CHECKLIST_STORE_MODELO, CHECKLIST_MODELO_DEFAULT.map(i => ({ ...i })));
}

// ── Modo de USO ──────────────────────────────────────────────────────────────

function _ckRenderUso(clientId, el) {
  const cid = _ckEsc(clientId);
  const ativos = getActiveChecklists();

  if (!ativos.length) {
    el.innerHTML = `
      <div class="empty-state">
        <p>Nenhum checklist ativo.</p>
        <button type="button" class="btn btn-primary btn-sm" onclick="setChecklistMode('${cid}','gerir',true)">+ Novo checklist</button>
      </div>
      <p class="ck-hint">Checklists são gerenciados no modo “Gerenciar” e valem para todos os clientes.</p>`;
    return;
  }

  const sel = checklistSelAtual(clientId);
  const cidSel = _ckEsc(sel);
  const { grupos, marcado, done, total, pct } = _ckCompute(clientId, sel);
  const procs = typeof getProcedures === 'function' ? getProcedures(clientId) : [];

  const segBtns = ativos.map(c => `
    <button type="button" class="ck-seg-btn${c.id === sel ? ' is-on' : ''}" data-ck-tipo="${_ckEsc(c.id)}"
      aria-pressed="${c.id === sel}" onclick="setChecklistSel('${cid}','${_ckEsc(c.id)}')">${escapeHtml(c.nome)}</button>`).join('');

  const groupsHtml = grupos.map(g => {
    const d = g.itens.filter(it => marcado.has(it.id)).length;
    const temProc = g.categoria !== CHECKLIST_SEM_PROC
      && findProceduresByCategoria(procs, g.categoria).length > 0;
    const rows = g.itens.map(it => {
      const on = marcado.has(it.id);
      return `<label class="ck-item${on ? ' is-done' : ''}" data-ck-row="${_ckEsc(it.id)}">
        <input type="checkbox" class="ck-box" data-ck-item="${_ckEsc(it.id)}"${on ? ' checked' : ''}
          aria-label="${escapeHtml(it.texto)}" />
        <span class="ck-text">${escapeHtml(it.texto)}</span>
      </label>`;
    }).join('');
    return `<section class="ck-group">
      <header class="ck-group-head">
        <h3 class="ck-group-title">${escapeHtml(g.categoria)}</h3>
        <span class="ck-count" data-ck-count="${escapeHtml(g.categoria)}">${d}/${g.itens.length}</span>
        <span class="ck-sp"></span>
        ${temProc ? `<button type="button" class="ck-proc-btn" onclick="openChecklistProc('${cid}','${_ckEsc(g.categoria)}')">Ver procedimento</button>` : ''}
      </header>
      <div class="ck-list">${rows}</div>
    </section>`;
  }).join('');

  el.innerHTML = `
    <div class="ck-bar">
      <div class="ck-seg" role="group" aria-label="Checklists">${segBtns}</div>
      <button type="button" class="ck-mgr-btn" onclick="setChecklistMode('${cid}','gerir')">Gerenciar</button>
    </div>
    <div class="ck-prog">
      <div class="ck-prog-main">
        <div class="ck-prog-top"><span id="ckProgText">${done} de ${total} itens</span><b id="ckProgPct">${pct}%</b></div>
        <div class="ck-track"><i id="ckProgFill" class="${pct === 100 ? 'is-done' : ''}" style="width:${pct}%"></i></div>
      </div>
      <button type="button" class="btn btn-secondary btn-sm" onclick="clearChecklistConfirm('${cid}')">Desmarcar tudo</button>
    </div>
    <div class="ck-ok${total > 0 && pct === 100 ? ' is-on' : ''}" id="ckOk" role="status">Tudo confirmado. Nada pendente neste checklist.</div>
    <div class="ck-groups">${groupsHtml || '<div class="empty-state"><p>Nenhum item neste checklist.</p></div>'}</div>
    <p class="ck-hint">O estado fica salvo por cliente e por checklist — marque conforme for concluindo.</p>`;

  el.querySelectorAll('[data-ck-item]').forEach(cb => {
    cb.addEventListener('change', () => _ckOnToggle(clientId, sel, cb));
  });

  _ckBackgroundLoad(clientId, sel);
}

function _ckOnToggle(clientId, checklistId, cb) {
  const itemId = cb.getAttribute('data-ck-item');
  const marcado = cb.checked;
  const row = cb.closest ? cb.closest('.ck-item') : null;
  if (row) row.classList.toggle('is-done', marcado);
  ckRefreshStats(clientId, checklistId);

  cb.disabled = true;
  Promise.resolve(saveChecklistMarcacao(clientId, itemId, marcado)).then(ok => {
    cb.disabled = false;
    if (ok) return;
    cb.checked = !marcado; // rollback visual (cache já revertido pela escrita)
    if (row) row.classList.toggle('is-done', !marcado);
    ckRefreshStats(clientId, checklistId);
  }).catch(() => {
    cb.disabled = false;
    cb.checked = !marcado;
    if (row) row.classList.toggle('is-done', !marcado);
    ckRefreshStats(clientId, checklistId);
  });
}

// "Desmarcar tudo": confirmação simples e volta para o modo de uso.
function clearChecklistConfirm(clientId) {
  const sel = checklistSelAtual(clientId);
  if (!sel) return;
  const n = getChecklistItens(sel).length;
  if (!n) return;
  confirmAction('Desmarcar todos os itens de <strong>' + escapeHtml(getChecklistNome(sel))
    + '</strong>? Os ' + n + ' itens voltam a ficar pendentes.', async () => {
      await limparChecklist(clientId, sel);
      _ckReopen(clientId);
    });
}

// Reabre o modal do cliente no MESMO modo (confirmAction fecha o modal).
function _ckReopen(clientId) {
  try {
    if (typeof viewClient === 'function') viewClient(clientId);
    if (typeof switchClientTab === 'function') switchClientTab('checklist', clientId);
  } catch (_) {}
}

// ── Modo GERENCIAR ───────────────────────────────────────────────────────────

function _ckRenderGerir(clientId, el) {
  const cid = _ckEsc(clientId);
  const admin = ckIsAdmin();
  const lista = getChecklists();

  if (!lista.some(c => c.id === _ckAdmSel[clientId])) {
    _ckAdmSel[clientId] = lista.length ? lista[0].id : null;
  }
  const sel = _ckAdmSel[clientId];

  const novoForm = _ckNovoAberto && admin ? `
    <form class="ck-adm-new" onsubmit="ckAdmCreate(event,'${cid}'); return false;">
      <input type="text" class="ck-adm-input" id="ckAdmNewName" maxlength="60"
        placeholder="Nome do checklist" aria-label="Nome do checklist" />
      <select class="ck-adm-select" id="ckAdmNewFrom" aria-label="A partir de">
        <option value="">Começar em branco</option>
        ${lista.map(c => `<option value="${_ckEsc(c.id)}">Duplicar: ${escapeHtml(c.nome)}</option>`).join('')}
      </select>
      <button type="submit" class="btn btn-primary btn-sm">Criar</button>
      <button type="button" class="btn btn-secondary btn-sm" onclick="ckAdmCloseNew('${cid}')">Cancelar</button>
    </form>` : '';

  const rows = lista.map(c => {
    const n = countItemsByChecklist(_ckCache(CHECKLIST_STORE_MODELO), c.id);
    const contas = _ckUsingDefaults()
      ? countItemsByChecklist(CHECKLIST_MODELO_DEFAULT, c.id) : n;
    const marcados = ckMarcacoesDoChecklist(c.id);
    const nome = admin
      ? `<input type="text" class="ck-adm-name" value="${escapeHtml(c.nome)}" maxlength="60"
           aria-label="Nome do checklist"
           onchange="ckAdmRename('${cid}','${_ckEsc(c.id)}',this.value)"
           onkeydown="if(event.key==='Enter'){this.blur()}" />`
      : `<span class="ck-adm-name-txt">${escapeHtml(c.nome)}</span>`;
    const badge = c.ativo === false
      ? '<span class="ck-badge ck-badge--off">inativo</span>'
      : '<span class="ck-badge">ativo</span>';
    const contagem = `${contas.ativos} ${contas.ativos === 1 ? 'item' : 'itens'}`
      + (contas.inativos ? ` <span class="ck-adm-off">(+${contas.inativos} desativados)</span>` : '')
      + (marcados ? ` <span class="ck-adm-marks">${marcados} ${marcados === 1 ? 'cliente' : 'clientes'}</span>` : '');
    const acoes = admin ? `
      <button type="button" class="btn btn-secondary btn-sm" onclick="ckAdmPick('${cid}','${_ckEsc(c.id)}')">Itens</button>
      <button type="button" class="btn btn-secondary btn-sm" onclick="ckAdmToggle('${cid}','${_ckEsc(c.id)}')">${c.ativo === false ? 'Reativar' : 'Desativar'}</button>
      <button type="button" class="btn btn-danger btn-sm" onclick="ckAdmDelete('${cid}','${_ckEsc(c.id)}')">Excluir</button>` : '';
    return `<div class="ck-adm-row${c.id === sel ? ' is-on' : ''}">
      <div class="ck-adm-id">${nome}${badge}</div>
      <div class="ck-adm-meta">${contagem}</div>
      <div class="ck-adm-acts">${acoes}</div>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="ck-adm">
      <div class="ck-adm-warn" role="note">⚠ Alterações aqui valem para todos os clientes.</div>
      <div class="ck-adm-head">
        <div>
          <div class="ck-adm-title">Gerenciar checklists</div>
          <div class="ck-adm-sub">${admin ? 'Salvar acontece a cada alteração.' : 'Leitura — apenas administradores podem editar.'}</div>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" onclick="setChecklistMode('${cid}','uso')">Ver como técnico</button>
      </div>
      ${admin ? '' : '<div class="ck-adm-locked">Somente administradores podem editar os checklists.</div>'}
      <section class="ck-adm-sec">
        <div class="ck-adm-sec-head">
          <h3 class="ck-adm-sec-title">Checklists (${lista.length})</h3>
          ${admin ? `<button type="button" class="btn btn-primary btn-sm" onclick="ckAdmOpenNew('${cid}')">+ Novo checklist</button>` : ''}
        </div>
        ${novoForm}
        ${rows || '<div class="empty-state"><p>Nenhum checklist cadastrado.</p></div>'}
      </section>
      ${admin && sel ? _ckRenderItensSec(cid, sel) : ''}
    </div>`;

  if (admin) {
    el.querySelectorAll('.ck-adm-item').forEach(row => _ckBindDrag(clientId, row));
    if (_ckRefocus === 'add') {
      _ckRefocus = '';
      const inp = el.querySelector('#ckAdmAddText');
      if (inp) inp.focus();
    }
    if (_ckNovoAberto) {
      const nm = el.querySelector('#ckAdmNewName');
      if (nm) nm.focus();
    }
  }
}

function _ckRenderItensSec(cid, checklistId) {
  const grupos = groupChecklistItens(getChecklistItensAll(checklistId));
  const admin = ckIsAdmin();
  const selOpts = (atual) => checklistCategoriaOptions(atual)
    .map(c => `<option value="${escapeHtml(c)}"${checklistNormCat(c) === checklistNormCat(atual) ? ' selected' : ''}>${escapeHtml(c)}</option>`)
    .join('');

  const cards = grupos.map(g => {
    const rows = g.itens.map((it, i) => `
      <div class="ck-adm-item" draggable="true" data-item="${_ckEsc(it.id)}" data-cat="${escapeHtml(g.categoria)}">
        <span class="ck-adm-handle" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/></svg>
        </span>
        <input type="text" class="ck-adm-input ck-adm-text" value="${escapeHtml(it.texto)}" maxlength="160"
          aria-label="Texto do item" onchange="ckAdmItemText('${cid}','${_ckEsc(it.id)}',this.value)"
          onkeydown="if(event.key==='Enter'){this.blur()}" />
        <select class="ck-adm-select ck-adm-cat" aria-label="Categoria do item"
          onchange="ckAdmItemCat('${cid}','${_ckEsc(it.id)}',this.value)">${selOpts(g.categoria)}</select>
        <button type="button" class="ck-adm-btn" title="Subir" aria-label="Subir item"
          onclick="ckAdmMove('${cid}','${_ckEsc(it.id)}',-1)"${i === 0 ? ' disabled' : ''}>↑</button>
        <button type="button" class="ck-adm-btn" title="Descer" aria-label="Descer item"
          onclick="ckAdmMove('${cid}','${_ckEsc(it.id)}',1)"${i === g.itens.length - 1 ? ' disabled' : ''}>↓</button>
        <button type="button" class="ck-adm-btn ck-adm-btn--rm" title="Remover item" aria-label="Remover item"
          onclick="ckAdmRemoveItem('${cid}','${_ckEsc(it.id)}')">×</button>
      </div>`).join('');
    return `<section class="ck-group">
      <header class="ck-group-head">
        <h3 class="ck-group-title">${escapeHtml(g.categoria)}</h3>
        <span class="ck-count">${g.itens.length}</span>
        <span class="ck-sp"></span>
        <span class="ck-adm-dica">Arraste ou use ↑ ↓</span>
      </header>
      <div class="ck-list">${rows}</div>
    </section>`;
  }).join('');

  return `<section class="ck-adm-sec">
    <div class="ck-adm-sec-head">
      <h3 class="ck-adm-sec-title">Itens de “${escapeHtml(getChecklistNome(checklistId))}”</h3>
    </div>
    ${cards || '<div class="empty-state"><p>Nenhum item neste checklist.</p></div>'}
    <div class="ck-adm-add">
      <input type="text" class="ck-adm-input" id="ckAdmAddText" maxlength="160"
        placeholder="+ Novo item (Enter adiciona e mantém o foco)"
        aria-label="Novo item"
        onkeydown="ckAdmAddKey(event,'${cid}')" />
      <select class="ck-adm-select" id="ckAdmAddCat" aria-label="Categoria do novo item">
        ${checklistCategoriaOptions('Estações').map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}
      </select>
      <button type="button" class="btn btn-primary btn-sm" onclick="ckAdmAdd('${cid}')">Adicionar</button>
    </div>
  </section>`;
}

// ── Ações do modo GERENCIAR ──────────────────────────────────────────────────

function ckAdmOpenNew(clientId) {
  _ckNovoAberto = true;
  _ckRerenderGerir(clientId);
}
function ckAdmCloseNew(clientId) {
  _ckNovoAberto = false;
  _ckRerenderGerir(clientId);
}

let _ckLastClient = null;

function _ckRerenderGerir(clientId) {
  const id = clientId || _ckLastClient;
  if (!id) return;
  _ckLastClient = id;
  const el = document.getElementById('clientTabContent');
  if (!el) return;
  if (checklistModo(id) !== 'gerir') return;
  _ckRenderGerir(id, el);
}

function _ckGerirAfter(clientId, ok, msgOk) {
  if (ok && msgOk) _ckToast(msgOk, 'success');
  _ckRerenderGerir(clientId);
}

async function ckAdmCreate(ev, clientId) {
  if (ev && ev.preventDefault) ev.preventDefault();
  const root = document.getElementById('clientTabContent');
  if (!root) return false;
  const nome = (root.querySelector('#ckAdmNewName') || {}).value || '';
  const de = (root.querySelector('#ckAdmNewFrom') || {}).value || '';
  const r = await createChecklist({ nome, duplicarDe: de || null });
  if (!r.ok) { _ckToast(r.motivo || 'Não foi possível criar.', 'error'); return false; }
  _ckNovoAberto = false;
  _ckAdmSel[clientId] = r.id;
  _ckGerirAfter(clientId, true, 'Checklist criado.');
  return false;
}

async function ckAdmRename(clientId, id, valor) {
  const nm = String(valor || '').trim();
  const atual = getChecklistById(id);
  if (!nm) { _ckRerenderGerir(clientId); return; }
  if (atual && nm === atual.nome) { _ckRerenderGerir(clientId); return; }
  const ok = await saveChecklistRow({ id, nome: nm }, 'Não foi possível renomear');
  _ckGerirAfter(clientId, ok, 'Nome salvo.');
}

async function ckAdmToggle(clientId, id) {
  const c = getChecklistById(id);
  if (!c) return;
  const ok = await saveChecklistRow({ id, ativo: c.ativo === false }, 'Não foi possível atualizar');
  _ckGerirAfter(clientId, ok, c.ativo === false ? 'Checklist reativado.' : 'Checklist desativado.');
}

async function ckAdmPick(clientId, id) {
  _ckAdmSel[clientId] = id;
  _ckRerenderGerir(clientId);
}

async function ckAdmDelete(clientId, id) {
  const c = getChecklistById(id);
  if (!c) return;
  const marcados = ckMarcacoesDoChecklist(id);
  if (marcados === null) {
    const carregou = await loadAllChecklistMarcacoes();
    if (!carregou || ckMarcacoesDoChecklist(id) === null) {
      _ckToast('Não foi possível verificar as marcações deste checklist.', 'error');
      return;
    }
  }
  const n = ckMarcacoesDoChecklist(id);
  if (n > 0) {
    _ckToast('Não é possível excluir: ' + n + (n === 1 ? ' cliente já marcou' : ' clientes já marcaram')
      + ' itens dele. Desative em vez de excluir.', 'error');
    return;
  }
  confirmAction('Excluir <strong>' + escapeHtml(c.nome) + '</strong> e seus itens? Esta ação não pode ser desfeita.',
    async () => {
      const ok = await deleteChecklist(id);
      if (_ckAdmSel[clientId] === id) _ckAdmSel[clientId] = null;
      _ckReopen(clientId);
      if (ok) _ckToast('Checklist excluído.', 'success');
    });
}

async function ckAdmAddKey(ev, clientId) {
  if (!ev || ev.key !== 'Enter') return;
  if (ev.preventDefault) ev.preventDefault();
  await ckAdmAdd(clientId);
}

async function ckAdmAdd(clientId) {
  const root = document.getElementById('clientTabContent');
  const sel = _ckAdmSel[clientId];
  if (!root || !sel) return;
  const inp = root.querySelector('#ckAdmAddText');
  const cat = (root.querySelector('#ckAdmAddCat') || {}).value || CHECKLIST_SEM_PROC;
  if (!inp) return;
  const r = await addChecklistItem(sel, { texto: inp.value, categoria: cat });
  if (!r.ok) { _ckToast(r.motivo || 'Não foi possível adicionar.', 'error'); return; }
  _ckRefocus = 'add'; // Enter mantém o foco no próximo item
  _ckGerirAfter(clientId, true, 'Item adicionado.');
}

async function ckAdmItemText(clientId, itemId, valor) {
  const txt = String(valor || '').trim();
  const atual = (_ckCache(CHECKLIST_STORE_MODELO).find(i => i.id === itemId) || {}).texto;
  if (!txt) { _ckRerenderGerir(clientId); return; }
  if (txt === atual) return;
  const ok = await saveChecklistItem({ id: itemId, texto: txt }, 'Não foi possível salvar');
  _ckGerirAfter(clientId, ok, 'Salvo.');
}

async function ckAdmItemCat(clientId, itemId, categoria) {
  const ok = await saveChecklistItem({ id: itemId, categoria: String(categoria || CHECKLIST_SEM_PROC) }, 'Não foi possível salvar');
  _ckGerirAfter(clientId, ok, 'Salvo.');
}

async function ckAdmMove(clientId, itemId, dir) {
  const sel = _ckAdmSel[clientId];
  const grupos = groupChecklistItens(getChecklistItensAll(sel));
  const ng = moveItemDir(grupos, itemId, dir);
  if (!ng) return;
  const ok = await reorderChecklistItems(sel, ng);
  _ckGerirAfter(clientId, ok, 'Salvo.');
}

// Drag & drop (complementa ↑↓, que é o caminho por teclado/celular).
function _ckBindDrag(clientId, row) {
  const id = row.getAttribute('data-item');
  row.addEventListener('dragstart', e => {
    _ckDragId = id;
    row.classList.add('is-drag');
    try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); } catch (_) {}
  });
  row.addEventListener('dragend', () => {
    row.classList.remove('is-drag');
    _ckDragId = null;
    document.querySelectorAll('.ck-adm-item.is-over').forEach(x => x.classList.remove('is-over'));
  });
  row.addEventListener('dragover', e => { e.preventDefault(); row.classList.add('is-over'); });
  row.addEventListener('dragleave', () => row.classList.remove('is-over'));
  row.addEventListener('drop', e => {
    e.preventDefault();
    row.classList.remove('is-over');
    ckAdmDrop(clientId, row.getAttribute('data-item'), row.getAttribute('data-cat'));
  });
}

async function ckAdmDrop(clientId, alvoId, alvoCat) {
  const de = _ckDragId;
  _ckDragId = null;
  if (!de || de === alvoId) return;
  const sel = _ckAdmSel[clientId];
  const grupos = groupChecklistItens(getChecklistItensAll(sel));
  const ng = moveItemBefore(grupos, de, alvoCat, alvoId);
  if (!ng) return;
  const ok = await reorderChecklistItems(sel, ng);
  _ckGerirAfter(clientId, ok, 'Salvo.');
}

async function ckAdmRemoveItem(clientId, itemId) {
  let n = ckMarcacoesDoItem(itemId);
  if (n === null) {
    const okLoad = await loadAllChecklistMarcacoes();
    n = okLoad ? ckMarcacoesDoItem(itemId) : null;
  }
  let msg;
  if (n === null) {
    msg = 'Remover este item do checklist? (não foi possível contar as marcações)';
  } else if (n > 0) {
    msg = 'Remover este item? ' + n + (n === 1 ? ' cliente já marcou' : ' clientes já marcaram')
      + ' ele — o histórico é preservado (só some da tela).';
  } else {
    msg = 'Remover este item do checklist? Ninguém ainda marcou ele.';
  }
  confirmAction(msg, async () => {
    const ok = await softRemoveChecklistItem(itemId);
    _ckReopen(clientId);
    if (ok) _ckToast('Item removido (oculto dos clientes).', 'success');
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
  const procs = typeof getProcedures === 'function'
    ? findProceduresByCategoria(getProcedures(clientId), categoria) : [];
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

// Escape no atributo onclick/atributos (escapeHtml não escapa crase/aspas
// simples dos nossos ids, que são sempre alfanuméricos + '-').
function _ckEsc(v) {
  return String(v == null ? '' : v).replace(/[<>"'`\\]/g, '');
}

// Export para testes (Node/Vitest). Em browser os identificadores acima ficam
// no escopo global dos scripts.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CHECKLIST_CATEGORIAS,
    CHECKLISTS_DEFAULT,
    CHECKLIST_MODELO_DEFAULT,
    CHECKLIST_SEM_PROC,
    checklistNormCat,
    groupChecklistItens,
    checklistProgress,
    findProceduresByCategoria,
    orderChecklists,
    groupsToFlat,
    renumberGroups,
    moveItemDir,
    moveItemBefore,
    countItemsByChecklist,
    checklistCategoriaOptions,
  };
}
