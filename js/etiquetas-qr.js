// etiquetas-qr.js — QR code nos equipamentos dos clientes.
// Etiquetas para imprimir (A4, 3 × 7 — Pimaco A4356/6180 e similares):
// - inventário Milvus do cliente (aba Inventário → "Etiquetas QR");
// - equipamento em conserto (menu ⋯ → "Etiqueta QR").
// O QR abre o Intra em ?disp=<id> ou ?equip=<id>: depois do login, mostra o
// dispositivo (com atalho para pendência) ou abre o equipamento.
// Biblioteca qrcode-generator sob demanda (lazy-libs.js, com SRI).

const QR_ALVO_KEY = 'intra_qr_alvo';

function qrLink(tipo, id) {
  const base = location.origin + location.pathname.replace(/index\.html$/, '');
  return base + '?' + tipo + '=' + encodeURIComponent(id);
}

async function qrSvg(texto) {
  const qrcode = await loadLib('qrcode');
  const q = qrcode(0, 'M');
  q.addData(texto);
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
}

// ── Impressão ───────────────────────────────────────────────────────────────

/** itens: [{ link, titulo, linhas: [] }] → página de etiquetas e diálogo de impressão. */
async function imprimirEtiquetas(itens) {
  if (!itens.length) return;
  let svgs;
  try { svgs = await Promise.all(itens.map((i) => qrSvg(i.link))); } catch (e) {
    showToast(e && e.message ? e.message : 'Não foi possível gerar os QR codes.', 'error');
    return;
  }
  document.getElementById('qrPrint')?.remove();
  const box = document.createElement('div');
  box.id = 'qrPrint';
  box.innerHTML = itens.map((i, n) => `
    <div class="qr-etq">
      <div class="qr-etq-code">${svgs[n]}</div>
      <div class="qr-etq-txt">
        <b>${escapeHtml(i.titulo)}</b>
        ${i.linhas.filter(Boolean).map((l) => `<span>${escapeHtml(l)}</span>`).join('')}
        <small>Init TI · escaneie para suporte</small>
      </div>
    </div>`).join('');
  document.body.appendChild(box);
  document.body.classList.add('printing-qr');
  const fim = () => { document.body.classList.remove('printing-qr'); box.remove(); window.removeEventListener('afterprint', fim); };
  window.addEventListener('afterprint', fim);
  setTimeout(() => window.print(), 50);
}

const _dispNome = (d) => d.apelido || d.hostname || 'Dispositivo';

async function abrirEtiquetasDispositivos(clientId) {
  const c = typeof getClientById === 'function' ? getClientById(clientId) : null;
  let devs = [];
  try { devs = await getClientDevices(clientId); } catch (_) { devs = []; }
  if (!devs.length) { showToast('Nenhum dispositivo no inventário deste cliente.', 'info'); return; }
  openModal('Etiquetas QR — ' + (c ? c.name : ''), `
    <p class="feed-lead">Marque os equipamentos e imprima numa folha de etiquetas A4 (3 × 7). Na impressão, escolha <b>Tamanho real / 100%</b> e sem margens extras.</p>
    <label style="display:flex;gap:8px;font-size:13px;margin-bottom:8px"><input type="checkbox" data-qr-todos checked /> Todos (${devs.length})</label>
    <div class="qr-lista">${devs.map((d) => `
      <label class="qr-item"><input type="checkbox" data-qr-disp="${escapeHtml(d.id)}" checked />
        <span><b>${escapeHtml(_dispNome(d))}</b> ${escapeHtml([d.tipo_dispositivo_text, d.numero_serial].filter(Boolean).join(' · '))}</span></label>`).join('')}</div>
    <div class="form-actions"><button type="button" class="btn btn-secondary" data-qr-fechar>Fechar</button>
      <button type="button" class="btn btn-primary" data-qr-imprimir="${escapeHtml(clientId)}">🖨️ Imprimir etiquetas</button></div>`);
  _qrDevsAbertos = devs;
}
let _qrDevsAbertos = [];

function _qrImprimirSelecionados(clientId) {
  const c = typeof getClientById === 'function' ? getClientById(clientId) : null;
  const marcados = new Set([...document.querySelectorAll('[data-qr-disp]:checked')].map((x) => x.dataset.qrDisp));
  const itens = _qrDevsAbertos.filter((d) => marcados.has(d.id)).map((d) => ({
    link: qrLink('disp', d.id), titulo: _dispNome(d),
    linhas: [d.numero_serial ? 'S/N ' + d.numero_serial : '', [d.marca, d.modelo_notebook].filter(Boolean).join(' '), c ? c.name : ''],
  }));
  if (!itens.length) { showToast('Marque ao menos um equipamento.', 'warning'); return; }
  imprimirEtiquetas(itens);
}

function imprimirEtiquetaEquipamento(id) {
  const e = typeof getEquipamentoById === 'function' ? getEquipamentoById(id) : null;
  if (!e) return;
  imprimirEtiquetas([{ link: qrLink('equip', e.id), titulo: e.nome || 'Equipamento',
    linhas: [e.numeroSerie ? 'S/N ' + e.numeroSerie : '', e.tipo || '', e.clientName || ''] }]);
}

