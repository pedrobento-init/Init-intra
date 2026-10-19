// Regras puras do Web Push (sem dependências: testadas no Vitest).

export type PushPayload = { title: string; body: string; url: string; tag?: string };

const MAX_TITLE = 80;
const MAX_BODY = 180;

function clip(s: unknown, n: number): string {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

/**
 * Normaliza o que vai no push. O link só pode ser uma rota do próprio app
 * ("#pendencias", "/#visitas"): nada de mandar o aparelho para outro site.
 */
export function buildPushPayload(input: { title?: unknown; body?: unknown; url?: unknown; tag?: unknown }): PushPayload | null {
  const title = clip(input.title, MAX_TITLE);
  if (!title) return null;
  const rawUrl = String(input.url ?? "").trim();
  const url = /^\/?#[a-z0-9_-]*$/i.test(rawUrl) ? (rawUrl.startsWith("/") ? rawUrl : "/" + rawUrl) : "/";
  const tag = clip(input.tag, 64);
  return { title, body: clip(input.body, MAX_BODY), url, ...(tag ? { tag } : {}) };
}

/** 404/410: o navegador descartou a inscrição; ela deve ser apagada. */
export function isGoneStatus(status: number | undefined): boolean {
  return status === 404 || status === 410;
}

/** E-mails (minúsculos, sem repetir) dos operadores ativos da lista, tirando quem enviou. */
export function pushRecipients(
  operators: { id: string; email?: string | null; active?: boolean | null }[],
  emails: unknown[],
  exceptOperatorId?: string | null,
): string[] {
  const wanted = new Set(emails.map((e) => String(e ?? "").trim().toLowerCase()).filter(Boolean));
  return [...new Set(
    operators
      .filter((o) => o.active !== false && o.id !== exceptOperatorId && wanted.has(String(o.email ?? "").trim().toLowerCase()))
      .map((o) => o.id),
  )];
}
