// supabase/functions/milvus-client-names/index.ts
// Edge Function: lista os `nome_fantasia` existentes no Milvus (deduplicados)
// para alimentar a tela administrativa "Mapeamento Milvus × Clientes".
// Escopo: SOMENTE descoberta de nomes. NÃO sincroniza dispositivos, NÃO
// grava mapeamento, NÃO retorna dispositivos, licenças ou dados sensíveis.
//
// CONFIGURAÇÃO (secrets — nunca no frontend, nunca no banco):
//   supabase secrets set MILVUS_API_TOKEN=seu_token_aqui
//   supabase secrets set MILVUS_API_URL=https://apiintegracao.milvus.com.br
//   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=sb_secret_xxxx
//   supabase functions deploy milvus-client-names
//
// SEGURANÇA:
// - Somente administradores (operators.is_admin = true, ativo).
// - O token do Milvus vive só aqui (Deno.env). Nunca é retornado,
//   logado ou incluído em mensagens de erro.
// - Reutiliza o padrão de autenticação de milvus-devices; a única
//   diferença é a exigência adicional de is_admin.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MILVUS_API_URL =
  Deno.env.get("MILVUS_API_URL") ?? "https://apiintegracao.milvus.com.br";
const MILVUS_API_TOKEN = Deno.env.get("MILVUS_API_TOKEN") ?? "";

const MAX_PAGES = 60;
const PAGE_SIZE = 1000;

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

async function fetchMilvusPage(page: number): Promise<{ list: unknown[]; current: number; last: number }> {
  const url = `${MILVUS_API_URL.replace(/\/$/, "")}/api/dispositivos/listagem`;
  const body = {
    is_paginate: true,
    is_descending: false,
    order_by: "id",
    total_registros: PAGE_SIZE,
    pagina: page,
  };

  let attempt = 0;
  for (;;) {
    attempt++;
    let res: Response;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25000);
      try {
        res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": MILVUS_API_TOKEN,
          },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      if (attempt === 1) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      throw new Error(`Falha de conexão com o Milvus: ${(e as Error)?.name === "AbortError" ? "timeout" : "rede"}`);
    }

    if (res.status === 401 || res.status === 403) {
      throw new Error("Falha de autenticação com o Milvus");
    }
    if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
      if (attempt === 1) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      throw new Error(`Milvus indisponível (HTTP ${res.status})`);
    }
    if (!res.ok) {
      throw new Error(`Milvus retornou HTTP ${res.status}`);
    }

    let data: unknown;
    try {
      data = await res.json();
    } catch {
      throw new Error("Resposta inválida do Milvus");
    }
    const d = data as Record<string, unknown>;
    const lista = (d["lista"] ?? d["data"] ?? d["devices"] ?? null) as unknown;
    if (!Array.isArray(lista)) throw new Error("Resposta do Milvus sem lista de dispositivos");
    const pag = (((d["meta"] as Record<string, unknown> | undefined)?.["paginate"]) ?? {}) as Record<string, unknown>;
    const current = Number(pag["current_page"] ?? page) || page;
    const last = Number(pag["last_page"] ?? page) || page;
    return { list: lista as unknown[], current, last };
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("milvus-client-names: service role não configurada");
    return json({ error: "Serviço indisponível" }, 500);
  }
  if (!MILVUS_API_TOKEN) {
    console.error("milvus-client-names: MILVUS_API_TOKEN não configurado");
    return json({ error: "Integração Milvus não configurada" }, 500);
  }

  const startedAt = Date.now();
  const authHeader = req.headers.get("authorization") || "";
  const callerToken = authHeader.replace(/^Bearer\s+/i, "");
  if (!callerToken) return json({ error: "Não autenticado" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1) Quem chama (JWT do usuário — mesma base do RLS).
  const { data: userData } = await admin.auth.getUser(callerToken);
  const callerUid = userData?.user?.id ?? null;
  if (!callerUid) return json({ error: "Não autenticado" }, 401);

  // 2) Somente administradores ativos (diferença p/ milvus-devices,
  //    que admite operador do próprio team).
  const { data: callerOp } = await admin
    .from("operators")
    .select("id, is_admin, active")
    .eq("auth_user_id", callerUid)
    .maybeSingle();
  if (!callerOp || callerOp.active === false || callerOp.is_admin !== true) {
    return json({ error: "Somente administradores" }, 403);
  }

  // 3) Pagina o Milvus e agrega por nome_fantasia (deduplicado).
  const counts = new Map<string, { nome: string; quantidadeDispositivos: number }>();
  let pages = 0;
  let received = 0;
  try {
    let page = 1;
    for (;;) {
      if (page > MAX_PAGES) {
        console.log(`milvus-client-names: teto de páginas (${MAX_PAGES}) atingido`);
        break;
      }
      const { list, current, last } = await fetchMilvusPage(page);
      pages++;
      received += list.length;
      for (const raw of list) {
        const nome = String((raw as Record<string, unknown>)?.["nome_fantasia"] ?? "").trim();
        if (!nome) continue;
        const key = nome.toLowerCase();
        const entry = counts.get(key);
        if (entry) entry.quantidadeDispositivos++;
        else counts.set(key, { nome, quantidadeDispositivos: 1 });
      }
      if (current >= last || list.length === 0) break;
      page = current + 1;
    }
  } catch (e) {
    console.error(`milvus-client-names: erro: ${(e as Error)?.message ?? "erro"}`);
    return json({ error: `Falha ao consultar nomes do Milvus: ${(e as Error)?.message ?? "erro inesperado"}` }, 502);
  }

  const nomes = [...counts.values()].sort((a, b) =>
    b.quantidadeDispositivos - a.quantidadeDispositivos ||
    a.nome.localeCompare(b.nome, "pt-BR"),
  );

  const durationMs = Date.now() - startedAt;
  console.log(
    `milvus-client-names: ok names=${nomes.length} devices=${received} ` +
    `pages=${pages} duration_ms=${durationMs}`,
  );
  return json({ success: true, nomes, totalNomes: nomes.length });
});
