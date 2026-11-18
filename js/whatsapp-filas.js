// whatsapp-filas.js — filas por departamento e rodízio na Caixa de entrada.
// =============================================================================
// O webhook grava em cada mensagem do WhatsApp o departamento que o cliente
// escolheu no menu e, com o rodízio ligado, já entrega a conversa a alguém
// (supabase/functions/whatsapp/distribuicao.ts). Esta tela faz o resto:
//   * separa a Caixa por departamento e mostra quantas conversas estão NA FILA
//     (pendentes e sem responsável);
//   * "Pegar próximo": a conversa mais antiga da fila vai para quem clicou. Quem
//     decide é a função whatsapp_pegar_proximo (087), no banco: dois cliques ao
//     mesmo tempo não pegam a mesma conversa, coisa que o app sozinho não
//     consegue garantir;
//   * o sinal de vida (whatsapp_atendente_ping) que diz ao rodízio quem está
//     online, e a pausa de quem não quer receber conversa agora;
//   * a configuração das filas (só admin): rodízio, limite de atendimentos
//     simultâneos e quem atende quais departamentos.
//
// Banco sem a 087: a barra continua separando pelo que a tela já tem, e o
// "Pegar próximo" avisa que falta a migration em vez de fingir que funcionou.
//
// "Na fila" segue a regra do banco: a conversa tem mensagem do cliente
// pendente e nenhuma mensagem aberta com responsável. Conversa encerrada
// fecha o ciclo — a próxima mensagem do mesmo número volta para a fila.

const WFILA_DEPARTAMENTOS = {
  suporte: 'Suporte',
  comercial: 'Comercial',
  poiesis: 'Poiesis',
};

// O sinal sai a cada minuto; o rodízio considera online quem mandou sinal nos
// últimos 3 (ONLINE_JANELA_MS em filas.ts). Os dois números andam juntos.
const WFILA_PING_MS = 60 * 1000;
const WFILA_ONLINE_MS = 3 * 60 * 1000;

const WFILA_STATUS_ABERTOS = ['pendente', 'anexado'];

var _wfilaDep = 'todos';
var _wfilaSoFila = false;
var _wfilaSemMigration = false;
var _wfilaPegando = false;
var _wfilaTimer = null;
// Operadores mostrados no modal de configuração, na ordem dos campos do form.
var _wfilaOpsModal = [];

function _wfilaEntrada(m) {
  return (m && m.direcao ? m.direcao : 'entrada') === 'entrada';
}

/** Quem está com a conversa no ciclo aberto, ou null (puro). */
function wfilaResponsavelAberto(c) {
  const msgs = (c && c.mensagens) || [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (_wfilaEntrada(m) && WFILA_STATUS_ABERTOS.includes(m.status) && m.atribuidoA)
      return m.atribuidoA;
  }
  return null;
}

/** Conversa do WhatsApp esperando alguém pegar (puro). */
function wfilaNaFila(c) {
  if (!c || (c.canal || 'email') !== 'whatsapp') return false;
  const pendente = (c.mensagens || []).some((m) => _wfilaEntrada(m) && m.status === 'pendente');
  return pendente && !wfilaResponsavelAberto(c);
}

function wfilaDepartamentoDe(c) {
  const d = c && c.departamento;
  return WFILA_DEPARTAMENTOS[d] ? d : null;
}

/**
 * Por departamento: conversas do WhatsApp em atendimento (não encerradas nem
 * descartadas) e quantas delas estão na fila. 'sem' = não escolheu (puro).
 */
function wfilaContar(conversas) {
  const r = { todos: { total: 0, fila: 0 }, sem: { total: 0, fila: 0 } };
  Object.keys(WFILA_DEPARTAMENTOS).forEach((k) => {
    r[k] = { total: 0, fila: 0 };
  });
  (conversas || []).forEach((c) => {
    if ((c.canal || 'email') !== 'whatsapp' || c.encerrada || c.descartada) return;
    const k = wfilaDepartamentoDe(c) || 'sem';
    const naFila = wfilaNaFila(c) ? 1 : 0;
    r[k].total++;
    r[k].fila += naFila;
    r.todos.total++;
    r.todos.fila += naFila;
  });
  return r;
}

