// supabase/functions/ia-relatorio/index.ts
// Edge Function: transforma as anotações soltas do técnico num relatório de
// visita pronto para o cliente (português, claro, sem jargão desnecessário).
// O técnico revisa e edita antes de salvar — a IA nunca grava nada sozinha.
//
// A IA fica no Make, no mesmo cenário do briefing e da triagem (rota
// "relatorio"); aqui não há chave de IA nenhuma. O prompt está no módulo do
// cenário — veja GOOGLE-AGENDA.md → "IA pelo Make".
//
// CONFIGURAÇÃO:
//   supabase secrets set IA_WEBHOOK_URL=<URL do Custom webhook do Make>
//   supabase functions deploy ia-relatorio
//
// CONTRATO
//   POST { notas: string, cliente?: string, motivo?: string, checklist?: string[] }
//   → { success: true, relatorio: string } | { error }
//
// SEGURANÇA / PRIVACIDADE
// - Só operador ativo autenticado (JWT → operators), mesma base do RLS.
// - Texto limitado a 6.000 caracteres; nada é salvo aqui nem logado (o log
//   registra só tamanhos). As anotações vão para o Make e para o provedor de
//   IA dele — não coloque senhas nas anotações (o app avisa no botão).
// - Sem rate limit próprio (como as outras funções, SEC-16): monitorar uso.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.113.0";
import { textoDaIa } from "../robo/campo.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const IA_WEBHOOK_URL = Deno.env.get("IA_WEBHOOK_URL") ?? "";

const MAX_CHARS = 6000;
const TIMEOUT_MS = 60000;  // o Make leva ~10 s; o técnico espera olhando a tela

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

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !IA_WEBHOOK_URL) {
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

  let res: Response;
  try {
    res = await fetch(IA_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tarefa: "relatorio", contexto }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    console.error("ia-relatorio: Make não respondeu:", (e as Error).name);
    return json({ error: "A IA demorou para responder. Tente de novo." }, 504);
  }
  if (res.status === 429) return json({ error: "IA ocupada agora. Tente em instantes." }, 429);
  if (!res.ok) {
    console.error(`ia-relatorio: Make respondeu ${res.status}`);
    return json({ error: "Falha ao gerar o relatório." }, 502);
  }
  // textoDaIa: aceita texto puro ou { texto }, e descarta o "Accepted" de um
  // cenário sem o módulo "Webhook response".
  const relatorio = textoDaIa(await res.text(), MAX_CHARS + 2000);
  if (!relatorio) return json({ error: "Resposta vazia da IA." }, 502);
  console.log(`ia-relatorio: op=${op.id} in_chars=${notas.length} out_chars=${relatorio.length}`);
  return json({ success: true, relatorio });
});
