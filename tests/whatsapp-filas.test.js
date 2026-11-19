import { describe, it, expect, beforeAll } from 'vitest';
import {
  atendeDepartamento,
  atendenteOnline,
  contarAbertos,
  conversaNoMenu,
  departamentoDaConversa,
  escolherAtendente,
  limiteDe,
  LIMITE_PADRAO,
  ONLINE_JANELA_MS,
  responsavelAberto,
} from '../supabase/functions/whatsapp/filas.ts';
import { filasAusentes } from '../supabase/functions/whatsapp/distribuicao.ts';
import { ESTADO_VAZIO } from '../supabase/functions/whatsapp/bot.ts';
import { loadHandler } from './helpers/edge-harness.js';
import { fakeSupabase } from './helpers/fake-supabase.js';

// Rodízio do WhatsApp (filas.ts + distribuicao.ts). O que se trava aqui: a
// conversa nunca vai para quem está offline, fora do departamento ou no
// limite; ninguém disponível = fica na fila; e a falta da 087 nunca derruba a
// mensagem do cliente.

const AGORA = new Date('2026-11-18T15:00:00Z');
const haMin = (min) => new Date(AGORA.getTime() - min * 60_000).toISOString();

function at(operador, extra = {}) {
  return {
    operador,
    departamentos: [],
    limite: null,
    recebe_rodizio: true,
    disponivel: true,
    visto_em: haMin(1),
    ultima_atribuicao_em: null,
    ...extra,
  };
}

const escolher = (lista, { departamento = null, abertos = {}, limite = 3 } = {}) =>
  escolherAtendente(lista, {
    departamento,
    abertos,
    agora: AGORA,
    config: { rodizio_ativo: true, limite_simultaneo: limite },
  });

describe('escolherAtendente', () => {
  it('ninguém online: fica na fila', () => {
    expect(
      escolher([at('Ana', { visto_em: haMin(10) }), at('Bia', { disponivel: false })])
    ).toBeNull();
  });

  it('lista vazia: fica na fila', () => {
    expect(escolher([])).toBeNull();
  });

  it('todos no limite: fica na fila', () => {
    expect(escolher([at('Ana'), at('Bia')], { abertos: { Ana: 3, Bia: 4 }, limite: 3 })).toBeNull();
  });

  it('pula quem está no limite e entrega a quem tem vaga', () => {
    expect(escolher([at('Ana'), at('Bia')], { abertos: { Ana: 3, Bia: 2 }, limite: 3 })).toBe(
      'Bia'
    );
  });

  it('limite próprio do atendente vale mais que o da equipe', () => {
    expect(escolher([at('Ana', { limite: 1 })], { abertos: { Ana: 1 }, limite: 5 })).toBeNull();
    expect(escolher([at('Ana', { limite: 8 })], { abertos: { Ana: 5 }, limite: 5 })).toBe('Ana');
  });

  it('quem tem menos atendimentos abertos recebe', () => {
    expect(escolher([at('Ana'), at('Bia')], { abertos: { Ana: 2, Bia: 1 } })).toBe('Bia');
  });

  it('empate: recebe quem recebeu há mais tempo, e quem nunca recebeu vem antes', () => {
    const lista = [
      at('Ana', { ultima_atribuicao_em: haMin(5) }),
      at('Bia', { ultima_atribuicao_em: haMin(30) }),
    ];
    expect(escolher(lista)).toBe('Bia');
    expect(escolher([...lista, at('Caio')])).toBe('Caio');
  });

  it('empate completo decide pelo nome, para duas execuções iguais darem o mesmo', () => {
    expect(escolher([at('Bia'), at('Ana')])).toBe('Ana');
  });

  it('só quem atende o departamento; lista vazia atende todos', () => {
    const lista = [at('Ana', { departamentos: ['suporte'] }), at('Bia', { departamentos: [] })];
    expect(escolher(lista, { departamento: 'comercial' })).toBe('Bia');
    expect(escolher([lista[0]], { departamento: 'comercial' })).toBeNull();
  });

  it('conversa sem departamento vai para qualquer atendente da equipe', () => {
    expect(escolher([at('Ana', { departamentos: ['poiesis'] })])).toBe('Ana');
  });

  it('quem o admin tirou do rodízio não recebe, mesmo online', () => {
    expect(escolher([at('Ana', { recebe_rodizio: false })])).toBeNull();
  });
});

