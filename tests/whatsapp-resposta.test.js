import { describe, it, expect } from 'vitest';
import {
  corpoGraph,
  erroDoGraph,
  idDoEnvio,
  janelaDaConversa,
  JANELA_HORAS,
  telefoneDaConversa,
  telefoneLegivel,
  textoDaResposta,
  TEXTO_MAX,
  ultimaFalaDoSolicitante,
} from '../supabase/functions/whatsapp/resposta.ts';

// Caminho de VOLTA do WhatsApp. Duas coisas erram calado aqui: o telefone, que
// mandado errado entrega a conversa de um cliente a outro, e a janela de 24 h,
// que a Meta cobra e o técnico não tem como adivinhar.

const nota = (visibility, createdAt, text = 'oi') => ({ text, author: 'Beatriz', createdAt, visibility });
const ABERTURA = '2026-10-26T09:00:00.000Z';

describe('o telefone sai da conversa, não do app', () => {
  it('thread de WhatsApp devolve só os dígitos', () => {
    expect(telefoneDaConversa('whatsapp:5511999990000')).toBe('5511999990000');
  });

  it('thread de e-mail não vira telefone', () => {
    expect(telefoneDaConversa('<CAF=abc@mail.gmail.com>')).toBe('');
  });

  it('chamado sem conversa nenhuma não vira telefone', () => {
    expect(telefoneDaConversa(null)).toBe('');
    expect(telefoneDaConversa('')).toBe('');
    expect(telefoneDaConversa(undefined)).toBe('');
  });

  it('número curto demais é recusado em vez de truncado', () => {
    // 10 dígitos é telefone sem país: mandar assim é mandar para outra pessoa.
    expect(telefoneDaConversa('whatsapp:1199999000')).toBe('');
  });

  it('número comprido demais também é recusado', () => {
    expect(telefoneDaConversa('whatsapp:5511999990000123456')).toBe('');
  });

  it('prefixo de outro canal não passa por descuido de substring', () => {
    expect(telefoneDaConversa('telegram:5511999990000')).toBe('');
  });
});

describe('quando o cliente falou por último', () => {
  it('sem notas, vale a abertura do chamado', () => {
    // A primeira mensagem não virou nota: virou o próprio chamado. Olhar só as
    // notas diria "nunca falou" e fecharia a janela no momento mais aberto.
    expect(ultimaFalaDoSolicitante([], ABERTURA)).toBe(ABERTURA);
  });

  it('nota do solicitante mais nova vence a abertura', () => {
    const notes = [nota('solicitante', '2026-10-26T11:00:00.000Z')];
    expect(ultimaFalaDoSolicitante(notes, ABERTURA)).toBe('2026-10-26T11:00:00.000Z');
  });

  it('nossa resposta e anotação interna não contam como fala do cliente', () => {
    const notes = [
      nota('resposta', '2026-10-26T20:00:00.000Z'),
      nota('interna', '2026-10-26T21:00:00.000Z'),
    ];
    expect(ultimaFalaDoSolicitante(notes, ABERTURA)).toBe(ABERTURA);
  });

  it('a mais nova vence mesmo fora de ordem na lista', () => {
    const notes = [
      nota('solicitante', '2026-10-26T15:00:00.000Z'),
      nota('solicitante', '2026-10-26T10:00:00.000Z'),
    ];
    expect(ultimaFalaDoSolicitante(notes, ABERTURA)).toBe('2026-10-26T15:00:00.000Z');
  });

  it('nota com data inválida não derruba o cálculo', () => {
    const notes = [nota('solicitante', 'ontem'), nota('solicitante', '2026-10-26T12:00:00.000Z')];
    expect(ultimaFalaDoSolicitante(notes, ABERTURA)).toBe('2026-10-26T12:00:00.000Z');
  });

  it('notes que não é lista é tratado como vazio', () => {
    expect(ultimaFalaDoSolicitante(null, ABERTURA)).toBe(ABERTURA);
    expect(ultimaFalaDoSolicitante('[]', ABERTURA)).toBe(ABERTURA);
  });
});

