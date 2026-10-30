// caixa-entrada.js — A caixa de entrada do marcador Pendências (073).
// =============================================================================
// Toda mensagem que o robô lê vira uma linha em emails_triagem, inclusive as
// que já viraram chamado sozinhas. A seção das pendências mostra só o que
// sobrou para alguém decidir; esta tela mostra a conversa inteira, agrupada
// pelo thread do Gmail, porque é o thread que o técnico enxerga — e é nele
// que a atribuição mora: duas mensagens do mesmo thread com donos diferentes
// seria o mesmo cliente atendido por duas pessoas sem saber uma da outra.
//
// Responder sai daqui por HUMANO: a resposta vai pelo Gmail na mesma conversa
// (Edge Function caixa-responder, migration 074), a mensagem enviada vira
// linha na conversa e as pendentes fecham como 'respondido'. A IA nunca
// responde sozinha: só sai e-mail por clique de operador.

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
  respondido: 'Respondido',
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

function _caixaItemHTML(c) {
  const u = c.ultima;
  const cli = c.clientId && typeof getClientById === 'function' ? getClientById(c.clientId) : null;
  const n = c.mensagens.length;
  return '<button type="button" class="cx-item' + (c.id === _caixaSelecionada ? ' ativo' : '') + (c.pendente ? ' pendente' : '') +
    '" data-action="caixaSelecionar" data-arg="' + escapeHtml(c.id) + '">' +
    '<span class="cx-item-topo"><b>' + escapeHtml(_emailTriagemNome(u.de) || u.de || '(sem remetente)') + '</b>' +
    '<span class="cx-quando">' + escapeHtml(formatDateTime(u.recebidoEm)) + '</span></span>' +
    '<span class="cx-assunto">' + escapeHtml(u.assunto || '(sem assunto)') + (n > 1 ? ' <span class="cx-n">' + n + '</span>' : '') + '</span>' +
    '<span class="cx-meta">' + escapeHtml(CAIXA_STATUS[u.status] || u.status || '') +
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
  return '<div class="cx-conv-topo">' +
    '<button type="button" class="btn btn-secondary btn-sm cx-voltar" data-action="caixaVoltar">Voltar</button>' +
    '<h2 class="ov-h2">' + escapeHtml(c.ultima.assunto || '(sem assunto)') + '</h2>' +
    '<div class="cx-meta">' + (cli ? 'Cliente: ' + escapeHtml(cli.name) : 'Sem cliente') +
    (c.atribuidoA ? ' · com ' + escapeHtml(c.atribuidoA) : ' · ninguém atribuído') +
    (motivo && c.pendente ? ' · ' + escapeHtml(motivo.label) : '') + '</div>' +
    (pen ? '<a class="cx-chamado" href="#" data-action="openPendencia" data-arg="' + escapeHtml(pen.id) + '">Chamado ' + escapeHtml(pen.id) + ': ' + escapeHtml(pen.title || pen.titulo || pen.assunto || '') + '</a>' : '') +
    (c.ultima.atribuicaoNota ? '<div class="cx-nota">Nota da atribuição: ' + escapeHtml(c.ultima.atribuicaoNota) + '</div>' : '') +
    acoes + '</div>' +
    c.mensagens.map((m) =>
      '<article class="cx-msg">' +
      '<header><b>' + escapeHtml(m.de || '') + '</b>' +
      // Selo do que SAIU daqui: sem ele a resposta da equipe parece mensagem
      // do cliente na leitura da conversa.
      (m.status === 'respondido' ? '<span class="cx-meta">✉ resposta enviada</span>' : '') +
      '<span class="cx-quando">' + escapeHtml(formatDateTime(m.recebidoEm)) + '</span></header>' +
      // Corpo como texto escapado em pre-wrap: e-mail é a entrada mais hostil
      // do app, e renderizar o HTML dele aqui abriria a porta que o escapeHtml fecha.
      '<div class="cx-corpo">' + escapeHtml(m.corpo || '') + '</div>' +
      '</article>').join('');
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

function caixaResponder(id) {
  const c = _caixaConversaPorId(id);
  if (!c) return;
  const pendentes = c.mensagens.filter((m) => m.status === 'pendente');
  if (!pendentes.length) { showToast('Esta conversa já foi tratada.', 'error'); renderCaixaEntrada(); return; }
  const alvo = pendentes[pendentes.length - 1];
  const destino = _emailTriagemEndereco(alvo.de);
  openModal('Responder ao cliente',
    '<form data-submit="caixaResponderSalvar" data-arg="' + escapeHtml(c.id) + '">' +
    '<div class="form-group"><label class="form-label">Para</label><p class="ov-muted">' + escapeHtml(destino || alvo.de || '(sem remetente)') + '</p></div>' +
    '<p class="ov-muted">Em resposta a: <b>' + escapeHtml(alvo.assunto || '(sem assunto)') + '</b></p>' +
    '<div class="form-group"><label class="form-label">Resposta *</label>' +
    '<textarea class="form-textarea" name="texto" rows="6" required placeholder="Escreva a resposta..."></textarea></div>' +
    '<p class="ov-muted">O e-mail sai pelo robô, na mesma conversa de e-mail. A IA não responde no seu lugar.</p>' +
    '<div class="form-actions"><button type="button" class="btn btn-secondary" data-action="closeModal">Cancelar</button>' +
    '<button type="submit" class="btn btn-primary">Enviar resposta</button></div></form>');
}

// Responder é decidir: a caixa-responder fecha as pendentes do thread quando o
// e-mail sai (mesmo se esta aba cair no meio). Aqui o local só é pintado depois
// de confirmado — pintar antes marcaria 'respondido' uma conversa cujo envio
// falhou, e o técnico sairia achando que o cliente foi atendido.
function caixaResponderSalvar(id, texto) {
  const c = _caixaConversaPorId(id);
  if (!c) return Promise.resolve(false);
  const pendentes = c.mensagens.filter((m) => m.status === 'pendente');
  if (!pendentes.length) { showToast('Esta conversa já foi tratada.', 'error'); renderCaixaEntrada(); return Promise.resolve(false); }
  const t = String(texto || '').trim();
  if (!t) { showToast('Escreva a resposta antes de enviar.', 'error'); return Promise.resolve(false); }
  const online = typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive;
  if (!online) { showToast('Sem conexão com o servidor: a resposta não foi enviada.', 'error'); return Promise.resolve(false); }
  const alvo = pendentes[pendentes.length - 1];
  return supabaseClient.functions.invoke('caixa-responder', { body: { email_id: alvo.id, text: t } })
    .then(function (r) {
      const d = r && r.data;
      if ((r && r.error) || !d || d.success !== true) {
        const msg = (d && d.error) || (r && r.error && r.error.message) || 'erro desconhecido';
        showToast('A resposta não foi enviada: ' + msg, 'error');
        return false;
      }
      _caixaSalvarConversa(c, { status: 'respondido' }, true);
      _emailTriagemRedesenhar();
      // O e-mail saiu: registrar pode ter falhado (074 ausente, banco fora do
      // ar) — avisa sem desfazer o envio, que já aconteceu.
      if (d.registrado === false) {
        showToast('Resposta enviada para ' + d.to + ', mas o registro na caixa falhou. Confira no servidor.', 'error');
      } else if (d.threaded === false) {
        showToast('Resposta enviada para ' + d.to + ' — como conversa nova (o original não trouxe Message-ID).', 'success');
      } else {
        showToast('Resposta enviada para ' + d.to + '.', 'success');
      }
      return true;
    })
    .catch(function (e) {
      showToast('A resposta não foi enviada.', 'error');
      if (typeof _logSilent === 'function') _logSilent(e, 'caixa-entrada:responder');
      return false;
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
  caixaResponder: (_el, id) => caixaResponder(id),
  caixaResponderSalvar: (el, id) => {
    const fd = new FormData(el);
    caixaResponderSalvar(id, String(fd.get('texto') || '')).then(function (ok) { if (ok) closeModal(); });
  },
});
