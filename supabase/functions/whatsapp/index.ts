// Edge Function: whatsapp — webhook de entrada do WhatsApp (hoje, WAHA).
//
// O que faz com cada mensagem de texto que um cliente manda para o número da
// empresa:
//   * se o mesmo número tem chamado ABERTO (pendencias.email_thread_id =
//     "whatsapp:<dígitos>"), vira nota do solicitante nesse chamado e ganha uma
//     linha na caixa como 'anexado' — é a mesma conversa, e um chamado por
//     mensagem deixaria quem atende com vários pela metade;
//   * senão, entra na caixa de entrada (emails_triagem, canal 'whatsapp') para
//     alguém decidir. O webhook NÃO abre chamado sozinho: no WhatsApp chega
//     "bom dia", "obrigado" e foto de boleto, e abrir chamado para isso lotaria
//     a fila. Com cliente casado pelo telefone a linha já vem com a equipe e o
//     cliente; sem, vai como sem_cliente na equipe padrão.
//
// ATENDIMENTO AUTOMÁTICO (bot.ts) — com WHATSAPP_BOT_ATIVO=1, a mensagem de um
// número SEM chamado aberto recebe o menu de departamentos; a escolha atribui a
// conversa (equipe + nota com o protocolo) e o que não dá para ler vai para um
// humano depois de duas tentativas. Número com chamado aberto nunca recebe o
// menu: já é atendimento em curso. A resposta só sai DEPOIS de a mensagem estar
// gravada na caixa, e falha de envio só vai para o log.
//
// RECIBO E REAÇÃO (086) — os eventos message.ack e message.reaction do WAHA
// atualizam a linha da mensagem (achada pelo message_id): ✓/✓✓/lida na nossa
// resposta e o emoji de cada lado. Sem a 086 são ignorados, com aviso no log.
//
// FOTO — a foto de perfil do contato (WAHA) é guardada em whatsapp_conversas e
// copiada para a linha da caixa, e renovada a cada 24h (a URL do CDN expira).
// Sem a migration 085 nada disso roda e a mensagem entra normalmente.
//
// AUTENTICAÇÃO — auth "none" + token na query, e verify_jwt = false no
// config.toml. O WAHA não manda JWT do Supabase; o webhook usa o token na URL
// cadastrada no painel (…/whatsapp?token=…). O token é comparado em tempo
// constante com WHATSAPP_WEBHOOK_TOKEN; sem o segredo configurado, tudo é 401
// (fail-closed). A URL com token nunca vai para log.
//
// IDEMPOTÊNCIA — a WAHA pode reentregar o mesmo evento. A chave
// "whatsapp:<messageId>" em avisos_enviados (051) garante uma passagem por
// mensagem; o email_id UNIQUE da caixa (066) segura o resto. Quando a caixa é o
// único destino e o insert falha, a chave volta e a function responde 500 para
// a reentrega: repetir é melhor que perder a mensagem do cliente.
//
// CONFIGURAÇÃO (supabase secrets set):
//   WHATSAPP_WEBHOOK_TOKEN — o token que vai na URL do webhook no painel.
//   (o envio usa WAHA_BASE_URL, WAHA_API_KEY e WAHA_SESSION, mas só no
//   whatsapp-responder.)

