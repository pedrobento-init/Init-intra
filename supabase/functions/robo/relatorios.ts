// supabase/functions/robo/relatorios.ts
// Regras puras do robô (sem rede, sem banco): eventos da agenda de
// vencimentos, leitura do RDAP, resumo diário e abas da planilha de
// indicadores. Testado em tests/robo.test.js.

import {
  daysBetween,
  emailLayout,
  escapeHtml,
  type Operator,
  PEN_CLOSED_STATUSES,
  VENC_TIPOS,
} from "../avisos-prazo/avisos.ts";

export type Visita = {
  id: string; numero?: number | null; client_name?: string | null; operator?: string | null; operator_id?: string | null;
  date?: string | null; time?: string | null; time_end?: string | null; all_day?: boolean | null;
  motivo?: string | null; status?: string | null; levar?: { t?: string; ok?: boolean }[] | null;
};
export type Pend = {
  id: string; assunto?: string | null; descricao?: string | null; client_name?: string | null;
  responsible?: string | null; responsible_id?: string | null; priority?: string | null; status?: string | null;
  tipo?: string | null; deadline?: string | null; categoria?: string | null; canal?: string | null;
  created_at?: string | null; completed_at?: string | null;
  first_response_due?: string | null; first_response_at?: string | null;
};
export type Venc = {
  id: string; tipo?: string | null; descricao?: string | null; client_name?: string | null;
  data_vencimento?: string | null; responsavel?: string | null; responsavel_id?: string | null;
  renovacao_auto?: boolean | null; status?: string | null; observacoes?: string | null;
};
export type Hora = {
  id: string; operator_id?: string | null; operator_name?: string | null; client_id?: string | null;
  started_at?: string | null; ended_at?: string | null; seconds?: number | null; source?: string | null; note?: string | null;
};
export type Dominio = { vencimento_id: string; dominio: string; expira_registro: string | null; erro: string | null };

const TZ = "America/Sao_Paulo";
const norm = (s: unknown) => String(s ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const dateBR = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const hhmm = (t: unknown) => (/^\d{1,2}:\d{2}/.exec(String(t ?? "")) || [""])[0].padStart(5, "0");

export function addDays(iso: string, n: number): string {
  return new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + n)).toISOString().slice(0, 10);
}

/** Data/hora ISO → dia e mês no horário de Brasília. */
export function diaBR(iso: string | null | undefined): string {
  if (!iso) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
}
const mes = (dia: string) => dia.slice(0, 7);

/** Operador por id; registros antigos só com nome, pelo nome (único e ativo). */
export function opDe(ops: Operator[], id?: string | null, name?: string | null): Operator | null {
  if (id) { const o = ops.find((x) => x.id === id); if (o) return o; }
  const n = norm(name);
  if (!n) return null;
  const same = ops.filter((o) => norm(o.name) === n && o.active !== false);
  return same.length === 1 ? same[0] : null;
}

function hex(s: string) {
  let h = "";
  for (const b of new TextEncoder().encode(s)) h += b.toString(16).padStart(2, "0");
  return h;
}

// ── Agenda de vencimentos ───────────────────────────────────────────────────

/** Evento de dia inteiro do vencimento; `h` = assinatura para o robô só regravar o que mudou. */
export function vencimentoEvento(v: Venc, appUrl = "") {
  const dia = String(v.data_vencimento || "").slice(0, 10);
  const tipo = VENC_TIPOS[String(v.tipo ?? "")] || "Vencimento";
  const summary = `🔔 ${tipo} · ${v.client_name || "Interno"}: ${v.descricao || ""}`.trim().slice(0, 250);
  const description = [
    v.renovacao_auto ? "Renovação automática (confira se renovou)." : "",
    v.responsavel ? "Responsável: " + v.responsavel : "",
    v.observacoes || "",
    appUrl ? appUrl + "/#vencimentos" : "",
  ].filter(Boolean).join("\n\n");
  return {
    id: "vc" + hex(v.id),
    summary,
    description,
    start: { date: dia },
    end: { date: addDays(dia, 1) },
    transparency: "transparent",  // não ocupa a agenda de ninguém
    extendedProperties: { private: { h: simpleHash(JSON.stringify([summary, description, dia])) } },
  };
}

