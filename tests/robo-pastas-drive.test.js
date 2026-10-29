import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// roboPastas roda no Apps Script, onde não há teste. Aqui ele roda de verdade
// contra um DriveApp falso: o que se trava é o comportamento no Drive — vincular,
// criar, renomear, mover e, acima de tudo, nunca apagar nem mexer no que é ambíguo.

const require = createRequire(import.meta.url);
const { criarDrive } = require('./_driveapp.cjs');
const fonte = fs.readFileSync(
  fileURLToPath(new URL('../tools/google-agenda-apps-script/Robo.gs', import.meta.url)), 'utf8');

const ROOT = 'raiz';
let drive, root, logs;

function rodar(plano, { rootId = ROOT } = {}) {
  const ctx = {
    DriveApp: drive.DriveApp,
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k === 'CLIENTES_ROOT_ID' ? rootId : null) }) },
    Logger: { log: (s) => logs.push(String(s)) },
    UrlFetchApp: { fetch: () => { throw new Error('rede no teste'); } },
  };
  vm.createContext(ctx);
  vm.runInContext(fonte, ctx);
  let enviado = null;
  ctx.roboChamar_ = (action, body) => {
    if (action === 'pastas') return { candidatos: [], vigiar: [], buscar: [], ...plano };
    enviado = body;
    return { gravados: 0, atualizados: 0 };
  };
  ctx.roboPastas();
  return enviado;
}

const nomesNaRaiz = () => [...drive.itens.values()]
  .filter((x) => x.tipo === 'pasta' && x.pais.includes(ROOT)).map((x) => x.nome).sort();

beforeEach(() => {
  drive = criarDrive();
  root = drive.pasta('Clientes', [], { id: ROOT });
  logs = [];
});

