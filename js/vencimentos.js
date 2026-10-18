// vencimentos.js – Agenda de renovações: licenças, certificados SSL, domínios,
// garantias, assinaturas de backup e contratos. Avisa 30 e 7 dias antes e no
// dia (faixa "Com você", selo no menu e e-mail ao responsável + admins).

const VENC_TIPOS = {
  licenca: 'Licença',
  ssl: 'Certificado SSL',
  dominio: 'Domínio',
  garantia: 'Garantia',
  backup: 'Assinatura de backup',
  contrato: 'Contrato',
  outro: 'Outro',
};
const VENC_AVISOS = [30, 7, 0];

function _vencDays(fromISO, toISO) {
  const a = Date.UTC(+fromISO.slice(0, 4), +fromISO.slice(5, 7) - 1, +fromISO.slice(8, 10));
  const b = Date.UTC(+toISO.slice(0, 4), +toISO.slice(5, 7) - 1, +toISO.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

/** Dias até vencer (negativo = vencido). */
function vencDaysLeft(v, todayISO) {
  return _vencDays(todayISO, String(v.dataVencimento || '').slice(0, 10));
}

/** Faixa: vencido | semana (≤7) | mes (≤30) | depois. */
function vencBand(days) {
  if (days < 0) return 'vencido';
  if (days <= 7) return 'semana';
  if (days <= 30) return 'mes';
  return 'depois';
}

/**
 * Qual aviso por e-mail cabe agora (puro): o mais urgente ainda não enviado.
 * Entrando direto na janela de 7 dias, o de 30 não sai atrasado — some junto.
 * @returns {{ aviso: string, marcar: string[] }|null}
 */
function vencAvisoDevido(v, todayISO) {
  if (!v || v.status === 'encerrado' || !v.dataVencimento) return null;
  const days = vencDaysLeft(v, todayISO);
  if (days < -7) return null; // vencido há mais de uma semana: não insiste por e-mail
  const sent = new Set((v.avisos || []).map(String));
  const due = VENC_AVISOS.filter((d) => days <= d).map(String); // ex.: 5 dias → ['30','7']
  if (!due.length) return null;
  const aviso = due[due.length - 1]; // o mais urgente
  if (sent.has(aviso)) return null;
  return { aviso, marcar: due.filter((d) => !sent.has(d)) };
}

/** Data + n meses (dia ajustado ao fim do mês). */
function vencAddMonths(iso, n) {
  const y = +iso.slice(0, 4), m = +iso.slice(5, 7) - 1, d = +iso.slice(8, 10);
  const last = new Date(Date.UTC(y, m + n + 1, 0)).getUTCDate();
  const out = new Date(Date.UTC(y, m + n, Math.min(d, last)));
  return out.toISOString().slice(0, 10);
}

/**
 * Modelo da tela (puro): filtra, separa por faixa e ordena por data.
 * @param {{ q?: string, tipo?: string, encerrados?: boolean }} [f]
 */
function buildVencimentosModel(list, todayISO, f) {
  const q = String((f && f.q) || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const tipo = (f && f.tipo) || '';
  const groups = { vencido: [], semana: [], mes: [], depois: [], encerrado: [] };
  for (const v of list || []) {
    if (!v) continue;
    if (tipo && v.tipo !== tipo) continue;
    if (q) {
      const hay = [v.descricao, v.clientName, v.responsavel, VENC_TIPOS[v.tipo]].join(' ').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      if (!hay.includes(q)) continue;
    }
    if (v.status === 'encerrado') { if (f && f.encerrados) groups.encerrado.push({ v, days: null }); continue; }
    const days = vencDaysLeft(v, todayISO);
    groups[vencBand(days)].push({ v, days });
  }
  for (const k of Object.keys(groups)) groups[k].sort((a, b) => String(a.v.dataVencimento).localeCompare(String(b.v.dataVencimento)));
  return { groups, counts: { vencido: groups.vencido.length, semana: groups.semana.length, mes: groups.mes.length, depois: groups.depois.length } };
}

/** Quantos vencem em até 7 dias (ou já venceram), opcionalmente só de um responsável. */
function countVencimentosUrgentes(list, todayISO, responsavel) {
  return (list || []).filter((v) => v && v.status !== 'encerrado' && v.dataVencimento &&
    (!responsavel || (v.responsavel || '') === responsavel) && vencDaysLeft(v, todayISO) <= 7).length;
}

// ── Tela ─────────────────────────────────────────────────────────────────

let _vencFilter = { q: '', tipo: '', encerrados: false };

function _vencToday() { return typeof localDateISO === 'function' ? localDateISO() : new Date().toISOString().slice(0, 10); }

function _vencWhen(days) {
  if (days === null) return '';
  if (days < 0) return '<span class="fila-due is-over">' + (days === -1 ? 'Venceu ontem' : 'Venceu há ' + (-days) + ' dias') + '</span>';
  if (days === 0) return '<span class="fila-due is-over">Vence hoje</span>';
  if (days <= 7) return '<span class="fila-due is-today">' + (days === 1 ? 'Amanhã' : 'Em ' + days + ' dias') + '</span>';
  return '<span class="fila-due">Em ' + days + ' dias</span>';
}

function _vencRow(it) {
  const v = it.v;
  const id = escapeHtml(v.id);
  const meta = [v.clientName || 'Interno', v.responsavel ? 'Resp.: ' + v.responsavel : '', v.renovacaoAuto ? 'renovação automática' : ''].filter(Boolean).join(' · ');
  return '<li class="venc-row">' +
    '<span class="venc-tipo venc-tipo--' + escapeHtml(v.tipo || 'outro') + '">' + escapeHtml(VENC_TIPOS[v.tipo] || 'Outro') + '</span>' +
    '<button type="button" class="venc-main" onclick="openVencimentoForm(\'' + id + '\')">' +
      '<b>' + escapeHtml(v.descricao || '—') + '</b><span>' + escapeHtml(meta) + '</span></button>' +
    '<span class="venc-date"><b>' + escapeHtml(typeof formatDate === 'function' ? formatDate(v.dataVencimento) : v.dataVencimento) + '</b>' + _vencWhen(it.days) + '</span>' +
    (v.status === 'encerrado' ? '<span></span>' : '<button type="button" class="btn btn-secondary btn-sm" onclick="openRenovarVencimento(\'' + id + '\')">Renovar</button>') +
  '</li>';
}

function renderVencimentos() {
  document.getElementById('pageTitle').textContent = 'Vencimentos';
  if (typeof setTopbarAction === 'function') {
    setTopbarAction('Novo vencimento', '<svg class="topbar-action-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>');
    window._topbarAction = () => openVencimentoForm();
  }
  const area = document.getElementById('contentArea');
  if (!document.getElementById('vencList')) {
    area.innerHTML =
      '<div class="ov-wrap venc">' +
        '<div class="search-bar page-toolbar">' +
          '<div class="search-input-wrap pt-search"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
          '<input class="form-input" id="vencSearch" placeholder="Buscar descrição, cliente ou responsável" value="' + escapeHtml(_vencFilter.q) + '" oninput="_vencFilter.q=this.value;renderVencimentos()" /></div>' +
          '<select class="form-select pt-filter" id="vencTipo" onchange="_vencFilter.tipo=this.value;renderVencimentos()"><option value="">Todos os tipos</option>' +
            Object.keys(VENC_TIPOS).map((k) => '<option value="' + k + '"' + (_vencFilter.tipo === k ? ' selected' : '') + '>' + VENC_TIPOS[k] + '</option>').join('') + '</select>' +
          '<label class="pz-toggle pt-filter"><input type="checkbox"' + (_vencFilter.encerrados ? ' checked' : '') + ' onchange="_vencFilter.encerrados=this.checked;renderVencimentos()"> Encerrados</label>' +
        '</div>' +
        '<div id="vencKpis"></div><div id="vencList"></div>' +
      '</div>';
  }
  const m = buildVencimentosModel(typeof getMyVencimentos === 'function' ? getMyVencimentos() : [], _vencToday(), _vencFilter);
  const c = m.counts;
  document.getElementById('vencKpis').innerHTML =
    '<div class="ov-kpis venc-kpis">' +
      '<div class="ov-k ov-k-static' + (c.vencido ? ' red' : '') + '"><b>' + c.vencido + '</b><span>Vencidos</span></div>' +
      '<div class="ov-k ov-k-static' + (c.semana ? ' amber' : '') + '"><b>' + c.semana + '</b><span>Em até 7 dias</span></div>' +
      '<div class="ov-k ov-k-static"><b>' + c.mes + '</b><span>Em até 30 dias</span></div>' +
      '<div class="ov-k ov-k-static"><b>' + c.depois + '</b><span>Depois</span></div>' +
    '</div>';
  const sec = (key, title) => m.groups[key].length
    ? '<section class="card ov-panel"><div class="ov-ph"><h2 class="ov-h2">' + title + '</h2><span class="ov-muted">' + m.groups[key].length + '</span></div><ul class="venc-list">' + m.groups[key].map(_vencRow).join('') + '</ul></section>'
    : '';
  const html = sec('vencido', 'Vencidos') + sec('semana', 'Próximos 7 dias') + sec('mes', 'Próximos 30 dias') + sec('depois', 'Mais adiante') + sec('encerrado', 'Encerrados');
  document.getElementById('vencList').innerHTML = html ||
    '<div class="empty-state"><p>' + (_vencFilter.q || _vencFilter.tipo ? 'Nada encontrado com esses filtros.' : 'Nenhum vencimento cadastrado. Cadastre licenças, certificados, domínios e garantias para ser avisado antes.') + '</p>' +
    '<button class="btn btn-primary btn-sm" onclick="openVencimentoForm()">+ Novo vencimento</button></div>';
}

function openVencimentoForm(id, preClientId) {
  const v = id ? (getVencimentoById(id) || {}) : { clientId: preClientId || '', tipo: 'licenca' };
  const clients = typeof getMyClients === 'function' ? getMyClients() : [];
  const ops = typeof getOperatorNames === 'function' ? getOperatorNames() : [];
  const esc = (x) => escapeHtml(x == null ? '' : String(x));
  openModal(id ? 'Editar vencimento' : 'Novo vencimento', `
    <form id="vencForm" onsubmit="submitVencimentoForm(event, '${esc(id || '')}')">
      <div class="form-row">
        <div class="form-group"><label class="form-label">Tipo</label><select class="form-select" name="tipo">${Object.keys(VENC_TIPOS).map((k) => `<option value="${k}"${v.tipo === k ? ' selected' : ''}>${VENC_TIPOS[k]}</option>`).join('')}</select></div>
        <div class="form-group"><label class="form-label">Vence em *</label><input type="date" class="form-input" name="dataVencimento" value="${esc(v.dataVencimento)}" required /></div>
      </div>
      <div class="form-group"><label class="form-label">Descrição *</label><input class="form-input" name="descricao" value="${esc(v.descricao)}" placeholder="Ex.: Microsoft 365 Business (20 licenças), SSL loja.cliente.com.br" required /></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Cliente</label><select class="form-select" name="clientId"><option value="">Interno (Init)</option>${clients.map((c) => `<option value="${esc(c.id)}"${v.clientId === c.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
        <div class="form-group"><label class="form-label">Responsável</label><select class="form-select" name="responsavel"><option value="">—</option>${ops.map((n) => `<option${v.responsavel === n ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
      </div>
      <label class="pz-toggle" style="margin:4px 0 12px"><input type="checkbox" name="renovacaoAuto"${v.renovacaoAuto ? ' checked' : ''}> Renovação automática (só lembrar de conferir)</label>
      <div class="form-group"><label class="form-label">Observações</label><textarea class="form-textarea" name="observacoes" rows="2">${esc(v.observacoes)}</textarea></div>
      ${(v.historico || []).length ? `<div class="venc-hist"><b>Renovações anteriores</b>${v.historico.slice().reverse().map((h) => `<span>Até ${esc(formatDate(h.ate))} · renovado em ${esc(formatDate(String(h.em || '').slice(0, 10)))}${h.por ? ' por ' + esc(h.por) : ''}</span>`).join('')}</div>` : ''}
      <div class="form-actions">
        ${id ? `<button type="button" class="btn btn-secondary" style="margin-right:auto" onclick="toggleEncerrarVencimento('${esc(id)}')">${v.status === 'encerrado' ? 'Reativar' : 'Encerrar (não renovar)'}</button>` : ''}
        ${id && (typeof canDelete !== 'function' || canDelete()) ? `<button type="button" class="btn btn-danger" onclick="if(confirm('Excluir este vencimento?')){deleteVencimento('${esc(id)}');closeModal();renderVencimentos();}">Excluir</button>` : ''}
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn-primary">Salvar</button>
      </div>
    </form>`);
}

function submitVencimentoForm(e, id) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const data = {
    tipo: fd.get('tipo') || 'outro',
    dataVencimento: fd.get('dataVencimento'),
    descricao: String(fd.get('descricao') || '').trim(),
    clientId: fd.get('clientId') || null,
    responsavel: fd.get('responsavel') || '',
    renovacaoAuto: fd.get('renovacaoAuto') === 'on',
    observacoes: String(fd.get('observacoes') || '').trim(),
  };
  if (!data.descricao || !data.dataVencimento) { showToast('Preencha a descrição e a data.', 'error'); return; }
  if (id) {
    const cur = getVencimentoById(id);
    data.id = id;
    // Mudou a data: os avisos recomeçam.
    if (cur && cur.dataVencimento !== data.dataVencimento) data.avisos = [];
  }
  saveVencimento(data);
  closeModal();
  showToast(id ? 'Vencimento atualizado.' : 'Vencimento cadastrado.', 'success');
  if ((window.location.hash || '').replace('#', '') === 'vencimentos') renderVencimentos();
}

function toggleEncerrarVencimento(id) {
  const v = getVencimentoById(id);
  if (!v) return;
  saveVencimento({ id, status: v.status === 'encerrado' ? 'ativo' : 'encerrado' });
  closeModal();
  renderVencimentos();
}

function openRenovarVencimento(id) {
  const v = getVencimentoById(id);
  if (!v) return;
  const base = v.dataVencimento || _vencToday();
  openModal('Renovar — ' + escapeHtml(v.descricao || ''), `
    <p style="margin:0 0 10px;font-size:13px;color:var(--ds-muted)">Vencia em <b>${escapeHtml(formatDate(base))}</b>. Até quando foi renovado?</p>
    <div class="venc-quick">
      <button type="button" class="vis-chip" onclick="document.getElementById('vencNova').value='${vencAddMonths(base, 1)}'">+1 mês</button>
      <button type="button" class="vis-chip" onclick="document.getElementById('vencNova').value='${vencAddMonths(base, 3)}'">+3 meses</button>
      <button type="button" class="vis-chip" onclick="document.getElementById('vencNova').value='${vencAddMonths(base, 12)}'">+1 ano</button>
      <button type="button" class="vis-chip" onclick="document.getElementById('vencNova').value='${vencAddMonths(base, 24)}'">+2 anos</button>
    </div>
    <div class="form-group"><label class="form-label">Novo vencimento</label><input type="date" class="form-input" id="vencNova" value="${vencAddMonths(base, 12)}" /></div>
    <div class="form-actions"><button type="button" class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
      <button type="button" class="btn btn-primary" onclick="confirmRenovarVencimento('${escapeHtml(id)}')">Renovar</button></div>`, 'sm');
}

function confirmRenovarVencimento(id) {
  const v = getVencimentoById(id);
  const nova = (document.getElementById('vencNova') || {}).value;
  if (!v || !nova) return;
  if (nova <= v.dataVencimento) { showToast('A nova data precisa ser depois da atual.', 'error'); return; }
  const me = (typeof getUser === 'function' && getUser() && getUser().name) || '';
  saveVencimento({
    id,
    dataVencimento: nova,
    avisos: [],
    historico: [...(v.historico || []), { ate: v.dataVencimento, em: new Date().toISOString(), por: me }],
  });
  if (typeof addLog === 'function') addLog('Renovou', 'Vencimento', id, (v.descricao || '') + ' até ' + nova);
  closeModal();
  showToast('Renovado até ' + formatDate(nova) + '.', 'success');
  renderVencimentos();
}

// ── Avisos por e-mail (30 / 7 / no dia) ─────────────────────────────────

function _vencEmail(v, days) {
  const quando = days < 0 ? 'VENCIDO há ' + (-days) + (days === -1 ? ' dia' : ' dias') : days === 0 ? 'vence HOJE' : 'vence em ' + days + ' dias';
  const body = '<h2 style="margin:0 0 8px;font-size:18px;color:#1e293b">' + escapeHtml(v.descricao || '') + '</h2>' +
    '<p style="margin:0 0 12px;font-size:14px;color:#475569">' + escapeHtml(VENC_TIPOS[v.tipo] || 'Vencimento') + ' · ' + escapeHtml(v.clientName || 'Interno') + '</p>' +
    '<p style="font-size:20px;font-weight:800;color:' + (days <= 7 ? '#dc2626' : '#1a56db') + ';margin:0 0 6px">' + quando + '</p>' +
    '<p style="font-size:13px;color:#64748b;margin:0 0 16px">Data: ' + escapeHtml(formatDate(v.dataVencimento)) + (v.renovacaoAuto ? ' · renovação automática (confira se renovou)' : '') + '</p>' +
    '<a href="' + window.location.origin + window.location.pathname + '#vencimentos" style="display:inline-block;background:#1a56db;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600">Ver no Init Intra →</a>';
  return { subject: '[Init Intra] ⏰ ' + (VENC_TIPOS[v.tipo] || 'Vencimento') + ' ' + quando + ': ' + (v.descricao || ''), html: typeof emailBody === 'function' ? emailBody(body) : body };
}

/** Manda os avisos devidos (uma vez por aviso, marcado no próprio registro). */
function checkVencimentoReminders() {
  try {
    if (typeof getSession === 'function' && !getSession()) return;
    if (typeof isSupabaseConnected !== 'function' || !isSupabaseConnected()) return; // marca precisa sincronizar
    // Só com dados frescos: aparelho com cópia velha não reenvia aviso já dado por outro.
    const syncedAt = typeof _getLastSyncAt === 'function' ? Date.parse(_getLastSyncAt('vencimentos') || '') : NaN;
    if (!(Date.now() - syncedAt < 10 * 60 * 1000)) return;
    if (typeof getNotifPrefs === 'function' && getNotifPrefs().onDeadlineReminder === false) return;
    if (typeof sendEmailNotification !== 'function' || typeof collectRecipients !== 'function') return;
    const today = _vencToday();
    for (const v of (typeof getMyVencimentos === 'function' ? getMyVencimentos() : [])) {
      const due = vencAvisoDevido(v, today);
      if (!due) continue;
      const to = collectRecipients(v.responsavel || '', true);
      // Marca antes de enviar: outro aparelho que sincronize no meio não repete.
      saveVencimento({ id: v.id, avisos: [...new Set([...(v.avisos || []).map(String), ...due.marcar])] }, { silent: true });
      if (!to.length) continue;
      const mail = _vencEmail(v, vencDaysLeft(v, today));
      sendEmailNotification({ to, subject: mail.subject, html: mail.html });
    }
  } catch (_) {}
}

function updateVencimentosBadge() {
  const el = document.getElementById('badge-vencimentos');
  if (!el) return;
  const n = countVencimentosUrgentes(typeof getMyVencimentos === 'function' ? getMyVencimentos() : [], _vencToday());
  el.textContent = n;
  el.classList.toggle('hidden', n === 0);
}

if (typeof window !== 'undefined' && typeof onDataChanged === 'function' && !window._vencAutoRefresh) {
  window._vencAutoRefresh = true;
  let _vencCheckTimer = null;
  onDataChanged('vencimentos', function () {
    try { updateVencimentosBadge(); } catch (_) {}
    try { if (typeof renderAlertStrip === 'function') renderAlertStrip(); } catch (_) {}
    // Chegou dado do servidor: confere avisos (debounce; a marca evita repetição).
    if (_vencCheckTimer) clearTimeout(_vencCheckTimer);
    _vencCheckTimer = setTimeout(checkVencimentoReminders, 5000);
  });
  window.addEventListener('load', () => setTimeout(checkVencimentoReminders, 15000));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { VENC_TIPOS, vencDaysLeft, vencBand, vencAvisoDevido, vencAddMonths, buildVencimentosModel, countVencimentosUrgentes };
}
