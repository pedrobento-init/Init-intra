// whatsapp-etiquetas.js — Etiquetas das conversas do WhatsApp (migration 089).
// =============================================================================
// A etiqueta mora na CONVERSA (telefone + equipe), não na mensagem: cada
// mensagem é uma linha de emails_triagem, e etiqueta posta numa delas sumia da
// lista assim que o cliente mandava a próxima. O telefone é a chave
// normalizada (chamadoTelefoneChave: sem o 55 e sem o nono dígito), a mesma
// com que a Caixa agrupa a conversa.
//
// A cor é uma de WETQ_CORES, e cada uma vira uma classe de css/whatsapp.css:
// nada do banco entra como CSS. O banco tem a mesma lista num CHECK (089), e
// tests/whatsapp-etiquetas.test.js confere que as duas batem.
//
// Sem a 089 as tabelas não existem: o sync as trata como opcionais
// (js/schema.js) e tudo aqui devolve lista vazia, então a Caixa segue igual.
//
// Script clássico (escopo global compartilhado), sem import/export.

const WETQ_DB_ETIQUETAS = 'intra_whatsapp_etiquetas';
const WETQ_DB_APLICADAS = 'intra_whatsapp_conversa_etiquetas';

const WETQ_CORES = {
  azul: 'Azul',
  verde: 'Verde',
  amarelo: 'Amarelo',
  laranja: 'Laranja',
  vermelho: 'Vermelho',
  roxo: 'Roxo',
  rosa: 'Rosa',
  cinza: 'Cinza',
};

const WETQ_NOME_MAX = 40;

// Etiqueta escolhida no filtro da Caixa ('' = todas as conversas). Por pessoa e
// só nesta aba: filtro é olhar, não dado.
var _wetqFiltro = '';

function _wetqLer(chave) {
  try {
    const v = typeof dbGet === 'function' ? dbGet(chave) : [];
    return Array.isArray(v) ? v : [];
  } catch (_e) {
    return [];
  }
}

function _wetqEquipe(t) {
  return String(t || '').trim() || 'init';
}

/** Chave da conversa a partir de qualquer forma do telefone. */
function wetqChave(telefone) {
  if (typeof chamadoTelefoneChave === 'function') {
    const c = chamadoTelefoneChave(telefone);
    if (c) return c;
  }
  const d = String(telefone || '').replace(/\D/g, '');
  return d.length >= 10 ? d : '';
}

/** Todas as etiquetas que este aparelho enxerga (a RLS já filtrou por equipe). */
function wetqTodas() {
  return _wetqLer(WETQ_DB_ETIQUETAS).filter((e) => e && e.id && e.nome);
}

/** Etiquetas de uma equipe, em ordem alfabética. Sem equipe: as do usuário. */
function wetqEtiquetas(team) {
  let lista = wetqTodas();
  if (team) lista = lista.filter((e) => _wetqEquipe(e.team) === _wetqEquipe(team));
  else if (typeof filterByTeam === 'function') {
    try {
      lista = filterByTeam(lista);
    } catch (_e) {
      /* sem equipe: mostra tudo */
    }
  }
  return lista
    .slice()
    .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR', { sensitivity: 'base' }));
}

function wetqAplicadas() {
  return _wetqLer(WETQ_DB_APLICADAS).filter((a) => a && a.id && a.etiquetaId && a.telefone);
}

// Uma conversa da Caixa pode ter linha de mais de uma equipe (admin vê todas):
// a etiqueta vale para qualquer uma das equipes dela.
function _wetqEquipesDa(conversa) {
  const set = new Set();
  ((conversa && conversa.mensagens) || []).forEach((m) => set.add(_wetqEquipe(m && m.team)));
  if (!set.size && conversa && conversa.ultima) set.add(_wetqEquipe(conversa.ultima.team));
  return set;
}

