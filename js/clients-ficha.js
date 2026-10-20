// clients-ficha.js – Ficha TI: modelo de campos, edição inline, acordeões, saúde e resumo.
// Parte de clients.js (dividido para facilitar manutenção). Scripts clássicos:
// carregam logo depois de clients.js e compartilham os mesmos globais.
// Nos testes, tests/_parts.cjs junta as partes na mesma ordem.

// ══════════════════════════════════════════════════════════════════════════
// FICHA TI — modelo declarativo + render + edição inline
// ────────────────────────────────────────────────────────────────────────────
// Um único modelo de seções/campos alimenta: acordeões, bloco Acesso rápido,
// barra "Ficha preenchida X%", botões de ação (copiar/ligar/WhatsApp/abrir) e
// o "Copiar resumo". A edição inline persiste pelo MESMO caminho do botão
// Editar do formulário: saveClient() (log, updatedAt/updatedBy, upsert).
// Sem dependências novas: SVG inline no padrão do projeto (estilo Lucide).
// ══════════════════════════════════════════════════════════════════════════

// Espelham os <select> do openClientForm (mantidos iguais de propósito).
const FICHA_OPTS = {
  serverType: ['Físico', 'Virtual', 'Cloud (AWS)', 'Cloud (Azure)', 'Cloud (GCP)', 'Outro'],
  remoteAccess: ['AnyDesk', 'TeamViewer', 'RDP', 'SSH', 'VPN', 'SSH + VPN', 'Outro'],
  backupFreq: ['Diário', 'Semanal', 'Quinzenal', 'Mensal', 'Sob demanda'],
};

const FICHA_SECTIONS = [
  { id: 'identificacao', title: 'Identificação', icon: 'id', fields: [
    { k: 'cnpj', l: 'CNPJ / CPF' },
    { k: 'segment', l: 'Segmento' },
    { k: 'owner', l: 'Dono' },
    { k: 'ownerPhone', l: 'Contato do dono', ty: 'phone' },
    { k: 'responsible', l: 'Responsável TI' },
    { k: 'responsiblePhone', l: 'Contato', ty: 'phone' },
    { k: 'technician', l: 'Técnico' },
    { k: 'address', l: 'Endereço', ty: 'address', w: true },
    { k: 'milvusClientToken', l: 'Token Milvus', ty: 'secret' },
  ]},
  { id: 'servidor', title: 'Servidor', icon: 'server', fields: [
    { k: 'server.type', l: 'Tipo', ty: 'choice', opts: FICHA_OPTS.serverType },
    { k: 'server.os', l: 'Sistema operacional' },
    { k: 'server.ip', l: 'IP', ty: 'copy' },
    { k: 'server.remoteAccess', l: 'Acesso remoto', ty: 'choice', opts: FICHA_OPTS.remoteAccess },
    { k: 'server.remoteId', l: 'ID de acesso', ty: 'secret', openWith: 'anydesk' },
    { k: 'server.notes', l: 'Observações', ty: 'longtext', w: true },
  ]},
  { id: 'hospedagem', title: 'Hospedagem', icon: 'globe', fields: [
    { k: 'hosting.provider', l: 'Provedor' },
    { k: 'hosting.panelUrl', l: 'Painel', ty: 'copy' },
    { k: 'hosting.user', l: 'Usuário', ty: 'copy' },
    { k: 'hosting.notes', l: 'Observações', ty: 'longtext', w: true },
  ]},
  { id: 'backup', title: 'Backup', icon: 'drive', fields: [
    { k: 'backup.frequency', l: 'Frequência', ty: 'choice', opts: FICHA_OPTS.backupFreq },
    { k: 'backup.time', l: 'Horário' },
    { k: 'backup.destination', l: 'Destino' },
    { k: 'backup.tool', l: 'Ferramenta' },
    { k: 'backup.lastCheck', l: 'Última verificação', ty: 'date' },
    { k: 'backup.lastBackupAt', l: 'Último backup', ty: 'datetime', emptyBadge: 'Sem registro' },
    { k: 'backup.lastBackupStatus', l: 'Status do último backup', ty: 'choice', opts: ['OK', 'Falhou'], badgeFor: { OK: 'ok', Falhou: 'bad' } },
  ]},
  { id: 'email', title: 'E-mail', icon: 'mail', fields: [
    { k: 'emails.provider', l: 'Provedor' },
    { k: 'emails.domain', l: 'Domínio' },
    { k: 'emails.server', l: 'Servidor', ty: 'copy' },
    { k: 'emails.port', l: 'Porta', ty: 'copy' },
    { k: 'emails.quota', l: 'Quota' },
  ]},
  { id: 'observacoes', title: 'Observações', icon: 'note', fields: [
    { k: 'notes', l: 'Observações gerais', ty: 'longtext', w: true },
  ]},
  { id: 'licencas', title: 'Licenças', icon: 'key', fields: [], ro: true },
];

const FICHA_FIELD_BY_KEY = {};
FICHA_SECTIONS.forEach(s => s.fields.forEach(f => { FICHA_FIELD_BY_KEY[f.k] = f; }));

// Ordem do bloco Acesso rápido (campos que o técnico mais usa).
const FICHA_QUICK_KEYS = ['server.remoteId', 'server.remoteAccess', 'server.ip', 'responsiblePhone', 'milvusClientToken'];

