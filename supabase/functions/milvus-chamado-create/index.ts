// supabase/functions/milvus-chamado-create/index.ts
// Edge Function: integração visita ↔ chamado Milvus (2 etapas).
//
// ETAPA 1 — criar (action "criar", default): UMA visita → UM chamado via
// POST /api/chamado/criar, idempotente (código gravado + marcador
// `[ref:VIS-id]` recuperável pós-timeout).
//
// ETAPA 2 — finalizar (action "finalizar"): relatório concluído →
// PUT /api/chamado/finalizar com o código já associado à visita.
// Finalizar 2× o mesmo chamado é inócuo no Milvus (mesmo estado final),
// então o retry pós-timeout é seguro sem marcador.
//
// CONFIGURAÇÃO (secrets — nunca no frontend, nunca no banco):
//   supabase secrets set MILVUS_API_TOKEN=seu_token_aqui
//   supabase secrets set MILVUS_API_URL=https://apiintegracao.milvus.com.br
//   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=sb_secret_xxxx
//   # Defaults do payload de CRIAÇÃO (sem eles usa "" e o Milvus pode
//   # recusar com 4xx):
//   supabase secrets set MILVUS_DEFAULT_TECNICO="tecnico@empresa.com.br"
//   supabase secrets set MILVUS_DEFAULT_MESA="Mesa padrão"
//   supabase secrets set MILVUS_DEFAULT_SETOR="Setor padrão"
//   supabase secrets set MILVUS_DEFAULT_CATEGORIA_PRIMARIA="Backup"
//   supabase secrets set MILVUS_DEFAULT_CATEGORIA_SECUNDARIA="Verificar"
//   supabase secrets set MILVUS_DEFAULT_CATEGORIA_ID=1
//   supabase functions deploy milvus-chamado-create
//
// FLUXO finalizar (visita concluída → chamado finalizado):
// - Frontend envia SOMENTE { visitId, action:"finalizar" }. O token e o
//   payload ficam aqui — o frontend NUNCA vê o MILVUS_API_TOKEN.
// - Consulta de estado (listagem por codigo) antes de agir:
//   já "Finalizado" no Milvus (resposta perdida antes)? adota sem PUT.
//   Ainda Novo/"a fazer"? tenta o play ANTES de desistir: play → espera ~4s
//   → reconsulta; confirmado "Em atendimento", segue p/ o PUT; senão,
//   MILVUS_CHAMADO_NOT_IN_PROGRESS com mensagem amigável (play manual).
//   Falha na consulta? segue para o fluxo normal (o PUT decide).
// - Pré-passo "play": POST /api/chamado/atualizar com o E-MAIL do operador
//   da visita (o mesmo da Intra, tabela operators); sem e-mail, cai no
//   técnico default (MILVUS_DEFAULT_TECNICO). Atribuir técnico costuma mover
//   Novo → Em atendimento, que é o pré-requisito do Milvus p/ finalizar.
// - EVIDÊNCIA DE CAMPO (chamado real Novo 26030, matriz tools/milvus-play-matrix.ps1):
//   atualizar com codigo → 404 "não encontrado"; com id interno + tecnico
//   (nome e e-mail) ou prioridade → 500 "Campo inválido" em todas as variantes;
//   acompanhamento cria (204, inclusive privado) mas NÃO move o status.
//   Ou seja, nenhum caminho via API move Novo → atendimento nesses chamados;
//   o play manual no portal segue como saída oficial (a mensagem de erro já
//   orienta). Se futuros chamados responderem diferente, remover o bloco do
//   play economiza ~5s + 2 chamadas por finalização.
// - Rate limit da doc oficial (>1min entre requisições, máx 1000/página):
//   na prática o fluxo já encadeia chamadas; a reconsulta extra só roda no
//   caminho Novo, e sua falha NÃO bloqueia (o PUT decide em seguida).
// - Fast-path: visits.milvus_finalizar_status já "finalizado" → devolve o
//   código SEM chamar o Milvus (reload/retry não repetem a operação).
// - Sem milvus_chamado_codigo → MILVUS_VISIT_WITHOUT_CODIGO (permanente:
//   nada a finalizar; a conclusão local NUNCA é bloqueada por isso).
// - Payload real do relatório: servico_realizado = relatorio da visita
//   (texto livre, obrigatório p/ concluir); equipamento_retirado e
//   material_utilizado = "" (o modelo não possui esses campos — sem
//   inventar dados).
// - Sucesso (HTTP 200 + código): grava milvus_finalizar_status e devolve
//   { success:true, codigo }.
// - Erros permanentes (4xx validação, 401 token): códigos próprios, SEM
//   retry automático no frontend.
// - Erros transitórios (rede, timeout, 5xx): HTTP 502 com código
//   MILVUS_UNAVAILABLE, SEM gravar nada (segue pendente p/ retry; repetir
//   um PUT de finalização é seguro).
//
// SEGURANÇA (mesmo padrão de milvus-tickets):
// - Token só em Deno.env: nunca retornado, logado ou em erro.
// - JWT → operators → team-check ANTES de qualquer chamada/escrita;
//   service role só depois da autorização (sem bypass p/ o frontend).

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
const ATUALIZAR_URL = `${MILVUS_API_URL.replace(/\/$/, "")}/api/chamado/atualizar`;
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

