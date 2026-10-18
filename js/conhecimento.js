// conhecimento.js – Base de conhecimento única.
// Junta numa busca só: artigos da equipe (procedimentos sem cliente),
// procedimentos de cada cliente, modelos e pendências RESOLVIDAS (o "como
// resolvemos da última vez"). Também sugere artigos parecidos dentro da
// pendência e transforma uma pendência resolvida em artigo.

const KB_KINDS = {
  artigo: 'Artigo',
  procedimento: 'Procedimento do cliente',
  modelo: 'Modelo',
  caso: 'Caso resolvido',
};

const KB_STOPWORDS = new Set(('a o e é de da do das dos em no na nos nas um uma uns umas para pra por com sem que se ao aos à às ' +
  'ou como mais menos mas não sim já foi ser está estão tem ter são era muito pouco este esta isso isto esse essa ' +
  'cliente clientes favor ok obs verificar verificado feito fazer').split(' '));

function kbNormalize(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Palavras relevantes (sem acento, sem stopword, 3+ letras ou com dígito). */
function kbTokens(s) {
  return kbNormalize(s).split(/[^a-z0-9]+/).filter((t) => t && !KB_STOPWORDS.has(t) && (t.length >= 3 || /\d/.test(t)));
}

// Notas automáticas (cronômetro, mudança de status) não são conhecimento.
function _kbUsefulNote(n) {
  const t = String((n && n.text) || '');
  return t && !/^(▶|⏸|⏹|🔁)/u.test(t) && !/sess[ãa]o registrada|tempo sess[ãa]o|iniciou o trabalho|status alterado/i.test(t);
}

/**
 * Documentos pesquisáveis (puro): recebe as listas já no escopo da equipe.
 * @param {{ procedures?: object[], templates?: object[], pendencias?: object[], clientName?: (id: string) => string }} src
 */
function kbCollect(src) {
  const name = typeof src.clientName === 'function' ? src.clientName : () => '';
  const docs = [];
  for (const p of src.procedures || []) {
    if (!p) continue;
    docs.push({ kind: p.clientId ? 'procedimento' : 'artigo', id: p.id, title: p.title || '', category: p.category || '',
      body: p.content || '', clientId: p.clientId || null, clientName: p.clientId ? name(p.clientId) : '', updatedAt: p.updatedAt || '' });
  }
  for (const t of src.templates || []) {
    if (!t) continue;
    docs.push({ kind: 'modelo', id: t.id, title: t.title || '', category: t.category || '', body: t.content || '', updatedAt: t.updatedAt || '' });
  }
  for (const p of src.pendencias || []) {
    if (!p || !['concluido', 'resolvido'].includes(p.status)) continue;
    const notes = (p.notes || []).filter(_kbUsefulNote).map((n) => n.text).join('\n');
    if (!String(p.descricao || '').trim() && !notes) continue; // sem registro de como resolveu
    docs.push({ kind: 'caso', id: p.id, title: p.assunto || p.descricao || '', category: p.tipo || '',
      body: [p.descricao || '', notes].filter(Boolean).join('\n'), clientId: p.clientId || null, clientName: p.clientName || '',
      updatedAt: p.completedAt || p.updatedAt || '' });
  }
  return docs;
}

/** Pontua um documento contra os termos (título 3, categoria 2, corpo 1; frase inteira +4). */
function _kbScore(doc, terms, phrase) {
  if (!terms.length) return 0;
  const title = kbNormalize(doc.title);
  const cat = kbNormalize(doc.category);
  const body = kbNormalize(doc.body);
  let score = 0;
  let hits = 0;
  for (const t of terms) {
    let h = 0;
    if (title.includes(t)) h += 3;
    if (cat.includes(t)) h += 2;
    if (body.includes(t)) h += 1;
    if (h) hits++;
    score += h;
  }
  if (phrase && phrase.length > 4 && (title.includes(phrase) || body.includes(phrase))) score += 4;
  return { score, hits };
}

/**
 * Busca (puro): todos os termos precisam aparecer em algum campo.
 * @param {{ kind?: string, limit?: number }} [opts]
 */
function kbSearch(docs, query, opts) {
  const terms = [...new Set(kbTokens(query))];
  const phrase = kbNormalize(query).trim();
  const kind = opts && opts.kind;
  if (!terms.length) return [];
  return (docs || [])
    .filter((d) => !kind || d.kind === kind)
    .map((d) => ({ d, s: _kbScore(d, terms, phrase) }))
    .filter((x) => x.s.hits === terms.length)
    .sort((a, b) => (b.s.score - a.s.score) || String(b.d.updatedAt).localeCompare(String(a.d.updatedAt)))
    .slice(0, (opts && opts.limit) || 50)
    .map((x) => x.d);
}

/**
 * Parecidos com um texto (puro): basta coincidir em parte dos termos.
 * Exige 2+ termos em comum (ou 1 no título) para não sugerir qualquer coisa.
 */
function kbRelated(docs, text, opts) {
  const terms = [...new Set(kbTokens(text))].slice(0, 25);
  if (!terms.length) return [];
  const exclude = opts && opts.excludeId;
  return (docs || [])
    .filter((d) => d.id !== exclude)
    .map((d) => {
      const s = _kbScore(d, terms, '');
      const titleHit = terms.some((t) => kbNormalize(d.title).includes(t));
      return { d, score: s.score, ok: s.hits >= 2 || (titleHit && s.hits >= 1 && terms.length <= 3) };
    })
    .filter((x) => x.ok)
    .sort((a, b) => (b.score - a.score) || (a.d.kind === 'artigo' ? -1 : 1))
    .slice(0, (opts && opts.limit) || 3)
    .map((x) => x.d);
}

/** Texto inicial de um artigo a partir de uma pendência resolvida (puro). */
function kbArticleFromPendencia(p) {
  const notes = (p.notes || []).filter(_kbUsefulNote).map((n) => '- ' + String(n.text).trim());
  const parts = [];
  if (p.descricao) parts.push('Problema:\n' + String(p.descricao).trim());
  if (notes.length) parts.push('O que foi feito:\n' + notes.join('\n'));
  parts.push('Origem: pendência ' + (p.clientName ? 'de ' + p.clientName : '') + ' resolvida em ' + String(p.completedAt || p.updatedAt || '').slice(0, 10) + '.');
  return { title: p.assunto || 'Como resolver', category: p.tipo || '', content: parts.join('\n\n') };
}

// ── Dados do app ─────────────────────────────────────────────────────────

function kbDocs() {
  const clients = typeof getMyClients === 'function' ? getMyClients() : [];
  const visible = new Set(clients.map((c) => c.id));
  const byId = new Map(clients.map((c) => [c.id, c.name]));
  const team = typeof getCurrentTeam === 'function' ? getCurrentTeam() : 'init';
  const admin = typeof isTeamAdmin === 'function' && isTeamAdmin();
  const procs = (typeof getProcedures === 'function' ? getProcedures() : [])
    .filter((p) => p && (p.clientId ? visible.has(p.clientId) : (admin || (p.team || 'init') === team)));
  return kbCollect({
    procedures: procs,
    templates: typeof getProcedureTemplates === 'function' ? getProcedureTemplates() : [],
    pendencias: typeof getMyPendencias === 'function' ? getMyPendencias() : [],
    clientName: (id) => byId.get(id) || '',
  });
}

// ── Tela ─────────────────────────────────────────────────────────────────

let _kbQuery = '';
let _kbKind = '';

const KB_ICON = {
  artigo: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  procedimento: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  modelo: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
  caso: '<path d="M20 6L9 17l-5-5"/>',
};

function _kbSnippet(d, q) {
  const body = String(d.body || '').replace(/\s+/g, ' ').trim();
  const terms = kbTokens(q);
  const nb = kbNormalize(body);
  let at = -1;
  for (const t of terms) { at = nb.indexOf(t); if (at !== -1) break; }
  const start = Math.max(0, at - 50);
  const cut = body.slice(start, start + 170);
  return (start > 0 ? '…' : '') + escapeHtml(cut) + (body.length > start + 170 ? '…' : '');
}

function _kbRow(d, q) {
  return '<li><button type="button" class="kb-row" onclick="openKbDoc(\'' + escapeHtml(d.kind) + '\',\'' + escapeHtml(d.id) + '\')">' +
    '<svg class="kb-ico kb-ico--' + d.kind + '" viewBox="0 0 24 24" aria-hidden="true">' + KB_ICON[d.kind] + '</svg>' +
    '<span class="kb-main"><b>' + escapeHtml(d.title || '(sem título)') + '</b>' +
    '<span class="kb-meta">' + escapeHtml([KB_KINDS[d.kind], d.clientName, d.category].filter(Boolean).join(' · ')) + '</span>' +
    (d.body ? '<span class="kb-snip">' + _kbSnippet(d, q) + '</span>' : '') + '</span></button></li>';
}

function renderConhecimento() {
  document.getElementById('pageTitle').textContent = 'Conhecimento';
  if (typeof setTopbarAction === 'function') {
    setTopbarAction('Novo artigo', '<svg class="topbar-action-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>');
    window._topbarAction = () => openKbArticleForm();
  }
  if (!document.getElementById('kbResults')) {
    const chip = (k, l) => '<button type="button" class="vis-chip" aria-pressed="' + (_kbKind === k) + '" data-kind="' + k + '" onclick="setKbKind(\'' + k + '\')">' + l + '</button>';
    document.getElementById('contentArea').innerHTML =
      '<div class="ov-wrap kb">' +
        '<div class="search-bar page-toolbar"><div class="search-input-wrap pt-search"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
        '<input class="form-input" id="kbSearch" placeholder="Descreva o problema: \'impressora não imprime\', \'VPN cai\'…" value="' + escapeHtml(_kbQuery) + '" oninput="_kbQuery=this.value;_kbPaint()" autocomplete="off" /></div></div>' +
        '<div class="kb-chips">' + chip('', 'Tudo') + chip('artigo', 'Artigos') + chip('caso', 'Casos resolvidos') + chip('procedimento', 'Procedimentos de clientes') + chip('modelo', 'Modelos') + '</div>' +
        '<div id="kbResults"></div>' +
      '</div>';
  }
  _kbPaint();
}

function setKbKind(k) {
  _kbKind = k;
  document.querySelectorAll('.kb-chips .vis-chip').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === k)));
  _kbPaint();
}