// Resumo copiável: whitelist explícita — token, senhas, chaves de licença e
// observações NUNCA entram aqui (defesa por construção, não por filtro).
const FICHA_SUMMARY_KEYS = [
  ['Segmento', 'segment'], ['CNPJ / CPF', 'cnpj'], ['Dono', 'owner'],
  ['Contato do dono', 'ownerPhone'], ['Responsável TI', 'responsible'],
  ['Contato', 'responsiblePhone'], ['Técnico', 'technician'],
  ['Tipo', 'server.type'], ['Sistema operacional', 'server.os'], ['IP', 'server.ip'],
  ['Acesso remoto', 'server.remoteAccess'], ['ID de acesso', 'server.remoteId'],
  ['Provedor', 'hosting.provider'], ['Painel', 'hosting.panelUrl'], ['Usuário', 'hosting.user'],
  ['Frequência', 'backup.frequency'], ['Horário', 'backup.time'], ['Destino', 'backup.destination'],
  ['Ferramenta', 'backup.tool'], ['Último backup', 'backup.lastBackupAt'],
];

// Estado dos acordeões por "<cliente>|<seção>": undefined = calcula na 1ª abra.
const _fichaOpen = {};
// Campos sensíveis revelados nesta sessão (só visual; copiar usa o valor real).
const _fichaReveal = {};

const FICHA_ICON_PATHS = {
  chev: '<polyline points="9 18 15 12 9 6"/>',
  id: '<rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="8" cy="11" r="2"/><path d="M14 9.5h5M14 13.5h5M5 16.5c.7-1.3 1.8-2 3-2s2.3.7 3 2"/>',
  server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><line x1="7" y1="7.5" x2="7.01" y2="7.5"/><line x1="7" y1="16.5" x2="7.01" y2="16.5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12"/><path d="M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>',
  drive: '<line x1="22" y1="12" x2="2" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" y1="16" x2="6.01" y2="16"/><line x1="9.5" y1="16" x2="9.51" y2="16"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
  note: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m10.85 12.15 7.15-7.15"/><path d="m18 5 2 2"/><path d="m15 8 2 2"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
  chat: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
  open: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
  info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="11"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-10-8-10-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12A3 3 0 1 1 9.88 9.88"/><line x1="1" y1="1" x2="23" y2="23"/>',
  zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
  form: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/>',
};

