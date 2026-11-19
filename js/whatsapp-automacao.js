// whatsapp-automacao.js — Automação do atendimento por WhatsApp (leva 3).
// =============================================================================
// Três coisas na tela, todas penduradas na Caixa de entrada:
//   * a configuração por equipe (horário, saudação, encerramento, pesquisa de
//     satisfação e inatividade), num modal que só admin abre — cada mensagem
//     automática sai do número da empresa, então ligar é decisão de quem
//     administra (a RLS da 088 também só deixa admin gravar);
//   * a nota de satisfação no painel lateral da conversa;
//   * o pedido ao servidor (conversa-encerrar) quando alguém encerra uma
//     conversa de WhatsApp: é ele que manda o encerramento e a pesquisa.
//
// A regra que decide quando mandar o quê mora no servidor
// (supabase/functions/whatsapp/automacao.ts). Aqui só se edita a configuração
// e se mostra o resultado. Tudo nasce desligado.
//
// A configuração e as avaliações não entram no sync offline (schema.js): são
// lidas sob demanda, com conexão. Sem a migration 088 a leitura falha, o modal
// avisa e a Caixa segue igual.
//
// Script clássico (escopo global compartilhado), sem import/export. Nomes de
// topo com prefixo wauto/_wauto.

const WAUTO_DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

// Os mesmos padrões de automacao.ts (TEXTOS_PADRAO): campo vazio no formulário
// vira null no banco e o servidor usa o padrão. Aqui servem de placeholder.
const WAUTO_TEXTOS_PADRAO = {
  texto_fora_horario:
    'Recebemos sua mensagem fora do nosso horário de atendimento. Ela ficou registrada e responderemos assim que voltarmos.',
  texto_saudacao:
    'Olá! Recebemos sua mensagem e em instantes alguém da nossa equipe vai atender você.',
  texto_encerramento:
    'Seu atendimento foi encerrado. Obrigado pelo contato! Se precisar, é só mandar uma nova mensagem.',
  texto_pesquisa:
    'Como você avalia este atendimento? Responda com uma nota de 1 (muito insatisfeito) a 5 (muito satisfeito).',
  texto_agradecimento: 'Obrigado pela sua avaliação!',
  texto_lembrete:
    'Olá! Ainda está por aí? Se precisar de mais alguma coisa, é só responder esta mensagem.',
  texto_inatividade:
    'Como não tivemos retorno, estamos encerrando este atendimento. Se precisar, é só mandar uma nova mensagem.',
};

const WAUTO_TEXTO_MAX = 1000;

// telefone -> { em, lista, erro, buscando }. Cache da nota no painel: a Caixa
// redesenha a cada mensagem e não pode virar uma consulta por redesenho.
var _wautoAvaliacoes = {};

function _wautoOnline() {
  return (
    typeof isSupabaseConnected === 'function' &&
    isSupabaseConnected() &&
    typeof window !== 'undefined' &&
    window._supabaseAuthActive === true &&
    typeof supabaseClient !== 'undefined' &&
    !!supabaseClient
  );
}

function _wautoEsc(v) {
  return typeof escapeHtml === 'function' ? escapeHtml(v == null ? '' : String(v)) : '';
}

// ── Regras puras do formulário (testadas em tests/whatsapp-automacao-ui.test.js)

function _wautoHora(bruto) {
  const m = /^(\d{1,2})(?::|h)?(\d{2})?$/.exec(String(bruto || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] || 0);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
  return String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
}

/**
 * "08:30-12:00, 13:00-17:30" → [["08:30","12:00"],["13:00","17:30"]].
 * Aceita "8h-12h" e "8:30 às 12:00". Faixa com fim antes do início atravessa a
 * meia-noite ("22:00-02:00"). Vazio = dia fechado.
 */
