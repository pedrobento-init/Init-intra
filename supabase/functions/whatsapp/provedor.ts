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
    // "...@lid" é um identificador interno do WhatsApp, NÃO um telefone: tirar
    // os dígitos dele dava um número que não existe (o envio para
    // "<dígitos>@c.us" falhava com "No LID for user" e o cliente nunca casava).
    const ehLid = origem.endsWith('@lid');
    const telefone = origem.replace(/\D/g, '');
    if (!telefone) continue;
    const id = String(p.id ?? '').trim();
    if (!id) continue;
    const dados = p._data as Record<string, unknown> | undefined;
    const nome = String(p.notifyName ?? dados?.notifyName ?? '')
      .trim()
      .slice(0, NOME_MAX);
    const citacao = citacaoDe(p);
    out.push({
      telefone: ehLid ? '' : telefone,
      ...(ehLid ? { lid: origem } : {}),
      nome,
      texto,
      id,
      quando: quandoDe(p.timestamp),
      ...(media ? { media } : {}),
      ...(citacao ? { citacao } : {}),
    });
  }
  return out;
}

// Mensagem citada. O WAHA novo manda `replyTo: {id, body}`; o engine WEBJS
// antigo só tem `_data.quotedStanzaID` e `_data.quotedMsg.body`.
function citacaoDe(p: Record<string, unknown>): { id: string; texto: string } | null {
  const r = p.replyTo as Record<string, unknown> | undefined;
  const dados = p._data as Record<string, unknown> | undefined;
  const q = dados?.quotedMsg as Record<string, unknown> | undefined;
  const id = String(r?.id ?? dados?.quotedStanzaID ?? '').trim();
  const texto = String(r?.body ?? q?.body ?? '')
    .trim()
    .slice(0, CITACAO_MAX);
  if (!id || id.length > 200) return null;
  return { id, texto };
}

const CITACAO_MAX = 300;

// Recibo (ack) do WAHA: -1 erro, 0 pendente, 1 servidor, 2 entregue, 3 lida,
// 4 ouvida. Só interessa o das mensagens que NÓS mandamos (fromMe).
export type Recibo = { id: string; ack: number };

// Reação: `alvo` é o id da mensagem reagida; emoji '' = a pessoa tirou a
// reação. `deMim` = reação feita pelo próprio número da empresa (pelo celular).
export type Reacao = { alvo: string; emoji: string; deMim: boolean };

// Emoji de reação: curto e sem espaço nem marcação (mesmo CHECK da 086).
export function emojiValido(e: unknown): boolean {
  const s = String(e ?? '');
  return s === '' || ([...s].length <= 8 && s.length <= 16 && !/[\s<>"'a-zA-Z0-9]/.test(s));
}

export function eventosDeStatus(payload: unknown): { recibos: Recibo[]; reacoes: Reacao[] } {
  const lista = Array.isArray(payload) ? payload : [payload];
  const recibos: Recibo[] = [];
  const reacoes: Reacao[] = [];
  for (const bruto of lista) {
    if (!bruto || typeof bruto !== 'object') continue;
    const evento = bruto as Record<string, unknown>;
    const p = evento.payload as Record<string, unknown> | undefined;
    if (!p) continue;
    if (evento.event === 'message.ack') {
      const id = idSerializado(p.id);
      const ack = Number(p.ack);
      if (p.fromMe !== true || !id || !Number.isInteger(ack) || ack < -1 || ack > 4) continue;
      recibos.push({ id, ack });
    } else if (evento.event === 'message.reaction') {
      const r = p.reaction as Record<string, unknown> | undefined;
      const alvo = idSerializado(r?.messageId);
      const emoji = String(r?.text ?? '');
      if (!alvo || !emojiValido(emoji)) continue;
      if (String(p.from ?? '').endsWith('@g.us')) continue;
      reacoes.push({ alvo, emoji, deMim: p.fromMe === true });
    }
  }
  return { recibos, reacoes };
}

// O id da mensagem vem como texto ("true_5511...@c.us_3EB0...") ou, em alguns
// engines, como objeto com `_serialized`.
export function idSerializado(v: unknown): string {
  if (typeof v === 'string') return v.trim().slice(0, 200);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o._serialized === 'string') return o._serialized.trim().slice(0, 200);
    if (typeof o.id === 'string') return o.id.trim().slice(0, 200);
  }
  return '';
}

// Final do id serializado: é como o WAHA às vezes cita a mensagem.
export function idCurto(id: string): string {
  const s = String(id || '');
  const i = s.lastIndexOf('_');
  return i >= 0 ? s.slice(i + 1) : s;
}

