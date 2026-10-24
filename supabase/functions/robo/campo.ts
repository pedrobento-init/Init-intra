// supabase/functions/robo/campo.ts
// Regras puras (sem rede, sem banco) do briefing antes da visita e do
// monitoramento de backup por e-mail. Testado em tests/robo-campo.test.js.

import { daysBetween, escapeHtml, PEN_CLOSED_STATUSES, VENC_TIPOS } from "../avisos-prazo/avisos.ts";
import type { Pend, Venc, Visita } from "./relatorios.ts";

const norm = (s: unknown) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const dateBR = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export type Device = {
  hostname?: string | null; apelido?: string | null; is_ativo?: boolean | null;
  data_ultima_atualizacao?: string | null; updated_at?: string | null;
};
export type Monitor = {
  id: string; client_id: string; client_name?: string | null; team?: string | null; nome: string;
  identificador: string; max_horas: number; responsavel?: string | null; ativo?: boolean | null;
  ultimo_status?: string | null; ultimo_em?: string | null; ultimo_assunto?: string | null;
  historico?: { em: string; status: string; assunto: string }[] | null; pendencia_id?: string | null;
  created_at?: string | null;
};
export type EmailBackup = { id: string; de: string; assunto: string; data: string; trecho?: string };

export const DISPOSITIVO_SEM_COMUNICAR_DIAS = 7;

/** Dias sem o agente falar com o Milvus, medido na última sincronização (null = em dia/sem dado). */
export function diasSemComunicar(d: Device): number | null {
  if (!d || d.is_ativo === false || !d.data_ultima_atualizacao) return null;
  const visto = Date.parse(d.data_ultima_atualizacao);
  const sync = Date.parse(d.updated_at || "") || Date.now();
  if (isNaN(visto)) return null;
  const dias = Math.floor((sync - visto) / 86400000);
  return dias > DISPOSITIVO_SEM_COMUNICAR_DIAS ? dias : null;
}

// ── Briefing ────────────────────────────────────────────────────────────────

export type Briefing = {
  cliente: string; data: string; hora: string; motivo: string; observacoes: string;
  levar: string[];
  ultimas_visitas: { data: string; motivo: string; relatorio: string }[];
  pendencias_abertas: { assunto: string; status: string; prioridade: string; prazo: string; atrasada: boolean }[];
  vencimentos_proximos: { tipo: string; descricao: string; data: string; dias: number }[];
  dispositivos_sem_comunicar: { nome: string; dias: number }[];
  backups: { nome: string; status: string; ultimo: string }[];
};

