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
  return `<span class="worker-badge ${itsMe ? 'worker-me' : 'worker-other'}" title="${itsMe ? 'Você está trabalhando neste item' : worker + ' está trabalhando neste item'}">${itsMe ? '🟢 Você' : '🟢 ' + escapeHtml(worker)}</span>`;
}

/**
 * Botão de ação (play, pause, ou bloqueado)
 */
function timerActionBtnHTML(item, type = 'pendencia') {
  const worker = getCurrentWorker(item);
  const itsMe = isCurrentWorker(item);

  if (!worker) {
    // Ninguém trabalhando — mostrar play
    return `<button class="timer-btn" title="Iniciar trabalho nesta pendência" onclick="toggleTimer('${type}','${_jsEscape(item.id)}',this)">▶</button>`;
  }

  if (itsMe) {
    // Sou eu trabalhando — mostrar pause
    return `<button class="timer-btn running" title="Pausar trabalho" onclick="toggleTimer('${type}','${_jsEscape(item.id)}',this)">⏸</button>`;
  }

  // Outro operador trabalhando — mostrar bloqueado/desabilitado
  return `<button class="timer-btn" disabled title="${escapeHtml(worker)} já está trabalhando neste item" style="opacity:.5;cursor:not-allowed">🔒</button>`;
}

/**
 * Widget completo (botão + indicador + tempo)
 */
function timerWidget(item, type = 'pendencia') {
  const worker = getCurrentWorker(item);
  if (!worker) {
    return `<span class="timer-widget">${timerActionBtnHTML(item, type)} <span style="font-size:11px;color:var(--text-muted)">Ninguém</span></span>`;
  }
  return `<span class="timer-widget">${timerActionBtnHTML(item, type)} ${workerBadgeHTML(item)} ${timerDisplayHTML(item)}</span>`;
}

/**
 * Alterna play/pause com lógica de atribuição de operador
 */
function toggleTimer(type, id, btnEl) {
  const now = new Date().toISOString();
  const item = getPendenciaById(id);
  const saveFn = savePendencia;
  const renderFn = renderPenView;
  const addUpdateFn = addPendenciaNote;
  const updateLabel = 'Pendência';

  if (!item) { showToast('Item não encontrado.', 'error'); return; }

  const user = getUser();
  const myName = user?.name || 'Operador';
  const worker = getCurrentWorker(item);

  if (worker && worker !== myName) {
    showToast(`Este item já está sendo trabalhado por ${worker}.`, 'warning');
    return;
  }

  if (worker && worker === myName) {
    // PAUSAR — mover para coluna "Pausado"
    const started = new Date(item.timerStartedAt).getTime();
    const elapsed = Math.max(0, Math.floor((Date.now() - started) / 1000));
    item.timerTotalSeconds = (item.timerTotalSeconds || 0) + elapsed;
    item.timerRunning = false;
    item.timerStartedAt = null;
    item.timerOperator = null;
    item.status = 'pausado';
    saveFn(item);
    if (typeof addUpdateFn === 'function') {
      addUpdateFn(id, `⏸ ${myName} pausou. Tempo sessão: ${formatTimer(elapsed)}. Total: ${formatTimer(item.timerTotalSeconds)}.`, myName);
    }
    showToast('Trabalho pausado — item movido para Pausados.', 'info');
  } else {
    // INICIAR
    item.timerRunning = true;
    item.timerOperator = myName;
    item.timerStartedAt = now;
    if (typeof item.timerTotalSeconds !== 'number') item.timerTotalSeconds = 0;

    if (!item.responsible) {
      item.responsible = myName;
    }

    if (item.status === 'pausado' || item.status === 'aberto') {
      item.status = 'em_andamento';
    }

    saveFn(item);
    if (typeof addUpdateFn === 'function') {
      addUpdateFn(id, `▶ ${myName} iniciou o trabalho nesta ${updateLabel.toLowerCase()}.`, myName);
    }
    showToast(`Você iniciou o trabalho nesta ${updateLabel.toLowerCase()}!`, 'success');
  }

  _refreshTimerUI(id);
  if (typeof renderFn === 'function') renderFn();
  if (typeof updateDashboardBadge === 'function') updateDashboardBadge();
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
    el.textContent = formatTimer(seconds);
    el.dataset.running = running;
  });
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
        el.textContent = formatTimer(getElapsedSeconds(item));
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