/**
 * Recorte da lista: 'todos' não mexe (e-mail continua aparecendo); um
 * departamento ou 'sem' mostra só o WhatsApp daquela fila (puro).
 */
function wfilaFiltrarConversas(conversas, dep, soFila) {
  return (conversas || []).filter((c) => {
    if (soFila && !wfilaNaFila(c)) return false;
    if (!dep || dep === 'todos') return true;
    if ((c.canal || 'email') !== 'whatsapp') return false;
    const d = wfilaDepartamentoDe(c);
    return dep === 'sem' ? !d : d === dep;
  });
}

function _wfilaDesde(c) {
  let menor = '';
  (c.mensagens || []).forEach((m) => {
    if (!_wfilaEntrada(m) || m.status !== 'pendente') return;
    const t = String(m.recebidoEm || m.createdAt || '');
    if (t && (!menor || t < menor)) menor = t;
  });
  return menor;
}

/**
 * A conversa que o "Pegar próximo" entregaria: a mais antiga da fila. `deps`
 * é um departamento, uma lista (conversa sem departamento entra junto) ou
 * vazio (todas). Mesma regra da whatsapp_pegar_proximo, usada no modo local (puro).
 */
function wfilaProximaDaFila(conversas, deps) {
  const lista = (conversas || []).filter((c) => {
    if (!wfilaNaFila(c)) return false;
    const d = wfilaDepartamentoDe(c);
    if (!deps || (Array.isArray(deps) && !deps.length)) return true;
    if (typeof deps === 'string') return d === deps;
    return !d || deps.includes(d);
  });
  lista.sort(
    (a, b) => _wfilaDesde(a).localeCompare(_wfilaDesde(b)) || String(a.id).localeCompare(b.id)
  );
  return lista[0] || null;
}

function wfilaFiltrar(conversas) {
  return wfilaFiltrarConversas(conversas, _wfilaDep, _wfilaSoFila);
}

// ── Estado do operador ──────────────────────────────────────────────────────
function _wfilaSessao() {
  return typeof getSession === 'function' ? getSession() || {} : {};
}

function _wfilaAdmin() {
  return _wfilaSessao().isAdmin === true;
}

function _wfilaEquipe() {
  const sel = typeof _selectedTeam !== 'undefined' ? _selectedTeam : '';
  if (sel) return sel;
  return typeof getCurrentTeam === 'function' ? getCurrentTeam() : 'init';
}

function _wfilaConectado() {
  return (
    typeof isSupabaseConnected === 'function' &&
    isSupabaseConnected() &&
    typeof window !== 'undefined' &&
    !!window._supabaseAuthActive &&
    typeof supabaseClient !== 'undefined' &&
    !!supabaseClient
  );
}

// Pausa é por aparelho: quem fecha o notebook para almoçar não quer voltar e
// descobrir que o celular continuou recebendo conversa no lugar dele.
function _wfilaPausaChave() {
  return 'wfilaPausa:' + (_wfilaSessao().opId || '');
}

function wfilaEmPausa() {
  try {
    return localStorage.getItem(_wfilaPausaChave()) === '1';
  } catch (_e) {
    return false;
  }
}

// PGRST202/42883 = função não existe; 42P01/PGRST205 = tabela não existe.
function _wfilaFaltaMigration(error) {
  const code = String((error && error.code) || '');
  return ['PGRST202', '42883', '42P01', 'PGRST205', '42703', 'PGRST204'].includes(code);
}

async function wfilaPing(disponivel) {
  if (_wfilaSemMigration || !_wfilaConectado() || !_wfilaSessao().opId) return;
  try {
    const { error } = await supabaseClient.rpc('whatsapp_atendente_ping', {
      p_disponivel: !!disponivel,
    });
    if (error && _wfilaFaltaMigration(error)) _wfilaSemMigration = true;
    else if (error) console.warn('whatsapp filas ping:', error.message);
  } catch (e) {
    if (typeof _logSilent === 'function') _logSilent(e, 'whatsapp-filas');
  }
}

