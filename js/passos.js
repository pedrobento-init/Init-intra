// passos.js — Passo a passo estruturado de procedimentos e modelos.
// =====================================================================
// O conteúdo continua sendo TEXTO na coluna `content` (procedures e
// procedure_templates): nada muda no banco, na sincronização, na busca nem no
// checklist de pendência (templateStepsToChecklist). Aqui o texto é lido como
// lista de passos para EDITAR (editor por passo) e para EXECUTAR (modo
// checklist, com progresso guardado no aparelho).
//
//   Texto antes do primeiro passo vira a introdução.
//   1) Título do passo
//      linhas recuadas logo abaixo são o detalhe do passo
//   2) Próximo passo
//
// O recuo do detalhe é o que deixa um detalhe começar com número sem virar
// passo novo. Modelos antigos ("1) ..." em cada linha) abrem sem conversão.

// Número de passo: "1)", "2.", "3:", "4 -". O ponto/dois-pontos exigem espaço
// depois para "1.5 GB" não virar passo.
const _PS_NUM = /^ ?(\d{1,3})(?:\)|[.:](?=\s|$)|\s*[-–]\s)\s*(.*)$/;
const _PS_BUL = /^ ?[-*•▪☐□]\s+(.*)$/;
const _PS_MAX_STEPS = 200;

