// supabase/functions/milvus-atendimentos/index.ts
// Edge Function: proxy para Relatorio Atendimentos Milvus (listagem + exporta)
// Roteamento por action: {action:"list"} -> /relatorio-atendimento/listagem
//                        {action:"export"} -> /relatorio-atendimento/exporta
//
// CONFIG (secrets):
//   supabase secrets set MILVUS_API_TOKEN=...
//   supabase secrets set MILVUS_API_URL=https://apiintegracao.milvus.com.br
//   supabase functions deploy milvus-atendimentos
//
// SEGURANCA:
// - MILVUS_API_TOKEN nunca exposto, nunca logado.
// - "token" dentro de filtro_body é token do CLIENTE (ex: O5NHAA) — valida que
//   pertence a um clients.milvus_client_token do current_op_team() antes de
//   repassar, evitando cross-team.
// - RLS reutilizada: JWT -> operators -> team check (admin passa).
// - Dados transientes: loga team+client_id, não persiste relatório.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MILVUS_API_URL =
  Deno.env.get("MILVUS_API_URL") ?? "https://apiintegracao.milvus.com.br";
const MILVUS_API_TOKEN = Deno.env.get("MILVUS_API_TOKEN") ?? "";

const LISTAGEM_URL = `${MILVUS_API_URL.replace(/\/$/, "")}/api/relatorio-atendimento/listagem`;
const EXPORTA_URL = `${MILVUS_API_URL.replace(/\/$/, "")}/api/relatorio-atendimento/exporta`;

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

