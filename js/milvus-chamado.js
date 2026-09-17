// milvus-chamado.js — Integração "visita criada → chamado criado no Milvus"
// =====================================================================
// Offline-first: a visita NUNCA depende da rede. Ao criar, ela é carimbada
// como `milvusChamadoStatus: 'pendente'` (só criações novas — visitas antigas
// sem o campo ficam 'nao_aplicavel', sem backfill). Este processador varre os
// pendentes nos gatilhos existentes (pós-save online, pós-sync, boot, evento
// `online`, aba visível) e chama a Edge Function `milvus-chamado-create` —
// o frontend NUNCA vê o MILVUS_API_TOKEN (mesmo padrão de milvus-tickets).
//
// Idempotência (sem duplicar chamados):
// - Chave estável = id da visita (gerado 1× no local, antes de qualquer rede).
// - 'criando' é PERSISTIDO antes do invoke: reload/crash no meio do voo vira
//   pendência retomável, nunca "esquecida" nem "recriada às cegas".
// - Código já gravado (local ou servidor) → pula sem chamar o Milvus.
// - Resposta perdida (timeout após criar): a Edge recupera pelo marcador
//   `[ref:VIS-id]` na descrição antes de criar de novo.
// - Mutex + releitura antes de cada invoke: 2 gatilhos simultâneos não
//   disparam 2 criações (o 2º vê 'criando'/código e pula).
//
// Erros permanentes (sem_token, validação, token inválido, sem cliente) NÃO
// retentam sozinhos; transitórios (rede/timeout/5xx) retentam até o teto.

const MILVUS_CHAMADO_EDGE = 'milvus-chamado-create';
const MILVUS_CHAMADO_MAX_TENTATIVAS = 8;
const MILVUS_CHAMADO_STALE_MS = 15 * 60 * 1000; // 'criando' +15min = travou

// ── Helpers puros (testáveis) ────────────────────────────────────────────

// Estado de UI da integração para UMA visita (puro, testável).
// kind: criado | pendente | criando | sem_token | erro | nao_aplicavel
function resolveMilvusChamadoState(visit) {
  const v = visit || {};
  if (v.milvusChamadoCodigo && Number(v.milvusChamadoCodigo) > 0) {
    return { kind: 'criado', codigo: Number(v.milvusChamadoCodigo), erro: null };
  }
  const st = v.milvusChamadoStatus || null;
  if (!st) return { kind: 'nao_aplicavel', codigo: null, erro: null };
  if (st === 'criado') return { kind: 'criado', codigo: null, erro: null };
  if (st === 'pendente') return { kind: 'pendente', codigo: null, erro: v.milvusChamadoErro || null };
  if (st === 'criando') return { kind: 'criando', codigo: null, erro: v.milvusChamadoErro || null };
  if (st === 'sem_token') return { kind: 'sem_token', codigo: null, erro: v.milvusChamadoErro || null };
  return { kind: 'erro', codigo: null, erro: v.milvusChamadoErro || null };
}

// Deve o processador tentar esta visita agora? (puro, testável)
function shouldRetryMilvusChamado(visit, nowMs) {
  const v = visit || {};
  if (v.milvusChamadoCodigo && Number(v.milvusChamadoCodigo) > 0) return false;
  const tentativas = Number(v.milvusChamadoTentativas) || 0;
  if (tentativas >= MILVUS_CHAMADO_MAX_TENTATIVAS) return false;
  if (v.milvusChamadoStatus === 'pendente') return true;
  if (v.milvusChamadoStatus === 'criando') {
    const now = (typeof nowMs === 'number') ? nowMs : Date.now();
    const upd = new Date(v.updatedAt || 0).getTime();
    if (isNaN(upd)) return true;
    return (now - upd) > MILVUS_CHAMADO_STALE_MS;
  }
  return false;
}