import { type SupabaseContext, withSupabase } from 'npm:@supabase/server@1';
import { type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { type EmailEntrada, entradaDaCaixa, notaDoSolicitante } from '../robo/campo.ts';
import {
  assuntoDaMensagem,
  chaveTelefone,
  clienteDoTelefone,
  conversaDoTelefone,
  funcaoAusente,
  LIMITE_POR_MINUTO,
  LOTE_MAX,
  type MensagemWhats,
  PEN_FECHADOS,
  tempoConstante,
} from './mensagem.ts';
import {
  decidirBot,
  EQUIPE_DO_SETOR,
  ESTADO_VAZIO,
  type EstadoBot,
  gerarProtocolo,
  notaDaAtribuicao,
} from './bot.ts';
import {
  enviarTexto,
  eventosDeStatus,
  fotoDoContato,
  idCurto,
  mensagensDoWebhook,
  telefoneDoLid,
} from './provedor.ts';

type ClienteFone = {
  id: string;
  name: string;
  team?: string | null;
  technician?: string | null;
  owner_phone?: string | null;
  responsible_phone?: string | null;
};

type Aberto = {
  id: string;
  status: string;
  notes: unknown;
  client_id: string | null;
  team: string | null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Caminho antigo, só para banco sem a 077: lê clients inteiro.
async function todosOsClientes(db: SupabaseClient): Promise<ClienteFone[]> {
  const out: ClienteFone[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('clients')
      .select('id, name, team, technician, owner_phone, responsible_phone')
      .range(from, from + 999);
    if (error) throw new Error('clients: ' + error.message);
    out.push(...((data || []) as ClienteFone[]));
    if (!data || data.length < 1000) return out;
  }
}

// Candidatos pelo índice da 077; a regra de ambiguidade continua em
// clienteDoTelefone, que é a mesma testada no vitest.
async function clienteDaMensagem(
  db: SupabaseClient,
  telefone: string,
  cache: { todos: ClienteFone[] | null }
): Promise<ClienteFone | null> {
  const chave = chaveTelefone(telefone);
  if (!chave) return null;
  const { data, error } = await db.rpc('clientes_do_telefone', { p_chave: chave });
  if (!error) return clienteDoTelefone((data || []) as ClienteFone[], telefone);
  // Erro de verdade não derruba a mensagem: a chave de dedupe já foi gravada,
  // então um 500 aqui faria a reentrega ser ignorada e a mensagem sumir. Sem
  // cliente, ela ao menos chega na caixa para alguém escolher.
  if (!funcaoAusente(error)) {
    console.error('whatsapp clientes_do_telefone:', error.message);
    return null;
  }
  if (!cache.todos) {
    console.warn('whatsapp: migration 077 não aplicada, casando cliente pela tabela inteira');
    cache.todos = await todosOsClientes(db);
  }
  return clienteDoTelefone(cache.todos, telefone);
}

// Soma a nota no chamado. Com a 077 é um UPDATE só no banco (sem corrida entre
// duas mensagens do mesmo número); sem ela, o ler-e-regravar antigo. Nos dois,
// filtra por id E pelo team lido: se o chamado mudou de equipe no meio, não
// grava em vez de gravar no escopo errado — e aí a mensagem segue para a caixa
// como pedido novo, em vez de sumir.
type Anexo = { ok: true } | { ok: false; naoAchou: boolean; erro: string };
async function anexarNota(db: SupabaseClient, aberto: Aberto, nota: unknown): Promise<Anexo> {
  const { data, error } = await db.rpc('append_pendencia_note', {
    p_id: aberto.id,
    p_team: aberto.team,
    p_nota: nota,
  });
  if (!error)
    return data === true
      ? { ok: true }
      : { ok: false, naoAchou: true, erro: 'chamado mudou de equipe ou sumiu' };
  if (!funcaoAusente(error)) return { ok: false, naoAchou: false, erro: error.message };
  console.warn('whatsapp: migration 077 não aplicada, anexando nota por ler-e-regravar');
  const anteriores = Array.isArray(aberto.notes) ? aberto.notes : [];
  let q = db
    .from('pendencias')
    .update({ notes: [...anteriores, nota], updated_at: new Date().toISOString() })
    .eq('id', aberto.id);
  q = aberto.team == null ? q.is('team', null) : q.eq('team', aberto.team);
  const { error: erroUpdate } = await q;
  return erroUpdate ? { ok: false, naoAchou: false, erro: erroUpdate.message } : { ok: true };
}

// Quantas mensagens deste número entraram na caixa no último minuto. Usa o
// índice (telefone, recebido_em) da 075. Erro de leitura não segura a
// mensagem: o limite protege a fila, não é controle de acesso.
async function recentesDoNumero(db: SupabaseClient, telefone: string): Promise<number> {
  const desde = new Date(Date.now() - 60_000).toISOString();
  const contar = (soEntrada: boolean) => {
    let q = db
      .from('emails_triagem')
      .select('id', { count: 'exact', head: true })
      .eq('telefone', telefone);
    // Só o que o número mandou: resposta nossa e nota interna gravam o mesmo
    // telefone, e um operador respondendo rápido derrubava a mensagem seguinte
    // do cliente como se fosse rajada.
    if (soEntrada) q = q.eq('direcao', 'entrada');
    return q.gte('recebido_em', desde);
  };
  let { count, error } = await contar(true);
  // Banco sem a 082 não tem `direcao`: o erro seria permanente e desligaria o
  // limite. Sem a coluna também não há resposta pelo portal, então contar tudo
  // dá o mesmo número.
  if (error && colunaDoPortalAusente(error)) ({ count, error } = await contar(false));
  if (error) {
    console.error('whatsapp limite:', error.message);
    return 0;
  }
  return count || 0;
}

// Fechado não conta: mensagem depois de concluir é pedido novo, e ressuscitar
// o chamado antigo esconderia isso do SLA e da fila.
//
// Sem filtro de team de propósito: a equipe só se sabe depois de casar o
// cliente, e o mesmo número pode ter chamado aberto em qualquer equipe. O
// update da nota filtra por id + team lidos aqui.
async function chamadoDaConversa(db: SupabaseClient, conversa: string): Promise<Aberto | null> {
  if (!conversa) return null;
  const { data, error } = await db
    .from('pendencias')
    .select('id, status, notes, client_id, team')
    .eq('email_thread_id', conversa)
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) {
    console.error('whatsapp conversa:', error.message);
    return null;
  }
  return ((data || []) as Aberto[]).find((p) => !PEN_FECHADOS.includes(String(p.status))) || null;
}

// A mensagem no formato que os helpers da caixa (robo/campo.ts) já entendem.
function entradaDe(m: MensagemWhats): EmailEntrada {
  return {
    id: 'whatsapp:' + m.id,
    de: m.nome || '+' + m.telefone,
    assunto: assuntoDaMensagem(m.texto),
    data: m.quando,
    trecho: m.texto,
    message_id: m.id,
    thread_id: conversaDoTelefone(m.telefone),
  };
}

// Banco sem a 075 falha aqui (coluna canal/telefone não existe): o erro fica no
// log e a nota, se houve, já está salva. A chave de dedupe NÃO volta, pelo
// mesmo motivo do robô: reentrega repetiria o erro para sempre.
async function baixarMidia(m: MensagemWhats) {
  if (!m.media) return null;
  try {
    const base = Deno.env.get('WAHA_BASE_URL') || '';
    const key = Deno.env.get('WAHA_API_KEY') || '';
    const raiz = new URL(base);
    const origem = new URL(m.media.url);
    // `//host` no pathname do anexo resolveria como URL protocol-relative e
    // mandaria a X-Api-Key para outro host. O host do download é sempre o da
    // WAHA; o resto é recusado antes do fetch.
    const url = new URL(origem.pathname.replace(/^\/+/, '/') + origem.search, raiz);
    if (url.origin !== raiz.origin) {
      console.error(`whatsapp mídia ${m.id}: host fora da WAHA, download ignorado`);
      return null;
    }
    const resp = await fetch(url.toString(), {
      headers: { 'X-Api-Key': key },
      signal: AbortSignal.timeout(20000),
    });
    const tamanho = Number(resp.headers.get('content-length') || 0);
    if (!resp.ok || tamanho > 5 * 1024 * 1024) return null;
    const bytes = new Uint8Array(await resp.arrayBuffer());
    if (bytes.length > 5 * 1024 * 1024) return null;
    let binario = '';
    for (let i = 0; i < bytes.length; i += 32768)
      binario += String.fromCharCode(...bytes.subarray(i, i + 32768));
    return { nome: m.media.nome, tipo: m.media.tipo, dados: btoa(binario) };
  } catch (err) {
    console.error(`whatsapp mídia ${m.id}:`, (err as Error).message);
    return null;
  }
}

// Banco sem a 082 não tem direcao/media. O PostgREST recusa o insert inteiro
// (PGRST204, coluna fora do schema cache) e o Postgres direto devolve 42703:
// sem o retry, a mensagem sumiria da caixa por causa de uma coluna que é só do
// portal. O histórico do portal fica para quando a migration rodar.
function colunaDoPortalAusente(error: { code?: string; message?: string }): boolean {
  if (error.code === '42703' || error.code === 'PGRST204') return true;
  const msg = error.message || '';
  return /(direcao|media|foto_url)/.test(msg) && /does not exist|schema cache/i.test(msg);
}

async function guardarNaCaixa(
  db: SupabaseClient,
  m: MensagemWhats,
  opcoes: {
    motivo?: string | null;
    status?: string;
    pendenciaId?: string | null;
    clientId?: string | null;
    team?: string | null;
  },
  extra: { foto_url?: string | null; atribuicao_nota?: string | null } = {}
): Promise<boolean> {
  const comCitacao = {
    ...entradaDaCaixa(entradaDe(m), opcoes, 'ETR-' + crypto.randomUUID()),
    canal: 'whatsapp',
    telefone: m.telefone,
    direcao: 'entrada',
    media: await baixarMidia(m),
    ...(extra.foto_url ? { foto_url: extra.foto_url } : {}),
    ...(extra.atribuicao_nota ? { atribuicao_nota: extra.atribuicao_nota } : {}),
    ...(m.citacao ? { citacao: m.citacao } : {}),
  };
  let { error } = await db.from('emails_triagem').insert(comCitacao);
  if (!error || error.code === '23505') return true;
  // Só a 086 falta: a mensagem entra sem a citação.
  const { citacao: _citacao, ...linha } = comCitacao;
  if (m.citacao && /citacao/.test(error.message || '')) {
    console.warn(`whatsapp caixa ${m.id}: migration 086 não aplicada, gravando sem citação`);
    ({ error } = await db.from('emails_triagem').insert(linha));
    if (!error || error.code === '23505') return true;
  }
  // Só a 085 falta: tira a foto e mantém direcao/media, que são da 082.
  if (linha.foto_url && /foto_url/.test(error.message || '')) {
    const { foto_url: _foto, ...semFoto } = linha;
    console.warn(`whatsapp caixa ${m.id}: migration 085 não aplicada, gravando sem foto`);
    ({ error } = await db.from('emails_triagem').insert(semFoto));
    if (!error || error.code === '23505') return true;
  }
  if (colunaDoPortalAusente(error)) {
    console.warn(`whatsapp caixa ${m.id}: migration 082 não aplicada, gravando sem direcao/media`);
    const { direcao: _direcao, media: _media, ...semPortal } = linha;
    let { error: erroAntigo } = await db.from('emails_triagem').insert(semPortal);
    if (!erroAntigo || erroAntigo.code === '23505') return true;
    // Banco antigo de verdade, sem 082 nem 085: a foto também fica de fora.
    if (semPortal.foto_url && /foto_url/.test(erroAntigo.message || '')) {
      const { foto_url: _foto, ...semNada } = semPortal;
      ({ error: erroAntigo } = await db.from('emails_triagem').insert(semNada));
      if (!erroAntigo || erroAntigo.code === '23505') return true;
    }
    console.error(`whatsapp caixa ${m.id} (a mensagem NÃO apareceu na caixa):`, erroAntigo.message);
    return false;
  }
  console.error(`whatsapp caixa ${m.id} (a mensagem NÃO apareceu na caixa):`, error.message);
  return false;
}

// Autor das mensagens que o robô manda. A Caixa reconhece este nome para
// marcar o balão; é também o filtro de quem acompanha a conversa na atribuição.
const AUTOR_BOT = 'Atendimento automático';

// Grava na conversa o que o robô acabou de mandar. Sem isso quem atende vê só
// o "1" do cliente e não sabe a que ele estava respondendo. Mesmo formato da
// resposta do operador (conversa-responder): direcao 'saida', status 'anexado'.
// Falha só vai para o log: a mensagem já saiu para o cliente.
async function registrarMensagemDoBot(
  db: SupabaseClient,
  m: MensagemWhats,
  texto: string,
  extra: { team: string; clientId: string | null; providerId?: string; ordem: number }
): Promise<void> {
  const id = 'bot:' + crypto.randomUUID();
  // +ordem ms: duas mensagens do robô no mesmo instante mantêm a ordem de envio.
  const agora = new Date(Date.now() + extra.ordem).toISOString();
  const { error } = await db.from('emails_triagem').insert({
    id,
    email_id: id,
    thread_id: conversaDoTelefone(m.telefone),
    message_id: extra.providerId || null,
    de: AUTOR_BOT,
    assunto: AUTOR_BOT,
    corpo: texto,
    recebido_em: agora,
    motivo: null,
    status: 'anexado',
    pendencia_id: null,
    team: extra.team,
    tratado_por: AUTOR_BOT,
    tratado_em: agora,
    client_id: extra.clientId,
    canal: 'whatsapp',
    telefone: m.telefone,
    direcao: 'saida',
    created_at: agora,
    updated_at: agora,
  });
  if (error) console.error(`whatsapp bot histórico ${m.id}:`, error.message);
}

type LinhaConversa = {
  ultima_em: string | null;
  bot_etapa: string | null;
  bot_setor: string | null;
  bot_tentativas: number | null;
  bot_protocolo: string | null;
  foto_url: string | null;
  foto_em: string | null;
};

const FOTO_VALIDADE_MS = 24 * 60 * 60 * 1000;

// Lê o estado do número ANTES do upsert de ultima_em: é essa data antiga que
// diz se a conversa é nova. `ok: false` = banco sem a 085; o bot e a foto
// ficam desligados para a mensagem, que entra na caixa do mesmo jeito.
async function lerConversa(
  db: SupabaseClient,
  telefone: string
): Promise<{ ok: boolean; linha: LinhaConversa | null }> {
  const { data, error } = await db
    .from('whatsapp_conversas')
    .select('ultima_em, bot_etapa, bot_setor, bot_tentativas, bot_protocolo, foto_url, foto_em')
    .eq('telefone', telefone)
    .maybeSingle();
  if (error) {
    console.warn('whatsapp: estado do bot indisponível (migration 085?):', error.message);
    return { ok: false, linha: null };
  }
  return { ok: true, linha: (data as LinhaConversa | null) || null };
}

function estadoDe(l: LinhaConversa | null): EstadoBot {
  if (!l || !l.bot_etapa) return ESTADO_VAZIO;
  return {
    etapa: l.bot_etapa === 'atribuido' ? 'atribuido' : 'aguardando_setor',
    setor: (l.bot_setor as EstadoBot['setor']) || null,
    tentativas: Number(l.bot_tentativas) || 0,
    protocolo: l.bot_protocolo || null,
  };
}

// Renova a foto no máximo uma vez por dia por número. Devolve a URL a usar
// (a nova, ou a que já estava guardada se a WAHA não respondeu).
async function fotoAtual(
  db: SupabaseClient,
  telefone: string,
  linha: LinhaConversa | null,
  cred: { baseUrl: string; apiKey: string; session: string }
): Promise<string | null> {
  const guardada = linha?.foto_url || null;
  if (!cred.baseUrl || !cred.apiKey) return guardada;
  const em = linha?.foto_em ? Date.parse(linha.foto_em) : NaN;
  if (Number.isFinite(em) && Date.now() - em < FOTO_VALIDADE_MS) return guardada;
  const nova = (await fotoDoContato(telefone, cred)) || null;
  const { error } = await db
    .from('whatsapp_conversas')
    .update({ foto_url: nova, foto_em: new Date().toISOString() })
    .eq('telefone', telefone);
  if (error) console.warn('whatsapp foto:', error.message);
  return nova;
}

// Recibos e reações. Cada um é um UPDATE pelo message_id; o id pode estar
// gravado inteiro ou só o final, por isso o `in`. Sem linha (mensagem mandada
// pelo celular, fora do Intra) o update não acha nada, e está tudo certo.
// Nunca lança: recibo perdido é só um ✓ a menos na tela.
async function aplicarStatus(
  db: SupabaseClient,
  payload: unknown
): Promise<{ recibos: number; reacoes: number }> {
  const { recibos, reacoes } = eventosDeStatus(payload);
  let nRecibos = 0,
    nReacoes = 0;
  const agora = new Date().toISOString();
  for (const r of recibos) {
    // Só avança: o trigger da 086 garante isso, e o filtro evita mexer no
    // updated_at (e redesenhar a tela de todo mundo) com recibo repetido.
    const teto = r.ack === -1 ? 2 : r.ack;
    const { error } = await db
      .from('emails_triagem')
      .update({ ack: r.ack, updated_at: agora })
      .eq('canal', 'whatsapp')
      .eq('direcao', 'saida')
      .in('message_id', [r.id, idCurto(r.id)])
      .or(`ack.is.null,ack.lt.${teto}`);
    if (error) console.warn('whatsapp recibo (migration 086?):', error.message);
    else nRecibos++;
  }
  for (const x of reacoes) {
    const coluna = x.deMim ? 'reacao_equipe' : 'reacao_contato';
    const { error } = await db
      .from('emails_triagem')
      .update({ [coluna]: x.emoji || null, updated_at: agora })
      .eq('canal', 'whatsapp')
      .in('message_id', [x.alvo, idCurto(x.alvo)]);
    if (error) console.warn('whatsapp reação (migration 086?):', error.message);
    else nReacoes++;
  }
  return { recibos: nRecibos, reacoes: nReacoes };
}

async function handle(req: Request, ctx: SupabaseContext) {
  if (req.method !== 'POST') return json({ ok: false }, 405);
  const esperado = Deno.env.get('WHATSAPP_WEBHOOK_TOKEN') || '';
  const recebido = new URL(req.url).searchParams.get('token') || '';
  if (!esperado || !recebido || !tempoConstante(recebido, esperado))
    return json({ ok: false }, 401);

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }
  // Evento que não é mensagem (recibo, reação, presença) responde 200: erro
  // faria a WAHA reentregar algo que não tem como dar certo depois.
  const todas = mensagensDoWebhook(payload);
  if (!todas.length) {
    const status = await aplicarStatus(ctx.supabaseAdmin, payload);
    return json({ ok: true, notas: 0, caixa: 0, sem_cliente: 0, limitadas: 0, ...status });
  }
  if (todas.length > LOTE_MAX)
    console.warn(`whatsapp: lote de ${todas.length} mensagens, tratando só ${LOTE_MAX}`);
  const msgs = todas.slice(0, LOTE_MAX);

  const db = ctx.supabaseAdmin;
  try {
    let notas = 0,
      caixa = 0,
      semCliente = 0,
      limitadas = 0,
      bot = 0;
    const cache: { todos: ClienteFone[] | null } = { todos: null };
    const credWaha = {
      baseUrl: Deno.env.get('WAHA_BASE_URL') || '',
      apiKey: Deno.env.get('WAHA_API_KEY') || '',
      session: Deno.env.get('WAHA_SESSION') || 'default',
    };
    for (const m of msgs) {
      const key = 'whatsapp:' + m.id;
      const { error: erroChave } = await db.from('avisos_enviados').insert({ key });
      if (erroChave) {
        if (erroChave.code === '23505') continue;
        throw new Error('avisos_enviados: ' + erroChave.message);
      }

      // O remetente pode vir como LID (ID interno do WhatsApp, "...@lid"): vira
      // telefone antes de o número servir de chave de conversa, de limite e de
      // casamento com cliente. Sem conversão (contato que esconde o telefone), a
      // mensagem entra na caixa mesmo assim, só que sem resposta automática,
      // porque não há telefone para quem responder.
      let telefoneConfirmado = true;
      if (m.lid) {
        const fone = await telefoneDoLid(m.lid, credWaha);
        if (fone) m.telefone = fone;
        else {
          m.telefone = m.lid.replace(/\D/g, '');
          telefoneConfirmado = false;
          console.warn(`whatsapp ${m.id}: LID sem telefone conhecido, entra na caixa sem robô`);
        }
      }

      // Depois da chave de dedupe: reentrega da mesma mensagem não conta duas
      // vezes, e a descartada aqui não volta numa reentrega.
      if ((await recentesDoNumero(db, m.telefone)) >= LIMITE_POR_MINUTO) {
        limitadas++;
        console.warn(
          `whatsapp: ${m.id} descartada, número passou de ${LIMITE_POR_MINUTO} mensagens por minuto`
        );
        continue;
      }

      const estadoLido = await lerConversa(db, m.telefone);

      // Prova, gravada só pelo servidor, de que este número falou com a empresa:
      // o whatsapp-responder recusa enviar para quem não está aqui (076). Falha
      // não segura a mensagem — o pior caso é a resposta ser recusada depois.
      const { error: erroConversa } = await db
        .from('whatsapp_conversas')
        .upsert(
          { telefone: m.telefone, ultima_em: new Date().toISOString() },
          { onConflict: 'telefone' }
        );
      if (erroConversa) console.error(`whatsapp conversa ${m.id}:`, erroConversa.message);

      const foto = estadoLido.ok
        ? await fotoAtual(db, m.telefone, estadoLido.linha, credWaha)
        : null;

      const aberto = await chamadoDaConversa(db, conversaDoTelefone(m.telefone));
      if (aberto) {
        const anexo = await anexarNota(db, aberto, notaDoSolicitante(entradaDe(m)));
        if (anexo.ok) {
          notas++;
          if (
            await guardarNaCaixa(
              db,
              m,
              {
                status: 'anexado',
                pendenciaId: aberto.id,
                clientId: aberto.client_id,
                team: aberto.team || 'init',
              },
              { foto_url: foto }
            )
          )
            caixa++;
          continue;
        }
        console.error(`whatsapp nota ${m.id}:`, anexo.erro);
        if (!anexo.naoAchou) {
          await db.from('avisos_enviados').delete().eq('key', key); // tenta de novo na reentrega
          continue;
        }
      }

      const c = await clienteDaMensagem(db, m.telefone, cache);
      if (!c) semCliente++;
      const opcoesCaixa = c
        ? { motivo: null, status: 'pendente', clientId: c.id, team: c.team || 'init' }
        : { motivo: 'sem_cliente', status: 'pendente', team: 'init' };

      // Atendimento automático: só com o secret ligado, só com o estado do
      // número legível e só com como responder (credenciais da WAHA).
      const agora = new Date();
      const botLigado =
        Deno.env.get('WHATSAPP_BOT_ATIVO') === '1' &&
        estadoLido.ok &&
        telefoneConfirmado &&
        !!credWaha.baseUrl &&
        !!credWaha.apiKey;
      const decisao = botLigado
        ? decidirBot(
            estadoDe(estadoLido.linha),
            m.texto,
            agora,
            estadoLido.linha?.ultima_em || null,
            gerarProtocolo(agora)
          )
        : null;
      const atrib = decisao?.atribuicao || null;
      // Suporte de cliente conhecido segue a equipe dele; os demais
      // departamentos têm a equipe definida em EQUIPE_DO_SETOR.
      const equipe = atrib?.setor
        ? atrib.setor === 'suporte' && c?.team
          ? c.team
          : EQUIPE_DO_SETOR[atrib.setor]
        : opcoesCaixa.team;
      const nota = atrib ? notaDaAtribuicao(atrib.setor, atrib.protocolo) : null;

      const ok = await guardarNaCaixa(
        db,
        m,
        atrib ? { ...opcoesCaixa, team: equipe } : opcoesCaixa,
        { foto_url: foto, atribuicao_nota: nota }
      );
      if (!ok) {
        // Sem chamado, a caixa é o único lugar onde a mensagem existiria.
        // Devolver a chave e falhar faz a WAHA reentregar; repetir é melhor que
        // a mensagem sumir sem ninguém ver.
        await db.from('avisos_enviados').delete().eq('key', key);
        throw new Error('whatsapp: mensagem ' + m.id + ' não entrou na caixa');
      }

      if (decisao && (decisao.respostas.length || decisao.proximo)) {
        // As mensagens que o cliente mandou antes de escolher (o "oi") ficaram
        // na equipe padrão: acompanham a atribuição. updated_at é obrigatório,
        // é por ele que o app dos operadores percebe a mudança.
        if (atrib && equipe !== opcoesCaixa.team) {
          const { error: erroMover } = await db
            .from('emails_triagem')
            .update({ team: equipe, atribuicao_nota: nota, updated_at: agora.toISOString() })
            .eq('canal', 'whatsapp')
            .eq('telefone', m.telefone)
            .eq('direcao', 'entrada')
            .eq('status', 'pendente')
            .eq('team', opcoesCaixa.team);
          if (erroMover) console.error(`whatsapp atribuição ${m.id}:`, erroMover.message);
          // O menu que o robô mandou antes da escolha fica com a conversa.
          const { error: erroBot } = await db
            .from('emails_triagem')
            .update({ team: equipe, updated_at: agora.toISOString() })
            .eq('canal', 'whatsapp')
            .eq('telefone', m.telefone)
            .eq('direcao', 'saida')
            .eq('de', AUTOR_BOT)
            .eq('team', opcoesCaixa.team);
          if (erroBot) console.error(`whatsapp atribuição bot ${m.id}:`, erroBot.message);
        } else if (atrib) {
          const { error: erroNota } = await db
            .from('emails_triagem')
            .update({ atribuicao_nota: nota, updated_at: agora.toISOString() })
            .eq('canal', 'whatsapp')
            .eq('telefone', m.telefone)
            .eq('direcao', 'entrada')
            .eq('status', 'pendente')
            .eq('team', opcoesCaixa.team);
          if (erroNota) console.error(`whatsapp atribuição ${m.id}:`, erroNota.message);
        }
        let enviou = !decisao.respostas.length;
        for (const [ordem, texto] of decisao.respostas.entries()) {
          const envio = await enviarTexto(m.telefone, texto, credWaha);
          if (!envio.ok) {
            console.error(`whatsapp bot ${m.id}: envio falhou (${envio.erro})`);
            break;
          }
          enviou = true;
          await registrarMensagemDoBot(db, m, texto, {
            team: atrib ? equipe : opcoesCaixa.team,
            clientId: c ? c.id : null,
            providerId: envio.id,
            ordem: ordem + 1,
          });
        }
        // Sem envio e sem atribuição, o estado não avança: a próxima mensagem
        // do cliente tenta mandar o menu de novo.
        if (decisao.proximo && (enviou || atrib)) {
          const e = decisao.proximo;
          const { error: erroEstado } = await db
            .from('whatsapp_conversas')
            .update({
              bot_etapa: e.etapa,
              bot_setor: e.setor,
              bot_tentativas: e.tentativas,
              bot_protocolo: e.protocolo,
              bot_em: agora.toISOString(),
            })
            .eq('telefone', m.telefone);
          if (erroEstado) console.error(`whatsapp bot estado ${m.id}:`, erroEstado.message);
        }
        bot++;
      }
      caixa++;
    }
    return json({ ok: true, notas, caixa, sem_cliente: semCliente, limitadas, bot });
  } catch (err) {
    // 500 faz a WAHA reentregar; a chave de dedupe impede processar duas vezes
    // o que já passou.
    console.error('whatsapp:', (err as Error).message);
    return json({ ok: false }, 500);
  }
}

export default { fetch: withSupabase({ auth: 'none' }, handle) };
