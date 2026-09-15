// supabase/functions/milvus-devices/index.ts
// Edge Function: sincroniza o inventário Milvus de UM cliente.
// Escopo: SOMENTE listagem de dispositivos. NÃO inclui softwares,
// status online/offline, Google, e-mails ou novas regras de auth.
//
// CONFIGURAÇÃO (secrets — nunca no frontend, nunca no banco):
//   supabase secrets set MILVUS_API_TOKEN=seu_token_aqui
//   supabase secrets set MILVUS_API_URL=https://apiintegracao.milvus.com.br
//   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=sb_secret_xxxx
//   supabase functions deploy milvus-devices
//
// SEGURANÇA:
// - O token do Milvus vive só aqui (Deno.env). Nunca é retornado,
//   logado ou incluído em mensagens de erro.
// - `sistema_operacional_licenca` NUNCA é persistido nem logado.
// - Autorização do usuário reutiliza operador→equipe→cliente:
//   admin (is_admin) passa; não-admin só se team do operador == team
//   do cliente. Service role é usada só para a escrita server-side
//   APÓS essa checagem — não é bypass para o frontend.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MILVUS_API_URL =
  Deno.env.get("MILVUS_API_URL") ?? "https://apiintegracao.milvus.com.br";
const MILVUS_API_TOKEN = Deno.env.get("MILVUS_API_TOKEN") ?? "";

const MAX_PAGES = 60;
const PAGE_SIZE = 1000;
const UPSERT_BATCH = 200;

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

const _toText = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  return String(v);
};

const _toIntOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

const _toIsoOrNull = (v: unknown): string | null => {
  if (v === null || v === undefined || v === "") return null;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d.toISOString();
};

const _toDateOrNull = (v: unknown): string | null => {
  const iso = _toIsoOrNull(v);
  return iso ? iso.slice(0, 10) : null;
};