// Extrai o código do chamado de respostas do Milvus/Edge (puro, testável).
// Aceita: 123 | "123" | { codigo: 123 } | { code: 123 } | { id: 123 }.
function extractMilvusCodigo(body) {
  if (body === null || body === undefined) return null;
  if (typeof body === 'number' && Number.isFinite(body) && body > 0) return Math.trunc(body);
  if (typeof body === 'string') {
    const s = body.trim();
    if (!s) return null;
    const direct = Number(s);
    if (Number.isFinite(direct) && direct > 0) return Math.trunc(direct);
    try { return extractMilvusCodigo(JSON.parse(s)); } catch (_) { return null; }
  }
  if (typeof body === 'object') {
    const c = body.codigo ?? body.code ?? body.id;
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return Math.trunc(n);
  }
  return null;
}

// Classifica o resultado do invoke da Edge (puro, testável).
// outcome: created | no-token | permanent | transient
function classifyMilvusChamadoResult(res, invokeError) {
  if (invokeError) return { outcome: 'transient', detail: String((invokeError && invokeError.message) || invokeError) };
  const data = (res && res.data) || res || {};
  if (data.success === true && extractMilvusCodigo(data.codigo ?? data) !== null) {
    return { outcome: 'created', codigo: extractMilvusCodigo(data.codigo ?? data), recovered: data.recovered === true || data.already === true };
  }
  const code = String(data.code || '');
  if (code === 'MILVUS_CLIENT_TOKEN_NOT_CONFIGURED') return { outcome: 'no-token', detail: code };
  if (code === 'MILVUS_VISIT_WITHOUT_CLIENT' || code === 'MILVUS_VALIDATION_ERROR' || code === 'MILVUS_INVALID_TOKEN') {
    return { outcome: 'permanent', detail: (data.detail ? code + ': ' + data.detail : code) || 'erro permanente' };
  }
  if (data.error) return { outcome: 'transient', detail: String(data.error.message || data.error) };
  return { outcome: 'transient', detail: code || 'resposta inesperada da integração' };
}

// ── Portas de entrada do processador ─────────────────────────────────────

let _milvusChamadoFlushing = false;

function _milvusChamadoCanRun() {
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
    if (typeof isSupabaseConnected !== 'function' || !isSupabaseConnected()) return false;
    if (typeof window !== 'undefined' && !window._supabaseAuthActive) return false;
    if (typeof supabaseClient === 'undefined' || !supabaseClient) return false;
  } catch (_) { return false; }
  return true;
}

// Atalho pós-criação de visita (online): varre pendentes sem bloquear.
// Offline/sem auth: não faz nada — a visita segue 'pendente' no local.
function enqueueMilvusChamado(visitId) {
  try {
    if (!_milvusChamadoCanRun()) return;
    processPendingMilvusChamados('visit:' + (visitId || ''));
  } catch (_) {}
}