function credenciais(cred: CredenciaisWaha) {
  return {
    baseUrl: String(cred.baseUrl || '')
      .trim()
      .replace(/\/+$/, ''),
    apiKey: String(cred.apiKey || '').trim(),
    session: String(cred.session || 'default').trim() || 'default',
  };
}

// Reage (ou tira a reação, com emoji '') a uma mensagem. Não lança.
export async function enviarReacao(
  messageId: string,
  emoji: string,
  cred: CredenciaisWaha,
  fetchFn: FetchFn = fetch
): Promise<Envio> {
  const { baseUrl, apiKey, session } = credenciais(cred);
  if (!baseUrl || !apiKey) return { ok: false, erro: 'credenciais' };
  if (!messageId || !emojiValido(emoji)) return { ok: false, erro: 'invalido' };
  try {
    const resp = await fetchFn(`${baseUrl}/api/reaction`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
      body: JSON.stringify({ session, messageId, reaction: emoji }),
      signal: AbortSignal.timeout(15000),
    });
    return resp.ok ? { ok: true } : { ok: false, erro: `provedor ${resp.status}` };
  } catch {
    return { ok: false, erro: 'inalcancavel' };
  }
}

// Marca a conversa como lida no celular do cliente (✓✓ azul do lado dele).
// Não lança; falha só significa que o cliente não vê o azul.
export async function marcarVisto(
  telefone: string,
  cred: CredenciaisWaha,
  fetchFn: FetchFn = fetch
): Promise<Envio> {
  const { baseUrl, apiKey, session } = credenciais(cred);
  const digitos = String(telefone || '').replace(/\D/g, '');
  if (!baseUrl || !apiKey) return { ok: false, erro: 'credenciais' };
  if (!digitos) return { ok: false, erro: 'invalido' };
  try {
    const resp = await fetchFn(`${baseUrl}/api/sendSeen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
      body: JSON.stringify({ session, chatId: `${digitos}@c.us` }),
      signal: AbortSignal.timeout(10000),
    });
    return resp.ok ? { ok: true } : { ok: false, erro: `provedor ${resp.status}` };
  } catch {
    return { ok: false, erro: 'inalcancavel' };
  }
}

// Envia texto pelo WAHA. Não lança: devolve {ok:false, erro} para a function
// decidir o código HTTP. A chave vai só no cabeçalho e nunca em log ou URL.
export async function enviarTexto(
  telefone: string,
  texto: string,
  cred: CredenciaisWaha,
  fetchFn: FetchFn = fetch,
  opcoes: { replyTo?: string | null } = {}
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
        ...(opcoes.replyTo ? { reply_to: opcoes.replyTo } : {}),
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
  // WEBJS devolve id texto; outros engines, objeto com _serialized ou key.id.
  const id = idSerializado(corpo.id) || idSerializado((corpo.key as unknown) ?? null);
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

// Telefone (só dígitos) de um LID, pela própria WAHA: GET /api/<sessão>/lids/<lid>
// devolve {"lid": "...@lid", "pn": "5511987654321@c.us"}. '' quando a WAHA não
// conhece o número (contato que esconde o telefone) ou está fora do ar.
//
// Não lança. Só aceita pn no formato de telefone (@c.us, 8 a 15 dígitos): o
// valor vira a chave da conversa e o destino das respostas.
export async function telefoneDoLid(
  lid: string,
  cred: CredenciaisWaha,
  fetchFn: FetchFn = fetch
): Promise<string> {
  const baseUrl = String(cred.baseUrl || '')
    .trim()
    .replace(/\/+$/, '');
  const apiKey = String(cred.apiKey || '').trim();
  const session = String(cred.session || 'default').trim() || 'default';
  if (!baseUrl || !apiKey || !/^\d{5,25}@lid$/.test(String(lid || ''))) return '';
  try {
    const resp = await fetchFn(
      `${baseUrl}/api/${encodeURIComponent(session)}/lids/${encodeURIComponent(lid)}`,
      { headers: { 'X-Api-Key': apiKey }, signal: AbortSignal.timeout(8000) }
    );
    if (!resp.ok) return '';
    const corpo = ((await resp.json()) || {}) as Record<string, unknown>;
    const pn = typeof corpo.pn === 'string' ? corpo.pn.trim() : '';
    const achou = /^(\d{8,15})@c\.us$/.exec(pn);
    return achou ? achou[1] : '';
  } catch {
    return '';
  }
}
