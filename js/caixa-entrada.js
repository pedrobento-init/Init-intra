// caixa-entrada.js — A caixa de entrada do marcador Pendências (073).
// =============================================================================
// Toda mensagem que o robô lê vira uma linha em emails_triagem, inclusive as
// que já viraram chamado sozinhas. A seção das pendências mostra só o que
// sobrou para alguém decidir; esta tela mostra a conversa inteira, agrupada
// pelo thread do Gmail, porque é o thread que o técnico enxerga — e é nele
// que a atribuição mora: duas mensagens do mesmo thread com donos diferentes
// seria o mesmo cliente atendido por duas pessoas sem saber uma da outra.
//
// A resposta sai direto da conversa pela function conversa-responder. Chamado
// é opcional e tem SLA próprio. A IA classifica, mas nunca responde sozinha.
//
// Desde a 075 a mesma tabela recebe o WhatsApp (canal = 'whatsapp', telefone).
// Não há thread do Gmail ali: a conversa é o telefone, e é por ele que a
// mensagem se agrupa, sugere cliente e vira chamado. Entrada sem canal é
// e-mail — é tudo o que existia antes da coluna.

var _caixaFiltro = 'pendentes';
var _caixaBusca = '';
var _caixaSelecionada = null;
var _caixaCanal = 'todos';
// Rascunho do composer. O sync e o realtime redesenham a tela a cada mensagem
// nova; sem guardar o texto, o que a pessoa estava escrevendo sumia no meio da
// frase. Fica por conversa: trocar de thread não leva o texto para outra.
var _caixaRascunho = { id: null, texto: '', kind: 'reply' };
// Mensagens que a pessoa já mandou e o servidor ainda não confirmou. Aparecem na
// conversa na hora, como no WhatsApp: esperar a Edge Function e o sync para só
// então limpar o campo deixava a tela parada e convidava a mandar de novo.
var _caixaEnviando = [];
var _caixaEnvioSeq = 0;
// Envios saem um depois do outro: em paralelo, duas mensagens digitadas em
// sequência podiam chegar ao cliente na ordem trocada.
var _caixaFilaEnvio = Promise.resolve();
// Depois de enviar, o campo volta a ter foco mesmo que o envio tenha sido pelo
// botão: quem está numa conversa continua escrevendo.
var _caixaFocarComposer = false;

// Nome com que o webhook do WhatsApp grava o que o atendimento automático mandou
// (supabase/functions/whatsapp/index.ts, AUTOR_BOT): os dois lados têm de bater.
const CAIXA_AUTOR_BOT = 'Atendimento automático';

const CAIXA_CANAIS = {
  todos: 'Todos os canais',
  email: 'E-mail',
  whatsapp: 'WhatsApp',
};

const CAIXA_FILTROS = {
  pendentes: 'Em atendimento',
  minhas: 'Atribuídas a mim',
  encerradas: 'Encerradas',
  todas: 'Todas',
};

const CAIXA_STATUS = {
  pendente: 'Aguardando',
  virou_chamado: 'Virou chamado',
  anexado: 'Em atendimento',
  descartado: 'Descartado',
  encerrado: 'Encerrado',
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
  return (
    'whatsapp:' + (chamadoTelefoneChave(e.telefone) || chamadoTelefoneDigitos(e.telefone) || e.id)
  );
}

// A tela agrupa o WhatsApp pelo telefone normalizado (sem 55 e sem nono
// dígito), mas o banco guarda o thread com o número inteiro. Responder com a
// chave da tela daria 404 na function: o thread id que vale é o que o servidor
// gravou — e, numa linha antiga sem ele, o telefone reconstruído do mesmo jeito.
function caixaThreadId(c) {
  if (!c) return '';
  if (c.ultima && c.ultima.threadId) return c.ultima.threadId;
  if ((c.canal || caixaCanalEntrada(c.ultima)) === 'whatsapp') {
    const digitos = chamadoTelefoneDigitos(c.telefone || (c.ultima && c.ultima.telefone) || '');
    if (digitos) return 'whatsapp:' + digitos;
  }
  return c.id || '';
}

function caixaAgruparConversas(lista) {
  const grupos = {};
  (lista || []).forEach((e) => {
    if (!e || !e.id) return;
    const chave = _caixaChaveConversa(e);
    (grupos[chave] = grupos[chave] || []).push(e);
  });
  return Object.keys(grupos)
    .map((chave) => {
      const mensagens = grupos[chave]
        .slice()
        .sort((a, b) => _caixaData(a).localeCompare(_caixaData(b)));
      const ultima = mensagens[mensagens.length - 1];
      const entradas = mensagens.filter((m) => (m.direcao || 'entrada') === 'entrada');
      const ultimaEntrada = entradas.length ? entradas[entradas.length - 1] : null;
      // Dono, cliente e chamado valem para o thread: pega o mais recente que
      // tiver o campo, porque uma resposta nova pode chegar antes do robô ou do
      // técnico carimbarem nela o que a primeira já tinha.
      const ultimoCom = (campo) => {
        for (let i = mensagens.length - 1; i >= 0; i--)
          if (mensagens[i][campo]) return mensagens[i][campo];
        return null;
      };
      const pendente = mensagens.some(
        (m) => (m.direcao || 'entrada') === 'entrada' && m.status === 'pendente'
      );
      // Encerrada/descartada é o estado da ÚLTIMA mensagem do cliente, não de
      // qualquer uma do thread: mensagem nova depois de encerrar chega como
      // 'anexado' (chamado aberto) e, olhando o histórico inteiro, a conversa
      // ficaria presa em "Encerradas" mesmo com o cliente falando de novo.
      const statusCliente = ultimaEntrada ? ultimaEntrada.status : null;
      return {
        id: chave,
        mensagens,
        ultima,
        ultimaEntrada,
        canal: caixaCanalEntrada(ultima),
        telefone: ultimoCom('telefone'),
        pendente,
        encerrada: !pendente && statusCliente === 'encerrado',
        // Descartar é decisão tomada: a conversa não volta para a fila de quem
        // espera resposta, mas continua existindo em "Todas".
        descartada: !pendente && statusCliente === 'descartado',
        atribuidoA: ultimoCom('atribuidoA'),
        clientId: ultimoCom('clientId'),
        pendenciaId: ultimoCom('pendenciaId'),
        fotoUrl: ultimoCom('fotoUrl'),
      };
    })
    .sort((a, b) => _caixaData(b.ultima).localeCompare(_caixaData(a.ultima)));
}

// Depois que a equipe responde, a última mensagem do thread é nossa — mas o
// interlocutor não mudou. Nome, endereço, motivo e sugestão de cliente saem da
// última mensagem de ENTRADA; a resposta não vira o "quem pediu".
function caixaInterlocutor(c) {
  if (!c) return null;
  if (c.ultimaEntrada) return c.ultimaEntrada;
  const entradas = (c.mensagens || []).filter((m) => (m.direcao || 'entrada') === 'entrada');
  if (entradas.length) return entradas[entradas.length - 1];
  // Conversa que a empresa começou (whatsapp-iniciar): o "de" da saída é quem
  // atendeu, não o contato. Sem ele, o nome cai no telefone (ou no nome salvo).
  if (c.ultima && c.canal === 'whatsapp') return Object.assign({}, c.ultima, { de: '' });
  return c.ultima || null;
}

