import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

describe('buildClientNarrative', () => {
  let clientsMod;
  beforeEach(() => {
    globalThis.getPendencias = () => [
      { clientId:'CLI-1', createdAt:'2024-01-01T10:00:00Z', status:'concluido', completedAt:'2024-01-02T10:00:00Z' },
      { clientId:'CLI-1', createdAt:'2024-02-01T10:00:00Z', status:'aberto' },
      { clientId:'CLI-2', createdAt:'2024-03-01T10:00:00Z', status:'aberto' },
    ];
    globalThis.getHealthForClient = () => ({ emoji:'🟢', label:'Saudável', color:'#16a34a' });
    globalThis.calculateAvgResolutionHours = () => 24;
    globalThis.formatDate = (iso) => new Date(iso).toLocaleDateString('pt-BR');
    globalThis.localDateISO = () => '2024-03-10';
    delete require.cache[require.resolve('../js/clients.js')];
    clientsMod = require('../js/clients.js');
  });
  it('monta texto corrido com data, total, média e status', () => {
    const txt = clientsMod.buildClientNarrative('CLI-1');
    expect(txt).toContain('Cliente desde');
    expect(txt).toContain('2 pendências no histórico');
    expect(txt).toContain('média');
    expect(txt).toContain('🟢');
    expect(txt).toContain('Saudável');
  });
  it('retorna sem histórico quando cliente sem pendências', () => {
    const txt = clientsMod.buildClientNarrative('CLI-99');
    expect(txt).toContain('0 pendências');
  });
});
