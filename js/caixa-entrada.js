// caixa-entrada.js — A caixa de entrada do marcador Pendências (073).
// =============================================================================
// Toda mensagem que o robô lê vira uma linha em emails_triagem, inclusive as
// que já viraram chamado sozinhas. A seção das pendências mostra só o que
// sobrou para alguém decidir; esta tela mostra a conversa inteira, agrupada
// pelo thread do Gmail, porque é o thread que o técnico enxerga — e é nele
// que a atribuição mora: duas mensagens do mesmo thread com donos diferentes
// seria o mesmo cliente atendido por duas pessoas sem saber uma da outra.
//
// Responder ao cliente NÃO sai daqui ainda: por enquanto a resposta passa pelo
// chamado, que já tem o envio, o histórico e o SLA. A IA nunca responde sozinha.

var _caixaFiltro = 'pendentes';
var _caixaBusca = '';
var _caixaSelecionada = null;

const CAIXA_FILTROS = {
  pendentes: 'Aguardando decisão',
  minhas: 'Atribuídas a mim',
  todas: 'Todas',
};

const CAIXA_STATUS = {
  pendente: 'Aguardando',
  virou_chamado: 'Virou chamado',
  anexado: 'Anexado a chamado',
  descartado: 'Descartado',
};

// Ordena por data ISO; entrada sem data vai para o fim em vez de quebrar a
// ordem das outras.
function _caixaData(e) {
  return String((e && e.recebidoEm) || '');
}

function caixaAgruparConversas(lista) {
  const grupos = {};
  (lista || []).forEach((e) => {
    if (!e || !e.id) return;
    const chave = e.threadId || e.id;
    (grupos[chave] = grupos[chave] || []).push(e);
  });
  return Object.keys(grupos).map((chave) => {
    const mensagens = grupos[chave].slice().sort((a, b) => _caixaData(a).localeCompare(_caixaData(b)));
    const ultima = mensagens[mensagens.length - 1];
    // Dono, cliente e chamado valem para o thread: pega o mais recente que
    // tiver o campo, porque uma resposta nova pode chegar antes do robô ou do
    // técnico carimbarem nela o que a primeira já tinha.
    const ultimoCom = (campo) => {
      for (let i = mensagens.length - 1; i >= 0; i--) if (mensagens[i][campo]) return mensagens[i][campo];
      return null;
    };
    return {
      id: chave,
      mensagens,
      ultima,
      pendente: mensagens.some((m) => m.status === 'pendente'),
      atribuidoA: ultimoCom('atribuidoA'),
      clientId: ultimoCom('clientId'),
      pendenciaId: ultimoCom('pendenciaId'),
    };
  }).sort((a, b) => _caixaData(b.ultima).localeCompare(_caixaData(a.ultima)));
}

function caixaFiltrar(conversas, filtro, busca, usuario) {
  const q = String(busca || '').trim().toLowerCase();
  return (conversas || []).filter((c) => {
    if (filtro === 'minhas' && c.atribuidoA !== usuario) return false;
    if ((filtro || 'pendentes') === 'pendentes' && !c.pendente) return false;
    if (!q) return true;
    return c.mensagens.some((m) =>
      String(m.assunto || '').toLowerCase().includes(q) || String(m.de || '').toLowerCase().includes(q));
  });
}

// Transferir sem dizer por quê deixa o novo dono sem contexto e o antigo sem
// saber que largou o caso. Primeira atribuição (ou reatribuir a si mesmo) não
// tira nada de ninguém, então não pede nota.
function caixaValidarAtribuicao(conversa, para, nota) {
  if (!para) return 'Escolha para quem atribuir.';
  const atual = conversa && conversa.atribuidoA;
  if (atual && atual !== para && !String(nota || '').trim()) {
    return 'A conversa está com ' + atual + '. Diga o motivo da transferência.';
  }
  return null;
}

function _caixaConversas() {
  const lista = typeof filterByTeam === 'function' ? filterByTeam(getEmailsTriagem()) : getEmailsTriagem();
  return caixaAgruparConversas(lista);
}

function _caixaConversaPorId(id) {
  return _caixaConversas().find((c) => c.id === id) || null;
}