/** Fatos do cliente para a visita (o mesmo pacote vai para a IA no Make). */
export function briefingDados(v: Visita & { observacoes?: string | null; client_id?: string | null }, ctx: {
  today: string; visitas: (Visita & { relatorio?: string | null })[]; pendencias: Pend[]; vencimentos: Venc[];
  devices: Device[]; monitores: Monitor[];
}): Briefing {
  const { today } = ctx;
  const ultimas = ctx.visitas
    .filter((x) => x.id !== v.id && x.status === "concluida" && String(x.date || "") < String(v.date || today))
    .sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 3)
    .map((x) => ({ data: String(x.date), motivo: x.motivo || "", relatorio: String(x.relatorio || "").trim().slice(0, 400) }));
  const pend = ctx.pendencias.filter((p) => !PEN_CLOSED_STATUSES.includes(String(p.status ?? "")))
    .sort((a, b) => String(a.deadline || "9999").localeCompare(String(b.deadline || "9999"))).slice(0, 8)
    .map((p) => ({
      assunto: String(p.assunto || p.descricao || "Sem descrição").slice(0, 140), status: p.status || "",
      prioridade: p.priority || "", prazo: p.deadline ? String(p.deadline).slice(0, 10) : "",
      atrasada: !!p.deadline && String(p.deadline).slice(0, 10) < today,
    }));
  const venc = ctx.vencimentos.filter((x) => x.status !== "encerrado" && x.data_vencimento)
    .map((x) => ({ x, dias: daysBetween(today, String(x.data_vencimento).slice(0, 10)) }))
    .filter(({ dias }) => dias <= 45).sort((a, b) => a.dias - b.dias).slice(0, 5)
    .map(({ x, dias }) => ({ tipo: VENC_TIPOS[String(x.tipo)] || "Vencimento", descricao: x.descricao || "", data: String(x.data_vencimento).slice(0, 10), dias }));
  const devs = ctx.devices.map((d) => ({ nome: d.apelido || d.hostname || "Dispositivo", dias: diasSemComunicar(d) }))
    .filter((d): d is { nome: string; dias: number } => d.dias !== null).sort((a, b) => b.dias - a.dias).slice(0, 8);
  const backups = ctx.monitores.filter((m) => m.ativo !== false)
    .map((m) => ({ nome: m.nome, status: m.ultimo_status || "sem notícia", ultimo: m.ultimo_em ? String(m.ultimo_em) : "" }));
  return {
    cliente: v.client_name || "", data: String(v.date || ""), hora: v.all_day ? "dia inteiro" : String(v.time || "").slice(0, 5),
    motivo: v.motivo || "", observacoes: String(v.observacoes || "").slice(0, 600),
    levar: (Array.isArray(v.levar) ? v.levar : []).map((i) => String(i?.t || "")).filter(Boolean),
    ultimas_visitas: ultimas, pendencias_abertas: pend, vencimentos_proximos: venc, dispositivos_sem_comunicar: devs, backups,
  };
}

/** O briefing tem algo além do básico da visita? (sem nada, não vale e-mail nem IA). */
export function briefingTemConteudo(b: Briefing): boolean {
  return !!(b.ultimas_visitas.length || b.pendencias_abertas.length || b.vencimentos_proximos.length
    || b.dispositivos_sem_comunicar.length || b.backups.some((x) => x.status !== "ok"));
}

/** Bloco HTML do briefing no e-mail "Seu dia". */
export function briefingHtml(b: Briefing, ia?: string | null): string {
  const li = (s: string) => `<li style="margin-bottom:3px">${s}</li>`;
  const bloco = (t: string, itens: string[]) => itens.length
    ? `<div style="margin-top:6px"><b style="font-size:12px;color:#334155">${t}</b><ul style="margin:2px 0 0;padding-left:18px">${itens.join("")}</ul></div>` : "";
  const partes = [
    ia ? `<div style="margin-top:6px;padding:8px 10px;background:#eff6ff;border-radius:6px;font-size:13px">💡 ${escapeHtml(ia).replace(/\n/g, "<br>")}</div>` : "",
    bloco("Últimas visitas", b.ultimas_visitas.map((x) => li(`${dateBR(x.data)} — ${escapeHtml(x.motivo)}${x.relatorio ? `: <span style="color:#64748b">${escapeHtml(x.relatorio.slice(0, 160))}${x.relatorio.length > 160 ? "…" : ""}</span>` : ""}`))),
    bloco("Pendências abertas", b.pendencias_abertas.map((p) => li(`${escapeHtml(p.assunto)}${p.atrasada ? ' <span style="color:#dc2626">(atrasada)</span>' : p.prazo ? ` (prazo ${dateBR(p.prazo)})` : ""}`))),
    bloco("Vencimentos próximos", b.vencimentos_proximos.map((x) => li(`${escapeHtml(x.tipo)}: ${escapeHtml(x.descricao)} — ${x.dias < 0 ? `<span style="color:#dc2626">venceu há ${-x.dias} dias</span>` : `em ${x.dias} dias`}`))),
    bloco("Sem comunicar com o Milvus", b.dispositivos_sem_comunicar.map((d) => li(`${escapeHtml(d.nome)} — ${d.dias} dias`))),
    bloco("Backups", b.backups.filter((x) => x.status !== "ok").map((x) => li(`${escapeHtml(x.nome)}: <span style="color:#dc2626">${escapeHtml(x.status)}</span>`))),
  ].join("");
  return partes ? `<div style="margin:4px 0 4px 4px;padding-left:10px;border-left:3px solid #cbd5e1;font-size:12.5px;color:#1e293b">${partes}</div>` : "";
}

