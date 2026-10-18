// supabase/functions/agenda-ics/index.ts
// Edge Function: agenda do técnico em formato iCalendar, para assinar no
// Google Agenda / Outlook / iPhone. O app de agenda não envia login, então:
//   supabase functions deploy agenda-ics --no-verify-jwt
// A autorização é o token secreto do link (tabela calendar_feeds, 046).
//
// GET /functions/v1/agenda-ics?t=<token>
// - Token inválido → 404 (não diz se o operador existe).
// - Só as visitas do PRÓPRIO operador, de 30 dias atrás até 6 meses à frente.
// - Sem dado sensível: cliente, motivo e observações da visita (o mesmo que
//   o técnico já vê no app). Nada de acessos/IDs remotos.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildIcs } from "./ics.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const APP_URL = Deno.env.get("APP_URL") ?? "";

function iso(d: Date) { return d.toISOString().slice(0, 10); }

serve(async (req: Request) => {
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return new Response("Indisponível", { status: 500 });

  const token = new URL(req.url).searchParams.get("t") || "";
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return new Response("Not found", { status: 404 });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: feed } = await admin.from("calendar_feeds").select("operator_id").eq("token", token).maybeSingle();
  if (!feed) return new Response("Not found", { status: 404 });
  const { data: op } = await admin.from("operators").select("id, name, active").eq("id", feed.operator_id).maybeSingle();
  if (!op || op.active === false) return new Response("Not found", { status: 404 });

  const now = new Date();
  const from = new Date(now.getTime() - 30 * 86400000);
  const to = new Date(now.getTime() + 183 * 86400000);
  // Por id (049); registros sem id (nome que não bateu com ninguém) pelo nome.
  const cols = "id, numero, client_name, motivo, observacoes, date, time, time_end, all_day, status, updated_at";
  const [byId, byName] = await Promise.all([
    admin.from("visits").select(cols).eq("operator_id", op.id).gte("date", iso(from)).lte("date", iso(to)).limit(1000),
    admin.from("visits").select(cols).is("operator_id", null).eq("operator", op.name).gte("date", iso(from)).lte("date", iso(to)).limit(1000),
  ]);
  // Banco ainda sem a coluna (049 não aplicada): cai só no nome.
  const legacy = byId.error ? await admin.from("visits").select(cols).eq("operator", op.name).gte("date", iso(from)).lte("date", iso(to)).limit(1000) : null;
  const error = legacy ? legacy.error : (byId.error || byName.error);
  const visits = legacy ? (legacy.data || []) : [...(byId.data || []), ...(byName.data || [])]
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (error) {
    console.error(`agenda-ics: leitura falhou op=${op.id}`);
    return new Response("Erro", { status: 500 });
  }
  admin.from("calendar_feeds").update({ last_used_at: now.toISOString() }).eq("operator_id", op.id).then(() => {});

  const body = buildIcs(visits || [], { name: "Init Intra — " + op.name, appUrl: APP_URL ? APP_URL + "#visitas" : "" });
  return new Response(req.method === "HEAD" ? null : body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="init-intra.ics"',
      "Cache-Control": "private, max-age=900",
    },
  });
});
