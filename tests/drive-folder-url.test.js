import { createRequire as __partsReq } from 'node:module';
const { requireParts, partsSource } = __partsReq(import.meta.url)('./_parts.cjs');
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// Snapshot antes de qualquer teste: o que é devolvido é exatamente o que
// existia. Chave ausente vira delete — é o padrão de milvus-client-token.test.js.
// O afterEach que devolve vem depois, no passo verde: escrito junto, o teste de
// higiene nasce verde e não prova nada.
const _globalKeys = [
  'getClientById', 'isCurrentAdmin', 'saveClient', 'showToast', 'closeModal',
  'openModal', 'getVisitsByClient', 'getPendenciasByClient', 'document', 'escapeHtml',
  'renderClientDocumentsList', 'renderAttachmentList',
];
const _keep = {};
for (const k of _globalKeys) _keep[k] = globalThis[k];
afterEach(() => {
  for (const k of _globalKeys) {
    if (_keep[k] === undefined) delete globalThis[k];
    else globalThis[k] = _keep[k];
  }
});

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

  it('recusa ID cru de 14 caracteres — o piso é 15', () => {
    expect(mod.parseDriveFolderId(ID.slice(0, 14))).toBeNull();
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

describe('parseDriveFolderId — normalização flexível', () => {
  let mod;
  beforeEach(() => { mod = requireParts('clients'); });

  it('aceita host sem esquema, host em maiúsculas e a forma legada open?id=', () => {
    expect(mod.parseDriveFolderId('drive.google.com/drive/folders/' + ID)).toBe(ID);
    expect(mod.parseDriveFolderId('HTTPS://DRIVE.GOOGLE.COM/drive/folders/' + ID + '/?usp=sharing')).toBe(ID);
    expect(mod.parseDriveFolderId('https://drive.google.com/open?id=' + ID)).toBe(ID);
    expect(mod.parseDriveFolderId('drive.google.com/open?id=' + ID + '&usp=sharing')).toBe(ID);
  });

  it('a normalização preserva a caixa do ID e não abre porteira para não-pasta', () => {
    expect(mod.driveFolderUrl('HTTPS://DRIVE.GOOGLE.COM/drive/folders/' + ID)).toBe(BASE + ID);
    expect(mod.parseDriveFolderId('HTTPS://DRIVE.GOOGLE.COM/file/d/' + ID + '/view')).toBeNull();
    expect(mod.parseDriveFolderId('docs.google.com/spreadsheets/d/' + ID + '/edit')).toBeNull();
    expect(mod.parseDriveFolderId('drive.google.com/drive/folders/' + ID + '" onmouseover=x')).toBeNull();
    expect(mod.parseDriveFolderId('drive.google.com/open?id=' + ID.slice(0, 14))).toBeNull();
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

// Guarda de fonte: o AGENTS.md proíbe handler inline, e a seção vizinha (a da
// planilha) ainda usa onclick. Sem este teste, copiar a vizinha passaria.
// CRLF normalizado — comparação de texto de arquivo quebra em checkout Windows.
describe('seção da pasta na ficha', () => {
  it('não usa onclick e tira o href de driveFolderUrl', () => {
    const src = partsSource('clients').replace(/\r\n/g, '\n');
    const i = src.indexOf('function renderClientDriveSection');
    expect(i).toBeGreaterThan(-1);
    const corpo = src.slice(i, src.indexOf('\n}\n', i) + 3);
    expect(corpo).not.toMatch(/onclick=/);
    expect(corpo).toMatch(/data-action=/);
    expect(corpo).toMatch(/driveFolderUrl\(/);
  });
});

describe('título da seção da pasta', () => {
  it('usa 🗂️ para não repetir o 📁 das Anexos', () => {
    const src = partsSource('clients').replace(/\r\n/g, '\n');
    expect(src).toContain('🗂️ Pasta no Drive');
    expect(src).toContain('📁 Anexos do Cliente');
  });
});

// DOM de mentira no estilo de tests/pen-fila-render.test.js: o que importa é o
// innerHTML que a seção escreve.
// catchAll: devolve um elemento para qualquer id, para o caso em que o teste
// quer deixar o resto da tela funcionar. Sem ele, id desconhecido é null —
// que é o que exercita "o elemento não está no DOM".
function _domFalso(ids, catchAll) {
  const els = {};
  for (const id of ids) els[id] = { innerHTML: '' };
  global.document = {
    getElementById: (id) => els[id] || (catchAll ? (els[id] = {
      innerHTML: '', scrollTop: 0,
      classList: { add() {}, remove() {} },
      querySelector: () => null, querySelectorAll: () => [],
      getAttribute: () => '', setAttribute() {}, addEventListener() {},
    }) : null),
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  global.escapeHtml = (s) => String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  return els;
}

describe('renderClientDriveSection', () => {
  let mod;
  beforeEach(() => { mod = requireParts('clients'); global.isCurrentAdmin = () => false; });

  // Cliente salvo antes da migration 068 não tem o campo: a ficha mostra o
  // estado vazio em vez de quebrar.
  it('cliente sem o campo mostra o estado vazio', () => {
    const els = _domFalso(['cliDriveBody', 'cliDriveActions']);
    global.getClientById = () => ({ id: 'cli-1', name: 'ACME' });
    mod.renderClientDriveSection('cli-1');
    expect(els.cliDriveBody.innerHTML).toMatch(/Nenhuma pasta vinculada/);
    expect(els.cliDriveBody.innerHTML).not.toMatch(/href=/);
  });

  it('cliente com pasta mostra o link canônico', () => {
    const els = _domFalso(['cliDriveBody', 'cliDriveActions']);
    global.getClientById = () => ({ id: 'cli-1', driveFolderUrl: BASE + ID });
    mod.renderClientDriveSection('cli-1');
    expect(els.cliDriveBody.innerHTML).toContain('href="' + BASE + ID + '"');
  });

  // Lixo gravado no campo (por import antigo, por exemplo) não vira href.
  it('valor inválido no campo não gera link', () => {
    const els = _domFalso(['cliDriveBody', 'cliDriveActions']);
    global.getClientById = () => ({ id: 'cli-1', driveFolderUrl: 'https://example.com/x' });
    mod.renderClientDriveSection('cli-1');
    expect(els.cliDriveBody.innerHTML).toMatch(/Nenhuma pasta vinculada/);
  });

  it('não-admin não vê os botões de vincular', () => {
    const els = _domFalso(['cliDriveBody', 'cliDriveActions']);
    global.getClientById = () => ({ id: 'cli-1', driveFolderUrl: BASE + ID });
    mod.renderClientDriveSection('cli-1');
    expect(els.cliDriveActions.innerHTML).toBe('');
  });
});

// O prompt de vincular substitui o #modalBody, que É a ficha do cliente
// (viewClient usa openModal). Depois de salvar, redesenhar a seção não
// funciona: o elemento não existe mais. Tem de reabrir a ficha.
describe('submitDriveFolderLink reabre a ficha', () => {
  let mod;
  beforeEach(() => {
    mod = requireParts('clients');
    global.isCurrentAdmin = () => true;
    global.getClientById = () => ({ id: 'cli-1', name: 'ACME' });
    global.saveClient = () => {};
    global.showToast = () => {};
    global.closeModal = () => {};
  });

  // A espiã é o openModal, que mora no ui.js e portanto é global de verdade:
  // dentro do grupo concatenado, viewClient é declaração de função e não se
  // substitui por global. Reabrir a ficha significa o openModal receber de
  // novo o nome do cliente como título.
  it('salvar leva de volta para a ficha do cliente', async () => {
    const els = _domFalso(['driveLinkInput'], true);
    els.driveLinkInput.value = BASE + ID;
    let titulo = null;
    global.openModal = (t) => { titulo = t; };
    global.getVisitsByClient = () => [];
    global.getPendenciasByClient = () => [];
    // Dois dos quatro renderizadores do timer moram em js/storage-anexos.js,
    // fora do grupo 'clients' que o teste compila: sem o stub, ReferenceError.
    global.renderClientDocumentsList = () => {};
    global.renderAttachmentList = () => {};
    mod.submitDriveFolderLink('cli-1');
    // O viewClient agenda o setTimeout de 20 ms de clients-ficha.js:786, que
    // chama quatro renderizadores. Sem este await o timer disputa com a
    // desmontagem do worker e o erro só aparece em algumas execuções; com ele,
    // o disparo acontece sempre dentro do teste.
    await new Promise((r) => setTimeout(r, 30));
    expect(titulo).toBe('ACME');
  });
});

// Guardas estruturais: não existe harness para saveClient nem para o envio do
// backup, então o que se tranca aqui é a forma do payload. Catch do regresso,
// não prova de comportamento.
describe('a coluna chega ao servidor', () => {
  const lerFonte = (f) => {
    const fs = __partsReq(import.meta.url)('node:fs');
    const path = __partsReq(import.meta.url)('node:path');
    const url = __partsReq(import.meta.url)('node:url');
    const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
    return fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
  };

  // Sem isto, desvincular nunca sai do aparelho: _mapToRemote descarta null em
  // coluna opcional (js/schema.js), então o único caminho que apaga o valor no
  // servidor é este upsert mandar a chave explicitamente.
  it('saveClient manda drive_folder_url quando a chave está presente', () => {
    const src = lerFonte('js/storage-pendencias.js');
    const i = src.indexOf("from('clients').upsert({");
    expect(i).toBeGreaterThan(-1);
    // Até o .then: o payload tem `{}` dentro dos spreads opcionais, então
    // cortar no primeiro `})` pararia antes do fim.
    const payload = src.slice(i, src.indexOf('.then(', i));
    expect(payload).toMatch(/'driveFolderUrl' in data/);
    expect(payload).toMatch(/drive_folder_url/);
  });

  // As migrations são aplicadas à mão: entre o deploy e o SQL Editor, mandar a
  // coluna sem condição faz o envio do backup falhar para TODOS os clientes.
  // O precedente é o address, que fica fora deste payload.
  it('o envio do backup só manda a coluna quando há valor', () => {
    const src = lerFonte('js/app.js');
    const i = src.indexOf("chunk('clients'");
    expect(i).toBeGreaterThan(-1);
    const payload = src.slice(i, src.indexOf('})))', i));
    expect(payload).toMatch(/\.\.\.\(c\.driveFolderUrl \? \{ drive_folder_url/);
  });
});

describe('higiene dos globais', () => {
  it('nenhum global emprestado sobrevive ao teste que o atribuiu', () => {
    for (const k of _globalKeys) expect(globalThis[k]).toBe(_keep[k]);
  });
});
