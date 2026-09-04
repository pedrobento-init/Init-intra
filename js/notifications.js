// notifications.js – Sistema de Notificações por E-mail
// Usa Supabase Edge Function + Resend como serviço de e-mail

const EMAIL_CONFIG = {
  edgeFunctionUrl: SUPABASE_URL
    ? `${SUPABASE_URL}/functions/v1/send-email`
    : '',
  fromName: 'Init Intra',
  fromEmail: 'notificacoes@initnet.com.br',
  enabled: true,
};

// ── Preferências de Notificação (localStorage) ──
const NOTIF_PREFS_KEY = 'intra_notif_prefs';

function getNotifPrefs() {
  try {
    return JSON.parse(localStorage.getItem(NOTIF_PREFS_KEY)) || {
      onPendenciaCreate: true,
      onPendenciaUpdate: true,
      onPendenciaNote: true,
      onDeadlineReminder: true,
      reminderDaysBefore: 2,
    };
  } catch {
    return {
      onPendenciaCreate: true,
      onPendenciaUpdate: true,
      onPendenciaNote: true,
      onDeadlineReminder: true,
      reminderDaysBefore: 2,
    };
  }
}

function saveNotifPrefs(prefs) {
  localStorage.setItem(NOTIF_PREFS_KEY, JSON.stringify(prefs));
}

// ── Envio de E-mail via Edge Function ──
async function sendEmailNotification({ to, subject, html }) {
  if (!EMAIL_CONFIG.enabled || !EMAIL_CONFIG.edgeFunctionUrl) {
    console.log('📧 [Notificação] E-mail desabilitado ou URL não configurada.');
    return { skipped: true };
  }

  if (!isSupabaseConnected()) {
    console.log('📧 [Notificação] Supabase offline. E-mail ignorado.');
    return { skipped: true };
  }

  if (!to || (Array.isArray(to) && to.length === 0)) {
    console.warn('📧 [Notificação] Destinatário(s) ausente(s). E-mail ignorado.');
    return { skipped: true };
  }

  try {
    const recipients = Array.isArray(to) ? to : [to];

    const { data, error } = await supabaseClient.functions.invoke('send-email', {
      body: {
        from: `${EMAIL_CONFIG.fromName} <${EMAIL_CONFIG.fromEmail}>`,
        to: recipients,
        subject,
        html,
      },
    });

    if (error) {
      if (error.message && (error.message.includes('CORS') || error.message.includes('Failed to send') || error.message.includes('fetch'))) {
        console.log('📧 [Notificação] Edge Function não disponível (não deployada?). Pulando...');
      } else {
        console.warn('📧 [Notificação] Erro na Edge Function:', error.message);
      }
      return { error: error.message };
    }

    console.log('📧 [Notificação] E-mail enviado com sucesso para:', recipients.join(', '));
    return { success: true, data };
  } catch (err) {
    const msg = err.message || String(err);
    if (msg.includes('CORS') || msg.includes('Failed to send') || msg.includes('fetch') || msg.includes('Edge Function')) {
      console.log('📧 [Notificação] Edge Function indisponível (verifique se está deployada). Silenciando...');
    } else {
      console.warn('📧 [Notificação] Falha:', msg);
    }
    return { error: msg };
  }
}

// ── Helpers de Formatação de E-mail ──
function emailHeader() {
  return `
    <div style="background:#1a56db;padding:20px 24px;border-radius:10px 10px 0 0">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="font-family:'Inter',Arial,sans-serif">
          <div style="font-size:20px;font-weight:800;color:#fff;letter-spacing:-0.3px">Init Intra</div>
          <div style="font-size:12px;color:rgba(255,255,255,0.7);margin-top:2px">Sistema de Gestão Interna</div>
        </td>
      </tr></table>
    </div>`;
}

