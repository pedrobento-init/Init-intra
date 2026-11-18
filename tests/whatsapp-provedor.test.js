import { describe, it, expect } from 'vitest';
import {
  emojiValido,
  enviarReacao,
  enviarTexto,
  eventosDeStatus,
  idCurto,
  marcarVisto,
  mensagensDoWebhook,
} from '../supabase/functions/whatsapp/provedor.ts';

// Adaptador do WAHA: único lugar que conhece o formato do provedor; os testes
// de mensagem.ts continuam independentes dele.

const recebida = (extra = {}, evento = {}) => ({
  event: 'message',
  session: 'default',
  payload: {
    id: 'MSG1',
    timestamp: Date.UTC(2026, 9, 30, 12, 0, 0) / 1000,
    from: '5511987654321@c.us',
    fromMe: false,
    body: 'A impressora parou',
    hasMedia: false,
    _data: { notifyName: 'Maria' },
    ...extra,
  },
  ...evento,
});

describe('mensagensDoWebhook', () => {
  it('traduz o evento message para MensagemWhats', () => {
    expect(mensagensDoWebhook(recebida())).toEqual([
      {
        telefone: '5511987654321',
        nome: 'Maria',
        texto: 'A impressora parou',
        id: 'MSG1',
        quando: '2026-10-30T12:00:00.000Z',
      },
    ]);
  });

  it('ignora o que o próprio número mandou, para o chamado não conversar consigo', () => {
    expect(mensagensDoWebhook(recebida({ fromMe: true }))).toEqual([]);
  });

  it('ignora grupo: o remetente seria o grupo, não o solicitante', () => {
    expect(mensagensDoWebhook(recebida({ from: '123456789@g.us' }))).toEqual([]);
  });

  it('ignora mensagem sem texto (áudio, figurinha)', () => {
    expect(mensagensDoWebhook(recebida({ body: undefined }))).toEqual([]);
    expect(mensagensDoWebhook(recebida({ body: '   ' }))).toEqual([]);
  });

  it('ignora outros eventos (status de entrega, presença)', () => {
    expect(mensagensDoWebhook(recebida({}, { event: 'message.ack' }))).toEqual([]);
  });

  it('sem id não entra: a deduplicação depende dele', () => {
    expect(mensagensDoWebhook(recebida({ id: '' }))).toEqual([]);
  });

  it('aceita lote e descarta lixo sem lançar', () => {
    const out = mensagensDoWebhook([recebida(), null, 'x', recebida({ id: 'MSG2', fromMe: true })]);
    expect(out.map((m) => m.id)).toEqual(['MSG1']);
  });

  it('telefone sai só com dígitos', () => {
    expect(mensagensDoWebhook(recebida({ from: '+55 (11) 98765-4321@c.us' }))[0].telefone).toBe(
      '5511987654321'
    );
  });
});

function fetchFalso(resposta) {
  const chamadas = [];
  const fn = async (url, init) => {
    chamadas.push({ url, init });
    if (resposta instanceof Error) throw resposta;
    return resposta;
  };
  return { fn, chamadas };
}

const cred = { baseUrl: 'https://waha.exemplo.com/', apiKey: 'SEGREDO', session: 'default' };
const okJson = (body) => new Response(JSON.stringify(body), { status: 200 });

describe('enviarTexto', () => {
  it('chama o sendText com a chave no header e o chatId do WAHA', async () => {
    const f = fetchFalso(okJson({ id: 'W1' }));
    await enviarTexto('+55 11 98765-4321', 'oi', cred, f.fn);
    expect(f.chamadas).toHaveLength(1);
    const { url, init } = f.chamadas[0];
    expect(url).toBe('https://waha.exemplo.com/api/sendText');
    expect(init.method).toBe('POST');
    expect(init.headers['X-Api-Key']).toBe('SEGREDO');
    expect(JSON.parse(init.body)).toEqual({
      session: 'default',
      chatId: '5511987654321@c.us',
      text: 'oi',
    });
  });

  it('usa a sessão default quando ela não foi configurada', async () => {
    const f = fetchFalso(okJson({}));
    await enviarTexto(
      '5511987654321',
      'oi',
      { baseUrl: 'http://localhost:3000', apiKey: 'K' },
      f.fn
    );
    expect(JSON.parse(f.chamadas[0].init.body).session).toBe('default');
  });

  it('devolve o id da mensagem enviada', async () => {
    expect(
      await enviarTexto('5511987654321', 'oi', cred, fetchFalso(okJson({ id: 'W1' })).fn)
    ).toEqual({ ok: true, id: 'W1' });
  });

  it('2xx sem JSON ainda conta como enviado', async () => {
    const r = await enviarTexto(
      '5511987654321',
      'oi',
      cred,
      fetchFalso(new Response('ok', { status: 200 })).fn
    );
    expect(r).toEqual({ ok: true });
  });

  it('erro HTTP do provedor vira erro com o status, sem a URL ou chave', async () => {
    const r = await enviarTexto(
      '5511987654321',
      'oi',
      cred,
      fetchFalso(new Response('x', { status: 401 })).fn
    );
    expect(r).toEqual({ ok: false, erro: 'provedor 401' });
  });

  it('falha de rede não lança', async () => {
    const r = await enviarTexto(
      '5511987654321',
      'oi',
      cred,
      fetchFalso(new Error('ECONNRESET')).fn
    );
    expect(r).toEqual({ ok: false, erro: 'inalcancavel' });
  });

  it('sem credencial completa nem tenta chamar', async () => {
    const f = fetchFalso(okJson({}));
    const r = await enviarTexto('5511987654321', 'oi', { baseUrl: 'http://localhost:3000' }, f.fn);
    expect(r).toEqual({ ok: false, erro: 'credenciais' });
    expect(f.chamadas).toHaveLength(0);
  });
});

