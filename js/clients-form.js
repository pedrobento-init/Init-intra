// clients-form.js – Formulário do cliente, logo, importador, planilha e auto-refresh.
// Parte de clients.js (dividido para facilitar manutenção). Scripts clássicos:
// carregam logo depois de clients.js e compartilham os mesmos globais.
// Nos testes, tests/_parts.cjs junta as partes na mesma ordem.

function openClientForm(id = null) {
  // Criação restrita a admin; edição (com id) segue liberada.
  if (!id && typeof isCurrentAdmin === 'function' && !isCurrentAdmin()) {
    if (typeof showToast === 'function') showToast('Apenas administradores podem cadastrar clientes.', 'error');
    return;
  }
  const c = id ? getClientById(id) : {};
  const lics = c.licenses || [];
  const esc = v => escapeHtml(v || '');
  openModal(id ? 'Editar Cliente' : 'Novo Cliente', `
    <form id="cliForm" class="ov-form" onsubmit="submitClientForm(event,'${id||''}')">
      <div class="form-section">
        <div class="form-section-title">Ícone do Cliente</div>
        <div style="display:flex;align-items:flex-start;gap:16px;margin-bottom:12px">
          <div id="logoPreview">${clientAvatar(c, 60)}</div>
          <div style="flex:1">
            <div class="form-group" style="margin-bottom:8px"><label class="form-label">Cor do avatar</label>
              <div style="display:flex;gap:6px;flex-wrap:wrap" id="colorPicker">
                ${COLORS.map(col=>`<div role="button" tabindex="0" aria-label="Cor ${col}" onclick="selectColor('${col}')" style="width:28px;height:28px;border-radius:50%;background:${col};cursor:pointer;border:3px solid ${(c.color||COLORS[0])===col?'#0f172a':'transparent'}" data-color="${col}"></div>`).join('')}
              </div>
            </div>
          <div class="form-row">
              <div class="form-group"><label class="form-label">Iniciais</label><input class="form-input" id="initialsInput" name="initials" maxlength="3" value="${esc(c.initials)}" oninput="updateLogoPreview()" /></div>
              <div class="form-group"><label class="form-label">URL da Logo (opcional)</label><input class="form-input" name="logo" id="logoUrlInput" value="${esc(c.logo && !c.logo.startsWith('data:') ? c.logo : '')}" placeholder="https://..." oninput="onLogoUrlChange()" /></div>
            </div>
            <div class="logo-upload-zone">
              <input type="file" id="logoFileInput" accept="image/*" style="display:none" onchange="onLogoFileSelected(event)" />
              <button type="button" class="logo-upload-btn" onclick="document.getElementById('logoFileInput').click()">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                Enviar Imagem
              </button>
              <button type="button" class="logo-crop-btn" id="cropBtn" onclick="openCropModal()" style="display:${c.logo?'inline-flex':'none'}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6.13 1L6 16a2 2 0 0 0 2 2h15"/><path d="M1 6.13L16 6a2 2 0 0 1 2 2v15"/></svg>
                Recortar
              </button>
              <button type="button" class="logo-remove-btn" id="removeLogoBtn" onclick="removeClientLogo()" style="display:${c.logo?'inline-flex':'none'}">
                ✕
              </button>
            </div>
            <div class="form-group" style="margin-top:8px">
              <label class="form-label">Formato da Logo</label>
              <div style="display:flex;gap:8px" id="shapePicker">
                <div class="logo-shape-option ${(c.logoShape||'circle')==='circle'?'selected':''}" role="button" tabindex="0" onclick="selectLogoShape('circle')" data-shape="circle">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>
                  Redondo
                </div>
                <div class="logo-shape-option ${(c.logoShape||'circle')==='square'?'selected':''}" role="button" tabindex="0" onclick="selectLogoShape('square')" data-shape="square">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="3"/></svg>
                  Quadrado
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="form-section">
        <div class="form-section-title">Identificação</div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Nome *</label><input class="form-input" name="name" value="${esc(c.name)}" required /></div>
          <div class="form-group"><label class="form-label">CNPJ / CPF</label><input class="form-input" name="cnpj" value="${esc(c.cnpj)}" /></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Segmento</label><input class="form-input" name="segment" value="${esc(c.segment)}" /></div>
          ${(() => {
            const opts = (typeof TEAM_OPTIONS !== 'undefined') ? TEAM_OPTIONS : [{ value: 'init', label: 'Init' }];
            const cur = c.team || 'init';
            const canEdit = (typeof isTeamAdmin === 'function') ? isTeamAdmin() : false;
            if (!canEdit) return `<input type="hidden" name="team" value="${esc(cur)}" />`;
            return `<div class="form-group"><label class="form-label">Equipe *</label><select class="form-select" name="team" required title="Time dono deste cliente (define quem visualiza as pendências)">${opts.map(o => `<option value="${escapeHtml(o.value)}" ${cur === o.value ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}</select></div>`;
          })()}
        </div>
      </div>
      <div class="form-section">
        <div class="form-section-title">Integração Milvus</div>
        <div class="form-group"><label class="form-label">Token do cliente no Milvus</label><input class="form-input" name="milvusClientToken" maxlength="64" value="${esc(c.milvusClientToken)}" placeholder="Ex.: ABC123" /><div style="font-size:11px;color:var(--text-muted);margin-top:4px">Identificador utilizado para localizar este cliente no Milvus. Deixe vazio se o cliente não utiliza Milvus.</div></div>
      </div>
      <div class="form-section">
        <div class="form-section-title">Responsáveis</div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Dono</label><input class="form-input" name="owner" value="${esc(c.owner)}" /></div>
          <div class="form-group"><label class="form-label">Contato</label><input class="form-input" name="ownerPhone" value="${esc(c.ownerPhone)}" /></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Responsável TI</label><input class="form-input" name="responsible" value="${esc(c.responsible)}" /></div>
          <div class="form-group"><label class="form-label">Contato</label><input class="form-input" name="responsiblePhone" value="${esc(c.responsiblePhone)}" /></div>
        </div>
        <div class="form-group"><label class="form-label">Técnico da Equipe</label><input class="form-input" name="technician" value="${esc(c.technician)}" /></div>
        <div class="form-group"><label class="form-label">Endereço</label><input class="form-input" name="address" value="${esc(c.address)}" placeholder="Rua, número - bairro, cidade" autocomplete="street-address" /></div>
      </div>
      <div class="form-section">
        <div class="form-section-title">Servidor</div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Tipo</label>
            <select class="form-select" name="server_type">${FICHA_OPTS.serverType.map(o=>`<option ${c.server?.type===o?'selected':''}>${o}</option>`).join('')}</select></div>
          <div class="form-group"><label class="form-label">SO</label><input class="form-input" name="server_os" value="${esc(c.server?.os)}" /></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">IP</label><input class="form-input" name="server_ip" value="${esc(c.server?.ip)}" /></div>
          <div class="form-group"><label class="form-label">Acesso Remoto</label>
            <select class="form-select" name="server_remoteAccess">${FICHA_OPTS.remoteAccess.map(o=>`<option ${c.server?.remoteAccess===o?'selected':''}>${o}</option>`).join('')}</select></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">ID / Endereço</label><input class="form-input" name="server_remoteId" value="${esc(c.server?.remoteId)}"${c.server?.remoteIdSet && !c.server?.remoteId ? ' placeholder="Guardado — preencha para trocar"' : ''} autocomplete="off" /></div>
          <div class="form-group"><label class="form-label">Obs</label><input class="form-input" name="server_notes" value="${esc(c.server?.notes)}" /></div>
        </div>
      </div>
      <div class="form-section">
        <div class="form-section-title">Hospedagem</div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Provedor</label><input class="form-input" name="hosting_provider" value="${esc(c.hosting?.provider)}" /></div>
          <div class="form-group"><label class="form-label">URL Painel</label><input class="form-input" name="hosting_panelUrl" value="${esc(c.hosting?.panelUrl)}" /></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Usuário</label><input class="form-input" name="hosting_user" value="${esc(c.hosting?.user)}" /></div>
          <div class="form-group"><label class="form-label">Obs</label><input class="form-input" name="hosting_notes" value="${esc(c.hosting?.notes)}" /></div>
        </div>
      </div>
      <div class="form-section">
        <div class="form-section-title">Backup</div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Frequência</label>
            <select class="form-select" name="backup_frequency">${FICHA_OPTS.backupFreq.map(o=>`<option ${c.backup?.frequency===o?'selected':''}>${o}</option>`).join('')}</select></div>
          <div class="form-group"><label class="form-label">Horário</label><input class="form-input" name="backup_time" value="${esc(c.backup?.time)}" /></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Destino</label><input class="form-input" name="backup_destination" value="${esc(c.backup?.destination)}" /></div>
          <div class="form-group"><label class="form-label">Ferramenta</label><input class="form-input" name="backup_tool" value="${esc(c.backup?.tool)}" /></div>
        </div>
        <div class="form-group"><label class="form-label">Última Verificação</label><input type="date" class="form-input" name="backup_lastCheck" value="${esc(c.backup?.lastCheck)}" /></div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Último backup</label><input type="datetime-local" class="form-input" name="backup_lastBackupAt" value="${esc(cfDateTimeLocalValue(c.backup?.lastBackupAt))}" /></div>
          <div class="form-group"><label class="form-label">Status do último backup</label>
            <select class="form-select" name="backup_lastBackupStatus"><option value="" ${!c.backup?.lastBackupStatus?'selected':''}>—</option>${['OK','Falhou'].map(o=>`<option ${c.backup?.lastBackupStatus===o?'selected':''}>${o}</option>`).join('')}</select></div>
        </div>
      </div>
      <div class="form-section">
        <div class="form-section-title">E-mail</div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Provedor</label><input class="form-input" name="emails_provider" value="${esc(c.emails?.provider)}" /></div>
          <div class="form-group"><label class="form-label">Domínio</label><input class="form-input" name="emails_domain" value="${esc(c.emails?.domain)}" /></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Servidor</label><input class="form-input" name="emails_server" value="${esc(c.emails?.server)}" /></div>
          <div class="form-group"><label class="form-label">Porta</label><input class="form-input" name="emails_port" value="${esc(c.emails?.port)}" /></div>
        </div>
        <div class="form-group"><label class="form-label">Quota</label><input class="form-input" name="emails_quota" value="${esc(c.emails?.quota)}" /></div>
      </div>
      <div class="form-section">
        <div class="form-section-title">Licenças</div>
        <div id="licContainer">${lics.map((l,i)=>licRow(l,i)).join('')}</div>
        <button type="button" class="btn btn-secondary btn-sm" onclick="addLicRow()">+ Licença</button>
      </div>
      <div class="form-section">
        <div class="form-section-title">Observações Gerais</div>
        <textarea class="form-textarea" name="notes" rows="3">${esc(c.notes)}</textarea>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn-primary"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Salvar</button>
      </div>
    </form>`, 'lg');
  window._selectedColor = c.color || COLORS[0];
  window._selectedLogoShape = c.logoShape || 'circle';
  window._currentLogoData = c.logo || '';
}

let _licIdx = 10;
function licRow(l={}, i=0) {
  const esc = v => escapeHtml(v || '');
  return `<div class="form-row" id="lr${i}" style="align-items:end;margin-bottom:8px">
    <div class="form-group" style="margin-bottom:0"><label class="form-label">Software</label><input class="form-input" name="ls_${i}" value="${esc(l.software)}" /></div>
    <div class="form-group" style="margin-bottom:0"><label class="form-label">Chave</label><input class="form-input" name="lk_${i}" value="${esc(l.key)}"${l.hasKey && !l.key ? ' placeholder="Guardada — preencha para trocar"' : ''} autocomplete="off" /><input type="hidden" name="lid_${i}" value="${esc(l.kid)}" /><input type="hidden" name="lh_${i}" value="${l.hasKey ? '1' : ''}" /></div>
    <div class="form-group" style="margin-bottom:0"><label class="form-label">Validade</label><input type="date" class="form-input" name="le_${i}" value="${esc(l.expiry)}" /></div>
    <button type="button" class="btn btn-danger btn-sm" style="flex-shrink:0" onclick="document.getElementById('lr${i}').remove()">✕</button>
  </div>`;
}
function addLicRow() {
  const d = document.createElement('div');
  d.innerHTML = licRow({}, _licIdx++);
  document.getElementById('licContainer').appendChild(d.firstElementChild);
}
function selectColor(col) {
  window._selectedColor = col;
  document.querySelectorAll('#colorPicker div').forEach(d => {
    d.style.border = `3px solid ${d.dataset.color === col ? '#0f172a' : 'transparent'}`;
  });
  updateLogoPreview();
}
function updateLogoPreview() {
  const initials = document.getElementById('initialsInput')?.value || '';
  const color = window._selectedColor || COLORS[0];
  const logo = window._currentLogoData || document.getElementById('logoUrlInput')?.value || '';
  const logoShape = window._selectedLogoShape || 'circle';
  const p = document.getElementById('logoPreview');
  if (p) p.innerHTML = clientAvatar({ initials, color, logo, logoShape }, 60);
  // Show/hide crop and remove buttons
  const hasLogo = !!logo;
  const cropBtn = document.getElementById('cropBtn');
  const removeBtn = document.getElementById('removeLogoBtn');
  if (cropBtn) cropBtn.style.display = hasLogo ? 'inline-flex' : 'none';
  if (removeBtn) removeBtn.style.display = hasLogo ? 'inline-flex' : 'none';
}

function selectLogoShape(shape) {
  window._selectedLogoShape = shape;
  document.querySelectorAll('#shapePicker .logo-shape-option').forEach(el => {
    el.classList.toggle('selected', el.dataset.shape === shape);
  });
  updateLogoPreview();
}

// ── Logo URL change handler ──
function onLogoUrlChange() {
  const url = (document.getElementById('logoUrlInput')?.value || '').trim();
  if (url && !/^https?:\/\//i.test(url) && !/^data:image\//i.test(url)) {
    window._currentLogoData = '';
  } else {
    window._currentLogoData = url;
  }
  updateLogoPreview();
}

// ── File upload handler ──
function onLogoFileSelected(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showToast('Selecione um arquivo de imagem válido.', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = function(ev) {
    window._currentLogoData = ev.target.result;
    // Clear URL input since we're using uploaded file
    const urlInput = document.getElementById('logoUrlInput');
    if (urlInput) urlInput.value = '';
    updateLogoPreview();
    // Automatically open crop modal
    openCropModal();
  };
  reader.readAsDataURL(file);
}

// ── Remove logo ──
function removeClientLogo() {
  window._currentLogoData = '';
  const urlInput = document.getElementById('logoUrlInput');
  if (urlInput) urlInput.value = '';
  const fileInput = document.getElementById('logoFileInput');
  if (fileInput) fileInput.value = '';
  updateLogoPreview();
  showToast('Logo removida.', 'info');
}

// ── Recorte básico local ──
let _cropImage = null;
let _cropSelectionRect = null;
let _cropDragStart = null;

function openCropModal() {
  const src = window._currentLogoData || document.getElementById('logoUrlInput')?.value || '';
  if (!src) {
    showToast('Nenhuma imagem para recortar. Envie ou defina uma URL primeiro.', 'error');
    return;
  }
  const img = document.getElementById('cropImage');
  _cropImage = null;
  _cropSelectionRect = null;
  const selection = document.getElementById('cropSelection');
  if (selection) selection.hidden = true;
  img.onload = function() {
    _cropImage = img;
    bindManualCropSelection();
  };
  img.onerror = function() {
    showToast('Não foi possível carregar a imagem. Verifique a URL ou envie um arquivo.', 'error');
    closeCropModal();
  };
  if (/^https?:\/\//i.test(src)) img.crossOrigin = 'anonymous';
  else img.removeAttribute('crossorigin');
  img.src = '';
  document.getElementById('cropModalOverlay').style.display = 'flex';
  img.src = src;
  if (img.complete && img.naturalWidth) {
    _cropImage = img;
    bindManualCropSelection();
  }
}

function bindManualCropSelection() {
  const img = document.getElementById('cropImage');
  if (!img || img.dataset.cropBound) return;
  img.dataset.cropBound = '1';
  img.addEventListener('pointerdown', function(e) {
    e.preventDefault();
    const r = img.getBoundingClientRect();
    _cropDragStart = { x: e.clientX - r.left, y: e.clientY - r.top };
    _cropSelectionRect = { x: _cropDragStart.x, y: _cropDragStart.y, w: 0, h: 0 };
    img.setPointerCapture(e.pointerId);
    updateManualCropSelection(r);
  });
  img.addEventListener('pointermove', function(e) {
    if (!_cropDragStart) return;
    updateManualCropSelection(img.getBoundingClientRect(), e);
  });
  img.addEventListener('pointerup', function(e) {
    if (_cropDragStart) updateManualCropSelection(img.getBoundingClientRect(), e);
    _cropDragStart = null;
  });
}

function updateManualCropSelection(bounds, event) {
  if (!_cropDragStart) return;
  const x = Math.max(0, Math.min(bounds.width, (event?.clientX ?? bounds.left + _cropDragStart.x) - bounds.left));
  const y = Math.max(0, Math.min(bounds.height, (event?.clientY ?? bounds.top + _cropDragStart.y) - bounds.top));
  const dx = x - _cropDragStart.x;
  const dy = y - _cropDragStart.y;
  const size = Math.min(Math.abs(dx), Math.abs(dy));
  const rect = {
    x: dx < 0 ? _cropDragStart.x - size : _cropDragStart.x,
    y: dy < 0 ? _cropDragStart.y - size : _cropDragStart.y,
    w: size,
    h: size,
  };
  _cropSelectionRect = rect;
  const selection = document.getElementById('cropSelection');
  if (selection) {
    selection.hidden = size < 2;
    selection.style.left = `${bounds.left - document.getElementById('cropContainer').getBoundingClientRect().left + rect.x}px`;
    selection.style.top = `${bounds.top - document.getElementById('cropContainer').getBoundingClientRect().top + rect.y}px`;
    selection.style.width = `${rect.w}px`;
    selection.style.height = `${rect.h}px`;
  }
}

function closeCropModal() {
  document.getElementById('cropModalOverlay').style.display = 'none';
  _cropImage = null;
}

function applyCrop() {
  if (!_cropImage) {
    showToast('A imagem ainda está carregando. Tente novamente.', 'error');
    return;
  }
  try {
    let canvas;
    const img = _cropImage;
    const displayed = img.getBoundingClientRect();
    const selected = _cropSelectionRect && _cropSelectionRect.w > 2
      ? _cropSelectionRect
      : { x: 0, y: 0, w: displayed.width, h: displayed.height };
    const scaleX = img.naturalWidth / displayed.width;
    const scaleY = img.naturalHeight / displayed.height;
    const sx = selected.x * scaleX;
    const sy = selected.y * scaleY;
    const size = Math.min(selected.w * scaleX, selected.h * scaleY);
    canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, size, size, 0, 0, 256, 256);
    if (!canvas) throw new Error('canvas indisponível');
    window._currentLogoData = canvas.toDataURL('image/png');
    const urlInput = document.getElementById('logoUrlInput');
    if (urlInput) urlInput.value = '';
    closeCropModal();
    updateLogoPreview();
    showToast('Logo recortada com sucesso!', 'success');
  } catch (_) {
    showToast('Não foi possível aplicar o recorte. Para imagens por URL, habilite CORS no servidor ou envie o arquivo.', 'error');
  }
}

function submitClientForm(e, id) {
  e.preventDefault();
  if (!id && typeof isCurrentAdmin === 'function' && !isCurrentAdmin()) {
    showToast('Apenas administradores podem cadastrar clientes.', 'error');
    return;
  }
  try {
    const fd = new FormData(e.target);
    const g = k => fd.get(k) || '';
    const lics = [];
    document.querySelectorAll('[id^="lr"]').forEach(row => {
      const i = row.id.replace('lr','');
      const s = fd.get(`ls_${i}`);
      if (!s) return;
      // kid liga a linha à chave guardada no cofre: chave vazia = mantém a guardada.
      const kid = fd.get(`lid_${i}`) || '';
      const lic = { software: s, key: fd.get(`lk_${i}`), expiry: fd.get(`le_${i}`) };
      if (kid) { lic.kid = kid; if (!lic.key && fd.get(`lh_${i}`) === '1') lic.hasKey = true; }
      lics.push(lic);
    });
    const logoValue = window._currentLogoData || g('logo');
    const existing = id ? getClientById(id) : null;
    const teamOpts = (typeof TEAM_OPTIONS !== 'undefined') ? TEAM_OPTIONS.map(o => o.value) : ['init'];
    const postedTeam = g('team');
    // Só admin pode trocar a equipe do cliente; demais preservam a atual
    // (nunca confia no POST: evita elevação via devtools).
    const canEditTeam = (typeof isTeamAdmin === 'function') ? isTeamAdmin() : false;
    const team = canEditTeam
      ? (teamOpts.includes(postedTeam) ? postedTeam : (existing?.team || getCurrentTeam()))
      : (existing?.team || getCurrentTeam());
    const clientData = {
      id: id||null, name:g('name'), cnpj:g('cnpj'), segment:g('segment'), team,
      milvusClientToken: normalizeMilvusClientToken(g('milvusClientToken')),
      color: window._selectedColor||COLORS[0], initials:g('initials'), logo: logoValue,
      logoShape: window._selectedLogoShape||'circle',
      owner:g('owner'), ownerPhone:g('ownerPhone'), responsible:g('responsible'),
      responsiblePhone:g('responsiblePhone'), technician:g('technician'), address:g('address').trim(),
      server:{type:g('server_type'),os:g('server_os'),ip:g('server_ip'),remoteAccess:g('server_remoteAccess'),remoteId:g('server_remoteId'),notes:g('server_notes'),
        // ID no cofre: campo vazio mantém o guardado (a marca não pode se perder).
        ...(!g('server_remoteId') && existing && existing.server && existing.server.remoteIdSet === true ? { remoteIdSet: true } : {})},
      hosting:{provider:g('hosting_provider'),panelUrl:g('hosting_panelUrl'),user:g('hosting_user'),notes:g('hosting_notes')},
      backup:{frequency:g('backup_frequency'),time:g('backup_time'),destination:g('backup_destination'),tool:g('backup_tool'),lastCheck:g('backup_lastCheck'),lastBackupAt:g('backup_lastBackupAt'),lastBackupStatus:g('backup_lastBackupStatus')},
      emails:{provider:g('emails_provider'),domain:g('emails_domain'),server:g('emails_server'),port:g('emails_port'),quota:g('emails_quota')},
      licenses:lics, notes:g('notes'),
    };
    if (typeof validateClient === 'function') {
      const errors = validateClient(clientData);
      if (errors.length) { showToast(errors[0], 'error'); return; }
    }
    saveClient(clientData);
    closeModal(); _refreshClientsInPlace(); updateBadges();
    showToast(id ? 'Cliente atualizado!' : 'Cliente cadastrado!', 'success');
  } catch (err) { showToast('Erro ao salvar cliente: ' + err.message, 'error'); }
}

// ── IMPORTADOR DE CLIENTES (Word / CSV / Colar) ──
const CLIENT_IMPORT_FIELDS = [
  { key: 'skip', label: '— Ignorar coluna —' },
  { key: 'name', label: 'Nome *', required: true },
  { key: 'cnpj', label: 'CNPJ / CPF' },
  { key: 'segment', label: 'Segmento' },
  { key: 'owner', label: 'Dono' },
  { key: 'ownerPhone', label: 'Telefone Dono' },
  { key: 'responsible', label: 'Responsável TI' },
  { key: 'responsiblePhone', label: 'Telefone Resp.' },
  { key: 'technician', label: 'Técnico' },
  { key: 'notes', label: 'Observações' },
  { key: 'team', label: 'Equipe' },
];

let _importRows = [];
let _importHasHeader = true;

function openImportClientsModal() {
  openModal('Importar Clientes', `
    <div style="margin-bottom:16px">
      <div style="font-size:13px;font-weight:600;margin-bottom:8px">1. Envie ou cole os dados</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px">
        <label class="btn btn-secondary" style="cursor:pointer">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg> Escolher arquivo (.docx, .csv, .txt)
          <input type="file" id="importFileInput" accept=".docx,.csv,.txt" style="display:none" onchange="handleImportFile(this)" />
        </label>
        <span style="font-size:12px;color:var(--text-muted);display:flex;align-items:center">ou</span>
        <button class="btn btn-secondary" onclick="document.getElementById('importPasteArea').style.display='block'"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Colar texto</button>
      </div>
      <textarea id="importPasteArea" class="form-textarea" rows="6" placeholder="Cole aqui os dados copiados do Word ou Excel...&#10;Exemplo:&#10;Nome | CNPJ | Segmento&#10;Padaria Central | 12.345.678/0001-90 | Alimentação" style="display:none;margin-bottom:8px" oninput="handleImportPaste(this.value)"></textarea>
    </div>
    <div id="importPreviewWrap" style="display:none">
      <div style="font-size:13px;font-weight:600;margin-bottom:8px">2. Preview e mapeamento de colunas</div>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;margin-bottom:8px;cursor:pointer">
        <input type="checkbox" id="importHasHeader" checked onchange="_importHasHeader=this.checked;renderImportPreview()" />
        Primeira linha é cabeçalho
      </label>
      <div id="importPreviewTable" style="max-height:300px;overflow:auto;border:1px solid var(--border);border-radius:6px;margin-bottom:12px"></div>
      <div id="importStats" style="font-size:12px;color:var(--text-muted);margin-bottom:12px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary" id="importBtn" onclick="executeClientImport()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Importar Clientes</button>
      </div>
    </div>
  `, 'lg');
}

async function handleImportFile(input) {
  const file = input.files[0];
  if (!file) return;
  const ext = file.name.split('.').pop().toLowerCase();
  const reader = new FileReader();

  if (ext === 'docx') {
    reader.onload = async function(e) {
      try {
        const arrayBuffer = e.target.result;
        const mammoth = await loadLib('mammoth');
        const result = await mammoth.convertToHtml({ arrayBuffer });
        const html = result.value;
        _importRows = extractRowsFromHtmlTable(html);
        if (!_importRows.length) {
          const textResult = await mammoth.extractRawText({ arrayBuffer });
          _importRows = parseDelimitedText(textResult.value);
        }
        renderImportPreview();
      } catch (err) {
        showToast('Erro ao ler .docx: ' + err.message, 'error');
      }
    };
    reader.readAsArrayBuffer(file);
  } else {
    reader.onload = function(e) {
      _importRows = parseDelimitedText(e.target.result);
      renderImportPreview();
    };
    reader.readAsText(file);
  }
}

// Token do cliente no Milvus: só trim. Sem lowercase, sem máscara, sem
// transformação — vazio vira '' (o sync grava NULL). Não é o segredo da API.
function normalizeMilvusClientToken(v) {
  return String(v === null || v === undefined ? '' : v).trim();
}

// Copia o token (visível na ficha) para uso na instalação do cliente Milvus.
function copyMilvusClientToken(clientId) {
  const c = typeof getClientById === 'function' ? getClientById(clientId) : null;
  const token = c ? String(c.milvusClientToken || '') : '';
  if (!token) {
    if (typeof showToast === 'function') showToast('Cliente sem token Milvus.', 'warning');
    return;
  }
  const done = () => { if (typeof showToast === 'function') showToast('Token copiado!', 'success'); };
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(token).then(done).catch(() => fallbackCopyMilvusToken(token, done));
    } else {
      fallbackCopyMilvusToken(token, done);
    }
  } catch (_) { fallbackCopyMilvusToken(token, done); }
}

function fallbackCopyMilvusToken(token, done) {
  try {
    const ta = document.createElement('textarea');
    ta.value = token;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    done();
  } catch (_) {
    if (typeof showToast === 'function') showToast('Não foi possível copiar.', 'error');
  }
}

// ── Planilha de documentação (Google Sheets, embed) ──
// Cada cliente tem sua própria planilha; o link fica em client.googleSheetUrl
// (coluna clients.google_sheet_url, sync bidirecional já mapeado). Gerenciar o
// vínculo é restrito a admin; visualizar segue a regra da aba (equipe).

// Extrai o link da planilha em um dos formatos aceitos (puro, testável):
// - URL de compartilhamento /spreadsheets/d/<ID>/... → { kind:'sheet' }
// - URL de "Publicar na web" /spreadsheets/d/e/<PUBID>/pubhtml → { kind:'published' }
// - ID colado diretamente → { kind:'sheet' }
// Retorna null se não reconhecer.
function parseGoogleSheetLink(v) {
  const s = String(v === null || v === undefined ? '' : v).trim();
  if (!s) return null;
  let m = s.match(/docs\.google\.com\/spreadsheets\/d\/e\/([a-zA-Z0-9-_]+)/);
  if (m) return { kind: 'published', id: m[1] };
  m = s.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  // '/d/e/...' já tratado acima; um ID real nunca é o literal 'e'.
  if (m && m[1] !== 'e') return { kind: 'sheet', id: m[1] };
  if (/^[a-zA-Z0-9-_]{20,}$/.test(s)) return { kind: 'sheet', id: s };
  return null;
}

// Extrai o ID da planilha de uma URL do Google Sheets ou do próprio ID colado.
// Retorna o ID ou null (puro, testável).
function parseGoogleSheetId(v) {
  const p = parseGoogleSheetLink(v);
  return p ? p.id : null;
}

// Extrai o ID da pasta do Google Drive de uma URL de pasta ou do ID colado cru.
// Puro e testável. O ID é aceito só como token seguro para URL: é isso que
// recusa aspa, '<' e espaço — o vetor do SEC-18, em que uma URL de texto livre
// virava atributo HTML. Não há suposição sobre o comprimento exato do ID, que o
// Google já mudou com o tempo; o que identifica a pasta é o segmento /folders/.
function parseDriveFolderId(v) {
  const s = String(v === null || v === undefined ? '' : v).trim();
  if (!s) return null;
  const m = s.match(/^https?:\/\/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([a-zA-Z0-9_-]{15,})\/?(?:[?#].*)?$/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{15,}$/.test(s)) return s;
  return null;
}

// Remonta a URL canônica da pasta a partir do ID: o texto colado pelo usuário
// nunca chega ao href. Retorna '' se inválido (puro, testável).
function driveFolderUrl(v) {
  const id = parseDriveFolderId(v);
  return id ? 'https://drive.google.com/drive/folders/' + id : '';
}

// Monta a URL de embed a partir do link/ID salvo:
// - sheet: .../edit?usp=sharing&embedded=true (a URL normal /edit é bloqueada
//   em iframe pelo Google via X-Frame-Options — daí a conversão; exige a
//   planilha compartilhada como "qualquer pessoa com o link pode visualizar").
// - published: .../d/e/<PUBID>/pubhtml?widget=true (exige Arquivo > Publicar
//   na web; somente leitura, sem login).
// Retorna '' se inválido (puro, testável).
function googleSheetEmbedUrl(v) {
  const p = parseGoogleSheetLink(v);
  if (!p) return '';
  if (p.kind === 'published') {
    return 'https://docs.google.com/spreadsheets/d/e/' + p.id + '/pubhtml?widget=true&headers=false';
  }
  return 'https://docs.google.com/spreadsheets/d/' + p.id + '/edit?usp=sharing&embedded=true';
}

function _canManageClientSheet() {
  try { return typeof isCurrentAdmin === 'function' ? isCurrentAdmin() : false; }
  catch (_) { return false; }
}

function renderClientSheetSection(clientId) {
  const body = document.getElementById('cliSheetBody');
  const actions = document.getElementById('cliSheetActions');
  if (!body) return;
  const c = typeof getClientById === 'function' ? getClientById(clientId) : null;
  const saved = c ? String(c.googleSheetUrl || '').trim() : '';
  const embed = googleSheetEmbedUrl(saved);
  const canManage = _canManageClientSheet();
  const safeId = escapeHtml(clientId);
  if (actions) {
    if (!embed) {
      actions.innerHTML = canManage ? `<button class="btn btn-primary btn-sm" onclick="openSheetLinkModal('${safeId}')">+ Vincular planilha</button>` : '';
    } else {
      actions.innerHTML =
        `<a class="btn btn-secondary btn-sm" href="${escapeHtml(saved)}" target="_blank" rel="noopener">Abrir no Google Sheets ↗</a>` +
        (canManage ? `<button class="btn btn-secondary btn-sm" onclick="openSheetLinkModal('${safeId}')">Editar link</button><button class="btn btn-sm btn-danger" onclick="removeSheetLinkConfirm('${safeId}')">Remover</button>` : '');
    }
  }
  if (!embed) {
    body.innerHTML = '<div class="empty-state"><p>Nenhuma planilha vinculada.</p></div>';
    return;
  }
  const kind = (function(){ try { const p = parseGoogleSheetLink(saved); return p ? p.kind : 'sheet'; } catch (_) { return 'sheet'; } })();
  const hint = kind === 'published'
    ? 'Planilha publicada na web (somente leitura, sem login). Para editar, use o botão abaixo.'
    : 'A planilha precisa estar compartilhada como “Qualquer pessoa com o link pode visualizar” para carregar aqui. Se aparecer a tela de login do Google, ajuste o compartilhamento na planilha.';
  body.innerHTML = `
    <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">${hint}</div>
    <iframe src="${escapeHtml(embed)}" style="width:100%;height:600px;border:1px solid var(--border);border-radius:8px;background:var(--bg-surface)" loading="lazy" title="Planilha de documentação"></iframe>`;
}

function openSheetLinkModal(clientId) {
  if (!_canManageClientSheet()) {
    if (typeof showToast === 'function') showToast('Apenas administradores podem vincular a planilha.', 'error');
    return;
  }
  const c = typeof getClientById === 'function' ? getClientById(clientId) : null;
  const cur = c ? String(c.googleSheetUrl || '') : '';
  const safeId = escapeHtml(clientId);
  openModal('📊 Vincular planilha de documentação', `
    <div class="form-group"><label class="form-label">Link do Google Sheets</label><input class="form-input" id="sheetLinkInput" value="${escapeHtml(cur)}" placeholder="https://docs.google.com/spreadsheets/d/..." /></div>
    <p style="font-size:12px;color:var(--text-muted)">Cole o link de <strong>compartilhamento</strong> (…/spreadsheets/d/…) ou o de <strong>Publicar na web</strong> (…/spreadsheets/d/e/…/pubhtml). No primeiro caso, compartilhe no Google como “Qualquer pessoa com o link pode visualizar”. Para desvincular, apague o campo e salve.</p>
    <div class="form-actions"><button type="button" class="btn btn-secondary" onclick="viewClient('${safeId}');switchClientTab('documentos','${safeId}')">Cancelar</button><button type="button" class="btn btn-primary" onclick="saveSheetLink('${safeId}')">Salvar</button></div>
    <div id="sheetLinkMsg" style="font-size:13px;margin-top:8px"></div>`);
}

function saveSheetLink(clientId) {
  if (!_canManageClientSheet()) {
    if (typeof showToast === 'function') showToast('Apenas administradores podem vincular a planilha.', 'error');
    return;
  }
  const input = document.getElementById('sheetLinkInput');
  const raw = input ? String(input.value || '').trim() : '';
  const setMsg = (html) => { const m = document.getElementById('sheetLinkMsg'); if (m) m.innerHTML = html; };
  if (raw && !parseGoogleSheetId(raw)) {
    setMsg('<span style="color:var(--danger,#dc2626)">Link inválido. Cole uma URL do Google Sheets (docs.google.com/spreadsheets/...).</span>');
    return;
  }
  try {
    const existing = typeof getClientById === 'function' ? getClientById(clientId) : null;
    if (!existing) {
      if (typeof showToast === 'function') showToast('Cliente não encontrado.', 'error');
      return;
    }
    saveClient({ ...existing, id: clientId, googleSheetUrl: raw || null });
    viewClient(clientId);
    switchClientTab('documentos', clientId);
    showToast(raw ? 'Planilha vinculada!' : 'Planilha desvinculada.', 'success');
  } catch (err) { showToast('Erro ao salvar: ' + (err && err.message ? err.message : err), 'error'); }
}

function removeSheetLinkConfirm(clientId) {
  if (!_canManageClientSheet()) {
    if (typeof showToast === 'function') showToast('Apenas administradores podem remover a planilha.', 'error');
    return;
  }
  confirmAction('Desvincular a planilha de documentação deste cliente?', function() {
    const existing = typeof getClientById === 'function' ? getClientById(clientId) : null;
    if (!existing) return;
    saveClient({ ...existing, id: clientId, googleSheetUrl: null });
    viewClient(clientId);
    switchClientTab('documentos', clientId);
    showToast('Planilha desvinculada.', 'success');
  });
}

function handleImportPaste(text) {
  if (!text || text.trim().length < 3) return;
  _importRows = parseDelimitedText(text);
  renderImportPreview();
}

function parseDelimitedText(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const firstLine = lines[0];
  let delim = '\t';
  const counts = {
    '\t': (firstLine.match(/\t/g) || []).length,
    ';': (firstLine.match(/;/g) || []).length,
    '|': (firstLine.match(/\|/g) || []).length,
    ',': (firstLine.match(/,/g) || []).length,
  };
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (best[1] > 0) delim = best[0];

  return lines.map(line => {
    if (delim === ',') return parseCsvLine(line);
    return line.split(delim).map(c => c.trim());
  });
}

function parseCsvLine(line) {
  const cells = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];
    if (inQuotes) {
      if (char === '"') {
        if (next === '"') { cell += '"'; i++; }
        else { inQuotes = false; }
      } else {
        cell += char;
      }
    } else {
      if (char === '"') { inQuotes = true; }
      else if (char === ',') { cells.push(cell.trim()); cell = ''; }
      else { cell += char; }
    }
  }
  cells.push(cell.trim());
  return cells;
}

function extractRowsFromHtmlTable(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const tables = doc.querySelectorAll('table');
  if (!tables.length) return [];
  let bestTable = tables[0];
  let bestRows = 0;
  tables.forEach(t => { if (t.rows.length > bestRows) { bestRows = t.rows.length; bestTable = t; } });
  return Array.from(bestTable.rows).map(row => Array.from(row.cells).map(c => c.textContent.trim()));
}

function renderImportPreview() {
  const wrap = document.getElementById('importPreviewWrap');
  const tableDiv = document.getElementById('importPreviewTable');
  const statsDiv = document.getElementById('importStats');
  const importBtn = document.getElementById('importBtn');
  if (!_importRows.length || !tableDiv) return;

  wrap.style.display = 'block';
  const hasHeader = document.getElementById('importHasHeader')?.checked ?? true;
  const headerRow = hasHeader ? _importRows[0] : _importRows[0].map((_, i) => `Col ${i + 1}`);
  const dataRows = hasHeader ? _importRows.slice(1) : _importRows;
  const validRows = dataRows.filter(r => r.some(c => c.trim()));

  // Build column mapping dropdowns
  const mapHtml = headerRow.map((h, i) => `
    <select class="form-select" id="importCol_${i}" style="font-size:11px;padding:2px 6px;max-width:140px" onchange="updateImportMapping()">
      ${CLIENT_IMPORT_FIELDS.map(f => `<option value="${f.key}">${f.label}</option>`).join('')}
    </select>
  `).join('');

  // Auto-detect mapping
  setTimeout(() => {
    headerRow.forEach((h, i) => {
      const lower = h.toLowerCase();
      const select = document.getElementById(`importCol_${i}`);
      if (!select) return;
      for (const f of CLIENT_IMPORT_FIELDS) {
        const keywords = {
          name: ['nome', 'razão social', 'empresa', 'cliente'],
          cnpj: ['cnpj', 'cpf', 'documento'],
          segment: ['segmento', 'ramo', 'área'],
          owner: ['dono', 'proprietário', 'owner'],
          ownerPhone: ['tel dono', 'fone dono', 'telefone dono'],
          responsible: ['resp', 'responsável', 'ti'],
          responsiblePhone: ['tel resp', 'fone resp'],
          technician: ['técnico', 'tecnico', 'tech'],
          notes: ['obs', 'notas', 'observação'],
          team: ['equipe', 'time', 'team'],
        };
        const kw = keywords[f.key];
        if (kw && kw.some(k => lower.includes(k))) {
          select.value = f.key;
          break;
        }
      }
    });
    updateImportMapping();
  }, 50);

  // Show preview (first 8 rows)
  const previewRows = validRows.slice(0, 8);
  const colCount = headerRow.length;
  tableDiv.innerHTML = `
    <table style="font-size:12px;width:100%;border-collapse:collapse">
      <thead>
        <tr style="background:var(--bg-base)">
          <th style="padding:6px 8px;border-bottom:2px solid var(--border);font-size:10px;text-transform:uppercase;color:var(--text-muted);position:sticky;top:0;background:var(--bg-base)">#</th>
          ${headerRow.map((h, i) => `<th style="padding:6px 8px;border-bottom:2px solid var(--border);position:sticky;top:0;background:var(--bg-base)"><div style="margin-bottom:4px;font-weight:600">${escapeHtml(h)}</div>${mapHtml.split('</select>')[i] + '</select>'}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${previewRows.map((row, ri) => `<tr style="border-bottom:1px solid var(--border)">
          <td style="padding:4px 8px;color:var(--text-muted);font-size:11px">${ri + 1}</td>
          ${row.map((c, ci) => `<td style="padding:4px 8px;${ci >= colCount ? 'display:none' : ''}">${escapeHtml(c)}</td>`).join('')}
          ${Array(Math.max(0, colCount - row.length)).fill('<td style="padding:4px 8px;color:var(--text-muted)">—</td>').join('')}
        </tr>`).join('')}
        ${validRows.length > 8 ? `<tr><td colspan="${colCount + 1}" style="padding:8px;text-align:center;color:var(--text-muted);font-size:11px">...e mais ${plural(validRows.length - 8, 'linha', 'linhas')}</td></tr>` : ''}
      </tbody>
    </table>
  `;

  statsDiv.textContent = `${plural(validRows.length, 'linha', 'linhas')} para importar · ${plural(headerRow.length, 'coluna', 'colunas')}`;
  if (importBtn) importBtn.style.display = validRows.length ? 'inline-flex' : 'none';
}

function updateImportMapping() {}

function executeClientImport() {
  const hasHeader = document.getElementById('importHasHeader')?.checked ?? true;
  const dataRows = hasHeader ? _importRows.slice(1) : _importRows;
  const validRows = dataRows.filter(r => r.some(c => c.trim()));
  const headerRow = hasHeader ? _importRows[0] : _importRows[0].map((_, i) => `Col ${i + 1}`);

  const mapping = {};
  headerRow.forEach((_, i) => {
    const sel = document.getElementById(`importCol_${i}`);
    if (sel && sel.value && sel.value !== 'skip') {
      mapping[i] = sel.value;
    }
  });

  if (!Object.values(mapping).includes('name')) {
    showToast('Mapeie pelo menos uma coluna como "Nome" para importar.', 'error');
    return;
  }

  let created = 0;
  let skipped = 0;
  const currentTeam = getCurrentTeam();

  for (const row of validRows) {
    const randBuf = new Uint32Array(1);
    crypto.getRandomValues(randBuf);
    const clientData = {
      team: currentTeam,
      color: COLORS[randBuf[0] % COLORS.length],
      initials: '',
      server: {}, hosting: {}, backup: {}, emails: {}, licenses: [],
    };
    for (const [colIdx, fieldKey] of Object.entries(mapping)) {
      const idx = parseInt(colIdx);
      const val = row[idx] || '';
      if (fieldKey === 'name') {
        clientData.name = val;
        clientData.initials = val.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
      } else {
        clientData[fieldKey] = val;
      }
    }
    if (!clientData.name || !clientData.name.trim()) { skipped++; continue; }
    if (typeof validateClient === 'function') {
      const errors = validateClient(clientData);
      if (errors.length) { skipped++; continue; }
    }
    try { saveClient(clientData); created++; }
    catch (_) { skipped++; }
  }

  closeModal();
  _refreshClientsInPlace(); // reconstrói o filtro (importados visíveis mesmo com busca ativa)
  updateBadges();
  showToast(`${plural(created, 'cliente importado', 'clientes importados')}${skipped ? ` · ${plural(skipped, 'linha ignorada', 'linhas ignoradas')}` : ''}`, 'success');
}

// ── Auto-refresh global (preserva filtros/paginação/scroll) ──
function _refreshClientsInPlace(){
  try{
    var q=(document.getElementById('clientSearch')?.value||'').toLowerCase();
    var all=typeof getMyClients==='function'?getMyClients(): (typeof getClients==='function'?getClients():[]);
    _filteredClients = q ? all.filter(function(c){ return (c.name||'').toLowerCase().indexOf(q)!==-1 || (c.segment||'').toLowerCase().indexOf(q)!==-1; }) : all;
    preserveScrollAround(function(){ renderClientGrid(); });
  }catch(_){ try{ renderClientGrid(); }catch(_){} }
}
(function(){
  if(typeof window==='undefined' || typeof onDataChanged!=='function') return;
  if(window._cliAutoRefresh) return;
  window._cliAutoRefresh=true;
  onDataChanged('clientes', function(){
    var h=(window.location.hash.replace('#','')||'dashboard');
    if(h!=='clientes') return;
    _refreshClientsInPlace();
  });
  // Procedimentos aplicados a clientes (templates, outra aba, realtime):
  // re-renderiza a aba ativa da ficha aberta, sem apagar rascunho em edição.
  onDataChanged('procedimentos', function(){
    try{
      var tab=(typeof document!=='undefined')?document.getElementById('clientTabContent'):null;
      if(!tab) return;
      if(tab.querySelector('input:focus, textarea:focus, select:focus')) return;
      var active=document.querySelector('#clientTabs .tab.active');
      var oc=active?(active.getAttribute('onclick')||''):'';
      var m=oc.match(/switchClientTab\('([^']+)','([^']+)'\)/);
      if(!m || typeof renderClientTab!=='function') return;
      var sc=tab.scrollTop;
      renderClientTab(m[1], m[2]);
      try{ tab.scrollTop=sc; }catch(_){}
    }catch(_){}
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildClientNarrative, normalizeMilvusClientToken, parseGoogleSheetId, parseGoogleSheetLink, googleSheetEmbedUrl,
    parseDriveFolderId, driveFolderUrl,
    // Ficha TI (aba "Ficha TI" do modal de cliente)
    cfGet, cfSet, cfFilled, cfFormatWhen, cfDateTimeLocalValue, cfProgress, cfClientSince,
    cfSectionCount, cfUpdatedMeta, buildClientSummary, renderClientFicha, FICHA_SECTIONS, FICHA_QUICK_KEYS,
  };
}
