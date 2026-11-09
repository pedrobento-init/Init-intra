// projeto-pagina.js: tela de projeto interno (#projetos/<id>).
// Projeto é trabalho da equipe, sem cliente esperando resposta: por isso aqui não
// entram timer, SLA, canal, solicitante nem transferência, que a tela de chamado tem.
// Rota, redesenho e estado preservado ficam em js/pagina-pendencia.js.

const PRJ_ABAS = ['visao', 'atividade'];
const PRJ_TRECHO_MAX = 120;

function prjNormalizarAba(aba) {
  return PRJ_ABAS.indexOf(aba) !== -1 ? aba : 'visao';
}

/** Feed da aba Atividade, mais recente primeiro; _penFeedItens devolve em ordem crescente. */
function prjFeedRecentes(p) {
  const itens = typeof _penFeedItens === 'function' ? _penFeedItens(p) : [];
  return itens.slice().reverse();
}

/** Progresso do checklist. Item sem objeto válido não conta, para a barra não mentir. */
function prjProgressoChecklist(p) {
  const itens = Array.isArray(p && p.checklist) ? p.checklist : [];
  const total = itens.length;
  const feitos = itens.filter((it) => it && it.done).length;
  return { feitos, total, percentual: total ? Math.round((feitos / total) * 100) : 0 };
}

// Devolve texto puro: quem desenha escapa. Assim o feed e a lateral não divergem na redação.
function prjEventoTexto(e) {
  const verbos = typeof _PEN_EVENT_VERBO !== 'undefined' ? _PEN_EVENT_VERBO : {};
  const rotulo = (v) => (typeof _penValorLabel === 'function' ? _penValorLabel(e.type, v) : String(v || '—'));
  if (e.type === 'criado') return verbos.criado || 'abriu a pendência';
  if (e.type === 'responsavel') return (verbos.responsavel || 'passou para') + ' ' + rotulo(e.para);
  return (verbos[e.type] || 'mudou algo') + ': ' + rotulo(e.de) + ' → ' + rotulo(e.para);
}

function prjAutor(item) {
  return (item && item.author) || 'Sistema';
}

function prjTempoHtml(iso) {
  const quando = typeof pgpTempoAtras === 'function' ? pgpTempoAtras(iso) : '';
  if (!quando) return '';
  return '<time class="prj-quando" datetime="' + escapeHtml(iso) + '">' + escapeHtml(quando) + '</time>';
}

// ----- Cabeçalho -----

function prjCabecalhoHtml(p) {
  const titulo = typeof getPendenciaTitulo === 'function' ? getPendenciaTitulo(p) : p.title;
  const numero = typeof penDisplayNumber === 'function' ? penDisplayNumber(p) : '';
  return '<header class="prj-cabecalho">'
    + '<div class="prj-trilha">'
    + '<nav class="prj-migalhas" aria-label="Caminho">'
    + pgpVoltarHtml('Projetos internos')
    + (numero ? '<span class="prj-migalha-sep" aria-hidden="true">›</span>'
      + '<span class="prj-numero">' + escapeHtml(numero) + '</span>' : '')
    + '</nav>'
    + '<button type="button" class="prj-botao prj-editar" data-action="prjEditar" data-arg="' + escapeHtml(p.id) + '">Editar</button>'
    + '</div>'
    + '<div class="prj-topo">'
    + '<h1 class="pgp-titulo">' + escapeHtml(titulo || 'Sem título') + '</h1>'
    + pgpSeletoresHtml(p)
    + '</div>'
    + '</header>';
}

function prjAbaHtml(chave, rotulo, ativa, contador) {
  return '<button type="button" class="prj-aba" role="tab" id="prjAba-' + chave + '"'
    + ' aria-controls="prjPainel-' + chave + '" aria-selected="' + (ativa ? 'true' : 'false') + '"'
    + ' data-pgp-aba="' + chave + '" data-action="prjAba" data-arg="' + chave + '">'
    + rotulo
    + (contador === undefined ? '' : ' <span class="prj-aba-contador">' + contador + '</span>')
    + '</button>';
}

function prjAbasHtml(aba, totalFeed) {
  return '<div class="prj-abas" role="tablist" aria-label="Seções do projeto">'
    + prjAbaHtml('visao', 'Visão geral', aba === 'visao')
    + prjAbaHtml('atividade', 'Atividade', aba === 'atividade', totalFeed)
    + '</div>';
}

// ----- Lateral -----

