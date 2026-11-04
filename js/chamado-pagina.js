// chamado-pagina.js: tela de chamado de canal externo (#chamados/<id>).
// Os fluxos de envio, transferência e sessões continuam em js/chamado-detalhe.js:
// a página só desenha o mesmo contrato de ids que o modal antigo lê (#newNoteText,
// #chamadoNotaTexto, #chdTransferPara, #chdTransferMotivo, #chamadoMencaoLista),
// para que exista um único caminho de gravação e de envio ao solicitante.

// Anexo é gravado por pendência, sem vínculo com a mensagem. Cinco minutos cobrem
// quem anexa e depois termina de escrever, sem colar o arquivo em conversa de outra hora.
const CHP_JANELA_ANEXO_MS = 5 * 60 * 1000;

const CHP_ICONES = {
  email: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  whatsapp: '<path d="M21 12a8.5 8.5 0 0 1-12.6 7.4L3 21l1.6-5.4A8.5 8.5 0 1 1 21 12Z"/>',
  cadeado: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  clipe: '<path d="m21 11-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l9-9a3.7 3.7 0 0 1 5.2 5.2l-9 9a1.8 1.8 0 0 1-2.6-2.6l8.3-8.3"/>',
  compartilhar: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  transferir: '<path d="M4 8h14"/><path d="m14 4 4 4-4 4"/><path d="M20 16H6"/><path d="m10 12-4 4 4 4"/>',
  play: '<path d="M7 4.5v15l12-7.5Z"/>',
  pausa: '<path d="M8 5v14"/><path d="M16 5v14"/>',
  arquivo: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/>',
};

function chpIcone(nome) {
  return '<svg class="chp-ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"'
    + ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'
    + (CHP_ICONES[nome] || '') + '</svg>';
}

// ---- Datas -------------------------------------------------------------------

function _chpMs(iso) {
  return iso ? Date.parse(iso) : NaN;
}

function _chpFormatar(iso, locale, opcoes) {
  const ms = _chpMs(iso);
  if (!Number.isFinite(ms)) return '';
  // O fuso é o da empresa, não o do navegador: o divisor de data tem de bater para toda a equipe.
  const fuso = typeof APP_TIME_ZONE === 'string' ? APP_TIME_ZONE : 'America/Sao_Paulo';
  return new Date(ms).toLocaleString(locale, Object.assign({ timeZone: fuso }, opcoes));
}

