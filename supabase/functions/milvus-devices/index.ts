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
//
// FLUXO (v2 — a listagem ignora paginação no servidor, mas
// GET /buscar?cliente=<id> devolve a lista completa, sem paginação):
// por nome mapeado → resolve o cliente_id do Milvus (cache no mapa,
// via id/serial de dispositivo conhecido, ou amostra da listagem) →
// buscar?cliente → normaliza → merge com o existente (por milvus id,
// serial ou hostname) → upsert. O vínculo continua explícito: o
// cliente_id só é usado como chave de busca DENTRO de nome já
// mapeado manualmente pelo administrador.

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

const BUSCAR_URL = `${MILVUS_API_URL.replace(/\/$/, "")}/api/dispositivos/buscar`;
const TYPES_URL = `${MILVUS_API_URL.replace(/\/$/, "")}/api/dispositivos/lista/tipo-dispositivo`;
const CLIENTS_URL = `${MILVUS_API_URL.replace(/\/$/, "")}/api/cliente/busca`;

// GET genérico ao Milvus (buscar/tipos): status antes do corpo,
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

function _buscarList(data: unknown): Record<string, unknown>[] {
  const lista = (data as Record<string, unknown> | null)?.["lista"] as unknown;
  if (Array.isArray(lista)) return lista as Record<string, unknown>[];
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  return [];
}

// Índice fantasia → cliente_id a partir da lista completa de clientes
// (GET /cliente/busca). Falha = mapa vazio (caímos nos fallbacks).
async function fetchMilvusClientIndex(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const data = await milvusGet(CLIENTS_URL, { status: "3" });
    for (const c of _buscarList(data)) {
      const key = String(c["nome_fantasia"] ?? "").trim().toLowerCase();
      const id = Number(c["id"]);
      if (key && Number.isFinite(id) && !out.has(key)) out.set(key, id);
    }
    console.log(`milvus-devices: índice de clientes size=${out.size}`);
  } catch (e) {
    console.log(`milvus-devices: índice indisponível (${(e as Error)?.message ?? "erro"})`);
  }
  return out;
}

// Mapa id→descrição dos tipos (1 chamada por sync; falha = textos vazios).
async function fetchTipoMap(): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  try {
    const data = await milvusGet(TYPES_URL, {});
    for (const t of _buscarList(data)) {
      const id = Number((t as Record<string, unknown>)["id"]);
      if (Number.isFinite(id)) out.set(id, String((t as Record<string, unknown>)["descricao"] ?? ""));
    }
  } catch (e) {
    console.log(`milvus-devices: tipos indisponíveis (${(e as Error)?.message ?? "erro"})`);
  }
  return out;
}

// Normaliza UM item do /buscar (registro completo, sem nome_fantasia —
// o vínculo vem do nome mapeado que originou a busca). Licença ignorada.
function normalizeBuscarDevice(
  raw: Record<string, unknown>, clientId: string, team: string,
  fantasia: string, tipoMap: Map<number, string>,
) {
  const milvusId = _toIntOrNull(raw["id"]);
  if (milvusId === null) return null;
  const now = new Date().toISOString();
  const tipoId = _toIntOrNull(raw["tipo_dispositivo_id"]);
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
    modelo_notebook: _toText(raw["modelo_notebook"] ?? raw["modelo"]),
    nome_fantasia: fantasia,
    tipo_dispositivo_id: tipoId,
    tipo_dispositivo_text: (tipoId !== null && tipoMap.get(tipoId)) || _toText(raw["tipo_dispositivo_text"]),
    updated_at: now,
  };
}

// Descobre o cliente_id do Milvus a partir de dispositivos conhecidos
// (id ou serial). Nunca joga erro pra cima: retorna null se não achar.
async function resolveClienteId(
  known: { milvus_device_id: number | null; numero_serial: string }[],
): Promise<number | null> {
  for (const k of known) {
    try {
      let data: unknown = null;
      if (k.milvus_device_id) data = await milvusGet(BUSCAR_URL, { id: String(k.milvus_device_id) });
      else if (k.numero_serial) data = await milvusGet(BUSCAR_URL, { serial: k.numero_serial });
      else continue;
      const item = _buscarList(data)[0];
      const cid = item ? Number(item["cliente_id"]) : NaN;
      if (Number.isFinite(cid)) return cid;
    } catch (_) { /* tenta o próximo conhecido */ }
  }
  return null;
}