function wautoFaixasDoTexto(texto) {
  const t = String(texto || '').trim();
  if (!t) return { faixas: [], erro: null };
  const faixas = [];
  for (const parte of t.split(/[,;]/)) {
    const p = parte.trim();
    if (!p) continue;
    const m = /^(\S+)\s*(?:-|–|—|às|as|a|até)\s*(\S+)$/i.exec(p);
    const ini = m ? _wautoHora(m[1]) : null;
    const fim = m ? _wautoHora(m[2]) : null;
    if (!ini || !fim || ini === fim || ini === '24:00')
      return { faixas: [], erro: 'use o formato 08:30-12:00, 13:00-17:30' };
    faixas.push([ini, fim]);
  }
  return { faixas, erro: null };
}

function wautoFaixasParaTexto(faixas) {
  return (Array.isArray(faixas) ? faixas : [])
    .filter((f) => Array.isArray(f) && f.length === 2)
    .map((f) => f[0] + '-' + f[1])
    .join(', ');
}

/**
 * Uma data por linha (ou separadas por vírgula): "25/12" vale todo ano,
 * "20/11/2026" só aquele dia. Sai no formato do banco: "12-25", "2026-11-20".
 */
function wautoFeriadosDoTexto(texto) {
  const feriados = [];
  for (const parte of String(texto || '').split(/[\n,;]/)) {
    const p = parte.trim();
    if (!p) continue;
    let m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/.exec(p);
    let dia, mes, ano;
    if (m) {
      dia = Number(m[1]);
      mes = Number(m[2]);
      ano = m[3] || '';
    } else if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(p))) {
      ano = m[1];
      mes = Number(m[2]);
      dia = Number(m[3]);
    } else {
      return { feriados: [], erro: '"' + p + '" não é uma data (use 25/12 ou 20/11/2026)' };
    }
    if (mes < 1 || mes > 12 || dia < 1 || dia > 31)
      return { feriados: [], erro: '"' + p + '" não é uma data válida' };
    const mmdd = String(mes).padStart(2, '0') + '-' + String(dia).padStart(2, '0');
    const valor = ano ? ano + '-' + mmdd : mmdd;
    if (!feriados.includes(valor)) feriados.push(valor);
  }
  return { feriados, erro: null };
}

function wautoFeriadosParaTexto(lista) {
  return (Array.isArray(lista) ? lista : [])
    .map((f) => {
      const m = /^(?:(\d{4})-)?(\d{2})-(\d{2})$/.exec(String(f));
      if (!m) return '';
      return m[3] + '/' + m[2] + (m[1] ? '/' + m[1] : '');
    })
    .filter(Boolean)
    .join('\n');
}

function _wautoInteiro(v) {
  const t = String(v == null ? '' : v).trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isInteger(n) ? n : NaN;
}

/**
 * Valida o formulário e monta a linha de whatsapp_automacao. `dados` é um
 * objeto simples (checkbox = booleano, resto = texto) para o teste não
 * depender de DOM. Devolve { linha } ou { erro } com a primeira coisa a
 * corrigir — salvar meio certo ligaria uma automação com prazo que não fecha.
 */