// Ausente (presenca.js) e em pausa não mandam sinal: o visto_em envelhece e o
// rodízio deixa de contar com quem não está olhando.
function _wfilaTique() {
  if (wfilaEmPausa()) return;
  if (typeof _presStatus !== 'undefined' && _presStatus === 'ausente') return;
  wfilaPing(true);
}

function wfilaIniciar() {
  if (_wfilaTimer || typeof setInterval !== 'function') return;
  _wfilaTimer = setInterval(_wfilaTique, WFILA_PING_MS);
  setTimeout(_wfilaTique, 5000);
}

// ── Barra da Caixa ──────────────────────────────────────────────────────────
function wfilaBarraHTML(contagem, opcoes) {
  const o = opcoes || {};
  const deps = [['todos', 'Todos']]
    .concat(Object.keys(WFILA_DEPARTAMENTOS).map((k) => [k, WFILA_DEPARTAMENTOS[k]]))
    .concat([['sem', 'Sem departamento']]);
  const chips = deps
    .filter(([k]) => k === 'todos' || k === o.dep || (contagem[k] && contagem[k].total))
    .map(([k, l]) => {
      const n = (contagem[k] && contagem[k].fila) || 0;
      return (
        '<button type="button" class="chip' +
        (k === o.dep ? ' on' : '') +
        '" data-action="wfilaDep" data-arg="' +
        k +
        '" aria-pressed="' +
        (k === o.dep) +
        '">' +
        escapeHtml(l) +
        (n ? ' <span class="wfila-n" title="' + n + ' na fila">' + n + '</span>' : '') +
        '</button>'
      );
    })
    .join('');
  const naFila = (contagem.todos && contagem.todos.fila) || 0;
  return (
    '<div class="cx-chips wfila-deps" role="group" aria-label="Departamento">' +
    chips +
    '</div><div class="wfila-acoes">' +
    '<button type="button" class="chip' +
    (o.soFila ? ' on' : '') +
    '" data-action="wfilaSoFila" aria-pressed="' +
    !!o.soFila +
    '">Na fila <span class="wfila-n">' +
    naFila +
    '</span></button>' +
    '<button type="button" class="btn btn-primary cx-btn wfila-pegar" data-action="wfilaPegar"' +
    (o.pegando ? ' disabled' : '') +
    '>' +
    (o.pegando ? 'Pegando…' : 'Pegar próximo') +
    '</button>' +
    '<button type="button" class="chip wfila-status' +
    (o.pausa ? ' wfila-pausa' : '') +
    '" data-action="wfilaPausa" aria-pressed="' +
    !o.pausa +
    '" title="' +
    (o.pausa
      ? 'Em pausa: o rodízio não manda conversa para você'
      : 'Disponível: o rodízio pode mandar conversa para você') +
    '"><span class="wfila-dot" aria-hidden="true"></span>' +
    (o.pausa ? 'Em pausa' : 'Disponível') +
    '</button>' +
    (o.admin
      ? '<button type="button" class="chip" data-action="wfilaConfig">Configurar filas</button>'
      : '') +
    '</div>'
  );
}

function wfilaRenderBarra(conversas) {
  if (typeof document === 'undefined') return;
  const chipsBox = document.getElementById('caixaCanalChips');
  if (!chipsBox) return;
  let barra = document.getElementById('wfilaBarra');
  if (!barra && typeof document.createElement === 'function') {
    barra = document.createElement('div');
    barra.id = 'wfilaBarra';
    barra.className = 'wfila-barra';
    chipsBox.insertAdjacentElement('afterend', barra);
  }
  if (!barra) return;
  // Fila é do WhatsApp: com só e-mail escolhido, a barra some e o recorte
  // por departamento deixa de valer (senão a lista de e-mail ficava vazia).
  const soEmail = typeof _caixaCanal !== 'undefined' && _caixaCanal === 'email';
  barra.classList.toggle('wfila-oculta', soEmail);
  if (soEmail) {
    _wfilaDep = 'todos';
    _wfilaSoFila = false;
    barra.innerHTML = '';
    return;
  }
  barra.innerHTML = wfilaBarraHTML(wfilaContar(conversas), {
    dep: _wfilaDep,
    soFila: _wfilaSoFila,
    pegando: _wfilaPegando,
    pausa: wfilaEmPausa(),
    admin: _wfilaAdmin(),
  });
}