function emailFooter() {
  return `
    <div style="background:#f8fafc;padding:16px 24px;border-radius:0 0 10px 10px;border-top:1px solid #e2e8f0;text-align:center">
      <div style="font-family:'Inter',Arial,sans-serif;font-size:11px;color:#94a3b8">
        Esta é uma notificação automática do Init Intra.<br>
        ${new Date().toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })}
      </div>
    </div>`;
}

function emailBody(content) {
  return `
    <!DOCTYPE html><html><head><meta charset="utf-8"></head>
    <body style="margin:0;padding:0;background:#f0f4f8;font-family:'Inter',Arial,sans-serif">
      <table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0">
        <tr><td align="center">
          <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08)">
            <tr><td>${emailHeader()}</td></tr>
            <tr><td style="padding:24px;font-family:'Inter',Arial,sans-serif;font-size:14px;color:#1e293b;line-height:1.6">${content}</td></tr>
            <tr><td>${emailFooter()}</td></tr>
          </table>
        </td></tr>
      </table>
    </body></html>`;
}

function priorityColor(priority) {
  return { baixa:'#16a34a', media:'#d97706', alta:'#dc2626', critica:'#991b1b' }[priority] || '#64748b';
}

function priorityLabel(priority) {
  return { baixa:'Baixa', media:'Média', alta:'Alta', critica:'Crítica' }[priority] || priority;
}

function statusLabel(status) {
  return { aberto:'Aberto', em_andamento:'Em Andamento', aguardando:'Aguard. Terceiro', concluido:'Concluído', cancelado:'Cancelado' }[status] || status;
}

// ── Coletar destinatários ──
function getAdminEmails() {
  return getOperators()
    .filter(o => o.isAdmin && o.active && o.email)
    .map(o => o.email);
}

function getResponsibleEmail(responsibleName) {
  const op = getOperators().find(o => o.name === responsibleName && o.email);
  return op ? op.email : null;
}

function collectRecipients(responsibleName, includeAdmins = true) {
  const emails = [];
  const respEmail = getResponsibleEmail(responsibleName);
  if (respEmail) emails.push(respEmail);
  if (includeAdmins) {
    getAdminEmails().forEach(e => { if (!emails.includes(e)) emails.push(e); });
  }
  return emails;
}

// ── Templates de E-mail ──

function notifyPendenciaCreated(pendencia) {
  const prefs = getNotifPrefs();
  if (!prefs.onPendenciaCreate) return;

  const recipients = collectRecipients(pendencia.responsible);
  if (!recipients.length) return;

  const deadlineText = pendencia.deadline
    ? `<strong>Prazo:</strong> ${formatDate(parseDeadline(pendencia.deadline))}`
    : '<strong>Prazo:</strong> Sem prazo definido';

  const html = emailBody(`
    <div style="margin-bottom:16px">
      <div style="display:inline-block;background:${priorityColor(pendencia.priority)}15;color:${priorityColor(pendencia.priority)};padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;margin-bottom:8px">Nova Pendência</div>
      <h2 style="margin:0;font-size:18px;font-weight:700;color:#1e293b">${escapeHtml(getPendenciaTitulo(pendencia))}</h2>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px">
      <tr>
        <td style="padding:8px 12px;background:#f8fafc;border-radius:6px 0 0 6px;font-size:12px;color:#64748b;width:120px"><strong>Cliente</strong></td>
        <td style="padding:8px 12px;background:#f8fafc;border-radius:0 6px 6px 0;font-size:13px">${escapeHtml(pendencia.clientName || '—')}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;font-size:12px;color:#64748b"><strong>Responsável</strong></td>
        <td style="padding:8px 12px;font-size:13px">${escapeHtml(pendencia.responsible || '—')}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;background:#f8fafc;border-radius:6px 0 0 6px;font-size:12px;color:#64748b"><strong>Prioridade</strong></td>
        <td style="padding:8px 12px;background:#f8fafc;border-radius:0 6px 6px 0;font-size:13px;color:${priorityColor(pendencia.priority)};font-weight:600">${priorityLabel(pendencia.priority)}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;font-size:12px;color:#64748b"><strong>Status</strong></td>
        <td style="padding:8px 12px;font-size:13px">${statusLabel(pendencia.status)}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;background:#f8fafc;border-radius:6px 0 0 6px;font-size:12px;color:#64748b"><strong>Prazo</strong></td>
        <td style="padding:8px 12px;background:#f8fafc;border-radius:0 6px 6px 0;font-size:13px">${deadlineText}</td>
      </tr>
    </table>
    <div style="text-align:center;margin-top:20px">
      <a href="${window.location.origin}${window.location.pathname}#pendencias" style="display:inline-block;background:#1a56db;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600">Ver no Init Intra →</a>
    </div>
  `);

  sendEmailNotification({
    to: recipients,
    subject: `[Init Intra] Nova Pendência: ${getPendenciaTitulo(pendencia)}`,
    html,
  });
}

