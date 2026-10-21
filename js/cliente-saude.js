// cliente-saude.js — Saúde do cliente (0 a 100) e backups monitorados (060).
// getHealthForClient (metrics.js) chama ajustarSaudeCliente: a nota de
// pendências passa a contar também vencimentos, backups, dispositivos que
// pararam de falar com o Milvus e tempo sem visita. Card, resumo, ficha e o
// painel "Clientes em risco" mostram a mesma nota, com o porquê.
// Aba "Backups" da ficha: monitores que o robô alimenta pelos e-mails do
// rótulo "Backups" do Gmail. Eventos delegados no document (CSP).

const SAUDE_CACHE = 'intra_saude_extra';
const SAUDE_DISP_DIAS = 7;       // dispositivo parado há mais que isso pesa
const SAUDE_SEM_VISITA_DIAS = 120;
let _saudeExtra = null;          // { devices: { clientId: [{nome, dias}] }, monitores: [...], em }
let _saudeCarregando = null;

// ── Nota (puro) ─────────────────────────────────────────────────────────────

function _saudeDias(deISO, ateISO) {
  const a = Date.UTC(+deISO.slice(0, 4), +deISO.slice(5, 7) - 1, +deISO.slice(8, 10));
  const b = Date.UTC(+ateISO.slice(0, 4), +ateISO.slice(5, 7) - 1, +ateISO.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

/** Alerta do monitor de backup: 'falha' | 'silencio' | 'aviso' | null. */
function backupMonitorAlerta(m, agora) {
  if (!m || m.ativo === false) return null;
  if (m.ultimo_status === 'falha') return 'falha';
  const desde = Date.parse(m.ultimo_em || m.created_at || '');
  if (!isNaN(desde) && ((agora || Date.now()) - desde) / 3600000 > (Number(m.max_horas) || 48)) return 'silencio';
  return m.ultimo_status === 'aviso' ? 'aviso' : null;
}

/**
 * Nota final a partir da saúde de pendências (base) e do resto.
 * Nunca melhora o nível que as pendências já deram.
 */
const _pl = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

function calcularSaude(d) {
  const base = d.base || { level: 'green', totalAbertas: 0, vencidas: 0, avgHours: 0 };
  const motivos = [];
  let nota = 100;
  const tira = (pts, max, n, txt) => { if (n > 0) { nota -= Math.min(max, pts * n); motivos.push(txt); } };

  tira(12, 36, base.vencidas || 0, _pl(base.vencidas, 'pendência vencida', 'pendências vencidas'));
  tira(3, 15, Math.max(0, (base.totalAbertas || 0) - 3), `${base.totalAbertas} pendências abertas`);
  if ((base.avgHours || 0) > 72) { nota -= 5; motivos.push(`resolução média de ${Math.round(base.avgHours)}h`); }

  const vencs = (d.vencimentos || []).filter((v) => v && v.status !== 'encerrado' && v.dataVencimento)
    .map((v) => _saudeDias(d.today, String(v.dataVencimento).slice(0, 10)));
  const vencidos = vencs.filter((x) => x < 0).length;
  const em7 = vencs.filter((x) => x >= 0 && x <= 7).length;
  const em30 = vencs.filter((x) => x > 7 && x <= 30).length;
  tira(20, 40, vencidos, _pl(vencidos, 'vencimento já vencido', 'vencimentos já vencidos'));
  tira(12, 24, em7, _pl(em7, 'vencimento em até 7 dias', 'vencimentos em até 7 dias'));
  tira(4, 8, em30, _pl(em30, 'vencimento em até 30 dias', 'vencimentos em até 30 dias'));

  const al = (d.monitores || []).map((m) => ({ m, a: backupMonitorAlerta(m, d.agora) })).filter((x) => x.a);
  al.forEach(({ m, a }) => {
    if (a === 'falha') { nota -= 25; motivos.push(`backup "${m.nome}" com falha`); }
    else if (a === 'silencio') { nota -= 15; motivos.push(`backup "${m.nome}" sem notícia`); }
    else { nota -= 8; motivos.push(`backup "${m.nome}" com aviso`); }
  });

  const parados = d.dispositivosParados || [];
  tira(3, 15, parados.length, _pl(parados.length, 'dispositivo', 'dispositivos') + ` sem falar com o Milvus há mais de ${SAUDE_DISP_DIAS} dias`);

  const ultima = (d.visitas || []).filter((v) => v && v.status !== 'cancelada' && v.date && v.date <= d.today)
    .map((v) => v.date).sort().pop();
  if (ultima && _saudeDias(ultima, d.today) > SAUDE_SEM_VISITA_DIAS) {
    nota -= 5;
    motivos.push(`sem visita há ${_saudeDias(ultima, d.today)} dias`);
  }

  nota = Math.max(0, Math.min(100, Math.round(nota)));
  const peso = { green: 0, yellow: 1, red: 2 };
  const pelaNota = nota >= 80 ? 'green' : nota >= 55 ? 'yellow' : 'red';
  const level = peso[base.level] > peso[pelaNota] ? base.level : pelaNota;
  const meta = { green: ['🟢', '#16a34a', 'Saudável'], yellow: ['🟡', '#d97706', 'Atenção'], red: ['🔴', '#dc2626', 'Crítico'] }[level];
  return { ...base, level, emoji: meta[0], color: meta[1], label: meta[2], nota, motivos };
}

// ── Dados de fora das pendências (cache local) ──────────────────────────────

function _saudeLer() {
  if (_saudeExtra) return _saudeExtra;
  try { _saudeExtra = JSON.parse(localStorage.getItem(SAUDE_CACHE) || 'null'); } catch (_) { _saudeExtra = null; }
  return _saudeExtra || { devices: {}, monitores: [] };
}

function _saudeOnline() {
  return typeof isSupabaseConnected === 'function' && isSupabaseConnected() && typeof window !== 'undefined' && window._supabaseAuthActive === true;
}

/** Busca dispositivos parados e monitores de backup (leve: só as colunas da conta). */
function carregarSaudeExtra(force) {
  if (!_saudeOnline()) return Promise.resolve(_saudeLer());
  const atual = _saudeLer();
  if (!force && atual.em && Date.now() - atual.em < 10 * 60000) return Promise.resolve(atual);
  if (_saudeCarregando) return _saudeCarregando;
  _saudeCarregando = (async () => {
    const novo = { devices: {}, monitores: atual.monitores || [], em: Date.now() };
    try {
      const { data } = await supabaseClient.from('client_devices')
        .select('client_id, hostname, apelido, is_ativo, data_ultima_atualizacao, updated_at').eq('is_ativo', true).limit(5000);
      (data || []).forEach((d) => {
        const visto = Date.parse(d.data_ultima_atualizacao || '');
        const sync = Date.parse(d.updated_at || '') || Date.now();
        if (isNaN(visto)) return;
        const dias = Math.floor((sync - visto) / 86400000);
        if (dias <= SAUDE_DISP_DIAS) return;
        (novo.devices[d.client_id] = novo.devices[d.client_id] || []).push({ nome: d.apelido || d.hostname || 'Dispositivo', dias });
      });
    } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'cliente-saude'); }
    try {
      const { data, error } = await supabaseClient.from('backup_monitores').select('*').order('nome');
      if (!error) novo.monitores = data || [];
    } catch (_e) { /* banco sem a 060: segue sem backups */ }
    _saudeExtra = novo;
    try { localStorage.setItem(SAUDE_CACHE, JSON.stringify(novo)); } catch (_) { /* sem espaço: só memória */ }
    _saudeCarregando = null;
    return novo;
  })();
  return _saudeCarregando;
}

