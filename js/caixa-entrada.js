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
//
// Desde a 075 a mesma tabela recebe o WhatsApp (canal = 'whatsapp', telefone).
// Não há thread do Gmail ali: a conversa é o telefone, e é por ele que a
// mensagem se agrupa, sugere cliente e vira chamado. Entrada sem canal é
// e-mail — é tudo o que existia antes da coluna.

var _caixaFiltro = 'pendentes';
var _caixaBusca = '';
var _caixaSelecionada = null;
var _caixaCanal = 'todos';

const CAIXA_CANAIS = {
  todos: 'Todos os canais',
  email: 'E-mail',
  whatsapp: 'WhatsApp',
};

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

// O telefone é a pista do WhatsApp mesmo sem o canal gravado: o backend pode
// ter escrito um antes do outro, e mensagem com telefone não tem e-mail.
function caixaCanalEntrada(e) {
  if (!e) return 'email';
  return e.canal === 'whatsapp' || String(e.telefone || '').trim() ? 'whatsapp' : 'email';
}

// O 'whatsapp:' na frente impede que um telefone colida com um thread id do
// Gmail. A chave normalizada junta "5511987654321" e "1187654321", que são a
// mesma pessoa escrita de dois jeitos.
function _caixaChaveConversa(e) {
  if (caixaCanalEntrada(e) !== 'whatsapp') return e.threadId || e.id;
  return 'whatsapp:' + (chamadoTelefoneChave(e.telefone) || chamadoTelefoneDigitos(e.telefone) || e.id);
}

function caixaAgruparConversas(lista) {
  const grupos = {};
  (lista || []).forEach((e) => {
    if (!e || !e.id) return;
    const chave = _caixaChaveConversa(e);
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
      canal: caixaCanalEntrada(ultima),
      telefone: ultimoCom('telefone'),
      pendente: mensagens.some((m) => m.status === 'pendente'),
      atribuidoA: ultimoCom('atribuidoA'),
      clientId: ultimoCom('clientId'),
      pendenciaId: ultimoCom('pendenciaId'),
    };
  }).sort((a, b) => _caixaData(b.ultima).localeCompare(_caixaData(a.ultima)));
}

function caixaFiltrar(conversas, filtro, busca, usuario) {
  const q = String(busca || '').trim().toLowerCase();
  // Telefone se busca pelos dígitos: ninguém digita os parênteses e o hífen
  // do jeito que o cadastro guardou.
  const qDig = chamadoTelefoneDigitos(q);
  return (conversas || []).filter((c) => {
    if (filtro === 'minhas' && c.atribuidoA !== usuario) return false;
    if ((filtro || 'pendentes') === 'pendentes' && !c.pendente) return false;
    if (!q) return true;
    return c.mensagens.some((m) =>
      String(m.assunto || '').toLowerCase().includes(q) || String(m.de || '').toLowerCase().includes(q) ||
      (qDig.length >= 4 && chamadoTelefoneDigitos(m.telefone).includes(qDig)));
  });
}

// Separado do filtro de situação para a contagem por situação continuar
// valendo dentro do canal escolhido.
function caixaFiltrarCanal(conversas, canal) {
  if (!canal || canal === 'todos') return (conversas || []).slice();
  return (conversas || []).filter((c) => (c.canal || 'email') === canal);
}

// Cadastro guarda o telefone do dono e o do responsável, cada um num formato.
// Devolve o id só quando um cliente bate: dois clientes com o mesmo número é
// ambíguo, e sugerir o errado é pior que não sugerir.
function caixaClientePorTelefone(telefone, clientes) {
  const chave = chamadoTelefoneChave(telefone);
  if (!chave) return null;
  const achados = (clientes || []).filter((cl) => cl &&
    (chamadoTelefoneChave(cl.ownerPhone) === chave || chamadoTelefoneChave(cl.responsiblePhone) === chave));
  return achados.length === 1 ? achados[0].id : null;
}

