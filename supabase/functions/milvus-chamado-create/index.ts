// supabase/functions/milvus-chamado-create/index.ts
// Edge Function: cria UM chamado no Milvus para UMA visita (integração
// "visita criada → chamado criado") + abstração de finalização (futura).
//
// CONFIGURAÇÃO (secrets — nunca no frontend, nunca no banco):
//   supabase secrets set MILVUS_API_TOKEN=seu_token_aqui
//   supabase secrets set MILVUS_API_URL=https://apiintegracao.milvus.com.br
//   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=sb_secret_xxxx
//   # Defaults do payload (sem eles a criação usa "" e o Milvus pode
//   # recusar com 4xx — ver MILVUS_DEFAULT_* abaixo):
//   supabase secrets set MILVUS_DEFAULT_TECNICO="tecnico@empresa.com.br"
//   supabase secrets set MILVUS_DEFAULT_MESA="Mesa padrão"
//   supabase secrets set MILVUS_DEFAULT_SETOR="Setor padrão"
//   supabase secrets set MILVUS_DEFAULT_CATEGORIA_PRIMARIA="Backup"
//   supabase secrets set MILVUS_DEFAULT_CATEGORIA_SECUNDARIA="Verificar"
//   supabase secrets set MILVUS_DEFAULT_CATEGORIA_ID=1
//   supabase functions deploy milvus-chamado-create
//
// FLUXO (visita → chamado, idempotente):
// - Frontend envia SOMENTE { visitId }. Todo o resto (cliente, payload,
//   token) é resolvido aqui — o frontend NUNCA vê o MILVUS_API_TOKEN.
// - Fast-path: visits.milvus_chamado_codigo já preenchido → devolve o
//   código SEM chamar o Milvus (retry/reload não duplicam).
// - Anti-duplicação pós-timeout: antes de criar, busca 1 página da
//   listagem filtrada pelo cliente e procura o marcador `[ref:VIS-id]`
//   na descrição. Achou → adota o código (o chamado foi criado numa
//   tentativa cuja resposta se perdeu). Não achou → cria.
// - Sucesso (HTTP 200 + código): grava visits.milvus_chamado_* e
//   devolve { success:true, codigo }.
// - Erros permanentes (sem token, 4xx validação, 401 token inválido):
//   códigos próprios, SEM retry automático no frontend.
// - Erros transitórios (rede, timeout, 5xx): HTTP 502 com código
//   MILVUS_UNAVAILABLE, SEM gravar nada (a visita segue pendente).
//
// SEGURANÇA (mesmo padrão de milvus-tickets):
// - Token só em Deno.env: nunca retornado, logado ou em erro.
// - JWT → operators → team-check ANTES de qualquer chamada/escrita;
//   service role só depois da autorização (sem bypass p/ o frontend).
//
// FINALIZAÇÃO (futura): action "finalizar" existe apenas como abstração
// (PUT /api/chamado/finalizar) e responde 501 até haver regra explícita.
// NENHUMA chamada de finalização é feita nesta etapa.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MILVUS_API_URL =
  Deno.env.get("MILVUS_API_URL") ?? "https://apiintegracao.milvus.com.br";
const MILVUS_API_TOKEN = Deno.env.get("MILVUS_API_TOKEN") ?? "";

const MILVUS_DEFAULTS = {
  tecnico: Deno.env.get("MILVUS_DEFAULT_TECNICO") ?? "",
  mesa: Deno.env.get("MILVUS_DEFAULT_MESA") ?? "",
  setor: Deno.env.get("MILVUS_DEFAULT_SETOR") ?? "",
  categoria_primaria: Deno.env.get("MILVUS_DEFAULT_CATEGORIA_PRIMARIA") ?? "",
  categoria_secundaria: Deno.env.get("MILVUS_DEFAULT_CATEGORIA_SECUNDARIA") ?? "",
  categoria_id: Number(Deno.env.get("MILVUS_DEFAULT_CATEGORIA_ID") ?? "") || null,
};

