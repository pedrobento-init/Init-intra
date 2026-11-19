// Automação do WhatsApp (leva 3): o lado que lê o banco e manda mensagem.
//
// A regra mora em automacao.ts; aqui só se executa o que ela decide. É usado
// pelo webhook (whatsapp/index.ts), pelo encerramento (conversa-encerrar) e
// pelo cron de inatividade (whatsapp-inatividade).
//
// Sem imports `npm:` (o vitest empacota quem importa este arquivo) e sem
// lançar: falha de automação vai para o log e NUNCA derruba a mensagem do
// cliente nem o encerramento feito pela equipe.
//
// BANCO SEM A 088 — whatsapp_automacao, whatsapp_avaliacoes e as colunas novas
// de whatsapp_conversas não existem. lerEstadoAutomacao devolve ok: false e
// quem chama pula a automação inteira; configDaEquipe devolve tudo desligado.

import { numeroEscreveuParaEquipe } from './equipes.ts';
import { enviarTexto, type CredenciaisWaha } from './provedor.ts';
import {
  AUTOR_AUTOMACAO,
  configDaLinha,
  configDesligada,
  type ConfigAutomacao,
  decidirEntrada,
  decidirNota,
  ESTADO_AUTOMACAO_VAZIO,
  type EstadoAutomacao,
  jaEncerrada,
  mensagensDeEncerramento,
  type MotivoSemEnvio,
  pesquisaValidaAte,
  semAvisoFixoDoBot,
} from './automacao.ts';

// O cliente do Supabase chega de três functions diferentes; o tipo de
// supabase-js viria de um import `npm:` que o vitest não resolve.
// deno-lint-ignore no-explicit-any
type Db = any;

const COLUNAS_ESTADO =
  'ultima_em, fora_horario_em, encerrada_em, pesquisa_ate, pesquisa_team, pesquisa_operador, inatividade_lembrete_em';

const CACHE_MS = 30_000;
const _cacheCfg = new Map<string, { em: number; cfg: ConfigAutomacao }>();

/**
 * Configuração da equipe, com cache curto: o webhook consulta duas vezes por
 * mensagem, e a tela de configuração não precisa valer no mesmo segundo.
 */
export async function configDaEquipe(db: Db, team: string | null): Promise<ConfigAutomacao> {
  const equipe = String(team || 'init');
  const guardada = _cacheCfg.get(equipe);
  if (guardada && Date.now() - guardada.em < CACHE_MS) return guardada.cfg;
  let cfg = configDesligada(equipe);
  try {
    const { data, error } = await db
      .from('whatsapp_automacao')
      .select('*')
      .eq('team', equipe)
      .maybeSingle();
    if (error)
      console.warn(
        'whatsapp automação: configuração indisponível (migration 088?):',
        error.message
      );
    else cfg = configDaLinha((data as Record<string, unknown> | null) || null, equipe);
  } catch (err) {
    console.error('whatsapp automação config:', (err as Error).message);
  }
  _cacheCfg.set(equipe, { em: Date.now(), cfg });
  return cfg;
}

/**
 * Estado da automação do número. Lido ANTES do upsert de ultima_em no webhook:
 * é a data antiga que diz se a conversa é nova.
 */
export async function lerEstadoAutomacao(
  db: Db,
  telefone: string
): Promise<{ ok: boolean; existe: boolean; estado: EstadoAutomacao }> {
  try {
    const { data, error } = await db
      .from('whatsapp_conversas')
      .select(COLUNAS_ESTADO)
      .eq('telefone', telefone)
      .maybeSingle();
    if (error) {
      console.warn('whatsapp automação: estado indisponível (migration 088?):', error.message);
      return { ok: false, existe: false, estado: ESTADO_AUTOMACAO_VAZIO };
    }
    const l = (data || {}) as Record<string, string | null>;
    return {
      ok: true,
      // Sem linha = o número nunca escreveu para a empresa (076): nada sai.
      existe: !!data,
      estado: {
        ultimaEm: l.ultima_em || null,
        foraHorarioEm: l.fora_horario_em || null,
        encerradaEm: l.encerrada_em || null,
        pesquisaAte: l.pesquisa_ate || null,
        pesquisaTeam: l.pesquisa_team || null,
        pesquisaOperador: l.pesquisa_operador || null,
        lembreteEm: l.inatividade_lembrete_em || null,
      },
    };
  } catch (err) {
    console.error('whatsapp automação estado:', (err as Error).message);
    return { ok: false, existe: false, estado: ESTADO_AUTOMACAO_VAZIO };
  }
}

async function gravarEstado(db: Db, telefone: string, patch: Record<string, unknown>) {
  const { error } = await db.from('whatsapp_conversas').update(patch).eq('telefone', telefone);
  if (error) console.error('whatsapp automação estado:', error.message);
}

