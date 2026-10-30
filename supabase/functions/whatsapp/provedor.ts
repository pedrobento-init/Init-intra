// Adaptador do provedor de WhatsApp — hoje a Z-API.
//
// É o ÚNICO arquivo que conhece o formato do provedor: o webhook e o
// whatsapp-responder só falam MensagemWhats e enviarTexto. Trocar para
// Evolution ou Meta Cloud é reescrever estas duas funções mantendo as
// assinaturas; os testes de mensagem.ts e das functions continuam valendo.
//
// Sem imports `npm:` de propósito: o vitest importa este arquivo direto.

import type { MensagemWhats } from "./mensagem.ts";

export type CredenciaisZapi = {
  instanceId?: string | null;
  token?: string | null;
  clientToken?: string | null;
};

export type Envio = { ok: boolean; id?: string; erro?: string };

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

const NOME_MAX = 120;

function quandoDe(momment: unknown): string {
  const ms = Number(momment);
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : new Date().toISOString();
}

// Webhook "Ao receber" da Z-API (type ReceivedCallback). Aceita objeto ou
// lista porque o formato do lote não é garantido e custa nada aceitar os dois.
//
// Ficam de fora, sem erro:
//   * fromMe — a Z-API também avisa o que o próprio número mandou (inclusive o
//     que o whatsapp-responder enviou); tratar isso como pedido do cliente
//     faria o chamado conversar consigo mesmo;
//   * isGroup — grupo não é solicitante, e o telefone do payload seria o do
//     grupo, não de quem pediu;
//   * mensagem sem texto (áudio, figurinha, status de entrega): sem texto não
//     há o que triar, e quem atende vê no próprio WhatsApp.
export function mensagensDoWebhook(payload: unknown): MensagemWhats[] {
  const lista = Array.isArray(payload) ? payload : [payload];
  const out: MensagemWhats[] = [];
  for (const bruto of lista) {
    if (!bruto || typeof bruto !== "object") continue;
    const p = bruto as Record<string, unknown>;
    if (p.type !== undefined && p.type !== "ReceivedCallback") continue;
    if (p.fromMe === true || p.isGroup === true) continue;
    const corpo = p.text as Record<string, unknown> | undefined;
    const texto = String(corpo?.message ?? "").trim();
    if (!texto) continue;
    const telefone = String(p.phone ?? "").replace(/\D/g, "");
    if (!telefone) continue;
    const id = String(p.messageId ?? "").trim();
    if (!id) continue;
    const nome = String(p.senderName ?? p.chatName ?? "").trim().slice(0, NOME_MAX);
    out.push({ telefone, nome, texto, id, quando: quandoDe(p.momment) });
  }
  return out;
}

// Envia texto pela Z-API. Não lança: devolve {ok:false, erro} para a function
// decidir o código HTTP.
//
// A URL leva o token da instância no caminho — por isso nunca vai para log,
// nem dentro de mensagem de erro.
export async function enviarTexto(
  telefone: string,
  texto: string,
  cred: CredenciaisZapi,
  fetchFn: FetchFn = fetch,
): Promise<Envio> {
  const instancia = String(cred.instanceId || "").trim();
  const token = String(cred.token || "").trim();
  const clientToken = String(cred.clientToken || "").trim();
  if (!instancia || !token || !clientToken) return { ok: false, erro: "credenciais" };
  const url = `https://api.z-api.io/instances/${encodeURIComponent(instancia)}/token/${encodeURIComponent(token)}/send-text`;
  let resp: Response;
  try {
    resp = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Client-Token": clientToken },
      body: JSON.stringify({ phone: String(telefone || "").replace(/\D/g, ""), message: texto }),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    return { ok: false, erro: "inalcancavel" };
  }
  if (!resp.ok) return { ok: false, erro: `provedor ${resp.status}` };
  let corpo: Record<string, unknown> = {};
  try {
    corpo = (await resp.json()) || {};
  } catch {
    // 2xx sem JSON ainda é envio aceito; só fica sem id.
  }
  const id = String(corpo.zaapId ?? corpo.messageId ?? corpo.id ?? "").trim();
  return id ? { ok: true, id } : { ok: true };
}