function _chpHora(iso) {
  return _chpFormatar(iso, 'pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function chpDiaRotulo(iso) {
  return _chpFormatar(iso, 'pt-BR', { day: '2-digit', month: '2-digit' });
}

// O rótulo não tem ano; a chave tem, para 30/10 de anos diferentes não virarem um dia só.
function _chpChaveDia(iso) {
  return _chpFormatar(iso, 'en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function _chpDataHora(iso) {
  const data = _chpFormatar(iso, 'pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return data ? data + ' às ' + _chpHora(iso) : '';
}

// `deadline` pode ser só "aaaa-mm-dd": passar por Date.parse leria UTC e recuaria um dia.
function _chpDataPrazo(valor) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(valor || ''));
  return m ? m[3] + '/' + m[2] + '/' + m[1] : '';
}

function _chpTimeHtml(iso) {
  const hora = _chpHora(iso);
  return hora ? '<time datetime="' + escapeHtml(iso) + '">' + escapeHtml(hora) + '</time>' : '';
}

// ---- Regras de conversa (puras) ----------------------------------------------

// Nota sem visibilidade é interna, como no resto do sistema: errar para o lado de não
// parecer pública. A exceção são as marcas do timer, que não são fala de ninguém.
function chpTipoNota(n) {
  const vis = n && n.visibility;
  if (vis === 'solicitante') return 'solicitante';
  if (vis === 'resposta') return 'resposta';
  if (!vis && /^[⏸⏹▶]️?\s*/.test(String((n && n.text) || ''))) return 'sistema';
  return 'interna';
}

function chpPosicaoAnexo(anexo, p, notas) {
  const em = _chpMs(anexo && anexo.uploadedAt);
  // Sem data não dá para saber quem mandou nem quando: fica à vista no topo,
  // sem atribuir o arquivo ao solicitante por suposição.
  if (!Number.isFinite(em)) return { onde: 'topo' };

  let melhor = null;
  let menor = Infinity;
  (notas || []).forEach((n) => {
    if (chpTipoNota(n) === 'sistema' || !n.author || n.author !== anexo.uploadedBy) return;
    const d = Math.abs(_chpMs(n.createdAt) - em);
    if (d <= CHP_JANELA_ANEXO_MS && d < menor) {
      melhor = n;
      menor = d;
    }
  });
  if (melhor) return { onde: 'nota', nota: melhor };

  const aberto = _chpMs(p && p.createdAt);
  if (Number.isFinite(aberto) && Math.abs(em - aberto) <= CHP_JANELA_ANEXO_MS) return { onde: 'original' };
  return { onde: 'evento' };
}

// A descrição pode ser só o resumo da triagem: o e-mail inteiro ganha quando é
// claramente maior, com a mesma folga usada pelo modal de pendência.
function chpCorpoOriginal(p) {
  const triagem = _penOrigemTriagem(p && p.descricao);
  const resumo = String((triagem && triagem.corpo) || '');
  const email = String((p && p.emailCorpo) || '').trim();
  const base = email.length > resumo.length + 40 ? email : (resumo || email);
  const depois = String((triagem && triagem.depois) || '').trim();
  return depois ? base + '\n\n' + depois : base;
}

function chpItensConversa(p, anexos) {
  const feed = _penFeedItens(p);
  const notas = feed.filter((i) => !i._evento);
  const porNota = new Map();
  const naOriginal = [];
  const semData = [];
  const soltos = [];

  (anexos || []).forEach((a) => {
    const pos = chpPosicaoAnexo(a, p, notas);
    if (pos.onde === 'nota') {
      if (!porNota.has(pos.nota)) porNota.set(pos.nota, []);
      porNota.get(pos.nota).push(a);
    } else if (pos.onde === 'original') {
      naOriginal.push(a);
    } else if (pos.onde === 'topo') {
      semData.push(a);
    } else {
      soltos.push(a);
    }
  });

  const cronologicos = [];
  feed.forEach((i) => {
    if (i._evento) {
      // A primeira bolha já conta a abertura; repetir como evento só faria ruído.
      // "Visto" fica no Andamento: na conversa seria uma linha a cada responsável.
      if (i.type !== 'criado' && i.type !== 'visto') cronologicos.push({ tipo: 'evento', at: i.createdAt, evento: i });
      return;
    }
    cronologicos.push({ tipo: chpTipoNota(i), at: i.createdAt, nota: i, anexos: porNota.get(i) || [] });
  });
  soltos.forEach((a) => cronologicos.push({ tipo: 'anexo', at: a.uploadedAt, anexo: a }));

  // Por instante, não por texto: "2026-10-30T10:00:00Z" e "...-03:00" não ordenam como string.
  cronologicos.sort((a, b) => (_chpMs(a.at) || 0) - (_chpMs(b.at) || 0));

  return [{ tipo: 'original', at: p.createdAt, anexos: naOriginal }]
    .concat(semData.map((a) => ({ tipo: 'anexo', at: null, anexo: a })))
    .concat(cronologicos);
}

function chpModoInicial(p, estado) {
  if (!_chdCanal(p)) return 'nota';
  return estado && estado.modo === 'nota' ? 'nota' : 'resposta';
}

function chpSeloPrazo(est) {
  const estado = est && est.estado;
  if (estado === 'respondida' || estado === 'resolvida') {
    return est.noPrazo
      ? { classe: 'chp-selo--ok', rotulo: 'Cumprido' }
      : { classe: 'chp-selo--atrasado', rotulo: 'Atrasado' };
  }
  if (estado === 'atrasada' || estado === 'estourada') return { classe: 'chp-selo--atrasado', rotulo: 'Atrasado' };
  if (estado === 'no_prazo' || estado === 'vence_logo') return { classe: 'chp-selo--aberto', rotulo: 'No prazo' };
  return { classe: 'chp-selo--sem', rotulo: 'Sem meta' };
}

function _chpTituloEvento(e) {
  const valor = _penValorLabel(e.type, e.para);
  if (e.type === 'criado') return 'Chamado aberto';
  if (e.type === 'visto') return 'Visto';
  if (e.type === 'status') return 'Status: ' + valor;
  if (e.type === 'responsavel') return 'Passou para ' + valor;
  if (e.type === 'prioridade') return 'Prioridade: ' + valor;
  if (e.type === 'prazo') return 'Prazo: ' + valor;
  return 'Alteração';
}

/**
 * Quando e para quem o chamado chegou pela primeira vez (pura). null = ainda
 * sem responsável. Não grava nada: sai de `responsible` + eventos 'responsavel'.
 * O 1º evento com `de` vazio É a chegada; se o 1º já sai de alguém, esse alguém
 * recebeu na abertura. `evento` aponta o item do fio que vira "Recebido", para
 * não aparecer também como "Passou para".
 */
function chpRecebido(p) {
  const trocas = (Array.isArray(p && p.events) ? p.events : [])
    .filter((e) => e && e.type === 'responsavel')
    .sort((a, b) => (_chpMs(a.at) || 0) - (_chpMs(b.at) || 0));
  const vazio = (v) => v == null || String(v).trim() === '';
  const primeira = trocas[0];
  if (primeira && vazio(primeira.de)) {
    return vazio(primeira.para) ? null : { quem: String(primeira.para), at: primeira.at, evento: primeira };
  }
  const naAbertura = primeira ? primeira.de : (p && p.responsible);
  return vazio(naAbertura) ? null : { quem: String(naAbertura), at: p.createdAt, evento: null };
}

function chpAndamento(p) {
  const itens = [];
  let temAbertura = false;
  const recebido = chpRecebido(p);
  _penFeedItens(p).forEach((i) => {
    if (i._evento) {
      if (i.type === 'criado') temAbertura = true;
      // A chegada sai abaixo, uma vez só, com a data certa.
      if (recebido && recebido.evento && i.type === 'responsavel' && i.createdAt === recebido.evento.at
        && i.para === recebido.evento.para && !i.de) return;
      const autor = i.author || 'Sistema';
      itens.push({ titulo: _chpTituloEvento(i), autor: i.motivo ? autor + ' · ' + i.motivo : autor, at: i.createdAt });
      return;
    }
    const tipo = chpTipoNota(i);
    if (tipo === 'sistema') return;
    const titulo = tipo === 'solicitante' ? 'Escreveu' : (tipo === 'resposta' ? 'Respondeu' : 'Anotou');
    itens.push({ titulo, autor: i.author || (tipo === 'solicitante' ? _chdNomeSolicitante(p) : 'Equipe'), at: i.createdAt });
  });
  // Chamado antigo pode não ter evento de criação; a linha do tempo ainda precisa de um começo.
  if (!temAbertura && p.createdAt) {
    itens.push({ titulo: 'Chamado aberto', autor: _chdNomeSolicitante(p), at: p.createdAt });
  }
  // Depois da abertura no array: com o mesmo instante, a ordenação (estável) mantém Aberto antes de Recebido.
  if (recebido) itens.push({ titulo: 'Recebido', autor: recebido.quem, at: recebido.at });
  return itens.sort((a, b) => (_chpMs(a.at) || 0) - (_chpMs(b.at) || 0));
}

// ---- Visto (migration 079) ---------------------------------------------------

// Uma tentativa por chamado e pessoa nesta sessão: a página redesenha a cada sync,
// e sem isto cada redesenho seria uma chamada ao banco.
const _chpVistoTentado = new Set();

/**
 * O usuário é o responsável por um chamado aberto e ainda não tem "Visto" dele (pura).
 * É só filtro para não chamar à toa: quem decide é o banco, pelo login.
 */
function chpPrecisaMarcarVisto(p, usuario) {
  const nome = String(usuario || '').trim();
  if (!p || !nome || String(p.responsible || '').trim() !== nome) return false;
  if (typeof isPendenciaClosed === 'function' && isPendenciaClosed(p.status)) return false;
  return !(Array.isArray(p.events) ? p.events : []).some((e) => e && e.type === 'visto' && e.by === nome);
}

/** Fire-and-forget: falhar aqui (offline, banco sem a 079) nunca atrapalha abrir o chamado. */
function chpMarcarVisto(p) {
  let nome = '';
  try { nome = (typeof getUser === 'function' && getUser() && getUser().name) || ''; } catch (_) { nome = ''; }
  if (!chpPrecisaMarcarVisto(p, nome)) return null;
  const chave = p.id + '|' + nome;
  if (_chpVistoTentado.has(chave)) return null;
  if (typeof supabaseClient === 'undefined' || !supabaseClient
    || typeof isSupabaseConnected !== 'function' || !isSupabaseConnected()
    || typeof window === 'undefined' || !window._supabaseAuthActive) return null;
  _chpVistoTentado.add(chave);
  return Promise.resolve(supabaseClient.rpc('marcar_chamado_visto', { p_id: p.id })).then((res) => {
    if (res && res.error) {
      if (typeof _logSilent === 'function') _logSilent(new Error(res.error.message || 'rpc'), 'chamado-pagina:visto');
      return;
    }
    const r = res && res.data;
    const evento = r && Array.isArray(r.events)
      ? r.events.filter((e) => e && e.type === 'visto').pop()
      : null;
    if (!evento) return;
    // Só soma o evento no cache. O updated_at novo chega pelo sync, que traz o
    // registro inteiro; trocar o array aqui apagaria um evento local ainda não enviado.
    const lista = getPendencias();
    const i = lista.findIndex((x) => x.id === p.id);
    if (i === -1) return;
    const atuais = Array.isArray(lista[i].events) ? lista[i].events : [];
    if (atuais.some((e) => e && e.type === 'visto' && e.at === evento.at && e.by === evento.by)) return;
    lista[i] = { ...lista[i], events: atuais.concat([evento]) };
    dbSet(DB.PENDENCIAS, lista);
    if (typeof penPaginaEstaAberta === 'function' && penPaginaEstaAberta(p.id)) penPaginaAtualizar(p.id);
  }).catch((e) => { if (typeof _logSilent === 'function') _logSilent(e, 'chamado-pagina:visto'); });
}

// ---- Anexos ------------------------------------------------------------------

// `safeUrl` recusa data:, que é como o modo local guarda arquivo. Só imagem rasterizada
// passa como src: data:image/svg+xml carrega script, e data:text/html abriria página no link.
function _chpAnexoUrl(src) {
  const url = String(src || '');
  if (/^data:image\/(png|jpe?g|gif|webp|bmp)[;,]/i.test(url)) return url;
  const segura = safeUrl(url);
  return segura === '#' ? '' : segura;
}

// Arquivo em data: vira download, nunca href navegável: o MIME embutido precisa ser de
// documento inerte. Html, svg e script ficam de fora mesmo com download, porque o
// navegador ainda é quem decide o que fazer com a URL.
function _chpAnexoDataBaixavel(src) {
  return /^data:(application\/(pdf|msword|vnd\.ms-excel|vnd\.ms-powerpoint|vnd\.openxmlformats-officedocument\.[a-z0-9.+-]+|zip|octet-stream)|text\/(plain|csv)|image\/(png|jpe?g|gif|webp|bmp))[;,]/i
    .test(String(src || ''));
}

function _chpAnexoHtml(a) {
  const nome = escapeHtml(a.name || 'Anexo');
  const imagem = String(a.mimeType || '').indexOf('image/') === 0;
  const l = typeof _attachmentLinkAttrs === 'function'
    ? _attachmentLinkAttrs(a)
    : { src: a.data || a.url || '', signed: '' };
  const data = /^data:/i.test(String(l.src || ''));
  const url = l.signed ? '' : _chpAnexoUrl(l.src);
  const baixavel = !l.signed && !url && _chpAnexoDataBaixavel(l.src);
  const miniatura = imagem && (l.signed || url)
    ? '<img class="chp-anexo-mini" alt=""' + (l.signed || ' src="' + escapeHtml(url) + '"') + '>'
    : '<span class="chp-anexo-ico">' + chpIcone('arquivo') + '</span>';
  const miolo = miniatura + '<span class="chp-anexo-nome">' + nome + '</span>';

  // Bucket privado: o link assinado é preenchido por fillSignedAttachmentLinks após o desenho.
  if (l.signed) {
    return '<a class="chp-anexo" aria-disabled="true" title="Carregando…"' + l.signed
      + ' data-att-name="' + nome + '" download="' + nome + '">' + miolo + '</a>';
  }
  if (url) {
    // data: raster também baixa: o modal trata os dois como arquivo, não como página.
    const extra = data
      ? ' download="' + nome + '"'
      : ' target="_blank" rel="noopener noreferrer" download="' + nome + '"';
    return '<a class="chp-anexo" href="' + escapeHtml(url) + '"' + extra + '>' + miolo + '</a>';
  }
  if (baixavel) {
    return '<a class="chp-anexo" href="' + escapeHtml(l.src) + '" download="' + nome + '">' + miolo + '</a>';
  }
  return '<span class="chp-anexo chp-anexo--off" title="Arquivo indisponível">' + miolo + '</span>';
}

function _chpAnexosHtml(anexos, obs) {
  if (!anexos || !anexos.length) return '';
  return '<div class="chp-anexos">' + anexos.map(_chpAnexoHtml).join('') + '</div>'
    + (obs ? '<p class="chp-anexo-obs">' + escapeHtml(obs) + '</p>' : '');
}

// ---- Conversa ----------------------------------------------------------------

function _chpBolhaHtml(o) {
  return '<article class="chp-msg ' + o.classe + '" data-chp-tipo="' + o.tipo + '">'
    + pgpAvatarHtml(o.autor, 32)
    + '<div class="chp-bolha">'
    + '<header class="chp-bolha-topo"><strong class="chp-autor">' + escapeHtml(o.autor) + '</strong>'
    + ' <span class="chp-acao">' + o.acao + '</span> ' + _chpTimeHtml(o.at) + '</header>'
    + '<div class="chp-bolha-corpo">' + o.corpo + '</div>'
    + (o.anexos || '') + (o.rodape || '')
    + '</div></article>';
}

function _chpOriginalHtml(p, item) {
  const texto = chpCorpoOriginal(p);
  return _chpBolhaHtml({
    classe: 'chp-msg--solicitante',
    tipo: 'original',
    autor: _chdNomeSolicitante(p),
    acao: 'abriu o chamado',
    at: item.at,
    corpo: texto ? _penRichDesc(texto) : '<em>Sem texto na mensagem original.</em>',
    anexos: _chpAnexosHtml(item.anexos),
  });
}

function _chpNotaHtml(p, item) {
  const n = item.nota;
  const corpo = _penRichNote(n.text || '');
  if (item.tipo === 'solicitante') {
    return _chpBolhaHtml({
      classe: 'chp-msg--solicitante', tipo: item.tipo, autor: n.author || _chdNomeSolicitante(p),
      acao: 'escreveu', at: item.at, corpo, anexos: _chpAnexosHtml(item.anexos),
    });
  }
  if (item.tipo === 'resposta') {
    return _chpBolhaHtml({
      classe: 'chp-msg--equipe', tipo: item.tipo, autor: n.author || 'Equipe', acao: 'respondeu', at: item.at, corpo,
      // pendencia-responder e o envio de WhatsApp só levam texto: o aviso evita prometer o arquivo.
      anexos: _chpAnexosHtml(item.anexos, _chdCanal(p) ? 'Não foi enviado a quem pediu' : ''),
    });
  }
  return _chpBolhaHtml({
    classe: 'chp-msg--nota', tipo: item.tipo, autor: n.author || 'Equipe', acao: 'anotou', at: item.at, corpo,
    anexos: _chpAnexosHtml(item.anexos),
    rodape: '<p class="chp-nota-aviso">' + chpIcone('cadeado') + ' anotação interna, só a equipe vê</p>',
  });
}

function _chpLinhaHtml(conteudo, at) {
  return '<div class="chp-evento"><span class="chp-evento-ponto" aria-hidden="true"></span>'
    + '<span class="chp-evento-texto">' + conteudo + (at ? ' · ' + _chpTimeHtml(at) : '') + '</span></div>';
}

function _chpEventoTextoHtml(e) {
  const quem = e.author ? escapeHtml(e.author) : 'Sistema';
  const para = escapeHtml(_penValorLabel(e.type, e.para));
  const verbo = _PEN_EVENT_VERBO[e.type] || 'mudou algo';
  if (e.type === 'responsavel') return quem + ' ' + verbo + ' <strong>' + para + '</strong>';
  return quem + ' ' + verbo + ': ' + escapeHtml(_penValorLabel(e.type, e.de)) + ' → <strong>' + para + '</strong>';
}

function _chpItemHtml(p, item) {
  if (item.tipo === 'original') return _chpOriginalHtml(p, item);
  if (item.tipo === 'evento') return _chpLinhaHtml(_chpEventoTextoHtml(item.evento), item.at);
  if (item.tipo === 'sistema') {
    // O símbolo do timer é emoji gravado na nota; aqui vira linha neutra de sistema.
    const texto = String(item.nota.text || '').replace(/^[⏸⏹▶]️?\s*/, '');
    return _chpLinhaHtml(escapeHtml(texto), item.at);
  }
  if (item.tipo === 'anexo') {
    const quem = item.anexo.uploadedBy ? escapeHtml(item.anexo.uploadedBy) : 'Alguém';
    return _chpLinhaHtml(quem + ' anexou ' + _chpAnexoHtml(item.anexo), item.at);
  }
  return _chpNotaHtml(p, item);
}

function _chpFioHtml(p, itens) {
  let dia = '';
  let html = '';
  itens.forEach((item) => {
    const chave = item.at ? _chpChaveDia(item.at) : '';
    if (chave && chave !== dia) {
      dia = chave;
      html += '<div class="chp-dia"><span>' + escapeHtml(chpDiaRotulo(item.at)) + '</span></div>';
    }
    html += _chpItemHtml(p, item);
  });
  return '<div class="chp-fio">' + html + '</div>';
}

// ---- Caixa de resposta -------------------------------------------------------

function chpComposerHtml(p, modo) {
  const id = escapeHtml(p.id);
  const canal = _chdCanal(p);
  const nome = escapeHtml(_chdNomeSolicitante(p));
  const emNota = modo === 'nota';
  const so = (qual) => ' data-chp-so="' + qual + '"' + ((qual === 'nota') === emNota ? '' : ' hidden');
  const canalTexto = canal === 'whatsapp' ? 'WhatsApp' : 'e-mail';

  // Sem canal a resposta não sai daqui: nem o campo existe, para não sugerir um envio impossível.
  const blocoResposta = canal
    ? '<label class="chp-sr" for="newNoteText"' + so('resposta') + '>Resposta para ' + nome + '</label>'
      + '<textarea class="chp-campo" id="newNoteText" rows="3" data-pgp-rascunho="chp-resposta"'
      + ' placeholder="Escreva a resposta…"' + so('resposta') + '></textarea>'
    : '<p class="chp-aviso">Sem e-mail nem WhatsApp de quem pediu: a resposta fica só no histórico do chamado.</p>';

  return '<div class="chp-composer" data-pgp-modo="' + (emNota ? 'nota' : 'resposta') + '">'
    + '<div class="chp-composer-topo">'
    + '<div class="chp-modos" role="group" aria-label="Tipo de mensagem">'
    + '<button type="button" class="chp-modo" data-action="chpModo" data-arg="resposta" aria-pressed="' + !emNota + '"'
    + (canal ? '' : ' disabled') + '>Responder</button>'
    + '<button type="button" class="chp-modo" data-action="chpModo" data-arg="nota" aria-pressed="' + emNota + '">'
    + chpIcone('cadeado') + ' Anotação interna</button>'
    + '</div>'
    + (canal ? '<p class="chp-ajuda"' + so('resposta') + '>Vai por ' + canalTexto + ' para ' + nome + '</p>' : '')
    + '<p class="chp-ajuda"' + so('nota') + '>Só a equipe vê. Use @nome para avisar alguém.</p>'
    + '</div>'
    + blocoResposta
    + '<div class="chd-mencao-wrap chp-mencao"' + so('nota') + '>'
    + '<label class="chp-sr" for="chamadoNotaTexto">Anotação interna</label>'
    + '<textarea class="chp-campo" id="chamadoNotaTexto" rows="3" data-pgp-rascunho="chp-nota" data-input="chdMencao"'
    + ' placeholder="Anotação para a equipe…"></textarea>'
    + '<ul class="chd-mencao-lista" id="chamadoMencaoLista" role="listbox" hidden></ul>'
    + '</div>'
    + '<div class="chp-composer-base">'
    + '<button type="button" class="chp-btn chp-btn--ico" data-action="chpAnexar" aria-label="Anexar arquivo ao chamado">'
    + chpIcone('clipe') + '</button>'
    + '<input type="file" id="chpAnexoInput" hidden data-change="chpAnexo" data-id="' + id + '">'
    + '<span class="chp-dica">Anexo fica só no chamado · Ctrl + Enter envia</span>'
    + (canal
      ? '<button type="button" class="chp-btn chp-enviar" data-action="chdResponder" data-arg="responder" data-id="' + id + '"'
        + so('resposta') + '>Enviar resposta</button>'
      : '')
    + '<button type="button" class="chp-btn chp-salvar" data-action="chdNotaInterna" data-arg="' + id + '"'
    + so('nota') + '>Salvar anotação</button>'
    + '</div></div>';
}

// ---- Cabeçalho ---------------------------------------------------------------

function _chpTransferirHtml(p, aberto) {
  const opcoes = _chdOperadoresElegiveis()
    .filter((o) => o.name !== p.responsible)
    .map((o) => '<option value="' + escapeHtml(o.name) + '">' + escapeHtml(o.name)
      + (o.team ? ' · ' + escapeHtml(o.team) : '') + '</option>')
    .join('');
  const id = escapeHtml(p.id);
  return '<div class="chp-transferir" id="chpPainelTransferir"' + (aberto ? '' : ' hidden') + '>'
    + '<div class="chp-transferir-campo"><label class="pgp-label" for="chdTransferPara">Transferir para</label>'
    + '<select class="chp-campo" id="chdTransferPara" data-pgp-rascunho="chp-transfer-para">'
    + '<option value="">Escolha…</option>' + opcoes + '</select></div>'
    + '<div class="chp-transferir-campo"><label class="pgp-label" for="chdTransferMotivo">Motivo (obrigatório, vira anotação interna)</label>'
    + '<textarea class="chp-campo" id="chdTransferMotivo" rows="2" maxlength="500" data-pgp-rascunho="chp-transfer-motivo"'
    + ' placeholder="Por que o chamado está mudando de mão?"></textarea></div>'
    + '<div class="chp-transferir-acoes">'
    + '<button type="button" class="chp-btn chp-enviar" data-action="chpTransferir" data-arg="' + id + '">Transferir</button>'
    + '<button type="button" class="chp-btn" data-action="chpPainelTransferir">Fechar</button>'
    + '</div></div>';
}

function _chpCabecalhoHtml(p, estado) {
  const id = escapeHtml(p.id);
  const titulo = typeof getPendenciaTitulo === 'function' ? getPendenciaTitulo(p) : p.title;
  const canal = _chdCanal(p);
  const canalTexto = canal ? _chdCanalRotulo(canal) : (penCanalLabel(p.canal) || 'Sem canal');
  const categoria = penCategoriaLabel(p.categoria);
  const trabalhando = isCurrentWorker(p);
  const rascunhos = (estado && estado.rascunhos) || {};
  // O painel é desenhado de novo a cada mudança de dados; com texto nele, tem de continuar aberto.
  const painelAberto = !!(rascunhos['chp-transfer-para'] || rascunhos['chp-transfer-motivo']);

  return '<header class="chp-cabecalho">'
    + '<div class="chp-meta">'
    + '<span class="chp-tag">' + escapeHtml(_chdProtocolo(p)) + '</span>'
    + '<span class="chp-meta-item">' + (canal ? chpIcone(canal) : '') + escapeHtml(canalTexto) + '</span>'
    + (categoria ? '<span class="chp-meta-item">' + escapeHtml(categoria) + '</span>' : '')
    + '</div>'
    + '<h1 class="pgp-titulo">' + escapeHtml(titulo || 'Sem título') + '</h1>'
    + '<div class="chp-cabecalho-base">'
    + pgpSeletoresHtml(p)
    + '<div class="chp-acoes">'
    + '<button type="button" class="chp-btn" data-action="chpPainelTransferir" aria-expanded="' + painelAberto + '" aria-controls="chpPainelTransferir">'
    + chpIcone('transferir') + ' Transferir</button>'
    + '<button type="button" class="chp-btn" data-action="chpCompartilhar" data-arg="' + id + '">'
    + chpIcone('compartilhar') + ' Compartilhar</button>'
    + '<button type="button" class="chp-btn ' + (trabalhando ? 'chp-timer-pausar' : 'chp-timer-iniciar') + '" data-action="chpTimer" data-arg="' + id + '">'
    + chpIcone(trabalhando ? 'pausa' : 'play') + (trabalhando ? ' Pausar timer' : ' Iniciar timer') + '</button>'
    + '</div></div>'
    + _chpTransferirHtml(p, painelAberto)
    + '</header>';
}

// ---- Coluna direita ----------------------------------------------------------

function _chpCardHtml(titulo, corpo) {
  return '<section class="chp-card"><h2 class="chp-card-titulo">' + titulo + '</h2>' + corpo + '</section>';
}

function _chpQuemPediuHtml(p) {
  const nome = _chdNomeSolicitante(p);
  const email = String(p.solicitanteEmail || '').trim();
  // encodeURIComponent impede que um e-mail forjado com "?bcc=" vire parâmetro do mailto.
  const mailto = email ? safeUrl('mailto:' + encodeURIComponent(email).replace(/%40/g, '@')) : '';
  const telefone = chamadoTelefoneDe(p);
  return _chpCardHtml('Quem pediu',
    '<div class="chp-pessoa">' + pgpAvatarHtml(nome, 40) + '<div class="chp-pessoa-dados">'
    + '<strong>' + escapeHtml(nome) + '</strong>'
    + (mailto ? '<a class="chp-link" href="' + escapeHtml(mailto) + '">' + escapeHtml(email) + '</a>' : '')
    + (telefone ? '<span class="chp-muted">' + escapeHtml(chamadoTelefoneFormatar(telefone)) + '</span>' : '')
    + '</div></div>'
    + '<dl class="chp-dados"><div><dt>Cliente</dt><dd>'
    + (p.clientName
      ? escapeHtml(p.clientName)
      : '<button type="button" class="chp-link" data-action="chpVincularCliente" data-arg="' + escapeHtml(p.id) + '">Vincular cliente</button>')
    + '</dd></div></dl>');
}

function _chpAtendimentoHtml(p) {
  const worker = getCurrentWorker(p);
  const tempo = worker ? timerDisplayHTML(p) : escapeHtml(_penFriendlyTime(p).friendly);
  const responsavel = p.responsible
    ? '<div class="chp-pessoa">' + pgpAvatarHtml(p.responsible, 32) + '<div class="chp-pessoa-dados">'
      + '<strong>' + escapeHtml(p.responsible) + '</strong>'
      + (p.team ? '<span class="chp-muted">' + escapeHtml(p.team) + '</span>' : '')
      + '</div></div>'
    : '<p class="chp-muted">Sem responsável</p>';
  return _chpCardHtml('Atendimento', responsavel
    + '<dl class="chp-dados">'
    + '<div><dt>Trabalhando agora</dt><dd' + (worker ? ' class="chp-verde"' : '') + '>' + escapeHtml(worker || 'Ninguém') + '</dd></div>'
    + '<div><dt>Tempo acumulado</dt><dd>' + tempo + '</dd></div>'
    + '</dl>'
    + '<button type="button" class="chp-link" data-action="chdSessoes" data-arg="' + escapeHtml(p.id) + '">Ver sessões</button>');
}

function _chpLinhaPrazoHtml(rotulo, est, quando, meta, createdAt, vazio) {
  const selo = chpSeloPrazo(est);
  const estado = est && est.estado;
  const dur = (m) => slaDuracaoCurta(m);
  let detalhe;
  if (estado === 'respondida' || estado === 'resolvida') {
    detalhe = _chpDataHora(quando) + ' · levou ' + dur(est.minutos);
  } else if (estado === 'atrasada' || estado === 'estourada') {
    detalhe = 'Meta: ' + meta + ' · ' + dur(est.minutos) + ' de atraso';
  } else if (estado === 'no_prazo' || estado === 'vence_logo') {
    detalhe = 'Meta: ' + meta + ' · faltam ' + dur(est.minutos);
  } else if (quando) {
    const levou = Math.max(0, Math.round((_chpMs(quando) - _chpMs(createdAt)) / 60000));
    detalhe = _chpDataHora(quando) + (Number.isFinite(levou) ? ' · levou ' + dur(levou) : '');
  } else {
    detalhe = vazio;
  }
  return '<div class="chp-prazo-linha"><div class="chp-prazo-topo"><span class="chp-prazo-rotulo">' + rotulo + '</span>'
    + '<span class="chp-selo ' + selo.classe + '">' + selo.rotulo + '</span></div>'
    + '<p class="chp-prazo-detalhe">' + escapeHtml(detalhe) + '</p></div>';
}

function _chpPrazoHtml(p, agora) {
  const lados = slaTempoPorLado(p, agora);
  return _chpCardHtml('Prazo',
    '<dl class="chp-dados"><div><dt>Aberto</dt><dd>' + escapeHtml(_chpDataHora(p.createdAt) || '—') + '</dd></div></dl>'
    + _chpLinhaPrazoHtml('1ª resposta', slaRespostaEstado(p, agora), p.firstResponseAt,
      _chpDataHora(p.firstResponseDue), p.createdAt, 'Ainda não respondido')
    + _chpLinhaPrazoHtml('Resolução', slaResolucaoEstado(p, agora), p.completedAt,
      _chpDataPrazo(p.deadline), p.createdAt, 'Ainda não resolvido')
    + '<hr class="chp-separador">'
    + '<p class="chp-subtitulo">De quem foi o tempo</p>'
    + '<dl class="chp-dados">'
    + '<div><dt>Com a equipe</dt><dd>' + escapeHtml(slaDuracaoCurta(lados.equipe)) + '</dd></div>'
    + '<div><dt>Com quem pediu</dt><dd>' + escapeHtml(slaDuracaoCurta(lados.solicitante)) + '</dd></div>'
    + '</dl>');
}

function _chpAndamentoHtml(p) {
  const itens = chpAndamento(p);
  return _chpCardHtml('Andamento', '<ol class="chp-linha-tempo">' + itens.map((item, i) => {
    const quando = _chpDataHora(item.at);
    return '<li class="chp-marco' + (i === itens.length - 1 ? ' is-final' : '') + '">'
      + '<span class="chp-marco-titulo">' + escapeHtml(item.titulo) + '</span>'
      + '<span class="chp-marco-quem">' + escapeHtml(item.autor) + (quando ? ' · ' + escapeHtml(quando) : '') + '</span></li>';
  }).join('') + '</ol>');
}

// ---- Tela --------------------------------------------------------------------

// O listener fica no próprio textarea: a raiz é recriada a cada desenho, então ele
// morre junto e o redesenho não acumula envio em dobro.
function _chpLigarAtalhos(container, id) {
  const ligar = (ta, enviar) => {
    if (!ta) return;
    ta.addEventListener('keydown', (ev) => {
      if (ev.repeat || !(ev.ctrlKey || ev.metaKey) || ev.key !== 'Enter') return;
      ev.preventDefault();
      enviar();
    });
  };
  ligar(container.querySelector('#newNoteText'), () => chamadoResponderAcao(id, 'responder'));
  ligar(container.querySelector('#chamadoNotaTexto'), () => chamadoNotaInterna(id));
}

// `estado` só vem preenchido em redesenho (penPaginaAtualizar); ver js/pagina-pendencia.js.
function renderChamadoPagina(p, container, estado) {
  const anexos = typeof getAttachments === 'function' ? (getAttachments('pendencias', p.id) || []) : [];
  const agora = Date.now();
  container.innerHTML = pgpVoltarHtml('Chamados')
    + _chpCabecalhoHtml(p, estado)
    + '<div class="chp-corpo">'
    + '<section class="chp-conversa" aria-label="Conversa">'
    + _chpFioHtml(p, chpItensConversa(p, anexos))
    + chpComposerHtml(p, chpModoInicial(p, estado))
    + '</section>'
    + '<aside class="chp-lado" aria-label="Detalhes do chamado">'
    + _chpQuemPediuHtml(p) + _chpAtendimentoHtml(p) + _chpPrazoHtml(p, agora) + _chpAndamentoHtml(p)
    + '</aside></div>';

  if (typeof container.querySelector !== 'function') return;
  _chpLigarAtalhos(container, p.id);
  if (typeof fillSignedAttachmentLinks === 'function') fillSignedAttachmentLinks(container);
}

// A alternância não redesenha: os dois campos já existem, e redesenhar só para trocar
// de modo moveria o scroll de quem está lendo a conversa.
function _chpAplicarModo(composer, modo) {
  composer.dataset.pgpModo = modo;
  composer.querySelectorAll('[data-action="chpModo"]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.arg === modo));
  });
  composer.querySelectorAll('[data-chp-so]').forEach((el) => {
    el.hidden = el.dataset.chpSo !== modo;
  });
  const campo = composer.querySelector(modo === 'nota' ? '#chamadoNotaTexto' : '#newNoteText');
  if (campo) campo.focus();
}