// No WhatsApp o "de" pode ser o nome do perfil ou o próprio número. Número cru
// não é nome: mostra formatado, que é como o técnico reconhece.
function _caixaNomeDe(m, canal) {
  if (!m) return '(sem remetente)';
  if (canal !== 'whatsapp') return _emailTriagemNome(m.de) || m.de || '(sem remetente)';
  const de = String(m.de || '').trim();
  const soNumero = !de || (chamadoTelefoneDigitos(de).length >= 8 && !/[a-zà-ú]/i.test(de));
  if (!soNumero) return de;
  return chamadoTelefoneFormatar(m.telefone || de) || '(sem remetente)';
}

// Badge do canal: só ícone + rótulo, todo texto passa por escapeHtml.
function _caixaCanalHTML(canal) {
  const c = canal === 'whatsapp' ? 'whatsapp' : 'email';
  const icone = c === 'whatsapp'
    ? '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 21l2.1-5.4A8.4 8.4 0 1 1 21 11.5z"/></svg>'
    : '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>';
  return '<span class="cx-canal cx-canal-' + escapeHtml(c) + '">' + icone + escapeHtml(CAIXA_CANAIS[c]) + '</span>';
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

// Separa o que o cliente escreveu da citação e da assinatura. A assinatura não
// some: às vezes é ali que está o telefone ou o cargo de quem pediu.
// WhatsApp não tem citação nem assinatura: uma linha "-- " ou começando com ">"
// é o que a pessoa digitou, e cortar ali apagaria parte do pedido.
function caixaCorpoLimpo(corpo, canal) {
  if (canal === 'whatsapp') {
    return { texto: String(corpo || '').replace(/\r\n?/g, '\n').trim(), assinatura: '' };
  }
  const linhas = String(corpo || '').replace(/\r\n?/g, '\n').split('\n');
  const fica = [];
  const assina = [];
  let naAssinatura = false;
  for (const l of linhas) {
    const t = l.trim();
    if (/^(Em .+escreveu:|On .+wrote:|-{2,} ?(Mensagem original|Original Message) ?-{2,}|De: .+|From: .+)$/i.test(t) && (fica.length || assina.length)) break;
    if (!naAssinatura && (t === '--' || t === '-- ')) { naAssinatura = true; continue; }
    if (t.startsWith('>')) continue;
    (naAssinatura ? assina : fica).push(l);
  }
  const limpa = (arr) => arr.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { texto: limpa(fica), assinatura: limpa(assina) };
}

function caixaPrevia(corpo, max, canal) {
  const lim = max || 120;
  const linha = caixaCorpoLimpo(corpo, canal).texto.split('\n').map((l) => l.trim())
    .find((l) => l && !/^(ol[áa]|oi|bom dia|boa tarde|boa noite|prezad[oa]s?)\b[^.!?]{0,30}[,!.]?$/i.test(l)) || '';
  return linha.length > lim ? linha.slice(0, lim - 1).trimEnd() + '…' : linha;
}

// Tempo de espera conta da última mensagem do cliente: é o relógio que ele vê.
function caixaEsperaRotulo(iso, agora) {
  const t = iso ? new Date(iso).getTime() : NaN;
  if (isNaN(t)) return '';
  const min = Math.max(0, Math.floor(((agora || Date.now()) - t) / 60000));
  if (min < 1) return 'agora';
  if (min < 60) return 'há ' + min + ' min';
  const h = Math.floor(min / 60);
  if (h < 24) return 'há ' + h + ' h';
  const d = Math.floor(h / 24);
  return 'há ' + d + (d === 1 ? ' dia' : ' dias');
}

// Domínio corporativo identifica a empresa; gmail/hotmail não identifica
// ninguém, então nesse caso só o mesmo endereço vale como pista.
function _caixaChaveRemetente(de) {
  const end = _emailTriagemEndereco(de);
  const dom = end.split('@')[1] || '';
  if (!dom) return '';
  return _EMAIL_TRIAGEM_PESSOAIS.indexOf(dom) >= 0 ? end : '@' + dom;
}

function caixaSugerirCliente(conversa, conversas) {
  if (!conversa || conversa.clientId) return null;
  // WhatsApp não tem domínio para votar; o telefone casa direto no cadastro.
  if (conversa.canal === 'whatsapp') {
    return caixaClientePorTelefone(conversa.telefone, typeof getMyClients === 'function' ? getMyClients() : []);
  }
  const chave = _caixaChaveRemetente(conversa.ultima && conversa.ultima.de);
  if (!chave) return null;
  const votos = {};
  (conversas || []).forEach((c) => {
    if (c.id === conversa.id || !c.clientId) return;
    if (_caixaChaveRemetente(c.ultima && c.ultima.de) === chave) votos[c.clientId] = (votos[c.clientId] || 0) + 1;
  });
  const ids = Object.keys(votos).sort((a, b) => votos[b] - votos[a]);
  return ids[0] || null;
}

function caixaHistoricoRemetente(conversa, conversas, max) {
  if (conversa && conversa.canal === 'whatsapp') {
    const tel = chamadoTelefoneChave(conversa.telefone);
    if (!tel) return [];
    return (conversas || []).filter((c) => c.id !== conversa.id && chamadoTelefoneChave(c.telefone) === tel)
      .slice(0, max || 5);
  }
  const end = conversa && conversa.ultima ? _emailTriagemEndereco(conversa.ultima.de) : '';
  if (!end) return [];
  return (conversas || []).filter((c) => c.id !== conversa.id && _emailTriagemEndereco(c.ultima && c.ultima.de) === end)
    .slice(0, max || 5);
}

function caixaContarFiltros(conversas, usuario) {
  const r = {};
  Object.keys(CAIXA_FILTROS).forEach((k) => { r[k] = caixaFiltrar(conversas, k, '', usuario).length; });
  return r;
}

// Lido/não lido é por pessoa e não precisa sobreviver a outro aparelho, então
// fica no navegador. Guarda o id da última mensagem vista: resposta nova no
// thread faz a conversa voltar a não lida sozinha.
function _caixaLidasChave() {
  const u = typeof getUser === 'function' ? (getUser() || {}) : {};
  return 'caixaLidas:' + (u.id || u.name || '');
}

function _caixaLidas() {
  try {
    return JSON.parse(localStorage.getItem(_caixaLidasChave()) || '{}') || {};
  } catch (_e) {
    return {};
  }
}

function _caixaGravarLidas(mapa) {
  try { localStorage.setItem(_caixaLidasChave(), JSON.stringify(mapa)); } catch (_e) { /* modo privado: segue sem */ }
}

function caixaNaoLida(conversa, lidas) {
  return !!conversa && !!conversa.ultima && (lidas || {})[conversa.id] !== conversa.ultima.id;
}

function _caixaMarcar(conversa, lida) {
  if (!conversa) return;
  const mapa = _caixaLidas();
  if (lida) mapa[conversa.id] = conversa.ultima.id;
  else delete mapa[conversa.id];
  _caixaGravarLidas(mapa);
}

function _caixaConversas() {
  const lista = typeof filterByTeam === 'function' ? filterByTeam(getEmailsTriagem()) : getEmailsTriagem();
  return caixaAgruparConversas(lista);
}

function _caixaConversaPorId(id) {
  return _caixaConversas().find((c) => c.id === id) || null;
}

function _caixaItemHTML(c, lidas) {
  const u = c.ultima;
  const cli = c.clientId && typeof getClientById === 'function' ? getClientById(c.clientId) : null;
  const n = c.mensagens.length;
  const naoLida = caixaNaoLida(c, lidas);
  const status = c.pendente ? 'pendente' : (u.status || '');
  const previa = caixaPrevia(u.corpo, 120, c.canal);
  return '<button type="button" class="cx-item' + (c.id === _caixaSelecionada ? ' ativo' : '') + (c.pendente ? ' pendente' : '') + (naoLida ? ' nao-lida' : '') +
    '" data-action="caixaSelecionar" data-arg="' + escapeHtml(c.id) + '">' +
    '<span class="cx-item-topo">' + (naoLida ? '<span class="cx-ponto" aria-label="Não lida"></span>' : '') +
    '<b>' + escapeHtml(_caixaNomeDe(u, c.canal)) + '</b>' +
    '<span class="cx-quando" title="' + escapeHtml(formatDateTime(u.recebidoEm)) + '">' + escapeHtml(caixaEsperaRotulo(u.recebidoEm)) + '</span></span>' +
    '<span class="cx-assunto">' + escapeHtml(u.assunto || '(sem assunto)') + (n > 1 ? ' <span class="cx-n">' + n + '</span>' : '') + '</span>' +
    (previa ? '<span class="cx-previa">' + escapeHtml(previa) + '</span>' : '') +
    '<span class="cx-meta"><span class="cx-chip cx-st-' + escapeHtml(status) + '">' + escapeHtml(CAIXA_STATUS[status] || status) + '</span>' +
    _caixaCanalHTML(c.canal) +
    (cli ? '<span>' + escapeHtml(cli.name) + '</span>' : '<span class="cx-alerta">Sem cliente</span>') +
    (c.atribuidoA ? '<span>com ' + escapeHtml(c.atribuidoA) + '</span>' : '') + '</span>' +
    '</button>';
}

function _caixaConversaHTML(c) {
  const id = escapeHtml(c.id);
  const cli = c.clientId && typeof getClientById === 'function' ? getClientById(c.clientId) : null;
  const pen = c.pendenciaId && typeof getPendenciaById === 'function' ? getPendenciaById(c.pendenciaId) : null;
  const motivo = EMAIL_TRIAGEM_MOTIVOS[c.ultima.motivo];
  // Resposta ao cliente sai pelo chamado, que é onde fica o histórico e o SLA:
  // a caixa só aponta o caminho, não compõe e-mail por fora.
  const acoes = '<div class="cx-acoes">' +
    (pen ? '<button type="button" class="btn btn-primary btn-sm" data-action="openPendencia" data-arg="' + escapeHtml(pen.id) + '">Responder pelo chamado</button>' : '') +
    '<button type="button" class="btn btn-secondary btn-sm" data-action="caixaAtribuir" data-arg="' + id + '">' + (c.atribuidoA ? 'Transferir' : 'Atribuir') + '</button>' +
    '<button type="button" class="btn btn-secondary btn-sm" data-action="caixaVincular" data-arg="' + id + '">' + (cli ? 'Trocar cliente' : 'Vincular cliente') + '</button>' +
    (c.pendente ? '<button type="button" class="btn btn-primary btn-sm" data-action="caixaAbrirChamado" data-arg="' + id + '">Abrir chamado</button>' +
      '<button type="button" class="btn btn-secondary btn-sm" data-action="caixaDescartar" data-arg="' + id + '">Descartar</button>' : '') +
    '<button type="button" class="btn btn-secondary btn-sm" data-action="caixaMarcarNaoLida" data-arg="' + id + '">Marcar como não lida</button>' +
    '</div>';
  const todas = _caixaConversas();
  const sugerido = caixaSugerirCliente(c, todas);
  const cliSug = sugerido && typeof getClientById === 'function' ? getClientById(sugerido) : null;
  const historico = caixaHistoricoRemetente(c, todas);
  const u = c.ultima;
  const whats = c.canal === 'whatsapp';
  const nome = _caixaNomeDe(u, c.canal);
  // No WhatsApp o contato é o telefone; o e-mail cru do "de" não existe ali.
  const emailDe = whats ? chamadoTelefoneFormatar(c.telefone || u.telefone || '') : _caixaEmailDe(u.de);
  const status = c.pendente ? 'pendente' : (u.status || '');
  let diaAnterior = '';
  const timeline = c.mensagens.map((m) => {
    const dia = _caixaDiaRotulo(m.recebidoEm);
    const sep = dia && dia !== diaAnterior ? '<div class="cx-dia"><span>' + escapeHtml(dia) + '</span></div>' : '';
    diaAnterior = dia;
    const quem = _caixaNomeDe(m, c.canal);
    return sep + '<article class="cx-msg">' +
      '<span class="cx-avatar" aria-hidden="true">' + escapeHtml(_caixaIniciais(quem)) + '</span>' +
      '<div class="cx-balao"><header><b>' + escapeHtml(quem) + '</b><span class="cx-quando">' + escapeHtml(_caixaHora(m.recebidoEm)) + '</span></header>' +
      _caixaCorpoHTML(m.corpo, c.canal) + '</div></article>';
  }).join('');
  const lado = '<aside class="cx-lado">' +
    '<section><h3>Quem pediu</h3><div class="cx-pessoa"><span class="cx-avatar">' + escapeHtml(_caixaIniciais(nome)) + '</span><div><b>' + escapeHtml(nome) + '</b>' +
    (emailDe && emailDe !== nome ? '<span class="cx-sub">' + escapeHtml(emailDe) + '</span>' : '') + '</div></div>' +
    '<dl><dt>Cliente</dt><dd>' + (cli ? escapeHtml(cli.name) : '<span class="cx-sub">Não vinculado</span>') + '</dd></dl>' +
    (cliSug ? '<div class="cx-sugestao"><span>Parece ser <b>' + escapeHtml(cliSug.name) + '</b>, ' + (whats ? 'pelo telefone' : 'pelo remetente') + '.</span>' +
      '<button type="button" class="btn btn-primary btn-sm" data-action="caixaVincularSugerido" data-arg="' + id + '">Vincular</button></div>' : '') +
    '</section>' +
    (historico.length ? '<section><h3>Outras conversas dele</h3><ul class="cx-historico">' +
      historico.map((h) => '<li><a href="#" data-action="caixaSelecionar" data-arg="' + escapeHtml(h.id) + '">' + escapeHtml(h.ultima.assunto || '(sem assunto)') +
        '<span class="cx-sub">' + escapeHtml(formatDateTime(h.ultima.recebidoEm)) + '</span></a></li>').join('') + '</ul></section>' : '') +
    '<section><h3>Atendimento</h3><dl>' +
    '<dt>Situação</dt><dd>' + escapeHtml(CAIXA_STATUS[status] || status) + (motivo && c.pendente ? '<span class="cx-sub">' + escapeHtml(motivo.label) + '</span>' : '') + '</dd>' +
    '<dt>Responsável</dt><dd>' + (c.atribuidoA ? escapeHtml(c.atribuidoA) : '<span class="cx-sub">Ninguém atribuído</span>') + '</dd>' +
    '<dt>Recebido</dt><dd>' + escapeHtml(formatDateTime(c.mensagens[0].recebidoEm)) + '</dd>' +
    (pen ? '<dt>Chamado</dt><dd><a class="cx-chamado" href="#" data-action="openPendencia" data-arg="' + escapeHtml(pen.id) + '">' + escapeHtml(pen.id) + ' · ' + escapeHtml(pen.title || pen.titulo || pen.assunto || '') + '</a></dd>' : '') +
    '</dl>' + (u.atribuicaoNota ? '<div class="cx-nota">' + escapeHtml(u.atribuicaoNota) + '</div>' : '') + '</section></aside>';
  return '<div class="cx-conv-topo">' +
    '<button type="button" class="btn btn-secondary btn-sm cx-voltar" data-action="caixaVoltar">Voltar</button>' +
    '<h2 class="ov-h2">' + escapeHtml(u.assunto || '(sem assunto)') + '</h2>' +
    '<div class="cx-chips"><span class="cx-chip cx-st-' + escapeHtml(status) + '">' + escapeHtml(CAIXA_STATUS[status] || status) + '</span>' +
    _caixaCanalHTML(c.canal) +
    (c.pendente ? '<span class="cx-chip cx-chip-alerta" title="' + escapeHtml(formatDateTime(u.recebidoEm)) + '">Aguardando ' + escapeHtml(caixaEsperaRotulo(u.recebidoEm)) + '</span>' : '') +
    '<span class="cx-chip' + (cli ? '' : ' cx-chip-alerta') + '">' + (cli ? escapeHtml(cli.name) : 'Sem cliente') + '</span>' +
    '<span class="cx-chip' + (c.atribuidoA ? '' : ' cx-chip-alerta') + '">' + (c.atribuidoA ? escapeHtml(c.atribuidoA) : 'Sem responsável') + '</span>' +
    (pen ? '<span class="cx-chip">Chamado #' + escapeHtml(String(pen.id).slice(0, 8)) + '</span>' : '') +
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
function _caixaCorpoHTML(corpo, canal) {
  const limpo = caixaCorpoLimpo(corpo, canal);
  return '<div class="cx-corpo">' + _caixaLinkificar(limpo.texto) + '</div>' +
    (limpo.assinatura ? '<details class="cx-assinatura"><summary>Assinatura</summary><div class="cx-corpo">' + _caixaLinkificar(limpo.assinatura) + '</div></details>' : '');
}

function _caixaLinkificar(texto) {
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
      '<input class="form-input" id="caixaBusca" placeholder="Buscar por assunto, remetente ou telefone..." value="' + escapeHtml(_caixaBusca) + '" data-input="caixaBusca" /></div>' +
      '<select class="form-select pt-filter" id="caixaFiltro" data-change="caixaFiltro">' +
      Object.keys(CAIXA_FILTROS).map((k) => '<option value="' + k + '"' + (k === _caixaFiltro ? ' selected' : '') + '>' + escapeHtml(CAIXA_FILTROS[k]) + '</option>').join('') +
      '</select>' +
      '<select class="form-select pt-filter" id="caixaCanal" data-change="caixaCanal" aria-label="Canal">' +
      Object.keys(CAIXA_CANAIS).map((k) => '<option value="' + escapeHtml(k) + '"' + (k === _caixaCanal ? ' selected' : '') + '>' + escapeHtml(CAIXA_CANAIS[k]) + '</option>').join('') +
      '</select></div>' +
      '<div class="cx-corpo-tela" id="caixaTela"><div class="cx-lista" id="caixaLista"></div><section class="card cx-conversa" id="caixaConversa"></section></div></div>';
  }
  const usuario = (getUser() || {}).name || '';
  const todas = _caixaConversas();
  // A contagem por situação respeita o canal: "Aguardando (3)" com WhatsApp
  // escolhido tem que ser 3 conversas de WhatsApp.
  const doCanal = caixaFiltrarCanal(todas, _caixaCanal);
  const visiveis = caixaFiltrar(doCanal, _caixaFiltro, _caixaBusca, usuario);
  // A toolbar não é remontada (perderia o foco da busca), então só os rótulos
  // do filtro são atualizados com a contagem.
  const selCanal = document.getElementById('caixaCanal');
  if (selCanal) selCanal.value = _caixaCanal;
  const sel0 = document.getElementById('caixaFiltro');
  if (sel0 && sel0.options) {
    sel0.value = _caixaFiltro;
    const contagem = caixaContarFiltros(doCanal, usuario);
    Array.prototype.forEach.call(sel0.options, (o) => { o.textContent = CAIXA_FILTROS[o.value] + ' (' + (contagem[o.value] || 0) + ')'; });
  }
  // Abrir a conversa conta como ler; marcar antes de desenhar a lista evita o
  // ponto de não lida piscando no item que acabou de ser clicado.
  const sel = _caixaSelecionada ? todas.find((c) => c.id === _caixaSelecionada) : null;
  if (sel && caixaNaoLida(sel, _caixaLidas())) _caixaMarcar(sel, true);
  const lidas = _caixaLidas();
  const lista = document.getElementById('caixaLista');
  const vazio = _caixaBusca ? 'Nada encontrado para "' + escapeHtml(_caixaBusca) + '".'
    : _caixaFiltro === 'pendentes' ? 'Nada aguardando decisão. Tudo em dia.'
    : _caixaFiltro === 'minhas' ? 'Nenhuma conversa atribuída a você.' : 'Nenhuma conversa ainda.';
  lista.innerHTML = visiveis.length ? visiveis.map((c) => _caixaItemHTML(c, lidas)).join('')
    : '<div class="empty-state"><p>' + vazio + '</p>' +
      (_caixaFiltro !== 'todas' ? '<button type="button" class="btn btn-secondary btn-sm" data-action="caixaFiltro" data-arg="todas">Ver todas</button>' : '') + '</div>';

  // A selecionada pode ter saído do filtro (foi descartada, por exemplo):
  // continua aberta, para o técnico ver o resultado do que acabou de fazer.
  const conv = document.getElementById('caixaConversa');
  const naoLidas = visiveis.filter((c) => caixaNaoLida(c, lidas)).length;
  conv.innerHTML = sel ? _caixaConversaHTML(sel)
    : '<div class="empty-state cx-vazio"><p><b>Escolha uma conversa</b></p><p class="ov-muted">' +
      (naoLidas ? naoLidas + (naoLidas > 1 ? ' não lidas' : ' não lida') + ' neste filtro.' : 'Tudo lido neste filtro.') + '</p></div>';
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
  // Aprender é por endereço/domínio de e-mail. No WhatsApp o telefone já
  // casa pelo cadastro, e o "de" (nome do perfil) não serve de chave.
  if (c.canal !== 'whatsapp') _emailTriagemAprender(c.ultima.de, cli.id);
  return true;
}

// Prefill do chamado vindo do WhatsApp. O telefone vai em emailThreadId como
// 'whatsapp:<dígitos>' — é dali que o whatsapp-responder lê para quem
// responder, e é o que o chamadoCanalDe reconhece. solicitanteEmail fica
// vazio de propósito: com ele, a resposta poderia sair por e-mail.
function caixaPrefillWhatsapp(c, e) {
  const digitos = chamadoTelefoneDigitos(c.telefone || e.telefone || '');
  const tel = chamadoTelefoneFormatar(digitos);
  const nome = _caixaNomeDe(e, 'whatsapp');
  return {
    assunto: String(e.assunto || ('WhatsApp de ' + (nome || tel))).slice(0, 120),
    descricao: caixaCorpoLimpo(e.corpo, 'whatsapp').texto,
    canal: 'whatsapp',
    solicitante: nome,
    solicitanteEmail: '',
    emailThreadId: digitos ? 'whatsapp:' + digitos : null,
    emailMessageId: null,
    emailCorpo: e.corpo || '',
    etrEntrada: e.id,
  };
}

function caixaAbrirChamado(id) {
  const c = _caixaConversaPorId(id);
  if (!c) return;
  const pendentes = c.mensagens.filter((m) => m.status === 'pendente');
  if (!pendentes.length) { showToast('Esta conversa já foi tratada.', 'error'); renderCaixaEntrada(); return; }
  const e = pendentes[pendentes.length - 1];
  if (c.canal !== 'whatsapp') { emailTriagemAbrirChamado(e.id); return; }
  if (typeof openPendenciaForm !== 'function') return;
  openPendenciaForm(null, e.clientId || c.clientId || null, null, caixaPrefillWhatsapp(c, e));
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
  caixaCanal: (_el, v) => { _caixaCanal = CAIXA_CANAIS[v] ? v : 'todos'; renderCaixaEntrada(); },
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
  // Fecha a conversa junto: aberta, o render a marcaria como lida de novo.
  caixaMarcarNaoLida: (_el, id) => {
    const c = _caixaConversas().find((x) => x.id === id);
    if (c) _caixaMarcar(c, false);
    _caixaSelecionada = null;
    renderCaixaEntrada();
  },
  // Recalcula na hora do clique: a sugestão do render pode ter ficado velha.
  caixaVincularSugerido: (_el, id) => {
    const todas = _caixaConversas();
    const c = todas.find((x) => x.id === id);
    const sugerido = c ? caixaSugerirCliente(c, todas) : null;
    if (sugerido && caixaVincularSalvar(id, sugerido)) _emailTriagemRedesenhar();
  },
});
