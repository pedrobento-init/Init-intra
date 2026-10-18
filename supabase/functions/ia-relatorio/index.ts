// supabase/functions/ia-relatorio/index.ts
// Edge Function: transforma as anotações soltas do técnico num relatório de
// visita pronto para o cliente (português, claro, sem jargão desnecessário).
// O técnico revisa e edita antes de salvar — a IA nunca grava nada sozinha.
//
// CONFIGURAÇÃO:
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//   supabase functions deploy ia-relatorio
//
// CONTRATO
//   POST { notas: string, cliente?: string, motivo?: string, checklist?: string[] }
//   → { success: true, relatorio: string } | { error }
//
// SEGURANÇA / PRIVACIDADE
// - Só operador ativo autenticado (JWT → operators), mesma base do RLS.
// - Texto limitado a 6.000 caracteres; nada é salvo aqui nem logado (o log
//   registra só tamanhos). As anotações vão para a API da Anthropic — não
//   coloque senhas nas anotações (o app avisa no botão).
// - Sem rate limit próprio (como as outras funções, SEC-16): monitorar uso.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0.131.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

const MAX_CHARS = 6000;

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

const SYSTEM = `Você escreve relatórios de visita técnica de uma empresa de suporte de TI para o cliente final.
Recebe as anotações rápidas do técnico (abreviadas, fora de ordem, às vezes com gírias técnicas) e devolve o relatório.

Regras:
- Português do Brasil, tom profissional e direto, frases curtas. O leitor é o cliente, não um técnico.
- Use só o que está nas anotações. Não invente equipamentos, números, causas ou resultados. Se algo ficou pendente ou incerto nas anotações, diga que ficou pendente.
- Estrutura, em texto simples (sem Markdown, sem asteriscos, sem cabeçalhos com #):
  Resumo: uma ou duas frases.
  O que foi feito: lista com hífens, um item por ação, no passado.
  Pendências e recomendações: lista com hífens; omita a seção se não houver nada.
- Termos técnicos indispensáveis podem ficar, com uma explicação curta entre parênteses na primeira vez.
- Nunca inclua senhas, tokens ou chaves que apareçam nas anotações; escreva "[credencial omitida]".
- Responda apenas com o relatório.`;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANTHROPIC_API_KEY) {
    console.error("ia-relatorio: secrets ausentes");
    return json({ error: "IA não configurada" }, 500);
  }

  const callerToken = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!callerToken) return json({ error: "Não autenticado" }, 401);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: userData } = await admin.auth.getUser(callerToken);
  const uid = userData?.user?.id ?? null;
  if (!uid) return json({ error: "Não autenticado" }, 401);
  const { data: op } = await admin.from("operators").select("id, active").eq("auth_user_id", uid).maybeSingle();
  if (!op || op.active === false) return json({ error: "Operador sem acesso" }, 403);

  let notas = "", cliente = "", motivo = "";
  let checklist: string[] = [];
  try {
    const body = await req.json();
    notas = String(body?.notas ?? "").trim();
    cliente = String(body?.cliente ?? "").trim().slice(0, 120);
    motivo = String(body?.motivo ?? "").trim().slice(0, 300);
    checklist = Array.isArray(body?.checklist) ? body.checklist.map((x: unknown) => String(x).slice(0, 200)).slice(0, 40) : [];
  } catch {
    return json({ error: "Corpo inválido" }, 400);
  }
  if (notas.length < 10) return json({ error: "Escreva pelo menos uma linha sobre o que foi feito." }, 400);
  if (notas.length > MAX_CHARS) return json({ error: `Anotações muito longas (máx. ${MAX_CHARS} caracteres).` }, 400);

  const contexto = [
    cliente ? `Cliente: ${cliente}` : "",
    motivo ? `Motivo da visita: ${motivo}` : "",
    checklist.length ? `Itens do checklist concluídos:\n- ${checklist.join("\n- ")}` : "",
    `Anotações do técnico:\n${notas}`,
  ].filter(Boolean).join("\n\n");

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  try {
    // Fallback no servidor: se o modelo recusar por política, a própria API
    // refaz no modelo indicado para a categoria (sem lista de modelos aqui).
    // deno-lint-ignore no-explicit-any
    const params: any = {
      model: "claude-opus-5-5",
      max_tokens: 4000,
      output_config: { effort: "low" }, // reescrita curta: low basta e responde rápido
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      messages: [{ role: "user", content: contexto }],
    };
    const msg = await client.beta.messages.create(params);
    if (msg.stop_reason === "refusal") {
      return json({ error: "A IA não conseguiu gerar este relatório. Escreva manualmente." }, 422);
    }
    const relatorio = msg.content
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { type: string; text?: string }) => b.text ?? "")
      .join("\n")
      .trim();
    if (!relatorio) return json({ error: "Resposta vazia da IA." }, 502);
    console.log(`ia-relatorio: op=${op.id} in_chars=${notas.length} out_chars=${relatorio.length} stop=${msg.stop_reason}`);
    return json({ success: true, relatorio, truncado: msg.stop_reason === "max_tokens" });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json({ error: "IA ocupada agora. Tente em instantes." }, 429);
    if (e instanceof Anthropic.AuthenticationError) {
      console.error("ia-relatorio: ANTHROPIC_API_KEY inválida");
      return json({ error: "IA não configurada" }, 500);
    }
    if (e instanceof Anthropic.APIError) {
      console.error(`ia-relatorio: API ${e.status}`);
      return json({ error: "Falha ao gerar o relatório." }, 502);
    }
    console.error("ia-relatorio: rede");
    return json({ error: "Falha de conexão com a IA." }, 502);
  }
});
