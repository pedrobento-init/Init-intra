// error-log.js — Erros que antes sumiam (catch vazio, exceção solta).
// Carrega cedo (antes dos demais scripts). Junta por "onde + mensagem" (a
// mesma falha conta 1x por sessão, com contador), guarda os últimos no
// aparelho e envia em lote para public.client_errors (migration 050) quando
// há conexão. Sem dado de cliente: mensagem, pilha curta, onde e URL.

const ERRLOG_MAX = 60;
const ERRLOG_FLUSH_MS = 30000;
const _errlog = { map: new Map(), queue: [], timer: null, disabled: false };

function _errKey(where, msg) { return String(where || '') + '|' + String(msg || '').slice(0, 200); }

/**
 * Registra um erro "engolido". Nunca lança. Retorna true se for novo na sessão.
 * Uso nos catch: `catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'sync'); }`
 */
function _logSilent(err, where) {
  try {
    const msg = err && err.message ? String(err.message) : String(err);
    if (!msg || msg === 'undefined') return false;
    const key = _errKey(where, msg);
    const cur = _errlog.map.get(key);
    if (cur) { cur.count++; return false; }
    if (_errlog.map.size >= ERRLOG_MAX) return false; // teto da sessão
    const entry = {
      at: new Date().toISOString(),
      source: String(where || '').slice(0, 80),
      message: msg.slice(0, 2000),
      stack: (err && err.stack ? String(err.stack) : '').slice(0, 4000),
      url: (typeof location !== 'undefined' ? location.hash || '' : ''),
      count: 1,
    };
    _errlog.map.set(key, entry);
    _errlog.queue.push(entry);
    if (typeof console !== 'undefined' && console.debug) console.debug('[erro registrado]', where, msg);
    _scheduleErrFlush();
    return true;
  } catch (_) { return false; }
}

function getLoggedErrors() { return [..._errlog.map.values()]; }

function _scheduleErrFlush() {
  if (_errlog.timer || _errlog.disabled) return;
  _errlog.timer = setTimeout(() => { _errlog.timer = null; flushErrorLog(); }, ERRLOG_FLUSH_MS);
}

/** Envia o que está na fila (se online e logado). Tabela ausente → para de tentar. */
async function flushErrorLog() {
  try {
    if (_errlog.disabled || !_errlog.queue.length) return;
    if (typeof isSupabaseConnected !== 'function' || !isSupabaseConnected() || !window._supabaseAuthActive) { _scheduleErrFlush(); return; }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { _scheduleErrFlush(); return; }
    const session = typeof getSession === 'function' ? getSession() : null;
    const batch = _errlog.queue.splice(0, 20);
    const rows = batch.map((e) => ({
      at: e.at, source: e.source, message: e.message, stack: e.stack, url: e.url, count: e.count,
      operator_id: session ? session.opId : null, operator_name: session ? session.name : '',
      app_version: (typeof CACHE_NAME !== 'undefined' ? CACHE_NAME : ''),
    }));
    const { error } = await supabaseClient.from('client_errors').insert(rows);
    if (error) {
      // 050 ainda não aplicada (ou sem permissão): não insiste nesta sessão.
      if (/client_errors|relation|permission|404/i.test(String(error.message || error.code || ''))) _errlog.disabled = true;
      else _errlog.queue.unshift(...batch);
    }
    if (_errlog.queue.length) _scheduleErrFlush();
  } catch (_) { /* o próprio log nunca derruba o app */ }
}

if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('error', (ev) => {
    // Erro de recurso (img/script) não tem .error; ignora — não é bug de código.
    if (ev && ev.error) _logSilent(ev.error, 'window.onerror');
  });
  window.addEventListener('unhandledrejection', (ev) => {
    const r = ev && ev.reason;
    _logSilent(r instanceof Error ? r : new Error(String(r && r.message ? r.message : r)), 'promise');
  });
  window.addEventListener('pagehide', () => { try { flushErrorLog(); } catch (_) {} });
}

// ── Admin: "Erros do app" (Histórico) ───────────────────────────────────
async function openClientErrors() {
  if (typeof isCurrentAdmin === 'function' && !isCurrentAdmin()) return;
  let rows = [];
  let note = '';
  try {
    if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
      const { data, error } = await supabaseClient.from('client_errors').select('*').order('at', { ascending: false }).limit(200);
      if (error) note = 'Não foi possível ler os erros do servidor (a migration 050 já foi aplicada?).';
      else rows = data || [];
    } else note = 'Sem conexão: mostrando só os erros deste aparelho.';
  } catch (_) { note = 'Falha ao consultar.'; }
  if (!rows.length) rows = getLoggedErrors().map((e) => ({ ...e, operator_name: '(este aparelho)' }));
  // Agrupa por onde+mensagem para ler rápido.
  const groups = new Map();
  for (const r of rows) {
    const k = _errKey(r.source, r.message);
    const g = groups.get(k) || { ...r, total: 0, people: new Set(), last: r.at };
    g.total += Number(r.count) || 1;
    if (r.operator_name) g.people.add(r.operator_name);
    if (String(r.at) > String(g.last)) g.last = r.at;
    groups.set(k, g);
  }
  const list = [...groups.values()].sort((a, b) => b.total - a.total);
  openModal('Erros do app', `
    ${note ? `<p class="err-note">${escapeHtml(note)}</p>` : ''}
    ${list.length ? `<ul class="err-list">${list.map((g) => `<li>
      <div class="err-head"><b>${escapeHtml(g.message)}</b><span class="err-count">${g.total}×</span></div>
      <div class="err-meta">${escapeHtml(g.source || '—')} · ${escapeHtml([...g.people].slice(0, 4).join(', ') || '—')} · último ${escapeHtml(typeof formatDateTime === 'function' ? formatDateTime(g.last) : g.last)}</div>
      ${g.stack ? `<details><summary>Pilha</summary><pre>${escapeHtml(g.stack)}</pre></details>` : ''}
    </li>`).join('')}</ul>` : '<p class="err-note">Nenhum erro registrado. 🎉</p>'}`, 'lg');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { _logSilent, getLoggedErrors, _errlog };
}
