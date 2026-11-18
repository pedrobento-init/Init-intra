// Atendimento automático do WhatsApp: menu de departamentos e atribuição.
//
// Só regra, sem rede e sem Deno (o vitest importa este arquivo direto). O
// webhook (index.ts) lê o estado do número, chama decidirBot e executa o que
// ele devolve: enviar texto, gravar o novo estado, atribuir a conversa.
//
// POR QUE ELE É TOLERANTE: o menu antigo era "digite 1, 2 ou 3" e a pessoa
// digitava errado ("22", "12", "opção 2", "comercial"). Aqui o número é aceito
// em vários formatos, a palavra do departamento também, e o que não dá para
// entender nunca é adivinhado: pergunta de novo uma vez e, na segunda falha,
// entrega para um humano em vez de prender o cliente num laço.

export type Setor = 'suporte' | 'comercial' | 'poiesis';

export type Etapa = 'aguardando_setor' | 'atribuido';

export type EstadoBot = {
  etapa: Etapa | null;
  setor: Setor | null;
  tentativas: number;
  protocolo: string | null;
};

export type Decisao = {
  respostas: string[];
  // null = não mexe no estado do número.
  proximo: EstadoBot | null;
  // Presente quando a conversa acabou de ser atribuída (setor pode ser null:
  // foi para triagem humana depois de duas respostas que não deu para ler).
  atribuicao: { setor: Setor | null; protocolo: string } | null;
};

// Equipe que recebe a conversa de cada departamento. Comercial e Poiesis ainda
// não têm equipe própria configurada no Intra: caem na 'init' e a nota da
// atribuição diz qual departamento a pessoa escolheu. Quando as equipes
// existirem, é só trocar aqui.
export const EQUIPE_DO_SETOR: Record<Setor, string> = {
  suporte: 'init',
  comercial: 'init',
  poiesis: 'init',
};

export const ROTULO_DO_SETOR: Record<Setor, string> = {
  suporte: 'Suporte Técnico',
  comercial: 'Comercial',
  poiesis: 'Atendimento Poiesis',
};

const MENU =
  '1 - Suporte Técnico\n2 - Comercial\n3 - Atendimento Poiesis\n\nResponda apenas com o número do departamento.';

export const TEXTO_BOAS_VINDAS =
  'Bem-vindo a Init Net, para iniciar o seu atendimento escolha o departamento que deseja falar. ' +
  'Nosso atendimento é 100% humanizado e por isso o tempo de resposta pode variar um pouco, ' +
  'mas não se preocupe, todas as solicitações serão atendidas.\n\n' +
  MENU;

export const TEXTO_NAO_ENTENDI = 'Não consegui entender a sua resposta.\n\n' + MENU;

export function textoDirecionando(protocolo: string): string {
  return (
    'Estamos direcionando seu atendimento para o departamento responsável.\n\n' +
    `Seu protocolo é: ${protocolo}`
  );
}

export function textoTriagem(protocolo: string): string {
  return (
    'Não conseguimos identificar o departamento, então vamos encaminhar a sua conversa ' +
    'para um atendente.\n\n' +
    `Seu protocolo é: ${protocolo}`
  );
}

export const TEXTO_FORA_DO_HORARIO =
  'Nosso horário de atendimento é de segunda a sexta, das 08h30 às 17h30, ' +
  'com pausa para almoço das 12h às 13h. A sua mensagem ficou registrada e ' +
  'responderemos assim que voltarmos.';

// Passado esse tempo sem mensagem do número, a conversa é nova e o menu volta.
export const SILENCIO_NOVA_CONVERSA_MS = 12 * 60 * 60 * 1000;

// Depois de quantas respostas ilegíveis o bot desiste e passa para um humano.
export const TENTATIVAS_MAX = 2;

// Mensagem longa não é escolha de menu: é a pessoa já contando o problema.
const TEXTO_CURTO_MAX = 40;

