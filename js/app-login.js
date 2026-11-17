// app-login.js — login, logout, boot de sessão e start do app.
// Extraído de app.js sem mudança de lógica; carrega antes de app.js (que roda init()).

// ── Login / Logout ─────────────────────────────────────────────────────────────
let _appStarted = false;

function _startApp() {
  if (typeof getCacheKV === 'function') {
    _selectedTeam = getCacheKV('intra_selected_team', '');
  }
  initTeamSelector();
  updateUserUI();
  updateBadges();

  if (typeof initSupabaseRealtime === 'function') {
    try {
      initSupabaseRealtime();
    } catch (_e) {
      if (typeof _logSilent === 'function') _logSilent(_e, 'app');
    }
  }

  var isAdmin = typeof isCurrentAdmin === 'function' && isCurrentAdmin();
  if (!isAdmin) {
    // Dashboard visível p/ todos (blocos de gestão filtrados no render);
    // histórico segue restrito.
    var histNav = document.getElementById('nav-historico');
    if (histNav) histNav.style.display = 'none';
  }
  if (typeof updateRelatoriosVisibility === 'function') updateRelatoriosVisibility();
  if (typeof setSidebarMoreAdmin === 'function') setSidebarMoreAdmin(isAdmin);

  const hash = window.location.hash.replace('#', '');
  const pages = [
    'fila',
    'dashboard',
    'prazos',
    'vencimentos',
    'conhecimento',
    'clientes',
    'pendencias',
    'caixa',
    'calendario',
    'operadores',
    'relatorios',
    'equipamentos',
    'historico',
    'templates',
    'visitas',
    'reuniao',
  ];
  // Tela inicial: gestão (admin/supervisor) cai no Dashboard; quem está no
  // dia a dia cai na Minha fila.
  const homePage = typeof isTeamAdmin === 'function' && isTeamAdmin() ? 'dashboard' : 'fila';
  // Números amigáveis antes da primeira pintura (local, sem rede): evita
  // "#----" transitório no boot e garante backfill mesmo se o sync atrasar.
  try {
    if (typeof maintainVisitNumeros === 'function') maintainVisitNumeros();
  } catch (_e) {
    if (typeof _logSilent === 'function') _logSilent(_e, 'app');
  }
  // Rota de item carrega por id: o F5 e o link colado precisam voltar ao mesmo item.
  const _isRota = (h) => typeof penPaginaRotaDe === 'function' && !!penPaginaRotaDe(h);
  navigateTo(pages.includes(hash) || _isRota(hash) ? hash : homePage);
  // Offline-first: a UI já montou a partir do banco local; a sincronização
  // automática roda agora em segundo plano, sem bloquear (toda falha de rede
  // vira fallback local + retry — ver triggerStartupSync em storage.js).
  try {
    if (typeof triggerStartupSync === 'function') triggerStartupSync('app-start');
  } catch (_e) {
    console.error('[app] sync de inicialização falhou', _e);
    if (typeof _logSilent === 'function') _logSilent(_e, 'app');
  }
  if (!_appStarted) {
    _appStarted = true;
    window.addEventListener('hashchange', () => {
      const p = window.location.hash.replace('#', '');
      if ((pages.includes(p) || _isRota(p)) && p !== _currentPage) navigateTo(p);
    });
  }
}

function forgotPassword() {
  const email = document.getElementById('loginEmail')?.value?.trim();
  if (!email) {
    alert('Digite seu e-mail no campo acima para receber o link de redefinição.');
    return;
  }
  if (typeof isSupabaseConnected !== 'function' || !isSupabaseConnected()) {
    alert('Serviço temporariamente indisponível. Tente novamente mais tarde.');
    return;
  }
  authResetPassword(email)
    .then(() => {
      alert(
        'Se o e-mail estiver cadastrado, você receberá um link de redefinição.\nVerifique a caixa de entrada e o spam.'
      );
    })
    .catch(() => {
      alert('Não foi possível enviar o e-mail agora. Tente novamente ou contate um administrador.');
    });
}

