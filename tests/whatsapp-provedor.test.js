import { describe, it, expect } from 'vitest';
import { enviarTexto, mensagensDoWebhook } from '../supabase/functions/whatsapp/provedor.ts';

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
    const p = recebida({ body: '', hasMedia: true, media: { url: 'http://localhost:3000/api/files/foto.jpg', mimetype: 'image/jpeg', filename: 'foto.jpg' } });
    const [m] = mensagensDoWebhook(p);
    expect(m.media).toEqual({ nome: 'foto.jpg', tipo: 'image/jpeg', url: 'http://localhost:3000/api/files/foto.jpg' });
  });

  it('não aceita URL de mídia fora de HTTP', () => {
    const p = recebida({ body: '', hasMedia: true, media: { url: 'javascript:alert(1)' } });
    expect(mensagensDoWebhook(p)).toEqual([]);
  });
});
