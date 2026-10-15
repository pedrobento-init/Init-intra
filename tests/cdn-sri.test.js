import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// SRI (Subresource Integrity): todo <script> externo precisa de integrity +
// crossorigin, senão um CDN comprometido executa no contexto do app.
// Regressão: motion@13.1.1 entrou sem integrity (auditoria SEC-04).
const html = fs.readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');

function externalScripts(source) {
  const out = [];
  const re = /<script\b([^>]*)\bsrc="([^"]+)"([^>]*)>/g;
  let m;
  while ((m = re.exec(source))) {
    const attrs = (m[1] || '') + ' ' + (m[3] || '');
    if (!/^https?:\/\//.test(m[2])) continue;
    out.push({
      src: m[2],
      integrity: /(?:^|\s)integrity="([^"]+)"/.exec(attrs)?.[1] || '',
      crossorigin: /(?:^|\s)crossorigin(?:[=>\s]|$)/.test(attrs),
    });
  }
  return out;
}

describe('SRI dos scripts de terceiros no index.html', () => {
  const scripts = externalScripts(html);

  it('há scripts externos para validar', () => {
    expect(scripts.length).toBeGreaterThanOrEqual(5);
  });

  it('todos declaram integrity sha384-...', () => {
    for (const s of scripts) {
      expect(s.integrity, s.src).toMatch(/^sha384-[A-Za-z0-9+/=]+$/);
    }
  });

  it('todos declaram crossorigin (obrigatório p/ SRI em CDN)', () => {
    for (const s of scripts) {
      expect(s.crossorigin, s.src).toBe(true);
    }
  });
});
