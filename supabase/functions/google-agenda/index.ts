// supabase/functions/google-agenda/index.ts
// Edge Function: ponte entre as visitas e o Google Apps Script (o "robô")
// que mexe nas agendas Google dos técnicos (migration 057). A função não
// fala com o Google: só diz ao robô o que enviar e aplica o que ele trouxe.
//
// CONFIGURAÇÃO (uma vez) — passo a passo em GOOGLE-AGENDA.md:
//   supabase secrets set AGENDA_SYNC_SECRET=<segredo longo e aleatório>
//   supabase secrets set APP_URL=https://<endereço do Intra>   (opcional)
//   supabase functions deploy google-agenda --no-verify-jwt
// (--no-verify-jwt porque quem chama é o Apps Script; a autorização é o
//  header x-agenda-secret, guardado nas propriedades do script.)
//
// A cada minuto o robô faz:
//   POST { action: "begin", runner_email }
//     → { calendars: [{ op, cal }], push: [{ seq, visit_id, event_id, cal, remove_from, event, hash }] }
//   (lê as mudanças de cada agenda e aplica o push no Google)
//   POST { action: "finish", calendars: [{ op, ok, error }], changes: [{ op, event }],
//          pushed: [{ seq, visit_id, ok, hash, error, access }] }
//
// REGRAS
// - Agenda do técnico = e-mail dele em operators (agenda principal).
// - Agenda compartilhada da equipe (ex.: "Atendimentos"): o id vai no
//   secret AGENDA_SHARED_CAL e toda visita sai lá também, com ou sem
//   técnico de e-mail cadastrado (migration 081). Nos itens trocados com
//   o robô ela é marcada com op = "shared" / dest = "shared".
// - Google → site: só data, horários e dia inteiro; evento apagado cancela a
//   visita agendada. Mudança do site ainda não enviada ÀQUELA agenda vence
//   (google_hash da pessoal, google_hash_shared da compartilhada — uma
//   assinatura por agenda, senão a confirmação de uma esconderia a outra).
// - As mudanças do Google são aplicadas ANTES de confirmar o push: o que o
//   robô leu é anterior ao envio, então não pode desfazer o que acabou de ir.

