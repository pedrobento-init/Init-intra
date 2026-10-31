// Regras do canal WhatsApp que não dependem do provedor nem do Deno.
//
// Vive separado do index.ts pelo mesmo motivo do robo/campo.ts: o vitest não
// roda Deno nem resolve os imports `npm:`, então o que dá para testar é o que
// não depende do runtime. E é aqui que mora a lógica que erra calado.
//
// Também não sabe nada da Z-API: o formato do provedor fica em provedor.ts, e
// o resto do sistema só enxerga MensagemWhats. Trocar de provedor (Evolution,
// Meta Cloud) é reescrever provedor.ts, não este arquivo.

import {
  type Cliente,
  type EmailBackup,
  type Triagem,
  corpoLimpo,
  primeiraRespostaDue,
  triagemDaIa,
} from "../robo/campo.ts";

// O que o canal precisa de uma mensagem recebida, já sem o formato do provedor.
// telefone: só dígitos, com país (ex.: 5511987654321). quando: ISO.
export type MensagemWhats = {
  telefone: string;
  nome: string;
  texto: string;
  id: string;
  quando: string;
};

// Teto do texto que sai para o WhatsApp. O limite do protocolo é maior, mas
// ninguém lê resposta desse tamanho no celular: passou disso, é colagem errada.
export const TEXTO_MAX = 20000;

// Status em que o chamado não recebe mais a conversa: o webhook abre outro, e
// o responder recusa enviar.
export const PEN_FECHADOS = ["concluido", "resolvido", "cancelado", "fechado"];

const PREFIXO = "whatsapp:";

// Comparação de segredo sem curto-circuito: o tempo não diz quantos caracteres
// do começo bateram. O tamanho vaza, mas o token tem tamanho fixo e não é dele
// que vem a segurança.
export function tempoConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

// Chave para casar o telefone do WhatsApp com o cadastrado no cliente: DDD + 8
// últimos dígitos. O cadastro vem de todo jeito ("(11) 98765-4321", "11
// 8765-4321", com ou sem 55), e o WhatsApp manda com país e, em alguns números
// antigos, SEM o nono dígito. Comparar o número inteiro deixaria de casar
// justamente esses. Os 8 últimos mais o DDD bastam para não confundir dois
// clientes na prática; o risco que sobra (casar com o cliente errado) é pior do
// que não casar, por isso número curto demais não vira chave — a mensagem cai
// na caixa como sem_cliente e alguém escolhe à mão.
export function chaveTelefone(bruto: unknown): string {
  let d = String(bruto ?? "").replace(/\D/g, "");
  if (!d) return "";
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  if (d.length < 10) return "";
  return d.slice(0, 2) + d.slice(-8);
}

type ClienteComFone = Cliente & {
  owner_phone?: string | null;
  responsible_phone?: string | null;
};

// Dois clientes com o mesmo número (sócio de duas empresas, telefone de
// contador) não decidem sozinhos: a mensagem vai sem cliente para alguém
// escolher, em vez de cair na equipe do primeiro que aparecer.
export function clienteDoTelefone<C extends ClienteComFone>(clientes: C[], telefone: string): C | null {
  const chave = chaveTelefone(telefone);
  if (!chave) return null;
  let achado: C | null = null;
  for (const c of clientes || []) {
    if (chaveTelefone(c.owner_phone) !== chave && chaveTelefone(c.responsible_phone) !== chave) continue;
    if (achado && achado.id !== c.id) return null;
    achado = c;
  }
  return achado;
}

// Mensagem de WhatsApp não tem assunto; a primeira linha é o mais perto disso
// que o cliente escreveu, e é o que aparece na lista da caixa.
export function assuntoDaMensagem(texto: string): string {
  const linha = String(texto || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l) || "";
  if (!linha) return "Pedido por WhatsApp";
  return linha.length > 120 ? linha.slice(0, 117).trimEnd() + "…" : linha;
}