function prjClienteHtml(p) {
  const cliente = p.clientId && typeof getClientById === 'function' ? getClientById(p.clientId) : null;
  if (!cliente) return '<span class="prj-vazio">Sem cliente</span>';
  const nome = cliente.name || 'Cliente sem nome';
  return '<span class="prj-pessoa">' + clientAvatar(cliente, 28)
    + '<button type="button" class="prj-link" data-action="openClient" data-arg="' + escapeHtml(cliente.id) + '">'
    + escapeHtml(nome) + '</button></span>';
}

function prjResponsavelHtml(p) {
  const equipe = (typeof TEAM_LABELS !== 'undefined' && TEAM_LABELS[p.team]) || p.team || '';
  const detalhe = equipe ? '<span class="prj-equipe">' + escapeHtml(equipe) + '</span>' : '';
  if (!p.responsible) return '<span class="prj-vazio">Sem responsável</span>' + (detalhe ? ' · ' + detalhe : '');
  return '<span class="prj-pessoa">' + pgpAvatarHtml(p.responsible, 28)
    + '<span>' + escapeHtml(p.responsible) + (detalhe ? ' · ' + detalhe : '') + '</span></span>';
}

function prjPrazoHtml(p) {
  if (!p.deadline) {
    return '<span class="prj-vazio">Sem prazo</span> · '
      + '<button type="button" class="prj-link" data-action="prjEditar" data-arg="' + escapeHtml(p.id) + '">Definir</button>';
  }
  const data = typeof formatDate === 'function' && typeof parseDeadline === 'function'
    ? formatDate(parseDeadline(p.deadline))
    : p.deadline;
  const fechado = typeof isPendenciaClosed === 'function' && isPendenciaClosed(p.status);
  const hoje = typeof localDateISO === 'function' ? localDateISO() : '';
  // Atraso vai por extenso, não só pela cor: cor sozinha não chega a quem não a distingue.
  if (!fechado && hoje && String(p.deadline).slice(0, 10) < hoje) {
    return '<span class="prj-atrasado">' + escapeHtml(data) + ' · atrasado</span>';
  }
  return '<span>' + escapeHtml(data) + '</span>';
}

function prjMetaHtml(rotulo, valorHtml) {
  return '<div class="prj-meta"><dt class="pgp-label">' + rotulo + '</dt><dd class="prj-meta-valor">' + valorHtml + '</dd></div>';
}

function prjUltimaHtml(p, feed) {
  const ultimo = feed[0];
  let corpo;
  if (ultimo) {
    const bruto = ultimo._evento ? prjEventoTexto(ultimo) : String(ultimo.text || '');
    const trecho = bruto.length > PRJ_TRECHO_MAX ? bruto.slice(0, PRJ_TRECHO_MAX).trimEnd() + '…' : bruto;
    corpo = '<p class="prj-ultima-trecho">' + escapeHtml(trecho) + '</p>'
      + '<p class="prj-ultima-rodape">' + escapeHtml(prjAutor(ultimo)) + ' ' + prjTempoHtml(ultimo.createdAt) + '</p>';
  } else {
    corpo = '<p class="prj-vazio">Nenhuma atualização ainda.</p>';
  }
  return '<div class="prj-ultima"><h2 class="pgp-label">Última atualização</h2>' + corpo + '</div>';
}

function prjLateralHtml(p, feed) {
  return '<aside class="prj-lateral" aria-label="Dados do projeto">'
    + '<dl class="prj-metas">'
    + prjMetaHtml('Cliente', prjClienteHtml(p))
    + prjMetaHtml('Responsável · Equipe', prjResponsavelHtml(p))
    + prjMetaHtml('Prazo', prjPrazoHtml(p))
    + '</dl>'
    + prjUltimaHtml(p, feed)
    + '</aside>';
}

// ----- Aba Visão geral -----

function prjDescricaoHtml(p) {
  const texto = String(p.descricao || '').trim();
  const corpo = !texto
    ? '<p class="prj-vazio">Sem descrição.</p>'
    : '<div class="prj-descricao">' + (typeof _penRichDesc === 'function' ? _penRichDesc(texto) : escapeHtml(texto)) + '</div>';
  return '<section class="prj-secao" aria-labelledby="prjTituloDescricao">'
    + '<h2 class="prj-secao-titulo" id="prjTituloDescricao">Descrição</h2>' + corpo + '</section>';
}

