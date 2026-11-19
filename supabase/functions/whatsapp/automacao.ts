// Automação do atendimento por WhatsApp (leva 3): horário de atendimento,
// saudação, encerramento, pesquisa de satisfação e inatividade.
//
// Só regra, sem rede e sem Deno (o vitest importa este arquivo direto), no
// mesmo espírito de bot.ts. Quem lê o banco e manda mensagem é
// automacao-acoes.ts; aqui só se decide O QUE fazer.
//
// TUDO DESLIGADO POR PADRÃO: equipe sem linha em whatsapp_automacao (088), ou
// com a linha ilegível, vale CONFIG_DESLIGADA. Cada mensagem automática é uma
// mensagem a mais saindo do número da empresa por uma API não oficial; ligar é
// decisão de quem administra a equipe, nunca efeito colateral de deploy.
//
// FUSO — as contas de horário usam o relógio de parede de America/Sao_Paulo,
// nunca o fuso do servidor. O Brasil não tem horário de verão hoje, mas a conta
// passa pelo nome do fuso para continuar certa se isso mudar.

import { TEXTO_FORA_DO_HORARIO } from './bot.ts';

// Mesmo autor do bot (index.ts, AUTOR_BOT) e da Caixa (CAIXA_AUTOR_BOT): é por
// ele que o balão aparece como "Atendimento automático" e que a inatividade
// sabe que a mensagem não foi de uma pessoa da equipe.
export const AUTOR_AUTOMACAO = 'Atendimento automático';

export type Faixa = [string, string]; // ["08:30", "12:00"]

export type ConfigAutomacao = {
  team: string;
  horarioAtivo: boolean;
  // 0 = domingo … 6 = sábado, como Date.getDay().
  horario: Record<number, Faixa[]>;
  // 'AAAA-MM-DD' (só aquele dia) ou 'MM-DD' (todo ano).
  feriados: string[];
  textoForaHorario: string;
  saudacaoAtiva: boolean;
  textoSaudacao: string;
  encerramentoAtivo: boolean;
  textoEncerramento: string;
  pesquisaAtiva: boolean;
  textoPesquisa: string;
  textoAgradecimento: string;
  pesquisaHoras: number;
  inatividadeAtiva: boolean;
  // null = sem lembrete, só encerra.
  lembreteMin: number | null;
  encerrarMin: number;
  textoLembrete: string;
  textoInatividade: string;
};

export const TEXTOS_PADRAO = {
  foraHorario:
    'Recebemos sua mensagem fora do nosso horário de atendimento. Ela ficou registrada e ' +
    'responderemos assim que voltarmos.',
  saudacao: 'Olá! Recebemos sua mensagem e em instantes alguém da nossa equipe vai atender você.',
  encerramento:
    'Seu atendimento foi encerrado. Obrigado pelo contato!\n' +
    'Protocolo: {protocolo}\n' +
    'Se precisar, é só mandar uma nova mensagem.',
  pesquisa:
    'Como você avalia este atendimento? Responda com uma nota de 1 (muito insatisfeito) ' +
    'a 5 (muito satisfeito).',
  agradecimento: 'Obrigado pela sua avaliação!',
  lembrete:
    'Olá! Ainda está por aí? Se precisar de mais alguma coisa, é só responder esta mensagem.',
  inatividade:
    'Como não tivemos retorno, estamos encerrando este atendimento. Se precisar, é só mandar ' +
    'uma nova mensagem.',
};

export const TEXTO_MAX = 1000;
export const PESQUISA_HORAS_PADRAO = 24;
export const INATIVIDADE_MIN_MIN = 5;
export const INATIVIDADE_MAX_MIN = 7 * 24 * 60;

// Mesma janela do bot (SILENCIO_NOVA_CONVERSA_MS): passado isso sem mensagem do
// número, a próxima é conversa nova e merece saudação de novo.
export const SILENCIO_NOVA_CONVERSA_MS = 12 * 60 * 60 * 1000;

