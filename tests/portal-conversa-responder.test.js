import { describe, it, expect } from 'vitest';
import { loadHandler, reqPost } from './helpers/edge-harness.js';
import { fakeSupabase } from './helpers/fake-supabase.js';

// Roda o handler de verdade (tests/helpers/edge-harness.js), com o dublê de
// Supabase registrando as queries. O que importa aqui é o ESCOPO: o destino da
// resposta e o status que ela marca não podem sair do que o navegador manda.
const ENV = {
  SUPABASE_URL: 'https://projeto.supabase.co',
  SUPABASE_ANON_KEY: 'anon-de-teste',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-de-teste',
  GMAIL_USER: 'robo@initnet.com.br',
  GMAIL_APP_PASSWORD: 'senha-de-app',
  GMAIL_FROM: 'robo@initnet.com.br',
};

const OPERADOR = { id: 'op-1', auth_user_id: 'user-1', name: 'Ana', active: true, team: 'init' };

function entrada(over) {
  return Object.assign({
    id: 'e1',
    thread_id: 't1',
    direcao: 'entrada',
    de: 'Márcia <marcia@acme.com.br>',
    assunto: 'Impressora',
    team: 'init',
    canal: 'email',
    telefone: null,
    pendencia_id: null,
    client_id: 'CLI-1',
    message_id: '<m1@acme.com.br>',
    recebido_em: '2026-10-26T10:00:00Z',
  }, over);
}

async function chamar({ linhas = [entrada()], body = { thread_id: 't1', text: 'Vamos verificar.' } } = {}) {
  const queries = [];
  const enviados = [];
  const { handler } = await loadHandler('conversa-responder', {
    env: ENV,
    createClient: fakeSupabase({
      user: { id: 'user-1' },
      queries,
      tabelas: { operators: [OPERADOR], emails_triagem: linhas },
    }),
    createTransport: () => ({
      sendMail: async (msg) => { enviados.push(msg); return { messageId: 'novo@initnet.com.br' }; },
      close: () => {},
    }),
  });
  const res = await handler(reqPost(body, 'jwt-valido'));
  return { res, dados: await res.json(), queries, enviados };
}

describe('conversa-responder: destino e escopo', () => {
  it('o destinatário do e-mail sai do thread, nunca do body', async () => {
    const { enviados } = await chamar({
      body: { thread_id: 't1', text: 'oi', to: 'vitima@exemplo.com', telefone: '5511999999999' },
    });
    expect(enviados).toHaveLength(1);
    expect(enviados[0].to).toBe('marcia@acme.com.br');
  });

  it('WhatsApp só responde para quem já escreveu para a empresa', async () => {
    const { res, enviados } = await chamar({
      linhas: [entrada({ canal: 'whatsapp', telefone: '5511987654321', de: 'Márcia' })],
    });
    expect(res.status).toBe(422);
    expect(enviados).toEqual([]);
  });

  // O update usa service role: sem o filtro de team, responder por uma equipe
  // tirava da fila a conversa da outra com o mesmo thread (WhatsApp não tem
  // thread por equipe).
  it('marca como atendida só a conversa da mesma equipe', async () => {
    const { res, queries } = await chamar({
      linhas: [
        entrada({ id: 'e1', team: 'init' }),
        entrada({ id: 'e2', team: 'mam', recebido_em: '2026-10-26T11:00:00Z' }),
      ],
    });
    expect(res.status).toBe(200);
    const up = queries.find((q) => q.patch && q.patch.status === 'anexado');
    expect(up.filtros).toEqual(expect.arrayContaining([['thread_id', 't1'], ['team', 'init']]));
  });

  it('resposta reabre pendente e encerrada; nota interna só mexe em pendente', async () => {
    const resposta = await chamar();
    const up = resposta.queries.find((q) => q.patch && q.patch.status === 'anexado');
    expect(up.filtros.find(([c]) => c === 'status')[1]).toEqual(['pendente', 'encerrado']);

    const nota = await chamar({ body: { thread_id: 't1', text: 'só para a equipe', kind: 'internal' } });
    const upNota = nota.queries.find((q) => q.patch && q.patch.status === 'anexado');
    expect(upNota.filtros.find(([c]) => c === 'status')[1]).toBe('pendente');
  });

  it('grava a resposta como saída e a nota como interna', async () => {
    const resposta = await chamar();
    expect(resposta.queries.find((q) => q.insert).insert.direcao).toBe('saida');

    const nota = await chamar({ body: { thread_id: 't1', text: 'nota', kind: 'internal' } });
    expect(nota.queries.find((q) => q.insert).insert.direcao).toBe('interna');
  });

  it('thread que não existe devolve 404 sem enviar nada', async () => {
    const { res, enviados } = await chamar({ linhas: [] });
    expect(res.status).toBe(404);
    expect(enviados).toEqual([]);
  });

  it('arquivo com base64 inválido é recusado antes de enviar', async () => {
    const { res, enviados } = await chamar({
      body: { thread_id: 't1', text: '', file: { nome: 'x.png', tipo: 'image/png', dados: '###' } },
    });
    expect(res.status).toBe(400);
    expect(enviados).toEqual([]);
  });
});
