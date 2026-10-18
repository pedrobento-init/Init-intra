import { describe, it, expect } from 'vitest';
import { buildIcs, icsEscape, icsFold } from '../supabase/functions/agenda-ics/ics.ts';

describe('agenda ICS', () => {
  const ics = buildIcs([
    { id: 'VIS-1', numero: 73, client_name: 'Acme, Ltda', motivo: 'Trocar switch; testar', date: '2026-10-20', time: '09:00', time_end: '11:30', status: 'agendada' },
    { id: 'VIS-2', client_name: 'Zeta', date: '2026-10-21', all_day: true, status: 'concluida' },
    { id: 'VIS-3', client_name: 'Sem fim', date: '2026-10-22', time: '14:00', status: 'cancelada' },
    { id: 'ruim', date: '20/10/2026' },
  ], { name: 'Init Intra — Ana', appUrl: 'https://intra.example/#visitas' });
  const unfolded = ics.replace(/\r\n /g, '');

  it('cabeçalho e um evento por visita válida, com CRLF', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(unfolded.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    expect(unfolded).toContain('UID:VIS-1@init-intra');
  });

  it('horário de Brasília vira UTC (+3h); dia inteiro usa DATE com fim exclusivo', () => {
    expect(unfolded).toContain('DTSTART:20261020T120000Z');
    expect(unfolded).toContain('DTEND:20261020T143000Z');
    expect(unfolded).toContain('DTSTART;VALUE=DATE:20261021\r\nDTEND;VALUE=DATE:20261022');
  });

  it('sem hora de fim: 1 hora de duração; cancelada sai como CANCELLED', () => {
    expect(unfolded).toContain('DTSTART:20261022T170000Z\r\nDTEND:20261022T180000Z');
    expect(unfolded).toMatch(/UID:VIS-3@init-intra[\s\S]*?STATUS:CANCELLED/);
  });

  it('escapa vírgula e ponto e vírgula; número da visita no título', () => {
    expect(unfolded).toContain(String.raw`SUMMARY:Visita #0073 · Acme\, Ltda`);
    expect(unfolded).toContain(String.raw`Motivo: Trocar switch\; testar`);
    expect(icsEscape('a\nb')).toBe(String.raw`a\nb`);
  });

  it('dobra linhas longas em até 75 bytes sem quebrar acento', () => {
    const line = 'DESCRIPTION:' + 'ção'.repeat(60);
    const parts = icsFold(line).split('\r\n ');
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75);
    expect(parts.join('')).toBe(line);
  });
});
