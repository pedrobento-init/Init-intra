// mapping.ts — visita ↔ evento do Google Calendar. Puro, sem dependências:
// testado pelo Vitest (tests/google-agenda.test.js).
//
// O id do evento é derivado do id da visita ("ii" + hex do id), então criar
// duas vezes não duplica e o caminho de volta (Google → site) acha a visita
// sem tabela de vínculo. Hex usa só 0-9a-f, que cabem no base32hex exigido
// pelo Google.

export type VisitRow = {
  id: string;
  numero?: number | null;
  client_name?: string | null;
  motivo?: string | null;
  observacoes?: string | null;
  date: string;               // YYYY-MM-DD (horário local de Brasília)
  time?: string | null;       // HH:MM[:SS]
  time_end?: string | null;   // HH:MM[:SS]
  all_day?: boolean | null;
  status?: string | null;
  levar?: { t?: string; ok?: boolean }[] | null;  // "O que levar" (058)
};

export type GEventTime = { date?: string; dateTime?: string; timeZone?: string };
export type GEvent = {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  start?: GEventTime;
  end?: GEventTime;
  extendedProperties?: { private?: Record<string, string> };
};

export const TIME_ZONE = "America/Sao_Paulo";
// Brasília não tem horário de verão desde 2019: UTC−3 fixo (como agenda-ics).
const OFFSET_HOURS = 3;

export function eventIdFor(visitId: string): string {
  let hex = "";
  for (const b of new TextEncoder().encode(visitId)) hex += b.toString(16).padStart(2, "0");
  return "ii" + hex;
}

export function visitIdFromEventId(eventId: string | null | undefined): string | null {
  const m = /^ii((?:[0-9a-f]{2})+)$/.exec(String(eventId || ""));
  if (!m) return null;
  const bytes = new Uint8Array(m[1].length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(m[1].slice(i * 2, i * 2 + 2), 16);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return null; }
}

function hhmm(t: string | null | undefined): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ""));
  return m ? m[1].padStart(2, "0") + ":" + m[2] : "";
}

function addDays(date: string, n: number): string {
  const d = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10) + n));
  return d.toISOString().slice(0, 10);
}

/** Campos de agenda da visita, normalizados (base da comparação e do hash). */
function schedule(v: Pick<VisitRow, "date" | "time" | "time_end" | "all_day">) {
  const time = v.all_day ? "" : hhmm(v.time);
  return { date: String(v.date || ""), time, time_end: time ? hhmm(v.time_end) : "", all_day: !time };
}

/** Evento do Google para a visita. appUrl: link para abrir a visita no app. */
export function visitToEvent(v: VisitRow, appUrl = ""): GEvent {
  const s = schedule(v);
  const num = v.numero ? "#" + String(v.numero).padStart(4, "0") + " " : "";
  const summary = "Visita " + num + "· " + (v.client_name || "Cliente") + (v.status === "concluida" ? " ✓" : "");
  const levar = levarItens(v);
  const description = [
    v.motivo ? "Motivo: " + v.motivo : "",
    v.observacoes || "",
    levar.length ? "O que levar:\n" + levar.map((i) => (i.ok ? "☑ " : "☐ ") + i.t).join("\n") : "",
    appUrl,
    "Data e horário podem ser mudados aqui ou no Init Intra; o resto, só no Init Intra.",
  ].filter(Boolean).join("\n\n");
  let start: GEventTime, end: GEventTime;
  if (s.all_day) {
    start = { date: s.date };
    end = { date: addDays(s.date, 1) };
  } else {
    let endT = s.time_end;
    if (!endT || endT <= s.time) {
      const [h, m] = s.time.split(":").map(Number);
      endT = String(Math.min(23, h + 1)).padStart(2, "0") + ":" + String(m).padStart(2, "0");
      if (endT <= s.time) endT = "23:59";
    }
    start = { dateTime: s.date + "T" + s.time + ":00-03:00", timeZone: TIME_ZONE };
    end = { dateTime: s.date + "T" + endT + ":00-03:00", timeZone: TIME_ZONE };
  }
  return {
    id: eventIdFor(v.id),
    status: "confirmed",
    summary,
    description,
    start,
    end,
    extendedProperties: { private: { initIntraVisitId: v.id } },
  };
}

function levarItens(v: VisitRow): { t: string; ok: boolean }[] {
  return (Array.isArray(v.levar) ? v.levar : [])
    .filter((i) => i && String(i.t || "").trim())
    .map((i) => ({ t: String(i.t).trim(), ok: i.ok === true }));
}

/** Assinatura do que foi enviado ao Google: igual = nada a enviar. */
export async function visitHash(v: VisitRow): Promise<string> {
  const s = schedule(v);
  const levar = levarItens(v);
  // Sem lista, a chave fica igual à de antes da 058: nada é reenviado à toa.
  const key = JSON.stringify([s.date, s.time, s.time_end, s.all_day, v.status || "", v.client_name || "",
    v.motivo || "", v.observacoes || "", v.numero ?? null, ...(levar.length ? [levar] : [])]);
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

/** Data/hora de Brasília de um dateTime RFC 3339 com qualquer fuso. */
function localParts(dateTime: string): { date: string; time: string } | null {
  const d = new Date(dateTime);
  if (isNaN(d.getTime())) return null;
  const iso = new Date(d.getTime() - OFFSET_HOURS * 3600000).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

function eventSchedule(ev: GEvent): { date: string; time: string; time_end: string; all_day: boolean } | null {
  if (ev.start?.date && /^\d{4}-\d{2}-\d{2}$/.test(ev.start.date)) {
    return { date: ev.start.date, time: "", time_end: "", all_day: true };
  }
  if (!ev.start?.dateTime) return null;
  const a = localParts(ev.start.dateTime);
  if (!a) return null;
  const b = ev.end?.dateTime ? localParts(ev.end.dateTime) : null;
  // Evento que passa da meia-noite: a visita guarda só o horário de início.
  const timeEnd = b && b.date === a.date && b.time > a.time ? b.time : "";
  return { date: a.date, time: a.time, time_end: timeEnd, all_day: false };
}

/**
 * O que mudou na agenda da visita a partir do evento editado no Google
 * (só data, horários e dia inteiro). null = nada a mudar.
 * Compara com o evento que o site geraria, não com a visita crua: visita sem
 * fim vira evento de 1h, e isso não é edição do técnico.
 */
export function eventToVisitPatch(ev: GEvent, v: VisitRow):
  Partial<Pick<VisitRow, "date" | "time" | "time_end" | "all_day">> | null {
  const next = eventSchedule(ev);
  const cur = eventSchedule(visitToEvent(v));
  if (!next || !cur) return null;
  if (next.date === cur.date && next.time === cur.time && next.time_end === cur.time_end && next.all_day === cur.all_day) return null;
  return {
    date: next.date,
    time: next.time || null,
    time_end: next.time_end || null,
    all_day: next.all_day,
  };
}
