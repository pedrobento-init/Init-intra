import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import postcss from 'postcss';

// Um "*/" dentro de comentário (ex.: "--ov-*/--kb-*") fecha o comentário
// antes da hora e quebra o resto da folha de estilo — o build passa, mas o
// navegador descarta regras. Este teste falha nesse caso.
describe('css/styles.css', () => {
  it('é CSS válido (sem comentário fechado antes da hora)', () => {
    const css = fs.readFileSync('css/styles.css', 'utf8');
    expect(() => postcss.parse(css)).not.toThrow();
  });
});
