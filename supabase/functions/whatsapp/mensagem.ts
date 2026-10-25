// supabase/functions/whatsapp/mensagem.ts
// Partes puras da entrada por WhatsApp: ler o webhook da Meta, conferir a
// assinatura, achar o cliente pelo telefone e montar o chamado.
//
// Vive separado do index.ts pelo mesmo motivo do robo/campo.ts: o vitest não
// roda Deno nem resolve os imports `npm:`, então o que dá para testar é o que
// não depende do runtime. E é aqui que mora a lógica que erra calado.

import {
  type Cliente,
  corpoLimpo,
  primeiraRespostaDue,
  type Triagem,
  triagemDaIa,
} from "../robo/campo.ts";

/** Mensagem de texto já desembrulhada do webhook. */
export type MensagemWhats = {
  id: string; // id da mensagem na Meta (serve de chave de dedupe)
  waId: string; // telefone de quem escreveu, só dígitos, com país
  nome: string; // nome do perfil — texto escrito por quem manda, trate como tal
  texto: string;
  data: string; // ISO
};

/**
 * Mensagens de TEXTO do payload da Meta.
 *
 * O webhook entrega muita coisa que não é mensagem: recibo de entrega, de
 * leitura, mudança de número. Tudo chega no mesmo envelope e abriria chamado
 * fantasma — por isso só `messages[]` com `type: "text"` passa. Áudio, imagem
 * e documento ficam fora deste primeiro teste: virariam chamado sem texto
 * nenhum, que é pior do que não virar.
 */
export function mensagensDoWebhook(payload: unknown): MensagemWhats[] {
  const out: MensagemWhats[] = [];
  const p = (payload ?? {}) as Record<string, unknown>;
  const entries = Array.isArray(p.entry) ? p.entry as Record<string, unknown>[] : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes as Record<string, unknown>[] : [];
    for (const change of changes) {
      const value = (change?.value ?? {}) as Record<string, unknown>;
      const msgs = Array.isArray(value.messages) ? value.messages as Record<string, unknown>[] : [];
      const contatos = Array.isArray(value.contacts) ? value.contacts as Record<string, unknown>[] : [];
      // O nome vem em contacts[], paralelo a messages[], casado pelo wa_id.
      const nomePorWaId = new Map<string, string>();
      for (const c of contatos) {
        const wa = String(c?.wa_id ?? "").replace(/\D/g, "");
        const perfil = (c?.profile ?? {}) as Record<string, unknown>;
        const nome = String(perfil.name ?? "").trim().slice(0, 120);
        if (wa && nome) nomePorWaId.set(wa, nome);
      }
      for (const m of msgs) {
        if (String(m?.type ?? "") !== "text") continue;
        const id = String(m?.id ?? "").trim();
        const waId = String(m?.from ?? "").replace(/\D/g, "");
        const corpo = (m?.text ?? {}) as Record<string, unknown>;
        const texto = String(corpo.body ?? "").trim();
        if (!id || !waId || !texto) continue;
        // `timestamp` é epoch em SEGUNDOS, como string. Tratar como
        // milissegundos jogaria a data para o ano 56000 e o SLA junto.
        const seg = Number(m?.timestamp);
        const data = Number.isFinite(seg) && seg > 0
          ? new Date(seg * 1000).toISOString()
          : new Date().toISOString();
        out.push({ id, waId, nome: nomePorWaId.get(waId) || "", texto, data });
      }
    }
  }
  return out;
}

/** Compara sem revelar, pelo tempo, até onde as duas strings batem. */
export function tempoConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

/**
 * Confere o X-Hub-Signature-256 da Meta sobre o corpo CRU.
 *
 * Tem de ser o corpo cru, byte a byte: `JSON.parse` seguido de `stringify`
 * muda espaçamento e ordem de chave, e a assinatura deixa de fechar.
 *
 * A comparação é em tempo constante. Com `===`, o tempo de resposta revela
 * quantos bytes do começo batem, e isso basta para montar a assinatura byte a
 * byte — é a diferença entre uma porta trancada e uma porta com a chave
 * pendurada do lado de fora.
 */
export async function assinaturaValida(
  corpoCru: string,
  header: string | null,
  appSecret: string,
): Promise<boolean> {
  const esperado = String(header || "").trim();
  if (!appSecret || !esperado.startsWith("sha256=")) return false;
  const chave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(corpoCru));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return tempoConstante("sha256=" + hex, esperado);
}