function notifyPendenciaUpdated(pendencia, oldStatus) {
  const prefs = getNotifPrefs();
  if (!prefs.onPendenciaUpdate) return;

  const recipients = collectRecipients(pendencia.responsible);
  if (!recipients.length) return;

  const statusChanged = oldStatus && oldStatus !== pendencia.status;
  const newStatusLabel = statusLabel(pendencia.status);
  const oldStatusLabel = statusLabel(oldStatus);

  const html = emailBody(`
    <div style="margin-bottom:16px">
      <div style="display:inline-block;background:#3b82f615;color:#3b82f6;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;margin-bottom:8px">Pendência Atualizada</div>
      <h2 style="margin:0;font-size:18px;font-weight:700;color:#1e293b">${escapeHtml(getPendenciaTitulo(pendencia))}</h2>
    </div>
    ${statusChanged ? `
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:14px 16px;margin-bottom:16px;text-align:center">
      <div style="font-size:12px;color:#64748b;margin-bottom:4px">Status alterado</div>
      <div style="font-size:14px;font-weight:600">
        <span style="color:#94a3b8;text-decoration:line-through">${oldStatusLabel}</span>
        <span style="margin:0 8px;color:#94a3b8">→</span>
        <span style="color:#1a56db">${newStatusLabel}</span>
      </div>
    </div>` : ''}
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px">
      <tr>
        <td style="padding:8px 12px;background:#f8fafc;border-radius:6px 0 0 6px;font-size:12px;color:#64748b;width:120px"><strong>Cliente</strong></td>
        <td style="padding:8px 12px;background:#f8fafc;border-radius:0 6px 6px 0;font-size:13px">${escapeHtml(pendencia.clientName || '—')}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;font-size:12px;color:#64748b"><strong>Responsável</strong></td>
        <td style="padding:8px 12px;font-size:13px">${escapeHtml(pendencia.responsible || '—')}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;background:#f8fafc;border-radius:6px 0 0 6px;font-size:12px;color:#64748b"><strong>Status</strong></td>
        <td style="padding:8px 12px;background:#f8fafc;border-radius:0 6px 6px 0;font-size:13px;font-weight:600">${newStatusLabel}</td>
      </tr>
    </table>
    <div style="text-align:center;margin-top:20px">
      <a href="${window.location.origin}${window.location.pathname}#pendencias" style="display:inline-block;background:#1a56db;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600">Ver no Init Intra →</a>
    </div>
  `);

  sendEmailNotification({
    to: recipients,
    subject: `[Init Intra] Pendência Atualizada: ${getPendenciaTitulo(pendencia)}`,
    html,
  });
}

