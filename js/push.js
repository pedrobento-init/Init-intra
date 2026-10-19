// push.js – Notificações no celular (Web Push)
// O aparelho se inscreve uma vez ("Ativar neste aparelho" nas configurações
// de notificação); o endereço fica em push_subscriptions (migration 053) e a
// Edge Function send-push entrega. No iPhone só funciona com o app instalado
// na tela inicial (iOS 16.4+).

function isPushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function _pushIsIOSNotInstalled() {
  try {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent || '');
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    return ios && !standalone;
  } catch (_) { return false; }
}

function _pushKeyToBytes(base64url) {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function _pushCurrentSubscription() {
  if (!isPushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

/** 'on' | 'off' | 'blocked' | 'unsupported' | 'ios-install' */
async function getPushState() {
  if (_pushIsIOSNotInstalled()) return 'ios-install';
  if (!isPushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  try { return (await _pushCurrentSubscription()) ? 'on' : 'off'; } catch (_) { return 'off'; }
}

async function enablePushOnThisDevice() {
  if (!isPushSupported()) throw new Error('Este navegador não aceita notificações.');
  if (typeof isSupabaseConnected !== 'function' || !isSupabaseConnected()) throw new Error('Sem conexão com o servidor.');
  const session = typeof getSession === 'function' ? getSession() : null;
  if (!session || !session.opId) throw new Error('Entre no sistema antes de ativar.');

  const { data, error } = await supabaseClient.functions.invoke('send-push', { method: 'GET' });
  if (error || !data || !data.publicKey) throw new Error('Notificações no celular ainda não foram configuradas no servidor.');

  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Permissão negada. Libere as notificações do site nas configurações do navegador.');

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: _pushKeyToBytes(data.publicKey) });
  const json = sub.toJSON();
  const { error: saveErr } = await supabaseClient.from('push_subscriptions').upsert({
    endpoint: json.endpoint,
    operator_id: session.opId,
    p256dh: json.keys && json.keys.p256dh,
    auth: json.keys && json.keys.auth,
    user_agent: String(navigator.userAgent || '').slice(0, 200),
  });
  if (saveErr) throw new Error('Não foi possível salvar a inscrição: ' + saveErr.message);
  return true;
}

async function disablePushOnThisDevice() {
  const sub = await _pushCurrentSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  try { await sub.unsubscribe(); } catch (_) {}
  try { if (typeof isSupabaseConnected === 'function' && isSupabaseConnected()) await supabaseClient.from('push_subscriptions').delete().eq('endpoint', endpoint); } catch (_) {}
}

/** Best-effort: o servidor confere destinatários e ignora quem enviou. */
async function sendPushNotification({ to, title, body, url }) {
  try {
    if (!to || !to.length || typeof isSupabaseConnected !== 'function' || !isSupabaseConnected()) return { skipped: true };
    const { data, error } = await supabaseClient.functions.invoke('send-push', { body: { to, title, body, url } });
    if (error) return { error: error.message };
    return data || { success: true };
  } catch (e) { return { error: e && e.message }; }
}

// ── Configurações de notificação: bloco "No celular" ──
const _PUSH_STATE_TEXT = {
  on: 'Ativadas neste aparelho.',
  off: 'Desativadas neste aparelho.',
  blocked: 'Bloqueadas pelo navegador. Libere as notificações do site nas configurações do navegador e tente de novo.',
  unsupported: 'Este navegador não aceita notificações.',
  'ios-install': 'No iPhone, instale o app primeiro (Compartilhar → Adicionar à Tela de Início) e ative por ele.',
};

async function renderPushSettings() {
  const box = document.getElementById('pushSettings');
  if (!box) return;
  const state = await getPushState();
  const btn = state === 'on'
    ? '<button type="button" class="btn btn-secondary" data-action="pushDisable">Desativar neste aparelho</button>'
    : (state === 'off' ? '<button type="button" class="btn btn-primary" data-action="pushEnable">Ativar neste aparelho</button>' : '');
  box.innerHTML = '<p class="push-state push-' + state + '">' + escapeHtml(_PUSH_STATE_TEXT[state] || '') + '</p>' + btn;
}

if (typeof registerActions === 'function') {
  registerActions({
    pushEnable: async (el) => {
      el.disabled = true;
      try {
        await enablePushOnThisDevice();
        showToast('Notificações ativadas neste aparelho.', 'success');
      } catch (e) {
        showToast(e.message || 'Não foi possível ativar.', 'error');
      }
      renderPushSettings();
    },
    pushDisable: async (el) => {
      el.disabled = true;
      await disablePushOnThisDevice();
      showToast('Notificações desativadas neste aparelho.', 'success');
      renderPushSettings();
    },
  });
}

if (typeof module !== 'undefined' && module.exports) module.exports = { _pushKeyToBytes };
