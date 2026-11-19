import { describe, it, expect, beforeAll } from 'vitest';
import { loadHandler, reqPost } from './helpers/edge-harness.js';
import { fakeSupabase } from './helpers/fake-supabase.js';
import { TEXTO_BOAS_VINDAS, TEXTO_FORA_DO_HORARIO } from '../supabase/functions/whatsapp/bot.ts';
import { AUTOR_AUTOMACAO, TEXTOS_PADRAO } from '../supabase/functions/whatsapp/automacao.ts';

// Automação do WhatsApp (leva 3) rodando nas functions de verdade, com o dublê
// de Supabase e uma WAHA falsa que só registra o que sairia para o cliente.
// O que se trava: nada sai com a automação desligada; a nota da pesquisa é
// gravada sem reabrir a conversa e o que não é nota não some; o encerramento
// e o cron respeitam a equipe da conversa (service role não tem RLS).

const ENV = {
  SUPABASE_URL: 'https://projeto.supabase.co',
  SUPABASE_ANON_KEY: 'anon-de-teste',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-de-teste',
  WHATSAPP_WEBHOOK_TOKEN: 'segredo-do-webhook',
  WAHA_BASE_URL: 'https://waha.interno',
  WAHA_API_KEY: 'chave-da-waha',
  AVISOS_CRON_SECRET: 'segredo-do-cron',
};
const TEL = '5511987654321';
const minAtras = (n) => new Date(Date.now() - n * 60_000).toISOString();
const minFrente = (n) => new Date(Date.now() + n * 60_000).toISOString();

function wahaFalsa() {
  const enviadas = [];
  const fetch = async (url, init) => {
    if (String(url).includes('/api/sendText')) {
      enviadas.push(JSON.parse(init.body).text);
      return new Response(JSON.stringify({ id: 'W' + enviadas.length }));
    }
    return new Response('{}', { status: 404 });
  };
  return { enviadas, fetch };
}

const inserts = (queries, tabela) =>
  queries.filter((q) => q.tabela === tabela && q.insert).map((q) => q.insert);
const patches = (queries, tabela) =>
  queries.filter((q) => q.tabela === tabela && q.patch && !q.insert);

// ── Webhook ──────────────────────────────────────────────────────────────────

async function webhook(texto, { conversa = null, automacao = [], env = ENV, id = 'M1' } = {}) {
  const queries = [];
  const waha = wahaFalsa();
  const createClient = fakeSupabase({
    queries,
    tabelas: {
      whatsapp_conversas: conversa ? [{ telefone: TEL, foto_em: minAtras(1), ...conversa }] : [],
      whatsapp_automacao: automacao,
    },
  });
  const { handler } = await loadHandler('whatsapp', { env, createClient, fetch: waha.fetch });
  const res = await handler(
    new Request('https://fn.local/?token=segredo-do-webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        event: 'message',
        payload: {
          id,
          from: TEL + '@c.us',
          body: texto,
          timestamp: Math.floor(Date.now() / 1000),
          notifyName: 'Márcia',
        },
      }),
    })
  );
  return { res, dados: await res.json(), queries, enviadas: waha.enviadas };
}

describe('webhook: automação desligada por padrão', () => {
  beforeAll(async () => {
    await loadHandler('whatsapp', { env: ENV, createClient: () => ({}) });
  }, 60000);

  it('equipe sem configuração: a mensagem entra e nada sai para o cliente', async () => {
    const { dados, enviadas, queries } = await webhook('oi', { conversa: { ultima_em: null } });
    expect(dados.caixa).toBe(1);
    expect(enviadas).toEqual([]);
    expect(inserts(queries, 'whatsapp_avaliacoes')).toEqual([]);
  });

  it('saudação ligada: número novo recebe a saudação, gravada como do robô', async () => {
    const { enviadas, queries } = await webhook('oi', {
      conversa: { ultima_em: null },
      automacao: [{ team: 'init', saudacao_ativa: true, texto_saudacao: 'Olá, já vamos atender!' }],
    });
    expect(enviadas).toEqual(['Olá, já vamos atender!']);
    const saida = inserts(queries, 'emails_triagem').find((l) => l.direcao === 'saida');
    expect(saida).toMatchObject({ de: AUTOR_AUTOMACAO, team: 'init', telefone: TEL });
  });
});