import { type SupabaseContext, withSupabase } from "npm:@supabase/server@1";
import { type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { eventIdFor, eventToVisitPatch, type GEvent, visitHash, visitIdFromEventId, visitToEvent, type VisitRow } from "./mapping.ts";

const APP_URL = (Deno.env.get("APP_URL") ?? "").replace(/\/$/, "");
const SECRET = Deno.env.get("AGENDA_SYNC_SECRET") ?? "";
// Agenda compartilhada da equipe (ex.: c_xxx@group.calendar.google.com).
// Vazia = só as agendas pessoais, como antes da 081.
const SHARED_CAL = (Deno.env.get("AGENDA_SHARED_CAL") ?? "").trim();
// Marcador do campo op/dest para a agenda compartilhada (não é um operator).
const SHARED_OP = "shared";

const VISIT_COLS = "id, numero, client_name, motivo, observacoes, date, time, time_end, all_day, status, operator, operator_id, google_hash, google_hash_shared, levar";
const PUSH_BATCH = 200;   // visitas por execução (o Apps Script tem 6 min)
const MAX_ATTEMPTS = 10;  // depois disso a visita sai da fila (erro fica no log)

type Visit = VisitRow & { operator?: string | null; operator_id?: string | null; google_hash?: string | null; google_hash_shared?: string | null };
type Op = { id: string; name: string; email: string | null; active: boolean | null };
type QueueRow = { seq: number; visit_id: string; old_operator_id: string | null; old_operator: string | null };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function safeEqual(a: string, b: string) {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

class Ops {
  byId = new Map<string, Op>();
  byName = new Map<string, Op>();
  constructor(list: Op[]) {
    for (const o of list) { this.byId.set(o.id, o); if (!this.byName.has(o.name)) this.byName.set(o.name, o); }
  }
  /** Operador da visita: por id (049); registros antigos só com nome, pelo nome. */
  of(id?: string | null, name?: string | null): Op | null {
    return (id ? this.byId.get(id) : name ? this.byName.get(name) : null) ?? null;
  }
  /** Agenda do operador: o e-mail, se ativo. */
  cal(op: Op | null): string | null {
    return op && op.active !== false && op.email ? op.email.trim().toLowerCase() : null;
  }
}

async function loadOps(db: SupabaseClient) {
  const { data, error } = await db.from("operators").select("id, name, email, active");
  if (error) throw new Error("operators: " + error.message);
  return new Ops((data || []) as Op[]);
}

/** Nome do técnico para o título na agenda compartilhada (cadastro > visita). */
function opNameOf(ops: Ops, v: Visit): string | null {
  return ops.of(v.operator_id, v.operator)?.name ?? v.operator ?? null;
}

async function loadVisits(db: SupabaseClient, ids: string[]) {
  const map = new Map<string, Visit>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await db.from("visits").select(VISIT_COLS).in("id", ids.slice(i, i + 100));
    if (error) throw new Error("visits: " + error.message);
    for (const v of (data || []) as Visit[]) map.set(v.id, v);
  }
  return map;
}

async function begin(db: SupabaseClient, input: { runner_email?: unknown }) {
  const email = typeof input.runner_email === "string" ? input.runner_email.slice(0, 200) : null;
  await db.from("google_agenda_runner").upsert({ id: 1, email, last_run_at: new Date().toISOString() });

  const ops = await loadOps(db);
  const calendars = [...ops.byId.values()].map((o) => ({ op: o.id, cal: ops.cal(o) })).filter((c) => c.cal);
  if (SHARED_CAL) calendars.push({ op: SHARED_OP, cal: SHARED_CAL });
  const { data: rows, error } = await db.from("google_agenda_queue")
    .select("seq, visit_id, old_operator_id, old_operator").order("seq").limit(PUSH_BATCH * 3);
  if (error) throw new Error("fila: " + error.message);
  // Várias mudanças da mesma visita viram um envio só (o estado atual).
  const groups = new Map<string, { seq: number; old: Set<string> }>();
  for (const r of (rows || []) as QueueRow[]) {
    if (!groups.has(r.visit_id)) {
      if (groups.size >= PUSH_BATCH) continue;
      groups.set(r.visit_id, { seq: r.seq, old: new Set() });
    }
    const g = groups.get(r.visit_id)!;
    g.seq = Math.max(g.seq, r.seq);
    const oldCal = ops.cal(ops.of(r.old_operator_id, r.old_operator));
    if (oldCal) g.old.add(oldCal);
  }

  const visits = await loadVisits(db, [...groups.keys()]);
  const push = [];
  const noop: { id: string; seq: number }[] = [];
  for (const [id, g] of groups) {
    const v = visits.get(id) ?? null;
    const cal = v ? ops.cal(ops.of(v.operator_id, v.operator)) : null;
    const live = !!v && v.status !== "cancelada" && /^\d{4}-\d{2}-\d{2}$/.test(String(v.date || ""));
    const removeFrom = [...g.old].filter((c) => c !== cal || !live);
    const hash = live ? await visitHash(v!) : null;
    // A compartilhada mostra o técnico no título: a assinatura dela inclui o
    // nome, então trocar de técnico reenvia o evento para atualizar o título.
    const hashShared = live && SHARED_CAL ? await visitHash(v!, opNameOf(ops, v!)) : null;

    // Destino pessoal (agenda do técnico). Nada a fazer quando já está igual,
    // ou quando o técnico não tem e-mail (fica sem hash, para ir quando tiver).
    const personalTodo = (live && !!cal && hash !== v!.google_hash) || removeFrom.length > 0 || (!live && !!cal);
    // Destino compartilhado ("Atendimentos"): toda visita, mesmo sem técnico
    // com e-mail. Visita morta sai de lá só se um dia entrou (hash gravado).
    const sharedTodo = !!SHARED_CAL && (live ? hashShared !== v!.google_hash_shared : !!v!.google_hash_shared);

    // Nada a fazer em NENHUMA das agendas: só tira da fila.
    if (!personalTodo && !sharedTodo) { noop.push({ id, seq: g.seq }); continue; }

    if (personalTodo) {
      push.push({
        seq: g.seq,
        visit_id: id,
        event_id: eventIdFor(id),
        cal: live ? cal : null,
        remove_from: live ? removeFrom : [...new Set([...removeFrom, ...(cal ? [cal] : [])])],
        event: live && cal ? visitToEvent(v!, APP_URL ? APP_URL + "/#visitas" : "") : null,
        hash: live && cal ? hash : null,
        dest: "personal",
      });
    }
    if (sharedTodo) {
      push.push({
        seq: g.seq,
        visit_id: id,
        event_id: eventIdFor(id),
        cal: live ? SHARED_CAL : null,
        remove_from: live ? [] : [SHARED_CAL],
        event: live ? visitToEvent(v!, APP_URL ? APP_URL + "/#visitas" : "", opNameOf(ops, v!)) : null,
        hash: hashShared,
        dest: SHARED_OP,
      });
    }
  }
  for (const n of noop) await db.from("google_agenda_queue").delete().eq("visit_id", n.id).lte("seq", n.seq);
  return json({ calendars, push });
}

/** Google → site: aplica um evento mudado na visita correspondente.
 *  opId nulo = o evento veio da agenda compartilhada: não há técnico dono
 *  para conferir, e a assinatura que vale é a da compartilhada. */
async function applyEvent(db: SupabaseClient, ops: Ops, opId: string | null, ev: GEvent): Promise<boolean> {
  const vid = visitIdFromEventId(ev?.id);
  if (!vid) return false;  // evento criado direto no Google: não é visita
  const v = (await loadVisits(db, [vid])).get(vid);
  if (!v || v.status === "cancelada") return false;
  if (opId !== null && ops.of(v.operator_id, v.operator)?.id !== opId) return false;
  const hashCol = opId === null ? "google_hash_shared" : "google_hash";
  // A compartilhada assina com o técnico no título; a pessoal, sem.
  const titleOp = opId === null ? opNameOf(ops, v) : undefined;
  // Mudança do site ainda não enviada a esta agenda: o site vence.
  if ((v[hashCol] ?? null) !== await visitHash(v, titleOp)) return false;

  const now = new Date().toISOString();
  if (ev.status === "cancelled") {
    if (v.status !== "agendada") return false;  // concluída não volta atrás
    // A outra agenda ainda tem o evento: sai no próximo ciclo, porque a
    // mudança de status põe a visita na fila e o hash dela ficou velho.
    await db.from("visits").update({ status: "cancelada", [hashCol]: null, updated_at: now }).eq("id", vid);
    return true;
  }
  const patch = eventToVisitPatch(ev, v);
  if (!patch) return false;
  const hash = await visitHash({ ...v, ...patch } as Visit, titleOp);
  await db.from("visits").update({ ...patch, [hashCol]: hash, updated_at: now }).eq("id", vid);
  return true;
}

/** Visitas do técnico de 7 dias atrás em diante → fila (agenda recém-liberada). */
async function backfill(db: SupabaseClient, op: Op) {
  const from = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const [byId, byName] = await Promise.all([
    db.from("visits").select("id").eq("operator_id", op.id).gte("date", from).neq("status", "cancelada").limit(500),
    db.from("visits").select("id").is("operator_id", null).eq("operator", op.name).gte("date", from).neq("status", "cancelada").limit(500),
  ]);
  const ids = [...(byId.data || []), ...(byName.data || [])].map((r) => r.id as string);
  if (!ids.length) return;
  // Sem hash = reenvia mesmo o que já foi um dia (a agenda pode ter sido
  // limpa). Mexer só em google_hash não dispara o trigger da 057.
  for (let i = 0; i < ids.length; i += 100) await db.from("visits").update({ google_hash: null }).in("id", ids.slice(i, i + 100));
  await db.from("google_agenda_queue").insert(ids.map((visit_id) => ({ visit_id })));
}

/** Agenda compartilhada recém-liberada: todas as visitas de 7 dias atrás em
 *  diante → fila, de qualquer técnico (mesma regra do backfill pessoal). */
async function backfillShared(db: SupabaseClient) {
  const from = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const { data } = await db.from("visits").select("id").gte("date", from).neq("status", "cancelada").limit(1000);
  const ids = (data || []).map((r) => r.id as string);
  if (!ids.length) return;
  for (let i = 0; i < ids.length; i += 100) await db.from("visits").update({ google_hash_shared: null }).in("id", ids.slice(i, i + 100));
  await db.from("google_agenda_queue").insert(ids.map((visit_id) => ({ visit_id })));
}

async function finish(db: SupabaseClient, input: { calendars?: unknown; changes?: unknown; pushed?: unknown }) {
  const ops = await loadOps(db);
  const now = new Date().toISOString();

  // 1. Acesso a cada agenda.
  const { data: prevRows } = await db.from("google_agenda_calendars").select("operator_id, ok, last_ok_at");
  const prev = new Map((prevRows || []).map((r) => [r.operator_id as string, r]));
  const { data: sharedRow } = SHARED_CAL
    ? await db.from("google_agenda_shared").select("id, ok, last_ok_at").eq("id", 1).maybeSingle()
    : { data: null };
  for (const c of (Array.isArray(input.calendars) ? input.calendars : []) as { op?: string; ok?: boolean; access?: boolean; error?: string }[]) {
    // Agenda compartilhada: estado na tabela própria (081), não é operador.
    if (c && c.op === SHARED_OP) {
      if (!SHARED_CAL) continue;
      if (c.ok !== true && c.access !== true && sharedRow) {
        await db.from("google_agenda_shared").update({ last_error: String(c.error || "").slice(0, 300), updated_at: now }).eq("id", 1);
        continue;
      }
      await db.from("google_agenda_shared").upsert({
        id: 1,
        calendar_id: SHARED_CAL,
        ok: c.ok === true,
        last_error: c.ok === true ? null : String(c.error || "Sem acesso").slice(0, 300),
        last_ok_at: c.ok === true ? now : (sharedRow?.last_ok_at ?? null),
        updated_at: now,
      });
      if (c.ok === true && !sharedRow?.ok) await backfillShared(db);
      continue;
    }
    const op = c && typeof c.op === "string" ? ops.byId.get(c.op) : null;
    const cal = ops.cal(op ?? null);
    if (!op || !cal) continue;
    const was = prev.get(op.id);
    // Falha passageira do Google: só anota o erro; o acesso continua valendo
    // (senão a volta ao normal reenviaria todas as visitas).
    if (c.ok !== true && c.access !== true && was) {
      await db.from("google_agenda_calendars").update({ last_error: String(c.error || "").slice(0, 300), updated_at: now }).eq("operator_id", op.id);
      continue;
    }
    await db.from("google_agenda_calendars").upsert({
      operator_id: op.id,
      calendar_id: cal,
      ok: c.ok === true,
      last_error: c.ok === true ? null : String(c.error || "Sem acesso").slice(0, 300),
      last_ok_at: c.ok === true ? now : (was?.last_ok_at ?? null),
      updated_at: now,
    });
    if (c.ok === true && !was?.ok) await backfill(db, op);
  }

  // 2. Mudanças feitas no Google (antes de confirmar o push — ver cabeçalho).
  let applied = 0;
  for (const ch of (Array.isArray(input.changes) ? input.changes : []).slice(0, 5000) as { op?: string; event?: GEvent }[]) {
    if (!ch || typeof ch.op !== "string" || !ch.event) continue;
    if (ch.op === SHARED_OP ? await applyEvent(db, ops, null, ch.event) : await applyEvent(db, ops, ch.op, ch.event)) applied++;
  }

  // 3. Resultado do push.
  const pushedIn = (Array.isArray(input.pushed) ? input.pushed : []) as
    { seq?: number; visit_id?: string; ok?: boolean; hash?: string | null; error?: string; access?: boolean; dest?: string }[];
  const valid = pushedIn.filter((p) => p && typeof p.visit_id === "string" && Number.isFinite(p.seq));
  const visits = await loadVisits(db, valid.filter((p) => p.ok).map((p) => p.visit_id as string));
  for (const p of valid) {
    const id = p.visit_id as string;
    if (p.ok || p.access) {
      // Sem acesso à agenda: sai da fila; volta inteira quando a agenda for
      // liberada (backfill pessoal ou da compartilhada).
      if (p.ok) {
        const v = visits.get(id);
        // Cada destino confirma a própria assinatura — e a compartilhada
        // assina com o técnico no título. dest ausente = robô de antes da
        // 081, que só conhece a agenda pessoal.
        const isShared = p.dest === SHARED_OP;
        const hashCol = isShared ? "google_hash_shared" : "google_hash";
        const esperado = p.hash ? await visitHash(v!, isShared ? opNameOf(ops, v!) : undefined) : null;
        // Só confirma se a visita não mudou de novo enquanto o robô enviava.
        if (v && (!p.hash || esperado === p.hash) && (v[hashCol] ?? null) !== (p.hash ?? null)) {
          await db.from("visits").update({ [hashCol]: p.hash ?? null }).eq("id", id);
        }
      }
      await db.from("google_agenda_queue").delete().eq("visit_id", id).lte("seq", p.seq as number);
    } else {
      const { data: q } = await db.from("google_agenda_queue").select("seq, attempts").eq("visit_id", id).lte("seq", p.seq as number);
      for (const r of q || []) {
        if ((r.attempts as number) + 1 >= MAX_ATTEMPTS) {
          console.error(`google-agenda: desistindo de ${id}: ${p.error}`);
          await db.from("google_agenda_queue").delete().eq("seq", r.seq);
        } else {
          await db.from("google_agenda_queue").update({ attempts: (r.attempts as number) + 1, last_error: String(p.error || "").slice(0, 300) }).eq("seq", r.seq);
        }
      }
    }
  }
  return json({ success: true, applied, pushed: valid.length });
}

// auth: "none" desliga só a checagem de JWT da plataforma: quem chama é o Apps
// Script, que não tem JWT. O x-agenda-secret continua sendo o primeiro teste.
async function handle(req: Request, ctx: SupabaseContext) {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!SECRET || !safeEqual(req.headers.get("x-agenda-secret") ?? "", SECRET)) return json({ error: "Não autorizado" }, 401);

  let input: { action?: string };
  try { input = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }
  const db = ctx.supabaseAdmin;
  try {
    if (input.action === "begin") return await begin(db, input);
    if (input.action === "finish") return await finish(db, input);
    return json({ error: "Ação desconhecida" }, 400);
  } catch (e) {
    console.error("google-agenda:", (e as Error).message);
    return json({ error: "Falha no servidor" }, 500);
  }
}

export default { fetch: withSupabase({ auth: "none" }, handle) };
