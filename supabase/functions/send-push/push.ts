// Envio de Web Push para operadores (usado por send-push e avisos-prazo).
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY e VAPID_SUBJECT
// (ex.: mailto:ti@initnet.com.br). Gerar o par uma vez:
//   npx web-push generate-vapid-keys

import webpush from "npm:web-push@3.6.7";
import { isGoneStatus, type PushPayload } from "./payload.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:notificacoes@initnet.com.br";

export function pushConfigured(): boolean {
  return !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
}

/** Manda o push para todos os aparelhos inscritos dos operadores. Não lança. */
export async function pushToOperators(db: Db, operatorIds: string[], payload: PushPayload) {
  const out = { sent: 0, removed: 0, failed: 0 };
  if (!pushConfigured() || !operatorIds.length) return out;
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  const { data: subs, error } = await db
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .in("operator_id", operatorIds);
  if (error) { console.error("push_subscriptions:", error.message); return out; }
  const body = JSON.stringify(payload);
  await Promise.all((subs ?? []).map(async (s: { endpoint: string; p256dh: string; auth: string }) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 24 * 3600 });
      out.sent++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (isGoneStatus(status)) {
        await db.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
        out.removed++;
      } else {
        out.failed++;
        console.error("web-push:", status, (e as Error).message);
      }
    }
  }));
  return out;
}

/** Atalho: e-mails de operadores → ids ativos → push. */
export async function pushToEmails(db: Db, emails: string[], payload: PushPayload) {
  if (!pushConfigured() || !emails.length) return { sent: 0, removed: 0, failed: 0 };
  const lower = emails.map((e) => e.toLowerCase());
  const { data: ops } = await db.from("operators").select("id, email, active");
  const ids = (ops ?? [])
    .filter((o: { email?: string; active?: boolean }) => o.active !== false && lower.includes(String(o.email ?? "").toLowerCase()))
    .map((o: { id: string }) => o.id);
  return pushToOperators(db, ids, payload);
}
