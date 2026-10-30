// robo-execucoes.js — O robô diz se está vivo, em Configurações (menu "Mais opções").
// =============================================================================
// O robô (supabase/functions/robo) grava cada ação em robo_execucoes (071).
// Antes disso, a triagem podia parar por dias — segredo trocado, gatilho do
// Apps Script apagado, Make fora do ar — e o único sinal era a falta de
// chamados novos, que ninguém nota.
//
// A tabela NÃO entra no sync: são ~288 linhas por dia e só importam as
// últimas. O painel busca direto do Supabase, com limite, e no máximo uma vez
// por minuto — abrir e fechar Configurações não pode virar uma query
// por clique. Sem Supabase, ou sem a migration aplicada, o painel some.
//
// Script clássico, como o resto de js/: sem import/export, nomes no escopo
// global (ver AGENTS.md).

// A triagem roda a cada 5 min; 30 min sem rodada são seis gatilhos perdidos,
// folga para um Apps Script atrasado sem esconder um robô parado de verdade.
var ROBO_TRIAGEM_PARADA_MS = 30 * 60 * 1000;
var ROBO_RECARGA_MS = 60 * 1000;

var _rbxCache = { linhas: null, em: 0, buscando: false };

function _rbxSupabaseReady() {
  try {
    return typeof isSupabaseConnected === 'function' && isSupabaseConnected()
      && typeof supabaseClient !== 'undefined' && supabaseClient
      && typeof window !== 'undefined' && window._supabaseAuthActive === true;
  } catch (_) { return false; }
}

/**
 * Lê as rodadas (mais nova primeiro) e decide o que o painel conta. Pura, para
 * o teste não depender de relógio nem de rede.
 *
 * Por ação vale a rodada MAIS NOVA: uma falha antiga já seguida de sucesso é
 * história, não alerta. `falhas` conta quantas das rodadas carregadas falharam,
 * para mostrar que o problema se repete.
 */
function roboSituacao(linhas, agoraMs) {
  var porAcao = {};
  var ordem = [];
  (linhas || []).forEach(function (r) {
    if (!r || !r.acao) return;
    var a = porAcao[r.acao];
    if (!a) {
      a = porAcao[r.acao] = { acao: r.acao, ultima: r, falhas: 0, rodadas: 0 };
      ordem.push(r.acao);
    }
    a.rodadas++;
    if (r.ok === false) a.falhas++;
  });
  var acoes = ordem.map(function (k) { return porAcao[k]; });
  var triagem = porAcao.triagem ? porAcao.triagem.ultima : null;
  var inicioTriagem = triagem ? Date.parse(triagem.inicio) : NaN;
  // Sem nenhuma rodada de triagem carregada também é "parado": a migration
  // está aplicada (senão nem haveria linhas) e o robô não deu sinal.
  var parado = acoes.length > 0 && (!triagem || !isFinite(inicioTriagem)
    || (agoraMs - inicioTriagem) > ROBO_TRIAGEM_PARADA_MS);
  var falhando = acoes.filter(function (a) { return a.ultima.ok === false; }).map(function (a) { return a.acao; });
  return { acoes: acoes, parado: parado, falhando: falhando, ultimaTriagem: triagem };
}

/** "há 3 min", "há 2 h", "há 4 d" — o quanto importa aqui, sem relógio exato. */
function _rbxIdade(iso, agoraMs) {
  var t = Date.parse(iso);
  if (!isFinite(t)) return '—';
  var min = Math.max(0, Math.round((agoraMs - t) / 60000));
  if (min < 1) return 'agora';
  if (min < 60) return 'há ' + min + ' min';
  var h = Math.round(min / 60);
  if (h < 48) return 'há ' + h + ' h';
  return 'há ' + Math.round(h / 24) + ' d';
}

/** Contadores devolvidos pela ação, sem o erro (que tem linha própria). */
function _rbxResumo(resultado) {
  if (!resultado || typeof resultado !== 'object') return '';
  return Object.keys(resultado).filter(function (k) { return k !== 'error'; }).map(function (k) {
    return k + ': ' + resultado[k];
  }).join(' · ');
}