/** Etiquetas (objetos) aplicadas à conversa da Caixa, em ordem alfabética. */
function wetqDaConversa(conversa, aplicadas, etiquetas) {
  if (!conversa || conversa.canal !== 'whatsapp') return [];
  const chave = wetqChave(conversa.telefone || (conversa.ultima && conversa.ultima.telefone));
  if (!chave) return [];
  const equipes = _wetqEquipesDa(conversa);
  const ids = new Set(
    (aplicadas || wetqAplicadas())
      .filter((a) => a.telefone === chave && equipes.has(_wetqEquipe(a.team)))
      .map((a) => a.etiquetaId)
  );
  return (etiquetas || wetqTodas())
    .filter((e) => ids.has(e.id))
    .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR', { sensitivity: 'base' }));
}

/** Etiquetas de um contato (telefone + equipe), para a tela de contatos. */
function wetqDoContato(telefone, team, aplicadas, etiquetas) {
  const chave = wetqChave(telefone);
  if (!chave) return [];
  return wetqDaConversa(
    { canal: 'whatsapp', telefone: chave, mensagens: [{ team: _wetqEquipe(team) }] },
    aplicadas,
    etiquetas
  );
}

/**
 * Pura: só as conversas com a etiqueta. Sem etiqueta escolhida devolve todas;
 * e-mail nunca tem etiqueta, então sai quando há filtro.
 */
function wetqFiltrarConversas(conversas, etiquetaId, aplicadas) {
  const id = etiquetaId === undefined ? _wetqFiltro : etiquetaId;
  const lista = (conversas || []).slice();
  if (!id) return lista;
  const marcadas = new Set(
    (aplicadas || wetqAplicadas())
      .filter((a) => a.etiquetaId === id)
      .map((a) => _wetqEquipe(a.team) + '|' + a.telefone)
  );
  return lista.filter((c) => {
    if (!c || c.canal !== 'whatsapp') return false;
    const chave = wetqChave(c.telefone || (c.ultima && c.ultima.telefone));
    if (!chave) return false;
    for (const t of _wetqEquipesDa(c)) if (marcadas.has(t + '|' + chave)) return true;
    return false;
  });
}

/** Valida nome e cor. Devolve a mensagem de erro, ou null. */
function wetqValidar(dados, existentes) {
  const nome = String((dados && dados.nome) || '').trim();
  if (!nome) return 'Dê um nome à etiqueta.';
  if (nome.length > WETQ_NOME_MAX)
    return 'Nome longo demais (até ' + WETQ_NOME_MAX + ' caracteres).';
  if (!Object.prototype.hasOwnProperty.call(WETQ_CORES, String((dados && dados.cor) || '')))
    return 'Escolha uma cor da lista.';
  const team = _wetqEquipe(dados.team);
  const igual = (existentes || []).find(
    (e) =>
      e.id !== dados.id &&
      _wetqEquipe(e.team) === team &&
      String(e.nome).trim().toLowerCase() === nome.toLowerCase()
  );
  return igual ? 'Já existe a etiqueta "' + igual.nome + '" nesta equipe.' : null;
}

function _wetqOnline() {
  return (
    typeof isSupabaseConnected === 'function' &&
    isSupabaseConnected() &&
    typeof window !== 'undefined' &&
    !!window._supabaseAuthActive
  );
}

// Mesmo jeito das respostas prontas: grava local, tenta o banco na hora e, se
// falhar, o sync empurra depois (o registro local fica mais novo que o remoto).
function _wetqPush(tabela, op, linha) {
  if (!_wetqOnline() || typeof supabaseClient === 'undefined') return;
  const q =
    op === 'delete'
      ? supabaseClient.from(tabela).delete().eq('id', linha.id)
      : supabaseClient.from(tabela).upsert(linha);
  Promise.resolve(q)
    .then((res) => {
      if (res && res.error) {
        console.error('❌ Supabase ' + tabela + ':', res.error);
        if (typeof markSyncPushFailed === 'function') markSyncPushFailed();
      }
    })
    .catch(() => {
      if (typeof markSyncPushFailed === 'function') markSyncPushFailed();
    });
}