function sanitizeIlike(s: unknown): string {
  return String(s ?? "").replace(/[%_\\]/g, "").replace(/[,()]/g, " ").trim().slice(0, 80);
}
function sanitizeDate(s: unknown): string {
  const v = String(s ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
}
function sanitizeCodigo(v: unknown): string {
  const s = String(v ?? "").trim().slice(0, 20);
  // Milvus aceita codigo string ou int; mantém como string sanitizada
  return s.replace(/[^0-9a-zA-Z-_]/g, "").slice(0, 20);
}
function sanitizeToken(v: unknown): string {
  return String(v ?? "").trim().slice(0, 40).replace(/[^a-zA-Z0-9]/g, "");
}
function clampTotalRegistros(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 50;
  const allowed = [50, 100, 200];
  if (allowed.includes(n)) return n;
  // cap 1000, default 50
  if (n <= 50) return 50;
  if (n <= 100) return 100;
  if (n <= 200) return 200;
  return Math.min(1000, Math.max(50, Math.trunc(n)));
}
function normalizeTeam(t: string | null | undefined): string {
  if (!t) return "init";
  const s = String(t).toLowerCase().trim();
  if (s.indexOf("poiesis_") === 0) return "poiesis";
  return s;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("milvus-atendimentos: service role não configurada");
    return json({ error: "Serviço indisponível" }, 500);
  }
  if (!MILVUS_API_TOKEN) {
    console.error("milvus-atendimentos: MILVUS_API_TOKEN não configurado");
    return json({ error: "Integração Milvus não configurada" }, 500);
  }

  const authHeader = req.headers.get("authorization") || "";
  const callerToken = authHeader.replace(/^Bearer\s+/i, "");
  if (!callerToken) return json({ error: "Não autenticado" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: userData } = await admin.auth.getUser(callerToken);
  const callerUid = userData?.user?.id ?? null;
  if (!callerUid) return json({ error: "Não autenticado" }, 401);

  const { data: callerOp } = await admin
    .from("operators")
    .select("id, team, is_admin, active")
    .eq("auth_user_id", callerUid)
    .maybeSingle();
  if (!callerOp || callerOp.active === false) {
    return json({ error: "Operador sem acesso" }, 403);
  }
  const isAdmin = callerOp.is_admin === true;
  const opTeam = callerOp.team || "init";

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Corpo inválido" }, 400);
  }
  const action = String(body?.action ?? "list").toLowerCase();
  if (!["list", "export"].includes(action)) {
    return json({ error: "action deve ser list ou export" }, 400);
  }

  const filtroBodyRaw = (body?.filtro_body ?? body?.filtroBody ?? {}) as Record<string, unknown>;
  const paginaRaw = body?.pagina ?? body?.page;
  const totalRegistrosRaw = body?.total_registros ?? body?.totalRegistros ?? body?.perPage;
  const isDescendingRaw = body?.is_descending ?? body?.isDescending;

  // Sanitização filtros
  const filtro: Record<string, unknown> = {};
  const dataInicial = sanitizeDate(filtroBodyRaw["data_inicial"] ?? filtroBodyRaw["dataInicial"]);
  const dataFinal = sanitizeDate(filtroBodyRaw["data_final"] ?? filtroBodyRaw["dataFinal"]);
  if (dataInicial) filtro["data_inicial"] = dataInicial;
  if (dataFinal) filtro["data_final"] = dataFinal;

  const codigoSan = sanitizeCodigo(filtroBodyRaw["codigo"]);
  if (codigoSan) filtro["codigo"] = codigoSan;

  const tokenSan = sanitizeToken(filtroBodyRaw["token"]);
  if (tokenSan) filtro["token"] = tokenSan;

  const nomeTec = sanitizeIlike(filtroBodyRaw["nome_tecnico"] ?? filtroBodyRaw["nomeTecnico"]);
  if (nomeTec) filtro["nome_tecnico"] = nomeTec;

  const nomeMesa = sanitizeIlike(filtroBodyRaw["nome_mesa"] ?? filtroBodyRaw["nomeMesa"]);
  if (nomeMesa) filtro["nome_mesa"] = nomeMesa;

  if (filtroBodyRaw["is_externo"] !== undefined) filtro["is_externo"] = !!filtroBodyRaw["is_externo"];
  if (filtroBodyRaw["is_comercial"] !== undefined) filtro["is_comercial"] = !!filtroBodyRaw["is_comercial"];
  if (filtroBodyRaw["motivo_pausa"] !== undefined) {
    const mp = sanitizeIlike(filtroBodyRaw["motivo_pausa"]);
    if (mp) filtro["motivo_pausa"] = mp;
  }

  // export: tipo_arquivo
  if (action === "export") {
    const tipo = String(filtroBodyRaw["tipo_arquivo"] ?? filtroBodyRaw["tipoArquivo"] ?? "csv").toLowerCase();
    if (!["csv", "xls", "xlsx"].includes(tipo)) {
      return json({ error: "tipo_arquivo deve ser csv ou xls" }, 400);
    }
    filtro["tipo_arquivo"] = tipo === "xlsx" ? "xls" : tipo;
  }

  // Validação cross-team por token cliente
  let clientIdForLog: string | null = null;
  if (tokenSan) {
    const { data: client } = await admin
      .from("clients")
      .select("id, team, milvus_client_token")
      .eq("milvus_client_token", tokenSan)
      .maybeSingle();
    if (!client) {
      return json({ error: "Token de cliente inválido" }, 403);
    }
    const cliTeam = (client as { team: string | null }).team || "init";
    if (!isAdmin && normalizeTeam(cliTeam) !== normalizeTeam(opTeam)) {
      return json({ error: "Token de cliente não pertence à sua equipe" }, 403);
    }
    clientIdForLog = (client as { id: string }).id;
  }

  console.log(`milvus-atendimentos: action=${action} team=${opTeam} clientId=${clientIdForLog ?? "-"} tokenHas=${!!tokenSan} isAdmin=${isAdmin}`);

  // Monta payload para Milvus
  const milvusBody: Record<string, unknown> = {
    filtro_body: filtro,
  };
  // list: paginacao top-level
  if (action === "list") {
    const pagina = paginaRaw !== undefined ? Math.max(1, Math.trunc(Number(paginaRaw) || 1)) : 1;
    const total = clampTotalRegistros(totalRegistrosRaw);
    const isDesc = isDescendingRaw !== undefined ? !!isDescendingRaw : true;
    milvusBody["pagina"] = pagina;
    milvusBody["total_registros"] = total;
    milvusBody["is_descending"] = isDesc;
    // também envia dentro de filtro_body? não, só top-level conforme spec
  }

  const targetUrl = action === "export" ? EXPORTA_URL : LISTAGEM_URL;

  let milvusRes: Response;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    milvusRes = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": MILVUS_API_TOKEN,
      },
      body: JSON.stringify(milvusBody),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
  } catch (e) {
    const isAbort = (e as Error)?.name === "AbortError";
    console.error(`milvus-atendimentos: fetch erro ${isAbort ? "timeout" : "rede"}`);
    return json({ error: "Falha de conexão com o Milvus" }, 502);
  }

  if (milvusRes.status === 401 || milvusRes.status === 403) {
    console.error("milvus-atendimentos: auth falhou no Milvus");
    return json({ error: "Falha de autenticação com o Milvus" }, 502);
  }
  if (!milvusRes.ok) {
    const txt = await milvusRes.text().catch(() => "");
    console.error(`milvus-atendimentos: Milvus HTTP ${milvusRes.status} ${txt.slice(0, 200)}`);
    return json({ error: `Milvus retornou HTTP ${milvusRes.status}` }, 502);
  }

  if (action === "list") {
    let data: unknown;
    try {
      data = await milvusRes.json();
    } catch {
      return json({ error: "Resposta inválida do Milvus" }, 502);
    }
    // repassa sem alterar formato {meta, lista, resumo}
    return json(data as Record<string, unknown>);
  } else {
    // export: retorna binário como base64
    const contentType = milvusRes.headers.get("content-type") || (String(filtro["tipo_arquivo"]) === "xls" ? "application/vnd.ms-excel" : "text/csv");
    const buf = await milvusRes.arrayBuffer();
    // cap de segurança: 10MB
    if (buf.byteLength > 10 * 1024 * 1024) {
      return json({ error: "Arquivo muito grande" }, 502);
    }
    let base64 = "";
    try {
      const bytes = new Uint8Array(buf);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      base64 = btoa(binary);
    } catch {
      return json({ error: "Falha ao codificar arquivo" }, 500);
    }
    const tipo = String(filtro["tipo_arquivo"] ?? "csv");
    return json({
      success: true,
      tipo_arquivo: tipo,
      contentType,
      base64,
      size: buf.byteLength,
    });
  }
});
