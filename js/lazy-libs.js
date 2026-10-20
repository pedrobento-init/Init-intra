// ── Bibliotecas carregadas só quando usadas ───────────────────────────────
// SheetJS (861 KB), mammoth (628 KB) e motion (136 KB) saíram do index.html:
// eram baixadas e interpretadas em todo acesso, mas só servem para
// exportar/importar planilha, ler .docx e animar. Mesmo CDN e mesmo SRI
// de antes (tests/cdn-sri.test.js confere).
const LAZY_LIBS = {
  xlsx: {
    src: 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
    integrity: 'sha384-vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw',
    global: 'XLSX',
  },
  mammoth: {
    src: 'https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js',
    integrity: 'sha384-nFoSjZIoH3CCp8W639jJyQkuPHinJ2NHe7on1xvlUA7SuGfJAfvMldrsoAVm6ECz',
    global: 'mammoth',
  },
  motion: {
    src: 'https://cdn.jsdelivr.net/npm/motion@13.1.1/dist/motion.js',
    integrity: 'sha384-H2nNDydHmZprp4CMCumnXEUZpWPr9ifgL1W1PkhJj8awdAZ3QfvsGho12tqLeeBI',
    global: 'Motion',
  },
};

const _lazyLibPending = {};

/** Carrega a biblioteca uma vez (com SRI) e devolve o objeto global dela. */
function loadLib(name) {
  const lib = LAZY_LIBS[name];
  if (!lib) return Promise.reject(new Error('Biblioteca desconhecida: ' + name));
  if (typeof window !== 'undefined' && window[lib.global]) return Promise.resolve(window[lib.global]);
  if (_lazyLibPending[name]) return _lazyLibPending[name];
  _lazyLibPending[name] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = lib.src;
    s.integrity = lib.integrity;
    s.crossOrigin = 'anonymous';
    s.async = true;
    s.onload = () => (window[lib.global] ? resolve(window[lib.global]) : reject(new Error(name + ' carregou sem ' + lib.global)));
    s.onerror = () => {
      delete _lazyLibPending[name];
      s.remove();
      reject(new Error('Não foi possível carregar ' + name + '. Verifique a conexão e tente de novo.'));
    };
    document.head.appendChild(s);
  });
  return _lazyLibPending[name];
}

// Animações: chegam depois que a tela já abriu (até lá, tudo funciona sem elas).
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const _motionLater = () => {
    const reduz = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduz) return; // quem pediu menos movimento não precisa da biblioteca
    loadLib('motion').catch((e) => { if (typeof _logSilent === 'function') _logSilent(e, 'lazy-libs'); });
  };
  window.addEventListener('load', () => {
    if ('requestIdleCallback' in window) window.requestIdleCallback(_motionLater, { timeout: 4000 });
    else setTimeout(_motionLater, 1500);
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LAZY_LIBS, loadLib };
}