function _wetqGravar(chave, lista) {
  if (typeof dbSet === 'function') dbSet(chave, lista);
}

/**
 * Cria (sem id) ou edita. Devolve { etiqueta } ou { erro }. A equipe da linha
 * não muda na edição: admin editando a etiqueta de outra equipe não a puxa.
 */
function wetqSalvarEtiqueta(dados) {
  const lista = _wetqLer(WETQ_DB_ETIQUETAS);
  const i = dados && dados.id ? lista.findIndex((e) => e && e.id === dados.id) : -1;
  const team =
    i >= 0
      ? _wetqEquipe(lista[i].team)
      : _wetqEquipe(
          (dados && dados.team) || (typeof getCurrentTeam === 'function' && getCurrentTeam())
        );
  const erro = wetqValidar(Object.assign({}, dados, { team }), lista);
  if (erro) return { erro };
  const agora = new Date().toISOString();
  const nome = String(dados.nome).trim();
  let linha;
  if (i >= 0) {
    linha = Object.assign({}, lista[i], { nome, cor: dados.cor, updatedAt: agora });
    lista[i] = linha;
  } else {
    const u = typeof getUser === 'function' ? getUser() : null;
    linha = {
      id: 'wetq_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      nome,
      cor: dados.cor,
      team,
      createdBy: (u && u.name) || null,
      createdAt: agora,
      updatedAt: agora,
    };
    lista.push(linha);
  }
  _wetqGravar(WETQ_DB_ETIQUETAS, lista);
  _wetqPush('whatsapp_etiquetas', 'upsert', {
    id: linha.id,
    nome: linha.nome,
    cor: linha.cor,
    team: linha.team,
    created_by: linha.createdBy || null,
    updated_at: linha.updatedAt,
  });
  return { etiqueta: linha };
}

/** Apaga a etiqueta e tira ela das conversas (no banco, o cascade da 089). */
function wetqExcluirEtiqueta(id) {
  const lista = _wetqLer(WETQ_DB_ETIQUETAS);
  const alvo = lista.find((e) => e && e.id === id);
  if (!alvo) return false;
  _wetqGravar(
    WETQ_DB_ETIQUETAS,
    lista.filter((e) => e !== alvo)
  );
  const aplicadas = _wetqLer(WETQ_DB_APLICADAS);
  const sai = aplicadas.filter((a) => a && a.etiquetaId === id);
  if (sai.length) {
    _wetqGravar(
      WETQ_DB_APLICADAS,
      aplicadas.filter((a) => !sai.includes(a))
    );
    // Tombstone: o próximo sync não traz de volta o que o cascade já apagou.
    if (typeof _addTombstone === 'function')
      sai.forEach((a) => _addTombstone(WETQ_DB_APLICADAS, a.id));
  }
  if (typeof _addTombstone === 'function') _addTombstone(WETQ_DB_ETIQUETAS, id);
  _wetqPush('whatsapp_etiquetas', 'delete', alvo);
  return true;
}

// Id determinístico: o mesmo par conversa+etiqueta nunca vira duas linhas, nem
// marcado ao mesmo tempo em dois aparelhos (o índice único da 089 recusaria).
function wetqIdAplicada(team, chave, etiquetaId) {
  return 'wce:' + _wetqEquipe(team) + ':' + chave + ':' + etiquetaId;
}

/**
 * Liga/desliga a etiqueta na conversa (telefone + equipe). A etiqueta tem de
 * ser da mesma equipe da conversa — a policy da 089 recusa o contrário, e aqui
 * a recusa vem antes, sem ida ao banco. Devolve true (marcou), false
 * (desmarcou) ou null (não deu).
 */
