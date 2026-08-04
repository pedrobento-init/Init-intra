// auth.js – Autenticação exclusiva via Supabase Auth
// =====================================================================

/**
 * Realiza login com email e senha via Supabase Auth.
 * Supabase é a única fonte de autenticação. Os dados do operador
 * (incluindo `team` e `isAdmin`) são sempre sincronizados a partir
 * do servidor após o login, antes de iniciar a aplicação.
 *
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{user: object, operator: object, method: string}>}
 */
async function authSignIn(email, password) {
  const trimmedEmail = (email || '').trim().toLowerCase();
  if (!trimmedEmail) throw new Error('Informe seu e-mail.');
  if (!password) throw new Error('Informe sua senha.');

  if (typeof isSupabaseConnected !== 'function' || !isSupabaseConnected()) {
    throw new Error('Sem conexão com o servidor. Verifique sua internet e configure o Supabase para entrar.');
  }

  console.log('🔑 Login via Supabase Auth:', trimmedEmail);

  // 1) Autentica no Supabase Auth
  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email: trimmedEmail,
    password: password
  });
  if (error) throw error;
  const authUser = data.user;
  if (!authUser) throw new Error('Falha na autenticação. Tente novamente.');
  window._supabaseAuthActive = true;

  // 2) Garante que existe um operador local correspondente
  let op = getOperatorByAuthId(authUser.id) || getOperatorByEmail(trimmedEmail);
  if (!op) {
    console.log('🆕 Operador ainda não existe localmente — criando...');
    op = await _createOperatorFromAuth(authUser);
  }
  if (!op || !op.id) {
    await supabaseClient.auth.signOut();
    throw new Error('Não foi possível criar/vincular seu operador. Contate um administrador.');
  }

  if (op.active === false) {
    await supabaseClient.auth.signOut();
    throw new Error('Operador desativado. Contate um administrador.');
  }

  // 3) Refresca o registro do operador a partir do Supabase para garantir
  //    dados atualizados (team, isAdmin, name, etc.).
  op = await _refreshOperatorFromSupabase(op, authUser);

  // 4) Vincula auth_user_id caso ainda não esteja (operador criado via email)
  if (!op.auth_user_id) {
    await _linkOperator(op.id, authUser.id, trimmedEmail);
    op.auth_user_id = authUser.id;
  }

  // 5) Sincroniza todos os dados (clientes, pendências, etc.) ANTES de iniciar o app
  try {
    await syncSupabaseToLocal();
  } catch (e) {
    console.warn('⚠️ Sincronização pós-login falhou (continuando com cache local):', e.message);
  }

  // 6) Cria/atualiza a sessão local com os dados frescos
  setSession(op.id);
  return { user: authUser, operator: op, method: 'supabase' };
}

/**
 * Cria um operador local (e no Supabase) a partir de um auth user novo.
 */
async function _createOperatorFromAuth(authUser) {
  const email = (authUser.email || '').toLowerCase();
  const nameFromEmail = email.split('@')[0];
  const name = nameFromEmail.charAt(0).toUpperCase() +
               nameFromEmail.slice(1).replace(/[._-]/g, ' ');
  const initials = name.split(' ').map(s => s[0]).join('').substring(0, 2).toUpperCase() || 'OP';

  const newOp = {
    name: name || email,
    initials,
    color: '#1a56db',
    role: 'Técnico',
    active: true,
    isAdmin: false,
    team: 'init',
    email,
    auth_user_id: authUser.id
  };

  // Tenta puxar o registro do Supabase (caso o admin já tenha criado o operador lá)
  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected()) {
    try {
      const { data: remote, error } = await supabaseClient
        .from('operators')
        .select('*')
        .eq('auth_user_id', authUser.id)
        .maybeSingle();
      if (!error && remote) {
        return _upsertOperatorFromRemote(remote);
      }
      // também tenta por e-mail
      const { data: byEmail, error: e2 } = await supabaseClient
        .from('operators')
        .select('*')
        .eq('email', email)
        .maybeSingle();
      if (!e2 && byEmail) {
        byEmail.auth_user_id = authUser.id;
        return _upsertOperatorFromRemote(byEmail);
      }
    } catch (e) {
      console.warn('⚠️ Não foi possível consultar operators no Supabase:', e.message);
    }
  }

  // Cria local e replica no Supabase
  const saved = await saveOperator(newOp);
  return saved;
}

/**
 * Refresca o registro local do operador a partir do Supabase,
 * mantendo os campos sensíveis (pinHash/pinSalt) caso o servidor
 * não os devolva.
 */
async function _refreshOperatorFromSupabase(localOp, authUser) {
  if (typeof isSupabaseConnected !== 'function' || !isSupabaseConnected()) return localOp;
  try {
    let remote = null;
    const { data: byAuth } = await supabaseClient
      .from('operators')
      .select('*')
      .eq('auth_user_id', authUser.id)
      .maybeSingle();
    if (byAuth) {
      remote = byAuth;
    } else if (authUser.email) {
      const { data: byEmail } = await supabaseClient
        .from('operators')
        .select('*')
        .eq('email', authUser.email.toLowerCase())
        .maybeSingle();
      remote = byEmail;
    }
    if (!remote) return localOp;
    return _upsertOperatorFromRemote(remote, localOp);
  } catch (e) {
    console.warn('⚠️ Falha ao refrescar operador:', e.message);
    return localOp;
  }
}

