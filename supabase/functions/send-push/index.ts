// supabase/functions/send-push/index.ts
// Notificação no celular (Web Push) quando alguém cria, muda ou comenta uma
// pendência de outro operador. O app chama junto com o e-mail.
//
// CONFIGURAÇÃO (uma vez):
//   npx web-push generate-vapid-keys
//   supabase secrets set VAPID_PUBLIC_KEY=<public> VAPID_PRIVATE_KEY=<private>
//   supabase secrets set VAPID_SUBJECT=mailto:ti@initnet.com.br
//   supabase functions deploy send-push
// Tabela: migration 053_push_subscriptions.sql.
//
// GET  → { publicKey } (o app precisa dela para inscrever o aparelho).
// POST { to: [emails], title, body, url } → envia aos aparelhos inscritos.
//
// SEGURANÇA: só operador ativo logado. Destinatários só operadores ativos
// (lidos com service_role); quem envia não recebe o próprio push. O link
// só pode ser uma rota do app ("#pendencias").

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.113.0";
import { buildPushPayload, pushRecipients } from "./payload.ts";
import { pushConfigured, pushToOperators, VAPID_PUBLIC_KEY } from "./push.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-api-version, x-supabase-client-platform",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });
  const { data: userData } = await sb.auth.getUser();
  const { data: me } = userData?.user
    ? await sb.from("operators").select("id,active").eq("auth_user_id", userData.user.id).maybeSingle()
    : { data: null };
  if (!me || me.active === false) return json({ error: "Não autorizado", code: "unauthorized" }, 401);

  if (!pushConfigured()) return json({ error: "Push não configurado no servidor (VAPID_*)", code: "not_configured" }, 503);
  if (req.method === "GET") return json({ publicKey: VAPID_PUBLIC_KEY });

  let input: { to?: unknown; title?: unknown; body?: unknown; url?: unknown; tag?: unknown };
  try { input = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }
  const to = Array.isArray(input.to) ? input.to.slice(0, 100) : [];
  const payload = buildPushPayload(input);
  if (!payload || !to.length) return json({ error: "Destinatário e título obrigatórios" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: ops, error } = await admin.from("operators").select("id, email, active");
  if (error) return json({ error: "Não foi possível conferir os destinatários" }, 500);
  const ids = pushRecipients(ops ?? [], to, me.id);
  const result = await pushToOperators(admin, ids, payload);
  return json({ success: true, ...result });
});