function _rbxLinhaHtml(a, agoraMs) {
  var r = a.ultima;
  var falhou = r.ok === false;
  var quando = r.inicio || '';
  var exato = quando;
  try { if (Date.parse(quando) && typeof formatDateTime === 'function') exato = formatDateTime(quando); } catch (_e) { /* data estranha: mostra crua */ }
  var resumo = _rbxResumo(r.resultado);
  return '<li class="rbx-acao' + (falhou ? ' is-falha' : '') + '">'
    + '<div class="rbx-top">'
    + '<span class="rbx-status">' + (falhou ? '✕' : '✓') + '</span>'
    + '<span class="rbx-nome">' + escapeHtml(a.acao) + '</span>'
    + (a.falhas ? '<span class="rbx-falhas">' + a.falhas + ' de ' + a.rodadas + ' falharam</span>' : '')
    + '<span class="rbx-quando" title="' + escapeHtml(exato) + '">' + escapeHtml(_rbxIdade(quando, agoraMs)) + '</span>'
    + '</div>'
    + (falhou && r.erro ? '<div class="rbx-erro">' + escapeHtml(r.erro) + '</div>' : '')
    + (resumo ? '<div class="rbx-resumo">' + escapeHtml(resumo) + '</div>' : '')
    + '</li>';
}

/** Busca as últimas rodadas e redesenha. Erro de query (sem 071) esconde o painel. */
function carregarRoboExecucoes() {
  if (!_rbxSupabaseReady() || _rbxCache.buscando) return;
  _rbxCache.buscando = true;
  supabaseClient.from('robo_execucoes')
    .select('acao,inicio,fim,duracao_ms,ok,erro,resultado')
    .order('inicio', { ascending: false })
    .limit(40)
    .then(function (res) {
      _rbxCache.linhas = res.error ? [] : (res.data || []);
      _rbxCache.em = Date.now();
    })
    .catch(function () { _rbxCache.linhas = []; _rbxCache.em = Date.now(); })
    .then(function () { _rbxCache.buscando = false; renderRoboExecucoes(); });
}

function renderRoboExecucoes() {
  var node = document.getElementById('roboStatus');
  if (!node) return;
  if (!_rbxSupabaseReady()) { node.innerHTML = ''; return; }
  var agora = Date.now();
  if (agora - _rbxCache.em > ROBO_RECARGA_MS) carregarRoboExecucoes();
  var linhas = _rbxCache.linhas;
  if (!linhas || !linhas.length) { node.innerHTML = ''; return; }

  var s = roboSituacao(linhas, agora);
  var problema = s.parado || s.falhando.length > 0;
  var titulo;
  if (s.parado) {
    titulo = s.ultimaTriagem
      ? 'Robô parado: a triagem não roda ' + _rbxIdade(s.ultimaTriagem.inicio, agora)
      : 'Robô parado: nenhuma rodada de triagem registrada';
  } else if (s.falhando.length) {
    titulo = 'Robô com falha em ' + s.falhando.join(', ');
  } else {
    titulo = 'Robô ok · triagem ' + _rbxIdade(s.ultimaTriagem.inicio, agora);
  }
  // Fechado por padrão quando está tudo bem; com problema abre sozinho, porque
  // o aviso que ninguém expande é o mesmo que não ter aviso.
  var fechado = !problema;
  try {
    var pref = localStorage.getItem('intra_rbx_fechada');
    if (!problema && pref === '0') fechado = false;
  } catch (_e) { /* sem localStorage: usa o padrão */ }
  node.innerHTML = '<section class="rbx-box' + (problema ? ' is-problema' : '') + (fechado ? ' is-fechada' : '') + '">'
    + '<button type="button" class="rbx-head" data-action="rbxToggle" aria-expanded="' + (fechado ? 'false' : 'true') + '">'
    + '<span class="rbx-head-title">' + (problema ? '⚠️ ' : '🤖 ') + escapeHtml(titulo) + '</span>'
    + '<span class="rbx-chevron" aria-hidden="true">' + (fechado ? '▸' : '▾') + '</span>'
    + '</button>'
    + (fechado ? '' : '<ul class="rbx-lista">' + s.acoes.map(function (a) { return _rbxLinhaHtml(a, agora); }).join('') + '</ul>')
    + '</section>';
}

function roboExecucoesToggle() {
  try {
    var aberta = localStorage.getItem('intra_rbx_fechada') === '0';
    localStorage.setItem('intra_rbx_fechada', aberta ? '1' : '0');
  } catch (_e) { /* sem localStorage: não lembra, e tudo bem */ }
  renderRoboExecucoes();
}

if (typeof registerActions === 'function') {
  registerActions({
    rbxToggle: function () { roboExecucoesToggle(); }
  });
}

// Ainda não há tela de Configurações; o modal é o lugar dela por enquanto. O
// texto fica fora de #roboStatus porque o render zera o nó quando não há dado.
function abrirConfiguracoes() {
  if (typeof openModal !== 'function') return;
  openModal('Configurações',
    '<p style="color:var(--text-muted);margin:0 0 12px">Status do robô de triagem (últimas rodadas). Sem Supabase conectado, nada aparece aqui.</p>'
    + '<div id="roboStatus"></div>');
  renderRoboExecucoes();
}
