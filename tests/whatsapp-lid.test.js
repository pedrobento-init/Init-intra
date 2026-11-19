import { describe, it, expect, beforeAll, vi } from 'vitest';
import {
  chatIdsPara,
  enviarTexto,
  mensagensDoWebhook,
  telefoneDoLid,
} from '../supabase/functions/whatsapp/provedor.ts';
import { TEXTO_BOAS_VINDAS } from '../supabase/functions/whatsapp/bot.ts';
import { loadHandler } from './helpers/edge-harness.js';
import { fakeSupabase } from './helpers/fake-supabase.js';

// O WhatsApp novo identifica quem escreve por um ID interno ("...@lid"), e não
// pelo telefone. O webhook antigo tirava os dígitos desse ID e guardava como
// telefone: o envio para "<dígitos>@c.us" falhava ("No LID for user") e o
// cliente nunca casava pelo telefone. Estes testes travam a conversão.

const LID = '189721758162980@lid';
const FONE = '5513999990000'; // número fictício

function evento(from, id = 'M1', body = 'oi') {
  return {
    event: 'message',
    payload: { id, from, body, timestamp: 1700000000, notifyName: 'Márcia' },
  };
}

describe('adaptador: remetente @lid', () => {
  it('não vira telefone: sai com telefone vazio e o lid preenchido', () => {
    const [m] = mensagensDoWebhook(evento(LID));
    expect(m.telefone).toBe('');
    expect(m.lid).toBe(LID);
  });

  it('remetente @c.us segue como antes, sem lid', () => {
    const [m] = mensagensDoWebhook(evento(`${FONE}@c.us`));
    expect(m.telefone).toBe(FONE);
    expect(m.lid).toBeUndefined();
  });

  // O engine NOWEB manda o telefone em key.remoteJidAlt (ou senderPn); o GOWS,
  // em Info.SenderAlt. Lendo daqui, a conversa nasce com o número certo mesmo
  // quando a consulta /lids do WAHA falha.
  it.each([
    ['NOWEB remoteJidAlt', { key: { remoteJid: LID, remoteJidAlt: `${FONE}@s.whatsapp.net` } }],
    ['NOWEB senderPn', { key: { remoteJid: LID, senderPn: `${FONE}@s.whatsapp.net` } }],
    ['GOWS SenderAlt', { Info: { Sender: LID, SenderAlt: `${FONE}:12@s.whatsapp.net` } }],
  ])('LID com telefone no próprio evento (%s) já sai com o número', (_n, _data) => {
    const ev = evento(LID);
    ev.payload._data = _data;
    const [m] = mensagensDoWebhook(ev);
    expect(m.telefone).toBe(FONE);
    expect(m.lid).toBeUndefined();
  });

  it('campo alternativo que é outro LID não vira telefone', () => {
    const ev = evento(LID);
    ev.payload._data = { key: { remoteJidAlt: '123456789012345@lid' } };
    const [m] = mensagensDoWebhook(ev);
    expect(m.telefone).toBe('');
    expect(m.lid).toBe(LID);
  });

  it('grupo continua ignorado', () => {
    expect(mensagensDoWebhook(evento('120363000000000000@g.us'))).toEqual([]);
  });
});

describe('telefoneDoLid', () => {
  const cred = { baseUrl: 'https://waha.interno/', apiKey: 'k', session: 'default' };
  const resposta =
    (corpo, status = 200) =>
    async () =>
      new Response(JSON.stringify(corpo), { status });

  it('devolve só os dígitos do pn e consulta a rota certa, com a chave no cabeçalho', async () => {
    let visto;
    const fone = await telefoneDoLid(LID, cred, async (u, init) => {
      visto = { u: String(u), init };
      return new Response(JSON.stringify({ lid: LID, pn: `${FONE}@c.us` }));
    });
    expect(fone).toBe(FONE);
    expect(visto.u).toBe(`https://waha.interno/api/default/lids/${encodeURIComponent(LID)}`);
    expect(visto.init.headers['X-Api-Key']).toBe('k');
  });

  it('aceita o pn no formato novo (@s.whatsapp.net)', async () => {
    const fone = await telefoneDoLid(
      LID,
      cred,
      resposta({ lid: LID, pn: `${FONE}@s.whatsapp.net` })
    );
    expect(fone).toBe(FONE);
  });

  it.each([
    ['sem pn (contato esconde o telefone)', { lid: LID, pn: null }],
    ['pn que é outro lid', { lid: LID, pn: '123456789012345@lid' }],
    ['pn com letras', { lid: LID, pn: 'abc@c.us' }],
    ['pn curto demais', { lid: LID, pn: '123@c.us' }],
    ['pn sem sufixo', { lid: LID, pn: FONE }],
  ])('%s não vira telefone', async (_nome, corpo) => {
    expect(await telefoneDoLid(LID, cred, resposta(corpo))).toBe('');
  });

  it('WAHA que não conhece o lid (404) ou caiu não derruba o webhook', async () => {
    expect(await telefoneDoLid(LID, cred, resposta({}, 404))).toBe('');
    expect(
      await telefoneDoLid(LID, cred, async () => {
        throw new Error('rede');
      })
    ).toBe('');
  });

  it('lid malformado nem chega a chamar a rede (o valor entra na URL)', async () => {
    let chamou = false;
    const fetchFn = async () => {
      chamou = true;
      return new Response('{}');
    };
    expect(await telefoneDoLid('../../api/sessions@lid', cred, fetchFn)).toBe('');
    expect(await telefoneDoLid('12345@c.us', cred, fetchFn)).toBe('');
    expect(chamou).toBe(false);
  });
});

