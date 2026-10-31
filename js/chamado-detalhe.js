// chamado-detalhe.js — Peças da tela de detalhe do chamado (estilo SAF).
// =====================================================================
// O `openPendenciaDetail` (pendencias-detalhe.js) monta a tela; aqui ficam os
// blocos dela e as ações do composer. Separado porque as regras do composer
// (variáveis, canal de resposta, transferência com motivo) são funções puras
// que dá para testar sem DOM.
//
// O canal de resposta vem de `chamadoCanalDe`/`chamadoEnviarResposta`
// (chamado-canal.js). Sem esse arquivo carregado, cai no comportamento antigo:
// só e-mail, e só quando o chamado tem endereço de quem pediu.
//
// Script clássico (escopo global compartilhado), sem import/export.

/** Variáveis que o atendente pode usar no texto. A ordem é a dos botões. */
const CHAMADO_VARIAVEIS = ['nome', 'primeiro_nome', 'protocolo', 'data_hoje', 'area', 'atendente'];

function _chdCanal(p) {
  if (!p) return null;
  try {
    return typeof chamadoCanalDe === 'function' ? chamadoCanalDe(p) : (p.solicitanteEmail ? 'email' : null);
  } catch (_e) {
    return null;
  }
}

function _chdCanalRotulo(canal) {
  if (canal === 'email') return 'E-mail';
  if (canal === 'whatsapp') return 'WhatsApp';
  return 'Sem canal';
}

function _chdNomeSolicitante(p) {
  var nome = String((p && (p.solicitante || p.clientName)) || '').trim();
  return nome || 'quem pediu';
}

function _chdProtocolo(p) {
  var n = '';
  try { n = typeof penDisplayNumber === 'function' ? penDisplayNumber(p) : ''; } catch (_e) { n = ''; }
  // '#---' é o "sem número ainda" do quadro: para o cliente, o id serve melhor.
  return n && n !== '#---' ? n : String((p && p.id) || '');
}

function _chdAssunto(p) {
  try {
    if (typeof getPendenciaAssunto === 'function') return getPendenciaAssunto(p) || '';
  } catch (_e) { /* cai no campo cru */ }
  return String((p && (p.assunto || p.titulo || p.title)) || '');
}

/** Texto do rótulo do composer. Texto puro: quem põe no HTML escapa. */
function chamadoRotuloComposer(p, canal) {
  var nome = _chdNomeSolicitante(p);
  if (canal === 'email' || canal === 'whatsapp') return 'Responder a ' + nome + ' por ' + _chdCanalRotulo(canal);
  return 'Responder a ' + nome + ' — sem canal de resposta';
}

/**
 * Troca {variavel} pelo valor do chamado. Variável conhecida sem valor vira
 * vazio (melhor "Olá ," do que "Olá {nome}," chegando ao cliente); chave
 * desconhecida fica como está, porque pode ser texto legítimo entre chaves.
 * Devolve texto puro — a nota passa por escape na hora de virar HTML.
 */
function chamadoAplicarVariaveis(texto, p, ctx) {
  var c = ctx || {};
  var pen = p || {};
  var nome = String(pen.solicitante || pen.clientName || '').trim();
  var valores = {
    nome: nome,
    primeiro_nome: nome ? nome.split(/\s+/)[0] : '',
    protocolo: _chdProtocolo(pen),
    // Checa pelo método, não por instanceof: Date de outro realm (vm, iframe) falha o instanceof.
    data_hoje: (c.hoje && typeof c.hoje.getTime === 'function' ? c.hoje : new Date()).toLocaleDateString('pt-BR'),
    area: (function () {
      var a = '';
      try { a = pen.categoria && typeof penCategoriaLabel === 'function' ? penCategoriaLabel(pen.categoria) : ''; } catch (_e) { a = ''; }
      return String(a || pen.team || '');
    })(),
    atendente: (function () {
      if (c.atendente) return String(c.atendente);
      try { var u = typeof getUser === 'function' ? getUser() : null; return u && u.name ? String(u.name) : ''; } catch (_e) { return ''; }
    })()
  };
  return String(texto == null ? '' : texto).replace(/\{([a-z_]+)\}/g, function (inteiro, chave) {
    return Object.prototype.hasOwnProperty.call(valores, chave) ? valores[chave] : inteiro;
  });
}