describe('atendenteOnline e limite', () => {
  it('online até a janela; depois, não', () => {
    const lim = new Date(AGORA.getTime() - ONLINE_JANELA_MS).toISOString();
    expect(atendenteOnline(at('Ana', { visto_em: lim }), AGORA)).toBe(true);
    expect(atendenteOnline(at('Ana', { visto_em: haMin(4) }), AGORA)).toBe(false);
    expect(atendenteOnline(at('Ana', { visto_em: null }), AGORA)).toBe(false);
  });

  it('sem configuração, usa o limite padrão', () => {
    expect(limiteDe(at('Ana'), null)).toBe(LIMITE_PADRAO);
  });

  it('atendeDepartamento com departamentos nulo atende todos', () => {
    expect(atendeDepartamento(at('Ana', { departamentos: null }), 'suporte')).toBe(true);
  });
});

describe('contarAbertos e responsavelAberto', () => {
  const linhas = [
    { telefone: '1', atribuido_a: 'Ana', direcao: 'entrada', status: 'pendente' },
    { telefone: '1', atribuido_a: 'Ana', direcao: 'entrada', status: 'anexado' },
    { telefone: '2', atribuido_a: 'Ana', direcao: 'entrada', status: 'anexado' },
    { telefone: '3', atribuido_a: 'Ana', direcao: 'entrada', status: 'encerrado' },
    { telefone: '4', atribuido_a: 'Bia', direcao: 'saida', status: 'anexado' },
    { telefone: '5', atribuido_a: 'Bia', direcao: null, status: 'pendente' },
  ];

  it('conta conversas distintas, só com mensagem do cliente ainda aberta', () => {
    expect(contarAbertos(linhas)).toEqual({ Ana: 2, Bia: 1 });
  });

  it('responsável é quem tem mensagem aberta; ciclo encerrado não conta', () => {
    expect(responsavelAberto([linhas[3]])).toBeNull();
    expect(responsavelAberto([linhas[3], linhas[1]])).toBe('Ana');
    // a resposta do robô ou do operador (saída) não define dono
    expect(responsavelAberto([linhas[4]])).toBeNull();
  });
});

describe('departamentoDaConversa e conversaNoMenu', () => {
  const atribuido = { etapa: 'atribuido', setor: 'suporte', tentativas: 0, protocolo: 'P' };

  it('a escolha de agora vale; a anterior vale enquanto a conversa segue atribuída', () => {
    const decisao = {
      respostas: ['x'],
      proximo: { ...atribuido, setor: 'comercial' },
      atribuicao: { setor: 'comercial', protocolo: 'P' },
    };
    expect(departamentoDaConversa(ESTADO_VAZIO, decisao)).toBe('comercial');
    expect(departamentoDaConversa(atribuido, null)).toBe('suporte');
    expect(
      departamentoDaConversa(atribuido, { respostas: [], proximo: null, atribuicao: null })
    ).toBe('suporte');
  });

  it('menu reenviado (conversa nova) zera o departamento e segura o rodízio', () => {
    const menu = {
      respostas: ['menu'],
      proximo: { etapa: 'aguardando_setor', setor: null, tentativas: 0, protocolo: null },
      atribuicao: null,
    };
    expect(departamentoDaConversa(atribuido, menu)).toBeNull();
    expect(conversaNoMenu(menu)).toBe(true);
    expect(conversaNoMenu(null)).toBe(false);
  });

  it('triagem (não escolheu) não tem departamento, mas já pode ser distribuída', () => {
    const triagem = {
      respostas: ['t'],
      proximo: { etapa: 'atribuido', setor: null, tentativas: 0, protocolo: 'P' },
      atribuicao: { setor: null, protocolo: 'P' },
    };
    expect(departamentoDaConversa(ESTADO_VAZIO, triagem)).toBeNull();
    expect(conversaNoMenu(triagem)).toBe(false);
  });
});

describe('filasAusentes', () => {
  it('reconhece coluna e tabela da 087 que não existem', () => {
    expect(filasAusentes({ code: '42703', message: 'column "departamento" does not exist' })).toBe(
      true
    );
    expect(filasAusentes({ code: 'PGRST205', message: 'Could not find the table' })).toBe(true);
    expect(filasAusentes({ message: 'relation "whatsapp_filas_config" does not exist' })).toBe(
      true
    );
    expect(filasAusentes({ code: '57014', message: 'canceling statement' })).toBe(false);
    expect(filasAusentes(null)).toBe(false);
  });
});

// ── Webhook de ponta a ponta ────────────────────────────────────────────────
const ENV = {
  SUPABASE_URL: 'https://projeto.supabase.co',
  SUPABASE_ANON_KEY: 'anon-de-teste',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-de-teste',
  WHATSAPP_WEBHOOK_TOKEN: 'segredo-do-webhook',
  WAHA_BASE_URL: 'https://waha.interno',
  WAHA_API_KEY: 'chave-da-waha',
};
const BOT = { ...ENV, WHATSAPP_BOT_ATIVO: '1' };
const FONE = '5511987654321';

function evento(texto, id = 'F1') {
  return {
    event: 'message',
    payload: {
      id,
      from: FONE + '@c.us',
      body: texto,
      timestamp: Math.floor(Date.now() / 1000),
      notifyName: 'Márcia',
    },
  };
}

