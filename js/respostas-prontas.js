// respostas-prontas.js — Textos que a equipe reaproveita ao responder chamado.
// =====================================================================
// Tabela `respostas_prontas` (migration 074), por equipe. O seletor mora no
// composer do chamado e só INSERE o texto: quem responde ainda lê, ajusta e
// posta. Nada aqui envia mensagem sozinho.
//
// Script clássico (escopo global compartilhado), sem import/export.

function getRespostasProntas() {
  try { return dbGet(DB.RESPOSTAS_PRONTAS) || []; } catch { return []; }
}

/** Respostas da equipe atual, em ordem alfabética de título. */
function respostasProntasDaEquipe() {
  var lista = getRespostasProntas().filter(function (r) { return r && r.id && r.titulo; });
  if (typeof filterByTeam === 'function') {
    try { lista = filterByTeam(lista); } catch (_e) { /* sem equipe: mostra tudo */ }
  }
  return lista.slice().sort(function (a, b) { return String(a.titulo).localeCompare(String(b.titulo), 'pt-BR'); });
}

function _respostaProntaPush(op, linha) {
  if (!(typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive)) return;
  var q = op === 'delete'
    ? supabaseClient.from('respostas_prontas').delete().eq('id', linha.id)
    : supabaseClient.from('respostas_prontas').upsert({
      id: linha.id, titulo: linha.titulo, conteudo: linha.conteudo, team: linha.team,
      created_by: linha.createdBy || null, updated_at: linha.updatedAt
    });
  q.then(function (res) {
    if (res.error) { console.error('❌ Supabase respostas_prontas:', res.error); markSyncPushFailed(); }
  }).catch(function () { markSyncPushFailed(); });
}

/**
 * Cria (sem id) ou edita. Devolve a resposta salva, ou null se faltar título
 * ou texto — resposta vazia no seletor só atrapalha.
 */
function salvarRespostaPronta(dados) {
  var titulo = String((dados && dados.titulo) || '').trim();
  var conteudo = String((dados && dados.conteudo) || '').trim();
  if (!titulo || !conteudo) return null;
  var lista = getRespostasProntas();
  var agora = new Date().toISOString();
  var i = dados.id ? lista.findIndex(function (r) { return r && r.id === dados.id; }) : -1;
  var linha;
  if (i >= 0) {
    // A equipe da linha não muda na edição: admin editando a resposta de outro
    // time não a puxa para o seu.
    linha = Object.assign({}, lista[i], { titulo: titulo, conteudo: conteudo, updatedAt: agora });
    lista[i] = linha;
  } else {
    var u = typeof getUser === 'function' ? getUser() : null;
    linha = {
      id: 'rp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      titulo: titulo, conteudo: conteudo,
      team: (typeof getCurrentTeam === 'function' && getCurrentTeam()) || 'init',
      createdBy: u ? u.name : null, createdAt: agora, updatedAt: agora
    };
    lista.push(linha);
  }
  dbSet(DB.RESPOSTAS_PRONTAS, lista);
  _respostaProntaPush('upsert', linha);
  return linha;
}

function excluirRespostaPronta(id) {
  var lista = getRespostasProntas();
  var alvo = lista.find(function (r) { return r && r.id === id; });
  if (!alvo) return false;
  dbSet(DB.RESPOSTAS_PRONTAS, lista.filter(function (r) { return r !== alvo; }));
  _respostaProntaPush('delete', alvo);
  return true;
}

/**
 * Põe o texto no composer. Acrescenta em vez de substituir: quem já começou a
 * escrever não perde o que digitou.
 */
function inserirRespostaPronta(id) {
  var r = getRespostasProntas().find(function (x) { return x && x.id === id; });
  var ta = typeof document !== 'undefined' ? document.getElementById('newNoteText') : null;
  if (!r || !ta) return false;
  var atual = ta.value.replace(/\s+$/, '');
  ta.value = atual ? atual + '\n\n' + r.conteudo : r.conteudo;
  ta.focus();
  return true;
}

function _respostasProntasLista() {
  var lista = respostasProntasDaEquipe();
  if (!lista.length) return '<p class="text-muted">Nenhuma resposta pronta ainda. Crie a primeira abaixo.</p>';
  return '<ul class="rp-lista">' + lista.map(function (r) {
    var id = escapeHtml(r.id);
    return '<li class="rp-item">'
      + '<button type="button" class="rp-usar" data-action="rpInserir" data-arg="' + id + '" title="Inserir no texto da resposta">'
      + '<strong>' + escapeHtml(r.titulo) + '</strong><span class="text-muted">' + escapeHtml(String(r.conteudo).slice(0, 120)) + '</span></button>'
      + '<span class="rp-acoes">'
      + '<button type="button" class="btn btn-secondary btn-sm" data-action="rpEditar" data-arg="' + id + '">Editar</button>'
      + '<button type="button" class="btn btn-secondary btn-sm" data-action="rpExcluir" data-arg="' + id + '">Excluir</button>'
      + '</span></li>';
  }).join('') + '</ul>';
}

function abrirRespostasProntas(editId) {
  var ed = editId ? getRespostasProntas().find(function (r) { return r && r.id === editId; }) : null;
  openModal('💬 Respostas prontas', _respostasProntasLista()
    + '<form class="rp-form" data-submit="rpSalvar">'
    + '<input type="hidden" id="rpId" value="' + escapeHtml(ed ? ed.id : '') + '">'
    + '<label class="form-label" for="rpTitulo">' + (ed ? 'Editar resposta' : 'Nova resposta') + '</label>'
    + '<input class="form-input" id="rpTitulo" maxlength="80" placeholder="Título (ex.: Reiniciar roteador)" value="' + escapeHtml(ed ? ed.titulo : '') + '">'
    + '<textarea class="form-textarea" id="rpConteudo" rows="4" placeholder="Texto que entra na resposta">' + escapeHtml(ed ? ed.conteudo : '') + '</textarea>'
    + '<button type="submit" class="btn btn-primary btn-sm">Salvar</button>'
    + '</form>');
}

if (typeof registerActions === 'function') {
  registerActions({
    rpAbrir: function () { abrirRespostasProntas(); },
    rpInserir: function (_el, id) {
      if (inserirRespostaPronta(id)) closeModal();
      else showToast('Abra um chamado para usar a resposta.', 'error');
    },
    rpEditar: function (_el, id) { abrirRespostasProntas(id); },
    rpExcluir: function (_el, id) {
      if (!confirm('Excluir esta resposta pronta para toda a equipe?')) return;
      excluirRespostaPronta(id);
      abrirRespostasProntas();
    },
    rpSalvar: function () {
      var salvo = salvarRespostaPronta({
        id: document.getElementById('rpId').value || null,
        titulo: document.getElementById('rpTitulo').value,
        conteudo: document.getElementById('rpConteudo').value
      });
      if (!salvo) { showToast('Preencha título e texto.', 'error'); return; }
      showToast('Resposta pronta salva.', 'success');
      abrirRespostasProntas();
    }
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getRespostasProntas, respostasProntasDaEquipe, salvarRespostaPronta, excluirRespostaPronta, inserirRespostaPronta };
}