/**
 * Manda os textos em ordem e grava cada um na conversa, como o bot faz
 * (direcao 'saida', autor "Atendimento automático"). Para no primeiro envio
 * que falha: mandar a pesquisa sem o aviso de encerramento antes confunde.
 * Devolve quantos saíram.
 */
export async function enviarDaAutomacao(
  db: Db,
  telefone: string,
  textos: string[],
  opcoes: { cred: CredenciaisWaha; team: string; clientId: string | null; status?: string }
): Promise<number> {
  // Toda mensagem automática fala em nome de uma equipe: só sai para número
  // que de fato escreveu para ela (whatsapp_conversa_equipes, gravada só pelo
  // webhook). O histórico da caixa não serve de prova: o operador grava ali.
  if ((await numeroEscreveuParaEquipe(db, telefone, opcoes.team)) !== true) {
    console.warn(
      `whatsapp automação ${telefone.slice(-4)}: número não escreveu para a equipe ${opcoes.team}, nada sai`
    );
    return 0;
  }
  let enviadas = 0;
  for (const texto of textos) {
    const envio = await enviarTexto(telefone, texto, opcoes.cred);
    if (!envio.ok) {
      console.error(`whatsapp automação ${telefone.slice(-4)}: envio falhou (${envio.erro})`);
      break;
    }
    enviadas++;
    const id = 'auto:' + crypto.randomUUID();
    // +ordem ms: duas mensagens no mesmo instante mantêm a ordem de envio.
    const agora = new Date(Date.now() + enviadas).toISOString();
    const { error } = await db.from('emails_triagem').insert({
      id,
      email_id: id,
      thread_id: 'whatsapp:' + telefone,
      message_id: envio.id || null,
      de: AUTOR_AUTOMACAO,
      assunto: AUTOR_AUTOMACAO,
      corpo: texto,
      recebido_em: agora,
      motivo: null,
      status: opcoes.status || 'anexado',
      pendencia_id: null,
      team: opcoes.team,
      tratado_por: AUTOR_AUTOMACAO,
      tratado_em: agora,
      client_id: opcoes.clientId,
      canal: 'whatsapp',
      telefone,
      direcao: 'saida',
      created_at: agora,
      updated_at: agora,
    });
    // A mensagem já saiu para o cliente: falha aqui só vai para o log.
    if (error) console.error('whatsapp automação histórico:', error.message);
  }
  return enviadas;
}

function temCredencial(cred: CredenciaisWaha): boolean {
  return !!cred.baseUrl && !!cred.apiKey;
}

export type NotaCapturada = { team: string; nota: number; cfg: ConfigAutomacao };

/**
 * Resposta da pesquisa de satisfação. Grava a avaliação e devolve a nota, ou
 * null quando a mensagem não é resposta da pesquisa — aí ela segue o caminho
 * normal da caixa, sem ser engolida.
 */
export async function notaDaMensagem(
  db: Db,
  telefone: string,
  texto: string,
  estado: EstadoAutomacao,
  agora: Date = new Date()
): Promise<NotaCapturada | null> {
  const d = decidirNota(estado, texto, agora);
  if (!d.limpar) return null;
  if (d.nota === null) {
    await gravarEstado(db, telefone, { pesquisa_ate: null });
    return null;
  }
  const team = estado.pesquisaTeam || 'init';
  const { error } = await db.from('whatsapp_avaliacoes').insert({
    team,
    telefone,
    thread_id: 'whatsapp:' + telefone,
    nota: d.nota,
    escala: 'csat',
    operador: estado.pesquisaOperador,
    respondida_em: agora.toISOString(),
  });
  if (error) {
    // Sem a avaliação gravada, a mensagem vai para a caixa como conversa:
    // perder o "5" é menos grave do que sumir com uma mensagem de verdade.
    console.error('whatsapp avaliação:', error.message);
    await gravarEstado(db, telefone, { pesquisa_ate: null });
    return null;
  }
  // encerrada_em de novo: a nota não reabre o atendimento, e a próxima
  // mensagem do número continua sendo conversa nova (saudação).
  await gravarEstado(db, telefone, { pesquisa_ate: null, encerrada_em: agora.toISOString() });
  return { team, nota: d.nota, cfg: await configDaEquipe(db, team) };
}

export async function agradecerNota(
  db: Db,
  telefone: string,
  capturada: NotaCapturada,
  cred: CredenciaisWaha
): Promise<void> {
  if (!temCredencial(cred)) return;
  await enviarDaAutomacao(db, telefone, [capturada.cfg.textoAgradecimento], {
    cred,
    team: capturada.team,
    clientId: null,
    status: 'encerrado',
  });
}

/** Tira o aviso fixo de horário do bot quando a equipe configurou o seu. */
export async function respostasDoBot(db: Db, team: string, respostas: string[]): Promise<string[]> {
  if (!respostas.length) return respostas;
  return semAvisoFixoDoBot(respostas, await configDaEquipe(db, team));
}