/** Os mesmos fatos em texto corrido — é o que o cenário do Make põe no prompt da IA. */
export function briefingTexto(b: Briefing): string {
  const l: string[] = [`Cliente: ${b.cliente}`, `Visita: ${dateBR(b.data)} ${b.hora} — motivo: ${b.motivo}`];
  if (b.observacoes) l.push(`Observações da visita: ${b.observacoes}`);
  if (b.levar.length) l.push(`O técnico vai levar: ${b.levar.join(", ")}`);
  if (b.ultimas_visitas.length) l.push("Últimas visitas:", ...b.ultimas_visitas.map((x) => `- ${dateBR(x.data)}: ${x.motivo}${x.relatorio ? ` — relatório: ${x.relatorio}` : ""}`));
  if (b.pendencias_abertas.length) l.push("Pendências abertas:", ...b.pendencias_abertas.map((p) => `- ${p.assunto} (${p.status}${p.prioridade ? ", prioridade " + p.prioridade : ""}${p.atrasada ? ", ATRASADA" : p.prazo ? ", prazo " + dateBR(p.prazo) : ""})`));
  if (b.vencimentos_proximos.length) l.push("Vencimentos próximos:", ...b.vencimentos_proximos.map((x) => `- ${x.tipo}: ${x.descricao} — ${x.dias < 0 ? `venceu há ${-x.dias} dias` : `em ${x.dias} dias`}`));
  if (b.dispositivos_sem_comunicar.length) l.push("Dispositivos sem comunicar com o Milvus:", ...b.dispositivos_sem_comunicar.map((d) => `- ${d.nome}: ${d.dias} dias`));
  const bk = b.backups.filter((x) => x.status !== "ok");
  if (bk.length) l.push("Backups com problema:", ...bk.map((x) => `- ${x.nome}: ${x.status}`));
  return l.join("\n").slice(0, 4000);
}

/** Resposta do Make: { texto } em JSON ou texto puro. max 1.200 serve ao briefing; o relatório da visita pede mais. */
export function textoDaIa(body: string, max = 1200): string | null {
  let t = body;
  try { const j = JSON.parse(body); t = typeof j === "string" ? j : (j?.texto ?? j?.text ?? j?.result ?? ""); } catch { /* texto puro */ }
  t = String(t || "").trim();
  if (!t || /^accepted$/i.test(t)) return null;  // webhook sem "Webhook response" devolve "Accepted"
  return t.slice(0, max);
}

// ── Backup por e-mail ───────────────────────────────────────────────────────

const FALHA = /\b(falha|falhou|failed|failure|erro|error|unsuccessful|nao concluido|not completed|aborted|abortado)\b/;
const AVISO = /\b(warning|aviso|alerta|partial|parcial|concluido com avisos|completed with warnings)\b/;
const OK = /\b(success|successful|successfully|sucesso|concluido|completed|ok|bem-sucedido|bem sucedido)\b/;

/** Status pelo assunto (e começo do corpo): falha > aviso > ok; null = não deu para saber. */
export function classificarBackup(assunto: string, trecho = ""): "falha" | "aviso" | "ok" | null {
  const a = norm(assunto);
  const t = norm(trecho).slice(0, 600);
  for (const txt of [a, t]) {
    if (FALHA.test(txt)) return "falha";
    if (AVISO.test(txt)) return "aviso";
    if (OK.test(txt)) return "ok";
  }
  return null;
}

