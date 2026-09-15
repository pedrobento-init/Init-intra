// supabase/functions/milvus-token-backfill/index.ts
// Edge Function: preenche clients.milvus_client_token a partir da lista
// do Milvus (GET /cliente/busca), sem digitação e sem chute.
// Somente administradores. Duas fases: dry_run (prévia) e commit.
//
// CONFIGURAÇÃO (secrets — nunca no frontend, nunca no banco):
//   supabase secrets set MILVUS_API_TOKEN=seu_token_aqui
//   supabase secrets set MILVUS_API_URL=https://apiintegracao.milvus.com.br
//   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=sb_secret_xxxx
//   supabase functions deploy milvus-token-backfill
//
// REGRAS (sem fuzzy, sem sobrescrita):
// - Match EXATO por nome_fantasia normalizado (trim + espaços + lower),
//   mesma regra do restante da integração.
// - Preenche SOMENTE clientes com token vazio/NULL. Valor manual nunca
//   é sobrescrito.
// - Mesmo nome com 2+ tokens DISTINTOS no Milvus = ambíguo → pula e
//   reporta para decisão manual.
// - Nome fora da lista do Milvus → não encontrado (fica p/ manual).
// - Logs e erros nunca contêm valores de token (só contagens).

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MILVUS_API_URL =
  Deno.env.get("MILVUS_API_URL") ?? "https://apiintegracao.milvus.com.br";
const MILVUS_API_TOKEN = Deno.env.get("MILVUS_API_TOKEN") ?? "";

const CLIENTS_URL = `${MILVUS_API_URL.replace(/\/$/, "")}/api/cliente/busca`;

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
  milvusNome: string;
  clientId: string;
  token: string | null;
  status: "pronto" | "ja_preenchido" | "nao_encontrado" | "ambiguo";
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("milvus-token-backfill: service role não configurada");
    return json({ error: "Serviço indisponível" }, 500);
  }
  if (!MILVUS_API_TOKEN) {
    console.error("milvus-token-backfill: MILVUS_API_TOKEN não configurado");
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

  // 2) dry_run (prévia) ou commit com onlyNomes opcional.
  let dryRun = true;
  let onlyNomes: string[] | null = null;
  try {
    const body = await req.json();
    dryRun = body?.dry_run !== false;
    if (Array.isArray(body?.onlyNomes)) {
      onlyNomes = body.onlyNomes.map((n: unknown) => String(n ?? "").trim()).filter(Boolean);
    }
  } catch {
    return json({ error: "Corpo inválido" }, 400);
  }

  // 3) Lista do Milvus: fantasia → tokens distintos.
  let byFantasia = new Map<string, Set<string>>();
  try {
    const data = await milvusGet(CLIENTS_URL, { status: "3" });
    const lista = ((data as Record<string, unknown>)?.["lista"] ?? null) as unknown;
    if (!Array.isArray(lista)) throw new Error("Resposta do Milvus sem lista de clientes");
    for (const c of lista as Record<string, unknown>[]) {
      const key = normName(c["nome_fantasia"]);
      const tok = String(c["token"] ?? "").trim();
      if (!key || !tok) continue;
      const set = byFantasia.get(key) || new Set<string>();
      set.add(tok);
      byFantasia.set(key, set);
    }
  } catch (e) {
    console.error(`milvus-token-backfill: milvus erro: ${(e as Error)?.message ?? "erro"}`);
    return json({ error: "Falha ao consultar clientes do Milvus." }, 502);
  }

  // 4) Mapa + tokens atuais dos clientes vinculados.
  const { data: mapRows } = await admin
    .from("milvus_client_map")
    .select("milvus_nome,client_id")
    .limit(2000);
  const clientIds = [...new Set(((mapRows || []) as { client_id: string }[]).map((r) => r.client_id))];
  const tokenByClient = new Map<string, string>();
  for (let i = 0; i < clientIds.length; i += 100) {
    const { data: cRows } = await admin
      .from("clients")
      .select("id,milvus_client_token")
      .in("id", clientIds.slice(i, i + 100));
    for (const c of (cRows || []) as { id: string; milvus_client_token: string | null }[]) {
      tokenByClient.set(c.id, String(c.milvus_client_token ?? "").trim());
    }
  }

  const buildPreview = (): PreviewRow[] => {
    const out: PreviewRow[] = [];
    for (const m of (mapRows || []) as { milvus_nome: string; client_id: string }[]) {
      const nome = String(m.milvus_nome || "").trim();
      if (!nome) continue;
      const current = tokenByClient.get(m.client_id) || "";
      if (current) {
        out.push({ milvusNome: nome, clientId: m.client_id, token: null, status: "ja_preenchido" });
        continue;
      }
      const toks = byFantasia.get(normName(nome));
      if (!toks) {
        out.push({ milvusNome: nome, clientId: m.client_id, token: null, status: "nao_encontrado" });
      } else if (toks.size > 1) {
        out.push({ milvusNome: nome, clientId: m.client_id, token: null, status: "ambiguo" });
      } else {
        out.push({ milvusNome: nome, clientId: m.client_id, token: [...toks][0], status: "pronto" });
      }
    }
    return out;
  };

  const preview = buildPreview();
  const totals = {
    total: preview.length,
    prontos: preview.filter((p) => p.status === "pronto").length,
    jaPreenchidos: preview.filter((p) => p.status === "ja_preenchido").length,
    naoEncontrados: preview.filter((p) => p.status === "nao_encontrado").length,
    ambiguos: preview.filter((p) => p.status === "ambiguo").length,
  };
  console.log(
    `milvus-token-backfill: preview total=${totals.total} prontos=${totals.prontos} ` +
    `ja=${totals.jaPreenchidos} nao=${totals.naoEncontrados} amb=${totals.ambiguos} dry=${dryRun}`,
  );
  if (dryRun) {
    return json({ success: true, dryRun: true, preview, totals });
  }

  // 5) Commit: só "pronto" (revalidado) e só os selecionados, se enviados.
  const wanted = onlyNomes === null ? null : new Set(onlyNomes.map(normName));
  let filled = 0;
  const skipped: { nome: string; motivo: string }[] = [];
  for (const p of preview) {
    if (p.status !== "pronto" || !p.token) continue;
    if (wanted && !wanted.has(normName(p.milvusNome))) continue;
    // Revalida: só preenche se continuar vazio (nunca sobrescreve).
    const { data: cur } = await admin
      .from("clients")
      .select("milvus_client_token")
      .eq("id", p.clientId)
      .maybeSingle();
    if (cur && String((cur as { milvus_client_token: string | null }).milvus_client_token || "").trim()) {
      skipped.push({ nome: p.milvusNome, motivo: "já preenchido" });
      continue;
    }
    const { error } = await admin
      .from("clients")
      .update({ milvus_client_token: p.token, updated_at: new Date().toISOString() })
      .eq("id", p.clientId);
    if (error) {
      console.error(`milvus-token-backfill: update falhou client_id=${p.clientId}: ${error.message}`);
      skipped.push({ nome: p.milvusNome, motivo: "falha ao gravar" });
      continue;
    }
    filled++;
  }
  console.log(`milvus-token-backfill: commit filled=${filled} skipped=${skipped.length}`);
  return json({ success: true, dryRun: false, filled, skipped });
});
