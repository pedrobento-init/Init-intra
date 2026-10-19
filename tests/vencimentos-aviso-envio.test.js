import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';

// O aviso de vencimento só fica marcado depois que o e-mail sai de verdade.
const SRC = fs.readFileSync(new URL('../js/vencimentos.js', import.meta.url), 'utf8');

function load({ sendOk, recipients = ['a@initnet.com.br'] }) {
  const store = { V1: { id: 'V1', status: 'ativo', tipo: 'ssl', descricao: 'SSL', dataVencimento: new Date().toISOString().slice(0, 10), avisos: [] } };
  const sent = [];
  const env = {
    getSession: () => ({ opId: 'OP-1' }),
    isSupabaseConnected: () => true,
    _getLastSyncAt: () => new Date().toISOString(),
    getNotifPrefs: () => ({ onDeadlineReminder: true }),
    collectRecipients: () => recipients,
    getMyVencimentos: () => Object.values(store).map((v) => ({ ...v })),
    getVencimentoById: (id) => store[id],
    saveVencimento: (d) => { store[d.id] = { ...store[d.id], ...d }; },
    sendEmailNotification: async (m) => { sent.push(m); return sendOk ? { success: true } : { error: 'falhou' }; },
    escapeHtml: (s) => String(s),
    formatDate: (s) => String(s),
    window: { location: { origin: 'https://intra', pathname: '/' } },
  };
  const names = Object.keys(env);
  const fn = new Function(...names, SRC + '\nreturn { checkVencimentoReminders };');
  const api = fn(...names.map((n) => env[n]));
  return { api, store, sent };
}

describe('aviso de vencimento por e-mail', () => {
  it('envio ok: marca o aviso', async () => {
    const { api, store, sent } = load({ sendOk: true });
    await api.checkVencimentoReminders();
    expect(sent.length).toBe(1);
    expect(store.V1.avisos).toEqual(['30', '7', '0']);
  });

  it('envio falhou: não marca, e não repete na mesma sessão', async () => {
    const { api, store, sent } = load({ sendOk: false });
    await api.checkVencimentoReminders();
    await api.checkVencimentoReminders();
    expect(sent.length).toBe(1);
    expect(store.V1.avisos).toEqual([]);
  });

  it('sem destinatário: marca sem enviar', async () => {
    const { api, store, sent } = load({ sendOk: true, recipients: [] });
    await api.checkVencimentoReminders();
    expect(sent.length).toBe(0);
    expect(store.V1.avisos).toEqual(['30', '7', '0']);
  });
});
