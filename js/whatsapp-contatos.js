// whatsapp-contatos.js — Contatos do WhatsApp e atendimento ativo.
// =============================================================================
// A lista NÃO tem tabela própria de contatos: é o histórico da Caixa
// (emails_triagem, já filtrada por equipe) agrupado por telefone. Só aparece
// quem já escreveu para a empresa — a mesma ideia da whatsapp_conversas (076),
// que o app não lê. O que é editável é o nome de exibição (whatsapp_contatos,
// 089), por equipe: o nome do perfil do WhatsApp às vezes é um emoji ou
// "Financeiro", e quem atende precisa reconhecer a pessoa.
//
// "Iniciar conversa" chama a Edge Function whatsapp-iniciar, que decide no
// servidor se o número pode receber (cliente da equipe ou quem já escreveu) e
// aplica o limite por hora. O que este arquivo confere antes é só para avisar
// cedo; quem manda é o servidor.
//
// Script clássico (escopo global compartilhado), sem import/export.

const WCONT_DB = 'intra_whatsapp_contatos';
const WCONT_NOME_MAX = 80;
// Na janela de 24 h desde a última mensagem do cliente a conversa está viva:
// responde-se pela Caixa, não se "inicia" de novo.
const WCONT_JANELA_MS = 24 * 60 * 60 * 1000;

var _wcontBusca = '';
var _wcontEtiqueta = '';

function _wcontEquipe(t) {
  return String(t || '').trim() || 'init';
}

function _wcontChave(t) {
  if (typeof wetqChave === 'function') return wetqChave(t);
  const d = String(t || '').replace(/\D/g, '');
  return d.length >= 10 ? d : '';
}

function wcontSalvos() {
  try {
    const v = typeof dbGet === 'function' ? dbGet(WCONT_DB) : [];
    return (Array.isArray(v) ? v : []).filter((c) => c && c.id && c.telefone);
  } catch (_e) {
    return [];
  }
}

/**
 * Nome editado do contato, ou ''. Com equipe, só o daquela equipe; sem, o
 * primeiro que este aparelho enxerga (a RLS já limitou às equipes do usuário).
 */
function wcontNome(telefone, team, salvos) {
  const chave = _wcontChave(telefone);
  if (!chave) return '';
  const achado = (salvos || wcontSalvos()).find(
    (c) => c.telefone === chave && (!team || _wcontEquipe(c.team) === _wcontEquipe(team))
  );
  return achado ? String(achado.nome || '').trim() : '';
}

function _wcontSoNumero(de) {
  const s = String(de || '').trim();
  return !s || (s.replace(/\D/g, '').length >= 8 && !/[a-zà-ú]/i.test(s));
}

function _wcontMs(iso) {
  const t = iso ? new Date(iso).getTime() : NaN;
  return isNaN(t) ? 0 : t;
}

/**
 * Pura: os contatos (telefone + equipe) a partir das linhas da Caixa. Só entra
 * quem tem mensagem de ENTRADA: conversa que só a empresa começou ainda não é
 * contato. Mais recente primeiro.
 */
