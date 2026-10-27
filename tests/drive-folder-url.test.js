import { createRequire as __partsReq } from 'node:module';
const { requireParts, partsSource } = __partsReq(import.meta.url)('./_parts.cjs');
import { describe, it, expect, beforeEach } from 'vitest';

const ID = '1a2B3cD4eF5gH6iJ7kL8mN9oP0qR';
const BASE = 'https://drive.google.com/drive/folders/';

describe('parseDriveFolderId', () => {
  let mod;
  beforeEach(() => { mod = requireParts('clients'); });

  it('extrai o ID com query, com barra final e na forma /u/<n>/', () => {
    expect(mod.parseDriveFolderId(BASE + ID)).toBe(ID);
    expect(mod.parseDriveFolderId(BASE + ID + '?usp=drive_link')).toBe(ID);
    expect(mod.parseDriveFolderId(BASE + ID + '/')).toBe(ID);
    expect(mod.parseDriveFolderId('https://drive.google.com/drive/u/0/folders/' + ID)).toBe(ID);
  });

  it('aceita o ID colado cru', () => {
    expect(mod.parseDriveFolderId(ID)).toBe(ID);
  });

  it('recusa arquivo, planilha, outro domínio, vazio e nulo', () => {
    expect(mod.parseDriveFolderId('https://drive.google.com/file/d/' + ID + '/view')).toBeNull();
    expect(mod.parseDriveFolderId('https://docs.google.com/spreadsheets/d/' + ID + '/edit')).toBeNull();
    expect(mod.parseDriveFolderId('https://example.com/pasta')).toBeNull();
    expect(mod.parseDriveFolderId('')).toBeNull();
    expect(mod.parseDriveFolderId(null)).toBeNull();
    expect(mod.parseDriveFolderId(undefined)).toBeNull();
  });

  it('recusa entrada com aspa, sinal de menor ou espaço — o vetor do SEC-18', () => {
    expect(mod.parseDriveFolderId(BASE + ID + '" onmouseover=alert(1) x="')).toBeNull();
    expect(mod.parseDriveFolderId(BASE + '<script>')).toBeNull();
    expect(mod.parseDriveFolderId(ID + ' ' + ID)).toBeNull();
  });
});

describe('driveFolderUrl', () => {
  let mod;
  beforeEach(() => { mod = requireParts('clients'); });

  it('remonta a URL pelo ID e descarta o que foi colado', () => {
    expect(mod.driveFolderUrl('https://drive.google.com/drive/u/3/folders/' + ID + '?usp=sharing'))
      .toBe(BASE + ID);
  });

  it('devolve vazio quando inválido', () => {
    expect(mod.driveFolderUrl('https://example.com/x')).toBe('');
    expect(mod.driveFolderUrl('')).toBe('');
  });
});

describe('saveDriveFolderLink', () => {
  let mod;
  beforeEach(() => {
    mod = requireParts('clients');
    global.getClientById = () => ({ id: 'cli-1', name: 'ACME' });
  });

  it('recusa quem não é admin', () => {
    global.isCurrentAdmin = () => false;
    const r = mod.saveDriveFolderLink('cli-1', BASE + ID);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/administrador/i);
  });

  it('recusa link inválido mesmo para admin', () => {
    global.isCurrentAdmin = () => true;
    expect(mod.saveDriveFolderLink('cli-1', 'https://example.com/x').ok).toBe(false);
  });

  it('salva a URL canônica, não a colada', () => {
    global.isCurrentAdmin = () => true;
    let salvo = null;
    global.saveClient = (c) => { salvo = c; };
    const r = mod.saveDriveFolderLink('cli-1', 'https://drive.google.com/drive/u/2/folders/' + ID + '?usp=sharing');
    expect(r.ok).toBe(true);
    expect(salvo.driveFolderUrl).toBe(BASE + ID);
  });

  it('campo vazio desvincula', () => {
    global.isCurrentAdmin = () => true;
    let salvo = null;
    global.saveClient = (c) => { salvo = c; };
    expect(mod.saveDriveFolderLink('cli-1', '  ').ok).toBe(true);
    expect(salvo.driveFolderUrl).toBeNull();
  });
});
