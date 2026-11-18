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
  WAHA_BASE_URL: 'https://waha.teste',
  WAHA_API_KEY: 'waha-key-teste',
  WAHA_SESSION: 'default',
};

const OPERADOR = { id: 'op-1', auth_user_id: 'user-1', name: 'Ana', active: true, team: 'init' };

function entrada(over) {
  return Object.assign(
    {
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
    },
    over
  );
}

async function chamar({
  linhas = [entrada()],
  body = { thread_id: 't1', text: 'Vamos verificar.' },
  fetchStub,
  contatos = [],
} = {}) {
  const queries = [];
  const enviados = [];
  const { handler } = await loadHandler('conversa-responder', {
    env: ENV,
    createClient: fakeSupabase({
      user: { id: 'user-1' },
      queries,
      tabelas: { operators: [OPERADOR], emails_triagem: linhas, whatsapp_conversas: contatos },
    }),
    createTransport: () => ({
      sendMail: async (msg) => {
        enviados.push(msg);
        return { messageId: 'novo@initnet.com.br' };
      },
      close: () => {},
    }),
    fetch: fetchStub,
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
    expect(up.filtros).toEqual(
      expect.arrayContaining([
        ['thread_id', 't1'],
        ['team', 'init'],
      ])
    );
  });

  it('resposta reabre pendente e encerrada; nota interna só mexe em pendente', async () => {
    const resposta = await chamar();
    const up = resposta.queries.find((q) => q.patch && q.patch.status === 'anexado');
    expect(up.filtros.find(([c]) => c === 'status')[1]).toEqual(['pendente', 'encerrado']);

    const nota = await chamar({
      body: { thread_id: 't1', text: 'só para a equipe', kind: 'internal' },
    });
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

  it('no WhatsApp o texto vai com o nome de quem atende, para o cliente saber', async () => {
    const enviadosWA = [];
    const { res, queries } = await chamar({
      linhas: [entrada({ canal: 'whatsapp', telefone: '5511987654321', de: 'Márcia' })],
      body: { thread_id: 't1', text: 'Vamos verificar.' },
      contatos: [{ telefone: '5511987654321' }],
      fetchStub: async (url, init) => {
        enviadosWA.push({ url: String(url), body: JSON.parse(String(init && init.body)) });
        return new Response(JSON.stringify({ id: 'wa-1' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });
    expect(res.status).toBe(200);
    expect(enviadosWA).toHaveLength(1);
    expect(enviadosWA[0].url).toContain('/api/sendText');
    expect(enviadosWA[0].body.text).toBe('Ana: Vamos verificar.');
    // O histórico mostra a mesma mensagem que o cliente recebeu.
    const ins = queries.find((q) => q.insert);
    expect(ins.insert.direcao).toBe('saida');
    expect(ins.insert.corpo).toBe('Ana: Vamos verificar.');
  });

  it('nota interna não leva o nome de quem atende (não vai para o cliente)', async () => {
    const { res, queries } = await chamar({
      linhas: [entrada({ canal: 'whatsapp', telefone: '5511987654321', de: 'Márcia' })],
      body: { thread_id: 't1', text: 'só anotação interna', kind: 'internal' },
    });
    expect(res.status).toBe(200);
    const ins = queries.find((q) => q.insert);
    expect(ins.insert.direcao).toBe('interna');
    expect(ins.insert.corpo).toBe('só anotação interna');
  });

  it('arquivo com base64 inválido é recusado antes de enviar', async () => {
    const { res, enviados } = await chamar({
      body: { thread_id: 't1', text: '', file: { nome: 'x.png', tipo: 'image/png', dados: '###' } },
    });
    expect(res.status).toBe(400);
    expect(enviados).toEqual([]);
  });
});

describe('conversa-responder: citação, reação e visto (086)', () => {
  const whats = (over) =>
    entrada({
      canal: 'whatsapp',
      telefone: '5511987654321',
      de: 'Márcia',
      thread_id: 'whatsapp:1187654321',
      message_id: 'false_5511987654321@c.us_Q1',
      corpo: 'Qual o prazo?',
      ...over,
    });
  const contatos = [{ telefone: '5511987654321' }];
  const wahaOk = () => {
    const chamadas = [];
    const fn = async (url, init) => {
      chamadas.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
      return new Response(JSON.stringify({ id: 'true_x@c.us_NOVO' }), { status: 200 });
    };
    return { fn, chamadas };
  };

  it('responder citando manda reply_to e grava a citação', async () => {
    const waha = wahaOk();
    const { res, queries } = await chamar({
      linhas: [whats()],
      contatos,
      fetchStub: waha.fn,
      body: { thread_id: 'whatsapp:1187654321', text: 'Amanhã', reply_to: 'e1' },
    });
    expect(res.status).toBe(200);
    expect(waha.chamadas[0].body.reply_to).toBe('false_5511987654321@c.us_Q1');
    const ins = queries.find((q) => q.insert && q.insert.direcao === 'saida');
    expect(ins.insert.citacao).toEqual({
      id: 'false_5511987654321@c.us_Q1',
      texto: 'Qual o prazo?',
      autor: 'Márcia',
    });
  });

  // O id citado vem do navegador: sem o filtro de thread e equipe, daria para
  // citar (e expor o texto de) uma mensagem de outra conversa.
  it('mensagem citada de outra equipe não é encontrada', async () => {
    const waha = wahaOk();
    const { res } = await chamar({
      linhas: [whats(), whats({ id: 'outra', team: 'mam', recebido_em: '2026-10-26T09:00:00Z' })],
      contatos,
      fetchStub: waha.fn,
      body: { thread_id: 'whatsapp:1187654321', text: 'x', reply_to: 'outra' },
    });
    expect(res.status).toBe(404);
    expect(waha.chamadas).toEqual([]);
  });

  it('reação sai para o WAHA e fica gravada como da equipe', async () => {
    const waha = wahaOk();
    const { res, queries } = await chamar({
      linhas: [whats()],
      contatos,
      fetchStub: waha.fn,
      body: { thread_id: 'whatsapp:1187654321', kind: 'reaction', alvo: 'e1', emoji: '👍' },
    });
    expect(res.status).toBe(200);
    expect(waha.chamadas[0].url).toBe('https://waha.teste/api/reaction');
    const up = queries.find((q) => q.patch && 'reacao_equipe' in q.patch);
    expect(up.patch.reacao_equipe).toBe('👍');
    expect(up.filtros).toEqual(expect.arrayContaining([['team', 'init']]));
  });

  // message_id é gravável pela equipe: sem amarrar ao chat do contato, daria
  // para o número da empresa reagir em mensagem de outra conversa.
  it('reação em mensagem cujo id é de outro chat é recusada', async () => {
    const waha = wahaOk();
    const { res } = await chamar({
      linhas: [whats({ message_id: 'false_5521999999999@c.us_X9' })],
      contatos,
      fetchStub: waha.fn,
      body: { thread_id: 'whatsapp:1187654321', kind: 'reaction', alvo: 'e1', emoji: '👍' },
    });
    expect(res.status).toBe(422);
    expect(waha.chamadas).toEqual([]);
  });

  it('visto e reação exigem a prova de contato, como a resposta', async () => {
    const waha = wahaOk();
    const { res } = await chamar({
      linhas: [whats()],
      contatos: [],
      fetchStub: waha.fn,
      body: { thread_id: 'whatsapp:1187654321', kind: 'seen' },
    });
    expect(res.status).toBe(422);
    expect(waha.chamadas).toEqual([]);
  });

  it('reação que não é emoji é recusada antes de qualquer envio', async () => {
    const waha = wahaOk();
    const { res } = await chamar({
      linhas: [whats()],
      contatos,
      fetchStub: waha.fn,
      body: { thread_id: 'whatsapp:1187654321', kind: 'reaction', alvo: 'e1', emoji: '<img>' },
    });
    expect(res.status).toBe(400);
    expect(waha.chamadas).toEqual([]);
  });

  it('reação e visto não existem no e-mail', async () => {
    const { res } = await chamar({ body: { thread_id: 't1', kind: 'seen' } });
    expect(res.status).toBe(400);
  });

  it('visto marca a conversa lida no WAHA sem gravar nada', async () => {
    const waha = wahaOk();
    const { res, queries } = await chamar({
      linhas: [whats()],
      contatos,
      fetchStub: waha.fn,
      body: { thread_id: 'whatsapp:1187654321', kind: 'seen' },
    });
    expect(res.status).toBe(200);
    expect(waha.chamadas[0].url).toBe('https://waha.teste/api/sendSeen');
    expect(queries.some((q) => q.insert || q.patch)).toBe(false);
  });
});
