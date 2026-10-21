// visita-campo.js — o técnico em campo (migration 060).
// - Rota de hoje: as visitas do dia em ordem, numa rota do Google Maps
//   (endereço do cliente; sem endereço, o nome — o Maps acha muitas empresas).
// - Cheguei / Saí no detalhe da visita: grava o horário; o Saí vira
//   lançamento de horas (source 'visita') no cliente.
// - Briefing: o texto da IA que o robô gerou no "Seu dia" + o que pesa na
//   saúde do cliente.
// Eventos delegados no document (CSP).

const ROTA_MAX_PARADAS = 10;  // destino + 9 paradas (limite da URL do Maps)

/** URL de rota do Google Maps saindo de onde a pessoa está. */
function rotaMapsUrl(paradas) {
  const p = (paradas || []).map((s) => String(s || '').trim()).filter(Boolean).slice(0, ROTA_MAX_PARADAS);
  if (!p.length) return null;
  const dest = p[p.length - 1];
  const meio = p.slice(0, -1);
  return 'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + encodeURIComponent(dest)
    + (meio.length ? '&waypoints=' + encodeURIComponent(meio.join('|')) : '');
}

/** Onde é a visita: endereço do cliente, ou o nome dele. */
function visitaParada(v) {
  const c = v && v.clientId && typeof getClientById === 'function' ? getClientById(v.clientId) : null;
  return (c && String(c.address || '').trim()) || (c && c.name) || (v && v.clientName) || '';
}

function _campoMinhasVisitasHoje() {
  const hoje = typeof localDateISO === 'function' ? localDateISO() : new Date().toISOString().slice(0, 10);
  const eu = ((typeof getUser === 'function' && getUser()) || {}).name || '';
  return (typeof getVisits === 'function' ? getVisits() : [])
    .filter((v) => v.date === hoje && v.operator === eu && v.status !== 'cancelada' && v.status !== 'concluida')
    .sort((a, b) => (a.allDay ? '' : String(a.time || '')).localeCompare(b.allDay ? '' : String(b.time || '')));
}

function abrirRotaDeHoje() {
  const vis = _campoMinhasVisitasHoje();
  const url = rotaMapsUrl(vis.map(visitaParada));
  if (!url) { showToast('Você não tem visitas para hoje.', 'info'); return; }
  if (vis.some((v) => { const c = getClientById(v.clientId); return !c || !String(c.address || '').trim(); })) {
    showToast('Algum cliente está sem endereço: a rota usa o nome dele. Preencha o endereço na ficha para acertar.', 'warning');
  }
  window.open(url, '_blank', 'noopener');
}

// ── Cheguei / Saí ───────────────────────────────────────────────────────────

const _hhmm = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
function _duracao(seg) {
  const m = Math.round(seg / 60);
  return m < 60 ? m + ' min' : Math.floor(m / 60) + 'h' + String(m % 60).padStart(2, '0');
}

/** Bloco do detalhe da visita: presença + briefing. */
function visitaCampoHtml(v) {
  if (!v || v.status === 'cancelada') return '';
  const id = escapeHtml(v.id);
  let presenca;
  if (!v.checkinAt) {
    presenca = v.status === 'concluida' ? '' : `<button type="button" class="btn btn-primary btn-sm" data-campo-checkin="${id}">📍 Cheguei</button>`;
  } else if (!v.checkoutAt) {
    presenca = `<span class="campo-st">Chegou às <b>${_hhmm(v.checkinAt)}</b></span> <button type="button" class="btn btn-secondary btn-sm" data-campo-checkout="${id}">🚪 Saí</button>`;
  } else {
    const seg = (Date.parse(v.checkoutAt) - Date.parse(v.checkinAt)) / 1000;
    presenca = `<span class="campo-st">No cliente das <b>${_hhmm(v.checkinAt)}</b> às <b>${_hhmm(v.checkoutAt)}</b> (${_duracao(seg)}, lançadas nas horas)</span>`;
  }
  const rota = v.status !== 'concluida' && visitaParada(v)
    ? `<a class="btn btn-secondary btn-sm" href="${escapeHtml(rotaMapsUrl([visitaParada(v)]))}" target="_blank" rel="noopener">🗺️ Como chegar</a>` : '';

  const health = v.clientId && typeof getHealthForClient === 'function' && typeof _getPendenciasList === 'function'
    ? getHealthForClient(_getPendenciasList(), v.clientId, localDateISO()) : null;
  const atencao = health && health.motivos && health.motivos.length
    ? `<div class="campo-atencao">⚠️ No cliente: ${health.motivos.map(escapeHtml).join(' · ')}</div>` : '';
  const ia = v.briefingIa ? `<div class="campo-ia">💡 ${escapeHtml(v.briefingIa).replace(/\n/g, '<br>')}</div>` : '';
  if (!presenca && !rota && !atencao && !ia) return '';
  return `<div class="form-group campo-box">
      ${presenca || rota ? `<div class="campo-acts">${presenca}${rota}</div>` : ''}
      ${ia || atencao ? `<div class="campo-brief"><label class="form-label">Briefing</label>${ia}${atencao}</div>` : ''}
    </div>`;
}

function _campoCheckin(id) {
  const v = getVisitById(id);
  if (!v || v.checkinAt) return;
  saveVisit({ ...v, checkinAt: new Date().toISOString(), status: v.status === 'agendada' ? 'em_andamento' : v.status });
  showToast('Chegada registrada.', 'success');
  openVisitDetail(id);
}

function _campoCheckout(id) {
  const v = getVisitById(id);
  if (!v || !v.checkinAt || v.checkoutAt) return;
  const agora = new Date();
  const seg = Math.round((agora.getTime() - Date.parse(v.checkinAt)) / 1000);
  if (seg <= 0) return;
  if (seg > 12 * 3600 && !window.confirm(`A chegada foi há ${_duracao(seg)}. Registrar a saída assim mesmo?`)) return;
  saveVisit({ ...v, checkoutAt: agora.toISOString() });
  if (typeof saveTimeEntry === 'function') {
    saveTimeEntry({
      clientId: v.clientId || null,
      operatorId: v.operatorId || (typeof _operatorIdByName === 'function' ? _operatorIdByName(v.operator) : null),
      operatorName: v.operator || '',
      startedAt: v.checkinAt, endedAt: agora.toISOString(), seconds: seg, source: 'visita',
      note: typeof visitDisplayTitle === 'function' ? visitDisplayTitle(v) : 'Visita',
      team: v.team || 'init',
    });
  }
  showToast(`Saída registrada: ${_duracao(seg)} lançadas nas horas.`, 'success');
  openVisitDetail(id);
}

if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('click', (e) => {
    const t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    if (t.closest('[data-campo-rota]')) { abrirRotaDeHoje(); return; }
    const ci = t.closest('[data-campo-checkin]');
    if (ci) { _campoCheckin(ci.dataset.campoCheckin); return; }
    const co = t.closest('[data-campo-checkout]');
    if (co) _campoCheckout(co.dataset.campoCheckout);
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { rotaMapsUrl };
}
