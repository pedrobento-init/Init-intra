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