/** Monitor do e-mail: identificador no remetente ou assunto; o mais específico (longo) vence. */
export function monitorDoEmail(monitores: Monitor[], e: EmailBackup): Monitor | null {
  const alvo = norm(e.de + " " + e.assunto);
  let melhor: Monitor | null = null;
  for (const m of monitores) {
    const id = norm(m.identificador).trim();
    if (m.ativo === false || id.length < 3 || !alvo.includes(id)) continue;
    if (!melhor || id.length > norm(melhor.identificador).trim().length) melhor = m;
  }
  return melhor;
}

/** Aplica o e-mail ao monitor (só se for mais novo que o último). */
export function aplicarEmail(m: Monitor, e: EmailBackup, status: "falha" | "aviso" | "ok"): Monitor {
  const hist = [{ em: e.data, status, assunto: e.assunto.slice(0, 200) }, ...(m.historico || [])]
    .sort((a, b) => String(b.em).localeCompare(String(a.em))).slice(0, 20);
  const novo = !m.ultimo_em || Date.parse(e.data) >= Date.parse(m.ultimo_em);
  return novo
    ? { ...m, ultimo_status: status, ultimo_em: e.data, ultimo_assunto: e.assunto.slice(0, 300), historico: hist }
    : { ...m, historico: hist };
}

/** Precisa de atenção? Falha no último e-mail, ou silêncio além de max_horas. */
export function backupAlerta(m: Monitor, agora: Date = new Date()): { tipo: "falha" | "silencio"; horas?: number } | null {
  if (m.ativo === false) return null;
  if (m.ultimo_status === "falha") return { tipo: "falha" };
  const desde = Date.parse(m.ultimo_em || m.created_at || "");
  if (isNaN(desde)) return null;
  const horas = Math.floor((agora.getTime() - desde) / 3600000);
  return horas > m.max_horas ? { tipo: "silencio", horas } : null;
}

/** Pendência automática do alerta. */
export function pendenciaDoAlerta(m: Monitor, a: { tipo: "falha" | "silencio"; horas?: number }, id: string, agora: Date = new Date()) {
  const iso = agora.toISOString();
  const assunto = a.tipo === "falha"
    ? `Backup com falha: ${m.nome}`
    : `Backup sem notícia há ${a.horas} h: ${m.nome}`;
  const descricao = a.tipo === "falha"
    ? `O último e-mail do backup "${m.nome}" indicou falha.\nAssunto: ${m.ultimo_assunto || "—"}\nRecebido em: ${m.ultimo_em || "—"}`
    : `Nenhum e-mail do backup "${m.nome}" chegou nas últimas ${a.horas} horas (limite: ${m.max_horas} h).\nÚltimo recebido: ${m.ultimo_em || "nunca"}`;
  return {
    id, client_id: m.client_id, client_name: m.client_name || "", team: m.team || "init",
    tipo: "Manutenção", assunto, descricao: descricao + "\n\nAberta automaticamente pelo monitor de backup do Init Intra.",
    responsible: m.responsavel || "", status: "aberto", priority: "alta", canal: "proativo", categoria: "backup",
    attachments: [], checklist: [], tags: ["backup-automatico"], created_at: iso, updated_at: iso,
  };
}

// ── Triagem de e-mail (pendência aberta pelo Intra) ─────────────────────────

/**
 * Mesmo pacote que vem do Gmail no monitor de backup, mais o `message_id`:
 * o cabeçalho Message-ID do RFC 5322, não o id interno do Gmail. É ele que a
 * resposta devolve em In-Reply-To para cair na mesma conversa do cliente.
 * Opcional: e-mail antigo (antes do Robo.gs mandar o cabeçalho) abre
 * pendência igual, só não dá para responder pela tela.
 */
// `thread_id` é o id da CONVERSA no Gmail (th.getId()), não o da mensagem:
// é por ele que a triagem sabe que esta mensagem pertence a um chamado que
// já existe. Opcional: e-mail de antes do Robo.gs mandar o campo abre
// chamado novo, como antes.
export type EmailEntrada = EmailBackup & { message_id?: string | null; thread_id?: string | null };
export type Cliente = {
  id: string; name: string; team?: string | null; technician?: string | null;
  emails?: Record<string, unknown> | null;
};
export type Triagem = {
  ignorar: boolean; assunto: string; descricao: string; categoria: string;
  prioridade: string; tipo: string; solicitante: string; semIa: boolean;
};

