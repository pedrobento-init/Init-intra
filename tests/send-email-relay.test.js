import { describe, it, expect } from 'vitest';
import { loadHandler, reqPost } from './helpers/edge-harness.js';
import { fakeSupabase } from './helpers/fake-supabase.js';

// SEC-03/P-3: a send-email já foi um relay aberto (aceitava `from`, `to` e
// `html` de quem chamasse). Hoje o remetente é fixo e o destinatário precisa
// ser operador ATIVO. Estes testes travam as duas coisas: são elas, e não o
// papel de quem chama, que impedem o relay.
//
// Por que não há teste de "só admin/gestão envia": as notificações de
// pendência saem de js/storage-pendencias.js no fluxo de QUALQUER técnico
// (notifyPendenciaCreated/Updated/Note), então exigir papel aqui calaria o
// e-mail do operador comum. Ver AUDITORIA.md §8.

const ENV = {
  SUPABASE_URL: 'https://projeto.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-de-teste',
  SUPABASE_ANON_KEY: 'anon-de-teste',
  GMAIL_USER: 'robo@initnet.com.br',
  GMAIL_APP_PASSWORD: 'senha-de-app',
  GMAIL_FROM: 'notificacoes@initnet.com.br',
};

const OPERADORES = [
  { id: 'op-1', auth_user_id: 'user-1', active: true, email: 'quem.chama@initnet.com.br' },
  { id: 'op-2', auth_user_id: 'user-2', active: true, email: 'colega@initnet.com.br' },
  { id: 'op-3', auth_user_id: 'user-3', active: false, email: 'desligado@initnet.com.br' },
];

/** Handler + o que o nodemailer recebeu (vazio = nada saiu). */
async function carregar() {
  const enviados = [];
  const { handler } = await loadHandler('send-email', {
    env: ENV,
    createClient: fakeSupabase({ user: { id: 'user-1' }, tabelas: { operators: OPERADORES } }),
    createTransport: () => ({
      sendMail: async (msg) => {
        enviados.push(msg);
        return { messageId: 'id-de-teste' };
      },
      close: () => {},
    }),
  });
  return { handler, enviados };
}

describe('send-email: remetente é fixo (não dá para forjar)', () => {
  it('ignora o `from` do corpo e usa sempre o GMAIL_FROM', async () => {
    const { handler, enviados } = await carregar();
    const res = await handler(
      reqPost(
        {
          from: 'Diretoria <diretoria@banco.com.br>',
          to: ['colega@initnet.com.br'],
          subject: 'Assunto',
          html: '<p>corpo</p>',
        },
        'jwt-valido'
      )
    );
    expect(res.status).toBe(200);
    expect(enviados).toHaveLength(1);
    expect(enviados[0].from.address).toBe(ENV.GMAIL_FROM);
    expect(JSON.stringify(enviados[0].from)).not.toContain('banco.com.br');
  });
});

describe('send-email: destinatário precisa ser operador ativo', () => {
  it('bloqueia endereço de fora com 403 e não manda nada', async () => {
    const { handler, enviados } = await carregar();
    const res = await handler(
      reqPost({ to: ['alvo@externo.com'], subject: 'Assunto', html: '<p>corpo</p>' }, 'jwt-valido')
    );
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('recipient_not_allowed');
    expect(enviados).toHaveLength(0);
  });

  it('bloqueia operador desativado', async () => {
    const { handler, enviados } = await carregar();
    const res = await handler(
      reqPost(
        { to: ['desligado@initnet.com.br'], subject: 'Assunto', html: '<p>corpo</p>' },
        'jwt-valido'
      )
    );
    expect(res.status).toBe(403);
    expect(enviados).toHaveLength(0);
  });

  it('um destinatário válido não abre a porta para um inválido na mesma lista', async () => {
    const { handler, enviados } = await carregar();
    const res = await handler(
      reqPost(
        {
          to: ['colega@initnet.com.br', 'alvo@externo.com'],
          subject: 'Assunto',
          html: '<p>corpo</p>',
        },
        'jwt-valido'
      )
    );
    expect(res.status).toBe(403);
    expect(enviados).toHaveLength(0);
  });

  it('deixa passar quando todos são operadores ativos', async () => {
    const { handler, enviados } = await carregar();
    const res = await handler(
      reqPost(
        {
          to: ['colega@initnet.com.br', 'quem.chama@initnet.com.br'],
          subject: 'Assunto',
          html: '<p>corpo</p>',
        },
        'jwt-valido'
      )
    );
    expect(res.status).toBe(200);
    expect(enviados[0].to).toEqual(['colega@initnet.com.br', 'quem.chama@initnet.com.br']);
  });
});
