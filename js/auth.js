// auth.js – Autenticação exclusiva via Supabase Auth
// =====================================================================

const OP_SAFE_COLS =
  'id,name,initials,color,role,phone,email,is_admin,is_gestao,active,team,auth_user_id,created_at,updated_at';

// Trava de tentativas de login — ATENÇÃO: é só conforto/atrito no CLIENTE.
// Quem quer burlar limpa o storage, abre outra aba anônima ou fala direto com a
// API; a defesa real contra força bruta é server-side (rate limit e proteção
// do Supabase Auth, mais senhas fortes). Aqui só persistimos o estado para o
// reload não zerar a contagem e damos feedback claro (tempo restante).
// Backoff exponencial: a cada 5 falhas a trava dobra (30 s, 1, 2, 4… até 30 min);
// sucesso zera tudo, e 1 h sem falhar também zera o nível.
const LOGIN_GUARD_KEY = 'initintra:login-guard';
const LOGIN_GUARD_MAX_FAILS = 5;
const LOGIN_GUARD_BASE_MS = 30 * 1000;
const LOGIN_GUARD_MAX_MS = 30 * 60 * 1000;
const LOGIN_GUARD_DECAY_MS = 60 * 60 * 1000;

// Espelho em memória: vale quando o storage falha (modo privado, bloqueado).
const _loginGuard = { fails: 0, lockUntil: 0, level: 0, lastFail: 0 };

function _loginGuardNum(v, max) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : 0;
}

function _loginGuardLoad(now) {
  try {
    const raw = localStorage.getItem(LOGIN_GUARD_KEY);
    if (raw) {
      const o = JSON.parse(raw);
      if (o && typeof o === 'object') {
        _loginGuard.fails = Math.floor(_loginGuardNum(o.fails, 1000));
        _loginGuard.level = Math.floor(_loginGuardNum(o.level, 30));
        _loginGuard.lastFail = _loginGuardNum(o.lastFail, now);
        // relógio voltado para trás não pode render uma trava maior que o teto
        _loginGuard.lockUntil = _loginGuardNum(o.lockUntil, now + LOGIN_GUARD_MAX_MS);
      }
    }
  } catch (_) {
    /* storage indisponível ou JSON corrompido: segue com a memória */
  }
  if (
    _loginGuard.level > 0 &&
    now >= _loginGuard.lockUntil &&
    now - _loginGuard.lastFail > LOGIN_GUARD_DECAY_MS
  ) {
    _loginGuard.fails = 0;
    _loginGuard.level = 0;
    _loginGuard.lastFail = 0;
    _loginGuard.lockUntil = 0;
  }
  return _loginGuard;
}

function _loginGuardSave() {
  try {
    localStorage.setItem(LOGIN_GUARD_KEY, JSON.stringify(_loginGuard));
  } catch (_) {
    /* fica só em memória */
  }
}

/** Milissegundos que faltam para liberar o login (0 = liberado). */
function loginLockRemainingMs(now) {
  const t = now == null ? Date.now() : now;
  return Math.max(0, _loginGuardLoad(t).lockUntil - t);
}

/** "45 s" ou "2 min 10 s". */
function formatLoginLockWait(ms) {
  const total = Math.max(1, Math.ceil(ms / 1000));
  if (total < 60) return total + ' s';
  const m = Math.floor(total / 60),
    sec = total % 60;
  return m + ' min' + (sec ? ' ' + sec + ' s' : '');
}

function _assertLoginAllowed() {
  const left = loginLockRemainingMs();
  if (left > 0) {
    throw new Error(`Muitas tentativas. Aguarde ${formatLoginLockWait(left)} e tente novamente.`);
  }
}

function _recordLoginFailure() {
  const now = Date.now();
  const g = _loginGuardLoad(now);
  g.fails += 1;
  g.lastFail = now;
  if (g.fails >= LOGIN_GUARD_MAX_FAILS) {
    g.lockUntil = now + Math.min(LOGIN_GUARD_BASE_MS * Math.pow(2, g.level), LOGIN_GUARD_MAX_MS);
    g.level += 1;
    g.fails = 0;
  }
  _loginGuardSave();
}

