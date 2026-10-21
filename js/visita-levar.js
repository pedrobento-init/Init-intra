// visita-levar.js — "O que levar" na visita (migration 058).
// O motivo da visita (ex.: "Formatação de máquina") sugere itens pelas
// regras palavras-chave → itens (tabela levar_regras, editada pelo admin).
// O técnico ajusta a lista no formulário e marca no detalhe o que separou.
// visit.levar = [{ t: 'Pendrive bootável', ok: false }, ...]
// Eventos delegados no document (sem handler inline — CSP).

// Mesma lista do seed da 058: vale offline / antes da 1ª leitura do banco.
const LEVAR_REGRAS_PADRAO = [
  { id: 'lv-formatacao', palavras: 'formatacao, formatar, reinstalar windows, reinstalacao', ordem: 1, ativo: true,
    itens: ['Pendrive bootável do Windows', 'HD externo para backup', 'Pendrive com drivers', 'Chave de licença do Windows'] },
  { id: 'lv-backup', palavras: 'backup', ordem: 2, ativo: true, itens: ['HD externo para backup', 'Cabo USB/SATA'] },
  { id: 'lv-maquina-nova', palavras: 'maquina nova, computador novo, notebook novo, instalacao de computador, instalacao de maquina', ordem: 3, ativo: true,
    itens: ['Pendrive com instaladores', 'Cabo de rede', 'Filtro de linha'] },
  { id: 'lv-impressora', palavras: 'impressora, scanner', ordem: 4, ativo: true,
    itens: ['Cabo USB de impressora', 'Driver da impressora no pendrive', 'Papel para teste'] },
  { id: 'lv-rede', palavras: 'rede, cabeamento, cabo de rede, switch, ponto de rede', ordem: 5, ativo: true,
    itens: ['Alicate de crimpar', 'Conectores RJ45', 'Testador de cabo', 'Cabo de rede'] },
  { id: 'lv-wifi', palavras: 'wifi, wi-fi, roteador, access point', ordem: 6, ativo: true,
    itens: ['Cabo de rede', 'Notebook para configurar', 'Fonte/adaptador PoE'] },
  { id: 'lv-servidor', palavras: 'servidor', ordem: 7, ativo: true, itens: ['Notebook', 'Pendrive bootável', 'HD externo', 'Cabo de rede'] },
];
const LEVAR_CACHE_KEY = 'intra_levar_regras';
let _levarRegras = null;
let _levarForm = null;   // { itens, ignorados } do formulário aberto
let _levarMotivoTimer = null;

// ── Regras (puro) ───────────────────────────────────────────────────────────

function levarNormaliza(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

/** Itens sugeridos para o motivo. Palavra-chave casa como palavra inteira,
 *  aceitando plural: "impressora" pega "impressoras", "rede" não pega "redefinir". */
function levarSugestoes(motivo, regras) {
  const m = levarNormaliza(motivo);
  if (!m) return [];
  const out = [];
  const seen = new Set();
  [...(regras || [])].filter((r) => r && r.ativo !== false)
    .sort((a, b) => (a.ordem || 0) - (b.ordem || 0))
    .forEach((r) => {
      const hit = String(r.palavras || '').split(',').map(levarNormaliza).filter(Boolean).some((p) => {
        const esc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp('(^|[^a-z0-9])' + esc + 's?($|[^a-z0-9])').test(m);
      });
      if (!hit) return;
      (Array.isArray(r.itens) ? r.itens : []).forEach((t) => {
        const k = levarNormaliza(t);
        if (k && !seen.has(k)) { seen.add(k); out.push(String(t).trim()); }
      });
    });
  return out;
}

/** Lista + sugestões que ainda não estão nela nem foram tiradas pelo técnico. */
function levarMescla(lista, sugestoes, ignorados) {
  const out = (lista || []).map((i) => ({ t: i.t, ok: i.ok === true }));
  const tem = new Set(out.map((i) => levarNormaliza(i.t)));
  (sugestoes || []).forEach((t) => {
    const k = levarNormaliza(t);
    if (!k || tem.has(k) || (ignorados && ignorados.has(k))) return;
    tem.add(k);
    out.push({ t, ok: false });
  });
  return out;
}

function getLevarRegras() {
  if (_levarRegras) return _levarRegras;
  try {
    const c = JSON.parse(localStorage.getItem(LEVAR_CACHE_KEY) || 'null');
    if (Array.isArray(c)) { _levarRegras = c; return c; }
  } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'visita-levar'); }
  return LEVAR_REGRAS_PADRAO;
}