export function configDesligada(team = 'init'): ConfigAutomacao {
  return {
    team,
    horarioAtivo: false,
    horario: {},
    feriados: [],
    textoForaHorario: TEXTOS_PADRAO.foraHorario,
    saudacaoAtiva: false,
    textoSaudacao: TEXTOS_PADRAO.saudacao,
    encerramentoAtivo: false,
    textoEncerramento: TEXTOS_PADRAO.encerramento,
    pesquisaAtiva: false,
    textoPesquisa: TEXTOS_PADRAO.pesquisa,
    textoAgradecimento: TEXTOS_PADRAO.agradecimento,
    pesquisaHoras: PESQUISA_HORAS_PADRAO,
    inatividadeAtiva: false,
    lembreteMin: null,
    encerrarMin: 60,
    textoLembrete: TEXTOS_PADRAO.lembrete,
    textoInatividade: TEXTOS_PADRAO.inatividade,
  };
}

const HORA_RE = /^([01]\d|2[0-4]):([0-5]\d)$/;

/** "08:30" → 510; "24:00" → 1440; inválido → null. */
export function minutosDaHora(h: unknown): number | null {
  const m = HORA_RE.exec(String(h ?? '').trim());
  if (!m) return null;
  const total = Number(m[1]) * 60 + Number(m[2]);
  return total <= 1440 ? total : null;
}

function texto(valor: unknown, padrao: string): string {
  const t = String(valor ?? '').trim();
  return t ? t.slice(0, TEXTO_MAX) : padrao;
}

function inteiro(valor: unknown, min: number, max: number): number | null {
  const n = Number(valor);
  if (!Number.isFinite(n)) return null;
  const i = Math.round(n);
  return i >= min && i <= max ? i : null;
}

function faixasValidas(bruto: unknown): Faixa[] {
  if (!Array.isArray(bruto)) return [];
  const out: Faixa[] = [];
  for (const f of bruto) {
    if (!Array.isArray(f) || f.length !== 2) continue;
    const a = minutosDaHora(f[0]);
    const b = minutosDaHora(f[1]);
    // Faixa vazia não abre nada; 24:00 só faz sentido como fim.
    if (a === null || b === null || a === b || a === 1440) continue;
    out.push([String(f[0]).trim(), String(f[1]).trim()]);
  }
  return out;
}