function _recordLoginSuccess() {
  _loginGuard.fails = 0;
  _loginGuard.level = 0;
  _loginGuard.lastFail = 0;
  _loginGuard.lockUntil = 0;
  try {
    localStorage.removeItem(LOGIN_GUARD_KEY);
  } catch (_) {
    /* nada a limpar */
  }
}

/**
 * Realiza login com email e senha via Supabase Auth.
 * O operador deve existir previamente (cadastro por administrador).
 *
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{user: object, operator: object, method: string}>}
 */
async function authSignIn(email, password) {
  const trimmedEmail = (email || '').trim().toLowerCase();
  if (!trimmedEmail) throw new Error('Informe seu e-mail.');
  if (!password) throw new Error('Informe sua senha.');

  _assertLoginAllowed();

  if (typeof isSupabaseConnected !== 'function' || !isSupabaseConnected()) {
    throw new Error('Serviço de autenticação indisponível.');
  }

  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email: trimmedEmail,
    password: password,
  });
  if (error) {
    _recordLoginFailure();
    throw error;
  }
  const authUser = data.user;
  if (!authUser) {
    _recordLoginFailure();
    throw new Error('Falha na autenticação. Tente novamente.');
  }
  window._supabaseAuthActive = true;

  let op = getOperatorByAuthId(authUser.id) || getOperatorByEmail(trimmedEmail);
  if (!op) {
    op = await _resolveOperatorForAuth(authUser);
  }
  if (!op || !op.id) {
    await supabaseClient.auth.signOut();
    window._supabaseAuthActive = false;
    _recordLoginFailure();
    throw new Error('Usuário não cadastrado. Contate um administrador.');
  }

  if (op.active === false) {
    await supabaseClient.auth.signOut();
    window._supabaseAuthActive = false;
    throw new Error('Operador desativado. Contate um administrador.');
  }

  op = await _refreshOperatorFromSupabase(op, authUser);
  if (!op || op.active === false) {
    await supabaseClient.auth.signOut();
    window._supabaseAuthActive = false;
    throw new Error('Operador desativado. Contate um administrador.');
  }

  if (!op.auth_user_id) {
    await _linkOperator(op.id, authUser.id, trimmedEmail);
    op.auth_user_id = authUser.id;
  }

  try {
    await syncSupabaseToLocal();
  } catch (_e) {
    console.warn('[auth] sync pós-login falhou', _e);
    if (typeof _logSilent === 'function') _logSilent(_e, 'auth');
  }

  _recordLoginSuccess();
  setSession(op.id);
  return { user: authUser, operator: op, method: 'supabase' };
}

/**
 * Busca operador remoto existente. Não cria operador automaticamente.
 */
async function _resolveOperatorForAuth(authUser) {
  if (typeof isSupabaseConnected !== 'function' || !isSupabaseConnected()) return null;
  const email = (authUser.email || '').toLowerCase();
  try {
    const { data: remote, error } = await supabaseClient
      .from('operators')
      .select(OP_SAFE_COLS)
      .eq('auth_user_id', authUser.id)
      .maybeSingle();
    if (!error && remote) return _upsertOperatorFromRemote(remote);

    if (email) {
      const { data: byEmail, error: e2 } = await supabaseClient
        .from('operators')
        .select(OP_SAFE_COLS)
        .eq('email', email)
        .maybeSingle();
      if (!e2 && byEmail) {
        if (!byEmail.auth_user_id) {
          byEmail.auth_user_id = authUser.id;
          try {
            await supabaseClient
              .from('operators')
              .update({ auth_user_id: authUser.id, updated_at: new Date().toISOString() })
              .eq('id', byEmail.id);
          } catch (_e) {
            console.error('[auth] vínculo operador/auth_user não gravado', _e);
            if (typeof _logSilent === 'function') _logSilent(_e, 'auth');
          }
        }
        return _upsertOperatorFromRemote(byEmail);
      }
    }
  } catch (_e) {
    console.error('[auth] resolver operador remoto falhou', _e);
    if (typeof _logSilent === 'function') _logSilent(_e, 'auth');
  }
  return null;
}

/** @deprecated use _resolveOperatorForAuth — mantido para compatibilidade de chamadas legadas */
async function _createOperatorFromAuth(authUser) {
  return _resolveOperatorForAuth(authUser);
}

/**
 * Refresca o registro local do operador a partir do Supabase.
 */
