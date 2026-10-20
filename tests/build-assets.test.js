import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { buildAssets, shortHash, parseLocalScripts, minifyCss } = require('../tools/build-assets.js');

const INDEX = '<html><head><link rel="stylesheet" href="css/styles.css" /></head><body>\n' +
  '<script src="https://cdn.jsdelivr.net/npm/x@1/x.min.js"></script>\n' +
  '<script defer src="js/a.js"></script>\n' +
  '<script defer src="js/b.js"></script>\n</body></html>';
const SW = "const CACHE_NAME = 'init-intra-vX';\nconst CDN_CACHE_NAME = 'init-intra-cdn-vX';\nconst STATIC_ASSETS = [\n  '/',\n  'index.html'\n];\n";

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intra-build-'));
  fs.mkdirSync(path.join(dir, 'js'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'css'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), INDEX);
  fs.writeFileSync(path.join(dir, 'js', 'a.js'), 'function hello(){ return 1; }\n');
  fs.writeFileSync(path.join(dir, 'js', 'b.js'), 'function world(){ return hello() + 1; }\n');
  fs.writeFileSync(path.join(dir, 'css', 'styles.css'), '.a { color: red; }\n');
  fs.writeFileSync(path.join(dir, 'sw.js'), SW);
  fs.writeFileSync(path.join(dir, 'manifest.json'), '{}');
  fs.writeFileSync(path.join(dir, 'icon.svg'), '<svg/>');
  return dir;
}

describe('build-assets', () => {
  it('parseia só scripts locais (ignora CDN)', () => {
    expect(parseLocalScripts('<script src="https://x/y.js"></script><script defer src="js/a.js"></script>'))
      .toEqual(['js/a.js']);
  });

  it('modo check: monta o resultado sem escrever nada', async () => {
    const dir = fixture();
    const r = await buildAssets(dir, { check: true });
    expect(Object.keys(r.manifest.js).sort()).toEqual(['js/a.js', 'js/b.js']);
    expect(Object.keys(r.manifest.css)).toEqual(['css/styles.css']);
    expect(fs.existsSync(path.join(dir, 'build'))).toBe(false);
    expect(r.indexHtml).toContain('src="assets/js/a.');
    expect(r.indexHtml).toContain('https://cdn.jsdelivr.net/npm/x@1/x.min.js');
    expect(r.sw).toContain('init-intra-' + r.buildTag);
    expect(r.sw).toContain("'assets/js/b.");
    expect(r.sw).toContain("'manifest.json'");
  });

  it('escreve o site em build/ e NUNCA altera os arquivos-fonte', async () => {
    const dir = fixture();
    const r = await buildAssets(dir, {});
    // fontes intactos (antes o build reescrevia index.html e sw.js no lugar)
    expect(fs.readFileSync(path.join(dir, 'index.html'), 'utf8')).toBe(INDEX);
    expect(fs.readFileSync(path.join(dir, 'sw.js'), 'utf8')).toBe(SW);
    // site completo em build/
    const b = (p) => path.join(dir, 'build', p);
    expect(fs.readFileSync(b('index.html'), 'utf8')).toContain('assets/js/a.');
    expect(fs.readFileSync(b('sw.js'), 'utf8')).toContain('init-intra-' + r.buildTag);
    expect(fs.existsSync(b('manifest.json'))).toBe(true);
    expect(fs.existsSync(b('icon.svg'))).toBe(true);
    const code = fs.readFileSync(b(r.manifest.js['js/a.js']), 'utf8');
    expect(code.trim().includes('\n')).toBe(false); // minificado
    expect(code).toContain('hello'); // global preservado
    expect(r.warnings).toEqual([]);
  });

  it('zera build/ a cada execução (nenhum hash antigo sobra)', async () => {
    const dir = fixture();
    const stale = path.join(dir, 'build', 'assets', 'js', 'a.00000000.min.js');
    fs.mkdirSync(path.dirname(stale), { recursive: true });
    fs.writeFileSync(stale, '// build antigo');
    await buildAssets(dir, {});
    expect(fs.existsSync(stale)).toBe(false);
  });

  it('shortHash estável e curto', () => {
    expect(shortHash('x')).toHaveLength(8);
    expect(shortHash('x')).toBe(shortHash('x'));
  });
});

describe('minifyCss', () => {
  it('tira comentários e espaços sem mudar o significado', () => {
    const src = `/* topo */
.a , .b {
  color : red ;
  margin: 0 auto;  /* fim */
}
@media (max-width: 768px) {
  .c > .d { padding: 4px 8px; }
}
`;
    expect(minifyCss(src)).toBe('.a,.b{color :red;margin:0 auto}@media (max-width:768px){.c > .d{padding:4px 8px}}');
  });

  it('preserva o espaço antes de ":" (seletor descendente), calc e textos entre aspas', () => {
    expect(minifyCss('.x :hover { width: calc(100% - 10px); }')).toBe('.x :hover{width:calc(100% - 10px)}');
    expect(minifyCss('.q::after { content: "a ; b  { c }  /* d */"; font-family: "Open Sans", sans-serif; }'))
      .toBe('.q::after{content:"a ; b  { c }  /* d */";font-family:"Open Sans",sans-serif}');
    expect(minifyCss("a[title='x  y'] { grid-template-areas: 'a b' 'c d'; }")).toBe("a[title='x  y']{grid-template-areas:'a b' 'c d'}");
  });

  it('o build publica o CSS minificado', async () => {
    const dir = fixture();
    const r = await buildAssets(dir, { check: true });
    expect(r.manifest.css['css/styles.css']).toMatch(/^assets\/css\/styles\.[0-9a-f]{8}\.min\.css$/);
  });
});