function notifyPendenciaNote(pendencia, note) {
  const prefs = getNotifPrefs();
  if (!prefs.onPendenciaNote) return;

  const recipients = collectRecipients(pendencia.responsible);
  if (!recipients.length) return;

  const html = emailBody(`
    <div style="margin-bottom:16px">
      <div style="display:inline-block;background:#7c3aed15;color:#7c3aed;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;margin-bottom:8px">Nova Nota</div>
      <h2 style="margin:0;font-size:16px;font-weight:700;color:#1e293b">${escapeHtml(getPendenciaTitulo(pendencia))}</h2>
    </div>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin-bottom:16px">
      <div style="font-size:12px;color:#64748b;margin-bottom:6px">
        <strong>${escapeHtml(note.author)}</strong> · ${new Date(note.createdAt).toLocaleString('pt-BR')}
      </div>
      <div style="font-size:14px;color:#1e293b;line-height:1.6;white-space:pre-wrap">${escapeHtml(note.text)}</div>
    </div>
    <div style="text-align:center;margin-top:20px">
      <a href="${window.location.origin}${window.location.pathname}#pendencias" style="display:inline-block;background:#1a56db;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600">Ver no Init Intra →</a>
    </div>
  `);

  sendEmailNotification({
    to: recipients,
    subject: `[Init Intra] Nova nota em: ${getPendenciaTitulo(pendencia)}`,
    html,
  });
}

// ── Lembrete de Prazo (chamado pelo cron job ou manualmente) ──
function notifyDeadlineReminder(pendencia, daysLeft) {
  const recipients = collectRecipients(pendencia.responsible);
  if (!recipients.length) return;

  const urgency = daysLeft <= 0 ? 'VENCIDA' : daysLeft === 1 ? 'vence AMANHÃ' : `vence em ${daysLeft} dias`;
  const urgencyColor = daysLeft <= 0 ? '#dc2626' : daysLeft <= 1 ? '#d97706' : '#1a56db';
  const urgencyBg = daysLeft <= 0 ? '#fef2f2' : daysLeft <= 1 ? '#fffbeb' : '#eff6ff';

  const html = emailBody(`
    <div style="margin-bottom:16px">
      <div style="display:inline-block;background:${urgencyColor}15;color:${urgencyColor};padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;margin-bottom:8px">⏰ Lembrete de Prazo</div>
      <h2 style="margin:0;font-size:18px;font-weight:700;color:#1e293b">${escapeHtml(getPendenciaTitulo(pendencia))}</h2>
    </div>
    <div style="background:${urgencyBg};border:1px solid ${urgencyColor}30;border-radius:8px;padding:16px;margin-bottom:16px;text-align:center">
      <div style="font-size:24px;font-weight:800;color:${urgencyColor};margin-bottom:4px">${urgency}</div>
      <div style="font-size:13px;color:#64748b">Prazo: ${formatDate(parseDeadline(pendencia.deadline))}</div>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px">
      <tr>
        <td style="padding:8px 12px;background:#f8fafc;border-radius:6px 0 0 6px;font-size:12px;color:#64748b;width:120px"><strong>Cliente</strong></td>
        <td style="padding:8px 12px;background:#f8fafc;border-radius:0 6px 6px 0;font-size:13px">${escapeHtml(pendencia.clientName || '—')}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;font-size:12px;color:#64748b"><strong>Responsável</strong></td>
        <td style="padding:8px 12px;font-size:13px">${escapeHtml(pendencia.responsible || '—')}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;background:#f8fafc;border-radius:6px 0 0 6px;font-size:12px;color:#64748b"><strong>Prioridade</strong></td>
        <td style="padding:8px 12px;background:#f8fafc;border-radius:0 6px 6px 0;font-size:13px;color:${priorityColor(pendencia.priority)};font-weight:600">${priorityLabel(pendencia.priority)}</td>
      </tr>
    </table>
    <div style="text-align:center;margin-top:20px">
      <a href="${window.location.origin}${window.location.pathname}#pendencias" style="display:inline-block;background:#1a56db;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600">Ver no Init Intra →</a>
    </div>
  `);

  sendEmailNotification({
    to: recipients,
    subject: `[Init Intra] ⏰ Prazo ${urgency}: ${getPendenciaTitulo(pendencia)}`,
    html,
  });
}