/**
 * Regra da transferência: outro responsável e motivo escrito. O motivo vira
 * nota interna — quem recebe o chamado precisa saber por que ele chegou.
 * Devolve a mensagem de erro, ou null quando pode transferir.
 */
function chamadoValidarTransferencia(p, para, motivo) {
  var novo = String(para || '').trim();
  var atual = String((p && p.responsible) || '').trim();
  if (!novo) return 'Escolha para quem transferir.';
  if (novo === atual) return 'O chamado já está com ' + novo + '.';
  if (!String(motivo || '').trim()) {
    return atual ? 'O chamado está com ' + atual + '. Diga o motivo da transferência.' : 'Diga o motivo da transferência.';
  }
  return null;
}

/** Operadores que podem receber o chamado — mesmo filtro do "Reatribuir". */
function _chdOperadoresElegiveis() {
  var ops = [];
  try { ops = typeof getOperators === 'function' ? (getOperators() || []) : []; } catch (_e) { ops = []; }
  var eligible = ops.filter(function (o) { return o && o.active !== false && o.onLeave !== true; });
  var team = typeof getCurrentTeam === 'function' ? getCurrentTeam() : null;
  var options = eligible;
  if (team && typeof isTeamAdmin === 'function' && !isTeamAdmin()) {
    var filtered = eligible.filter(function (o) { return (o.team || 'init') === team; });
    if (filtered.length) options = filtered;
  }
  return options;
}

function _chdChip(classe, texto, titulo) {
  return '<span class="chd-chip ' + classe + '"' + (titulo ? ' title="' + escapeHtml(titulo) + '"' : '') + '>' + escapeHtml(texto) + '</span>';
}

function _chdPrioridadeRotulo(v) {
  return { baixa: 'Baixa', media: 'Média', alta: 'Alta', critica: 'Crítica' }[v] || 'Sem prioridade';
}

/**
 * Cabeçalho: protocolo, assunto e os chips de status, prioridade e canal.
 * `extras` (select de status, timer, botão de editar) vêm prontos de quem chama
 * — já escapados lá, porque dependem de estado da tela de detalhe.
 */
function chamadoCabecalhoHtml(p, extras) {
  var e = extras || {};
  var st = (typeof STATUS_PEN_MAP !== 'undefined' && STATUS_PEN_MAP[p.status]) ? STATUS_PEN_MAP[p.status] : { label: p.status || '—' };
  var canal = _chdCanal(p);
  return '<header class="chd-head">'
    + '<div class="chd-head-main">'
    + '<span class="chd-protocolo">' + escapeHtml(_chdProtocolo(p)) + '</span>'
    + '<h2 class="chd-assunto">' + escapeHtml(_chdAssunto(p) || 'Sem assunto') + '</h2>'
    + '<div class="chd-chips">'
    + _chdChip('chd-chip-status', st.label, 'Status')
    + _chdChip('chd-chip-pri chd-pri-' + (/^(baixa|media|alta|critica)$/.test(p.priority) ? p.priority : 'nenhuma'), _chdPrioridadeRotulo(p.priority), 'Prioridade')
    + _chdChip('chd-chip-canal' + (canal ? ' chd-canal-' + canal : ' chd-canal-nenhum'), canal ? _chdCanalRotulo(canal) : 'Sem canal', 'Canal de resposta')
    + '</div></div>'
    + '<div class="chd-head-side">' + (e.status || '') + (e.timer || '') + (e.editar || '') + '</div>'
    + '</header>';
}

