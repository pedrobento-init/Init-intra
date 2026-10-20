import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

// Pendência vencida/atrasada não gera alerta; só o que vence hoje ou nos
// próximos dias. O e-mail de prazo agora é do servidor (avisos-prazo.test.js).
const NOTIF = fs.readFileSync(new URL('../js/notifications.js', import.meta.url), 'utf8');
const UI = fs.readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');

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

  it('o navegador não dispara mais lembrete de prazo', () => {
    expect(NOTIF).not.toMatch(/checkDeadlineReminders|notifyDeadlineReminder|sessionStorage/);
  });
});