describe('mídia do WAHA', () => {
  it('aceita imagem sem texto e normaliza os metadados', () => {
    const p = recebida({
      body: '',
      hasMedia: true,
      media: {
        url: 'http://localhost:3000/api/files/foto.jpg',
        mimetype: 'image/jpeg',
        filename: 'foto.jpg',
      },
    });
    const [m] = mensagensDoWebhook(p);
    expect(m.media).toEqual({
      nome: 'foto.jpg',
      tipo: 'image/jpeg',
      url: 'http://localhost:3000/api/files/foto.jpg',
    });
  });

  it('não aceita URL de mídia fora de HTTP', () => {
    const p = recebida({ body: '', hasMedia: true, media: { url: 'javascript:alert(1)' } });
    expect(mensagensDoWebhook(p)).toEqual([]);
  });
});

describe('conversa rica: citação, recibo e reação (086)', () => {
  it('guarda a mensagem que o contato respondeu citando', () => {
    const [m] = mensagensDoWebhook(recebida({ replyTo: { id: 'ABC', body: 'Qual o modelo?' } }));
    expect(m.citacao).toEqual({ id: 'ABC', texto: 'Qual o modelo?' });
  });

  it('engine antigo do WAHA: a citação vem em _data.quotedMsg', () => {
    const [m] = mensagensDoWebhook(
      recebida({ _data: { notifyName: 'Maria', quotedStanzaID: 'XYZ', quotedMsg: { body: 'oi' } } })
    );
    expect(m.citacao).toEqual({ id: 'XYZ', texto: 'oi' });
  });

  it('mensagem sem citação não ganha o campo', () => {
    expect(mensagensDoWebhook(recebida())[0]).not.toHaveProperty('citacao');
  });

  it('recibo só conta para mensagem que a empresa mandou', () => {
    const ack = (fromMe, ack) => ({
      event: 'message.ack',
      payload: { id: 'true_5511@c.us_A1', fromMe, ack },
    });
    expect(eventosDeStatus([ack(true, 3), ack(false, 3)]).recibos).toEqual([
      { id: 'true_5511@c.us_A1', ack: 3 },
    ]);
  });

  it('recibo fora da faixa do WAHA é ignorado', () => {
    const r = eventosDeStatus({ event: 'message.ack', payload: { id: 'X', fromMe: true, ack: 9 } });
    expect(r.recibos).toEqual([]);
  });

  it('reação do contato e reação tirada (texto vazio)', () => {
    const reacao = (text, fromMe = false) => ({
      event: 'message.reaction',
      payload: { from: '5511@c.us', fromMe, reaction: { text, messageId: 'true_5511@c.us_A1' } },
    });
    expect(eventosDeStatus([reacao('👍'), reacao('', true)]).reacoes).toEqual([
      { alvo: 'true_5511@c.us_A1', emoji: '👍', deMim: false },
      { alvo: 'true_5511@c.us_A1', emoji: '', deMim: true },
    ]);
  });

  it('reação que não é emoji não passa (vai parar na tela)', () => {
    expect(emojiValido('<b>')).toBe(false);
    expect(emojiValido('ok')).toBe(false);
    expect(emojiValido('❤️')).toBe(true);
  });

  it('id curto é o final do id serializado', () => {
    expect(idCurto('true_5511@c.us_3EB0ABC')).toBe('3EB0ABC');
  });

  it('id do envio vindo como objeto (_serialized) também é guardado', async () => {
    const r = await enviarTexto(
      '5511987654321',
      'oi',
      cred,
      fetchFalso(okJson({ id: { _serialized: 'true_x@c.us_Z' } })).fn
    );
    expect(r).toEqual({ ok: true, id: 'true_x@c.us_Z' });
  });

  it('responder citando manda reply_to para o WAHA', async () => {
    const f = fetchFalso(okJson({ id: 'W1' }));
    await enviarTexto('5511987654321', 'oi', cred, f.fn, { replyTo: 'false_x@c.us_Q' });
    expect(JSON.parse(f.chamadas[0].init.body).reply_to).toBe('false_x@c.us_Q');
  });

  it('reação sai por PUT /api/reaction com o id da mensagem', async () => {
    const f = fetchFalso(okJson({}));
    expect(await enviarReacao('false_x@c.us_Q', '👍', cred, f.fn)).toEqual({ ok: true });
    expect(f.chamadas[0].url).toBe('https://waha.exemplo.com/api/reaction');
    expect(f.chamadas[0].init.method).toBe('PUT');
    expect(JSON.parse(f.chamadas[0].init.body)).toMatchObject({
      messageId: 'false_x@c.us_Q',
      reaction: '👍',
    });
  });

  it('marcar visto usa o chatId do telefone', async () => {
    const f = fetchFalso(okJson({}));
    await marcarVisto('+55 11 98765-4321', cred, f.fn);
    expect(f.chamadas[0].url).toBe('https://waha.exemplo.com/api/sendSeen');
    expect(JSON.parse(f.chamadas[0].init.body).chatId).toBe('5511987654321@c.us');
  });
});