/** Barra de ações. Os painéis de transferir e assunto abrem no lugar, sem modal. */
function chamadoAcoesHtml(p) {
  var id = escapeHtml(p.id);
  var ops = _chdOperadoresElegiveis().filter(function (o) { return o.name !== p.responsible; });
  var opcoes = '<option value="">Escolha…</option>' + ops.map(function (o) {
    return '<option value="' + escapeHtml(o.name) + '">' + escapeHtml(o.name) + (o.team ? ' · ' + escapeHtml(o.team) : '') + '</option>';
  }).join('');
  var pri = ['baixa', 'media', 'alta', 'critica'].map(function (v) {
    return '<option value="' + v + '"' + (p.priority === v ? ' selected' : '') + '>' + _chdPrioridadeRotulo(v) + '</option>';
  }).join('');
  var fechado = typeof isPendenciaClosed === 'function' && isPendenciaClosed(p.status);
  return '<div class="chd-actions" role="toolbar" aria-label="Ações do chamado">'
    + '<button type="button" class="btn btn-secondary btn-sm" data-action="chdPainel" data-arg="transferir" aria-controls="chdPainelTransferir">⇄ Transferir</button>'
    + '<label class="chd-actions-pri"><span>Prioridade</span><select class="form-select chd-select" data-change="penSetField" data-field="priority" data-id="' + id + '" aria-label="Prioridade">' + pri + '</select></label>'
    + '<button type="button" class="btn btn-secondary btn-sm" data-action="chdPainel" data-arg="assunto" aria-controls="chdPainelAssunto">✎ Assunto</button>'
    + '<button type="button" class="btn btn-secondary btn-sm" data-action="chdCompartilhar" data-arg="' + id + '" title="Copia o protocolo e o endereço">🔗 Compartilhar</button>'
    + (fechado ? '' : '<button type="button" class="btn btn-secondary btn-sm chd-btn-cancelar" data-action="chdCancelar" data-arg="' + id + '">✕ Cancelar</button>')
    + '</div>'
    + '<div class="chd-painel" id="chdPainelTransferir" hidden>'
    + '<label class="form-label" for="chdTransferPara">Transferir para</label>'
    + '<select class="form-select" id="chdTransferPara">' + opcoes + '</select>'
    + '<label class="form-label" for="chdTransferMotivo">Motivo <span class="text-muted">(obrigatório, vira anotação interna)</span></label>'
    + '<textarea class="form-input" id="chdTransferMotivo" rows="2" maxlength="500" placeholder="Por que o chamado está mudando de mão?"></textarea>'
    + '<div class="chd-painel-acoes"><button type="button" class="btn btn-primary btn-sm" data-action="chdTransferir" data-arg="' + id + '">Transferir</button>'
    + '<button type="button" class="btn btn-secondary btn-sm" data-action="chdPainel" data-arg="transferir">Fechar</button></div>'
    + '</div>'
    + '<div class="chd-painel" id="chdPainelAssunto" hidden>'
    + '<label class="form-label" for="chdAssuntoInput">Assunto</label>'
    + '<input type="text" class="form-input" id="chdAssuntoInput" maxlength="200" value="' + escapeHtml(_chdAssunto(p)) + '">'
    + '<div class="chd-painel-acoes"><button type="button" class="btn btn-primary btn-sm" data-action="chdSalvarAssunto" data-arg="' + id + '">Salvar assunto</button>'
    + '<button type="button" class="btn btn-secondary btn-sm" data-action="chdPainel" data-arg="assunto">Fechar</button></div>'
    + '</div>';
}

function _chdLinha(rotulo, valorHtml) {
  return valorHtml ? '<div class="chd-card-row"><dt>' + escapeHtml(rotulo) + '</dt><dd>' + valorHtml + '</dd></div>' : '';
}

/** Linha curta do andamento: evento ou nota, sem o texto inteiro. */
function _chdAndamentoItem(n) {
  var quando = typeof formatDateTime === 'function' ? formatDateTime(n.createdAt) : String(n.createdAt || '');
  var quem = escapeHtml(n.author || 'Sistema');
  var oque;
  if (n._evento) {
    oque = typeof _PEN_EVENT_VERBO !== 'undefined' && _PEN_EVENT_VERBO[n.type] ? _PEN_EVENT_VERBO[n.type] : 'mudou algo';
    if (n.para) oque += ' · ' + String(typeof _penValorLabel === 'function' ? _penValorLabel(n.type, n.para) : n.para);
  } else if (n.visibility === 'solicitante') {
    oque = 'escreveu (solicitante)';
  } else if (n.visibility === 'resposta') {
    oque = 'respondeu';
  } else {
    oque = 'anotou (interna)';
  }
  return '<li class="chd-and-item' + (n._evento ? ' is-evento' : '') + '"><span class="chd-and-dot" aria-hidden="true"></span>'
    + '<span class="chd-and-txt"><strong>' + quem + '</strong> ' + escapeHtml(oque) + '</span>'
    + '<span class="chd-and-at">' + escapeHtml(quando) + '</span></li>';
}