// Depois que vira chamado, o que importa é onde o chamado está — "Virou
// chamado" para sempre esconde que ele já foi resolvido.
function _caixaSituacao(status, pendenciaId) {
  const pen = (status === 'virou_chamado' || status === 'anexado') && pendenciaId && typeof getPendenciaById === 'function' ? getPendenciaById(pendenciaId) : null;
  if (pen && STATUS_PEN_MAP[pen.status]) {
    return { label: 'Chamado ' + STATUS_PEN_MAP[pen.status].label.toLowerCase(), cls: isPendenciaClosed(pen.status) ? 'chamado-fechado' : 'chamado-aberto' };
  }
  return { label: CAIXA_STATUS[status] || status || '', cls: status };
}

function _caixaItemHTML(c) {
  const u = c.ultima;
  const cli = c.clientId && typeof getClientById === 'function' ? getClientById(c.clientId) : null;
  const n = c.mensagens.length;
  return '<button type="button" class="cx-item' + (c.id === _caixaSelecionada ? ' ativo' : '') + (c.pendente ? ' pendente' : '') +
    '" data-action="caixaSelecionar" data-arg="' + escapeHtml(c.id) + '">' +
    '<span class="cx-item-topo"><b>' + escapeHtml(_emailTriagemNome(u.de) || u.de || '(sem remetente)') + '</b>' +
    '<span class="cx-quando">' + escapeHtml(formatDateTime(u.recebidoEm)) + '</span></span>' +
    '<span class="cx-assunto">' + escapeHtml(u.assunto || '(sem assunto)') + (n > 1 ? ' <span class="cx-n">' + n + '</span>' : '') + '</span>' +
    '<span class="cx-meta">' + escapeHtml(_caixaSituacao(u.status, c.pendenciaId).label) +
    (cli ? ' · ' + escapeHtml(cli.name) : '') +
    (c.atribuidoA ? ' · com ' + escapeHtml(c.atribuidoA) : '') + '</span>' +
    '</button>';
}