// ── Verificação de Prazos (chamado no init e periodicamente) ──
function checkDeadlineReminders() {
  if (typeof getSession === 'function' && !getSession()) return;
  const prefs = getNotifPrefs();
  if (!prefs.onDeadlineReminder) return;

  const pens = getPendencias();
  const today = new Date();
    const todayStr = localDateISO(today);

  const reminderDays = prefs.reminderDaysBefore || 2;

  pens.forEach(p => {
    if (!p.deadline || isPendenciaClosed(p.status)) return;

    const deadline = parseDeadline(p.deadline);
    const diffMs = deadline - today;
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays <= reminderDays && diffDays >= -1) {
      const sentKey = `notif_sent_${p.id}_${p.deadline}`;
      if (!sessionStorage.getItem(sentKey)) {
        notifyDeadlineReminder(p, diffDays);
        sessionStorage.setItem(sentKey, '1');
      }
    }
  });
}

function notifyStalePendencia(p, days) {
  const recipients = collectRecipients(p.responsible);
  if (!recipients.length) return;
  const status = (typeof STATUS_PEN_MAP !== 'undefined' && STATUS_PEN_MAP[p.status]?.label) || p.status;
  const html = emailBody(`
    <div style="margin-bottom:16px">
      <div style="display:inline-block;background:#d9770615;color:#d97706;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;margin-bottom:8px">🕓 Pendência parada</div>
      <h2 style="margin:0;font-size:18px;font-weight:700;color:#1e293b">${escapeHtml(getPendenciaTitulo(p))}</h2>
    </div>
    <p style="font-size:14px;color:#475569;margin:0 0 16px">Esta pendência está sem atualização há <strong>${days} dias</strong>.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px">
      <tr><td style="padding:8px 12px;background:#f8fafc;border-radius:6px 0 0 6px;font-size:12px;color:#64748b;width:120px"><strong>Cliente</strong></td><td style="padding:8px 12px;background:#f8fafc;border-radius:0 6px 6px 0;font-size:13px">${escapeHtml(p.clientName || '—')}</td></tr>
      <tr><td style="padding:8px 12px;font-size:12px;color:#64748b"><strong>Responsável</strong></td><td style="padding:8px 12px;font-size:13px">${escapeHtml(p.responsible || '—')}</td></tr>
      <tr><td style="padding:8px 12px;background:#f8fafc;border-radius:6px 0 0 6px;font-size:12px;color:#64748b"><strong>Status</strong></td><td style="padding:8px 12px;background:#f8fafc;border-radius:0 6px 6px 0;font-size:13px">${escapeHtml(status)}</td></tr>
    </table>
    <div style="text-align:center;margin-top:20px">
      <a href="${window.location.origin}${window.location.pathname}#pendencias" style="display:inline-block;background:#1a56db;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600">Ver no Init Intra →</a>
    </div>
  `);
  sendEmailNotification({
    to: recipients,
    subject: `[Init Intra] 🕓 Pendência parada há ${days} dias: ${getPendenciaTitulo(p)}`,
    html,
  });
}

function checkStalePendencias() {
  if (typeof getSession === 'function' && !getSession()) return;
  const prefs = getNotifPrefs();
  if (!prefs.onDeadlineReminder) return;
  getPendencias().forEach(p => {
    if (isPendenciaClosed(p.status)) return;
    const ref = p.updatedAt || p.createdAt;
    if (!ref) return;
    const days = Math.floor((Date.now() - new Date(ref).getTime()) / 86400000);
    if (days >= 7) {
      const sentKey = `notif_stale_${p.id}_${ref}`;
      if (!sessionStorage.getItem(sentKey)) {
        notifyStalePendencia(p, days);
        sessionStorage.setItem(sentKey, '1');
      }
    }
  });
}

