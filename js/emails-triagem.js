// emails-triagem.js — A caixa do que chegou por e-mail e NÃO virou chamado.
// =============================================================================
// Dois caminhos da triagem (robo/index.ts) descartavam em silêncio: e-mail sem
// cliente e e-mail que a IA marcou `ignorar`. Os dois podem ser pedido de
// verdade — o domínio pode não estar na ficha, a pessoa pode ter escrito do
// Gmail pessoal (que nunca casa, de propósito), e o Make erra.
//
// Esta tela não é fila de trabalho: é o registro do que chegou e ninguém viu.
// Por isso a ação de fechar chama-se DESCARTAR e grava quem descartou — some
// da lista, não do banco. Migration 066.
//
// Script clássico, como o resto de js/: sem import/export, nomes no escopo
// global (ver AGENTS.md).

var EMAIL_TRIAGEM_MOTIVOS = {
  sem_cliente: { label: 'Sem cliente', dica: 'O remetente não casou com nenhuma ficha. Cadastre o cliente, ou ponha o domínio na ficha dele.' },
  ignorado_ia: { label: 'A IA ignorou', dica: 'O Make classificou como propaganda ou aviso automático. Confira se não era pedido.' },
  auto_resposta: { label: 'Resposta automática', dica: 'Férias, confirmação de recebimento ou aviso de não entrega. Não virou nota no chamado; confira se não era gente escrevendo.' }
};

function getEmailsTriagem() {
  try { return dbGet(DB.EMAILS_TRIAGEM) || []; } catch (_e) { return []; }
}

/** Só o que ninguém tratou, do mais novo para o mais velho. */
function entradasEmailPendentes() {
  var lista = getEmailsTriagem().filter(function (e) {
    return e && e.status === 'pendente';
  });
  if (typeof filterByTeam === 'function') {
    try { lista = filterByTeam(lista); } catch (_e) { /* sem equipe: mostra tudo */ }
  }
  return lista.sort(function (a, b) {
    return String(b.recebidoEm || b.createdAt || '').localeCompare(String(a.recebidoEm || a.createdAt || ''));
  });
}

var _EMAIL_TRIAGEM_COLUNAS_073 = [
  ['client_id', 'clientId'], ['team', 'team'], ['atribuido_a', 'atribuidoA'],
  ['atribuido_em', 'atribuidoEm'], ['atribuicao_nota', 'atribuicaoNota']
];

/** A caixa (#caixa) mostra as mesmas linhas: quem muda uma redesenha as duas telas. */
function _emailTriagemRedesenhar() {
  if (typeof renderEntradasEmail === 'function') renderEntradasEmail();
  if (typeof renderCaixaEntrada === 'function' && document.getElementById('caixaLista')) renderCaixaEntrada();
  // O "+N" da aba E-mail conta as entradas pendentes; sem isso fica velho até o próximo filtro.
  if (typeof _penRenderOrigemCounts === 'function') { try { _penRenderOrigemCounts(); } catch (_e) { /* fora da tela de pendências */ } }
}

