import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

// Funções puras da auditoria (ui.js é script global): extrai e avalia só elas.
const src = fs.readFileSync('js/ui.js', 'utf8');
const pick = (name) => src.match(new RegExp('function ' + name + '\\([\\s\\S]*?\\n\\}'))[0];
const T = new Function(
  'const localDateISO = (d) => { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); };\n' +
  ['_auditNorm', 'auditFacets', 'filterAuditLogs', 'groupAuditLogsByDay'].map(pick).join('\n') +
  '\nreturn { auditFacets, filterAuditLogs, groupAuditLogsByDay };'
)();

const L = [
  { id: '1', action: 'Criou', type: 'Pendência', operatorName: 'Ana', details: 'Backup mensal', targetId: 'PEN-1', timestamp: '2026-10-15T15:00:00.000Z' },
  { id: '2', action: 'Editou', type: 'Visita', operatorName: 'Beto', details: 'Relatório', targetId: 'VIS-9', timestamp: '2026-10-14T15:00:00.000Z' },
  { id: '3', action: 'Login', type: 'Sessão', operatorName: null, details: '', timestamp: '2026-10-01T15:00:00.000Z' },
];

describe('auditoria', () => {
  it('facetas vêm dos próprios registros (inclui "Sistema")', () => {
    const f = T.auditFacets(L);
    expect(f.types).toEqual(['Pendência', 'Sessão', 'Visita']);
    expect(f.people).toEqual(['Ana', 'Beto', 'Sistema']);
  });
  it('filtra por pessoa, ação, tipo e período; busca sem acento e por ID', () => {
    expect(T.filterAuditLogs(L, { person: 'Ana' }).map((l) => l.id)).toEqual(['1']);
    expect(T.filterAuditLogs(L, { action: 'Editou' }).map((l) => l.id)).toEqual(['2']);
    expect(T.filterAuditLogs(L, { from: '2026-10-14' }).map((l) => l.id)).toEqual(['1', '2']);
    expect(T.filterAuditLogs(L, { q: 'relatorio' }).map((l) => l.id)).toEqual(['2']);
    expect(T.filterAuditLogs(L, { q: 'vis-9' }).map((l) => l.id)).toEqual(['2']);
  });
  it('agrupa por dia com Hoje/Ontem', () => {
    const g = T.groupAuditLogsByDay(T.filterAuditLogs(L, {}), '2026-10-15');
    expect(g.map((x) => x.label)).toEqual(['Hoje', 'Ontem', '01/10/2026']);
  });
});
