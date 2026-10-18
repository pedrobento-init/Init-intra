// relatorio-cliente.js – Relatório mensal por cliente (prestação de contas).
// Junta o que o app já sabe do mês: visitas (com duração e chamado), horas de
// cronômetro nas pendências, pendências resolvidas/abertas e, quando online,
// os atendimentos do Milvus. Sai como PDF pelo "Salvar como PDF" do navegador
// (sem biblioteca nova e sem pop-up: imprime uma área da própria página).

const RPT_MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** 'YYYY-MM' → { start, end, label } (datas locais YYYY-MM-DD). */
function rptMonthRange(ym) {
  const y = Number(String(ym).slice(0, 4));
  const m = Number(String(ym).slice(5, 7));
  const last = new Date(y, m, 0).getDate();
  const mm = String(m).padStart(2, '0');
  return { start: y + '-' + mm + '-01', end: y + '-' + mm + '-' + String(last).padStart(2, '0'), label: RPT_MONTHS[m - 1] + ' de ' + y };
}

function _rptLocalDate(iso) {
  if (!iso) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

const _RPT_SESSION_RE = /sess[ãa]o(?: registrada)?:\s*(\d+):(\d{2}):(\d{2})/i;

/**
 * Sessões de cronômetro registradas nas notas da pendência (pausa, ajuste e
 * conclusão escrevem "Sessão registrada/Tempo sessão: HH:MM:SS").
 * @returns {{ at: string, seconds: number, author: string }[]}
 */
function parseTimerSessions(notes) {
  const out = [];
  for (const n of notes || []) {
    const m = n && typeof n.text === 'string' ? n.text.match(_RPT_SESSION_RE) : null;
    if (!m) continue;
    const seconds = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    if (seconds > 0) out.push({ at: n.createdAt || '', seconds, author: n.author || '' });
  }
  return out;
}

/** Duração da visita em minutos pelo horário (null se dia inteiro/sem fim). */
function visitDurationMinutes(v) {
  if (!v || v.allDay || !v.time || !v.timeEnd) return null;
  const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
  const d = toMin(v.timeEnd) - toMin(v.time);
  return Number.isFinite(d) && d > 0 ? d : null;
}

/** "HH:MM" → minutos. */
function _rptHHMM(s) {
  const m = String(s || '').match(/^(\d+):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

/** Minutos → "3h 20min". */
function rptFormatMinutes(min) {
  const t = Math.max(0, Math.round(Number(min) || 0));
  const h = Math.floor(t / 60);
  const m = t % 60;
  if (!h) return m + 'min';
  return m ? h + 'h ' + String(m).padStart(2, '0') + 'min' : h + 'h';
}

function _rptClosed(status) {
  if (typeof isPendenciaClosed === 'function') return isPendenciaClosed(status);
  return ['concluido', 'resolvido', 'cancelado', 'fechado'].includes(status || '');
}

/**
 * Modelo puro do relatório (testável). Listas já filtradas pelo cliente.
 * @param {{ client: object, pens: object[], visits: object[], entries?: object[], atend?: object[]|null, atendTruncated?: boolean }} src
 * @param {string} ym 'YYYY-MM'
 */
function buildClientMonthReport(src, ym) {
  const r = rptMonthRange(ym);
  const inMonth = (d) => !!d && d >= r.start && d <= r.end;

  const visits = (src.visits || [])
    .filter((v) => v && inMonth(v.date) && v.status !== 'cancelada')
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.time || '').localeCompare(String(b.time || '')))
    .map((v) => ({ v, minutes: visitDurationMinutes(v) }));
  const visitsDone = visits.filter((x) => x.v.status === 'concluida');
  const visitMinutes = visitsDone.reduce((s, x) => s + (x.minutes || 0), 0);

  // Horas: lançamentos (time_entries, 048) são a fonte. Pendência sem nenhum
  // lançamento ainda (aparelho que não sincronizou o backfill) cai nas notas.
  let penSeconds = 0;
  const penTime = new Map();
  const byPen = new Map();
  for (const e of src.entries || []) {
    if (!e || !e.pendenciaId) continue;
    if (!byPen.has(e.pendenciaId)) byPen.set(e.pendenciaId, []);
    byPen.get(e.pendenciaId).push({ at: e.endedAt, seconds: Number(e.seconds) || 0 });
  }
  for (const p of src.pens || []) {
    const sessions = byPen.has(p.id) ? byPen.get(p.id) : parseTimerSessions(p.notes);
    for (const s of sessions) {
      if (!inMonth(_rptLocalDate(s.at))) continue;
      penSeconds += s.seconds;
      penTime.set(p.id, (penTime.get(p.id) || 0) + s.seconds);
    }
  }

  const resolved = (src.pens || [])
    .filter((p) => p && ['concluido', 'resolvido'].includes(p.status) && inMonth(_rptLocalDate(p.completedAt || p.updatedAt)))
    .sort((a, b) => String(a.completedAt || a.updatedAt).localeCompare(String(b.completedAt || b.updatedAt)))
    .map((p) => ({ p, seconds: penTime.get(p.id) || 0 }));
  const opened = (src.pens || []).filter((p) => p && inMonth(_rptLocalDate(p.createdAt))).length;
  const today = typeof localDateISO === 'function' ? localDateISO() : _rptLocalDate(new Date().toISOString());
  const stillOpen = (src.pens || [])
    .filter((p) => p && !_rptClosed(p.status))
    .sort((a, b) => String(a.deadline || '9999').localeCompare(String(b.deadline || '9999')))
    .map((p) => ({ p, overdue: !!(p.deadline && p.deadline < today) }));

  const atend = Array.isArray(src.atend) ? src.atend : null;
  const atendMinutes = atend ? atend.reduce((s, a) => s + _rptHHMM(a.total_horas_atendimento), 0) : 0;
  // Chamados: os abertos pelas visitas do mês + os que aparecem nos atendimentos.
  const tickets = new Map();
  for (const x of visits) {
    if (x.v.milvusChamadoCodigo) tickets.set(String(x.v.milvusChamadoCodigo), { codigo: String(x.v.milvusChamadoCodigo), assunto: x.v.motivo || 'Visita técnica', origem: 'Visita' });
  }
  for (const a of atend || []) {
    if (!a || !a.codigo) continue;
    const cur = tickets.get(String(a.codigo)) || { codigo: String(a.codigo), assunto: a.assunto || '', origem: 'Milvus', minutes: 0 };
    cur.minutes = (cur.minutes || 0) + _rptHHMM(a.total_horas_atendimento);
    if (!cur.tecnico && a.tecnico) cur.tecnico = a.tecnico;
    tickets.set(String(a.codigo), cur);
  }

  return {
    client: src.client || {},
    period: r,
    visits, visitsDone: visitsDone.length, visitMinutes,
    penMinutes: Math.round(penSeconds / 60),
    resolved, opened, stillOpen,
    atendAvailable: !!atend, atendMinutes, atendTruncated: !!src.atendTruncated,
    tickets: [...tickets.values()].sort((a, b) => Number(a.codigo) - Number(b.codigo)),
    totalMinutes: visitMinutes + Math.round(penSeconds / 60),
  };
}

// ── HTML do relatório (mesmo HTML na prévia e na impressão) ─────────────

function _rptDate(d) { return typeof formatDate === 'function' ? formatDate(d) : d; }
function _rptPenNum(p) { return typeof penDisplayNumber === 'function' ? penDisplayNumber(p) : ''; }
function _rptPenTitle(p) { return typeof getPendenciaTitulo === 'function' ? getPendenciaTitulo(p) : (p.assunto || ''); }
function _rptCut(s, n) { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; }

function renderClientReportHtml(m) {
  const e = escapeHtml;
  const kpi = (v, l) => '<div class="rpt-kpi"><b>' + v + '</b><span>' + l + '</span></div>';
  const empty = (cols, txt) => '<tr><td colspan="' + cols + '" class="rpt-none">' + txt + '</td></tr>';
  const statusLabel = (s) => (typeof VISIT_STATUS_MAP !== 'undefined' && VISIT_STATUS_MAP[s] && VISIT_STATUS_MAP[s].label) || s || '—';

  const visitRows = m.visits.map((x) => '<tr>' +
    '<td>' + e(_rptDate(x.v.date)) + '</td>' +
    '<td>' + e(x.v.operator || '—') + '</td>' +
    '<td>' + e(_rptCut(x.v.motivo, 60) || '—') + (x.v.relatorio ? '<div class="rpt-sub">' + e(_rptCut(x.v.relatorio, 180)) + '</div>' : '') + '</td>' +
    '<td class="rpt-num">' + (x.minutes ? rptFormatMinutes(x.minutes) : '—') + '</td>' +
    '<td>' + e(statusLabel(x.v.status)) + (x.v.milvusChamadoCodigo ? '<div class="rpt-sub">Chamado #' + e(String(x.v.milvusChamadoCodigo)) + '</div>' : '') + '</td>' +
    '</tr>').join('');

  const resolvedRows = m.resolved.map((x) => '<tr>' +
    '<td>' + e(_rptPenNum(x.p)) + '</td>' +
    '<td>' + e(_rptCut(_rptPenTitle(x.p), 80)) + '</td>' +
    '<td>' + e(x.p.responsible || '—') + '</td>' +
    '<td>' + e(_rptDate(_rptLocalDate(x.p.completedAt || x.p.updatedAt))) + '</td>' +
    '<td class="rpt-num">' + (x.seconds ? rptFormatMinutes(x.seconds / 60) : '—') + '</td>' +
    '</tr>').join('');

  const openRows = m.stillOpen.map((x) => '<tr>' +
    '<td>' + e(_rptPenNum(x.p)) + '</td>' +
    '<td>' + e(_rptCut(_rptPenTitle(x.p), 80)) + '</td>' +
    '<td>' + e(x.p.responsible || '—') + '</td>' +
    '<td' + (x.overdue ? ' class="rpt-over"' : '') + '>' + (x.p.deadline ? e(_rptDate(x.p.deadline)) + (x.overdue ? ' (vencida)' : '') : '—') + '</td>' +
    '</tr>').join('');

  const ticketRows = m.tickets.map((t) => '<tr>' +
    '<td>#' + e(t.codigo) + '</td>' +
    '<td>' + e(_rptCut(t.assunto, 80) || '—') + '</td>' +
    '<td>' + e(t.tecnico || '—') + '</td>' +
    '<td class="rpt-num">' + (t.minutes ? rptFormatMinutes(t.minutes) : '—') + '</td>' +
    '</tr>').join('');

  const atendNote = !m.atendAvailable
    ? '<p class="rpt-note">Horas do Milvus indisponíveis agora (sem conexão ou cliente sem integração). Os chamados abaixo vêm só das visitas.</p>'
    : (m.atendTruncated ? '<p class="rpt-note">Mostrando os primeiros 200 atendimentos do Milvus no mês.</p>' : '');

  return '<article class="rpt">' +
    '<header class="rpt-head">' +
      '<div><div class="rpt-brand">Init · Relatório mensal</div><h1>' + e(m.client.name || 'Cliente') + '</h1>' +
      '<div class="rpt-period">' + e(m.period.label.charAt(0).toUpperCase() + m.period.label.slice(1)) + ' · ' + e(_rptDate(m.period.start)) + ' a ' + e(_rptDate(m.period.end)) + '</div></div>' +
      '<div class="rpt-gen">Gerado em ' + e(new Date().toLocaleDateString('pt-BR')) + '</div>' +
    '</header>' +
    '<section class="rpt-kpis">' +
      kpi(rptFormatMinutes(m.totalMinutes), 'Horas no app (visitas + pendências)') +
      kpi(m.atendAvailable ? rptFormatMinutes(m.atendMinutes) : '—', 'Horas no Milvus') +
      kpi(m.visitsDone + (m.visits.length !== m.visitsDone ? '<small>/' + m.visits.length + '</small>' : ''), 'Visitas realizadas') +
      kpi(m.resolved.length, 'Pendências resolvidas') +
      kpi(m.stillOpen.length, 'Em aberto hoje') +
    '</section>' +
    '<p class="rpt-note">Horas no app: ' + rptFormatMinutes(m.visitMinutes) + ' em visitas concluídas (pelo horário) e ' + rptFormatMinutes(m.penMinutes) + ' de cronômetro em pendências. ' + m.opened + ' pendência' + (m.opened === 1 ? '' : 's') + ' aberta' + (m.opened === 1 ? '' : 's') + ' no mês.</p>' +
    '<h2>Visitas</h2>' +
    '<table><thead><tr><th>Data</th><th>Técnico</th><th>Motivo / relatório</th><th class="rpt-num">Duração</th><th>Situação</th></tr></thead><tbody>' + (visitRows || empty(5, 'Nenhuma visita no mês.')) + '</tbody></table>' +
    '<h2>Pendências resolvidas</h2>' +
    '<table><thead><tr><th>Nº</th><th>Assunto</th><th>Responsável</th><th>Concluída</th><th class="rpt-num">Tempo no mês</th></tr></thead><tbody>' + (resolvedRows || empty(5, 'Nenhuma pendência resolvida no mês.')) + '</tbody></table>' +
    '<h2>Chamados</h2>' + atendNote +
    '<table><thead><tr><th>Chamado</th><th>Assunto</th><th>Técnico</th><th class="rpt-num">Horas</th></tr></thead><tbody>' + (ticketRows || empty(4, 'Nenhum chamado no mês.')) + '</tbody></table>' +
    '<h2>Em aberto</h2>' +
    '<table><thead><tr><th>Nº</th><th>Assunto</th><th>Responsável</th><th>Prazo</th></tr></thead><tbody>' + (openRows || empty(4, 'Nada em aberto.')) + '</tbody></table>' +
  '</article>';
}

// ── Impressão (PDF) sem pop-up ──────────────────────────────────────────

/** Imprime só este HTML: o resto da página some no @media print. */
function printHtmlDocument(html, title) {
  if (typeof document === 'undefined') return;
  let host = document.getElementById('printDoc');
  if (!host) {
    host = document.createElement('div');
    host.id = 'printDoc';
    document.body.appendChild(host);
  }
  host.innerHTML = html;
  const prevTitle = document.title;
  // O título vira o nome sugerido do arquivo no "Salvar como PDF".
  if (title) document.title = title;
  document.body.classList.add('printing-doc');
  const done = () => {
    document.body.classList.remove('printing-doc');
    document.title = prevTitle;
    host.innerHTML = '';
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  setTimeout(() => { try { window.print(); } catch (_) { done(); } }, 50);
}

// ── Tela (modal com prévia) ─────────────────────────────────────────────

let _rptLast = null;

function _rptMonthOptions() {
  const now = new Date();
  const opts = [];
  for (let i = 0; i < 13; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    opts.push({ ym, label: RPT_MONTHS[d.getMonth()] + ' de ' + d.getFullYear() });
  }
  return opts;
}

function openClientReport(clientId) {
  const c = typeof getClientById === 'function' ? getClientById(clientId) : null;
  if (!c) return;
  // Mês passado por padrão nos primeiros dias (fechamento); senão o atual.
  const opts = _rptMonthOptions();
  const def = new Date().getDate() <= 10 ? opts[1].ym : opts[0].ym;
  openModal('Relatório mensal — ' + escapeHtml(c.name), `
    <div class="rpt-bar">
      <label class="form-label" for="rptMonth" style="margin:0">Mês</label>
      <select class="form-select" id="rptMonth" style="width:auto" onchange="loadClientReport('${escapeHtml(clientId)}')">
        ${opts.map((o) => `<option value="${o.ym}"${o.ym === def ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
      </select>
      <button type="button" class="btn btn-primary btn-sm" id="rptPrintBtn" onclick="printClientReport()" disabled>Imprimir / salvar PDF</button>
    </div>
    <div class="rpt-preview" id="rptPreview"><p class="rpt-loading">Montando o relatório…</p></div>`, 'lg');
  loadClientReport(clientId);
}

async function loadClientReport(clientId) {
  const c = typeof getClientById === 'function' ? getClientById(clientId) : null;
  const sel = document.getElementById('rptMonth');
  const box = document.getElementById('rptPreview');
  if (!c || !sel || !box) return;
  const ym = sel.value;
  const r = rptMonthRange(ym);
  const btn = document.getElementById('rptPrintBtn');
  if (btn) btn.disabled = true;
  box.innerHTML = '<p class="rpt-loading">Montando o relatório…</p>';

  const pens = (typeof getPendencias === 'function' ? getPendencias() : []).filter((p) => p && p.clientId === clientId);
  const visits = (typeof getVisits === 'function' ? getVisits() : []).filter((v) => v && v.clientId === clientId);
  const penIds = new Set(pens.map((p) => p.id));
  const entries = (typeof getTimeEntries === 'function' ? getTimeEntries() : []).filter((e) => e && penIds.has(e.pendenciaId));

  // Atendimentos do Milvus: opcional (online + cliente integrado).
  let atend = null;
  let atendTruncated = false;
  if (typeof fetchMilvusAtendimentos === 'function') {
    try {
      const res = await fetchMilvusAtendimentos({ clientId, dataInicial: r.start, dataFinal: r.end, perPage: 200 });
      atend = (res && res.lista) || [];
      atendTruncated = atend.length >= 200;
    } catch (_) { atend = null; }
  }
  // Trocou de mês/fechou enquanto buscava: descarta.
  if (!document.getElementById('rptPreview') || document.getElementById('rptMonth').value !== ym) return;

  const model = buildClientMonthReport({ client: c, pens, visits, entries, atend, atendTruncated }, ym);
  const html = renderClientReportHtml(model);
  _rptLast = { html, title: 'Relatório ' + c.name + ' ' + ym };
  box.innerHTML = html;
  if (btn) btn.disabled = false;
}

function printClientReport() {
  if (!_rptLast) return;
  printHtmlDocument(_rptLast.html, _rptLast.title);
  if (typeof addLog === 'function') { try { addLog('Gerou relatório mensal', 'Cliente', _rptLast.title.replace(/^Relatório /, ''), ''); } catch (_) {} }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { rptMonthRange, parseTimerSessions, visitDurationMinutes, rptFormatMinutes, buildClientMonthReport, renderClientReportHtml };
}
