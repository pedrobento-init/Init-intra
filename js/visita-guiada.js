// visita-guiada.js – Atendimento guiado da visita (pensado para o celular).
// Uma etapa por tela, com a ação principal sempre no rodapé:
//   Chegada → Fotos → Relatório → Assinatura → Concluir
// Reaproveita o que já existe: Cheguei/Saí (visita-campo.js), O que levar
// (visita-levar.js), fotos (visit-photos.js), IA do relatório (ia-relatorio.js),
// assinatura (visit-signature.js) e a conclusão (concludeVisit em visitas.js).
// Cada etapa grava ao avançar (offline-first, vai no sync da visita); o texto
// do relatório também fica como rascunho no aparelho enquanto é digitado.

const CW_PASSOS = [
  { k: 'chegada', t: 'Chegada' },
  { k: 'fotos', t: 'Fotos' },
  { k: 'relatorio', t: 'Relatório' },
  { k: 'assinatura', t: 'Assinatura' },
  { k: 'concluir', t: 'Concluir' },
];
const CW_KEY = 'intra_cw_';          // + id: etapa onde parou
const CW_DRAFT = 'intra_cw_draft_';  // + id: rascunho do relatório

let _cw = null; // { id, passo, refazerAssinatura }

/** Etapa para (re)começar: onde parou ou, sem isso, pelo que a visita já tem (puro). */
function cwPassoInicial(v, salvo) {
  if (!v) return 0;
  const n = salvo === null || salvo === undefined || salvo === '' ? NaN : Number(salvo);
  if (Number.isInteger(n) && n >= 0 && n < CW_PASSOS.length && (n === 0 || v.checkinAt)) return n;
  if (!v.checkinAt) return 0;
  const temRelatorio = !!String(v.relatorio || '').trim();
  if (!temRelatorio) return 1;
  return typeof isValidSignature === 'function' && isValidSignature(v.assinatura) ? 4 : 3;
}

/** Itens do resumo da etapa Concluir (puro). */
function cwResumo(v, nFotos) {
  const hhmm = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const assinou = typeof isValidSignature === 'function' && isValidSignature(v.assinatura);
  return [
    { ok: !!v.checkinAt, passo: 0, texto: v.checkinAt ? 'Chegada às ' + hhmm(v.checkinAt) : 'Chegada não registrada' },
    { ok: nFotos > 0, passo: 1, texto: nFotos > 0 ? (nFotos === 1 ? '1 foto' : nFotos + ' fotos') : 'Nenhuma foto' },
    { ok: !!String(v.relatorio || '').trim(), passo: 2, obrigatorio: true, texto: String(v.relatorio || '').trim() ? 'Relatório preenchido' : 'Falta o relatório' },
    { ok: assinou, passo: 3, texto: assinou ? 'Assinado por ' + (v.assinaturaNome || 'cliente') : 'Sem assinatura do cliente' },
  ];
}

function _cwGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
function _cwSet(k, val) { try { if (val === null) localStorage.removeItem(k); else localStorage.setItem(k, String(val)); } catch (_) {} }

function openVisitaGuiada(id, passo) {
  const v = getVisitById(id);
  if (!v) return;
  if (v.status === 'concluida' || v.status === 'cancelada') { openVisitDetail(id); return; }
  _cw = { id, passo: Number.isInteger(passo) ? passo : cwPassoInicial(v, _cwGet(CW_KEY + id)), refazerAssinatura: false };
  const num = typeof formatVisitNumero === 'function' ? formatVisitNumero(v) : '';
  openModal((v.clientName || 'Visita') + (num ? ' · ' + num : ''),
    '<div class="cw" id="cw">' +
      '<ol class="cw-steps" id="cwSteps" aria-label="Etapas do atendimento"></ol>' +
      '<div class="cw-body" id="cwBody"></div>' +
      '<div class="cw-bar" id="cwBar"></div>' +
    '</div>', 'cw-modal');
  _cwRender();
}

