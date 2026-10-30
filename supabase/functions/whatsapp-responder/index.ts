// Edge Function: whatsapp-responder — o operador responde pelo WhatsApp a quem
// abriu o chamado por WhatsApp.
//
// Separada do webhook (whatsapp/) de propósito: lá a porta é um token na query
// com verify_jwt = false, porque quem chama é a Z-API; aqui quem chama é o app,
// com o JWT do operador. Juntar as duas numa função só obrigaria a abrir o
// envio para o mesmo token da entrada.
//
// O APP NUNCA ESCOLHE O DESTINATÁRIO. O body traz só o chamado e o texto; o
// número sai de pendencias.email_thread_id ("whatsapp:<dígitos>"), gravado
// quando o chamado nasceu da mensagem. Se o número viesse do body, qualquer
// operador poderia usar o número da empresa para escrever para quem quisesse.
//
// Dois clientes, cada um com um papel:
//   * ctx.supabase (RLS) lê o chamado primeiro — é o que garante que o operador
//     só responde chamado da própria equipe. Chamado de outra equipe aparece
//     como "não encontrado", igual ao resto do app;
//   * ctx.supabaseAdmin lê o email_thread_id depois — o destino não pode
//     depender de coluna que o RLS ou um select do app deixe de fora.
//
// Não grava nota nem mexe no status: quem chama (o app) já registra a resposta
// no chamado pelo caminho de sempre, e duas fontes gravando a mesma nota
// duplicariam a conversa.
//
// Resposta: { success: true, to: "<dígitos>", id } — `to` são os dígitos crus,
// iguais aos do email_thread_id, para o app comparar sem formatar.
//
// CONFIGURAÇÃO (supabase secrets set): ZAPI_INSTANCE_ID, ZAPI_TOKEN,
// ZAPI_CLIENT_TOKEN.

import { type SupabaseContext, withSupabase } from "npm:@supabase/server@1";
import { telefoneDaConversa, TEXTO_MAX } from "../whatsapp/mensagem.ts";
import { enviarTexto } from "../whatsapp/provedor.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function handle(req: Request, ctx: SupabaseContext): Promise<Response> {
  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    // Só operador ativo logado — mesma porta do pendencia-responder.
    const uid = ctx.userClaims?.id ?? null;
    const { data: op } = uid
      ? await ctx.supabase.from("operators").select("id,name,active").eq("auth_user_id", uid).maybeSingle()
      : { data: null };
    if (!op || op.active === false) return json({ error: "Não autorizado", code: "unauthorized" }, 401);

    const cred = {
      instanceId: Deno.env.get("ZAPI_INSTANCE_ID"),
      token: Deno.env.get("ZAPI_TOKEN"),
      clientToken: Deno.env.get("ZAPI_CLIENT_TOKEN"),
    };
    if (!cred.instanceId || !cred.token || !cred.clientToken) {
      console.error("whatsapp-responder: credenciais da Z-API não configuradas como secrets");
      return json({ error: "WhatsApp não configurado no Supabase", code: "missing_credentials" }, 500);
    }

    const { pendencia_id, text } = await req.json();
    const id = String(pendencia_id || "").trim();
    const bruto = String(text ?? "").trim();
    if (!id) return json({ error: "pendencia_id obrigatório", code: "missing_pendencia" }, 400);
    if (!bruto) return json({ error: "Escreva a resposta antes de enviar", code: "empty_text" }, 400);
    // Recusa em vez de cortar: mandar metade da resposta sem avisar é pior.
    if (bruto.length > TEXTO_MAX) return json({ error: "Resposta longa demais", code: "text_too_long" }, 400);

    const { data: visivel, error: visErr } = await ctx.supabase
      .from("pendencias").select("id").eq("id", id).maybeSingle();
    if (visErr) {
      console.error("whatsapp-responder: leitura do chamado:", visErr.message);
      return json({ error: "Não foi possível ler o chamado", code: "pendencia_read" }, 500);
    }
    if (!visivel) return json({ error: "Chamado não encontrado", code: "pendencia_not_found" }, 404);

    const { data: pen, error: penErr } = await ctx.supabaseAdmin
      .from("pendencias").select("id, email_thread_id").eq("id", id).maybeSingle();
    if (penErr || !pen) {
      console.error("whatsapp-responder: leitura do destino:", penErr?.message || "sumiu");
      return json({ error: "Não foi possível ler o chamado", code: "pendencia_read" }, 500);
    }

    const tel = telefoneDaConversa(pen.email_thread_id);
    if (!tel) {
      return json({ error: "Este chamado não veio do WhatsApp", code: "not_whatsapp" }, 422);
    }

    const envio = await enviarTexto(tel, bruto, cred);
    if (!envio.ok) {
      // O erro do provedor nunca leva a URL (ela tem o token da instância).
      console.error("whatsapp-responder: envio falhou:", envio.erro);
      const code = envio.erro === "inalcancavel" ? "provider_unreachable" : "provider_error";
      return json({ success: false, error: "Não foi possível enviar pelo WhatsApp", code }, 502);
    }
    return json({ success: true, to: tel, id: envio.id || null });
  } catch (err) {
    console.error("whatsapp-responder:", (err as Error).message);
    return json({ error: "Erro interno", code: "internal" }, 500);
  }
}

export default { fetch: withSupabase({ auth: "user" }, handle) };