// Marcador de idempotência da CRIAÇÃO: identifica o chamado desta visita
// mesmo se a resposta da criação se perdeu (cenário timeout → retry).
const _markerFor = (visitId: string): string => `[ref:${visitId}]`;

const _sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// E-mail do operador da visita (o mesmo da Intra, tabela operators).
// '' se não houver operador/e-mail. Nunca lança.
async function _resolveOperatorEmail(
  admin: ReturnType<typeof createClient>,
  visitOperator: string | null,
): Promise<string> {
  const name = _txt(visitOperator);
  if (!name) return "";
  try {
    const { data } = await admin.from("operators")
      .select("name,email,active")
      .eq("name", name)
      .limit(1)
      .maybeSingle();
    return _txt((data as { email?: unknown } | null)?.email);
  } catch {
    return "";
  }
}

// Fase 2: o técnico do play é o E-MAIL do operador da visita (o mesmo que
// ele usa na Intra, tabela operators); sem e-mail, cai no default abaixo.
async function _resolvePlayTecnico(
  admin: ReturnType<typeof createClient>,
  visitOperator: string | null,
): Promise<string> {
  const fallback = MILVUS_DEFAULTS.tecnico;
  const name = _txt(visitOperator);
  if (!name) {
    console.log(`milvus-chamado-create: play sem operador na visita — usando técnico default`);
    return fallback;
  }
  const email = await _resolveOperatorEmail(admin, name);
  if (email) {
    console.log(`milvus-chamado-create: play com e-mail do operador da visita (${name})`);
    return email;
  }
  console.log(`milvus-chamado-create: operador da visita sem e-mail (${name}) — usando técnico default`);
  return fallback;
}

// Pré-passo "play": atribui o técnico (e-mail do operador da visita, ou o
// default) via /api/chamado/atualizar. Atribuir técnico costuma mover Novo →
// Em atendimento (pré-requisito do finalizar). Retorna true se o Milvus
// aceitou (HTTP 2xx); false caso contrário. Best-effort: quem chama decide
// o próximo passo. Nunca lança.
async function _playChamado(
  admin: ReturnType<typeof createClient>,
  codigo: number,
  visitId: string,
  visitOperator: string | null,
): Promise<boolean> {
  const tecnico = await _resolvePlayTecnico(admin, visitOperator);
  if (!tecnico) {
    console.log(`milvus-chamado-create: play impossível visit_id=${visitId} (sem técnico default nem e-mail do operador)`);
    return false;
  }
  try {
    const upd = await _fetchMilvus(ATUALIZAR_URL, {
      chamado_ids: String(codigo),
      chamado_tecnico: tecnico,
    });
    const updBody = await upd.text().catch(() => "");
    console.log(`milvus-chamado-create: play visit_id=${visitId} codigo=${codigo} http=${upd.status} body=${updBody.slice(0, 200)}`);
    return upd.ok;
  } catch (e) {
    console.warn(`milvus-chamado-create: play falhou visit_id=${visitId} codigo=${codigo} (${(e as Error)?.name ?? "erro"})`);
    return false;
  }
}

async function _fetchMilvus(url: string, body: unknown, method = "POST"): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method,
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
  milvus_finalizar_status: string | null;
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

