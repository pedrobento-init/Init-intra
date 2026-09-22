import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

describe('parseGoogleSheetId', () => {
  let clientsMod;
  beforeEach(() => {
    delete require.cache[require.resolve('../js/clients.js')];
    clientsMod = require('../js/clients.js');
  });
  it('extrai o ID de URLs /edit, /view e com gid', () => {
    expect(clientsMod.parseGoogleSheetId('https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit?usp=sharing')).toBe('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms');
    expect(clientsMod.parseGoogleSheetId('https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/view#gid=0')).toBe('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms');
    expect(clientsMod.parseGoogleSheetId('https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/pubhtml')).toBe('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms');
  });
  it('aceita o ID colado diretamente', () => {
    expect(clientsMod.parseGoogleSheetId('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms')).toBe('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms');
  });
  it('rejeita URLs fora do Sheets e vazio', () => {
    expect(clientsMod.parseGoogleSheetId('https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/view')).toBeNull();
    expect(clientsMod.parseGoogleSheetId('https://example.com/planilha')).toBeNull();
    expect(clientsMod.parseGoogleSheetId('')).toBeNull();
    expect(clientsMod.parseGoogleSheetId(null)).toBeNull();
    expect(clientsMod.parseGoogleSheetId(undefined)).toBeNull();
  });
});

describe('parseGoogleSheetLink (publicado na web)', () => {
  let clientsMod;
  beforeEach(() => {
    delete require.cache[require.resolve('../js/clients.js')];
    clientsMod = require('../js/clients.js');
  });
  it('extrai o ID publicado de URLs /d/e/.../pubhtml (não o literal "e")', () => {
    expect(clientsMod.parseGoogleSheetLink('https://docs.google.com/spreadsheets/d/e/2PACX-1vQAbCdEfGhIjKlMnOpQrStUvWxYz/pubhtml'))
      .toEqual({ kind: 'published', id: '2PACX-1vQAbCdEfGhIjKlMnOpQrStUvWxYz' });
    expect(clientsMod.parseGoogleSheetLink('https://docs.google.com/spreadsheets/d/e/2PACX-1vQAbCdEfGhIjKlMnOpQrStUvWxYz/pubhtml?widget=true'))
      .toEqual({ kind: 'published', id: '2PACX-1vQAbCdEfGhIjKlMnOpQrStUvWxYz' });
  });
  it('parseGoogleSheetId retorna o ID publicado (nunca "e")', () => {
    expect(clientsMod.parseGoogleSheetId('https://docs.google.com/spreadsheets/d/e/2PACX-1vQAbCdEfGhIjKlMnOpQrStUvWxYz/pubhtml'))
      .toBe('2PACX-1vQAbCdEfGhIjKlMnOpQrStUvWxYz');
  });
  it('classifica link de compartilhamento como sheet', () => {
    expect(clientsMod.parseGoogleSheetLink('https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit?usp=sharing'))
      .toEqual({ kind: 'sheet', id: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms' });
  });
});

describe('googleSheetEmbedUrl (publicado na web)', () => {
  let clientsMod;
  beforeEach(() => {
    delete require.cache[require.resolve('../js/clients.js')];
    clientsMod = require('../js/clients.js');
  });
  it('gera pubhtml embed a partir do link publicado', () => {
    expect(clientsMod.googleSheetEmbedUrl('https://docs.google.com/spreadsheets/d/e/2PACX-1vQAbCdEfGhIjKlMnOpQrStUvWxYz/pubhtml'))
      .toBe('https://docs.google.com/spreadsheets/d/e/2PACX-1vQAbCdEfGhIjKlMnOpQrStUvWxYz/pubhtml?widget=true&headers=false');
  });
});
describe('googleSheetEmbedUrl', () => {
  let clientsMod;
  beforeEach(() => {
    delete require.cache[require.resolve('../js/clients.js')];
    clientsMod = require('../js/clients.js');
  });
  it('converte qualquer URL válida para o formato embedded', () => {
    expect(clientsMod.googleSheetEmbedUrl('https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit?usp=sharing'))
      .toBe('https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit?usp=sharing&embedded=true');
  });
  it('retorna vazio quando inválido', () => {
    expect(clientsMod.googleSheetEmbedUrl('https://example.com/x')).toBe('');
    expect(clientsMod.googleSheetEmbedUrl('')).toBe('');
  });
});
