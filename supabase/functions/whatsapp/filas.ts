// Filas do WhatsApp: departamento da conversa e distribuição automática.
//
// Só regra, sem rede e sem Deno (o vitest importa este arquivo direto, como o
// bot.ts). Quem lê e grava no banco é o distribuicao.ts; o webhook só chama.
//
// O MODELO — a conversa (um telefone numa equipe) está:
//   * com responsável, se alguma mensagem do cliente ainda aberta (pendente ou
//     anexada) tem atribuido_a. Conversa encerrada ou descartada fecha o ciclo:
//     a mensagem seguinte do mesmo número volta para a fila, em vez de cair
//     para sempre em quem atendeu da última vez (que pode até ter saído);
//   * na fila, se tem mensagem pendente e ninguém responsável.
// O rodízio só olha conversa na fila; conversa com responsável aberto
// continua com ele (as mensagens novas herdam o nome).

import { type Decisao, type EstadoBot, type Setor } from './bot.ts';

export const DEPARTAMENTOS: Setor[] = ['suporte', 'comercial', 'poiesis'];

// Quanto tempo depois do último sinal do app o operador ainda conta como
// online. O app manda sinal a cada minuto: três minutos absorvem um sinal
// perdido sem deixar o rodízio mandando conversa para quem fechou a aba.
export const ONLINE_JANELA_MS = 3 * 60 * 1000;

// Limite padrão de atendimentos simultâneos quando a equipe não configurou.
export const LIMITE_PADRAO = 5;

// Status de mensagem do cliente que ainda é atendimento em curso.
export const STATUS_ABERTOS = ['pendente', 'anexado'];

export type ConfigFila = {
  rodizio_ativo: boolean;
  limite_simultaneo: number | null;
};

export type Atendente = {
  operador: string;
  departamentos: string[] | null;
  limite: number | null;
  recebe_rodizio: boolean | null;
  disponivel: boolean | null;
  visto_em: string | null;
  ultima_atribuicao_em: string | null;
};

export type LinhaAberta = {
  telefone: string | null;
  atribuido_a: string | null;
  direcao?: string | null;
  status?: string | null;
};

export function departamentoValido(d: unknown): Setor | null {
  return DEPARTAMENTOS.includes(d as Setor) ? (d as Setor) : null;
}

/**
 * Departamento desta mensagem, pelo que o robô decidiu agora ou já tinha
 * decidido antes. null = não se sabe (robô desligado desde sempre, cliente que
 * não escolheu e foi para a triagem, ou ainda no menu).
 */
export function departamentoDaConversa(estado: EstadoBot, decisao: Decisao | null): Setor | null {
  if (decisao?.atribuicao) return departamentoValido(decisao.atribuicao.setor);
  // Menu enviado (conversa nova ou resposta que não deu para ler): a escolha
  // antiga não vale mais para esta conversa.
  if (decisao?.proximo) return null;
  return estado.etapa === 'atribuido' ? departamentoValido(estado.setor) : null;
}

/**
 * O cliente ainda está escolhendo no menu: distribuir agora mandaria a
 * conversa para alguém de um departamento que ele nem escolheu.
 */
export function conversaNoMenu(decisao: Decisao | null): boolean {
  return !!decisao && !decisao.atribuicao && decisao.proximo?.etapa === 'aguardando_setor';
}

function aberta(l: LinhaAberta): boolean {
  return (l.direcao || 'entrada') === 'entrada' && STATUS_ABERTOS.includes(String(l.status || ''));
}

/** Responsável do ciclo aberto da conversa, ou null se ela está na fila. */
export function responsavelAberto(linhas: LinhaAberta[]): string | null {
  for (const l of linhas || []) {
    const nome = String(l.atribuido_a || '').trim();
    if (nome && aberta(l)) return nome;
  }
  return null;
}

/**
 * Atendimentos abertos por operador: conversas distintas (telefone) com
 * mensagem do cliente ainda aberta atribuída a ele.
 */
export function contarAbertos(linhas: LinhaAberta[]): Record<string, number> {
  const vistos = new Set<string>();
  const out: Record<string, number> = {};
  for (const l of linhas || []) {
    const nome = String(l.atribuido_a || '').trim();
    const tel = String(l.telefone || '');
    if (!nome || !tel || !aberta(l)) continue;
    const chave = nome + '\u0000' + tel;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    out[nome] = (out[nome] || 0) + 1;
  }
  return out;
}

export function limiteDe(a: Atendente, config: ConfigFila | null): number {
  const proprio = Number(a.limite);
  if (Number.isFinite(proprio) && proprio >= 1) return proprio;
  const daEquipe = Number(config?.limite_simultaneo);
  return Number.isFinite(daEquipe) && daEquipe >= 1 ? daEquipe : LIMITE_PADRAO;
}

export function atendenteOnline(a: Atendente, agora: Date): boolean {
  if (!a.disponivel) return false;
  const visto = a.visto_em ? Date.parse(a.visto_em) : NaN;
  if (!Number.isFinite(visto)) return false;
  // visto_em vem do relógio do banco; um pouco à frente do da function dá
  // diferença negativa, que conta como online.
  return agora.getTime() - visto <= ONLINE_JANELA_MS;
}

/**
 * Atende o departamento? Lista vazia ou nula = atende todos; conversa sem
 * departamento vai para qualquer atendente da equipe.
 */
export function atendeDepartamento(a: Atendente, departamento: Setor | null): boolean {
  const lista = Array.isArray(a.departamentos) ? a.departamentos : [];
  if (!departamento || !lista.length) return true;
  return lista.includes(departamento);
}

/**
 * Rodízio: entre os atendentes online do departamento e abaixo do limite,
 * quem tem MENOS atendimentos abertos; empate vai para quem recebeu conversa
 * há mais tempo (nunca recebeu = primeiro), e por fim o nome, para a escolha
 * ser a mesma em duas execuções iguais. null = fica na fila.
 */
export function escolherAtendente(
  atendentes: Atendente[],
  opcoes: {
    departamento: Setor | null;
    config: ConfigFila | null;
    abertos: Record<string, number>;
    agora: Date;
  }
): string | null {
  const ultima = (a: Atendente) => {
    const t = a.ultima_atribuicao_em ? Date.parse(a.ultima_atribuicao_em) : NaN;
    return Number.isFinite(t) ? t : -Infinity;
  };
  const candidatos = (atendentes || [])
    .filter((a) => a && String(a.operador || '').trim())
    .filter((a) => a.recebe_rodizio !== false)
    .filter((a) => atendenteOnline(a, opcoes.agora))
    .filter((a) => atendeDepartamento(a, opcoes.departamento))
    .map((a) => ({ a, n: opcoes.abertos[a.operador] || 0 }))
    .filter(({ a, n }) => n < limiteDe(a, opcoes.config));
  candidatos.sort(
    (x, y) =>
      x.n - y.n || ultima(x.a) - ultima(y.a) || x.a.operador.localeCompare(y.a.operador, 'pt-BR')
  );
  return candidatos.length ? candidatos[0].a.operador : null;
}
