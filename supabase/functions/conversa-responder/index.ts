// Resposta e nota interna de uma conversa da caixa, sem exigir chamado.
// O destino sai da última mensagem recebida no thread, nunca do navegador.
//
// Além de responder e anotar (kind 'reply' | 'internal'), no WhatsApp:
//   * reply_to — id da linha citada; a resposta sai como "responder" no
//     WhatsApp e a citação fica gravada (086);
//   * kind 'reaction' — reage a uma mensagem da conversa (emoji '' tira);
//   * kind 'seen' — marca a conversa como lida no celular do cliente.
// Em todos, a linha alvo é procurada DENTRO do thread que o operador enxerga:
// o id que vem do navegador nunca aponta para conversa de outra equipe.
//
// LIMITE CONHECIDO — no e-mail não existe prova de contato como a
// whatsapp_conversas (076). O destino sai da última mensagem de entrada, mas
// quem pode inserir em emails_triagem (RLS por equipe) consegue criar uma linha
// de entrada com o "de" de um terceiro e usar a caixa para escrever em nome da
// empresa. Fechar de verdade exige gravar toda mensagem recebida numa tabela de
// prova, como a 076 fez para o WhatsApp; até lá isto é saída autenticada de
// e-mail, não um relay aberto — e é dívida registrada, não detalhe.
import { type SupabaseContext, withSupabase } from 'npm:@supabase/server@1';
import nodemailer from 'npm:nodemailer@6.9.16';
import {
  chatIdsPara,
  emojiValido,
  enviarReacao,
  enviarTexto,
  idDoChat,
  idSerializado,
  marcarVisto,
} from '../whatsapp/provedor.ts';
import { numeroEscreveuParaEquipe } from '../whatsapp/equipes.ts';

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
const TEXTO_MAX = 20000;
const ARQUIVO_BASE64_MAX = 7_000_000;