describe('webhook: fora do expediente uma vez só', () => {
  // Horário ligado sem dia nenhum = sempre fechado, e o teste não depende da
  // hora em que a suíte roda.
  const fechado = [
    { team: 'init', horario_ativo: true, horario: {}, texto_fora_horario: 'Fechado.' },
  ];

  it('primeira mensagem recebe o aviso e o aviso fica marcado', async () => {
    const { enviadas, queries } = await webhook('oi', {
      conversa: { ultima_em: minAtras(60) },
      automacao: fechado,
    });
    expect(enviadas).toEqual(['Fechado.']);
    const marca = patches(queries, 'whatsapp_conversas').find((q) => q.patch.fora_horario_em);
    expect(marca.filtros).toContainEqual(['telefone', TEL]);
  });

  it('com o aviso dado nesta janela, a mensagem seguinte não recebe de novo', async () => {
    const { enviadas } = await webhook('alô?', {
      conversa: { ultima_em: minAtras(5), fora_horario_em: minAtras(5) },
      automacao: fechado,
    });
    expect(enviadas).toEqual([]);
  });

  it('com o horário da equipe, o aviso fixo do bot não sai junto', async () => {
    const { enviadas } = await webhook('1', {
      conversa: { ultima_em: null },
      automacao: fechado,
      env: { ...ENV, WHATSAPP_BOT_ATIVO: '1' },
    });
    expect(enviadas).not.toContain(TEXTO_FORA_DO_HORARIO);
    expect(enviadas).toContain('Fechado.');
    expect(enviadas[0]).toContain('Estamos direcionando seu atendimento');
  });

  it('com o menu do bot respondendo, a saudação não duplica as boas-vindas', async () => {
    const { enviadas } = await webhook('oi', {
      conversa: { ultima_em: null },
      automacao: [{ team: 'init', saudacao_ativa: true, texto_saudacao: 'Olá!' }],
      env: { ...ENV, WHATSAPP_BOT_ATIVO: '1' },
    });
    expect(enviadas).toEqual([TEXTO_BOAS_VINDAS]);
  });
});

describe('webhook: resposta da pesquisa de satisfação', () => {
  const esperando = {
    ultima_em: minAtras(10),
    encerrada_em: minAtras(5),
    pesquisa_ate: minFrente(60),
    pesquisa_team: 'mam',
    pesquisa_operador: 'Ana',
  };
  const mam = [{ team: 'mam', pesquisa_ativa: true, texto_agradecimento: 'Valeu pela nota!' }];

  it('nota grava a avaliação na equipe de quem encerrou e agradece', async () => {
    const { dados, enviadas, queries } = await webhook('⭐⭐⭐⭐⭐', {
      conversa: esperando,
      automacao: mam,
    });
    expect(dados.caixa).toBe(1);
    expect(inserts(queries, 'whatsapp_avaliacoes')).toEqual([
      expect.objectContaining({
        team: 'mam',
        telefone: TEL,
        nota: 5,
        operador: 'Ana',
        escala: 'csat',
      }),
    ]);
    expect(enviadas).toEqual(['Valeu pela nota!']);
    const limpa = patches(queries, 'whatsapp_conversas').find((q) => 'pesquisa_ate' in q.patch);
    expect(limpa.patch.pesquisa_ate).toBeNull();
  });

  it('a nota entra na caixa já encerrada: não reabre o atendimento', async () => {
    const { queries } = await webhook('nota 4', { conversa: esperando, automacao: mam });
    const entrada = inserts(queries, 'emails_triagem').find((l) => l.direcao === 'entrada');
    expect(entrada).toMatchObject({ status: 'encerrado', team: 'mam', corpo: 'nota 4' });
  });

  it('resposta que não é nota segue como mensagem normal e encerra a espera', async () => {
    const { enviadas, queries } = await webhook('ainda está sem internet', {
      conversa: esperando,
      automacao: mam,
    });
    expect(inserts(queries, 'whatsapp_avaliacoes')).toEqual([]);
    expect(enviadas).toEqual([]);
    const entrada = inserts(queries, 'emails_triagem').find((l) => l.direcao === 'entrada');
    expect(entrada.status).toBe('pendente');
    const limpa = patches(queries, 'whatsapp_conversas').find((q) => 'pesquisa_ate' in q.patch);
    expect(limpa.patch).toEqual({ pesquisa_ate: null });
  });

  it('pesquisa vencida: o "5" é só mais uma mensagem', async () => {
    const { queries } = await webhook('5', {
      conversa: { ...esperando, pesquisa_ate: minAtras(1) },
      automacao: mam,
    });
    expect(inserts(queries, 'whatsapp_avaliacoes')).toEqual([]);
    expect(inserts(queries, 'emails_triagem')[0].status).toBe('pendente');
  });
});

