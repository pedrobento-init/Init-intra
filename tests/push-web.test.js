import { describe, it, expect } from 'vitest';
import { buildPushPayload, isGoneStatus, pushRecipients } from '../supabase/functions/send-push/payload.ts';

// Regras do Web Push (Edge Function send-push).
describe('buildPushPayload', () => {
  it('exige título e corta textos longos', () => {
    expect(buildPushPayload({ title: '  ' })).toBeNull();
    const p = buildPushPayload({ title: 'Nova pendência', body: 'x'.repeat(300), url: '#pendencias' });
    expect(p.body.length).toBe(180);
    expect(p.body.endsWith('…')).toBe(true);
  });

  it('link só para rota do próprio app', () => {
    expect(buildPushPayload({ title: 't', url: '#pendencias' }).url).toBe('/#pendencias');
    expect(buildPushPayload({ title: 't', url: '/#visitas' }).url).toBe('/#visitas');
    expect(buildPushPayload({ title: 't', url: 'https://evil.example/#x' }).url).toBe('/');
    expect(buildPushPayload({ title: 't', url: 'javascript:alert(1)' }).url).toBe('/');
  });
});

describe('pushRecipients', () => {
  const OPS = [
    { id: 'OP-ana', email: 'Ana@init.com', active: true },
    { id: 'OP-beto', email: 'beto@init.com', active: false },
    { id: 'OP-gil', email: 'gil@init.com', active: true },
  ];
  it('só operadores ativos da lista, sem quem enviou', () => {
    expect(pushRecipients(OPS, ['ana@init.com', 'beto@init.com', 'gil@init.com', 'fora@x.com'], 'OP-gil')).toEqual(['OP-ana']);
  });
});

describe('isGoneStatus', () => {
  it('404 e 410 apagam a inscrição', () => {
    expect(isGoneStatus(410)).toBe(true);
    expect(isGoneStatus(404)).toBe(true);
    expect(isGoneStatus(500)).toBe(false);
  });
});

describe('chave VAPID no navegador (js/push.js)', async () => {
  const { createRequire } = await import('node:module');
  const { _pushKeyToBytes } = createRequire(import.meta.url)('../js/push.js');
  it('base64url vira bytes (65 bytes na chave pública P-256)', () => {
    const key = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
    const bytes = _pushKeyToBytes(key);
    expect(bytes.length).toBe(65);
    expect(bytes[0]).toBe(4);
  });
});
