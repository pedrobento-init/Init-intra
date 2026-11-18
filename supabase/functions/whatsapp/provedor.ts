// Adaptador do provedor de WhatsApp — WAHA.
//
// É o ÚNICO arquivo que conhece o formato do provedor: o webhook e o
// whatsapp-responder só falam MensagemWhats e enviarTexto.
//
// Sem imports `npm:` de propósito: o vitest importa este arquivo direto.

import type { MensagemWhats } from './mensagem.ts';

export type CredenciaisWaha = {
  baseUrl?: string | null;
  apiKey?: string | null;
  session?: string | null;
};

export type Envio = { ok: boolean; id?: string; erro?: string };

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

const NOME_MAX = 120;

function quandoDe(segundos: unknown): string {
  const s = Number(segundos);
  return Number.isFinite(s) && s > 0 ? new Date(s * 1000).toISOString() : new Date().toISOString();
}

// Webhook "message" do WAHA. Aceita objeto ou lista para o simulador e para
// facilitar testes de lote; o WAHA envia um evento por requisição.
export function mensagensDoWebhook(payload: unknown): MensagemWhats[] {
  const lista = Array.isArray(payload) ? payload : [payload];
  const out: MensagemWhats[] = [];
  for (const bruto of lista) {
    if (!bruto || typeof bruto !== 'object') continue;
    const evento = bruto as Record<string, unknown>;
    if (evento.event !== 'message') continue;
    const p = evento.payload as Record<string, unknown> | undefined;
    if (!p || p.fromMe === true) continue;
    const origem = String(p.from ?? '');
    if (origem.endsWith('@g.us')) continue;
    const texto = String(p.body ?? '').trim();
    const bruta = p.media as Record<string, unknown> | undefined;
    const mediaUrl = String(bruta?.url || '');
    const media =
      p.hasMedia === true && /^https?:\/\//.test(mediaUrl)
        ? {
            nome: String(bruta?.filename || 'arquivo').slice(0, 120),
            tipo: String(bruta?.mimetype || 'application/octet-stream').slice(0, 120),
            url: mediaUrl,
          }
        : null;
    if (!texto && !media) continue;
    const telefone = origem.replace(/\D/g, '');
    if (!telefone) continue;
    const id = String(p.id ?? '').trim();
    if (!id) continue;
    const dados = p._data as Record<string, unknown> | undefined;
    const nome = String(p.notifyName ?? dados?.notifyName ?? '')
      .trim()
      .slice(0, NOME_MAX);
    out.push({
      telefone,
      nome,
      texto,
      id,
      quando: quandoDe(p.timestamp),
      ...(media ? { media } : {}),
    });
  }
  return out;
}

// Envia texto pelo WAHA. Não lança: devolve {ok:false, erro} para a function
// decidir o código HTTP. A chave vai só no cabeçalho e nunca em log ou URL.
export async function enviarTexto(
  telefone: string,
  texto: string,
  cred: CredenciaisWaha,
  fetchFn: FetchFn = fetch
): Promise<Envio> {
  const baseUrl = String(cred.baseUrl || '')
    .trim()
    .replace(/\/+$/, '');
  const apiKey = String(cred.apiKey || '').trim();
  const session = String(cred.session || 'default').trim() || 'default';
  if (!baseUrl || !apiKey) return { ok: false, erro: 'credenciais' };
  let resp: Response;
  try {
    resp = await fetchFn(`${baseUrl}/api/sendText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
      body: JSON.stringify({
        session,
        chatId: `${String(telefone || '').replace(/\D/g, '')}@c.us`,
        text: texto,
      }),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    return { ok: false, erro: 'inalcancavel' };
  }
  if (!resp.ok) return { ok: false, erro: `provedor ${resp.status}` };
  let corpo: Record<string, unknown> = {};
  try {
    corpo = (await resp.json()) || {};
  } catch {
    // 2xx sem JSON ainda é envio aceito; só fica sem id.
  }
  const id = typeof corpo.id === 'string' ? corpo.id.trim() : '';
  return id ? { ok: true, id } : { ok: true };
}

// URL da foto de perfil do contato, ou '' quando não há. Muita gente deixa a
// foto visível só para contatos: a WAHA devolve null nesse caso, e a tela cai
// nas iniciais. A URL vem do CDN do WhatsApp e expira em dias, por isso o
// webhook renova de tempos em tempos em vez de guardar para sempre.
//
// Não lança e só aceita https: a URL vai parar num <img src> de quem atende.
export async function fotoDoContato(
  telefone: string,
  cred: CredenciaisWaha,
  fetchFn: FetchFn = fetch
): Promise<string> {
  const baseUrl = String(cred.baseUrl || '')
    .trim()
    .replace(/\/+$/, '');
  const apiKey = String(cred.apiKey || '').trim();
  const session = String(cred.session || 'default').trim() || 'default';
  const digitos = String(telefone || '').replace(/\D/g, '');
  if (!baseUrl || !apiKey || !digitos) return '';
  const query = new URLSearchParams({ contactId: `${digitos}@c.us`, session });
  try {
    const resp = await fetchFn(`${baseUrl}/api/contacts/profile-picture?${query}`, {
      headers: { 'X-Api-Key': apiKey },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return '';
    const corpo = ((await resp.json()) || {}) as Record<string, unknown>;
    const url = typeof corpo.profilePictureURL === 'string' ? corpo.profilePictureURL.trim() : '';
    return /^https:\/\/[^\s"'<>]+$/.test(url) && url.length <= 1000 ? url : '';
  } catch {
    return '';
  }
}
