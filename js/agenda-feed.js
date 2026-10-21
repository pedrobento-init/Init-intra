// agenda-feed.js — "Agenda no celular": link ICS pessoal para assinar no
// Google Agenda, Outlook ou iPhone (Edge Function agenda-ics, migration 046).
// Google Agenda nos dois sentidos: robô Apps Script + Edge Function
// google-agenda (migration 057). Aqui só o estado e como liberar a agenda.

async function _renderGoogleAgendaBox() {
  const box = document.getElementById('gcalBox');
  if (!box) return;
  let st;
  try {
    const { data, error } = await supabaseClient.rpc('my_google_agenda_status');
    if (error) throw error;
    st = data || {};
  } catch (_) { box.hidden = true; return; }
  if (!st.runner_email) { box.hidden = true; return; }  // robô não instalado
  const robot = escapeHtml(st.runner_email);
  const parado = !st.runner_last_run || (Date.now() - new Date(st.runner_last_run).getTime()) > 15 * 60000;
  const aviso = parado ? '<p class="gcal-err">A sincronização com o Google está parada. Avise o administrador.</p>' : '';
  if (!st.my_email) {
    box.innerHTML = `<h4>Google Agenda</h4>${aviso}
      <p class="feed-lead">Seu cadastro está sem e-mail. Peça ao administrador para preencher o e-mail da sua conta Google em Operadores.</p>`;
  } else if (st.ok) {
    box.innerHTML = `<h4>Google Agenda — sincronizando</h4>${aviso}
      <p class="feed-lead">Suas visitas aparecem na agenda <b>${escapeHtml(st.my_email)}</b> em até 1 minuto. Mudou data ou horário lá? A visita muda aqui. Apagou o evento? A visita agendada é cancelada.</p>`;
  } else {
    box.innerHTML = `<h4>Google Agenda (cria e edita na sua agenda)</h4>${aviso}
      <p class="feed-lead">Para as visitas virarem eventos na sua agenda <b>${escapeHtml(st.my_email)}</b> (e o que você mudar lá voltar para cá), compartilhe a agenda uma vez:</p>
      <ol class="feed-steps">
        <li>No Google Agenda (computador): <b>Configurações</b> → sua agenda → <b>Compartilhar com pessoas específicas</b>.</li>
        <li>Adicione <b>${robot}</b> com a permissão <b>Fazer alterações nos eventos</b>.</li>
        <li>Em até 1 minuto suas visitas começam a aparecer.</li>
      </ol>
      ${st.error ? `<p class="gcal-err">${escapeHtml(st.error)}</p>` : ''}
      <div class="feed-opts">
        <button type="button" class="btn btn-secondary btn-sm" data-gcal="copy">Copiar ${robot}</button>
        <a class="btn btn-primary btn-sm" href="https://calendar.google.com/calendar/r/settings" target="_blank" rel="noopener">Abrir configurações do Google Agenda</a>
      </div>`;
    box.querySelector('[data-gcal="copy"]').addEventListener('click', () => {
      navigator.clipboard.writeText(st.runner_email).then(() => showToast('E-mail copiado.', 'success'));
    });
  }
  box.hidden = false;
}

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
    <div class="gcal-box" id="gcalBox" hidden></div>
    <p class="feed-lead">Ou só para ver (sem conectar conta): suas visitas aparecem no app de agenda do celular e se atualizam sozinhas (o Google pode levar algumas horas para buscar mudanças).</p>
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
  _renderGoogleAgendaBox();
}
