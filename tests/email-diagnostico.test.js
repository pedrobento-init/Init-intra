import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';

// describeEmailError: cada causa comum de "nenhum e-mail sai" vira uma
// mensagem que diz o que arrumar.
let describeEmailError;
let emailErrorDetail;
beforeAll(() => {
  const src = fs.readFileSync(new URL('../js/notifications.js', import.meta.url), 'utf8');
  const fn = new Function('SUPABASE_URL', src + '\nreturn { describeEmailError, _emailErrorDetail };');
  ({ describeEmailError, _emailErrorDetail: emailErrorDetail } = fn(''));
});

describe('diagnóstico do envio de e-mail (Gmail)', () => {
  it('função não publicada', () => {
    expect(describeEmailError({ status: 404, message: 'Edge Function returned a non-2xx status code' })).toMatch(/não está publicada/);
  });
  it('faltam os secrets do Gmail', () => {
    expect(describeEmailError({ status: 500, code: 'missing_credentials', message: 'x' })).toMatch(/GMAIL_USER e GMAIL_APP_PASSWORD/);
  });
  it('Gmail recusou o login', () => {
    expect(describeEmailError({ status: 502, code: 'EAUTH', message: '535-5.7.8 Username and Password not accepted.' })).toMatch(/recusou o login/);
  });
  it('limite diário, conexão, acesso e rede', () => {
    expect(describeEmailError({ code: 'EENVELOPE', message: '550 5.4.5 Daily user sending limit exceeded.' })).toMatch(/Limite diário/);
    expect(describeEmailError({ code: 'ETIMEDOUT', message: 'Connection timeout' })).toMatch(/smtp\.gmail\.com/);
    expect(describeEmailError({ status: 401, code: 'unauthorized' })).toMatch(/entre de novo/);
    expect(describeEmailError({ code: 'network', message: 'Failed to send a request to the Edge Function' })).toMatch(/Não foi possível chamar/);
  });
  it('lê status e corpo do erro da Edge Function', async () => {
    const err = { message: 'Edge Function returned a non-2xx status code', context: { status: 502, json: async () => ({ error: '535 Username and Password not accepted', code: 'EAUTH' }) } };
    expect(await emailErrorDetail(err)).toEqual({ status: 502, code: 'EAUTH', message: '535 Username and Password not accepted' });
  });
});