// ── conversa-encerrar ────────────────────────────────────────────────────────

const OPERADOR = { id: 'op-1', auth_user_id: 'user-1', name: 'Ana', active: true };

function entrada(over) {
  return {
    id: 'e1',
    thread_id: 'whatsapp:' + TEL,
    direcao: 'entrada',
    team: 'init',
    canal: 'whatsapp',
    telefone: TEL,
    client_id: 'C1',
    status: 'anexado',
    recebido_em: minAtras(30),
    ...over,
  };
}

async function encerrar({
  linhas = [entrada()],
  conversa = { telefone: TEL, ultima_em: minAtras(30) },
  automacao = [],
  operador = OPERADOR,
  body = { thread_id: 'whatsapp:' + TEL },
} = {}) {
  const queries = [];
  const waha = wahaFalsa();
  const { handler } = await loadHandler('conversa-encerrar', {
    env: ENV,
    fetch: waha.fetch,
    createClient: fakeSupabase({
      user: { id: 'user-1' },
      queries,
      tabelas: {
        operators: operador ? [operador] : [],
        emails_triagem: linhas,
        whatsapp_conversas: conversa ? [conversa] : [],
        whatsapp_automacao: automacao,
      },
    }),
  });
  const res = await handler(reqPost(body, 'jwt-valido'));
  return { res, dados: await res.json(), queries, enviadas: waha.enviadas };
}