// ── Pegar próximo ───────────────────────────────────────────────────────────
function _wfilaAbrirConversa(telefone) {
  const chave = typeof chamadoTelefoneChave === 'function' ? chamadoTelefoneChave(telefone) : '';
  if (chave && typeof _caixaSelecionada !== 'undefined') _caixaSelecionada = 'whatsapp:' + chave;
}

// O banco já gravou; isto só adianta na tela o que o realtime vai trazer, sem
// empurrar nada de volta (dbSet não sobe para o servidor).
function _wfilaMarcarLocal(telefone, nome) {
  if (typeof getEmailsTriagem !== 'function' || typeof dbSet !== 'function') return;
  const agora = new Date().toISOString();
  const lista = getEmailsTriagem().map((e) =>
    e && e.telefone === telefone && WFILA_STATUS_ABERTOS.includes(e.status) && !e.atribuidoA
      ? Object.assign({}, e, { atribuidoA: nome, atribuidoEm: agora })
      : e
  );
  dbSet(DB.EMAILS_TRIAGEM, lista);
}

function _wfilaRedesenhar() {
  if (typeof renderCaixaEntrada === 'function' && document.getElementById('caixaLista'))
    renderCaixaEntrada();
}

async function wfilaPegarProximo() {
  if (_wfilaPegando) return;
  const nome = (typeof getUser === 'function' ? getUser() || {} : {}).name || '';
  const dep = WFILA_DEPARTAMENTOS[_wfilaDep] ? _wfilaDep : null;
  if (!_wfilaConectado()) {
    // Modo local (demonstração): a mesma regra, sem banco para disputar.
    const c = wfilaProximaDaFila(
      typeof _caixaConversas === 'function' ? _caixaConversas() : [],
      dep
    );
    if (!c) {
      showToast('Ninguém na fila agora.', 'info');
      return;
    }
    _caixaSalvarConversa(c, { atribuidoA: nome, atribuidoEm: new Date().toISOString() }, true);
    _caixaSelecionada = c.id;
    _wfilaRedesenhar();
    return;
  }
  _wfilaPegando = true;
  _wfilaRedesenhar();
  try {
    const equipe = typeof _selectedTeam !== 'undefined' && _selectedTeam ? _selectedTeam : null;
    const { data, error } = await supabaseClient.rpc('whatsapp_pegar_proximo', {
      p_departamento: dep,
      p_team: equipe,
    });
    if (error) {
      if (_wfilaFaltaMigration(error)) {
        _wfilaSemMigration = true;
        showToast('As filas ainda não estão ativas no banco (migration 087).', 'error');
      } else showToast('Não deu para pegar a conversa: ' + error.message, 'error');
      return;
    }
    if (!data) {
      showToast('Ninguém na fila agora.', 'info');
      return;
    }
    _wfilaMarcarLocal(String(data), nome);
    _wfilaAbrirConversa(String(data));
    showToast('Conversa atribuída a você.', 'success');
  } catch (e) {
    showToast('Não deu para pegar a conversa agora.', 'error');
    if (typeof _logSilent === 'function') _logSilent(e, 'whatsapp-filas');
  } finally {
    _wfilaPegando = false;
    _wfilaRedesenhar();
  }
}

function wfilaAlternarPausa() {
  const pausa = !wfilaEmPausa();
  try {
    if (pausa) localStorage.setItem(_wfilaPausaChave(), '1');
    else localStorage.removeItem(_wfilaPausaChave());
  } catch (_e) {
    /* modo privado: vale só até recarregar */
  }
  wfilaPing(!pausa);
  showToast(
    pausa
      ? 'Em pausa: o rodízio não manda conversa nova para você.'
      : 'Disponível: você volta a receber conversas do rodízio.',
    'info'
  );
  _wfilaRedesenhar();
}

