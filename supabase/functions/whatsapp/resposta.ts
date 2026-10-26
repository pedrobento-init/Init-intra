// supabase/functions/whatsapp/resposta.ts
// Partes puras do caminho de VOLTA: achar o telefone da conversa, decidir se a
// janela de 24 h da Meta ainda está aberta e montar o corpo do envio.
//
// Vive separado do index.ts pelo mesmo motivo do mensagem.ts: o vitest não roda
// Deno nem resolve `npm:`, então o que dá para travar com teste é o que não
// depende do runtime. E aqui mora justamente a regra que erra calado — a
// janela: errar para o lado "aberta" faz a Meta recusar o envio; errar para
// "fechada" esconde do técnico um caminho que estava disponível.

/**
 * Horas que a Meta dá para responder em texto livre, contadas da ÚLTIMA
 * mensagem do cliente. Fora dela só sai template aprovado — que é outro
 * caminho inteiro (aprovação na Meta, variáveis, idioma), fora deste teste.
 */
export const JANELA_HORAS = 24;

/** Teto do texto. A Meta corta em 4096 caracteres o corpo de uma mensagem. */
export const TEXTO_MAX = 4096;

/** Prefixo que a triagem grava em `email_thread_id` para marcar o canal. */
const PREFIXO = "whatsapp:";

/**
 * Telefone da conversa (só dígitos, com país), ou "" se o chamado não nasceu
 * no WhatsApp.
 *
 * É daqui que o destinatário sai — nunca do que o app mandou. Mesmo desenho da
 * pendencia-responder: o app manda `pendencia_id`, e para quem vai é decisão do
 * servidor, lida com a chave de serviço. Sem isso, quem tivesse a chave pública
 * mandaria WhatsApp em nome da Init para qualquer número.
 */
export function telefoneDaConversa(threadId: unknown): string {
  const t = String(threadId ?? "").trim();
  if (!t.startsWith(PREFIXO)) return "";
  const d = t.slice(PREFIXO.length).replace(/\D/g, "");
  // 12 dígitos = 55 + DDD + 8; 13 = com o nono dígito. Menos que isso não é
  // telefone com país, e mandar para um número truncado é mandar para outra
  // pessoa — melhor recusar.
  return d.length >= 12 && d.length <= 15 ? d : "";
}

/** Nota que é fala de quem PEDIU (chegou pelo canal), não nossa nem interna. */
function ehDoSolicitante(n: unknown): boolean {
  const nota = (n ?? {}) as Record<string, unknown>;
  return String(nota.visibility ?? "") === "solicitante";
}

/**
 * Quando o cliente falou por último nesta conversa, em ISO.
 *
 * `criadoEm` entra porque a PRIMEIRA mensagem não virou nota: ela virou o
 * próprio chamado (assunto + descrição). Um chamado recém-aberto tem
 * `notes: []`, e olhar só as notas diria "nunca falou" — a janela sairia
 * fechada justamente no momento em que ela está mais aberta.
 */
export function ultimaFalaDoSolicitante(notes: unknown, criadoEm: unknown): string {
  let maior = Date.parse(String(criadoEm ?? "")) || 0;
  const lista = Array.isArray(notes) ? notes : [];
  for (const n of lista) {
    if (!ehDoSolicitante(n)) continue;
    const t = Date.parse(String((n as Record<string, unknown>).createdAt ?? "")) || 0;
    if (t > maior) maior = t;
  }
  return maior ? new Date(maior).toISOString() : "";
}

export type Janela = {
  aberta: boolean;
  /** ISO da última fala do cliente, ou "" quando não há data alguma. */
  ultima: string;
  /** Minutos que faltam para fechar. 0 quando já fechou. */
  restamMin: number;
};

/**
 * Estado da janela de 24 h.
 *
 * Sem data nenhuma a janela sai FECHADA, de propósito: data faltando é chamado
 * velho ou registro estranho, e nos dois casos tentar mandar ganha uma recusa
 * da Meta que o técnico não entende. Fechada, ele lê "a janela fechou" e sabe
 * o que fazer.
 */
export function janelaDaConversa(
  notes: unknown,
  criadoEm: unknown,
  agora: Date = new Date(),
): Janela {
  const ultima = ultimaFalaDoSolicitante(notes, criadoEm);
  if (!ultima) return { aberta: false, ultima: "", restamMin: 0 };
  const fim = Date.parse(ultima) + JANELA_HORAS * 3600_000;
  const falta = fim - agora.getTime();
  return {
    aberta: falta > 0,
    ultima,
    restamMin: falta > 0 ? Math.floor(falta / 60_000) : 0,
  };
}

/** Texto do técnico pronto para enviar, ou "" se não há o que mandar. */
export function textoDaResposta(bruto: unknown): string {
  return String(bruto ?? "").trim().slice(0, TEXTO_MAX);
}

/** Corpo do POST da Graph API para uma mensagem de texto. */
export function corpoGraph(waId: string, texto: string) {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: waId,
    type: "text",
    // Sem preview: a Meta buscaria o link do nosso lado e um link interno
    // viraria um card com dados do cliente na conversa.
    text: { preview_url: false, body: texto },
  };
}

/**
 * Telefone como gente lê: +55 (11) 99999-0000. Só para mostrar na tela e nos
 * avisos — o envio usa os dígitos crus.
 */
export function telefoneLegivel(waId: string): string {
  const d = String(waId || "").replace(/\D/g, "");
  if (!d.startsWith("55") || d.length < 12) return d ? "+" + d : "";
  const ddd = d.slice(2, 4);
  const num = d.slice(4);
  const corte = num.length > 8 ? 5 : 4;
  return `+55 (${ddd}) ${num.slice(0, corte)}-${num.slice(corte)}`;
}

/**
 * O `wamid` da mensagem que saiu, de dentro da resposta da Graph API, ou "".
 * Serve de recibo no log: sem ele não há como diferenciar "a Meta aceitou" de
 * "a Meta respondeu 200 com um corpo que não reconhecemos".
 */
export function idDoEnvio(resposta: unknown): string {
  const r = (resposta ?? {}) as Record<string, unknown>;
  const msgs = Array.isArray(r.messages) ? r.messages as Record<string, unknown>[] : [];
  return String(msgs[0]?.id ?? "").trim();
}

/**
 * Erro da Graph API em uma linha legível. A Meta devolve
 * `{ error: { message, code, error_subcode, error_data: { details } } }`, e
 * `details` é onde mora o motivo de verdade ("Message failed to send because
 * more than 24 hours have passed...").
 */
export function erroDoGraph(resposta: unknown, status: number): string {
  const r = (resposta ?? {}) as Record<string, unknown>;
  const e = (r.error ?? {}) as Record<string, unknown>;
  const dados = (e.error_data ?? {}) as Record<string, unknown>;
  const detalhe = String(dados.details ?? "").trim();
  const msg = String(e.message ?? "").trim();
  const texto = detalhe || msg;
  return texto ? texto.slice(0, 300) : `A Meta recusou o envio (HTTP ${status}).`;
}
