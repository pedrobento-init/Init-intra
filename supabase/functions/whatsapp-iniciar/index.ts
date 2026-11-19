// Atendimento ativo: a empresa escreve primeiro pelo WhatsApp.
//
// A trava da 076 continua valendo: o Intra não pode virar um disparador de
// WhatsApp para qualquer número. Por isso o destino só passa se for
//   (a) telefone de CLIENTE cadastrado da equipe de quem envia (owner_phone ou
//       responsible_phone de clients; admin vale para qualquer equipe), ou
//   (b) número que já escreveu para a empresa (whatsapp_conversas, gravada só
//       pelo webhook) E cuja conversa a equipe enxerga na caixa (RLS de
//       emails_triagem). Só a 076 não basta: ela não tem equipe, e um operador
//       iniciaria conversa com quem só falou com outra equipe.
// Tudo isso é decidido AQUI, com o banco. O navegador só manda o número e o
// texto; nada do que ele diz sobre o cliente é levado em conta.
//
// A WAHA é API não oficial: mensagem não solicitada em volume é o caminho mais
// curto para o número da empresa ser bloqueado. Daí o limite por operador e
// por equipe na última hora (whatsapp_envios_ativos, 089, só service_role) e a
// consulta à WAHA de que o número tem WhatsApp antes de mandar. Sem a 089 a
// function recusa tudo (fail-closed): sem contagem não há limite.
//
// Janela de 24 h: na API oficial da Meta, fora dela só sai mensagem de modelo
// aprovado. A WAHA não impõe isso, mas o risco de denúncia é o mesmo; a tela
// (js/whatsapp-contatos.js) só oferece "Iniciar conversa" quando a conversa
// não está aberta na caixa e avisa do limite.
//
// O envio NÃO grava em whatsapp_conversas: aquela tabela é a prova de que o
// NÚMERO escreveu, e a empresa escrever primeiro não prova nada. Enquanto o
// contato não responder, nova mensagem ativa passa de novo por aqui (e conta
// no limite); quando ele responder, a conversa segue pela caixa
// (conversa-responder) como qualquer outra.
import { type SupabaseContext, withSupabase } from 'npm:@supabase/server@1';
import { enviarTexto } from '../whatsapp/provedor.ts';
import { chaveTelefone, clienteDoTelefone, funcaoAusente } from '../whatsapp/mensagem.ts';

// Números do limite. Conservadores de propósito: atendimento ativo é exceção
// (retorno de visita, aviso de chamado), não campanha.
export const LIMITE_OPERADOR_HORA = 20;
export const LIMITE_EQUIPE_HORA = 60;
const TEXTO_MAX = 4096;
const HORA_MS = 60 * 60 * 1000;

type Operador = {
  id: string;
  name: string | null;
  active: boolean | null;
  team: string | null;
  is_admin: boolean | null;
};

