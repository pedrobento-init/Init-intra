// Resposta e nota interna de uma conversa da caixa, sem exigir chamado.
// O destino sai da última mensagem recebida no thread, nunca do navegador.
//
// LIMITE CONHECIDO — no e-mail não existe prova de contato como a
// whatsapp_conversas (076). O destino sai da última mensagem de entrada, mas
// quem pode inserir em emails_triagem (RLS por equipe) consegue criar uma linha
// de entrada com o "de" de um terceiro e usar a caixa para escrever em nome da
// empresa. Fechar de verdade exige gravar toda mensagem recebida numa tabela de
// prova, como a 076 fez para o WhatsApp; até lá isto é saída autenticada de
// e-mail, não um relay aberto — e é dívida registrada, não detalhe.
import { type SupabaseContext, withSupabase } from "npm:@supabase/server@1";
import nodemailer from "npm:nodemailer@6.9.16";
import { enviarTexto } from "../whatsapp/provedor.ts";

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
const TEXTO_MAX = 20000;
const ARQUIVO_BASE64_MAX = 7_000_000;

type Midia = { nome: string; tipo: string; dados: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function enderecoDe(de: unknown): string {
  const bruto = String(de || "");
  const m = /<([^>]+)>/.exec(bruto);
  const end = (m ? m[1] : bruto).trim().toLowerCase();
  return EMAIL_RE.test(end) ? end : "";
}

function assuntoResposta(assunto: unknown): string {
  const limpo = String(assunto || "").trim() || "Atendimento";
  return (/^re:\s*/i.test(limpo) ? limpo : "Re: " + limpo).slice(0, 300);
}

function midiaDoBody(valor: unknown): Midia | null {
  if (!valor || typeof valor !== "object") return null;
  const m = valor as Record<string, unknown>;
  const dados = String(m.dados || "");
  const base64 = dados.includes(",") ? dados.slice(dados.indexOf(",") + 1) : dados;
  if (!base64 || base64.length > ARQUIVO_BASE64_MAX || !/^[A-Za-z0-9+/=\r\n]+$/.test(base64)) throw new Error("invalid_file");
  return { nome: String(m.nome || "arquivo").slice(0, 120), tipo: String(m.tipo || "application/octet-stream").slice(0, 120), dados: base64 };
}

async function handle(req: Request, ctx: SupabaseContext): Promise<Response> {
  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const uid = ctx.userClaims?.id ?? null;
    const { data: op } = uid
      ? await ctx.supabase.from("operators").select("id,name,active").eq("auth_user_id", uid).maybeSingle()
      : { data: null };
    if (!op || op.active === false) return json({ error: "Não autorizado", code: "unauthorized" }, 401);

    const body = await req.json();
    const thread = String(body.thread_id || "").trim();
    const texto = String(body.text ?? "").trim();
    const interna = body.kind === "internal";
    if (!thread) return json({ error: "Conversa obrigatória", code: "missing_thread" }, 400);
    if (texto.length > TEXTO_MAX) return json({ error: "Texto longo demais", code: "text_too_long" }, 400);
    let midia: Midia | null = null;
    try { midia = midiaDoBody(body.file); } catch { return json({ error: "Arquivo inválido ou maior que 5 MB", code: "invalid_file" }, 400); }
    if (!texto && !midia) return json({ error: "Escreva uma mensagem ou escolha um arquivo", code: "empty_text" }, 400);

    const { data: visivel, error: visErr } = await ctx.supabase.from("emails_triagem")
      .select("id").eq("thread_id", thread).eq("direcao", "entrada").order("recebido_em", { ascending: false }).limit(1).maybeSingle();
    if (visErr) return json({ error: "Não foi possível ler a conversa", code: "thread_read" }, 500);
    if (!visivel) return json({ error: "Conversa não encontrada", code: "thread_not_found" }, 404);
    const { data: ultima, error } = await ctx.supabaseAdmin.from("emails_triagem")
      .select("id, thread_id, message_id, de, assunto, team, client_id, pendencia_id, canal, telefone")
      .eq("id", visivel.id).maybeSingle();
    if (error || !ultima) return json({ error: "Conversa não encontrada", code: "thread_not_found" }, 404);

    let providerId: string | null = null;
    if (!interna && ultima.canal === "whatsapp") {
      const telefone = String(ultima.telefone || "").replace(/\D/g, "");
      const { data: contato } = await ctx.supabaseAdmin.from("whatsapp_conversas").select("telefone").eq("telefone", telefone).maybeSingle();
      if (!contato) return json({ error: "Este número nunca escreveu para a empresa", code: "not_whatsapp_contact" }, 422);
      const baseUrl = (Deno.env.get("WAHA_BASE_URL") || "").replace(/\/+$/, "");
      const apiKey = Deno.env.get("WAHA_API_KEY") || "";
      const session = Deno.env.get("WAHA_SESSION") || "default";
      if (!baseUrl || !apiKey) return json({ error: "WhatsApp não configurado", code: "missing_credentials" }, 500);
      if (!midia) {
        const envio = await enviarTexto(telefone, texto, { baseUrl, apiKey, session });
        if (!envio.ok) return json({ error: "Não foi possível enviar pelo WhatsApp", code: "provider_error" }, 502);
        providerId = envio.id || null;
      } else {
        const endpoint = midia.tipo.startsWith("image/") ? "sendImage" : midia.tipo.startsWith("audio/") ? "sendVoice" : "sendFile";
        const payload: Record<string, unknown> = { session, chatId: telefone + "@c.us", file: { mimetype: midia.tipo, filename: midia.nome, data: midia.dados } };
        if (endpoint === "sendVoice") payload.convert = true;
        else payload.caption = texto;
        try {
          const resp = await fetch(`${baseUrl}/api/${endpoint}`, {
            method: "POST", headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
            body: JSON.stringify(payload), signal: AbortSignal.timeout(30000),
          });
          if (!resp.ok) return json({ error: "Não foi possível enviar a mídia", code: "provider_error" }, 502);
          const envio = await resp.json().catch(() => ({}));
          providerId = typeof envio.id === "string" ? envio.id : null;
        } catch { return json({ error: "WAHA inacessível", code: "provider_unreachable" }, 502); }
      }
    } else if (!interna) {
      const destino = enderecoDe(ultima.de);
      if (!destino) return json({ error: "Remetente sem e-mail válido", code: "invalid_requester_email" }, 422);
      const user = Deno.env.get("GMAIL_USER") || "";
      const pass = (Deno.env.get("GMAIL_APP_PASSWORD") || "").replace(/\s+/g, "");
      if (!user || !pass) return json({ error: "E-mail não configurado", code: "missing_credentials" }, 500);
      const transporter = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass } });
      try {
        const info = await transporter.sendMail({
          from: { name: "Init Intra", address: Deno.env.get("GMAIL_FROM") || user }, to: destino,
          subject: assuntoResposta(ultima.assunto), text: texto,
          ...(ultima.message_id ? { inReplyTo: ultima.message_id, references: [ultima.message_id] } : {}),
          ...(midia ? { attachments: [{ filename: midia.nome, content: midia.dados, encoding: "base64", contentType: midia.tipo }] } : {}),
        });
        providerId = info.messageId || null;
      } catch (err) {
        console.error("conversa-responder SMTP:", (err as Error).message);
        return json({ error: "Não foi possível enviar o e-mail", code: "smtp_error" }, 502);
      } finally { transporter.close(); }
    }

    const id = "portal:" + crypto.randomUUID();
    const agora = new Date().toISOString();
    const { error: insertErr } = await ctx.supabaseAdmin.from("emails_triagem").insert({
      id, email_id: id, thread_id: thread, message_id: providerId, de: op.name || "Equipe Init",
      assunto: ultima.assunto, corpo: texto, recebido_em: agora, motivo: null, status: "anexado",
      pendencia_id: ultima.pendencia_id, team: ultima.team, tratado_por: op.name, tratado_em: agora,
      client_id: ultima.client_id, atribuido_a: op.name, atribuido_em: agora, canal: ultima.canal || "email",
      telefone: ultima.telefone, direcao: interna ? "interna" : "saida",
      media: midia ? { nome: midia.nome, tipo: midia.tipo, dados: midia.dados } : null,
      created_at: agora, updated_at: agora,
    });
    if (insertErr) {
      console.error("conversa-responder insert:", insertErr.message);
      return json({ error: interna ? "Não foi possível salvar a nota" : "Enviado, mas não foi possível salvar no histórico", code: "history_write" }, 500);
    }
    // Responder reabre o que estava encerrado: o cliente voltou a falar e isso
    // é atendimento novo. Nota interna não conta — ninguém respondeu ao cliente.
    //
    // O update é com service role, então o escopo de equipe vai explícito: o
    // mesmo thread de WhatsApp pode ter linha em mais de uma equipe, e sem o
    // filtro responder por uma tiraria a conversa da fila da outra.
    let statusQuery = ctx.supabaseAdmin.from("emails_triagem")
      .update({ status: "anexado", updated_at: agora }).eq("thread_id", thread).eq("team", ultima.team);
    statusQuery = interna
      ? statusQuery.eq("status", "pendente")
      : statusQuery.in("status", ["pendente", "encerrado"]);
    const { error: statusErr } = await statusQuery;
    if (statusErr) console.error("conversa-responder status:", statusErr.message);
    return json({ success: true, id });
  } catch (err) {
    console.error("conversa-responder:", (err as Error).message);
    return json({ error: "Erro interno" }, 500);
  }
}

export default { fetch: withSupabase({ auth: "user" }, handle) };