/** Grava a decisão na entrada e empurra para o banco, como o resto do app. */
function _emailTriagemSalvar(id, patch) {
  var lista = getEmailsTriagem();
  var i = lista.findIndex(function (e) { return e && e.id === id; });
  if (i === -1) return null;
  var agora = new Date().toISOString();
  // Só quem DECIDIU leva nome e data. O desfazer devolve status 'pendente',
  // e estampar tratadoPor/tratadoEm nela registraria um responsável numa
  // decisão que ninguém tomou — a entrada volta exatamente como chegou.
  var decidida = String((patch && patch.status) || lista[i].status || '') !== 'pendente';
  // Atribuir ou vincular não é decisão sobre a entrada: sem status no patch,
  // quem a tratou (ou ninguém) continua sendo quem estava.
  var mudaStatus = !!(patch && 'status' in patch);
  var anterior = lista[i];
  lista[i] = Object.assign({}, anterior, patch, {
    tratadoPor: mudaStatus ? (decidida ? ((typeof getUser === 'function' && getUser()) ? getUser().name : '') : null) : (anterior.tratadoPor || null),
    tratadoEm: mudaStatus ? (decidida ? agora : null) : (anterior.tratadoEm || null),
    // O sync resolve conflito por updatedAt: sem isto, duas abas decidindo a
    // mesma entrada não teriam como saber qual decisão é a mais nova.
    updatedAt: agora
  });
  dbSet(DB.EMAILS_TRIAGEM, lista);
  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    var payload = {
      status: lista[i].status,
      pendencia_id: lista[i].pendenciaId || null,
      tratado_por: lista[i].tratadoPor,
      tratado_em: lista[i].tratadoEm,
      updated_at: lista[i].updatedAt
    };
    // As colunas da 073 só vão quando a ação mexeu nelas: um banco ainda sem
    // a migration recusaria o update inteiro, e descartar deixaria de funcionar.
    _EMAIL_TRIAGEM_COLUNAS_073.forEach(function (par) {
      if (patch && par[1] in patch) payload[par[0]] = lista[i][par[1]] == null ? null : lista[i][par[1]];
    });
    supabaseClient.from('emails_triagem').update(payload).eq('id', id).then(function (res) {
      if (res.error) { console.error('❌ Supabase emails_triagem:', res.error); markSyncPushFailed(); }
    }).catch(function () { markSyncPushFailed(); });
  }
  return lista[i];
}

/**
 * A entrada vira chamado: abre o formulário já preenchido com o que o e-mail
 * trouxe. O cliente só vem preenchido quando alguém o VINCULOU na caixa — sem
 * isso fica em branco de propósito: a entrada está aqui justamente porque
 * ninguém sabe de quem é, e adivinhar poria o chamado no cliente errado.
 *
 * A entrada só é marcada depois que o chamado existe de fato: marcar antes
 * perderia o e-mail se a pessoa desistisse no meio do formulário.
 */
function emailTriagemAbrirChamado(id) {
  var e = getEmailsTriagem().find(function (x) { return x && x.id === id; });
  if (!e) { showToast('Entrada não encontrada.', 'error'); return; }
  // Card velho na tela (sem realtime, outra aba, colega tratou primeiro):
  // abrir o formulário em cima dele viraria um SEGUNDO chamado para a mesma
  // mensagem. O status é conferido aqui, onde ainda dá para recusar.
  if (e.status !== 'pendente') {
    showToast('Esta entrada já foi tratada.', 'error');
    _emailTriagemRedesenhar();
    return;
  }
  if (typeof openPendenciaForm !== 'function') return;
  openPendenciaForm(null, e.clientId || null, null, {
    assunto: String(e.assunto || '').slice(0, 120),
    descricao: String(e.corpo || ''),
    canal: 'email',
    solicitante: (typeof _emailTriagemNome === 'function') ? _emailTriagemNome(e.de) : '',
    solicitanteEmail: _emailTriagemEndereco(e.de),
    emailThreadId: e.threadId || null,
    emailMessageId: e.messageId || null,
    emailCorpo: e.corpo || null,
    // O id da entrada viaja NO formulário, não em window: o cancelar destrói
    // o formulário, e com ele a pendência de marcá-la. Um id solto em
    // window._emailTriagemPendente sobrevivia ao cancelamento, e o PRÓXIMO
    // chamado criado pelo formulário marcava a entrada abandonada como
    // virou_chamado — apontando para o chamado errado.
    etrEntrada: id
  });
}

/** `Márcia <m@acme.com.br>` → `m@acme.com.br`. Par do enderecoDoRemetente do robô. */
function _emailTriagemEndereco(de) {
  var m = /<([^>]+)>/.exec(String(de || ''));
  var alvo = (m ? m[1] : String(de || '')).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(alvo) ? alvo : '';
}

/** Nome de quem escreveu; sem nome, a parte antes do @. */
function _emailTriagemNome(de) {
  var s = String(de || '').trim();
  var m = /^\s*"?([^"<]+?)"?\s*</.exec(s);
  if (m) return m[1].trim().slice(0, 120);
  return (_emailTriagemEndereco(s).split('@')[0] || s).trim().slice(0, 120);
}

