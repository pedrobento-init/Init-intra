// Estilo dinâmico sem o atributo style (CSP: style-src-attr 'none').
//
// O CSP bloqueia o atributo style no markup (innerHTML, setAttribute), mas não bloqueia
// a CSSOM (el.style.setProperty). Cor de cliente, % de progresso e variáveis como
// --c dependem de dado, então não viram classe: o template escreve
// data-sty="--c:#1a56db;width:40%" e este arquivo aplica as declarações via CSSOM
// assim que o nó entra no documento (MutationObserver roda antes da pintura).
//
// Segurança: o valor vem de dado de usuário (já passado por escapeHtml no template).
// Aqui ainda se descarta url(), expression(), @import, chaves e barras invertidas,
// para que um valor malformado não vire exfiltração por CSS nem quebre outra regra.

const _STY_PROP = /^(--[a-zA-Z0-9_-]+|[a-z]+(-[a-z]+)*)$/;
const _STY_PERIGO = /url\s*\(|expression\s*\(|@import|[{}\\<>]|javascript:|behavior:/i;

function _estiloDinamicoAplicar(el) {
  const raw = el.getAttribute('data-sty');
  if (!raw) return;
  // ';' dentro de parênteses (rgba(...)) não separa declarações.
  let depth = 0;
  let cur = '';
  const decls = [];
  for (const ch of raw) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ';' && depth === 0) {
      decls.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  decls.push(cur);
  for (const d of decls) {
    const i = d.indexOf(':');
    if (i < 1) continue;
    const prop = d.slice(0, i).trim();
    let val = d.slice(i + 1).trim();
    if (!val || val.length > 300 || !_STY_PROP.test(prop) || _STY_PERIGO.test(val)) continue;
    let prio = '';
    if (/\s*!important$/i.test(val)) {
      val = val.replace(/\s*!important$/i, '');
      prio = 'important';
    }
    el.style.setProperty(prop, val, prio);
  }
}

function _estiloDinamicoVarrer(root) {
  if (root.nodeType !== 1) return;
  if (root.hasAttribute('data-sty')) _estiloDinamicoAplicar(root);
  const filhos = root.querySelectorAll('[data-sty]');
  for (let i = 0; i < filhos.length; i++) _estiloDinamicoAplicar(filhos[i]);
}

if (typeof document !== 'undefined' && typeof MutationObserver === 'function') {
  _estiloDinamicoVarrer(document.documentElement);
  new MutationObserver((muts) => {
    for (const m of muts) m.addedNodes.forEach(_estiloDinamicoVarrer);
  }).observe(document.documentElement, { childList: true, subtree: true });
}