type ClienteFone = {
  id: string;
  name: string;
  team?: string | null;
  owner_phone?: string | null;
  responsible_phone?: string | null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Mesmo formato do conversa-responder: o cliente precisa saber quem escreveu
// pelo número compartilhado da empresa.
function prefixoAtendente(nome: string, texto: string): string {
  const n = String(nome || '').trim();
  return n ? n + ': ' + texto : texto;
}

function equipe(t: unknown): string {
  return String(t || '').trim() || 'init';
}

// O webhook grava o número como a WAHA entrega (55 + DDD + número, com ou sem o
// nono dígito, conforme o cadastro do WhatsApp). Quem digita o número na tela
// escreve de qualquer jeito: procura as quatro formas.
export function variantesTelefone(bruto: unknown): string[] {
  let d = String(bruto ?? '').replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  const base = new Set<string>();
  if (d.length === 11 && d[2] === '9') {
    base.add(d);
    base.add(d.slice(0, 2) + d.slice(3));
  } else if (d.length === 10) {
    base.add(d);
    base.add(d.slice(0, 2) + '9' + d.slice(2));
  } else if (d.length >= 8) {
    base.add(d);
  }
  const out = new Set<string>();
  for (const b of base) {
    out.add(b);
    if (b.length === 10 || b.length === 11) out.add('55' + b);
  }
  return [...out];
}

async function clientesDoTelefone(ctx: SupabaseContext, chave: string): Promise<ClienteFone[]> {
  const { data, error } = await ctx.supabaseAdmin.rpc('clientes_do_telefone', { p_chave: chave });
  if (!error) return (data || []) as ClienteFone[];
  if (!funcaoAusente(error)) throw new Error('clientes: ' + error.message);
  // Banco sem a 077: varre os cadastros, como o webhook faz no mesmo caso.
  const lidos = await ctx.supabaseAdmin
    .from('clients')
    .select('id, name, team, owner_phone, responsible_phone')
    .limit(5000);
  if (lidos.error) throw new Error('clientes: ' + lidos.error.message);
  return ((lidos.data || []) as ClienteFone[]).filter(
    (c) => chaveTelefone(c.owner_phone) === chave || chaveTelefone(c.responsible_phone) === chave
  );
}

// Quantos envios ativos desde `desde`, filtrando por uma coluna. null = a
// tabela não existe (ou falhou): quem chama recusa, porque sem contagem não há
// limite.
async function contarEnvios(
  ctx: SupabaseContext,
  coluna: 'operador_id' | 'team',
  valor: string,
  desde: string
): Promise<number | null> {
  const { data, count, error } = await ctx.supabaseAdmin
    .from('whatsapp_envios_ativos')
    .select('id', { count: 'exact', head: true })
    .eq(coluna, valor)
    .gte('criado_em', desde);
  if (error) {
    console.error('whatsapp-iniciar contagem:', error.message);
    return null;
  }
  return typeof count === 'number' ? count : Array.isArray(data) ? data.length : 0;
}

// Pergunta à WAHA se o número tem WhatsApp e qual é o chatId de verdade (com
// ou sem o nono dígito). Mandar para número sem WhatsApp não chega a ninguém,
// mas conta como tentativa estranha para o WhatsApp.
async function chatIdNaWaha(
  telefone: string,
  cred: { baseUrl: string; apiKey: string; session: string }
): Promise<{ ok: true; telefone: string } | { ok: false; code: string }> {
  const url =
    `${cred.baseUrl}/api/contacts/check-exists?phone=${encodeURIComponent(telefone)}` +
    `&session=${encodeURIComponent(cred.session)}`;
  let resp: Response;
  try {
    resp = await fetch(url, {
      headers: { 'X-Api-Key': cred.apiKey },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return { ok: false, code: 'provider_unreachable' };
  }
  if (!resp.ok) return { ok: false, code: 'provider_error' };
  const corpo = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  if (corpo.numberExists !== true) return { ok: false, code: 'not_on_whatsapp' };
  const chatId = String(corpo.chatId || '');
  const digitos = chatId.endsWith('@c.us') ? chatId.replace(/\D/g, '') : '';
  return digitos ? { ok: true, telefone: digitos } : { ok: true, telefone };
}

async function handle(req: Request, ctx: SupabaseContext): Promise<Response> {
  try {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const uid = ctx.userClaims?.id ?? null;
    const { data: opBruto } = uid
      ? await ctx.supabase
          .from('operators')
          .select('id,name,active,team,is_admin')
          .eq('auth_user_id', uid)
          .maybeSingle()
      : { data: null };
    const op = opBruto as Operador | null;
    if (!op || op.active === false)
      return json({ error: 'Não autorizado', code: 'unauthorized' }, 401);
    const minhaEquipe = equipe(op.team);

    const body = await req.json().catch(() => ({}));
    const texto = String(body.text ?? '').trim();
    if (!texto) return json({ error: 'Escreva a mensagem', code: 'empty_text' }, 400);
    if (texto.length > TEXTO_MAX)
      return json({ error: 'Texto longo demais', code: 'text_too_long' }, 400);
    const variantes = variantesTelefone(body.telefone);
    const chave = chaveTelefone(body.telefone);
    if (!chave || !variantes.length)
      return json({ error: 'Telefone inválido', code: 'invalid_phone' }, 400);

    // (a) cliente cadastrado da equipe. Dois clientes com o mesmo número não
    // impedem o envio (os dois são da equipe), só deixam a conversa sem
    // cliente vinculado, como o webhook faz.
    let doTime: ClienteFone[] = [];
    try {
      doTime = (await clientesDoTelefone(ctx, chave)).filter(
        (c) => op.is_admin === true || equipe(c.team) === minhaEquipe
      );
    } catch (err) {
      console.error('whatsapp-iniciar:', (err as Error).message);
      return json({ error: 'Não foi possível conferir o cadastro', code: 'clients_read' }, 500);
    }
    const cliente = clienteDoTelefone(doTime, chave);

    // (b) número que já escreveu E cuja conversa esta equipe enxerga.
    const { data: prova } = await ctx.supabaseAdmin
      .from('whatsapp_conversas')
      .select('telefone')
      .in('telefone', variantes)
      .limit(1)
      .maybeSingle();
    let visivel: { team?: string | null; client_id?: string | null } | null = null;
    if (prova) {
      const { data } = await ctx.supabase
        .from('emails_triagem')
        .select('team, client_id')
        .eq('canal', 'whatsapp')
        .in('telefone', variantes)
        .order('recebido_em', { ascending: false })
        .limit(1)
        .maybeSingle();
      visivel = data || null;
    }
    if (!doTime.length && !visivel)
      return json(
        {
          error: 'Só dá para iniciar conversa com cliente da sua equipe ou com quem já escreveu',
          code: 'not_allowed_number',
        },
        403
      );

    const teamConversa = equipe(
      (cliente && cliente.team) ||
        (doTime[0] && doTime[0].team) ||
        (visivel && visivel.team) ||
        minhaEquipe
    );

    const desde = new Date(Date.now() - HORA_MS).toISOString();
    const doOperador = await contarEnvios(ctx, 'operador_id', String(op.id), desde);
    const daEquipe = await contarEnvios(ctx, 'team', teamConversa, desde);
    if (doOperador === null || daEquipe === null)
      return json(
        { error: 'Envio ativo indisponível: falta a migration 089', code: 'migration_missing' },
        503
      );
    if (doOperador >= LIMITE_OPERADOR_HORA)
      return json(
        {
          error: `Limite de ${LIMITE_OPERADOR_HORA} conversas iniciadas por hora atingido`,
          code: 'rate_limited',
        },
        429
      );
    if (daEquipe >= LIMITE_EQUIPE_HORA)
      return json(
        {
          error: `A equipe atingiu ${LIMITE_EQUIPE_HORA} conversas iniciadas nesta hora`,
          code: 'team_rate_limited',
        },
        429
      );

    const baseUrl = (Deno.env.get('WAHA_BASE_URL') || '').replace(/\/+$/, '');
    const apiKey = Deno.env.get('WAHA_API_KEY') || '';
    const session = Deno.env.get('WAHA_SESSION') || 'default';
    if (!baseUrl || !apiKey)
      return json({ error: 'WhatsApp não configurado', code: 'missing_credentials' }, 500);

    // Quem já escreveu tem o número exato que a WAHA conhece; o cadastro do
    // cliente pode estar sem o 55 ou sem o nono dígito, então pergunta.
    let destino = prova ? String(prova.telefone).replace(/\D/g, '') : '';
    if (!destino) {
      const candidato = variantes.find((v) => v.startsWith('55')) || variantes[0];
      const achado = await chatIdNaWaha(candidato, { baseUrl, apiKey, session });
      if (!achado.ok) {
        const status = achado.code === 'not_on_whatsapp' ? 422 : 502;
        const msg =
          achado.code === 'not_on_whatsapp'
            ? 'Este número não tem WhatsApp'
            : 'Não foi possível consultar o WhatsApp';
        return json({ error: msg, code: achado.code }, status);
      }
      destino = achado.telefone;
    }

    // A tentativa conta antes do envio: duas abas mandando ao mesmo tempo não
    // furam o limite, e envio que falhou no provedor também pesou no número.
    const { error: reservaErr } = await ctx.supabaseAdmin
      .from('whatsapp_envios_ativos')
      .insert({ operador_id: String(op.id), team: teamConversa, telefone: destino });
    if (reservaErr) {
      console.error('whatsapp-iniciar reserva:', reservaErr.message);
      return json(
        { error: 'Envio ativo indisponível: falta a migration 089', code: 'migration_missing' },
        503
      );
    }

    const textoEnvio = prefixoAtendente(op.name || '', texto);
    const envio = await enviarTexto(destino, textoEnvio, { baseUrl, apiKey, session });
    if (!envio.ok)
      return json({ error: 'Não foi possível enviar pelo WhatsApp', code: 'provider_error' }, 502);

    const id = 'ativo:' + crypto.randomUUID();
    const agora = new Date().toISOString();
    const thread = 'whatsapp:' + destino;
    const clientId = (cliente && cliente.id) || (visivel && visivel.client_id) || null;
    const { error: insertErr } = await ctx.supabaseAdmin.from('emails_triagem').insert({
      id,
      email_id: id,
      thread_id: thread,
      message_id: envio.id || null,
      de: op.name || 'Equipe Init',
      assunto: 'Conversa iniciada por ' + (op.name || 'Equipe Init'),
      corpo: textoEnvio,
      recebido_em: agora,
      motivo: null,
      status: 'anexado',
      pendencia_id: null,
      team: teamConversa,
      tratado_por: op.name,
      tratado_em: agora,
      client_id: clientId,
      atribuido_a: op.name,
      atribuido_em: agora,
      canal: 'whatsapp',
      telefone: destino,
      direcao: 'saida',
      media: null,
      created_at: agora,
      updated_at: agora,
    });
    if (insertErr) {
      console.error('whatsapp-iniciar insert:', insertErr.message);
      return json(
        { error: 'Enviado, mas não foi possível salvar no histórico', code: 'history_write' },
        500
      );
    }
    return json({ success: true, id, thread_id: thread, telefone: destino });
  } catch (err) {
    console.error('whatsapp-iniciar:', (err as Error).message);
    return json({ error: 'Erro interno' }, 500);
  }
}

export default { fetch: withSupabase({ auth: 'user' }, handle) };