function wautoLinhaDoFormulario(dados, team, autor) {
  const d = dados || {};
  const horario = {};
  for (let dia = 0; dia <= 6; dia++) {
    const r = wautoFaixasDoTexto(d['dia_' + dia]);
    if (r.erro) return { erro: WAUTO_DIAS[dia] + ': ' + r.erro };
    if (r.faixas.length) horario[String(dia)] = r.faixas;
  }
  if (d.horario_ativo && !Object.keys(horario).length)
    return { erro: 'Para usar o horário de atendimento, preencha ao menos um dia.' };
  const fer = wautoFeriadosDoTexto(d.feriados);
  if (fer.erro) return { erro: 'Feriados: ' + fer.erro };

  const linha = {
    team: String(team || 'init'),
    horario_ativo: !!d.horario_ativo,
    horario,
    feriados: fer.feriados,
    saudacao_ativa: !!d.saudacao_ativa,
    encerramento_ativo: !!d.encerramento_ativo,
    pesquisa_ativa: !!d.pesquisa_ativa,
    inatividade_ativa: !!d.inatividade_ativa,
    updated_by: autor || null,
    updated_at: new Date().toISOString(),
  };
  for (const campo of Object.keys(WAUTO_TEXTOS_PADRAO)) {
    const t = String(d[campo] == null ? '' : d[campo]).trim();
    if (t.length > WAUTO_TEXTO_MAX)
      return { erro: 'Texto longo demais (máximo de ' + WAUTO_TEXTO_MAX + ' caracteres).' };
    linha[campo] = t || null;
  }

  const horas = _wautoInteiro(d.pesquisa_horas);
  if (horas !== null && !(horas >= 1 && horas <= 168))
    return { erro: 'A pesquisa espera a nota de 1 a 168 horas.' };
  linha.pesquisa_horas = horas === null ? 24 : horas;

  const lembrete = _wautoInteiro(d.inatividade_lembrete_min);
  const encerrar = _wautoInteiro(d.inatividade_encerrar_min);
  if (lembrete !== null && !(lembrete >= 5 && lembrete <= 10080))
    return { erro: 'O lembrete sai entre 5 minutos e 7 dias depois da última mensagem.' };
  if (encerrar !== null && !(encerrar >= 10 && encerrar <= 10080))
    return { erro: 'O encerramento automático fica entre 10 minutos e 7 dias.' };
  if (linha.inatividade_ativa && encerrar === null)
    return { erro: 'Diga em quantos minutos sem resposta a conversa é encerrada.' };
  if (lembrete !== null && encerrar !== null && lembrete >= encerrar)
    return { erro: 'O lembrete tem de sair antes do encerramento.' };
  linha.inatividade_lembrete_min = lembrete;
  linha.inatividade_encerrar_min = encerrar;
  return { linha };
}