async function _refreshOperatorFromSupabase(localOp, authUser) {
  if (typeof isSupabaseConnected !== 'function' || !isSupabaseConnected()) return localOp;
  try {
    let remote = null;
    const { data: byAuth } = await supabaseClient
      .from('operators')
      .select(OP_SAFE_COLS)
      .eq('auth_user_id', authUser.id)
      .maybeSingle();
    if (byAuth) {
      remote = byAuth;
    } else if (authUser.email) {
      const { data: byEmail } = await supabaseClient
        .from('operators')
        .select(OP_SAFE_COLS)
        .eq('email', authUser.email.toLowerCase())
        .maybeSingle();
      remote = byEmail;
    }
    if (!remote) return localOp;
    return _upsertOperatorFromRemote(remote, localOp);
  } catch (_) {
    return localOp;
  }
}

/**
 * Upsert de operador remoto no cache local (sem hashes de senha).
 */
// localFallback: mantido na assinatura por compatibilidade com quem chama.
function _upsertOperatorFromRemote(remote, _localFallback) {
  const list = getOperators();
  const merged = {
    id: remote.id,
    name: remote.name,
    initials: remote.initials,
    color: remote.color,
    ...(remote.photo ? { photo: remote.photo } : {}),
    role: remote.role,
    phone: remote.phone,
    email: remote.email,
    isAdmin: remote.is_admin === true,
    isGestao: remote.is_gestao === true,
    active: remote.active !== false,
    team: remote.team || 'init',
    auth_user_id: remote.auth_user_id,
    createdAt: remote.created_at,
    updatedAt: remote.updated_at,
  };
  const idx = list.findIndex((o) => o.id === merged.id);
  if (idx !== -1) list[idx] = { ...list[idx], ...merged };
  else list.push(merged);
  // Hash de senha não é mais guardado (cópias antigas do aparelho saem aqui).
  for (const o of list) {
    if (o) {
      delete o.pinHash;
      delete o.pinSalt;
    }
  }
  dbSet(DB.OPERATORS, list);
  return merged;
}

/**
 * Vincula auth_user_id do Supabase ao operador local (e propaga para o Supabase).
 */
async function _linkOperator(operatorId, authUserId, email) {
  const list = getOperators();
  const idx = list.findIndex((o) => o.id === operatorId);
  if (idx === -1) return;
  list[idx].auth_user_id = authUserId;
  if (email) list[idx].email = email;
  list[idx].updatedAt = new Date().toISOString();
  dbSet(DB.OPERATORS, list);
  if (
    typeof isSupabaseConnected === 'function' &&
    isSupabaseConnected() &&
    window._supabaseAuthActive
  ) {
    supabaseClient
      .from('operators')
      .update({
        auth_user_id: authUserId,
        email,
        updated_at: new Date().toISOString(),
      })
      .eq('id', operatorId)
      .then(() => {})
      .catch(() => {});
  }
}

/**
 * Realiza logout (Supabase + local).
 */
async function authSignOut() {
  clearSession();
  window._supabaseAuthActive = false;

  try {
    const keys = Object.keys(localStorage);
    for (const key of keys) {
      if (key.startsWith('sb-') && key.endsWith('-auth-token')) {
        localStorage.removeItem(key);
      }
    }
  } catch (_e) {
    if (typeof _logSilent === 'function') _logSilent(_e, 'auth');
  }

  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected()) {
    try {
      await supabaseClient.auth.signOut({ scope: 'global' });
    } catch (_e) {
      console.error('[auth] signOut remoto falhou', _e);
      if (typeof _logSilent === 'function') _logSilent(_e, 'auth');
    }
  }
}

/**
 * Retorna o usuário autenticado atual (apenas sessão Supabase válida).
 */
async function authGetCurrentUser() {
  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected()) {
    try {
      const { data } = await supabaseClient.auth.getUser();
      if (data?.user) {
        window._supabaseAuthActive = true;
        const op = getOperatorByAuthId(data.user.id) || getOperatorByEmail(data.user.email);
        return { authUser: data.user, operator: op };
      }
    } catch (_e) {
      if (typeof _logSilent === 'function') _logSilent(_e, 'auth');
    }
  }
  return null;
}

/**
 * Escuta mudanças no estado de autenticação do Supabase.
 */
