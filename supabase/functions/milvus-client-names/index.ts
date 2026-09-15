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

const CLIENTS_URL = `${MILVUS_API_URL.replace(/\/$/, "")}/api/cliente/busca`;

// GET genérico ao Milvus (clientes/tipos): status antes do corpo,
// 1 retry para 429/5xx/conexão, nunca para 401/403.
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

function _milvusList(data: unknown): Record<string, unknown>[] {
  const lista = (data as Record<string, unknown> | null)?.["lista"] as unknown;
  if (Array.isArray(lista)) return lista as Record<string, unknown>[];
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  return [];
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
  while (attempt < 3) {
    attempt++;
    // Um único AbortController cobre headers + corpo: se o Milvus travar
    // no meio do body, o abort interrompe em ~25s em vez de pendurar a
    // função até o timeout da plataforma (504).
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    let res: Response;
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
    } catch (e) {
      clearTimeout(timer);
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      throw new Error(`Falha de conexão com o Milvus: ${(e as Error)?.name === "AbortError" ? "timeout" : "rede"}`);
    }
    let data: unknown;
    // Status ANTES do corpo: 429/5xx com corpo vazio precisam do retry
    // (e da mensagem certa), não de "resposta inválida".
    if (res.status === 401 || res.status === 403) {
      clearTimeout(timer);
      // Erro de autenticação: NUNCA repetir automaticamente.
      throw new Error("Falha de autenticação com o Milvus");
    }
    if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
      clearTimeout(timer);
      // 5xx/429 voltam rápido: 2 retries com backoff crescente.
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, attempt * 2000));
        continue;
      }
      throw new Error(`Milvus indisponível (HTTP ${res.status})`);
    }
    if (!res.ok) {
      clearTimeout(timer);
      throw new Error(`Milvus retornou HTTP ${res.status}`);
    }
    try {
      data = await res.json();
    } catch {
      clearTimeout(timer);
      // 200 com corpo vazio/truncado: soluço transitório, 1 retry.
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      throw new Error("Resposta inválida do Milvus");
    }
    clearTimeout(timer);

    const d = data as Record<string, unknown>;
    const lista = (d["lista"] ?? d["data"] ?? d["devices"] ?? null) as unknown;
    if (!Array.isArray(lista)) throw new Error("Resposta do Milvus sem lista de dispositivos");
    const pag = (((d["meta"] as Record<string, unknown> | undefined)?.["paginate"]) ?? {}) as Record<string, unknown>;
    const current = Number(pag["current_page"] ?? page) || page;
    const last = Number(pag["last_page"] ?? page) || page;
    return { list: lista as unknown[], current, last };
  }
  throw new Error("Falha inesperada ao consultar o Milvus");
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

  // 3) Lista completa de clientes (id + fantasia + CNPJ) + contagens
  // da amostra visível de dispositivos. A listagem de dispositivos
  // ignora paginação no servidor — as contagens cobrem só a amostra;
  // nomes fora dela vêm com quantidade null ("—" na tela).
  const byFantasia = new Map<string, { nome: string; ids: number[]; cnpj: string }>();
  try {
    const data = await milvusGet(CLIENTS_URL, { status: "3" });
    for (const c of _milvusList(data)) {
      const nome = String(c["nome_fantasia"] ?? "").trim();
      const id = Number(c["id"]);
      if (!nome || !Number.isFinite(id)) continue;
      const key = nome.toLowerCase();
      const entry = byFantasia.get(key);
      if (entry) {
        if (!entry.ids.includes(id)) entry.ids.push(id);
      } else {
        byFantasia.set(key, { nome, ids: [id], cnpj: String(c["cnpj_cpf"] ?? "") });
      }
    }
  } catch (e) {
    console.error(`milvus-client-names: clientes erro: ${(e as Error)?.message ?? "erro"}`);
    return json({ error: `Falha ao consultar clientes do Milvus: ${(e as Error)?.message ?? "erro inesperado"}` }, 502);
  }
  if (!byFantasia.size) {
    return json({ error: "Nenhum cliente retornado pelo Milvus" }, 502);
  }

  const counts = new Map<string, number>();
  let pages = 0;
  let received = 0;
  // Dedupe por id do dispositivo: a API pode repetir a mesma página
  // (paginação ignorada) — sem isso, contagens saem multiplicadas.
  const seenIds = new Set<string>();
  const ingest = (list: unknown[]): number => {
    let fresh = 0;
    received += list.length;
    for (const raw of list) {
      const nome = String((raw as Record<string, unknown>)?.["nome_fantasia"] ?? "").trim();
      if (!nome) continue;
      const id = String((raw as Record<string, unknown>)?.["id"] ?? "");
      if (id) {
        if (seenIds.has(id)) continue;
        seenIds.add(id);
      }
      fresh++;
      const key = nome.toLowerCase();
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return fresh;
  };
  try {
    const first = await fetchMilvusPage(1);
    pages++;
    ingest(first.list);
    let last = first.last;
    if (last > MAX_PAGES) {
      console.log(`milvus-client-names: teto de páginas (${MAX_PAGES}) atingido (last_page=${last})`);
      last = MAX_PAGES;
    }
    if (first.current < last && first.list.length > 0) {
      const rest: number[] = [];
      for (let p = first.current + 1; p <= last; p++) rest.push(p);
      const BATCH = 8;
      for (let i = 0; i < rest.length; i += BATCH) {
        const results = await Promise.all(rest.slice(i, i + BATCH).map((p) => fetchMilvusPage(p)));
        let batchFresh = 0;
        for (const r of results) {
          pages++;
          batchFresh += ingest(r.list);
        }
        console.log(`milvus-client-names: progresso pages=${pages}/${last}`);
        if (batchFresh === 0) {
          console.log(`milvus-client-names: páginas repetidas, interrompendo em pages=${pages}`);
          break;
        }
      }
    }
  } catch (e) {
    // Amostra é complementar: falha aqui não derruba a lista de clientes.
    console.log(`milvus-client-names: amostra indisponível (${(e as Error)?.message ?? "erro"})`);
  }

  const nomes = [...byFantasia.values()].map((c) => ({
    nome: c.nome,
    milvusClienteId: c.ids[0],
    milvusClienteIds: c.ids,
    duplicado: c.ids.length > 1,
    cnpj: c.cnpj,
    quantidadeDispositivos: counts.get(c.nome.toLowerCase()) ?? null,
  })).sort((a, b) =>
    (b.quantidadeDispositivos ?? -1) - (a.quantidadeDispositivos ?? -1) ||
    a.nome.localeCompare(b.nome, "pt-BR"),
  );

  const durationMs = Date.now() - startedAt;
  console.log(
    `milvus-client-names: ok names=${nomes.length} sample_devices=${received} ` +
    `pages=${pages} duration_ms=${durationMs}`,
  );
  return json({ success: true, nomes, totalNomes: nomes.length });
});
