// caixa-pendencia.js — Pendência e chamado do Milvus abertos da própria conversa.
// =============================================================================
// O "Criar chamado" da Caixa abria o formulário completo num modal, por cima da
// conversa: quem atende perdia de vista o que o cliente escreveu justamente na
// hora de resumir o pedido. Aqui os dois formulários moram no painel de
// detalhes, ao lado da conversa, com o mínimo que o atendimento decide na hora
// (título, cliente, prioridade, responsável, prazo e o chamado do Milvus).
//
// A lista "Pendências abertas" do cliente fica no painel o tempo todo, e não só
// dentro do formulário: antes de abrir uma pendência nova, quem atende precisa
// ver se o mesmo problema já está aberto — e isso vale também para quem só
// está respondendo.
//
// O chamado no Milvus sai pela Edge Function milvus-chamado-create (ação
// "conversa"): o token do Milvus nunca chega ao navegador. A `ref` é gerada uma
// vez por formulário aberto e vai como marcador na descrição; clicar duas
// vezes, ou tentar de novo depois de um timeout, adota o chamado que já nasceu
// em vez de abrir outro.

// Estado do formulário aberto. O sync e o realtime redesenham a conversa a cada
// mensagem nova: sem guardar o que foi digitado aqui, o formulário voltaria
// vazio no meio do preenchimento.
//   conv — id da conversa; tipo — 'pendencia' | 'milvus';
//   v — valores dos campos; enviando — trava do botão durante o invoke.
var _cxpPainel = null;
// Chamados do Milvus por cliente (client_milvus_tickets), lidos uma vez por
// abertura de formulário. Busca no Milvus de verdade é a Edge milvus-tickets.
var _cxpTickets = {};
// Leitura em andamento por cliente: o painel se redesenha a cada mensagem e
// não pode disparar uma leitura nova a cada redesenho.
var _cxpTicketsCarregando = {};
var _cxpTicketsAtualizando = {};

const CXP_PRIORIDADES = [
  ['baixa', 'Baixa'],
  ['media', 'Média'],
  ['alta', 'Alta'],
  ['critica', 'Crítica'],
];
const CXP_TICKETS_MAX = 6;
const CXP_ABERTAS_MAX = 8;

// ── Regras puras (testáveis) ────────────────────────────────────────────────

// O Milvus devolve o status como texto livre do portal ("Finalizado",
// "Cancelado", "Em atendimento"…): o que não é fim de linha conta como aberto.
const _CXP_MILVUS_FECHADO = /finaliz|cancel|conclu|resolvid|fechad|encerrad/i;

/** Chamados do Milvus ainda em aberto, os mais novos (maior código) primeiro. */
function cxpChamadosMilvusAbertos(tickets) {
  return (tickets || [])
    .filter((t) => t && Number(t.codigo) > 0 && !_CXP_MILVUS_FECHADO.test(String(t.status || '')))
    .sort((a, b) => Number(b.codigo) - Number(a.codigo));
}

const _CXP_FECHADAS = ['concluido', 'resolvido', 'cancelado', 'fechado'];

