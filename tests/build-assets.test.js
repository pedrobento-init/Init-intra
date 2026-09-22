import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { buildAssets, shortHash, parseLocalScripts } = require('../tools/build-assets.js');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intra-build-'));
  fs.mkdirSync(path.join(dir, 'js'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'css'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'),
    '<html><head><link rel="stylesheet" href="css/styles.css" /></head><body>\n' +
    '<script src="https://cdn.jsdelivr.net/npm/x@1/x.min.js"></script>\n' +
    '<script defer src="js/a.js"></script>\n' +
    '<script defer src="js/b.js"></script>\n</body></html>');
  fs.writeFileSync(path.join(dir, 'js', 'a.js'), 'function hello(){ return 1; }\n');
  fs.writeFileSync(path.join(dir, 'js', 'b.js'), 'function world(){ return hello() + 1; }\n');
  fs.writeFileSync(path.join(dir, 'css', 'styles.css'), '.a { color: red; }\n');
  fs.writeFileSync(path.join(dir, 'sw.js'),
    "const CACHE_NAME = 'init-intra-vX';\nconst CDN_CACHE_NAME = 'init-intra-cdn-vX';\nconst STATIC_ASSETS = [\n  '/',\n  'index.html'\n];\n");
  return dir;
}

describe('build-assets', () => {
  it('parseia só scripts locais (ignora CDN)', () => {
    expect(parseLocalScripts('<script src="https://x/y.js"></script><script defer src="js/a.js"></script>'))
      .toEqual(['js/a.js']);
  });
  it('gera dist com hash, reescreve index.html e sw.js (dry)', async () => {
    const dir = fixture();
    const r = await buildAssets(dir, { check: true });
    // manifest cobre os 2 js + css
    expect(Object.keys(r.manifest.js).sort()).toEqual(['js/a.js', 'js/b.js']);
    expect(Object.keys(r.manifest.css)).toEqual(['css/styles.css']);
    // nada escrito em modo check
    expect(fs.existsSync(path.join(dir, 'dist'))).toBe(false);
    // index.html reescrito aponta p/ dist com hash
    expect(r.indexHtml).toContain('dist/js/a.');
    expect(r.indexHtml).toContain('.min.js');
    expect(r.indexHtml).toContain('https://cdn.jsdelivr.net/npm/x@1/x.min.js');
    expect(r.indexHtml).not.toContain('src="js/a.js"');
    // sw.js com tag nova e assets dist
    expect(r.sw).toContain('init-intra-' + r.buildTag);
    expect(r.sw).toContain('dist/js/b.');
    expect(r.sw).not.toContain('init-intra-vX');
  });
  it('escreve arquivos reais fora do dry', async () => {
    const dir = fixture();
    const r = await buildAssets(dir, {});
    const outJs = path.join(dir, r.manifest.js['js/a.js']);
    expect(fs.existsSync(outJs)).toBe(true);
    const code = fs.readFileSync(outJs, 'utf8');
    // minificado (1 linha) e global preservado
    expect(code.trim().includes('\n')).toBe(false);
    expect(code).toContain('hello');
    // index.html e sw.js do fixture foram reescritos
    expect(fs.readFileSync(path.join(dir, 'index.html'), 'utf8')).toContain('dist/js/a.');
    expect(r.warnings).toEqual([]);
  });
  it('shortHash estável e curto', () => {
    expect(shortHash('x')).toHaveLength(8);
    expect(shortHash('x')).toBe(shortHash('x'));
  });
});
