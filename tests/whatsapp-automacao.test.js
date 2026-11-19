import { describe, it, expect } from 'vitest';
import {
  AUTOR_AUTOMACAO,
  configDaLinha,
  configDesligada,
  conversasParadas,
  decidirEntrada,
  decidirInatividade,
  decidirNota,
  dentroDoExpediente,
  deveAvisarForaDoHorario,
  ESTADO_AUTOMACAO_VAZIO,
  interpretarNota,
  jaEncerrada,
  mensagensDeEncerramento,
  semAvisoFixoDoBot,
  TEXTOS_PADRAO,
} from '../supabase/functions/whatsapp/automacao.ts';
import { TEXTO_FORA_DO_HORARIO, textoDirecionando } from '../supabase/functions/whatsapp/bot.ts';

// Regra da automação do WhatsApp (leva 3). O que se trava aqui: a conta de
// horário no fuso de Brasília (inclusive faixa que vira o dia e feriado), o
// aviso de fora do expediente uma vez por janela, a nota que só vale quando é
// nota com certeza, e tudo desligado por padrão.

// 2026-11-18 é quarta-feira. Brasília = UTC-3 (sem horário de verão).
const em = (dia, h, min = 0) => new Date(Date.UTC(2026, 10, dia, h + 3, min));
const quarta = (h, min) => em(18, h, min);
const quinta = (h, min) => em(19, h, min);
const sexta = (h, min) => em(20, h, min);
const sabado = (h, min) => em(21, h, min);
const iso = (d) => d.toISOString();

const COMERCIAL = [
  ['08:30', '12:00'],
  ['13:00', '17:30'],
];
const linhaComercial = (extra = {}) => ({
  team: 'init',
  horario_ativo: true,
  horario: { 1: COMERCIAL, 2: COMERCIAL, 3: COMERCIAL, 4: COMERCIAL, 5: COMERCIAL },
  ...extra,
});
const cfgComercial = (extra) => configDaLinha(linhaComercial(extra));

describe('configDaLinha', () => {
  it('equipe sem linha fica com tudo desligado', () => {
    const cfg = configDaLinha(null, 'mam');
    expect(cfg.team).toBe('mam');
    expect(cfg).toMatchObject({
      horarioAtivo: false,
      saudacaoAtiva: false,
      encerramentoAtivo: false,
      pesquisaAtiva: false,
      inatividadeAtiva: false,
    });
  });

  it('só true de verdade liga: "true" em texto ou 1 não contam', () => {
    const cfg = configDaLinha({ saudacao_ativa: 'true', pesquisa_ativa: 1 });
    expect(cfg.saudacaoAtiva).toBe(false);
    expect(cfg.pesquisaAtiva).toBe(false);
  });

  it('texto vazio volta ao padrão e faixa inválida é descartada', () => {
    const cfg = configDaLinha({
      texto_saudacao: '   ',
      horario: { 1: [['08:00', '12:00'], ['25:00', '26:00'], ['10:00', '10:00'], ['x']] },
    });
    expect(cfg.textoSaudacao).toBe(TEXTOS_PADRAO.saudacao);
    expect(cfg.horario[1]).toEqual([['08:00', '12:00']]);
  });

  it('inatividade com lembrete depois do encerramento fica desligada, não adivinhada', () => {
    const ruim = configDaLinha({
      inatividade_ativa: true,
      inatividade_lembrete_min: 60,
      inatividade_encerrar_min: 30,
    });
    expect(ruim.inatividadeAtiva).toBe(false);
    const sem = configDaLinha({ inatividade_ativa: true });
    expect(sem.inatividadeAtiva).toBe(false);
    const boa = configDaLinha({
      inatividade_ativa: true,
      inatividade_lembrete_min: 20,
      inatividade_encerrar_min: 60,
    });
    expect(boa).toMatchObject({ inatividadeAtiva: true, lembreteMin: 20, encerrarMin: 60 });
  });

  it('feriado só no formato do banco (AAAA-MM-DD ou MM-DD)', () => {
    const cfg = configDaLinha({ feriados: ['2026-11-20', '12-25', '25/12', '2026-13-01'] });
    expect(cfg.feriados).toEqual(['2026-11-20', '12-25']);
  });
});