// A mensagem no formato que a triagem por IA do robô já entende, para reusar
// o mesmo prompt em vez de manter um segundo.
export function entradaDaMensagem(m: MensagemWhats): EmailBackup {
  return {
    id: m.id,
    de: m.nome || m.telefone,
    assunto: assuntoDaMensagem(m.texto),
    data: m.quando,
    trecho: corpoLimpo(m.texto),
  };
}

export function triagemDaMensagem(resp: string, m: MensagemWhats): Triagem {
  const t = triagemDaIa(resp, entradaDaMensagem(m));
  // A IA às vezes devolve o próprio número como solicitante; o nome do perfil
  // é melhor, e na falta dele um rótulo honesto é melhor que um telefone cru.
  const solicitante = m.nome || (t.solicitante === m.telefone ? "" : t.solicitante);
  return { ...t, solicitante: solicitante || "Contato de WhatsApp" };
}

export function pendenciaDoWhatsapp(
  t: Triagem,
  m: MensagemWhats,
  c: Cliente,
  id: string,
  agora = new Date(),
): Record<string, unknown> {
  const tel = String(m.telefone || "").replace(/\D/g, "");
  const tags = ["triagem-automatica", "whatsapp"];
  if (t.semIa) tags.push("sem-classificacao-ia");
  const origem = "\n\n— Aberta pela triagem de WhatsApp do Init Intra." +
    `\nDe: ${m.nome || "(perfil sem nome)"} · +${tel}` +
    `\nRecebido em: ${m.quando}`;
  const iso = agora.toISOString();
  return {
    id,
    client_id: c.id,
    client_name: c.name,
    team: c.team || "init",
    tipo: t.tipo,
    assunto: t.assunto,
    descricao: t.descricao + origem,
    responsible: c.technician || "",
    solicitante: t.solicitante,
    // Sem e-mail: a resposta não pode cair no pendencia-responder, que manda
    // para solicitante_email. Nulo aqui é o que faz o app oferecer o WhatsApp.
    solicitante_email: null,
    email_message_id: null,
    // A coluna da 065 nasceu para a thread do Gmail, mas na prática é o
    // conversa_id do chamado: é por ela que a próxima mensagem do mesmo número
    // vira nota, e é dela que o whatsapp-responder tira o destino.
    email_thread_id: PREFIXO + tel,
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

// A chave de conversa que o webhook procura e que a pendência guarda. Uma
// função só para os dois lados: se um normalizasse diferente do outro, a
// mensagem nova nunca acharia o chamado aberto e abriria outra entrada.
export function conversaDoTelefone(telefone: unknown): string {
  const d = String(telefone ?? "").replace(/\D/g, "");
  return d ? PREFIXO + d : "";
}

// O destino da resposta sai do registro no servidor, nunca do app: quem
// pudesse mandar o número no body poderia usar o número da empresa para
// escrever para qualquer um.
export function telefoneDaConversa(threadId: unknown): string {
  const t = String(threadId ?? "").trim();
  if (!t.startsWith(PREFIXO)) return "";
  const d = t.slice(PREFIXO.length).replace(/\D/g, "");
  // 12 dígitos = 55 + DDD + 8; 13 = com o nono dígito. Até 15 cobre número de
  // fora (E.164). Menos que isso não é um telefone que dê para responder, e
  // mandar para um número truncado é pior que não mandar: melhor recusar.
  return d.length >= 12 && d.length <= 15 ? d : "";
}

export function textoDaResposta(bruto: unknown): string {
  return String(bruto ?? "").trim().slice(0, TEXTO_MAX);
}

// Só para mostrar (log, nota): o que vai para o provedor e para o app são os
// dígitos crus.
export function telefoneLegivel(telefone: string): string {
  const d = String(telefone || "").replace(/\D/g, "");
  if (!d.startsWith("55") || d.length < 12) return d ? "+" + d : "";
  const ddd = d.slice(2, 4);
  const num = d.slice(4);
  const corte = num.length > 8 ? 5 : 4;
  return `+55 (${ddd}) ${num.slice(0, corte)}-${num.slice(corte)}`;
}