// Listas fechadas do app: migration 056 (canal/categoria) e js/pendencias.js (tipo).
export const PEN_CATEGORIAS = ["rede", "email", "impressora", "hardware", "software", "acesso",
  "backup", "servidor", "seguranca", "telefonia", "outro"];
export const PEN_PRIORIDADES = ["baixa", "media", "alta", "critica"];
export const PEN_TIPOS = ["Projeto", "Operacional / Interno", "Manutenção", "Suporte", "Gestão", "Outro"];
/** Prioridade máxima que a triagem dá sozinha. "critica" vale SLA de 1 h: fica para a equipe. */
export const TRIAGEM_PRIORIDADE_MAX = "alta";
// Domínio de e-mail grátis nunca casa cliente: o remetente pode ser qualquer um.
const DOMINIOS_PUBLICOS = ["gmail.com", "hotmail.com", "hotmail.com.br", "outlook.com", "outlook.com.br",
  "live.com", "yahoo.com", "yahoo.com.br", "icloud.com", "me.com", "msn.com",
  "uol.com.br", "bol.com.br", "terra.com.br", "globo.com"];

/** `Márcia <m@acme.com.br>` → `m@acme.com.br` (vazio se não houver e-mail). */
export function enderecoDoRemetente(de: string): string {
  const m = /<([^>]+)>/.exec(String(de || ""));
  const alvo = (m ? m[1] : String(de || "")).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(alvo) ? alvo : "";
}

/** Nome de quem escreveu; sem nome no remetente, a parte antes do @. */
export function nomeDoRemetente(de: string): string {
  const s = String(de || "").trim();
  const m = /^\s*"?([^"<]+?)"?\s*</.exec(s);
  if (m) return m[1].trim().slice(0, 120);
  return (enderecoDoRemetente(s).split("@")[0] || s).trim().slice(0, 120);
}

// ── Corpo do e-mail: só o que a pessoa escreveu agora ──────────────────────
// Um e-mail de resposta carrega a conversa inteira citada embaixo e a
// assinatura de quem escreveu. Isso ia cru para a IA e, sem IA, virava a
// descrição do chamado — que terminava no meio de "Em qui., 22 de", porque o
// corte de 600 caracteres caía dentro do trecho citado.
//
// A regra é errar para MENOS: na dúvida o texto fica. Nenhum corte depende de
// adivinhar o formato do cliente; todos são marcadores que o próprio programa
// de e-mail escreve.

/** Início da conversa citada. O primeiro que casar manda. */
const MARCAS_CITACAO: RegExp[] = [
  // Gmail: "Em qui., 22 de out. de 2026 às 10:30, Fulano <f@x> escreveu:".
  // A linha quebra no meio com frequência, por isso [\s\S] e não ponto.
  /^[ \t]*Em[ \t][\s\S]{0,300}?escreveu:[ \t]*$/im,
  /^[ \t]*On[ \t][\s\S]{0,300}?wrote:[ \t]*$/im,
  // Outlook e clientes que encaminham com cabeçalho.
  /^[ \t]*-{2,}[ \t]*(Mensagem original|Original Message|Mensagem encaminhada|Forwarded message)[ \t]*-{2,}/im,
  /^[ \t]*_{10,}[ \t]*$/m,
  /^[ \t]*(De|From):[ \t].*\n[ \t]*(Enviada em|Enviado em|Enviada|Sent|Data|Date):[ \t]/im,
  // Primeira linha citada com ">".
  /^[ \t]*>/m,
];