const CREATE_URL = `${MILVUS_API_URL.replace(/\/$/, "")}/api/chamado/criar`;
const LIST_URL = `${MILVUS_API_URL.replace(/\/$/, "")}/api/chamado/listagem`;
const FINALIZE_URL = `${MILVUS_API_URL.replace(/\/$/, "")}/api/chamado/finalizar`;
const FETCH_TIMEOUT_MS = 25000;

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

const _txt = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  return String(v);
};

const _toCodigo = (raw: string): number | null => {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const direct = Number(s);
  if (Number.isFinite(direct) && direct > 0) return Math.trunc(direct);
  try {
    const parsed: unknown = JSON.parse(s);
    if (typeof parsed === "number" && Number.isFinite(parsed) && parsed > 0) {
      return Math.trunc(parsed);
    }
    if (parsed && typeof parsed === "object") {
      const c = (parsed as Record<string, unknown>)["codigo"] ??
        (parsed as Record<string, unknown>)["code"] ??
        (parsed as Record<string, unknown>)["id"];
      const n = Number(c);
      if (Number.isFinite(n) && n > 0) return Math.trunc(n);
    }
  } catch {
    // corpo não-JSON e não-numérico: sem código aproveitável
  }
  return null;
};

const _escHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const _fmtDate = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso || "—");
};

// Marcador de idempotência: identifica o chamado desta visita mesmo se a
// resposta da criação se perdeu (cenário timeout → retry).
const _markerFor = (visitId: string): string => `[ref:${visitId}]`;

async function _fetchMilvus(url: string, body: unknown): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
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
}

type Visit = {
  id: string;
  client_id: string | null;
  client_name: string | null;
  operator: string | null;
  date: string | null;
  time: string | null;
  time_end: string | null;
  motivo: string | null;
  observacoes: string | null;
  relatorio: string | null;
  status: string | null;
  milvus_chamado_codigo: number | null;
};

type Client = {
  id: string;
  name: string | null;
  team: string | null;
  emails: unknown;
  owner: string | null;
  owner_phone: string | null;
  responsible: string | null;
  responsible_phone: string | null;
  milvus_client_token: string | null;
};

function _firstEmail(emails: unknown): string {
  if (Array.isArray(emails)) {
    const found = emails.map(String).map((s) => s.trim()).find((s) => s.includes("@"));
    if (found) return found;
  }
  if (typeof emails === "string" && emails.includes("@")) return emails.trim();
  return "";
}

function _timeRange(v: Visit): string {
  const t = _txt(v.time).slice(0, 5);
  const te = _txt(v.time_end).slice(0, 5);
  if (t && te) return `${t}–${te}`;
  if (t) return `a partir das ${t}`;
  return "dia todo";
}

function buildCreatePayload(
  v: Visit,
  c: Client,
  clienteId: string | number,
): Record<string, unknown> {
  const marker = _markerFor(v.id);
  const assunto = `Visita técnica — ${_txt(v.client_name) || _txt(c.name) || "cliente"} — ${_fmtDate(_txt(v.date))}`;
  const lines = [
    `Motivo: ${_txt(v.motivo) || "—"}`,
    `Data: ${_fmtDate(_txt(v.date))} (${_timeRange(v)})`,
    `Operador: ${_txt(v.operator) || "—"}`,
  ];
  if (_txt(v.observacoes)) lines.push(`Observações: ${_txt(v.observacoes)}`);
  if (_txt(v.relatorio)) lines.push(`Relatório: ${_txt(v.relatorio)}`);
  lines.push(marker);
  const descricao = lines.join("\n");
  const descricaoHtml = "<p>" + lines.map(_escHtml).join("</p><p>") + "</p>";
  return {
    cliente_id: clienteId,
    chamado_assunto: assunto,
    chamado_descricao: descricao,
    chamado_descricao_html: descricaoHtml,
    chamado_email: _firstEmail(c.emails),
    chamado_telefone: _txt(c.responsible_phone) || _txt(c.owner_phone),
    chamado_contato: _txt(c.responsible) || _txt(c.owner) || _txt(c.name),
    is_b2c: false,
    chamado_tecnico: MILVUS_DEFAULTS.tecnico,
    chamado_mesa: MILVUS_DEFAULTS.mesa,
    chamado_setor: MILVUS_DEFAULTS.setor,
    chamado_categoria_primaria: MILVUS_DEFAULTS.categoria_primaria,
    chamado_categoria_secundaria: MILVUS_DEFAULTS.categoria_secundaria,
    categoria_id: MILVUS_DEFAULTS.categoria_id,
  };
}