describe('a janela de 24 h da Meta', () => {
  it('aberta logo depois da mensagem, com o tempo que resta', () => {
    const j = janelaDaConversa([], ABERTURA, new Date('2026-10-26T10:00:00.000Z'));
    expect(j.aberta).toBe(true);
    expect(j.restamMin).toBe(23 * 60);
  });

  it('fechada passadas as 24 h', () => {
    const j = janelaDaConversa([], ABERTURA, new Date('2026-10-27T09:00:01.000Z'));
    expect(j.aberta).toBe(false);
    expect(j.restamMin).toBe(0);
  });

  it('no instante exato das 24 h já está fechada', () => {
    // Igual não é dentro: a Meta conta do lado dela, e o empate recusa o envio.
    const j = janelaDaConversa([], ABERTURA, new Date('2026-10-27T09:00:00.000Z'));
    expect(j.aberta).toBe(false);
  });

  it('mensagem nova do cliente reabre a janela', () => {
    const notes = [nota('solicitante', '2026-10-27T08:00:00.000Z')];
    const j = janelaDaConversa(notes, ABERTURA, new Date('2026-10-27T10:00:00.000Z'));
    expect(j.aberta).toBe(true);
    expect(j.ultima).toBe('2026-10-27T08:00:00.000Z');
  });

  it('sem data alguma sai fechada, não aberta por otimismo', () => {
    // Data faltando é registro estranho. Aberta, o técnico levaria uma recusa
    // crua da Meta; fechada, ele lê o motivo e sabe o que fazer.
    const j = janelaDaConversa([], null, new Date(ABERTURA));
    expect(j.aberta).toBe(false);
    expect(j.ultima).toBe('');
  });

  it('JANELA_HORAS é o que a Meta cobra', () => {
    expect(JANELA_HORAS).toBe(24);
  });
});

describe('o texto que sai', () => {
  it('espaço em volta não vira mensagem', () => {
    expect(textoDaResposta('   \n  ')).toBe('');
    expect(textoDaResposta(null)).toBe('');
  });

  it('texto normal atravessa inteiro', () => {
    expect(textoDaResposta('  Já trocamos o cabo. ')).toBe('Já trocamos o cabo.');
  });

  it('corta no teto da Meta em vez de levar recusa', () => {
    expect(textoDaResposta('a'.repeat(TEXTO_MAX + 500))).toHaveLength(TEXTO_MAX);
  });
});

describe('o corpo que a Graph API recebe', () => {
  it('mensagem de texto no formato da Meta', () => {
    expect(corpoGraph('5511999990000', 'Bom dia')).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '5511999990000',
      type: 'text',
      text: { preview_url: false, body: 'Bom dia' },
    });
  });

  it('preview de link fica desligado', () => {
    // Com preview, um link interno viraria card com dado do cliente na conversa.
    expect(corpoGraph('55119', 'veja https://intra.init/chamado/1').text.preview_url).toBe(false);
  });
});

describe('o que a Meta responde', () => {
  it('o wamid do envio serve de recibo', () => {
    expect(idDoEnvio({ messages: [{ id: 'wamid.XYZ' }] })).toBe('wamid.XYZ');
  });

  it('200 com corpo estranho não inventa recibo', () => {
    expect(idDoEnvio({})).toBe('');
    expect(idDoEnvio(null)).toBe('');
    expect(idDoEnvio({ messages: 'nope' })).toBe('');
  });

  it('o detalhe do erro vence a mensagem genérica', () => {
    const corpo = {
      error: {
        message: 'Unsupported post request',
        error_data: { details: 'Message failed to send because more than 24 hours have passed' },
      },
    };
    expect(erroDoGraph(corpo, 400)).toContain('more than 24 hours');
  });

  it('sem detalhe, vale a mensagem', () => {
    expect(erroDoGraph({ error: { message: 'Invalid OAuth access token' } }, 401))
      .toBe('Invalid OAuth access token');
  });

  it('corpo ilegível ainda diz o status', () => {
    expect(erroDoGraph(null, 503)).toContain('503');
  });
});

describe('telefone como gente lê', () => {
  it('celular com nono dígito', () => {
    expect(telefoneLegivel('5511999990000')).toBe('+55 (11) 99999-0000');
  });

  it('fixo de oito dígitos', () => {
    expect(telefoneLegivel('551144786171')).toBe('+55 (11) 4478-6171');
  });

  it('número de fora do Brasil fica cru, com o +', () => {
    expect(telefoneLegivel('14155550123')).toBe('+14155550123');
  });

  it('vazio não vira "+"', () => {
    expect(telefoneLegivel('')).toBe('');
  });
});
