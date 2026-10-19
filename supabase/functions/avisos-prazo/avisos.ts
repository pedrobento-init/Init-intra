// supabase/functions/avisos-prazo/avisos.ts
// Regras puras dos avisos por e-mail (sem rede, sem banco): quem recebe,
// qual aviso cabe hoje e o texto do e-mail. Testado em tests/avisos-prazo.test.js.
//
// Antes estas regras rodavam no navegador de quem abria o site
// (js/notifications.js e js/vencimentos.js): cada pessoa/aba nova mandava o
// mesmo lembrete de novo. Agora o cron chama a função uma vez por dia.

export type Operator = {
  id: string;
  name: string;
  email: string | null;
  active: boolean | null;
  is_admin: boolean | null;
  is_gestao: boolean | null;
};

export type Pendencia = {
  id: string;
  assunto?: string | null;
  descricao?: string | null;
  client_name?: string | null;
  responsible?: string | null;
  responsible_id?: string | null;
  priority?: string | null;
  status?: string | null;
  tipo?: string | null;
  deadline?: string | null;
};

export type Vencimento = {
  id: string;
  tipo?: string | null;
  descricao?: string | null;
  client_name?: string | null;
  data_vencimento?: string | null;
  responsavel?: string | null;
  responsavel_id?: string | null;
  renovacao_auto?: boolean | null;
  status?: string | null;
  avisos?: unknown;
};

export const PEN_CLOSED_STATUSES = ["concluido", "resolvido", "cancelado", "fechado"];
export const PEN_REMINDER_DAYS = 2;
export const VENC_AVISOS = [30, 7, 0];
export const VENC_TIPOS: Record<string, string> = {
  licenca: "Licença",
  ssl: "Certificado SSL",
  dominio: "Domínio",
  garantia: "Garantia",
  backup: "Assinatura de backup",
  contrato: "Contrato",
  outro: "Outro",
};

/** Data de hoje (YYYY-MM-DD) no horário de Brasília. */
export function todayBR(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
}

