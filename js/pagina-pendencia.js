// pagina-pendencia.js: base das páginas de detalhe com rota própria
// (#chamados/<id> e #projetos/<id>). Aqui ficam só a rota, a carga do item, os
// estados de erro e as peças comuns; o conteúdo de cada tela mora em
// js/projeto-pagina.js e js/chamado-pagina.js.

// O id vai parar no hash e em querySelector das telas: só entra o alfabeto que os
// ids reais usam (PEN-<base36>-<aleatório>). Qualquer outra coisa não é rota.
const _PGP_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const _PGP_ROTA_RE = /^#?(chamados|projetos)\/([A-Za-z0-9_-]{1,128})$/;
const _PGP_TIPO_DA_ROTA = { chamados: 'chamado', projetos: 'projeto' };
const _PGP_ROTA_DO_TIPO = { chamado: 'chamados', projeto: 'projetos' };
const _PGP_TITULO_DO_TIPO = { chamado: 'Chamado', projeto: 'Projeto interno' };
const _PGP_ESTADOS = {
  carregando: { titulo: 'Carregando…', texto: '' },
  'nao-encontrado': {
    titulo: 'Item não encontrado',
    texto: 'Ele pode ter sido excluído, ou você está sem conexão para buscá-lo.',
  },
  'sem-acesso': {
    titulo: 'Sem acesso a este item',
    texto: 'Ele pertence a outra equipe ou é restrito à Gestão.',
  },
  erro: {
    titulo: 'Não foi possível abrir este item',
    texto: 'Tente de novo em instantes. Se persistir, volte para a lista e abra novamente.',
  },
};
const _PGP_PRIORIDADES = [
  ['baixa', 'Baixa'],
  ['media', 'Média'],
  ['alta', 'Alta'],
  ['critica', 'Crítica'],
];
const _PGP_STATUS_LEGADO = { concluido: 'Concluído', fechado: 'Fechado' };

let _pgpAberta = null; // { tipo, id } da página na tela, ou null fora dela.
let _pgpRenderSeq = 0; // Resposta de carga mais antiga que a última navegação é descartada.
let _pgpAssinatura = null; // JSON do item desenhado: evita redesenhar quando nada mudou.
let _pgpScrollLista = null; // Posição da lista a reaplicar quando ela terminar de desenhar.

// ── Tipo e rota ──────────────────────────────────────────────────────────────

/** 'chamado' para canal externo (e-mail, WhatsApp); 'projeto' nos demais. */
function penPaginaTipo(p) {
  if (!p) return 'projeto';
  const canal = String(p.canal || '').toLowerCase();
  if (canal === 'email' || canal === 'whatsapp') return 'chamado';
  // Chamado antigo pode não ter `canal` preenchido, mas tem a thread ou o remetente.
  return typeof chamadoCanalDe === 'function' && chamadoCanalDe(p) ? 'chamado' : 'projeto';
}

/** `chamados/<id>` ou `projetos/<id>`; '' quando o item não pode virar rota. */
function penPaginaHash(p) {
  if (!p || !_PGP_ID_RE.test(String(p.id))) return '';
  return _PGP_ROTA_DO_TIPO[penPaginaTipo(p)] + '/' + p.id;
}

/** `#chamados/<id>` etc.; sem rota possível, aponta para a lista em vez de um link morto. */
function penPaginaHref(p) {
  const hash = penPaginaHash(p);
  return hash ? '#' + hash : '#pendencias';
}

/** Pura: `{ tipo, id }` quando o hash (com ou sem `#`) é rota de página; senão null. */
function penPaginaRotaDe(hash) {
  if (typeof hash !== 'string') return null;
  const m = _PGP_ROTA_RE.exec(hash);
  return m ? { tipo: _PGP_TIPO_DA_ROTA[m[1]], id: m[2] } : null;
}