/** Coluna da direita: quem pediu, atendimento, prazo e andamento. */
function chamadoCartoesHtml(p, origem) {
  // O número de quem escreveu pelo WhatsApp mora no emailThreadId (C); o
  // campo solicitanteTelefone fica de reserva para chamado aberto à mão.
  var tel = String((typeof chamadoTelefoneDe === 'function' && chamadoTelefoneDe(p)) || p.solicitanteTelefone || '').trim();
  if (tel && typeof chamadoTelefoneFormatar === 'function') tel = chamadoTelefoneFormatar(tel);
  var email = String(p.solicitanteEmail || '').trim();
  var nome = String(p.solicitante || '').trim();
  var now = Date.now();
  var itens = typeof _penFeedItens === 'function' ? _penFeedItens(p) : [];
  var ultimos = itens.slice(-6);
  var origemHtml = '';
  try { origemHtml = origem && typeof _penOrigemHtml === 'function' ? _penOrigemHtml(origem) : ''; } catch (_e) { origemHtml = ''; }
  var resp = '', resol = '', tempo = '';
  try { resp = typeof penRespostaBadge === 'function' ? penRespostaBadge(p, now, { full: true }) : ''; } catch (_e) { resp = ''; }
  try { resol = typeof penResolucaoBadge === 'function' ? penResolucaoBadge(p, now) : ''; } catch (_e) { resol = ''; }
  try { tempo = typeof penTempoPorLadoHtml === 'function' ? penTempoPorLadoHtml(p, now) : ''; } catch (_e) { tempo = ''; }
  return '<section class="chd-card" aria-label="Quem pediu"><h3 class="chd-card-title">Quem pediu</h3><dl class="chd-card-dl">'
    + _chdLinha('Nome', escapeHtml(nome || '—'))
    + (email ? _chdLinha('E-mail', '<a href="mailto:' + escapeHtml(email) + '">' + escapeHtml(email) + '</a>') : '')
    + (tel ? _chdLinha('Telefone', escapeHtml(tel)) : '')
    + _chdLinha('Cliente', escapeHtml(p.clientName || '—'))
    + '</dl></section>'
    + '<section class="chd-card" aria-label="Atendimento"><h3 class="chd-card-title">Atendimento</h3><dl class="chd-card-dl">'
    + _chdLinha('Responsável', escapeHtml(p.responsible || '—'))
    + _chdLinha('Equipe', escapeHtml(p.team || '—'))
    + '</dl>' + origemHtml + '</section>'
    + '<section class="chd-card" aria-label="Prazo"><h3 class="chd-card-title">Prazo</h3><dl class="chd-card-dl">'
    + _chdLinha('1ª resposta', resp || '—')
    + _chdLinha('Resolução', resol || '—')
    + '</dl>' + (tempo ? '<div class="chd-card-tempo">' + tempo + '</div>' : '') + '</section>'
    + '<section class="chd-card" aria-label="Andamento"><h3 class="chd-card-title">Andamento</h3>'
    + (ultimos.length ? '<ol class="chd-andamento">' + ultimos.map(_chdAndamentoItem).join('') + '</ol>' : '<p class="text-muted chd-vazio">Nada ainda.</p>')
    + '</section>';
}