// Amostra da listagem (p1 + p2 com parada em repetição) como ÚLTIMO
// recurso de resolução: devolve itens {id, nome_fantasia}.
async function fetchListagemSample(): Promise<{ id: number; nome: string }[]> {
  const out: { id: number; nome: string }[] = [];
  const seen = new Set<number>();
  for (let p = 1; p <= 3; p++) {
    let r;
    try {
      r = await fetchMilvusPage(p);
    } catch {
      break;
    }
    let fresh = 0;
    for (const raw of r.list) {
      const id = Number((raw as Record<string, unknown>)?.["id"]);
      if (!Number.isFinite(id) || seen.has(id)) continue;
      seen.add(id);
      fresh++;
      out.push({ id, nome: String((raw as Record<string, unknown>)?.["nome_fantasia"] ?? "").trim() });
    }
    if (fresh === 0 || r.list.length === 0) break;
  }
  return out;
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

  // 4) Mapa explícito nome_fantasia → este cliente (+ cache cliente_id).
  const { data: mapRows } = await admin
    .from("milvus_client_map")
    .select("milvus_nome,milvus_cliente_id")
    .eq("client_id", clientId);
  const mapList = (mapRows || []).map((r: { milvus_nome: string; milvus_cliente_id: number | null }) => ({
    nome: String(r.milvus_nome || "").trim(),
    clienteId: (typeof r.milvus_cliente_id === "number") ? r.milvus_cliente_id : null as number | null,
  })).filter((m) => m.nome);
  if (!mapList.length) {
    return json({
      success: true, clientId, synced: 0, created: 0, updated: 0,
      resolved: 0, unresolvedNames: [], received: 0, lastSyncAt: new Date().toISOString(),
    });
  }

  // Dispositivos conhecidos: resolvem o cliente_id (via id ou serial) e
  // evitam duplicar linhas vindas da planilha no merge.
  const { data: knownRows } = await admin
    .from("client_devices")
    .select("id,milvus_device_id,numero_serial,hostname,nome_fantasia")
    .eq("client_id", clientId)
    .limit(3000);
  const knownByName = new Map<string, { milvus_device_id: number | null; numero_serial: string }[]>();
  for (const k of (knownRows || []) as Record<string, unknown>[]) {
    const key = String(k["nome_fantasia"] ?? "").trim().toLowerCase();
    if (!key) continue;
    const arr = knownByName.get(key) || [];
    arr.push({
      milvus_device_id: (typeof k["milvus_device_id"] === "number") ? k["milvus_device_id"] as number : null,
      numero_serial: String(k["numero_serial"] ?? ""),
    });
    knownByName.set(key, arr);
  }

  const tipoMap = await fetchTipoMap();
  const clientIndex = await fetchMilvusClientIndex();
  let listagemSample: { id: number; nome: string }[] | null = null;

  // 5) Por nome mapeado: resolve cliente_id → buscar?cliente (completa).
  // Ordem: lista de clientes (autoritativa) → cache → dispositivo
  // conhecido → amostra da listagem. Falha de UM nome não derruba os
  // demais (vai para unresolvedNames).
  const collected: { [k: string]: unknown }[] = [];
  const resolvedNames: string[] = [];
  const unresolvedNames: string[] = [];
  const seenMids = new Set<number>();
  let received = 0;
  for (const m of mapList) {
    const key = m.nome.toLowerCase();
    let cid: number | null = clientIndex.get(key) ?? m.clienteId;
    try {
      if (cid === null) {
        const known = knownByName.get(key) || [];
        if (known.length) cid = await resolveClienteId(known);
      }
      if (cid === null) {
        if (!listagemSample) listagemSample = await fetchListagemSample();
        const hit = listagemSample.find((s) => s.nome.toLowerCase() === key);
        if (hit) {
          try {
            const data = await milvusGet(BUSCAR_URL, { id: String(hit.id) });
            const item = _buscarList(data)[0];
            const n = item ? Number(item["cliente_id"]) : NaN;
            if (Number.isFinite(n)) cid = n;
          } catch (_) {}
        }
      }
      if (cid === null) { unresolvedNames.push(m.nome); continue; }
      if (cid !== m.clienteId) {
        await admin.from("milvus_client_map").update({ milvus_cliente_id: cid }).eq("milvus_nome", m.nome);
      }
      const data = await milvusGet(BUSCAR_URL, { cliente: String(cid) });
      const items = _buscarList(data);
      received += items.length;
      for (const raw of items) {
        const row = normalizeBuscarDevice(raw, clientId, cliTeam, m.nome, tipoMap);
        if (!row) continue;
        // Mesmo dispositivo via 2 nomes (mesmo cliente Milvus): 1ª ocorrência
        // vence — duplicata no batch quebra o upsert (ON CONFLICT).
        const mid = (row as { milvus_device_id: unknown }).milvus_device_id;
        if (typeof mid === "number") {
          if (seenMids.has(mid)) continue;
          seenMids.add(mid);
        }
        collected.push(row as unknown as { [k: string]: unknown });
      }
      resolvedNames.push(m.nome);
      console.log(`milvus-devices: nome client_id=${clientId} nome="${m.nome}" milvus_cliente=${cid} items=${items.length}`);
    } catch (e) {
      // Mensagem amigável no retorno; detalhe só no log seguro (sem token).
      console.error(`milvus-devices: nome falhou client_id=${clientId} nome="${m.nome}": ${(e as Error)?.message ?? "erro"}`);
      unresolvedNames.push(m.nome);
    }
  }

  // 6) Merge com o existente (por milvus id, serial ou hostname) + upsert.
  // Dispositivo que sumiu NÃO é excluído (histórico). Linhas da planilha
  // (id imp-*) casadas por serial/hostname ganham o milvus id aqui.
  const { data: existing } = await admin
    .from("client_devices")
    .select("*")
    .eq("client_id", clientId)
    .limit(3000);
  const byMid = new Map<number, Record<string, unknown>>();
  const bySerial = new Map<string, Record<string, unknown>>();
  const byHost = new Map<string, Record<string, unknown>>();
  for (const e of (existing || []) as Record<string, unknown>[]) {
    if (typeof e["milvus_device_id"] === "number") byMid.set(e["milvus_device_id"] as number, e);
    const s = String(e["numero_serial"] ?? "").toLowerCase();
    if (s && !bySerial.has(s)) bySerial.set(s, e);
    const h = String(e["hostname"] ?? "").toLowerCase();
    if (h && !byHost.has(h)) byHost.set(h, e);
  }
  const rows: { [k: string]: unknown }[] = [];
  const seenRowIds = new Set<string>();
  let created = 0;
  let updated = 0;
  for (const row of collected) {
    const mid = row["milvus_device_id"];
    const prev = (typeof mid === "number" && byMid.get(mid)) ||
      bySerial.get(String(row["numero_serial"] ?? "").toLowerCase()) ||
      byHost.get(String(row["hostname"] ?? "").toLowerCase()) || null;
    const final = prev
      ? {
        ...prev, ...row,
        id: prev["id"],
        created_at: prev["created_at"],
        observacao: String(row["observacao"] ?? "") || String(prev["observacao"] ?? ""),
      }
      : row;
    // Mesma linha alcançada por dois caminhos: 1ª vence — duplicata no
    // batch quebra o upsert (ON CONFLICT).
    const rid = String(final["id"] ?? "");
    if (!rid || seenRowIds.has(rid)) continue;
    seenRowIds.add(rid);
    rows.push(final);
    if (prev) updated++;
    else created++;
  }

  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const batch = rows.slice(i, i + UPSERT_BATCH);
    // Alvo = PK `id` (determinístico e único por dispositivo). Mirar
    // (client_id, milvus_device_id) quebrava quando a linha mesclada
    // reaproveitava um id existente com mid de outra linha (409/23505).
    const { error } = await admin
      .from("client_devices")
      .upsert(batch);
    if (error) {
      console.error(`milvus-devices: upsert falhou client_id=${clientId}: ${error.message}`);
      return json({ error: "Falha ao gravar inventário" }, 500);
    }
  }

  const durationMs = Date.now() - startedAt;
  const lastSyncAt = new Date().toISOString();
  console.log(
    `milvus-devices: fim client_id=${clientId} received=${received} ` +
    `matched=${rows.length} created=${created} updated=${updated} ` +
    `resolved=${resolvedNames.length} unresolved=${unresolvedNames.length} ` +
    `duration_ms=${durationMs} ok`,
  );
  return json({
    success: true,
    clientId,
    synced: rows.length,
    created,
    updated,
    resolved: resolvedNames.length,
    unresolvedNames,
    received,
    lastSyncAt,
  });
});
