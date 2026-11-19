import { describe, it, expect, beforeAll } from 'vitest';
import {
  ESTADO_VAZIO,
  TEXTO_BOAS_VINDAS,
  TEXTO_FORA_DO_HORARIO,
  decidirBot,
  emHorarioDeAtendimento,
  gerarProtocolo,
  interpretarSetor,
  notaDaAtribuicao,
} from '../supabase/functions/whatsapp/bot.ts';
import { fotoDoContato } from '../supabase/functions/whatsapp/provedor.ts';
import { loadHandler } from './helpers/edge-harness.js';
import { fakeSupabase } from './helpers/fake-supabase.js';

// O bot existe porque as pessoas digitavam a opção errada no menu antigo.
// O que se trava aqui: aceitar os jeitos reais de escolher, NUNCA adivinhar o
// que é ambíguo, e não prender o cliente num laço de "não entendi".

// 2026-11-18 é quarta-feira. Brasília = UTC-3.
const quarta = (h, min = 0) => new Date(Date.UTC(2026, 10, 18, h + 3, min));
const sabado = (h, min = 0) => new Date(Date.UTC(2026, 10, 21, h + 3, min));

describe('interpretarSetor', () => {
  it.each([
    ['1', 'suporte'],
    ['2', 'comercial'],
    ['3', 'poiesis'],
    ['2.', 'comercial'],
    ['2)', 'comercial'],
    [' 2 ', 'comercial'],
    ['opção 2', 'comercial'],
    ['Opcao 3', 'poiesis'],
    ['dois', 'comercial'],
    ['um', 'suporte'],
    ['comercial', 'comercial'],
    ['Vendas', 'comercial'],
    ['Suporte técnico', 'suporte'],
    ['poiesis', 'poiesis'],
  ])('"%s" é %s', (texto, setor) => {
    expect(interpretarSetor(texto)).toBe(setor);
  });

  it.each(['22', '12', '1 e 2', '1 2', '4', '0', '', 'oi', 'bom dia', 'suporte ou comercial'])(
    '"%s" é ambíguo ou inválido e não vira escolha',
    (texto) => {
      expect(interpretarSetor(texto)).toBeNull();
    }
  );

  it('"um" como artigo não é a opção 1', () => {
    expect(interpretarSetor('quero um plano')).toBe('comercial');
    expect(interpretarSetor('preciso de um favor')).toBeNull();
  });

  it('mensagem longa é a pessoa contando o problema, não escolhendo no menu', () => {
    expect(
      interpretarSetor('2 porque meu contrato venceu e preciso renovar com urgência')
    ).toBeNull();
  });
});

describe('emHorarioDeAtendimento', () => {
  it('abre às 08h30, fecha às 12h, volta às 13h e encerra às 17h30', () => {
    expect(emHorarioDeAtendimento(quarta(8, 29))).toBe(false);
    expect(emHorarioDeAtendimento(quarta(8, 30))).toBe(true);
    expect(emHorarioDeAtendimento(quarta(11, 59))).toBe(true);
    expect(emHorarioDeAtendimento(quarta(12, 0))).toBe(false);
    expect(emHorarioDeAtendimento(quarta(12, 59))).toBe(false);
    expect(emHorarioDeAtendimento(quarta(13, 0))).toBe(true);
    expect(emHorarioDeAtendimento(quarta(17, 29))).toBe(true);
    expect(emHorarioDeAtendimento(quarta(17, 30))).toBe(false);
  });

  it('fim de semana é fora do horário, mesmo no meio da tarde', () => {
    expect(emHorarioDeAtendimento(sabado(15))).toBe(false);
  });

  it('usa o fuso de Brasília, não o do servidor: 23h UTC de quarta já é 20h lá', () => {
    expect(emHorarioDeAtendimento(new Date(Date.UTC(2026, 10, 18, 23, 0)))).toBe(false);
    expect(emHorarioDeAtendimento(new Date(Date.UTC(2026, 10, 18, 14, 0)))).toBe(true); // 11h
  });
});

