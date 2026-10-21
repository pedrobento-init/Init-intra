// supabase/functions/ia-levar/index.ts
// Edge Function: sugere o que levar para a visita, a partir do motivo, das
// observações, das últimas visitas do cliente e do inventário dele.
// As regras palavras-chave → itens (058) continuam valendo e resolvem o caso
// comum na hora; isto aqui é a segunda opinião, só quando o técnico pede.
// Devolve sugestão: quem monta a lista é o técnico, no formulário.
//
// A IA fica no Make, no mesmo cenário do briefing (rota "levar") — veja
// GOOGLE-AGENDA.md → "IA pelo Make".
//
// CONFIGURAÇÃO:
//   supabase secrets set IA_WEBHOOK_URL=<URL do Custom webhook do Make>
//   supabase functions deploy ia-levar
//
// CONTRATO
//   POST { client_id?, cliente?, motivo?, observacoes?, lista?: string[] }
//   → { success: true, itens: string[] } | { error }
//
// SEGURANÇA / PRIVACIDADE
// - Só operador ativo autenticado (JWT → operators), mesma base do RLS.
// - Vão para o Make o nome do cliente, o motivo, as observações, os
//   relatórios das últimas visitas (300 caracteres cada) e o inventário
//   resumido. Sem senhas, tokens, IP ou MAC.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.113.0";
import { itensDaIa } from "../robo/campo.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const IA_WEBHOOK_URL = Deno.env.get("IA_WEBHOOK_URL") ?? "";

const MAX_ITENS = 6;          // igual ao limite pedido no prompt da rota
const VISITAS_HISTORICO = 3;
const DEVICES = 10;
const TIMEOUT_MS = 45000;

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

const dateBR = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const limpo = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Últimas visitas concluídas e inventário ativo do cliente, em texto para o prompt. */
async function contextoDoCliente(db: SupabaseClient, clientId: string): Promise<string[]> {
  const linhas: string[] = [];
  const [visitas, devices] = await Promise.all([
    db.from("visits").select("date, motivo, relatorio").eq("client_id", clientId).eq("status", "concluida")
      .order("date", { ascending: false }).limit(VISITAS_HISTORICO),
    db.from("client_devices").select("apelido, hostname, marca, sistema_operacional")
      .eq("client_id", clientId).neq("is_ativo", false).limit(DEVICES),
  ]);
  const vis = (visitas.data || []).filter((v) => /^\d{4}-\d{2}-\d{2}/.test(String(v.date || "")));
  if (vis.length) {
    linhas.push("Últimas visitas concluídas:");
    for (const v of vis) {
      const rel = limpo(v.relatorio, 300);
      linhas.push(`- ${dateBR(String(v.date))}: ${limpo(v.motivo, 120) || "sem motivo"}${rel ? ` — relatório: ${rel}` : ""}`);
    }
  }
  const devs = (devices.data || [])
    .map((d) => {
      const nome = limpo(d.apelido, 60) || limpo(d.hostname, 60);
      const extra = [limpo(d.marca, 40), limpo(d.sistema_operacional, 40)].filter(Boolean).join(", ");
      return nome ? `- ${nome}${extra ? ` (${extra})` : ""}` : "";
    })
    .filter(Boolean);
  if (devs.length) linhas.push("Inventário do cliente (dispositivos ativos):", ...devs);
  return linhas;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !IA_WEBHOOK_URL) {
    console.error("ia-levar: secrets ausentes");
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

  let clientId = "", cliente = "", motivo = "", observacoes = "";
  let lista: string[] = [];
  try {
    const body = await req.json();
    clientId = limpo(body?.client_id, 80);
    cliente = limpo(body?.cliente, 120);
    motivo = limpo(body?.motivo, 300);
    observacoes = limpo(body?.observacoes, 2000);
    lista = Array.isArray(body?.lista) ? body.lista.map((x: unknown) => limpo(x, 120)).filter(Boolean).slice(0, 40) : [];
  } catch {
    return json({ error: "Corpo inválido" }, 400);
  }
  if (!motivo && !observacoes) return json({ error: "Escreva o motivo ou as observações da visita primeiro." }, 400);

  const linhas = [
    cliente ? `Cliente: ${cliente}` : "",
    motivo ? `Motivo da visita: ${motivo}` : "",
    observacoes ? `Observações da visita: ${observacoes}` : "",
    lista.length ? `Já está na lista do técnico: ${lista.join(", ")}` : "",
  ].filter(Boolean);
  if (clientId) {
    try {
      linhas.push(...await contextoDoCliente(admin, clientId));
    } catch (e) {
      console.error("ia-levar: histórico do cliente:", (e as Error).message);  // sugere sem o histórico
    }
  }

  let res: Response;
  try {
    res = await fetch(IA_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tarefa: "levar", contexto: linhas.join("\n").slice(0, 4000) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    console.error("ia-levar: Make não respondeu:", (e as Error).name);
    return json({ error: "A IA demorou para responder. Tente de novo." }, 504);
  }
  if (res.status === 429) return json({ error: "IA ocupada agora. Tente em instantes." }, 429);
  if (!res.ok) {
    console.error(`ia-levar: Make respondeu ${res.status}`);
    return json({ error: "Falha ao sugerir os itens." }, 502);
  }
  const itens = itensDaIa(await res.text(), lista, MAX_ITENS);
  console.log(`ia-levar: op=${op.id} lista=${lista.length} sugeridos=${itens.length}`);
  return json({ success: true, itens });
});
