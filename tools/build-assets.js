// tools/build-assets.js — monta o site publicado em build/ (minify + hash)
// =====================================================================
// Roda no build da Vercel DEPOIS do build-config.js:
//   "build": "node tools/build-config.js && node tools/build-assets.js"
//
// Gera TUDO dentro de build/ (a Vercel publica só essa pasta —
// vercel.json → outputDirectory). Os arquivos-fonte do repositório nunca
// são reescritos, então rodar o build localmente é inofensivo:
//   build/index.html                 (src locais → assets com hash)
//   build/sw.js                      (STATIC_ASSETS → assets + CACHE_NAME do build)
//   build/assets/js/<nome>.<hash8>.min.js   (terser; toplevel:false p/ preservar
//                                            os globais — o app não usa módulos)
//   build/assets/css/<nome>.<hash8>.css
//   build/<ícones, logo, manifest.json>
// Antes do build a pasta é zerada (nada de hash antigo acumulado).
//
// `node tools/build-assets.js --check` valida sem escrever nada.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const OUT_DIR = 'build';
// Arquivos da raiz servidos como estão (ícones, logo, manifesto do PWA).
const STATIC_FILES = ['manifest.json', 'icon.svg', 'icon-192.png', 'icon-512.png', 'logo-initnet.svg', 'logo-initnet.jpg'];

function shortHash(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8);
}

function parseLocalScripts(indexHtml) {
  const out = [];
  const re = /<script[^>]*\bsrc="(js\/[^"]+\.js)"[^>]*>/g;
  let m;
  while ((m = re.exec(indexHtml))) out.push(m[1]);
  return out;
}

function parseLocalCss(indexHtml) {
  const out = [];
  const re = /<link[^>]*\bhref="(css\/[^"]+\.css)"[^>]*>/g;
  let m;
  while ((m = re.exec(indexHtml))) out.push(m[1]);
  return out;
}

async function minifyJs(code, filename) {
  let terser;
  try {
    terser = require('terser');
  } catch (_) {
    return { code, minified: false };
  }
  const res = await terser.minify({ [filename]: code }, {
    // toplevel:false = nomes globais (funções/consts entre arquivos) intactos.
    compress: { passes: 2 },
    mangle: true,
    format: { comments: false },
  });
  if (res.error) throw new Error('terser ' + filename + ': ' + (res.error.message || res.error));
  return { code: res.code, minified: true };
}

async function buildAssets(rootDir, opts) {
  const root = rootDir || process.cwd();
  const dry = !!(opts && opts.check);
  const out = path.join(root, OUT_DIR);
  const warnings = [];
  const manifest = { js: {}, css: {} };
  const files = {}; // caminho em build/ → conteúdo

  const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const scripts = parseLocalScripts(indexHtml);
  const cssFiles = parseLocalCss(indexHtml);

  // 1. JS → assets/js/<base>.<hash>.min.js
  for (const rel of scripts) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) { warnings.push('ausente (link mantido): ' + rel); continue; }
    const { code, minified } = await minifyJs(fs.readFileSync(abs, 'utf8'), rel);
    if (!minified) warnings.push('terser indisponível, copiado sem minify: ' + rel);
    const outRel = 'assets/js/' + path.basename(rel, '.js') + '.' + shortHash(code) + '.min.js';
    manifest.js[rel] = outRel;
    files[outRel] = code;
  }

  // 2. CSS → assets/css/<base>.<hash>.css (só hash, sem minify)
  for (const rel of cssFiles) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) { warnings.push('ausente (link mantido): ' + rel); continue; }
    const src = fs.readFileSync(abs);
    const outRel = 'assets/css/' + path.basename(rel, '.css') + '.' + shortHash(src) + '.css';
    manifest.css[rel] = outRel;
    files[outRel] = src;
  }

  // 3. index.html com os assets do build
  let outIndex = indexHtml;
  for (const [rel, hashed] of Object.entries(manifest.js)) outIndex = outIndex.split('src="' + rel + '"').join('src="' + hashed + '"');
  for (const [rel, hashed] of Object.entries(manifest.css)) outIndex = outIndex.split('href="' + rel + '"').join('href="' + hashed + '"');
  files['index.html'] = outIndex;

  // 4. sw.js: STATIC_ASSETS → assets do build + CACHE_NAME com hash do build
  const staticPresent = STATIC_FILES.filter((f) => fs.existsSync(path.join(root, f)));
  const hashedAssets = ['/', 'index.html']
    .concat(Object.values(manifest.css))
    .concat(Object.values(manifest.js))
    .concat(staticPresent.filter((f) => f !== 'logo-initnet.jpg' && f !== 'icon-512.png'));
  const buildTag = shortHash(hashedAssets.join('\n'));
  const swSrc = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const outSw = swSrc
    .replace(/const CACHE_NAME = '[^']*';/, "const CACHE_NAME = 'init-intra-" + buildTag + "';")
    .replace(/const CDN_CACHE_NAME = '[^']*';/, "const CDN_CACHE_NAME = 'init-intra-cdn-" + buildTag + "';")
    .replace(/const STATIC_ASSETS = \[[\s\S]*?\];/, 'const STATIC_ASSETS = [\n' + hashedAssets.map((a) => "  '" + a + "'").join(',\n') + '\n];');
  if (outSw === swSrc) throw new Error('sw.js: blocos CACHE_NAME/STATIC_ASSETS não encontrados');
  files['sw.js'] = outSw;

  // 5. Estáticos copiados como estão
  for (const f of staticPresent) files[f] = fs.readFileSync(path.join(root, f));

  if (!dry) {
    fs.rmSync(out, { recursive: true, force: true }); // pasta zerada: sem hash antigo
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(out, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
  }
  return { manifest, hashedAssets, buildTag, warnings, files: Object.keys(files), indexHtml: outIndex, sw: outSw, outDir: OUT_DIR };
}

if (require.main === module) {
  const check = process.argv.includes('--check');
  buildAssets(process.cwd(), { check })
    .then((r) => {
      console.log('✅ build-assets ' + (check ? '(check)' : 'ok') + ': ' + Object.keys(r.manifest.js).length + ' js, ' + Object.keys(r.manifest.css).length + ' css, tag ' + r.buildTag + ' → ' + r.outDir + '/');
      r.warnings.forEach((w) => console.warn('⚠️ ' + w));
    })
    .catch((e) => { console.error('❌ build-assets:', e.message); process.exit(1); });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildAssets, shortHash, parseLocalScripts, OUT_DIR };
}
