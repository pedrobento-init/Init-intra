// supabase/functions/milvus-clients-import/index.ts
// Edge Function: importa clientes do Milvus para `clients` + já cria o
// vínculo em `milvus_client_map` (nome → novo client_id + id Milvus).
// Somente administradores. Duas fases: dry_run (prévia, sem escrita)
// e commit (insere só os confirmados como novos).
//
// CONFIGURAÇÃO (secrets — nunca no frontend, nunca no banco):
//   supabase secrets set MILVUS_API_TOKEN=seu_token_aqui
//   supabase secrets set MILVUS_API_URL=https://apiintegracao.milvus.com.br
//   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=sb_secret_xxxx
//   supabase functions deploy milvus-clients-import
//
// REGRAS:
// - Nome = nome_fantasia (exato, sem aproximação).
// - Pula quem já existe: mesmo CNPJ (só dígitos) OU mesmo nome
//   normalizado. CNPJ tem precedência no diagnóstico.
// - Novos entram com team='init' (neutro; admin ajusta depois).
// - Token só em Deno.env: nunca retornado, logado ou em erro.
// - Service role só APÓS checagem de admin (sem bypass).

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MILVUS_API_URL =
  Deno.env.get("MILVUS_API_URL") ?? "https://apiintegracao.milvus.com.br";
const MILVUS_API_TOKEN = Deno.env.get("MILVUS_API_TOKEN") ?? "";

const CLIENTS_URL = `${MILVUS_API_URL.replace(/\/$/, "")}/api/cliente/busca`;
const COMMIT_CAP = 500;

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

const normName = (v: unknown): string =>
  String(v ?? "").replace(/\s+/g, " ").trim().toLowerCase();

const normCnpj = (v: unknown): string =>
  String(v ?? "").replace(/\D/g, "");

function initialsFor(name: string): string {
  const parts = name.split(" ").map((w) => w[0]).filter(Boolean).join("");
  return (parts.substring(0, 2) || "CL").toUpperCase();
}

async function milvusGet(path: string, params: Record<string, string>): Promise<unknown> {
  const url = `${path}?${new URLSearchParams(params).toString()}`;
  let attempt = 0;
  while (attempt < 2) {
    attempt++;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "Authorization": MILVUS_API_TOKEN },
        signal: ctrl.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      throw new Error(`Falha de conexão com o Milvus: ${(e as Error)?.name === "AbortError" ? "timeout" : "rede"}`);
    }
    if (res.status === 401 || res.status === 403) {
      clearTimeout(timer);
      throw new Error("Falha de autenticação com o Milvus");
    }
    if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
      clearTimeout(timer);
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      throw new Error(`Milvus indisponível (HTTP ${res.status})`);
    }
    if (!res.ok) {
      clearTimeout(timer);
      throw new Error(`Milvus retornou HTTP ${res.status}`);
    }
    try {
      const data: unknown = await res.json();
      clearTimeout(timer);
      return data;
    } catch {
      clearTimeout(timer);
      throw new Error("Resposta inválida do Milvus");
    }
  }
  throw new Error("Falha inesperada ao consultar o Milvus");
}