function wcontListar(linhas, opts) {
  const o = opts || {};
  const salvos = o.salvos || wcontSalvos();
  const clientes = o.clientes || [];
  const agora = o.agora == null ? Date.now() : o.agora;
  const grupos = new Map();
  (linhas || []).forEach((m) => {
    if (!m || !(m.canal === 'whatsapp' || String(m.telefone || '').trim())) return;
    const chave = _wcontChave(m.telefone);
    if (!chave) return;
    const team = _wcontEquipe(m.team);
    const k = team + '|' + chave;
    if (!grupos.has(k)) grupos.set(k, { chave, team, mensagens: [] });
    grupos.get(k).mensagens.push(m);
  });
  const out = [];
  grupos.forEach((g) => {
    const ms = g.mensagens.slice().sort((a, b) => _wcontMs(a.recebidoEm) - _wcontMs(b.recebidoEm));
    const entradas = ms.filter((m) => (m.direcao || 'entrada') === 'entrada');
    if (!entradas.length) return;
    const ultima = ms[ms.length - 1];
    const ultimaEntrada = entradas[entradas.length - 1];
    let perfil = '';
    for (let i = entradas.length - 1; i >= 0 && !perfil; i--)
      if (!_wcontSoNumero(entradas[i].de)) perfil = String(entradas[i].de).trim();
    let telefone = '';
    for (let i = ms.length - 1; i >= 0 && !telefone; i--)
      telefone = String(ms[i].telefone || '').replace(/\D/g, '');
    let clientId = null;
    for (let i = ms.length - 1; i >= 0 && !clientId; i--) clientId = ms[i].clientId || null;
    if (!clientId) {
      // Mesmo critério da Caixa: só um cliente da equipe com esse número.
      const achados = clientes.filter(
        (c) =>
          c &&
          _wcontEquipe(c.team) === g.team &&
          (_wcontChave(c.ownerPhone) === g.chave || _wcontChave(c.responsiblePhone) === g.chave)
      );
      if (achados.length === 1) clientId = achados[0].id;
    }
    const salvo = wcontNome(g.chave, g.team, salvos);
    const pendente = entradas.some((m) => m.status === 'pendente');
    const ultimaEntradaMs = _wcontMs(ultimaEntrada.recebidoEm);
    out.push({
      id: g.team + '|' + g.chave,
      chave: g.chave,
      team: g.team,
      telefone: telefone || g.chave,
      nomeSalvo: salvo,
      nomePerfil: perfil,
      nome: salvo || perfil || '',
      clientId,
      mensagens: ms.length,
      ultimaEm: ultima.recebidoEm || null,
      ultimaEntradaEm: ultimaEntrada.recebidoEm || null,
      aberta:
        pendente || (ultimaEntrada.status !== 'encerrado' && ultimaEntrada.status !== 'descartado'),
      janelaAberta: agora - ultimaEntradaMs < WCONT_JANELA_MS,
      fotoUrl: (ms.filter((m) => m.fotoUrl).pop() || {}).fotoUrl || null,
    });
  });
  return out.sort((a, b) => _wcontMs(b.ultimaEm) - _wcontMs(a.ultimaEm));
}

/** Pura: busca por nome, telefone (dígitos) ou cliente. */
function wcontFiltrar(contatos, busca, nomeCliente) {
  const q = String(busca || '')
    .trim()
    .toLowerCase();
  if (!q) return (contatos || []).slice();
  const qd = q.replace(/\D/g, '');
  return (contatos || []).filter((c) => {
    const cli = nomeCliente ? String(nomeCliente(c.clientId) || '') : '';
    return (
      String(c.nome || '')
        .toLowerCase()
        .includes(q) ||
      String(c.nomePerfil || '')
        .toLowerCase()
        .includes(q) ||
      cli.toLowerCase().includes(q) ||
      (qd.length >= 4 && String(c.telefone).includes(qd))
    );
  });
}

/**
 * Pura: o telefone pode receber conversa ativa? Espelha a regra do servidor
 * (whatsapp-iniciar) só para avisar antes — o servidor decide de novo.
 */
function wcontPodeIniciar(telefone, contatos, clientes) {
  const chave = _wcontChave(telefone);
  if (!chave) return false;
  return (
    (contatos || []).some((c) => c.chave === chave) ||
    (clientes || []).some(
      (c) => c && (_wcontChave(c.ownerPhone) === chave || _wcontChave(c.responsiblePhone) === chave)
    )
  );
}

function _wcontOnline() {
  return (
    typeof isSupabaseConnected === 'function' &&
    isSupabaseConnected() &&
    typeof window !== 'undefined' &&
    !!window._supabaseAuthActive
  );
}

function _wcontPush(op, linha) {
  if (!_wcontOnline() || typeof supabaseClient === 'undefined') return;
  const q =
    op === 'delete'
      ? supabaseClient.from('whatsapp_contatos').delete().eq('id', linha.id)
      : supabaseClient.from('whatsapp_contatos').upsert(linha);
  Promise.resolve(q)
    .then((res) => {
      if (res && res.error) {
        console.error('❌ Supabase whatsapp_contatos:', res.error);
        if (typeof markSyncPushFailed === 'function') markSyncPushFailed();
      }
    })
    .catch(() => {
      if (typeof markSyncPushFailed === 'function') markSyncPushFailed();
    });
}

/**
 * Grava o nome de exibição. Nome vazio apaga o registro: a tela volta a
 * mostrar o nome do perfil do WhatsApp. Devolve { ok } ou { erro }.
 */