function wetqAlternar(telefone, team, etiquetaId) {
  const chave = wetqChave(telefone);
  const eq = _wetqEquipe(team);
  const etq = wetqTodas().find((e) => e.id === etiquetaId);
  if (!chave || !etq || _wetqEquipe(etq.team) !== eq) return null;
  const id = wetqIdAplicada(eq, chave, etiquetaId);
  const lista = _wetqLer(WETQ_DB_APLICADAS);
  const atual = lista.find((a) => a && a.id === id);
  if (atual) {
    _wetqGravar(
      WETQ_DB_APLICADAS,
      lista.filter((a) => a !== atual)
    );
    if (typeof _addTombstone === 'function') _addTombstone(WETQ_DB_APLICADAS, id);
    _wetqPush('whatsapp_conversa_etiquetas', 'delete', atual);
    return false;
  }
  const agora = new Date().toISOString();
  const u = typeof getUser === 'function' ? getUser() : null;
  const linha = {
    id,
    telefone: chave,
    etiquetaId,
    team: eq,
    createdBy: (u && u.name) || null,
    createdAt: agora,
    updatedAt: agora,
  };
  lista.push(linha);
  _wetqGravar(WETQ_DB_APLICADAS, lista);
  if (typeof _removeTombstone === 'function') _removeTombstone(WETQ_DB_APLICADAS, id);
  _wetqPush('whatsapp_conversa_etiquetas', 'upsert', {
    id,
    telefone: chave,
    etiqueta_id: etiquetaId,
    team: eq,
    created_by: linha.createdBy,
    updated_at: agora,
  });
  return true;
}

// ── HTML ────────────────────────────────────────────────────────────────────

function _wetqCorClasse(cor) {
  return Object.prototype.hasOwnProperty.call(WETQ_CORES, cor) ? cor : 'cinza';
}

/** Chips das etiquetas. Mostra até `max` e resume o resto em "+N". */
function wetqChipsHTML(etiquetas, max) {
  const lista = etiquetas || [];
  if (!lista.length) return '';
  const limite = max || lista.length;
  const vis = lista.slice(0, limite);
  const resto = lista.length - vis.length;
  return (
    '<span class="wetq-chips">' +
    vis
      .map(
        (e) =>
          '<span class="wetq-chip wetq-cor-' +
          _wetqCorClasse(e.cor) +
          '">' +
          escapeHtml(e.nome) +
          '</span>'
      )
      .join('') +
    (resto > 0
      ? '<span class="wetq-chip wetq-mais" title="' +
        escapeHtml(
          lista
            .slice(limite)
            .map((e) => e.nome)
            .join(', ')
        ) +
        '">+' +
        resto +
        '</span>'
      : '') +
    '</span>'
  );
}

/** Gancho da Caixa: chips no item da lista e no cabeçalho da conversa. */
function wetqConversaChipsHTML(conversa, max) {
  return wetqChipsHTML(wetqDaConversa(conversa), max || 3);
}

/** Gancho da Caixa: botão "Etiquetas" nas ações (só WhatsApp tem etiqueta). */
function wetqBotaoHTML(conversa) {
  if (!conversa || conversa.canal !== 'whatsapp') return '';
  return (
    '<button type="button" class="btn cx-btn" data-action="wetqAbrir" data-arg="' +
    escapeHtml(conversa.id) +
    '">Etiquetas</button>'
  );
}

/** Gancho da Caixa: o seletor de etiqueta ao lado dos chips de canal. */
function wetqFiltroHTML() {
  const lista = wetqEtiquetas();
  if (!lista.length) return '';
  if (_wetqFiltro && !lista.some((e) => e.id === _wetqFiltro)) _wetqFiltro = '';
  return (
    '<select class="form-select wetq-filtro" data-change="wetqFiltro" aria-label="Filtrar por etiqueta">' +
    '<option value="">Todas as etiquetas</option>' +
    lista
      .map(
        (e) =>
          '<option value="' +
          escapeHtml(e.id) +
          '"' +
          (e.id === _wetqFiltro ? ' selected' : '') +
          '>' +
          escapeHtml(e.nome) +
          '</option>'
      )
      .join('') +
    '</select>'
  );
}