function _levarOnline() {
  return typeof isSupabaseConnected === 'function' && isSupabaseConnected() && typeof window !== 'undefined' && window._supabaseAuthActive === true;
}

async function loadLevarRegras() {
  if (!_levarOnline()) return getLevarRegras();
  try {
    const { data, error } = await supabaseClient.from('levar_regras').select('id, palavras, itens, ativo, ordem').order('ordem');
    if (error) throw error;
    _levarRegras = data || [];
    try { localStorage.setItem(LEVAR_CACHE_KEY, JSON.stringify(_levarRegras)); } catch (_e) { /* sem espaço: fica só em memória */ }
  } catch (_e) {
    // Banco sem a 058: segue com o cache/padrão.
    if (typeof _logSilent === 'function') _logSilent(_e, 'visita-levar');
  }
  return getLevarRegras();
}

function levarPodeEditarRegras() {
  try { return getCurrentPermissions() === PERMISSIONS.admin; } catch (_) { return false; }
}

// ── Formulário da visita ────────────────────────────────────────────────────

/** Bloco do formulário. Visita nova com motivo já preenchido já vem com sugestões. */
function levarFormHtml(v) {
  const base = Array.isArray(v && v.levar) ? v.levar : [];
  _levarForm = { itens: base.map((i) => ({ t: i.t, ok: i.ok === true })), ignorados: new Set() };
  if (!(v && v.id) && !base.length && v && v.motivo) _levarForm.itens = levarMescla([], levarSugestoes(v.motivo, getLevarRegras()));
  loadLevarRegras();  // atualiza o cache para a próxima digitação
  return `
    <div class="form-group levar-box">
      <label class="form-label">O que levar</label>
      <ul class="levar-list" id="levarList">${_levarItensHtml(_levarForm.itens, 'form')}</ul>
      <div class="levar-add">
        <input class="form-input" id="levarNovo" placeholder="Adicionar item (ex.: cabo HDMI)" maxlength="120" />
        <button type="button" class="btn btn-secondary btn-sm" data-levar-add>Adicionar</button>
      </div>
      <p class="levar-hint">Os itens aparecem conforme o motivo. Tire o que não precisar.</p>
    </div>`;
}

/** Lista do formulário para gravar na visita (undefined = formulário sem o bloco). */
function levarFormValor() {
  if (!_levarForm || !document.getElementById('levarList')) return undefined;
  return _levarForm.itens.filter((i) => String(i.t || '').trim()).map((i) => ({ t: String(i.t).trim().slice(0, 120), ok: i.ok === true }));
}

function _levarItensHtml(itens, modo) {
  if (!itens.length) return `<li class="levar-vazio">${modo === 'form' ? 'Nada por enquanto.' : ''}</li>`;
  return itens.map((i, n) => `
    <li class="levar-item${i.ok ? ' is-ok' : ''}">
      <label><input type="checkbox" data-levar-ok="${n}" ${i.ok ? 'checked' : ''} /> <span>${escapeHtml(i.t)}</span></label>
      ${modo === 'form' ? `<button type="button" class="levar-rm" data-levar-rm="${n}" aria-label="Tirar ${escapeHtml(i.t)}">×</button>` : ''}
    </li>`).join('');
}

function _levarRenderForm() {
  const ul = document.getElementById('levarList');
  if (ul && _levarForm) ul.innerHTML = _levarItensHtml(_levarForm.itens, 'form');
}

