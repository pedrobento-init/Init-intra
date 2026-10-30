import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadHandler, reqPost } from './helpers/edge-harness.js';
import { fakeSupabase } from './helpers/fake-supabase.js';

// Irmã da pendencia-responder (tests/pendencia-responder.test.js): a mesma
// trava, com o destinatário vindo da LINHA da caixa em vez do chamado. O
// invariante que estes testes protegem: a chave pública que vai no site não pode
// virar relay de e-mail — o app manda o id da linha, o endereço sai do `de`
// dela, e a linha só é lida com o cliente do operador (RLS por equipe é a
// permissão; sem supabaseAdmin, outra equipe recebe 404 e nada é enviado).

const src = fs.readFileSync(
  fileURLToPath(new URL('../supabase/functions/caixa-responder/index.ts', import.meta.url)),
  'utf8',
);

describe('caixa-responder: o destinatário nunca vem do app', () => {
  it('o corpo da requisição só traz email_id e text', () => {
    const destruct = /const\s*\{([^}]*)\}\s*=\s*await\s+req\.json\(\)/.exec(src);
    expect(destruct, 'não achei a leitura do corpo da requisição').not.toBeNull();
    const campos = destruct[1].split(',').map((s) => s.trim()).filter(Boolean).sort();
    expect(campos).toEqual(['email_id', 'text']);
  });

  it('o endereço sai do `de` da linha', () => {
    expect(src).toMatch(/const\s+destino\s*=\s*enderecoDe\(row\.de\)/);
    expect(src).toMatch(/to:\s*destino\b/);
  });
});