/** Gancho de getHealthForClient (metrics.js). */
function ajustarSaudeCliente(base, clientId, todayISO) {
  try {
    const x = _saudeLer();
    return calcularSaude({
      base, today: todayISO, agora: Date.now(),
      vencimentos: (typeof getVencimentos === 'function' ? getVencimentos() : []).filter((v) => v.clientId === clientId),
      visitas: (typeof getVisits === 'function' ? getVisits() : []).filter((v) => v.clientId === clientId),
      monitores: (x.monitores || []).filter((m) => m.client_id === clientId),
      dispositivosParados: (x.devices || {})[clientId] || [],
    });
  } catch (_) { return base; }
}

function saudeMotivosHtml(health) {
  if (!health || !Array.isArray(health.motivos) || !health.motivos.length) return '';
  return `<div class="saude-motivos"><b>Nota ${health.nota}/100:</b> ${health.motivos.map(escapeHtml).join(' · ')}</div>`;
}

// ── Aba "Backups" da ficha ──────────────────────────────────────────────────

let _bkClient = null;

function _bkStatusTag(m) {
  const a = backupMonitorAlerta(m);
  if (m.ativo === false) return '<span class="tag">Pausado</span>';
  if (a === 'falha') return '<span class="tag tag-red">Falha</span>';
  if (a === 'silencio') return '<span class="tag tag-red">Sem notícia</span>';
  if (a === 'aviso') return '<span class="tag tag-yellow">Aviso</span>';
  return m.ultimo_status === 'ok' ? '<span class="tag tag-green">OK</span>' : '<span class="tag">Aguardando 1º e-mail</span>';
}

