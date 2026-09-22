// tools/build-assets.js — minify + hash de conteúdo p/ cache immutable
// =====================================================================
// Roda no build da Vercel DEPOIS do build-config.js:
//   "build": "node tools/build-config.js && node tools/build-assets.js"
//
// Gera (só no output do build — o git/dev local seguem com js/ crus):
//   dist/js/<nome>.<hash8>.min.js   (terser; toplevel:false p/ preservar
//                                    os globais — o app não usa módulos)
//   dist/css/styles.<hash8>.css      (cópia com hash, sem minify)
//   index.html                       (reescrito IN PLACE: src locais → dist)
//   sw.js                            (reescrito IN PLACE: STATIC_ASSETS → dist
//                                    + CACHE_NAME com hash do build)
//
// Desenvolvimento local: rode `node tools/build-assets.js --check` para
// validar sem escrever nada, ou simplesmente não rode (index.html fonte
// referencia js/ e css/ originais).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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
  const warnings = [];
  const manifest = { js: {}, css: {} };

  const indexPath = path.join(root, 'index.html');
  const indexHtml = fs.readFileSync(indexPath, 'utf8');
  const scripts = parseLocalScripts(indexHtml);
  const cssFiles = parseLocalCss(indexHtml);

  // 1. JS → dist/js/<base>.<hash>.min.js
  for (const rel of scripts) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) { warnings.push('ausente (mantido original): ' + rel); continue; }
    const src = fs.readFileSync(abs, 'utf8');
    const { code, minified } = await minifyJs(src, rel);
    if (!minified) warnings.push('terser indisponível, copiado sem minify: ' + rel);
    const h = shortHash(code);
    const base = path.basename(rel, '.js');
    const outRel = 'dist/js/' + base + '.' + h + '.min.js';
    manifest.js[rel] = outRel;
    if (!dry) {
      fs.mkdirSync(path.join(root, 'dist', 'js'), { recursive: true });
      fs.writeFileSync(path.join(root, outRel), code);
    }
  }

  // 2. CSS → dist/css/<base>.<hash>.css (só hash, sem minify)
  for (const rel of cssFiles) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) { warnings.push('ausente (mantido original): ' + rel); continue; }
    const src = fs.readFileSync(abs);
    const h = shortHash(src);
    const base = path.basename(rel, '.css');
    const outRel = 'dist/css/' + base + '.' + h + '.css';
    manifest.css[rel] = outRel;
    if (!dry) {
      fs.mkdirSync(path.join(root, 'dist', 'css'), { recursive: true });
      fs.writeFileSync(path.join(root, outRel), src);
    }
  }

  // 3. index.html reescrito (build-time)
  let outIndex = indexHtml;
  for (const [rel, hashed] of Object.entries(manifest.js)) {
    outIndex = outIndex.split('src="' + rel + '"').join('src="' + hashed + '"');
  }
  for (const [rel, hashed] of Object.entries(manifest.css)) {
    outIndex = outIndex.split('href="' + rel + '"').join('href="' + hashed + '"');
  }

  // 4. sw.js reescrito: STATIC_ASSETS → dist + CACHE_NAME com hash do build
  const swPath = path.join(root, 'sw.js');
  const swSrc = fs.readFileSync(swPath, 'utf8');
  const hashedAssets = ['/', 'index.html']
    .concat(Object.values(manifest.css))
    .concat(Object.values(manifest.js))
    .concat(['manifest.json', 'icon.svg', 'icon-192.png', 'logo-initnet.svg']);
  const buildTag = shortHash(hashedAssets.join('\n'));
  let outSw = swSrc
    .replace(/const CACHE_NAME = '[^']*';/, "const CACHE_NAME = 'init-intra-" + buildTag + "';")
    .replace(/const CDN_CACHE_NAME = '[^']*';/, "const CDN_CACHE_NAME = 'init-intra-cdn-" + buildTag + "';")
    .replace(/const STATIC_ASSETS = \[[\s\S]*?\];/, 'const STATIC_ASSETS = [\n' + hashedAssets.map(a => "  '" + a + "'").join(',\n') + '\n];');
  if (outSw === swSrc) throw new Error('sw.js: blocos CACHE_NAME/STATIC_ASSETS não encontrados');

  if (!dry) {
    fs.writeFileSync(indexPath, outIndex);
    fs.writeFileSync(swPath, outSw);
  }
  return { manifest, hashedAssets, buildTag, warnings, indexHtml: outIndex, sw: outSw };
}

if (require.main === module) {
  const check = process.argv.includes('--check');
  buildAssets(process.cwd(), { check })
    .then((r) => {
      console.log('✅ build-assets ' + (check ? '(check)' : 'ok') + ': ' + Object.keys(r.manifest.js).length + ' js, ' + Object.keys(r.manifest.css).length + ' css, tag ' + r.buildTag);
      r.warnings.forEach((w) => console.warn('⚠️ ' + w));
    })
    .catch((e) => { console.error('❌ build-assets:', e.message); process.exit(1); });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildAssets, shortHash, parseLocalScripts };
}