function cfIcon(name, size) {
  const s = size || 16;
  const p = FICHA_ICON_PATHS[name] || '';
  return `<svg class="cf-ico" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}

function cfGet(c, key) {
  if (!c) return '';
  if (key.indexOf('.') === -1) return c[key] == null ? '' : c[key];
  const p = key.split('.');
  const v = c[p[0]];
  return v && v[p[1]] != null ? v[p[1]] : '';
}

function cfSet(c, key, value) {
  const next = { ...c };
  if (key.indexOf('.') === -1) { next[key] = value; }
  else { const p = key.split('.'); next[p[0]] = { ...(c[p[0]] || {}), [p[1]]: value }; }
  return next;
}

function cfIsQuick(key) { return FICHA_QUICK_KEYS.indexOf(key) !== -1; }

function cfFilled(v) { return String(v == null ? '' : v).trim() !== ''; }

function cfFormatWhen(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  try {
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? formatDate(s) : formatDateTime(s);
  } catch (_) { return s; }
}

// Valor aceito por <input type="datetime-local"> (YYYY-MM-DDTHH:mm).
function cfDateTimeLocalValue(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  const m = s.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  if (m) return m[1] + 'T' + m[2];
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s + 'T00:00';
  return '';
}

// Campo preenchido? O ID de acesso guardado no cofre (043) conta como preenchido
// mesmo sem o valor no registro.
function cfFieldFilled(c, f) {
  if (f.k === 'server.remoteId' && typeof isRemoteIdVaulted === 'function' && isRemoteIdVaulted(c)) return true;
  return cfFilled(cfGet(c, f.k));
}

function cfProgress(c) {
  let filled = 0, total = 0;
  FICHA_SECTIONS.forEach(s => s.fields.forEach(f => {
    total++;
    if (cfFieldFilled(c, f)) filled++;
  }));
  return { filled, total };
}

// "Cliente desde": 1ª pendência do cliente → data de cadastro → oculta.
function cfClientSince(c, pens) {
  try {
    const mine = (pens || []).filter(p => p && p.clientId === c.id && p.createdAt);
    if (mine.length) {
      const min = mine.reduce((a, b) => (new Date(a.createdAt) < new Date(b.createdAt) ? a : b));
      const d = formatDate(min.createdAt);
      if (d && d !== '—') return d;
    }
  } catch (_) {}
  if (c.createdAt) {
    const d = formatDate(c.createdAt);
    if (d && d !== '—') return d;
  }
  return '';
}

function cfSectionCount(sec, c) {
  if (sec.ro) {
    const n = (c.licenses || []).length;
    return n ? `${n} licença${n > 1 ? 's' : ''}` : 'Nenhuma licença';
  }
  const n = sec.fields.filter(f => cfFieldFilled(c, f)).length;
  return n ? `${n} de ${sec.fields.length} preenchidos` : 'Nenhum dado preenchido';
}

// ── Cópia (mesmo feedback do token: toast curto "Copiado: ...") ─────────────
function cfCopy(text, opts) {
  const o = opts || {};
  const value = String(text == null ? '' : text);
  if (!value.trim()) { showToast('Nada para copiar.', 'warning'); return; }
  const preview = o.mask ? '••••••' : value.replace(/\s+/g, ' ').trim().slice(0, 40);
  const done = () => showToast('Copiado: ' + preview, 'success');
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(done).catch(() => cfFallbackCopy(value, done));
    } else {
      cfFallbackCopy(value, done);
    }
  } catch (_) { cfFallbackCopy(value, done); }
}

function cfFallbackCopy(value, done) {
  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    done();
  } catch (_) { showToast('Não foi possível copiar.', 'error'); }
}

function cfActionButton(label, icon, title, handler) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'cf-act';
  b.innerHTML = cfIcon(icon, 12) + '<span>' + escapeHtml(label) + '</span>';
  b.title = title || label;
  b.setAttribute('aria-label', title || label);
  b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); handler(); });
  return b;
}

function cfLinkAction(label, icon, href, title, newTab) {
  const a = document.createElement('a');
  a.className = 'cf-act';
  a.href = href;
  a.innerHTML = cfIcon(icon, 12) + '<span>' + escapeHtml(label) + '</span>';
  a.title = title || label;
  a.setAttribute('aria-label', title || label);
  if (newTab) { a.target = '_blank'; a.rel = 'noopener'; }
  a.addEventListener('click', (e) => e.stopPropagation());
  return a;
}

// ── ID de acesso guardado no cofre (migration 043) ─────────────────────────
// O valor não está no registro: Mostrar/Copiar/Abrir buscam no servidor
// (cada busca vai para a auditoria) e o valor fica 1 min só em memória.
function cfVaultedRemoteIdEl(field, clientId, c) {
  const wrap = document.createElement('div');
  wrap.className = 'cf-value';
  wrap.dataset.cfKey = field.k;
  const shown = getRevealedSecret(clientId, 'remote_id');
  const refresh = () => cfRefreshFields(clientId, field.k);
  const withValue = async (fn) => {
    try { fn(await revealClientSecret(clientId, 'remote_id', null, refresh)); }
    catch (err) { showToast(err.message, 'warning'); }
  };

  const txt = document.createElement('span');
  txt.className = 'cf-text';
  txt.tabIndex = 0;
  txt.setAttribute('role', 'button');
  txt.setAttribute('aria-label', 'Trocar ' + field.l);
  txt.title = 'Clique para trocar (o atual fica guardado até você digitar outro)';
  txt.textContent = shown !== null ? (shown || '—') : '••••••';
  txt.addEventListener('click', () => cfStartEdit(wrap, field, clientId));
  txt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cfStartEdit(wrap, field, clientId); }
  });
  wrap.appendChild(txt);

  const actions = document.createElement('span');
  actions.className = 'cf-actions';
  if (shown !== null) {
    actions.appendChild(cfActionButton('Ocultar', 'eyeOff', 'Ocultar ' + field.l, () => { forgetClientSecret(clientId, 'remote_id'); refresh(); }));
  } else {
    actions.appendChild(cfActionButton('Mostrar', 'eye', 'Mostrar ' + field.l + ' (fica registrado na auditoria)', () => withValue(refresh)));
  }
  actions.appendChild(cfActionButton('Copiar', 'copy', 'Copiar ' + field.l, () => withValue((v) => cfCopy(v, { mask: true, label: field.l }))));
  if (field.openWith === 'anydesk' && /anydesk/i.test(String(cfGet(c, 'server.remoteAccess') || ''))) {
    actions.appendChild(cfActionButton('Abrir', 'open', 'Abrir no AnyDesk', () => withValue((v) => { if (v) window.location.href = 'anydesk:' + v.replace(/\s+/g, ''); })));
  }
  actions.appendChild(cfActionButton('Apagar', 'trash', 'Apagar ' + field.l, async () => {
    if (!window.confirm('Apagar o ' + field.l + ' guardado deste cliente?')) return;
    try {
      await setClientRemoteId(clientId, '');
      const cur = getClientById(clientId);
      if (cur) saveClient(cfSet(cur, 'server.remoteIdSet', false));
      showToast(field.l + ' apagado.', 'success');
    } catch (err) { showToast(err.message, 'error'); }
    refresh();
  }));
  wrap.appendChild(actions);
  return wrap;
}

// ── Célula de valor: texto + ações + clique para editar ────────────────────
function cfValueEl(field, clientId) {
  const c = getClientById(clientId) || {};
  if (field.k === 'server.remoteId' && typeof isRemoteIdVaulted === 'function' && isRemoteIdVaulted(c)) {
    return cfVaultedRemoteIdEl(field, clientId, c);
  }
  const raw = String(cfGet(c, field.k) == null ? '' : cfGet(c, field.k));
  const has = cfFilled(raw);
  const revealed = _fichaReveal[field.k] === true;

  const wrap = document.createElement('div');
  wrap.className = 'cf-value';
  wrap.dataset.cfKey = field.k;

  if (field.emptyBadge && !has) {
    const badge = document.createElement('span');
    badge.className = 'cf-badge cf-badge--warn';
    badge.textContent = field.emptyBadge;
    wrap.appendChild(badge);
  }

  const txt = document.createElement('span');
  txt.className = 'cf-text' + (has ? '' : ' is-empty');
  txt.tabIndex = 0;
  txt.setAttribute('role', 'button');
  txt.setAttribute('aria-label', 'Editar ' + field.l + (has ? '' : ' — vazio'));
  txt.title = 'Clique para editar';
  if (!has) {
    txt.textContent = '— adicionar';
  } else if (field.ty === 'secret' && !revealed) {
    txt.textContent = '••••••';
  } else if (field.ty === 'datetime') {
    txt.textContent = cfFormatWhen(raw);
  } else if (field.badgeFor && field.badgeFor[raw]) {
    txt.className += ' cf-text--badge';
    txt.dataset.badge = field.badgeFor[raw];
    txt.textContent = raw;
  } else {
    txt.textContent = raw;
  }
  txt.addEventListener('click', () => cfStartEdit(wrap, field, clientId));
  txt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cfStartEdit(wrap, field, clientId); }
  });
  wrap.appendChild(txt);

  const actions = document.createElement('span');
  actions.className = 'cf-actions';
  if (has) {
    const wantCopy = field.ty === 'copy' || field.ty === 'secret' || field.ty === 'phone' || cfIsQuick(field.k);
    if (field.ty === 'secret') {
      actions.appendChild(cfActionButton(revealed ? 'Ocultar' : 'Mostrar', revealed ? 'eyeOff' : 'eye',
        (revealed ? 'Ocultar ' : 'Mostrar ') + field.l,
        () => { _fichaReveal[field.k] = !revealed; cfRefreshFields(clientId, field.k); }));
    }
    if (wantCopy) {
      const isSecret = field.ty === 'secret';
      actions.appendChild(cfActionButton('Copiar', 'copy', 'Copiar ' + field.l,
        () => cfCopy(raw, { mask: isSecret, label: field.l })));
    }
    if (field.ty === 'phone') {
      const d = raw.replace(/\D/g, '');
      if (d.length >= 8) {
        actions.appendChild(cfLinkAction('Ligar', 'phone', 'tel:' + d, 'Ligar para ' + field.l));
        actions.appendChild(cfLinkAction('WhatsApp', 'chat', 'https://wa.me/55' + d, 'Abrir WhatsApp', true));
      }
    }
    if (field.ty === 'address' && typeof mapsLinks === 'function') {
      const ml = mapsLinks(raw);
      actions.appendChild(cfLinkAction('Maps', 'open', ml.google, 'Abrir no Google Maps', true));
      actions.appendChild(cfLinkAction('Waze', 'open', ml.waze, 'Abrir no Waze', true));
    }
    if (field.openWith === 'anydesk') {
      const remote = String(cfGet(c, 'server.remoteAccess') || '');
      const rid = String(cfGet(c, 'server.remoteId') || '').trim();
      if (/anydesk/i.test(remote) && rid) {
        actions.appendChild(cfLinkAction('Abrir', 'open', 'anydesk:' + rid, 'Abrir no AnyDesk'));
      }
    }
  }
  if (actions.childNodes.length) wrap.appendChild(actions);
  return wrap;
}

function cfFieldEl(field, clientId, compact) {
  const box = document.createElement('div');
  box.className = 'cf-field' + (field.w ? ' cf-wide' : '') + (compact ? ' cf-field--sm' : '');
  const lb = document.createElement('div');
  lb.className = 'cf-label';
  lb.textContent = field.l;
  box.appendChild(lb);
  box.appendChild(cfValueEl(field, clientId));
  return box;
}

function cfValidateField(field, value) {
  if (!value) return true;
  if (field.ty === 'phone' && typeof Validators !== 'undefined' && Validators.phone && !Validators.phone(value)) {
    showToast('Telefone inválido — use DDD + número.', 'error');
    return false;
  }
  return true;
}

// ── Edição inline: Enter salva, Esc cancela, blur salva ────────────────────
function cfStartEdit(wrap, field, clientId) {
  if (!wrap || wrap.classList.contains('is-editing')) return;
  const txt = wrap.querySelector('.cf-text');
  const c = getClientById(clientId);
  if (!txt || !c || field.ro) return;
  const raw = String(cfGet(c, field.k) == null ? '' : cfGet(c, field.k));

  let input;
  if (field.ty === 'choice') {
    input = document.createElement('select');
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = '—';
    input.appendChild(blank);
    (field.opts || []).forEach(o => {
      const op = document.createElement('option');
      op.value = o;
      op.textContent = o;
      input.appendChild(op);
    });
    input.value = (field.opts || []).indexOf(raw) !== -1 ? raw : '';
  } else if (field.ty === 'longtext') {
    input = document.createElement('textarea');
    input.rows = 3;
    input.value = raw;
  } else {
    input = document.createElement('input');
    input.type = field.ty === 'datetime' ? 'datetime-local' : (field.ty === 'date' ? 'date' : 'text');
    input.value = field.ty === 'datetime' ? cfDateTimeLocalValue(raw) : raw;
  }
  input.className = 'cf-input';
  input.setAttribute('aria-label', 'Editar ' + field.l);
  // ID no cofre: o campo abre vazio (o atual não desce); vazio = mantém.
  if (field.k === 'server.remoteId' && typeof isRemoteIdVaulted === 'function' && isRemoteIdVaulted(c)) {
    input.placeholder = 'Novo ID — vazio mantém o atual';
  }
  wrap.classList.add('is-editing');
  txt.replaceWith(input);
  input.focus();
  try { if (input.select) input.select(); } catch (_) {}

  let done = false;
  const finish = (save, refocus) => {
    if (done) return;
    if (!save) { done = true; cfRefreshFields(clientId, field.k, wrap, false); return; }
    const value = String(input.value == null ? '' : input.value).trim();
    if (!cfValidateField(field, value)) return; // mantém o campo em edição
    done = true;
    cfCommitField(clientId, field, value, refocus === true);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    else if (e.key === 'Enter' && field.ty !== 'longtext') { e.preventDefault(); finish(true, true); }
  });
  input.addEventListener('change', () => { if (field.ty === 'choice') finish(true, true); });
  input.addEventListener('blur', () => finish(true, false));
}

function cfCommitField(clientId, field, value, refocus) {
  const c = getClientById(clientId);
  if (!c) return;
  const norm = field.k === 'milvusClientToken' ? normalizeMilvusClientToken(value) : value;
  const before = String(cfGet(c, field.k) == null ? '' : cfGet(c, field.k));
  if (norm !== before) {
    try {
      saveClient(cfSet(c, field.k, norm));
    } catch (err) {
      showToast('Erro ao salvar: ' + (err && err.message ? err.message : err), 'error');
      cfRefreshFields(clientId, field.k, null, false);
      return;
    }
  }
  cfRefreshFields(clientId, field.k, null, refocus);
  cfRefreshCounters(clientId);
}

// Repinta só as células da chave (mantém o resto do DOM — e o foco — intactos).
function cfRefreshFields(clientId, key, preferWrap, refocus) {
  const root = document.getElementById('clientTabContent');
  const field = FICHA_FIELD_BY_KEY[key];
  if (!root || !field) return;
  const nodes = Array.prototype.slice.call(root.querySelectorAll('[data-cf-key="' + key + '"]'));
  let target = null;
  nodes.forEach(n => {
    const fresh = cfValueEl(field, clientId);
    if (preferWrap && n === preferWrap) target = fresh;
    n.replaceWith(fresh);
  });
  if (!target) target = root.querySelector('[data-cf-key="' + key + '"]');
  if (refocus && target) {
    const t = target.querySelector('.cf-text');
    if (t) t.focus();
  }
}

function cfRefreshCounters(clientId) {
  const root = document.getElementById('clientTabContent');
  const c = getClientById(clientId);
  if (!root || !c) return;
  FICHA_SECTIONS.forEach(sec => {
    const el = root.querySelector('[data-cf-count="' + sec.id + '"]');
    if (el) el.textContent = cfSectionCount(sec, c);
  });
  const { filled, total } = cfProgress(c);
  const pct = total ? Math.round((filled / total) * 100) : 0;
  const pctEl = root.querySelector('#cfPct');
  if (pctEl) pctEl.textContent = pct + '%';
  const fill = root.querySelector('#cfFill');
  if (fill) fill.style.width = pct + '%';
}

// ── Acordeões ──────────────────────────────────────────────────────────────
function toggleFichaSection(clientId, secId) {
  const sec = FICHA_SECTIONS.find(s => s.id === secId);
  const c = getClientById(clientId);
  const root = document.getElementById('clientTabContent');
  if (!sec || !c || !root) return;
  const key = clientId + '|' + secId;
  const hasData = sec.ro ? (c.licenses || []).length > 0 : sec.fields.some(f => cfFieldFilled(c, f));
  const cur = _fichaOpen[key] !== undefined ? _fichaOpen[key] : hasData;
  _fichaOpen[key] = !cur;
  const wrap = root.querySelector('[data-cf-sec="' + secId + '"]');
  if (!wrap) return;
  wrap.classList.toggle('open', !cur);
  const head = wrap.querySelector('.cf-sec-head');
  if (head) head.setAttribute('aria-expanded', String(!cur));
}

// "Editar ficha": abre todas as seções para edição inline.
function editFichaAll(clientId) {
  FICHA_SECTIONS.forEach(s => { _fichaOpen[clientId + '|' + s.id] = true; });
  const el = document.getElementById('clientTabContent');
  renderClientFicha(clientId, el);
  showToast('Clique em um valor para editar.', 'info');
}

function openClientFullForm(clientId) {
  closeModal();
  openClientForm(clientId);
}

function cfSectionEl(sec, clientId, c) {
  const key = clientId + '|' + sec.id;
  const hasData = sec.ro ? (c.licenses || []).length > 0 : sec.fields.some(f => cfFieldFilled(c, f));
  const open = _fichaOpen[key] !== undefined ? !!_fichaOpen[key] : hasData;

  const wrap = document.createElement('section');
  wrap.className = 'cf-sec' + (open ? ' open' : '');
  wrap.dataset.cfSec = sec.id;

  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'cf-sec-head';
  head.setAttribute('aria-expanded', String(open));
  head.setAttribute('aria-controls', 'cf-sec-body-' + sec.id);
  head.innerHTML = `<span class="cf-chev">${cfIcon('chev', 16)}</span><span class="cf-sec-ico">${cfIcon(sec.icon, 16)}</span>` +
    `<span class="cf-sec-title">${escapeHtml(sec.title)}</span>` +
    `<span class="cf-sec-count" data-cf-count="${sec.id}">${escapeHtml(cfSectionCount(sec, c))}</span>`;
  head.addEventListener('click', () => toggleFichaSection(clientId, sec.id));
  wrap.appendChild(head);

  const body = document.createElement('div');
  body.className = 'cf-sec-body';
  body.id = 'cf-sec-body-' + sec.id;
  if (sec.ro) {
    body.appendChild(cfLicensesEl(c));
  } else {
    const grid = document.createElement('div');
    grid.className = 'cf-grid';
    sec.fields.forEach(f => grid.appendChild(cfFieldEl(f, clientId)));
    body.appendChild(grid);
  }
  wrap.appendChild(body);
  return wrap;
}

function cfLicensesEl(c) {
  const lics = c.licenses || [];
  const wrap = document.createElement('div');
  wrap.className = 'cf-lics';
  if (!lics.length) {
    const p = document.createElement('p');
    p.className = 'cf-empty';
    p.textContent = 'Nenhuma licença cadastrada.';
    wrap.appendChild(p);
    return wrap;
  }
  lics.forEach(l => {
    const row = document.createElement('div');
    row.className = 'cf-lic';
    row.innerHTML = `<div class="cf-lic-name">${escapeHtml(l.software || '—')}${l.expiry ? `<span class="cf-badge cf-badge--warn">até ${escapeHtml(l.expiry)}</span>` : ''}</div>` +
      (l.key ? `<code class="cf-lic-key">${escapeHtml(l.key)}</code>` : '');
    // Chave no cofre (043): mascarada; Mostrar/Copiar buscam no servidor (auditado).
    if (typeof isLicenseKeyVaulted === 'function' && isLicenseKeyVaulted(l)) {
      const shown = getRevealedSecret(c.id, 'license', l.kid);
      const code = document.createElement('code');
      code.className = 'cf-lic-key';
      code.textContent = shown !== null ? (shown || '—') : '••••-••••';
      row.appendChild(code);
      const repaint = () => { const fresh = cfLicensesEl(getClientById(c.id) || c); wrap.replaceWith(fresh); };
      const withKey = async (fn) => {
        try { fn(await revealClientSecret(c.id, 'license', l.kid, repaint)); }
        catch (err) { showToast(err.message, 'warning'); }
      };
      const acts = document.createElement('span');
      acts.className = 'cf-actions';
      acts.appendChild(shown !== null
        ? cfActionButton('Ocultar', 'eyeOff', 'Ocultar chave', () => { forgetClientSecret(c.id, 'license', l.kid); repaint(); })
        : cfActionButton('Mostrar', 'eye', 'Mostrar chave (fica registrado na auditoria)', () => withKey(repaint)));
      acts.appendChild(cfActionButton('Copiar', 'copy', 'Copiar chave', () => withKey((v) => cfCopy(v, { mask: true, label: 'Chave' }))));
      row.appendChild(acts);
    }
    wrap.appendChild(row);
  });
  return wrap;
}

// ── Faixa de saúde unificada (status + números + cliente desde + progresso) ─
function cfHealthHtml(clientId, c) {
  const today = typeof localDateISO === 'function' ? localDateISO() : new Date().toISOString().slice(0, 10);
  const pens = _getPendenciasList();
  const sla = (typeof getSlaStatsForClient === 'function')
    ? getSlaStatsForClient(pens, clientId, today)
    : { totalAbertas: 0, vencidas: 0, dentroPrazo: 0 };
  const health = (typeof getHealthForClient === 'function') ? getHealthForClient(pens, clientId, today) : null;
  const level = health && health.level ? health.level : 'green';
  const color = health && health.color ? health.color : 'var(--text-muted)';
  const label = health && health.label ? health.label : 'Saúde';
  const emoji = health && health.emoji ? health.emoji : '•';
  const avg = health && health.avgHours != null ? health.avgHours.toFixed(1) + 'h' : 'sem histórico';
  const since = cfClientSince(c, pens);
  const th = (typeof HEALTH_THRESHOLDS !== 'undefined') ? HEALTH_THRESHOLDS : null;
  const tip = th
    ? `Saudável: até ${th.greenMaxVencidas} vencidas · ${th.greenMaxAbertas} abertas · média ${th.greenMaxAvgHours}h<br>Atenção: até ${th.yellowMaxVencidas} vencidas · ${th.yellowMaxAbertas} abertas · média ${th.yellowMaxAvgHours}h<br>Crítico: acima disso.`
    : '';
  const { filled, total } = cfProgress(c);
  const pct = total ? Math.round((filled / total) * 100) : 0;
  return `
    <div class="cf-health" data-level="${escapeHtml(level)}" style="--cf-h:${escapeHtml(color)}">
      <span class="cf-health-dot" aria-hidden="true"></span>
      <div class="cf-health-main">
        <span class="cf-health-status">${escapeHtml(emoji)} ${escapeHtml(label)}</span>
        <span class="cf-health-stats">${sla.totalAbertas} abertas · ${sla.vencidas} vencidas · média ${escapeHtml(avg)}${since ? ` · cliente desde ${escapeHtml(since)}` : ''}</span>
        <button type="button" class="cf-info" aria-label="Ver critérios de saúde do cliente">${cfIcon('info', 15)}<span class="cf-tip" role="tooltip"><strong>Critérios</strong><br>${tip}</span></button>
      </div>
      <div class="cf-progress">
        <div class="cf-progress-top"><span>Ficha preenchida</span><b id="cfPct">${pct}%</b></div>
        <div class="cf-track"><i id="cfFill" style="width:${pct}%"></i></div>
      </div>
    </div>`;
}

// ── Resumo copiável (whitelist; sem token/senha/chave) ─────────────────────
function buildClientSummary(clientId) {
  const c = getClientById(clientId);
  if (!c) return '';
  const lines = ['Ficha TI – ' + (c.name || '')];
  FICHA_SUMMARY_KEYS.forEach(([label, key]) => {
    const v = String(cfGet(c, key) == null ? '' : cfGet(c, key)).trim();
    if (v) lines.push(label + ': ' + v);
  });
  return lines.join('\n');
}

function copyClientSummary(clientId) {
  const text = buildClientSummary(clientId);
  if (!text || text.split('\n').length < 2) { showToast('Nada para copiar — ficha vazia.', 'warning'); return; }
  cfCopy(text);
}

// Cabeçalho do modal: "Atualizada em DD/MM/AAAA por <usuário>".
function cfUpdatedMeta(c) {
  if (!c) return '';
  let when = '';
  try { if (c.updatedAt) when = formatDate(c.updatedAt); } catch (_) {}
  if (!when || when === '—') return '';
  return 'Atualizada em ' + when + (c.updatedBy ? ' por ' + escapeHtml(c.updatedBy) : '');
}

function renderClientFicha(clientId, el) {
  if (!el) return;
  const c = getClientById(clientId);
  if (!c) { el.innerHTML = '<div class="empty-state"><p>Cliente não encontrado.</p></div>'; return; }
  const cid = escapeHtml(clientId);
  el.innerHTML = `
    <div class="cf-bar">
      <button type="button" class="btn btn-primary btn-sm" onclick="editFichaAll('${cid}')">${cfIcon('edit', 13)} Editar ficha</button>
      <button type="button" class="btn btn-secondary btn-sm" onclick="closeModal();navigateTo('pendencias');setTimeout(()=>openPendenciaForm(null,'${cid}'),100)">+ Nova Pendência</button>
      <span class="cf-bar-sp"></span>
      <button type="button" class="btn btn-secondary btn-sm" onclick="openClientFullForm('${cid}')">${cfIcon('form', 13)} Formulário</button>
      <button type="button" class="btn btn-secondary btn-sm" onclick="copyClientSummary('${cid}')">${cfIcon('copy', 13)} Copiar resumo</button>
    </div>
    ${cfHealthHtml(clientId, c)}
    <div class="cf-quick">
      <div class="cf-quick-head">${cfIcon('zap', 15)}<h3 class="cf-quick-title">Acesso rápido</h3></div>
      <div class="cf-quick-grid" id="cfQuick"></div>
    </div>
    <div class="cf-sections" id="cfSections"></div>
    <p class="cf-hint">${cfIcon('info', 13)} Clique em qualquer valor para editar — Enter salva, Esc cancela.</p>`;

  const quick = el.querySelector('#cfQuick');
  FICHA_QUICK_KEYS.forEach(k => {
    const f = FICHA_FIELD_BY_KEY[k];
    if (f && quick) quick.appendChild(cfFieldEl(f, clientId, true));
  });
  const box = el.querySelector('#cfSections');
  FICHA_SECTIONS.forEach(sec => { if (box) box.appendChild(cfSectionEl(sec, clientId, c)); });
}

function renderClientTab(tab, id) {
  const el = document.getElementById('clientTabContent');
  if (tab === 'ficha') {
    renderClientFicha(id, el);
  } else if (tab === 'procedimentos') {
    const procs = getProcedures(id);
    el.innerHTML = `<div style="margin-bottom:12px;display:flex;gap:8px">
        <button class="btn btn-primary btn-sm" onclick="openProcedureForm('${id}')">+ Novo Procedimento</button>
      </div>
      ${procs.length ? procs.map(p => `
        <div class="proc-card" id="proc-${escapeHtml(p.id)}">
          <div class="proc-card-header" role="button" tabindex="0" onclick="toggleProcCard('${escapeHtml(p.id)}')">
            <div style="flex:1;min-width:0">
              <div class="proc-card-title">${escapeHtml(p.title)}</div>
              ${p.category ? `<span class="tag tag-blue" style="margin-top:4px">${escapeHtml(p.category)}</span>` : ''}
            </div>
            <div class="proc-actions" onclick="event.stopPropagation()">
              <button class="btn btn-sm btn-secondary" onclick="duplicateProcedure('${escapeHtml(id)}','${escapeHtml(p.id)}')">Duplicar</button>
              <button class="btn btn-sm btn-secondary" onclick="openProcedureForm('${escapeHtml(id)}','${escapeHtml(p.id)}')">Editar</button>
              <button class="btn btn-sm btn-danger" onclick="deleteProcedureConfirm('${escapeHtml(p.id)}','${escapeHtml(id)}')">✕</button>
            </div>
          </div>
          <pre class="proc-content">${escapeHtml(p.content)}</pre>
        </div>`).join('') : `<div class="empty-state"><p>Nenhum procedimento cadastrado</p></div>`}`;
  } else if (tab === 'documentos') {
    el.innerHTML = `
      <div class="attachment-section" style="margin-top:0">
        <div class="section-header" style="margin-bottom:12px">
          <span class="section-title">📄 Documentos permanentes (Máx 2MB)</span>
          <label class="btn btn-primary btn-sm" style="cursor:pointer">
            + Enviar Documento permanente
            <input type="file" id="cliDocFileInput" style="display:none" onchange="handleClientDocumentUpload('${id}',this,()=>renderClientDocumentsList('${id}','cliDocumentsList'))" />
          </label>
        </div>
        <div class="attachment-list" id="cliDocumentsList"></div>
      </div>
      <hr class="divider" />
      <div class="attachment-section" style="margin-top:0">
        <div class="section-header" style="margin-bottom:12px">
          <span class="section-title">📁 Anexos do Cliente (Máx 2MB)</span>
          <label class="btn btn-secondary btn-sm" style="cursor:pointer">
            + Enviar Anexo
            <input type="file" id="cliFileInput" style="display:none" onchange="handleFileUpload('clients','${id}',this,()=>renderAttachmentList('clients','${id}','cliAttachmentsList'))" />
          </label>
        </div>
        <div class="attachment-list" id="cliAttachmentsList"></div>
      </div>
      <hr class="divider" />
      <div class="attachment-section" style="margin-top:0">
        <div class="section-header" style="margin-bottom:12px">
          <span class="section-title">📊 Planilha de documentação (Google Sheets)</span>
          <div style="display:flex;gap:6px;flex-wrap:wrap" id="cliSheetActions"></div>
        </div>
        <div id="cliSheetBody"></div>
      </div>
    `;
    setTimeout(function(){ renderClientDocumentsList(id, 'cliDocumentsList'); renderAttachmentList('clients', id, 'cliAttachmentsList'); renderClientSheetSection(id); }, 20);
  } else if (tab === 'visitas') {
    const visits = getVisitsByClient(id);
    el.innerHTML = `<div style="margin-bottom:12px;display:flex;gap:8px">
        <button class="btn btn-primary btn-sm" onclick="openVisitForm(null,'${escapeHtml(id)}')">+ Registrar Visita</button>
      </div>
      ${visits.length ? `<div class="table-wrapper"><table><thead><tr><th>Data</th><th>Horário</th><th>Motivo</th><th>Operador</th><th>Status</th><th></th></tr></thead><tbody>${visits.map(v => `<tr>
        <td><strong>${formatDate(v.date)}</strong></td>
        <td>${escapeHtml(typeof formatVisitTimeRange === 'function' ? formatVisitTimeRange(v) : (v.time || '—'))}</td>
        <td>${escapeHtml(v.motivo || '—')}${v.observacoes ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">${escapeHtml(v.observacoes)}</div>` : ''}</td>
        <td>${escapeHtml(v.operator || '—')}</td>
        <td>${typeof visitStatusTag === 'function' ? visitStatusTag(v.status) : escapeHtml(v.status)}</td>
        <td style="text-align:right"><button class="btn btn-sm btn-secondary" onclick="openVisitDetail('${escapeHtml(v.id)}')">Abrir</button></td>
      </tr>`).join('')}</tbody></table></div>` : `<div class="empty-state"><p>Nenhuma visita registrada para este cliente.</p></div>`}`;
  } else if (tab === 'inventario') {
    renderClientInventoryTab(id);
  } else if (tab === 'chamados') {
    renderClientMilvusTicketsTab(id);
  } else if (tab === 'checklist') {
    renderClientChecklistTab(id);
  } else if (tab === 'atendimentos') {
    // Aba removida (unificada em "chamados"): alias defensivo para não quebrar
    // chamadas antigas — renderiza a aba unificada.
    renderClientMilvusTicketsTab(id);
  } else if (tab === 'historico') {
    const client = getClientById(id);
    const clientName = client ? client.name : '';
    const pensIds = new Set(_getPendenciasList().filter(p => {
      if (p.clientId !== id) return false;
      try { if (typeof canViewPendencia === 'function' && !canViewPendencia(p)) return false; } catch (_) {}
      return true;
    }).map(p => p.id));
    const visitIds = new Set(getVisits().filter(v => v.clientId === id).map(v => v.id));
    const logs = (function(){
      var _l = typeof getLogs === 'function' ? getLogs() : [];
      try { if (typeof filterGestaoLogs === 'function') return filterGestaoLogs(_l); } catch (_) {}
      return _l;
    })();
    const filtered = logs.filter(l => {
      if (l.targetId === id) return true;
      if (pensIds.has(l.targetId)) return true;
      if (visitIds.has(l.targetId)) return true;
      if (clientName && l.details && l.details.toLowerCase().includes(clientName.toLowerCase())) return true;
      if (l.type === 'Cliente' && l.details === clientName) return true;
      return false;
    }).slice(0, 80);
    if (!filtered.length) {
      el.innerHTML = `<div class="empty-state" style="padding:20px"><p>Nenhum histórico para este cliente.</p></div>`;
    } else {
      el.innerHTML = `<div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">${plural(filtered.length, 'registro', 'registros')}</div>
        <div class="log-timeline">${filtered.map(log => {
          const actionKey = (log.action || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-');
          const actionClass = ['criou','ativou','editou','excluiu','desativou','login','backup','limpou'].includes(actionKey.split('-')[0]) ? 'log-action-' + actionKey.split('-')[0] : 'log-action-default';
          return `<div class="log-card"><div class="log-dot ${actionClass}" style="background:currentColor"></div><div class="log-header"><span class="log-action-label">${escapeHtml(log.action)}</span><span class="log-type-badge ${actionClass}">${escapeHtml(log.type)}</span><span style="flex:1"></span><span class="log-meta">${formatDateTime(log.timestamp)}</span></div><div class="log-details">${escapeHtml(log.details)}</div><div class="log-meta">👤 ${escapeHtml(log.operatorName||'Sistema')}</div></div>`;
        }).join('')}</div>`;
    }
  } else {
    const pens = _getPendenciasList().filter(p => {
      if (p.clientId !== id) return false;
      try { if (typeof canViewPendencia === 'function' && !canViewPendencia(p)) return false; } catch (_) {}
      return true;
    });
    el.innerHTML = `<div style="margin-bottom:12px"><button class="btn btn-primary btn-sm" onclick="closeModal();navigateTo('pendencias');setTimeout(()=>openPendenciaForm(null,'${id}'),100)">+ Nova Pendência</button></div>
      ${pens.length ? `<div class="table-wrapper"><table><thead><tr><th>Tipo</th><th>Assunto</th><th>Responsável</th><th>Status</th><th>Prioridade</th><th>Prazo</th><th></th></tr></thead><tbody>${pens.map(p=>`<tr class="cli-pen-row" tabindex="0" onclick="openClientPenRow(event,'${escapeHtml(id)}','${escapeHtml(p.id)}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openClientPenRow(event,'${escapeHtml(id)}','${escapeHtml(p.id)}')}"><td>${escapeHtml(p.tipo||'—')}</td><td>${escapeHtml(getPendenciaTitulo(p))}</td><td>${escapeHtml(p.responsible||'—')}</td><td>${statusTag(p.status)}</td><td>${priorityTag(p.priority)}</td><td>${p.deadline?formatDate(p.deadline):'—'}</td><td style="text-align:right"><button class="btn btn-sm btn-secondary" onclick="event.stopPropagation();openClientPendencia('${escapeHtml(id)}','${escapeHtml(p.id)}')" aria-label="Abrir pendência: ${escapeHtml(getPendenciaTitulo(p))}">Abrir</button></td></tr>`).join('')}</tbody></table></div>` : `<div class="empty-state"><p>Nenhuma pendência</p></div>`}`;
  }
}