describe('dentroDoExpediente', () => {
  it('abre e fecha nas bordas das faixas', () => {
    const cfg = cfgComercial();
    expect(dentroDoExpediente(cfg, quarta(8, 29))).toBe(false);
    expect(dentroDoExpediente(cfg, quarta(8, 30))).toBe(true);
    expect(dentroDoExpediente(cfg, quarta(12, 0))).toBe(false);
    expect(dentroDoExpediente(cfg, quarta(13, 0))).toBe(true);
    expect(dentroDoExpediente(cfg, quarta(17, 29))).toBe(true);
    expect(dentroDoExpediente(cfg, quarta(17, 30))).toBe(false);
    expect(dentroDoExpediente(cfg, sabado(10))).toBe(false);
  });

  it('usa o fuso de Brasília: 23h UTC de quarta é 20h lá, 12h UTC de quinta é 9h', () => {
    const cfg = cfgComercial();
    expect(dentroDoExpediente(cfg, new Date(Date.UTC(2026, 10, 18, 23, 0)))).toBe(false);
    expect(dentroDoExpediente(cfg, new Date(Date.UTC(2026, 10, 19, 2, 0)))).toBe(false);
    expect(dentroDoExpediente(cfg, new Date(Date.UTC(2026, 10, 19, 12, 0)))).toBe(true);
  });

  it('faixa que vira o dia (22:00-02:00 de quarta) vale até a madrugada de quinta', () => {
    const cfg = configDaLinha({ horario_ativo: true, horario: { 3: [['22:00', '02:00']] } });
    expect(dentroDoExpediente(cfg, quarta(21, 59))).toBe(false);
    expect(dentroDoExpediente(cfg, quarta(23, 0))).toBe(true);
    expect(dentroDoExpediente(cfg, quinta(1, 30))).toBe(true);
    expect(dentroDoExpediente(cfg, quinta(2, 0))).toBe(false);
    expect(dentroDoExpediente(cfg, em(17, 23))).toBe(false); // terça: não tem faixa
  });

  it('feriado com data fecha só aquele dia; sem ano fecha todo ano', () => {
    const cfg = cfgComercial({ feriados: ['2026-11-20', '12-25'] });
    expect(dentroDoExpediente(cfg, sexta(10))).toBe(false);
    expect(dentroDoExpediente(cfg, quinta(10))).toBe(true);
    expect(dentroDoExpediente(cfg, new Date(Date.UTC(2026, 11, 25, 13)))).toBe(false); // sexta
    expect(dentroDoExpediente(cfg, new Date(Date.UTC(2026, 11, 24, 13)))).toBe(true); // quinta
  });

  it('horário desligado não restringe nada', () => {
    expect(dentroDoExpediente(configDesligada(), sabado(3))).toBe(true);
  });
});

