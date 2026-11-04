import { describe, it, expect } from 'vitest';
import { enviarTexto, mensagensDoWebhook } from '../supabase/functions/whatsapp/provedor.ts';

// Adaptador da Evolution API: único lugar que conhece o formato do provedor.
// Se um dia trocar de provedor, estes testes mudam junto; os de mensagem.ts não.
// Os payloads seguem o prepareMessage da Evolution 2.3.7.

const recebida = ({ key = {}, message, ...extra } = {}) => ({
  event: 'messages.upsert',
  instance: 'intra',
  data: {
    key: { remoteJid: '5511987654321@s.whatsapp.net', fromMe: false, id: 'MSG1', ...key },
    pushName: 'Maria',
    message: message === undefined ? { conversation: 'A impressora parou' } : message,
    messageType: 'conversation',
    messageTimestamp: Date.UTC(2026, 9, 30, 12, 0, 0) / 1000,
    ...extra,
  },
  date_time: '2026-10-30T09:00:00.000Z',
});

describe('mensagensDoWebhook', () => {
  it('traduz o messages.upsert para MensagemWhats', () => {
    expect(mensagensDoWebhook(recebida())).toEqual([{
      telefone: '5511987654321',
      nome: 'Maria',
      texto: 'A impressora parou',
      id: 'MSG1',
      quando: '2026-10-30T12:00:00.000Z',
    }]);
  });

  it('aceita o nome do evento em maiúsculas (MESSAGES_UPSERT)', () => {
    expect(mensagensDoWebhook({ ...recebida(), event: 'MESSAGES_UPSERT' })).toHaveLength(1);
  });

  it('ignora outros eventos (status de entrega, conexão)', () => {
    expect(mensagensDoWebhook({ ...recebida(), event: 'messages.update' })).toEqual([]);
    expect(mensagensDoWebhook({ ...recebida(), event: 'connection.update' })).toEqual([]);
  });

  it('ignora o que o próprio número mandou, para o chamado não conversar consigo', () => {
    expect(mensagensDoWebhook(recebida({ key: { fromMe: true } }))).toEqual([]);
  });

  it('ignora grupo: o JID seria o do grupo, não do solicitante', () => {
    expect(mensagensDoWebhook(recebida({ key: { remoteJid: '120363000000000000@g.us' } }))).toEqual([]);
  });

  it('ignora status e lista de transmissão', () => {
    expect(mensagensDoWebhook(recebida({ key: { remoteJid: 'status@broadcast' } }))).toEqual([]);
  });

  it('contato @lid usa o telefone do remoteJidAlt', () => {
    const [m] = mensagensDoWebhook(recebida({
      key: { remoteJid: '123456789012345@lid', remoteJidAlt: '5521999990000@s.whatsapp.net' },
    }));
    expect(m.telefone).toBe('5521999990000');
  });

  it('contato @lid em versão antiga usa o senderPn', () => {
    const [m] = mensagensDoWebhook(recebida({
      key: { remoteJid: '123456789012345@lid', senderPn: '5521999990000@s.whatsapp.net' },
    }));
    expect(m.telefone).toBe('5521999990000');
  });

  it('@lid sem telefone alternativo fica de fora: o lid não é telefone', () => {
    expect(mensagensDoWebhook(recebida({ key: { remoteJid: '123456789012345@lid' } }))).toEqual([]);
  });

  it('JID com sufixo de aparelho vira só o telefone', () => {
    const [m] = mensagensDoWebhook(recebida({ key: { remoteJid: '5511987654321:12@s.whatsapp.net' } }));
    expect(m.telefone).toBe('5511987654321');
  });

  it('lê texto de extendedTextMessage (link, citação) se vier sem converter', () => {
    const [m] = mensagensDoWebhook(recebida({ message: { extendedTextMessage: { text: 'veja https://x' } } }));
    expect(m.texto).toBe('veja https://x');
  });

  it('ignora mensagem sem texto (áudio, figurinha, foto sem legenda)', () => {
    expect(mensagensDoWebhook(recebida({ message: { audioMessage: {} } }))).toEqual([]);
    expect(mensagensDoWebhook(recebida({ message: { conversation: '   ' } }))).toEqual([]);
    expect(mensagensDoWebhook(recebida({ message: null }))).toEqual([]);
  });

  it('sem id da mensagem não entra: a deduplicação depende dele', () => {
    expect(mensagensDoWebhook(recebida({ key: { id: '' } }))).toEqual([]);
  });

  it('timestamp em segundos ou já em milissegundos dá a mesma data', () => {
    const ms = Date.UTC(2026, 9, 30, 12, 0, 0);
    expect(mensagensDoWebhook(recebida({ messageTimestamp: String(ms / 1000) }))[0].quando)
      .toBe('2026-10-30T12:00:00.000Z');
    expect(mensagensDoWebhook(recebida({ messageTimestamp: ms }))[0].quando)
      .toBe('2026-10-30T12:00:00.000Z');
  });

  it('aceita lote de envelopes e data em lista, e descarta lixo sem lançar', () => {
    const dois = { ...recebida(), data: [recebida().data, recebida({ key: { id: 'MSG2' } }).data] };
    const out = mensagensDoWebhook([dois, null, 'x', recebida({ key: { id: 'MSG3', fromMe: true } })]);
    expect(out.map((m) => m.id)).toEqual(['MSG1', 'MSG2']);
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

const cred = { url: 'https://evo.exemplo.com.br/', instancia: 'intra teste', apikey: 'KEY' };
const okJson = (body) => new Response(JSON.stringify(body), { status: 201 });

describe('enviarTexto', () => {
  it('chama o sendText da instância com a apikey no cabeçalho', async () => {
    const f = fetchFalso(okJson({ key: { id: 'E1' } }));
    await enviarTexto('+55 11 98765-4321', 'oi', cred, f.fn);
    expect(f.chamadas).toHaveLength(1);
    const { url, init } = f.chamadas[0];
    expect(url).toBe('https://evo.exemplo.com.br/message/sendText/intra%20teste');
    expect(init.method).toBe('POST');
    expect(init.headers.apikey).toBe('KEY');
    expect(JSON.parse(init.body)).toEqual({ number: '5511987654321', text: 'oi' });
  });

  it('id vem do key.id da mensagem enviada', async () => {
    expect(await enviarTexto('5511987654321', 'oi', cred, fetchFalso(okJson({ key: { id: 'E1' } })).fn))
      .toEqual({ ok: true, id: 'E1' });
  });

  it('2xx sem JSON ainda conta como enviado', async () => {
    const r = await enviarTexto('5511987654321', 'oi', cred, fetchFalso(new Response('ok', { status: 201 })).fn);
    expect(r).toEqual({ ok: true });
  });

  it('erro HTTP do provedor vira erro com o status, sem URL nem apikey', async () => {
    const r = await enviarTexto('5511987654321', 'oi', cred, fetchFalso(new Response('x', { status: 401 })).fn);
    expect(r).toEqual({ ok: false, erro: 'provedor 401' });
  });

  it('falha de rede não lança', async () => {
    const r = await enviarTexto('5511987654321', 'oi', cred, fetchFalso(new Error('ECONNRESET')).fn);
    expect(r).toEqual({ ok: false, erro: 'inalcancavel' });
  });

  it('sem credencial completa nem tenta chamar', async () => {
    const f = fetchFalso(okJson({}));
    const r = await enviarTexto('5511987654321', 'oi', { url: cred.url, instancia: 'intra' }, f.fn);
    expect(r).toEqual({ ok: false, erro: 'credenciais' });
    expect(f.chamadas).toHaveLength(0);
  });

  it('servidor em http é recusado: a apikey não sai em texto puro', async () => {
    const f = fetchFalso(okJson({}));
    const r = await enviarTexto('5511987654321', 'oi', { ...cred, url: 'http://1.2.3.4:8080' }, f.fn);
    expect(r).toEqual({ ok: false, erro: 'credenciais' });
    expect(f.chamadas).toHaveLength(0);
  });
});