type Midia = { nome: string; tipo: string; dados: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Quem atende aparece no WhatsApp: o cliente fala com a empresa por um
// número compartilhado, então o nome da pessoa da equipe vai no próprio
// texto — é a única forma do cliente saber com quem está falando.
function prefixoAtendente(nome: string, texto: string): string {
  const n = String(nome || '').trim();
  if (!n) return texto;
  return n + ': ' + texto;
}

function enderecoDe(de: unknown): string {
  const bruto = String(de || '');
  const m = /<([^>]+)>/.exec(bruto);
  const end = (m ? m[1] : bruto).trim().toLowerCase();
  return EMAIL_RE.test(end) ? end : '';
}

function assuntoResposta(assunto: unknown): string {
  const limpo = String(assunto || '').trim() || 'Atendimento';
  return (/^re:\s*/i.test(limpo) ? limpo : 'Re: ' + limpo).slice(0, 300);
}

function midiaDoBody(valor: unknown): Midia | null {
  if (!valor || typeof valor !== 'object') return null;
  const m = valor as Record<string, unknown>;
  const dados = String(m.dados || '');
  const base64 = dados.includes(',') ? dados.slice(dados.indexOf(',') + 1) : dados;
  if (!base64 || base64.length > ARQUIVO_BASE64_MAX || !/^[A-Za-z0-9+/=\r\n]+$/.test(base64))
    throw new Error('invalid_file');
  return {
    nome: String(m.nome || 'arquivo').slice(0, 120),
    tipo: String(m.tipo || 'application/octet-stream').slice(0, 120),
    dados: base64,
  };
}

async function handle(req: Request, ctx: SupabaseContext): Promise<Response> {
  try {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const uid = ctx.userClaims?.id ?? null;
    const { data: op } = uid
      ? await ctx.supabase
          .from('operators')
          .select('id,name,active')
          .eq('auth_user_id', uid)
          .maybeSingle()
      : { data: null };
    if (!op || op.active === false)
      return json({ error: 'Não autorizado', code: 'unauthorized' }, 401);

    const body = await req.json();
    const thread = String(body.thread_id || '').trim();
    const texto = String(body.text ?? '').trim();
    const interna = body.kind === 'internal';
    const reacao = body.kind === 'reaction';
    const visto = body.kind === 'seen';
    if (!thread) return json({ error: 'Conversa obrigatória', code: 'missing_thread' }, 400);
    if (texto.length > TEXTO_MAX)
      return json({ error: 'Texto longo demais', code: 'text_too_long' }, 400);
    let midia: Midia | null = null;
    try {
      midia = midiaDoBody(body.file);
    } catch {
      return json({ error: 'Arquivo inválido ou maior que 5 MB', code: 'invalid_file' }, 400);
    }
    if (reacao && !emojiValido(body.emoji))
      return json({ error: 'Reação inválida', code: 'invalid_reaction' }, 400);
    if (!reacao && !visto && !texto && !midia)
      return json({ error: 'Escreva uma mensagem ou escolha um arquivo', code: 'empty_text' }, 400);

    const { data: visivel, error: visErr } = await ctx.supabase
      .from('emails_triagem')
      .select('id')
      .eq('thread_id', thread)
      .eq('direcao', 'entrada')
      .order('recebido_em', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (visErr) return json({ error: 'Não foi possível ler a conversa', code: 'thread_read' }, 500);
    if (!visivel) return json({ error: 'Conversa não encontrada', code: 'thread_not_found' }, 404);
    const { data: ultima, error } = await ctx.supabaseAdmin
      .from('emails_triagem')
      .select(
        'id, thread_id, message_id, de, assunto, team, client_id, pendencia_id, canal, telefone'
      )
      .eq('id', visivel.id)
      .maybeSingle();
    if (error || !ultima)
      return json({ error: 'Conversa não encontrada', code: 'thread_not_found' }, 404);

    const whats = ultima.canal === 'whatsapp';
    const credWaha = {
      baseUrl: (Deno.env.get('WAHA_BASE_URL') || '').replace(/\/+$/, ''),
      apiKey: Deno.env.get('WAHA_API_KEY') || '',
      session: Deno.env.get('WAHA_SESSION') || 'default',
    };
    if ((reacao || visto) && !whats)
      return json({ error: 'Só no WhatsApp', code: 'not_whatsapp' }, 400);

    // Linha citada ou reagida: sempre deste thread e desta equipe. Com service
    // role, o filtro de team é o que faz o papel da RLS.
    const alvoId = String((reacao ? body.alvo : body.reply_to) || '').trim();
    let alvo: {
      id: string;
      message_id: string | null;
      de: string | null;
      corpo: string | null;
      direcao: string | null;
    } | null = null;
    if (alvoId) {
      const { data: achado } = await ctx.supabaseAdmin
        .from('emails_triagem')
        .select('id, message_id, de, corpo, direcao')
        .eq('id', alvoId)
        .eq('thread_id', thread)
        .eq('team', ultima.team)
        .maybeSingle();
      alvo = achado || null;
      if (!alvo) return json({ error: 'Mensagem não encontrada', code: 'target_not_found' }, 404);
    }

    // A linha de entrada que diz "esta equipe atende este número" é gravável
    // pelo operador (RLS de emails_triagem): forjando uma, a equipe A falava
    // com contato da equipe B. A prova é a 088, gravada só pelo webhook. Banco
    // sem a 088 (null) segue como antes, para não parar o atendimento.
    if (whats && !interna) {
      const fone = String(ultima.telefone || '').replace(/\D/g, '');
      if ((await numeroEscreveuParaEquipe(ctx.supabaseAdmin, fone, ultima.team)) === false)
        return json(
          {
            error: 'Este número não escreveu para a sua equipe',
            code: 'not_team_contact',
          },
          403
        );
    }

    // Visto e reação também falam com o número pela sessão compartilhada do
    // WAHA: valem a mesma prova de contato (076) que a resposta exige.
    if (visto || reacao) {
      const foneContato = String(ultima.telefone || '').replace(/\D/g, '');
      const { data: contatoOk } = foneContato
        ? await ctx.supabaseAdmin
            .from('whatsapp_conversas')
            .select('telefone')
            .eq('telefone', foneContato)
            .maybeSingle()
        : { data: null };
      if (!contatoOk)
        return json(
          { error: 'Este número nunca escreveu para a empresa', code: 'not_whatsapp_contact' },
          422
        );
    }

    if (visto) {
      // Melhor esforço: sem WAHA o operador continua atendendo, só o cliente
      // não vê o azul. Por isso 200 mesmo quando não saiu.
      const r =
        credWaha.baseUrl && credWaha.apiKey
          ? await marcarVisto(String(ultima.telefone || ''), credWaha)
          : { ok: false };
      return json({ success: true, enviado: r.ok });
    }

    if (reacao) {
      // message_id é coluna que a RLS deixa a equipe gravar: sem amarrar o id
      // ao chat deste contato, daria para reagir em mensagem de outra conversa
      // da sessão. Id curto (sem o chat) não tem como ser conferido: recusa.
      const fone = String(ultima.telefone || '').replace(/\D/g, '');
      if (
        !alvo ||
        !alvo.message_id ||
        alvo.direcao === 'interna' ||
        !idDoChat(alvo.message_id, fone)
      )
        return json(
          { error: 'Essa mensagem não aceita reação', code: 'target_not_reactable' },
          422
        );
      if (!credWaha.baseUrl || !credWaha.apiKey)
        return json({ error: 'WhatsApp não configurado', code: 'missing_credentials' }, 500);
      const emoji = String(body.emoji || '');
      const envio = await enviarReacao(alvo.message_id, emoji, credWaha);
      if (!envio.ok)
        return json(
          { error: 'Não foi possível reagir pelo WhatsApp', code: 'provider_error' },
          502
        );
      const { error: reErr } = await ctx.supabaseAdmin
        .from('emails_triagem')
        .update({ reacao_equipe: emoji || null, updated_at: new Date().toISOString() })
        .eq('id', alvo.id)
        .eq('team', ultima.team);
      if (reErr) console.error('conversa-responder reação:', reErr.message);
      return json({ success: true });
    }

    // A citação só vale no WhatsApp; no e-mail o histórico já vai no corpo.
    const citacao =
      whats && alvo
        ? {
            id: alvo.message_id || alvo.id,
            texto: String(alvo.corpo || '').slice(0, 300),
            autor: String(alvo.de || '').slice(0, 120),
          }
        : null;

    let providerId: string | null = null;
    if (!interna && ultima.canal === 'whatsapp') {
      const telefone = String(ultima.telefone || '').replace(/\D/g, '');
      const { data: contato } = await ctx.supabaseAdmin
        .from('whatsapp_conversas')
        .select('telefone')
        .eq('telefone', telefone)
        .maybeSingle();
      if (!contato)
        return json(
          { error: 'Este número nunca escreveu para a empresa', code: 'not_whatsapp_contact' },
          422
        );
      const baseUrl = (Deno.env.get('WAHA_BASE_URL') || '').replace(/\/+$/, '');
      const apiKey = Deno.env.get('WAHA_API_KEY') || '';
      const session = Deno.env.get('WAHA_SESSION') || 'default';
      if (!baseUrl || !apiKey)
        return json({ error: 'WhatsApp não configurado', code: 'missing_credentials' }, 500);
      const textoEnvio = prefixoAtendente(op.name || '', texto);
      if (!midia) {
        const envio = await enviarTexto(telefone, textoEnvio, { baseUrl, apiKey, session }, fetch, {
          replyTo: alvo?.message_id || null,
        });
        if (!envio.ok) {
          console.error(`conversa-responder: envio pelo WhatsApp falhou (${envio.erro})`);
          return json(
            { error: 'Não foi possível enviar pelo WhatsApp', code: 'provider_error' },
            502
          );
        }
        providerId = envio.id || null;
      } else {
        const endpoint = midia.tipo.startsWith('image/')
          ? 'sendImage'
          : midia.tipo.startsWith('audio/')
            ? 'sendVoice'
            : 'sendFile';
        const payload: Record<string, unknown> = {
          session,
          file: { mimetype: midia.tipo, filename: midia.nome, data: midia.dados },
        };
        if (endpoint === 'sendVoice') payload.convert = true;
        else payload.caption = prefixoAtendente(op.name || '', texto);
        try {
          // Mesma regra do texto (chatIdsPara): conversa gravada com o LID
          // tenta "@lid" quando "@c.us" é recusado.
          let resp: Response | null = null;
          for (const chatId of chatIdsPara(telefone)) {
            resp = await fetch(`${baseUrl}/api/${endpoint}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
              body: JSON.stringify({ ...payload, chatId }),
              signal: AbortSignal.timeout(30000),
            });
            if (resp.ok) break;
          }
          if (!resp || !resp.ok)
            return json({ error: 'Não foi possível enviar a mídia', code: 'provider_error' }, 502);
          const envio = await resp.json().catch(() => ({}));
          providerId = idSerializado(envio.id) || idSerializado(envio.key) || null;
        } catch {
          return json({ error: 'WAHA inacessível', code: 'provider_unreachable' }, 502);
        }
      }
    } else if (!interna) {
      const destino = enderecoDe(ultima.de);
      if (!destino)
        return json({ error: 'Remetente sem e-mail válido', code: 'invalid_requester_email' }, 422);
      const user = Deno.env.get('GMAIL_USER') || '';
      const pass = (Deno.env.get('GMAIL_APP_PASSWORD') || '').replace(/\s+/g, '');
      if (!user || !pass)
        return json({ error: 'E-mail não configurado', code: 'missing_credentials' }, 500);
      const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: { user, pass },
      });
      try {
        const info = await transporter.sendMail({
          from: { name: 'Init Intra', address: Deno.env.get('GMAIL_FROM') || user },
          to: destino,
          subject: assuntoResposta(ultima.assunto),
          text: texto,
          ...(ultima.message_id
            ? { inReplyTo: ultima.message_id, references: [ultima.message_id] }
            : {}),
          ...(midia
            ? {
                attachments: [
                  {
                    filename: midia.nome,
                    content: midia.dados,
                    encoding: 'base64',
                    contentType: midia.tipo,
                  },
                ],
              }
            : {}),
        });
        providerId = info.messageId || null;
      } catch (err) {
        console.error('conversa-responder SMTP:', (err as Error).message);
        return json({ error: 'Não foi possível enviar o e-mail', code: 'smtp_error' }, 502);
      } finally {
        transporter.close();
      }
    }

    const id = 'portal:' + crypto.randomUUID();
    const agora = new Date().toISOString();
    // O histórico mostra a mesma mensagem que o cliente recebeu: no WhatsApp
    // o texto enviado leva o nome de quem atendeu, então o registro idem.
    const textoSalvo =
      !interna && ultima.canal === 'whatsapp' ? prefixoAtendente(op.name || '', texto) : texto;
    const linha: Record<string, unknown> = {
      id,
      email_id: id,
      thread_id: thread,
      message_id: providerId,
      de: op.name || 'Equipe Init',
      assunto: ultima.assunto,
      corpo: textoSalvo,
      recebido_em: agora,
      motivo: null,
      status: 'anexado',
      pendencia_id: ultima.pendencia_id,
      team: ultima.team,
      tratado_por: op.name,
      tratado_em: agora,
      client_id: ultima.client_id,
      atribuido_a: op.name,
      atribuido_em: agora,
      canal: ultima.canal || 'email',
      telefone: ultima.telefone,
      direcao: interna ? 'interna' : 'saida',
      media: midia ? { nome: midia.nome, tipo: midia.tipo, dados: midia.dados } : null,
      created_at: agora,
      updated_at: agora,
    };
    let { error: insertErr } = await ctx.supabaseAdmin
      .from('emails_triagem')
      .insert(citacao ? { ...linha, citacao } : linha);
    // Banco sem a 086: a mensagem já saiu, então o histórico entra sem a
    // citação em vez de virar "enviado, mas não salvo".
    if (insertErr && citacao && /citacao/.test(insertErr.message || '')) {
      console.warn('conversa-responder: migration 086 não aplicada, gravando sem citação');
      ({ error: insertErr } = await ctx.supabaseAdmin.from('emails_triagem').insert(linha));
    }
    if (insertErr) {
      console.error('conversa-responder insert:', insertErr.message);
      return json(
        {
          error: interna
            ? 'Não foi possível salvar a nota'
            : 'Enviado, mas não foi possível salvar no histórico',
          code: 'history_write',
        },
        500
      );
    }
    // Responder reabre o que estava encerrado: o cliente voltou a falar e isso
    // é atendimento novo. Nota interna não conta — ninguém respondeu ao cliente.
    //
    // O update é com service role, então o escopo de equipe vai explícito: o
    // mesmo thread de WhatsApp pode ter linha em mais de uma equipe, e sem o
    // filtro responder por uma tiraria a conversa da fila da outra.
    let statusQuery = ctx.supabaseAdmin
      .from('emails_triagem')
      .update({ status: 'anexado', updated_at: agora })
      .eq('thread_id', thread)
      .eq('team', ultima.team);
    statusQuery = interna
      ? statusQuery.eq('status', 'pendente')
      : statusQuery.in('status', ['pendente', 'encerrado']);
    const { error: statusErr } = await statusQuery;
    if (statusErr) console.error('conversa-responder status:', statusErr.message);
    return json({ success: true, id });
  } catch (err) {
    console.error('conversa-responder:', (err as Error).message);
    return json({ error: 'Erro interno' }, 500);
  }
}

export default { fetch: withSupabase({ auth: 'user' }, handle) };
