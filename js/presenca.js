// presenca.js — quem da equipe está com a Intra aberta agora.
// =====================================================================
// Usa o Presence do Supabase Realtime: cada aba anuncia o operador num
// canal da equipe e o servidor mantém a lista viva (quem fecha a aba ou
// perde a conexão some sozinho, sem tabela nem migration). Por isso o
// status é "melhor esforço": serve para saber quem está por perto, não
// como registro de ponto.
//
// O canal é por equipe (`presenca:<team>`), o mesmo recorte da RLS: um
// operador não vê quem está online em outra equipe.
//
// Sem Supabase (modo local) a lista tem só o próprio operador, para a UI
// não ficar vazia em demonstração.

/** Sem interação (ou com a aba escondida) por esse tempo, o status vira "ausente". */
const PRESENCA_AUSENTE_MS = 5 * 60 * 1000;

const PRESENCA_STATUS_LABEL = { online: 'Online', ausente: 'Ausente', offline: 'Offline' };

let _presChannel = null;
let _presLista = [];
let _presStatus = 'online';
let _presDesde = '';
let _presUltimaAtividade = Date.now();
let _presTimer = null;
let _presOuvintesLigados = false;
let _presPainelAberto = false;

/**
 * Converte o `presenceState()` do canal numa lista por operador (puro).
 * A mesma pessoa com duas abas aparece uma vez: online se qualquer aba
 * estiver online, e "desde" a conexão mais antiga.
 */
function presencaListaDoEstado(state) {
  const porOp = Object.create(null);
  Object.keys(state || {}).forEach((key) => {
    (state[key] || []).forEach((meta) => {
      if (!meta || !meta.opId) return;
      const atual = porOp[meta.opId];
      if (!atual) {
        porOp[meta.opId] = {
          opId: String(meta.opId),
          name: String(meta.name || ''),
          initials: String(meta.initials || ''),
          color: String(meta.color || ''),
          role: String(meta.role || ''),
          status: meta.status === 'ausente' ? 'ausente' : 'online',
          since: String(meta.since || ''),
        };
        return;
      }
      if (meta.status !== 'ausente') atual.status = 'online';
      if (meta.since && (!atual.since || meta.since < atual.since)) atual.since = meta.since;
    });
  });
  const ordem = { online: 0, ausente: 1 };
  return Object.keys(porOp)
    .map((k) => porOp[k])
    .sort(
      (a, b) =>
        ordem[a.status] - ordem[b.status] ||
        a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' })
    );
}

/** Status de um operador na lista atual: online, ausente ou offline. */
function presencaStatusDe(opId, lista) {
  const l = lista || _presLista;
  const p = l.find((x) => x.opId === String(opId));
  return p ? p.status : 'offline';
}

/** "Bom dia" / "Boa tarde" / "Boa noite" pela hora local (puro). */
function presencaSaudacao(hora) {
  if (hora >= 5 && hora < 12) return 'Bom dia';
  if (hora >= 12 && hora < 18) return 'Boa tarde';
  return 'Boa noite';
}

/** Iniciais de reserva quando o operador não tem as suas cadastradas (puro). */
function presencaIniciais(p) {
  if (p && p.initials) return String(p.initials).slice(0, 2).toUpperCase();
  const partes = String((p && p.name) || '?')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!partes.length) return '?';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[1][0]).toUpperCase();
}

