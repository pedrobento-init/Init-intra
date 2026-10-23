// supabase/functions/pendencia-responder/index.ts
// Edge Function: responde ao solicitante do chamado por e-mail, na mesma
// conversa em que ele escreveu. É o caminho de volta da triagem (robo/campo.ts).
//
// CONFIGURAÇÃO: usa os secrets que a send-email já exige —
//   GMAIL_USER / GMAIL_APP_PASSWORD / GMAIL_FROM (opcional)
//   supabase functions deploy pendencia-responder
//
// POR QUE NÃO É A send-email: aquela só manda para operador ativo, e é de
// propósito — a chave pública vai no site, então sem a trava qualquer um
// mandaria e-mail em nome do domínio para qualquer endereço. Aqui a trava não
// afrouxa, muda de critério: o app NUNCA escolhe o destinatário. Manda
// `pendencia_id`, e o endereço sai do `solicitante_email` daquele chamado,
// lido com a chave de serviço. Quem não está no chamado não recebe nada.
//
// MESMA CONVERSA: o `email_message_id` guardado na triagem (064) volta como
// In-Reply-To e References. Sem ele o e-mail sai assim mesmo, só começa uma
// conversa nova na caixa do cliente — por isso é aviso, não erro.

import { type SupabaseContext, withSupabase } from "npm:@supabase/server@1";
import nodemailer from "npm:nodemailer@6.9.16";

const GMAIL_USER = Deno.env.get("GMAIL_USER") ?? "";
const GMAIL_APP_PASSWORD = (Deno.env.get("GMAIL_APP_PASSWORD") ?? "").replace(/\s+/g, "");
const GMAIL_FROM = Deno.env.get("GMAIL_FROM") || GMAIL_USER;
const FROM_NAME = "Init Intra";
const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
const TEXTO_MAX = 20000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Texto do técnico vira HTML simples: parágrafo por linha em branco, quebra por linha. */
function corpoHtml(texto: string, assinatura: string): string {
  const paragrafos = texto.split(/\n{2,}/).map((p) =>
    `<p style="margin:0 0 12px">${escapeHtml(p.trim()).replace(/\n/g, "<br>")}</p>`
  ).join("");
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111">`
    + paragrafos
    + `<p style="margin:24px 0 0;padding-top:12px;border-top:1px solid #ddd;color:#666;font-size:12px">`
    + escapeHtml(assinatura) + `</p></div>`;
}

/** `Re:` só uma vez, por mais que o assunto já venha respondido. */
function assuntoResposta(assunto: string): string {
  const limpo = String(assunto || "").trim() || "Seu chamado";
  return (/^re:\s*/i.test(limpo) ? limpo : "Re: " + limpo).slice(0, 300);
}

async function handle(req: Request, ctx: SupabaseContext): Promise<Response> {
  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    // Só operador ativo logado — mesma porta da send-email.
    const uid = ctx.userClaims?.id ?? null;
    const { data: op } = uid
      ? await ctx.supabase.from("operators").select("id,name,active").eq("auth_user_id", uid).maybeSingle()
      : { data: null };
    if (!op || op.active === false) return json({ error: "Não autorizado", code: "unauthorized" }, 401);

    if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
      console.error("GMAIL_USER/GMAIL_APP_PASSWORD não configurados como secrets no Supabase");
      return json({ error: "GMAIL_USER ou GMAIL_APP_PASSWORD não configurados no Supabase", code: "missing_credentials" }, 500);
    }

    const { pendencia_id, text } = await req.json();
    const id = String(pendencia_id || "").trim();
    const texto = String(text ?? "").trim();
    if (!id) return json({ error: "pendencia_id obrigatório", code: "missing_pendencia" }, 400);
    if (!texto) return json({ error: "Escreva a resposta antes de enviar", code: "empty_text" }, 400);
    if (texto.length > TEXTO_MAX) return json({ error: "Resposta longa demais", code: "text_too_long" }, 400);

    // Lido com a chave de serviço: o destinatário não pode depender do que o
    // app mandou nem do que o RLS deixou o chamador enxergar.
    const { data: pen, error: penErr } = await ctx.supabaseAdmin
      .from("pendencias")
      .select("id, assunto, solicitante, solicitante_email, email_message_id, client_name")
      .eq("id", id).maybeSingle();
    if (penErr) {
      console.error("pendencia-responder: leitura do chamado:", penErr.message);
      return json({ error: "Não foi possível ler o chamado", code: "pendencia_read" }, 500);
    }
    if (!pen) return json({ error: "Chamado não encontrado", code: "pendencia_not_found" }, 404);

    const destino = String(pen.solicitante_email || "").trim().toLowerCase();
    if (!destino) {
      return json({ error: "Este chamado não tem e-mail de quem pediu", code: "no_requester_email" }, 422);
    }
    if (!EMAIL_RE.test(destino)) {
      console.error("pendencia-responder: solicitante_email inválido no chamado", id);
      return json({ error: "O e-mail de quem pediu está inválido", code: "invalid_requester_email" }, 422);
    }

    const refId = String(pen.email_message_id || "").trim();
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    });

    try {
      const info = await transporter.sendMail({
        from: { name: FROM_NAME, address: GMAIL_FROM },
        to: destino,
        subject: assuntoResposta(String(pen.assunto || "")),
        html: corpoHtml(texto, `${op.name || "Equipe Init"} — Suporte Init`),
        text: texto,
        ...(refId ? { inReplyTo: refId, references: [refId] } : {}),
      });
      return json({
        success: true,
        to: destino,
        threaded: !!refId,       // false = foi como conversa nova, sem o Message-ID
        id: info.messageId,
      });
    } catch (e) {
      const err = e as { code?: string; responseCode?: number; response?: string; message?: string };
      console.error("Gmail SMTP error:", err.code, err.responseCode, err.response || err.message);
      return json({
        success: false,
        error: err.response || err.message || "Erro ao enviar e-mail",
        code: err.code || "smtp_error",
        smtpCode: err.responseCode || null,
      }, 502);
    } finally {
      transporter.close();
    }
  } catch (err) {
    console.error("Erro na Edge Function:", err);
    return json({ error: (err as Error).message || "Erro interno" }, 500);
  }
}

export default { fetch: withSupabase({ auth: "user" }, handle) };