// ── Abrir pelo QR ───────────────────────────────────────────────────────────

async function abrirDispositivoQr(id) {
  let d = null;
  try {
    const { data } = await supabaseClient.from('client_devices').select('*').eq('id', id).maybeSingle();
    d = data;
  } catch (_) { d = null; }
  if (!d) { showToast('Equipamento não encontrado (ou de outra equipe).', 'warning'); return; }
  const c = typeof getClientById === 'function' ? getClientById(d.client_id) : null;
  const linha = (k, v) => v ? `<div class="info-item"><div class="info-key">${k}</div><div class="info-value">${escapeHtml(String(v))}</div></div>` : '';
  const quando = (iso) => iso ? (typeof formatDateTime === 'function' ? formatDateTime(iso) : new Date(iso).toLocaleString('pt-BR')) : '';
  openModal(_dispNome(d), `
    <div class="info-grid">
      ${linha('Cliente', c ? c.name : '')}${linha('Hostname', d.hostname)}${linha('Tipo', d.tipo_dispositivo_text)}
      ${linha('Marca / modelo', [d.marca || d.placa_mae, d.modelo_notebook].filter(Boolean).join(' '))}${linha('Nº de série', d.numero_serial)}
      ${linha('Sistema', d.sistema_operacional)}${linha('Usuário logado', d.usuario_logado)}${linha('IP interno', d.ip_interno)}
      ${linha('Garantia até', d.data_garantia ? formatDate(d.data_garantia) : '')}${linha('Última comunicação (Milvus)', quando(d.data_ultima_atualizacao))}
    </div>
    <div class="form-actions">
      ${c ? `<button type="button" class="btn btn-secondary" data-qr-cliente="${escapeHtml(c.id)}">Ficha do cliente</button>` : ''}
      <button type="button" class="btn btn-primary" data-qr-pendencia="${escapeHtml(d.id)}">+ Pendência para este equipamento</button>
    </div>`);
  _qrDispAberto = d;
}
let _qrDispAberto = null;

function _qrAbrirAlvo(alvo) {
  if (alvo.tipo === 'disp') abrirDispositivoQr(alvo.id);
  else if (alvo.tipo === 'equip') {
    navigateTo('equipamentos');
    setTimeout(() => { if (typeof openEquipForm === 'function') openEquipForm(alvo.id); }, 200);
  }
}

// ?disp= / ?equip= chega antes do login: guarda, limpa o endereço e abre
// quando o app estiver pronto (sessão + Supabase).
(function () {
  if (typeof window === 'undefined' || !window.location) return;
  const q = new URLSearchParams(window.location.search);
  const tipo = q.has('disp') ? 'disp' : q.has('equip') ? 'equip' : null;
  if (tipo) {
    try { sessionStorage.setItem(QR_ALVO_KEY, JSON.stringify({ tipo, id: q.get(tipo) })); } catch (_) {}
    try { history.replaceState(null, '', window.location.pathname + window.location.hash); } catch (_) {}
  }
  let alvo = null;
  try { alvo = JSON.parse(sessionStorage.getItem(QR_ALVO_KEY) || 'null'); } catch (_) {}
  if (!alvo || !alvo.id) return;
  let tentativas = 0;
  const t = setInterval(() => {
    tentativas++;
    const pronto = window._supabaseAuthActive === true && typeof getSession === 'function' && getSession()
      && typeof supabaseClient !== 'undefined' && typeof navigateTo === 'function';
    if (pronto) {
      clearInterval(t);
      try { sessionStorage.removeItem(QR_ALVO_KEY); } catch (_) {}
      setTimeout(() => _qrAbrirAlvo(alvo), 600);
    } else if (tentativas > 600) clearInterval(t);  // 5 min sem login: desiste
  }, 500);
})();

if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('click', (e) => {
    const t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    const inv = t.closest('[data-qr-inventario]');
    if (inv) { abrirEtiquetasDispositivos(inv.dataset.qrInventario); return; }
    const imp = t.closest('[data-qr-imprimir]');
    if (imp) { _qrImprimirSelecionados(imp.dataset.qrImprimir); return; }
    const eq = t.closest('[data-qr-equip]');
    if (eq) { imprimirEtiquetaEquipamento(eq.dataset.qrEquip); return; }
    if (t.closest('[data-qr-fechar]')) { closeModal(); return; }
    const cli = t.closest('[data-qr-cliente]');
    if (cli) { viewClient(cli.dataset.qrCliente); return; }
    if (t.closest('[data-qr-pendencia]') && _qrDispAberto) {
      const d = _qrDispAberto;
      closeModal();
      navigateTo('pendencias');
      setTimeout(() => openPendenciaForm(null, d.client_id, null, {
        assunto: 'Equipamento ' + _dispNome(d),
        descricao: 'Aberta pelo QR do equipamento ' + _dispNome(d) + (d.numero_serial ? ' (S/N ' + d.numero_serial + ')' : '') + '.',
      }), 150);
    }
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t && t.matches && t.matches('[data-qr-todos]')) document.querySelectorAll('[data-qr-disp]').forEach((x) => { x.checked = t.checked; });
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { qrLink };
}
