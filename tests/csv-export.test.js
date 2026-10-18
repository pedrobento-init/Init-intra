import { createRequire as __storageReq } from 'node:module';
const { requireStorage, storageSource } = __storageReq(import.meta.url)('./_storage.cjs');
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

// ── SEC-15 (P-17) + CONS-08: neutralização de fórmula e escape estrutural ────
// Regras verificadas:
//  1) célula iniciada por =, +, -, @, tab ou CR ganha marcador de texto (');
//  2) número negativo puro NÃO é marcado;
//  3) ';', aspa dupla e quebra de linha são escapados (colunas não desalinham);
//  4) TODOS os exportadores passam pelo mesmo helper (csvCell);
//  5) _icsEscape (ICS) escapa barra invertida, ';' e ',' e normaliza CR/LF.
const BS = String.fromCharCode(92);
const NL = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const TAB = String.fromCharCode(9);
const BOM = String.fromCharCode(0xfeff);
const D = String.fromCharCode(34);
const Q = String.fromCharCode(39);

function _anyEl() {
  return new Proxy(function () {}, {
    get: (_t, p) => {
      if (p === Symbol.toPrimitive) return () => '';
      if (p === 'then') return undefined;
      if (p === 'style' || p === 'dataset') return {};
      if (p === 'classList') return { add() {}, remove() {}, toggle() {}, contains: () => false };
      return (..._a) => _anyEl();
    },
    set: () => true,
    apply: () => _anyEl(),
  });
}
function _setGlobal(name, value) {
  try {
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  } catch (_) {
    globalThis[name] = value;
  }
}
_setGlobal('window', {
  _pendingSyncCount: 0,
  addEventListener() {},
  location: { hash: '' },
  innerWidth: 1280,
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
});
_setGlobal('navigator', { onLine: true, userAgent: 'test' });
_setGlobal(
  'document',
  new Proxy(
    {},
    {
      get: (_t, p) => {
        if (p === 'addEventListener') return () => {};
        if (p === 'querySelectorAll') return () => [];
        if (p === 'getElementById' || p === 'querySelector' || p === 'createElement') return (..._a) => _anyEl();
        if (p === 'head' || p === 'body') return _anyEl();
        if (p === 'visibilityState') return 'visible';
        return undefined;
      },
      set: () => true,
    }
  )
);
const _ls = {};
_setGlobal('localStorage', {
  getItem: (k) => (k in _ls ? _ls[k] : null),
  setItem: (k, v) => {
    _ls[k] = String(v);
  },
  removeItem: (k) => {
    delete _ls[k];
  },
});
globalThis.Dexie = class {
  constructor() {}
  version() {
    return { stores() {} };
  }
};

// ── Código REAL carregado no escopo global (mesmo padrão de visita-numero) ───
const _quietErr = console.error;
console.error = () => {};
try {
  vm.runInThisContext(storageSource(), { filename: 'storage.js' });
  vm.runInThisContext(fs.readFileSync('js/ui.js', 'utf8'), { filename: 'ui.js' });
  vm.runInThisContext(fs.readFileSync('js/visitas.js', 'utf8'), { filename: 'visitas.js' });
} finally {
  console.error = _quietErr;
}
console.debug = () => {};
console.warn = () => {};