function _presHoraCurta(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function _presMeta() {
  const s = typeof getSession === 'function' ? getSession() : null;
  if (!s || !s.opId) return null;
  return {
    opId: String(s.opId),
    name: s.name || '',
    initials: s.initials || '',
    color: s.color || '',
    role: s.role || '',
    status: _presStatus,
    since: _presDesde,
  };
}

function _presCor(p) {
  if (p.color && /^#[0-9a-f]{3,8}$/i.test(p.color)) return p.color;
  return typeof getOpAvatarColor === 'function' ? getOpAvatarColor(p.name) : '#1a56db';
}

/** Avatar com o ponto de status. Tudo que vem do canal passa por escapeHtml. */
function presencaAvatarHtml(p, extraClass) {
  const label = PRESENCA_STATUS_LABEL[p.status] || '';
  return `<span class="pres-av ${extraClass || ''}" data-sty="background:${escapeHtml(_presCor(p))}" title="${escapeHtml(p.name)} · ${label}">${escapeHtml(presencaIniciais(p))}<i class="pres-dot pres-dot--${p.status}" aria-hidden="true"></i></span>`;
}

/** Lista "Equipe online" (painel do topo e card do dashboard). */
function presencaListaHtml(lista) {
  const l = lista || _presLista;
  if (!l.length) return '<p class="pres-vazio">Ninguém conectado agora.</p>';
  const meuId = (_presMeta() || {}).opId;
  return `<ul class="pres-lista">${l
    .map((p) => {
      const desde = _presHoraCurta(p.since);
      const sub =
        p.status === 'ausente' ? 'Ausente' : desde ? `Online desde ${desde}` : 'Online agora';
      return `<li class="pres-item">
        ${presencaAvatarHtml(p)}
        <span class="pres-item-txt">
          <span class="pres-item-nome">${escapeHtml(p.name)}${p.opId === meuId ? ' <span class="pres-voce">você</span>' : ''}</span>
          <span class="pres-item-sub">${escapeHtml(p.role || 'Técnico')} · ${sub}</span>
        </span>
      </li>`;
    })
    .join('')}</ul>`;
}

/** Repinta tudo que mostra presença: topo, cartão do usuário, operadores e dashboard. */
function presencaRepintar() {
  const online = _presLista.filter((p) => p.status === 'online').length;

  const stack = document.getElementById('presStack');
  if (stack) {
    const max = 4;
    const avs = _presLista
      .slice(0, max)
      .map((p) => presencaAvatarHtml(p, 'pres-av--stack pres-av--' + p.status))
      .join('');
    const extra =
      _presLista.length > max ? `<span class="pres-mais">+${_presLista.length - max}</span>` : '';
    stack.innerHTML = `<span class="pres-avs">${avs}${extra}</span><span class="pres-cont"><b>${online}</b> online</span>`;
    stack.setAttribute(
      'aria-label',
      `${online} ${online === 1 ? 'pessoa online' : 'pessoas online'} na equipe — ver quem`
    );
    stack.hidden = !_presLista.length;
  }

  const painel = document.getElementById('presPanelBody');
  if (painel) {
    painel.innerHTML = presencaListaHtml();
  }

  const card = document.getElementById('dashPresenca');
  if (card) {
    card.innerHTML = presencaListaHtml();
  }
  const cardCont = document.getElementById('dashPresencaCont');
  if (cardCont) cardCont.textContent = `${online} online`;

  const meuDot = document.getElementById('userPresDot');
  if (meuDot) {
    meuDot.className = 'pres-dot pres-dot--' + _presStatus;
    meuDot.title = PRESENCA_STATUS_LABEL[_presStatus];
  }
  const meuStatus = document.getElementById('userPresLabel');
  if (meuStatus) meuStatus.textContent = PRESENCA_STATUS_LABEL[_presStatus];

  // Cards da tela Operadores: só troca a classe do ponto, sem repintar a tela.
  document.querySelectorAll('[data-pres-op]').forEach((el) => {
    const st = presencaStatusDe(el.getAttribute('data-pres-op'));
    el.className = 'pres-dot pres-dot--' + st;
    el.title = PRESENCA_STATUS_LABEL[st];
  });
}

function _presAtualizarLista() {
  if (_presChannel && typeof _presChannel.presenceState === 'function') {
    _presLista = presencaListaDoEstado(_presChannel.presenceState());
  } else {
    const eu = _presMeta();
    _presLista = eu ? presencaListaDoEstado({ local: [eu] }) : [];
  }
  presencaRepintar();
}

function _presAnunciar() {
  const meta = _presMeta();
  if (!meta) return;
  if (_presChannel) {
    try {
      _presChannel.track(meta);
    } catch (_e) {
      if (typeof _logSilent === 'function') _logSilent(_e, 'presenca');
    }
  } else {
    _presAtualizarLista();
  }
}

function _presDefinirStatus(st) {
  if (st === _presStatus) return;
  _presStatus = st;
  _presAnunciar();
  presencaRepintar();
}

function _presVerificarInatividade() {
  const escondida = document.visibilityState === 'hidden';
  const parado = Date.now() - _presUltimaAtividade >= PRESENCA_AUSENTE_MS;
  _presDefinirStatus(escondida || parado ? 'ausente' : 'online');
}

function _presAtividade() {
  _presUltimaAtividade = Date.now();
  if (_presStatus !== 'online' && document.visibilityState !== 'hidden')
    _presDefinirStatus('online');
}

function _presLigarOuvintes() {
  if (_presOuvintesLigados) return;
  _presOuvintesLigados = true;
  // Atividade só marca a hora (barato); quem decide o status é o timer.
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((ev) =>
    document.addEventListener(ev, _presAtividade, { passive: true, capture: true })
  );
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') _presAtividade();
  });
  document.addEventListener('click', (e) => {
    if (!_presPainelAberto) return;
    const wrap = document.getElementById('presWrap');
    // composedPath() é o caminho no momento do disparo: o toggle repinta a
    // pilha e o alvo original já pode ter saído do DOM quando isto roda.
    const caminho = typeof e.composedPath === 'function' ? e.composedPath() : [e.target];
    if (wrap && caminho.indexOf(wrap) === -1) presencaFecharPainel();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && _presPainelAberto) presencaFecharPainel();
  });
}