// O delimitador do RFC 3676 ("-- " sozinho na linha): sem ambiguidade nenhuma.
const MARCA_SIG_RFC = /^-- ?[ \t]*$/m;
const DESPEDIDAS = /^[ \t]*(Atenciosamente|Att\.?|Abraços?|Abraço|Obrigad[oa]|Agradeço|Grat[oa]|Cordialmente|Saudações|Respeitosamente)[ \t]*[,.!]?[ \t]*$/im;
// Sinais de bloco de contato: telefone, site ou e-mail soltos.
const SINAL_CONTATO = /(\+?\d[\d ().-]{7,}\d)|(https?:\/\/|www\.)|([^\s@]+@[^\s@]+\.[^\s@]{2,})/i;

/** Menor índice entre os marcadores, ou -1. */
function _primeiroCorte(s: string, marcas: RegExp[]): number {
  let corte = -1;
  for (const re of marcas) {
    const m = re.exec(s);
    if (m && m.index >= 0 && (corte === -1 || m.index < corte)) corte = m.index;
  }
  return corte;
}

/**
 * Corta a assinatura. O delimitador "-- " do RFC vale sozinho. Uma despedida
 * ("Obrigado,", "Atenciosamente") só corta quando o que vem depois PARECE
 * bloco de contato: curto e com telefone, site ou e-mail. Despedida seguida de
 * texto de verdade fica, porque ali a pessoa ainda estava falando.
 */
function _semAssinatura(s: string): string {
  const rfc = MARCA_SIG_RFC.exec(s);
  let corpo = rfc ? s.slice(0, rfc.index) : s;
  const d = DESPEDIDAS.exec(corpo);
  if (d) {
    const depois = corpo.slice(d.index + d[0].length).trim();
    if (depois.length <= 400 && SINAL_CONTATO.test(depois)) {
      // A despedida em si fica: é a última coisa que a pessoa escreveu.
      corpo = corpo.slice(0, d.index + d[0].length);
    }
  }
  return corpo;
}

/**
 * O que a pessoa escreveu agora: sem a conversa citada e sem a assinatura.
 * Devolve o texto original quando o corte não deixaria quase nada — um e-mail
 * de duas linhas não pode virar um chamado vazio.
 */
export function corpoLimpo(trecho: string): string {
  const original = String(trecho || "").replace(/\r\n?/g, "\n");
  if (!original.trim()) return "";
  const corte = _primeiroCorte(original, MARCAS_CITACAO);
  const semCitacao = corte > 0 ? original.slice(0, corte) : original;
  const limpo = _semAssinatura(semCitacao).replace(/\n{3,}/g, "\n\n").trim();
  // Sobrou pouco demais: algum marcador pegou texto de verdade.
  if (limpo.length < 20 && original.trim().length >= 20) return original.trim();
  return limpo;
}

/**
 * Remetente do próprio domínio da Init. O robô varre a CONVERSA inteira do
 * rótulo, então a nossa resposta ao cliente chega aqui como mensagem nova e
 * abria um chamado com o técnico como solicitante — e responder naquele
 * chamado devolveria o e-mail para a própria Init.
 */
export function remetenteInterno(de: string, dominios: string[]): boolean {
  const d = (enderecoDoRemetente(de).split("@")[1] || "").trim();
  if (!d) return false;
  return (dominios || []).some((x) => {
    const n = String(x || "").trim().toLowerCase().replace(/^@/, "");
    return !!n && n.includes(".") && (d === n || d.endsWith("." + n));
  });
}

/** Domínio da caixa do robô (GMAIL_USER): o domínio "de casa", sem secret novo. */
export function dominiosInternos(gmailUser: string): string[] {
  const d = (String(gmailUser || "").trim().toLowerCase().split("@")[1] || "").trim();
  return d.includes(".") ? [d] : [];
}


/** Tira os Re:/Enc: empilhados do assunto. */
export function assuntoLimpo(assunto: string): string {
  const prefixo = /^\s*(re|res|ref|enc|encaminhada|fwd|fw)\s*:\s*/i;
  let s = String(assunto || "").trim();
  for (let i = 0; i < 5 && prefixo.test(s); i++) s = s.replace(prefixo, "").trim();
  return s.slice(0, 140);
}

