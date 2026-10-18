// agenda-feed.js — "Agenda no celular": link ICS pessoal para assinar no
// Google Agenda, Outlook ou iPhone (Edge Function agenda-ics, migration 046).

function _agendaFeedUrl(token) {
  const base = (typeof SUPABASE_URL !== 'undefined' && SUPABASE_URL) ? String(SUPABASE_URL).replace(/\/$/, '') : '';
  return base + '/functions/v1/agenda-ics?t=' + encodeURIComponent(token);
}

async function openCalendarFeed(rotate) {
  const online = typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive === true;
  if (!online) { showToast('O link da agenda precisa de conexão com o servidor.', 'warning'); return; }
  if (rotate && !window.confirm('Gerar um link novo? O link atual para de funcionar em todos os aparelhos onde foi adicionado.')) return;
  let token;
  try {
    const { data, error } = await supabaseClient.rpc('my_calendar_feed_token', { p_rotate: !!rotate });
    if (error || !data) throw error || new Error('vazio');
    token = String(data);
  } catch (_) {
    showToast('Não foi possível gerar o link da agenda (o banco já tem a migration 046?).', 'error');
    return;
  }
  const url = _agendaFeedUrl(token);
  const webcal = url.replace(/^https?:/, 'webcal:');
  const google = 'https://calendar.google.com/calendar/r?cid=' + encodeURIComponent(webcal);
  openModal('Agenda no celular', `
    <p class="feed-lead">Suas visitas aparecem no app de agenda do celular e se atualizam sozinhas (o Google pode levar algumas horas para buscar mudanças).</p>
    <div class="feed-url"><input class="form-input" id="feedUrl" readonly value="${escapeHtml(url)}" onclick="this.select()" />
      <button type="button" class="btn btn-secondary btn-sm" onclick="navigator.clipboard.writeText(document.getElementById('feedUrl').value).then(()=>showToast('Link copiado.','success'))">Copiar</button></div>
    <div class="feed-opts">
      <a class="btn btn-primary btn-sm" href="${escapeHtml(google)}" target="_blank" rel="noopener">Adicionar ao Google Agenda</a>
      <a class="btn btn-secondary btn-sm" href="${escapeHtml(webcal)}">iPhone / Mac / Outlook</a>
    </div>
    <ul class="feed-steps">
      <li><b>Outlook:</b> Adicionar calendário → Da internet → cole o link.</li>
      <li><b>Android sem Google Agenda:</b> use o link no app de agenda que aceitar "assinatura por URL".</li>
    </ul>
    <p class="feed-warn">Este link é pessoal: quem tiver o link vê suas visitas (cliente e motivo). Se ele vazar, gere outro.</p>
    <div class="form-actions"><button type="button" class="btn btn-secondary" onclick="openCalendarFeed(true)">Gerar link novo</button><button type="button" class="btn btn-primary" onclick="closeModal()">Fechar</button></div>`);
}