function _pgpHashAtual() {
  return String((window.location && window.location.hash) || '').replace(/^#/, '');
}

// ── Item, acesso e escopo de equipe ──────────────────────────────────────────

function _pgpItemLocal(id) {
  const key = String(id);
  const doCache = typeof getPendenciaById === 'function' ? getPendenciaById(key) : null;
  if (doCache) return doCache;
  // Modo paginado: o item da lista pode estar só na página carregada, fora do cache.
  if (typeof _filteredPens !== 'undefined' && Array.isArray(_filteredPens)) {
    return _filteredPens.find((x) => x && String(x.id) === key) || null;
  }
  return null;
}

function _pgpRemovidoLocalmente(id) {
  return typeof _penOptimisticRemoved !== 'undefined'
    && !!_penOptimisticRemoved
    && !!_penOptimisticRemoved[id];
}

// getPendencias() guarda todas as equipes que o usuário já baixou (admin vê várias).
// A rota não pode ignorar o seletor de equipe só porque o item está no cache.
function _pgpForaDoEscopo(p) {
  if (typeof _penPageScope !== 'function') return false;
  try {
    const sc = _penPageScope();
    if (sc.adminSeeAll || !sc.team) return false;
    return (p.team || 'init') !== sc.team;
  } catch (_) {
    return false;
  }
}

function _pgpPodeVer(p) {
  if (typeof canViewPendencia === 'function' && !canViewPendencia(p)) return false;
  return !_pgpForaDoEscopo(p);
}

// As ações existentes (changePenStatus etc.) só enxergam o cache. Item vindo do
// servidor entra nele sem contar como pendência de envio e sem disparar evento:
// não é edição local e não pode voltar ao servidor como se fosse.
function _pgpGarantirNoCache(p) {
  if (typeof getPendenciaById !== 'function' || getPendenciaById(p.id)) return;
  if (typeof dbSet !== 'function' || typeof getPendencias !== 'function') return;
  const prev = window._suppressPendingSync || false;
  window._suppressPendingSync = true;
  try {
    dbSet(DB.PENDENCIAS, [...getPendencias(), p]);
  } finally {
    window._suppressPendingSync = prev;
  }
}

// Busca direta por id para o item fora do cache (link aberto em nova aba, modo
// paginado). O filtro de team espelha a lista; quem manda de verdade é a RLS.
// Resolve null quando não há como buscar: a tela mostra "não encontrado".
function _pgpCarregarPorId(id) {
  if (_pgpRemovidoLocalmente(id)) return Promise.resolve(null);
  if (typeof _penServerAvailable !== 'function' || !_penServerAvailable()) return Promise.resolve(null);
  const fields = _penFields();
  if (!fields) return Promise.reject(new Error('Schema de pendências indisponível'));
  const sc = _penPageScope();
  let q = supabaseClient.from('pendencias').select('*').eq('id', id);
  if (!sc.adminSeeAll && sc.team) q = q.eq('team', sc.team);
  return q.maybeSingle().then((res) => {
    if (res.error) throw res.error;
    return res.data ? _mapFromRemote(res.data, fields) : null;
  });
}

// ── Desenho ──────────────────────────────────────────────────────────────────

function _pgpCriarRaiz(tipo, id) {
  const content = document.getElementById('contentArea');
  if (!content) return null;
  content.innerHTML = '<div class="pgp pgp-' + tipo + '" data-pgp-id="' + escapeHtml(id)
    + '" data-pgp-tipo="' + tipo + '"></div>';
  return content.firstElementChild;
}

function _pgpEstadoHtml(tipo, estado) {
  const e = _PGP_ESTADOS[estado] || _PGP_ESTADOS.erro;
  return '<div class="pgp-estado" role="status">'
    + '<h1 class="pgp-estado-titulo">' + escapeHtml(e.titulo) + '</h1>'
    + (e.texto ? '<p class="pgp-estado-texto">' + escapeHtml(e.texto) + '</p>' : '')
    + (estado === 'carregando' ? '' : pgpVoltarHtml('Voltar para a lista'))
    + '</div>';
}

function _pgpMostrarEstado(tipo, id, estado) {
  _pgpAssinatura = null;
  const raiz = _pgpCriarRaiz(tipo, id);
  if (raiz) raiz.innerHTML = _pgpEstadoHtml(tipo, estado);
}

function _pgpDesenhar(tipo, p, estado) {
  const raiz = _pgpCriarRaiz(tipo, p.id);
  if (!raiz) return null;
  const tela = tipo === 'chamado'
    ? (typeof renderChamadoPagina === 'function' ? renderChamadoPagina : null)
    : (typeof renderProjetoPagina === 'function' ? renderProjetoPagina : null);
  try {
    if (!tela) throw new Error('Tela indisponível: ' + tipo);
    tela(p, raiz, estado || null);
    _pgpAssinatura = JSON.stringify(p);
    return raiz;
  } catch (err) {
    console.error('[pagina-pendencia] falha ao desenhar', err);
    raiz.innerHTML = _pgpEstadoHtml(tipo, 'erro');
    _pgpAssinatura = null;
    return null;
  }
}

function _pgpMostrar(seq, tipo, p) {
  if (seq !== _pgpRenderSeq) return;
  if (!_pgpPodeVer(p)) {
    _pgpMostrarEstado(tipo, p.id, 'sem-acesso');
    return;
  }
  _pgpGarantirNoCache(p);
  if (penPaginaTipo(p) !== tipo) {
    _pgpMostrarEstado(tipo, p.id, 'carregando');
    // location.replace para o link errado não virar degrau no botão Voltar. Fica para
    // depois porque navigateTo ainda vai gravar o hash errado ao terminar este render.
    setTimeout(() => {
      if (seq === _pgpRenderSeq) window.location.replace('#' + penPaginaHash(p));
    }, 0);
    return;
  }
  _pgpDesenhar(tipo, p);
}

/**
 * Carrega o item, confere acesso e tipo, e chama a tela no #contentArea.
 * Devolve uma Promise quando precisou buscar no servidor; senão undefined.
 */
function renderPaginaPendencia(tipo, id) {
  const t = tipo === 'chamado' ? 'chamado' : 'projeto';
  const key = String(id);
  const seq = ++_pgpRenderSeq;
  _pgpAberta = { tipo: t, id: key };
  _pgpAssinatura = null;
  const titulo = document.getElementById('pageTitle');
  if (titulo) titulo.textContent = _PGP_TITULO_DO_TIPO[t];

  if (!_PGP_ID_RE.test(key) || _pgpRemovidoLocalmente(key)) {
    _pgpMostrarEstado(t, key, 'nao-encontrado');
    return undefined;
  }
  const local = _pgpItemLocal(key);
  if (local) {
    _pgpMostrar(seq, t, local);
    return undefined;
  }
  _pgpMostrarEstado(t, key, 'carregando');
  return _pgpCarregarPorId(key).then((p) => {
    if (seq !== _pgpRenderSeq) return;
    if (p) _pgpMostrar(seq, t, p);
    else _pgpMostrarEstado(t, key, 'nao-encontrado');
  }).catch((err) => {
    if (seq !== _pgpRenderSeq) return;
    console.warn('[pagina-pendencia] falha ao carregar', err);
    _pgpMostrarEstado(t, key, 'erro');
  });
}

/** Fecha modal aberto e vai para a rota do item; se já estiver nela, re-renderiza. */
function abrirPaginaPendencia(id) {
  const key = String(id == null ? '' : id);
  if (!_PGP_ID_RE.test(key)) {
    // Id fora do padrão não cabe em rota; o modal antigo ainda sabe abri-lo.
    if (typeof openPendenciaDetailModal === 'function') openPendenciaDetailModal(id);
    return;
  }
  // A ficha do cliente agenda a volta à aba dentro de closeModal; aqui a rota muda e
  // a página é outro lugar, então o retorno não pode disparar por cima dela. O desvio
  // ao modal antigo, acima, é o único caminho que ainda devolve para a ficha.
  if (typeof _clientPenReturn !== 'undefined') {
    _clientPenReturn = null;
    if (typeof _clientPenOrigin !== 'undefined') _clientPenOrigin = null;
  }
  const p = _pgpItemLocal(key);
  if (p && typeof canViewPendencia === 'function' && !canViewPendencia(p)) {
    // Mesmo aviso do modal: o usuário continua onde estava em vez de cair numa página morta.
    if (typeof showToast === 'function') showToast('Acesso restrito à Gestão.', 'warning');
    return;
  }
  const overlay = document.getElementById('modalOverlay');
  if (overlay && overlay.style.display === 'flex' && typeof closeModal === 'function') closeModal();
  // Item desconhecido abre como projeto; o render corrige a rota quando descobrir o tipo.
  const hash = p ? penPaginaHash(p) : 'projetos/' + key;
  if (_pgpHashAtual() === hash && penPaginaEstaAberta(key)) {
    // Síncrono de propósito: chdCancelar lê #chgStatus logo depois desta chamada.
    penPaginaAtualizar(key);
    return;
  }
  if (typeof navigateTo === 'function') navigateTo(hash);
  else window.location.hash = hash;
}

// ── Atualização preservando o que a pessoa estava fazendo ────────────────────

function _pgpCapturarEstado(raiz) {
  const rascunhos = {};
  raiz.querySelectorAll('[data-pgp-rascunho]').forEach((el) => {
    rascunhos[el.dataset.pgpRascunho] = el.value;
  });
  const modoEl = raiz.querySelector('[data-pgp-modo]');
  const abaEl = raiz.querySelector('[data-pgp-aba][aria-selected="true"]');
  const ativo = document.activeElement;
  let foco = null;
  if (ativo && raiz.contains(ativo)) {
    foco = {
      rascunho: ativo.dataset ? ativo.dataset.pgpRascunho || null : null,
      id: ativo.id || null,
      inicio: typeof ativo.selectionStart === 'number' ? ativo.selectionStart : null,
      fim: typeof ativo.selectionEnd === 'number' ? ativo.selectionEnd : null,
    };
  }
  return {
    rascunhos,
    modo: modoEl ? modoEl.dataset.pgpModo : null,
    aba: abaEl ? abaEl.dataset.pgpAba : null,
    scrollY: window.scrollY || 0,
    foco,
  };
}

function _pgpCampoDeRascunho(raiz, chave) {
  const campos = raiz.querySelectorAll('[data-pgp-rascunho]');
  for (let i = 0; i < campos.length; i++) {
    if (campos[i].dataset.pgpRascunho === chave) return campos[i];
  }
  return null;
}

function _pgpRestaurarEstado(raiz, estado) {
  Object.keys(estado.rascunhos).forEach((chave) => {
    const campo = _pgpCampoDeRascunho(raiz, chave);
    if (campo) campo.value = estado.rascunhos[chave];
  });
  if (estado.foco) {
    const f = estado.foco;
    let el = f.rascunho ? _pgpCampoDeRascunho(raiz, f.rascunho) : null;
    if (!el && f.id) el = document.getElementById(f.id);
    if (el && raiz.contains(el)) {
      el.focus({ preventScroll: true });
      if (f.inicio !== null && typeof el.setSelectionRange === 'function') {
        try { el.setSelectionRange(f.inicio, f.fim); } catch (_) { /* tipo de campo sem cursor */ }
      }
    }
  }
  if (typeof window.scrollTo === 'function') window.scrollTo(0, estado.scrollY);
}

/**
 * Re-renderiza a página aberta mantendo rascunho, modo, aba e rolagem.
 * Não faz nada se a página aberta for de outro id.
 */
function penPaginaAtualizar(id) {
  if (!penPaginaEstaAberta(id)) return undefined;
  const { tipo, id: key } = _pgpAberta;
  const p = _pgpItemLocal(key);
  // Item sumiu, perdeu acesso ou mudou de canal: o caminho completo decide o que mostrar.
  if (!p || penPaginaTipo(p) !== tipo || !_pgpPodeVer(p)) return renderPaginaPendencia(tipo, key);
  const raizAtual = document.querySelector('#contentArea > .pgp');
  const estado = raizAtual ? _pgpCapturarEstado(raizAtual) : null;
  _pgpRenderSeq++; // Uma carga em andamento não pode sobrescrever o desenho mais novo.
  const raiz = _pgpDesenhar(tipo, p, estado);
  if (raiz && estado) _pgpRestaurarEstado(raiz, estado);
  return undefined;
}

function penPaginaEstaAberta(id) {
  return !!_pgpAberta && _pgpAberta.id === String(id);
}

/** Chamado pelo navigateTo ao sair para outra tela: invalida cargas e o estado da página. */
function penPaginaFechar() {
  _pgpAberta = null;
  _pgpAssinatura = null;
  _pgpScrollLista = null;
  _pgpRenderSeq++;
}

/** Item excluído com a página aberta: o "desfazer" fica na lista, então volta para ela. */
function penPaginaVoltarSeAberta(id) {
  if (penPaginaEstaAberta(id) && typeof navigateTo === 'function') navigateTo('pendencias');
}

// A lista desenha depois do requestAnimationFrame do navigateTo (setTimeout local,
// fetch no modo servidor), quando a página ainda é curta demais para rolar. Por isso
// a posição fica guardada e é reaplicada ao fim do desenho, uma vez só.
function penPaginaMarcarScrollLista(y) {
  _pgpScrollLista = y > 0 ? y : null;
}

function penPaginaAplicarScrollLista() {
  if (_pgpScrollLista === null) return;
  const y = _pgpScrollLista;
  _pgpScrollLista = null;
  window.scrollTo(0, y);
}

// Mudança vinda de sincronização ou de outra aba chega aqui já com debounce.
function _pgpAoMudarDados() {
  if (!_pgpAberta) return;
  const { tipo, id } = _pgpAberta;
  const p = _pgpItemLocal(id);
  if (!p) {
    // Não rebusca no servidor: uma exclusão local ainda não enviada ressuscitaria o item.
    if (_pgpAssinatura) {
      _pgpRenderSeq++;
      _pgpMostrarEstado(tipo, id, 'nao-encontrado');
    }
    return;
  }
  if (!_pgpAssinatura) {
    renderPaginaPendencia(tipo, id);
    return;
  }
  if (JSON.stringify(p) !== _pgpAssinatura) penPaginaAtualizar(id);
}

// ── Peças comuns às duas telas ───────────────────────────────────────────────

function _pgpOpcaoHtml(valor, rotulo, atual, desabilitada) {
  return '<option value="' + escapeHtml(valor) + '"'
    + (valor === atual ? ' selected' : '')
    + (desabilitada ? ' disabled' : '') + '>' + escapeHtml(rotulo) + '</option>';
}

/**
 * Seletores de status e prioridade. O id `chgStatus` é contrato: changePenStatus e
 * _chdMudarStatus leem esse campo, então cada página só pode ter uma chamada a isto.
 */
function pgpSeletoresHtml(p) {
  const item = p || {};
  const id = escapeHtml(item.id == null ? '' : item.id);
  const statusMap = typeof STATUS_PEN_MAP !== 'undefined' ? STATUS_PEN_MAP : {};
  const prioMap = typeof PRIORITY_MAP !== 'undefined' ? PRIORITY_MAP : {};
  const status = String(item.status == null ? '' : item.status);
  const prioridade = String(item.priority == null ? '' : item.priority);

  let statusOpts = Object.keys(statusMap)
    .map((k) => _pgpOpcaoHtml(k, statusMap[k].label, status, false)).join('');
  // Status antigo continua visível, mas não pode ser escolhido de novo.
  if (status && !statusMap[status]) {
    statusOpts += _pgpOpcaoHtml(status, (_PGP_STATUS_LEGADO[status] || status) + ' (antigo)', status, true);
  }
  let prioOpts = _PGP_PRIORIDADES
    .map(([k, rotulo]) => _pgpOpcaoHtml(k, (prioMap[k] && prioMap[k].label) || rotulo, prioridade, false)).join('');
  if (prioridade && !_PGP_PRIORIDADES.some(([k]) => k === prioridade)) {
    prioOpts += _pgpOpcaoHtml(prioridade, prioridade + ' (antigo)', prioridade, true);
  }

  return '<div class="pgp-seletores">'
    + '<div class="pgp-seletor">'
    + '<label class="pgp-label" for="chgStatus">Status</label>'
    + '<select id="chgStatus" class="pgp-select pgp-select-status" data-change="pgpStatus"'
    + ' data-id="' + id + '" data-status="' + escapeHtml(status) + '">' + statusOpts + '</select>'
    + '</div>'
    + '<div class="pgp-seletor">'
    + '<label class="pgp-label" for="pgpPrioridade">Prioridade</label>'
    + '<select id="pgpPrioridade" class="pgp-select pgp-select-prioridade" data-change="penSetField"'
    + ' data-field="priority" data-id="' + id + '" data-prioridade="' + escapeHtml(prioridade) + '">' + prioOpts + '</select>'
    + '</div>'
    + '</div>';
}

/** Avatar de iniciais. `tamanho` em px (padrão 32, máximo 128). */
function pgpAvatarHtml(nome, tamanho) {
  const texto = String(nome == null ? '' : nome).trim();
  const palavras = texto ? texto.split(/\s+/) : [];
  // Array.from para não partir acento composto nem emoji pela metade.
  const inicial = (s) => Array.from(s)[0] || '';
  let iniciais = palavras.length ? inicial(palavras[0]) : '?';
  if (palavras.length > 1) iniciais += inicial(palavras[palavras.length - 1]);
  const t = Number(tamanho);
  const px = t > 0 && t <= 128 ? t : 32;
  const rotulo = escapeHtml(texto || 'Sem nome');
  return '<span class="pgp-avatar" style="--pgp-avatar-size:' + px + 'px" role="img"'
    + ' title="' + rotulo + '" aria-label="' + rotulo + '">'
    + escapeHtml(iniciais.toUpperCase()) + '</span>';
}

/** "há 3 h", "há 2 dias"… '' para data inválida. `agora` só existe para os testes. */
function pgpTempoAtras(iso, agora) {
  if (iso === null || iso === undefined || iso === '') return '';
  const quando = new Date(iso).getTime();
  if (Number.isNaN(quando)) return '';
  const base = agora === undefined ? Date.now() : new Date(agora).getTime();
  const min = Math.floor((base - quando) / 60000);
  if (min < 1) return 'agora'; // Relógio adiantado também cai aqui em vez de "há -3 min".
  if (min < 60) return 'há ' + min + ' min';
  const horas = Math.floor(min / 60);
  if (horas < 24) return 'há ' + horas + ' h';
  const dias = Math.floor(horas / 24);
  if (dias < 30) return 'há ' + dias + (dias === 1 ? ' dia' : ' dias');
  if (dias < 365) {
    const meses = Math.floor(dias / 30);
    return 'há ' + meses + (meses === 1 ? ' mês' : ' meses');
  }
  const anos = Math.floor(dias / 365);
  return 'há ' + anos + (anos === 1 ? ' ano' : ' anos');
}

/** Link de volta para a lista; é <a href> para Ctrl+clique e botão Voltar funcionarem. */
function pgpVoltarHtml(rotulo) {
  return '<a class="pgp-voltar" href="#pendencias">← ' + escapeHtml(rotulo || 'Pendências') + '</a>';
}

// ── Ligações com o resto do app ──────────────────────────────────────────────

if (typeof registerActions === 'function') {
  registerActions({
    // Não reaproveita chdStatus: ele sincroniza peças do modal antigo. O redesenho
    // final cobre a saída sem salvar, para o select não ficar mostrando valor falso.
    pgpStatus: (el) => {
      changePenStatus(el.dataset.id);
      if (el.isConnected) penPaginaAtualizar(el.dataset.id);
    },
  });
}

if (typeof onDataChanged === 'function') onDataChanged('pendencias', _pgpAoMudarDados);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    penPaginaTipo, penPaginaHash, penPaginaHref, penPaginaRotaDe,
    abrirPaginaPendencia, renderPaginaPendencia, penPaginaAtualizar,
    penPaginaEstaAberta, penPaginaFechar, penPaginaVoltarSeAberta,
    penPaginaMarcarScrollLista, penPaginaAplicarScrollLista,
    pgpSeletoresHtml, pgpAvatarHtml, pgpTempoAtras, pgpVoltarHtml,
  };
}