if (typeof registerActions === 'function') {
  registerActions({
    chpModo: function (el, modo) {
      const composer = el.closest('.chp-composer');
      if (composer) _chpAplicarModo(composer, modo);
    },
    chpTimer: function (el, id) {
      toggleTimer('pendencia', id, el);
      penPaginaAtualizar(id);
    },
    chpCompartilhar: function (_el, id) {
      const p = getPendenciaById(id);
      if (p) copyToClipboard(location.origin + location.pathname + penPaginaHref(p));
    },
    chpAnexar: function () {
      const input = document.getElementById('chpAnexoInput');
      if (input) input.click();
    },
    chpAnexo: function (el) {
      const id = el.dataset.id;
      handleFileUpload('pendencias', id, el, function () { penPaginaAtualizar(id); });
    },
    chpPainelTransferir: function () {
      const painel = document.getElementById('chpPainelTransferir');
      if (!painel) return;
      painel.hidden = !painel.hidden;
      const botao = document.querySelector('[aria-controls="chpPainelTransferir"]');
      if (botao) botao.setAttribute('aria-expanded', String(!painel.hidden));
      if (!painel.hidden) document.getElementById('chdTransferPara').focus();
    },
    chpTransferir: function (_el, id) {
      const para = (document.getElementById('chdTransferPara') || {}).value || '';
      const motivo = String((document.getElementById('chdTransferMotivo') || {}).value || '').trim();
      const antes = getPendenciaById(id);
      const valido = !!antes && !chamadoValidarTransferencia(antes, para, motivo);
      _chdTransferir(id);
      // _chdTransferir não limpa os campos, e o redesenho os restauraria: sem isto o
      // painel reabriria com o motivo já gravado, pronto para ser enviado de novo.
      const depois = getPendenciaById(id);
      if (!valido || !depois || depois.responsible !== para) return;
      const campoPara = document.getElementById('chdTransferPara');
      const campoMotivo = document.getElementById('chdTransferMotivo');
      if (campoPara) campoPara.value = '';
      if (campoMotivo) campoMotivo.value = '';
      const painel = document.getElementById('chpPainelTransferir');
      if (painel) painel.hidden = true;
      const botao = document.querySelector('[aria-controls="chpPainelTransferir"]');
      if (botao) botao.setAttribute('aria-expanded', 'false');
    },
    chpVincularCliente: function (_el, id) {
      openPendenciaForm(id);
    },
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    renderChamadoPagina,
    chpIcone,
    chpTipoNota,
    chpPosicaoAnexo,
    chpCorpoOriginal,
    chpItensConversa,
    chpModoInicial,
    chpSeloPrazo,
    chpAndamento,
    chpRecebido,
    chpPrecisaMarcarVisto,
    chpMarcarVisto,
    chpDiaRotulo,
    chpComposerHtml,
  };
}