function wcontSalvarNome(telefone, team, nome) {
  const chave = _wcontChave(telefone);
  if (!chave) return { erro: 'Telefone inválido.' };
  const limpo = String(nome || '').trim();
  if (limpo.length > WCONT_NOME_MAX)
    return { erro: 'Nome longo demais (até ' + WCONT_NOME_MAX + ' caracteres).' };
  const eq = _wcontEquipe(team);
  // Id determinístico: o mesmo contato editado em dois aparelhos é a mesma linha.
  const id = 'wct:' + eq + ':' + chave;
  const lista = wcontSalvos();
  const i = lista.findIndex((c) => c.id === id);
  if (!limpo) {
    if (i < 0) return { ok: true };
    const alvo = lista[i];
    lista.splice(i, 1);
    if (typeof dbSet === 'function') dbSet(WCONT_DB, lista);
    if (typeof _addTombstone === 'function') _addTombstone(WCONT_DB, id);
    _wcontPush('delete', alvo);
    return { ok: true };
  }
  const agora = new Date().toISOString();
  const u = typeof getUser === 'function' ? getUser() : null;
  const linha =
    i >= 0
      ? Object.assign({}, lista[i], { nome: limpo, updatedAt: agora })
      : {
          id,
          telefone: chave,
          nome: limpo,
          team: eq,
          createdBy: (u && u.name) || null,
          createdAt: agora,
          updatedAt: agora,
        };
  if (i >= 0) lista[i] = linha;
  else lista.push(linha);
  if (typeof dbSet === 'function') dbSet(WCONT_DB, lista);
  if (typeof _removeTombstone === 'function') _removeTombstone(WCONT_DB, id);
  _wcontPush('upsert', {
    id,
    telefone: chave,
    nome: limpo,
    team: eq,
    created_by: linha.createdBy || null,
    updated_at: agora,
  });
  return { ok: true };
}

// ── Tela ──────────────────────────────────────────────────────────────────────

function _wcontLinhas() {
  let lista = typeof getEmailsTriagem === 'function' ? getEmailsTriagem() : [];
  if (typeof filterByTeam === 'function') lista = filterByTeam(lista);
  return lista;
}

function _wcontClientes() {
  return typeof getMyClients === 'function' ? getMyClients() || [] : [];
}

function _wcontTodos() {
  return wcontListar(_wcontLinhas(), { clientes: _wcontClientes() });
}

function _wcontNomeCliente(id) {
  const c = id && typeof getClientById === 'function' ? getClientById(id) : null;
  return c ? c.name : '';
}