function authOnStateChange(callback) {
  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected()) {
    return supabaseClient.auth.onAuthStateChange((event, session) => {
      callback(event, session);
    });
  }
  return null;
}

/**
 * Envia email de redefinição de senha via Supabase Auth.
 */
async function authResetPassword(email) {
  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected()) {
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: window.location.origin + window.location.pathname,
    });
    if (error) throw error;
    return true;
  }
  throw new Error('Serviço de redefinição indisponível.');
}

/**
 * Cria um usuário no Supabase Auth para o operador recém-cadastrado (admin).
 */
async function authCreateUser(email, password) {
  if (typeof isSupabaseConnected !== 'function' || !isSupabaseConnected()) {
    return { ok: false, reason: 'offline', message: 'Sem conexão com o servidor.' };
  }
  if (typeof isCurrentAdmin === 'function' && !isCurrentAdmin()) {
    return {
      ok: false,
      reason: 'forbidden',
      message: 'Apenas administradores podem criar usuários.',
    };
  }
  const trimmed = (email || '').trim().toLowerCase();
  if (!trimmed || !password) {
    return { ok: false, reason: 'invalid', message: 'E-mail e senha são obrigatórios.' };
  }
  if (password.length < 8) {
    return { ok: false, reason: 'invalid', message: 'A senha deve ter no mínimo 8 caracteres.' };
  }

  let adminAccess = null;
  let adminRefresh = null;
  try {
    const { data: cur } = await supabaseClient.auth.getSession();
    if (cur?.session) {
      adminAccess = cur.session.access_token;
      adminRefresh = cur.session.refresh_token;
    }
  } catch (_e) {
    if (typeof _logSilent === 'function') _logSilent(_e, 'auth');
  }

  try {
    const { data, error } = await supabaseClient.auth.signUp({
      email: trimmed,
      password,
      options: {
        emailRedirectTo: window.location.origin + window.location.pathname,
      },
    });
    if (error) {
      const msg = (error.message || '').toLowerCase();
      if (msg.includes('already') || msg.includes('registered') || msg.includes('duplicate')) {
        return { ok: false, reason: 'duplicate', message: 'Já existe um usuário com esse e-mail.' };
      }
      return { ok: false, reason: 'error', message: error.message };
    }
    const newUser = data?.user;
    if (!newUser) {
      return { ok: false, reason: 'error', message: 'Resposta vazia do servidor de autenticação.' };
    }

    if (data.session && adminAccess && adminRefresh) {
      try {
        await supabaseClient.auth.setSession({
          access_token: adminAccess,
          refresh_token: adminRefresh,
        });
        window._supabaseAuthActive = true;
      } catch (_e) {
        console.error('[auth] sessão do admin não restaurada', _e);
        if (typeof _logSilent === 'function') _logSilent(_e, 'auth');
        if (typeof showToast === 'function')
          showToast('A sessão do administrador não foi restaurada. Entre novamente.', 'error');
      }
    }

    return {
      ok: true,
      needsEmailConfirm: !data.session,
      authUserId: newUser.id,
    };
  } catch (err) {
    if (adminAccess && adminRefresh) {
      try {
        await supabaseClient.auth.setSession({
          access_token: adminAccess,
          refresh_token: adminRefresh,
        });
      } catch (_e) {
        console.error('[auth] sessão do admin não restaurada', _e);
        if (typeof _logSilent === 'function') _logSilent(_e, 'auth');
      }
    }
    return { ok: false, reason: 'error', message: err.message || String(err) };
  }
}

/**
 * Reenvia o e-mail de convite/redefinição.
 */
async function authResendInvite(email) {
  if (typeof isSupabaseConnected !== 'function' || !isSupabaseConnected()) {
    return { ok: false, message: 'Sem conexão com o servidor.' };
  }
  if (typeof isCurrentAdmin === 'function' && !isCurrentAdmin()) {
    return { ok: false, message: 'Apenas administradores podem reenviar convites.' };
  }
  const trimmed = (email || '').trim().toLowerCase();
  try {
    const { error } = await supabaseClient.auth.resetPasswordForEmail(trimmed, {
      redirectTo: window.location.origin + window.location.pathname,
    });
    if (error) return { ok: false, message: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}