function simpleHash(s: string) {
  let x = 0;
  for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) | 0;
  return (x >>> 0).toString(36);
}

// ── Domínios (RDAP) ─────────────────────────────────────────────────────────

/** Domínio citado na descrição do vencimento (ex.: "Domínio cliente.com.br"). */
export function dominioDe(v: Venc): string | null {
  const m = /(?:^|[\s(/@])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24})(?=$|[\s)/,;:])/i
    .exec(`${v.descricao || ""} ${v.observacoes || ""}`.toLowerCase().replace(/^https?:\/\//, " "));
  return m ? m[1].replace(/^www\./, "") : null;
}

/** Data de expiração (YYYY-MM-DD) na resposta RDAP (RFC 9083). */
export function expiracaoRdap(json: unknown): string | null {
  const evs = (json as { events?: { eventAction?: string; eventDate?: string }[] })?.events;
  if (!Array.isArray(evs)) return null;
  const e = evs.find((x) => String(x?.eventAction || "").toLowerCase() === "expiration");
  return e?.eventDate ? diaBR(e.eventDate) || null : null;
}

/** Cadastro e registro discordam por mais de 1 dia? */
export function dominioDiverge(v: Venc, d: Dominio | undefined): boolean {
  if (!d || !d.expira_registro || !v.data_vencimento) return false;
  return Math.abs(daysBetween(String(v.data_vencimento).slice(0, 10), d.expira_registro)) > 1;
}

// ── Resumo diário ───────────────────────────────────────────────────────────

export type Resumo = { op: Operator; subject: string; html: string; vazio: boolean; visitasHoje: number };

const PRIO: Record<string, string> = { baixa: "Baixa", media: "Média", alta: "Alta", critica: "Crítica" };

function visitaLinha(v: Visita, briefing = "") {
  const hora = v.all_day || !v.time ? "Dia inteiro" : hhmm(v.time) + (v.time_end ? "–" + hhmm(v.time_end) : "");
  const num = v.numero ? "#" + String(v.numero).padStart(4, "0") + " " : "";
  const levar = (Array.isArray(v.levar) ? v.levar : []).filter((i) => i && i.t);
  const lista = levar.length
    ? `<div style="font-size:12px;color:#475569;margin-top:4px">Levar: ${levar.map((i) => (i.ok ? "☑ " : "☐ ") + escapeHtml(i.t)).join(" · ")}</div>`
    : "";
  return `<li style="margin-bottom:8px"><b>${escapeHtml(hora)}</b> — ${escapeHtml(num)}${escapeHtml(v.client_name || "Cliente")}: ${escapeHtml(v.motivo || "")}${lista}${briefing}</li>`;
}

function pendLinha(p: Pend, today: string) {
  const dias = p.deadline ? daysBetween(String(p.deadline).slice(0, 10), today) : 0;
  const quando = dias <= 0 ? "vence hoje" : dias === 1 ? "venceu ontem" : `vencida há ${dias} dias`;
  const titulo = String(p.assunto || p.descricao || "Sem descrição").slice(0, 120);
  return `<li style="margin-bottom:6px">${escapeHtml(titulo)} — ${escapeHtml(p.client_name || "—")} <span style="color:${dias > 0 ? "#dc2626" : "#d97706"}">(${quando}${p.priority ? ", " + escapeHtml(PRIO[p.priority] || p.priority) : ""})</span></li>`;
}

function vencLinha(v: Venc, today: string, dom?: Dominio) {
  const dias = daysBetween(today, String(v.data_vencimento).slice(0, 10));
  const quando = dias === 0 ? "hoje" : dias === 1 ? "amanhã" : `em ${dias} dias`;
  const div = dom && dominioDiverge(v, dom)
    ? ` <span style="color:#dc2626">⚠ registro diz ${dateBR(dom.expira_registro!)}</span>` : "";
  return `<li style="margin-bottom:6px">${escapeHtml(VENC_TIPOS[String(v.tipo)] || "Vencimento")} · ${escapeHtml(v.client_name || "Interno")}: ${escapeHtml(v.descricao || "")} — <b>${quando}</b> (${dateBR(String(v.data_vencimento))})${div}</li>`;
}

/** Rota do Google Maps saindo de onde a pessoa está (igual a js/visita-campo.js). */
export function rotaMapsUrl(paradas: string[]): string | null {
  const p = paradas.map((s) => String(s || "").trim()).filter(Boolean).slice(0, 10);
  if (!p.length) return null;
  const meio = p.slice(0, -1);
  return "https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=" + encodeURIComponent(p[p.length - 1])
    + (meio.length ? "&waypoints=" + encodeURIComponent(meio.join("|")) : "");
}

const secao = (titulo: string, itens: string[]) =>
  itens.length ? `<h3 style="margin:18px 0 8px;font-size:15px;color:#1e293b">${titulo}</h3><ul style="margin:0;padding-left:18px">${itens.join("")}</ul>` : "";

/**
 * Um e-mail por pessoa: suas visitas de hoje (com o que levar), suas
 * pendências vencidas ou que vencem hoje, vencimentos dos próximos 7 dias
 * de que é responsável. Admin vê também todos os vencimentos e os domínios
 * cujo registro discorda do cadastro.
 */
export function montarResumos(input: {
  today: string; ops: Operator[]; visitas: Visita[]; pendencias: Pend[]; vencimentos: Venc[];
  dominios: Dominio[]; appUrl?: string;
  briefings?: Map<string, string>;  // visita → HTML do briefing (campo.ts)
  paradas?: Map<string, string>;    // visita → endereço (ou nome) do cliente, para a rota
}): Resumo[] {
  const { today, ops, appUrl = "" } = input;
  const ate = addDays(today, 7);
  const dom = new Map(input.dominios.map((d) => [d.vencimento_id, d]));
  const visHoje = input.visitas.filter((v) => v.date === today && v.status !== "cancelada")
    .sort((a, b) => (a.all_day ? "" : hhmm(a.time)).localeCompare(b.all_day ? "" : hhmm(b.time)));
  const pendAtras = input.pendencias.filter((p) => p.deadline && String(p.deadline).slice(0, 10) <= today
    && !PEN_CLOSED_STATUSES.includes(String(p.status ?? "")))
    .sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)));
  const vencSemana = input.vencimentos.filter((v) => v.status !== "encerrado" && v.data_vencimento
    && String(v.data_vencimento).slice(0, 10) >= today && String(v.data_vencimento).slice(0, 10) <= ate)
    .sort((a, b) => String(a.data_vencimento).localeCompare(String(b.data_vencimento)));
  const divergentes = input.vencimentos.filter((v) => v.status !== "encerrado" && dominioDiverge(v, dom.get(v.id)));

  return ops.filter((o) => o.active !== false && o.email).map((op) => {
    const minhasVis = visHoje.filter((v) => opDe(ops, v.operator_id, v.operator)?.id === op.id);
    const minhasPend = pendAtras.filter((p) => opDe(ops, p.responsible_id, p.responsible)?.id === op.id);
    const meusVenc = op.is_admin ? vencSemana : vencSemana.filter((v) => opDe(ops, v.responsavel_id, v.responsavel)?.id === op.id);
    const meusDiv = op.is_admin ? divergentes.filter((v) => !meusVenc.includes(v)) : [];
    const rota = rotaMapsUrl(minhasVis.filter((v) => v.status !== "concluida").map((v) => input.paradas?.get(v.id) || ""));
    const corpo = [
      secao(`🚗 Suas visitas hoje (${minhasVis.length})`, minhasVis.map((v) => visitaLinha(v, input.briefings?.get(v.id) || ""))),
      rota ? `<p style="margin:8px 0 0"><a href="${escapeHtml(rota)}" style="color:#1a56db;font-weight:600">🗺️ Abrir a rota do dia no Google Maps</a></p>` : "",
      secao(`⏰ Pendências vencidas ou que vencem hoje (${minhasPend.length})`, minhasPend.map((p) => pendLinha(p, today))),
      secao(`🔔 Vencimentos até ${dateBR(ate)} (${meusVenc.length})`, meusVenc.map((v) => vencLinha(v, today, dom.get(v.id)))),
      secao("⚠ Domínios com data diferente do registro", meusDiv.map((v) => vencLinha(v, today, dom.get(v.id)))),
    ].join("");
    const vazio = !corpo;
    const botao = appUrl
      ? `<div style="text-align:center;margin-top:22px"><a href="${escapeHtml(appUrl)}" style="display:inline-block;background:#1a56db;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600">Abrir o Init Intra →</a></div>` : "";
    const primeiro = String(op.name || "").split(/\s+/)[0];
    const html = emailLayout(`<h2 style="margin:0 0 4px;font-size:18px">Bom dia, ${escapeHtml(primeiro)}!</h2>
      <p style="margin:0;color:#64748b;font-size:13px">Seu dia em ${dateBR(today)}.</p>${corpo}${botao}`);
    const partes = [minhasVis.length ? `${minhasVis.length} visita${minhasVis.length > 1 ? "s" : ""}` : "",
      minhasPend.length ? `${minhasPend.length} pendência${minhasPend.length > 1 ? "s" : ""} para hoje/atrasada${minhasPend.length > 1 ? "s" : ""}` : "",
      meusVenc.length ? `${meusVenc.length} vencimento${meusVenc.length > 1 ? "s" : ""}` : ""].filter(Boolean);
    return { op, subject: `[Init Intra] Seu dia ${dateBR(today)}: ${partes.join(", ") || "nada pendente"}`, html, vazio, visitasHoje: minhasVis.length };
  });
}