function _wcontIniciais(nome) {
  const p = String(nome || '?')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!p.length) return '?';
  return ((p[0][0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}

function _wcontFone(t) {
  return typeof chamadoTelefoneFormatar === 'function'
    ? chamadoTelefoneFormatar(t)
    : String(t || '');
}

function _wcontLinhaHTML(c) {
  const nome = c.nome || _wcontFone(c.telefone);
  const cli = _wcontNomeCliente(c.clientId);
  const etqs = typeof wetqDoContato === 'function' ? wetqDoContato(c.chave, c.team) : [];
  const foto = typeof caixaFotoHTML === 'function' ? caixaFotoHTML({ fotoUrl: c.fotoUrl }) : '';
  const quando =
    c.ultimaEm && typeof formatDateTime === 'function' ? formatDateTime(c.ultimaEm) : '';
  return (
    '<tr><th scope="row"><span class="wcont-pessoa"><span class="cx-av" aria-hidden="true">' +
    escapeHtml(_wcontIniciais(nome)) +
    foto +
    '</span><span><b>' +
    escapeHtml(nome) +
    '</b>' +
    (c.nomeSalvo && c.nomePerfil && c.nomePerfil !== c.nomeSalvo
      ? '<small class="cx-sub">No WhatsApp: ' + escapeHtml(c.nomePerfil) + '</small>'
      : '') +
    '</span></span></th>' +
    '<td class="wcont-fone">' +
    escapeHtml(_wcontFone(c.telefone)) +
    '</td><td>' +
    (cli ? escapeHtml(cli) : '<span class="cx-sub">Sem cliente</span>') +
    '</td><td>' +
    (typeof wetqChipsHTML === 'function' ? wetqChipsHTML(etqs, 3) : '') +
    '</td><td>' +
    escapeHtml(quando) +
    (c.aberta ? ' <span class="wcont-aberta">em atendimento</span>' : '') +
    '</td><td class="wcont-acoes">' +
    '<button type="button" class="btn btn-secondary btn-sm" data-action="wcontAbrirConversa" data-arg="' +
    escapeHtml(c.chave) +
    '">Abrir conversa</button>' +
    '<button type="button" class="btn btn-secondary btn-sm" data-action="wcontEditarNome" data-arg="' +
    escapeHtml(c.id) +
    '">Editar nome</button>' +
    (!c.janelaAberta
      ? '<button type="button" class="btn btn-secondary btn-sm" data-action="wcontIniciar" data-arg="' +
        escapeHtml(c.telefone) +
        '">Mensagem</button>'
      : '') +
    '</td></tr>'
  );
}

function _wcontCorpoHTML() {
  let lista = wcontFiltrar(_wcontTodos(), _wcontBusca, _wcontNomeCliente);
  if (_wcontEtiqueta && typeof wetqDoContato === 'function')
    lista = lista.filter((c) =>
      wetqDoContato(c.chave, c.team).some((e) => e.id === _wcontEtiqueta)
    );
  if (!lista.length)
    return (
      '<p class="ov-muted wcont-vazio">' +
      (_wcontBusca || _wcontEtiqueta
        ? 'Nenhum contato com esse filtro.'
        : 'Ninguém escreveu pelo WhatsApp ainda.') +
      '</p>'
    );
  return (
    '<div class="wcont-rolagem"><table class="wpainel-tabela wcont-tabela"><thead><tr>' +
    '<th scope="col">Contato</th><th scope="col">Telefone</th><th scope="col">Cliente</th>' +
    '<th scope="col">Etiquetas</th><th scope="col">Última conversa</th><th scope="col"><span class="sr-only">Ações</span></th>' +
    '</tr></thead><tbody>' +
    lista.map(_wcontLinhaHTML).join('') +
    '</tbody></table></div>' +
    '<p class="ov-muted">' +
    lista.length +
    (lista.length === 1 ? ' contato' : ' contatos') +
    '</p>'
  );
}

function renderWhatsappContatos() {
  const titulo = document.getElementById('pageTitle');
  if (titulo) titulo.textContent = 'Contatos do WhatsApp';
  const area = document.getElementById('contentArea');
  if (!area) return;
  // A barra não é remontada a cada tecla: o campo de busca perderia o foco.
  if (!document.getElementById('wcontTabela')) {
    area.innerHTML =
      '<div class="wcont"><div class="wcont-barra">' +
      '<input class="form-input wcont-busca" type="search" placeholder="Buscar por nome, telefone ou cliente…" value="' +
      escapeHtml(_wcontBusca) +
      '" data-input="wcontBusca" aria-label="Buscar contato" />' +
      '<span id="wcontEtqBox"></span>' +
      '<button type="button" class="btn btn-secondary" data-action="wetqGerenciar">Etiquetas</button>' +
      '<button type="button" class="btn btn-primary" data-action="wcontIniciar">Iniciar conversa</button>' +
      '</div><div id="wcontTabela"></div></div>';
  }
  const etq = typeof wetqEtiquetas === 'function' ? wetqEtiquetas() : [];
  if (_wcontEtiqueta && !etq.some((e) => e.id === _wcontEtiqueta)) _wcontEtiqueta = '';
  const box = document.getElementById('wcontEtqBox');
  if (box)
    box.innerHTML = etq.length
      ? '<select class="form-select" data-change="wcontEtiqueta" aria-label="Filtrar por etiqueta"><option value="">Todas as etiquetas</option>' +
        etq
          .map(
            (e) =>
              '<option value="' +
              escapeHtml(e.id) +
              '"' +
              (e.id === _wcontEtiqueta ? ' selected' : '') +
              '>' +
              escapeHtml(e.nome) +
              '</option>'
          )
          .join('') +
        '</select>'
      : '';
  document.getElementById('wcontTabela').innerHTML = _wcontCorpoHTML();
}

/**
 * Mensagem nova na Caixa (onChange de emails_triagem em js/schema.js): a tela de
 * contatos e o painel, se estiverem abertos, se refazem com ela.
 */
function wcontPainelAtualizar() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  const pagina = (window.location.hash || '').replace('#', '');
  if (pagina === 'whatsapp-contatos' && document.getElementById('wcontTabela'))
    renderWhatsappContatos();
  else if (
    pagina === 'whatsapp-painel' &&
    document.querySelector('.wpainel') &&
    typeof renderWhatsappPainel === 'function'
  )
    renderWhatsappPainel();
}

/** Leva para a Caixa com a conversa do telefone aberta. */
function wcontAbrirConversa(chave) {
  if (!chave) return;
  // Estado da Caixa (js/caixa-entrada.js): a conversa do WhatsApp tem id
  // 'whatsapp:<chave>' e pode estar encerrada, então o filtro vai para "Todas".
  if (typeof _caixaSelecionada !== 'undefined') _caixaSelecionada = 'whatsapp:' + chave;
  if (typeof _caixaFiltro !== 'undefined') _caixaFiltro = 'todas';
  if (typeof _caixaCanal !== 'undefined') _caixaCanal = 'whatsapp';
  if (typeof navigateTo === 'function') navigateTo('caixa');
}

function wcontEditarNome(id) {
  const c = _wcontTodos().find((x) => x.id === id);
  if (!c) return;
  openModal(
    'Nome do contato',
    '<form data-submit="wcontSalvarNome" data-arg="' +
      escapeHtml(c.id) +
      '"><div class="form-group"><label class="form-label" for="wcontNomeIn">Nome de exibição</label>' +
      '<input class="form-input" id="wcontNomeIn" name="nome" maxlength="' +
      WCONT_NOME_MAX +
      '" value="' +
      escapeHtml(c.nomeSalvo) +
      '" placeholder="' +
      escapeHtml(c.nomePerfil || _wcontFone(c.telefone)) +
      '" /></div>' +
      '<p class="ov-muted">' +
      escapeHtml(_wcontFone(c.telefone)) +
      (c.nomePerfil ? ' · no WhatsApp: ' + escapeHtml(c.nomePerfil) : '') +
      '. Deixe em branco para voltar ao nome do WhatsApp. Vale para toda a equipe.</p>' +
      '<div class="form-actions"><button type="button" class="btn btn-secondary" data-action="closeModal">Cancelar</button>' +
      '<button type="submit" class="btn btn-primary">Salvar</button></div></form>'
  );
}

// Clientes da equipe com telefone, para escolher sem digitar o número.
function _wcontOpcoesClientes() {
  const out = [];
  _wcontClientes().forEach((c) => {
    [
      [c.ownerPhone, c.owner],
      [c.responsiblePhone, c.responsible],
    ].forEach(([fone, quem]) => {
      if (!_wcontChave(fone)) return;
      out.push({
        valor: String(fone),
        rotulo: c.name + (quem ? ' — ' + quem : '') + ' · ' + _wcontFone(fone),
      });
    });
  });
  return out.sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
}

function wcontIniciar(telefone) {
  const opcoes = _wcontOpcoesClientes();
  openModal(
    'Iniciar conversa no WhatsApp',
    '<form data-submit="wcontEnviarAtivo"><div class="form-group"><label class="form-label" for="wcontCli">Cliente</label>' +
      '<select class="form-select" id="wcontCli" data-change="wcontEscolherCliente"><option value="">— escolher —</option>' +
      opcoes
        .map(
          (o) => '<option value="' + escapeHtml(o.valor) + '">' + escapeHtml(o.rotulo) + '</option>'
        )
        .join('') +
      '</select></div>' +
      '<div class="form-group"><label class="form-label" for="wcontTel">Telefone *</label>' +
      '<input class="form-input" id="wcontTel" name="telefone" inputmode="tel" required value="' +
      escapeHtml(telefone ? _wcontFone(telefone) : '') +
      '" placeholder="(11) 98765-4321" /></div>' +
      '<div class="form-group"><label class="form-label" for="wcontTxt">Mensagem *</label>' +
      '<textarea class="form-textarea" id="wcontTxt" name="text" rows="4" maxlength="4096" required></textarea></div>' +
      '<p class="ov-muted">Só cliente cadastrado da sua equipe ou quem já escreveu para a empresa. ' +
      'O cliente vê seu nome no começo da mensagem. Há limite de conversas iniciadas por hora: ' +
      'mensagem que o cliente não espera aumenta o risco de bloqueio do número.</p>' +
      '<div class="form-actions"><button type="button" class="btn btn-secondary" data-action="closeModal">Cancelar</button>' +
      '<button type="submit" class="btn btn-primary">Enviar</button></div></form>'
  );
}

async function _wcontErroDe(res) {
  let codigo = '';
  let msg = (res.data && res.data.error) || '';
  if (res.error) {
    try {
      const ctx = res.error.context;
      if (ctx && typeof ctx.json === 'function') {
        const corpo = (await ctx.json()) || {};
        codigo = corpo.code || '';
        msg = corpo.error || msg;
      }
    } catch (_e) {
      if (typeof _logSilent === 'function') _logSilent(_e, 'whatsapp-iniciar');
    }
    msg = msg || res.error.message || 'erro de conexão';
  }
  return { codigo, msg };
}

async function wcontEnviarAtivo(form) {
  const fd = new FormData(form);
  const telefone = String(fd.get('telefone') || '');
  const texto = String(fd.get('text') || '').trim();
  const chave = _wcontChave(telefone);
  if (!chave || !texto) {
    showToast('Informe telefone e mensagem.', 'error');
    return;
  }
  const contatos = _wcontTodos();
  // Conversa viva: responder pela Caixa não gasta o limite nem parece disparo.
  const viva = contatos.find((c) => c.chave === chave && c.janelaAberta);
  if (viva) {
    closeModal();
    showToast('Este contato escreveu nas últimas 24 h: responda pela conversa.', 'info');
    wcontAbrirConversa(chave);
    return;
  }
  if (!wcontPodeIniciar(telefone, contatos, _wcontClientes())) {
    showToast(
      'Só dá para iniciar conversa com cliente da sua equipe ou com quem já escreveu.',
      'error'
    );
    return;
  }
  if (!_wcontOnline() || typeof supabaseClient === 'undefined') {
    showToast('Conecte-se ao Supabase para enviar.', 'error');
    return;
  }
  const botao = form.querySelector ? form.querySelector('button[type="submit"]') : null;
  if (botao) botao.disabled = true;
  try {
    const res = await supabaseClient.functions.invoke('whatsapp-iniciar', {
      body: { telefone, text: texto },
    });
    if (res.error || (res.data && res.data.error)) {
      const { codigo, msg } = await _wcontErroDe(res);
      if (codigo === 'history_write') {
        closeModal();
        showToast('Mensagem enviada, mas não ficou no histórico. Não reenvie.', 'warning');
        return;
      }
      showToast('Não foi possível enviar: ' + msg, 'error');
      return;
    }
    closeModal();
    showToast('Mensagem enviada.', 'success');
    if (typeof syncSupabaseToLocal === 'function') {
      try {
        await syncSupabaseToLocal();
      } catch (_e) {
        /* o próximo sync traz */
      }
    }
    wcontAbrirConversa(chave);
  } finally {
    if (botao) botao.disabled = false;
  }
}

if (typeof registerActions === 'function') {
  registerActions({
    wcontBusca: (_el, v) => {
      _wcontBusca = String(v || '');
      renderWhatsappContatos();
    },
    wcontEtiqueta: (_el, v) => {
      _wcontEtiqueta = String(v || '');
      renderWhatsappContatos();
    },
    wcontAbrirConversa: (_el, chave) => wcontAbrirConversa(chave),
    wcontEditarNome: (_el, id) => wcontEditarNome(id),
    wcontSalvarNome: (el, id) => {
      const c = _wcontTodos().find((x) => x.id === id);
      if (!c) return;
      const r = wcontSalvarNome(c.chave, c.team, new FormData(el).get('nome'));
      if (r.erro) {
        showToast(r.erro, 'error');
        return;
      }
      closeModal();
      renderWhatsappContatos();
    },
    wcontIniciar: (_el, telefone) => wcontIniciar(telefone || ''),
    wcontEscolherCliente: (_el, v) => {
      const tel = document.getElementById('wcontTel');
      if (tel && v) tel.value = _wcontFone(v);
    },
    wcontEnviarAtivo: (el) => {
      wcontEnviarAtivo(el);
    },
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    wcontNome,
    wcontListar,
    wcontFiltrar,
    wcontPodeIniciar,
    wcontSalvarNome,
    wcontSalvos,
  };
}
