// Edge Function: whatsapp-inatividade — lembrete e encerramento automático de
// conversa de WhatsApp em que o cliente parou de responder.
//
// Chamada pelo pg_cron a cada 5 minutos (migration 088). Para cada equipe com
// a inatividade ligada em whatsapp_automacao: se a última mensagem da conversa
// foi de uma pessoa da equipe e o cliente não respondeu em N minutos, manda o
// lembrete (uma vez); passados M minutos, encerra a conversa e avisa. A regra
// está em whatsapp/automacao.ts (conversasParadas, decidirInatividade).
//
// DESLIGADA POR PADRÃO: sem equipe com inatividade_ativa, a função lê uma
// tabela e devolve. Sem a 088, a leitura falha e ela devolve do mesmo jeito.
//
// AUTENTICAÇÃO — auth "none" + x-cron-secret (o mesmo AVISOS_CRON_SECRET dos
// outros crons, guardado no Vault como avisos_cron_secret), verify_jwt = false
// no config.toml: quem chama é o pg_cron, que não tem JWT.
//
// ESCOPO — tudo com service role, então a equipe vai explícita em cada
// escrita: o encerramento só mexe nas linhas da caixa daquele telefone NA
// equipe da conversa parada, e só nas que estão em aberto.

import { type SupabaseContext, withSupabase } from 'npm:@supabase/server@1';
import {
  configDaLinha,
  type ConfigAutomacao,
  conversasParadas,
  decidirInatividade,
  type LinhaHistorico,
} from '../whatsapp/automacao.ts';
import { encerrarPelaAutomacao, enviarDaAutomacao } from '../whatsapp/automacao-acoes.ts';

// Teto de ações por execução: o cron volta em 5 minutos, e uma rajada de
// mensagens saindo do número de uma vez é o que chama atenção do WhatsApp.
const ACOES_MAX = 40;
// Folga de histórico além do maior prazo de encerramento: a mensagem do
// cliente que a equipe respondeu pode ser bem anterior à resposta.
const FOLGA_HISTORICO_MS = 3 * 24 * 60 * 60 * 1000;
const LINHAS_MAX = 5000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function safeEqual(a: string, b: string) {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function handle(req: Request, ctx: SupabaseContext) {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const segredo = Deno.env.get('AVISOS_CRON_SECRET') ?? '';
  if (!segredo || !safeEqual(req.headers.get('x-cron-secret') ?? '', segredo))
    return json({ error: 'Não autorizado' }, 401);

  const db = ctx.supabaseAdmin;
  try {
    const { data: linhasCfg, error: cfgErr } = await db
      .from('whatsapp_automacao')
      .select('*')
      .eq('inatividade_ativa', true);
    if (cfgErr) {
      console.warn(
        'whatsapp-inatividade: configuração indisponível (migration 088?):',
        cfgErr.message
      );
      return json({ ok: true, ativo: false });
    }
    const configs = new Map<string, ConfigAutomacao>();
    for (const l of (linhasCfg || []) as Record<string, unknown>[]) {
      const cfg = configDaLinha(l);
      if (cfg.inatividadeAtiva) configs.set(cfg.team, cfg);
    }
    if (!configs.size) return json({ ok: true, ativo: false });

    const cred = {
      baseUrl: Deno.env.get('WAHA_BASE_URL') || '',
      apiKey: Deno.env.get('WAHA_API_KEY') || '',
      session: Deno.env.get('WAHA_SESSION') || 'default',
    };
    if (!cred.baseUrl || !cred.apiKey)
      return json({ error: 'WhatsApp não configurado', code: 'missing_credentials' }, 500);

    const agora = new Date();
    const maiorPrazo = Math.max(...[...configs.values()].map((c) => c.encerrarMin));
    const desde = new Date(
      agora.getTime() - maiorPrazo * 60_000 - FOLGA_HISTORICO_MS
    ).toISOString();
    const { data: historico, error: histErr } = await db
      .from('emails_triagem')
      .select('telefone, team, client_id, de, direcao, status, recebido_em, pendencia_id')
      .eq('canal', 'whatsapp')
      .in('team', [...configs.keys()])
      .gte('recebido_em', desde)
      .order('recebido_em', { ascending: false })
      .limit(LINHAS_MAX);
    if (histErr) throw new Error('emails_triagem: ' + histErr.message);

    const paradas = conversasParadas((historico || []) as LinhaHistorico[]).filter((p) =>
      configs.has(p.team)
    );
    if (!paradas.length) return json({ ok: true, ativo: true, lembretes: 0, encerradas: 0 });

    const { data: estados } = await db
      .from('whatsapp_conversas')
      .select('telefone, inatividade_lembrete_em')
      .in(
        'telefone',
        paradas.map((p) => p.telefone)
      );
    const lembretes = new Map<string, string | null>();
    for (const e of (estados || []) as Array<{
      telefone: string;
      inatividade_lembrete_em: string | null;
    }>)
      lembretes.set(e.telefone, e.inatividade_lembrete_em);

    let lembrou = 0,
      encerrou = 0,
      acoes = 0;
    for (const p of paradas) {
      if (acoes >= ACOES_MAX) break;
      // Sem linha em whatsapp_conversas o número nunca escreveu (076): nada sai.
      if (!lembretes.has(p.telefone)) continue;
      const cfg = configs.get(p.team) as ConfigAutomacao;
      const acao = decidirInatividade(
        cfg,
        p.ultimaSaidaEm,
        lembretes.get(p.telefone) ?? null,
        agora
      );
      if (!acao) continue;
      acoes++;
      if (acao === 'lembrar') {
        const enviadas = await enviarDaAutomacao(db, p.telefone, [cfg.textoLembrete], {
          cred,
          team: p.team,
          clientId: p.clientId,
        });
        if (!enviadas) continue;
        const { error } = await db
          .from('whatsapp_conversas')
          .update({ inatividade_lembrete_em: agora.toISOString() })
          .eq('telefone', p.telefone);
        if (error) console.error('whatsapp-inatividade lembrete:', error.message);
        lembrou++;
        continue;
      }
      // Encerrar: só o que está em aberto, deste telefone, NESTA equipe, e
      // nada que tenha chegado depois da leitura (o cliente pode ter
      // respondido neste meio-tempo).
      const { error } = await db
        .from('emails_triagem')
        .update({ status: 'encerrado', updated_at: agora.toISOString() })
        .eq('canal', 'whatsapp')
        .eq('telefone', p.telefone)
        .eq('team', p.team)
        .in('status', ['pendente', 'anexado'])
        .lte('recebido_em', agora.toISOString());
      if (error) {
        console.error('whatsapp-inatividade encerrar:', error.message);
        continue;
      }
      await encerrarPelaAutomacao(
        db,
        {
          telefone: p.telefone,
          team: p.team,
          clientId: p.clientId,
          operador: null,
          motivo: 'inatividade',
          cred,
        },
        agora
      );
      encerrou++;
    }
    return json({ ok: true, ativo: true, lembretes: lembrou, encerradas: encerrou });
  } catch (err) {
    console.error('whatsapp-inatividade:', (err as Error).message);
    return json({ ok: false, error: 'Erro interno' }, 500);
  }
}

export default { fetch: withSupabase({ auth: 'none' }, handle) };
