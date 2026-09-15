// supabase/functions/milvus-tickets/index.ts
// Edge Function: sincroniza os 10 chamados MAIS RECENTES do Milvus de
// UM cliente (contexto rápido p/ visita — NÃO é cópia dos 20k+).
//
// CONFIGURAÇÃO (secrets — nunca no frontend, nunca no banco):
//   supabase secrets set MILVUS_API_TOKEN=seu_token_aqui
//   supabase secrets set MILVUS_API_URL=https://apiintegracao.milvus.com.br
//   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=sb_secret_xxxx
//   supabase functions deploy milvus-tickets
//
// FLUXO (1 cliente → 1 consulta → 10 chamados → upsert → prune):
// - Preferência: filtro_body.cliente_token = clients.milvus_client_token
//   (identificador do CLIENTE; nunca o MILVUS_API_TOKEN, que é segredo).
// - Fallback: filtro_body.cliente_id = milvus_client_map.milvus_cliente_id
//   (id numérico resolvido via /cliente/busca; sem fuzzy de nome).
// - A API ignora total_registros (sempre 50/página): 1 página,
//   corta os 10 primeiros (código descrescente), apaga o excedente
//   SOMENTE deste client_id. Nunca toca outros clientes.
// - Coleta vazia NÃO apaga nada (falha transitória não limpa histórico).
// - Sem token E sem mapa: { success:false, code:
//   MILVUS_CLIENT_TOKEN_NOT_CONFIGURED } — sem consultar o Milvus.
//
// SEGURANÇA (mesmo padrão de milvus-devices):
// - Token só em Deno.env: nunca retornado, logado ou em erro.
// - JWT → operators → team-check ANTES de qualquer escrita; service
//   role só depois da autorização (sem bypass p/ o frontend).
// - NÃO persiste: contato, e-mails, telefone, CPF/CNPJ, tokens,
//   avaliações, HTML, logs extras e dados de dispositivo.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MILVUS_API_URL =
  Deno.env.get("MILVUS_API_URL") ?? "https://apiintegracao.milvus.com.br";
const MILVUS_API_TOKEN = Deno.env.get("MILVUS_API_TOKEN") ?? "";

const TICKETS_URL = `${MILVUS_API_URL.replace(/\/$/, "")}/api/chamado/listagem`;
const KEEP_TOP = 10;

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

// "2026-09-10 13:51:41" (sem TZ na origem) → ISO. Inválido → null.
const _toIsoOrNull = (v: unknown): string | null => {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).trim().replace(" ", "T");
  const d = new Date(s.length === 10 ? `${s}T00:00:00` : s);
  return isNaN(d.getTime()) ? null : d.toISOString();
};

// Normaliza UM chamado. Campos fora da tela compacta são descartados
// aqui mesmo (contato, e-mails, telefone, CPF/CNPJ, token, avaliações,
// HTML, logs extras, dispositivo). Licença sequer existe neste endpoint.
function normalizeTicket(raw: Record<string, unknown>, clientId: string, team: string) {
  const mid = _toIntOrNull(raw["id"]);
  if (mid === null) return null;
  const now = new Date().toISOString();
  const log = (raw["ultima_log"] && typeof raw["ultima_log"] === "object")
    ? (raw["ultima_log"] as Record<string, unknown>)
    : null;
  return {
    id: `${clientId}:ticket-${mid}`,
    client_id: clientId,
    team,
    milvus_ticket_id: mid,
    codigo: _toIntOrNull(raw["codigo"]),
    assunto: _toText(raw["assunto"]),
    descricao: _toText(raw["descricao"]),
    status: _toText(raw["status"]),
    prioridade: _toText(raw["prioridade"]),
    categoria_primaria: _toText(raw["categoria_primaria"]),
    categoria_secundaria: _toText(raw["categoria_secundaria"]),
    tecnico: _toText(raw["tecnico"]),
    data_criacao: _toIsoOrNull(raw["data_criacao"]),
    data_modificacao: _toIsoOrNull(raw["data_modificacao"]),
    data_solucao: _toIsoOrNull(raw["data_solucao"]),
    ultima_log: log
      ? { texto: _toText(log["texto"]), data: _toIsoOrNull(log["data"]), tecnico: _toText(log["tecnico"]) }
      : null,
    synced_at: now,
    updated_at: now,
  };
}