function _levarAdicionar() {
  const inp = document.getElementById('levarNovo');
  const t = (inp && inp.value || '').trim();
  if (!t || !_levarForm) return;
  _levarForm.ignorados.delete(levarNormaliza(t));
  _levarForm.itens = levarMescla(_levarForm.itens, [t]);
  inp.value = '';
  inp.focus();
  _levarRenderForm();
}

// ── Detalhe da visita ───────────────────────────────────────────────────────

function levarDetalheHtml(v) {
  const itens = Array.isArray(v && v.levar) ? v.levar : [];
  if (!itens.length) return '';
  const feitos = itens.filter((i) => i.ok).length;
  return `
    <div class="form-group levar-box">
      <label class="form-label">O que levar <span class="levar-conta" id="levarConta">${feitos}/${itens.length} separados</span></label>
      <ul class="levar-list" id="levarDetalhe" data-visit="${escapeHtml(v.id)}">${_levarItensHtml(itens, 'detalhe')}</ul>
    </div>`;
}

function _levarMarcarNoDetalhe(ul, n, ok) {
  const v = typeof getVisitById === 'function' ? getVisitById(ul.dataset.visit) : null;
  if (!v || !Array.isArray(v.levar) || !v.levar[n]) return;
  const levar = v.levar.map((i, k) => ({ t: i.t, ok: k === n ? ok : i.ok === true }));
  saveVisit({ ...v, levar });
  const li = ul.querySelectorAll('.levar-item')[n];
  if (li) li.classList.toggle('is-ok', ok);
  const conta = document.getElementById('levarConta');
  if (conta) conta.textContent = levar.filter((i) => i.ok).length + '/' + levar.length + ' separados';
}

// ── Regras (admin) ──────────────────────────────────────────────────────────

let _levarEdicao = null;  // { regras, apagadas }

async function openLevarRegras() {
  if (!levarPodeEditarRegras()) { showToast('Só administradores editam as regras.', 'warning'); return; }
  if (!_levarOnline()) { showToast('Editar as regras precisa de conexão com o servidor.', 'warning'); return; }
  const regras = await loadLevarRegras();
  _levarEdicao = { regras: regras.map((r) => ({ ...r, itens: [...(r.itens || [])] })), apagadas: [] };
  openModal('O que levar — regras', `
    <p class="feed-lead">Quando o motivo da visita tiver uma das palavras, os itens entram na lista "O que levar". Maiúsculas e acentos não importam.</p>
    <div id="levarRegrasLista"></div>
    <button type="button" class="btn btn-secondary btn-sm" data-levar-nova>+ Nova regra</button>
    <div class="form-actions">
      <button type="button" class="btn btn-secondary" data-levar-fechar>Cancelar</button>
      <button type="button" class="btn btn-primary" data-levar-salvar>Salvar regras</button>
    </div>`);
  _levarRenderRegras();
}

function _levarRenderRegras() {
  const box = document.getElementById('levarRegrasLista');
  if (!box || !_levarEdicao) return;
  box.innerHTML = _levarEdicao.regras.map((r, n) => `
    <div class="levar-regra" data-levar-regra="${n}">
      <div class="form-group"><label class="form-label">Palavras no motivo (separe por vírgula)</label>
        <input class="form-input" data-campo="palavras" value="${escapeHtml(r.palavras || '')}" placeholder="formatação, formatar" /></div>
      <div class="form-group"><label class="form-label">Itens para levar (um por linha)</label>
        <textarea class="form-textarea" data-campo="itens" rows="3" placeholder="Pendrive bootável&#10;HD externo">${escapeHtml((r.itens || []).join('\n'))}</textarea></div>
      <div class="levar-regra-acoes">
        <label><input type="checkbox" data-campo="ativo" ${r.ativo !== false ? 'checked' : ''} /> Ativa</label>
        <button type="button" class="btn btn-secondary btn-sm" data-levar-del="${n}">Apagar regra</button>
      </div>
    </div>`).join('') || '<p class="levar-hint">Nenhuma regra.</p>';
}

