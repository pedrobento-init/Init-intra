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
    const t = ev.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return; // digitando
    const el = t && t.closest ? t.closest('[data-action]') : null;
    if (!el || el.tagName === 'BUTTON' || el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') return;
    ev.preventDefault();
    _runAction(el.dataset.action, el, el.dataset.arg, ev);
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

// Moldura do app (index.html): topo, menu, busca e modais fixos.
// data-arg="closeMore" fecha o menu "Mais ações" depois de agir.
const _actCall = (name, ...args) => { if (typeof globalThis[name] === 'function') return globalThis[name](...args); };
const _thenCloseMore = (fn) => (el, arg, ev) => { fn(el, arg, ev); if (arg === 'closeMore') _actCall('closeTopbarMoreMenu'); };
registerActions({
  focusContent: () => { const c = document.getElementById('contentArea'); if (c) c.focus(); },
  openSearch: () => _actCall('openGlobalSearch'),
  closeSearch: () => _actCall('closeGlobalSearch'),
  closeSearchOverlay: (_el, _arg, ev) => _actCall('closeGlobalSearch', ev),
  teamChange: (_el, value) => _actCall('onTeamChange', value),
  logout: () => _actCall('doLogout'),
  syncNow: () => _actCall('syncNow'),
  topbarMore: (_el, _arg, ev) => _actCall('toggleTopbarMoreMenu', ev),
  topbarAction: _thenCloseMore(() => _actCall('topbarAction')),
  notifSettings: _thenCloseMore(() => _actCall('openNotifSettings')),
  refreshPage: _thenCloseMore(() => _actCall('refreshPage')),
  themeToggle: _thenCloseMore(() => { const b = document.getElementById('themeToggleBtn'); if (b) b.click(); }),
  mobileMenu: () => { const b = document.getElementById('mobileMenuBtn'); if (b) b.click(); },
  hideOverlay: (_el, id) => { const o = document.getElementById(id); if (o) o.style.display = 'none'; },
  saveUserConfig: () => _actCall('saveUserConfig'),
  closeCrop: () => _actCall('closeCropModal'),
  applyCrop: () => _actCall('applyCrop'),
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { registerActions, _actions };
}