// ── Configuração (admin) ────────────────────────────────────────────────────
function _wfilaOnline(a, agora) {
  const t = a && a.visto_em ? Date.parse(a.visto_em) : NaN;
  return !!(a && a.disponivel) && Number.isFinite(t) && agora - t <= WFILA_ONLINE_MS;
}

/** Monta o form do modal (puro): config da equipe e uma linha por operador. */
function wfilaConfigHTML(team, config, atendentes, nomes, agora) {
  const cfg = config || { rodizio_ativo: false, limite_simultaneo: 5 };
  const porNome = {};
  (atendentes || []).forEach((a) => {
    porNome[a.operador] = a;
  });
  const linhas = (nomes || [])
    .map((nome, i) => {
      const a = porNome[nome] || {};
      const deps = Array.isArray(a.departamentos) ? a.departamentos : [];
      const online = _wfilaOnline(a, agora);
      return (
        '<tr><td><label class="wfila-op"><input type="checkbox" name="recebe:' +
        i +
        '"' +
        (a.recebe_rodizio ? ' checked' : '') +
        ' /> ' +
        escapeHtml(nome) +
        '</label> <span class="wfila-online' +
        (online ? ' on' : '') +
        '">' +
        (online ? 'online' : 'offline') +
        '</span></td>' +
        Object.keys(WFILA_DEPARTAMENTOS)
          .map(
            (k) =>
              '<td class="wfila-c"><input type="checkbox" name="dep:' +
              i +
              ':' +
              k +
              '" aria-label="' +
              escapeHtml(nome + ' — ' + WFILA_DEPARTAMENTOS[k]) +
              '"' +
              (deps.includes(k) ? ' checked' : '') +
              ' /></td>'
          )
          .join('') +
        '<td><input class="form-input wfila-lim" type="number" min="1" max="100" name="lim:' +
        i +
        '" value="' +
        (a.limite ? escapeHtml(String(a.limite)) : '') +
        '" placeholder="equipe" aria-label="' +
        escapeHtml('Limite de ' + nome) +
        '" /></td></tr>'
      );
    })
    .join('');
  return (
    '<form data-submit="wfilaConfigSalvar" data-arg="' +
    escapeHtml(team) +
    '">' +
    '<p class="cx-sub">Equipe <b>' +
    escapeHtml(team) +
    '</b>. Com o rodízio ligado, cada conversa nova do WhatsApp vai para o atendente online ' +
    'do departamento com menos atendimentos abertos. Ninguém disponível: fica na fila.</p>' +
    '<div class="form-group"><label class="wfila-op"><input type="checkbox" name="rodizio"' +
    (cfg.rodizio_ativo ? ' checked' : '') +
    ' /> Distribuir conversas automaticamente (rodízio)</label></div>' +
    '<div class="form-group"><label class="form-label">Atendimentos simultâneos por operador</label>' +
    '<input class="form-input" type="number" name="limite" min="1" max="100" required value="' +
    escapeHtml(String(cfg.limite_simultaneo || 5)) +
    '" /></div>' +
    '<div class="wfila-tabela"><table><thead><tr><th>Atende no rodízio</th>' +
    Object.keys(WFILA_DEPARTAMENTOS)
      .map((k) => '<th>' + escapeHtml(WFILA_DEPARTAMENTOS[k]) + '</th>')
      .join('') +
    '<th>Limite</th></tr></thead><tbody>' +
    (linhas || '<tr><td colspan="5">Nenhum operador nesta equipe.</td></tr>') +
    '</tbody></table></div>' +
    '<p class="cx-sub">Nenhum departamento marcado = atende todos. Limite vazio = o da equipe.</p>' +
    '<div class="form-actions"><button type="button" class="btn btn-secondary" data-action="closeModal">Cancelar</button>' +
    '<button type="submit" class="btn btn-primary">Salvar</button></div></form>'
  );
}