/** Lê os campos da tela para _levarEdicao (antes de redesenhar ou salvar). */
function _levarLerRegras() {
  document.querySelectorAll('[data-levar-regra]').forEach((el) => {
    const r = _levarEdicao.regras[Number(el.dataset.levarRegra)];
    if (!r) return;
    r.palavras = el.querySelector('[data-campo="palavras"]').value.trim();
    r.itens = el.querySelector('[data-campo="itens"]').value.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 30);
    r.ativo = el.querySelector('[data-campo="ativo"]').checked;
  });
}

async function _levarSalvarRegras() {
  _levarLerRegras();
  const regras = _levarEdicao.regras.filter((r) => r.palavras && r.itens.length);
  const quem = (typeof getSession === 'function' && getSession()?.name) || null;
  const now = new Date().toISOString();
  try {
    if (_levarEdicao.apagadas.length) {
      const { error } = await supabaseClient.from('levar_regras').delete().in('id', _levarEdicao.apagadas);
      if (error) throw error;
    }
    if (regras.length) {
      const { error } = await supabaseClient.from('levar_regras').upsert(regras.map((r, n) => ({
        id: r.id || (typeof nextId === 'function' ? nextId('LV') : 'LV-' + Date.now() + '-' + n),
        palavras: r.palavras.slice(0, 500), itens: r.itens, ativo: r.ativo !== false, ordem: n + 1,
        updated_by: quem, updated_at: now,
      })));
      if (error) throw error;
    }
    await loadLevarRegras();
    closeModal();
    showToast('Regras salvas.', 'success');
  } catch (_e) {
    showToast('Não foi possível salvar as regras.', 'error');
  }
}

// ── Eventos (delegados) ─────────────────────────────────────────────────────

if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('[data-levar-regras]')) { openLevarRegras(); return; }
    if (t.closest('[data-levar-add]')) { _levarAdicionar(); return; }
    const rm = t.closest('[data-levar-rm]');
    if (rm && _levarForm) {
      const n = Number(rm.dataset.levarRm);
      const it = _levarForm.itens[n];
      if (it) _levarForm.ignorados.add(levarNormaliza(it.t));
      _levarForm.itens.splice(n, 1);
      _levarRenderForm();
      return;
    }
    if (t.closest('[data-levar-nova]') && _levarEdicao) {
      _levarLerRegras();
      _levarEdicao.regras.push({ id: null, palavras: '', itens: [], ativo: true });
      _levarRenderRegras();
      const last = document.querySelector('[data-levar-regra]:last-child [data-campo="palavras"]');
      if (last) last.focus();
      return;
    }
    const del = t.closest('[data-levar-del]');
    if (del && _levarEdicao) {
      _levarLerRegras();
      const [r] = _levarEdicao.regras.splice(Number(del.dataset.levarDel), 1);
      if (r && r.id) _levarEdicao.apagadas.push(r.id);
      _levarRenderRegras();
      return;
    }
    if (t.closest('[data-levar-salvar]')) { _levarSalvarRegras(); return; }
    if (t.closest('[data-levar-fechar]')) closeModal();
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (!t || !t.matches || !t.matches('[data-levar-ok]')) return;
    const n = Number(t.dataset.levarOk);
    const det = t.closest('#levarDetalhe');
    if (det) { _levarMarcarNoDetalhe(det, n, t.checked); return; }
    if (_levarForm && _levarForm.itens[n]) {
      _levarForm.itens[n].ok = t.checked;
      t.closest('.levar-item')?.classList.toggle('is-ok', t.checked);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target && e.target.id === 'levarNovo') { e.preventDefault(); _levarAdicionar(); }
  });

  // Motivo digitado → sugestões (só com o bloco aberto no formulário).
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (!t || t.name !== 'motivo' || !_levarForm || !document.getElementById('levarList')) return;
    clearTimeout(_levarMotivoTimer);
    _levarMotivoTimer = setTimeout(() => {
      _levarForm.itens = levarMescla(_levarForm.itens, levarSugestoes(t.value, getLevarRegras()), _levarForm.ignorados);
      _levarRenderForm();
    }, 350);
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { levarNormaliza, levarSugestoes, levarMescla, LEVAR_REGRAS_PADRAO };
}