describe('deveAvisarForaDoHorario: uma vez por janela fechada', () => {
  const cfg = cfgComercial();

  it('primeira mensagem fora do horário recebe o aviso; dentro, nunca', () => {
    expect(deveAvisarForaDoHorario(cfg, sabado(10), null)).toBe(true);
    expect(deveAvisarForaDoHorario(cfg, quarta(10), null)).toBe(false);
  });

  it('segunda mensagem no mesmo fim de semana não recebe de novo', () => {
    // A janela começou sexta 17h30; o aviso de sexta 18h já cobre o sábado.
    expect(deveAvisarForaDoHorario(cfg, sabado(10), iso(sexta(18)))).toBe(false);
    expect(deveAvisarForaDoHorario(cfg, sabado(10), iso(sabado(9, 59)))).toBe(false);
  });

  it('aviso de uma janela anterior não conta: houve expediente no meio', () => {
    expect(deveAvisarForaDoHorario(cfg, sabado(10), iso(quinta(19)))).toBe(true);
    // Almoço é janela própria: avisado às 12h10, de novo à noite.
    expect(deveAvisarForaDoHorario(cfg, quarta(19), iso(quarta(12, 10)))).toBe(true);
    expect(deveAvisarForaDoHorario(cfg, quarta(12, 50), iso(quarta(12, 10)))).toBe(false);
  });

  it('janela que vira o dia: aviso das 23h segue valendo de madrugada', () => {
    expect(deveAvisarForaDoHorario(cfg, quinta(2), iso(quarta(23)))).toBe(false);
  });

  it('horário ligado sem dia nenhum vira "a cada 24 horas", sem repetir por mensagem', () => {
    const vazio = configDaLinha({ horario_ativo: true, horario: {} });
    expect(deveAvisarForaDoHorario(vazio, quarta(10), null)).toBe(true);
    expect(deveAvisarForaDoHorario(vazio, quarta(10), iso(quarta(8)))).toBe(false);
    expect(deveAvisarForaDoHorario(vazio, quarta(10), iso(em(17, 9)))).toBe(true);
  });

  it('desligado nunca avisa', () => {
    expect(deveAvisarForaDoHorario(configDesligada(), sabado(10), null)).toBe(false);
  });
});

describe('interpretarNota (CSAT 1 a 5)', () => {
  it.each([
    ['5', 5],
    [' 4 ', 4],
    ['4.', 4],
    ['5!', 5],
    ['nota 4', 4],
    ['Nota: 3', 3],
    ['4/5', 4],
    ['cinco', 5],
    ['dou 5', 5],
    ['5 estrelas', 5],
    ['5, obrigado', 5],
    ['⭐⭐⭐', 3],
    ['⭐️⭐️⭐️⭐️⭐️', 5],
    ['★', 1],
  ])('"%s" é %d', (texto, nota) => {
    expect(interpretarNota(texto)).toBe(nota);
  });

  it.each([
    '',
    '0',
    '6',
    '10',
    '45',
    '4 ou 5',
    '4 e 5',
    '⭐⭐⭐⭐⭐⭐',
    'oi',
    'tenho 2 dúvidas',
    'obrigado',
    'a impressora voltou a parar, 5 vezes hoje',
  ])('"%s" não é nota', (texto) => {
    expect(interpretarNota(texto)).toBeNull();
  });
});

describe('decidirNota', () => {
  const agora = quarta(10);
  const esperando = {
    ...ESTADO_AUTOMACAO_VAZIO,
    pesquisaAte: iso(quarta(20)),
    pesquisaTeam: 'init',
  };

  it('sem pesquisa pendente não mexe em nada', () => {
    expect(decidirNota(ESTADO_AUTOMACAO_VAZIO, '5', agora)).toEqual({ nota: null, limpar: false });
  });

  it('com pesquisa pendente, nota é capturada', () => {
    expect(decidirNota(esperando, '⭐⭐⭐⭐', agora)).toEqual({ nota: 4, limpar: true });
  });

  it('o que não é nota encerra a espera e segue como mensagem normal', () => {
    expect(decidirNota(esperando, 'na verdade ainda não voltou', agora)).toEqual({
      nota: null,
      limpar: true,
    });
  });

  it('pesquisa vencida não captura mais nada', () => {
    expect(decidirNota(esperando, '5', quarta(21))).toEqual({ nota: null, limpar: true });
  });
});