describe('roboPastas no Drive', () => {
  it('uma pasta com o nome na raiz: vincula, sem criar outra', () => {
    const p = drive.pasta('Acme', [ROOT]);
    const r = rodar({ buscar: [{ client_id: 'c1', nome: 'Acme' }] });
    expect(r.achados).toEqual([{ client_id: 'c1', folder_url: p.getUrl() }]);
    expect(nomesNaRaiz()).toEqual(['Acme']);
  });

  it('nenhuma pasta com o nome: cria na raiz e vincula', () => {
    const r = rodar({ buscar: [{ client_id: 'c1', nome: 'Beta' }] });
    expect(nomesNaRaiz()).toEqual(['Beta']);
    expect(r.achados).toHaveLength(1);
    expect(r.achados[0].client_id).toBe('c1');
  });

  it('várias pastas com o nome: só reporta, não vincula nem cria', () => {
    drive.pasta('Gama', [ROOT]);
    drive.pasta('Gama', [ROOT]);
    const r = rodar({ buscar: [{ client_id: 'c1', nome: 'Gama' }] });
    expect(r.achados).toEqual([]);
    expect(r.ambiguas).toEqual(['Gama: 2 pastas']);
    expect(nomesNaRaiz()).toEqual(['Gama', 'Gama']);
  });

  it('pasta na lixeira não conta: com uma viva e uma na lixeira, vincula a viva', () => {
    drive.pasta('Delta', [ROOT], { lixeira: true });
    const viva = drive.pasta('Delta', [ROOT]);
    const r = rodar({ buscar: [{ client_id: 'c1', nome: 'Delta' }] });
    expect(r.achados).toEqual([{ client_id: 'c1', folder_url: viva.getUrl() }]);
    expect(r.ambiguas).toEqual([]);
  });

  it('planilha solta na raiz é ambígua: a raiz inteira não vira pasta de um cliente', () => {
    drive.arquivo('Planilha', [ROOT], { id: 'pl' });
    const r = rodar({ candidatos: [{ client_id: 'c1', sheet_id: 'pl' }] });
    expect(r.achados).toEqual([]);
    expect(r.ambiguas).toEqual(['c1: planilha solta na raiz']);
  });

  it('planilha dentro de pasta: vincula a pasta-mãe', () => {
    const mae = drive.pasta('Eta', [ROOT]);
    drive.arquivo('Planilha', [mae.getId()], { id: 'pl' });
    const r = rodar({ candidatos: [{ client_id: 'c1', sheet_id: 'pl' }] });
    expect(r.achados).toEqual([{ client_id: 'c1', folder_url: mae.getUrl() }]);
  });

  it('pasta vigiada com nome antigo fora da raiz: renomeia e move para a raiz', () => {
    const outra = drive.pasta('Outro lugar');
    const f = drive.pasta('Nome velho', [outra.getId()], { id: 'f1' });
    const r = rodar({ vigiar: [{ client_id: 'c1', folder_id: 'f1', nome: 'Nome novo', compartilhada: false }] });
    expect(f.nome).toBe('Nome novo');
    expect(f.pais).toEqual([ROOT]);
    expect(r.testes).toEqual([{ client_id: 'c1', status: 'ok' }]);
  });

  it('pasta compartilhada por dois clientes: confere, mas não renomeia nem move', () => {
    const f = drive.pasta('Grupo', ['fora'], { id: 'f1' });
    rodar({ vigiar: [
      { client_id: 'a', folder_id: 'f1', nome: 'Matriz', compartilhada: true },
      { client_id: 'b', folder_id: 'f1', nome: 'Filial', compartilhada: true },
    ] });
    expect(f.nome).toBe('Grupo');
    expect(f.pais).toEqual(['fora']);
  });

  it('plano sem nome (função antiga): não renomeia nem move', () => {
    const f = drive.pasta('Qualquer', ['fora'], { id: 'f1' });
    const r = rodar({ vigiar: [{ client_id: 'c1', folder_id: 'f1' }] });
    expect(f.nome).toBe('Qualquer');
    expect(f.pais).toEqual(['fora']);
    expect(r.testes).toEqual([{ client_id: 'c1', status: 'ok' }]);
  });

  it('pasta vigiada na lixeira ou sumida fica inacessível e não é mexida', () => {
    const f = drive.pasta('Velha', ['fora'], { id: 'f1', lixeira: true });
    const r = rodar({ vigiar: [
      { client_id: 'c1', folder_id: 'f1', nome: 'Nova', compartilhada: false },
      { client_id: 'c2', folder_id: 'sumiu', nome: 'X', compartilhada: false },
    ] });
    expect(r.testes).toEqual([{ client_id: 'c1', status: 'inacessivel' }, { client_id: 'c2', status: 'inacessivel' }]);
    expect(f.nome).toBe('Velha');
  });

  it('órfãs: pastas vivas da raiz que ninguém vigia nem achou saem no relatório', () => {
    drive.pasta('Vigiada', [ROOT], { id: 'v1' });
    drive.pasta('Achada', [ROOT]);
    drive.pasta('Órfã', [ROOT]);
    drive.pasta('Lixo', [ROOT], { lixeira: true });
    const r = rodar({
      vigiar: [{ client_id: 'c1', folder_id: 'v1', nome: 'Vigiada', compartilhada: false }],
      buscar: [{ client_id: 'c2', nome: 'Achada' }],
    });
    expect(r.orfas).toEqual(['Órfã']);
    expect(logs.some((l) => l.includes('Órfãs na raiz: Órfã'))).toBe(true);
  });

  it('nada é apagado: toda pasta e arquivo de antes continua no Drive', () => {
    drive.pasta('A', [ROOT]);
    drive.pasta('A', [ROOT]);
    drive.pasta('Órfã', [ROOT]);
    drive.pasta('Velha', ['fora'], { id: 'f1' });
    const antes = [...drive.itens.keys()];
    rodar({
      buscar: [{ client_id: 'c1', nome: 'A' }],
      vigiar: [{ client_id: 'c2', folder_id: 'f1', nome: 'Nova', compartilhada: false }],
    });
    for (const id of antes) {
      expect(drive.itens.has(id)).toBe(true);
      expect(drive.itens.get(id).lixeira).toBe(false);
    }
  });

  it('CLIENTES_ROOT_ID vazio: registra o erro e não cria, move nem lista órfã', () => {
    const f = drive.pasta('Velha', ['fora'], { id: 'f1' });
    const total = drive.itens.size;
    const r = rodar({
      buscar: [{ client_id: 'c1', nome: 'Nova' }],
      vigiar: [{ client_id: 'c2', folder_id: 'f1', nome: 'Velha', compartilhada: false }],
    }, { rootId: '' });
    expect(r.erros).toEqual(['CLIENTES_ROOT_ID vazio: nada criado, movido nem listado']);
    expect(drive.itens.size).toBe(total);
    expect(f.pais).toEqual(['fora']);
    expect(r.achados).toEqual([]);
    expect(r.orfas).toEqual([]);
  });

  it('erro sai no log com a mensagem, não só na contagem', () => {
    rodar({}, { rootId: '' });
    expect(logs).toContain('Erros: CLIENTES_ROOT_ID vazio: nada criado, movido nem listado');
  });

  it('CLIENTES_ROOT_ID que não abre: registra o erro e não cria nada', () => {
    const total = drive.itens.size;
    const r = rodar({ buscar: [{ client_id: 'c1', nome: 'Nova' }] }, { rootId: 'nao-existe' });
    expect(r.erros[0]).toMatch(/^CLIENTES_ROOT_ID inacessível: /);
    expect(drive.itens.size).toBe(total);
  });

  it('achados vão à função só com client_id e folder_url: folder_id fica no robô', () => {
    drive.pasta('Acme', [ROOT]);
    const r = rodar({ buscar: [{ client_id: 'c1', nome: 'Acme' }] });
    expect(Object.keys(r.achados[0]).sort()).toEqual(['client_id', 'folder_url']);
  });
});