/** Cliente do e-mail: domínio da ficha (emails.domain); senão, nome do cliente no remetente ou no assunto. */
export function clienteDoEmail(clientes: Cliente[], e: EmailEntrada): Cliente | null {
  const dominio = enderecoDoRemetente(e.de).split("@")[1] || "";
  if (dominio && !DOMINIOS_PUBLICOS.includes(dominio)) {
    for (const c of clientes) {
      const d = norm(c.emails?.domain).replace(/^@/, "").trim();
      if (d.includes(".") && (dominio === d || dominio.endsWith("." + d))) return c;
    }
  }
  // Sem domínio na ficha: o nome do cliente no remetente ou no assunto; o mais específico vence.
  const alvo = norm(e.de + " " + e.assunto);
  let melhor: Cliente | null = null;
  for (const c of clientes) {
    const nome = norm(c.name).trim();
    if (nome.length < 4 || !alvo.includes(nome)) continue;
    if (!melhor || nome.length > norm(melhor.name).trim().length) melhor = c;
  }
  return melhor;
}

const umaDe = (v: unknown, lista: string[], padrao: string) =>
  lista.find((x) => norm(x) === norm(v)) || padrao;

/** Resposta do Make (JSON) checada contra as listas fechadas. Sem resposta, vale o próprio e-mail. */
export function triagemDaIa(body: string, e: EmailEntrada): Triagem {
  let j: Record<string, unknown> | null = null;
  try {
    const p = JSON.parse(body);
    if (p && typeof p === "object" && !Array.isArray(p)) j = p as Record<string, unknown>;
  } catch { /* webhook fora do ar ou "Accepted": segue sem IA */ }
  const texto = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  let prioridade = umaDe(j?.prioridade, PEN_PRIORIDADES, "media");
  if (PEN_PRIORIDADES.indexOf(prioridade) > PEN_PRIORIDADES.indexOf(TRIAGEM_PRIORIDADE_MAX)) {
    prioridade = TRIAGEM_PRIORIDADE_MAX;
  }
  return {
    ignorar: j?.ignorar === true || String(j?.ignorar ?? "").toLowerCase() === "true",
    assunto: texto(j?.assunto, 140) || assuntoLimpo(e.assunto) || "Pedido por e-mail",
    // Sem IA, a descrição é o e-mail: corpoLimpo tira a conversa citada e a
    // assinatura antes do corte de 600, que era o que terminava no meio de
    // "Em qui., 22 de".
    descricao: texto(j?.descricao, 600) || texto(corpoLimpo(e.trecho || ""), 600),
    categoria: umaDe(j?.categoria, PEN_CATEGORIAS, "outro"),
    prioridade,
    tipo: umaDe(j?.tipo, PEN_TIPOS, "Suporte"),
    solicitante: texto(j?.solicitante, 120) || nomeDoRemetente(e.de),
    semIa: !j,
  };
}

// Expediente e prazos de 1ª resposta iguais aos do app (js/sla.js).
const SLA_EXPEDIENTE = { inicio: 8, fim: 18 };
const SLA_RESPOSTA_HORAS: Record<string, number> = { critica: 1, alta: 4, media: 8, baixa: 24 };
const BRT_MS = 3 * 3600000;  // Brasília = UTC-3 (sem horário de verão desde 2019)