function _kbPaint() {
  const box = document.getElementById('kbResults');
  if (!box) return;
  const docs = kbDocs();
  const q = _kbQuery.trim();
  if (!q) {
    // Sem busca: artigos da equipe (mais recentes primeiro).
    const list = docs.filter((d) => (_kbKind ? d.kind === _kbKind : d.kind === 'artigo'))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 40);
    const counts = Object.keys(KB_KINDS).map((k) => docs.filter((d) => d.kind === k).length);
    box.innerHTML = '<p class="kb-hint">' + counts[0] + ' artigos · ' + counts[3] + ' casos resolvidos · ' + counts[1] + ' procedimentos de clientes · ' + counts[2] + ' modelos. Busque pelo sintoma.</p>' +
      (list.length ? '<section class="card ov-panel"><ul class="kb-list">' + list.map((d) => _kbRow(d, '')).join('') + '</ul></section>'
        : '<div class="empty-state"><p>Nenhum artigo da equipe ainda. Escreva um, ou transforme uma pendência resolvida em artigo (botão no detalhe dela).</p><button class="btn btn-primary btn-sm" onclick="openKbArticleForm()">+ Novo artigo</button></div>');
    return;
  }
  const found = kbSearch(docs, q, { kind: _kbKind || undefined, limit: 60 });
  box.innerHTML = found.length
    ? '<p class="kb-hint">' + found.length + (found.length === 1 ? ' resultado' : ' resultados') + '</p><section class="card ov-panel"><ul class="kb-list">' + found.map((d) => _kbRow(d, q)).join('') + '</ul></section>'
    : '<div class="empty-state"><p>Nada encontrado para "' + escapeHtml(q) + '".</p><button class="btn btn-secondary btn-sm" onclick="openKbArticleForm(null,{title:document.getElementById(\'kbSearch\').value})">Escrever um artigo sobre isso</button></div>';
}

