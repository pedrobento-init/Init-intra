import { describe, it, expect } from 'vitest';
import { eventIdFor, eventToVisitPatch, visitHash, visitIdFromEventId, visitToEvent } from '../supabase/functions/google-agenda/mapping.ts';

const base = { id: 'VIS-1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed', numero: 73, client_name: 'Acme', motivo: 'Trocar switch',
  observacoes: 'Levar cabo', date: '2026-10-20', time: '09:00:00', time_end: '11:30:00', all_day: false, status: 'agendada' };

describe('google-agenda: id do evento', () => {
  it('ida e volta, só caracteres base32hex aceitos pelo Google', () => {
    const eid = eventIdFor(base.id);
    expect(eid).toMatch(/^[a-v0-9]{5,1024}$/);
    expect(visitIdFromEventId(eid)).toBe(base.id);
  });
  it('evento criado direto no Google não vira visita', () => {
    expect(visitIdFromEventId('abc123googleid')).toBeNull();
    expect(visitIdFromEventId('ii0')).toBeNull();
    expect(visitIdFromEventId(undefined)).toBeNull();
  });
});

describe('google-agenda: visita → evento', () => {
  it('horário em Brasília, título com número e cliente', () => {
    const ev = visitToEvent(base, 'https://intra.example/#visitas');
    expect(ev.summary).toBe('Visita #0073 · Acme');
    expect(ev.start).toEqual({ dateTime: '2026-10-20T09:00:00-03:00', timeZone: 'America/Sao_Paulo' });
    expect(ev.end.dateTime).toBe('2026-10-20T11:30:00-03:00');
    expect(ev.description).toContain('Motivo: Trocar switch');
    expect(ev.description).toContain('https://intra.example/#visitas');
    expect(ev.extendedProperties.private.initIntraVisitId).toBe(base.id);
  });
  it('dia inteiro usa date com fim exclusivo; sem fim vira 1h; concluída ganha ✓', () => {
    expect(visitToEvent({ ...base, all_day: true }).end).toEqual({ date: '2026-10-21' });
    expect(visitToEvent({ ...base, time_end: null }).end.dateTime).toBe('2026-10-20T10:00:00-03:00');
    expect(visitToEvent({ ...base, time: '23:30', time_end: null }).end.dateTime).toBe('2026-10-20T23:59:00-03:00');
    expect(visitToEvent({ ...base, status: 'concluida' }).summary).toMatch(/✓$/);
  });
});

describe('google-agenda: evento → visita', () => {
  it('evento igual ao que o site geraria não muda nada (sem loop)', () => {
    expect(eventToVisitPatch(visitToEvent(base), base)).toBeNull();
    const semFim = { ...base, time_end: null };
    expect(eventToVisitPatch(visitToEvent(semFim), semFim)).toBeNull();
    const dia = { ...base, all_day: true, time: null, time_end: null };
    expect(eventToVisitPatch(visitToEvent(dia), dia)).toBeNull();
  });
  it('arrastar o evento no Google muda data e horário (qualquer fuso)', () => {
    const ev = { start: { dateTime: '2026-10-22T17:00:00Z' }, end: { dateTime: '2026-10-22T18:15:00Z' } };
    expect(eventToVisitPatch(ev, base)).toEqual({ date: '2026-10-22', time: '14:00', time_end: '15:15', all_day: false });
  });
  it('virar dia inteiro no Google limpa os horários', () => {
    expect(eventToVisitPatch({ start: { date: '2026-10-21' }, end: { date: '2026-10-22' } }, base))
      .toEqual({ date: '2026-10-21', time: null, time_end: null, all_day: true });
  });
  it('evento que passa da meia-noite guarda só o início', () => {
    const ev = { start: { dateTime: '2026-10-20T22:00:00-03:00' }, end: { dateTime: '2026-10-21T01:00:00-03:00' } };
    expect(eventToVisitPatch(ev, base)).toEqual({ date: '2026-10-20', time: '22:00', time_end: null, all_day: false });
  });
});

describe('google-agenda: hash', () => {
  it('ignora segundos e muda com o que aparece na agenda', async () => {
    const h = await visitHash(base);
    expect(await visitHash({ ...base, time: '09:00', time_end: '11:30' })).toBe(h);
    expect(await visitHash({ ...base, motivo: 'Outro' })).not.toBe(h);
    expect(await visitHash({ ...base, date: '2026-10-21' })).not.toBe(h);
  });
});
