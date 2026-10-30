// supabase/functions/caixa-responder/index.ts
// Edge Function: responde, da Caixa de entrada (#caixa), a um e-mail que ainda
// não virou chamado. Irmã da pendencia-responder, com a mesma trava.
//
// CONFIGURAÇÃO: os mesmos secrets da send-email —
//   GMAIL_USER / GMAIL_APP_PASSWORD / GMAIL_FROM (opcional)
//   supabase functions deploy caixa-responder
//
// O APP NUNCA ESCOLHE O DESTINATÁRIO: manda só `email_id` (emails_triagem.id),
// e o endereço sai do `de` daquela linha. Sem isso a chave pública do site
// viraria um relay de e-mail em nome do domínio.
//
// PERMISSÃO: a linha é lida com o cliente do usuário, não com a chave de
// serviço. Quem não enxerga o e-mail pelo RLS (outra equipe) recebe 404 e não
// responde — a regra de equipe da caixa vale também para a resposta.
//
// MESMA CONVERSA: o `message_id` da linha vai como In-Reply-To e References.
// Sem ele o e-mail sai assim mesmo, só abre conversa nova na caixa do cliente.
//
// REGISTRO: a resposta enviada vira LINHA nova em emails_triagem (status
// 'respondido', team da linha de origem) e as pendentes do thread também viram
// respondido — responder é decidir, como abrir chamado ou descartar. Exige a
// migration 074; sem ela o envio sai e a gravação falha, que volta
// `registrado: false` para a tela avisar (e-mail que já saiu não se desfaz).
// Só linha 'pendente' é respondida: card velho ou duplo clique não manda duas
// vezes o mesmo e-mail.

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

/** `de` chega como "Nome <email>" ou só "email": fica o que está entre <>. */
function enderecoDe(de: string): string {
  const s = String(de || "").trim();
  const m = s.match(/<([^<>]+)>\s*$/);
  return (m ? m[1] : s).trim().toLowerCase();
}

function corpoHtml(texto: string, assinatura: string): string {
  const paragrafos = texto.split(/\n{2,}/).map((p) =>
    `<p style="margin:0 0 12px">${escapeHtml(p.trim()).replace(/\n/g, "<br>")}</p>`
  ).join("");
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111">`
    + paragrafos
    + `<p style="margin:24px 0 0;padding-top:12px;border-top:1px solid #ddd;color:#666;font-size:12px">`
    + escapeHtml(assinatura) + `</p></div>`;
}

function assuntoResposta(assunto: string): string {
  const limpo = String(assunto || "").trim() || "Sua mensagem";
  return (/^re:\s*/i.test(limpo) ? limpo : "Re: " + limpo).slice(0, 300);
}

async function handle(req: Request, ctx: SupabaseContext): Promise<Response> {
  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const uid = ctx.userClaims?.id ?? null;
    const { data: op } = uid
      ? await ctx.supabase.from("operators").select("id,name,active").eq("auth_user_id", uid).maybeSingle()
      : { data: null };
    if (!op || op.active === false) return json({ error: "Não autorizado", code: "unauthorized" }, 401);

    if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
      console.error("GMAIL_USER/GMAIL_APP_PASSWORD não configurados como secrets no Supabase");
      return json({ error: "GMAIL_USER ou GMAIL_APP_PASSWORD não configurados no Supabase", code: "missing_credentials" }, 500);
    }

    const { email_id, text } = await req.json();
    const id = String(email_id || "").trim();
    const texto = String(text ?? "").trim();
    if (!id) return json({ error: "email_id obrigatório", code: "missing_email" }, 400);
    if (!texto) return json({ error: "Escreva a resposta antes de enviar", code: "empty_text" }, 400);
    if (texto.length > TEXTO_MAX) return json({ error: "Resposta longa demais", code: "text_too_long" }, 400);

    // Cliente do usuário de propósito: o RLS da caixa é a regra de permissão.
    const { data: row, error: rowErr } = await ctx.supabase
      .from("emails_triagem")
      .select("id, de, assunto, message_id, thread_id, pendencia_id, client_id, team, status")
      .eq("id", id).maybeSingle();
    if (rowErr) {
      console.error("caixa-responder: leitura do e-mail:", rowErr.message);
      return json({ error: "Não foi possível ler o e-mail", code: "email_read" }, 500);
    }
    if (!row) return json({ error: "E-mail não encontrado", code: "email_not_found" }, 404);
    if (row.status !== "pendente") {
      return json({ error: "Esta conversa já foi tratada", code: "already_handled" }, 422);
    }

    const destino = enderecoDe(row.de);
    if (!EMAIL_RE.test(destino)) {
      console.error("caixa-responder: remetente inválido no e-mail", id);
      return json({ error: "O remetente deste e-mail está inválido", code: "invalid_sender" }, 422);
    }

    const refId = String(row.message_id || "").trim();
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
        subject: assuntoResposta(String(row.assunto || "")),
        html: corpoHtml(texto, `${op.name || "Equipe Init"} — Suporte Init`),
        text: texto,
        ...(refId ? { inReplyTo: refId, references: [refId] } : {}),
      });

      // A resposta vira linha na conversa, e as pendentes do thread fecham com
      // 'respondido': a conversa sai de "Aguardando decisão" porque responder
      // É decidir. Escrita com o cliente do operador — o RLS por equipe da 066
      // continua valendo do começo ao fim.
      const agora = new Date().toISOString();
      const { error: insErr } = await ctx.supabase.from("emails_triagem").insert({
        id: crypto.randomUUID(),
        email_id: info.messageId,
        thread_id: row.thread_id || null,
        message_id: info.messageId,
        de: op.name ? `${op.name} <${GMAIL_FROM}>` : GMAIL_FROM,
        assunto: assuntoResposta(String(row.assunto || "")),
        corpo: texto,
        recebido_em: agora,
        motivo: null,
        status: "respondido",
        pendencia_id: row.pendencia_id || null,
        client_id: row.client_id || null,
        team: row.team || "init",
        tratado_por: op.name || null,
        tratado_em: agora,
      });
      if (insErr) console.error("caixa-responder: registro da resposta:", insErr.message);

      let fechar = ctx.supabase
        .from("emails_triagem")
        .update({ status: "respondido", tratado_por: op.name || null, tratado_em: agora, updated_at: agora });
      fechar = row.thread_id
        ? fechar.eq("thread_id", row.thread_id).eq("status", "pendente")
        : fechar.eq("id", row.id).eq("status", "pendente");
      const { error: updErr } = await fechar;
      if (updErr) console.error("caixa-responder: fechamento das pendentes:", updErr.message);

      // O e-mail JÁ saiu: falha de gravação não desfaz o envio, vira aviso
      // (registrado: false) para a tela dizer o que houve — repetir o envio
      // por causa de um update que falhou mandaria o mesmo e-mail duas vezes.
      return json({
        success: true,
        to: destino,
        threaded: !!refId,
        registrado: !insErr && !updErr,
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