// Auto-check reminders on load
if (typeof window !== 'undefined') {
  window.addEventListener('load', () => setTimeout(() => {
    checkDeadlineReminders();
    checkStalePendencias();
  }, 3000));
}

// ── UI: Modal de Configurações de Notificação ──
function openNotifSettings() {
  const prefs = getNotifPrefs();
  const modal = document.getElementById('notifModalOverlay');
  const body = document.getElementById('notifModalBody');

  body.innerHTML = `
    <div style="margin-bottom:16px">
      <p style="font-size:13px;color:var(--text-secondary);margin-bottom:16px">
        Configure quais e-mails automáticos serão enviados pelo sistema.
      </p>
    </div>

    <div style="margin-bottom:20px">
      <div style="font-size:11px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid var(--accent-dim2)">Pendências</div>
      <label style="display:flex;align-items:center;gap:10px;padding:8px 0;cursor:pointer;font-size:13px">
        <input type="checkbox" id="pref_pendCreate" ${prefs.onPendenciaCreate ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--accent)">
        <span>Ao criar nova pendência</span>
      </label>
      <label style="display:flex;align-items:center;gap:10px;padding:8px 0;cursor:pointer;font-size:13px">
        <input type="checkbox" id="pref_pendUpdate" ${prefs.onPendenciaUpdate ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--accent)">
        <span>Ao atualizar pendência (mudança de status)</span>
      </label>
      <label style="display:flex;align-items:center;gap:10px;padding:8px 0;cursor:pointer;font-size:13px">
        <input type="checkbox" id="pref_pendNote" ${prefs.onPendenciaNote ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--accent)">
        <span>Ao adicionar nota/ata</span>
      </label>
    </div>

    <div style="margin-bottom:20px">
      <div style="font-size:11px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid var(--accent-dim2)">Lembretes de Prazo</div>
      <label style="display:flex;align-items:center;gap:10px;padding:8px 0;cursor:pointer;font-size:13px">
        <input type="checkbox" id="pref_deadline" ${prefs.onDeadlineReminder ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--accent)">
        <span>Enviar lembretes automáticos</span>
      </label>
      <div style="display:flex;align-items:center;gap:8px;padding:8px 0 0 26px;font-size:13px">
        <span style="color:var(--text-muted)">Dias antes do prazo:</span>
        <input type="number" id="pref_reminderDays" value="${prefs.reminderDaysBefore || 2}" min="1" max="14" style="width:60px;padding:4px 8px;border:1px solid var(--border);border-radius:4px;font-size:13px;text-align:center">
      </div>
    </div>

    <div style="padding-top:14px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end">
      <button class="btn btn-secondary" onclick="document.getElementById('notifModalOverlay').style.display='none'">Cancelar</button>
      <button class="btn btn-primary" onclick="saveNotifSettings()">Salvar</button>
    </div>
  `;

  modal.style.display = 'flex';
}

function saveNotifSettings() {
  const prefs = {
    onPendenciaCreate: document.getElementById('pref_pendCreate').checked,
    onPendenciaUpdate: document.getElementById('pref_pendUpdate').checked,
    onPendenciaNote: document.getElementById('pref_pendNote').checked,
    onDeadlineReminder: document.getElementById('pref_deadline').checked,
    reminderDaysBefore: parseInt(document.getElementById('pref_reminderDays').value) || 2,
  };
  saveNotifPrefs(prefs);
  document.getElementById('notifModalOverlay').style.display = 'none';
  showToast('Preferências de notificação salvas!', 'success');
}

// Fechar modal ao clicar no overlay
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    const overlay = document.getElementById('notifModalOverlay');
    if (overlay) {
      overlay.addEventListener('click', e => {
        if (e.target === overlay) overlay.style.display = 'none';
      });
    }
  });
}