/**
 * Chave de comparação de telefone: DDD + os 8 últimos dígitos.
 *
 * O wa_id vem como 5511999990000 (país+DDD+número) e a ficha do cliente tem
 * texto livre: "(11) 99999-0000", "11 4478-6171", "+55 11 ...". Os 8 últimos
 * dígitos ignoram o nono dígito que os celulares ganharam, que é justamente o
 * que faz cadastro antigo não casar com número atual.
 *
 * O preço: dois números do mesmo DDD que só diferem no nono dígito viram a
 * mesma chave. É raro, e o estrago seria abrir o chamado no cliente errado —
 * por isso nada é inventado quando não casa: vira `sem_cliente` e alguém olha.
 */
export function chaveTelefone(bruto: string): string {
  let d = String(bruto || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2); // tira o código do país
  if (d.length < 10) return ""; // sem DDD não dá para casar
  return d.slice(0, 2) + d.slice(-8);
}

/** Cliente dono daquele telefone, ou null. Olha os dois telefones da ficha. */
export function clienteDoTelefone(clientes: Cliente[], waId: string): Cliente | null {
  const alvo = chaveTelefone(waId);
  if (!alvo) return null;
  for (const c of clientes || []) {
    const ficha = c as unknown as Record<string, unknown>;
    for (const f of [ficha.owner_phone, ficha.responsible_phone]) {
      if (f && chaveTelefone(String(f)) === alvo) return c;
    }
  }
  return null;
}

/** Primeira linha da mensagem vira assunto; a mensagem inteira é a descrição. */
export function assuntoDaMensagem(texto: string): string {
  const linha = String(texto || "").split("\n").map((s) => s.trim()).find(Boolean) || "";
  if (!linha) return "Pedido por WhatsApp";
  return linha.length <= 120 ? linha : linha.slice(0, 117).trimEnd() + "…";
}

/**
 * A mensagem no formato que a triagem do e-mail já sabe validar, para a
 * resposta da IA e as listas fechadas terem UMA implementação só.
 */
export function entradaDaMensagem(m: MensagemWhats) {
  return {
    id: m.id,
    de: m.nome || m.waId,
    assunto: assuntoDaMensagem(m.texto),
    data: m.data,
    trecho: corpoLimpo(m.texto),
  };
}

/** Triagem da mensagem: a mesma validação de listas fechadas do e-mail. */
export function triagemDaMensagem(respostaIa: string, m: MensagemWhats): Triagem {
  const t = triagemDaIa(respostaIa, entradaDaMensagem(m));
  // Sem nome no perfil, nomeDoRemetente devolveria o próprio telefone como
  // solicitante — número não é nome de gente.
  const solicitante = m.nome || (t.solicitante === m.waId ? "" : t.solicitante);
  return { ...t, solicitante: solicitante || "Contato de WhatsApp" };
}

/** Chamado nascido de uma mensagem de WhatsApp. Par do pendenciaDaTriagem. */
export function pendenciaDoWhatsapp(
  t: Triagem,
  m: MensagemWhats,
  c: Cliente,
  id: string,
  agora: Date = new Date(),
) {
  const iso = agora.toISOString();
  const tags = ["triagem-automatica", "whatsapp"];
  if (t.semIa) tags.push("sem-classificacao-ia");
  const origem = "\n\n— Aberta pela triagem de WhatsApp do Init Intra."
    + `\nDe: ${m.nome || "(perfil sem nome)"} · +${m.waId}`
    + `\nRecebido em: ${m.data}`;
  return {
    id,
    client_id: c.id,
    client_name: c.name || "",
    team: c.team || "init",
    tipo: t.tipo,
    assunto: t.assunto,
    descricao: t.descricao + origem,
    responsible: c.technician || "",
    solicitante: t.solicitante,
    // Sem e-mail: responder por WhatsApp é outro caminho, fora deste teste.
    // Deixar vazio é o que faz a caixa "Enviar por e-mail" não aparecer — e é
    // o certo, porque o e-mail nunca chegaria a quem escreveu pelo WhatsApp.
    solicitante_email: null,
    email_message_id: null,
    // Mesma coluna da 065, com prefixo de canal: ela guarda "a conversa que
    // abriu este chamado". O nome diz e-mail porque e-mail era o único canal;
    // se o WhatsApp sair do teste, vale renomear para `conversa_id`.
    email_thread_id: "whatsapp:" + m.waId,
    status: "aberto",
    priority: t.prioridade,
    canal: "whatsapp",
    categoria: t.categoria,
    first_response_due: primeiraRespostaDue(t.prioridade, agora),
    attachments: [],
    checklist: [],
    tags,
    created_at: iso,
    updated_at: iso,
  };
}
