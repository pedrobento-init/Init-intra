// actions.js — Eventos por delegação (sem onclick no HTML).
// =====================================================================
// Por quê: atributos on* (onclick e afins) no HTML obrigam o CSP a liberar 'unsafe-inline',
// o que anula a principal proteção contra XSS. Aqui um ouvinte por tipo de
// evento no documento lê o atributo do elemento e chama uma ação
// REGISTRADA (lista fechada — nada de chamar função global pelo nome).
//
//   <button data-action="nav" data-arg="prazos">           → clique
//   <select data-change="setTipo">                           → change (recebe el.value)
//   <input data-input="buscar">                              → input (recebe el.value)
//   <form data-submit="salvar">                              → submit (preventDefault automático)
//   data-stop="1"                                            → não propaga para o pai
//
// A conversão é gradual (tela por tela). Quando não restar nenhum handler
// inline, o CSP pode tirar 'unsafe-inline' de script-src (vercel.json).

const _actions = Object.create(null);

/** Registra ações: { nome: (el, arg, ev) => ... }. */
function registerActions(map) {
  for (const k of Object.keys(map || {})) {
    if (typeof map[k] === 'function') _actions[k] = map[k];
  }
}

function _runAction(name, el, arg, ev) {
  const fn = _actions[name];
  if (!fn) { if (typeof _logSilent === 'function') _logSilent(new Error('ação não registrada: ' + name), 'actions'); return; }
  try { fn(el, arg, ev); } catch (e) { if (typeof _logSilent === 'function') _logSilent(e, 'action:' + name); else throw e; }
}

if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('click', (ev) => {
    const el = ev.target && ev.target.closest ? ev.target.closest('[data-action]') : null;
    if (!el || el.disabled) return;
    if (el.tagName === 'A' && el.getAttribute('href') === '#') ev.preventDefault();
    if (el.dataset.stop) ev.stopPropagation();
    _runAction(el.dataset.action, el, el.dataset.arg, ev);
  });
  // Teclado: elementos não-botão com data-action (ex.: <a role="link">) respondem a Enter/Espaço.
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const el = ev.target && ev.target.closest ? ev.target.closest('[data-action]') : null;
    if (!el || el.tagName === 'BUTTON' || el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') return;
    ev.preventDefault();
    _runAction(el.dataset.action, el, el.dataset.arg, ev);
  });
  // Cards e linhas clicáveis (role="button" com onclick) respondem a Enter/Espaço como um botão.
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const t = ev.target;
    if (!t || !t.getAttribute || t.getAttribute('role') !== 'button' || t.hasAttribute('data-action')) return;
    if (/^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
    ev.preventDefault();
    t.click();
  });
  document.addEventListener('change', (ev) => {
    const el = ev.target && ev.target.closest ? ev.target.closest('[data-change]') : null;
    if (el) _runAction(el.dataset.change, el, el.type === 'checkbox' ? el.checked : el.value, ev);
  });
  document.addEventListener('input', (ev) => {
    const el = ev.target && ev.target.closest ? ev.target.closest('[data-input]') : null;
    if (el) _runAction(el.dataset.input, el, el.value, ev);
  });
  document.addEventListener('submit', (ev) => {
    const el = ev.target && ev.target.closest ? ev.target.closest('[data-submit]') : null;
    if (!el) return;
    ev.preventDefault();
    _runAction(el.dataset.submit, el, el.dataset.arg, ev);
  });
}

// Ações básicas, usadas em várias telas.
registerActions({
  nav: (_el, page) => { if (typeof navigateTo === 'function') navigateTo(page); },
  openPendencia: (_el, id) => { if (typeof openPendenciaDetail === 'function') openPendenciaDetail(id); },
  openVisit: (_el, id) => { if (typeof openVisitDetail === 'function') openVisitDetail(id); },
  openClient: (_el, id) => { if (typeof viewClient === 'function') viewClient(id); },
  newVisit: () => { if (typeof openVisitForm === 'function') openVisitForm(); },
  newPendencia: () => { if (typeof openPendenciaForm === 'function') openPendenciaForm(); },
  closeModal: () => { if (typeof closeModal === 'function') closeModal(); },
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { registerActions, _actions };
}
