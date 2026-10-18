// ics.ts — gera o calendário iCalendar (RFC 5545) das visitas. Puro, sem
// dependências: testado pelo Vitest (tests/agenda-ics.test.js).

export type VisitRow = {
  id: string;
  numero?: number | null;
  client_name?: string | null;
  motivo?: string | null;
  observacoes?: string | null;
  date: string;               // YYYY-MM-DD (horário local de Brasília)
  time?: string | null;       // HH:MM
  time_end?: string | null;   // HH:MM
  all_day?: boolean | null;
  status?: string | null;
  updated_at?: string | null;
};

// Brasília não tem horário de verão desde 2019: UTC−3 fixo.
const OFFSET_HOURS = 3;

/** Escapa texto de propriedade (vírgula, ponto e vírgula, barra, quebra). */
export function icsEscape(s: string): string {
  return String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Dobra linhas em 75 octetos (RFC 5545 §3.1), sem partir caractere UTF-8. */
export function icsFold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let size = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (size + n > (out.length ? 74 : 75)) { out.push(cur); cur = ""; size = 0; }
    cur += ch;
    size += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

function utcStamp(date: string, hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), h + OFFSET_HOURS, m || 0));
  return d.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
}

function dateOnly(date: string, plusDays = 0): string {
  const d = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10) + plusDays));
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

function stamp(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : new Date();
  return (isNaN(d.getTime()) ? new Date() : d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Monta o VCALENDAR. appUrl: link para abrir a visita no app. */
export function buildIcs(visits: VisitRow[], opts: { name: string; appUrl: string }): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Init Intra//Agenda//PT-BR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:" + icsEscape(opts.name),
    "X-WR-TIMEZONE:America/Sao_Paulo",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const v of visits) {
    if (!v || !v.id || !/^\d{4}-\d{2}-\d{2}$/.test(v.date || "")) continue;
    const timed = !v.all_day && /^\d{1,2}:\d{2}/.test(v.time || "");
    const num = v.numero ? "#" + String(v.numero).padStart(4, "0") + " " : "";
    const title = "Visita " + num + "· " + (v.client_name || "Cliente") + (v.status === "concluida" ? " ✓" : "");
    const desc = [v.motivo ? "Motivo: " + v.motivo : "", v.observacoes || "", opts.appUrl].filter(Boolean).join("\n");
    lines.push("BEGIN:VEVENT", "UID:" + v.id + "@init-intra", "DTSTAMP:" + stamp(v.updated_at), "SEQUENCE:0");
    if (timed) {
      const start = (v.time as string).slice(0, 5);
      let end = /^\d{1,2}:\d{2}/.test(v.time_end || "") ? (v.time_end as string).slice(0, 5) : "";
      if (!end || end <= start) {
        const [h, m] = start.split(":").map(Number);
        end = String(Math.min(23, h + 1)).padStart(2, "0") + ":" + String(m).padStart(2, "0");
      }
      lines.push("DTSTART:" + utcStamp(v.date, start), "DTEND:" + utcStamp(v.date, end));
    } else {
      lines.push("DTSTART;VALUE=DATE:" + dateOnly(v.date), "DTEND;VALUE=DATE:" + dateOnly(v.date, 1));
    }
    lines.push("SUMMARY:" + icsEscape(title));
    if (desc) lines.push("DESCRIPTION:" + icsEscape(desc));
    lines.push("STATUS:" + (v.status === "cancelada" ? "CANCELLED" : "CONFIRMED"), "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(icsFold).join("\r\n") + "\r\n";
}
