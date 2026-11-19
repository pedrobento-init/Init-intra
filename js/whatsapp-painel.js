// whatsapp-painel.js — Painel de atendimento do WhatsApp.
// =============================================================================
// Tudo sai de emails_triagem, que já está no aparelho (sync da Caixa) e já vem
// filtrada por equipe pela RLS e por filterByTeam. Nada de tabela nova para
// métrica: o número que o painel mostra é o mesmo histórico que a Caixa mostra.
//
// O que é um ATENDIMENTO (a unidade das médias):
//   * começa na mensagem do cliente que chega sem atendimento aberto naquele
//     telefone + equipe;
//   * termina quando alguém encerra a conversa (status 'encerrado', com a hora
//     em tratadoEm) ou, se ninguém encerrou, quando a conversa fica 12 h
//     parada — a mesma regra do atendimento automático (bot.ts) para "conversa
//     nova". Encerrar e reabrir apagam o status antigo (conversa-responder
//     regrava 'encerrado' como 'anexado'), então só a pausa longa separa os
//     atendimentos antigos; nesse caso o fim é a última mensagem.
//   * 1ª resposta = primeira mensagem de SAÍDA escrita por gente. Nota interna
//     não é resposta (o cliente não recebeu nada) e o atendimento automático
//     também não (ele só manda o menu; o cliente segue esperando alguém).
//   * a empresa escrevendo primeiro (whatsapp-iniciar) abre um atendimento
//     ATIVO: conta no volume do atendente, mas não tem "1ª resposta".
//
// Avaliação de satisfação: outra parte do sistema guarda as notas. Quem tiver
// os dados registra uma fonte com wpainelRegistrarAvaliacoes(fn); sem fonte,
// ou se ela falhar, o painel simplesmente não mostra o bloco.
//
// Script clássico (escopo global compartilhado), sem import/export.

const WPAINEL_AUTOR_BOT = 'Atendimento automático';
const WPAINEL_PAUSA_MS = 12 * 60 * 60 * 1000;
const WPAINEL_PERIODOS = { hoje: 'Hoje', d7: '7 dias', d30: '30 dias', d90: '90 dias' };
const WPAINEL_SEM_ATENDENTE = 'Sem atendente';

var _wpainelPeriodo = 'd7';
var _wpainelEquipe = '';
var _wpainelFonteAvaliacoes = null;

function _wpainelMs(iso) {
  const t = iso ? new Date(iso).getTime() : NaN;
  return isNaN(t) ? null : t;
}

function _wpainelDirecao(m) {
  return (m && m.direcao) || 'entrada';
}

function _wpainelEhWhats(m) {
  return !!m && (m.canal === 'whatsapp' || !!String(m.telefone || '').trim());
}

function _wpainelChave(m) {
  const t = m && m.telefone;
  if (typeof chamadoTelefoneChave === 'function') {
    const c = chamadoTelefoneChave(t);
    if (c) return c;
  }
  return String(t || '').replace(/\D/g, '');
}

function _wpainelHumana(m) {
  return _wpainelDirecao(m) === 'saida' && String(m.de || '').trim() !== WPAINEL_AUTOR_BOT;
}

/**
 * Pura: agrupa as linhas de WhatsApp em conversas (telefone + equipe), com as
 * mensagens em ordem de chegada — a ordem do banco não é garantida, e o sync
 * pode trazer uma resposta antes da pergunta.
 */
function wpainelConversas(linhas) {
  const grupos = new Map();
  (linhas || []).forEach((m) => {
    if (!_wpainelEhWhats(m) || _wpainelMs(m.recebidoEm) === null) return;
    const chave = _wpainelChave(m);
    if (!chave) return;
    const k = String(m.team || 'init') + '|' + chave;
    if (!grupos.has(k)) grupos.set(k, { chave, team: String(m.team || 'init'), mensagens: [] });
    grupos.get(k).mensagens.push(m);
  });
  const out = [];
  grupos.forEach((g) => {
    g.mensagens.sort((a, b) => _wpainelMs(a.recebidoEm) - _wpainelMs(b.recebidoEm));
    out.push(g);
  });
  return out;
}