type PreviewRow = {
  milvusId: number;
  nome: string;
  razao: string;
  cnpj: string;
  status: "novo" | "existe_cnpj" | "existe_nome";
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("milvus-clients-import: service role não configurada");
    return json({ error: "Serviço indisponível" }, 500);
  }
  if (!MILVUS_API_TOKEN) {
    console.error("milvus-clients-import: MILVUS_API_TOKEN não configurado");
    return json({ error: "Integração Milvus não configurada" }, 500);
  }

  const authHeader = req.headers.get("authorization") || "";
  const callerToken = authHeader.replace(/^Bearer\s+/i, "");
  if (!callerToken) return json({ error: "Não autenticado" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1) Somente administradores ativos.
  const { data: userData } = await admin.auth.getUser(callerToken);
  const callerUid = userData?.user?.id ?? null;
  if (!callerUid) return json({ error: "Não autenticado" }, 401);

  const { data: callerOp } = await admin
    .from("operators")
    .select("id, is_admin, active")
    .eq("auth_user_id", callerUid)
    .maybeSingle();
  if (!callerOp || callerOp.active === false || callerOp.is_admin !== true) {
    return json({ error: "Somente administradores" }, 403);
  }

  // 2) Parâmetros: dry_run (prévia) ou commit com onlyIds opcional.
  let dryRun = true;
  let onlyIds: number[] | null = null;
  try {
    const body = await req.json();
    dryRun = body?.dry_run !== false;
    if (Array.isArray(body?.onlyIds)) {
      onlyIds = body.onlyIds.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n));
    }
  } catch {
    return json({ error: "Corpo inválido" }, 400);
  }

  // 3) Lista completa do Milvus + clientes locais (id, nome, cnpj).
  let milvusList: { nome: string; razao: string; cnpj: string; milvusId: number }[];
  try {
    const data = await milvusGet(CLIENTS_URL, { status: "3" });
    const lista = ((data as Record<string, unknown>)?.["lista"] ?? null) as unknown;
    if (!Array.isArray(lista)) throw new Error("Resposta do Milvus sem lista de clientes");
    milvusList = [];
    for (const c of lista as Record<string, unknown>[]) {
      const nome = String(c["nome_fantasia"] ?? "").replace(/\s+/g, " ").trim();
      const mid = Number(c["id"]);
      if (!nome || !Number.isFinite(mid)) continue;
      milvusList.push({
        nome,
        razao: String(c["razao_social"] ?? ""),
        cnpj: String(c["cnpj_cpf"] ?? "").trim(),
        milvusId: mid,
      });
    }
  } catch (e) {
    console.error(`milvus-clients-import: milvus erro: ${(e as Error)?.message ?? "erro"}`);
    return json({ error: "Falha ao consultar clientes do Milvus." }, 502);
  }

  const { data: localRows } = await admin.from("clients").select("id,name,cnpj").limit(2000);
  const byCnpj = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const l of (localRows || []) as { id: string; name: string; cnpj: string }[]) {
    const cn = normCnpj(l.cnpj);
    if (cn && !byCnpj.has(cn)) byCnpj.set(cn, l.id);
    const nm = normName(l.name);
    if (nm && !byName.has(nm)) byName.set(nm, l.id);
  }

  const preview: PreviewRow[] = milvusList.map((m) => {
    const cn = normCnpj(m.cnpj);
    let status: PreviewRow["status"] = "novo";
    if (cn && byCnpj.has(cn)) status = "existe_cnpj";
    else if (byName.has(normName(m.nome))) status = "existe_nome";
    return { milvusId: m.milvusId, nome: m.nome, razao: m.razao, cnpj: m.cnpj, status };
  });
  const totals = {
    total: preview.length,
    novos: preview.filter((p) => p.status === "novo").length,
    existeCnpj: preview.filter((p) => p.status === "existe_cnpj").length,
    existeNome: preview.filter((p) => p.status === "existe_nome").length,
  };
  console.log(`milvus-clients-import: preview total=${totals.total} novos=${totals.novos} dry=${dryRun}`);
  if (dryRun) {
    return json({ success: true, dryRun: true, preview, totals });
  }

  // 4) Commit: só os novos (filtrados por onlyIds quando enviado).
  const wanted = new Set(onlyIds ?? []);
  const targets = preview
    .filter((p) => p.status === "novo" && (onlyIds === null || wanted.has(p.milvusId)))
    .slice(0, COMMIT_CAP);
  const now = new Date().toISOString();
  let created = 0;
  const skipped: { nome: string; motivo: string }[] = [];
  const createdIds: string[] = [];
  for (const t of targets) {
    // Revalida contra o banco atual (nada entra no escuro).
    const cn = normCnpj(t.cnpj);
    if ((cn && byCnpj.has(cn)) || byName.has(normName(t.nome))) {
      skipped.push({ nome: t.nome, motivo: "já existe" });
      continue;
    }
    const newId = `CLI-${crypto.randomUUID()}`;
    const { error: cErr } = await admin.from("clients").insert({
      id: newId,
      name: t.nome,
      cnpj: t.cnpj,
      segment: "",
      color: "#1a56db",
      initials: initialsFor(t.nome),
      team: "init",
      created_at: now,
      updated_at: now,
    });
    if (cErr) {
      console.error(`milvus-clients-import: insert falhou nome="${t.nome}": ${cErr.message}`);
      skipped.push({ nome: t.nome, motivo: "falha ao gravar" });
      continue;
    }
    const { error: mErr } = await admin.from("milvus_client_map").upsert(
      { milvus_nome: t.nome, client_id: newId, milvus_cliente_id: t.milvusId },
      { onConflict: "milvus_nome" },
    );
    if (mErr) {
      console.error(`milvus-clients-import: mapa falhou nome="${t.nome}": ${mErr.message}`);
    }
    if (cn) byCnpj.set(cn, newId);
    byName.set(normName(t.nome), newId);
    created++;
    createdIds.push(newId);
  }
  console.log(`milvus-clients-import: commit created=${created} skipped=${skipped.length}`);
  return json({ success: true, dryRun: false, created, skipped, createdIds });
});