function openKbDoc(kind, id) {
  if (kind === 'caso') { if (typeof openPendenciaDetail === 'function') openPendenciaDetail(id); return; }
  const d = kbDocs().find((x) => x.kind === kind && x.id === id);
  if (!d) { if (typeof showToast === 'function') showToast('Documento não encontrado.', 'warning'); return; }
  const acts = [];
  if (kind === 'artigo') acts.push('<button type="button" class="btn btn-secondary btn-sm" onclick="openKbArticleForm(\'' + escapeHtml(id) + '\')">Editar</button>');
  if (kind === 'procedimento' && d.clientId) acts.push('<button type="button" class="btn btn-secondary btn-sm" onclick="viewClient(\'' + escapeHtml(d.clientId) + '\')">Abrir cliente</button>');
  acts.push('<button type="button" class="btn btn-secondary btn-sm" onclick="copyKbDoc(\'' + escapeHtml(kind) + '\',\'' + escapeHtml(id) + '\')">Copiar texto</button>');
  openModal(escapeHtml(d.title || 'Documento'),
    '<div class="kb-doc-meta">' + escapeHtml([KB_KINDS[kind], d.clientName, d.category].filter(Boolean).join(' · ')) + '</div>' +
    '<div class="kb-doc-body">' + escapeHtml(d.body || '—') + '</div>' +
    '<div class="form-actions">' + acts.join('') + '<button type="button" class="btn btn-primary btn-sm" onclick="closeModal()">Fechar</button></div>', 'lg');
}