describe('csvCell - neutralização de fórmula (SEC-15)', () => {
  it('marca como texto células iniciadas por =, + e @', () => {
    expect(csvCell('=1+1')).toBe(Q + '=1+1');
    expect(csvCell('=cmd|calc /C calc')).toBe(Q + '=cmd|calc /C calc');
    expect(csvCell('+55 11 9999-0000')).toBe(Q + '+55 11 9999-0000');
    expect(csvCell('@usuario')).toBe(Q + '@usuario');
    expect(csvCell(TAB + 'tab')).toBe(Q + TAB + 'tab');
    // CR também é marcador de fórmula E quebra de linha: as duas proteções
    // se combinam (prefixo + campo entre aspas).
    expect(csvCell(CR + 'cr')).toBe(D + Q + CR + 'cr' + D);
  });

  it('marca como texto valores iniciados por - quando não são números', () => {
    expect(csvCell('-abc')).toBe(Q + '-abc');
    expect(csvCell('- TEM QUEBRAR')).toBe(Q + '- TEM QUEBRAR');
  });

  it('NÃO marca números negativos puros (continuam números)', () => {
    expect(csvCell('-12.5')).toBe('-12.5');
    expect(csvCell('-3')).toBe('-3');
    expect(csvCell(-7)).toBe('-7');
  });

  it('escapa aspa dupla e envolve campo com ; ou quebra de linha', () => {
    expect(csvCell('diz ' + D + 'oi' + D)).toBe(D + 'diz ' + D + D + 'oi' + D + D + D);
    expect(csvCell('a;b')).toBe(D + 'a;b' + D);
    expect(csvCell('linha1' + NL + 'linha2')).toBe(D + 'linha1' + NL + 'linha2' + D);
    expect(csvCell('linha1' + CR + NL + 'linha2')).toBe(D + 'linha1' + CR + NL + 'linha2' + D);
  });

  it('combina proteção de fórmula com escape estrutural', () => {
    const out = csvCell('=1;2');
    expect(out.startsWith(D + Q)).toBe(true);
    expect(out.endsWith(D)).toBe(true);
    expect(out).toBe(D + Q + '=1;2' + D);
  });

  it('não altera texto simples e normaliza null/undefined', () => {
    expect(csvCell('Cliente A')).toBe('Cliente A');
    expect(csvCell('a,b')).toBe('a,b');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(0)).toBe('0');
  });
});

describe('csvRow / exportCSV - estrutura das colunas', () => {
  it('csvRow aplica csvCell em cada célula e junta com ;', () => {
    expect(csvRow(['Nome', '=SUM(A1)'])).toBe('Nome;' + Q + '=SUM(A1)');
    expect(csvRow(['Tem; ponto', 'ok'])).toBe(D + 'Tem; ponto' + D + ';ok');
  });

  it('exportCSV emite BOM + cabeçalho + linhas já protegidos', async () => {
    const _create = URL.createObjectURL;
    const _revoke = URL.revokeObjectURL;
    let captured = null;
    URL.createObjectURL = (blob) => {
      captured = blob;
      return 'blob:fake';
    };
    URL.revokeObjectURL = () => {};
    try {
      exportCSV('arquivo_teste', ['Nome', 'Valor'], [
        ['Cliente A', '=cmd|calc'],
        ['Tem;ponto', 'texto simples'],
      ]);
      expect(captured).toBeTruthy();
      const bytes = new Uint8Array(await captured.arrayBuffer());
      // BOM UTF-8 (EF BB BF) presente — Blob.text() descarta o BOM, por isso
      // a verificação é feita nos bytes.
      expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
      const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
      expect(text.charCodeAt(0)).toBe(0xfeff);
      expect(text.slice(1)).toBe(
        'Nome;Valor' + NL + 'Cliente A;' + Q + '=cmd|calc' + NL + D + 'Tem;ponto' + D + ';texto simples'
      );
    } finally {
      URL.createObjectURL = _create;
      URL.revokeObjectURL = _revoke;
    }
  });
});

