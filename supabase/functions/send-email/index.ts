// supabase/functions/send-email/index.ts
// Edge Function para envio de e-mails via Resend
//
// CONFIGURAÇÃO:
// 1. Crie uma conta no Resend (https://resend.com)
// 2. Adicione a API key como secrets no Supabase:
//    supabase secrets set RESEND_API_KEY=re_xxxxxxxxxxxxx
// 3. Verifique o domínio no Resend e configure o FROM email
// 4. Deploy: supabase functions deploy send-email

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Only allow POST
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Method not allowed" }),
        { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify API key exists
    if (!RESEND_API_KEY) {
      console.error("RESEND_API_KEY não configurada como secret no Supabase");
      return new Response(
        JSON.stringify({ error: "Serviço de e-mail não configurado" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { from, to, subject, html } = await req.json();

    // Validate input
    if (!to || !Array.isArray(to) || to.length === 0) {
      return new Response(
        JSON.stringify({ error: "Destinatário(s) obrigatório(s)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!subject || !html) {
      return new Response(
        JSON.stringify({ error: "Assunto e corpo do e-mail obrigatórios" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Limit: Resend free tier = 100/day, 3000/month
    // Send in batches if many recipients
    const results = [];
    const batchSize = 50;

    for (let i = 0; i < to.length; i += batchSize) {
      const batch = to.slice(i, i + batchSize);

      const resendResponse = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: from || "Init Intra <notificacoes@initnet.com.br>",
          to: batch,
          subject,
          html,
        }),
      });

      const data = await resendResponse.json();

      if (!resendResponse.ok) {
        console.error("Resend API error:", data);
        results.push({ error: data.message || "Erro ao enviar e-mail", status: resendResponse.status });
      } else {
        results.push({ success: true, id: data.id });
      }
    }

    const hasError = results.some((r) => r.error);
    const hasSuccess = results.some((r) => r.success);

    return new Response(
      JSON.stringify({
        success: hasSuccess,
        message: hasError
          ? `${results.filter((r) => r.success).length}/${results.length} e-mails enviados`
          : `${results.length} e-mail(s) enviado(s) com sucesso`,
        results,
      }),
      {
        status: hasSuccess ? 200 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("Erro na Edge Function:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Erro interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