function _cwRender() {
  if (!_cw) return;
  const v = getVisitById(_cw.id);
  const body = document.getElementById('cwBody');
  if (!v || !body) return;
  _cwSet(CW_KEY + _cw.id, _cw.passo);
  const id = escapeHtml(v.id);

  document.getElementById('cwSteps').innerHTML = CW_PASSOS.map((p, i) => {
    const st = i < _cw.passo ? 'is-done' : i === _cw.passo ? 'is-current' : '';
    const pode = i !== _cw.passo && (i === 0 || v.checkinAt);
    return '<li class="cw-step ' + st + '"' + (i === _cw.passo ? ' aria-current="step"' : '') + '>' +
      (pode ? '<button type="button" data-action="cwIr" data-arg="' + i + '">' : '<span>') +
      '<b>' + (i < _cw.passo ? '✓' : i + 1) + '</b><span>' + p.t + '</span>' +
      (pode ? '</button>' : '</span>') + '</li>';
  }).join('');

  const passo = CW_PASSOS[_cw.passo].k;
  body.innerHTML = _cwPassoHtml(passo, v);
  document.getElementById('cwBar').innerHTML = _cwBarraHtml(passo, v, id);
  body.scrollTop = 0;
  const modalBody = body.closest('.modal-body');
  if (modalBody) modalBody.scrollTop = 0;

  if (passo === 'fotos' && typeof renderVisitPhotos === 'function') renderVisitPhotos(v.id);
  if (passo === 'assinatura' && document.getElementById('cwSig')) requestAnimationFrame(() => initSignaturePad('cwSig'));
  if (passo === 'concluir') _cwPreencherFotosResumo(v);
}

function _cwPassoHtml(passo, v) {
  const id = escapeHtml(v.id);
  if (passo === 'chegada') {
    const c = v.clientId && typeof getClientById === 'function' ? getClientById(v.clientId) : null;
    const lugar = typeof visitaParada === 'function' ? visitaParada(v) : '';
    const rota = lugar && typeof rotaMapsUrl === 'function' ? rotaMapsUrl([lugar]) : null;
    const tel = c && String(c.responsiblePhone || c.ownerPhone || '').replace(/\D/g, '');
    const quem = c && (c.responsible || c.owner);
    const health = v.clientId && typeof getHealthForClient === 'function' && typeof _getPendenciasList === 'function'
      ? getHealthForClient(_getPendenciasList(), v.clientId, localDateISO()) : null;
    const quando = typeof formatVisitTimeRange === 'function' ? formatVisitTimeRange(v) : (v.time || '');
    return '<section class="cw-card">' +
        '<div class="cw-when">' + escapeHtml(v.date ? formatDate(v.date) : '') + (quando ? ' · ' + escapeHtml(quando) : '') + '</div>' +
        '<h3 class="cw-client">' + escapeHtml(v.clientName || 'Cliente') + '</h3>' +
        (c && c.address ? '<div class="cw-addr">' + escapeHtml(c.address) + '</div>' : '') +
        '<div class="cw-links">' +
          (rota ? '<a class="btn btn-secondary btn-sm" href="' + escapeHtml(rota) + '" target="_blank" rel="noopener">🗺️ Como chegar</a>' : '') +
          (tel ? '<a class="btn btn-secondary btn-sm" href="tel:+55' + escapeHtml(tel) + '">📞 Ligar' + (quem ? ' para ' + escapeHtml(String(quem).split(' ')[0]) : '') + '</a>' : '') +
        '</div>' +
        (v.checkinAt ? '<div class="cw-ok">📍 Chegou às ' + escapeHtml(new Date(v.checkinAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })) + '</div>' : '') +
      '</section>' +
      '<div class="cw-field"><div class="cw-label">Motivo</div><div class="cw-text">' + escapeHtml(v.motivo || '—') + '</div></div>' +
      (v.observacoes ? '<div class="cw-field"><div class="cw-label">Observações</div><div class="cw-text">' + escapeHtml(v.observacoes).replace(/\n/g, '<br>') + '</div></div>' : '') +
      (v.briefingIa ? '<div class="campo-ia">💡 ' + escapeHtml(v.briefingIa).replace(/\n/g, '<br>') + '</div>' : '') +
      (health && health.motivos && health.motivos.length ? '<div class="campo-atencao">⚠️ No cliente: ' + health.motivos.map(escapeHtml).join(' · ') + '</div>' : '') +
      (typeof levarDetalheHtml === 'function' ? levarDetalheHtml(v) : '') +
      '<button type="button" class="link-btn cw-detalhes" data-action="cwDetalhes" data-arg="' + id + '">Ver todos os detalhes da visita</button>';
  }
  if (passo === 'fotos') {
    return '<p class="cw-hint">Registre o antes e o depois. Sem sinal, as fotos sobem quando a conexão voltar.</p>' +
      (typeof visitPhotosSectionHtml === 'function' ? visitPhotosSectionHtml(v.id) : '');
  }
  if (passo === 'relatorio') {
    const rascunho = _cwGet(CW_DRAFT + v.id);
    const texto = rascunho !== null ? rascunho : (v.relatorio || '');
    return '<label class="cw-label" for="cwRelatorio">O que foi feito</label>' +
      '<textarea class="form-textarea cw-relatorio" id="cwRelatorio" rows="8" data-visit="' + id + '" placeholder="Serviços executados, soluções aplicadas, testes, peças trocadas…">' + escapeHtml(texto) + '</textarea>' +
      (typeof iaReportButtonHtml === 'function' ? iaReportButtonHtml('cwRelatorio', v.id) : '');
  }
  if (passo === 'assinatura') {
    if (!_cw.refazerAssinatura && typeof isValidSignature === 'function' && isValidSignature(v.assinatura)) {
      return '<div class="sig-view"><div class="sig-img"><img src="' + escapeHtml(v.assinatura) + '" alt="Assinatura de ' + escapeHtml(v.assinaturaNome || 'cliente') + '" /></div>' +
        '<div class="sig-meta">' + escapeHtml(v.assinaturaNome || 'Sem nome') + '</div></div>' +
        '<button type="button" class="btn btn-secondary btn-sm" data-action="cwRefazerAssinatura">Assinar de novo</button>';
    }
    return '<p class="cw-hint">Peça para o responsável assinar com o dedo. É opcional, mas vai no relatório da visita.</p>' +
      (typeof signaturePadHtml === 'function' ? signaturePadHtml('cwSig', v.assinaturaNome || '') : '');
  }
  // concluir
  const pendente = !v.checkinAt || v.checkoutAt ? '' :
    '<label class="cw-check"><input type="checkbox" id="cwSaida" checked /> Registrar a saída agora (lança as horas no cliente)</label>';
  return '<ul class="cw-resumo" id="cwResumo">' + _cwResumoHtml(v, null) + '</ul>' +
    pendente +
    '<label class="cw-check"><input type="checkbox" id="cwPendencia" /> Criar pendência de acompanhamento</label>';
}