const FERIADO_RE = /^(\d{4}-)?(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * Configuração legível a partir da linha de whatsapp_automacao (088). Tolerante
 * de propósito: campo inválido volta ao padrão, e inatividade com prazos que
 * não fecham (encerrar antes do lembrete) fica DESLIGADA em vez de adivinhada.
 */
export function configDaLinha(
  linha: Record<string, unknown> | null,
  team = 'init'
): ConfigAutomacao {
  const cfg = configDesligada(String(linha?.team || team));
  if (!linha) return cfg;
  const horario: Record<number, Faixa[]> = {};
  const brutoHorario =
    linha.horario && typeof linha.horario === 'object'
      ? (linha.horario as Record<string, unknown>)
      : {};
  for (let dia = 0; dia <= 6; dia++) {
    const faixas = faixasValidas(brutoHorario[String(dia)]);
    if (faixas.length) horario[dia] = faixas;
  }
  cfg.horario = horario;
  cfg.feriados = Array.isArray(linha.feriados)
    ? (linha.feriados as unknown[]).map((f) => String(f).trim()).filter((f) => FERIADO_RE.test(f))
    : [];
  cfg.horarioAtivo = linha.horario_ativo === true;
  cfg.textoForaHorario = texto(linha.texto_fora_horario, TEXTOS_PADRAO.foraHorario);
  cfg.saudacaoAtiva = linha.saudacao_ativa === true;
  cfg.textoSaudacao = texto(linha.texto_saudacao, TEXTOS_PADRAO.saudacao);
  cfg.encerramentoAtivo = linha.encerramento_ativo === true;
  cfg.textoEncerramento = texto(linha.texto_encerramento, TEXTOS_PADRAO.encerramento);
  cfg.pesquisaAtiva = linha.pesquisa_ativa === true;
  cfg.textoPesquisa = texto(linha.texto_pesquisa, TEXTOS_PADRAO.pesquisa);
  cfg.textoAgradecimento = texto(linha.texto_agradecimento, TEXTOS_PADRAO.agradecimento);
  cfg.pesquisaHoras = inteiro(linha.pesquisa_horas, 1, 168) ?? PESQUISA_HORAS_PADRAO;
  cfg.textoLembrete = texto(linha.texto_lembrete, TEXTOS_PADRAO.lembrete);
  cfg.textoInatividade = texto(linha.texto_inatividade, TEXTOS_PADRAO.inatividade);
  const encerrar = inteiro(
    linha.inatividade_encerrar_min,
    INATIVIDADE_MIN_MIN * 2,
    INATIVIDADE_MAX_MIN
  );
  const lembrete =
    linha.inatividade_lembrete_min == null || linha.inatividade_lembrete_min === ''
      ? null
      : inteiro(linha.inatividade_lembrete_min, INATIVIDADE_MIN_MIN, INATIVIDADE_MAX_MIN);
  const lembreteInvalido =
    linha.inatividade_lembrete_min != null &&
    linha.inatividade_lembrete_min !== '' &&
    lembrete === null;
  cfg.inatividadeAtiva =
    linha.inatividade_ativa === true &&
    encerrar !== null &&
    !lembreteInvalido &&
    (lembrete === null || lembrete < encerrar);
  if (encerrar !== null) cfg.encerrarMin = encerrar;
  cfg.lembreteMin = lembrete;
  return cfg;
}

// ── Relógio de parede de Brasília ────────────────────────────────────────────

const FORMATO_SP = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * Minutos desde a época no relógio de parede de São Paulo (não é UTC: 10h em
 * Brasília vira "10h" aqui). Comparar e somar nessa escala dispensa saber o
 * deslocamento do fuso em cada data.
 */
export function minutoDeParede(d: Date): number {
  const p: Record<string, string> = {};
  for (const x of FORMATO_SP.formatToParts(d)) p[x.type] = x.value;
  return (
    Date.UTC(
      Number(p.year),
      Number(p.month) - 1,
      Number(p.day),
      Number(p.hour) % 24,
      Number(p.minute)
    ) / 60000
  );
}

function ehFeriado(cfg: ConfigAutomacao, isoDia: string): boolean {
  return cfg.feriados.includes(isoDia) || cfg.feriados.includes(isoDia.slice(5));
}

// Intervalos abertos [início, fim) em minutos de parede, dos `dias` anteriores
// até hoje. Faixa com fim antes do início atravessa a meia-noite (22:00–02:00)
// e termina no dia seguinte; o feriado vale para o dia em que a faixa começa.
function intervalos(
  cfg: ConfigAutomacao,
  agoraParede: number,
  dias: number
): Array<[number, number]> {
  const hoje = Math.floor(agoraParede / 1440);
  const out: Array<[number, number]> = [];
  for (let k = -dias; k <= 0; k++) {
    const dia = hoje + k;
    const data = new Date(dia * 86400000);
    if (ehFeriado(cfg, data.toISOString().slice(0, 10))) continue;
    for (const [ini, fim] of cfg.horario[data.getUTCDay()] || []) {
      const a = minutosDaHora(ini) as number;
      const b = minutosDaHora(fim) as number;
      out.push([dia * 1440 + a, dia * 1440 + (b > a ? b : 1440 + b)]);
    }
  }
  return out;
}

/** Dentro do horário configurado? Horário desligado = sem restrição (sempre aberto). */
export function dentroDoExpediente(cfg: ConfigAutomacao, agora: Date): boolean {
  if (!cfg.horarioAtivo) return true;
  const t = minutoDeParede(agora);
  return intervalos(cfg, t, 1).some(([a, b]) => a <= t && t < b);
}

// Quantos dias para trás procurar o último fechamento. Duas semanas cobrem
// feriado prolongado e recesso; sem expediente nesse período, ver abaixo.
const DIAS_PARA_TRAS = 15;

/**
 * Manda o aviso de fora do expediente? Uma vez por JANELA fechada: a janela
 * começa quando o último expediente terminou (sexta 17h30, por exemplo) e vai
 * até o próximo abrir. Quem manda três mensagens no sábado recebe um aviso só;
 * quem volta a escrever na segunda à noite recebe de novo, porque houve
 * expediente no meio.
 *
 * Sem expediente nenhum nas últimas duas semanas (equipe que ligou o horário
 * sem marcar dias), a janela vira "a cada 24 horas" para o aviso não sumir de
 * vez nem repetir a cada mensagem.
 */
export function deveAvisarForaDoHorario(
  cfg: ConfigAutomacao,
  agora: Date,
  avisadoEm: string | null
): boolean {
  if (!cfg.horarioAtivo || dentroDoExpediente(cfg, agora)) return false;
  const avisado = avisadoEm ? Date.parse(avisadoEm) : NaN;
  if (!Number.isFinite(avisado)) return true;
  const t = minutoDeParede(agora);
  const fechamentos = intervalos(cfg, t, DIAS_PARA_TRAS)
    .map(([, fim]) => fim)
    .filter((fim) => fim <= t);
  const inicioDaJanela = fechamentos.length ? Math.max(...fechamentos) : t - 24 * 60;
  return minutoDeParede(new Date(avisado)) < inicioDaJanela;
}

// ── Pesquisa de satisfação (CSAT 1 a 5) ─────────────────────────────────────

const NOTA_TEXTO_MAX = 30;

const NOTA_POR_EXTENSO: Record<string, number> = {
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
};

// Palavras que aparecem em volta da nota e não mudam o que ela diz.
const PALAVRAS_DE_NOTA = new Set([
  'nota',
  'minha',
  'e',
  'eu',
  'dou',
  'daria',
  'de',
  'a',
  'o',
  'estrela',
  'estrelas',
  'ponto',
  'pontos',
  'avaliacao',
  'avalio',
  'obrigado',
  'obrigada',
  'valeu',
  'ok',
]);

function normalizar(t: string): string {
  return t
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Nota de 1 a 5 numa resposta, ou null quando não dá para ter certeza.
 *
 * Aceita "5", "nota 4", "4/5", "cinco", "5 estrelas", "⭐⭐⭐". Recusa o que
 * não é nota com certeza: texto longo (é a pessoa voltando a conversar), duas
 * notas ("4 ou 5"), número fora da escala ("10", "0") e qualquer palavra que
 * não seja de avaliação ("tenho 2 dúvidas"). Na dúvida, null: a mensagem segue
 * para a Caixa como conversa, que é pior perder do que uma nota.
 */
export function interpretarNota(bruto: string): number | null {
  const t = String(bruto ?? '').trim();
  if (!t || t.length > NOTA_TEXTO_MAX) return null;

  // Só estrelas (com o seletor de variação que o teclado do celular põe).
  const semEspaco = t.replace(/[\s️]/g, '');
  if (/^[⭐★🌟]+$/u.test(semEspaco)) {
    const n = [...semEspaco].length;
    return n >= 1 && n <= 5 ? n : null;
  }

  const fracao = /^([1-5])\s*\/\s*5$/.exec(t);
  if (fracao) return Number(fracao[1]);

  const tokens = normalizar(t).split(' ').filter(Boolean);
  const notas: number[] = [];
  for (const tok of tokens) {
    if (/^\d+$/.test(tok)) notas.push(Number(tok));
    else if (tok in NOTA_POR_EXTENSO) notas.push(NOTA_POR_EXTENSO[tok]);
    else if (!PALAVRAS_DE_NOTA.has(tok)) return null;
  }
  if (notas.length !== 1) return null;
  const n = notas[0];
  return n >= 1 && n <= 5 ? n : null;
}

export type EstadoAutomacao = {
  ultimaEm: string | null;
  foraHorarioEm: string | null;
  encerradaEm: string | null;
  pesquisaAte: string | null;
  pesquisaTeam: string | null;
  pesquisaOperador: string | null;
  lembreteEm: string | null;
};

export const ESTADO_AUTOMACAO_VAZIO: EstadoAutomacao = {
  ultimaEm: null,
  foraHorarioEm: null,
  encerradaEm: null,
  pesquisaAte: null,
  pesquisaTeam: null,
  pesquisaOperador: null,
  lembreteEm: null,
};

/**
 * A mensagem que acabou de chegar responde a pesquisa?
 *
 * Só a PRIMEIRA mensagem depois do encerramento conta, e só dentro do prazo:
 * com nota, grava e agradece; sem nota, a pesquisa morre ali (limpar = true) e
 * a mensagem segue como conversa normal. Esperar mais mensagens faria um "2"
 * dito dias depois, numa conversa nova, virar nota sem ninguém perceber.
 */
export function decidirNota(
  estado: EstadoAutomacao,
  textoMsg: string,
  agora: Date
): { nota: number | null; limpar: boolean } {
  if (!estado.pesquisaAte) return { nota: null, limpar: false };
  const ate = Date.parse(estado.pesquisaAte);
  if (!Number.isFinite(ate) || agora.getTime() > ate) return { nota: null, limpar: true };
  return { nota: interpretarNota(textoMsg), limpar: true };
}

// ── Saudação e aviso de fora do expediente ──────────────────────────────────

export type ContextoEntrada = {
  agora: Date;
  estado: EstadoAutomacao;
  // O número tem chamado aberto: é atendimento em curso, não conversa nova.
  chamadoAberto: boolean;
  // O menu de departamentos (bot.ts) já respondeu esta mensagem.
  botRespondeu: boolean;
};

// A pesquisa ainda espera resposta? O estado do webhook é lido ANTES de a
// pesquisa ser limpa, então uma mensagem que não virou nota (o "Sim" de quem
// respondeu a pergunta) ainda enxerga a pesquisa aberta aqui.
function pesquisaEmAberto(estado: EstadoAutomacao, agora: Date): boolean {
  const ate = estado.pesquisaAte ? Date.parse(estado.pesquisaAte) : NaN;
  return Number.isFinite(ate) && agora.getTime() <= ate;
}

function conversaNova(estado: EstadoAutomacao, agora: Date): boolean {
  const ultima = estado.ultimaEm ? Date.parse(estado.ultimaEm) : NaN;
  if (!Number.isFinite(ultima)) return true;
  if (agora.getTime() - ultima > SILENCIO_NOVA_CONVERSA_MS) return true;
  // Encerrada depois da última mensagem do número: o que chega agora é
  // atendimento novo, mesmo que o encerramento tenha sido há cinco minutos.
  const encerrada = estado.encerradaEm ? Date.parse(estado.encerradaEm) : NaN;
  return Number.isFinite(encerrada) && encerrada >= ultima;
}

/**
 * O que mandar depois de a mensagem estar gravada na caixa: saudação (só em
 * conversa nova, e só quando o menu do bot não falou primeiro) e o aviso de
 * fora do expediente (uma vez por janela fechada).
 */
export function decidirEntrada(
  cfg: ConfigAutomacao,
  ctx: ContextoEntrada
): { respostas: string[]; avisouForaHorario: boolean } {
  const respostas: string[] = [];
  if (
    cfg.saudacaoAtiva &&
    !ctx.botRespondeu &&
    !ctx.chamadoAberto &&
    // Resposta à pesquisa que não é nota ("Sim", "ótimo"): é o cliente
    // falando do atendimento que acabou de acabar, não um contato novo.
    // Saudar aí ("Recebemos sua mensagem…") soa como se ninguém tivesse lido.
    !pesquisaEmAberto(ctx.estado, ctx.agora) &&
    conversaNova(ctx.estado, ctx.agora)
  )
    respostas.push(cfg.textoSaudacao);
  const fora = deveAvisarForaDoHorario(cfg, ctx.agora, ctx.estado.foraHorarioEm);
  if (fora) respostas.push(cfg.textoForaHorario);
  return { respostas, avisouForaHorario: fora };
}

/**
 * Com o horário configurado pela equipe, o aviso fixo do bot (segunda a sexta,
 * 08h30–17h30) sai da resposta do menu: senão o cliente recebia dois avisos de
 * horário, e o fixo podia contradizer o configurado.
 */
export function semAvisoFixoDoBot(respostas: string[], cfg: ConfigAutomacao): string[] {
  return cfg.horarioAtivo ? respostas.filter((r) => r !== TEXTO_FORA_DO_HORARIO) : respostas;
}

// ── Encerramento ────────────────────────────────────────────────────────────

/**
 * Mensagens ao encerrar. Pela equipe: encerramento e pesquisa, conforme a
 * configuração. Por inatividade: só o aviso de encerramento por falta de
 * retorno — quem sumiu não vai avaliar, e a pesquisa ali seria só mais uma
 * mensagem saindo do número.
 */
export function mensagensDeEncerramento(
  cfg: ConfigAutomacao,
  motivo: 'equipe' | 'inatividade',
  protocolo: string | null = null
): { textos: string[]; pesquisa: boolean } {
  if (motivo === 'inatividade')
    return {
      textos: cfg.inatividadeAtiva ? [comProtocolo(cfg.textoInatividade, protocolo)] : [],
      pesquisa: false,
    };
  const textos: string[] = [];
  if (cfg.encerramentoAtivo) textos.push(comProtocolo(cfg.textoEncerramento, protocolo));
  if (cfg.pesquisaAtiva) textos.push(comProtocolo(cfg.textoPesquisa, protocolo));
  return { textos, pesquisa: cfg.pesquisaAtiva };
}

/**
 * Por que nada saiu no encerramento. A equipe clica em "Encerrar" e não vê
 * mensagem nenhuma: sem o motivo, "desligado nas configurações" e "o número
 * nunca escreveu para a equipe" parecem o mesmo defeito.
 */
export type MotivoSemEnvio =
  'sem_conversa' | 'outra_equipe' | 'desativado' | 'sem_credencial' | 'falhou';

/**
 * Troca {protocolo} pelo protocolo que o robô deu à conversa. Sem protocolo
 * (conversa que a equipe puxou, sem passar pelo menu), a linha que o cita sai
 * inteira em vez de mandar "Protocolo: " vazio ou a chave crua para o cliente.
 */
export function comProtocolo(texto: string, protocolo: string | null): string {
  const p = String(protocolo || '').trim();
  if (p) return texto.split('{protocolo}').join(p);
  return texto
    .split('\n')
    .filter((l) => !l.includes('{protocolo}'))
    .join('\n')
    .trim();
}

/**
 * Já encerrada depois da última mensagem do número? Então um segundo clique em
 * "Encerrar" (ou o encerramento local chegando antes do servidor) não manda as
 * mensagens de novo.
 */
export function jaEncerrada(estado: EstadoAutomacao): boolean {
  const encerrada = estado.encerradaEm ? Date.parse(estado.encerradaEm) : NaN;
  if (!Number.isFinite(encerrada)) return false;
  const ultima = estado.ultimaEm ? Date.parse(estado.ultimaEm) : NaN;
  return !Number.isFinite(ultima) || encerrada >= ultima;
}

export function pesquisaValidaAte(cfg: ConfigAutomacao, agora: Date): string {
  return new Date(agora.getTime() + cfg.pesquisaHoras * 3600_000).toISOString();
}

// ── Inatividade ─────────────────────────────────────────────────────────────

export type LinhaHistorico = {
  telefone: string | null;
  team: string | null;
  client_id?: string | null;
  de: string | null;
  direcao: string | null;
  status: string | null;
  recebido_em: string | null;
  pendencia_id?: string | null;
};

export type Parada = {
  telefone: string;
  team: string;
  clientId: string | null;
  ultimaSaidaEm: string;
};

/**
 * Conversas em que a ÚLTIMA palavra foi de uma pessoa da equipe — o cliente
 * está devendo resposta. Lê o histórico da caixa em vez de guardar estado à
 * parte: a resposta do operador já está lá (conversa-responder), e um carimbo
 * separado ficaria velho no primeiro caminho que esquecesse de atualizá-lo.
 *
 * Ficam de fora: nota interna (o cliente não viu), mensagem do robô (o
 * lembrete não reinicia o prazo), conversa já encerrada ou descartada e
 * conversa ligada a chamado (o chamado tem SLA e dono; encerrar por
 * inatividade ali diria ao cliente que o problema acabou).
 */
export function conversasParadas(linhas: LinhaHistorico[]): Parada[] {
  const porTelefone = new Map<string, LinhaHistorico[]>();
  for (const l of linhas) {
    const tel = String(l.telefone || '').replace(/\D/g, '');
    if (!tel) continue;
    if (!porTelefone.has(tel)) porTelefone.set(tel, []);
    porTelefone.get(tel)!.push(l);
  }
  const out: Parada[] = [];
  for (const [telefone, lista] of porTelefone) {
    const visiveis = lista
      .filter((l) => (l.direcao || 'entrada') !== 'interna')
      .sort((a, b) => String(b.recebido_em || '').localeCompare(String(a.recebido_em || '')));
    const daPessoa = visiveis.find(
      (l) => !((l.direcao || 'entrada') === 'saida' && l.de === AUTOR_AUTOMACAO)
    );
    if (!daPessoa || daPessoa.direcao !== 'saida' || !daPessoa.recebido_em) continue;
    const entrada = visiveis.find((l) => (l.direcao || 'entrada') === 'entrada');
    if (!entrada || !['pendente', 'anexado'].includes(String(entrada.status))) continue;
    if (entrada.pendencia_id) continue;
    out.push({
      telefone,
      team: daPessoa.team || entrada.team || 'init',
      clientId: entrada.client_id || null,
      ultimaSaidaEm: daPessoa.recebido_em,
    });
  }
  return out;
}

/**
 * Lembrar, encerrar ou esperar. Os dois prazos contam da última mensagem da
 * equipe; o lembrete sai uma vez por resposta da equipe (lembreteEm anterior a
 * ela não conta). Passado o prazo de encerrar, encerra mesmo sem lembrete —
 * o cron pode ter ficado parado, e esperar mais um ciclo não ajuda ninguém.
 */
export function decidirInatividade(
  cfg: ConfigAutomacao,
  ultimaSaidaEm: string,
  lembreteEm: string | null,
  agora: Date
): 'lembrar' | 'encerrar' | null {
  if (!cfg.inatividadeAtiva) return null;
  const saida = Date.parse(ultimaSaidaEm);
  if (!Number.isFinite(saida)) return null;
  const passou = agora.getTime() - saida;
  if (passou >= cfg.encerrarMin * 60_000) return 'encerrar';
  if (cfg.lembreteMin === null || passou < cfg.lembreteMin * 60_000) return null;
  const lembrado = lembreteEm ? Date.parse(lembreteEm) : NaN;
  return Number.isFinite(lembrado) && lembrado >= saida ? null : 'lembrar';
}