async function renderClientBackupsTab(clientId) {
  const el = document.getElementById('clientTabContent');
  if (!el) return;
  _bkClient = clientId;
  el.innerHTML = '<p style="color:var(--text-muted);font-size:13px">Carregando backups…</p>';
  const x = await carregarSaudeExtra(true);
  if (_bkClient !== clientId || !document.getElementById('clientTabContent')) return;
  const mons = (x.monitores || []).filter((m) => m.client_id === clientId);
  const quando = (iso) => iso ? (typeof formatDateTime === 'function' ? formatDateTime(iso) : new Date(iso).toLocaleString('pt-BR')) : '—';
  el.innerHTML = `
    <p class="feed-lead">O robô lê os e-mails com o rótulo <b>Backups</b> no Gmail dele e acha a rotina pelo <b>identificador</b> (um texto que aparece no remetente ou no assunto, ex.: o nome do job). Falha, ou nenhum e-mail dentro do limite de horas, abre uma pendência sozinha.</p>
    <div style="margin-bottom:12px"><button type="button" class="btn btn-primary btn-sm" data-bk-novo>+ Monitorar um backup</button></div>
    <div id="bkForm"></div>
    ${mons.length ? mons.map((m) => `
      <div class="bk-card">
        <div class="bk-head"><b>${escapeHtml(m.nome)}</b> ${_bkStatusTag(m)}
          <span class="bk-acts"><button type="button" class="btn btn-secondary btn-sm" data-bk-editar="${escapeHtml(m.id)}">Editar</button></span></div>
        <div class="bk-meta">Identificador: <code>${escapeHtml(m.identificador)}</code> · limite ${Number(m.max_horas) || 48} h${m.responsavel ? ' · ' + escapeHtml(m.responsavel) : ''}</div>
        <div class="bk-meta">Último e-mail: ${escapeHtml(quando(m.ultimo_em))}${m.ultimo_assunto ? ' — ' + escapeHtml(m.ultimo_assunto) : ''}</div>
        ${(m.historico || []).length ? `<details><summary class="bk-meta">Histórico (${m.historico.length})</summary><ul class="bk-hist">${m.historico.slice(0, 10).map((h) => `<li>${escapeHtml(quando(h.em))} · ${escapeHtml(h.status)} · ${escapeHtml(h.assunto)}</li>`).join('')}</ul></details>` : ''}
      </div>`).join('') : '<div class="empty-state"><p>Nenhum backup monitorado para este cliente.</p></div>'}`;
}

