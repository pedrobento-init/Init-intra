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

import { type SupabaseContext, withSupabase } from "npm:@supabase/server@1";
import { buildPushPayload, pushRecipients } from "./payload.ts";
import { pushConfigured, pushToOperators, VAPID_PUBLIC_KEY } from "./push.ts";

// CORS e preflight ficam com o withSupabase: sem `allowedHeaders` na config,
// ele ecoa os headers pedidos no preflight — os que o supabase-js envia.
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function handle(req: Request, ctx: SupabaseContext): Promise<Response> {
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // ctx.supabase é o client DO CHAMADOR (RLS aplica), equivalente ao antigo
  // anon + Authorization repassado. ctx.supabaseAdmin, mais abaixo, é o que
  // bypassa — a distinção importa e foi preservada.
  const uid = ctx.userClaims?.id ?? null;
  const { data: me } = uid
    ? await ctx.supabase.from("operators").select("id,active").eq("auth_user_id", uid).maybeSingle()
    : { data: null };
  if (!me || me.active === false) return json({ error: "Não autorizado", code: "unauthorized" }, 401);

  if (!pushConfigured()) return json({ error: "Push não configurado no servidor (VAPID_*)", code: "not_configured" }, 503);
  if (req.method === "GET") return json({ publicKey: VAPID_PUBLIC_KEY });

  let input: { to?: unknown; title?: unknown; body?: unknown; url?: unknown; tag?: unknown };
  try { input = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }
  const to = Array.isArray(input.to) ? input.to.slice(0, 100) : [];
  const payload = buildPushPayload(input);
  if (!payload || !to.length) return json({ error: "Destinatário e título obrigatórios" }, 400);

  const admin = ctx.supabaseAdmin;
  const { data: ops, error } = await admin.from("operators").select("id, email, active");
  if (error) return json({ error: "Não foi possível conferir os destinatários" }, 500);
  const ids = pushRecipients(ops ?? [], to, me.id);
  const result = await pushToOperators(admin, ids, payload);
  return json({ success: true, ...result });
}

export default { fetch: withSupabase({ auth: "user" }, handle) };
