import { describe, it, expect } from 'vitest';
import { enviarTexto, mensagensDoWebhook } from '../supabase/functions/whatsapp/provedor.ts';

// Adaptador da Z-API: único lugar que conhece o formato do provedor. Se um dia
// trocar para Evolution ou Meta Cloud, estes testes mudam junto; os de
// mensagem.ts não.

const recebida = (extra = {}) => ({
  type: 'ReceivedCallback',
  phone: '5511987654321',
  fromMe: false,
  isGroup: false,
  messageId: 'MSG1',
  senderName: 'Maria',
  momment: Date.UTC(2026, 9, 30, 12, 0, 0),
  text: { message: 'A impressora parou' },
  ...extra,
});

describe('mensagensDoWebhook', () => {
  it('traduz o ReceivedCallback para MensagemWhats', () => {
    expect(mensagensDoWebhook(recebida())).toEqual([{
      telefone: '5511987654321',
      nome: 'Maria',
      texto: 'A impressora parou',
      id: 'MSG1',
      quando: '2026-10-30T12:00:00.000Z',
    }]);
  });

  it('ignora o que o próprio número mandou, para o chamado não conversar consigo', () => {
    expect(mensagensDoWebhook(recebida({ fromMe: true }))).toEqual([]);
  });

  it('ignora grupo: o telefone seria o do grupo, não do solicitante', () => {
    expect(mensagensDoWebhook(recebida({ isGroup: true }))).toEqual([]);
  });

  it('ignora mensagem sem texto (áudio, figurinha)', () => {
    expect(mensagensDoWebhook(recebida({ text: undefined }))).toEqual([]);
    expect(mensagensDoWebhook(recebida({ text: { message: '   ' } }))).toEqual([]);
  });

  it('ignora outros callbacks (status de entrega, presença)', () => {
    expect(mensagensDoWebhook(recebida({ type: 'MessageStatusCallback' }))).toEqual([]);
  });

  it('sem messageId não entra: a deduplicação depende dele', () => {
    expect(mensagensDoWebhook(recebida({ messageId: '' }))).toEqual([]);
  });

  it('aceita lote e descarta lixo sem lançar', () => {
    const out = mensagensDoWebhook([recebida(), null, 'x', recebida({ messageId: 'MSG2', fromMe: true })]);
    expect(out.map((m) => m.id)).toEqual(['MSG1']);
  });

  it('telefone sai só com dígitos', () => {
    expect(mensagensDoWebhook(recebida({ phone: '+55 (11) 98765-4321' }))[0].telefone).toBe('5511987654321');
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

const cred = { instanceId: 'INST', token: 'TOK', clientToken: 'CT' };
const okJson = (body) => new Response(JSON.stringify(body), { status: 200 });

describe('enviarTexto', () => {
  it('chama o send-text da instância com o Client-Token no header', async () => {
    const f = fetchFalso(okJson({ zaapId: 'Z1' }));
    await enviarTexto('+55 11 98765-4321', 'oi', cred, f.fn);
    expect(f.chamadas).toHaveLength(1);
    const { url, init } = f.chamadas[0];
    expect(url).toBe('https://api.z-api.io/instances/INST/token/TOK/send-text');
    expect(init.method).toBe('POST');
    expect(init.headers['Client-Token']).toBe('CT');
    expect(JSON.parse(init.body)).toEqual({ phone: '5511987654321', message: 'oi' });
  });

  it('id vem do zaapId, depois messageId, depois id', async () => {
    expect(await enviarTexto('5511987654321', 'oi', cred, fetchFalso(okJson({ zaapId: 'Z', messageId: 'M' })).fn))
      .toEqual({ ok: true, id: 'Z' });
    expect(await enviarTexto('5511987654321', 'oi', cred, fetchFalso(okJson({ messageId: 'M', id: 'I' })).fn))
      .toEqual({ ok: true, id: 'M' });
    expect(await enviarTexto('5511987654321', 'oi', cred, fetchFalso(okJson({ id: 'I' })).fn))
      .toEqual({ ok: true, id: 'I' });
  });

  it('2xx sem JSON ainda conta como enviado', async () => {
    const r = await enviarTexto('5511987654321', 'oi', cred, fetchFalso(new Response('ok', { status: 200 })).fn);
    expect(r).toEqual({ ok: true });
  });

  it('erro HTTP do provedor vira erro com o status, sem a URL', async () => {
    const r = await enviarTexto('5511987654321', 'oi', cred, fetchFalso(new Response('x', { status: 401 })).fn);
    expect(r).toEqual({ ok: false, erro: 'provedor 401' });
  });

  it('falha de rede não lança', async () => {
    const r = await enviarTexto('5511987654321', 'oi', cred, fetchFalso(new Error('ECONNRESET')).fn);
    expect(r).toEqual({ ok: false, erro: 'inalcancavel' });
  });

  it('sem credencial completa nem tenta chamar', async () => {
    const f = fetchFalso(okJson({}));
    const r = await enviarTexto('5511987654321', 'oi', { instanceId: 'INST', token: 'TOK' }, f.fn);
    expect(r).toEqual({ ok: false, erro: 'credenciais' });
    expect(f.chamadas).toHaveLength(0);
  });
});