/** Lê o form do modal (puro sobre um get(nome)): o que vai para o banco. */
function wfilaConfigDoForm(get, team, nomes) {
  const limite = Math.min(100, Math.max(1, parseInt(get('limite'), 10) || 5));
  const atendentes = (nomes || []).map((nome, i) => {
    const lim = parseInt(get('lim:' + i), 10);
    return {
      team,
      operador: nome,
      recebe_rodizio: !!get('recebe:' + i),
      departamentos: Object.keys(WFILA_DEPARTAMENTOS).filter((k) => !!get('dep:' + i + ':' + k)),
      limite: Number.isFinite(lim) && lim >= 1 ? Math.min(100, lim) : null,
    };
  });
  return {
    config: { team, rodizio_ativo: !!get('rodizio'), limite_simultaneo: limite },
    atendentes,
  };
}

async function wfilaAbrirConfig() {
  if (!_wfilaAdmin()) return;
  if (!_wfilaConectado()) {
    showToast('A configuração das filas precisa da conexão com o servidor.', 'error');
    return;
  }
  const team = _wfilaEquipe();
  const [cfg, ats] = await Promise.all([
    supabaseClient.from('whatsapp_filas_config').select('*').eq('team', team).maybeSingle(),
    supabaseClient.from('whatsapp_atendentes').select('*').eq('team', team),
  ]);
  const erro = cfg.error || ats.error;
  if (erro) {
    showToast(
      _wfilaFaltaMigration(erro)
        ? 'As filas ainda não estão ativas no banco (migration 087).'
        : 'Não deu para ler a configuração: ' + erro.message,
      'error'
    );
    return;
  }
  const nomes = (typeof getOperatorNames === 'function' ? getOperatorNames(team) : []).slice();
  (ats.data || []).forEach((a) => {
    if (a.recebe_rodizio && !nomes.includes(a.operador)) nomes.push(a.operador);
  });
  nomes.sort((a, b) => a.localeCompare(b, 'pt-BR'));
  _wfilaOpsModal = nomes;
  openModal(
    'Filas do WhatsApp',
    wfilaConfigHTML(team, cfg.data, ats.data || [], nomes, Date.now()),
    'lg'
  );
}

async function wfilaSalvarConfig(form, team) {
  const fd = new FormData(form);
  const dados = wfilaConfigDoForm((k) => fd.get(k), team, _wfilaOpsModal);
  const quem = (typeof getUser === 'function' ? getUser() || {} : {}).name || null;
  const agora = new Date().toISOString();
  const r1 = await supabaseClient
    .from('whatsapp_filas_config')
    .upsert(Object.assign({}, dados.config, { updated_by: quem, updated_at: agora }), {
      onConflict: 'team',
    });
  // Upsert só com as colunas da configuração: disponivel/visto_em são do
  // próprio operador e não podem voltar no tempo por causa deste form.
  const r2 = dados.atendentes.length
    ? await supabaseClient.from('whatsapp_atendentes').upsert(
        dados.atendentes.map((a) => Object.assign({}, a, { updated_at: agora })),
        { onConflict: 'team,operador' }
      )
    : { error: null };
  const erro = r1.error || r2.error;
  if (erro) {
    showToast('Não deu para salvar: ' + erro.message, 'error');
    return false;
  }
  showToast(
    dados.config.rodizio_ativo
      ? 'Filas salvas. O rodízio vale para as próximas conversas.'
      : 'Filas salvas. Rodízio desligado: as conversas ficam na fila.',
    'success'
  );
  return true;
}

registerActions({
  wfilaDep: (_el, v) => {
    _wfilaDep = v === 'sem' || WFILA_DEPARTAMENTOS[v] ? v : 'todos';
    _wfilaRedesenhar();
  },
  wfilaSoFila: () => {
    _wfilaSoFila = !_wfilaSoFila;
    _wfilaRedesenhar();
  },
  wfilaPegar: () => {
    wfilaPegarProximo();
  },
  wfilaPausa: () => wfilaAlternarPausa(),
  wfilaConfig: () => {
    wfilaAbrirConfig();
  },
  wfilaConfigSalvar: (el, team) => {
    wfilaSalvarConfig(el, team).then((ok) => {
      if (ok) closeModal();
    });
  },
});

wfilaIniciar();
