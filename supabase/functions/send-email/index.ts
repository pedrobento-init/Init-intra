// supabase/functions/send-email/index.ts
// Edge Function para envio de e-mails pelo Gmail do Google Workspace (SMTP)
//
// CONFIGURAÇÃO (secrets — nunca no código):
// 1. Na conta Google que vai enviar: verificação em duas etapas ligada e uma
//    senha de app gerada em https://myaccount.google.com/apppasswords
// 2. supabase secrets set GMAIL_USER=conta@initnet.com.br
//    supabase secrets set GMAIL_APP_PASSWORD=xxxxxxxxxxxxxxxx
//    Opcional (alias configurado em "Enviar e-mail como" no Gmail):
//    supabase secrets set GMAIL_FROM=notificacoes@initnet.com.br
// 3. Deploy: supabase functions deploy send-email
//
// Porta 465 (SSL): o Supabase bloqueia saída nas portas 25 e 587.
// Limite do Gmail Workspace: ~2.000 mensagens/dia por conta.
//
// SEGURANÇA: só um operador ativo logado envia. A anon key é pública (vai no
// site), então sem esta checagem qualquer um usaria o domínio para mandar
// e-mail para qualquer endereço. O remetente é fixo (o app não escolhe).
// DIAGNÓSTICO: o erro do Gmail volta (code + mensagem) para o app, que mostra
// no "Enviar e-mail de teste" e grava em Erros do app.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.16";

const GMAIL_USER = Deno.env.get("GMAIL_USER") ?? "";
const GMAIL_APP_PASSWORD = (Deno.env.get("GMAIL_APP_PASSWORD") ?? "").replace(/\s+/g, "");
const GMAIL_FROM = Deno.env.get("GMAIL_FROM") || GMAIL_USER;
const FROM_NAME = "Init Intra";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-api-version, x-supabase-client-platform",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    // Só operador ativo logado (o JWT da anon key não tem usuário).
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      auth: { persistSession: false },
    });
    const { data: userData } = await sb.auth.getUser();
    const { data: op } = userData?.user
      ? await sb.from("operators").select("id,active").eq("auth_user_id", userData.user.id).maybeSingle()
      : { data: null };
    if (!op || op.active === false) return json({ error: "Não autorizado", code: "unauthorized" }, 401);

    if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
      console.error("GMAIL_USER/GMAIL_APP_PASSWORD não configurados como secrets no Supabase");
      return json({ error: "GMAIL_USER ou GMAIL_APP_PASSWORD não configurados no Supabase", code: "missing_credentials" }, 500);
    }

    const { to, subject, html } = await req.json();

    const recipients = Array.isArray(to) ? to.map((t) => String(t || "").trim()).filter(Boolean) : [];
    if (recipients.length === 0) return json({ error: "Destinatário(s) obrigatório(s)" }, 400);
    if (recipients.length > 100 || recipients.some((r) => !EMAIL_RE.test(r))) {
      return json({ error: "Destinatário inválido" }, 400);
    }
    if (!subject || !html) return json({ error: "Assunto e corpo do e-mail obrigatórios" }, 400);

    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    });

    try {
      const info = await transporter.sendMail({
        from: { name: FROM_NAME, address: GMAIL_FROM },
        to: recipients,
        subject: String(subject).slice(0, 300),
        html: String(html),
      });
      return json({ success: true, message: `${recipients.length} e-mail(s) enviado(s) com sucesso`, id: info.messageId });
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
});
