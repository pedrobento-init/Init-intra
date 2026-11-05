// Adaptador do provedor de WhatsApp — hoje a Evolution API (v2, auto-hospedada).
//
// É o ÚNICO arquivo que conhece o formato do provedor: o webhook e o
// whatsapp-responder só falam MensagemWhats e enviarTexto. Trocar de provedor
// (Meta Cloud, outro) é reescrever estas duas funções mantendo as assinaturas;
// os testes de mensagem.ts e das functions continuam valendo.
//
// O formato foi conferido no código-fonte da Evolution 2.3.7
// (whatsapp.baileys.service.ts: prepareMessage e o envio de MESSAGES_UPSERT),
// não só na documentação.
//
// Sem imports `npm:` de propósito: o vitest importa este arquivo direto.

import type { MensagemWhats } from "./mensagem.ts";

export type CredenciaisEvolution = {
  url?: string | null;
  instancia?: string | null;
  apikey?: string | null;
};

export type Envio = { ok: boolean; id?: string; erro?: string };

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

const NOME_MAX = 120;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? v as Obj : null);

// A Evolution manda messageTimestamp em SEGUNDOS (número ou string). Valor já
// em milissegundos também é aceito: é barato e evita data em 1970 se um dia
// mudar.
function quandoDe(ts: unknown): string {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return new Date().toISOString();
  return new Date(n < 1e12 ? n * 1000 : n).toISOString();
}

// "5511987654321@s.whatsapp.net" (ou "...:12@s.whatsapp.net", com o aparelho)
// → "5511987654321". Só JID de pessoa vira telefone: grupo (@g.us), status e
// lista de transmissão (@broadcast) e newsletter não são solicitante.
function telefoneDoJid(jid: unknown): string {
  const s = String(jid ?? "");
  if (!s.endsWith("@s.whatsapp.net")) return "";
  return s.split("@")[0].split(":")[0].replace(/\D/g, "");
}

// Contatos novos do WhatsApp podem chegar com remoteJid "<id>@lid", um
// identificador que NÃO é o telefone. A Evolution troca pelo remoteJidAlt
// quando o tem; versões anteriores mandavam o número em senderPn. Sem nenhum
// dos dois não há telefone, e a mensagem fica de fora — casar cliente ou
// responder para um @lid não funcionaria.
function telefoneDaChave(key: Obj): string {
  return telefoneDoJid(key.remoteJid) || telefoneDoJid(key.remoteJidAlt) || telefoneDoJid(key.senderPn);
}

function textoDe(message: Obj | null): string {
  if (!message) return "";
  // prepareMessage já converte extendedTextMessage (texto com link, citação)
  // em conversation; o fallback cobre versão que não converta.
  const ext = obj(message.extendedTextMessage);
  return String(message.conversation ?? ext?.text ?? "").trim();
}

// "messages.upsert" ou "MESSAGES_UPSERT": a Evolution usa as duas grafias
// conforme a origem (webhook da instância ou global).
function ehUpsert(evento: unknown): boolean {
  if (evento === undefined) return true;
  return String(evento).toLowerCase().replace(/_/g, ".") === "messages.upsert";
}

// Webhook da Evolution: { event, instance, data, ... }. Aceita lista de
// envelopes e `data` em lista porque o formato do lote não é garantido e
// custa nada aceitar.
//
// Ficam de fora, sem erro:
//   * fromMe — a Evolution também avisa o que o próprio número mandou
//     (inclusive o que o whatsapp-responder enviou); tratar isso como pedido do
//     cliente faria o chamado conversar consigo mesmo;
//   * grupo, status e @lid sem telefone (ver telefoneDaChave);
//   * mensagem sem texto (áudio, figurinha, foto sem legenda): sem texto não
//     há o que triar, e quem atende vê no próprio WhatsApp;
//   * qualquer outro evento (connection.update, messages.update…).
export function mensagensDoWebhook(payload: unknown): MensagemWhats[] {
  const envelopes = Array.isArray(payload) ? payload : [payload];
  const out: MensagemWhats[] = [];
  for (const bruto of envelopes) {
    const env = obj(bruto);
    if (!env || !ehUpsert(env.event)) continue;
    const dados = Array.isArray(env.data) ? env.data : [env.data];
    for (const d of dados) {
      const m = obj(d);
      const key = obj(m?.key);
      if (!m || !key || key.fromMe === true) continue;
      const texto = textoDe(obj(m.message));
      if (!texto) continue;
      const telefone = telefoneDaChave(key);
      if (!telefone) continue;
      const id = String(key.id ?? "").trim();
      if (!id) continue;
      const nome = String(m.pushName ?? "").trim().slice(0, NOME_MAX);
      out.push({ telefone, nome, texto, id, quando: quandoDe(m.messageTimestamp) });
    }
  }
  return out;
}

// Endereço do servidor da Evolution, sem barra no fim. Só https: a apikey vai
// no cabeçalho de cada envio e não pode atravessar a internet em texto puro.
function baseDe(url: unknown): string {
  const s = String(url ?? "").trim().replace(/\/+$/, "");
  try {
    return new URL(s).protocol === "https:" ? s : "";
  } catch {
    return "";
  }
}

// Envia texto pela Evolution. Não lança: devolve {ok:false, erro} para a
// function decidir o código HTTP.
//
// A apikey nunca vai para log nem para mensagem de erro.
export async function enviarTexto(
  telefone: string,
  texto: string,
  cred: CredenciaisEvolution,
  fetchFn: FetchFn = fetch,
): Promise<Envio> {
  const base = baseDe(cred.url);
  const instancia = String(cred.instancia || "").trim();
  const apikey = String(cred.apikey || "").trim();
  if (!base || !instancia || !apikey) return { ok: false, erro: "credenciais" };
  const url = `${base}/message/sendText/${encodeURIComponent(instancia)}`;
  let resp: Response;
  try {
    resp = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey },
      body: JSON.stringify({ number: String(telefone || "").replace(/\D/g, ""), text: texto }),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    return { ok: false, erro: "inalcancavel" };
  }
  if (!resp.ok) return { ok: false, erro: `provedor ${resp.status}` };
  let corpo: Obj = {};
  try {
    corpo = obj(await resp.json()) || {};
  } catch {
    // 2xx sem JSON ainda é envio aceito; só fica sem id.
  }
  // A resposta é a mensagem enviada, no mesmo formato do webhook: o id está
  // em key.id.
  const id = String(obj(corpo.key)?.id ?? "").trim();
  return id ? { ok: true, id } : { ok: true };
}
