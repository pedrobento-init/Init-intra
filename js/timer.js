// timer.js – Sistema "Quem está trabalhando nesta pendência?"

/**
 * Escapa aspas simples para uso em strings JS dentro de atributos HTML onclick
 */
function _jsEscape(str) {
  return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Retorna o nome do operador que está trabalhando ativamente no item
 */
function getCurrentWorker(item) {
  if (item?.timerRunning && item?.timerOperator) {
    return item.timerOperator;
  }
  return null;
}

/**
 * Verifica se o usuário logado é quem está trabalhando no item
 */
function isCurrentWorker(item) {
  const worker = getCurrentWorker(item);
  if (!worker) return false;
  const user = getUser();
  return worker === user?.name;
}

/**
 * Retorna o tempo total decorrido (em segundos)
 */
function getElapsedSeconds(item) {
  let total = item?.timerTotalSeconds || 0;
  if (item?.timerRunning && item?.timerStartedAt) {
    const started = new Date(item.timerStartedAt).getTime();
    total += Math.max(0, Math.floor((Date.now() - started) / 1000));
  }
  return total;
}

/**
 * Formata segundos em HH:MM:SS
 */
function formatTimer(totalSeconds) {
  if (!totalSeconds || totalSeconds < 0) totalSeconds = 0;
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

/**
 * Nota de sessão encerrada pela conclusão (o cronômetro para sozinho ao
 * fechar a pendência). Mesmo formato "Sessão registrada: HH:MM:SS" do ajuste:
 * é das notas de sessão que o relatório mensal tira as horas do período.
 */
function timerClosedSessionNote(operator, sessionSeconds, totalSeconds) {
  const me = (typeof getUser === 'function' && getUser() && getUser().name) || operator || 'Operador';
  return {
    text: `⏹ Cronômetro de ${operator || me} parado ao concluir. Sessão registrada: ${formatTimer(sessionSeconds)}. Total: ${formatTimer(totalSeconds)}.`,
    author: me,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Versão curta para cards: até 24h igual a formatTimer; acima disso "8d 21h"
 * ("213:06:51" não se lê de relance).
 */
function formatTimerCompact(totalSeconds) {
  const t = Number(totalSeconds) || 0;
  if (t < 86400) return formatTimer(t);
  const d = Math.floor(t / 86400);
  const h = Math.floor((t % 86400) / 3600);
  return d + 'd ' + h + 'h';
}

// Sessão ligada além disto = provável cronômetro esquecido.
const TIMER_FORGOTTEN_SECONDS = 10 * 3600;

/** Segundos da sessão atual (desde o último play), 0 se parado. */
function getSessionSeconds(item) {
  if (!item?.timerRunning || !item?.timerStartedAt) return 0;
  const started = new Date(item.timerStartedAt).getTime();
  if (!Number.isFinite(started)) return 0;
  return Math.max(0, Math.floor((Date.now() - started) / 1000));
}

function isTimerForgotten(item) {
  return getSessionSeconds(item) >= TIMER_FORGOTTEN_SECONDS;
}

/** "8 dias", "1 dia e 3h", "14h" — para textos de alerta. */
function formatDurationWords(totalSeconds) {
  const t = Math.max(0, Number(totalSeconds) || 0);
  const d = Math.floor(t / 86400);
  const h = Math.floor((t % 86400) / 3600);
  const m = Math.floor((t % 3600) / 60);
  if (d > 0) return d + (d === 1 ? ' dia' : ' dias') + (h ? ' e ' + h + 'h' : '');
  if (h > 0) return h + 'h' + (m ? ' ' + String(m).padStart(2, '0') + 'min' : '');
  return m + 'min';
}

/** Texto do display conforme o formato pedido pelo elemento. */
function _timerText(el, item) {
  const secs = getElapsedSeconds(item);
  return el && el.dataset && el.dataset.format === 'compact' ? formatTimerCompact(secs) : formatTimer(secs);
}

/**
 * HTML do display de tempo
 */
function timerDisplayHTML(item) {
  const seconds = getElapsedSeconds(item);
  const running = item?.timerRunning ? 'true' : 'false';
  return `<span class="timer-display" data-timer-id="${escapeHtml(item.id)}" data-running="${running}">${formatTimer(seconds)}</span>`;
}

/**
 * Indicador textual de quem está trabalhando
 */
function workerBadgeHTML(item) {
  const worker = getCurrentWorker(item);
  if (!worker) return '';
  const itsMe = isCurrentWorker(item);
  return `<span class="worker-badge ${itsMe ? 'worker-me' : 'worker-other'}" title="${itsMe ? 'Você está trabalhando neste item' : escapeHtml(worker) + ' está trabalhando neste item'}">${itsMe ? '🟢 Você' : '🟢 ' + escapeHtml(worker)}</span>`;
}

/**
 * Botão de ação (play, pause, ou bloqueado)
 */
function timerActionBtnHTML(item, type = 'pendencia') {
  const worker = getCurrentWorker(item);
  const itsMe = isCurrentWorker(item);

  if (!worker) {
    // Ninguém trabalhando — play com rótulo coerente com o status (mesma ação/funcionalidade).
    // aberto: iniciar move para em_andamento; em_andamento parado: retomar mantém o status.
    var _st = item && item.status;
    var _playTitle = _st === 'aberto' ? 'Iniciar atendimento (move para Em Andamento)'
      : _st === 'em_andamento' ? 'Retomar trabalho (já em andamento)'
      : _st === 'pausado' ? 'Retomar trabalho (move para Em Andamento)'
      : 'Iniciar trabalho neste chamado';
    return `<button class="timer-btn" title="${_playTitle}" onclick="toggleTimer('${type}','${_jsEscape(item.id)}',this)">▶</button>`;
  }

  if (itsMe) {
    // Sou eu trabalhando — mostrar pause
    return `<button class="timer-btn running" title="Pausar trabalho" onclick="toggleTimer('${type}','${_jsEscape(item.id)}',this)">⏸</button>`;
  }

  // Outro operador trabalhando — mostrar bloqueado/desabilitado
  return `<button class="timer-btn" disabled title="${escapeHtml(worker)} já está trabalhando neste item" style="opacity:.5;cursor:not-allowed">🔒</button>`;
}

/**
 * Status final (resolvido/fechado/...) — fonte única isPendenciaClosed quando
 * disponível, com fallback para não quebrar em testes/ordem de scripts.
 */
function _isTimerClosedStatus(status) {
  try {
    if (typeof isPendenciaClosed === 'function') return isPendenciaClosed(status);
  } catch (_) {}
  return ['concluido', 'resolvido', 'cancelado', 'fechado'].includes(status || '');
}

/**
 * Widget completo (botão + indicador + tempo)
 * Em chamado finalizado não há ação de execução: exibe só o tempo acumulado,
 * sem botão play/pause, para não sugerir que ainda está em andamento.
 */
function timerWidget(item, type = 'pendencia') {
  var _wid = '';
  try { _wid = (typeof escapeHtml === 'function') ? escapeHtml(item && item.id) : String((item && item.id) || ''); } catch (_) { _wid = String((item && item.id) || ''); }
  if (item && _isTimerClosedStatus(item.status)) {
    const secs = getElapsedSeconds(item);
    return `<span class="timer-widget" data-timer-widget="${_wid}" title="Tempo total trabalhado (chamado finalizado)"><span style="font-size:11px;color:var(--text-muted)">⏱ ${formatTimer(secs)}</span></span>`;
  }
  const worker = getCurrentWorker(item);
  if (!worker) {
    return `<span class="timer-widget" data-timer-widget="${_wid}">${timerActionBtnHTML(item, type)} <span style="font-size:11px;color:var(--text-muted)" title="Ninguém trabalhando agora">Ninguém</span></span>`;
  }
  return `<span class="timer-widget" data-timer-widget="${_wid}">${timerActionBtnHTML(item, type)} ${workerBadgeHTML(item)} ${timerDisplayHTML(item)}</span>`;
}

/**
 * Alterna play/pause com lógica de atribuição de operador.
 * Single-write: a nota de timeline vai embutida no mesmo save (evita a
 * corrida upsert x update que fazia a UI voltar ao estado antigo).
 * Não muta a referência viva do cache — trabalha sobre cópia.
 */
function toggleTimer(type, id, btnEl) {
  const now = new Date().toISOString();
  const isTicket = type === 'ticket';
  const cur = isTicket ? getTicketById(id) : getPendenciaById(id);
  const saveFn = isTicket ? saveTicket : savePendencia;
  const renderFn = renderPenView;
  const updateLabel = 'Pendência';

  if (!cur) { showToast('Item não encontrado.', 'error'); return; }

  // Chamado finalizado não pode iniciar/retomar execução pelo card.
  // Reabra (mude o status) para voltar a trabalhar — evita resolvido com timer rodando.
  if (_isTimerClosedStatus(cur.status)) {
    showToast('Chamado finalizado — reabra para retomar o trabalho.', 'info');
    return;
  }

  const user = getUser();
  const myName = user?.name || 'Operador';
  const worker = getCurrentWorker(cur);

  if (worker && worker !== myName) {
    showToast(`Este item já está sendo trabalhado por ${worker}.`, 'warning');
    return;
  }

  // Anti duplo-clique: o botão antigo será substituído pelo full refresh abaixo.
  if (btnEl && !btnEl.disabled) { try { btnEl.disabled = true; } catch (_) {} }

  try {
    if (worker && worker === myName) {
      // PAUSAR — mover para coluna "Pausado"
      const started = cur.timerStartedAt ? new Date(cur.timerStartedAt).getTime() : Date.now();
      const elapsed = Math.max(0, Math.floor((Date.now() - started) / 1000));
      const total = (Number(cur.timerTotalSeconds) || 0) + elapsed;
      const note = { text: `⏸ ${myName} pausou. Tempo sessão: ${formatTimer(elapsed)}. Total: ${formatTimer(total)}.`, author: myName, createdAt: now };
      const next = {
        ...cur,
        timerTotalSeconds: total,
        timerRunning: false,
        timerStartedAt: null,
        timerOperator: null,
        status: 'pausado',
        notes: [...(cur.notes || []), note],
        updatedAt: now,
      };
      saveFn(next);
      showToast('Trabalho pausado — item movido para Pausados.', 'info');
    } else {
      // INICIAR
      const next = {
        ...cur,
        timerRunning: true,
        timerOperator: myName,
        timerStartedAt: now,
        timerTotalSeconds: (typeof cur.timerTotalSeconds === 'number') ? cur.timerTotalSeconds : 0,
        responsible: cur.responsible || myName,
        status: (cur.status === 'pausado' || cur.status === 'aberto') ? 'em_andamento' : cur.status,
        notes: [...(cur.notes || []), { text: `▶ ${myName} iniciou o trabalho nesta ${updateLabel.toLowerCase()}.`, author: myName, createdAt: now }],
        updatedAt: now,
      };
      saveFn(next);
      showToast(`Você iniciou o trabalho nesta ${updateLabel.toLowerCase()}!`, 'success');
    }
  } finally {
    try { if (btnEl && btnEl.isConnected) btnEl.disabled = false; } catch (_) {}
  }

  _refreshTimerFull(id, type);
  if (typeof renderFn === 'function') { try { renderFn(); } catch (_) {} }
  if (typeof updateDashboardBadge === 'function') { try { updateDashboardBadge(); } catch (_) {} }
  else if (typeof updateBadges === 'function') { try { updateBadges(); } catch (_) {} }
}

/**
 * "Parar e ajustar tempo": encerra uma sessão (normalmente esquecida ligada)
 * gravando só o tempo real informado, em vez de somar dias de relógio aos
 * relatórios de horas. Pode o próprio operador da sessão ou um admin.
 */
function _canAdjustTimer(item) {
  const worker = getCurrentWorker(item);
  if (!worker) return false;
  if (worker === getUser()?.name) return true;
  try { return typeof isCurrentAdmin === 'function' && isCurrentAdmin(); } catch (_) { return false; }
}

function openTimerAdjust(id) {
  const item = getPendenciaById(id);
  if (!item || !item.timerRunning) return;
  if (!_canAdjustTimer(item)) {
    showToast('Só ' + (getCurrentWorker(item) || 'quem iniciou') + ' ou um administrador pode parar este cronômetro.', 'warning');
    return;
  }
  const session = getSessionSeconds(item);
  // Sugestão: a sessão inteira se for plausível; senão 8h (jornada) — o
  // operador corrige para o tempo real.
  const suggested = Math.min(session, 8 * 3600);
  const sh = Math.floor(suggested / 3600);
  const sm = Math.round((suggested % 3600) / 60 / 5) * 5;
  const started = item.timerStartedAt ? new Date(item.timerStartedAt) : null;
  const startedTxt = started ? started.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
  openModal('Parar e ajustar tempo', `
    <p style="font-size:13px;color:var(--text-secondary);margin-bottom:14px">
      O cronômetro de <strong>${escapeHtml(getCurrentWorker(item))}</strong> está ligado desde
      <strong>${escapeHtml(startedTxt)}</strong> (${escapeHtml(formatDurationWords(session))}).
      Informe quanto tempo foi realmente trabalhado nesta sessão — só isso entra no total.
    </p>
    <div class="form-row">
      <div class="form-group"><label class="form-label" for="timerAdjH">Horas</label>
        <input type="number" class="form-input" id="timerAdjH" min="0" max="999" step="1" value="${sh}" /></div>
      <div class="form-group"><label class="form-label" for="timerAdjM">Minutos</label>
        <input type="number" class="form-input" id="timerAdjM" min="0" max="59" step="5" value="${Math.min(sm, 55)}" /></div>
    </div>
    <p style="font-size:12px;color:var(--text-muted);margin:-4px 0 14px">Total antes desta sessão: ${escapeHtml(formatDurationWords(Number(item.timerTotalSeconds) || 0))}. A pendência vai para Pausado.</p>
    <div class="form-actions">
      <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
      <button type="button" class="btn btn-primary" onclick="submitTimerAdjust('${_jsEscape(id)}')">Parar e salvar</button>
    </div>`, 'sm');
}

function submitTimerAdjust(id) {
  const cur = getPendenciaById(id);
  if (!cur || !cur.timerRunning) { closeModal(); return; }
  if (!_canAdjustTimer(cur)) { showToast('Permissão negada.', 'error'); return; }
  const h = Math.max(0, parseInt(document.getElementById('timerAdjH')?.value, 10) || 0);
  const m = Math.min(59, Math.max(0, parseInt(document.getElementById('timerAdjM')?.value, 10) || 0));
  const sessionReal = Math.min(h * 3600 + m * 60, getSessionSeconds(cur));
  const total = (Number(cur.timerTotalSeconds) || 0) + sessionReal;
  const now = new Date().toISOString();
  const me = getUser()?.name || 'Operador';
  const note = {
    text: `⏹ ${me} parou o cronômetro de ${getCurrentWorker(cur)} (ligado há ${formatDurationWords(getSessionSeconds(cur))}). Sessão registrada: ${formatTimer(sessionReal)}. Total: ${formatTimer(total)}.`,
    author: me, createdAt: now,
  };
  savePendencia({
    ...cur,
    timerTotalSeconds: total,
    timerRunning: false,
    timerStartedAt: null,
    timerOperator: null,
    status: 'pausado',
    notes: [...(cur.notes || []), note],
    updatedAt: now,
  });
  closeModal();
  showToast('Cronômetro parado — tempo ajustado.', 'success');
  _refreshTimerFull(id, 'pendencia');
  if (typeof renderPenView === 'function') { try { renderPenView(); } catch (_) {} }
}

/**
 * Atualiza no DOM os displays de um timer específico
 */
function _refreshTimerUI(id) {
  const displays = document.querySelectorAll(`[data-timer-id="${id}"]`);
  const item = getPendenciaById(id);
  if (!item) return;
  const seconds = getElapsedSeconds(item);
  const running = item.timerRunning ? 'true' : 'false';
  displays.forEach(el => {
    el.textContent = el.dataset.format === 'compact' ? formatTimerCompact(seconds) : formatTimer(seconds);
    el.dataset.running = running;
  });
}

/**
 * Full refresh de um timer: botão ▶/⏸/🔒 + badge de worker + display +
 * bloco "Trabalhando agora" do modal de detalhe (se aberto para este id).
 * Chamado logo após toggleTimer para feedback imediato, sem esperar o
 * fetch do servidor convergir.
 */
function _refreshTimerFull(id, type) {
  var t = type || 'pendencia';
  var isTicket = t === 'ticket';
  var item = null;
  try { item = isTicket ? getTicketById(id) : getPendenciaById(id); } catch (_) { item = null; }
  if (!item) return;
  // 1. Displays (texto do cronômetro)
  try { _refreshTimerUI(id); } catch (_) {}
  // 2. Widgets completos (botão + badge + tempo) nos cards e no modal
  try {
    var widgets = document.querySelectorAll('[data-timer-widget]');
    widgets.forEach(function(w) {
      try {
        if (w.getAttribute('data-timer-widget') !== String(id)) return;
        var tmp = document.createElement('span');
        tmp.innerHTML = timerWidget(item, t);
        var fresh = tmp.firstChild;
        if (fresh) w.replaceWith(fresh);
      } catch (_) {}
    });
  } catch (_) {}
  // 3. Bloco "Trabalhando agora" do modal de detalhe (se aberto para este id)
  try {
    var overlay = document.getElementById('modalOverlay');
    var modalVisible = overlay && overlay.style.display !== 'none';
    if (modalVisible && document.querySelector('#modalBody [data-timer-widget]')) {
      var workBox = document.querySelector('#modalBody .pen-work');
      if (workBox) {
        var w2 = getCurrentWorker(item);
        workBox.classList.toggle('is-working', !!w2);
        workBox.classList.toggle('is-free', !w2);
        var valEl = workBox.querySelector('.pen-work-value');
        if (valEl) {
          if (w2) {
            var esc = (typeof escapeHtml === 'function') ? escapeHtml(w2) : String(w2);
            valEl.innerHTML = '<strong>' + esc + '</strong> <span class="pen-work-time">' + timerDisplayHTML(item) + '</span>';
          } else {
            valEl.innerHTML = '<strong>Ninguém</strong> <span class="pen-work-hint">· Disponível</span>';
          }
        }
        var timeEl = workBox.querySelector('.pen-time');
        if (timeEl) {
          var secs = getElapsedSeconds(item);
          var friendly = formatTimer(secs);
          try {
            if (typeof _penFriendlyTime === 'function') {
              var ft = _penFriendlyTime(item);
              if (ft && ft.friendly) friendly = ft.friendly;
            } else if (typeof formatElapsedFriendly === 'function') {
              friendly = formatElapsedFriendly(secs);
            }
          } catch (_) {}
          timeEl.textContent = '⏱ ' + friendly;
        }
      }
    }
  } catch (_) {}
  // 4. Badges da sidebar
  try {
    if (typeof updateBadges === 'function') updateBadges();
  } catch (_) {}
}

/**
 * Intervalo global que atualiza timers ativos a cada segundo
 */
let _timerInterval = null;

function _startTimerInterval() {
  if (_timerInterval) return;
  _timerInterval = setInterval(() => {
    const activeDisplays = document.querySelectorAll('.timer-display[data-running="true"]');
    activeDisplays.forEach(el => {
      const id = el.dataset.timerId;
      const item = getPendenciaById(id);
      if (item && item.timerRunning) {
        el.textContent = _timerText(el, item);
      } else {
        el.dataset.running = 'false';
      }
    });
  }, 1000);
}

function _stopTimerInterval() {
  if (_timerInterval) {
    clearInterval(_timerInterval);
    _timerInterval = null;
  }
}

_startTimerInterval();

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    _stopTimerInterval();
  } else {
    _startTimerInterval();
  }
});

// Aliases de compatibilidade para uso nos modais
function timerButtonHTML(item, type) { return timerActionBtnHTML(item, type); }
