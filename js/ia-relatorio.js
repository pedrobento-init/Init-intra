// ia-relatorio.js — "Escrever com IA" no relatório da visita.
// O técnico joga tópicos soltos no campo; a Edge Function `ia-relatorio`
// devolve o texto organizado para o cliente. Sempre substitui só o campo
// (nada é salvo) e dá para desfazer.

const _iaUndo = {};

function iaReportAvailable() {
  try {
    return typeof isSupabaseConnected === 'function' && isSupabaseConnected() &&
      typeof window !== 'undefined' && window._supabaseAuthActive === true && navigator.onLine !== false;
  } catch (_) { return false; }
}

function iaReportButtonHtml(textareaId, visitId) {
  if (!iaReportAvailable()) return '';
  return '<div class="ia-bar" id="iaBar_' + escapeHtml(textareaId) + '">' +
    '<button type="button" class="btn btn-secondary btn-sm ia-btn" onclick="iaWriteReport(\'' + escapeHtml(textareaId) + '\',\'' + escapeHtml(visitId) + '\',this)">✨ Escrever com IA</button>' +
    '<span class="ia-hint">Escreva tópicos soltos e a IA organiza para o cliente. Revise antes de salvar; não coloque senhas.</span>' +
  '</div>';
}

async function iaWriteReport(textareaId, visitId, btn) {
  const ta = document.getElementById(textareaId);
  if (!ta) return;
  const notas = String(ta.value || '').trim();
  if (notas.length < 10) { showToast('Escreva primeiro alguns tópicos do que foi feito.', 'warning'); ta.focus(); return; }
  if (!iaReportAvailable()) { showToast('A IA precisa de conexão.', 'warning'); return; }
  const v = typeof getVisitById === 'function' ? getVisitById(visitId) : null;
  const checklist = v && Array.isArray(v.checklist) ? v.checklist.filter((i) => i && i.done).map((i) => i.text || '') : [];
  const label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Escrevendo…'; }
  ta.setAttribute('aria-busy', 'true');
  try {
    const { data, error } = await supabaseClient.functions.invoke('ia-relatorio', {
      body: { notas, cliente: v ? v.clientName : '', motivo: v ? v.motivo : '', checklist },
    });
    if (error || !data || !data.relatorio) {
      let msg = (data && data.error) || '';
      try { if (!msg && error && error.context && typeof error.context.json === 'function') msg = (await error.context.json()).error || ''; } catch (_) {}
      throw new Error(msg || 'Não foi possível gerar o relatório agora.');
    }
    _iaUndo[textareaId] = ta.value;
    ta.value = data.relatorio;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    const bar = document.getElementById('iaBar_' + textareaId);
    if (bar && !bar.querySelector('.ia-undo')) {
      const u = document.createElement('button');
      u.type = 'button';
      u.className = 'link-btn ia-undo';
      u.textContent = 'Desfazer';
      u.addEventListener('click', () => {
        if (_iaUndo[textareaId] == null) return;
        ta.value = _iaUndo[textareaId];
        delete _iaUndo[textareaId];
        u.remove();
      });
      bar.appendChild(u);
    }
    showToast(data.truncado ? 'Relatório gerado (cortado no fim — revise).' : 'Relatório gerado. Revise antes de salvar.', data.truncado ? 'warning' : 'success');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = label; }
    ta.removeAttribute('aria-busy');
  }
}
