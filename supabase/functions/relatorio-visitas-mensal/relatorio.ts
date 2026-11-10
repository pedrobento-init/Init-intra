export type Operator = {
  email: string | null;
  active: boolean | null;
  is_gestao: boolean | null;
};

export type Visit = {
  id: string;
  client_name?: string | null;
  operator?: string | null;
  date?: string | null;
  time?: string | null;
  time_end?: string | null;
  all_day?: boolean | null;
  motivo?: string | null;
  status?: string | null;
};

const MONTHS = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

export function previousMonth(today: string): {
  key: string;
  start: string;
  end: string;
  label: string;
} {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const date = new Date(Date.UTC(year, month - 2, 1));
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const mm = String(m + 1).padStart(2, '0');
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return {
    key: `${y}-${mm}`,
    start: `${y}-${mm}-01`,
    end: `${y}-${mm}-${String(last).padStart(2, '0')}`,
    label: `${MONTHS[m]} de ${y}`,
  };
}

export function managerEmails(operators: Operator[]): string[] {
  const emails = new Map<string, string>();
  for (const op of operators) {
    const email = String(op.email ?? '').trim();
    if (op.active === false || op.is_gestao !== true || !email) continue;
    const normalized = email.toLowerCase();
    if (!emails.has(normalized)) emails.set(normalized, email);
  }
  return [...emails.values()];
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function dateBR(value: unknown): string {
  const date = String(value ?? '').slice(0, 10);
  return `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
}

const STATUS: Record<string, string> = {
  agendada: 'Agendada',
  confirmada: 'Confirmada',
  em_andamento: 'Em andamento',
  concluida: 'Concluída',
  cancelada: 'Cancelada',
  remarcada: 'Remarcada',
};

export function buildVisitsEmail(
  visits: Visit[],
  period: { key: string; start: string; end: string; label: string },
  appUrl = ''
): { subject: string; html: string } {
  const ordered = [...visits].sort(
    (a, b) =>
      String(a.date).localeCompare(String(b.date)) ||
      String(a.time ?? '').localeCompare(String(b.time ?? '')) ||
      String(a.client_name ?? '').localeCompare(String(b.client_name ?? ''), 'pt-BR')
  );
  const completed = ordered.filter((v) => v.status === 'concluida').length;
  const cancelled = ordered.filter((v) => v.status === 'cancelada').length;
  const clients = new Set(ordered.map((v) => String(v.client_name ?? '').trim()).filter(Boolean));
  const rows = ordered
    .map((v) => {
      const schedule = v.all_day
        ? 'Dia inteiro'
        : [v.time, v.time_end].filter(Boolean).join(' – ') || '—';
      return `<tr>
      <td style="padding:10px;border-bottom:1px solid #e2e8f0">${escapeHtml(dateBR(v.date))}</td>
      <td style="padding:10px;border-bottom:1px solid #e2e8f0">${escapeHtml(v.client_name || '—')}</td>
      <td style="padding:10px;border-bottom:1px solid #e2e8f0">${escapeHtml(v.operator || '—')}</td>
      <td style="padding:10px;border-bottom:1px solid #e2e8f0">${escapeHtml(schedule)}</td>
      <td style="padding:10px;border-bottom:1px solid #e2e8f0">${escapeHtml(v.motivo || '—')}</td>
      <td style="padding:10px;border-bottom:1px solid #e2e8f0">${escapeHtml(STATUS[String(v.status)] || v.status || '—')}</td>
    </tr>`;
    })
    .join('');
  const link = appUrl
    ? `<p style="text-align:center;margin-top:24px"><a href="${escapeHtml(appUrl.replace(/#.*$/, '') + '#visitas')}" style="display:inline-block;background:#1a56db;color:#fff;padding:11px 24px;border-radius:6px;text-decoration:none;font-weight:600">Ver visitas no Init Intra</a></p>`
    : '';
  const empty = `<tr><td colspan="6" style="padding:24px;text-align:center;color:#64748b">Nenhuma visita registrada neste mês.</td></tr>`;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:24px 0;background:#f0f4f8;font-family:Arial,sans-serif;color:#1e293b">
    <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center"><table width="900" cellpadding="0" cellspacing="0" style="max-width:900px;background:#fff;border-radius:10px;overflow:hidden">
      <tr><td style="background:#1a56db;padding:24px"><div style="font-size:22px;font-weight:700;color:#fff">Relatório mensal de visitas</div><div style="color:#dbeafe;margin-top:6px;text-transform:capitalize">${escapeHtml(period.label)}</div></td></tr>
      <tr><td style="padding:24px">
        <p style="margin-top:0">Resumo: <strong>${ordered.length} visita${ordered.length === 1 ? '' : 's'}</strong> · ${completed} concluída${completed === 1 ? '' : 's'} · ${cancelled} cancelada${cancelled === 1 ? '' : 's'} · ${clients.size} cliente${clients.size === 1 ? '' : 's'}.</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px"><thead><tr style="background:#f8fafc;text-align:left">
          <th style="padding:10px">Data</th><th style="padding:10px">Cliente</th><th style="padding:10px">Técnico</th><th style="padding:10px">Horário</th><th style="padding:10px">Motivo</th><th style="padding:10px">Situação</th>
        </tr></thead><tbody>${rows || empty}</tbody></table>${link}
      </td></tr><tr><td style="padding:16px;text-align:center;background:#f8fafc;color:#94a3b8;font-size:11px">Relatório automático do Init Intra · Período: ${escapeHtml(dateBR(period.start))} a ${escapeHtml(dateBR(period.end))}</td></tr>
    </table></td></tr></table></body></html>`;
  return { subject: `[Init Intra] Visitas de ${period.label}`, html };
}
