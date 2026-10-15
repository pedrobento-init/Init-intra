import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

// plural() vive em ui.js (script global); extrai só a função para testar.
const src = fs.readFileSync('js/ui.js', 'utf8');
const fnSrc = src.match(/function plural\([\s\S]*?\n\}/)[0];
const plural = new Function(fnSrc + '; return plural;')();

describe('plural (pt-BR)', () => {
  it('singular só para 1', () => {
    expect(plural(1, 'pendência', 'pendências')).toBe('1 pendência');
  });

  it('0 e >1 no plural', () => {
    expect(plural(0, 'pendência', 'pendências')).toBe('0 pendências');
    expect(plural(3, 'nota', 'notas')).toBe('3 notas');
  });

  it('valor inválido vira 0', () => {
    expect(plural(undefined, 'linha', 'linhas')).toBe('0 linhas');
  });
});

describe('textos sem "(s)"', () => {
  it('nenhuma mensagem de UI usa o sufixo "(s)" após palavra', () => {
    const files = fs.readdirSync('js').filter((f) => f.endsWith('.js'));
    const offenders = [];
    for (const f of files) {
      fs.readFileSync('js/' + f, 'utf8').split('\n').forEach((line, i) => {
        if (/console\.|^\s*\*|^\s*\/\//.test(line)) return; // logs e comentários
        // Só conta "(s)" dentro de string (aspas/crase abertas antes dele),
        // para não pegar chamadas como escapeHtml(s).
        const re = /(?:^|[^\wà-ú])[a-zà-ú]+\(s\)/g; // palavra minúscula inteira (não String(s))
        let m;
        while ((m = re.exec(line))) {
          const before = line.slice(0, m.index);
          const inStr = (before.split('`').length - 1) % 2 === 1 || (before.split("'").length - 1) % 2 === 1;
          if (inStr) { offenders.push(`${f}:${i + 1}`); break; }
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