/** Composer: resposta a quem pediu e, separada, a anotação interna. */
function chamadoComposerHtml(p) {
  var id = escapeHtml(p.id);
  var canal = _chdCanal(p);
  var vars = CHAMADO_VARIAVEIS.map(function (v) {
    return '<button type="button" class="chd-var" data-action="chdInserirVariavel" data-arg="' + v + '" title="Inserir {' + v + '}">{' + v + '}</button>';
  }).join('');
  return '<section class="chd-composer' + (canal ? '' : ' is-sem-canal') + '" aria-label="Responder">'
    + '<div class="chd-composer-head"><label class="chd-composer-label" id="chdComposerLabel" for="newNoteText">' + escapeHtml(chamadoRotuloComposer(p, canal)) + '</label>'
    + '<button type="button" class="link-btn" data-action="rpAbrir" aria-controls="rpPainel" aria-expanded="false">Respostas prontas</button></div>'
    + '<div class="rp-painel" id="rpPainel" hidden></div>'
    + (canal ? '' : '<p class="chd-composer-aviso">Sem e-mail nem WhatsApp de quem pediu: a resposta fica só no histórico do chamado.</p>')
    + '<div class="chd-vars" role="group" aria-label="Variáveis">' + vars + '</div>'
    + '<textarea class="form-input chd-textarea" id="newNoteText" rows="4" placeholder="Escreva a resposta… (Ctrl+Enter envia)"></textarea>'
    + '<div class="chd-composer-acoes">'
    + '<button type="button" class="btn btn-primary btn-sm" data-action="chdResponder" data-arg="responder" data-id="' + id + '">Responder</button>'
    + '<button type="button" class="btn btn-secondary btn-sm" data-action="chdResponder" data-arg="pedir_info" data-id="' + id + '" title="Envia e deixa o chamado aguardando o cliente">Pedir informação</button>'
    + '<button type="button" class="btn btn-secondary btn-sm" data-action="chdResponder" data-arg="encerrar" data-id="' + id + '" title="Envia e marca o chamado como resolvido">Encerrar chamado</button>'
    + '</div></section>'
    + '<section class="chd-nota" aria-label="Anotação interna">'
    + '<label class="chd-nota-label" for="chamadoNotaTexto">🔒 Anotação interna <span class="text-muted">— só a equipe vê; use @nome para avisar alguém</span></label>'
    + '<div class="chd-mencao-wrap">'
    + '<textarea class="form-input chd-textarea" id="chamadoNotaTexto" rows="2" data-input="chdMencao" placeholder="Anotação para a equipe…"></textarea>'
    + '<ul class="chd-mencao-lista" id="chamadoMencaoLista" role="listbox" hidden></ul>'
    + '</div>'
    + '<div class="chd-composer-acoes"><button type="button" class="btn btn-secondary btn-sm" data-action="chdNotaInterna" data-arg="' + id + '">Salvar anotação</button></div>'
    + '</section>';
}

function _chdReabrir(id) {
  if (typeof openPendenciaDetail === 'function') openPendenciaDetail(id);
  if (typeof document !== 'undefined' && document.getElementById('penViewArea') && typeof renderPenView === 'function') renderPenView(false);
}

function _chdMudarStatus(id, status) {
  var sel = typeof document !== 'undefined' ? document.getElementById('chgStatus') : null;
  if (!sel || typeof changePenStatus !== 'function') return;
  sel.value = status;
  changePenStatus(id);
}

/**
 * Responder / Pedir informação / Encerrar. A nota é gravada como 'resposta'
 * mesmo sem canal (conta para o SLA da 1ª resposta); o envio só acontece
 * quando há canal.
 */
function chamadoResponderAcao(id, acao) {
  var ta = typeof document !== 'undefined' ? document.getElementById('newNoteText') : null;
  var bruto = ta ? String(ta.value || '').trim() : '';
  if (!bruto) { if (typeof showToast === 'function') showToast('Escreva a resposta antes de enviar.', 'error'); return false; }
  var p = typeof getPendenciaById === 'function' ? getPendenciaById(id) : null;
  if (!p) return false;
  var me = (typeof getUser === 'function' && getUser()) ? getUser().name : '';
  var texto = chamadoAplicarVariaveis(bruto, p, { atendente: me });
  if (addPendenciaNote(id, texto, me, 'resposta') === false) {
    if (typeof showToast === 'function') showToast('Não foi possível salvar a resposta.', 'error');
    return false;
  }
  if (ta) ta.value = '';
  if (_chdCanal(p)) {
    try {
      if (typeof chamadoEnviarResposta === 'function') chamadoEnviarResposta(p, texto);
      else if (typeof penResponderPorEmail === 'function') penResponderPorEmail(p.id, texto);
    } catch (e) {
      console.error('[chamado] envio da resposta falhou:', e);
      if (typeof showToast === 'function') showToast('Resposta salva, mas o envio falhou.', 'error');
    }
  }
  if (acao === 'pedir_info') _chdMudarStatus(id, 'aguardando_cliente');
  else if (acao === 'encerrar') _chdMudarStatus(id, 'resolvido');
  else _chdReabrir(id);
  return true;
}