function _cwResumoHtml(v, nFotos) {
  return cwResumo(v, nFotos || 0).map((r) => {
    const fotos = r.passo === 1 && nFotos === null;
    return '<li class="cw-res' + (r.ok ? ' is-ok' : r.obrigatorio ? ' is-bad' : '') + '">' +
      '<span class="cw-res-ic" aria-hidden="true">' + (r.ok ? '✓' : r.obrigatorio ? '!' : '–') + '</span>' +
      '<span>' + (fotos ? 'Contando fotos…' : escapeHtml(r.texto)) + '</span>' +
      (r.ok ? '' : '<button type="button" class="link-btn" data-action="cwIr" data-arg="' + r.passo + '">' + (r.obrigatorio ? 'Preencher' : 'Ir') + '</button>') +
    '</li>';
  }).join('');
}

async function _cwPreencherFotosResumo(v) {
  let n = 0;
  try { n = typeof listVisitPhotos === 'function' ? (await listVisitPhotos(v.id)).length : 0; } catch (_) { n = 0; }
  const ul = document.getElementById('cwResumo');
  if (ul && _cw && _cw.id === v.id) ul.innerHTML = _cwResumoHtml(getVisitById(v.id) || v, n);
}

function _cwBarraHtml(passo, v, id) {
  const voltar = _cw.passo === 0
    ? '<button type="button" class="btn btn-secondary" data-action="cwDetalhes" data-arg="' + id + '">Detalhes</button>'
    : '<button type="button" class="btn btn-secondary" data-action="cwIr" data-arg="' + (_cw.passo - 1) + '">Voltar</button>';
  let principal;
  if (passo === 'chegada') {
    principal = v.checkinAt
      ? '<button type="button" class="btn btn-primary" data-action="cwIr" data-arg="1">Próximo: Fotos</button>'
      : '<button type="button" class="btn btn-primary" data-action="cwCheguei">📍 Cheguei</button>';
  } else if (passo === 'concluir') {
    principal = '<button type="button" class="btn cw-concluir" data-action="cwConcluir">✅ Concluir visita</button>';
  } else {
    principal = '<button type="button" class="btn btn-primary" data-action="cwIr" data-arg="' + (_cw.passo + 1) + '">Próximo: ' + CW_PASSOS[_cw.passo + 1].t + '</button>';
  }
  return voltar + principal;
}