describe('gerarProtocolo', () => {
  it('é a data de Brasília mais quatro dígitos', () => {
    expect(gerarProtocolo(quarta(10), 0.4821)).toBe('20261118-4821');
    expect(gerarProtocolo(quarta(10), 0)).toBe('20261118-0000');
  });

  it('perto da meia-noite UTC ainda é o dia anterior em Brasília', () => {
    expect(gerarProtocolo(new Date(Date.UTC(2026, 10, 19, 1, 0)), 0.5)).toBe('20261118-5000');
  });
});

describe('decidirBot', () => {
  const agora = quarta(10);
  const P = '20261118-1234';
  const recente = new Date(agora.getTime() - 60_000).toISOString();

  it('primeira mensagem ("oi") recebe o menu e o estado passa a aguardar o setor', () => {
    const d = decidirBot(ESTADO_VAZIO, 'oi', agora, null, P);
    expect(d.respostas).toEqual([TEXTO_BOAS_VINDAS]);
    expect(d.proximo).toMatchObject({ etapa: 'aguardando_setor', tentativas: 0 });
    expect(d.atribuicao).toBeNull();
  });

  it('o menu mantém os três departamentos na ordem que o cliente já conhece', () => {
    expect(TEXTO_BOAS_VINDAS).toMatch(
      /1 - Suporte Técnico\n2 - Comercial\n3 - Atendimento Poiesis/
    );
  });

  it('escolha válida atribui, devolve o protocolo e conclui', () => {
    const estado = { etapa: 'aguardando_setor', setor: null, tentativas: 0, protocolo: null };
    const d = decidirBot(estado, '2', agora, recente, P);
    expect(d.atribuicao).toEqual({ setor: 'comercial', protocolo: P });
    expect(d.respostas).toHaveLength(1);
    expect(d.respostas[0]).toContain('Estamos direcionando seu atendimento');
    expect(d.respostas[0]).toContain(`Seu protocolo é: ${P}`);
    expect(d.proximo).toMatchObject({ etapa: 'atribuido', setor: 'comercial', protocolo: P });
  });

  it('quem já abre a conversa com "2" pula o menu', () => {
    const d = decidirBot(ESTADO_VAZIO, '2', agora, null, P);
    expect(d.atribuicao?.setor).toBe('comercial');
    expect(d.respostas).not.toContain(TEXTO_BOAS_VINDAS);
  });

  it('resposta errada ("22") pergunta de novo, sem atribuir', () => {
    const estado = { etapa: 'aguardando_setor', setor: null, tentativas: 0, protocolo: null };
    const d = decidirBot(estado, '22', agora, recente, P);
    expect(d.atribuicao).toBeNull();
    expect(d.respostas[0]).toContain('Não consegui entender');
    expect(d.proximo?.tentativas).toBe(1);
  });

  it('na segunda resposta ilegível encaminha para um humano em vez de repetir o menu', () => {
    const estado = { etapa: 'aguardando_setor', setor: null, tentativas: 1, protocolo: null };
    const d = decidirBot(estado, 'sei lá', agora, recente, P);
    expect(d.atribuicao).toEqual({ setor: null, protocolo: P });
    expect(d.respostas[0]).toContain('encaminhar a sua conversa para um atendente');
    expect(d.proximo?.etapa).toBe('atribuido');
  });

  it('conversa já atribuída e recente não recebe mais nada do robô', () => {
    const estado = { etapa: 'atribuido', setor: 'suporte', tentativas: 0, protocolo: P };
    const d = decidirBot(estado, 'alguém aí?', agora, recente, P);
    expect(d).toEqual({ respostas: [], proximo: null, atribuicao: null });
  });

  it('depois de 12h de silêncio a conversa é nova e o menu volta', () => {
    const estado = { etapa: 'atribuido', setor: 'suporte', tentativas: 0, protocolo: P };
    const velha = new Date(agora.getTime() - 13 * 3600_000).toISOString();
    const d = decidirBot(estado, 'bom dia', agora, velha, P);
    expect(d.respostas).toEqual([TEXTO_BOAS_VINDAS]);
    expect(d.proximo?.etapa).toBe('aguardando_setor');
  });

  it('fora do horário, depois da atribuição avisa quando volta o atendimento', () => {
    const d = decidirBot(ESTADO_VAZIO, '1', sabado(10), null, P);
    expect(d.respostas).toHaveLength(2);
    expect(d.respostas[1]).toBe(TEXTO_FORA_DO_HORARIO);
  });

  it('dentro do horário não manda o aviso de expediente', () => {
    const d = decidirBot(ESTADO_VAZIO, '1', quarta(10), null, P);
    expect(d.respostas).toHaveLength(1);
  });

  it('mídia sem texto não é escolha: no primeiro contato mostra o menu', () => {
    const d = decidirBot(ESTADO_VAZIO, '', agora, null, P);
    expect(d.respostas).toEqual([TEXTO_BOAS_VINDAS]);
  });
});