function wautoEstrelas(nota) {
  const n = Math.max(0, Math.min(5, Math.round(Number(nota) || 0)));
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

/** Última nota, média e total. Lista vem da mais nova para a mais velha. */
function wautoResumoAvaliacoes(lista) {
  const notas = (Array.isArray(lista) ? lista : []).filter(
    (a) => a && Number(a.nota) >= 1 && Number(a.nota) <= 5
  );
  if (!notas.length) return null;
  const soma = notas.reduce((s, a) => s + Number(a.nota), 0);
  return { ultima: notas[0], media: soma / notas.length, total: notas.length };
}

function wautoAvaliacoesHTML(lista) {
  const r = wautoResumoAvaliacoes(lista);
  if (!r) return '';
  const nota = Number(r.ultima.nota);
  const quando =
    r.ultima.respondida_em && typeof formatDateTime === 'function'
      ? formatDateTime(r.ultima.respondida_em)
      : '';
  const detalhe = [quando, r.ultima.operador ? 'atendido por ' + r.ultima.operador : '']
    .filter(Boolean)
    .join(' · ');
  return (
    '<section><h3>Satisfação</h3><dl>' +
    '<dt>Última nota</dt><dd><span aria-label="Nota ' +
    nota +
    ' de 5">' +
    wautoEstrelas(nota) +
    '</span> ' +
    nota +
    '/5' +
    (detalhe ? '<span class="cx-sub">' + _wautoEsc(detalhe) + '</span>' : '') +
    '</dd>' +
    (r.total > 1
      ? '<dt>Média</dt><dd>' +
        _wautoEsc(r.media.toFixed(1).replace('.', ',')) +
        '/5<span class="cx-sub">' +
        r.total +
        ' avaliações deste contato</span></dd>'
      : '') +
    '</dl></section>'
  );
}

// Busca de novo quando chegou mensagem depois da última leitura (a nota vem
// junto do "obrigado pela avaliação"), com piso de 15 s entre leituras e, se a
// tabela não existe (088 não aplicada), só a cada 10 min.
function _wautoPrecisaBuscar(cache, ultimaMsgIso, agoraMs) {
  if (!cache) return true;
  if (cache.buscando) return false;
  const idade = agoraMs - (cache.em || 0);
  if (cache.erro) return idade > 10 * 60 * 1000;
  if (idade < 15 * 1000) return false;
  if (ultimaMsgIso && String(ultimaMsgIso) > new Date(cache.em || 0).toISOString()) return true;
  return idade > 5 * 60 * 1000;
}

async function _wautoBuscarAvaliacoes(tel) {
  if (!_wautoOnline()) return;
  const antes = _wautoAvaliacoes[tel] || {};
  _wautoAvaliacoes[tel] = Object.assign({}, antes, { buscando: true });
  let lista = antes.lista || [];
  let erro = false;
  try {
    const res = await supabaseClient
      .from('whatsapp_avaliacoes')
      .select('nota, operador, respondida_em, team')
      .eq('telefone', tel)
      .order('respondida_em', { ascending: false })
      .limit(20);
    if (res.error) erro = true;
    else lista = res.data || [];
  } catch (e) {
    erro = true;
    if (typeof _logSilent === 'function') _logSilent(e, 'whatsapp_avaliacoes');
  }
  const mudou = JSON.stringify(lista) !== JSON.stringify(antes.lista || []);
  _wautoAvaliacoes[tel] = { em: Date.now(), lista, erro, buscando: false };
  if (
    mudou &&
    typeof renderCaixaEntrada === 'function' &&
    (window.location.hash.replace('#', '') || '') === 'caixa'
  )
    renderCaixaEntrada();
}

/** Seção "Satisfação" do painel lateral da conversa (vazia se não há nota). */
function wautoAvaliacaoHTML(c) {
  if (!c || c.canal !== 'whatsapp') return '';
  const tel = String(c.telefone || (c.ultima && c.ultima.telefone) || '').replace(/\D/g, '');
  if (!tel) return '';
  const cache = _wautoAvaliacoes[tel];
  if (_wautoPrecisaBuscar(cache, c.ultima && c.ultima.recebidoEm, Date.now()))
    _wautoBuscarAvaliacoes(tel);
  return wautoAvaliacoesHTML(cache && cache.lista);
}

// ── Encerramento pelo servidor ───────────────────────────────────────────────

/**
 * Chamado por caixaEncerrar depois de o status local mudar. O servidor encerra
 * de novo (mesmo valor, com o escopo de equipe) e manda o que a equipe
 * configurou. Offline não chama: a conversa encerra igual, só sem mensagem.
 */
function wautoAvisarEncerramento(c) {
  if (!c || c.canal !== 'whatsapp' || !_wautoOnline()) return null;
  const thread = typeof caixaThreadId === 'function' ? caixaThreadId(c) : '';
  if (!thread) return null;
  return supabaseClient.functions
    .invoke('conversa-encerrar', { body: { thread_id: thread } })
    .then(async (res) => {
      if (!res.error) {
        const d = res.data || {};
        if (d.enviadas)
          showToast(
            d.pesquisa
              ? 'Mensagem de encerramento e pesquisa de satisfação enviadas.'
              : 'Mensagem de encerramento enviada.',
            'success'
          );
        return d;
      }
      let msg = res.error.message || '';
      let status = 0;
      try {
        const ctx = res.error.context;
        status = (ctx && ctx.status) || 0;
        if (ctx && typeof ctx.json === 'function') msg = ((await ctx.json()) || {}).error || msg;
      } catch (_e) {
        /* corpo ilegível: fica a mensagem genérica */
      }
      // 404: function ainda não publicada ou conversa antiga sem thread. O
      // encerramento local já valeu; não há mensagem a avisar.
      if (status === 404) {
        if (typeof _logSilent === 'function')
          _logSilent(new Error(msg || 'conversa-encerrar 404'), 'conversa-encerrar');
        return null;
      }
      showToast('Conversa encerrada, mas o aviso ao cliente falhou: ' + msg, 'warning');
      return null;
    })
    .catch((e) => {
      if (typeof _logSilent === 'function') _logSilent(e, 'conversa-encerrar');
      return null;
    });
}

// ── Configuração (modal, só admin) ───────────────────────────────────────────

function wautoPodeConfigurar() {
  return typeof isCurrentAdmin === 'function' && isCurrentAdmin() && _wautoOnline();
}

/** Botão no topo da lista da Caixa. Vazio para quem não é admin. */
function wautoBotaoCaixaHTML() {
  if (!(typeof isCurrentAdmin === 'function' && isCurrentAdmin())) return '';
  return (
    '<button type="button" class="btn cx-btn btn-sm" data-action="wautoAbrir">' +
    'Automação do WhatsApp</button>'
  );
}

function _wautoCheck(nome, ligado, rotulo) {
  return (
    '<label class="u-ae752a"><input type="checkbox" name="' +
    nome +
    '"' +
    (ligado ? ' checked' : '') +
    ' /> ' +
    _wautoEsc(rotulo) +
    '</label>'
  );
}

function _wautoTexto(nome, rotulo, linha) {
  return (
    '<div class="form-group"><label class="form-label" for="wauto_' +
    nome +
    '">' +
    _wautoEsc(rotulo) +
    '</label><textarea class="form-textarea" rows="2" maxlength="' +
    WAUTO_TEXTO_MAX +
    '" id="wauto_' +
    nome +
    '" name="' +
    nome +
    '" placeholder="' +
    _wautoEsc(WAUTO_TEXTOS_PADRAO[nome]) +
    '">' +
    _wautoEsc((linha && linha[nome]) || '') +
    '</textarea></div>'
  );
}

function _wautoNumero(nome, rotulo, valor, min, max) {
  return (
    '<div class="form-group"><label class="form-label" for="wauto_' +
    nome +
    '">' +
    _wautoEsc(rotulo) +
    '</label><input class="form-input" type="number" id="wauto_' +
    nome +
    '" name="' +
    nome +
    '" min="' +
    min +
    '" max="' +
    max +
    '" value="' +
    _wautoEsc(valor == null ? '' : valor) +
    '" /></div>'
  );
}

function wautoFormHTML(team, linha) {
  const l = linha || {};
  const horario = l.horario && typeof l.horario === 'object' ? l.horario : {};
  const equipes =
    typeof TEAM_OPTIONS !== 'undefined' && Array.isArray(TEAM_OPTIONS)
      ? TEAM_OPTIONS
      : [{ value: team, label: team }];
  const dias = WAUTO_DIAS.map(
    (nome, dia) =>
      '<div class="form-group"><label class="form-label" for="wauto_dia_' +
      dia +
      '">' +
      _wautoEsc(nome) +
      '</label><input class="form-input" id="wauto_dia_' +
      dia +
      '" name="dia_' +
      dia +
      '" placeholder="fechado" value="' +
      _wautoEsc(wautoFaixasParaTexto(horario[String(dia)])) +
      '" /></div>'
  ).join('');
  return (
    '<form data-submit="wautoSalvar" data-arg="' +
    _wautoEsc(team) +
    '">' +
    '<div class="form-group"><label class="form-label" for="wauto_team">Equipe</label>' +
    '<select class="form-select" id="wauto_team" data-change="wautoTrocarEquipe">' +
    equipes
      .map(
        (o) =>
          '<option value="' +
          _wautoEsc(o.value) +
          '"' +
          (o.value === team ? ' selected' : '') +
          '>' +
          _wautoEsc(o.label) +
          '</option>'
      )
      .join('') +
    '</select><div class="form-hint">Vale para as conversas de WhatsApp desta equipe. ' +
    'Tudo começa desligado; cada mensagem automática sai do número da empresa.</div></div>' +
    '<div class="form-section"><div class="form-section-title">Horário de atendimento</div>' +
    _wautoCheck(
      'horario_ativo',
      l.horario_ativo,
      'Avisar quem escrever fora do horário (uma vez por período fechado)'
    ) +
    '<div class="form-hint">Horário de Brasília. Faixas separadas por vírgula, como ' +
    '08:30-12:00, 13:00-17:30. Vazio = fechado. 22:00-02:00 atravessa a meia-noite.</div>' +
    '<div class="form-row">' +
    dias +
    '</div>' +
    '<div class="form-group"><label class="form-label" for="wauto_feriados">Feriados</label>' +
    '<textarea class="form-textarea" rows="2" id="wauto_feriados" name="feriados" placeholder="25/12&#10;20/11/2026">' +
    _wautoEsc(wautoFeriadosParaTexto(l.feriados)) +
    '</textarea><div class="form-hint">Um por linha. 25/12 vale todo ano; 20/11/2026 só naquele dia.</div></div>' +
    _wautoTexto('texto_fora_horario', 'Mensagem fora do horário', l) +
    '</div>' +
    '<div class="form-section"><div class="form-section-title">Saudação</div>' +
    _wautoCheck(
      'saudacao_ativa',
      l.saudacao_ativa,
      'Responder a primeira mensagem de cada conversa nova'
    ) +
    '<div class="form-hint">Não sai quando o menu de departamentos já respondeu, nem para quem tem chamado aberto.</div>' +
    _wautoTexto('texto_saudacao', 'Mensagem de saudação', l) +
    '</div>' +
    '<div class="form-section"><div class="form-section-title">Encerramento</div>' +
    _wautoCheck(
      'encerramento_ativo',
      l.encerramento_ativo,
      'Avisar o cliente quando a equipe encerrar a conversa'
    ) +
    _wautoTexto('texto_encerramento', 'Mensagem de encerramento', l) +
    '</div>' +
    '<div class="form-section"><div class="form-section-title">Pesquisa de satisfação (nota de 1 a 5)</div>' +
    _wautoCheck(
      'pesquisa_ativa',
      l.pesquisa_ativa,
      'Pedir uma nota ao encerrar; a resposta aparece na conversa'
    ) +
    '<div class="form-hint">Só a primeira resposta depois do encerramento conta. O que não for nota segue como mensagem normal.</div>' +
    _wautoTexto('texto_pesquisa', 'Pergunta', l) +
    _wautoTexto('texto_agradecimento', 'Agradecimento', l) +
    _wautoNumero('pesquisa_horas', 'Esperar a nota por (horas)', l.pesquisa_horas || 24, 1, 168) +
    '</div>' +
    '<div class="form-section"><div class="form-section-title">Inatividade</div>' +
    _wautoCheck(
      'inatividade_ativa',
      l.inatividade_ativa,
      'Lembrar e encerrar quando o cliente para de responder'
    ) +
    '<div class="form-hint">Conta da última mensagem de alguém da equipe. Conversa com chamado aberto não é encerrada.</div>' +
    '<div class="form-row">' +
    _wautoNumero(
      'inatividade_lembrete_min',
      'Lembrete depois de (min, opcional)',
      l.inatividade_lembrete_min,
      5,
      10080
    ) +
    _wautoNumero(
      'inatividade_encerrar_min',
      'Encerrar depois de (min)',
      l.inatividade_encerrar_min,
      10,
      10080
    ) +
    '</div>' +
    _wautoTexto('texto_lembrete', 'Mensagem de lembrete', l) +
    _wautoTexto('texto_inatividade', 'Mensagem ao encerrar por inatividade', l) +
    '</div>' +
    '<div class="form-actions">' +
    '<button type="button" class="btn btn-secondary" data-action="closeModal">Cancelar</button>' +
    '<button type="submit" class="btn btn-primary">Salvar</button></div></form>'
  );
}

async function wautoAbrir(team) {
  if (!wautoPodeConfigurar()) {
    showToast('Só admin, com conexão, configura a automação do WhatsApp.', 'warning');
    return;
  }
  const equipe = String(
    team || (typeof getCurrentTeam === 'function' ? getCurrentTeam() : 'init') || 'init'
  );
  openModal('Automação do WhatsApp', '<div class="empty-state"><p>Carregando…</p></div>', 'lg');
  const res = await supabaseClient
    .from('whatsapp_automacao')
    .select('*')
    .eq('team', equipe)
    .maybeSingle();
  const corpo = document.getElementById('modalBody');
  if (!corpo) return;
  if (res.error) {
    corpo.innerHTML =
      '<div class="empty-state"><p>Não foi possível ler a configuração. ' +
      'Confira se a migration 088 foi aplicada.</p></div>';
    return;
  }
  corpo.innerHTML = wautoFormHTML(equipe, res.data || null);
}

function _wautoDadosDoForm(form) {
  const fd = new FormData(form);
  const dados = {};
  for (const [k, v] of fd.entries()) dados[k] = typeof v === 'string' ? v : '';
  for (const k of [
    'horario_ativo',
    'saudacao_ativa',
    'encerramento_ativo',
    'pesquisa_ativa',
    'inatividade_ativa',
  ])
    dados[k] = fd.get(k) === 'on';
  return dados;
}

async function wautoSalvar(form, team) {
  if (!wautoPodeConfigurar()) {
    showToast('Só admin, com conexão, configura a automação do WhatsApp.', 'warning');
    return;
  }
  const autor = (typeof getUser === 'function' ? getUser() || {} : {}).name || null;
  const r = wautoLinhaDoFormulario(_wautoDadosDoForm(form), team, autor);
  if (r.erro) {
    showToast(r.erro, 'error');
    return;
  }
  const res = await supabaseClient
    .from('whatsapp_automacao')
    .upsert(r.linha, { onConflict: 'team' });
  if (res.error) {
    showToast('Não foi possível salvar: ' + (res.error.message || 'erro'), 'error');
    return;
  }
  closeModal();
  showToast('Automação do WhatsApp salva. Vale a partir da próxima mensagem.', 'success');
}

if (typeof registerActions === 'function') {
  registerActions({
    wautoAbrir: () => {
      wautoAbrir();
    },
    wautoTrocarEquipe: (_el, team) => {
      wautoAbrir(team);
    },
    wautoSalvar: (el, team) => {
      wautoSalvar(el, team);
    },
  });
}

// ── Fonte de avaliações do painel de atendimento (js/whatsapp-painel.js) ───────
// O painel pede de forma síncrona; a nota mora no banco. Primeira chamada de
// um período devolve null e busca em segundo plano; quando chega, redesenha o
// painel se ele estiver aberto. A RLS da 088 já limita à equipe de quem lê.
var _wautoAvalPeriodo = {};

function wautoFonteAvaliacoes(filtro) {
  const f = filtro || {};
  const chave = [f.desde, f.ate, f.team || ''].join('|');
  const c = _wautoAvalPeriodo[chave];
  if (c && !c.buscando && Date.now() - c.em < 60 * 1000) return c.resumo;
  if (!c || !c.buscando) _wautoBuscarAvalPeriodo(chave, f);
  return c ? c.resumo : null;
}

function wautoResumoNotas(lista) {
  const notas = (lista || [])
    .map((r) => Number(r && r.nota))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 5);
  if (!notas.length) return null;
  return { media: notas.reduce((a, n) => a + n, 0) / notas.length, total: notas.length };
}