type Caller = { id: string; team: string; isAdmin: boolean };

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
  tecnicoEmail: string,
  operatorEmail: string,
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
    // Contato/e-mail = operador da visita (não o responsável do cliente):
    // é o nome que aparece no cabeçalho do chamado no portal.
    chamado_email: operatorEmail || _firstEmail(c.emails),
    chamado_telefone: _txt(c.responsible_phone) || _txt(c.owner_phone),
    chamado_contato: _txt(v.operator) || _txt(c.responsible) || _txt(c.owner) || _txt(c.name),
    is_b2c: false,
    // Técnico = e-mail do operador da visita (o mesmo da Intra); sem e-mail,
    // cai no default. O AUTOR exibido no portal ("Pedro • há 13 minutos")
    // continua sendo o dono do token da API — para trocar o autor, gere o
    // token a partir de um usuário neutro no Milvus (ex.: "Integração").
    chamado_tecnico: tecnicoEmail || MILVUS_DEFAULTS.tecnico,
    chamado_mesa: MILVUS_DEFAULTS.mesa,
    chamado_setor: MILVUS_DEFAULTS.setor,
    chamado_categoria_primaria: MILVUS_DEFAULTS.categoria_primaria,
    chamado_categoria_secundaria: MILVUS_DEFAULTS.categoria_secundaria,
    categoria_id: MILVUS_DEFAULTS.categoria_id,
  };
}

// Payload da FINALIZAÇÃO a partir do relatório real (espelho em
// js/milvus-chamado.js: buildMilvusFinalizarPayload — manter iguais).
// O relatório é texto livre: servico_realizado = relatorio; equipamento e
// material não existem no modelo → "" (sem inventar dados).
function buildFinalizePayload(v: Visit, codigo: number): Record<string, unknown> {
  return {
    chamado_codigo: String(codigo),
    chamado_servico_realizado: _txt(v.relatorio),
    chamado_equipamento_retirado: "",
    chamado_material_utilizado: "",
  };
}