describe('notaDaAtribuicao', () => {
  it('diz o departamento escolhido e o protocolo', () => {
    expect(notaDaAtribuicao('comercial', 'X-1')).toBe(
      'Escolheu "Comercial" no atendimento automático · protocolo X-1'
    );
  });

  it('sem departamento avisa que ninguém escolheu', () => {
    expect(notaDaAtribuicao(null, 'X-1')).toContain('Não escolheu departamento');
  });
});

describe('fotoDoContato', () => {
  const cred = { baseUrl: 'https://waha.interno/', apiKey: 'k', session: 'default' };
  const resposta =
    (corpo, status = 200) =>
    async () =>
      new Response(JSON.stringify(corpo), { status });

  it('devolve a URL https da foto e consulta o contato certo com a chave no cabeçalho', async () => {
    let visto;
    const url = await fotoDoContato('+55 (11) 98765-4321', cred, async (u, init) => {
      visto = { u: String(u), init };
      return new Response(JSON.stringify({ profilePictureURL: 'https://pps.whatsapp.net/a.jpg' }));
    });
    expect(url).toBe('https://pps.whatsapp.net/a.jpg');
    expect(visto.u).toContain('https://waha.interno/api/contacts/profile-picture?');
    expect(decodeURIComponent(visto.u)).toContain('contactId=5511987654321@c.us');
    expect(visto.init.headers['X-Api-Key']).toBe('k');
    expect(visto.u).not.toContain('k&');
  });

  it('contato com foto privada (null) vira string vazia, e a tela cai nas iniciais', async () => {
    expect(await fotoDoContato('5511987654321', cred, resposta({ profilePictureURL: null }))).toBe(
      ''
    );
  });

  it.each([
    ['http puro', 'http://x/a.jpg'],
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:image/png;base64,AAA'],
    ['com aspas', 'https://x/a.jpg"onerror="x'],
    ['com espaço', 'https://x/a b.jpg'],
  ])('recusa URL %s: ela vai parar num <img src>', async (_nome, perigosa) => {
    expect(
      await fotoDoContato('5511987654321', cred, resposta({ profilePictureURL: perigosa }))
    ).toBe('');
  });

  it('erro da WAHA ou rede fora não derruba a mensagem', async () => {
    expect(await fotoDoContato('5511987654321', cred, resposta({}, 500))).toBe('');
    expect(
      await fotoDoContato('5511987654321', cred, async () => {
        throw new Error('rede');
      })
    ).toBe('');
  });

  it('sem credencial nem chega a chamar a rede', async () => {
    let chamou = false;
    const url = await fotoDoContato('5511987654321', { baseUrl: '', apiKey: '' }, async () => {
      chamou = true;
      return new Response('{}');
    });
    expect(url).toBe('');
    expect(chamou).toBe(false);
  });
});

// ── Webhook de ponta a ponta, com o dublê de Supabase e a WAHA falsa ─────────
const ENV = {
  SUPABASE_URL: 'https://projeto.supabase.co',
  SUPABASE_ANON_KEY: 'anon-de-teste',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-de-teste',
  WHATSAPP_WEBHOOK_TOKEN: 'segredo-do-webhook',
  WAHA_BASE_URL: 'https://waha.interno',
  WAHA_API_KEY: 'chave-da-waha',
};

function evento(texto, id = 'M1') {
  return {
    event: 'message',
    payload: {
      id,
      from: '5511987654321@c.us',
      body: texto,
      timestamp: Math.floor(Date.now() / 1000),
      notifyName: 'Márcia',
    },
  };
}