function normalizar(texto: string): string {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// "um" fica de fora de propósito: em "quero um plano" é artigo, não opção 1.
// Só vale a resposta curta e inteira ("um", "opção dois"), ver interpretarSetor.
const NUMERO_POR_EXTENSO: Record<string, string> = {
  um: '1',
  uma: '1',
  dois: '2',
  duas: '2',
  tres: '3',
};

const PALAVRAS: Record<Setor, string[]> = {
  suporte: ['suporte', 'tecnico', 'tecnica', 'assistencia'],
  comercial: [
    'comercial',
    'vendas',
    'venda',
    'orcamento',
    'contratar',
    'plano',
    'planos',
    'comprar',
  ],
  poiesis: ['poiesis'],
};

const SETOR_DO_NUMERO: Record<string, Setor> = { '1': 'suporte', '2': 'comercial', '3': 'poiesis' };

/**
 * Departamento escolhido numa mensagem, ou null se não dá para ter certeza.
 *
 * Aceita "2", "2.", "2)", "opção 2", "dois" e a palavra do departamento
 * ("comercial", "vendas", "poiesis"). Recusa o que é ambíguo: "22", "12",
 * "1 e 2" ou uma frase que cita mais de um departamento.
 */
export function interpretarSetor(texto: string): Setor | null {
  const norm = normalizar(texto);
  if (!norm || norm.length > TEXTO_CURTO_MAX) return null;

  const bruto = norm.split(' ');
  const tokens = bruto.length <= 2 ? bruto.map((t) => NUMERO_POR_EXTENSO[t] ?? t) : bruto;

  const numeros = tokens.filter((t) => /^\d+$/.test(t));
  if (numeros.length > 1 && new Set(numeros).size > 1) return null;
  if (numeros.length >= 1) {
    const unico = numeros[0];
    // "22" e "12" são o erro de digitação que motivou o bot: não adivinha.
    return SETOR_DO_NUMERO[unico] ?? null;
  }

  const achados = (Object.keys(PALAVRAS) as Setor[]).filter((setor) =>
    PALAVRAS[setor].some((p) => tokens.includes(p))
  );
  return achados.length === 1 ? achados[0] : null;
}

// Protocolo legível: data + 4 dígitos (AAAAMMDD-NNNN). `sorteio` entra de fora
// para o teste não depender de acaso.
export function gerarProtocolo(agora: Date, sorteio: number = Math.random()): string {
  const partes = partesEmSaoPaulo(agora);
  const n = String(Math.floor(sorteio * 10000)).padStart(4, '0');
  return `${partes.ano}${partes.mes}${partes.dia}-${n}`;
}

function partesEmSaoPaulo(d: Date) {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(d)) p[x.type] = x.value;
  return {
    ano: p.year,
    mes: p.month,
    dia: p.day,
    hora: Number(p.hour),
    minuto: Number(p.minute),
    semana: p.weekday, // Mon..Sun
  };
}

/**
 * Segunda a sexta, 08h30–12h e 13h–17h30, no horário de Brasília. O Brasil não
 * tem mais horário de verão, então o fuso é fixo; a conta mesmo assim usa o
 * nome do fuso para não depender do fuso do servidor.
 */
export function emHorarioDeAtendimento(agora: Date): boolean {
  const p = partesEmSaoPaulo(agora);
  if (p.semana === 'Sat' || p.semana === 'Sun') return false;
  const min = p.hora * 60 + p.minuto;
  const manha = min >= 8 * 60 + 30 && min < 12 * 60;
  const tarde = min >= 13 * 60 && min < 17 * 60 + 30;
  return manha || tarde;
}

export const ESTADO_VAZIO: EstadoBot = {
  etapa: null,
  setor: null,
  tentativas: 0,
  protocolo: null,
};

function atribuir(
  setor: Setor | null,
  protocolo: string,
  agora: Date
): Pick<Decisao, 'respostas' | 'proximo' | 'atribuicao'> {
  const respostas = [setor ? textoDirecionando(protocolo) : textoTriagem(protocolo)];
  if (!emHorarioDeAtendimento(agora)) respostas.push(TEXTO_FORA_DO_HORARIO);
  return {
    respostas,
    proximo: { etapa: 'atribuido', setor, tentativas: 0, protocolo },
    atribuicao: { setor, protocolo },
  };
}

/**
 * O que fazer com a mensagem de um número que NÃO tem chamado aberto.
 *
 * @param estado       o que o bot gravou da última vez (ou ESTADO_VAZIO)
 * @param texto        corpo da mensagem (vazio se foi só mídia)
 * @param ultimaEm     quando o número falou pela última vez, antes desta mensagem
 * @param protocoloNovo protocolo a usar se esta mensagem concluir a atribuição
 */
export function decidirBot(
  estado: EstadoBot,
  texto: string,
  agora: Date,
  ultimaEm: string | null,
  protocoloNovo: string
): Decisao {
  const semResposta: Decisao = { respostas: [], proximo: null, atribuicao: null };
  const ultima = ultimaEm ? Date.parse(ultimaEm) : NaN;
  const conversaNova =
    !estado.etapa ||
    !Number.isFinite(ultima) ||
    agora.getTime() - ultima > SILENCIO_NOVA_CONVERSA_MS;

  if (!conversaNova && estado.etapa === 'atribuido') return semResposta;

  const setor = interpretarSetor(texto);

  if (conversaNova) {
    // Quem já responde o menu de cabeça ("2") ou escreve "comercial" no
    // primeiro contato não precisa ver o menu antes.
    if (setor) return { ...atribuir(setor, protocoloNovo, agora) };
    return {
      respostas: [TEXTO_BOAS_VINDAS],
      proximo: { etapa: 'aguardando_setor', setor: null, tentativas: 0, protocolo: null },
      atribuicao: null,
    };
  }

  // aguardando_setor
  if (setor) return { ...atribuir(setor, protocoloNovo, agora) };
  const tentativas = (estado.tentativas || 0) + 1;
  if (tentativas >= TENTATIVAS_MAX) return { ...atribuir(null, protocoloNovo, agora) };
  return {
    respostas: [TEXTO_NAO_ENTENDI],
    proximo: { etapa: 'aguardando_setor', setor: null, tentativas, protocolo: null },
    atribuicao: null,
  };
}

// Texto da nota que fica na entrada da caixa para quem for atender.
export function notaDaAtribuicao(setor: Setor | null, protocolo: string): string {
  return setor
    ? `Escolheu "${ROTULO_DO_SETOR[setor]}" no atendimento automático · protocolo ${protocolo}`
    : `Não escolheu departamento no atendimento automático · protocolo ${protocolo}`;
}