function _caixaConversaHTML(c) {
  const id = escapeHtml(c.id);
  const cli = c.clientId && typeof getClientById === 'function' ? getClientById(c.clientId) : null;
  const pen = c.pendenciaId && typeof getPendenciaById === 'function' ? getPendenciaById(c.pendenciaId) : null;
  const motivo = EMAIL_TRIAGEM_MOTIVOS[c.ultima.motivo];
  const acoes = '<div class="cx-acoes">' +
    '<button type="button" class="btn btn-secondary btn-sm" data-action="caixaAtribuir" data-arg="' + id + '">' + (c.atribuidoA ? 'Transferir' : 'Atribuir') + '</button>' +
    '<button type="button" class="btn btn-secondary btn-sm" data-action="caixaVincular" data-arg="' + id + '">' + (cli ? 'Trocar cliente' : 'Vincular cliente') + '</button>' +
    (c.pendente ? '<button type="button" class="btn btn-primary btn-sm" data-action="caixaAbrirChamado" data-arg="' + id + '">Abrir chamado</button>' +
      '<button type="button" class="btn btn-secondary btn-sm" data-action="caixaDescartar" data-arg="' + id + '">Descartar</button>' : '') +
    '</div>';
  const u = c.ultima;
  const nome = _emailTriagemNome(u.de) || u.de || '(sem remetente)';
  const emailDe = _caixaEmailDe(u.de);
  const status = c.pendente ? 'pendente' : (u.status || '');
  const sit = _caixaSituacao(status, c.pendenciaId);
  let diaAnterior = '';
  const timeline = c.mensagens.map((m) => {
    const dia = _caixaDiaRotulo(m.recebidoEm);
    const sep = dia && dia !== diaAnterior ? '<div class="cx-dia"><span>' + escapeHtml(dia) + '</span></div>' : '';
    diaAnterior = dia;
    const quem = _emailTriagemNome(m.de) || m.de || '(sem remetente)';
    return sep + '<article class="cx-msg">' +
      '<span class="cx-avatar" aria-hidden="true">' + escapeHtml(_caixaIniciais(quem)) + '</span>' +
      '<div class="cx-balao"><header><b>' + escapeHtml(quem) + '</b><span class="cx-quando">' + escapeHtml(_caixaHora(m.recebidoEm)) + '</span></header>' +
      '<div class="cx-corpo">' + _caixaCorpoHTML(m.corpo) + '</div></div></article>';
  }).join('');
  const lado = '<aside class="cx-lado">' +
    '<section><h3>Quem pediu</h3><div class="cx-pessoa"><span class="cx-avatar">' + escapeHtml(_caixaIniciais(nome)) + '</span><div><b>' + escapeHtml(nome) + '</b>' +
    (emailDe && emailDe !== nome ? '<span class="cx-sub">' + escapeHtml(emailDe) + '</span>' : '') + '</div></div>' +
    '<dl><dt>Cliente</dt><dd>' + (cli ? escapeHtml(cli.name) : '<span class="cx-sub">Não vinculado</span>') + '</dd></dl></section>' +
    '<section><h3>Atendimento</h3><dl>' +
    '<dt>Situação</dt><dd>' + escapeHtml(sit.label) + (motivo && c.pendente ? '<span class="cx-sub">' + escapeHtml(motivo.label) + '</span>' : '') + '</dd>' +
    '<dt>Responsável</dt><dd>' + (c.atribuidoA ? escapeHtml(c.atribuidoA) : '<span class="cx-sub">Ninguém atribuído</span>') + '</dd>' +
    '<dt>Recebido</dt><dd>' + escapeHtml(formatDateTime(c.mensagens[0].recebidoEm)) + '</dd>' +
    (pen ? '<dt>Chamado</dt><dd><a class="cx-chamado" href="#" data-action="openPendencia" data-arg="' + escapeHtml(pen.id) + '">' + escapeHtml(pen.id) + ' · ' + escapeHtml(pen.title || pen.titulo || pen.assunto || '') + '</a></dd>' : '') +
    '</dl>' + (u.atribuicaoNota ? '<div class="cx-nota">' + escapeHtml(u.atribuicaoNota) + '</div>' : '') + '</section></aside>';
  return '<div class="cx-conv-topo">' +
    '<button type="button" class="btn btn-secondary btn-sm cx-voltar" data-action="caixaVoltar">Voltar</button>' +
    '<h2 class="ov-h2">' + escapeHtml(u.assunto || '(sem assunto)') + '</h2>' +
    '<div class="cx-chips"><span class="cx-chip cx-st-' + escapeHtml(sit.cls) + '">' + escapeHtml(sit.label) + '</span>' +
    '<span class="cx-chip">' + (cli ? escapeHtml(cli.name) : 'Sem cliente') + '</span>' +
    '<span class="cx-chip">' + (c.atribuidoA ? escapeHtml(c.atribuidoA) : 'Sem responsável') + '</span>' +
    '<span class="cx-chip">' + c.mensagens.length + (c.mensagens.length > 1 ? ' mensagens' : ' mensagem') + '</span></div>' +
    acoes + '</div>' +
    '<div class="cx-conv-grade"><div class="cx-timeline">' + timeline + '</div>' + lado + '</div>';
}

function _caixaEmailDe(de) {
  const m = /<([^>]+)>/.exec(de || '');
  return m ? m[1] : (de || '');
}