/** Chamado criado a partir de uma entrada: fecha o ciclo. Chamado por pendencias, com o id vindo do formulário. */
function emailTriagemMarcarAberta(pendenciaId, id, clientId) {
  if (!id || !pendenciaId) return;
  var e = getEmailsTriagem().find(function (x) { return x && x.id === id; });
  // Entre abrir o formulário e salvar, o colega pode ter tratado a entrada:
  // por cima da decisão dele, o pendenciaId novo apontaria para o chamado errado.
  if (!e || e.status !== 'pendente') {
    _emailTriagemRedesenhar();
    return;
  }
  _emailTriagemSalvar(id, { status: 'virou_chamado', pendenciaId: pendenciaId });
  // Quem escolheu o cliente no formulário respondeu a pergunta que o robô não
  // soube responder: guardar a resposta é o que evita a mesma entrada amanhã.
  _emailTriagemAprender(e.de, clientId);
  _emailTriagemRedesenhar();
}

// Par do DOMINIOS_PUBLICOS do robô (robo/campo.ts). Mudou lá, muda aqui: um
// provedor pessoal fora desta lista teria o DOMÍNIO aprendido, e todo mundo que
// escreve dele viraria chamado do mesmo cliente.
var _EMAIL_TRIAGEM_PESSOAIS = [
  'gmail.com', 'hotmail.com', 'hotmail.com.br', 'outlook.com', 'outlook.com.br',
  'live.com', 'yahoo.com', 'yahoo.com.br', 'icloud.com', 'me.com', 'msn.com',
  'uol.com.br', 'bol.com.br', 'terra.com.br', 'globo.com'
];

/**
 * Grava em clientes_remetentes (072) que este remetente é deste cliente.
 * Provedor pessoal aprende o endereço; domínio próprio aprende o domínio.
 * Vai direto ao Supabase, fora do sync: quem lê é o robô, não o app.
 */
function _emailTriagemAprender(de, clientId) {
  var endereco = _emailTriagemEndereco(de);
  var c = (clientId && typeof getClientById === 'function') ? getClientById(clientId) : null;
  if (!endereco || !c) return null;
  var dominio = endereco.split('@')[1];
  var pessoal = _EMAIL_TRIAGEM_PESSOAIS.indexOf(dominio) !== -1;
  var remetente = pessoal ? endereco : dominio;
  // O team é o do CLIENTE, não o de quem vinculou: é o cliente que pertence a
  // uma equipe, e é a equipe dele que precisa enxergar (e corrigir) o vínculo.
  var team = c.team || 'init';
  var u = typeof getUser === 'function' ? getUser() : null;
  var linha = {
    // id derivado da chave única: vincular de novo atualiza a mesma linha.
    id: team + '|' + remetente,
    remetente: remetente,
    tipo: pessoal ? 'endereco' : 'dominio',
    client_id: c.id,
    team: team,
    created_by: u ? u.name : null,
    updated_at: new Date().toISOString()
  };
  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    // Falhar aqui não é falha de sync: sem a 072, ou com o cliente ainda não
    // enviado, o robô só deixa de aprender. O chamado já está salvo.
    supabaseClient.from('clientes_remetentes').upsert(linha, { onConflict: 'team,remetente' }).then(function (res) {
      if (res && res.error) console.warn('⚠️ clientes_remetentes:', res.error.message);
    }).catch(function () {});
  }
  return linha;
}

/** Descartar: some da lista, fica no banco com quem decidiu. */
function emailTriagemDescartar(id) {
  var e = _emailTriagemSalvar(id, { status: 'descartado', pendenciaId: null });
  if (!e) { showToast('Entrada não encontrada.', 'error'); return; }
  _emailTriagemRedesenhar();
  if (typeof showUndoToast === 'function') {
    showUndoToast('Entrada descartada.', function () {
      _emailTriagemSalvar(id, { status: 'pendente', pendenciaId: null });
      _emailTriagemRedesenhar();
    });
  } else {
    showToast('Entrada descartada.', 'success');
  }
}