/** Anotação interna: grava 'interna' e nunca envia nada para fora. */
function chamadoNotaInterna(id) {
  var ta = typeof document !== 'undefined' ? document.getElementById('chamadoNotaTexto') : null;
  var texto = ta ? String(ta.value || '').trim() : '';
  if (!texto) { if (typeof showToast === 'function') showToast('Escreva a anotação.', 'error'); return false; }
  var me = (typeof getUser === 'function' && getUser()) ? getUser().name : '';
  if (addPendenciaNote(id, texto, me, 'interna') === false) {
    if (typeof showToast === 'function') showToast('Não foi possível salvar a anotação.', 'error');
    return false;
  }
  if (ta) ta.value = '';
  _chdReabrir(id);
  return true;
}

function _chdTransferir(id) {
  var p = getPendenciaById(id);
  if (!p) return;
  var para = (document.getElementById('chdTransferPara') || {}).value || '';
  var motivo = String((document.getElementById('chdTransferMotivo') || {}).value || '').trim();
  var erro = chamadoValidarTransferencia(p, para, motivo);
  if (erro) { showToast(erro, 'error'); return; }
  try {
    var res = updatePendenciaAssignee(id, { responsible: para });
    showToast('Pendência reatribuída para ' + para + '!', 'success');
    try { _optimisticPenUpsert(Object.assign({}, res.pen)); } catch (_e) { /* a sincronização cobre */ }
  } catch (err) {
    showToast((err && err.message) || 'Não foi possível reatribuir.', 'error');
    return;
  }
  var me = (typeof getUser === 'function' && getUser()) ? getUser().name : '';
  addPendenciaNote(id, 'Transferido para ' + para + ': ' + motivo, me, 'interna');
  if (typeof updateBadges === 'function') updateBadges();
  _chdReabrir(id);
}

/** Insere o texto no cursor do textarea, sem perder o que já está escrito. */
function _chdInserirNoCursor(ta, txt) {
  var ini = typeof ta.selectionStart === 'number' ? ta.selectionStart : ta.value.length;
  var fim = typeof ta.selectionEnd === 'number' ? ta.selectionEnd : ini;
  ta.value = ta.value.slice(0, ini) + txt + ta.value.slice(fim);
  var pos = ini + txt.length;
  try { ta.setSelectionRange(pos, pos); } catch (_e) { /* textarea sem foco */ }
  ta.focus();
}

/** "@pa" logo antes do cursor, ou null. */
function _chdTokenMencao(ta) {
  var ate = ta.value.slice(0, typeof ta.selectionStart === 'number' ? ta.selectionStart : ta.value.length);
  var m = /(^|\s)@([A-Za-zÀ-ÿ0-9_]*)$/.exec(ate);
  return m ? { inicio: ate.length - m[2].length - 1, termo: m[2] } : null;
}