describe('decidirEntrada: saudação e aviso de horário', () => {
  const agora = quarta(10);
  const ligada = configDaLinha({ saudacao_ativa: true, texto_saudacao: 'Olá!' });
  const ctx = (extra = {}) => ({
    agora,
    estado: ESTADO_AUTOMACAO_VAZIO,
    chamadoAberto: false,
    botRespondeu: false,
    ...extra,
  });

  it('desligada não manda nada', () => {
    expect(decidirEntrada(configDesligada(), ctx()).respostas).toEqual([]);
  });

  it('número novo recebe a saudação; conversa em andamento não', () => {
    expect(decidirEntrada(ligada, ctx()).respostas).toEqual(['Olá!']);
    const recente = { ...ESTADO_AUTOMACAO_VAZIO, ultimaEm: iso(quarta(9, 50)) };
    expect(decidirEntrada(ligada, ctx({ estado: recente })).respostas).toEqual([]);
  });

  it('mensagem depois do encerramento é conversa nova, mesmo poucos minutos depois', () => {
    const estado = {
      ...ESTADO_AUTOMACAO_VAZIO,
      ultimaEm: iso(quarta(9, 50)),
      encerradaEm: iso(quarta(9, 55)),
    };
    expect(decidirEntrada(ligada, ctx({ estado })).respostas).toEqual(['Olá!']);
  });

  it('não saúda quando o menu do bot já respondeu nem com chamado aberto', () => {
    expect(decidirEntrada(ligada, ctx({ botRespondeu: true })).respostas).toEqual([]);
    expect(decidirEntrada(ligada, ctx({ chamadoAberto: true })).respostas).toEqual([]);
  });

  it('fora do horário, a saudação vem seguida do aviso', () => {
    const cfg = cfgComercial({ saudacao_ativa: true, texto_saudacao: 'Olá!' });
    const d = decidirEntrada(cfg, ctx({ agora: sabado(10) }));
    expect(d.respostas).toEqual(['Olá!', cfg.textoForaHorario]);
    expect(d.avisouForaHorario).toBe(true);
  });

  it('o aviso de horário sai até com chamado aberto (o cliente precisa saber)', () => {
    const cfg = cfgComercial();
    const d = decidirEntrada(cfg, ctx({ agora: sabado(10), chamadoAberto: true }));
    expect(d.respostas).toEqual([cfg.textoForaHorario]);
  });
});

describe('semAvisoFixoDoBot', () => {
  it('com horário da equipe, o aviso fixo do bot sai; sem, fica', () => {
    const respostas = [textoDirecionando('P-1'), TEXTO_FORA_DO_HORARIO];
    expect(semAvisoFixoDoBot(respostas, cfgComercial())).toEqual([textoDirecionando('P-1')]);
    expect(semAvisoFixoDoBot(respostas, configDesligada())).toEqual(respostas);
  });
});

describe('mensagensDeEncerramento', () => {
  const cfg = configDaLinha({
    encerramento_ativo: true,
    texto_encerramento: 'Tchau',
    pesquisa_ativa: true,
    texto_pesquisa: 'Nota?',
    inatividade_ativa: true,
    inatividade_encerrar_min: 60,
    texto_inatividade: 'Sumiu',
  });

  it('pela equipe: encerramento e depois a pesquisa', () => {
    expect(mensagensDeEncerramento(cfg, 'equipe')).toEqual({
      textos: ['Tchau', 'Nota?'],
      pesquisa: true,
    });
  });

  it('por inatividade: só o aviso, sem pesquisa', () => {
    expect(mensagensDeEncerramento(cfg, 'inatividade')).toEqual({
      textos: ['Sumiu'],
      pesquisa: false,
    });
  });

  it('desligado: nada', () => {
    expect(mensagensDeEncerramento(configDesligada(), 'equipe')).toEqual({
      textos: [],
      pesquisa: false,
    });
  });
});

describe('jaEncerrada', () => {
  it('encerrada depois da última mensagem do número segura o reenvio', () => {
    const base = { ...ESTADO_AUTOMACAO_VAZIO, ultimaEm: iso(quarta(9)) };
    expect(jaEncerrada(base)).toBe(false);
    expect(jaEncerrada({ ...base, encerradaEm: iso(quarta(10)) })).toBe(true);
    expect(jaEncerrada({ ...base, encerradaEm: iso(quarta(8)) })).toBe(false);
  });
});