function _wpainelNovo(conv, m, t, ativo) {
  return {
    chave: conv.chave,
    team: conv.team,
    inicio: t,
    ultima: t,
    ativo,
    primeiraResposta: null,
    atendente: ativo ? String(m.de || '').trim() || null : null,
    atribuido: m.atribuidoA || null,
    fechadoEm: null,
    fim: null,
    descartado: false,
    entradas: 0,
  };
}

function _wpainelFechar(s) {
  s.fim = s.fechadoEm !== null ? Math.max(s.fechadoEm, s.inicio) : s.ultima;
  if (!s.atendente) s.atendente = s.atribuido || null;
  return s;
}

/**
 * Pura: os atendimentos de uma conversa. `agora` decide se o último está
 * aberto (sem encerramento e sem 12 h de pausa) — aberto não tem fim.
 */
function wpainelAtendimentos(conversa, agora) {
  const hoje = agora == null ? Date.now() : agora;
  const out = [];
  let atual = null;
  for (const m of conversa.mensagens) {
    const t = _wpainelMs(m.recebidoEm);
    const dir = _wpainelDirecao(m);
    if (atual) {
      const encerrado = atual.fechadoEm !== null && t > atual.fechadoEm;
      const pausa = dir === 'entrada' && t - atual.ultima >= WPAINEL_PAUSA_MS;
      if (encerrado || pausa) {
        out.push(_wpainelFechar(atual));
        atual = null;
      }
    }
    if (!atual) {
      if (dir === 'entrada') atual = _wpainelNovo(conversa, m, t, false);
      else if (_wpainelHumana(m)) atual = _wpainelNovo(conversa, m, t, true);
      else continue; // nota ou robô sem conversa aberta não abre atendimento
    }
    atual.ultima = Math.max(atual.ultima, t);
    if (m.atribuidoA) atual.atribuido = m.atribuidoA;
    if (dir === 'entrada') {
      atual.entradas++;
      if (m.status === 'descartado') atual.descartado = true;
    }
    if (!atual.ativo && atual.primeiraResposta === null && _wpainelHumana(m) && t >= atual.inicio) {
      atual.primeiraResposta = t;
      atual.atendente = String(m.de || '').trim() || null;
    }
    const tratado = _wpainelMs(m.tratadoEm);
    if (m.status === 'encerrado' && tratado !== null && tratado >= atual.inicio)
      atual.fechadoEm = atual.fechadoEm === null ? tratado : Math.max(atual.fechadoEm, tratado);
  }
  if (atual) {
    const parado = hoje - atual.ultima >= WPAINEL_PAUSA_MS;
    if (atual.fechadoEm !== null || parado) out.push(_wpainelFechar(atual));
    else {
      if (!atual.atendente) atual.atendente = atual.atribuido || null;
      out.push(atual);
    }
  }
  return out;
}

