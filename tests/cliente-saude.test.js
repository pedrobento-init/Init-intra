import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { rotaMapsUrl as rotaServidor } from '../supabase/functions/robo/relatorios.ts';

const req = createRequire(import.meta.url);
const { calcularSaude, backupMonitorAlerta } = req('../js/cliente-saude.js');
const { rotaMapsUrl } = req('../js/visita-campo.js');

const today = '2026-10-21';
const agora = Date.parse('2026-10-21T12:00:00Z');
const verde = { level: 'green', label: 'Saudável', totalAbertas: 0, vencidas: 0, avgHours: 0 };

describe('saúde do cliente (0–100)', () => {
  it('sem nada pesando: 100, saudável, sem motivos', () => {
    const s = calcularSaude({ base: verde, today, agora });
    expect(s.nota).toBe(100);
    expect(s.level).toBe('green');
    expect(s.motivos).toEqual([]);
  });
  it('backup com falha e vencimento estourado derrubam um cliente sem pendências', () => {
    const s = calcularSaude({
      base: verde, today, agora,
      monitores: [{ nome: 'Veeam', ultimo_status: 'falha', max_horas: 48 }],
      vencimentos: [{ status: 'ativo', dataVencimento: '2026-10-10' }],
    });
    expect(s.nota).toBe(55);
    expect(s.level).toBe('yellow');
    expect(s.motivos).toEqual(['1 vencimento já vencido', 'backup "Veeam" com falha']);
  });
  it('soma tudo e chega a crítico', () => {
    const s = calcularSaude({
      base: { level: 'yellow', totalAbertas: 8, vencidas: 4, avgHours: 100 }, today, agora,
      vencimentos: [{ status: 'ativo', dataVencimento: '2026-10-25' }, { status: 'ativo', dataVencimento: '2026-11-10' }],
      monitores: [{ nome: 'NAS', ultimo_status: 'ok', ultimo_em: '2026-10-15T00:00:00Z', max_horas: 48 }],
      dispositivosParados: [{ nome: 'PC-1', dias: 20 }, { nome: 'PC-2', dias: 9 }],
      visitas: [{ date: '2026-03-01', status: 'concluida' }],
    });
    expect(s.level).toBe('red');
    // −36 vencidas −15 abertas −5 média −12−4 vencimentos −15 backup −6 dispositivos −5 sem visita
    expect(s.nota).toBe(2);
    expect(s.motivos).toContain('backup "NAS" sem notícia');
    expect(s.motivos).toContain('sem visita há 234 dias');
  });
  it('não melhora o nível que as pendências já deram', () => {
    expect(calcularSaude({ base: { ...verde, level: 'red' }, today, agora }).level).toBe('red');
  });
  it('vencimento encerrado e monitor pausado não contam', () => {
    const s = calcularSaude({ base: verde, today, agora,
      vencimentos: [{ status: 'encerrado', dataVencimento: '2026-01-01' }],
      monitores: [{ nome: 'X', ultimo_status: 'falha', ativo: false, max_horas: 48 }] });
    expect(s.nota).toBe(100);
  });
  it('alerta do monitor: falha, silêncio (desde a criação se nunca chegou), aviso', () => {
    expect(backupMonitorAlerta({ ultimo_status: 'falha' }, agora)).toBe('falha');
    expect(backupMonitorAlerta({ ultimo_status: 'ok', ultimo_em: '2026-10-21T00:00:00Z', max_horas: 48 }, agora)).toBeNull();
    expect(backupMonitorAlerta({ created_at: '2026-10-10T00:00:00Z', max_horas: 48 }, agora)).toBe('silencio');
    expect(backupMonitorAlerta({ ultimo_status: 'aviso', ultimo_em: '2026-10-21T00:00:00Z', max_horas: 48 }, agora)).toBe('aviso');
  });
});

describe('rota do dia (Google Maps)', () => {
  it('última parada é o destino; as outras viram waypoints; sem visitas, nada', () => {
    const url = rotaMapsUrl(['Rua A, 1', '', 'Acme Ltda']);
    expect(url).toBe('https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=Acme%20Ltda&waypoints=Rua%20A%2C%201');
    expect(rotaMapsUrl([])).toBeNull();
  });
  it('no máximo 10 paradas; site e e-mail montam a mesma URL', () => {
    const p = Array.from({ length: 12 }, (_, i) => 'P' + i);
    expect(decodeURIComponent(rotaMapsUrl(p)).split('|')).toHaveLength(9);
    expect(rotaServidor(p)).toBe(rotaMapsUrl(p));
  });
});