function copyKbDoc(kind, id) {
  const d = kbDocs().find((x) => x.kind === kind && x.id === id);
  if (!d) return;
  const text = d.title + '\n\n' + d.body;
  try { navigator.clipboard.writeText(text).then(() => showToast('Copiado.', 'success')); } catch (_) {}
}

/** @param {object} [pre] valores iniciais (título/categoria/conteúdo) */
function openKbArticleForm(id, pre) {
  const a = id ? ((typeof getProcedures === 'function' ? getProcedures() : []).find((p) => p.id === id) || {}) : (pre || {});
  openModal(id ? 'Editar artigo' : 'Novo artigo', `
    <form onsubmit="submitKbArticle(event,'${escapeHtml(id || '')}')">
      <div class="form-group"><label class="form-label">Título *</label><input class="form-input" name="title" value="${escapeHtml(a.title || '')}" placeholder="Ex.: Impressora HP some da rede depois de atualizar o Windows" required /></div>
      <div class="form-group"><label class="form-label">Categoria</label><input class="form-input" name="category" value="${escapeHtml(a.category || '')}" placeholder="Rede, Impressora, E-mail, Backup…" /></div>
      <div class="form-group"><label class="form-label">Sintoma, causa e solução</label><textarea class="form-textarea" name="content" rows="12" placeholder="Sintoma:&#10;Causa:&#10;Solução (passo a passo):">${escapeHtml(a.content || '')}</textarea></div>
      <p class="kb-hint" style="margin:-6px 0 12px">Fica visível para toda a sua equipe, não só para um cliente.</p>
      <div class="form-actions">
        ${id && (typeof canDelete !== 'function' || canDelete()) ? `<button type="button" class="btn btn-danger" style="margin-right:auto" onclick="if(confirm('Excluir este artigo?')){deleteProcedure('${escapeHtml(id)}');closeModal();if(document.getElementById('kbResults'))_kbPaint();}">Excluir</button>` : ''}
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn-primary">Salvar</button>
      </div>
    </form>`, 'lg');
}

function submitKbArticle(e, id) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const title = String(fd.get('title') || '').trim();
  if (!title) return;
  const team = (typeof isTeamAdmin === 'function' && isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam)
    ? _selectedTeam : (typeof getCurrentTeam === 'function' ? getCurrentTeam() : 'init');
  const data = { title, category: String(fd.get('category') || '').trim(), content: String(fd.get('content') || ''), clientId: null };
  if (id) data.id = id; else data.team = team;
  saveProcedure(data);
  closeModal();
  showToast(id ? 'Artigo atualizado.' : 'Artigo publicado na base da equipe.', 'success');
  if (document.getElementById('kbResults')) _kbPaint();
}

/** Botão no detalhe da pendência resolvida. */
function kbFromPendencia(penId) {
  const p = typeof getPendenciaById === 'function' ? getPendenciaById(penId) : null;
  if (!p) return;
  openKbArticleForm(null, kbArticleFromPendencia(p));
}

/** Bloco "Base de conhecimento" no detalhe da pendência. */
function kbPendenciaPanelHtml(p) {
  if (!p) return '';
  let related = [];
  try { related = kbRelated(kbDocs(), [p.assunto, p.descricao].join(' '), { excludeId: p.id, limit: 3 }); } catch (_) {}
  const resolved = ['concluido', 'resolvido'].includes(p.status);
  if (!related.length && !resolved) return '';
  return '<div class="kb-pen">' +
    '<div class="kb-pen-head"><span>Base de conhecimento</span>' +
    (resolved ? '<button type="button" class="link-btn" onclick="kbFromPendencia(\'' + escapeHtml(p.id) + '\')">Transformar em artigo</button>' : '') + '</div>' +
    (related.length ? '<ul class="kb-list kb-list--sm">' + related.map((d) => _kbRow(d, [p.assunto, p.descricao].join(' '))).join('') + '</ul>'
      : '<p class="kb-hint">Registre como resolveu: vira consulta para a próxima vez.</p>') +
  '</div>';
}

if (typeof window !== 'undefined' && typeof onDataChanged === 'function' && !window._kbAutoRefresh) {
  window._kbAutoRefresh = true;
  ['procedimentos', 'templates', 'pendencias'].forEach((n) => onDataChanged(n, function () {
    try { if ((window.location.hash || '').replace('#', '') === 'conhecimento') _kbPaint(); } catch (_) {}
  }));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { kbTokens, kbCollect, kbSearch, kbRelated, kbArticleFromPendencia };
}