function _wetqCoresOptions(atual) {
  return Object.keys(WETQ_CORES)
    .map(
      (k) =>
        '<option value="' +
        k +
        '"' +
        (k === atual ? ' selected' : '') +
        '>' +
        escapeHtml(WETQ_CORES[k]) +
        '</option>'
    )
    .join('');
}

// Formulário de nova etiqueta, embutido nos dois modais. data-arg leva a equipe
// e o que reabrir depois de salvar.
function _wetqFormNovaHTML(team, volta) {
  return (
    '<form class="wetq-nova" data-submit="wetqCriar" data-arg="' +
    escapeHtml(volta) +
    '" data-team="' +
    escapeHtml(_wetqEquipe(team)) +
    '">' +
    '<input class="form-input" name="nome" maxlength="' +
    WETQ_NOME_MAX +
    '" placeholder="Nova etiqueta" aria-label="Nome da etiqueta" required />' +
    '<select class="form-select" name="cor" aria-label="Cor">' +
    _wetqCoresOptions('azul') +
    '</select>' +
    '<button type="submit" class="btn btn-primary btn-sm">Criar</button></form>'
  );
}

// Conversa da Caixa pelo id (a Caixa expõe _caixaConversaPorId).
function _wetqConversa(id) {
  return typeof _caixaConversaPorId === 'function' ? _caixaConversaPorId(id) : null;
}

function _wetqEquipeDaConversa(c) {
  return _wetqEquipe(c && c.ultima && c.ultima.team);
}

/** Modal da conversa: marca e desmarca as etiquetas da equipe dela. */
function wetqAbrir(convId) {
  const c = _wetqConversa(convId);
  if (!c || c.canal !== 'whatsapp') return;
  const team = _wetqEquipeDaConversa(c);
  const daEquipe = wetqEtiquetas(team);
  const marcadas = new Set(wetqDaConversa(c).map((e) => e.id));
  openModal(
    'Etiquetas da conversa',
    '<div class="wetq-modal">' +
      (daEquipe.length
        ? '<ul class="wetq-lista" role="list">' +
          daEquipe
            .map(
              (e) =>
                '<li><label class="wetq-opcao"><input type="checkbox" data-change="wetqMarcar" data-conv="' +
                escapeHtml(convId) +
                '" value="' +
                escapeHtml(e.id) +
                '"' +
                (marcadas.has(e.id) ? ' checked' : '') +
                ' /> ' +
                wetqChipsHTML([e]) +
                '</label></li>'
            )
            .join('') +
          '</ul>'
        : '<p class="ov-muted">Esta equipe ainda não tem etiquetas. Crie a primeira abaixo.</p>') +
      _wetqFormNovaHTML(team, 'conversa:' + convId) +
      '<div class="form-actions"><button type="button" class="btn btn-secondary" data-action="wetqGerenciar">Editar etiquetas</button>' +
      '<button type="button" class="btn btn-primary" data-action="closeModal">Pronto</button></div></div>'
  );
}

/** Modal de cadastro: renomear, trocar cor e apagar etiquetas da equipe. */
function wetqGerenciar() {
  const lista = wetqEtiquetas();
  const team =
    (typeof getCurrentTeam === 'function' && getCurrentTeam()) || (lista[0] && lista[0].team);
  openModal(
    'Etiquetas do WhatsApp',
    '<div class="wetq-modal">' +
      (lista.length
        ? '<ul class="wetq-lista" role="list">' +
          lista
            .map(
              (e) =>
                '<li><form class="wetq-edita" data-submit="wetqEditar" data-arg="' +
                escapeHtml(e.id) +
                '">' +
                '<input class="form-input" name="nome" maxlength="' +
                WETQ_NOME_MAX +
                '" value="' +
                escapeHtml(e.nome) +
                '" aria-label="Nome" required />' +
                '<select class="form-select" name="cor" aria-label="Cor">' +
                _wetqCoresOptions(e.cor) +
                '</select>' +
                '<button type="submit" class="btn btn-secondary btn-sm">Salvar</button>' +
                '<button type="button" class="btn btn-secondary btn-sm" data-action="wetqExcluir" data-arg="' +
                escapeHtml(e.id) +
                '">Apagar</button></form></li>'
            )
            .join('') +
          '</ul>'
        : '<p class="ov-muted">Nenhuma etiqueta ainda.</p>') +
      _wetqFormNovaHTML(team, 'gerenciar') +
      '<div class="form-actions"><button type="button" class="btn btn-primary" data-action="closeModal">Fechar</button></div></div>'
  );
}