function showLoginScreen() {
  const overlay = document.getElementById('loginOverlay');
  const content = document.getElementById('loginContent');
  overlay.style.display = 'block';

  const serverOk = typeof isSupabaseConnected === 'function' && isSupabaseConnected();

  content.innerHTML = `
    <div class="login-header">
      <img src="logo-initnet.svg" alt="InitNET" class="login-brand" width="176" height="56" />
      <div class="login-title">Init Intra</div>
      <div class="login-subtitle">Acesso restrito — identifique-se</div>
    </div>

    <div class="login-form-wrap">
      <div class="login-card">
        ${!serverOk ? `<div class="login-error u-8062c3">Serviço de autenticação indisponível.<br><span class="u-08bfba">Verifique sua conexão ou contate o suporte.</span></div>` : ''}

        <div class="login-field">
          <label class="login-label">E-mail</label>
          <input type="email" id="loginEmail" class="login-input" autocomplete="email"
            placeholder="seu.email@empresa.com" ${!serverOk ? 'disabled' : ''} />
        </div>

        <div class="login-field">
          <div class="login-label-row">
            <label class="login-label">Senha</label>
            <button type="button" class="login-forgot" data-action="forgotPassword" ${!serverOk ? 'disabled' : ''}>Esqueci minha senha</button>
          </div>
          <input type="password" id="loginPassword" class="login-input" autocomplete="current-password"
            placeholder="Digite sua senha..." ${!serverOk ? 'disabled' : ''} />
        </div>

        <div id="loginError" class="login-error"></div>

        <button id="loginBtn" class="login-btn" data-action="doLogin" ${!serverOk ? 'disabled' : ''}>
          Entrar →
        </button>
      </div>
      <p class="login-footer">
        Init Intra · Sistema Interno · ${new Date().getFullYear()}
      </p>
    </div>
  `;

  // Enter no e-mail pula para a senha; Enter na senha entra (antes era onkeydown no HTML).
  document.getElementById('loginEmail')?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      document.getElementById('loginPassword')?.focus();
    }
  });
  document.getElementById('loginPassword')?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') doLogin();
  });

  setTimeout(() => document.getElementById('loginEmail')?.focus(), 100);
  _loginLockCountdown();
}

// Mostra o tempo restante da trava e segura o botão até liberar (a trava em si
// vive em auth.js e sobrevive ao reload; ver o aviso sobre defesa server-side).
let _loginLockTimer = null;
function _loginLockCountdown() {
  if (_loginLockTimer) {
    clearInterval(_loginLockTimer);
    _loginLockTimer = null;
  }
  if (typeof loginLockRemainingMs !== 'function' || loginLockRemainingMs() <= 0) return;
  const tick = () => {
    const errEl = document.getElementById('loginError');
    const btn = document.getElementById('loginBtn');
    const left = loginLockRemainingMs();
    if (left <= 0) {
      clearInterval(_loginLockTimer);
      _loginLockTimer = null;
      if (errEl) errEl.textContent = '';
      if (btn) btn.disabled = false;
      return;
    }
    if (errEl) {
      errEl.textContent =
        'Muitas tentativas. Aguarde ' + formatLoginLockWait(left) + ' e tente novamente.';
      errEl.style.color = '#f87171';
    }
    if (btn) btn.disabled = true;
  };
  tick();
  _loginLockTimer = setInterval(tick, 1000);
}