// ── Webhook de ponta a ponta ─────────────────────────────────────────────────
const ENV = {
  SUPABASE_URL: 'https://projeto.supabase.co',
  SUPABASE_ANON_KEY: 'anon-de-teste',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-de-teste',
  WHATSAPP_WEBHOOK_TOKEN: 'segredo-do-webhook',
  WAHA_BASE_URL: 'https://waha.interno',
  WAHA_API_KEY: 'chave-da-waha',
  WHATSAPP_BOT_ATIVO: '1',
};

async function chamar(payload, { pn = `${FONE}@c.us` } = {}) {
  const queries = [];
  const enviadas = [];
  const fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('/lids/'))
      return pn
        ? new Response(JSON.stringify({ lid: LID, pn }))
        : new Response('{}', { status: 404 });
    if (u.includes('/api/sendText')) {
      const corpo = JSON.parse(init.body);
      enviadas.push({ chatId: corpo.chatId, text: corpo.text });
      return new Response(JSON.stringify({ id: 'W1' }));
    }
    return new Response('{}', { status: 404 });
  };
  const createClient = fakeSupabase({ queries, tabelas: { whatsapp_conversas: [] } });
  const { handler } = await loadHandler('whatsapp', { env: ENV, createClient, fetch });
  const res = await handler(
    new Request('https://fn.local/?token=segredo-do-webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
  );
  return { res, dados: await res.json(), queries, enviadas };
}

describe('webhook com remetente @lid', () => {
  beforeAll(async () => {
    await loadHandler('whatsapp', { env: ENV, createClient: () => ({}) });
  }, 60000);

  it('guarda o telefone REAL na caixa, e não os dígitos do lid', async () => {
    const { dados, queries } = await chamar(evento(LID));
    expect(dados.caixa).toBe(1);
    const linha = queries.find((q) => q.tabela === 'emails_triagem' && q.insert)?.insert;
    expect(linha.telefone).toBe(FONE);
    expect(linha.thread_id).toBe(`whatsapp:${FONE}`);
    expect(JSON.stringify(linha)).not.toContain('189721758162980');
  });

  it('o robô responde para o telefone @c.us, nunca para os dígitos do lid', async () => {
    const { enviadas } = await chamar(evento(LID));
    expect(enviadas).toEqual([{ chatId: `${FONE}@c.us`, text: TEXTO_BOAS_VINDAS }]);
  });

  it('o limite por número e o estado do robô usam o telefone convertido', async () => {
    const { queries } = await chamar(evento(LID));
    const conversa = queries.find((q) => q.tabela === 'whatsapp_conversas' && q.patch?.bot_etapa);
    expect(conversa.filtros).toEqual(expect.arrayContaining([['telefone', FONE]]));
  });

  it('lid que a WAHA não conhece: a mensagem entra na caixa, mas o robô não responde', async () => {
    const { dados, queries, enviadas } = await chamar(evento(LID), { pn: null });
    expect(dados.caixa).toBe(1);
    expect(queries.some((q) => q.tabela === 'emails_triagem' && q.insert)).toBe(true);
    expect(enviadas).toEqual([]);
  });
});

// Conversa gravada antes da correção tem o LID como "telefone": responder para
// "<dígitos>@c.us" dá 502 ("No LID for user"). O envio tenta "@lid" em seguida.
describe('envio para conversa gravada com o LID', () => {
  const cred = { baseUrl: 'https://waha.interno', apiKey: 'k', session: 'default' };
  const LID_DIGITOS = LID.replace(/\D/g, '');

  it('sempre tenta @c.us e depois @lid, sem depender do tamanho do número', () => {
    expect(chatIdsPara(FONE)).toEqual([`${FONE}@c.us`, `${FONE}@lid`]);
    expect(chatIdsPara(LID_DIGITOS)).toEqual([`${LID_DIGITOS}@c.us`, `${LID_DIGITOS}@lid`]);
  });

  it('LID de 13 dígitos (como na conversa real) também tenta @lid', () => {
    expect(chatIdsPara('3771736305909')).toEqual(['3771736305909@c.us', '3771736305909@lid']);
  });

  it('@c.us recusado: reenvia para @lid e devolve o id', async () => {
    const tentativas = [];
    const envio = await enviarTexto(LID_DIGITOS, 'oi', cred, async (_u, init) => {
      const { chatId } = JSON.parse(init.body);
      tentativas.push(chatId);
      return chatId.endsWith('@lid')
        ? new Response(JSON.stringify({ id: 'true_x@lid_A1' }))
        : new Response('{"error":"No LID for user"}', { status: 500 });
    });
    expect(tentativas).toEqual([`${LID_DIGITOS}@c.us`, `${LID_DIGITOS}@lid`]);
    expect(envio).toEqual({ ok: true, id: 'true_x@lid_A1' });
  });

  it('recusa nos dois destinos devolve falha sem inventar sucesso', async () => {
    let n = 0;
    const envio = await enviarTexto(FONE, 'oi', cred, async () => {
      n++;
      return new Response('{}', { status: 500 });
    });
    expect(n).toBe(2);
    expect(envio.ok).toBe(false);
  });

  // O 502 da Caixa não diz por que o WAHA recusou. O log guarda o status e um
  // trecho da resposta, e do telefone só o final.
  it('recusa do WAHA fica no log com o status e sem o telefone inteiro', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await enviarTexto(
        FONE,
        'oi',
        cred,
        async () => new Response('sessao invalida', { status: 422 })
      );
      const linhas = aviso.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(linhas).toContain('HTTP 422');
      expect(linhas).toContain('sessao invalida');
      expect(linhas).not.toContain(FONE);
    } finally {
      aviso.mockRestore();
    }
  });
});