// Varredura idempotente dos pendentes. Nunca lança; nunca apaga visita;
// falha transitória volta a 'pendente' (+1 tentativa), permanente vira
// 'erro'/'sem_token' (sem retry automático).
async function processPendingMilvusChamados(reason) {
  if (_milvusChamadoFlushing) return { ok: true, reason: 'already-running' };
  if (!_milvusChamadoCanRun()) return { ok: false, reason: 'offline' };
  if (typeof getVisits !== 'function' || typeof saveVisit !== 'function') {
    return { ok: false, reason: 'unavailable' };
  }
  _milvusChamadoFlushing = true;
  const summary = { ok: true, processed: 0, created: 0, failed: 0 };
  try {
    const pending = getVisits().filter((v) => shouldRetryMilvusChamado(v));
    for (const cand of pending) {
      // Releitura: outro gatilho pode ter resolvido enquanto varríamos.
      const v = (typeof getVisitById === 'function' ? getVisitById(cand.id) : cand) || cand;
      if (!shouldRetryMilvusChamado(v)) continue;
      if (v.milvusChamadoCodigo && Number(v.milvusChamadoCodigo) > 0) continue;
      summary.processed++;

      // Trava persistida ANTES da rede (crash-safe; stale retoma depois).
      try {
        saveVisit({ ...v, milvusChamadoStatus: 'criando' });
      } catch (_) {}

      let res = null;
      let invokeError = null;
      try {
        const r = await supabaseClient.functions.invoke(MILVUS_CHAMADO_EDGE, {
          body: { visitId: v.id },
        });
        res = r && r.data !== undefined ? r : { data: r };
        if (r && r.error) invokeError = r.error;
      } catch (e) { invokeError = e; }

      const cls = classifyMilvusChamadoResult(res, invokeError);
      try {
        if (cls.outcome === 'created') {
          saveVisit({ ...getVisitById(v.id), milvusChamadoCodigo: cls.codigo, milvusChamadoStatus: 'criado', milvusChamadoErro: null });
          summary.created++;
        } else if (cls.outcome === 'no-token') {
          saveVisit({ ...getVisitById(v.id), milvusChamadoStatus: 'sem_token', milvusChamadoErro: 'Cliente sem identificação Milvus (token/mapa).' });
          summary.failed++;
        } else if (cls.outcome === 'permanent') {
          saveVisit({ ...getVisitById(v.id), milvusChamadoStatus: 'erro', milvusChamadoErro: String(cls.detail || 'erro').slice(0, 300) });
          summary.failed++;
        } else {
          const cur = getVisitById(v.id) || v;
          saveVisit({ ...cur, milvusChamadoStatus: 'pendente', milvusChamadoErro: String(cls.detail || 'falha temporária').slice(0, 300), milvusChamadoTentativas: (Number(cur.milvusChamadoTentativas) || 0) + 1 });
          summary.failed++;
        }
      } catch (_) {}
    }
  } catch (_) {
    // varredura nunca derruba o chamador
  } finally {
    _milvusChamadoFlushing = false;
  }
  return summary;
}

// Retry manual (botão na UI): volta a 'pendente' e enfileira.
function retryMilvusChamado(visitId) {
  try {
    if (typeof getVisitById !== 'function' || typeof saveVisit !== 'function') return;
    const v = getVisitById(visitId);
    if (!v) return;
    if (v.milvusChamadoCodigo && Number(v.milvusChamadoCodigo) > 0) return;
    saveVisit({ ...v, milvusChamadoStatus: 'pendente', milvusChamadoErro: null });
    if (typeof showToast === 'function') showToast('Nova tentativa de criação do chamado enfileirada.', 'info');
    enqueueMilvusChamado(visitId);
    if (typeof openVisitDetail === 'function') {
      try { openVisitDetail(visitId); } catch (_) {}
    }
  } catch (_) {}
}

// Finalização (etapa futura): abstraída, SEM chamada e SEM regra.
// PUT /api/chamado/finalizar só será acionado quando houver definição explícita.
async function finalizeMilvusChamado(_visitId) {
  throw new Error('Finalização automática de chamados Milvus ainda não implementada (sem regra definida).');
}

// Gatilhos de reconexão/retorno (a verificação real ocorre no processador).
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    try { processPendingMilvusChamados('online'); } catch (_) {}
  });
}
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('visibilitychange', () => {
    try {
      if (document.visibilityState === 'visible') processPendingMilvusChamados('visibility');
    } catch (_) {}
  });
}

// Export para testes (Node/Vitest).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MILVUS_CHAMADO_EDGE,
    MILVUS_CHAMADO_MAX_TENTATIVAS,
    MILVUS_CHAMADO_STALE_MS,
    resolveMilvusChamadoState,
    shouldRetryMilvusChamado,
    extractMilvusCodigo,
    classifyMilvusChamadoResult,
    enqueueMilvusChamado,
    processPendingMilvusChamados,
    retryMilvusChamado,
    finalizeMilvusChamado,
  };
}
