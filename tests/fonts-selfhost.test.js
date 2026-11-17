import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
// Normaliza CRLF: checkout Windows não pode mudar o resultado.
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

describe('fontes auto-hospedadas (PERF-03)', () => {
  const html = read('index.html');
  const vercel = read('vercel.json');
  const sw = read('sw.js');
  const css = read('css/fonts.css');

  it('index.html não carrega nada do Google Fonts e faz preload só da fonte latin', () => {
    expect(html).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
    expect(html).toContain('href="css/fonts.css"');
    const preloads = html.match(/<link[^>]*rel="preload"[^>]*as="font"[^>]*>/g) || [];
    expect(preloads).toHaveLength(1);
    expect(preloads[0]).toContain('fonts/manrope-latin.woff2');
    expect(preloads[0]).toContain('crossorigin'); // sem isso o preload de fonte é descartado
  });

  it('a CSP não libera mais hosts do Google Fonts', () => {
    expect(vercel).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
    expect(vercel).toContain("font-src 'self' data:");
  });

  it('@font-face usa swap e aponta para arquivos woff2 que existem', () => {
    const faces = css.match(/@font-face\s*{[^}]*}/g) || [];
    expect(faces.length).toBeGreaterThanOrEqual(2);
    for (const f of faces) {
      expect(f).toContain('font-display: swap');
      const rel = /url\('\.\.\/(fonts\/[^']+)'\)/.exec(f)[1];
      const buf = fs.readFileSync(path.join(root, rel));
      expect(buf.subarray(0, 4).toString('latin1')).toBe('wOF2');
    }
  });

  it('a licença OFL acompanha as fontes e o SW pré-cacheia css e fontes', () => {
    expect(read('fonts/OFL.txt')).toContain('SIL Open Font License');
    expect(sw).toContain("'css/fonts.css'");
    expect(sw).toContain("'fonts/manrope-latin.woff2'");
    expect(sw).toContain("'fonts/manrope-latin-ext.woff2'");
  });
});