if (typeof registerActions === 'function') {
  registerActions({
    chdResponder: function (el, acao) { chamadoResponderAcao(el.dataset.id, acao); },
    chdNotaInterna: function (_el, id) { chamadoNotaInterna(id); },
    chdPainel: function (_el, qual) {
      var alvo = document.getElementById(qual === 'assunto' ? 'chdPainelAssunto' : 'chdPainelTransferir');
      var outro = document.getElementById(qual === 'assunto' ? 'chdPainelTransferir' : 'chdPainelAssunto');
      if (!alvo) return;
      if (outro) outro.hidden = true;
      alvo.hidden = !alvo.hidden;
      if (!alvo.hidden) { var f = alvo.querySelector('select, input, textarea'); if (f) f.focus(); }
    },
    chdTransferir: function (_el, id) { _chdTransferir(id); },
    chdSalvarAssunto: function (_el, id) {
      var v = String((document.getElementById('chdAssuntoInput') || {}).value || '').trim();
      if (!v) { showToast('O assunto não pode ficar vazio.', 'error'); return; }
      var p = getPendenciaById(id);
      if (!p) return;
      // quickUpdatePendenciaField não aceita 'assunto' (lista fechada de
      // campos); savePendencia valida e registra como qualquer edição.
      var novo = Object.assign({}, p, { assunto: v.slice(0, 200) });
      savePendencia(novo);
      try { _optimisticPenUpsert(novo); } catch (_e) { /* a sincronização cobre */ }
      showToast('Assunto atualizado!', 'success');
      _chdReabrir(id);
    },
    chdCompartilhar: function (_el, id) {
      var p = getPendenciaById(id);
      if (!p) return;
      // Não há link direto para um chamado: vai o protocolo e a tela de pendências.
      var link = location.origin + location.pathname + '#pendencias';
      copyToClipboard(_chdProtocolo(p) + ' – ' + _chdAssunto(p) + '\n' + link);
    },
    chdCancelar: function (_el, id) {
      var p = getPendenciaById(id);
      if (!p) return;
      confirmAction('Cancelar o chamado ' + escapeHtml(_chdProtocolo(p)) + '?', function () {
        // O confirm fecha a tela do chamado; reabre para o changePenStatus
        // achar o #chgStatus.
        openPendenciaDetail(id);
        _chdMudarStatus(id, 'cancelado');
      });
    },
    chdStatus: function (el) {
      if (typeof cmdStatusPreview === 'function') cmdStatusPreview(el);
      changePenStatus(el.dataset.id);
    },
    chdEditar: function (_el, id) { closeModal(); openPendenciaForm(id); },
    chdSessoes: function (_el, id) { openTimeEntries(id); },
    chdCheckAdd: function (_el, id) { addCheckItem(id); },
    chdDuplicar: function (_el, id) { duplicatePendencia(id); },
    chdAnexo: function (el) {
      var id = el.dataset.id;
      handleFileUpload('pendencias', id, el, function () {
        renderAttachmentList('pendencias', id, 'penAttachmentsList');
        if (typeof cmdRefreshAttCount === 'function') cmdRefreshAttCount(id);
      });
    },
    chdInserirVariavel: function (_el, nome) {
      var ta = document.getElementById('newNoteText');
      if (ta && CHAMADO_VARIAVEIS.indexOf(nome) !== -1) _chdInserirNoCursor(ta, '{' + nome + '}');
    },
    chdMencao: function (el) {
      var lista = document.getElementById('chamadoMencaoLista');
      if (!lista) return;
      var tok = _chdTokenMencao(el);
      if (!tok) { lista.hidden = true; lista.innerHTML = ''; return; }
      var termo = tok.termo.toLowerCase();
      var nomes = _chdOperadoresElegiveis().map(function (o) { return String(o.name || ''); })
        .filter(function (n) { return n && n.toLowerCase().indexOf(termo) === 0; }).slice(0, 6);
      if (!nomes.length) { lista.hidden = true; lista.innerHTML = ''; return; }
      lista.innerHTML = nomes.map(function (n) {
        return '<li role="option"><button type="button" class="chd-mencao-item" data-action="chdMencaoEscolher" data-arg="' + escapeHtml(n) + '">@' + escapeHtml(n) + '</button></li>';
      }).join('');
      lista.hidden = false;
    },
    chdMencaoEscolher: function (_el, nome) {
      var ta = document.getElementById('chamadoNotaTexto');
      var lista = document.getElementById('chamadoMencaoLista');
      if (lista) { lista.hidden = true; lista.innerHTML = ''; }
      if (!ta) return;
      var tok = _chdTokenMencao(ta);
      // A menção do storage só reconhece [A-Za-zÀ-ÿ0-9_]: nome com espaço
      // vira só o primeiro pedaço, igual ao que parseMentionedOperators lê.
      var alvo = String(nome || '').split(/\s+/)[0];
      if (tok) ta.setSelectionRange(tok.inicio, ta.selectionStart);
      _chdInserirNoCursor(ta, '@' + alvo + ' ');
    }
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CHAMADO_VARIAVEIS, chamadoAplicarVariaveis, chamadoRotuloComposer, chamadoValidarTransferencia,
    chamadoCabecalhoHtml, chamadoAcoesHtml, chamadoCartoesHtml, chamadoComposerHtml,
    chamadoResponderAcao, chamadoNotaInterna
  };
}
