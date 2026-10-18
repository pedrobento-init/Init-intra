// supabase/functions/milvus-chamado-status/index.ts
// Edge Function: devolve o status ATUAL no Milvus dos chamados abertos
// pelas visitas (volta do sentido app → Milvus que milvus-chamado-create
// já faz: criar e finalizar).
//
// CONFIGURAÇÃO (mesmos secrets das outras funções Milvus):
//   supabase secrets set MILVUS_API_TOKEN=seu_token_aqui
//   supabase secrets set MILVUS_API_URL=https://apiintegracao.milvus.com.br
//   supabase functions deploy milvus-chamado-status
//
// CONTRATO
//   POST { visitIds: string[] }  (máx. 25 por chamada)
//   → { success: true, statuses: [{ visitId, codigo, found, status,
//        tecnico, data_modificacao, data_solucao, ultima_log }] }
// - O código do chamado vem do BANCO (visits.milvus_chamado_codigo), nunca
//   do frontend: o chamador só escolhe quais visitas consultar.
// - Autorização igual às policies: admin vê tudo; demais só a própria equipe.
//   Visita de outra equipe é ignorada em silêncio (não vaza existência).
// - Somente leitura: não grava nada no banco. O app guarda o resultado no
//   cache local e decide o que mostrar (sem migration, sem colunas novas).
//
// SEGURANÇA (mesmo padrão de milvus-tickets):
// - Token só em Deno.env: nunca retornado, logado ou em erro.
// - Não devolve contato, e-mails, telefone, CPF/CNPJ nem HTML.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MILVUS_API_URL =
  Deno.env.get("MILVUS_API_URL") ?? "https://apiintegracao.milvus.com.br";
const MILVUS_API_TOKEN = Deno.env.get("MILVUS_API_TOKEN") ?? "";

const LIST_URL = `${MILVUS_API_URL.replace(/\/$/, "")}/api/chamado/listagem`;
const MAX_VISITS = 25;
const CONCURRENCY = 4;

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

const _txt = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

// "2026-09-10 13:51:41" (sem TZ na origem) → ISO. Inválido → null.
const _iso = (v: unknown): string | null => {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).trim().replace(" ", "T");
  const d = new Date(s.length === 10 ? `${s}T00:00:00` : s);
  return isNaN(d.getTime()) ? null : d.toISOString();
};

// Texto de log do Milvus pode vir com HTML: devolve texto puro e curto.
const _plain = (v: unknown, max = 280): string => {
  const s = _txt(v).replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
};

type Status = {
  visitId: string;
  codigo: number;
  found: boolean;
  status: string;
  tecnico: string;
  data_modificacao: string | null;
  data_solucao: string | null;
  ultima_log: { texto: string; data: string | null; tecnico: string } | null;
};

// Consulta UM chamado pelo código. null = falha (a visita fica de fora da
// resposta e o app tenta de novo depois); found:false = não existe/sem acesso.
async function fetchStatus(visitId: string, codigo: number): Promise<Status | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(LIST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": MILVUS_API_TOKEN },
      body: JSON.stringify({ is_paginate: true, pagina: 1, total_registros: 50, filtro_body: { codigo } }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    const lista = (data["lista"] ?? data["data"] ?? []) as unknown;
    if (!Array.isArray(lista)) return null;
    const row = (lista as Record<string, unknown>[]).find((r) => Number(r["codigo"]) === codigo);
    if (!row) {
      return { visitId, codigo, found: false, status: "", tecnico: "", data_modificacao: null, data_solucao: null, ultima_log: null };
    }
    const log = (row["ultima_log"] && typeof row["ultima_log"] === "object")
      ? (row["ultima_log"] as Record<string, unknown>)
      : null;
    return {
      visitId,
      codigo,
      found: true,
      status: _txt(row["status"]),
      tecnico: _txt(row["tecnico"]),
      data_modificacao: _iso(row["data_modificacao"]),
      data_solucao: _iso(row["data_solucao"]),
      ultima_log: log ? { texto: _plain(log["texto"]), data: _iso(log["data"]), tecnico: _txt(log["tecnico"]) } : null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("milvus-chamado-status: service role não configurada");
    return json({ error: "Serviço indisponível" }, 500);
  }
  if (!MILVUS_API_TOKEN) {
    console.error("milvus-chamado-status: MILVUS_API_TOKEN não configurado");
    return json({ error: "Integração Milvus não configurada" }, 500);
  }

  const callerToken = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
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
  if (!callerOp || callerOp.active === false) return json({ error: "Operador sem acesso" }, 403);

  let ids: string[] = [];
  try {
    const body = await req.json();
    ids = Array.isArray(body?.visitIds) ? body.visitIds.map((x: unknown) => String(x ?? "").trim()).filter(Boolean) : [];
  } catch {
    return json({ error: "Corpo inválido" }, 400);
  }
  ids = [...new Set(ids)].slice(0, MAX_VISITS);
  if (!ids.length) return json({ success: true, statuses: [] });

  const { data: visits, error } = await admin
    .from("visits")
    .select("id, team, milvus_chamado_codigo")
    .in("id", ids);
  if (error) {
    console.error(`milvus-chamado-status: leitura de visitas falhou: ${error.message}`);
    return json({ error: "Não foi possível ler as visitas." }, 500);
  }

  const isAdmin = callerOp.is_admin === true;
  const opTeam = callerOp.team || "init";
  const jobs = (visits || [])
    .filter((v: { team: string | null }) => isAdmin || (v.team || "init") === opTeam)
    .map((v: { id: string; milvus_chamado_codigo: number | null }) => ({ visitId: v.id, codigo: Number(v.milvus_chamado_codigo) }))
    .filter((j: { codigo: number }) => Number.isFinite(j.codigo) && j.codigo > 0);

  // Poucas consultas em paralelo (não estoura o rate limit do Milvus).
  const statuses: Status[] = [];
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const j = jobs[next++];
      const st = await fetchStatus(j.visitId, j.codigo);
      if (st) statuses.push(st);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));

  console.log(`milvus-chamado-status: pedidos=${ids.length} consultados=${jobs.length} ok=${statuses.length}`);
  return json({ success: true, statuses, checkedAt: new Date().toISOString() });
});