function _psEsc(s) {
  if (typeof escapeHtml === 'function') return escapeHtml(s);
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _psTrimBlank(lines) {
  let a = 0, b = lines.length;
  while (a < b && !lines[a].trim()) a++;
  while (b > a && !lines[b - 1].trim()) b--;
  return lines.slice(a, b).map((l) => l.replace(/\s+$/, ''));
}

/** Texto → { intro, steps: [{ text, detail }] }. Puro. */
function procParseSteps(content) {
  const lines = String(content == null ? '' : content).replace(/\r\n?/g, '\n').split('\n');
  // Com passos numerados, só o número abre passo (marcador vira detalhe);
  // sem número, a lista de marcadores é que é o passo a passo.
  const hasNum = lines.some((l) => _PS_NUM.test(l));
  const re = hasNum ? _PS_NUM : _PS_BUL;
  const intro = [];
  const steps = [];
  let cur = null;
  for (const line of lines) {
    const m = steps.length < _PS_MAX_STEPS ? line.match(re) : null;
    if (m) {
      cur = { text: String(hasNum ? m[2] : m[1]).trim(), detail: [] };
      steps.push(cur);
    } else if (cur) {
      cur.detail.push(line.replace(/^(?: {1,3}|\t)/, ''));
    } else {
      intro.push(line);
    }
  }
  return {
    intro: _psTrimBlank(intro).join('\n'),
    steps: steps.map((s) => ({ text: s.text, detail: _psTrimBlank(s.detail).join('\n') })),
  };
}

/** { intro, steps } → texto (formato que procParseSteps lê de volta). Puro. */
function procSerializeSteps(doc) {
  const out = [];
  const intro = _psTrimBlank(String((doc && doc.intro) || '').replace(/\r\n?/g, '\n').split('\n'));
  if (intro.length) out.push(...intro, '');
  const steps = ((doc && doc.steps) || []).filter((s) => s && (String(s.text || '').trim() || String(s.detail || '').trim()));
  steps.forEach((s, i) => {
    out.push((i + 1) + ') ' + String(s.text || '').replace(/\s*\n\s*/g, ' ').trim());
    _psTrimBlank(String(s.detail || '').replace(/\r\n?/g, '\n').split('\n')).forEach((l) => out.push(l ? '   ' + l : ''));
  });
  while (out.length && !out[out.length - 1]) out.pop();
  return out.join('\n');
}

/**
 * Texto colado num passo → lista de passos. Com numeração ou marcadores usa o
 * parser; sem nada, cada linha preenchida vira um passo. Puro.
 */
function procStepsFromPaste(text) {
  const doc = procParseSteps(text);
  if (doc.steps.length) {
    const lead = doc.intro ? doc.intro.split('\n').map((l) => l.trim()).filter(Boolean).map((t) => ({ text: t, detail: '' })) : [];
    return lead.concat(doc.steps);
  }
  return String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((t) => ({ text: t, detail: '' }));
}

// Trecho entre aspas ou crases (comando, nome de menu, caminho) vira um chip
// que copia ao clicar; URL http(s) vira link. Tudo o mais é escapado.
const _PS_TOKEN = /`([^`\n]{1,200})`|"([^"\n]{1,120})"|“([^”\n]{1,120})”|(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/g;

/** Texto de um passo → HTML seguro com chips copiáveis e links. Puro. */
function procInlineHtml(text) {
  const s = String(text == null ? '' : text);
  let out = '';
  let last = 0;
  s.replace(_PS_TOKEN, (m, code, dq, sq, url, idx) => {
    out += _psEsc(s.slice(last, idx));
    if (url) {
      out += '<a class="ps-link" href="' + _psEsc(url) + '" target="_blank" rel="noopener noreferrer">' + _psEsc(url) + '</a>';
    } else {
      const v = code || dq || sq;
      // <span role="button"> e não <button>: botão é bloco atômico e não
      // quebra junto com o texto, um nome de menu longo virava um bloco solto.
      // Enter/Espaço chegam pela delegação de teclado do actions.js.
      out += '<span role="button" tabindex="0" class="ps-chip' + (code ? ' ps-chip--code' : '') + '" data-action="psCopy" data-arg="' + _psEsc(v) + '" title="Clique para copiar">' + _psEsc(v) + '</span>';
    }
    last = idx + m.length;
    return m;
  });
  return out + _psEsc(s.slice(last));
}

/** Leitura (cartões e fichas): lista numerada com detalhe. */
function procReadHtml(content, opts) {
  const o = opts || {};
  const doc = procParseSteps(content);
  if (!doc.steps.length) return '<div class="ps-read-plain">' + procInlineHtml(content || o.empty || '') + '</div>';
  const limit = o.limit && doc.steps.length > o.limit ? o.limit : doc.steps.length;
  return (doc.intro && !o.limit ? '<div class="ps-read-intro">' + procInlineHtml(doc.intro) + '</div>' : '') +
    '<ol class="ps-read">' + doc.steps.slice(0, limit).map((s, i) =>
      '<li><span class="ps-read-n">' + (i + 1) + '</span><div class="ps-read-b"><div>' + procInlineHtml(s.text) + '</div>' +
      (s.detail && !o.limit ? '<div class="ps-read-d">' + procInlineHtml(s.detail) + '</div>' : '') + '</div></li>').join('') +
    '</ol>' +
    (limit < doc.steps.length ? '<div class="ps-read-more">+ ' + (doc.steps.length - limit) + ' passo' + (doc.steps.length - limit === 1 ? '' : 's') + '</div>' : '');
}

function _psCountLabel(n) {
  return n === 1 ? '1 passo' : n + ' passos';
}

// ─────────────────────────────────────────────────────────────────────
// EDITOR
// Estado em root._ps = { intro, steps:[{text, detail, open}] }. O <textarea
// name="content"> escondido carrega o texto serializado, então o FormData do
// formulário que hospeda o editor segue igual.
// ─────────────────────────────────────────────────────────────────────

const _PS_ICONS = {
  grip: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
  up: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="18 15 12 9 6 15"/></svg>',
  down: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>',
  note: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="14" y2="17"/></svg>',
  dup: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>',
  plus: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  trash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
  check: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>',
  play: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="6 4 20 12 6 20 6 4"/></svg>',
};

/** Markup do editor. Monte com procEditorMount depois do openModal. */
function procEditorHtml(content) {
  return `
    <div class="pse" data-pse>
      <textarea name="content" hidden>${_psEsc(content || '')}</textarea>
      <div class="pse-bar">
        <div class="pse-tabs" role="tablist" aria-label="Modo de edição">
          <button type="button" role="tab" class="pse-tab is-on" aria-selected="true" data-action="pseMode" data-arg="steps">Passos</button>
          <button type="button" role="tab" class="pse-tab" aria-selected="false" data-action="pseMode" data-arg="text">Texto livre</button>
        </div>
        <span class="pse-count" aria-live="polite"></span>
      </div>
      <div class="pse-pane" data-pane="steps">
        <div class="pse-intro">
          <label class="pse-sub" for="pseIntro">Antes de começar <span>(opcional)</span></label>
          <textarea class="form-textarea pse-intro-in" id="pseIntro" rows="1" placeholder="Pré-requisitos, avisos, o que pedir ao cliente…"></textarea>
        </div>
        <ol class="pse-list"></ol>
        <div class="pse-foot">
          <button type="button" class="btn btn-secondary btn-sm pse-add" data-action="pseAdd">${_PS_ICONS.plus} Adicionar passo</button>
          <span class="pse-keys"><kbd>Enter</kbd> novo passo · <kbd>Shift</kbd>+<kbd>Enter</kbd> quebra linha · <kbd>Alt</kbd>+<kbd>↑</kbd><kbd>↓</kbd> move · cole uma lista para criar vários</span>
        </div>
      </div>
      <div class="pse-pane" data-pane="text" hidden>
        <textarea class="form-textarea pse-raw" rows="16" spellcheck="true" placeholder="1) Primeiro passo&#10;   detalhe recuado do primeiro passo&#10;2) Segundo passo"></textarea>
        <p class="pse-hint">Linhas que começam com <code>1)</code>, <code>2.</code>… viram passos; linhas recuadas logo abaixo viram o detalhe do passo. Texto entre "aspas" vira botão de copiar na execução.</p>
      </div>
    </div>`;
}

function _pseRoot(el) { return el && el.closest ? el.closest('[data-pse]') : null; }
function _pseIdx(el) { const li = el && el.closest ? el.closest('.pse-step') : null; return li ? Number(li.dataset.i) : -1; }

function _pseGrow(ta) {
  if (!ta) return;
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 2 + 'px';
}

function _pseStepHtml(s, i, n) {
  const open = s.open || !!String(s.detail || '').trim();
  return `
    <li class="pse-step${open ? ' has-detail' : ''}" data-i="${i}">
      <span class="pse-grip" title="Arraste para reordenar" aria-hidden="true">${_PS_ICONS.grip}</span>
      <span class="pse-num" aria-hidden="true">${i + 1}</span>
      <div class="pse-main">
        <textarea class="pse-text" rows="1" aria-label="Passo ${i + 1}" placeholder="${i === 0 ? 'Ex.: Abra o Executar (Win+R) e digite &quot;gpedit.msc&quot;' : 'Descreva o passo…'}">${_psEsc(s.text || '')}</textarea>
        <textarea class="pse-detail" rows="1" aria-label="Detalhes do passo ${i + 1}" placeholder="Detalhes: caminho de menu, comando, observação, valor esperado…"${open ? '' : ' hidden'}>${_psEsc(s.detail || '')}</textarea>
      </div>
      <div class="pse-tools">
        <button type="button" class="pse-ico${open ? ' is-on' : ''}" data-action="pseDetail" title="Detalhes do passo" aria-label="Detalhes do passo ${i + 1}">${_PS_ICONS.note}</button>
        <button type="button" class="pse-ico" data-action="pseMove" data-arg="-1" title="Subir (Alt+↑)" aria-label="Subir passo ${i + 1}"${i === 0 ? ' disabled' : ''}>${_PS_ICONS.up}</button>
        <button type="button" class="pse-ico" data-action="pseMove" data-arg="1" title="Descer (Alt+↓)" aria-label="Descer passo ${i + 1}"${i === n - 1 ? ' disabled' : ''}>${_PS_ICONS.down}</button>
        <button type="button" class="pse-ico" data-action="pseInsert" title="Inserir passo abaixo" aria-label="Inserir passo abaixo do ${i + 1}">${_PS_ICONS.plus}</button>
        <button type="button" class="pse-ico" data-action="pseDup" title="Duplicar passo" aria-label="Duplicar passo ${i + 1}">${_PS_ICONS.dup}</button>
        <button type="button" class="pse-ico pse-ico--danger" data-action="pseDel" title="Excluir passo" aria-label="Excluir passo ${i + 1}">${_PS_ICONS.trash}</button>
      </div>
    </li>`;
}

function _pseSync(root, dirty) {
  const st = root._ps;
  const hidden = root.querySelector('textarea[name="content"]');
  const textMode = root.dataset.mode === 'text';
  if (hidden) hidden.value = textMode ? root.querySelector('.pse-raw').value : procSerializeSteps(st);
  const n = st.steps.filter((s) => String(s.text || '').trim() || String(s.detail || '').trim()).length;
  const c = root.querySelector('.pse-count');
  if (c) c.textContent = _psCountLabel(n);
  if (dirty) { try { _modalDirty = true; } catch (_) {} }
}

function _pseRender(root, focus) {
  const st = root._ps;
  if (!st.steps.length) st.steps.push({ text: '', detail: '' });
  const list = root.querySelector('.pse-list');
  list.innerHTML = st.steps.map((s, i) => _pseStepHtml(s, i, st.steps.length)).join('');
  list.querySelectorAll('textarea').forEach((ta) => { if (!ta.hidden) _pseGrow(ta); });
  if (focus) _pseFocus(root, focus.i, focus.field || 'text', focus.at);
}

function _pseFocus(root, i, field, at) {
  const li = root.querySelector('.pse-step[data-i="' + i + '"]');
  const ta = li && li.querySelector(field === 'detail' ? '.pse-detail' : '.pse-text');
  if (!ta) return;
  ta.focus();
  const pos = at === 'start' ? 0 : ta.value.length;
  try { ta.setSelectionRange(pos, pos); } catch (_) {}
  try { li.scrollIntoView({ block: 'nearest' }); } catch (_) {}
}

function _pseLoad(root, content) {
  const doc = procParseSteps(content);
  root._ps = { intro: doc.intro, steps: doc.steps.map((s) => ({ text: s.text, detail: s.detail, open: false })) };
  // Texto corrido sem nenhum passo: em vez de esconder tudo na introdução,
  // cada linha vira um passo (é o que a pessoa quer ao abrir o editor).
  if (!doc.steps.length && doc.intro) {
    root._ps = { intro: '', steps: procStepsFromPaste(doc.intro).map((s) => ({ text: s.text, detail: '', open: false })) };
  }
  const intro = root.querySelector('.pse-intro-in');
  if (intro) { intro.value = root._ps.intro; _pseGrow(intro); }
}

/** Liga os eventos do editor (uma vez por modal aberto). */
function procEditorMount(root) {
  if (!root || root._psMounted) return;
  root._psMounted = true;
  root.dataset.mode = 'steps';
  _pseLoad(root, root.querySelector('textarea[name="content"]').value);
  _pseRender(root);
  _pseSync(root, false);

  root.addEventListener('input', (ev) => {
    const t = ev.target;
    const st = root._ps;
    if (t.classList.contains('pse-raw')) { _pseSync(root, true); return; }
    if (t.classList.contains('pse-intro-in')) { st.intro = t.value; _pseGrow(t); _pseSync(root, true); return; }
    const i = _pseIdx(t);
    if (i < 0 || !st.steps[i]) return;
    if (t.classList.contains('pse-text')) st.steps[i].text = t.value;
    else if (t.classList.contains('pse-detail')) st.steps[i].detail = t.value;
    _pseGrow(t);
    _pseSync(root, true);
  });

  root.addEventListener('keydown', (ev) => {
    const t = ev.target;
    if (!t.classList || !(t.classList.contains('pse-text') || t.classList.contains('pse-detail'))) return;
    const st = root._ps;
    const i = _pseIdx(t);
    if (i < 0) return;
    if (ev.altKey && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown')) {
      ev.preventDefault();
      _pseMove(root, i, ev.key === 'ArrowUp' ? -1 : 1, t.classList.contains('pse-detail') ? 'detail' : 'text');
      return;
    }
    if (!t.classList.contains('pse-text')) return;
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) {
      ev.preventDefault();
      // Enter no meio do texto quebra o passo em dois, como num editor de lista.
      const pos = t.selectionStart;
      const rest = t.value.slice(pos);
      if (rest.trim() && pos > 0) {
        st.steps[i].text = t.value.slice(0, pos).trim();
        st.steps.splice(i + 1, 0, { text: rest.trim(), detail: '' });
        _pseRender(root, { i: i + 1, at: 'start' });
      } else {
        st.steps.splice(pos === 0 && t.value.trim() ? i : i + 1, 0, { text: '', detail: '' });
        _pseRender(root, { i: pos === 0 && t.value.trim() ? i : i + 1 });
      }
      _pseSync(root, true);
    } else if (ev.key === 'Backspace' && !t.value && !String(st.steps[i].detail || '').trim() && st.steps.length > 1) {
      ev.preventDefault();
      st.steps.splice(i, 1);
      _pseRender(root, { i: Math.max(0, i - 1) });
      _pseSync(root, true);
    } else if (ev.key === 'ArrowUp' && t.selectionStart === 0 && t.selectionEnd === 0 && i > 0) {
      ev.preventDefault();
      _pseFocus(root, i - 1, 'text');
    } else if (ev.key === 'ArrowDown' && t.selectionStart === t.value.length && i < st.steps.length - 1) {
      ev.preventDefault();
      _pseFocus(root, i + 1, 'text', 'end');
    }
  });

  // Colar uma lista (do Word, de um e-mail, do bloco de notas) num passo
  // cria vários passos de uma vez em vez de amontoar tudo num só.
  root.addEventListener('paste', (ev) => {
    const t = ev.target;
    if (!t.classList || !t.classList.contains('pse-text')) return;
    const txt = ev.clipboardData && ev.clipboardData.getData('text');
    if (!txt || !/\n\s*\S/.test(txt.trim())) return;
    const items = procStepsFromPaste(txt);
    if (items.length < 2) return;
    ev.preventDefault();
    const st = root._ps;
    const i = _pseIdx(t);
    const before = t.value.slice(0, t.selectionStart).trim();
    const after = t.value.slice(t.selectionEnd).trim();
    if (before) items[0].text = before + ' ' + items[0].text;
    if (after) items[items.length - 1].text += ' ' + after;
    const keepDetail = st.steps[i].detail;
    st.steps.splice(i, 1, ...items.map((s) => ({ text: s.text, detail: s.detail, open: false })));
    if (keepDetail && !st.steps[i].detail) st.steps[i].detail = keepDetail;
    _pseRender(root, { i: i + items.length - 1 });
    _pseSync(root, true);
    if (typeof showToast === 'function') showToast(items.length + ' passos criados a partir do texto colado.', 'success');
  });

  // Arrastar pela alça. O <li> só fica arrastável enquanto a alça está
  // pressionada: arrastável o tempo todo, ele roubaria a seleção de texto.
  let dragFrom = -1;
  root.addEventListener('pointerdown', (ev) => {
    const g = ev.target.closest && ev.target.closest('.pse-grip');
    if (g) g.closest('.pse-step').draggable = true;
  });
  root.addEventListener('dragstart', (ev) => {
    const li = ev.target.closest && ev.target.closest('.pse-step');
    if (!li || !li.draggable) return;
    dragFrom = Number(li.dataset.i);
    li.classList.add('is-drag');
    try { ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', String(dragFrom)); } catch (_) {}
  });
  root.addEventListener('dragover', (ev) => {
    if (dragFrom < 0) return;
    const li = ev.target.closest && ev.target.closest('.pse-step');
    if (!li) return;
    ev.preventDefault();
    const r = li.getBoundingClientRect();
    const below = ev.clientY > r.top + r.height / 2;
    root.querySelectorAll('.pse-step').forEach((x) => x.classList.remove('drop-above', 'drop-below'));
    li.classList.add(below ? 'drop-below' : 'drop-above');
  });
  root.addEventListener('drop', (ev) => {
    if (dragFrom < 0) return;
    const li = ev.target.closest && ev.target.closest('.pse-step');
    if (!li) return;
    ev.preventDefault();
    let to = Number(li.dataset.i) + (li.classList.contains('drop-below') ? 1 : 0);
    const st = root._ps;
    const [moved] = st.steps.splice(dragFrom, 1);
    if (to > dragFrom) to--;
    st.steps.splice(to, 0, moved);
    dragFrom = -1;
    _pseRender(root);
    _pseSync(root, true);
  });
  root.addEventListener('dragend', () => {
    dragFrom = -1;
    root.querySelectorAll('.pse-step').forEach((x) => { x.draggable = false; x.classList.remove('is-drag', 'drop-above', 'drop-below'); });
  });
}

/** Troca o conteúdo do editor (ex.: "Carregar do modelo"). */
function procEditorSet(root, content) {
  if (!root) return;
  if (root.dataset.mode === 'text') root.querySelector('.pse-raw').value = content || '';
  _pseLoad(root, content || '');
  _pseRender(root);
  _pseSync(root, true);
}

function _pseMove(root, i, d, field) {
  const st = root._ps;
  const j = i + d;
  if (j < 0 || j >= st.steps.length) return;
  const tmp = st.steps[i];
  st.steps[i] = st.steps[j];
  st.steps[j] = tmp;
  _pseRender(root, { i: j, field });
  _pseSync(root, true);
}

function _pseSetMode(root, mode) {
  if (!root || root.dataset.mode === mode) return;
  const raw = root.querySelector('.pse-raw');
  if (mode === 'text') {
    raw.value = procSerializeSteps(root._ps);
  } else {
    _pseLoad(root, raw.value);
    _pseRender(root);
  }
  root.dataset.mode = mode;
  root.querySelectorAll('.pse-tab').forEach((b) => {
    const on = b.dataset.arg === mode;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  root.querySelectorAll('.pse-pane').forEach((p) => { p.hidden = p.dataset.pane !== mode; });
  _pseSync(root, false);
  if (mode === 'text') { raw.focus(); } else { _pseFocus(root, 0, 'text'); }
}

// ─────────────────────────────────────────────────────────────────────
// EXECUÇÃO — checklist do passo a passo, com o passo atual em destaque.
// O progresso fica no aparelho (localStorage) para quem fecha o modal no
// meio do atendimento retomar de onde parou; muda o conteúdo, zera.
// ─────────────────────────────────────────────────────────────────────

let _psrState = null;

function _psrSig(steps) {
  let h = 0;
  const s = steps.map((x) => x.text).join('\u0001');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return steps.length + ':' + h;
}

function _psrStoreKey(kind, id) { return 'intra_psr_' + kind + '_' + id; }

function _psrLoadDone(kind, id, sig) {
  try {
    const v = JSON.parse(localStorage.getItem(_psrStoreKey(kind, id)) || 'null');
    if (v && v.sig === sig && Array.isArray(v.done)) return v.done.filter((n) => Number.isInteger(n));
  } catch (_) {}
  return [];
}

function _psrSaveDone() {
  const s = _psrState;
  if (!s) return;
  try {
    if (!s.done.size) localStorage.removeItem(_psrStoreKey(s.kind, s.id));
    else localStorage.setItem(_psrStoreKey(s.kind, s.id), JSON.stringify({ sig: s.sig, done: Array.from(s.done), at: Date.now() }));
  } catch (_) {}
}

function _psrFind(kind, id) {
  if (kind === 'tpl') return typeof getProcedureTemplateById === 'function' ? getProcedureTemplateById(id) : null;
  const all = typeof getProcedures === 'function' ? (getProcedures() || []) : [];
  return all.find((p) => p.id === id) || null;
}

/** Abre o modo execução. kind: 'tpl' (modelo) | 'proc' (procedimento/artigo). */
function openProcedureRunner(kind, id) {
  const item = _psrFind(kind, id);
  if (!item) { if (typeof showToast === 'function') showToast('Procedimento não encontrado.', 'warning'); return; }
  const doc = procParseSteps(item.content);
  const sig = _psrSig(doc.steps);
  _psrState = { kind, id, item, doc, sig, done: new Set(_psrLoadDone(kind, id, sig).filter((n) => n < doc.steps.length)) };
  const meta = [item.category ? '<span class="tag tag-blue">' + _psEsc(item.category) + '</span>' : '',
    '<span class="psr-meta-n">' + _psCountLabel(doc.steps.length) + '</span>'].join('');
  openModal(item.title || 'Procedimento', `
    <div class="psr" data-psr>
      <div class="psr-top">
        <div class="psr-meta">${meta}</div>
        <div class="psr-progress" role="progressbar" aria-label="Progresso do procedimento" aria-valuemin="0" aria-valuemax="${doc.steps.length}">
          <div class="psr-bar"><span></span></div>
          <span class="psr-pct"></span>
        </div>
      </div>
      ${doc.intro ? '<div class="psr-intro"><div class="psr-intro-h">Antes de começar</div><div class="psr-intro-b">' + procInlineHtml(doc.intro) + '</div></div>' : ''}
      ${doc.steps.length ? '<ol class="psr-list"></ol>' : '<div class="empty-state"><p>Este procedimento ainda não está dividido em passos.</p></div>'}
      <div class="psr-done" hidden>${_PS_ICONS.check}<div><strong>Procedimento concluído</strong><span>Copie o resumo para registrar no chamado.</span></div></div>
      <div class="form-actions psr-actions">
        <button type="button" class="btn btn-secondary btn-sm" data-action="psrReset" title="Desmarcar todos os passos">Recomeçar</button>
        <button type="button" class="btn btn-secondary btn-sm" data-action="psrCopy" title="Copiar o checklist com o que foi feito">Copiar resumo</button>
        <span class="psr-sp"></span>
        <button type="button" class="btn btn-secondary btn-sm" data-action="psrEdit">Editar</button>
        <button type="button" class="btn btn-primary psr-next" data-action="psrNext"></button>
      </div>
    </div>`, 'xl');
  _psrPaint(true);
}

function _psrCurrent() {
  const s = _psrState;
  for (let i = 0; i < s.doc.steps.length; i++) if (!s.done.has(i)) return i;
  return -1;
}

function _psrPaint(scroll) {
  const s = _psrState;
  const root = document.querySelector('#modalBody [data-psr]');
  if (!s || !root) return;
  const n = s.doc.steps.length;
  const cur = _psrCurrent();
  const list = root.querySelector('.psr-list');
  if (list) {
    list.innerHTML = s.doc.steps.map((st, i) => {
      const done = s.done.has(i);
      const isCur = i === cur;
      return `<li class="psr-step${done ? ' is-done' : ''}${isCur ? ' is-current' : ''}" data-i="${i}">
        <button type="button" class="psr-check" data-action="psrToggle" data-arg="${i}" aria-pressed="${done}" aria-label="${done ? 'Desmarcar' : 'Marcar'} passo ${i + 1}">
          <span class="psr-n">${i + 1}</span><span class="psr-ok">${_PS_ICONS.check}</span>
        </button>
        <div class="psr-body">
          <div class="psr-text">${procInlineHtml(st.text) || '<em>(sem título)</em>'}</div>
          ${st.detail ? '<div class="psr-detail">' + procInlineHtml(st.detail) + '</div>' : ''}
        </div>
      </li>`;
    }).join('');
  }
  const pct = n ? Math.round((s.done.size / n) * 100) : 0;
  const bar = root.querySelector('.psr-bar span');
  if (bar) bar.style.width = pct + '%';
  const pb = root.querySelector('.psr-progress');
  if (pb) pb.setAttribute('aria-valuenow', String(s.done.size));
  const lbl = root.querySelector('.psr-pct');
  if (lbl) lbl.textContent = s.done.size + ' de ' + n + (n ? ' · ' + pct + '%' : '');
  const doneBox = root.querySelector('.psr-done');
  if (doneBox) doneBox.hidden = !(n && cur < 0);
  const next = root.querySelector('.psr-next');
  if (next) {
    next.innerHTML = cur >= 0 ? _PS_ICONS.check + ' Concluir passo ' + (cur + 1) : 'Fechar';
    next.dataset.mode = cur >= 0 ? 'next' : 'close';
  }
  if (scroll && cur >= 0) {
    const li = root.querySelector('.psr-step[data-i="' + cur + '"]');
    try { if (li) li.scrollIntoView({ block: 'center', behavior: typeof _canAnimate === 'function' && _canAnimate() ? 'smooth' : 'auto' }); } catch (_) {}
  }
}

function _psrSummary() {
  const s = _psrState;
  const date = new Date().toLocaleString('pt-BR');
  const lines = [s.item.title + ' — ' + s.done.size + '/' + s.doc.steps.length + ' passos (' + date + ')'];
  s.doc.steps.forEach((st, i) => lines.push((s.done.has(i) ? '[x] ' : '[ ] ') + (i + 1) + ') ' + st.text));
  return lines.join('\n');
}

function _psCopyText(text, msg) {
  const ok = () => { if (typeof showToast === 'function') showToast(msg || 'Copiado!', 'success'); };
  try {
    navigator.clipboard.writeText(text).then(ok, () => { if (typeof showToast === 'function') showToast('Não foi possível copiar.', 'error'); });
  } catch (_) {}
}

if (typeof registerActions === 'function') {
  registerActions({
    // Editor
    pseMode: (el, mode) => _pseSetMode(_pseRoot(el), mode),
    pseAdd: (el) => {
      const root = _pseRoot(el);
      const st = root._ps;
      const last = st.steps[st.steps.length - 1];
      if (last && !String(last.text || '').trim() && !String(last.detail || '').trim()) { _pseFocus(root, st.steps.length - 1, 'text'); return; }
      st.steps.push({ text: '', detail: '' });
      _pseRender(root, { i: st.steps.length - 1 });
      _pseSync(root, true);
    },
    pseInsert: (el) => {
      const root = _pseRoot(el);
      const i = _pseIdx(el);
      root._ps.steps.splice(i + 1, 0, { text: '', detail: '' });
      _pseRender(root, { i: i + 1 });
      _pseSync(root, true);
    },
    pseDup: (el) => {
      const root = _pseRoot(el);
      const i = _pseIdx(el);
      const s = root._ps.steps[i];
      root._ps.steps.splice(i + 1, 0, { text: s.text, detail: s.detail, open: s.open });
      _pseRender(root, { i: i + 1 });
      _pseSync(root, true);
    },
    pseDel: (el) => {
      const root = _pseRoot(el);
      const i = _pseIdx(el);
      const st = root._ps;
      const removed = st.steps.splice(i, 1)[0];
      _pseRender(root, { i: Math.max(0, Math.min(i, st.steps.length - 1)) });
      _pseSync(root, true);
      if (removed && (String(removed.text || '').trim() || String(removed.detail || '').trim()) && typeof showUndoToast === 'function') {
        showUndoToast('Passo ' + (i + 1) + ' removido.', () => {
          if (!root.isConnected) return;
          st.steps.splice(Math.min(i, st.steps.length), 0, removed);
          _pseRender(root, { i });
          _pseSync(root, true);
        });
      }
    },
    pseMove: (el, d) => _pseMove(_pseRoot(el), _pseIdx(el), Number(d) || 0),
    pseDetail: (el) => {
      const root = _pseRoot(el);
      const i = _pseIdx(el);
      const s = root._ps.steps[i];
      const li = el.closest('.pse-step');
      const ta = li.querySelector('.pse-detail');
      if (ta.hidden) {
        s.open = true;
        ta.hidden = false;
        li.classList.add('has-detail');
        el.classList.add('is-on');
        _pseGrow(ta);
        ta.focus();
      } else if (!String(s.detail || '').trim()) {
        s.open = false;
        ta.hidden = true;
        li.classList.remove('has-detail');
        el.classList.remove('is-on');
      } else {
        ta.focus();
      }
    },
    // Execução
    psRun: (el, id) => openProcedureRunner(el.dataset.kind === 'tpl' ? 'tpl' : 'proc', id),
    psCopy: (_el, v) => _psCopyText(v, 'Copiado: ' + v),
    psrToggle: (_el, i) => {
      const s = _psrState;
      if (!s) return;
      const n = Number(i);
      if (s.done.has(n)) s.done.delete(n); else s.done.add(n);
      _psrSaveDone();
      _psrPaint(false);
    },
    psrNext: (el) => {
      const s = _psrState;
      if (!s) return;
      if (el.dataset.mode === 'close') { closeModal(); return; }
      const cur = _psrCurrent();
      if (cur >= 0) s.done.add(cur);
      _psrSaveDone();
      _psrPaint(true);
      const next = document.querySelector('#modalBody .psr-next');
      if (next) next.focus();
    },
    psrReset: () => {
      if (!_psrState) return;
      _psrState.done.clear();
      _psrSaveDone();
      _psrPaint(true);
    },
    psrCopy: () => { if (_psrState) _psCopyText(_psrSummary(), 'Resumo copiado.'); },
    psrEdit: () => {
      const s = _psrState;
      if (!s) return;
      if (s.kind === 'tpl') { if (typeof openTemplateForm === 'function') openTemplateForm(s.id); return; }
      if (s.item.clientId && typeof openProcedureForm === 'function') openProcedureForm(s.item.clientId, s.id);
      else if (typeof openKbArticleForm === 'function') openKbArticleForm(s.id);
    },
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { procParseSteps, procSerializeSteps, procStepsFromPaste, procInlineHtml, procReadHtml };
}