function _caixaIniciais(nome) {
  const partes = String(nome || '?').replace(/[<>"@].*$/, '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '?';
  return ((partes[0][0] || '') + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase();
}

function _caixaDiaRotulo(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || isNaN(d)) return '';
  const hoje = new Date();
  const ontem = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 1);
  if (d.toDateString() === hoje.toDateString()) return 'Hoje';
  if (d.toDateString() === ontem.toDateString()) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function _caixaHora(iso) {
  const d = iso ? new Date(iso) : null;
  return d && !isNaN(d) ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
}

// O que chega é e-mail cru: citação da resposta anterior e assinatura repetem
// o que a timeline já mostra, então saem. Corpo continua texto escapado — e-mail
// é a entrada mais hostil do app; só URL http(s) vira link, também escapada.
function _caixaCorpoHTML(corpo) {
  const linhas = String(corpo || '').replace(/\r\n?/g, '\n').split('\n');
  const fica = [];
  for (const l of linhas) {
    const t = l.trim();
    if (/^(Em .+escreveu:|On .+wrote:|-{2,} ?(Mensagem original|Original Message) ?-{2,}|De: .+|From: .+)$/i.test(t) && fica.length) break;
    if (t === '--' || t === '-- ') break;
    if (t.startsWith('>')) continue;
    fica.push(l);
  }
  const texto = fica.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return texto.split(/(<?https?:\/\/[^\s<>"]+>?)/g).map((p, i) => {
    if (i % 2 === 0) return escapeHtml(p);
    const url = p.replace(/^</, '').replace(/>$/, '');
    let rotulo = url;
    try { rotulo = new URL(url).hostname; } catch (_e) { /* fica a URL inteira */ }
    return '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(rotulo) + '</a>';
  }).join('');
}

function renderCaixaEntrada() {
  const titulo = document.getElementById('pageTitle');
  if (titulo) titulo.textContent = 'Caixa de entrada';
  const area = document.getElementById('contentArea');
  if (!area) return;
  if (!document.getElementById('caixaLista')) {
    area.innerHTML = '<div class="ov-wrap cx"><div class="search-bar page-toolbar">' +
      '<div class="search-input-wrap pt-search"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
      '<input class="form-input" id="caixaBusca" placeholder="Buscar por assunto ou remetente..." value="' + escapeHtml(_caixaBusca) + '" data-input="caixaBusca" /></div>' +
      '<select class="form-select pt-filter" data-change="caixaFiltro">' +
      Object.keys(CAIXA_FILTROS).map((k) => '<option value="' + k + '"' + (k === _caixaFiltro ? ' selected' : '') + '>' + escapeHtml(CAIXA_FILTROS[k]) + '</option>').join('') +
      '</select></div>' +
      '<div class="cx-corpo-tela" id="caixaTela"><div class="cx-lista" id="caixaLista"></div><section class="card cx-conversa" id="caixaConversa"></section></div></div>';
  }
  const usuario = (getUser() || {}).name || '';
  const todas = _caixaConversas();
  const visiveis = caixaFiltrar(todas, _caixaFiltro, _caixaBusca, usuario);
  const lista = document.getElementById('caixaLista');
  lista.innerHTML = visiveis.length ? visiveis.map(_caixaItemHTML).join('')
    : '<div class="empty-state"><p>' + (_caixaFiltro === 'pendentes' ? 'Nada aguardando decisão.' : 'Nenhuma conversa encontrada.') + '</p></div>';

  // A selecionada pode ter saído do filtro (foi descartada, por exemplo):
  // continua aberta, para o técnico ver o resultado do que acabou de fazer.
  const sel = _caixaSelecionada ? todas.find((c) => c.id === _caixaSelecionada) : null;
  const conv = document.getElementById('caixaConversa');
  conv.innerHTML = sel ? _caixaConversaHTML(sel) : '<div class="empty-state"><p>Escolha uma conversa.</p></div>';
  const tela = document.getElementById('caixaTela');
  if (tela) tela.classList.toggle('cx-aberta', !!sel);
}

// Grava o mesmo patch em todas as mensagens do thread. Cada update vai por id,
// e a RLS por equipe decide o resto no banco.
function _caixaSalvarConversa(c, patch, soPendentes) {
  c.mensagens.forEach((m) => {
    if (soPendentes && m.status !== 'pendente') return;
    _emailTriagemSalvar(m.id, Object.assign({}, patch));
  });
}

function caixaAtribuir(id) {
  const c = _caixaConversaPorId(id);
  if (!c) return;
  const team = c.ultima.team || (typeof _selectedTeam !== 'undefined' ? _selectedTeam : 'init');
  const ops = typeof getOperatorNames === 'function' ? getOperatorNames(team) : [];
  openModal(c.atribuidoA ? 'Transferir conversa' : 'Atribuir conversa',
    '<form data-submit="caixaAtribuirSalvar" data-arg="' + escapeHtml(c.id) + '">' +
    '<div class="form-group"><label class="form-label">Para *</label><select class="form-select" name="para" required><option value="">—</option>' +
    ops.map((n) => '<option' + (n === c.atribuidoA ? ' selected' : '') + '>' + escapeHtml(n) + '</option>').join('') + '</select></div>' +
    '<div class="form-group"><label class="form-label">Nota' + (c.atribuidoA ? ' (obrigatória ao transferir)' : '') + '</label>' +
    '<textarea class="form-textarea" name="nota" rows="3"></textarea></div>' +
    '<div class="form-actions"><button type="button" class="btn btn-secondary" data-action="closeModal">Cancelar</button>' +
    '<button type="submit" class="btn btn-primary">Salvar</button></div></form>');
}

function caixaAtribuirSalvar(id, para, nota) {
  const c = _caixaConversaPorId(id);
  if (!c) return false;
  const erro = caixaValidarAtribuicao(c, para, nota);
  if (erro) { showToast(erro, 'error'); return false; }
  // Sem status no patch: atribuir não é decidir, e o _emailTriagemSalvar só
  // carimba tratadoPor quando o status muda.
  _caixaSalvarConversa(c, {
    atribuidoA: para,
    atribuidoEm: new Date().toISOString(),
    atribuicaoNota: String(nota || '').trim() || null,
  });
  return true;
}

function caixaVincular(id) {
  const c = _caixaConversaPorId(id);
  if (!c) return;
  const clientes = typeof getMyClients === 'function' ? getMyClients() : [];
  openModal('Vincular cliente',
    '<form data-submit="caixaVincularSalvar" data-arg="' + escapeHtml(c.id) + '">' +
    '<div class="form-group"><label class="form-label">Cliente *</label><select class="form-select" name="clientId" required><option value="">—</option>' +
    clientes.map((cl) => '<option value="' + escapeHtml(cl.id) + '"' + (cl.id === c.clientId ? ' selected' : '') + '>' + escapeHtml(cl.name) + '</option>').join('') + '</select></div>' +
    '<p class="ov-muted">O remetente fica aprendido: o próximo e-mail dele já chega com o cliente.</p>' +
    '<div class="form-actions"><button type="button" class="btn btn-secondary" data-action="closeModal">Cancelar</button>' +
    '<button type="submit" class="btn btn-primary">Vincular</button></div></form>');
}

function caixaVincularSalvar(id, clientId) {
  const c = _caixaConversaPorId(id);
  const cli = clientId && typeof getClientById === 'function' ? getClientById(clientId) : null;
  if (!c || !cli) { showToast('Escolha um cliente.', 'error'); return false; }
  // A equipe vem do cliente: e-mail sem cliente nasce na init, e um cliente da
  // mam vinculado aqui precisa levar a conversa para a caixa da mam.
  _caixaSalvarConversa(c, { clientId: cli.id, team: cli.team || null });
  _emailTriagemAprender(c.ultima.de, cli.id);
  return true;
}

function caixaAbrirChamado(id) {
  const c = _caixaConversaPorId(id);
  if (!c) return;
  const pendentes = c.mensagens.filter((m) => m.status === 'pendente');
  if (!pendentes.length) { showToast('Esta conversa já foi tratada.', 'error'); renderCaixaEntrada(); return; }
  emailTriagemAbrirChamado(pendentes[pendentes.length - 1].id);
}

function caixaDescartar(id) {
  const c = _caixaConversaPorId(id);
  if (!c) return;
  const ids = c.mensagens.filter((m) => m.status === 'pendente').map((m) => m.id);
  if (!ids.length) return;
  ids.forEach((mid) => _emailTriagemSalvar(mid, { status: 'descartado', pendenciaId: null }));
  _emailTriagemRedesenhar();
  showUndoToast('Conversa descartada.', () => {
    ids.forEach((mid) => _emailTriagemSalvar(mid, { status: 'pendente', pendenciaId: null }));
    _emailTriagemRedesenhar();
  });
}

registerActions({
  caixaSelecionar: (_el, id) => { _caixaSelecionada = id || null; renderCaixaEntrada(); },
  caixaVoltar: () => { _caixaSelecionada = null; renderCaixaEntrada(); },
  caixaBusca: (_el, v) => { _caixaBusca = v || ''; renderCaixaEntrada(); },
  caixaFiltro: (_el, v) => { _caixaFiltro = CAIXA_FILTROS[v] ? v : 'pendentes'; renderCaixaEntrada(); },
  caixaAtribuir: (_el, id) => caixaAtribuir(id),
  caixaAtribuirSalvar: (el, id) => {
    const fd = new FormData(el);
    if (caixaAtribuirSalvar(id, String(fd.get('para') || ''), String(fd.get('nota') || ''))) { closeModal(); _emailTriagemRedesenhar(); }
  },
  caixaVincular: (_el, id) => caixaVincular(id),
  caixaVincularSalvar: (el, id) => {
    const fd = new FormData(el);
    if (caixaVincularSalvar(id, String(fd.get('clientId') || ''))) { closeModal(); _emailTriagemRedesenhar(); }
  },
  caixaAbrirChamado: (_el, id) => caixaAbrirChamado(id),
  caixaDescartar: (_el, id) => caixaDescartar(id),
});