describe('decidirInatividade', () => {
  const cfg = configDaLinha({
    inatividade_ativa: true,
    inatividade_lembrete_min: 20,
    inatividade_encerrar_min: 60,
  });
  const saida = iso(quarta(10));

  it('espera, lembra uma vez e encerra', () => {
    expect(decidirInatividade(cfg, saida, null, quarta(10, 19))).toBeNull();
    expect(decidirInatividade(cfg, saida, null, quarta(10, 20))).toBe('lembrar');
    expect(decidirInatividade(cfg, saida, iso(quarta(10, 21)), quarta(10, 40))).toBeNull();
    expect(decidirInatividade(cfg, saida, iso(quarta(10, 21)), quarta(11))).toBe('encerrar');
  });

  it('lembrete de uma resposta anterior da equipe não conta para a nova', () => {
    expect(decidirInatividade(cfg, saida, iso(quarta(9, 30)), quarta(10, 25))).toBe('lembrar');
  });

  it('passado o prazo encerra mesmo sem lembrete (cron parado)', () => {
    expect(decidirInatividade(cfg, saida, null, quarta(12))).toBe('encerrar');
  });

  it('sem lembrete configurado, só encerra', () => {
    const so = configDaLinha({ inatividade_ativa: true, inatividade_encerrar_min: 60 });
    expect(decidirInatividade(so, saida, null, quarta(10, 30))).toBeNull();
    expect(decidirInatividade(so, saida, null, quarta(11))).toBe('encerrar');
  });

  it('desligada nunca age', () => {
    expect(decidirInatividade(configDesligada(), saida, null, quarta(23))).toBeNull();
  });
});

describe('conversasParadas', () => {
  const l = (extra) => ({
    telefone: '5511987654321',
    team: 'init',
    client_id: 'C1',
    de: 'Márcia',
    direcao: 'entrada',
    status: 'anexado',
    recebido_em: iso(quarta(9)),
    pendencia_id: null,
    ...extra,
  });
  const operador = (extra) =>
    l({ de: 'Ana', direcao: 'saida', recebido_em: iso(quarta(10)), ...extra });

  it('última palavra da equipe: o cliente está devendo resposta', () => {
    expect(conversasParadas([l(), operador()])).toEqual([
      { telefone: '5511987654321', team: 'init', clientId: 'C1', ultimaSaidaEm: iso(quarta(10)) },
    ]);
  });

  it('cliente respondeu depois: nada a fazer', () => {
    expect(conversasParadas([l(), operador(), l({ recebido_em: iso(quarta(10, 5)) })])).toEqual([]);
  });

  it('o lembrete do robô e a nota interna não contam como última palavra', () => {
    const r = conversasParadas([
      l(),
      operador(),
      l({ de: AUTOR_AUTOMACAO, direcao: 'saida', recebido_em: iso(quarta(10, 20)) }),
      l({ de: 'Ana', direcao: 'interna', recebido_em: iso(quarta(10, 30)) }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].ultimaSaidaEm).toBe(iso(quarta(10)));
  });

  it('só o robô falou (menu) não é conversa parada', () => {
    expect(
      conversasParadas([
        l({ status: 'pendente' }),
        l({ de: AUTOR_AUTOMACAO, direcao: 'saida', recebido_em: iso(quarta(9, 1)) }),
      ])
    ).toEqual([]);
  });

  it('encerrada, descartada ou com chamado fica de fora', () => {
    expect(conversasParadas([l({ status: 'encerrado' }), operador()])).toEqual([]);
    expect(conversasParadas([l({ status: 'descartado' }), operador()])).toEqual([]);
    expect(conversasParadas([l({ pendencia_id: 'PEN-1' }), operador()])).toEqual([]);
  });

  it('a equipe da conversa é a da resposta da equipe', () => {
    const r = conversasParadas([l({ team: 'mam' }), operador({ team: 'mam' })]);
    expect(r[0].team).toBe('mam');
  });
});