function _emailTriagemCardHtml(e) {
  var motivo = EMAIL_TRIAGEM_MOTIVOS[e.motivo] || { label: e.motivo || '—', dica: '' };
  var quando = e.recebidoEm || e.createdAt || '';
  try { if (Date.parse(quando) && typeof formatDateTime === 'function') quando = formatDateTime(quando); } catch (_e) { /* data estranha: mostra crua */ }
  var trecho = String(e.corpo || '').replace(/\s+/g, ' ').trim();
  return '<li class="etr-card">'
    + '<div class="etr-top">'
    + '<span class="etr-motivo etr-motivo--' + escapeHtml(e.motivo || 'outro') + '" title="' + escapeHtml(motivo.dica) + '">' + escapeHtml(motivo.label) + '</span>'
    + '<span class="etr-quando">' + escapeHtml(quando) + '</span>'
    + '</div>'
    + '<div class="etr-assunto">' + (escapeHtml(e.assunto || '') || '<em>sem assunto</em>') + '</div>'
    + '<div class="etr-de">' + escapeHtml(e.de || '') + '</div>'
    + (trecho ? '<p class="etr-trecho">' + escapeHtml(trecho.slice(0, 260)) + (trecho.length > 260 ? '…' : '') + '</p>' : '')
    + '<div class="etr-acoes">'
    + '<button type="button" class="btn btn-primary btn-sm" data-action="etrAbrir" data-arg="' + escapeHtml(e.id) + '">Abrir chamado</button>'
    + '<button type="button" class="btn btn-secondary btn-sm" data-action="etrDescartar" data-arg="' + escapeHtml(e.id) + '">Descartar</button>'
    + '</div></li>';
}

/**
 * Desenha a caixa. Sem entradas pendentes ela some inteira — um painel vazio
 * dizendo "nada aqui" todo dia vira ruído, e aí ninguém lê quando tem algo.
 */
function renderEntradasEmail() {
  var node = document.getElementById('penEntradasEmail');
  if (!node) return;
  var lista = entradasEmailPendentes();
  if (!lista.length) { node.innerHTML = ''; return; }
  var aberta = true;
  try { aberta = localStorage.getItem('intra_etr_fechada') !== '1'; } catch (_e) { /* sem localStorage: aberta */ }
  node.innerHTML = '<section class="etr-box' + (aberta ? '' : ' is-fechada') + '">'
    + '<button type="button" class="etr-head" data-action="etrToggle" aria-expanded="' + (aberta ? 'true' : 'false') + '">'
    + '<span class="etr-head-title">📥 Chegou por e-mail e não virou chamado</span>'
    + '<span class="etr-count">' + lista.length + '</span>'
    + '<span class="etr-chevron" aria-hidden="true">' + (aberta ? '▾' : '▸') + '</span>'
    + '</button>'
    // Fora do botão: link dentro de <button> não é clicável de forma confiável.
    + '<a class="etr-link" href="#caixa" data-action="nav" data-arg="caixa">Abrir caixa de entrada</a>'
    + (aberta ? '<ul class="etr-lista">' + lista.map(_emailTriagemCardHtml).join('') + '</ul>' : '')
    + '</section>';
}

function emailTriagemToggle() {
  var aberta = true;
  try {
    aberta = localStorage.getItem('intra_etr_fechada') !== '1';
    localStorage.setItem('intra_etr_fechada', aberta ? '1' : '0');
  } catch (_e) { /* sem localStorage: não lembra, e tudo bem */ }
  renderEntradasEmail();
}

if (typeof registerActions === 'function') {
  registerActions({
    etrAbrir: function (_el, arg) { emailTriagemAbrirChamado(arg); },
    etrDescartar: function (_el, arg) { emailTriagemDescartar(arg); },
    etrToggle: function () { emailTriagemToggle(); }
  });
}