function _bkForm(m) {
  const box = document.getElementById('bkForm');
  if (!box) return;
  const ops = typeof getOperatorNames === 'function' ? getOperatorNames() : [];
  m = m || { id: '', nome: '', identificador: '', max_horas: 48, responsavel: '', ativo: true };
  box.innerHTML = `
    <form class="bk-card" data-bk-form="${escapeHtml(m.id)}">
      <div class="form-row">
        <div class="form-group"><label class="form-label">Nome *</label><input class="form-input" name="nome" required maxlength="80" value="${escapeHtml(m.nome)}" placeholder="Veeam do servidor" /></div>
        <div class="form-group"><label class="form-label">Identificador no e-mail *</label><input class="form-input" name="identificador" required minlength="3" maxlength="120" value="${escapeHtml(m.identificador)}" placeholder="Job SRV-ACME" /></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Alertar sem e-mail após (horas)</label><input class="form-input" type="number" name="max_horas" min="1" max="2160" value="${Number(m.max_horas) || 48}" /></div>
        <div class="form-group"><label class="form-label">Responsável pela pendência</label><select class="form-select" name="responsavel"><option value="">— ninguém (admins veem) —</option>${ops.map((n) => `<option ${n === m.responsavel ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')}</select></div>
      </div>
      <label style="display:flex;gap:8px;align-items:center;font-size:13px;margin-bottom:10px"><input type="checkbox" name="ativo" ${m.ativo !== false ? 'checked' : ''} /> Monitorando</label>
      <div class="form-actions">
        ${m.id && typeof isCurrentAdmin === 'function' && isCurrentAdmin() ? `<button type="button" class="btn btn-danger btn-sm" data-bk-apagar="${escapeHtml(m.id)}">Apagar</button>` : ''}
        <button type="button" class="btn btn-secondary btn-sm" data-bk-cancelar>Cancelar</button>
        <button type="submit" class="btn btn-primary btn-sm">Salvar</button>
      </div>
    </form>`;
  box.querySelector('[name="nome"]').focus();
}

async function _bkSalvar(form) {
  if (!_saudeOnline()) { showToast('Salvar o monitor precisa de conexão.', 'warning'); return; }
  const c = typeof getClientById === 'function' ? getClientById(_bkClient) : null;
  const fd = new FormData(form);
  const id = form.dataset.bkForm || (typeof nextId === 'function' ? nextId('BKP') : 'BKP-' + Date.now());
  const row = {
    id, client_id: _bkClient, client_name: c ? c.name : '', team: (c && c.team) || 'init',
    nome: String(fd.get('nome') || '').trim(), identificador: String(fd.get('identificador') || '').trim(),
    max_horas: Math.max(1, Math.min(2160, Number(fd.get('max_horas')) || 48)),
    responsavel: String(fd.get('responsavel') || ''), ativo: fd.get('ativo') === 'on', updated_at: new Date().toISOString(),
  };
  if (!row.nome || row.identificador.length < 3) { showToast('Preencha o nome e um identificador com 3+ letras.', 'error'); return; }
  const { error } = await supabaseClient.from('backup_monitores').upsert(row);
  if (error) { showToast('Não foi possível salvar o monitor.', 'error'); return; }
  showToast('Monitor salvo.', 'success');
  renderClientBackupsTab(_bkClient);
}

if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('click', async (e) => {
    const t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    const aba = t.closest('[data-client-tab]');
    if (aba && typeof switchClientTab === 'function') { switchClientTab(aba.dataset.clientTab, aba.dataset.clientId); return; }
    if (t.closest('[data-bk-novo]')) { _bkForm(null); return; }
    if (t.closest('[data-bk-cancelar]')) { const b = document.getElementById('bkForm'); if (b) b.innerHTML = ''; return; }
    const ed = t.closest('[data-bk-editar]');
    if (ed) { _bkForm((_saudeLer().monitores || []).find((m) => m.id === ed.dataset.bkEditar)); return; }
    const del = t.closest('[data-bk-apagar]');
    if (del) {
      if (!window.confirm('Apagar este monitor de backup?')) return;
      const { error } = await supabaseClient.from('backup_monitores').delete().eq('id', del.dataset.bkApagar);
      if (error) showToast('Não foi possível apagar.', 'error'); else renderClientBackupsTab(_bkClient);
    }
  });
  document.addEventListener('submit', (e) => {
    const f = e.target;
    if (f && f.matches && f.matches('[data-bk-form]')) { e.preventDefault(); _bkSalvar(f); }
  });
  // Primeira carga depois do login; a lista de clientes redesenha com a nota completa.
  if (typeof window !== 'undefined') {
    window.addEventListener('load', () => setTimeout(() => {
      carregarSaudeExtra().then(() => {
        if (document.getElementById('clientGrid') && typeof renderClientGrid === 'function') renderClientGrid();
      }).catch(() => {});
    }, 4000));
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { calcularSaude, backupMonitorAlerta };
}