describe('caixa-responder: a linha é do operador, não da chave de serviço', () => {
  it('o fonte nunca usa supabaseAdmin: o RLS por equipe é a trava', () => {
    expect(src).not.toMatch(/supabaseAdmin/);
  });

  it('a linha vem de emails_triagem, lida com o cliente do usuário', () => {
    expect(src).toMatch(/ctx\.supabase\s*\n\s*\.from\("emails_triagem"\)/);
  });

  it('exige operador ativo logado, como a pendencia-responder', () => {
    expect(src).toMatch(/withSupabase\(\s*\{\s*auth:\s*"user"\s*\}/);
    expect(src).toMatch(/from\("operators"\)/);
    expect(src).toContain('unauthorized');
  });
});

describe('caixa-responder: só responde o que ainda está pendente', () => {
  it('linha já tratada é recusada antes do envio', () => {
    expect(src).toContain('already_handled');
    expect(src).toMatch(/status\s*!==\s*"pendente"/);
  });
});

describe('caixa-responder: mesma conversa', () => {
  it('devolve o message_id da linha em In-Reply-To e References', () => {
    expect(src).toMatch(/inReplyTo:\s*refId/);
    expect(src).toMatch(/references:\s*\[refId\]/);
  });

  it('sem message_id o e-mail sai assim mesmo, avisando que não ficou na conversa', () => {
    expect(src).toMatch(/threaded:\s*!!refId/);
  });
});

describe('caixa-responder: a resposta fica registrada na conversa', () => {
  it('a mensagem enviada vira linha com status respondido, id do envio e team da origem', () => {
    expect(src).toMatch(/insert\(/);
    expect(src).toMatch(/email_id:\s*info\.messageId/);
    expect(src).toMatch(/status:\s*"respondido"/);
    expect(src).toMatch(/team:\s*row\.team/);
  });

  it('e as pendentes do thread também viram respondido', () => {
    expect(src).toMatch(/update\(\{[^}]*status:\s*"respondido"/);
    expect(src).toMatch(/eq\("status", "pendente"\)/);
  });

  it('falha de gravação não desfaz o envio: volta registrada: false', () => {
    expect(src).toMatch(/registrado:\s*!insErr\s*&&\s*!updErr/);
  });
});

// ── Comportamento: roda o index.ts de verdade (tests/helpers/edge-harness.js) ──

const ENV = {
  SUPABASE_URL: 'https://projeto.supabase.co',
  SUPABASE_ANON_KEY: 'anon-de-teste',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-de-teste',
  GMAIL_USER: 'robo@initnet.com.br',
  GMAIL_APP_PASSWORD: 'senha-de-app',
  GMAIL_FROM: 'robo@initnet.com.br',
};

const OPERADOR = {
  id: 'op-1', auth_user_id: 'user-1', name: 'Ana', team: 'init', active: true,
};

const LINHA = {
  id: 'ETR-1', de: 'Márcia Prado <marcia@acme.com.br>', assunto: 'Impressora não imprime',
  message_id: '<m1@acme.com.br>', thread_id: 't1', status: 'pendente',
  pendencia_id: null, client_id: null, team: 'init',
};

/** Fake que registra o que a function gravou (insert/update/eq) para assertar. */
function createClientGravando(tabelas, gravacoes) {
  const base = fakeSupabase({ user: { id: 'user-1' }, tabelas });
  return (url, key, opts) => {
    const c = base(url, key, opts);
    const fromBase = c.from.bind(c);
    c.from = (tabela) => {
      const b = fromBase(tabela);
      for (const m of ['select', 'insert', 'update', 'eq']) {
        const f = b[m].bind(b);
        b[m] = (...args) => { gravacoes.push({ tabela, m, args }); return f(...args); };
      }
      return b;
    };
    return c;
  };
}

describe('caixa-responder: envio de verdade (harness)', () => {
  it('manda na mesma conversa, grava a resposta e fecha as pendentes do thread', async () => {
    const gravacoes = [];
    const mails = [];
    const { handler } = await loadHandler('caixa-responder', {
      env: ENV,
      createClient: createClientGravando(
        { operators: [OPERADOR], emails_triagem: [LINHA, { ...LINHA, id: 'ETR-0', message_id: '<m0@acme.com.br>' }] },
        gravacoes
      ),
      createTransport: () => ({
        sendMail: async (mail) => { mails.push(mail); return { messageId: '<resposta@init>' }; },
        close: () => {},
      }),
    });

    const res = await handler(reqPost({ email_id: 'ETR-1', text: 'Olá Márcia, vamos verificar.' }, 'jwt-valido'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      success: true, to: 'marcia@acme.com.br', threaded: true, registrado: true,
    });

    // Mesma conversa: o message-id da linha original volta no cabeçalho.
    expect(mails).toHaveLength(1);
    expect(mails[0].inReplyTo).toBe('<m1@acme.com.br>');
    expect(mails[0].to).toBe('marcia@acme.com.br');

    const ins = gravacoes.find((g) => g.tabela === 'emails_triagem' && g.m === 'insert');
    expect(ins, 'a resposta não foi gravada em emails_triagem').toBeTruthy();
    expect(ins.args[0]).toMatchObject({
      email_id: '<resposta@init>', message_id: '<resposta@init>',
      thread_id: 't1', status: 'respondido', team: 'init', tratado_por: 'Ana',
    });

    const upd = gravacoes.find((g) => g.tabela === 'emails_triagem' && g.m === 'update');
    expect(upd, 'as pendentes do thread não foram fechadas').toBeTruthy();
    expect(upd.args[0]).toMatchObject({ status: 'respondido', tratado_por: 'Ana' });
  });

  it('linha já tratada não gera segundo e-mail', async () => {
    const gravacoes = [];
    const mails = [];
    const { handler } = await loadHandler('caixa-responder', {
      env: ENV,
      createClient: createClientGravando(
        { operators: [OPERADOR], emails_triagem: [{ ...LINHA, status: 'virou_chamado' }] },
        gravacoes
      ),
      createTransport: () => ({
        sendMail: async (mail) => { mails.push(mail); return { messageId: '<não-deveria>' }; },
        close: () => {},
      }),
    });

    const res = await handler(reqPost({ email_id: 'ETR-1', text: 'resposta dupla' }, 'jwt-valido'));
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('already_handled');
    expect(mails).toHaveLength(0);
  });

  it('linha de equipe que o operador não enxerga não é encontrada', async () => {
    const { handler } = await loadHandler('caixa-responder', {
      env: ENV,
      // O RLS deixa a linha invisível: para o handler ela simplesmente não existe.
      createClient: createClientGravando({ operators: [OPERADOR], emails_triagem: [] }, []),
      createTransport: () => ({ sendMail: async () => ({ messageId: 'x' }), close: () => {} }),
    });
    const res = await handler(reqPost({ email_id: 'ETR-de-outra-equipe', text: 'oi' }, 'jwt-valido'));
    expect(res.status).toBe(404);
  });
});
