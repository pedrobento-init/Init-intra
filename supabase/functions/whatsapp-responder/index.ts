// supabase/functions/whatsapp-responder/index.ts
// Edge Function: responde por WhatsApp a quem abriu o chamado, na mesma
// conversa em que ele escreveu. É o caminho de volta da entrada por WhatsApp
// (supabase/functions/whatsapp/), par da pendencia-responder do e-mail.
//
// CONFIGURAÇÃO (secrets):
//   WHATSAPP_TOKEN ............. token de acesso do app na Meta (o mesmo
//                                painel onde sai o App secret). No teste é um
//                                token temporário de 24 h; para valer, token
//                                de System User, que não expira.
//   WHATSAPP_PHONE_NUMBER_ID ... "Phone number ID" do número que ENVIA (em
//                                WhatsApp → API Setup). NÃO é o telefone: é um
//                                id numérico longo da Meta.
//   supabase functions deploy whatsapp-responder
//
// POR QUE NÃO É A whatsapp: aquela é webhook, chamada pela Meta, autenticada
// por assinatura HMAC e com `verify_jwt = false`. Esta é chamada pelo app, com
// o JWT do operador — juntar as duas numa função só obrigaria a desligar o
// verify_jwt do caminho que o app usa, e aí o envio ficaria aberto a quem tem
// a chave pública (que vai no site).
//
// O APP NUNCA ESCOLHE O DESTINATÁRIO: manda `pendencia_id`, e o telefone sai do
// `email_thread_id` daquele chamado, lido com a chave de serviço. Mesma trava
// da pendencia-responder, e pelo mesmo motivo: sem ela, quem tivesse a chave
// pública mandaria WhatsApp em nome da Init para qualquer número.

import { type SupabaseContext, withSupabase } from "npm:@supabase/server@1";
import {
  corpoGraph,
  erroDoGraph,
  idDoEnvio,
  janelaDaConversa,
  JANELA_HORAS,
  telefoneDaConversa,
  telefoneLegivel,
  textoDaResposta,
  TEXTO_MAX,
} from "../whatsapp/resposta.ts";

const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const GRAPH = "https://graph.facebook.com/v21.0";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function handle(req: Request, ctx: SupabaseContext): Promise<Response> {
  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    // Só operador ativo logado — mesma porta da pendencia-responder.
    const uid = ctx.userClaims?.id ?? null;
    const { data: op } = uid
      ? await ctx.supabase.from("operators").select("id,name,active").eq("auth_user_id", uid).maybeSingle()
      : { data: null };
    if (!op || op.active === false) return json({ error: "Não autorizado", code: "unauthorized" }, 401);

    if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
      console.error("WHATSAPP_TOKEN/WHATSAPP_PHONE_NUMBER_ID não configurados como secrets no Supabase");
      return json({ error: "WhatsApp não configurado no Supabase", code: "missing_credentials" }, 500);
    }

    const { pendencia_id, text } = await req.json();
    const id = String(pendencia_id || "").trim();
    const texto = textoDaResposta(text);
    if (!id) return json({ error: "pendencia_id obrigatório", code: "missing_pendencia" }, 400);
    if (!texto) return json({ error: "Escreva a resposta antes de enviar", code: "empty_text" }, 400);
    if (String(text ?? "").trim().length > TEXTO_MAX) {
      return json({ error: `A mensagem passa de ${TEXTO_MAX} caracteres`, code: "text_too_long" }, 400);
    }

    // Duas leituras, de propósito, cada uma respondendo uma pergunta:
    //
    // 1) PODE? Com a chave do operador, sujeita ao RLS por equipe. Se o chamado
    //    não aparece aqui, ele não é dessa equipe e a conversa não é dele —
    //    sem isto, bastaria saber o id para falar com o cliente de outra equipe.
    const { data: visivel, error: visErr } = await ctx.supabase
      .from("pendencias").select("id").eq("id", id).maybeSingle();
    if (visErr) {
      console.error("whatsapp-responder: leitura com RLS:", visErr.message);
      return json({ error: "Não foi possível ler o chamado", code: "pendencia_read" }, 500);
    }
    if (!visivel) return json({ error: "Chamado não encontrado", code: "pendencia_not_found" }, 404);

    // 2) PARA QUEM? Com a chave de serviço: o destinatário não pode depender do
    //    que o app mandou. A resposta do PODE já saiu acima.
    const { data: pen, error: penErr } = await ctx.supabaseAdmin
      .from("pendencias")
      .select("id, email_thread_id, notes, created_at, client_name")
      .eq("id", id).maybeSingle();
    if (penErr) {
      console.error("whatsapp-responder: leitura do chamado:", penErr.message);
      return json({ error: "Não foi possível ler o chamado", code: "pendencia_read" }, 500);
    }
    if (!pen) return json({ error: "Chamado não encontrado", code: "pendencia_not_found" }, 404);

    const waId = telefoneDaConversa(pen.email_thread_id);
    if (!waId) {
      return json({ error: "Este chamado não veio por WhatsApp", code: "not_whatsapp" }, 422);
    }

    // A janela de 24 h é da Meta, não nossa: fora dela só sai template
    // aprovado. Conferir aqui transforma uma recusa crua da Graph API numa
    // frase que o técnico entende — e evita um POST que já se sabe perdido.
    const janela = janelaDaConversa(pen.notes, pen.created_at);
    if (!janela.aberta) {
      return json({
        error: `A janela de ${JANELA_HORAS} h fechou: fora dela o WhatsApp só aceita template aprovado.`
          + " A nota continua salva no chamado; para falar com o cliente, ligue ou mande e-mail.",
        code: "window_closed",
        ultima_mensagem: janela.ultima || null,
      }, 422);
    }

    let res: Response;
    try {
      res = await fetch(`${GRAPH}/${PHONE_NUMBER_ID}/messages`, {
        method: "POST",
        headers: {
          // O token só existe aqui, no header. Nunca na URL nem no log.
          "Authorization": "Bearer " + WHATSAPP_TOKEN,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(corpoGraph(waId, texto)),
        signal: AbortSignal.timeout(20000),
      });
    } catch (e) {
      console.error("whatsapp-responder: Graph API inalcançável:", (e as Error).message);
      return json({ success: false, error: "Não foi possível falar com a Meta", code: "graph_unreachable" }, 502);
    }

    let corpo: unknown = null;
    try {
      corpo = await res.json();
    } catch {
      corpo = null;
    }

    if (!res.ok) {
      // Só o motivo, nunca o token nem o corpo inteiro: a resposta de erro da
      // Meta ecoa pedaços do pedido.
      const motivo = erroDoGraph(corpo, res.status);
      console.error(`whatsapp-responder: Graph ${res.status} no chamado ${id}:`, motivo);
      return json({ success: false, error: motivo, code: "graph_error", status: res.status }, 502);
    }

    const wamid = idDoEnvio(corpo);
    return json({
      success: true,
      to: telefoneLegivel(waId),
      // Minutos que restam da janela: é o que deixa a tela avisar "faltam 40
      // min" antes de o técnico descobrir no erro.
      restam_min: janela.restamMin,
      id: wamid || null,
    });
  } catch (err) {
    console.error("Erro na Edge Function:", err);
    return json({ error: (err as Error).message || "Erro interno" }, 500);
  }
}

export default { fetch: withSupabase({ auth: "user" }, handle) };