/** Entra no canal da equipe. Chamado no início do app (login ou sessão restaurada). */
function iniciarPresenca() {
  const meta = _presMeta();
  if (!meta) return;
  pararPresenca();
  _presStatus = 'online';
  _presDesde = new Date().toISOString();
  _presUltimaAtividade = Date.now();
  _presLigarOuvintes();
  _presTimer = setInterval(_presVerificarInatividade, 30 * 1000);

  const s = getSession();
  const podeConectar =
    typeof supabaseClient !== 'undefined' && supabaseClient && window._supabaseAuthActive;
  if (!podeConectar) {
    _presAtualizarLista();
    return;
  }
  try {
    const ch = supabaseClient.channel('presenca:' + (s.team || 'init'), {
      config: { presence: { key: meta.opId } },
    });
    ch.on('presence', { event: 'sync' }, _presAtualizarLista);
    ch.subscribe((st) => {
      if (st === 'SUBSCRIBED') _presAnunciar();
    });
    _presChannel = ch;
  } catch (_e) {
    _presChannel = null;
    if (typeof _logSilent === 'function') _logSilent(_e, 'presenca');
  }
  // Mostra o próprio operador já, sem esperar o primeiro sync do servidor.
  if (!_presLista.length) {
    _presLista = presencaListaDoEstado({ local: [_presMeta()] });
    presencaRepintar();
  }
}

/** Sai do canal (logout). */
function pararPresenca() {
  if (_presTimer) clearInterval(_presTimer);
  _presTimer = null;
  if (_presChannel) {
    try {
      _presChannel.untrack();
      supabaseClient.removeChannel(_presChannel);
    } catch (_e) {
      if (typeof _logSilent === 'function') _logSilent(_e, 'presenca');
    }
  }
  _presChannel = null;
  _presLista = [];
  presencaFecharPainel();
  presencaRepintar();
}

function presencaFecharPainel() {
  _presPainelAberto = false;
  const p = document.getElementById('presPanel');
  if (p) p.hidden = true;
  const b = document.getElementById('presStack');
  if (b) b.setAttribute('aria-expanded', 'false');
}

function presencaAlternarPainel() {
  if (_presPainelAberto) {
    presencaFecharPainel();
    return;
  }
  _presPainelAberto = true;
  presencaRepintar();
  const p = document.getElementById('presPanel');
  if (p) p.hidden = false;
  const b = document.getElementById('presStack');
  if (b) b.setAttribute('aria-expanded', 'true');
}

if (typeof registerActions === 'function') {
  registerActions({
    presToggle: () => presencaAlternarPainel(),
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    presencaListaDoEstado,
    presencaStatusDe,
    presencaSaudacao,
    presencaIniciais,
    PRESENCA_AUSENTE_MS,
  };
}