async function doLogin() {
  const email = document.getElementById('loginEmail')?.value?.trim() || '';
  const password = document.getElementById('loginPassword')?.value || '';
  const errEl = document.getElementById('loginError');
  const btn = document.getElementById('loginBtn');

  if (typeof isSupabaseConnected !== 'function' || !isSupabaseConnected()) {
    if (errEl) errEl.textContent = 'Serviço de autenticação indisponível.';
    return;
  }
  if (!email) {
    if (errEl) errEl.textContent = 'Digite seu e-mail.';
    return;
  }
  if (!password) {
    if (errEl) errEl.textContent = 'Digite sua senha.';
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="u-9cb0f7"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg> Autenticando...';
  }
  if (errEl) errEl.textContent = '';

  try {
    const result = await authSignIn(email, password);
    const op = result.operator;

    addLog('Login', 'Sessão', op.id, op.name);
    document.getElementById('loginOverlay').style.display = 'none';
    _startApp();
    showToast(`Bem-vindo, ${op.name}!`, 'success');

    if ('Notification' in window && Notification.permission === 'default') {
      setTimeout(() => Notification.requestPermission(), 3000);
    }
  } catch (err) {
    var raw = err.message || '';
    var msg = 'Não foi possível entrar. Verifique seus dados e tente novamente.';
    if (raw.includes('Muitas tentativas')) {
      msg = raw;
    } else if (
      raw.includes('não cadastrado') ||
      raw.includes('desativado') ||
      raw.includes('Contate')
    ) {
      msg = raw;
    } else if (raw.includes('Email not confirmed') || raw.includes('email_not_confirmed')) {
      msg = 'E-mail ainda não confirmado. Verifique sua caixa de entrada.';
    } else if (raw.includes('Invalid login credentials') || raw.includes('invalid_credentials')) {
      msg = 'E-mail ou senha incorretos.';
    } else if (
      raw.includes('fetch') ||
      raw.includes('network') ||
      raw.includes('Failed to fetch')
    ) {
      msg = 'Sem conexão com o servidor. Verifique sua internet.';
    } else if (raw.includes('Informe')) {
      msg = raw;
    }
    if (errEl) errEl.textContent = msg;
    if (errEl) errEl.style.color = '#f87171';
    const input = document.getElementById('loginPassword');
    if (input) {
      input.value = '';
      input.focus();
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = 'Entrar →';
    }
    _loginLockCountdown();
  }
}

async function doLogout() {
  // Alterações ainda não enviadas ficam só neste aparelho: avisa antes de sair.
  try {
    if (
      typeof getPendingChanges === 'function' &&
      typeof isSupabaseConnected === 'function' &&
      isSupabaseConnected()
    ) {
      const pend = await getPendingChanges();
      if (
        pend.length &&
        !window.confirm(
          (pend.length === 1
            ? 'Há 1 alteração que ainda não foi enviada'
            : 'Há ' + pend.length + ' alterações que ainda não foram enviadas') +
            ' ao servidor.\n\nElas continuam salvas neste aparelho e sobem no próximo acesso, mas não aparecem para a equipe até lá.\n\nSair mesmo assim?'
        )
      )
        return;
    }
  } catch (_e) {
    if (typeof _logSilent === 'function') _logSilent(_e, 'app');
  }
  try {
    await authSignOut();
  } catch (err) {
    console.warn('Erro no logout:', err);
  }
  // Garantir limpeza total mesmo se authSignOut falhou
  if (typeof forgetAllClientSecrets === 'function') forgetAllClientSecrets();
  clearSession();
  window._supabaseAuthActive = false;
  // Limpar tokens Supabase do localStorage (safety net adicional)
  try {
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith('sb-') && key.endsWith('-auth-token')) {
        localStorage.removeItem(key);
      }
    });
  } catch (_e) {
    if (typeof _logSilent === 'function') _logSilent(_e, 'app');
  }
  showLoginScreen();
}

// ── Boot offline-first: rede no boot nunca bloqueia a UI ──────────────────────
// Leituras de operador no restore de sessão tocam a rede; com backend fora do
// ar elas pendurariam o boot. Com timeout próprio, o app cai para o operador
// local e segue; o sync de fundo (via _startApp) alinha quando voltar.
const BOOT_OP_TIMEOUT_MS = 8000;
function _bootOpWithTimeout(promise, fallback) {
  try {
    if (typeof _withSyncTimeout === 'function') {
      return _withSyncTimeout(promise, BOOT_OP_TIMEOUT_MS, 'boot-operador').then(
        (v) => (v === undefined ? fallback : v),
        () => fallback
      );
    }
  } catch (_e) {
    if (typeof _logSilent === 'function') _logSilent(_e, 'app');
  }
  return Promise.resolve(promise).then(
    (v) => (v === undefined ? fallback : v),
    () => fallback
  );
}