describe('conversa-encerrar', () => {
  const ligada = [
    {
      team: 'init',
      encerramento_ativo: true,
      texto_encerramento: 'Encerrado, obrigado!',
      pesquisa_ativa: true,
      texto_pesquisa: 'Nota de 1 a 5?',
      pesquisa_horas: 24,
    },
  ];

  it('sem JWT é 401 pelo wrapper; operador inativo também não encerra', async () => {
    const { handler } = await loadHandler('conversa-encerrar', {
      env: ENV,
      createClient: fakeSupabase({ user: { id: 'user-1' } }),
    });
    expect((await handler(reqPost({ thread_id: 'x' }))).status).toBe(401);
    const { res } = await encerrar({ operador: { ...OPERADOR, active: false } });
    expect(res.status).toBe(401);
  });

  it('conversa que a RLS não mostra é 404 e nada muda', async () => {
    const { res, queries, enviadas } = await encerrar({ linhas: [] });
    expect(res.status).toBe(404);
    expect(queries.filter((q) => q.patch)).toEqual([]);
    expect(enviadas).toEqual([]);
  });

  it('o status muda só no thread E na equipe da conversa', async () => {
    const { res, queries } = await encerrar({
      linhas: [entrada({ team: 'mam' }), entrada({ id: 'e0', recebido_em: minAtras(90) })],
    });
    expect(res.status).toBe(200);
    const ups = patches(queries, 'emails_triagem').filter((q) => q.patch.status === 'encerrado');
    expect(ups).toHaveLength(2);
    for (const up of ups) expect(up.filtros).toContainEqual(['team', 'mam']);
    expect(ups[0].filtros).toContainEqual(['thread_id', 'whatsapp:' + TEL]);
    expect(ups[0].filtros).toContainEqual(['status', ['pendente', 'anexado'], 'in']);
  });

  it('sem automação configurada encerra e não manda nada', async () => {
    const { res, dados, enviadas, queries } = await encerrar();
    expect(res.status).toBe(200);
    expect(dados).toMatchObject({ success: true, enviadas: 0, pesquisa: false });
    expect(enviadas).toEqual([]);
    // encerrada_em marca mesmo assim: a próxima mensagem é conversa nova.
    const est = patches(queries, 'whatsapp_conversas').find((q) => q.patch.encerrada_em);
    expect(est.patch.pesquisa_ate).toBeNull();
  });

  it('ligada: manda encerramento e pesquisa, e passa a esperar a nota', async () => {
    const { dados, enviadas, queries } = await encerrar({ automacao: ligada });
    expect(enviadas).toEqual(['Encerrado, obrigado!', 'Nota de 1 a 5?']);
    expect(dados).toMatchObject({ enviadas: 2, pesquisa: true });
    const est = patches(queries, 'whatsapp_conversas').find((q) => q.patch.encerrada_em);
    expect(est.patch).toMatchObject({ pesquisa_team: 'init', pesquisa_operador: 'Ana' });
    expect(Date.parse(est.patch.pesquisa_ate)).toBeGreaterThan(Date.now() + 23 * 3600_000);
    const gravadas = inserts(queries, 'emails_triagem');
    expect(gravadas.map((l) => l.status)).toEqual(['encerrado', 'encerrado']);
    expect(gravadas[0]).toMatchObject({ de: AUTOR_AUTOMACAO, direcao: 'saida', team: 'init' });
  });

  it('segundo clique (já encerrada depois da última mensagem) não reenvia', async () => {
    const { dados, enviadas } = await encerrar({
      automacao: ligada,
      conversa: { telefone: TEL, ultima_em: minAtras(30), encerrada_em: minAtras(1) },
    });
    expect(enviadas).toEqual([]);
    expect(dados.repetido).toBe(true);
  });

  it('número que nunca escreveu (sem whatsapp_conversas) não recebe nada', async () => {
    const { enviadas } = await encerrar({ automacao: ligada, conversa: null });
    expect(enviadas).toEqual([]);
  });

  it('conversa de e-mail encerra sem tocar na WAHA', async () => {
    const { res, enviadas } = await encerrar({
      automacao: ligada,
      linhas: [entrada({ canal: 'email', telefone: null, thread_id: 't1' })],
      body: { thread_id: 't1' },
    });
    expect(res.status).toBe(200);
    expect(enviadas).toEqual([]);
  });
});

// ── whatsapp-inatividade (cron) ──────────────────────────────────────────────

async function cron({
  automacao = [],
  linhas = [],
  conversas = [],
  segredo = 'segredo-do-cron',
} = {}) {
  const queries = [];
  const waha = wahaFalsa();
  const { handler } = await loadHandler('whatsapp-inatividade', {
    env: ENV,
    fetch: waha.fetch,
    createClient: fakeSupabase({
      queries,
      tabelas: {
        whatsapp_automacao: automacao,
        emails_triagem: linhas,
        whatsapp_conversas: conversas,
      },
    }),
  });
  const res = await handler(
    new Request('https://fn.local/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(segredo ? { 'x-cron-secret': segredo } : {}),
      },
      body: '{}',
    })
  );
  return { res, dados: await res.json(), queries, enviadas: waha.enviadas };
}