async function _wautoBuscarAvalPeriodo(chave, f) {
  if (!_wautoOnline()) return;
  const antes = _wautoAvalPeriodo[chave] || { resumo: null };
  _wautoAvalPeriodo[chave] = Object.assign({}, antes, { buscando: true });
  let resumo = antes.resumo;
  try {
    let q = supabaseClient
      .from('whatsapp_avaliacoes')
      .select('nota')
      .gte('respondida_em', new Date(f.desde).toISOString())
      .lt('respondida_em', new Date(f.ate).toISOString())
      .limit(5000);
    if (f.team) q = q.eq('team', f.team);
    const res = await q;
    if (!res.error) resumo = wautoResumoNotas(res.data);
  } catch (e) {
    if (typeof _logSilent === 'function') _logSilent(e, 'whatsapp_avaliacoes painel');
  }
  _wautoAvalPeriodo[chave] = { em: Date.now(), resumo, buscando: false };
  const mudou = JSON.stringify(resumo) !== JSON.stringify(antes.resumo);
  if (
    mudou &&
    typeof renderWhatsappPainel === 'function' &&
    (window.location.hash.replace('#', '') || '') === 'whatsapp-painel'
  )
    renderWhatsappPainel();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    wautoFaixasDoTexto,
    wautoFaixasParaTexto,
    wautoFeriadosDoTexto,
    wautoFeriadosParaTexto,
    wautoLinhaDoFormulario,
    wautoEstrelas,
    wautoResumoAvaliacoes,
    wautoAvaliacoesHTML,
    wautoAvaliacaoHTML,
    wautoBotaoCaixaHTML,
    wautoFormHTML,
    wautoAvisarEncerramento,
    _wautoPrecisaBuscar,
    wautoResumoNotas,
  };
}