/** Grava o que a etapa atual tem (relatório, assinatura) antes de sair dela. */
function _cwSalvarPasso() {
  if (!_cw) return;
  const v = getVisitById(_cw.id);
  if (!v) return;
  const passo = CW_PASSOS[_cw.passo].k;
  if (passo === 'relatorio') {
    const ta = document.getElementById('cwRelatorio');
    if (!ta) return;
    const texto = ta.value.trim();
    if (texto !== String(v.relatorio || '').trim()) saveVisit({ ...v, relatorio: texto });
    _cwSet(CW_DRAFT + v.id, null);
  } else if (passo === 'assinatura' && typeof readSignaturePad === 'function' && document.getElementById('cwSig')) {
    const sig = readSignaturePad('cwSig');
    if (sig) {
      saveVisit({ ...v, ...signatureFields(sig) });
      _cw.refazerAssinatura = false;
    }
  }
}

function _cwIr(passo) {
  const n = Number(passo);
  if (!_cw || !Number.isInteger(n) || n < 0 || n >= CW_PASSOS.length) return;
  const v = getVisitById(_cw.id);
  if (n > 0 && v && !v.checkinAt) { showToast('Registre a chegada primeiro.', 'warning'); return; }
  _cwSalvarPasso();
  _cw.passo = n;
  _cwRender();
}

function _cwCheguei() {
  if (!_cw) return;
  if (typeof registrarChegadaVisita === 'function') registrarChegadaVisita(_cw.id);
  _cw.passo = 1;
  _cwRender();
}

function _cwConcluir() {
  if (!_cw) return;
  const id = _cw.id;
  const v = getVisitById(id);
  if (!v) return;
  const relatorio = String(v.relatorio || '').trim();
  if (!relatorio) { showToast('Falta o relatório: conte o que foi feito.', 'error'); _cw.passo = 2; _cwRender(); return; }
  const saida = document.getElementById('cwSaida');
  const criarPendencia = !!document.getElementById('cwPendencia')?.checked;
  if (saida && saida.checked && typeof registrarSaidaVisita === 'function') registrarSaidaVisita(id);
  concludeVisit(id, { relatorio, criarPendencia });
  _cwSet(CW_KEY + id, null);
  _cwSet(CW_DRAFT + id, null);
  _cw = null;
  closeModal();
  showToast('Visita concluída!', 'success');
  openVisitDetail(id);
}

if (typeof registerActions === 'function') {
  registerActions({
    visitaGuiada: (_el, id) => openVisitaGuiada(id),
    cwDetalhes: (_el, id) => { _cwSalvarPasso(); _cw = null; openVisitDetail(id); },
    cwIr: (_el, n) => _cwIr(n),
    cwCheguei: () => _cwCheguei(),
    cwConcluir: () => _cwConcluir(),
    cwRefazerAssinatura: () => { if (_cw) { _cw.refazerAssinatura = true; _cwRender(); } },
  });
}

// Rascunho do relatório: sobrevive a fechar o atendimento ou a tela apagar.
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('input', (e) => {
    const ta = e.target;
    if (ta && ta.id === 'cwRelatorio' && ta.dataset.visit) _cwSet(CW_DRAFT + ta.dataset.visit, ta.value);
  });
}

if (typeof module !== 'undefined' && module.exports) module.exports = { cwPassoInicial, cwResumo, CW_PASSOS };