// Normaliza UM dispositivo Milvus para a linha de client_devices.
// NOTA: `sistema_operacional_licenca` é ignorado de propósito
// (pode conter chave — sem necessidade funcional, não persistimos).
function normalizeDevice(raw: Record<string, unknown>, clientId: string, team: string) {
  const milvusId = _toIntOrNull(raw["id"]);
  if (milvusId === null) return null;
  const now = new Date().toISOString();
  return {
    id: `${clientId}:milvus-${milvusId}`,
    client_id: clientId,
    team,
    milvus_device_id: milvusId,
    hostname: _toText(raw["hostname"]),
    apelido: _toText(raw["apelido"]),
    ip_interno: _toText(raw["ip_interno"]),
    ip_externo: _toText(raw["ip_externo"]),
    mac_address: _toText(raw["macaddres"] ?? raw["mac_address"]),
    marca: _toText(raw["marca"]),
    fabricante: _toText(raw["fabricante"]),
    is_ativo: raw["is_ativo"] === undefined || raw["is_ativo"] === null
      ? true
      : raw["is_ativo"] === true || raw["is_ativo"] === 1 || raw["is_ativo"] === "1",
    data_criacao: _toIsoOrNull(raw["data_criacao"]),
    data_ultima_atualizacao: _toIsoOrNull(raw["data_ultima_atualizacao"]),
    dominio: _toText(raw["dominio"]),
    sistema_operacional: _toText(raw["sistema_operacional"]),
    placa_mae: _toText(raw["placa_mae"]),
    placa_mae_serial: _toText(raw["placa_mae_serial"]),
    processador: _toText(raw["processador"]),
    versao_client: _toText(raw["versao_client"]),
    observacao: _toText(raw["observacao"]),
    usuario_logado: _toText(raw["usuario_logado"]),
    total_processadores: _toIntOrNull(raw["total_processadores"]),
    numero_serial: _toText(raw["numero_serial"]),
    placa_mae_modelo: _toText(raw["placa_mae_modelo"]),
    data_compra: _toDateOrNull(raw["data_compra"]),
    data_garantia: _toDateOrNull(raw["data_garantia"]),
    modelo_notebook: _toText(raw["modelo_notebook"]),
    nome_fantasia: _toText(raw["nome_fantasia"]),
    tipo_dispositivo_id: _toIntOrNull(raw["tipo_dispositivo_id"]),
    tipo_dispositivo_text: _toText(raw["tipo_dispositivo_text"]),
    updated_at: now,
  };
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
  while (attempt < 2) {
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
          // A API do Milvus espera o token puro neste header.
          "Authorization": MILVUS_API_TOKEN,
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      // Erro de conexão/timeout: 1 retry com backoff, depois desiste.
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      throw new Error(`Falha de conexão com o Milvus: ${(e as Error)?.name === "AbortError" ? "timeout" : "rede"}`);
    }
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      clearTimeout(timer);
      throw new Error("Resposta inválida do Milvus");
    }
    clearTimeout(timer);

    if (res.status === 401 || res.status === 403) {
      // Erro de autenticação: NUNCA repetir automaticamente.
      throw new Error("Falha de autenticação com o Milvus");
    }
    if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      throw new Error(`Milvus indisponível (HTTP ${res.status})`);
    }
    if (!res.ok) {
      throw new Error(`Milvus retornou HTTP ${res.status}`);
    }
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
    console.error("milvus-devices: service role não configurada");
    return json({ error: "Serviço indisponível" }, 500);
  }
  if (!MILVUS_API_TOKEN) {
    console.error("milvus-devices: MILVUS_API_TOKEN não configurado");
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

  const { data: callerOp } = await admin
    .from("operators")
    .select("id, team, is_admin, active")
    .eq("auth_user_id", callerUid)
    .maybeSingle();
  if (!callerOp || callerOp.active === false) {
    return json({ error: "Operador sem acesso" }, 403);
  }

  // 2) Qual cliente.
  let clientId = "";
  try {
    const body = await req.json();
    clientId = String(body?.clientId ?? "").trim();
  } catch {
    return json({ error: "Corpo inválido" }, 400);
  }
  if (!clientId) return json({ error: "clientId é obrigatório" }, 400);

  const { data: client } = await admin
    .from("clients")
    .select("id, name, team")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) return json({ error: "Cliente não encontrado" }, 404);

  // 3) Autorização: mesma regra das policies clients_* (sem bypass).
  const isAdmin = callerOp.is_admin === true;
  const opTeam = callerOp.team || "init";
  const cliTeam = client.team || "init";
  if (!isAdmin && opTeam !== cliTeam) {
    return json({ error: "Acesso negado a este cliente" }, 403);
  }

  console.log(`milvus-devices: início client_id=${clientId} team=${cliTeam}`);

  // 4) Mapa explícito nome_fantasia → este cliente.
  const { data: mapRows } = await admin
    .from("milvus_client_map")
    .select("milvus_nome")
    .eq("client_id", clientId);
  const mappedNames = new Set(
    (mapRows || []).map((r: { milvus_nome: string }) => r.milvus_nome.trim().toLowerCase()).filter(Boolean),
  );

  // 5) Pagina o Milvus: a 1ª página descobre last_page; as demais vêm em
  // lotes paralelos (8 por vez) para caber no timeout da plataforma.
  // Teto anti-loop mantido em MAX_PAGES.
  let pages = 0;
  let received = 0;
  const matched: Record<string, unknown>[] = [];
  let skippedUnmapped = 0;
  const ingest = (list: unknown[]) => {
    received += list.length;
    for (const raw of list) {
      const nome = String((raw as Record<string, unknown>)?.["nome_fantasia"] ?? "").trim().toLowerCase();
      if (nome && mappedNames.has(nome)) {
        matched.push(raw as Record<string, unknown>);
      } else {
        skippedUnmapped++;
      }
    }
  };
  try {
    const first = await fetchMilvusPage(1);
    pages++;
    ingest(first.list);
    let last = first.last;
    if (last > MAX_PAGES) {
      console.log(`milvus-devices: teto de páginas (${MAX_PAGES}) atingido client_id=${clientId} (last_page=${last})`);
      last = MAX_PAGES;
    }
    if (first.current < last && first.list.length > 0) {
      const rest: number[] = [];
      for (let p = first.current + 1; p <= last; p++) rest.push(p);
      const BATCH = 8;
      for (let i = 0; i < rest.length; i += BATCH) {
        const results = await Promise.all(rest.slice(i, i + BATCH).map((p) => fetchMilvusPage(p)));
        for (const r of results) {
          pages++;
          ingest(r.list);
        }
        console.log(`milvus-devices: progresso client_id=${clientId} pages=${pages}/${last}`);
      }
    }
  } catch (e) {
    // Mensagem amigável; detalhe técnico só no log seguro (sem token).
    console.error(`milvus-devices: erro client_id=${clientId}: ${(e as Error)?.message ?? "erro"}`);
    return json({ error: `Falha ao sincronizar inventário: ${(e as Error)?.message ?? "erro inesperado"}` }, 502);
  }

  // 6) Normaliza + upsert em lote (id = client + milvus id; nunca hostname).
  const rows = [];
  for (const raw of matched) {
    const row = normalizeDevice(raw, clientId, cliTeam);
    if (row) rows.push(row);
  }

  // Dispositivo que sumiu de uma sincronização NÃO é excluído (histórico).
  const { data: existing } = await admin
    .from("client_devices")
    .select("milvus_device_id")
    .eq("client_id", clientId);
  const existingIds = new Set((existing || []).map((r: { milvus_device_id: number }) => r.milvus_device_id));

  let created = 0;
  let updated = 0;
  for (const r of rows) {
    if (existingIds.has((r as { milvus_device_id: number }).milvus_device_id)) updated++;
    else { created++; existingIds.add((r as { milvus_device_id: number }).milvus_device_id); }
  }

  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const batch = rows.slice(i, i + UPSERT_BATCH);
    const { error } = await admin
      .from("client_devices")
      .upsert(batch, { onConflict: "client_id,milvus_device_id" });
    if (error) {
      console.error(`milvus-devices: upsert falhou client_id=${clientId}: ${error.message}`);
      return json({ error: "Falha ao gravar inventário" }, 500);
    }
  }

  const durationMs = Date.now() - startedAt;
  const lastSyncAt = new Date().toISOString();
  console.log(
    `milvus-devices: fim client_id=${clientId} pages=${pages} received=${received} ` +
    `matched=${rows.length} created=${created} updated=${updated} ` +
    `skipped_unmapped=${skippedUnmapped} duration_ms=${durationMs} ok`,
  );
  return json({
    success: true,
    clientId,
    synced: rows.length,
    created,
    updated,
    skippedUnmapped,
    pages,
    received,
    lastSyncAt,
  });
});
