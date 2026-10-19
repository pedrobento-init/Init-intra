import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

// Pendência vencida/atrasada não gera mais e-mail nem alerta; só o que vence
// hoje ou nos próximos dias.
const NOTIF = fs.readFileSync(new URL('../js/notifications.js', import.meta.url), 'utf8');
const UI = fs.readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (n) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return d; };

describe('lembrete de prazo por e-mail', () => {
  it('não envia para pendência vencida; envia para a que vence hoje', () => {
    const pens = [
      { id: 'ATRASADA', deadline: iso(addDays(-1)), status: 'aberto' },
      { id: 'HOJE', deadline: iso(addDays(0)), status: 'aberto' },
    ];
    const avisadas = [];
    const store = {};
    const env = {
      SUPABASE_URL: '',
      getSession: () => ({ opId: 'OP-1' }),
      getMyPendencias: () => pens,
      isPendenciaClosed: () => false,
      parseDeadline: (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); },
      localStorage: { getItem: () => null, setItem: () => {} },
      sessionStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; } },
      window: undefined,
    };
    const names = Object.keys(env);
    const run = new Function(...names, '__avisar', NOTIF + '\nnotifyDeadlineReminder = (p) => __avisar(p.id);\nreturn { checkDeadlineReminders };');
    run(...names.map((n) => env[n]), (id) => avisadas.push(id)).checkDeadlineReminders();
    expect(avisadas).toEqual(['HOJE']);
  });
});

describe('alerta na tela', () => {
  it('não conta pendência vencida no alerta', () => {
    expect(UI).not.toMatch(/p\.deadline <= todayStr/);
    expect(UI).toMatch(/p\.deadline === todayStr/);
  });
});

describe('pendência parada', () => {
  it('não existe mais e-mail de pendência parada', () => {
    expect(NOTIF).not.toMatch(/checkStalePendencias|notifyStalePendencia/);
  });
});
