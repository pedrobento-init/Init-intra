import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
const require = createRequire(import.meta.url);

// operadores.js é script global (sem export): roda num contexto isolado com o
// mínimo que o topo do arquivo precisa, e as funções puras saem pelo contexto.
const ctx = vm.createContext({
  escapeHtml: (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    ),
  console,
  window: {},
  debounce: (f) => f,
  document: { addEventListener() {}, getElementById: () => null },
});
vm.runInContext(fs.readFileSync('js/operadores.js', 'utf8'), ctx, { filename: 'operadores.js' });

const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';

describe('opFotoSegura', () => {
  it('aceita data URL raster (jpeg, png, webp)', () => {
    expect(ctx.opFotoSegura(JPEG)).toBe(JPEG);
    expect(ctx.opFotoSegura('data:image/png;base64,iVBORw0KGgo=')).not.toBe('');
    expect(ctx.opFotoSegura('data:image/webp;base64,UklGRg==')).not.toBe('');
  });

  it('recusa SVG, URL remota, javascript: e vazio', () => {
    expect(ctx.opFotoSegura('data:image/svg+xml;base64,PHN2Zz4=')).toBe('');
    expect(ctx.opFotoSegura('https://exemplo.com/a.jpg')).toBe('');
    expect(ctx.opFotoSegura('javascript:alert(1)')).toBe('');
    expect(ctx.opFotoSegura(null)).toBe('');
  });

  it('recusa aspas e marcação no corpo (não escapa do atributo src)', () => {
    expect(ctx.opFotoSegura('data:image/jpeg;base64,AAA" onerror="alert(1)')).toBe('');
  });

  it('respeita o teto de tamanho do CHECK da migration 084', () => {
    const grande = 'data:image/jpeg;base64,' + 'A'.repeat(150000);
    expect(ctx.opFotoSegura(grande)).toBe('');
  });
});

describe('opFotoRecorte', () => {
  it('imagem larga corta as laterais, centralizado', () => {
    expect(ctx.opFotoRecorte(400, 200)).toEqual({ sx: 100, sy: 0, lado: 200 });
  });
  it('imagem alta corta em cima e embaixo', () => {
    expect(ctx.opFotoRecorte(200, 301)).toEqual({ sx: 0, sy: 50, lado: 200 });
  });
  it('quadrada não corta nada', () => {
    expect(ctx.opFotoRecorte(300, 300)).toEqual({ sx: 0, sy: 0, lado: 300 });
  });
});

describe('opAvatarFoto', () => {
  it('sem foto válida devolve vazio (o chamador cai nas iniciais)', () => {
    expect(ctx.opAvatarFoto({ photo: '' })).toBe('');
    expect(ctx.opAvatarFoto({ photo: 'https://x/y.jpg' })).toBe('');
    expect(ctx.opAvatarFoto(null)).toBe('');
  });
  it('com foto válida devolve <img>', () => {
    expect(ctx.opAvatarFoto({ photo: JPEG })).toContain('<img class="op-avatar-img" src="' + JPEG);
  });
});

describe('opForcaSenha', () => {
  it('vazia é 0 e menor que 8 nunca passa de fraca', () => {
    expect(ctx.opForcaSenha('')).toBe(0);
    expect(ctx.opForcaSenha('Ab1!')).toBe(1);
  });
  it('cresce com tamanho, caixa mista e símbolo+número', () => {
    expect(ctx.opForcaSenha('abcdefgh')).toBe(1);
    expect(ctx.opForcaSenha('Abcdefgh')).toBe(2);
    expect(ctx.opForcaSenha('Abcdefg1!xyz')).toBe(4);
  });
});

describe('foto no sync de operadores (schema.js)', () => {
  const { ENTITIES: SCHEMA } = require('../js/schema.js');
  const ent = SCHEMA.find((e) => e.table === 'operators');
  const base = { id: 'OP-1', name: 'Ana', initials: 'AN', color: '#111', team: 'init' };

  it('sem foto, o upsert NÃO leva a coluna photo (banco sem a migration 084 segue salvando)', () => {
    expect(ent.buildUpsert(base)).not.toHaveProperty('photo');
  });
  it('com foto, leva; removida (null), manda null para limpar no servidor', () => {
    expect(ent.buildUpsert({ ...base, photo: JPEG }).photo).toBe(JPEG);
    expect(ent.buildUpsert({ ...base, photo: null })).toHaveProperty('photo', null);
  });
  it('mapRow só cria a chave photo quando o servidor manda foto', () => {
    expect(ent.mapRow({ id: 'OP-1', name: 'Ana', photo: null })).not.toHaveProperty('photo');
    expect(ent.mapRow({ id: 'OP-1', name: 'Ana', photo: JPEG }).photo).toBe(JPEG);
  });
});