// Consulta o status real de UM chamado pelo código (listagem).
// Retorna: 'finalizado' | 'aguardando' (a fazer/novo/aberto/agendado) |
// 'emandamento' (qualquer outro estado com responsável/fluxo) | null
// (falha na consulta — não bloqueia, o PUT decide). Nunca lança.
async function findChamadoStatus(codigo: string): Promise<string | null> {
  try {
    const res = await _fetchMilvus(LIST_URL, {
      is_paginate: true,
      pagina: 1,
      total_registros: 50,
      filtro_body: { codigo },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    const lista = (data["lista"] ?? data["data"] ?? []) as unknown;
    if (!Array.isArray(lista)) return null;
    const row = (lista as Record<string, unknown>[]).find(
      (r) => Number(r["codigo"]) === Number(codigo),
    );
    if (!row) return null;
    const s = _txt(row["status"]).toLowerCase().replace(/\s+/g, "");
    if (s.includes("finaliz")) return "finalizado";
    if (["afazer", "agatendimento", "novo", "aberto", "agendado", "semtecnico"].includes(s)) {
      return "aguardando";
    }
    return "emandamento";
  } catch {
    return null;
  }
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

// Autentica o chamador (JWT → operators). Retorna o operador ou Response de erro.
async function _authCaller(admin: ReturnType<typeof createClient>, callerToken: string): Promise<Caller | Response> {
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
  return {
    id: callerOp.id as string,
    team: (callerOp.team as string) || "init",
    isAdmin: callerOp.is_admin === true,
  };
}

// ETAPA 2 — finalizar o chamado da visita (relatório concluído).
async function _handleFinalizar(
  admin: ReturnType<typeof createClient>,
  caller: Caller,
  visitId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Response> {
  const { data: visit } = await admin
    .from("visits")
    .select("id, client_id, operator, relatorio, status, milvus_chamado_codigo, milvus_finalizar_status")
    .eq("id", visitId)
    .maybeSingle();
  const v = visit as (Pick<Visit, "id" | "client_id" | "operator" | "relatorio" | "status" | "milvus_chamado_codigo" | "milvus_finalizar_status">) | null;
  if (!v) return json({ error: "Visita não encontrada" }, 404);

  // Idempotência rápida: já finalizado → devolve sem tocar o Milvus.
  if (v.milvus_finalizar_status === "finalizado") {
    return json({ success: true, already: true, codigo: Number(v.milvus_chamado_codigo) || null, visitId });
  }
  const codigo = Number(v.milvus_chamado_codigo);
  if (!Number.isFinite(codigo) || codigo <= 0) {
    // Sem chamado associado: nada a finalizar (a conclusão local segue válida).
    return json({ success: false, code: "MILVUS_VISIT_WITHOUT_CODIGO", visitId });
  }

  if (!v.client_id) {
    return json({ success: false, code: "MILVUS_VISIT_WITHOUT_CLIENT", visitId });
  }
  const { data: client } = await admin
    .from("clients")
    .select("id, team")
    .eq("id", v.client_id)
    .maybeSingle();
  const c = client as { id: string; team: string | null } | null;
  if (!c) return json({ error: "Cliente da visita não encontrado" }, 404);
  if (!caller.isAdmin && caller.team !== (c.team || "init")) {
    return json({ error: "Acesso negado a este cliente" }, 403);
  }

  console.log(`milvus-chamado-create: finalizar início visit_id=${visitId} codigo=${codigo}`);

  // Estado real antes de agir: já finalizado (resposta perdida antes)?
  // adota sem PUT. Ainda Novo/"a fazer"? tenta o play ANTES de desistir
  // (play → espera → reconsulta); só desiste se continuar fora de
  // atendimento. Falha na consulta? segue para o fluxo normal (o PUT decide).
  const estado = await findChamadoStatus(String(codigo));
  if (estado === "finalizado") {
    await admin.from("visits").update({
      milvus_finalizar_status: "finalizado",
      milvus_finalizar_erro: null,
      updated_at: new Date().toISOString(),
    }).eq("id", visitId);
    console.log(`milvus-chamado-create: finalizar já aplicado no Milvus visit_id=${visitId} codigo=${codigo} (adotado por status)`);
    return json({ success: true, recovered: true, codigo, visitId });
  }
  let playJaFeito = false;
  if (estado === "aguardando") {
    console.log(`milvus-chamado-create: finalizar estado antes=Novo visit_id=${visitId} codigo=${codigo} (tentando play)`);
    const okPlay = await _playChamado(admin, codigo, visitId, v.operator);
    if (!okPlay) {
      console.log(`milvus-chamado-create: finalizar play não aplicado visit_id=${visitId} codigo=${codigo}`);
      return json({
        success: false,
        code: "MILVUS_CHAMADO_NOT_IN_PROGRESS",
        message: `O chamado ${codigo} ainda está Novo no Milvus e o play automático não pôde ser executado. Dê play manualmente no Milvus (coloque o chamado Em atendimento) e tente concluir de novo.`,
        codigo,
        visitId,
      });
    }
    playJaFeito = true;
    // Best-effort: dá tempo do Milvus transicionar antes de reconsultar.
    await _sleep(4000);
    const depois = await findChamadoStatus(String(codigo));
    console.log(`milvus-chamado-create: finalizar estado depois=${depois ?? "desconhecido"} visit_id=${visitId} codigo=${codigo}`);
    if (depois === "finalizado") {
      await admin.from("visits").update({
        milvus_finalizar_status: "finalizado",
        milvus_finalizar_erro: null,
        updated_at: new Date().toISOString(),
      }).eq("id", visitId);
      console.log(`milvus-chamado-create: finalizar já aplicado no Milvus visit_id=${visitId} codigo=${codigo} (adotado por status na reconsulta)`);
      return json({ success: true, recovered: true, codigo, visitId });
    }
    if (depois !== "emandamento" && depois !== null) {
      console.log(`milvus-chamado-create: finalizar bloqueado visit_id=${visitId} codigo=${codigo} (play não moveu para atendimento)`);
      return json({
        success: false,
        code: "MILVUS_CHAMADO_NOT_IN_PROGRESS",
        message: `O chamado ${codigo} continua fora de atendimento no Milvus mesmo após o play. Dê play manualmente no Milvus (coloque o chamado Em atendimento) e tente concluir de novo.`,
        codigo,
        visitId,
      });
    }
    console.log(`milvus-chamado-create: finalizar play confirmado em atendimento visit_id=${visitId} codigo=${codigo} (segue p/ finalizar)`);
  }

  // Pré-passo "play" best-effort para os demais casos (chamado já em
  // atendimento ou consulta inicial falhou). Idempotente; pulado quando o
  // play acima já rodou, para economizar chamadas à API.
  if (!playJaFeito) {
    await _playChamado(admin, codigo, visitId, v.operator);
  }

  const payload = buildFinalizePayload(
    { ...v, client_name: null, operator: null, date: null, time: null, time_end: null, motivo: null, observacoes: null } as Visit,
    codigo,
  );
  let res: Response;
  try {
    res = await _fetchMilvus(FINALIZE_URL, payload, "PUT");
  } catch (e) {
    console.error(`milvus-chamado-create: finalizar rede/timeout visit_id=${visitId}: ${(e as Error)?.name ?? "erro"}`);
    return json({ success: false, code: "MILVUS_UNAVAILABLE", visitId }, 502);
  }
  if (res.status === 401 || res.status === 403) {
    console.error(`milvus-chamado-create: finalizar auth Milvus recusada (HTTP ${res.status}) visit_id=${visitId}`);
    return json({ success: false, code: "MILVUS_INVALID_TOKEN", visitId });
  }
  if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
    console.error(`milvus-chamado-create: Milvus indisponível p/ finalizar (HTTP ${res.status}) visit_id=${visitId}`);
    return json({ success: false, code: "MILVUS_UNAVAILABLE", visitId }, 502);
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    console.error(`milvus-chamado-create: finalizar HTTP ${res.status} visit_id=${visitId} detail=${detail}`);
    return json({ success: false, code: "MILVUS_VALIDATION_ERROR", visitId, detail });
  }
  const rawBody = await res.text().catch(() => "");
  const echoed = _toCodigo(rawBody);
  const { error: updErr } = await admin.from("visits").update({
    milvus_finalizar_status: "finalizado",
    milvus_finalizar_erro: null,
    updated_at: new Date().toISOString(),
  }).eq("id", visitId);
  if (updErr) {
    console.error(`milvus-chamado-create: chamado ${codigo} finalizado mas visits não atualizou visit_id=${visitId}: ${updErr.message}`);
  }
  console.log(`milvus-chamado-create: finalizar fim visit_id=${visitId} codigo=${echoed || codigo} ok`);
  return json({ success: true, codigo: echoed || codigo, visitId });
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
  const caller = await _authCaller(admin, callerToken);
  if (caller instanceof Response) return caller;

  // 2) Qual visita (+ ação).
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

  // 3) ETAPA 2 — finalização (relatório concluído).
  if (action === "finalizar") return _handleFinalizar(admin, caller, visitId);
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
    return json({ success: false, code: "MILVUS_VISIT_WITHOUT_CLIENT", visitId });
  }
  const { data: client } = await admin
    .from("clients")
    .select("id, name, team, emails, owner, owner_phone, responsible, responsible_phone, milvus_client_token")
    .eq("id", v.client_id)
    .maybeSingle();
  const c = client as Client | null;
  if (!c) return json({ error: "Cliente da visita não encontrado" }, 404);

  // 5) Autorização: mesma regra das policies (sem bypass).
  if (!caller.isAdmin && caller.team !== (c.team || "init")) {
    return json({ error: "Acesso negado a este cliente" }, 403);
  }

  console.log(`milvus-chamado-create: início visit_id=${visitId} client_id=${c.id} team=${c.team || "init"}`);

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
  const operatorEmail = await _resolveOperatorEmail(admin, v.operator);
  const tecnicoCreate = operatorEmail || MILVUS_DEFAULTS.tecnico;
  const payload = buildCreatePayload(v, c, clienteId, tecnicoCreate, operatorEmail);
  let res: Response;
  try {
    res = await _fetchMilvus(CREATE_URL, payload);
  } catch (e) {
    console.error(`milvus-chamado-create: rede/timeout visit_id=${visitId}: ${(e as Error)?.name ?? "erro"}`);
    return json({ success: false, code: "MILVUS_UNAVAILABLE", visitId }, 502);
  }
  if (res.status === 401 || res.status === 403) {
    console.error(`milvus-chamado-create: auth Milvus recusada (HTTP ${res.status}) visit_id=${visitId}`);
    return json({ success: false, code: "MILVUS_INVALID_TOKEN", visitId });
  }
  if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
    console.error(`milvus-chamado-create: Milvus indisponível (HTTP ${res.status}) visit_id=${visitId}`);
    return json({ success: false, code: "MILVUS_UNAVAILABLE", visitId }, 502);
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    console.error(`milvus-chamado-create: HTTP ${res.status} visit_id=${visitId} detail=${detail}`);
    return json({ success: false, code: "MILVUS_VALIDATION_ERROR", visitId, detail });
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
