// supabase/functions/avisos-prazo/index.ts
// Edge Function: lembretes de prazo (pendências) e avisos de vencimento,
// enviados UMA vez pelo servidor. Chamada pelo pg_cron todo dia (migration 051).
//
// Antes o navegador de quem abria o site disparava esses e-mails: o mesmo
// lembrete saía de novo a cada pessoa ou aba nova.
//
// DEPLOY:
//   supabase secrets set AVISOS_CRON_SECRET=<o mesmo valor guardado no Vault>
//   supabase secrets set APP_URL=https://<endereço do Intra>   (opcional: botão no e-mail)
//   supabase functions deploy avisos-prazo --no-verify-jwt
// Usa os mesmos GMAIL_USER / GMAIL_APP_PASSWORD (/ GMAIL_FROM) da send-email.
//
// SEGURANÇA: só responde com o header x-cron-secret correto. Lê e grava com
// service_role; destinatários saem da tabela operators (nunca do pedido).
// DUPLICIDADE: cada aviso é "reservado" em avisos_enviados (chave única)
// antes do envio; se o Gmail falhar, a reserva é desfeita e tenta amanhã.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.16";
import {
  isPendenciaGestao,
  pendenciaAvisoDevido,
  pendenciaAvisoKey,
  pendenciaEmail,
  recipientsFor,
  todayBR,
  vencAvisoDevido,
  vencimentoEmail,
  type Operator,
  type Pendencia,
  type Vencimento,
} from "./avisos.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("AVISOS_CRON_SECRET") ?? "";
const APP_URL = Deno.env.get("APP_URL") ?? "";
const GMAIL_USER = Deno.env.get("GMAIL_USER") ?? "";
const GMAIL_APP_PASSWORD = (Deno.env.get("GMAIL_APP_PASSWORD") ?? "").replace(/\s+/g, "");
const GMAIL_FROM = Deno.env.get("GMAIL_FROM") || GMAIL_USER;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function safeEqual(a: string, b: string) {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!CRON_SECRET || !safeEqual(req.headers.get("x-cron-secret") ?? "", CRON_SECRET)) {
    return json({ error: "Não autorizado" }, 401);
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !GMAIL_USER || !GMAIL_APP_PASSWORD) {
    return json({ error: "Secrets ausentes (SUPABASE_*, GMAIL_USER, GMAIL_APP_PASSWORD)" }, 500);
  }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });
  const today = todayBR();
  const result = { today, pendencias: 0, vencimentos: 0, falhas: [] as string[] };

  // Reserva a chave; false = outro envio já fez (ou está fazendo) este aviso.
  async function claim(key: string) {
    const { error } = await db.from("avisos_enviados").insert({ key });
    if (!error) return true;
    if (error.code === "23505") return false;
    throw new Error("avisos_enviados: " + error.message);
  }
  async function release(key: string) {
    await db.from("avisos_enviados").delete().eq("key", key);
  }
  async function send(to: string[], mail: { subject: string; html: string }) {
    await transporter.sendMail({ from: { name: "Init Intra", address: GMAIL_FROM }, to, subject: mail.subject, html: mail.html });
  }

  try {
    const { data: ops, error: opsErr } = await db
      .from("operators")
      .select("id, name, email, active, is_admin, is_gestao");
    if (opsErr) throw new Error("operators: " + opsErr.message);
    const operators = (ops ?? []) as Operator[];

    // ── Pendências: até 2 dias antes e no dia ──
    const until = new Date(Date.parse(today + "T12:00:00Z") + 2 * 86400000).toISOString().slice(0, 10);
    const { data: pens, error: penErr } = await db
      .from("pendencias")
      .select("id, assunto, descricao, client_name, responsible, responsible_id, priority, status, tipo, deadline")
      .gte("deadline", today)
      .lte("deadline", until);
    if (penErr) throw new Error("pendencias: " + penErr.message);

    for (const p of (pens ?? []) as Pendencia[]) {
      const due = pendenciaAvisoDevido(p, today);
      if (!due) continue;
      const to = recipientsFor(operators, { id: p.responsible_id, name: p.responsible }, { gestao: isPendenciaGestao(p) });
      if (!to.length) continue;
      const key = pendenciaAvisoKey(p, due.tipo);
      if (!(await claim(key))) continue;
      try {
        await send(to, pendenciaEmail(p, due.days, APP_URL));
        result.pendencias++;
      } catch (e) {
        await release(key);
        result.falhas.push(`${key}: ${(e as Error).message}`);
      }
    }

    // ── Vencimentos: 30 e 7 dias antes, no dia (e até 7 dias depois) ──
    const { data: vencs, error: vencErr } = await db
      .from("vencimentos")
      .select("id, tipo, descricao, client_name, data_vencimento, responsavel, responsavel_id, renovacao_auto, status, avisos")
      .neq("status", "encerrado")
      .lte("data_vencimento", new Date(Date.parse(today + "T12:00:00Z") + 30 * 86400000).toISOString().slice(0, 10))
      .gte("data_vencimento", new Date(Date.parse(today + "T12:00:00Z") - 7 * 86400000).toISOString().slice(0, 10));
    if (vencErr) throw new Error("vencimentos: " + vencErr.message);

    for (const v of (vencs ?? []) as Vencimento[]) {
      const due = vencAvisoDevido(v, today);
      if (!due) continue;
      const key = `vencimento:${v.id}:${String(v.data_vencimento).slice(0, 10)}:${due.aviso}`;
      if (!(await claim(key))) continue;
      const to = recipientsFor(operators, { id: v.responsavel_id, name: v.responsavel });
      try {
        if (to.length) {
          await send(to, vencimentoEmail(v, due.days, APP_URL));
          result.vencimentos++;
        }
        const avisos = [...new Set([...(Array.isArray(v.avisos) ? v.avisos.map(String) : []), ...due.marcar])];
        await db.from("vencimentos").update({ avisos, updated_at: new Date().toISOString() }).eq("id", v.id);
      } catch (e) {
        await release(key);
        result.falhas.push(`${key}: ${(e as Error).message}`);
      }
    }
  } catch (e) {
    console.error("avisos-prazo:", e);
    return json({ ...result, error: (e as Error).message }, 500);
  } finally {
    transporter.close();
  }

  if (result.falhas.length) console.error("avisos-prazo falhas:", result.falhas);
  return json(result);
});