/** Prazo da 1ª resposta em horas úteis (8h–18h, seg–sex, horário de Brasília). */
export function primeiraRespostaDue(prioridade: string, agora: Date = new Date()): string {
  const d = new Date(agora.getTime() - BRT_MS);  // relógio de Brasília lido em UTC
  let restante = Math.round((SLA_RESPOSTA_HORAS[prioridade] ?? SLA_RESPOSTA_HORAS.media) * 60);
  const inicioDoDia = (x: Date) => { x.setUTCHours(SLA_EXPEDIENTE.inicio, 0, 0, 0); };
  const proximoDia = (x: Date) => { x.setUTCDate(x.getUTCDate() + 1); inicioDoDia(x); };
  for (let guard = 0; guard < 400; guard++) {
    if ([0, 6].includes(d.getUTCDay())) { proximoDia(d); continue; }
    const ini = new Date(d); inicioDoDia(ini);
    const fim = new Date(d); fim.setUTCHours(SLA_EXPEDIENTE.fim, 0, 0, 0);
    if (d < ini) d.setTime(ini.getTime());
    if (d >= fim) { proximoDia(d); continue; }
    const livres = Math.floor((fim.getTime() - d.getTime()) / 60000);
    if (restante <= livres) { d.setTime(d.getTime() + restante * 60000); break; }
    restante -= livres;
    proximoDia(d);
  }
  return new Date(d.getTime() + BRT_MS).toISOString();
}

/** Pendência da triagem: o que a IA entendeu, com o e-mail original no fim da descrição. */
export function pendenciaDaTriagem(t: Triagem, e: EmailEntrada, c: Cliente, id: string, agora: Date = new Date()) {
  const iso = agora.toISOString();
  const tags = ["triagem-automatica"];
  if (t.semIa) tags.push("sem-classificacao-ia");
  const origem = `\n\n— Aberta pela triagem de e-mail do Init Intra.\nDe: ${e.de}\nRecebido em: ${e.data}`
    + `\nAssunto original: ${String(e.assunto || "").slice(0, 200)}`;
  return {
    id, client_id: c.id, client_name: c.name || "", team: c.team || "init",
    tipo: t.tipo, assunto: t.assunto, descricao: t.descricao + origem,
    responsible: c.technician || "", solicitante: t.solicitante,
    solicitante_email: enderecoDoRemetente(e.de) || null,
    email_message_id: String(e.message_id || "").trim().slice(0, 500) || null,
    email_thread_id: String(e.thread_id || "").trim().slice(0, 200) || null,
    status: "aberto", priority: t.prioridade, canal: "email", categoria: t.categoria,
    first_response_due: primeiraRespostaDue(t.prioridade, agora),
    attachments: [], checklist: [], tags, created_at: iso, updated_at: iso,
  };
}


/**
 * Nota de uma mensagem que chegou na conversa de um chamado que já existe.
 *
 * `visibility: "solicitante"` é um valor novo, de propósito: só "resposta"
 * conta como 1ª resposta no SLA (js/sla.js, slaNotaEhResposta), então a fala
 * de quem PEDIU nunca pode marcar que a gente respondeu. Fail-closed — se um
 * dia alguém esquecer deste caminho, o pior que acontece é não contar.
 */
export function notaDoSolicitante(e: EmailEntrada, agora: Date = new Date()) {
  const texto = corpoLimpo(e.trecho || "").slice(0, 4000);
  return {
    text: texto || "(mensagem sem texto)",
    author: nomeDoRemetente(e.de),
    createdAt: (Date.parse(e.data) ? new Date(e.data) : agora).toISOString(),
    mentionedOperators: [],
    visibility: "solicitante",
  };
}

/** Itens que o Make devolveu para o "O que levar": um por linha, sem numeração nem repetido. */
export function itensDaIa(body: string, jaTem: string[] = [], max = 8): string[] {
  const texto = textoDaIa(body, 2000);
  if (!texto) return [];
  const vistos = new Set(jaTem.map((t) => norm(t)));
  const out: string[] = [];
  for (const linha of texto.split("\n")) {
    const t = linha.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").replace(/\s+/g, " ").replace(/\.$/, "").trim().slice(0, 120);
    if (t.length < 2 || /^(nada|nenhum|sem item|n\/a)\b/i.test(t)) continue;
    const k = norm(t);
    if (vistos.has(k)) continue;
    vistos.add(k);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}
