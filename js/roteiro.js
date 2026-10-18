// roteiro.js – Roteiro do dia: as visitas de hoje em ordem, com endereço,
// atalhos para Maps/Waze e a rota completa (todas as paradas) num toque.
// Aparece na Minha fila no lugar da lista simples de visitas.

const ROTEIRO_MAX_WAYPOINTS = 9; // limite do link de rotas do Google Maps

/** Links de navegação para um endereço (puro). */
function mapsLinks(address) {
  const q = encodeURIComponent(String(address || '').trim());
  return {
    google: 'https://www.google.com/maps/search/?api=1&query=' + q,
    waze: 'https://waze.com/ul?q=' + q + '&navigate=yes',
  };
}

/**
 * Rota com várias paradas a partir da localização atual (puro). A última
 * parada é o destino; as anteriores viram waypoints (máx. 9 no link).
 * @returns {string|null}
 */
function buildRouteUrl(addresses) {
  const list = (addresses || []).map((a) => String(a || '').trim()).filter(Boolean).slice(0, ROTEIRO_MAX_WAYPOINTS + 1);
  if (!list.length) return null;
  const dest = list[list.length - 1];
  const way = list.slice(0, -1);
  return 'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + encodeURIComponent(dest) +
    (way.length ? '&waypoints=' + encodeURIComponent(way.join('|')) : '');
}

/**
 * Paradas do dia de um técnico (puro, testável): horário marcado primeiro,
 * em ordem; "dia inteiro" no fim. Concluídas ficam na lista (riscadas), fora da rota.
 * @param {(id: string) => object|null} getClient
 */
function buildRoteiro(visits, getClient, todayISO, userName) {
  const stops = (visits || [])
    .filter((v) => v && v.date === todayISO && v.status !== 'cancelada' && (v.operator || '') === (userName || ''))
    .map((v) => {
      const c = typeof getClient === 'function' ? getClient(v.clientId) : null;
      const address = String((c && c.address) || '').trim();
      return { v, client: c, address, done: v.status === 'concluida', timed: !v.allDay && !!v.time };
    })
    .sort((a, b) => (Number(b.timed) - Number(a.timed)) || String(a.v.time || '').localeCompare(String(b.v.time || '')));
  const pending = stops.filter((s) => !s.done);
  return {
    stops,
    pending: pending.length,
    missingAddress: pending.filter((s) => !s.address).length,
    routable: pending.filter((s) => s.address).length,
    routeUrl: buildRouteUrl(pending.filter((s) => s.address).map((s) => s.address)),
  };
}

function roteiroPanelHtml(visits, todayISO, userName) {
  const r = buildRoteiro(visits, typeof getClientById === 'function' ? getClientById : null, todayISO, userName);
  const head = '<div class="ov-ph"><h2 class="ov-h2">Roteiro do dia</h2>' +
    '<div class="rt-head-acts">' +
      (r.routeUrl && r.routable > 1 ? '<a class="btn btn-primary btn-sm" href="' + escapeHtml(r.routeUrl) + '" target="_blank" rel="noopener">Rota completa</a>' : '') +
      '<button class="btn btn-secondary btn-sm" onclick="openVisitForm()">+ Visita</button>' +
    '</div></div>';
  if (!r.stops.length) return '<section class="ov-panel">' + head + '<p class="fila-none">Nenhuma visita sua hoje.</p></section>';

  let n = 0;
  const rows = r.stops.map((s) => {
    const v = s.v;
    const id = escapeHtml(v.id);
    const when = s.timed ? (typeof formatVisitTimeRange === 'function' ? formatVisitTimeRange(v) : v.time) : 'Dia inteiro';
    const num = s.done ? '✓' : String(++n);
    let place;
    if (s.address) {
      const ml = mapsLinks(s.address);
      place = '<span class="rt-addr">' + escapeHtml(s.address) + '</span>' +
        (s.done ? '' : '<span class="rt-nav"><a href="' + escapeHtml(ml.google) + '" target="_blank" rel="noopener" onclick="event.stopPropagation()">Maps</a>' +
          '<a href="' + escapeHtml(ml.waze) + '" target="_blank" rel="noopener" onclick="event.stopPropagation()">Waze</a></span>');
    } else {
      place = '<button type="button" class="link-btn rt-noaddr" onclick="event.stopPropagation();viewClient(\'' + escapeHtml(v.clientId || '') + '\')">Sem endereço — adicionar</button>';
    }
    return '<li class="rt-stop' + (s.done ? ' is-done' : '') + '" onclick="openVisitDetail(\'' + id + '\')">' +
      '<span class="rt-num" aria-hidden="true">' + num + '</span>' +
      '<span class="rt-main"><span class="rt-top"><b>' + escapeHtml(v.clientName || '—') + '</b><span class="rt-when">' + escapeHtml(when) + '</span></span>' +
      (v.motivo ? '<span class="rt-why">' + escapeHtml(v.motivo) + '</span>' : '') +
      '<span class="rt-place">' + place + '</span></span></li>';
  }).join('');
  const note = r.missingAddress && r.pending > 1
    ? '<p class="rt-note">' + r.missingAddress + (r.missingAddress === 1 ? ' parada sem endereço fica' : ' paradas sem endereço ficam') + ' fora da rota.</p>'
    : '';
  return '<section class="ov-panel rt">' + head + '<ol class="rt-list">' + rows + '</ol>' + note + '</section>';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { mapsLinks, buildRouteUrl, buildRoteiro, ROTEIRO_MAX_WAYPOINTS };
}