/**
 * Faz upsert de um operador vindo do Supabase no cache local,
 * preservando pinHash/pinSalt locais caso o servidor não os envie.
 */
function _upsertOperatorFromRemote(remote, localFallback) {
  const list = getOperators();
  const localById = localFallback || list.find(o => o.id === remote.id) ||
                    list.find(o => o.auth_user_id === remote.auth_user_id) ||
                    list.find(o => (o.email || '').toLowerCase() === (remote.email || '').toLowerCase());
  // Privilégios vêm só do servidor (nunca do cache local)
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
    pinHash:      remote.pin_hash || localById?.pinHash || null,
    pinSalt:      remote.pin_salt || localById?.pinSalt || null,
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
    }).eq('id', operatorId).then(res => {
      if (res.error) console.warn('⚠️ Vincular auth_user_id (verifique schema operators):', res.error.message);
    }).catch(err => console.warn('⚠️ Rede ao vincular auth_user_id:', err.message));
  }
}

/**
 * Realiza logout (Supabase + local).
 */
async function authSignOut() {
  // 1) Limpa sessão local e flags ANTES de chamar signOut
  //    para garantir que, mesmo se signOut falhar, não há sessão residual.
  clearSession();
  window._supabaseAuthActive = false;

  // 2) Limpa tokens do Supabase Auth do localStorage (safety net)
  try {
    const keys = Object.keys(localStorage);
    for (const key of keys) {
      if (key.startsWith('sb-') && key.endsWith('-auth-token')) {
        localStorage.removeItem(key);
      }
    }
  } catch (e) {
    console.warn('⚠️ Erro ao limpar tokens do localStorage:', e.message);
  }

  // 3) Solicita signOut global ao Supabase (invalida refresh tokens no servidor)
  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected()) {
    try {
      await supabaseClient.auth.signOut({ scope: 'global' });
    } catch (err) {
      console.warn('⚠️ Erro ao sair do Supabase Auth:', err.message);
    }
  }
}

/**
 * Retorna o usuário autenticado atual, restaurando a sessão via Supabase
 * se houver token válido em cookies/storage.
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
    } catch (err) {
      console.warn('⚠️ Erro ao buscar usuário Supabase:', err.message);
    }
  }
  const session = getSession();
  if (session) {
    const op = getOperatorById(session.opId);
    return { authUser: null, operator: op };
  }
  return null;
}

/**
 * Escuta mudanças no estado de autenticação do Supabase.
 */
function authOnStateChange(callback) {
  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected()) {
    return supabaseClient.auth.onAuthStateChange((event, session) => {
      console.log('🔑 Auth state change:', event);
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
    try {
      const { error } = await supabaseClient.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo: window.location.origin + window.location.pathname
      });
      if (error) throw error;
      return true;
    } catch (err) {
      throw err;
    }
  }
  throw new Error('Serviço de redefinição indisponível offline. Contate um administrador.');
}

/**
 * Cria um usuário no Supabase Auth para o operador recém-cadastrado.
 *
 * Tenta `supabaseClient.auth.signUp` (que dispara o e-mail de confirmação).
 * O operador só conseguirá logar depois de confirmar o e-mail — e o nosso
 * fluxo de login faz o vínculo automaticamente na primeira entrada.
 *
 * Casos retornados:
 *  - { ok: true,  needsEmailConfirm: true }  — usuário criado, aguardando confirmação
 *  - { ok: true,  needsEmailConfirm: false } — usuário criado e logado (raro via signUp)
 *  - { ok: false, reason: 'duplicate' }      — já existe um Auth user com esse e-mail
 *  - { ok: false, reason: 'error', message } — outro erro
 */
async function authCreateUser(email, password) {
  if (typeof isSupabaseConnected !== 'function' || !isSupabaseConnected()) {
    return { ok: false, reason: 'offline', message: 'Sem conexão com o Supabase.' };
  }
  const trimmed = (email || '').trim().toLowerCase();
  if (!trimmed || !password) {
    return { ok: false, reason: 'invalid', message: 'E-mail e senha são obrigatórios.' };
  }
  // Preserva sessão do admin — signUp pode trocar o JWT pelo do novo usuário
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
        return { ok: false, reason: 'duplicate', message: 'Já existe um usuário Auth com esse e-mail.' };
      }
      return { ok: false, reason: 'error', message: error.message };
    }
    const newUser = data?.user;
    if (!newUser) {
      return { ok: false, reason: 'error', message: 'Resposta vazia do Supabase Auth.' };
    }

    // Restaura sessão do admin se o signUp autenticou o novo usuário
    if (data.session && adminAccess && adminRefresh) {
      try {
        await supabaseClient.auth.setSession({
          access_token: adminAccess,
          refresh_token: adminRefresh
        });
        window._supabaseAuthActive = true;
      } catch (restoreErr) {
        console.warn('⚠️ Falha ao restaurar sessão admin após criar usuário:', restoreErr.message);
      }
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
 * Reenvia o e-mail de confirmação para um usuário do Supabase Auth.
 * Usa resetPasswordForEmail como fallback caso signUp não tenha confirmado.
 */
async function authResendInvite(email) {
  if (typeof isSupabaseConnected !== 'function' || !isSupabaseConnected()) {
    return { ok: false, message: 'Sem conexão com o Supabase.' };
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