function _wpainelDia(t) {
  const d = new Date(t);
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

function _wpainelMedia(lista) {
  return lista.length ? lista.reduce((s, v) => s + v, 0) / lista.length : null;
}

/**
 * Pura: as métricas do painel.
 *   linhas: emails_triagem já filtrada por equipe (formato local, camelCase).
 *   desde/ate: ms; o atendimento entra pelo início, a mensagem pela chegada.
 *   agora: ms, para "aberto agora" e "maior espera".
 */
function wpainelCalcular(linhas, opts) {
  const o = opts || {};
  const agora = o.agora == null ? Date.now() : o.agora;
  const desde = o.desde == null ? -Infinity : o.desde;
  const ate = o.ate == null ? Infinity : o.ate;
  const conversas = wpainelConversas(linhas);

  const atendimentos = [];
  conversas.forEach((c) => wpainelAtendimentos(c, agora).forEach((a) => atendimentos.push(a)));
  const doPeriodo = atendimentos.filter((a) => a.inicio >= desde && a.inicio < ate);
  // Descartado é spam ou engano: não é atendimento e não puxa média nenhuma.
  const validos = doPeriodo.filter((a) => !a.descartado);
  const receptivos = validos.filter((a) => !a.ativo);
  const respondidos = receptivos.filter((a) => a.primeiraResposta !== null);
  const terminados = validos.filter((a) => a.fim !== null);

  const porAtendente = {};
  validos.forEach((a) => {
    const nome = a.atendente || WPAINEL_SEM_ATENDENTE;
    const r = (porAtendente[nome] = porAtendente[nome] || {
      nome,
      atendimentos: 0,
      ativos: 0,
      respondidos: 0,
      somaPrimeira: 0,
      encerrados: 0,
    });
    r.atendimentos++;
    if (a.ativo) r.ativos++;
    if (a.primeiraResposta !== null) {
      r.respondidos++;
      r.somaPrimeira += a.primeiraResposta - a.inicio;
    }
    if (a.fim !== null) r.encerrados++;
  });
  const atendentes = Object.keys(porAtendente)
    .map((k) => {
      const r = porAtendente[k];
      return {
        nome: r.nome,
        atendimentos: r.atendimentos,
        ativos: r.ativos,
        encerrados: r.encerrados,
        primeiraRespostaMs: r.respondidos ? r.somaPrimeira / r.respondidos : null,
      };
    })
    .sort((a, b) => b.atendimentos - a.atendimentos || a.nome.localeCompare(b.nome, 'pt-BR'));

  // Volume: mensagens recebidas do cliente, por dia e por hora do dia.
  const porDia = {};
  const porHora = new Array(24).fill(0);
  conversas.forEach((c) =>
    c.mensagens.forEach((m) => {
      if (_wpainelDirecao(m) !== 'entrada') return;
      const t = _wpainelMs(m.recebidoEm);
      if (t < desde || t >= ate) return;
      const dia = _wpainelDia(t);
      porDia[dia] = (porDia[dia] || 0) + 1;
      porHora[new Date(t).getHours()]++;
    })
  );
  // Dia sem mensagem também é dado: sem preencher, o gráfico pularia a data.
  const dias = [];
  if (isFinite(desde) && isFinite(ate) && ate > desde) {
    const d = new Date(desde);
    d.setHours(0, 0, 0, 0);
    for (let i = 0; i < 400 && d.getTime() < ate; i++) {
      const k = _wpainelDia(d.getTime());
      dias.push({ dia: k, total: porDia[k] || 0 });
      d.setDate(d.getDate() + 1);
    }
  } else {
    Object.keys(porDia)
      .sort()
      .forEach((k) => dias.push({ dia: k, total: porDia[k] }));
  }

  // Agora: estado atual de cada conversa, independente do período.
  let abertas = 0;
  let aguardando = 0;
  let semAtendente = 0;
  let maiorEsperaMs = 0;
  conversas.forEach((c) => {
    const entradas = c.mensagens.filter((m) => _wpainelDirecao(m) === 'entrada');
    if (!entradas.length) return;
    const ultimaEntrada = entradas[entradas.length - 1];
    const pendente = entradas.some((m) => m.status === 'pendente');
    if (
      !pendente &&
      (ultimaEntrada.status === 'encerrado' || ultimaEntrada.status === 'descartado')
    )
      return;
    abertas++;
    const atribuido = c.mensagens.some((m) => m.atribuidoA);
    if (!atribuido) semAtendente++;
    // Aguardando = a última fala que o cliente vê é dele. Nota interna e menu
    // do robô não contam como resposta.
    const falas = c.mensagens.filter((m) => _wpainelDirecao(m) === 'entrada' || _wpainelHumana(m));
    const ultimaFala = falas[falas.length - 1];
    if (ultimaFala && _wpainelDirecao(ultimaFala) === 'entrada') {
      aguardando++;
      maiorEsperaMs = Math.max(maiorEsperaMs, agora - _wpainelMs(ultimaFala.recebidoEm));
    }
  });

  return {
    atendimentos: validos.length,
    receptivos: receptivos.length,
    ativos: validos.length - receptivos.length,
    semResposta: receptivos.length - respondidos.length,
    descartados: doPeriodo.length - validos.length,
    primeiraRespostaMs: _wpainelMedia(respondidos.map((a) => a.primeiraResposta - a.inicio)),
    atendimentoMs: _wpainelMedia(terminados.map((a) => a.fim - a.inicio)),
    encerrados: terminados.length,
    atendentes,
    dias,
    horas: porHora,
    recebidas: dias.reduce((s, d) => s + d.total, 0),
    abertas,
    aguardando,
    semAtendente,
    maiorEsperaMs,
  };
}

/** "4 min", "1 h 20 min", "2 d 3 h". Null vira travessão. */
function wpainelDuracao(ms) {
  if (ms == null || !isFinite(ms)) return '—';
  const min = Math.round(Math.max(0, ms) / 60000);
  if (min < 1) return '< 1 min';
  if (min < 60) return min + ' min';
  const h = Math.floor(min / 60);
  const rm = min % 60;
  if (h < 24) return h + ' h' + (rm ? ' ' + rm + ' min' : '');
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return d + ' d' + (rh ? ' ' + rh + ' h' : '');
}

/** Intervalo [desde, ate) do período escolhido, em ms. */
function wpainelIntervalo(periodo, agora) {
  const fim = agora == null ? Date.now() : agora;
  const ini = new Date(fim);
  ini.setHours(0, 0, 0, 0);
  const dias = { hoje: 0, d7: 6, d30: 29, d90: 89 }[periodo];
  ini.setDate(ini.getDate() - (dias == null ? 6 : dias));
  return { desde: ini.getTime(), ate: fim + 1 };
}

/**
 * Ponto de extensão da avaliação de satisfação. `fn({desde, ate, team})` deve
 * devolver { media, total } (média de 1 a 5) ou null. Quem registrar é dono do
 * dado; o painel só mostra.
 */
function wpainelRegistrarAvaliacoes(fn) {
  _wpainelFonteAvaliacoes = typeof fn === 'function' ? fn : null;
}

function _wpainelAvaliacoes(filtro) {
  if (!_wpainelFonteAvaliacoes) return null;
  try {
    const r = _wpainelFonteAvaliacoes(filtro);
    if (!r || typeof r.media !== 'number' || !isFinite(r.media) || !(r.total > 0)) return null;
    return { media: r.media, total: r.total };
  } catch (e) {
    if (typeof _logSilent === 'function') _logSilent(e, 'wpainel-avaliacoes');
    return null;
  }
}

// ── Tela ──────────────────────────────────────────────────────────────────────

function _wpainelLinhas() {
  let lista = typeof getEmailsTriagem === 'function' ? getEmailsTriagem() : [];
  if (typeof filterByTeam === 'function') lista = filterByTeam(lista);
  return lista.filter(_wpainelEhWhats);
}

function _wpainelKpi(valor, rotulo, dica, tom) {
  return (
    '<div class="ov-k ov-k-static' +
    (tom ? ' ' + tom : '') +
    '"' +
    (dica ? ' title="' + escapeHtml(dica) + '"' : '') +
    '><b class="stat-value">' +
    escapeHtml(String(valor)) +
    '</b><span>' +
    escapeHtml(rotulo) +
    '</span></div>'
  );
}

// Barras de uma série só (uma cor, a de destaque): a altura é a magnitude e o
// rótulo/tooltip leva o número — a cor não carrega informação sozinha.
function _wpainelColunasHTML(itens, rotuloAria) {
  const max = Math.max(1, ...itens.map((i) => i.valor));
  return (
    '<div class="wpainel-colunas" role="img" aria-label="' +
    escapeHtml(rotuloAria) +
    '">' +
    itens
      .map(
        (i) =>
          '<div class="wpainel-col" title="' +
          escapeHtml(i.dica) +
          '"><span class="wpainel-col-v">' +
          (i.valor ? escapeHtml(String(i.valor)) : '') +
          '</span><span class="wpainel-col-barra" data-sty="height:' +
          Math.round((i.valor / max) * 100) +
          '%"></span><span class="wpainel-col-r">' +
          escapeHtml(i.rotulo) +
          '</span></div>'
      )
      .join('') +
    '</div>'
  );
}

function _wpainelDiaRotulo(k, curto) {
  const [a, m, d] = k.split('-').map(Number);
  const dt = new Date(a, m - 1, d);
  return curto
    ? String(d).padStart(2, '0') + '/' + String(m).padStart(2, '0')
    : dt.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
}

function _wpainelEquipes(linhas) {
  return [...new Set(linhas.map((m) => String(m.team || 'init')))].sort();
}

function renderWhatsappPainel() {
  const titulo = document.getElementById('pageTitle');
  if (titulo) titulo.textContent = 'Painel de atendimento';
  const area = document.getElementById('contentArea');
  if (!area) return;
  const todas = _wpainelLinhas();
  const admin = typeof isTeamAdmin === 'function' && isTeamAdmin();
  const equipes = admin ? _wpainelEquipes(todas) : [];
  if (_wpainelEquipe && !equipes.includes(_wpainelEquipe)) _wpainelEquipe = '';
  const linhas = _wpainelEquipe
    ? todas.filter((m) => String(m.team || 'init') === _wpainelEquipe)
    : todas;
  const agora = Date.now();
  const { desde, ate } = wpainelIntervalo(_wpainelPeriodo, agora);
  const r = wpainelCalcular(linhas, { desde, ate, agora });
  const aval = _wpainelAvaliacoes({ desde, ate, team: _wpainelEquipe || null });

  const filtros =
    '<div class="wpainel-filtros"><div class="cx-chips" role="group" aria-label="Período">' +
    Object.keys(WPAINEL_PERIODOS)
      .map(
        (k) =>
          '<button type="button" class="chip' +
          (k === _wpainelPeriodo ? ' on' : '') +
          '" aria-pressed="' +
          (k === _wpainelPeriodo) +
          '" data-action="wpainelPeriodo" data-arg="' +
          k +
          '">' +
          escapeHtml(WPAINEL_PERIODOS[k]) +
          '</button>'
      )
      .join('') +
    '</div>' +
    (equipes.length > 1
      ? '<select class="form-select wpainel-equipe" data-change="wpainelEquipe" aria-label="Equipe"><option value="">Todas as equipes</option>' +
        equipes
          .map(
            (t) =>
              '<option value="' +
              escapeHtml(t) +
              '"' +
              (t === _wpainelEquipe ? ' selected' : '') +
              '>' +
              escapeHtml(t) +
              '</option>'
          )
          .join('') +
        '</select>'
      : '') +
    '</div>';

  const agoraKpis =
    '<section class="ov-kpis wpainel-kpis" aria-label="Agora">' +
    _wpainelKpi(r.abertas, 'Conversas abertas agora', 'Conversas não encerradas nem descartadas') +
    _wpainelKpi(
      r.aguardando,
      'Aguardando resposta',
      'A última mensagem é do cliente (nota interna e robô não contam)',
      r.aguardando ? 'amber' : ''
    ) +
    _wpainelKpi(
      r.semAtendente,
      'Na fila sem atendente',
      'Abertas e sem ninguém atribuído',
      r.semAtendente ? 'amber' : ''
    ) +
    _wpainelKpi(
      r.aguardando ? wpainelDuracao(r.maiorEsperaMs) : '—',
      'Maior espera agora',
      'Desde a última mensagem do cliente que aguarda resposta',
      r.maiorEsperaMs >= 3600000 ? 'red' : ''
    ) +
    '</section>';

  const periodoKpis =
    '<section class="ov-kpis wpainel-kpis" aria-label="No período">' +
    _wpainelKpi(
      wpainelDuracao(r.primeiraRespostaMs),
      'Tempo médio de 1ª resposta',
      'Da mensagem do cliente até a primeira resposta escrita por alguém da equipe'
    ) +
    _wpainelKpi(
      wpainelDuracao(r.atendimentoMs),
      'Tempo médio de atendimento',
      'Do início até encerrar (ou até 12 h sem mensagem)'
    ) +
    _wpainelKpi(r.atendimentos, 'Atendimentos', r.ativos + ' iniciados pela empresa') +
    _wpainelKpi(
      r.semResposta,
      'Sem resposta',
      'Atendimentos do período que ninguém respondeu',
      r.semResposta ? 'red' : ''
    ) +
    (aval
      ? _wpainelKpi(
          aval.media.toFixed(1).replace('.', ','),
          'Satisfação (' + aval.total + ' avaliações)',
          'Média das notas de 1 a 5'
        )
      : '') +
    '</section>';

  const maxAt = Math.max(1, ...r.atendentes.map((a) => a.atendimentos));
  const tabelaAtendentes = r.atendentes.length
    ? '<table class="wpainel-tabela"><thead><tr><th scope="col">Atendente</th><th scope="col">Atendimentos</th><th scope="col">Iniciados</th><th scope="col">Encerrados</th><th scope="col">1ª resposta</th></tr></thead><tbody>' +
      r.atendentes
        .map(
          (a) =>
            '<tr><th scope="row">' +
            escapeHtml(a.nome) +
            '</th><td><span class="wpainel-barra-h"><span data-sty="width:' +
            Math.round((a.atendimentos / maxAt) * 100) +
            '%"></span></span><b>' +
            a.atendimentos +
            '</b></td><td>' +
            a.ativos +
            '</td><td>' +
            a.encerrados +
            '</td><td>' +
            escapeHtml(wpainelDuracao(a.primeiraRespostaMs)) +
            '</td></tr>'
        )
        .join('') +
      '</tbody></table>'
    : '<p class="ov-muted">Nenhum atendimento no período.</p>';

  // Muitos dias: rótulo curto, senão as datas se atropelam.
  const curto = r.dias.length > 10;
  const colDias = _wpainelColunasHTML(
    r.dias.map((d) => ({
      valor: d.total,
      rotulo: _wpainelDiaRotulo(d.dia, true),
      dica: _wpainelDiaRotulo(d.dia, false) + ': ' + d.total + ' mensagens',
    })),
    'Mensagens recebidas por dia'
  );
  const colHoras = _wpainelColunasHTML(
    r.horas.map((v, h) => ({
      valor: v,
      rotulo: h % 3 === 0 ? String(h).padStart(2, '0') + 'h' : '',
      dica: String(h).padStart(2, '0') + 'h: ' + v + ' mensagens',
    })),
    'Mensagens recebidas por hora do dia'
  );
  const tabelaDias =
    '<details class="wpainel-dados"><summary>Ver em tabela</summary><table class="wpainel-tabela"><thead><tr><th scope="col">Dia</th><th scope="col">Mensagens</th></tr></thead><tbody>' +
    r.dias
      .map(
        (d) =>
          '<tr><th scope="row">' +
          escapeHtml(_wpainelDiaRotulo(d.dia, false)) +
          '</th><td>' +
          d.total +
          '</td></tr>'
      )
      .join('') +
    '</tbody></table></details>';

  area.innerHTML =
    '<div class="wpainel">' +
    filtros +
    '<h2 class="ov-h2 wpainel-h">Agora</h2>' +
    agoraKpis +
    '<h2 class="ov-h2 wpainel-h">' +
    escapeHtml(WPAINEL_PERIODOS[_wpainelPeriodo]) +
    '</h2>' +
    periodoKpis +
    '<div class="wpainel-grade">' +
    '<section class="card ov-panel" aria-labelledby="wpainel-at"><div class="ov-ph"><h2 class="ov-h2" id="wpainel-at">Conversas por atendente</h2></div>' +
    tabelaAtendentes +
    '</section>' +
    '<section class="card ov-panel" aria-labelledby="wpainel-dia"><div class="ov-ph"><h2 class="ov-h2" id="wpainel-dia">Mensagens recebidas por dia</h2><span class="ov-chip">' +
    r.recebidas +
    ' no período</span></div>' +
    '<div class="wpainel-rolagem' +
    (curto ? ' wpainel-curto' : '') +
    '">' +
    colDias +
    '</div>' +
    tabelaDias +
    '</section>' +
    '<section class="card ov-panel" aria-labelledby="wpainel-hora"><div class="ov-ph"><h2 class="ov-h2" id="wpainel-hora">Por hora do dia</h2></div>' +
    colHoras +
    '</section></div>' +
    '<p class="ov-muted wpainel-nota">Atendimento começa na mensagem do cliente e termina ao encerrar a conversa ou depois de 12 h sem mensagem. Nota interna e atendimento automático não contam como resposta.</p>' +
    '</div>';
}

if (typeof registerActions === 'function') {
  registerActions({
    wpainelPeriodo: (_el, p) => {
      _wpainelPeriodo = WPAINEL_PERIODOS[p] ? p : 'd7';
      renderWhatsappPainel();
    },
    wpainelEquipe: (_el, t) => {
      _wpainelEquipe = String(t || '');
      renderWhatsappPainel();
    },
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    wpainelConversas,
    wpainelAtendimentos,
    wpainelCalcular,
    wpainelDuracao,
    wpainelIntervalo,
    wpainelRegistrarAvaliacoes,
    _wpainelAvaliacoes,
  };
}