function caixaFiltrar(conversas, filtro, busca, usuario) {
  const q = String(busca || '')
    .trim()
    .toLowerCase();
  // Telefone se busca pelos dígitos: ninguém digita os parênteses e o hífen
  // do jeito que o cadastro guardou.
  const qDig = chamadoTelefoneDigitos(q);
  return (conversas || []).filter((c) => {
    if (filtro === 'minhas' && c.atribuidoA !== usuario) return false;
    if ((filtro || 'pendentes') === 'pendentes' && (c.encerrada || c.descartada)) return false;
    if (filtro === 'encerradas' && !c.encerrada) return false;
    if (!q) return true;
    return c.mensagens.some(
      (m) =>
        String(m.assunto || '')
          .toLowerCase()
          .includes(q) ||
        String(m.de || '')
          .toLowerCase()
          .includes(q) ||
        (qDig.length >= 4 && chamadoTelefoneDigitos(m.telefone).includes(qDig))
    );
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
  const achados = (clientes || []).filter(
    (cl) =>
      cl &&
      (chamadoTelefoneChave(cl.ownerPhone) === chave ||
        chamadoTelefoneChave(cl.responsiblePhone) === chave)
  );
  return achados.length === 1 ? achados[0].id : null;
}

// No WhatsApp o "de" pode ser o nome do perfil ou o próprio número. Número cru
// não é nome: mostra formatado, que é como o técnico reconhece.
function _caixaNomeDe(m, canal) {
  if (!m) return '(sem remetente)';
  if (canal !== 'whatsapp') return _emailTriagemNome(m.de) || m.de || '(sem remetente)';
  // Nome editado em Contatos do WhatsApp (089) vale mais que o do perfil.
  const salvo = typeof wcontNome === 'function' ? wcontNome(m.telefone, m.team) : '';
  if (salvo) return salvo;
  const de = String(m.de || '').trim();
  const soNumero = !de || (chamadoTelefoneDigitos(de).length >= 8 && !/[a-zà-ú]/i.test(de));
  if (!soNumero) return de;
  return chamadoTelefoneFormatar(m.telefone || de) || '(sem remetente)';
}

// Badge do canal: só ícone + rótulo, todo texto passa por escapeHtml.
function _caixaCanalHTML(canal) {
  const c = canal === 'whatsapp' ? 'whatsapp' : 'email';
  const icone =
    c === 'whatsapp'
      ? '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 21l2.1-5.4A8.4 8.4 0 1 1 21 11.5z"/></svg>'
      : '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>';
  return (
    '<span class="cx-canal cx-canal-' +
    escapeHtml(c) +
    '">' +
    icone +
    escapeHtml(CAIXA_CANAIS[c]) +
    '</span>'
  );
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
    return {
      texto: String(corpo || '')
        .replace(/\r\n?/g, '\n')
        .trim(),
      assinatura: '',
    };
  }
  const linhas = String(corpo || '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const fica = [];
  const assina = [];
  let naAssinatura = false;
  for (const l of linhas) {
    const t = l.trim();
    if (
      /^(Em .+escreveu:|On .+wrote:|-{2,} ?(Mensagem original|Original Message) ?-{2,}|De: .+|From: .+)$/i.test(
        t
      ) &&
      (fica.length || assina.length)
    )
      break;
    if (!naAssinatura && (t === '--' || t === '-- ')) {
      naAssinatura = true;
      continue;
    }
    if (t.startsWith('>')) continue;
    (naAssinatura ? assina : fica).push(l);
  }
  const limpa = (arr) =>
    arr
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  return { texto: limpa(fica), assinatura: limpa(assina) };
}

function caixaPrevia(corpo, max, canal) {
  const lim = max || 120;
  const linha =
    caixaCorpoLimpo(corpo, canal)
      .texto.split('\n')
      .map((l) => l.trim())
      .find(
        (l) =>
          l &&
          !/^(ol[áa]|oi|bom dia|boa tarde|boa noite|prezad[oa]s?)\b[^.!?]{0,30}[,!.]?$/i.test(l)
      ) || '';
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
    return caixaClientePorTelefone(
      conversa.telefone,
      typeof getMyClients === 'function' ? getMyClients() : []
    );
  }
  const quem = caixaInterlocutor(conversa);
  const chave = _caixaChaveRemetente(quem && quem.de);
  if (!chave) return null;
  const votos = {};
  (conversas || []).forEach((c) => {
    if (c.id === conversa.id || !c.clientId) return;
    const outro = caixaInterlocutor(c);
    if (_caixaChaveRemetente(outro && outro.de) === chave)
      votos[c.clientId] = (votos[c.clientId] || 0) + 1;
  });
  const ids = Object.keys(votos).sort((a, b) => votos[b] - votos[a]);
  return ids[0] || null;
}

function caixaHistoricoRemetente(conversa, conversas, max) {
  // No WhatsApp a conversa já é o número inteiro (_caixaChaveConversa agrupa
  // pela chave do telefone): não existe "outra conversa do mesmo remetente".
  if (conversa && conversa.canal === 'whatsapp') return [];
  const quem = caixaInterlocutor(conversa);
  const end = quem ? _emailTriagemEndereco(quem.de) : '';
  if (!end) return [];
  return (conversas || [])
    .filter((c) => {
      const outro = caixaInterlocutor(c);
      return c.id !== conversa.id && _emailTriagemEndereco(outro && outro.de) === end;
    })
    .slice(0, max || 5);
}

function caixaContarFiltros(conversas, usuario) {
  const r = {};
  Object.keys(CAIXA_FILTROS).forEach((k) => {
    r[k] = caixaFiltrar(conversas, k, '', usuario).length;
  });
  return r;
}

// Lido/não lido é por pessoa e não precisa sobreviver a outro aparelho, então
// fica no navegador. Guarda o id da última mensagem vista: resposta nova no
// thread faz a conversa voltar a não lida sozinha.
function _caixaLidasChave() {
  const u = typeof getUser === 'function' ? getUser() || {} : {};
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
  try {
    localStorage.setItem(_caixaLidasChave(), JSON.stringify(mapa));
  } catch (_e) {
    /* modo privado: segue sem */
  }
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
  const lista =
    typeof filterByTeam === 'function' ? filterByTeam(getEmailsTriagem()) : getEmailsTriagem();
  return caixaAgruparConversas(lista);
}

function _caixaConversaPorId(id) {
  return _caixaConversas().find((c) => c.id === id) || null;
}

// Selo com o ícone do canal (WhatsApp/e-mail), no canto do avatar.
function _cxBadgeCanal(canal) {
  const whats = canal === 'whatsapp';
  const path = whats
    ? '<path d="M21 11.5a8.5 8.5 0 0 1-12.6 7.4L3 20l1.2-5A8.5 8.5 0 1 1 21 11.5z"/>'
    : '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>';
  return (
    '<span class="cx-av-badge ' +
    (whats ? 'wa' : 'em') +
    '">' +
    '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    path +
    '</svg></span>'
  );
}

// Número curto do chamado: o cliente vê "Chamado 1721", não "PEN-0001721".
function _cxChamadoCurto(id) {
  return (
    String(id || '')
      .replace(/^PEN-?0*/i, '')
      .replace(/^0+/, '') || String(id || '')
  );
}

function _caixaItemHTML(c, lidas) {
  const u = c.ultima;
  // A prévia e a hora são da última atividade (inclusive a nossa resposta); o
  // nome é de quem falou com a empresa.
  const quem = caixaInterlocutor(c) || u;
  const cli = c.clientId && typeof getClientById === 'function' ? getClientById(c.clientId) : null;
  const naoLida = caixaNaoLida(c, lidas);
  const previa = caixaPrevia(u.corpo, 110, c.canal);
  // Relógio de espera: quem ficou esperando um dia fica âmbar; dois, vermelho.
  const esperaMs = u.recebidoEm ? Date.now() - new Date(u.recebidoEm).getTime() : 0;
  const classeEspera =
    esperaMs >= 2 * 86400000 ? ' cx-late-r' : esperaMs >= 86400000 ? ' cx-late-y' : '';
  const espera = caixaEsperaRotulo(u.recebidoEm);
  const nome = _caixaNomeDe(quem, c.canal);
  return (
    '<button type="button" class="cx-item' +
    (c.id === _caixaSelecionada ? ' sel' : '') +
    (c.pendente ? ' pendente' : '') +
    (naoLida ? ' nao-lida' : '') +
    '" data-action="caixaSelecionar" data-arg="' +
    escapeHtml(c.id) +
    '">' +
    '<span class="cx-av" aria-hidden="true">' +
    escapeHtml(_caixaIniciais(nome)) +
    caixaFotoHTML(c) +
    _cxBadgeCanal(c.canal) +
    '</span>' +
    '<span class="cx-cm">' +
    '<span class="cx-r1">' +
    (naoLida ? '<i class="cx-dot" aria-label="Não lida"></i>' : '') +
    '<b class="cx-nm">' +
    escapeHtml(nome) +
    '</b>' +
    '<span class="cx-quando' +
    classeEspera +
    '" title="' +
    escapeHtml(formatDateTime(u.recebidoEm)) +
    '">' +
    escapeHtml(espera) +
    '</span></span>' +
    (u.assunto
      ? '<span class="cx-assunto">' + escapeHtml(u.assunto || '(sem assunto)') + '</span>'
      : '') +
    (previa ? '<span class="cx-previa">' + escapeHtml(previa) + '</span>' : '') +
    '<span class="cx-meta"><span class="cx-emp' +
    (cli ? '' : ' cx-alerta') +
    '">' +
    escapeHtml(cli ? cli.name : 'Sem cliente') +
    '</span>' +
    (c.pendenciaId
      ? '<span class="cx-badge">Chamado ' + escapeHtml(_cxChamadoCurto(c.pendenciaId)) + '</span>'
      : '') +
    (c.atribuidoA ? '<span class="cx-meta-com">com ' + escapeHtml(c.atribuidoA) + '</span>' : '') +
    (typeof wetqConversaChipsHTML === 'function' ? wetqConversaChipsHTML(c, 2) : '') +
    '</span>' +
    '</span></button>'
  );
}

// Estado local da tela: conversas com cartões de e-mail expandidos (a última
// sempre abre) e o painel de detalhes visível ou não.
var _caixaExpand = {};
var _caixaDetalhesAberto = true;

function _caixaConversaHTML(c) {
  const id = escapeHtml(c.id);
  const cli = c.clientId && typeof getClientById === 'function' ? getClientById(c.clientId) : null;
  const pen =
    c.pendenciaId && typeof getPendenciaById === 'function'
      ? getPendenciaById(c.pendenciaId)
      : null;
  const u = c.ultima;
  const quem = caixaInterlocutor(c) || u;
  const motivo = EMAIL_TRIAGEM_MOTIVOS[quem.motivo];
  const todas = _caixaConversas();
  const sugerido = caixaSugerirCliente(c, todas);
  const cliSug = sugerido && typeof getClientById === 'function' ? getClientById(sugerido) : null;
  const historico = caixaHistoricoRemetente(c, todas);
  const whats = c.canal === 'whatsapp';
  const nome = _caixaNomeDe(quem, c.canal);
  // No WhatsApp o contato é o telefone; o e-mail cru do "de" não existe ali.
  const emailDe = whats
    ? chamadoTelefoneFormatar(c.telefone || quem.telefone || '')
    : _caixaEmailDe(quem.de);
  const status = c.pendente ? 'pendente' : u.status || '';
  const expMap = (_caixaExpand[c.id] = _caixaExpand[c.id] || {});
  let diaAnterior = '';
  const hora = (m) => escapeHtml(_caixaHora(m.recebidoEm) || formatDateTime(m.recebidoEm));
  const autorDe = (m) =>
    (m.direcao || 'entrada') === 'interna'
      ? 'Nota interna · ' + (m.de || 'Equipe')
      : (m.direcao || 'entrada') === 'saida'
        ? m.de || 'Você'
        : _caixaNomeDe(m, c.canal);
  const timeline = c.mensagens
    .map((m, i) => {
      const dia = _caixaDiaRotulo(m.recebidoEm);
      const sep =
        dia && dia !== diaAnterior
          ? '<div class="cx-dia"><span>' + escapeHtml(dia) + '</span></div>'
          : '';
      diaAnterior = dia;
      const direcao = m.direcao || 'entrada';
      const autor = autorDe(m);
      if (whats) {
        const continua = caixaMsgContinua(c.mensagens[i - 1], m) && !sep;
        return sep + _caixaMsgWhatsHTML(c, m, continua);
      }
      const ultimaMsg = i === c.mensagens.length - 1;
      const expandida = ultimaMsg || !!expMap[i];
      if (!expandida) {
        const linha = caixaPrevia(m.corpo, 100, c.canal) || '(sem texto)';
        return (
          sep +
          '<button type="button" class="cx-em cx-em-fold" data-action="caixaExpandir" data-arg="' +
          i +
          '"><span><b>' +
          escapeHtml(autor) +
          '</b>: ' +
          escapeHtml(linha) +
          '</span><span class="cx-quando">' +
          hora(m) +
          '</span></button>'
        );
      }
      return (
        sep +
        '<article class="cx-em' +
        (direcao === 'saida' ? ' cx-em-out' : '') +
        (direcao === 'interna' ? ' cx-em-nota' : '') +
        '">' +
        '<div class="cx-em-eh"><b>' +
        escapeHtml(autor) +
        '</b><span class="cx-quando">' +
        hora(m) +
        '</span></div>' +
        '<div class="cx-em-eb">' +
        _caixaCorpoHTML(m.corpo, c.canal) +
        _caixaMediaHTML(m.media) +
        '</div></article>'
      );
    })
    .join('');
  const lado =
    '<aside class="cx-lado">' +
    '<section><h3>Quem pediu</h3><div class="cx-pessoa"><span class="cx-av cx-av-md" aria-hidden="true">' +
    escapeHtml(_caixaIniciais(nome)) +
    caixaFotoHTML(c) +
    '</span><div><b>' +
    escapeHtml(nome) +
    '</b>' +
    (emailDe && emailDe !== nome ? '<span class="cx-sub">' + escapeHtml(emailDe) + '</span>' : '') +
    '</div></div>' +
    '<dl><dt>Cliente</dt><dd>' +
    (cli ? escapeHtml(cli.name) : '<span class="cx-sub">Não vinculado</span>') +
    '</dd></dl>' +
    (cliSug
      ? '<div class="cx-sugestao"><span>Parece ser <b>' +
        escapeHtml(cliSug.name) +
        '</b>, ' +
        (whats ? 'pelo telefone' : 'pelo remetente') +
        '.</span>' +
        '<button type="button" class="btn btn-primary btn-sm" data-action="caixaVincularSugerido" data-arg="' +
        id +
        '">Vincular</button></div>'
      : '') +
    '</section>' +
    (historico.length
      ? '<section><h3>Outras conversas dele</h3><ul class="cx-historico">' +
        historico
          .map(
            (h) =>
              '<li><a href="#" data-action="caixaSelecionar" data-arg="' +
              escapeHtml(h.id) +
              '">' +
              escapeHtml(h.ultima.assunto || '(sem assunto)') +
              '<span class="cx-sub">' +
              escapeHtml(formatDateTime(h.ultima.recebidoEm)) +
              '</span></a></li>'
          )
          .join('') +
        '</ul></section>'
      : '') +
    '<section><h3>Atendimento</h3><dl>' +
    '<dt>Situação</dt><dd>' +
    escapeHtml(CAIXA_STATUS[status] || status) +
    (motivo && c.pendente ? '<span class="cx-sub">' + escapeHtml(motivo.label) + '</span>' : '') +
    '</dd>' +
    '<dt>Responsável</dt><dd>' +
    (c.atribuidoA ? escapeHtml(c.atribuidoA) : '<span class="cx-sub">Ninguém atribuído</span>') +
    '</dd>' +
    '<dt>Recebido</dt><dd>' +
    escapeHtml(formatDateTime(c.mensagens[0].recebidoEm)) +
    '</dd>' +
    (pen
      ? '<dt>Chamado</dt><dd><a class="cx-chamado" href="#" data-action="openPendencia" data-arg="' +
        escapeHtml(pen.id) +
        '">' +
        escapeHtml(pen.id) +
        ' · ' +
        escapeHtml(pen.title || pen.titulo || pen.assunto || '') +
        '</a></dd>'
      : '') +
    '</dl>' +
    (u.atribuicaoNota ? '<div class="cx-nota">' + escapeHtml(u.atribuicaoNota) + '</div>' : '') +
    '</section>' +
    '<section class="cx-lado-acoes"><h3>Ações</h3><div class="cx-acoes-ver">' +
    (pen
      ? '<button type="button" class="btn cx-btn" data-action="openPendencia" data-arg="' +
        escapeHtml(pen.id) +
        '">Abrir chamado</button>'
      : '<button type="button" class="btn cx-btn" data-action="caixaAbrirChamado" data-arg="' +
        id +
        '">Criar chamado</button>') +
    '<button type="button" class="btn cx-btn" data-action="caixaAtribuir" data-arg="' +
    id +
    '">' +
    (c.atribuidoA ? 'Transferir atendimento' : 'Assumir / atribuir') +
    '</button>' +
    '<button type="button" class="btn cx-btn" data-action="caixaVincular" data-arg="' +
    id +
    '">' +
    (cli ? 'Trocar cliente' : 'Vincular cliente') +
    '</button>' +
    (typeof wetqBotaoHTML === 'function' ? wetqBotaoHTML(c) : '') +
    '<button type="button" class="btn cx-btn" data-action="caixaMarcarNaoLida" data-arg="' +
    id +
    '">Marcar como não lida</button>' +
    (!c.encerrada
      ? '<button type="button" class="btn cx-btn" data-action="caixaEncerrar" data-arg="' +
        id +
        '">Encerrar conversa</button>'
      : '') +
    '<button type="button" class="btn cx-btn" data-action="caixaDescartar" data-arg="' +
    id +
    '">Descartar conversa</button>' +
    '</div></section></aside>';
  const eu = (typeof getUser === 'function' ? getUser() || {} : {}).name || '';
  const rasc =
    _caixaRascunho && _caixaRascunho.id === c.id ? _caixaRascunho : { texto: '', kind: 'reply' };
  const linhaInfo = whats
    ? '<span class="cx-comp-info">O cliente vê seu nome: <b>' +
      escapeHtml(eu || 'você') +
      '</b></span>'
    : '<span class="cx-comp-info">Para: ' +
      escapeHtml(_caixaEmailDe(quem.de)) +
      ' · Assunto: Re: ' +
      escapeHtml(u.assunto || 'Atendimento') +
      '</span>';
  const composer =
    '<form class="cx-composer" data-submit="caixaEnviarMensagem" data-arg="' +
    id +
    '" data-canal="' +
    (whats ? 'whatsapp' : 'email') +
    '">' +
    '<div class="cx-comp-top">' +
    linhaInfo +
    '<span class="cx-comp-grp"><select class="form-select" name="kind" data-change="caixaRascunhoTipo" aria-label="Tipo de mensagem">' +
    '<option value="reply"' +
    (rasc.kind === 'internal' ? '' : ' selected') +
    '>Responder</option>' +
    '<option value="internal"' +
    (rasc.kind === 'internal' ? ' selected' : '') +
    '>Nota interna</option></select>' +
    '<button type="button" class="btn cx-btn cx-rp" data-action="rpAbrir" aria-controls="rpPainel" aria-expanded="false">Respostas prontas</button></span>' +
    '</div>' +
    '<div class="cx-comp-row"><label class="btn cx-ic-btn" for="cxArquivo" aria-label="Anexar arquivo"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7"/></svg></label>' +
    '<input type="file" id="cxArquivo" name="file" class="cx-filehidden" accept="image/*,audio/*,.pdf,.txt,.zip" />' +
    '<textarea class="cx-tx" name="text" id="newNoteText" rows="' +
    (whats ? 1 : 4) +
    '" data-input="caixaRascunho" placeholder="' +
    (whats ? 'Escreva uma mensagem' : 'Escreva a resposta (Ctrl+Enter envia)') +
    '">' +
    escapeHtml(rasc.texto) +
    '</textarea>' +
    '<button type="submit" class="btn cx-btn cx-send" aria-label="Enviar"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m22 2-11 11"/><path d="m22 2-7 20-4-9-9-4z"/></svg></button></div>' +
    '<div id="rpPainel" hidden></div></form>';
  return (
    '<div class="cx-conv-topo">' +
    '<button type="button" class="btn cx-btn cx-voltar" data-action="caixaVoltar" aria-label="Voltar"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></button>' +
    '<span class="cx-av cx-av-lg" aria-hidden="true">' +
    escapeHtml(_caixaIniciais(nome)) +
    caixaFotoHTML(c) +
    _cxBadgeCanal(c.canal) +
    '</span>' +
    '<div class="cx-conv-id"><b>' +
    escapeHtml(nome) +
    '</b><span>' +
    escapeHtml((cli ? cli.name : '') + (cli ? ' · ' : '') + (whats ? 'WhatsApp' : 'E-mail')) +
    '</span>' +
    (typeof wetqConversaChipsHTML === 'function' ? wetqConversaChipsHTML(c, 4) : '') +
    '</div>' +
    '<span class="cx-conv-flex"></span>' +
    (pen
      ? '<button type="button" class="btn cx-btn" data-action="openPendencia" data-arg="' +
        escapeHtml(pen.id) +
        '">Chamado ' +
        escapeHtml(_cxChamadoCurto(pen.id)) +
        '</button>'
      : '<button type="button" class="btn cx-btn" data-action="caixaAbrirChamado" data-arg="' +
        id +
        '">Virar chamado</button>') +
    '<button type="button" class="btn cx-btn cx-ic-btn" data-action="cxDetalhes" aria-pressed="' +
    (_caixaDetalhesAberto ? 'true' : 'false') +
    '" aria-label="Detalhes"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></svg></button>' +
    '</div>' +
    '<div class="cx-conv-grade' +
    (_caixaDetalhesAberto ? '' : ' cx-det-fechado') +
    '"><div class="cx-conv-main"><div class="cx-timeline">' +
    (whats ? '' : '<h2 class="cx-subj">' + escapeHtml(u.assunto || '(sem assunto)') + '</h2>') +
    timeline +
    _caixaEnviandoHTML(c) +
    '</div>' +
    composer +
    '</div>' +
    lado +
    '</div>'
  );
}

// ---- Mensagem do WhatsApp: avatar ao lado da bolha -------------------------
// Como na página do chamado: cada fala tem o rosto de quem falou — a foto do
// contato à esquerda, a do colega à direita. Quem atende bate o olho e sabe
// quem disse o quê sem ler o nome de cada bolha.

// Falas seguidas da mesma pessoa, no mesmo dia e com pouco intervalo, viram um
// bloco só: repetir avatar e nome em cada "ok" / "obrigado" só faz ruído.
const CAIXA_GRUPO_MS = 10 * 60 * 1000;

function caixaMsgContinua(anterior, m) {
  if (!anterior || !m) return false;
  if ((anterior.direcao || 'entrada') !== (m.direcao || 'entrada')) return false;
  // Na entrada o "de" pode variar (nome do perfil ou número): é a mesma pessoa.
  if ((m.direcao || 'entrada') !== 'entrada' && String(anterior.de || '') !== String(m.de || ''))
    return false;
  const a = new Date(anterior.recebidoEm).getTime();
  const b = new Date(m.recebidoEm).getTime();
  if (isNaN(a) || isNaN(b)) return false;
  return b - a >= 0 && b - a <= CAIXA_GRUPO_MS;
}

// A resposta só guarda o nome de quem atendeu (conversa-responder grava "de"
// com op.name), então é pelo nome que se acha a foto.
function _caixaOperadorPorNome(nome) {
  const n = String(nome || '')
    .trim()
    .toLowerCase();
  if (!n || typeof getOperators !== 'function') return null;
  return (
    (getOperators() || []).find(
      (o) =>
        String((o && o.name) || '')
          .trim()
          .toLowerCase() === n
    ) || null
  );
}

// O WhatsApp leva "Nome: texto" para o cliente saber quem respondeu, e o
// histórico grava igual. Com o nome no topo da bolha, o prefixo só repetiria.
function caixaCorpoSemAtendente(corpo, de) {
  const n = String(de || '').trim();
  const s = String(corpo || '');
  return n && s.startsWith(n + ': ') ? s.slice(n.length + 2) : s;
}

const _CAIXA_ICO_BOT =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 4v4M9 13v2M15 13v2"/></svg>';

function caixaAvatarMsgHTML(c, m, nome) {
  const direcao = (m && m.direcao) || 'entrada';
  if (direcao === 'entrada') {
    return (
      '<span class="cx-av cx-av-sm" aria-hidden="true">' +
      escapeHtml(_caixaIniciais(nome)) +
      caixaFotoHTML(c) +
      '</span>'
    );
  }
  if (m.de === CAIXA_AUTOR_BOT) {
    return (
      '<span class="cx-av cx-av-sm cx-av-bot" aria-hidden="true">' + _CAIXA_ICO_BOT + '</span>'
    );
  }
  const op = _caixaOperadorPorNome(m.de);
  // opFotoSegura só deixa passar data URL raster: SVG poderia carregar script.
  const foto = op && typeof opFotoSegura === 'function' ? opFotoSegura(op.photo) : '';
  const corBruta =
    (op && op.color) || (typeof getOpAvatarColor === 'function' ? getOpAvatarColor(nome) : '');
  const cor = /^#[0-9a-f]{3,8}$/i.test(String(corBruta || '')) ? corBruta : '';
  return (
    '<span class="cx-av cx-av-sm cx-av-eq"' +
    (cor ? ' data-sty="--cx-av-cor:' + escapeHtml(cor) + '"' : '') +
    ' aria-hidden="true">' +
    escapeHtml(_caixaIniciais(nome)) +
    (foto
      ? '<img class="cx-av-img" src="' + escapeHtml(foto) + '" alt="" draggable="false" />'
      : '') +
    '</span>'
  );
}

function _caixaMsgWhatsHTML(c, m, continua) {
  const direcao = m.direcao || 'entrada';
  const bot = direcao === 'saida' && m.de === CAIXA_AUTOR_BOT;
  const lado = direcao === 'interna' ? 'nota' : direcao === 'saida' ? 'out' : 'in';
  const nome =
    direcao === 'entrada'
      ? _caixaNomeDe(m, c.canal)
      : String(m.de || '').trim() || (direcao === 'interna' ? 'Equipe' : 'Você');
  const hora = escapeHtml(_caixaHora(m.recebidoEm) || formatDateTime(m.recebidoEm));
  const corpo = direcao === 'saida' && !bot ? caixaCorpoSemAtendente(m.corpo, m.de) : m.corpo;
  // O selo do robô continua no lugar do nome: quem atende precisa saber que
  // aquilo foi o atendimento automático e não um colega.
  const autor = bot
    ? '<b class="cx-bubble-bot-tag">' + escapeHtml(CAIXA_AUTOR_BOT) + '</b>'
    : '<b class="cx-bubble-autor">' + escapeHtml(nome) + '</b>';
  const topo = continua
    ? ''
    : '<div class="cx-bubble-topo">' +
      autor +
      (direcao === 'interna' ? '<span class="cx-bubble-nota-tag">Nota interna</span>' : '') +
      '<span class="cx-bubble-hora">' +
      hora +
      '</span></div>';
  return (
    '<div class="cx-msg cx-msg-' +
    lado +
    (continua ? ' cx-msg-cont' : '') +
    '">' +
    (continua
      ? '<span class="cx-av-vazio" aria-hidden="true"></span>'
      : caixaAvatarMsgHTML(c, m, nome)) +
    '<div class="cx-bubble cx-bubble-' +
    lado +
    '">' +
    topo +
    _caixaCorpoHTML(corpo, c.canal) +
    _caixaMediaHTML(m.media) +
    (continua ? '<small>' + hora + '</small>' : '') +
    '</div></div>'
  );
}

// Só estes tipos viram <img>/<audio>; o resto é baixado como binário. O tipo
// vem do remetente (WAHA ou anexo do operador): SVG e HTML embutidos em
// data: URL abririam conteúdo ativo se o navegador deixasse navegar até eles.
const CAIXA_MIDIA_IMAGEM = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const CAIXA_MIDIA_AUDIO = [
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
  'audio/webm',
  'audio/wav',
  'audio/amr',
];

function _caixaMidiaTipo(bruto) {
  // WhatsApp manda 'audio/ogg; codecs=opus': o que importa é o tipo base.
  const base = String(bruto || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (CAIXA_MIDIA_IMAGEM.includes(base) || CAIXA_MIDIA_AUDIO.includes(base)) return base;
  return 'application/octet-stream';
}

function _caixaMediaHTML(media) {
  if (!media || typeof media !== 'object') return '';
  const nome = String(media.nome || media.filename || 'Anexo');
  const tipo = _caixaMidiaTipo(media.tipo || media.mimetype);
  const url = media.dados
    ? 'data:' + tipo + ';base64,' + String(media.dados).replace(/[^A-Za-z0-9+/=]/g, '')
    : String(media.url || '');
  if (!/^https?:\/\//.test(url) && !url.startsWith('data:'))
    return '<div class="cx-anexo">' + escapeHtml(nome) + '</div>';
  const seguro = escapeHtml(url);
  if (tipo.startsWith('image/'))
    return (
      '<a href="' +
      seguro +
      '" target="_blank" rel="noopener noreferrer"><img class="cx-imagem" src="' +
      seguro +
      '" alt="' +
      escapeHtml(nome) +
      '"></a>'
    );
  if (tipo.startsWith('audio/'))
    return '<audio class="cx-audio" controls preload="none" src="' + seguro + '"></audio>';
  return (
    '<a class="cx-anexo" href="' +
    seguro +
    '" target="_blank" rel="noopener noreferrer" download="' +
    escapeHtml(nome) +
    '">Baixar ' +
    escapeHtml(nome) +
    '</a>'
  );
}

function _caixaEmailDe(de) {
  const m = /<([^>]+)>/.exec(de || '');
  return m ? m[1] : de || '';
}

// Foto de perfil do contato (WhatsApp). A URL é gravada pelo webhook, mas só
// https entra no <img>: ela vai para o atributo src de quem atende.
//
// A URL do CDN do WhatsApp é assinada e vence (o `oe` é a validade, em segundos
// hexadecimais), e o webhook só a renova quando o contato manda mensagem de
// novo. Conversa parada fica com URL vencida: o Chrome desenhava o ícone de
// imagem quebrada por cima das iniciais, porque o <img> tem tamanho fixo.
// Vencida, nem entra; se falhar mesmo assim, _caixaFotoFalhou a remove.
function caixaFotoVencida(url, agora) {
  const m = /[?&]oe=([0-9A-Fa-f]{6,10})(?:&|$)/.exec(String(url || ''));
  if (!m) return false;
  return parseInt(m[1], 16) * 1000 <= (agora == null ? Date.now() : agora);
}

function caixaFotoHTML(conversa, agora) {
  const url = String((conversa && conversa.fotoUrl) || '').trim();
  if (!/^https:\/\/[^\s"'<>]+$/.test(url) || url.length > 1000) return '';
  if (caixaFotoVencida(url, agora)) return '';
  return (
    '<img class="cx-av-img" src="' +
    escapeHtml(url) +
    '" alt="" loading="lazy" referrerpolicy="no-referrer" draggable="false" />'
  );
}

// Evento de erro de <img> não sobe na árvore: só na captura dá para ouvir num
// lugar só (e a CSP não deixa usar onerror inline). Sem a imagem, as iniciais
// que estão por baixo aparecem.
function _caixaFotoFalhou(ev) {
  const img = ev && ev.target;
  if (img && img.classList && img.classList.contains('cx-av-img')) img.remove();
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('error', _caixaFotoFalhou, true);
}

function _caixaIniciais(nome) {
  const partes = String(nome || '?')
    .replace(/[<>"@].*$/, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!partes.length) return '?';
  return (
    (partes[0][0] || '') + (partes.length > 1 ? partes[partes.length - 1][0] : '')
  ).toUpperCase();
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
  return d && !isNaN(d)
    ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : '';
}

// O que chega é e-mail cru: citação da resposta anterior e assinatura repetem
// o que a timeline já mostra, então saem. Corpo continua texto escapado — e-mail
// é a entrada mais hostil do app; só URL http(s) vira link, também escapada.
function _caixaCorpoHTML(corpo, canal) {
  const limpo = caixaCorpoLimpo(corpo, canal);
  return (
    '<div class="cx-corpo">' +
    _caixaLinkificar(limpo.texto) +
    '</div>' +
    (limpo.assinatura
      ? '<details class="cx-assinatura"><summary>Assinatura</summary><div class="cx-corpo">' +
        _caixaLinkificar(limpo.assinatura) +
        '</div></details>'
      : '')
  );
}

function _caixaLinkificar(texto) {
  return texto
    .split(/(<?https?:\/\/[^\s<>"]+>?)/g)
    .map((p, i) => {
      if (i % 2 === 0) return escapeHtml(p);
      const url = p.replace(/^</, '').replace(/>$/, '');
      let rotulo = url;
      try {
        rotulo = new URL(url).hostname;
      } catch (_e) {
        /* fica a URL inteira */
      }
      return (
        '<a href="' +
        escapeHtml(url) +
        '" target="_blank" rel="noopener noreferrer">' +
        escapeHtml(rotulo) +
        '</a>'
      );
    })
    .join('');
}

function renderCaixaEntrada() {
  const titulo = document.getElementById('pageTitle');
  if (titulo) titulo.textContent = 'Caixa de entrada';
  const area = document.getElementById('contentArea');
  if (!area) return;
  if (!document.getElementById('caixaLista')) {
    area.innerHTML =
      '<div class="cx" id="caixaTela"><div class="cx-list-panel"><div class="cx-lh">' +
      '<div class="cx-search-wrap"><svg class="cx-search-ic" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
      '<input class="cx-search" id="caixaBusca" type="search" placeholder="Buscar por nome, assunto ou telefone…" value="' +
      escapeHtml(_caixaBusca) +
      '" data-input="caixaBusca" aria-label="Buscar" /></div>' +
      '<div class="cx-chips" id="caixaCanalChips" role="group" aria-label="Canal"></div>' +
      '<div class="cx-tabs" id="caixaTabs" role="tablist" aria-label="Situação"></div></div>' +
      '<div class="cx-cards" id="caixaLista"></div></div>' +
      '<section class="cx-main" id="caixaConversa"></section></div>';
  }
  const usuario = (getUser() || {}).name || '';
  const todas = _caixaConversas();
  // A contagem por situação respeita o canal: "Aguardando (3)" com WhatsApp
  // escolhido tem que ser 3 conversas de WhatsApp.
  let doCanal = caixaFiltrarCanal(todas, _caixaCanal);
  // Etiqueta (089) recorta junto com o canal: as contagens seguem o filtro.
  if (typeof wetqFiltrarConversas === 'function') doCanal = wetqFiltrarConversas(doCanal);
  const visiveis = caixaFiltrar(doCanal, _caixaFiltro, _caixaBusca, usuario);
  // Toolbar não é remontada (perderia o foco da busca), então só as contagens
  // e os estados ativo/inativo das chips e abas são atualizados.
  const contagem = caixaContarFiltros(doCanal, usuario);
  const chips = [
    ['todos', 'Todos', null],
    [
      'email',
      'E-mail',
      '<path d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/><path d="m3 7 9 6 9-6"/>',
    ],
    [
      'whatsapp',
      'WhatsApp',
      '<path d="M21 11.5a8.5 8.5 0 0 1-12.6 7.4L3 20l1.2-5A8.5 8.5 0 1 1 21 11.5z"/>',
    ],
  ];
  const chipsHtml = chips
    .map(
      ([k, l, svg]) =>
        '<button type="button" class="chip' +
        (k === _caixaCanal ? ' on' : '') +
        '" data-action="caixaCanal" data-arg="' +
        k +
        '" aria-pressed="' +
        (k === _caixaCanal) +
        '">' +
        (svg
          ? '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            svg +
            '</svg>'
          : '') +
        escapeHtml(l) +
        '</button>'
    )
    .join('');
  const chipsBox = document.getElementById('caixaCanalChips');
  if (chipsBox)
    chipsBox.innerHTML = chipsHtml + (typeof wetqFiltroHTML === 'function' ? wetqFiltroHTML() : '');
  const tabs = Object.keys(CAIXA_FILTROS)
    .map(
      (k) =>
        '<button type="button" class="tab' +
        (k === _caixaFiltro ? ' on' : '') +
        '" role="tab" aria-selected="' +
        (k === _caixaFiltro) +
        '" data-action="caixaFiltro" data-arg="' +
        k +
        '">' +
        escapeHtml(CAIXA_FILTROS[k]) +
        ' <span class="cx-tab-n">' +
        (contagem[k] || 0) +
        '</span></button>'
    )
    .join('');
  const tabsBox = document.getElementById('caixaTabs');
  if (tabsBox) tabsBox.innerHTML = tabs;
  // Abrir a conversa conta como ler; marcar antes de desenhar a lista evita o
  // ponto de não lida piscando no item que acabou de ser clicado.
  const sel = _caixaSelecionada ? todas.find((c) => c.id === _caixaSelecionada) : null;
  if (sel && caixaNaoLida(sel, _caixaLidas())) _caixaMarcar(sel, true);
  const lidas = _caixaLidas();
  const lista = document.getElementById('caixaLista');
  const vazio = _caixaBusca
    ? 'Nada encontrado para "' + escapeHtml(_caixaBusca) + '".'
    : _caixaFiltro === 'pendentes'
      ? 'Nada aguardando decisão. Tudo em dia.'
      : _caixaFiltro === 'minhas'
        ? 'Nenhuma conversa atribuída a você.'
        : 'Nenhuma conversa ainda.';
  lista.innerHTML = visiveis.length
    ? visiveis.map((c) => _caixaItemHTML(c, lidas)).join('')
    : '<div class="cx-lista-vazia"><p>' +
      vazio +
      '</p>' +
      (_caixaFiltro !== 'todas'
        ? '<button type="button" class="btn cx-btn" data-action="caixaFiltro" data-arg="todas">Ver todas</button>'
        : '') +
      '</div>';

  // A selecionada pode ter saído do filtro (foi descartada, por exemplo):
  // continua aberta, para o técnico ver o resultado do que acabou de fazer.
  const conv = document.getElementById('caixaConversa');
  const naoLidas = visiveis.filter((c) => caixaNaoLida(c, lidas)).length;
  const antes = _caixaCapturarConversa(conv);
  conv.innerHTML = sel
    ? _caixaConversaHTML(sel)
    : '<div class="cx-empty"><div class="cx-empty-ic"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/></svg></div>' +
      '<b>Escolha uma conversa</b>' +
      '<p class="cx-empty-sub">' +
      (naoLidas
        ? naoLidas + (naoLidas > 1 ? ' mensagens não lidas.' : ' mensagem não lida.')
        : 'Tudo lido neste filtro.') +
      '</p></div>';
  _caixaRestaurarConversa(conv, antes, sel);
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
  openModal(
    c.atribuidoA ? 'Transferir conversa' : 'Atribuir conversa',
    '<form data-submit="caixaAtribuirSalvar" data-arg="' +
      escapeHtml(c.id) +
      '">' +
      '<div class="form-group"><label class="form-label">Para *</label><select class="form-select" name="para" required><option value="">—</option>' +
      ops
        .map(
          (n) =>
            '<option' + (n === c.atribuidoA ? ' selected' : '') + '>' + escapeHtml(n) + '</option>'
        )
        .join('') +
      '</select></div>' +
      '<div class="form-group"><label class="form-label">Nota' +
      (c.atribuidoA ? ' (obrigatória ao transferir)' : '') +
      '</label>' +
      '<textarea class="form-textarea" name="nota" rows="3"></textarea></div>' +
      '<div class="form-actions"><button type="button" class="btn btn-secondary" data-action="closeModal">Cancelar</button>' +
      '<button type="submit" class="btn btn-primary">Salvar</button></div></form>'
  );
}

function caixaAtribuirSalvar(id, para, nota) {
  const c = _caixaConversaPorId(id);
  if (!c) return false;
  const erro = caixaValidarAtribuicao(c, para, nota);
  if (erro) {
    showToast(erro, 'error');
    return false;
  }
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
  openModal(
    'Vincular cliente',
    '<form data-submit="caixaVincularSalvar" data-arg="' +
      escapeHtml(c.id) +
      '">' +
      '<div class="form-group"><label class="form-label">Cliente *</label><select class="form-select" name="clientId" required><option value="">—</option>' +
      clientes
        .map(
          (cl) =>
            '<option value="' +
            escapeHtml(cl.id) +
            '"' +
            (cl.id === c.clientId ? ' selected' : '') +
            '>' +
            escapeHtml(cl.name) +
            '</option>'
        )
        .join('') +
      '</select></div>' +
      '<p class="ov-muted">O remetente fica aprendido: o próximo e-mail dele já chega com o cliente.</p>' +
      '<div class="form-actions"><button type="button" class="btn btn-secondary" data-action="closeModal">Cancelar</button>' +
      '<button type="submit" class="btn btn-primary">Vincular</button></div></form>'
  );
}

function caixaVincularSalvar(id, clientId) {
  const c = _caixaConversaPorId(id);
  const cli = clientId && typeof getClientById === 'function' ? getClientById(clientId) : null;
  if (!c || !cli) {
    showToast('Escolha um cliente.', 'error');
    return false;
  }
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
    assunto: String(e.assunto || 'WhatsApp de ' + (nome || tel)).slice(0, 120),
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
  const recebidas = c.mensagens.filter((m) => (m.direcao || 'entrada') === 'entrada');
  if (!recebidas.length || c.pendenciaId) {
    showToast('Esta conversa já tem um chamado.', 'error');
    renderCaixaEntrada();
    return;
  }
  const e = recebidas[recebidas.length - 1];
  if (c.canal !== 'whatsapp') {
    emailTriagemAbrirChamado(e.id);
    return;
  }
  if (typeof openPendenciaForm !== 'function') return;
  openPendenciaForm(null, e.clientId || c.clientId || null, null, caixaPrefillWhatsapp(c, e));
}

function caixaDescartar(id) {
  const c = _caixaConversaPorId(id);
  if (!c) return;
  // Mesma regra do caixaEncerrar: só o que está em aberto ('pendente' ou
  // 'anexado') muda, mais a última mensagem do cliente, que é a que define o
  // estado da conversa. Filtrar só 'pendente' fazia o botão não fazer nada em
  // conversa com chamado aberto (mensagens 'anexado') ou já encerrada.
  const ultima = c.ultimaEntrada;
  const alvos = c.mensagens
    .filter((m) => m.status === 'pendente' || m.status === 'anexado' || m === ultima)
    .filter((m) => m.status !== 'descartado' && m.status !== 'virou_chamado')
    .map((m) => ({ id: m.id, status: m.status }));
  if (!alvos.length) {
    showToast('Não há mensagem em aberto para descartar nesta conversa.', 'error');
    return;
  }
  alvos.forEach((a) => _emailTriagemSalvar(a.id, { status: 'descartado' }));
  _emailTriagemRedesenhar();
  showUndoToast('Conversa descartada.', () => {
    alvos.forEach((a) => _emailTriagemSalvar(a.id, { status: a.status }));
    _emailTriagemRedesenhar();
  });
}

// ── Composer fluido: envio otimista, rolagem e foco ──────────────────────────

// A mensagem otimista some quando a de verdade chega pelo sync. Sem isto as
// duas apareciam juntas entre o sync e o fim do envio. A folga de 2 minutos
// cobre relógio do servidor diferente do da máquina.
function caixaEnvioJaChegou(c, item) {
  const desde = new Date(new Date(item.desde).getTime() - 2 * 60 * 1000).toISOString();
  const direcao = item.kind === 'internal' ? 'interna' : 'saida';
  return (c.mensagens || []).some(
    (m) =>
      (m.direcao || 'entrada') === direcao &&
      String(m.corpo || '').trim() === item.texto &&
      _caixaData(m) >= desde
  );
}

function _caixaEnviandoHTML(c) {
  const itens = _caixaEnviando.filter((it) => it.conv === c.id && !caixaEnvioJaChegou(c, it));
  if (!itens.length) return '';
  const whats = c.canal === 'whatsapp';
  const eu = (typeof getUser === 'function' ? getUser() || {} : {}).name || '';
  return itens
    .map((it) => {
      const nota = it.kind === 'internal';
      const corpo =
        (it.texto ? '<div class="cx-corpo">' + escapeHtml(it.texto) + '</div>' : '') +
        (it.arquivo ? '<div class="cx-corpo">📎 ' + escapeHtml(it.arquivo) + '</div>' : '');
      const status = '<small class="cx-enviando-st">Enviando…</small>';
      if (whats) {
        const lado = nota ? 'nota' : 'out';
        return (
          '<div class="cx-msg cx-msg-' +
          lado +
          ' cx-enviando">' +
          caixaAvatarMsgHTML(c, { direcao: nota ? 'interna' : 'saida', de: eu }, eu || 'Você') +
          '<div class="cx-bubble cx-bubble-' +
          lado +
          '"><div class="cx-bubble-topo"><b class="cx-bubble-autor">' +
          escapeHtml(eu || 'Você') +
          '</b>' +
          (nota ? '<span class="cx-bubble-nota-tag">Nota interna</span>' : '') +
          '</div>' +
          corpo +
          status +
          '</div></div>'
        );
      }
      return (
        '<article class="cx-em cx-enviando ' +
        (nota ? 'cx-em-nota' : 'cx-em-out') +
        '"><div class="cx-em-eb">' +
        corpo +
        '</div>' +
        status +
        '</article>'
      );
    })
    .join('');
}

// Antes de trocar o HTML da conversa: em que ponto a pessoa estava lendo e se
// estava escrevendo. Sem isto todo redesenho (sync, realtime, envio) jogava a
// conversa para o topo e tirava o foco do campo.
function _caixaCapturarConversa(conv) {
  if (!conv || typeof conv.querySelector !== 'function') return null;
  const tl = conv.querySelector('.cx-timeline');
  const tx = conv.querySelector('.cx-tx');
  const ativo = typeof document !== 'undefined' ? document.activeElement : null;
  return {
    id: (conv.dataset && conv.dataset.cxConv) || null,
    // Perto do fim conta como no fim: é quem está acompanhando a conversa.
    noFim: !tl || tl.scrollHeight - tl.scrollTop - tl.clientHeight < 60,
    topo: tl ? tl.scrollTop : 0,
    foco: !!tx && ativo === tx,
    inicio: tx && typeof tx.selectionStart === 'number' ? tx.selectionStart : null,
    fim: tx && typeof tx.selectionEnd === 'number' ? tx.selectionEnd : null,
  };
}

function _caixaRolarFim(tl) {
  tl.scrollTop = tl.scrollHeight;
}

function _caixaRestaurarConversa(conv, antes, sel) {
  if (!conv || typeof conv.querySelector !== 'function') return;
  if (conv.dataset) conv.dataset.cxConv = sel ? sel.id : '';
  if (!sel) return;
  const mesma = !!antes && antes.id === sel.id;
  const tl = conv.querySelector('.cx-timeline');
  if (tl) {
    if (mesma && !antes.noFim) {
      tl.scrollTop = antes.topo;
    } else {
      // Conversa aberta agora ou acompanhada no fim: a última mensagem fica à
      // vista. Imagem decodifica depois e empurra o fim para baixo, então rola
      // de novo quando cada uma terminar de carregar.
      _caixaRolarFim(tl);
      tl.querySelectorAll('img').forEach((img) => {
        if (!img.complete) img.addEventListener('load', () => _caixaRolarFim(tl), { once: true });
      });
    }
  }
  const tx = conv.querySelector('.cx-tx');
  if (!tx) return;
  _caixaAjustarAltura(tx);
  const focar = _caixaFocarComposer || (mesma && antes.foco);
  _caixaFocarComposer = false;
  if (!focar) return;
  tx.focus({ preventScroll: true });
  if (mesma && antes.foco && antes.inicio !== null) {
    try {
      tx.setSelectionRange(antes.inicio, antes.fim);
    } catch (_e) {
      /* campo sem cursor */
    }
  }
}

// O campo cresce com o texto até o max-height do CSS, como no WhatsApp; com
// rows fixo a mensagem longa virava uma linha com barra de rolagem.
function _caixaAjustarAltura(tx) {
  if (!tx || !tx.style || typeof tx.scrollHeight !== 'number') return;
  tx.style.height = 'auto';
  tx.style.height = tx.scrollHeight + 2 + 'px';
}

/**
 * Pura: a tecla envia a mensagem? No WhatsApp é Enter (Shift+Enter quebra a
 * linha), como no app; no e-mail, onde parágrafo é a regra, só Ctrl/Cmd+Enter.
 * Durante composição de IME (acento, teclado asiático) o Enter confirma o
 * caractere e não pode enviar.
 */
function caixaTeclaEnvia(ev, canal) {
  if (!ev || ev.key !== 'Enter' || ev.isComposing || ev.keyCode === 229) return false;
  if (ev.altKey) return false;
  if (canal === 'whatsapp') return !ev.shiftKey;
  return !!(ev.ctrlKey || ev.metaKey) && !ev.shiftKey;
}

function _caixaTeclaComposer(ev) {
  const tx = ev.target;
  if (!tx || !tx.classList || !tx.classList.contains('cx-tx')) return;
  const form = tx.closest ? tx.closest('.cx-composer') : null;
  if (!form || !caixaTeclaEnvia(ev, form.dataset.canal)) return;
  ev.preventDefault();
  // Segurar o Enter não pode virar uma rajada de envios iguais.
  if (ev.repeat) return;
  if (typeof form.requestSubmit === 'function') form.requestSubmit();
  else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('keydown', _caixaTeclaComposer);
}

function _caixaLimparComposer(form) {
  if (!form || typeof form.querySelector !== 'function') return;
  const tx = form.querySelector('textarea[name="text"]');
  if (tx) {
    tx.value = '';
    _caixaAjustarAltura(tx);
  }
  const arq = form.querySelector('input[type="file"]');
  if (arq) arq.value = '';
}

/**
 * Envia a resposta ou nota da conversa. O campo limpa e a mensagem aparece na
 * hora (otimista); o servidor confirma em segundo plano, na fila. Se falhar, o
 * texto volta para o campo para a pessoa não ter de redigitar.
 */
async function caixaEnviarMensagem(id, form) {
  const c = _caixaConversaPorId(id);
  if (!c || !window._supabaseAuthActive) {
    showToast('Conecte-se ao Supabase para responder.', 'error');
    return;
  }
  const fd = new FormData(form);
  const texto = String(fd.get('text') || '').trim();
  const arquivo = fd.get('file');
  const temArquivo = !!(arquivo && arquivo.size);
  if (!texto && !temArquivo) {
    showToast('Escreva uma mensagem ou escolha um arquivo.', 'error');
    return;
  }
  if (temArquivo && arquivo.size > 5 * 1024 * 1024) {
    showToast('O arquivo deve ter no máximo 5 MB.', 'error');
    return;
  }
  const kind = fd.get('kind') === 'internal' ? 'internal' : 'reply';
  const item = {
    seq: ++_caixaEnvioSeq,
    conv: c.id,
    texto,
    kind,
    arquivo: temArquivo ? String(arquivo.name || 'Anexo') : '',
    desde: new Date().toISOString(),
  };
  _caixaEnviando.push(item);
  _caixaLimparComposer(form);
  // O tipo fica: quem está escrevendo notas internas segue nelas.
  _caixaRascunho = { id: null, texto: '', kind };
  if (typeof fecharRespostasProntas === 'function') fecharRespostasProntas();
  _caixaFocarComposer = true;
  _emailTriagemRedesenhar();
  const envio = _caixaFilaEnvio.then(() =>
    _caixaEnviarAoServidor(c, item, temArquivo ? arquivo : null)
  );
  _caixaFilaEnvio = envio.catch(() => {});
  return envio;
}

async function _caixaEnviarAoServidor(c, item, arquivo) {
  let ok = false;
  try {
    let file = null;
    if (arquivo) {
      const dados = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
        reader.onerror = reject;
        reader.readAsDataURL(arquivo);
      });
      file = { nome: arquivo.name, tipo: arquivo.type || 'application/octet-stream', dados };
    }
    const res = await supabaseClient.functions.invoke('conversa-responder', {
      body: { thread_id: caixaThreadId(c), text: item.texto, kind: item.kind, file },
    });
    let codigo = '';
    let msg = (res.data && res.data.error) || '';
    if (res.error) {
      // Status não-2xx chega como FunctionsHttpError com o corpo ainda no
      // Response: sem lê-lo, o operador só via "non-2xx status code".
      try {
        const ctx = res.error.context;
        if (ctx && typeof ctx.json === 'function') {
          const corpo = (await ctx.json()) || {};
          codigo = corpo.code || '';
          msg = corpo.error || msg;
        }
      } catch (_e) {
        if (typeof _logSilent === 'function') _logSilent(_e, 'conversa-responder');
      }
      // A resposta já chegou ao cliente; só o histórico falhou. Tratar como erro
      // comum levava o operador a reenviar e o cliente recebia duas vezes.
      if (codigo === 'history_write' && item.kind !== 'internal') {
        ok = true;
        showToast(
          'Resposta enviada ao cliente, mas não ficou no histórico. Não reenvie.',
          'warning'
        );
        return;
      }
      throw new Error(msg || res.error.message || 'erro de conexão');
    }
    if (msg) throw new Error(msg);
    ok = true;
  } catch (err) {
    showToast(
      'Não foi possível concluir: ' + String((err && err.message) || 'erro de conexão'),
      'error'
    );
    // Devolve o texto ao campo, mas só se a pessoa não começou outra mensagem
    // nesta conversa: sobrescrever o que ela está digitando seria pior.
    const livre = !_caixaRascunho.texto || _caixaRascunho.id !== c.id;
    if (item.texto && livre) _caixaRascunho = { id: c.id, texto: item.texto, kind: item.kind };
  } finally {
    // Com sucesso, o sync traz a mensagem de verdade antes de a otimista sair:
    // assim ela não some e reaparece. Na falha, sai já.
    if (ok && typeof syncSupabaseToLocal === 'function') {
      try {
        await syncSupabaseToLocal();
      } catch (_e) {
        /* o próximo sync traz */
      }
    }
    _caixaEnviando = _caixaEnviando.filter((x) => x !== item);
    _emailTriagemRedesenhar();
  }
}

// Encerrar mexe só no que está em aberto. 'virou_chamado' e 'descartado' são
// decisões já tomadas sobre aquela mensagem e somem do histórico se
// sobrescritas. A última mensagem do cliente é exceção: é ela que diz se a
// conversa está encerrada (caixaAgruparConversas), então sempre leva o status.
function caixaEncerrar(id) {
  const c = _caixaConversaPorId(id);
  if (!c) return;
  const ultima = c.ultimaEntrada;
  c.mensagens.forEach((m) => {
    const aberta = m.status === 'pendente' || m.status === 'anexado';
    if (aberta || m === ultima) _emailTriagemSalvar(m.id, { status: 'encerrado' });
  });
  _emailTriagemRedesenhar();
  showToast('Conversa encerrada. Uma nova mensagem do cliente reabre o atendimento.', 'success');
}

registerActions({
  // Alternar painel de detalhes (mockup) e expandir cartão de e-mail antigo.
  cxDetalhes: () => {
    _caixaDetalhesAberto = !_caixaDetalhesAberto;
    renderCaixaEntrada();
  },
  caixaExpandir: (_el, i) => {
    const c = _caixaConversas().find((x) => x.id === _caixaSelecionada);
    if (!c) return;
    const k = parseInt(i, 10);
    const m = (_caixaExpand[c.id] = _caixaExpand[c.id] || {});
    m[k] = !m[k];
    renderCaixaEntrada();
  },
  caixaSelecionar: (_el, id) => {
    _caixaSelecionada = id || null;
    renderCaixaEntrada();
  },
  caixaVoltar: () => {
    _caixaSelecionada = null;
    renderCaixaEntrada();
  },
  caixaBusca: (_el, v) => {
    _caixaBusca = v || '';
    renderCaixaEntrada();
  },
  caixaFiltro: (_el, v) => {
    _caixaFiltro = CAIXA_FILTROS[v] ? v : 'pendentes';
    renderCaixaEntrada();
  },
  caixaCanal: (_el, v) => {
    _caixaCanal = CAIXA_CANAIS[v] ? v : 'todos';
    renderCaixaEntrada();
  },
  caixaAtribuir: (_el, id) => caixaAtribuir(id),
  caixaAtribuirSalvar: (el, id) => {
    const fd = new FormData(el);
    if (caixaAtribuirSalvar(id, String(fd.get('para') || ''), String(fd.get('nota') || ''))) {
      closeModal();
      _emailTriagemRedesenhar();
    }
  },
  caixaVincular: (_el, id) => caixaVincular(id),
  caixaVincularSalvar: (el, id) => {
    const fd = new FormData(el);
    if (caixaVincularSalvar(id, String(fd.get('clientId') || ''))) {
      closeModal();
      _emailTriagemRedesenhar();
    }
  },
  caixaAbrirChamado: (_el, id) => caixaAbrirChamado(id),
  caixaDescartar: (_el, id) => caixaDescartar(id),
  caixaEncerrar: (_el, id) => caixaEncerrar(id),
  caixaEnviarMensagem: (el, id) => {
    caixaEnviarMensagem(id, el);
  },
  // Guardar a cada tecla é o que sobrevive ao redesenho disparado pelo sync.
  caixaRascunho: (el, texto) => {
    _caixaAjustarAltura(el);
    _caixaRascunho = {
      id: _caixaSelecionada,
      texto: String(texto || ''),
      kind: _caixaRascunho.kind || 'reply',
    };
  },
  caixaRascunhoTipo: (_el, tipo) => {
    _caixaRascunho = {
      id: _caixaSelecionada,
      texto: _caixaRascunho.texto || '',
      kind: tipo === 'internal' ? 'internal' : 'reply',
    };
  },
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