const recente = () => new Date(Date.now() - 60_000).toISOString();
const aguardando = () => ({
  telefone: FONE,
  ultima_em: recente(),
  bot_etapa: 'aguardando_setor',
  bot_tentativas: 0,
  foto_em: new Date().toISOString(),
});
const online = (operador, extra = {}) => ({
  operador,
  departamentos: [],
  limite: null,
  recebe_rodizio: true,
  disponivel: true,
  visto_em: new Date().toISOString(),
  ultima_atribuicao_em: null,
  ...extra,
});

async function chamar(
  payload,
  { env = ENV, conversa = null, config = null, atendentes = [], caixa = [], semColuna = false } = {}
) {
  const queries = [];
  const rpcs = [];
  const base = fakeSupabase({
    queries,
    tabelas: {
      whatsapp_conversas: conversa ? [conversa] : [],
      whatsapp_filas_config: config ? [{ team: 'init', ...config }] : [],
      whatsapp_atendentes: atendentes.map((a) => ({ team: 'init', ...a })),
      emails_triagem: caixa,
    },
  });
  const createClient = (url, key, opts) => {
    const cliente = base(url, key, opts);
    const rpc = cliente.rpc;
    cliente.rpc = async (nome, args) => {
      rpcs.push([nome, args]);
      if (nome === 'whatsapp_atribuir_se_livre') return { data: true, error: null };
      return rpc(nome, args);
    };
    const from = cliente.from;
    cliente.from = (tabela) => {
      const b = from(tabela);
      if (!semColuna || tabela !== 'emails_triagem') return b;
      // Banco sem a 087: gravar `departamento` dá 42703, como o Postgres.
      // O builder devolve a si mesmo a cada passo, então trocar o `then` dele
      // vale para o fim da cadeia.
      const update = b.update;
      b.update = (patch) => {
        update(patch);
        if ('departamento' in patch) {
          const erro = { code: '42703', message: 'column "departamento" does not exist' };
          b.then = (res, rej) => Promise.resolve({ data: null, error: erro }).then(res, rej);
        }
        return b;
      };
      return b;
    };
    return cliente;
  };
  const fetch = async (url) => {
    if (String(url).includes('/api/sendText')) return new Response(JSON.stringify({ id: 'W1' }));
    return new Response('', { status: 404 });
  };
  const { handler, logs } = await loadHandler('whatsapp', { env, createClient, fetch });
  const res = await handler(
    new Request('https://fn.local/?token=segredo-do-webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
  );
  return { res, dados: await res.json(), queries, rpcs, logs };
}

const atribuicoes = (rpcs) => rpcs.filter(([n]) => n === 'whatsapp_atribuir_se_livre');

describe('webhook: filas e rodízio', () => {
  beforeAll(async () => {
    await loadHandler('whatsapp', { env: ENV, createClient: () => ({}) });
  }, 60000);

  it('escolha no menu grava o departamento nas mensagens pendentes da conversa', async () => {
    const { queries } = await chamar(evento('2'), { env: BOT, conversa: aguardando() });
    const dep = queries.find((q) => q.tabela === 'emails_triagem' && q.patch?.departamento);
    expect(dep.patch.departamento).toBe('comercial');
    expect(dep.filtros).toEqual(
      expect.arrayContaining([
        ['canal', 'whatsapp'],
        ['telefone', FONE],
        ['status', 'pendente'],
        ['departamento', null, 'is'],
      ])
    );
  });

  it('rodízio ligado: entrega ao atendente online do departamento com menos abertos', async () => {
    const { rpcs, queries } = await chamar(evento('2'), {
      env: BOT,
      conversa: aguardando(),
      config: { rodizio_ativo: true, limite_simultaneo: 3 },
      atendentes: [
        online('Ana', { departamentos: ['comercial'] }),
        online('Bia', { departamentos: ['suporte'] }),
        online('Caio', { departamentos: ['comercial'] }),
      ],
      caixa: [
        {
          canal: 'whatsapp',
          team: 'init',
          telefone: '5511900000001',
          atribuido_a: 'Ana',
          direcao: 'entrada',
          status: 'pendente',
        },
      ],
    });
    expect(atribuicoes(rpcs)).toEqual([
      ['whatsapp_atribuir_se_livre', { p_team: 'init', p_telefone: FONE, p_operador: 'Caio' }],
    ]);
    const vez = queries.find(
      (q) => q.tabela === 'whatsapp_atendentes' && q.patch?.ultima_atribuicao_em
    );
    expect(vez.filtros).toEqual(expect.arrayContaining([['operador', 'Caio']]));
  });

  // O nome vem de operators.name, que o operador edita. Aspas no filtro do
  // PostgREST quebravam a contagem e paravam o rodízio da equipe inteira.
  it('nome de operador não vai para o filtro do PostgREST: a contagem filtra depois de ler', async () => {
    const { rpcs, queries } = await chamar(evento('2'), {
      env: BOT,
      conversa: aguardando(),
      config: { rodizio_ativo: true, limite_simultaneo: 1 },
      atendentes: [online('Ana "x"'), online('Bia')],
      caixa: [
        {
          canal: 'whatsapp',
          team: 'init',
          telefone: '5511900000001',
          atribuido_a: 'Ana "x"',
          direcao: 'entrada',
          status: 'anexado',
        },
      ],
    });
    const porNome = queries.filter((q) =>
      q.filtros.some(([col, , tipo]) => col === 'atribuido_a' && tipo === 'in')
    );
    expect(porNome).toEqual([]);
    expect(atribuicoes(rpcs)).toEqual([
      ['whatsapp_atribuir_se_livre', { p_team: 'init', p_telefone: FONE, p_operador: 'Bia' }],
    ]);
  });

  it('todos no limite: a conversa fica na fila', async () => {
    const aberta = (tel, op) => ({
      canal: 'whatsapp',
      team: 'init',
      telefone: tel,
      atribuido_a: op,
      direcao: 'entrada',
      status: 'anexado',
    });
    const { rpcs, dados } = await chamar(evento('2'), {
      env: BOT,
      conversa: aguardando(),
      config: { rodizio_ativo: true, limite_simultaneo: 1 },
      atendentes: [online('Ana'), online('Bia')],
      caixa: [aberta('5511900000001', 'Ana'), aberta('5511900000002', 'Bia')],
    });
    expect(dados.caixa).toBe(1);
    expect(atribuicoes(rpcs)).toEqual([]);
  });

  it('ninguém online: a conversa fica na fila', async () => {
    const { rpcs } = await chamar(evento('2'), {
      env: BOT,
      conversa: aguardando(),
      config: { rodizio_ativo: true, limite_simultaneo: 3 },
      atendentes: [online('Ana', { visto_em: new Date(Date.now() - 3600_000).toISOString() })],
    });
    expect(atribuicoes(rpcs)).toEqual([]);
  });

  it('rodízio desligado: ninguém é escolhido', async () => {
    const { rpcs } = await chamar(evento('2'), {
      env: BOT,
      conversa: aguardando(),
      config: { rodizio_ativo: false, limite_simultaneo: 3 },
      atendentes: [online('Ana')],
    });
    expect(atribuicoes(rpcs)).toEqual([]);
  });

  it('cliente ainda no menu: não distribui antes da escolha', async () => {
    const { rpcs, queries } = await chamar(evento('oi'), {
      env: BOT,
      config: { rodizio_ativo: true, limite_simultaneo: 3 },
      atendentes: [online('Ana')],
    });
    expect(atribuicoes(rpcs)).toEqual([]);
    expect(queries.some((q) => q.tabela === 'whatsapp_filas_config')).toBe(false);
  });

  it('robô desligado e rodízio ligado: distribui sem departamento', async () => {
    const { rpcs } = await chamar(evento('a impressora parou'), {
      config: { rodizio_ativo: true, limite_simultaneo: 3 },
      atendentes: [online('Ana', { departamentos: ['poiesis'] })],
    });
    expect(atribuicoes(rpcs).map(([, a]) => a.p_operador)).toEqual(['Ana']);
  });

  it('conversa com responsável aberto: a mensagem nova herda o nome e o rodízio não roda', async () => {
    const { rpcs, queries } = await chamar(evento('mais uma coisa'), {
      config: { rodizio_ativo: true, limite_simultaneo: 3 },
      atendentes: [online('Ana')],
      caixa: [
        {
          canal: 'whatsapp',
          team: 'init',
          telefone: FONE,
          atribuido_a: 'Bia',
          direcao: 'entrada',
          status: 'pendente',
        },
      ],
    });
    expect(atribuicoes(rpcs)).toEqual([]);
    const herda = queries.find((q) => q.tabela === 'emails_triagem' && q.patch?.atribuido_a);
    expect(herda.patch.atribuido_a).toBe('Bia');
    expect(herda.filtros).toEqual(expect.arrayContaining([['atribuido_a', null, 'is']]));
  });

  it('banco sem a 087: a mensagem entra na caixa, o webhook responde 200 e só avisa no log', async () => {
    const { res, dados, rpcs, logs } = await chamar(evento('2'), {
      env: BOT,
      conversa: aguardando(),
      semColuna: true,
    });
    expect(res.status).toBe(200);
    expect(dados.caixa).toBe(1);
    expect(atribuicoes(rpcs)).toEqual([]);
    expect(logs.join('\n')).toMatch(/migration 087 não aplicada/);
  });
});