function prjEtapaHtml(item, indice, id) {
  const texto = String((item && item.text) || '');
  const feito = !!(item && item.done);
  const idAttr = escapeHtml(id);
  return '<li class="prj-etapa' + (feito ? ' prj-etapa-feita' : '') + '">'
    + '<label class="prj-etapa-rotulo">'
    + '<input type="checkbox" class="prj-etapa-check" data-change="prjMarcarEtapa" data-id="' + idAttr + '" data-indice="' + indice + '"' + (feito ? ' checked' : '') + ' />'
    + '<span class="prj-etapa-texto">' + escapeHtml(texto) + '</span>'
    + '</label>'
    + '<button type="button" class="prj-etapa-remover" data-action="prjRemoverEtapa" data-arg="' + indice + '" data-id="' + idAttr + '"'
    + ' aria-label="Remover etapa: ' + escapeHtml(texto) + '"><span aria-hidden="true">×</span></button>'
    + '</li>';
}

function prjChecklistHtml(p) {
  const itens = Array.isArray(p.checklist) ? p.checklist : [];
  const prog = prjProgressoChecklist(p);
  const topo = '<div class="prj-card-topo"><h2 class="prj-secao-titulo" id="prjTituloChecklist">Checklist</h2>'
    + (prog.total ? '<span class="prj-contagem">' + prog.feitos + ' de ' + prog.total + '</span>' : '')
    + '</div>';
  const corpo = prog.total
    ? '<progress class="prj-progresso" value="' + prog.feitos + '" max="' + prog.total + '" aria-label="Progresso do checklist"></progress>'
      + '<ul class="prj-etapas">' + itens.map((it, i) => prjEtapaHtml(it, i, p.id)).join('') + '</ul>'
    : '<p class="prj-vazio">Nenhuma etapa ainda.</p>';
  // Form real porque o teclado delegado de actions.js ignora Enter em input: é o submit que faz "Enter adiciona".
  // O id newCheckItem é o que addCheckItem lê.
  const form = '<form class="prj-etapa-form" data-submit="prjAdicionarEtapa" data-arg="' + escapeHtml(p.id) + '">'
    + '<label class="prj-oculto" for="newCheckItem">Adicionar etapa</label>'
    + '<input type="text" class="prj-campo" id="newCheckItem" data-pgp-rascunho="prj-etapa" placeholder="Adicionar etapa…" autocomplete="off" />'
    + '<button type="submit" class="prj-botao">Adicionar</button>'
    + '</form>';
  return '<section class="prj-card" aria-labelledby="prjTituloChecklist">' + topo + corpo + form + '</section>';
}

function prjAnexosHtml() {
  return '<section class="prj-card" aria-labelledby="prjTituloAnexos">'
    + '<div class="prj-card-topo"><h2 class="prj-secao-titulo" id="prjTituloAnexos">Anexos</h2></div>'
    + '<div id="prjAnexosLista"></div>'
    + '</section>';
}

// ----- Aba Atividade -----

function prjComposerHtml(p) {
  return '<form class="prj-card prj-composer" data-submit="prjPublicar" data-arg="' + escapeHtml(p.id) + '">'
    + '<label class="prj-composer-rotulo" for="prjNovaNota"><strong>Nova atualização</strong> · só a equipe vê, use @nome para avisar alguém</label>'
    + '<textarea class="prj-campo prj-composer-texto" id="prjNovaNota" data-pgp-rascunho="prj-nota" rows="3"></textarea>'
    + '<div class="prj-composer-acoes"><button type="submit" class="prj-botao prj-botao-primario">Publicar</button></div>'
    + '</form>';
}

function prjFeedItemHtml(item) {
  const autor = prjAutor(item);
  const topo = '<div class="prj-feed-topo"><strong class="prj-feed-autor">' + escapeHtml(autor) + '</strong> ' + prjTempoHtml(item.createdAt) + '</div>';
  let texto;
  if (item._evento) {
    texto = '<p class="prj-feed-evento">' + escapeHtml(prjEventoTexto(item)) + '</p>';
  } else {
    const nota = String(item.text || '');
    texto = '<div class="prj-feed-texto">' + (typeof _penRichNote === 'function' ? _penRichNote(nota) : escapeHtml(nota)) + '</div>';
  }
  return '<li class="prj-feed-item">' + pgpAvatarHtml(autor, 32) + '<div class="prj-feed-corpo">' + topo + texto + '</div></li>';
}

function prjFeedHtml(feed) {
  if (!feed.length) return '<p class="prj-vazio">Nenhuma atualização ainda.</p>';
  return '<ol class="prj-feed">' + feed.map(prjFeedItemHtml).join('') + '</ol>';
}