describe('whatsapp-inatividade', () => {
  const cfg = [
    {
      team: 'init',
      inatividade_ativa: true,
      inatividade_lembrete_min: 20,
      inatividade_encerrar_min: 60,
      texto_lembrete: 'Ainda aí?',
      texto_inatividade: 'Encerrando por falta de retorno.',
    },
  ];
  const historico = (minutosDesdeResposta, extra = {}) => [
    entrada({ recebido_em: minAtras(minutosDesdeResposta + 5), ...extra }),
    {
      ...entrada({ id: 's1', de: 'Ana', direcao: 'saida', ...extra }),
      recebido_em: minAtras(minutosDesdeResposta),
    },
  ];

  it('sem o x-cron-secret certo é 401 e não lê nada', async () => {
    const semSegredo = await cron({ segredo: null });
    expect(semSegredo.res.status).toBe(401);
    const errado = await cron({ segredo: 'outro' });
    expect(errado.res.status).toBe(401);
    expect(errado.queries).toEqual([]);
  });

  it('nenhuma equipe com inatividade ligada: lê a configuração e para', async () => {
    const { dados, queries, enviadas } = await cron({ linhas: historico(90) });
    expect(dados).toEqual({ ok: true, ativo: false });
    expect(queries.map((q) => q.tabela)).toEqual(['whatsapp_automacao']);
    expect(enviadas).toEqual([]);
  });

  it('passou do prazo do lembrete: lembra uma vez e marca', async () => {
    const { dados, enviadas, queries } = await cron({
      automacao: cfg,
      linhas: historico(25),
      conversas: [{ telefone: TEL, inatividade_lembrete_em: null }],
    });
    expect(dados).toMatchObject({ lembretes: 1, encerradas: 0 });
    expect(enviadas).toEqual(['Ainda aí?']);
    const marca = patches(queries, 'whatsapp_conversas').find(
      (q) => q.patch.inatividade_lembrete_em
    );
    expect(marca.filtros).toContainEqual(['telefone', TEL]);
  });

  it('lembrete já dado para esta resposta: espera o prazo de encerrar', async () => {
    const { enviadas } = await cron({
      automacao: cfg,
      linhas: historico(30),
      conversas: [{ telefone: TEL, inatividade_lembrete_em: minAtras(5) }],
    });
    expect(enviadas).toEqual([]);
  });

  it('passou do prazo de encerrar: encerra só nesta equipe e avisa o cliente', async () => {
    const { dados, enviadas, queries } = await cron({
      automacao: cfg,
      linhas: historico(65),
      conversas: [
        { telefone: TEL, ultima_em: minAtras(70), inatividade_lembrete_em: minAtras(40) },
      ],
    });
    expect(dados).toMatchObject({ encerradas: 1 });
    expect(enviadas).toEqual(['Encerrando por falta de retorno.']);
    const up = patches(queries, 'emails_triagem').find((q) => q.patch.status === 'encerrado');
    expect(up.filtros).toEqual(
      expect.arrayContaining([
        ['canal', 'whatsapp'],
        ['telefone', TEL],
        ['team', 'init'],
        ['status', ['pendente', 'anexado'], 'in'],
      ])
    );
    // Por inatividade não vai pesquisa: quem sumiu não avalia.
    const est = patches(queries, 'whatsapp_conversas').find((q) => q.patch.encerrada_em);
    expect(est.patch.pesquisa_ate).toBeNull();
  });

  it('conversa de equipe sem a inatividade ligada não é tocada', async () => {
    const { enviadas, queries } = await cron({
      automacao: cfg,
      linhas: historico(65, { team: 'mam' }),
      conversas: [{ telefone: TEL }],
    });
    expect(enviadas).toEqual([]);
    expect(patches(queries, 'emails_triagem')).toEqual([]);
  });

  it('conversa ligada a chamado não é encerrada por inatividade', async () => {
    const { enviadas } = await cron({
      automacao: cfg,
      linhas: historico(65, { pendencia_id: 'PEN-1' }),
      conversas: [{ telefone: TEL }],
    });
    expect(enviadas).toEqual([]);
  });

  it('textos padrão quando a equipe não escreveu os seus', async () => {
    const { enviadas } = await cron({
      automacao: [{ ...cfg[0], texto_lembrete: null }],
      linhas: historico(25),
      conversas: [{ telefone: TEL }],
    });
    expect(enviadas).toEqual([TEXTOS_PADRAO.lembrete]);
  });
});