async function chamar(payload, { env = ENV, conversa = null, triagem = [] } = {}) {
  const queries = [];
  const enviadas = [];
  const fetch = async (url, init) => {
    if (String(url).includes('/api/sendText')) {
      enviadas.push(JSON.parse(init.body).text);
      return new Response(JSON.stringify({ id: 'W' + enviadas.length }));
    }
    if (String(url).includes('/api/contacts/profile-picture'))
      return new Response(
        JSON.stringify({ profilePictureURL: 'https://pps.whatsapp.net/foto.jpg' })
      );
    return new Response('', { status: 404 });
  };
  const createClient = fakeSupabase({
    queries,
    tabelas: { whatsapp_conversas: conversa ? [conversa] : [], emails_triagem: triagem },
  });
  const { handler } = await loadHandler('whatsapp', { env, createClient, fetch });
  const res = await handler(
    new Request('https://fn.local/?token=segredo-do-webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
  );
  return { res, dados: await res.json(), queries, enviadas };
}

describe('webhook com o atendimento automático', () => {
  beforeAll(async () => {
    await loadHandler('whatsapp', { env: ENV, createClient: () => ({}) });
  }, 60000);

  it('desligado (sem WHATSAPP_BOT_ATIVO) a mensagem entra na caixa e o robô não responde', async () => {
    const { res, dados, enviadas } = await chamar(evento('oi'));
    expect(res.status).toBe(200);
    expect(dados.caixa).toBe(1);
    expect(enviadas).toEqual([]);
  });

  it('ligado, número novo recebe o menu depois de a mensagem estar na caixa', async () => {
    const { dados, enviadas, queries } = await chamar(evento('oi'), {
      env: { ...ENV, WHATSAPP_BOT_ATIVO: '1' },
    });
    expect(dados.caixa).toBe(1);
    expect(dados.bot).toBe(1);
    expect(enviadas).toEqual([TEXTO_BOAS_VINDAS]);
    const estado = queries.find((q) => q.tabela === 'whatsapp_conversas' && q.patch?.bot_etapa);
    expect(estado.patch).toMatchObject({ bot_etapa: 'aguardando_setor', bot_tentativas: 0 });
  });

  it('o que o robô mandou fica na conversa, para quem atende ver a que o cliente respondeu', async () => {
    const { queries } = await chamar(evento('oi'), { env: { ...ENV, WHATSAPP_BOT_ATIVO: '1' } });
    const inseridas = queries.filter((q) => q.tabela === 'emails_triagem' && q.insert);
    const bot = inseridas.map((q) => q.insert).find((l) => l.direcao === 'saida');
    expect(bot).toMatchObject({
      canal: 'whatsapp',
      telefone: '5511987654321',
      thread_id: 'whatsapp:5511987654321',
      de: 'Atendimento automático',
      corpo: TEXTO_BOAS_VINDAS,
      status: 'anexado',
    });
    expect(bot.email_id).toBe(bot.id);
    // a mensagem do cliente entra ANTES da resposta do robô
    expect(inseridas[0].insert.direcao).toBe('entrada');
  });

  it('robô desligado não grava mensagem nenhuma de saída', async () => {
    const { queries } = await chamar(evento('oi'));
    const saidas = queries.filter(
      (q) => q.tabela === 'emails_triagem' && q.insert?.direcao === 'saida'
    );
    expect(saidas).toEqual([]);
  });

  it('a linha da caixa leva a foto de perfil do contato', async () => {
    const { queries } = await chamar(evento('oi'));
    const linha = queries.find((q) => q.tabela === 'emails_triagem' && q.insert)?.insert;
    expect(linha.foto_url).toBe('https://pps.whatsapp.net/foto.jpg');
  });

  it('escolha "2" atribui: nota com protocolo na linha e resposta de direcionamento', async () => {
    const conversa = {
      telefone: '5511987654321',
      ultima_em: new Date(Date.now() - 60_000).toISOString(),
      bot_etapa: 'aguardando_setor',
      bot_setor: null,
      bot_tentativas: 0,
      bot_protocolo: null,
      foto_url: 'https://pps.whatsapp.net/antiga.jpg',
      foto_em: new Date().toISOString(),
    };
    const { enviadas, queries } = await chamar(evento('2', 'M2'), {
      env: { ...ENV, WHATSAPP_BOT_ATIVO: '1' },
      conversa,
    });
    expect(enviadas[0]).toContain('Estamos direcionando seu atendimento');
    expect(enviadas[0]).toMatch(/Seu protocolo é: \d{8}-\d{4}/);
    const linha = queries.find((q) => q.tabela === 'emails_triagem' && q.insert)?.insert;
    expect(linha.atribuicao_nota).toMatch(/Escolheu "Comercial".*protocolo \d{8}-\d{4}/);
    const fim = queries.find((q) => q.tabela === 'whatsapp_conversas' && q.patch?.bot_etapa);
    expect(fim.patch).toMatchObject({ bot_etapa: 'atribuido', bot_setor: 'comercial' });
  });

  it('as mensagens anteriores do número (o "oi") ganham a nota e o updated_at da atribuição', async () => {
    const conversa = {
      telefone: '5511987654321',
      ultima_em: new Date(Date.now() - 60_000).toISOString(),
      bot_etapa: 'aguardando_setor',
      bot_tentativas: 0,
      foto_em: new Date().toISOString(),
    };
    const { queries } = await chamar(evento('2', 'M3'), {
      env: { ...ENV, WHATSAPP_BOT_ATIVO: '1' },
      conversa,
    });
    const mover = queries.find(
      (q) => q.tabela === 'emails_triagem' && q.patch?.atribuicao_nota && !q.insert
    );
    expect(mover.patch.updated_at).toBeTruthy();
    // só o que ainda está pendente e é do cliente, na equipe de origem
    expect(mover.filtros).toEqual(
      expect.arrayContaining([
        ['canal', 'whatsapp'],
        ['telefone', '5511987654321'],
        ['direcao', 'entrada'],
        ['status', 'pendente'],
        ['team', 'init'],
      ])
    );
  });

  it('conversa já atribuída e recente: a mensagem entra na caixa e o robô fica quieto', async () => {
    const conversa = {
      telefone: '5511987654321',
      ultima_em: new Date(Date.now() - 60_000).toISOString(),
      bot_etapa: 'atribuido',
      bot_setor: 'suporte',
      bot_tentativas: 0,
      bot_protocolo: '20261118-0001',
      foto_em: new Date().toISOString(),
    };
    const { dados, enviadas } = await chamar(evento('alguém aí?', 'M4'), {
      env: { ...ENV, WHATSAPP_BOT_ATIVO: '1' },
      conversa,
    });
    expect(dados.caixa).toBe(1);
    expect(enviadas).toEqual([]);
  });

  // Pedro buscou o contato e mandou a primeira mensagem (whatsapp-iniciar): o
  // cliente responde "1" e o menu de departamentos não pode tirar a conversa
  // de quem já está atendendo.
  const saidaDaEquipe = (extra) => ({
    canal: 'whatsapp',
    thread_id: 'whatsapp:5511987654321',
    direcao: 'saida',
    de: 'Pedro Bento',
    recebido_em: new Date().toISOString(),
    ...extra,
  });

  it('conversa iniciada pela equipe: o robô fica quieto e a resposta entra na caixa', async () => {
    const { dados, enviadas } = await chamar(evento('1', 'M5'), {
      env: { ...ENV, WHATSAPP_BOT_ATIVO: '1' },
      triagem: [saidaDaEquipe()],
    });
    expect(dados.caixa).toBe(1);
    expect(dados.bot).toBe(0);
    expect(enviadas).toEqual([]);
  });

  it('só a resposta do próprio robô não conta como a equipe ter falado', async () => {
    const { dados, enviadas } = await chamar(evento('oi', 'M6'), {
      env: { ...ENV, WHATSAPP_BOT_ATIVO: '1' },
      triagem: [saidaDaEquipe({ de: 'Atendimento automático' })],
    });
    expect(dados.bot).toBe(1);
    expect(enviadas.length).toBeGreaterThan(0);
  });

  it('fala da equipe fora da janela de 12 h volta a passar pelo menu', async () => {
    const velha = new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString();
    const { dados } = await chamar(evento('oi', 'M7'), {
      env: { ...ENV, WHATSAPP_BOT_ATIVO: '1' },
      triagem: [saidaDaEquipe({ recebido_em: velha })],
    });
    expect(dados.bot).toBe(1);
  });
});