/** Texto curto para o Google Chat (visão da equipe). */
export function resumoChat(input: { today: string; ops: Operator[]; visitas: Visita[]; pendencias: Pend[]; vencimentos: Venc[] }): string {
  const { today, ops } = input;
  const vis = input.visitas.filter((v) => v.date === today && v.status !== "cancelada");
  const pend = input.pendencias.filter((p) => p.deadline && String(p.deadline).slice(0, 10) < today && !PEN_CLOSED_STATUSES.includes(String(p.status ?? "")));
  const ate = addDays(today, 7);
  const venc = input.vencimentos.filter((v) => v.status !== "encerrado" && v.data_vencimento
    && String(v.data_vencimento).slice(0, 10) >= today && String(v.data_vencimento).slice(0, 10) <= ate);
  const porTec = new Map<string, number>();
  for (const v of vis) { const n = opDe(ops, v.operator_id, v.operator)?.name || v.operator || "Sem técnico"; porTec.set(n, (porTec.get(n) || 0) + 1); }
  const linhas = [`*Init Intra — ${dateBR(today)}*`,
    `🚗 Visitas hoje: ${vis.length}${porTec.size ? " (" + [...porTec].map(([n, c]) => `${n.split(/\s+/)[0]} ${c}`).join(", ") + ")" : ""}`,
    `⏰ Pendências vencidas: ${pend.length}`,
    `🔔 Vencimentos nos próximos 7 dias: ${venc.length}`];
  return linhas.join("\n");
}