/** Saudação e aviso de fora do expediente, depois de a mensagem estar na caixa. */
export async function aposEntrada(
  db: Db,
  telefone: string,
  ctx: {
    team: string;
    clientId: string | null;
    estado: EstadoAutomacao;
    chamadoAberto: boolean;
    botRespondeu: boolean;
  },
  cred: CredenciaisWaha,
  agora: Date = new Date()
): Promise<number> {
  if (!temCredencial(cred)) return 0;
  const cfg = await configDaEquipe(db, ctx.team);
  const d = decidirEntrada(cfg, {
    agora,
    estado: ctx.estado,
    chamadoAberto: ctx.chamadoAberto,
    botRespondeu: ctx.botRespondeu,
  });
  if (!d.respostas.length) return 0;
  const enviadas = await enviarDaAutomacao(db, telefone, d.respostas, {
    cred,
    team: ctx.team,
    clientId: ctx.clientId,
  });
  // Só marca o aviso como dado se ele saiu de fato (é sempre o último da lista).
  if (d.avisouForaHorario && enviadas === d.respostas.length)
    await gravarEstado(db, telefone, { fora_horario_em: agora.toISOString() });
  return enviadas;
}

/**
 * Mensagens e estado do encerramento de uma conversa de WhatsApp. O status das
 * linhas da caixa é de quem chama (conversa-encerrar, cron), com o escopo de
 * equipe que cada um tem. Aqui: mandar encerramento/pesquisa e marcar
 * encerrada_em, que segura o envio repetido e faz a próxima mensagem ser
 * conversa nova.
 */
export async function encerrarPelaAutomacao(
  db: Db,
  p: {
    telefone: string;
    team: string;
    clientId: string | null;
    operador: string | null;
    motivo: 'equipe' | 'inatividade';
    cred: CredenciaisWaha;
  },
  agora: Date = new Date()
): Promise<{
  enviadas: number;
  pesquisa: boolean;
  repetido: boolean;
  motivo?: MotivoSemEnvio;
}> {
  const nada = (motivo: MotivoSemEnvio) => ({
    enviadas: 0,
    pesquisa: false,
    repetido: false,
    motivo,
  });
  const lido = await lerEstadoAutomacao(db, p.telefone);
  if (!lido.ok || !lido.existe) return nada('sem_conversa');
  // Equipe que o número nunca procurou não mexe no estado dele: encerrada_em e
  // a pesquisa são por telefone, e valeriam também para a equipe de verdade.
  if ((await numeroEscreveuParaEquipe(db, p.telefone, p.team)) !== true)
    return nada('outra_equipe');
  // Só o clique da equipe pode repetir (dois cliques, ou o status local chegando
  // antes). O cron não: ele só vê conversa ainda em aberto, e a equipe pode ter
  // encerrado e reaberto respondendo de novo, sem mensagem nova do cliente.
  if (p.motivo === 'equipe' && jaEncerrada(lido.estado))
    return { enviadas: 0, pesquisa: false, repetido: true };
  const cfg = await configDaEquipe(db, p.team);
  const { textos, pesquisa } = mensagensDeEncerramento(
    cfg,
    p.motivo,
    await protocoloDoNumero(db, p.telefone)
  );
  // encerrada_em é gravado mesmo sem mensagem: é ele que faz a próxima fala do
  // cliente ser conversa nova, esteja o aviso ligado ou não.
  const enviadas =
    textos.length && temCredencial(p.cred)
      ? await enviarDaAutomacao(db, p.telefone, textos, {
          cred: p.cred,
          team: p.team,
          clientId: p.clientId,
          status: 'encerrado',
        })
      : 0;
  // A pesquisa só fica esperando nota se ela saiu de verdade.
  const esperaNota = pesquisa && enviadas === textos.length && enviadas > 0;
  await gravarEstado(db, p.telefone, {
    encerrada_em: agora.toISOString(),
    inatividade_lembrete_em: null,
    pesquisa_ate: esperaNota ? pesquisaValidaAte(cfg, agora) : null,
    pesquisa_team: esperaNota ? p.team : null,
    pesquisa_operador: esperaNota ? p.operador : null,
  });
  const motivo: MotivoSemEnvio | null = !textos.length
    ? 'desativado'
    : !temCredencial(p.cred)
      ? 'sem_credencial'
      : enviadas < textos.length
        ? 'falhou'
        : null;
  return { enviadas, pesquisa: esperaNota, repetido: false, ...(motivo ? { motivo } : {}) };
}

/**
 * Protocolo que o robô deu à conversa (bot_protocolo, 085). Coluna ausente ou
 * erro de leitura = sem protocolo: o encerramento sai igual, só sem a linha.
 */
async function protocoloDoNumero(db: Db, telefone: string): Promise<string | null> {
  const { data, error } = await db
    .from('whatsapp_conversas')
    .select('bot_protocolo')
    .eq('telefone', telefone)
    .maybeSingle();
  if (error) return null;
  return String((data as { bot_protocolo?: string | null } | null)?.bot_protocolo || '') || null;
}