describe('_visitReportCsvCell - delegação com fallback', () => {
  it('usa csvCell quando disponível', () => {
    expect(_visitReportCsvCell('=1+1')).toBe(csvCell('=1+1'));
    expect(_visitReportCsvCell('a;b')).toBe(csvCell('a;b'));
  });

  it('mantém a proteção de fórmula mesmo sem csvCell no escopo', () => {
    const src = fs.readFileSync('js/visitas.js', 'utf8');
    const st = src.indexOf('function _visitReportCsvCell');
    const en = src.indexOf(NL + '}', st);
    const isolated = vm.runInNewContext('(' + src.slice(st, en + 2) + ')');
    // o fallback antigo envolvia SEMPRE o valor entre aspas — o que importa é
    // que a fórmula nunca chegue crua à planilha.
    expect(isolated('=1+1')).toBe(D + Q + '=1+1' + D);
    expect(isolated('-abc')).toBe(D + Q + '-abc' + D);
    expect(isolated('a;b')).toBe(D + 'a;b' + D);
    expect(isolated('diz ' + D + 'oi' + D)).toBe(D + 'diz ' + D + D + 'oi' + D + D + D);
  });
});

describe('todos os exportadores delegam ao helper único', () => {
  const uiSrc = fs.readFileSync('js/ui.js', 'utf8');
  const visitasSrc = fs.readFileSync('js/visitas.js', 'utf8');
  const equipSrc = fs.readFileSync('js/equipamentos.js', 'utf8');
  const mdSrc = fs.readFileSync('js/milvus-devices.js', 'utf8');
  const prefixStmt = 's = ' + D + Q + D + ' + s;';

  it('exportCSV genérico usa csvRow (ui.js)', () => {
    expect(uiSrc).toContain('function csvCell(v)');
    expect(uiSrc).toContain('csvRow(headers)');
    expect(uiSrc).toContain('rows.map(csvRow)');
  });

  it('relatório de visitas delega a csvCell (visitas.js)', () => {
    expect(visitasSrc).toContain("if (typeof csvCell === 'function') return csvCell(val);");
    expect(visitasSrc).toContain(prefixStmt);
  });

  it('acerto de equipamentos delega a csvCell (equipamentos.js)', () => {
    expect(equipSrc).toContain("if (typeof csvCell === 'function') return csvCell(v);");
    expect(equipSrc).toContain(prefixStmt);
  });

  it('inventário Milvus delega a csvCell (milvus-devices.js)', () => {
    expect(mdSrc).toContain("if (typeof csvCell === 'function') return csvCell(v);");
    expect(mdSrc).toContain(prefixStmt);
  });

  it('index.html carrega ui.js antes dos demais exportadores', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const pos = (f) => html.indexOf('src="js/' + f + '"');
    expect(pos('ui.js')).toBeGreaterThan(-1);
    expect(pos('ui.js')).toBeLessThan(pos('calendar.js'));
    expect(pos('ui.js')).toBeLessThan(pos('visitas.js'));
    expect(pos('ui.js')).toBeLessThan(pos('equipamentos.js'));
    expect(pos('ui.js')).toBeLessThan(pos('milvus-devices.js'));
  });
});

describe('_icsEscape - escape RFC 5545 (CONS-08)', () => {
  const calSrc = fs.readFileSync('js/calendar.js', 'utf8');
  const st = calSrc.indexOf('function _icsEscape');
  const en = calSrc.indexOf(NL + '}', st);
  const icsEscape = vm.runInNewContext('(' + calSrc.slice(st, en + 2) + ')');

  it('escapa barra invertida antes de ; e ,', () => {
    expect(icsEscape('a' + BS + 'b;c,d')).toBe('a' + BS + BS + 'b' + BS + ';c' + BS + ',d');
    expect(icsEscape('a' + BS + ';')).toBe('a' + BS + BS + BS + ';');
  });

  it('normaliza CRLF, CR e LF para a sequência de escape', () => {
    expect(icsEscape('x' + CR + NL + 'y')).toBe('x' + BS + 'n' + 'y');
    expect(icsEscape('x' + CR + 'y')).toBe('x' + BS + 'n' + 'y');
    expect(icsEscape('x' + NL + 'y')).toBe('x' + BS + 'n' + 'y');
  });

  it('não altera texto simples nem valor vazio', () => {
    expect(icsEscape('Simples')).toBe('Simples');
    expect(icsEscape('')).toBe('');
    expect(icsEscape(null)).toBe('');
  });
});
