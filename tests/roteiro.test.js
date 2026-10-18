import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { mapsLinks, buildRouteUrl, buildRoteiro } = require('../js/roteiro.js');

const TODAY = '2026-10-18';
const clients = { a: { address: 'Rua A, 1 - Centro' }, b: { address: 'Av. B, 2' }, c: {} };
const get = (id) => clients[id] || null;
const v = (o) => Object.assign({ date: TODAY, operator: 'Ana', status: 'agendada' }, o);

describe('roteiro do dia', () => {
  it('links de Maps e Waze com o endereço codificado', () => {
    const l = mapsLinks('Rua A, 1 - Centro');
    expect(l.google).toBe('https://www.google.com/maps/search/?api=1&query=Rua%20A%2C%201%20-%20Centro');
    expect(l.waze).toContain('q=Rua%20A%2C%201%20-%20Centro&navigate=yes');
  });

  it('rota: último endereço é o destino, os anteriores são paradas', () => {
    const u = buildRouteUrl(['X', 'Y', 'Z']);
    expect(u).toContain('destination=Z');
    expect(u).toContain('waypoints=' + encodeURIComponent('X|Y'));
    expect(buildRouteUrl([])).toBeNull();
    expect(buildRouteUrl(Array.from({ length: 15 }, (_, i) => 'E' + i))).toContain('destination=E9');
  });

  it('ordena por horário, dia inteiro no fim; concluída fica fora da rota; só as visitas do técnico', () => {
    const r = buildRoteiro([
      v({ id: '3', clientId: 'c', allDay: true }),
      v({ id: '2', clientId: 'b', time: '14:00' }),
      v({ id: '1', clientId: 'a', time: '09:00', status: 'concluida' }),
      v({ id: 'x', clientId: 'a', time: '08:00', operator: 'Beto' }),
      v({ id: 'y', clientId: 'a', time: '08:00', status: 'cancelada' }),
      v({ id: 'z', clientId: 'a', time: '08:00', date: '2026-10-19' }),
    ], get, TODAY, 'Ana');
    expect(r.stops.map((s) => s.v.id)).toEqual(['1', '2', '3']);
    expect(r.pending).toBe(2);
    expect(r.missingAddress).toBe(1);
    expect(r.routable).toBe(1); // uma parada só: sem botão "Rota completa"
    expect(r.routeUrl).toContain('destination=' + encodeURIComponent('Av. B, 2'));
    expect(r.routeUrl).not.toContain('waypoints');
  });
});
