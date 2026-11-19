// Edge Function: conversa-encerrar — encerra uma conversa da Caixa de entrada
// pelo servidor e, no WhatsApp, manda o encerramento e a pesquisa de
// satisfação que a equipe configurou (whatsapp/automacao.ts, migration 088).
//
// POR QUE UMA FUNCTION À PARTE, e não um `kind: 'close'` no conversa-responder:
// aquela function é o caminho de resposta (texto obrigatório, anexo, prefixo do
// atendente, reabrir o que estava encerrado) e o contrato dela está travado em
// tests/portal-conversa-responder.test.js. Encerrar não tem texto nem anexo e
// faz o contrário de reabrir; misturar os dois num handler só deixaria cada
// validação com um "exceto quando é close".
//
// ESCOPO — o destino e a equipe saem do banco, nunca do navegador: a última
// mensagem de entrada do thread é lida com o JWT do operador (a RLS por equipe
// decide se ele enxerga a conversa) e só então com service role. O update de
// status filtra por thread E pela equipe dessa linha, como o conversa-responder:
// o mesmo telefone pode ter conversa em duas equipes, e encerrar numa não pode
// tirar a da outra da fila.
//
// O navegador também grava o status 'encerrado' (offline-first: a Caixa muda na
// hora). Os dois writes são o mesmo valor; o que só o servidor faz é mandar as
// mensagens, e encerrada_em (whatsapp_conversas) impede mandar duas vezes.
//
// AUTENTICAÇÃO — auth "user" + verify_jwt = true; só operador ativo.

import { type SupabaseContext, withSupabase } from 'npm:@supabase/server@1';
import { encerrarPelaAutomacao } from '../whatsapp/automacao-acoes.ts';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
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

    const body = await req.json().catch(() => ({}));
    const thread = String(body?.thread_id || '').trim();
    if (!thread) return json({ error: 'Conversa obrigatória', code: 'missing_thread' }, 400);

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
      .select('id, team, client_id, canal, telefone')
      .eq('id', visivel.id)
      .maybeSingle();
    if (error || !ultima)
      return json({ error: 'Conversa não encontrada', code: 'thread_not_found' }, 404);

    const agora = new Date().toISOString();
    // Mesma regra da Caixa (caixaEncerrar): só o que está em aberto muda;
    // 'virou_chamado' e 'descartado' são decisões já tomadas. A última
    // mensagem do cliente é a que diz o estado da conversa, então leva o
    // status sempre.
    const { error: abertasErr } = await ctx.supabaseAdmin
      .from('emails_triagem')
      .update({ status: 'encerrado', updated_at: agora })
      .eq('thread_id', thread)
      .eq('team', ultima.team)
      .in('status', ['pendente', 'anexado']);
    const { error: ultimaErr } = await ctx.supabaseAdmin
      .from('emails_triagem')
      .update({ status: 'encerrado', updated_at: agora })
      .eq('id', ultima.id)
      .eq('team', ultima.team);
    if (abertasErr || ultimaErr) {
      console.error('conversa-encerrar status:', (abertasErr || ultimaErr)?.message);
      return json({ error: 'Não foi possível encerrar', code: 'close_write' }, 500);
    }

    let automacao = { enviadas: 0, pesquisa: false, repetido: false };
    const telefone = String(ultima.telefone || '').replace(/\D/g, '');
    if (ultima.canal === 'whatsapp' && telefone) {
      automacao = await encerrarPelaAutomacao(ctx.supabaseAdmin, {
        telefone,
        team: ultima.team || 'init',
        clientId: ultima.client_id || null,
        operador: op.name || null,
        motivo: 'equipe',
        cred: {
          baseUrl: Deno.env.get('WAHA_BASE_URL') || '',
          apiKey: Deno.env.get('WAHA_API_KEY') || '',
          session: Deno.env.get('WAHA_SESSION') || 'default',
        },
      });
    }
    return json({ success: true, ...automacao });
  } catch (err) {
    console.error('conversa-encerrar:', (err as Error).message);
    return json({ error: 'Erro interno' }, 500);
  }
}

export default { fetch: withSupabase({ auth: 'user' }, handle) };