/**
 * Redesenha só as telas abertas que mostram etiqueta ou nome de contato. É o
 * onChange das tabelas da 089 em js/schema.js (realtime e sync).
 */
function wetqRedesenharTelas() {
  if (typeof document === 'undefined') return;
  if (typeof renderCaixaEntrada === 'function' && document.getElementById('caixaLista'))
    renderCaixaEntrada();
  if (typeof renderWhatsappContatos === 'function' && document.getElementById('wcontTabela'))
    renderWhatsappContatos();
}

function _wetqRedesenhar() {
  wetqRedesenharTelas();
}

function _wetqVoltar(volta) {
  const v = String(volta || '');
  if (v.indexOf('conversa:') === 0) wetqAbrir(v.slice('conversa:'.length));
  else wetqGerenciar();
}

if (typeof registerActions === 'function') {
  registerActions({
    wetqAbrir: (_el, id) => wetqAbrir(id),
    wetqGerenciar: () => wetqGerenciar(),
    wetqFiltro: (_el, v) => {
      _wetqFiltro = String(v || '');
      _wetqRedesenhar();
    },
    // Checkbox: a delegação passa el.checked, então a conversa vem do data-conv.
    wetqMarcar: (el) => {
      const c = _wetqConversa(el.dataset.conv);
      if (!c) return;
      const r = wetqAlternar(c.telefone, _wetqEquipeDaConversa(c), el.value);
      if (r === null) {
        showToast('Esta etiqueta não é da equipe da conversa.', 'error');
        el.checked = !el.checked;
        return;
      }
      _wetqRedesenhar();
    },
    wetqCriar: (el, volta) => {
      const fd = new FormData(el);
      const r = wetqSalvarEtiqueta({
        nome: String(fd.get('nome') || ''),
        cor: String(fd.get('cor') || ''),
        team: el.dataset.team || null,
      });
      if (r.erro) {
        showToast(r.erro, 'error');
        return;
      }
      _wetqVoltar(volta);
      _wetqRedesenhar();
    },
    wetqEditar: (el, id) => {
      const fd = new FormData(el);
      const r = wetqSalvarEtiqueta({
        id,
        nome: String(fd.get('nome') || ''),
        cor: String(fd.get('cor') || ''),
      });
      if (r.erro) {
        showToast(r.erro, 'error');
        return;
      }
      showToast('Etiqueta salva.', 'success');
      _wetqRedesenhar();
    },
    wetqExcluir: (_el, id) => {
      const e = wetqTodas().find((x) => x.id === id);
      if (!e) return;
      if (
        typeof confirm === 'function' &&
        !confirm('Apagar a etiqueta "' + e.nome + '"? Ela sai de todas as conversas.')
      )
        return;
      wetqExcluirEtiqueta(id);
      if (_wetqFiltro === id) _wetqFiltro = '';
      wetqGerenciar();
      _wetqRedesenhar();
    },
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    WETQ_CORES,
    wetqChave,
    wetqEtiquetas,
    wetqDaConversa,
    wetqDoContato,
    wetqFiltrarConversas,
    wetqValidar,
    wetqSalvarEtiqueta,
    wetqExcluirEtiqueta,
    wetqAlternar,
    wetqIdAplicada,
    wetqChipsHTML,
    wetqFiltroHTML,
    _wetqFiltroSet: (v) => {
      _wetqFiltro = v;
    },
  };
}
