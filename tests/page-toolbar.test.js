import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

// Contrato: toda tela com busca/filtros usa o cabeçalho único .page-toolbar
// (busca .pt-search → filtros .pt-filter → ações .pt-actions à direita).
const screens = {
  'js/pendencias.js': 'penSearch',
  'js/equipamentos.js': 'equipSearch',
  'js/clients.js': 'clientSearch',
  'js/templates.js': 'templateSearch',
  'js/operadores.js': 'opSearch',
  'js/ui.js': 'logSearch',
  'js/milvus-atendimentos.js': 'gAtendCodigo',
  'js/visitas.js': 'visitSearch',
};

describe('cabeçalho de página único', () => {
  for (const [file, searchId] of Object.entries(screens)) {
    it(`${file} usa .page-toolbar com busca .pt-search`, () => {
      const src = fs.readFileSync(file, 'utf8');
      expect(src).toContain('page-toolbar');
      expect(src).toContain('pt-search');
      expect(src).toContain(`id="${searchId}"`); // ids preservados (filtros salvos dependem deles)
    });
  }

  it('ações secundárias ficam em .pt-actions (export/import)', () => {
    for (const f of ['js/clients.js', 'js/equipamentos.js', 'js/ui.js', 'js/milvus-atendimentos.js']) {
      expect(fs.readFileSync(f, 'utf8')).toContain('pt-actions');
    }
  });

  it('CSS do padrão presente (desktop + celular)', () => {
    const css = fs.readFileSync('css/styles.css', 'utf8');
    expect(css).toContain('.page-toolbar > .pt-search');
    expect(css).toContain('.page-toolbar > .pt-actions');
    expect(css).toMatch(/@media \(max-width:768px\)[^]*\.page-toolbar > \.pt-filter \{ flex: 1 1 calc\(50% - 4px\)/);
  });
});
