// auth.js – Autenticação exclusiva via Supabase Auth
// =====================================================================

const OP_SAFE_COLS = 'id,name,initials,color,role,phone,email,is_admin,active,team,auth_user_id,created_at,updated_at';

const _loginGuard = { fails: 0, lockUntil: 0 };

function _assertLoginAllowed() {
  const now = Date.now();
  if (now < _loginGuard.lockUntil) {
    const mins = Math.ceil((_loginGuard.lockUntil - now) / 60000);
    throw new Error(`Muitas tentativas. Aguarde ${mins} min e tente novamente.`);
  }
}

function _recordLoginFailure() {
  _loginGuard.fails += 1;
  if (_loginGuard.fails >= 5) {
    _loginGuard.lockUntil = Date.now() + 15 * 60 * 1000;
    _loginGuard.fails = 0;
  }
}

function _recordLoginSuccess() {
  _loginGuard.fails = 0;
  _loginGuard.lockUntil = 0;
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
    password: password
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
  } catch (_) {}

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
          } catch (_) {}
        }
        return _upsertOperatorFromRemote(byEmail);
      }
    }
  } catch (_) {}
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
function _upsertOperatorFromRemote(remote, localFallback) {
  const list = getOperators();
  const localById = localFallback || list.find(o => o.id === remote.id) ||
                    list.find(o => o.auth_user_id === remote.auth_user_id) ||
                    list.find(o => (o.email || '').toLowerCase() === (remote.email || '').toLowerCase());
  const merged = {
    id:           remote.id,
    name:         remote.name,
    initials:     remote.initials,
    color:        remote.color,
    role:         remote.role,
    phone:        remote.phone,
    email:        remote.email,
    isAdmin:      remote.is_admin === true,
    active:       remote.active !== false,
    team:         remote.team || 'init',
    auth_user_id: remote.auth_user_id,
    createdAt:    remote.created_at,
    updatedAt:    remote.updated_at,
    pinHash:      localById?.pinHash || null,
    pinSalt:      localById?.pinSalt || null,
  };
  const idx = list.findIndex(o => o.id === merged.id);
  if (idx !== -1) list[idx] = { ...list[idx], ...merged };
  else list.push(merged);
  dbSet(DB.OPERATORS, list);
  return merged;
}

/**
 * Vincula auth_user_id do Supabase ao operador local (e propaga para o Supabase).
 */
async function _linkOperator(operatorId, authUserId, email) {
  const list = getOperators();
  const idx = list.findIndex(o => o.id === operatorId);
  if (idx === -1) return;
  list[idx].auth_user_id = authUserId;
  if (email) list[idx].email = email;
  list[idx].updatedAt = new Date().toISOString();
  dbSet(DB.OPERATORS, list);
  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    supabaseClient.from('operators').update({
      auth_user_id: authUserId,
      email,
      updated_at: new Date().toISOString()
    }).eq('id', operatorId).then(() => {}).catch(() => {});
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
  } catch (_) {}

  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected()) {
    try {
      await supabaseClient.auth.signOut({ scope: 'global' });
    } catch (_) {}
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
    } catch (_) {}
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
      redirectTo: window.location.origin + window.location.pathname
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
    return { ok: false, reason: 'forbidden', message: 'Apenas administradores podem criar usuários.' };
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
  } catch (_) {}

  try {
    const { data, error } = await supabaseClient.auth.signUp({
      email: trimmed,
      password,
      options: {
        emailRedirectTo: window.location.origin + window.location.pathname
      }
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
          refresh_token: adminRefresh
        });
        window._supabaseAuthActive = true;
      } catch (_) {}
    }

    return {
      ok: true,
      needsEmailConfirm: !data.session,
      authUserId: newUser.id
    };
  } catch (err) {
    if (adminAccess && adminRefresh) {
      try {
        await supabaseClient.auth.setSession({
          access_token: adminAccess,
          refresh_token: adminRefresh
        });
      } catch (_) {}
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
      redirectTo: window.location.origin + window.location.pathname
    });
    if (error) return { ok: false, message: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}