async function fetchTicketsPage(filter: Record<string, unknown>): Promise<unknown[]> {
  const body = {
    is_paginate: true,
    is_descending: true,
    order_by: "codigo",
    total_registros: 50,
    pagina: 1,
    filtro_body: filter,
  };

  let attempt = 0;
  while (attempt < 2) {
    attempt++;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    let res: Response;
    try {
      res = await fetch(TICKETS_URL, {
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
      data = await res.json();
    } catch {
      clearTimeout(timer);
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      throw new Error("Resposta inválida do Milvus");
    }
    clearTimeout(timer);
    const d = data as Record<string, unknown>;
    const lista = (d["lista"] ?? d["data"] ?? null) as unknown;
    if (!Array.isArray(lista)) throw new Error("Resposta do Milvus sem lista de chamados");
    return lista as unknown[];
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
    console.error("milvus-tickets: service role não configurada");
    return json({ error: "Serviço indisponível" }, 500);
  }
  if (!MILVUS_API_TOKEN) {
    console.error("milvus-tickets: MILVUS_API_TOKEN não configurado");
    return json({ error: "Integração Milvus não configurada" }, 500);
  }

  const startedAt = Date.now();
  const authHeader = req.headers.get("authorization") || "";
  const callerToken = authHeader.replace(/^Bearer\s+/i, "");
  if (!callerToken) return json({ error: "Não autenticado" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1) Quem chama (JWT — mesma base do RLS).
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
    .select("id, name, team, milvus_client_token")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) return json({ error: "Cliente não encontrado" }, 404);

  // 3) Autorização: mesma regra das policies (sem bypass).
  const isAdmin = callerOp.is_admin === true;
  const opTeam = callerOp.team || "init";
  const cliTeam = client.team || "init";
  if (!isAdmin && opTeam !== cliTeam) {
    return json({ error: "Acesso negado a este cliente" }, 403);
  }

  console.log(`milvus-tickets: início client_id=${clientId} team=${cliTeam}`);

  // 4) Filtro preferencial: clients.milvus_client_token (trim; nunca o
  // segredo da API). Fallback: ids do mapa explícito (sem fuzzy).
  const clientToken = String(client.milvus_client_token ?? "").trim();
  const { data: mapRows } = await admin
    .from("milvus_client_map")
    .select("milvus_nome,milvus_cliente_id")
    .eq("client_id", clientId);
  const clienteIds = [...new Set((mapRows || [])
    .map((r: { milvus_cliente_id: number | null }) => r.milvus_cliente_id)
    .filter((n): n is number => typeof n === "number"))];
  if (!clientToken && !clienteIds.length) {
    return json({
      success: false, code: "MILVUS_CLIENT_TOKEN_NOT_CONFIGURED",
      clientId, unmapped: true, synced: 0, created: 0, updated: 0, pruned: 0,
      lastSyncAt: new Date().toISOString(),
    });
  }

  // 5) 1 consulta por filtro (sem paginar os 20k+). Log registra só a
  // presença do token, nunca o valor.
  const via = clientToken ? "token" : "map";
  console.log(`milvus-tickets: filtro client_id=${clientId} via=${via} hasToken=${!!clientToken}`);
  const seen = new Map<number, Record<string, unknown>>();
  try {
    const filters: Record<string, unknown>[] = clientToken
      ? [{ cliente_token: clientToken }]
      : clienteIds.map((cid) => ({ cliente_id: cid }));
    for (const filter of filters) {
      const items = await fetchTicketsPage(filter);
      for (const raw of items) {
        const row = normalizeTicket(raw as Record<string, unknown>, clientId, cliTeam);
        if (row && !seen.has(row.milvus_ticket_id as number)) {
          seen.set(row.milvus_ticket_id as number, row as unknown as Record<string, unknown>);
        }
      }
    }
  } catch (e) {
    console.error(`milvus-tickets: erro client_id=${clientId}: ${(e as Error)?.message ?? "erro"}`);
    return json({ error: "Não foi possível atualizar os chamados do Milvus." }, 502);
  }

  // Top 10 por código descrescente (a API ignora total_registros).
  const top = [...seen.values()]
    .sort((a, b) => Number(b["codigo"] ?? 0) - Number(a["codigo"] ?? 0))
    .slice(0, KEEP_TOP);

  // 6) Upsert + contagem (chave client_id + milvus_ticket_id).
  const { data: existing } = await admin
    .from("client_milvus_tickets")
    .select("milvus_ticket_id")
    .eq("client_id", clientId);
  const existingIds = new Set((existing || []).map((r: { milvus_ticket_id: number }) => r.milvus_ticket_id));
  let created = 0;
  let updated = 0;
  const keepIds = new Set<number>();
  const rows = [];
  for (const r of top) {
    const mid = r["milvus_ticket_id"] as number;
    keepIds.add(mid);
    rows.push(r);
    if (existingIds.has(mid)) updated++;
    else { created++; existingIds.add(mid); }
  }
  if (rows.length) {
    const { error } = await admin
      .from("client_milvus_tickets")
      .upsert(rows, { onConflict: "client_id,milvus_ticket_id" });
    if (error) {
      console.error(`milvus-tickets: upsert falhou client_id=${clientId}: ${error.message}`);
      return json({ error: "Não foi possível atualizar os chamados do Milvus." }, 500);
    }
  }

  // 7) Prune: mantém no máx. os 10 maiores códigos, SOMENTE deste
  // cliente. Coleta vazia nunca apaga (protege contra falha transitória:
  // com keepIds vazio não há o que preservar, então pula).
  let pruned = 0;
  if (keepIds.size > 0) {
    const { data: all } = await admin
      .from("client_milvus_tickets")
      .select("milvus_ticket_id")
      .eq("client_id", clientId)
      .order("codigo", { ascending: false })
      .limit(200);
    const stale = (all || [])
      .map((r: { milvus_ticket_id: number }) => r.milvus_ticket_id)
      .filter((mid) => !keepIds.has(mid));
    if (stale.length) {
      const { error, count } = await admin
        .from("client_milvus_tickets")
        .delete({ count: "exact" })
        .eq("client_id", clientId)
        .in("milvus_ticket_id", stale);
      if (!error) pruned = count || 0;
    }
  }

  const durationMs = Date.now() - startedAt;
  const lastSyncAt = new Date().toISOString();
  console.log(
    `milvus-tickets: fim client_id=${clientId} via=${via} synced=${rows.length} ` +
    `created=${created} updated=${updated} pruned=${pruned} duration_ms=${durationMs} ok`,
  );
  return json({ success: true, clientId, via, synced: rows.length, created, updated, pruned, lastSyncAt });
});