/** Dias de `fromISO` até `toISO` (datas sem hora). */
export function daysBetween(fromISO: string, toISO: string): number {
  const a = Date.UTC(+fromISO.slice(0, 4), +fromISO.slice(5, 7) - 1, +fromISO.slice(8, 10));
  const b = Date.UTC(+toISO.slice(0, 4), +toISO.slice(5, 7) - 1, +toISO.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

const norm = (s: unknown) =>
  String(s ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const isActive = (o: Operator | undefined | null) => !!o && o.active !== false && !!o.email;

function findOperator(ops: Operator[], id?: string | null, name?: string | null) {
  if (id) {
    const byId = ops.find((o) => o.id === id);
    if (byId) return byId;
  }
  const n = norm(name);
  if (!n) return undefined;
  const same = ops.filter((o) => norm(o.name) === n && o.active !== false);
  return same.length === 1 ? same[0] : undefined;
}

function uniq(list: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const e of list) {
    const v = String(e ?? "").trim();
    if (v && !out.some((x) => x.toLowerCase() === v.toLowerCase())) out.push(v);
  }
  return out;
}

/**
 * Destinatários: responsável + admins ativos. Pendência tipo Gestão vai só
 * para quem é Gestão (o responsável entra só se também for Gestão).
 */
export function recipientsFor(
  ops: Operator[],
  person: { id?: string | null; name?: string | null },
  opts: { gestao?: boolean } = {},
): string[] {
  const resp = findOperator(ops, person.id, person.name);
  if (opts.gestao) {
    const gestao = ops.filter((o) => isActive(o) && o.is_gestao === true);
    return uniq(gestao.map((o) => o.email));
  }
  const admins = ops.filter((o) => isActive(o) && o.is_admin === true);
  return uniq([isActive(resp) ? resp!.email : null, ...admins.map((o) => o.email)]);
}

export function isPendenciaGestao(p: Pendencia): boolean {
  return norm(p.tipo) === "gestao";
}

export function pendenciaTitulo(p: Pendencia): string {
  return String(p.assunto ?? "").trim() || String(p.descricao ?? "").trim() || "Sem descrição";
}

/**
 * Lembrete de pendência: 'antes' (faltam 1 ou 2 dias) e 'hoje' (vence hoje).
 * Vencida/atrasada ou fechada não gera e-mail. Cada um sai uma vez por prazo.
 */
export function pendenciaAvisoDevido(p: Pendencia, today: string): { tipo: "antes" | "hoje"; days: number } | null {
  if (!p || !p.deadline || PEN_CLOSED_STATUSES.includes(String(p.status ?? ""))) return null;
  const days = daysBetween(today, String(p.deadline).slice(0, 10));
  if (days < 0 || days > PEN_REMINDER_DAYS) return null;
  return { tipo: days === 0 ? "hoje" : "antes", days };
}

/** Chave única do lembrete (tabela avisos_enviados). */
export function pendenciaAvisoKey(p: Pendencia, tipo: string): string {
  return `pendencia:${p.id}:${String(p.deadline).slice(0, 10)}:${tipo}`;
}

/**
 * Aviso de vencimento: o mais urgente ainda não dado (30, 7 ou no dia).
 * Entrando direto na janela de 7 dias, o de 30 é marcado junto, sem e-mail próprio.
 */
export function vencAvisoDevido(v: Vencimento, today: string): { aviso: string; marcar: string[]; days: number } | null {
  if (!v || v.status === "encerrado" || !v.data_vencimento) return null;
  const days = daysBetween(today, String(v.data_vencimento).slice(0, 10));
  if (days < -7) return null;
  const sent = new Set((Array.isArray(v.avisos) ? v.avisos : []).map(String));
  const due = VENC_AVISOS.filter((d) => days <= d).map(String);
  if (!due.length) return null;
  const aviso = due[due.length - 1];
  if (sent.has(aviso)) return null;
  return { aviso, marcar: due.filter((d) => !sent.has(d)), days };
}

// ── E-mail ───────────────────────────────────────────────────────────

export function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const dateBR = (iso: string) => {
  const s = String(iso).slice(0, 10);
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
};

const PRIORITY: Record<string, [string, string]> = {
  baixa: ["Baixa", "#16a34a"],
  media: ["Média", "#d97706"],
  alta: ["Alta", "#dc2626"],
  critica: ["Crítica", "#991b1b"],
};

export function emailLayout(content: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:'Inter',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0"><tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08)">
      <tr><td style="background:#1a56db;padding:20px 24px">
        <div style="font-size:20px;font-weight:800;color:#fff">Init Intra</div>
        <div style="font-size:12px;color:rgba(255,255,255,0.7);margin-top:2px">Sistema de Gestão Interna</div>
      </td></tr>
      <tr><td style="padding:24px;font-size:14px;color:#1e293b;line-height:1.6">${content}</td></tr>
      <tr><td style="background:#f8fafc;padding:16px 24px;border-top:1px solid #e2e8f0;text-align:center;font-size:11px;color:#94a3b8">
        Esta é uma notificação automática do Init Intra.
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

function button(appUrl: string, hash: string): string {
  if (!appUrl) return "";
  const href = escapeHtml(appUrl.replace(/#.*$/, "") + "#" + hash);
  return `<div style="text-align:center;margin-top:20px"><a href="${href}" style="display:inline-block;background:#1a56db;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600">Ver no Init Intra →</a></div>`;
}

export function pendenciaEmail(p: Pendencia, days: number, appUrl = ""): { subject: string; html: string } {
  const urgency = days <= 0 ? "vence HOJE" : days === 1 ? "vence AMANHÃ" : `vence em ${days} dias`;
  const color = days <= 0 ? "#dc2626" : days === 1 ? "#d97706" : "#1a56db";
  const [prioLabel, prioColor] = PRIORITY[String(p.priority ?? "")] || [String(p.priority ?? "—"), "#64748b"];
  const titulo = pendenciaTitulo(p);
  const row = (label: string, value: string, style = "") =>
    `<tr><td style="padding:8px 12px;font-size:12px;color:#64748b;width:120px"><strong>${label}</strong></td><td style="padding:8px 12px;font-size:13px;${style}">${value}</td></tr>`;
  const html = emailLayout(`
    <div style="display:inline-block;color:${color};font-size:12px;font-weight:600;margin-bottom:8px">⏰ Lembrete de Prazo</div>
    <h2 style="margin:0 0 16px;font-size:18px;color:#1e293b">${escapeHtml(titulo)}</h2>
    <div style="border:1px solid ${color}30;border-radius:8px;padding:16px;margin-bottom:16px;text-align:center">
      <div style="font-size:24px;font-weight:800;color:${color}">${urgency}</div>
      <div style="font-size:13px;color:#64748b">Prazo: ${dateBR(String(p.deadline))}</div>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0">
      ${row("Cliente", escapeHtml(p.client_name || "—"))}
      ${row("Responsável", escapeHtml(p.responsible || "—"))}
      ${row("Prioridade", escapeHtml(prioLabel), `color:${prioColor};font-weight:600`)}
    </table>
    ${button(appUrl, "pendencias")}`);
  return { subject: `[Init Intra] ⏰ Prazo ${urgency}: ${titulo}`.slice(0, 300), html };
}

export function vencimentoEmail(v: Vencimento, days: number, appUrl = ""): { subject: string; html: string } {
  const quando = days < 0
    ? `VENCIDO há ${-days} ${days === -1 ? "dia" : "dias"}`
    : days === 0 ? "vence HOJE" : `vence em ${days} dias`;
  const tipo = VENC_TIPOS[String(v.tipo ?? "")] || "Vencimento";
  const html = emailLayout(`
    <h2 style="margin:0 0 8px;font-size:18px;color:#1e293b">${escapeHtml(v.descricao || "")}</h2>
    <p style="margin:0 0 12px;font-size:14px;color:#475569">${escapeHtml(tipo)} · ${escapeHtml(v.client_name || "Interno")}</p>
    <p style="font-size:20px;font-weight:800;color:${days <= 7 ? "#dc2626" : "#1a56db"};margin:0 0 6px">${quando}</p>
    <p style="font-size:13px;color:#64748b;margin:0 0 16px">Data: ${dateBR(String(v.data_vencimento))}${v.renovacao_auto ? " · renovação automática (confira se renovou)" : ""}</p>
    ${button(appUrl, "vencimentos")}`);
  return { subject: `[Init Intra] ⏰ ${tipo} ${quando}: ${v.descricao || ""}`.slice(0, 300), html };
}