// Procura chamado já criado para esta visita (marcador na descrição).
// Retorna o código adotado ou null. Nunca lança (falha = segue p/ criar).
async function findCreatedCodigo(
  filter: Record<string, unknown>,
  visitId: string,
): Promise<number | null> {
  try {
    const res = await _fetchMilvus(LIST_URL, {
      is_paginate: true,
      is_descending: true,
      order_by: "codigo",
      total_registros: 50,
      pagina: 1,
      filtro_body: filter,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    const lista = (data["lista"] ?? data["data"] ?? []) as unknown;
    if (!Array.isArray(lista)) return null;
    const marker = _markerFor(visitId);
    for (const raw of lista) {
      const row = raw as Record<string, unknown>;
      const desc = _txt(row["descricao"]);
      if (desc.includes(marker)) {
        const cod = Number(row["codigo"]);
        if (Number.isFinite(cod) && cod > 0) return Math.trunc(cod);
      }
    }
    return null;
  } catch {
    return null;
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
    console.error("milvus-chamado-create: service role não configurada");
    return json({ error: "Serviço indisponível" }, 500);
  }
  if (!MILVUS_API_TOKEN) {
    console.error("milvus-chamado-create: MILVUS_API_TOKEN não configurado");
    return json({ error: "Integração Milvus não configurada" }, 500);
  }

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

  // 2) Qual visita (+ ação futura).
  let visitId = "";
  let action = "criar";
  try {
    const body = await req.json();
    visitId = String(body?.visitId ?? "").trim();
    if (body?.action) action = String(body.action).trim().toLowerCase();
  } catch {
    return json({ error: "Corpo inválido" }, 400);
  }
  if (!visitId) return json({ error: "visitId é obrigatório" }, 400);

  // 3) Finalização: abstraída para etapa futura — sem regra, sem chamada.
  if (action === "finalizar") {
    return json({
      success: false,
      code: "MILVUS_FINALIZE_NOT_IMPLEMENTED",
      message: "Finalização automática de chamados ainda não possui regra definida.",
    }, 501);
  }
  if (action !== "criar") return json({ error: "action inválida" }, 400);

  const { data: visit } = await admin
    .from("visits")
    .select("id, client_id, client_name, operator, date, time, time_end, motivo, observacoes, relatorio, status, milvus_chamado_codigo")
    .eq("id", visitId)
    .maybeSingle();
  const v = visit as Visit | null;
  if (!v) return json({ error: "Visita não encontrada" }, 404);

  // 4) Idempotência rápida: código já gravado → devolve sem tocar o Milvus.
  if (v.milvus_chamado_codigo && Number(v.milvus_chamado_codigo) > 0) {
    return json({ success: true, already: true, codigo: Number(v.milvus_chamado_codigo), visitId });
  }

  if (!v.client_id) {
    return json({ success: false, code: "MILVUS_VISIT_WITHOUT_CLIENT", visitId }, 200);
  }
  const { data: client } = await admin
    .from("clients")
    .select("id, name, team, emails, owner, owner_phone, responsible, responsible_phone, milvus_client_token")
    .eq("id", v.client_id)
    .maybeSingle();
  const c = client as Client | null;
  if (!c) return json({ error: "Cliente da visita não encontrado" }, 404);

  // 5) Autorização: mesma regra das policies (sem bypass).
  const isAdmin = callerOp.is_admin === true;
  const opTeam = callerOp.team || "init";
  const cliTeam = c.team || "init";
  if (!isAdmin && opTeam !== cliTeam) {
    return json({ error: "Acesso negado a este cliente" }, 403);
  }

  console.log(`milvus-chamado-create: início visit_id=${visitId} client_id=${c.id} team=${cliTeam}`);

  // 6) Identificador do cliente no Milvus: token preferencial, senão mapa.
  const clientToken = String(c.milvus_client_token ?? "").trim();
  let clienteId: string | number | null = clientToken || null;
  if (!clienteId) {
    const { data: mapRows } = await admin
      .from("milvus_client_map")
      .select("milvus_cliente_id")
      .eq("client_id", c.id);
    const ids = [...new Set((mapRows || [])
      .map((r: { milvus_cliente_id: number | null }) => r.milvus_cliente_id)
      .filter((n): n is number => typeof n === "number"))];
    if (ids.length) clienteId = ids[0];
  }
  if (!clienteId) {
    return json({
      success: false, code: "MILVUS_CLIENT_TOKEN_NOT_CONFIGURED",
      visitId, unmapped: true,
    });
  }
  const filter = typeof clienteId === "number"
    ? { cliente_id: clienteId }
    : { cliente_token: clienteId };

  // 7) Recuperação pós-timeout: o chamado pode existir sem resposta.
  const recovered = await findCreatedCodigo(filter, visitId);
  if (recovered) {
    await admin.from("visits").update({
      milvus_chamado_codigo: recovered,
      milvus_chamado_status: "criado",
      milvus_chamado_erro: null,
      updated_at: new Date().toISOString(),
    }).eq("id", visitId);
    console.log(`milvus-chamado-create: recuperado visit_id=${visitId} codigo=${recovered} (marcador)`);
    return json({ success: true, recovered: true, codigo: recovered, visitId });
  }

  // 8) Criação (tentativa única: resultado incerto volta como pendente e
  // a próxima execução recupera pelo marcador — sem duplicar).
  const payload = buildCreatePayload(v, c, clienteId);
  let res: Response;
  try {
    res = await _fetchMilvus(CREATE_URL, payload);
  } catch (e) {
    console.error(`milvus-chamado-create: rede/timeout visit_id=${visitId}: ${(e as Error)?.name ?? "erro"}`);
    return json({ success: false, code: "MILVUS_UNAVAILABLE", visitId }, 502);
  }
  if (res.status === 401 || res.status === 403) {
    console.error(`milvus-chamado-create: auth Milvus recusada (HTTP ${res.status}) visit_id=${visitId}`);
    return json({ success: false, code: "MILVUS_INVALID_TOKEN", visitId }, 200);
  }
  if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
    console.error(`milvus-chamado-create: Milvus indisponível (HTTP ${res.status}) visit_id=${visitId}`);
    return json({ success: false, code: "MILVUS_UNAVAILABLE", visitId }, 502);
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    console.error(`milvus-chamado-create: HTTP ${res.status} visit_id=${visitId} detail=${detail}`);
    return json({ success: false, code: "MILVUS_VALIDATION_ERROR", visitId, detail }, 200);
  }
  const rawBody = await res.text().catch(() => "");
  const codigo = _toCodigo(rawBody);
  if (!codigo) {
    console.error(`milvus-chamado-create: resposta sem código visit_id=${visitId} body=${rawBody.slice(0, 200)}`);
    return json({ success: false, code: "MILVUS_UNAVAILABLE", visitId }, 502);
  }

  const { error: updErr } = await admin.from("visits").update({
    milvus_chamado_codigo: codigo,
    milvus_chamado_status: "criado",
    milvus_chamado_erro: null,
    updated_at: new Date().toISOString(),
  }).eq("id", visitId);
  if (updErr) {
    console.error(`milvus-chamado-create: chamado ${codigo} criado mas visits não atualizou visit_id=${visitId}: ${updErr.message}`);
    // O código volta mesmo assim: o frontend grava o local e o sync
    // propaga; o marcador impede duplicata numa nova tentativa.
  }
  console.log(`milvus-chamado-create: fim visit_id=${visitId} codigo=${codigo} ok`);
  return json({ success: true, codigo, visitId });
});