// ── Planilha de indicadores ─────────────────────────────────────────────────

type Linha = (string | number | null)[];

function horasEntre(ini?: string | null, fim?: string | null): number | null {
  const a = hhmm(ini), b = hhmm(fim);
  if (!a || !b || b <= a) return null;
  const m = (+b.slice(0, 2) * 60 + +b.slice(3)) - (+a.slice(0, 2) * 60 + +a.slice(3));
  return Math.round(m / 6) / 10;
}

/** 1ª resposta: "No prazo" | "Fora do prazo" | "Aguardando" | "" (sem SLA). */
export function slaPrimeiraResposta(p: Pend, agora: Date = new Date()): string {
  if (!p.first_response_due) return "";
  const due = Date.parse(p.first_response_due);
  if (p.first_response_at) return Date.parse(p.first_response_at) <= due ? "No prazo" : "Fora do prazo";
  return agora.getTime() > due ? "Fora do prazo" : "Aguardando";
}

export function montarIndicadores(input: {
  ops: Operator[]; visitas: Visita[]; pendencias: Pend[]; horas: Hora[]; clientes: { id: string; name: string }[]; agora?: Date;
}): Record<string, Linha[]> {
  const { ops } = input;
  const agora = input.agora || new Date();
  const cli = new Map(input.clientes.map((c) => [c.id, c.name]));
  const nomeOp = (id?: string | null, name?: string | null) => opDe(ops, id, name)?.name || name || "";

  const visitas: Linha[] = [["Número", "Data", "Mês", "Cliente", "Técnico", "Motivo", "Status", "Início", "Fim", "Duração (h)"]];
  for (const v of [...input.visitas].sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
    const d = String(v.date || "");
    visitas.push([v.numero ?? null, d, mes(d), v.client_name || "", nomeOp(v.operator_id, v.operator), v.motivo || "",
      v.status || "", v.all_day ? "" : hhmm(v.time), v.all_day ? "" : hhmm(v.time_end), v.all_day ? null : horasEntre(v.time, v.time_end)]);
  }

  const pends: Linha[] = [["ID", "Aberta em", "Mês", "Cliente", "Responsável", "Assunto", "Prioridade", "Status",
    "Categoria", "Canal", "Prazo", "Concluída em", "1ª resposta (SLA)"]];
  for (const p of [...input.pendencias].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))) {
    const ab = diaBR(p.created_at);
    pends.push([p.id, ab, mes(ab), p.client_name || "", nomeOp(p.responsible_id, p.responsible),
      String(p.assunto || p.descricao || "").slice(0, 200), PRIO[String(p.priority)] || p.priority || "", p.status || "",
      p.categoria || "", p.canal || "", p.deadline ? String(p.deadline).slice(0, 10) : "", diaBR(p.completed_at), slaPrimeiraResposta(p, agora)]);
  }

  const horas: Linha[] = [["Data", "Mês", "Técnico", "Cliente", "Horas", "Origem", "Nota"]];
  for (const h of [...input.horas].sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)))) {
    const d = diaBR(h.started_at || h.ended_at);
    horas.push([d, mes(d), nomeOp(h.operator_id, h.operator_name), (h.client_id && cli.get(h.client_id)) || "",
      Math.round((Number(h.seconds) || 0) / 36) / 100, h.source || "", String(h.note || "").slice(0, 200)]);
  }

  // Resumo por mês e técnico.
  type Acc = { vis: number; horas: number; resolv: number; slaOk: number; slaTot: number };
  const acc = new Map<string, Acc>();
  const get = (m: string, t: string) => {
    const k = m + "\u0000" + t;
    if (!acc.has(k)) acc.set(k, { vis: 0, horas: 0, resolv: 0, slaOk: 0, slaTot: 0 });
    return acc.get(k)!;
  };
  for (const r of visitas.slice(1)) if (r[6] === "concluida" && r[2]) get(String(r[2]), String(r[4] || "—")).vis++;
  for (const r of horas.slice(1)) if (r[1]) get(String(r[1]), String(r[2] || "—")).horas += Number(r[4]) || 0;
  for (const p of input.pendencias) {
    const t = nomeOp(p.responsible_id, p.responsible) || "—";
    const fim = diaBR(p.completed_at);
    if (fim && ["resolvido", "concluido", "fechado"].includes(String(p.status))) get(mes(fim), t).resolv++;
    const sla = slaPrimeiraResposta(p, agora);
    const ab = diaBR(p.created_at);
    if (ab && (sla === "No prazo" || sla === "Fora do prazo")) {
      const a = get(mes(ab), t);
      a.slaTot++;
      if (sla === "No prazo") a.slaOk++;
    }
  }
  const resumo: Linha[] = [["Mês", "Técnico", "Visitas concluídas", "Horas lançadas", "Pendências resolvidas",
    "Pendências com SLA", "1ª resposta no prazo (%)"]];
  for (const [k, a] of [...acc].sort(([x], [y]) => y.localeCompare(x))) {
    const [m, t] = k.split("\u0000");
    resumo.push([m, t, a.vis, Math.round(a.horas * 100) / 100, a.resolv, a.slaTot, a.slaTot ? Math.round((a.slaOk / a.slaTot) * 100) : null]);
  }
  return { "Resumo mensal": resumo, "Visitas": visitas, "Pendências": pends, "Horas": horas };
}
