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
// Destinatário só pode ser e-mail de operador ativo cadastrado (lido com
// service_role, sem depender do RLS): nem um login válido manda e-mail para
// fora da empresa em nome do Init Intra.
// DIAGNÓSTICO: o erro do Gmail volta (code + mensagem) para o app, que mostra
// no "Enviar e-mail de teste" e grava em Erros do app.

import { type SupabaseContext, withSupabase } from "npm:@supabase/server@1";
import nodemailer from "npm:nodemailer@6.9.16";

const GMAIL_USER = Deno.env.get("GMAIL_USER") ?? "";
const GMAIL_APP_PASSWORD = (Deno.env.get("GMAIL_APP_PASSWORD") ?? "").replace(/\s+/g, "");
const GMAIL_FROM = Deno.env.get("GMAIL_FROM") || GMAIL_USER;
const FROM_NAME = "Init Intra";
// CORS e preflight ficam com o withSupabase: sem `allowedHeaders` na config,
// ele ecoa os headers pedidos no preflight — os que o supabase-js envia.

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

async function handle(req: Request, ctx: SupabaseContext): Promise<Response> {

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    // Só operador ativo logado. ctx.supabase é o client DO CHAMADOR (RLS
    // aplica), equivalente ao antigo anon + Authorization repassado;
    // ctx.supabaseAdmin, mais abaixo, é o que bypassa.
    const uid = ctx.userClaims?.id ?? null;
    const { data: op } = uid
      ? await ctx.supabase.from("operators").select("id,active").eq("auth_user_id", uid).maybeSingle()
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

    const admin = ctx.supabaseAdmin;
    const { data: ops, error: opsErr } = await admin.from("operators").select("email, active").not("email", "is", null);
    if (opsErr) return json({ error: "Não foi possível conferir os destinatários", code: "recipients_check" }, 500);
    const allowed = new Set(
      (ops ?? []).filter((o) => o.active !== false).map((o) => String(o.email || "").trim().toLowerCase()).filter(Boolean),
    );
    const blocked = recipients.filter((r) => !allowed.has(r.toLowerCase()));
    if (blocked.length) {
      return json({ error: "Destinatário fora da lista de operadores ativos: " + blocked.join(", "), code: "recipient_not_allowed" }, 403);
    }

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
}

export default { fetch: withSupabase({ auth: "user" }, handle) };