// ----- Tela -----

// Os dois painéis ficam sempre no DOM: _pgpRestaurarEstado só devolve rascunho a campo
// que existe, e desenhar só a aba visível perderia o texto digitado na outra.
function prjPainelHtml(chave, aba, conteudo) {
  return '<div class="prj-painel" role="tabpanel" id="prjPainel-' + chave + '" aria-labelledby="prjAba-' + chave + '"'
    + ' data-prj-painel="' + chave + '"' + (aba === chave ? '' : ' hidden') + '>' + conteudo + '</div>';
}

function renderProjetoPagina(p, container, estado) {
  const aba = prjNormalizarAba(estado && estado.aba);
  const feed = prjFeedRecentes(p);
  const anexos = typeof getAttachments === 'function' ? getAttachments('pendencias', p.id) || [] : [];
  const temAnexos = anexos.length > 0;

  // Ordem do DOM segue a leitura do layout estreito (lateral antes das abas), para o
  // Tab não pular para trás quando a lateral desce para a grade sob o título.
  container.innerHTML = prjCabecalhoHtml(p)
    + prjLateralHtml(p, feed)
    + prjAbasHtml(aba, feed.length)
    + '<div class="prj-principal">'
    + prjPainelHtml('visao', aba, prjDescricaoHtml(p) + prjChecklistHtml(p) + (temAnexos ? prjAnexosHtml() : ''))
    + prjPainelHtml('atividade', aba, prjComposerHtml(p) + prjFeedHtml(feed))
    + '</div>';

  // renderAttachmentList procura o container por id, então só funciona depois do innerHTML.
  if (temAnexos && typeof renderAttachmentList === 'function') {
    renderAttachmentList('pendencias', p.id, 'prjAnexosLista');
  }
}

// Troca sem redesenhar: um redesenho aqui roubaria o foco do botão da aba.
function prjTrocarAba(raiz, aba) {
  const alvo = prjNormalizarAba(aba);
  raiz.querySelectorAll('[data-pgp-aba]').forEach((b) => {
    b.setAttribute('aria-selected', b.dataset.pgpAba === alvo ? 'true' : 'false');
  });
  raiz.querySelectorAll('[data-prj-painel]').forEach((painel) => {
    painel.hidden = painel.dataset.prjPainel !== alvo;
  });
}

// As funções de checklist vêm do modal antigo e só redesenham o que é dele (são no-op
// aqui). Quem atualiza esta tela é penPaginaAtualizar, sem esperar o debounce da sincronização.
const _prjAcoes = {
  prjAba: (el, aba) => {
    const raiz = el.closest('.pgp-projeto');
    if (raiz) prjTrocarAba(raiz, aba);
  },
  prjEditar: (_el, id) => {
    if (typeof openPendenciaForm === 'function') openPendenciaForm(id);
  },
  prjMarcarEtapa: (el) => {
    toggleCheckItem(el.dataset.id, Number(el.dataset.indice));
    penPaginaAtualizar(el.dataset.id);
  },
  prjRemoverEtapa: (el, indice) => {
    removeCheckItem(el.dataset.id, Number(indice));
    penPaginaAtualizar(el.dataset.id);
  },
  prjAdicionarEtapa: (_el, id) => {
    addCheckItem(id);
    penPaginaAtualizar(id);
  },
  prjPublicar: (_el, id) => {
    const campo = document.getElementById('prjNovaNota');
    const texto = campo ? campo.value.trim() : '';
    if (!texto) {
      if (campo) campo.focus();
      return;
    }
    const usuario = typeof getUser === 'function' ? getUser() : null;
    if (!addPendenciaNote(id, texto, usuario ? usuario.name : '', 'interna')) {
      // O texto continua no campo: quem escreveu não perde o trabalho por uma falha de gravação.
      if (typeof showToast === 'function') showToast('Não foi possível salvar a atualização.', 'error');
      return;
    }
    // Limpa antes de redesenhar: a captura de estado relê o campo e devolveria o texto publicado.
    campo.value = '';
    if (typeof showToast === 'function') showToast('Atualização publicada.', 'success');
    penPaginaAtualizar(id);
  },
};

if (typeof registerActions === 'function') registerActions(_prjAcoes);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderProjetoPagina, prjFeedRecentes, prjProgressoChecklist, prjEventoTexto, prjTrocarAba, _prjAcoes };
}