/** Pendências em aberto de um cliente, as mais recentes primeiro. */
function cxpPendenciasAbertas(pendencias, clientId) {
  if (!clientId) return [];
  return (pendencias || [])
    .filter((p) => p && p.clientId === clientId && !_CXP_FECHADAS.includes(p.status || ''))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

/**
 * Monta a pendência a partir do formulário. `ctx` traz o que vem da conversa
 * (canal, solicitante, descrição e, se a conversa ainda não tem chamado, os
 * campos que casam as próximas mensagens com esta pendência).
 */
function cxpPendenciaDados(v, ctx, hoje) {
  const val = v || {};
  const c = ctx || {};
  const titulo = String(val.titulo || '').trim();
  const priority = ['baixa', 'media', 'alta', 'critica'].includes(val.priority)
    ? val.priority
    : 'media';
  const deadline =
    /^\d{4}-\d{2}-\d{2}$/.test(String(val.deadline || '')) && val.deadline
      ? val.deadline
      : typeof slaPrazoSugerido === 'function'
        ? slaPrazoSugerido(priority, hoje)
        : '';
  const codigo = Number(val.milvusCodigo);
  const dados = {
    clientId: val.clientId || '',
    clientName: val.clientName || '',
    tipo: 'Suporte',
    assunto: titulo.slice(0, 120),
    descricao: String(c.descricao || '').trim() || titulo,
    responsible: val.responsible || '',
    status: 'aberto',
    priority,
    deadline,
    solicitante: String(c.solicitante || '').trim(),
    canal: c.canal === 'whatsapp' ? 'whatsapp' : 'email',
    categoria: '',
    tags: [],
    recurrence: '',
    linkUtil: '',
  };
  if (Number.isInteger(codigo) && codigo > 0) dados.milvusChamadoCodigo = codigo;
  // Só a primeira pendência da conversa leva o fio: com ele, as respostas do
  // cliente passam a entrar nela. Uma segunda pendência não pode roubar o fio
  // da que já existe.
  if (c.vinculo) {
    dados.solicitanteEmail = c.vinculo.solicitanteEmail || '';
    dados.emailThreadId = c.vinculo.emailThreadId || null;
    dados.emailMessageId = c.vinculo.emailMessageId || null;
    dados.emailCorpo = c.vinculo.emailCorpo || null;
  }
  return dados;
}

/** Chamados do cliente que casam com o termo (código ou assunto). */
function cxpFiltrarTickets(tickets, termo, max) {
  const q = String(termo || '')
    .trim()
    .toLowerCase()
    .replace(/^#/, '');
  const lista = (tickets || []).filter((t) => t && Number(t.codigo) > 0);
  const casam = !q
    ? lista
    : lista.filter(
        (t) =>
          String(t.codigo).includes(q) ||
          String(t.assunto || '')
            .toLowerCase()
            .includes(q)
      );
  return casam.slice(0, max || CXP_TICKETS_MAX);
}

/** Número digitado que vale como código de chamado (para vincular um que ainda não sincronizou). */
function cxpCodigoDigitado(termo) {
  const s = String(termo || '')
    .trim()
    .replace(/^#/, '');
  if (!/^\d{1,9}$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}

/** Resultado do invoke da Edge (ação "conversa") → o que a tela faz. */
function cxpMilvusResultado(data, invokeError) {
  if (invokeError) {
    // Sem corpo legível (function fora do ar, rede): o status HTTP, quando há,
    // distingue "não publicada" (404) de "caiu" (500) para quem for investigar.
    const ctx = invokeError.context;
    const status = ctx && Number(ctx.status) > 0 ? ' (erro ' + Number(ctx.status) + ')' : '';
    return {
      ok: false,
      msg: 'Não foi possível falar com o Milvus agora. Tente de novo.' + status,
    };
  }
  const d = data || {};
  const codigo = Number(d.codigo);
  if (d.success === true && Number.isFinite(codigo) && codigo > 0) {
    return { ok: true, codigo: Math.trunc(codigo), recuperado: d.recovered === true };
  }
  const code = String(d.code || '');
  if (code === 'MILVUS_CLIENT_TOKEN_NOT_CONFIGURED')
    return { ok: false, msg: 'Este cliente ainda não está ligado ao Milvus (falta o token).' };
  if (code === 'MILVUS_INVALID_TOKEN')
    return { ok: false, msg: 'O Milvus recusou o token da integração. Avise o administrador.' };
  if (code === 'MILVUS_VALIDATION_ERROR')
    return {
      ok: false,
      msg: 'O Milvus recusou o chamado' + (d.detail ? ': ' + String(d.detail).slice(0, 160) : '.'),
    };
  if (code === 'MILVUS_UNAVAILABLE')
    return { ok: false, msg: 'O Milvus não respondeu. Tente de novo em instantes.' };
  return { ok: false, msg: String(d.error || 'Não foi possível criar o chamado no Milvus.') };
}

/**
 * Corpo JSON de uma resposta de erro do invoke. O supabase-js devolve `data`
 * nulo em qualquer status fora de 2xx e deixa a Response em `error.context`; a
 * Edge responde 502 com `code: 'MILVUS_UNAVAILABLE'` e 4xx com `error`, e sem
 * ler o corpo tudo virava a mesma frase genérica.
 */
async function cxpCorpoDoErro(erro) {
  try {
    const ctx = erro && erro.context;
    if (ctx && typeof ctx.json === 'function') {
      const corpo = await ctx.json();
      return corpo && typeof corpo === 'object' ? corpo : null;
    }
  } catch (_e) {
    /* corpo ilegível: fica a mensagem genérica */
  }
  return null;
}

/** Chave de idempotência do chamado (formato que a Edge aceita: CX-…). */
function cxpNovaRef(aleatorio) {
  const r =
    aleatorio ||
    (typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, '')
      : Math.random().toString(36).slice(2) + Date.now().toString(36));
  return (
    'CX-' +
    String(r)
      .replace(/[^A-Za-z0-9_-]/g, '')
      .slice(0, 40)
  );
}

// ── Contexto da conversa ────────────────────────────────────────────────────

function _cxpUltimaEntrada(c) {
  const recebidas = (c.mensagens || []).filter((m) => (m.direcao || 'entrada') === 'entrada');
  return recebidas.length ? recebidas[recebidas.length - 1] : null;
}

// O que a conversa entrega pronto para os dois formulários.
function _cxpContexto(c) {
  const e = _cxpUltimaEntrada(c);
  const whats = c.canal === 'whatsapp';
  const quem = typeof caixaInterlocutor === 'function' ? caixaInterlocutor(c) : e;
  const nome = typeof _caixaNomeDe === 'function' ? _caixaNomeDe(quem, c.canal) : '';
  let titulo = '';
  let descricao = '';
  let vinculo = null;
  if (e && whats && typeof caixaPrefillWhatsapp === 'function') {
    const pre = caixaPrefillWhatsapp(c, e);
    titulo = pre.assunto;
    descricao = pre.descricao;
    vinculo = pre;
  } else if (e) {
    titulo = String(e.assunto || '').slice(0, 120);
    descricao =
      typeof caixaCorpoLimpo === 'function'
        ? caixaCorpoLimpo(e.corpo, c.canal).texto
        : String(e.corpo || '');
    vinculo = {
      solicitanteEmail:
        typeof _emailTriagemEndereco === 'function' ? _emailTriagemEndereco(e.de) : '',
      emailThreadId: e.threadId || null,
      emailMessageId: e.messageId || null,
      emailCorpo: e.corpo || null,
    };
  }
  return {
    entrada: e,
    canal: whats ? 'whatsapp' : 'email',
    solicitante: nome,
    origem: (whats ? 'WhatsApp' : 'E-mail') + (nome ? ' · ' + nome : ''),
    titulo,
    descricao,
    telefone:
      whats && typeof chamadoTelefoneDigitos === 'function'
        ? chamadoTelefoneDigitos(c.telefone || (e && e.telefone) || '')
        : '',
    // Conversa que já tem chamado não passa o fio para uma pendência nova.
    vinculo: c.pendenciaId ? null : vinculo,
  };
}

function _cxpClientes() {
  const sel = typeof _selectedTeam !== 'undefined' && _selectedTeam;
  const lista =
    typeof isTeamAdmin === 'function' &&
    isTeamAdmin() &&
    sel &&
    typeof getClientsByTeam === 'function'
      ? getClientsByTeam(sel)
      : typeof getMyClients === 'function'
        ? getMyClients()
        : [];
  return (lista || [])
    .slice()
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR'));
}

function _cxpOperadores() {
  const me = (typeof getUser === 'function' && (getUser() || {}).name) || '';
  // Admin atribui a qualquer equipe, como no formulário completo.
  const team =
    typeof isTeamAdmin === 'function' && isTeamAdmin()
      ? undefined
      : typeof getCurrentTeam === 'function'
        ? getCurrentTeam()
        : undefined;
  const ops = typeof getOperatorNames === 'function' ? getOperatorNames(team) || [] : [];
  return { me, nomes: ops.length ? ops : me ? [me] : [] };
}

function _cxpPendencias() {
  const todas = typeof getMyPendencias === 'function' ? getMyPendencias() : [];
  return (todas || []).filter((p) =>
    typeof canViewPendencia === 'function' ? canViewPendencia(p) : true
  );
}

function _cxpClienteDaConversa(c) {
  if (c.clientId) return c.clientId;
  if (typeof caixaSugerirCliente === 'function' && typeof _caixaConversas === 'function')
    return caixaSugerirCliente(c, _caixaConversas()) || '';
  return '';
}

// ── HTML ────────────────────────────────────────────────────────────────────

function _cxpStatusLabel(status) {
  const m = typeof STATUS_PEN_MAP !== 'undefined' ? STATUS_PEN_MAP[status] : null;
  return m ? m.label : status || 'Aberto';
}

function _cxpCurto(id) {
  return typeof _cxChamadoCurto === 'function' ? _cxChamadoCurto(id) : String(id || '');
}

/** "Pendências abertas de <cliente>": no painel sempre, com ou sem formulário aberto. */
function cxpAbertasHTML(c) {
  const clientId = (_cxpPainel && _cxpPainel.conv === c.id && _cxpPainel.v.clientId) || c.clientId;
  if (!clientId) return '';
  const cli = typeof getClientById === 'function' ? getClientById(clientId) : null;
  const abertas = cxpPendenciasAbertas(_cxpPendencias(), clientId);
  const itens = abertas
    .slice(0, CXP_ABERTAS_MAX)
    .map(
      (p) =>
        '<li><a href="#" class="cxp-pen" data-action="openPendencia" data-arg="' +
        escapeHtml(p.id) +
        '"><span class="cxp-pen-meta">#' +
        escapeHtml(_cxpCurto(p.id)) +
        ' · ' +
        escapeHtml(_cxpStatusLabel(p.status)) +
        (p.milvusChamadoCodigo
          ? ' · Milvus ' + escapeHtml(String(Number(p.milvusChamadoCodigo) || ''))
          : '') +
        (p.id === c.pendenciaId ? ' · desta conversa' : '') +
        '</span><b>' +
        escapeHtml(p.assunto || p.descricao || '(sem título)') +
        '</b></a></li>'
    )
    .join('');
  const resto = abertas.length - CXP_ABERTAS_MAX;
  return (
    '<section class="cxp-abertas"><h3>Pendências abertas' +
    (cli ? ' de ' + escapeHtml(cli.name) : '') +
    (abertas.length ? ' <span class="cxp-n">' + abertas.length + '</span>' : '') +
    '</h3>' +
    (abertas.length
      ? '<ul class="cxp-lista">' +
        itens +
        '</ul>' +
        (resto > 0
          ? '<span class="cx-sub">e mais ' +
            resto +
            (resto > 1 ? ' abertas' : ' aberta') +
            '</span>'
          : '')
      : '<span class="cx-sub">Nenhuma pendência aberta para este cliente.</span>') +
    '</section>'
  );
}

/** "Chamados abertos no Milvus de <cliente>": ao lado das pendências, sempre visível. */
function cxpMilvusAbertosHTML(c) {
  if (typeof getClientMilvusTickets !== 'function') return '';
  const clientId = (_cxpPainel && _cxpPainel.conv === c.id && _cxpPainel.v.clientId) || c.clientId;
  if (!clientId) return '';
  const cli = typeof getClientById === 'function' ? getClientById(clientId) : null;
  _cxpCarregarTickets(clientId);
  const tickets = _cxpTickets[clientId];
  // Qual pendência aponta para cada chamado: é o que diz se já há alguém nele.
  const vinculos = {};
  _cxpPendencias().forEach((p) => {
    const n = Number(p && p.milvusChamadoCodigo);
    if (p.clientId === clientId && n > 0 && !vinculos[n]) vinculos[n] = p;
  });
  const abertos = tickets ? cxpChamadosMilvusAbertos(tickets) : [];
  const atualizando = !!_cxpTicketsAtualizando[clientId];
  let corpo;
  if (!tickets) corpo = '<span class="cx-sub">Carregando chamados…</span>';
  else if (!abertos.length)
    corpo =
      '<span class="cx-sub">Nenhum chamado aberto entre os ' +
      (tickets.length ? 'mais recentes' : 'sincronizados') +
      '.</span>';
  else
    corpo =
      '<ul class="cxp-lista">' +
      abertos
        .map((t) => {
          const pen = vinculos[Number(t.codigo)];
          return (
            '<li><div class="cxp-pen cxp-mv"><span class="cxp-pen-meta">#' +
            escapeHtml(String(Number(t.codigo))) +
            (t.status ? ' · ' + escapeHtml(t.status) : '') +
            (t.tecnico ? ' · ' + escapeHtml(t.tecnico) : '') +
            '</span><b>' +
            escapeHtml(t.assunto || '(sem assunto)') +
            '</b>' +
            (pen
              ? '<a href="#" class="cxp-mv-pen" data-action="openPendencia" data-arg="' +
                escapeHtml(pen.id) +
                '">Pendência #' +
                escapeHtml(_cxpCurto(pen.id)) +
                '</a>'
              : '<span class="cx-sub">Sem pendência vinculada</span>') +
            '</div></li>'
          );
        })
        .join('') +
      '</ul>';
  return (
    '<section class="cxp-abertas"><h3>Chamados abertos no Milvus' +
    (cli ? ' de ' + escapeHtml(cli.name) : '') +
    (abertos.length ? ' <span class="cxp-n">' + abertos.length + '</span>' : '') +
    '</h3>' +
    corpo +
    '<button type="button" class="btn cx-btn cxp-mv-sync" data-action="cxpMilvusAtualizar" data-arg="' +
    escapeHtml(clientId) +
    '"' +
    (atualizando ? ' disabled' : '') +
    '>' +
    (atualizando ? 'Atualizando…' : 'Atualizar do Milvus') +
    '</button></section>'
  );
}

function _cxpClienteSelectHTML(id, valor) {
  const clientes = _cxpClientes();
  // Cliente da conversa fora da lista (outra equipe vista pelo admin) não some.
  if (valor && !clientes.some((x) => x.id === valor) && typeof getClientById === 'function') {
    const extra = getClientById(valor);
    if (extra) clientes.unshift(extra);
  }
  return (
    '<select class="form-select" id="' +
    id +
    '" data-change="cxpCliente">' +
    '<option value="">Selecione o cliente</option>' +
    clientes
      .map(
        (x) =>
          '<option value="' +
          escapeHtml(x.id) +
          '"' +
          (x.id === valor ? ' selected' : '') +
          '>' +
          escapeHtml(x.name || '') +
          '</option>'
      )
      .join('') +
    '</select>'
  );
}

function _cxpMilvusVinculoHTML(v) {
  const tickets = _cxpTickets[v.clientId] || null;
  if (v.milvusCodigo) {
    const t = (tickets || []).find((x) => Number(x.codigo) === Number(v.milvusCodigo));
    return (
      '<div class="cxp-milvus-sel"><span><b>#' +
      escapeHtml(String(v.milvusCodigo)) +
      '</b>' +
      (t && t.assunto ? ' · ' + escapeHtml(t.assunto) : '') +
      '</span><button type="button" class="btn cx-ic-btn" data-action="cxpMilvusLimpar" aria-label="Remover vínculo">' +
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>'
    );
  }
  return (
    '<input class="form-input" id="cxpMilvusBusca" type="search" autocomplete="off" data-input="cxpMilvusBusca" placeholder="' +
    (v.clientId ? 'Buscar chamado para vincular' : 'Escolha o cliente primeiro') +
    '" value="' +
    escapeHtml(v.milvusBusca || '') +
    '"' +
    (v.clientId ? '' : ' disabled') +
    ' />' +
    '<div class="cxp-sugestoes" id="cxpMilvusSugestoes">' +
    _cxpSugestoesHTML(v) +
    '</div>'
  );
}

function _cxpSugestoesHTML(v) {
  if (!v.clientId || !String(v.milvusBusca || '').trim()) return '';
  const tickets = _cxpTickets[v.clientId];
  if (!tickets) return '<span class="cx-sub">Carregando chamados…</span>';
  const achados = cxpFiltrarTickets(tickets, v.milvusBusca);
  const digitado = cxpCodigoDigitado(v.milvusBusca);
  const botoes = achados.map(
    (t) =>
      '<button type="button" class="cxp-sug" data-action="cxpMilvusEscolher" data-arg="' +
      escapeHtml(String(Number(t.codigo))) +
      '"><b>#' +
      escapeHtml(String(Number(t.codigo))) +
      '</b> ' +
      escapeHtml(t.assunto || '') +
      (t.status ? '<span class="cx-sub">' + escapeHtml(t.status) + '</span>' : '') +
      '</button>'
  );
  // Chamado aberto agora no portal ainda não está na lista sincronizada.
  if (digitado && !achados.some((t) => Number(t.codigo) === digitado))
    botoes.push(
      '<button type="button" class="cxp-sug" data-action="cxpMilvusEscolher" data-arg="' +
        digitado +
        '">Vincular o chamado <b>#' +
        digitado +
        '</b></button>'
    );
  return botoes.length
    ? botoes.join('')
    : '<span class="cx-sub">Nenhum chamado recente com esse termo. Digite o número para vincular.</span>';
}

function _cxpPrioridadesHTML(atual) {
  return (
    '<div class="cxp-prio" role="radiogroup" aria-label="Prioridade">' +
    CXP_PRIORIDADES.map(
      (p) =>
        '<button type="button" class="cxp-chip cxp-prio-' +
        p[0] +
        (p[0] === atual ? ' on' : '') +
        '" role="radio" aria-checked="' +
        (p[0] === atual) +
        '" data-action="cxpPrioridade" data-arg="' +
        p[0] +
        '">' +
        p[1] +
        '</button>'
    ).join('') +
    '</div>'
  );
}

function _cxpFormPendenciaHTML(c, ctx, v) {
  const ops = _cxpOperadores();
  const nomes = ops.nomes.slice();
  if (v.responsible && !nomes.includes(v.responsible)) nomes.push(v.responsible);
  return (
    '<form class="cxp-form" data-submit="cxpCriarPendencia" data-arg="' +
    escapeHtml(c.id) +
    '" novalidate>' +
    '<h3 class="cxp-tit">Nova pendência</h3>' +
    '<span class="cxp-origem">Origem: ' +
    escapeHtml(ctx.origem) +
    '</span>' +
    '<label class="cxp-l" for="cxpTitulo">Título</label>' +
    '<input class="form-input" id="cxpTitulo" maxlength="120" autocomplete="off" data-input="cxpCampo" data-campo="titulo" value="' +
    escapeHtml(v.titulo || '') +
    '" />' +
    '<label class="cxp-l" for="cxpCliente">Cliente</label>' +
    _cxpClienteSelectHTML('cxpCliente', v.clientId) +
    '<span class="cxp-l">Prioridade</span>' +
    _cxpPrioridadesHTML(v.priority) +
    '<div class="cxp-par"><div><label class="cxp-l" for="cxpResp">Responsável</label>' +
    '<select class="form-select" id="cxpResp" data-change="cxpCampoSel" data-campo="responsible">' +
    nomes
      .map(
        (n) =>
          '<option value="' +
          escapeHtml(n) +
          '"' +
          (n === v.responsible ? ' selected' : '') +
          '>' +
          escapeHtml(n) +
          '</option>'
      )
      .join('') +
    '</select></div>' +
    '<div><label class="cxp-l" for="cxpPrazo">Prazo</label>' +
    '<input class="form-input" type="date" id="cxpPrazo" data-change="cxpPrazo" value="' +
    escapeHtml(v.deadline || '') +
    '" /></div></div>' +
    '<label class="cxp-l" for="cxpMilvusBusca">Chamado no Milvus (opcional)</label>' +
    _cxpMilvusVinculoHTML(v) +
    '<div class="cxp-acoes"><button type="button" class="btn btn-secondary" data-action="cxpFechar">Cancelar</button>' +
    '<button type="submit" class="btn btn-primary">Criar pendência</button></div>' +
    '</form>'
  );
}

function _cxpFormMilvusHTML(c, ctx, v) {
  const abertas = cxpPendenciasAbertas(_cxpPendencias(), v.clientId);
  return (
    '<form class="cxp-form" data-submit="cxpCriarMilvus" data-arg="' +
    escapeHtml(c.id) +
    '" novalidate>' +
    '<h3 class="cxp-tit">Novo chamado no Milvus</h3>' +
    '<span class="cxp-origem">Origem: ' +
    escapeHtml(ctx.origem) +
    '</span>' +
    '<label class="cxp-l" for="cxpMvAssunto">Assunto</label>' +
    '<input class="form-input" id="cxpMvAssunto" maxlength="200" autocomplete="off" data-input="cxpCampo" data-campo="titulo" value="' +
    escapeHtml(v.titulo || '') +
    '" />' +
    '<label class="cxp-l" for="cxpMvCliente">Cliente</label>' +
    _cxpClienteSelectHTML('cxpMvCliente', v.clientId) +
    '<label class="cxp-l" for="cxpMvDescricao">Descrição</label>' +
    '<textarea class="form-textarea" id="cxpMvDescricao" rows="4" maxlength="4000" data-input="cxpCampo" data-campo="descricao">' +
    escapeHtml(v.descricao || '') +
    '</textarea>' +
    '<label class="cxp-l" for="cxpMvPen">Vincular à pendência (opcional)</label>' +
    '<select class="form-select" id="cxpMvPen" data-change="cxpCampoSel" data-campo="pendenciaId">' +
    '<option value="">Nenhuma</option>' +
    abertas
      .map(
        (p) =>
          '<option value="' +
          escapeHtml(p.id) +
          '"' +
          (p.id === v.pendenciaId ? ' selected' : '') +
          '>#' +
          escapeHtml(_cxpCurto(p.id)) +
          ' · ' +
          escapeHtml(p.assunto || p.descricao || '') +
          '</option>'
      )
      .join('') +
    '</select>' +
    '<div class="cxp-acoes"><button type="button" class="btn btn-secondary" data-action="cxpFechar">Cancelar</button>' +
    '<button type="submit" class="btn btn-primary"' +
    (_cxpPainel && _cxpPainel.enviando ? ' disabled' : '') +
    '>' +
    (_cxpPainel && _cxpPainel.enviando ? 'Criando…' : 'Criar no Milvus') +
    '</button></div>' +
    '</form>'
  );
}

/** Formulário aberto (se for desta conversa) + pendências abertas. Chamado pela Caixa. */
function cxpLadoHTML(c) {
  if (!c) return '';
  let form = '';
  if (_cxpPainel && _cxpPainel.conv === c.id) {
    const ctx = _cxpContexto(c);
    form =
      '<section class="cxp-box">' +
      (_cxpPainel.tipo === 'milvus'
        ? _cxpFormMilvusHTML(c, ctx, _cxpPainel.v)
        : _cxpFormPendenciaHTML(c, ctx, _cxpPainel.v)) +
      '</section>';
  }
  return form + cxpAbertasHTML(c) + cxpMilvusAbertosHTML(c);
}

/** Botões de "Ações" do painel. */
function cxpBotoesHTML(c) {
  if (!c) return '';
  const id = escapeHtml(c.id);
  return (
    '<button type="button" class="btn cx-btn" data-action="cxpAbrir" data-arg="' +
    id +
    '" data-tipo="pendencia">Criar pendência</button>' +
    '<button type="button" class="btn cx-btn" data-action="cxpAbrir" data-arg="' +
    id +
    '" data-tipo="milvus">Criar chamado no Milvus</button>'
  );
}

// ── Ações ───────────────────────────────────────────────────────────────────

function _cxpRedesenhar() {
  if (typeof renderCaixaEntrada === 'function') renderCaixaEntrada();
}

// Lê uma vez por cliente e redesenha quando chega. O redesenho não dispara
// outra leitura: a lista já está no cache, e a que está a caminho é lembrada.
function _cxpCarregarTickets(clientId) {
  if (
    !clientId ||
    _cxpTickets[clientId] ||
    _cxpTicketsCarregando[clientId] ||
    typeof getClientMilvusTickets !== 'function'
  )
    return;
  _cxpTicketsCarregando[clientId] = true;
  Promise.resolve()
    .then(() => getClientMilvusTickets(clientId))
    .then((lista) => {
      _cxpTickets[clientId] = Array.isArray(lista) ? lista : [];
    })
    .catch((e) => {
      _cxpTickets[clientId] = [];
      if (typeof _logSilent === 'function') _logSilent(e, 'caixa-pendencia');
    })
    .then(() => {
      delete _cxpTicketsCarregando[clientId];
      _cxpRedesenhar();
    });
}

// A lista local é a dos últimos chamados sincronizados; "Atualizar" pede à
// Edge milvus-tickets uma leitura nova do Milvus e relê a lista.
async function cxpMilvusAtualizar(clientId) {
  if (!clientId || _cxpTicketsAtualizando[clientId]) return;
  if (typeof syncClientMilvusTickets !== 'function') return;
  _cxpTicketsAtualizando[clientId] = true;
  _cxpRedesenhar();
  try {
    const res = await syncClientMilvusTickets(clientId);
    const st =
      typeof resolveMilvusTicketsSyncState === 'function'
        ? resolveMilvusTicketsSyncState(res)
        : { kind: 'ok' };
    if (st.kind === 'no-token')
      showToast('Este cliente ainda não está ligado ao Milvus (falta o token).', 'error');
    else if (st.kind === 'unmapped')
      showToast('Este cliente não tem mapeamento no Milvus.', 'error');
  } catch (e) {
    showToast((e && e.message) || 'Não foi possível atualizar os chamados do Milvus.', 'error');
  }
  delete _cxpTicketsAtualizando[clientId];
  delete _cxpTickets[clientId];
  _cxpCarregarTickets(clientId);
  _cxpRedesenhar();
}

// Só a lista de sugestões muda enquanto se digita: redesenhar a conversa
// inteira tiraria o foco do campo a cada tecla.
function _cxpAtualizarSugestoes() {
  if (!_cxpPainel || typeof document === 'undefined') return;
  const box = document.getElementById('cxpMilvusSugestoes');
  if (box) box.innerHTML = _cxpSugestoesHTML(_cxpPainel.v);
}

function cxpAbrir(convId, tipo) {
  const c = typeof _caixaConversaPorId === 'function' ? _caixaConversaPorId(convId) : null;
  if (!c) return;
  const t = tipo === 'milvus' ? 'milvus' : 'pendencia';
  // Clicar de novo no mesmo botão fecha (alternância, como o painel de detalhes).
  if (_cxpPainel && _cxpPainel.conv === c.id && _cxpPainel.tipo === t) {
    _cxpPainel = null;
    _cxpRedesenhar();
    return;
  }
  const ctx = _cxpContexto(c);
  const ops = _cxpOperadores();
  const clientId = _cxpClienteDaConversa(c);
  const priority = 'media';
  const pen =
    c.pendenciaId && typeof getPendenciaById === 'function'
      ? getPendenciaById(c.pendenciaId)
      : null;
  _cxpPainel = {
    conv: c.id,
    tipo: t,
    ref: t === 'milvus' ? cxpNovaRef() : null,
    enviando: false,
    prazoManual: false,
    v: {
      titulo: ctx.titulo,
      descricao: ctx.descricao,
      clientId,
      priority,
      responsible: ops.me,
      deadline:
        typeof slaPrazoSugerido === 'function' && typeof localDateISO === 'function'
          ? slaPrazoSugerido(priority, localDateISO())
          : '',
      milvusCodigo: null,
      milvusBusca: '',
      pendenciaId:
        pen && !_CXP_FECHADAS.includes(pen.status || '') && !pen.milvusChamadoCodigo ? pen.id : '',
    },
  };
  // Painel de detalhes fechado esconderia o formulário que acabou de abrir.
  if (typeof _caixaDetalhesAberto !== 'undefined') _caixaDetalhesAberto = true;
  if (t === 'pendencia') _cxpCarregarTickets(clientId);
  _cxpRedesenhar();
  if (typeof document !== 'undefined') {
    const alvo = document.getElementById(t === 'milvus' ? 'cxpMvAssunto' : 'cxpTitulo');
    if (alvo && alvo.focus) alvo.focus();
  }
}

function _cxpConversaDoPainel(id) {
  if (!_cxpPainel || _cxpPainel.conv !== id) return null;
  return typeof _caixaConversaPorId === 'function' ? _caixaConversaPorId(id) : null;
}

// Mesma trava do formulário rápido: cliente de outra equipe só para admin.
function _cxpClienteValido(clientId) {
  const client = clientId && typeof getClientById === 'function' ? getClientById(clientId) : null;
  if (!client) return { erro: 'Escolha o cliente.' };
  const admin = typeof isTeamAdmin === 'function' && isTeamAdmin();
  const team = typeof getCurrentTeam === 'function' ? getCurrentTeam() : 'init';
  if (!admin && (client.team || 'init') !== team)
    return { erro: 'Você não pode criar para clientes de outra equipe.' };
  return { client };
}

function cxpCriarPendencia(convId) {
  const c = _cxpConversaDoPainel(convId);
  if (!c) return;
  const v = _cxpPainel.v;
  if (!String(v.titulo || '').trim()) {
    showToast('Escreva o título da pendência.', 'error');
    return;
  }
  const cv = _cxpClienteValido(v.clientId);
  if (cv.erro) {
    showToast(cv.erro, 'error');
    return;
  }
  const ctx = _cxpContexto(c);
  const hoje = typeof localDateISO === 'function' ? localDateISO() : '';
  const data = cxpPendenciaDados(Object.assign({}, v, { clientName: cv.client.name }), ctx, hoje);
  const errors = typeof validatePendencia === 'function' ? validatePendencia(data) : [];
  if (errors.length) {
    showToast(errors[0], 'error');
    return;
  }
  try {
    savePendencia(data);
  } catch (err) {
    showToast('Erro ao salvar pendência: ' + err.message, 'error');
    return;
  }
  // Fecha o ciclo da entrada só com a pendência salva, como o formulário
  // completo: marcar antes perderia a mensagem se a pessoa desistisse.
  if (ctx.vinculo && ctx.entrada && typeof emailTriagemMarcarAberta === 'function') {
    try {
      emailTriagemMarcarAberta(data.id, ctx.entrada.id, data.clientId);
    } catch (e) {
      if (typeof _logSilent === 'function') _logSilent(e, 'caixa-pendencia');
    }
  }
  _cxpPainel = null;
  if (typeof updateBadges === 'function') updateBadges();
  showToast('Pendência criada!', 'success');
  _cxpRedesenhar();
}

function _cxpVincularMilvus(pendenciaId, codigo) {
  const p =
    pendenciaId && typeof getPendenciaById === 'function' ? getPendenciaById(pendenciaId) : null;
  if (!p) return false;
  // Cópia: o registro guardado só muda via savePendencia.
  savePendencia(Object.assign({}, p, { milvusChamadoCodigo: codigo }));
  return true;
}

async function cxpCriarMilvus(convId) {
  const c = _cxpConversaDoPainel(convId);
  if (!c || _cxpPainel.enviando) return;
  const v = _cxpPainel.v;
  const assunto = String(v.titulo || '').trim();
  if (!assunto) {
    showToast('Escreva o assunto do chamado.', 'error');
    return;
  }
  const cv = _cxpClienteValido(v.clientId);
  if (cv.erro) {
    showToast(cv.erro, 'error');
    return;
  }
  if (
    typeof isSupabaseConnected !== 'function' ||
    !isSupabaseConnected() ||
    typeof supabaseClient === 'undefined' ||
    !supabaseClient
  ) {
    showToast('Sem conexão com o servidor: o chamado no Milvus precisa de internet.', 'error');
    return;
  }
  const ctx = _cxpContexto(c);
  const painel = _cxpPainel;
  painel.enviando = true;
  _cxpRedesenhar();
  let r;
  try {
    const { data, error } = await supabaseClient.functions.invoke('milvus-chamado-create', {
      body: {
        action: 'conversa',
        clientId: v.clientId,
        ref: painel.ref,
        assunto,
        descricao: String(v.descricao || '').trim(),
        contato: ctx.solicitante,
        telefone: ctx.telefone,
      },
    });
    const corpo = data || (error ? await cxpCorpoDoErro(error) : null);
    r = cxpMilvusResultado(corpo, corpo ? null : error);
  } catch (e) {
    r = cxpMilvusResultado(null, e);
  }
  painel.enviando = false;
  if (!r.ok) {
    showToast(r.msg, 'error');
    _cxpRedesenhar();
    return;
  }
  let vinculou = false;
  try {
    vinculou = _cxpVincularMilvus(v.pendenciaId, r.codigo);
  } catch (e) {
    if (typeof _logSilent === 'function') _logSilent(e, 'caixa-pendencia');
  }
  // Atualiza a lista local de chamados do cliente (busca do outro formulário).
  // O chamado novo entra na lista de abertos assim que a sincronização volta.
  if (typeof syncClientMilvusTickets === 'function')
    syncClientMilvusTickets(v.clientId)
      .catch(() => {})
      .then(() => {
        delete _cxpTickets[v.clientId];
        _cxpCarregarTickets(v.clientId);
      });
  if (_cxpPainel === painel) _cxpPainel = null;
  showToast(
    'Chamado #' +
      r.codigo +
      (r.recuperado ? ' já existia no Milvus' : ' criado no Milvus') +
      (vinculou ? ' e vinculado à pendência.' : '.'),
    'success'
  );
  _cxpRedesenhar();
}

if (typeof registerActions === 'function') {
  registerActions({
    cxpAbrir: (el, id) => cxpAbrir(id, el && el.dataset ? el.dataset.tipo : 'pendencia'),
    cxpFechar: () => {
      _cxpPainel = null;
      _cxpRedesenhar();
    },
    // Digitação não redesenha: só guarda, para o próximo redesenho do sync.
    cxpCampo: (el, valor) => {
      if (_cxpPainel && el && el.dataset && el.dataset.campo)
        _cxpPainel.v[el.dataset.campo] = valor;
    },
    cxpCampoSel: (el, valor) => {
      if (_cxpPainel && el && el.dataset && el.dataset.campo)
        _cxpPainel.v[el.dataset.campo] = valor;
    },
    cxpCliente: (_el, valor) => {
      if (!_cxpPainel) return;
      _cxpPainel.v.clientId = valor;
      // Chamado e pendência escolhidos eram do cliente anterior.
      _cxpPainel.v.milvusCodigo = null;
      _cxpPainel.v.milvusBusca = '';
      _cxpPainel.v.pendenciaId = '';
      if (_cxpPainel.tipo === 'pendencia') _cxpCarregarTickets(valor);
      _cxpRedesenhar();
    },
    cxpPrioridade: (_el, valor) => {
      if (!_cxpPainel) return;
      _cxpPainel.v.priority = valor;
      // Prazo segue o SLA da prioridade até a pessoa escolher uma data.
      if (!_cxpPainel.prazoManual && typeof slaPrazoSugerido === 'function')
        _cxpPainel.v.deadline = slaPrazoSugerido(valor, localDateISO());
      _cxpRedesenhar();
    },
    cxpPrazo: (_el, valor) => {
      if (!_cxpPainel) return;
      _cxpPainel.v.deadline = valor;
      _cxpPainel.prazoManual = true;
    },
    cxpMilvusBusca: (_el, valor) => {
      if (!_cxpPainel) return;
      _cxpPainel.v.milvusBusca = valor;
      _cxpCarregarTickets(_cxpPainel.v.clientId);
      _cxpAtualizarSugestoes();
    },
    cxpMilvusEscolher: (_el, codigo) => {
      if (!_cxpPainel) return;
      const n = cxpCodigoDigitado(codigo);
      if (!n) return;
      _cxpPainel.v.milvusCodigo = n;
      _cxpPainel.v.milvusBusca = '';
      _cxpRedesenhar();
    },
    cxpMilvusLimpar: () => {
      if (!_cxpPainel) return;
      _cxpPainel.v.milvusCodigo = null;
      _cxpRedesenhar();
    },
    cxpCriarPendencia: (_el, id) => cxpCriarPendencia(id),
    cxpMilvusAtualizar: (_el, clientId) => {
      cxpMilvusAtualizar(clientId);
    },
    cxpCriarMilvus: (_el, id) => {
      cxpCriarMilvus(id);
    },
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    cxpPendenciasAbertas,
    cxpChamadosMilvusAbertos,
    cxpPendenciaDados,
    cxpFiltrarTickets,
    cxpCodigoDigitado,
    cxpMilvusResultado,
    cxpCorpoDoErro,
    cxpNovaRef,
  };
}
