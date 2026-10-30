// ── SLA e dados do atendimento (056) ──────────────────────────────────────
// Prazo de 1ª resposta e de resolução pela prioridade, em horário comercial;
// canal, categoria e solicitante; relatório de problemas recorrentes.
// Funções puras no topo (testadas em tests/sla.test.js); telas usam os
// helpers de render no fim do arquivo.

// Ajuste aqui os prazos do time. resposta: horas úteis até a 1ª resposta;
// resolucao: dias úteis até o prazo limite sugerido (0 = no mesmo dia).
const SLA_PRIORIDADE = {
  critica: { resposta: 1,  resolucao: 0, label: 'Crítica' },
  alta:    { resposta: 4,  resolucao: 1, label: 'Alta' },
  media:   { resposta: 8,  resolucao: 3, label: 'Média' },
  baixa:   { resposta: 24, resolucao: 7, label: 'Baixa' },
};
// Horário comercial (hora local do aparelho), segunda a sexta.
const SLA_EXPEDIENTE = { inicio: 8, fim: 18 };

const PEN_CANAIS = [
  { value: 'telefone', label: 'Telefone' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'email', label: 'E-mail' },
  { value: 'milvus', label: 'Chamado Milvus' },
  { value: 'presencial', label: 'Presencial' },
  { value: 'proativo', label: 'Proativo (equipe viu antes)' },
];
const PEN_CATEGORIAS = [
  { value: 'rede', label: 'Rede / Internet' },
  { value: 'email', label: 'E-mail' },
  { value: 'impressora', label: 'Impressora' },
  { value: 'hardware', label: 'Computador / Hardware' },
  { value: 'software', label: 'Software / Sistema' },
  { value: 'acesso', label: 'Acesso / Senha' },
  { value: 'backup', label: 'Backup' },
  { value: 'servidor', label: 'Servidor' },
  { value: 'seguranca', label: 'Segurança' },
  { value: 'telefonia', label: 'Telefonia' },
  { value: 'outro', label: 'Outro' },
];

function _slaLabel(list, value) {
  const it = list.find((x) => x.value === value);
  return it ? it.label : '';
}
function penCanalLabel(v) { return _slaLabel(PEN_CANAIS, v); }
function penCategoriaLabel(v) { return _slaLabel(PEN_CATEGORIAS, v); }

function _slaRegra(priority) { return SLA_PRIORIDADE[priority] || SLA_PRIORIDADE.media; }
function _slaDiaUtil(d) { const w = d.getDay(); return w !== 0 && w !== 6; }

// Soma horas úteis a uma data (fora do expediente começa no próximo início).
function slaAddBusinessHours(date, hours) {
  const d = new Date(date.getTime());
  let restante = Math.round(Number(hours || 0) * 60);
  const inicioDoDia = (x) => { x.setHours(SLA_EXPEDIENTE.inicio, 0, 0, 0); };
  const proximoDia = (x) => { x.setDate(x.getDate() + 1); inicioDoDia(x); };
  for (let guard = 0; guard < 400; guard++) {
    if (!_slaDiaUtil(d)) { proximoDia(d); continue; }
    const ini = new Date(d); inicioDoDia(ini);
    const fim = new Date(d); fim.setHours(SLA_EXPEDIENTE.fim, 0, 0, 0);
    if (d < ini) d.setTime(ini.getTime());
    if (d >= fim) { proximoDia(d); continue; }
    const livres = Math.floor((fim - d) / 60000);
    if (restante <= livres) return new Date(d.getTime() + restante * 60000);
    restante -= livres;
    proximoDia(d);
  }
  return d;
}

// Data (YYYY-MM-DD) n dias úteis depois de hoje; 0 = hoje (ou o próximo dia útil).
function slaAddBusinessDays(todayISO, n) {
  const [y, m, dd] = String(todayISO).split('-').map(Number);
  const d = new Date(y, m - 1, dd, 12);
  while (!_slaDiaUtil(d)) d.setDate(d.getDate() + 1);
  let falta = Math.max(0, Number(n) || 0);
  while (falta > 0) { d.setDate(d.getDate() + 1); if (_slaDiaUtil(d)) falta--; }
  const p = (x) => String(x).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function slaPrazoSugerido(priority, todayISO) { return slaAddBusinessDays(todayISO, _slaRegra(priority).resolucao); }
function slaRespostaAte(createdAtIso, priority) {
  return slaAddBusinessHours(new Date(createdAtIso), _slaRegra(priority).resposta).toISOString();
}
function slaResumo(priority) {
  const r = _slaRegra(priority);
  const res = r.resolucao === 0 ? 'no mesmo dia' : r.resolucao + (r.resolucao === 1 ? ' dia útil' : ' dias úteis');
  return '1ª resposta em ' + r.resposta + 'h úteis · prazo ' + res;
}

function _slaAberta(status) { return !['resolvido', 'concluido', 'cancelado', 'fechado'].includes(status || ''); }

/**
 * Ao gravar: define o prazo da 1ª resposta (criação ou troca de prioridade
 * antes de responder) e registra a 1ª resposta na primeira ação da equipe:
 * status saindo de "Aberto", cronômetro iniciado ou nota nova.
 * prev = registro antes (null na criação); cur = registro gravado (alterado aqui).
 */
/**
 * A nota conta como 1ª RESPOSTA? Só a que vai para quem pediu.
 * Anotação interna é conversa da equipe — se contasse, o número de SLA
 * deixaria de significar "o solicitante foi respondido".
 *
 * Nota antiga, sem o campo, NÃO conta: fail-closed. Elas já têm o
 * firstResponseAt gravado de quando foram escritas, então nada é
 * recalculado — este caminho só vale para nota nova.
 */
function slaNotaEhResposta(n) {
  return !!n && n.visibility === 'resposta';
}

function slaOnSave(prev, cur, nowIso, actor) {
  if (!cur) return cur;
  if (!prev) {
    if (!cur.firstResponseDue && cur.createdAt) cur.firstResponseDue = slaRespostaAte(cur.createdAt, cur.priority);
  } else if (!cur.firstResponseAt && cur.firstResponseDue && prev.priority !== cur.priority && cur.createdAt) {
    cur.firstResponseDue = slaRespostaAte(cur.createdAt, cur.priority);
  }
  if (cur.firstResponseAt || !cur.firstResponseDue) return cur;
  const notasAntes = prev && Array.isArray(prev.notes) ? prev.notes.length : 0;
  const notasNovas = (Array.isArray(cur.notes) ? cur.notes : []).slice(notasAntes);
  const respondeu = !prev
    ? (cur.status && cur.status !== 'aberto')
    : ((prev.status || 'aberto') === 'aberto' && cur.status && cur.status !== 'aberto')
      || (cur.timerRunning === true && prev.timerRunning !== true)
      || notasNovas.some(slaNotaEhResposta);
  if (respondeu) {
    cur.firstResponseAt = nowIso;
    if (actor) cur.firstResponseBy = actor;
  }
  return cur;
}

/** Situação da 1ª resposta: respondida | atrasada | vence_logo (≤1h) | no_prazo | sem_sla. */
function slaRespostaEstado(p, nowMs) {
  if (!p || !p.firstResponseDue) return { estado: 'sem_sla' };
  const due = new Date(p.firstResponseDue).getTime();
  if (p.firstResponseAt) {
    const at = new Date(p.firstResponseAt).getTime();
    return { estado: 'respondida', noPrazo: at <= due, minutos: Math.max(0, Math.round((at - new Date(p.createdAt || at).getTime()) / 60000)) };
  }
  if (!_slaAberta(p.status)) return { estado: 'sem_sla' };
  const falta = Math.round((due - nowMs) / 60000);
  if (falta < 0) return { estado: 'atrasada', minutos: -falta };
  return { estado: falta <= 60 ? 'vence_logo' : 'no_prazo', minutos: falta };
}

/**
 * Situação da RESOLUÇÃO: resolvida | estourada | vence_logo (≤1 dia) |
 * no_prazo | sem_sla. Simétrica à de 1ª resposta, mas lendo o que já existe:
 * `deadline` é o prazo (slaPrazoSugerido o preenche pela prioridade, em dias
 * úteis) e `completedAt` é a entrega. Nenhuma coluna nova.
 *
 * O prazo é um DIA, não um instante: vale até o fim dele (23:59), senão
 * resolver às 15h do próprio dia do vencimento contaria como atraso.
 */
function slaResolucaoEstado(p, nowMs) {
  if (!p || !p.deadline) return { estado: 'sem_sla' };
  const due = new Date(String(p.deadline).slice(0, 10) + 'T23:59:59').getTime();
  if (isNaN(due)) return { estado: 'sem_sla' };
  const inicio = new Date(p.createdAt || nowMs).getTime();
  if (!_slaAberta(p.status)) {
    // Sem completedAt (legado ou cancelada) não dá para julgar a entrega.
    if (!p.completedAt) return { estado: 'sem_sla' };
    const at = new Date(p.completedAt).getTime();
    return { estado: 'resolvida', noPrazo: at <= due, minutos: Math.max(0, Math.round((at - inicio) / 60000)) };
  }
  const falta = Math.round((due - nowMs) / 60000);
  if (falta < 0) return { estado: 'estourada', minutos: -falta };
  return { estado: falta <= 1440 ? 'vence_logo' : 'no_prazo', minutos: falta };
}

function slaDuracaoCurta(min) {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h' + (m % 60 ? String(m % 60).padStart(2, '0') : '');
  const d = Math.floor(h / 24);
  return d + (d === 1 ? ' dia' : ' dias');
}

/** Números da 1ª resposta: abertas aguardando, atrasadas e % no prazo (últimos `dias`). */
function buildRespostaKpis(pens, nowMs, dias) {
  const desde = nowMs - (dias || 30) * 86400000;
  let aguardando = 0, atrasadas = 0, respondidas = 0, noPrazo = 0;
  const tempos = [];
  for (const p of pens || []) {
    const st = slaRespostaEstado(p, nowMs);
    if (st.estado === 'atrasada') { atrasadas++; aguardando++; }
    else if (st.estado === 'vence_logo' || st.estado === 'no_prazo') aguardando++;
    else if (st.estado === 'respondida' && new Date(p.firstResponseAt).getTime() >= desde) {
      respondidas++;
      if (st.noPrazo) noPrazo++;
      tempos.push(st.minutos);
    }
  }
  tempos.sort((a, b) => a - b);
  const mediana = tempos.length ? tempos[Math.floor((tempos.length - 1) / 2)] : null;
  return { aguardando, atrasadas, respondidas, pctNoPrazo: respondidas ? Math.round((noPrazo / respondidas) * 100) : null, medianaMin: mediana };
}

/**
 * Problemas recorrentes nos últimos `dias` (pela data de criação):
 * - porCategoria: total por categoria (sem categoria à parte);
 * - recorrentes: cliente × categoria com `minimo`+ ocorrências (o que vale atacar na causa);
 * - porCanal e solicitantes mais frequentes.
 */
function buildRecorrentesModel(pens, todayISO, opts) {
  const o = Object.assign({ dias: 90, minimo: 3 }, opts || {});
  const [y, m, d] = String(todayISO).split('-').map(Number);
  const desde = new Date(y, m - 1, d - o.dias).getTime();
  const lista = (pens || []).filter((p) => p && p.createdAt && new Date(p.createdAt).getTime() >= desde && p.status !== 'cancelado');
  const conta = (map, k) => map.set(k, (map.get(k) || 0) + 1);
  const cat = new Map(), canal = new Map(), sol = new Map(), grupos = new Map();
  let semCategoria = 0;
  for (const p of lista) {
    if (p.categoria) conta(cat, p.categoria); else semCategoria++;
    if (p.canal) conta(canal, p.canal);
    if (p.solicitante && p.solicitante.trim()) {
      const nome = p.solicitante.trim();
      const k = (p.clientId || '') + '|' + nome.toLowerCase();
      const g = sol.get(k) || { nome, clientId: p.clientId || '', clientName: p.clientName || '', total: 0 };
      g.total++;
      sol.set(k, g);
    }
    if (p.categoria && p.clientId) {
      const k = p.clientId + '|' + p.categoria;
      const g = grupos.get(k) || { clientId: p.clientId, clientName: p.clientName || '', categoria: p.categoria, total: 0, abertas: 0, ultima: '', itens: [] };
      g.total++;
      if (_slaAberta(p.status)) g.abertas++;
      if (p.createdAt > g.ultima) g.ultima = p.createdAt;
      g.itens.push({ id: p.id, assunto: p.assunto || p.descricao || '', createdAt: p.createdAt });
      grupos.set(k, g);
    }
  }
  const ordena = (map) => [...map.entries()].map(([value, total]) => ({ value, total })).sort((a, b) => b.total - a.total || a.value.localeCompare(b.value));
  const recorrentes = [...grupos.values()].filter((g) => g.total >= o.minimo)
    .map((g) => ({ ...g, itens: g.itens.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5) }))
    .sort((a, b) => b.total - a.total || b.ultima.localeCompare(a.ultima));
  return {
    total: lista.length, semCategoria, dias: o.dias, minimo: o.minimo,
    porCategoria: ordena(cat), porCanal: ordena(canal), recorrentes,
    solicitantes: [...sol.values()].filter((s) => s.total >= 2).sort((a, b) => b.total - a.total).slice(0, 10),
  };
}

/** Solicitantes já usados com este cliente (para sugerir no formulário). */
function solicitantesDoCliente(pens, clientId) {
  if (!clientId) return [];
  const vistos = new Map();
  for (const p of pens || []) {
    if (p.clientId !== clientId || !p.solicitante || !p.solicitante.trim()) continue;
    const nome = p.solicitante.trim();
    const k = nome.toLowerCase();
    if (!vistos.has(k) || (p.createdAt || '') > vistos.get(k).em) vistos.set(k, { nome, em: p.createdAt || '' });
  }
  return [...vistos.values()].sort((a, b) => b.em.localeCompare(a.em)).map((x) => x.nome).slice(0, 15);
}

// ── Helpers de tela ───────────────────────────────────────────────────────
function _slaEsc(s) { return typeof escapeHtml === 'function' ? escapeHtml(s) : String(s == null ? '' : s); }

function penCanalOptionsHtml(sel) {
  return '<option value="">Não informado</option>' + PEN_CANAIS.map((c) =>
    '<option value="' + c.value + '"' + (sel === c.value ? ' selected' : '') + '>' + _slaEsc(c.label) + '</option>').join('');
}
function penCategoriaOptionsHtml(sel) {
  return '<option value="">Não informada</option>' + PEN_CATEGORIAS.map((c) =>
    '<option value="' + c.value + '"' + (sel === c.value ? ' selected' : '') + '>' + _slaEsc(c.label) + '</option>').join('');
}
function penSolicitanteDatalistHtml(id, clientId) {
  const nomes = typeof getPendencias === 'function' ? solicitantesDoCliente(getPendencias(), clientId) : [];
  return '<datalist id="' + id + '">' + nomes.map((n) => '<option value="' + _slaEsc(n) + '"></option>').join('') + '</datalist>';
}

/** Selo do card/detalhe para a 1ª resposta (vazio quando não há o que avisar). */
function penRespostaBadge(p, nowMs, opts) {
  const st = slaRespostaEstado(p, nowMs == null ? Date.now() : nowMs);
  const full = opts && opts.full;
  if (st.estado === 'atrasada') return '<span class="sla-badge is-late" title="Prazo da 1ª resposta passou">Sem resposta · ' + slaDuracaoCurta(st.minutos) + ' atrasada</span>';
  if (st.estado === 'vence_logo') return '<span class="sla-badge is-soon" title="Prazo da 1ª resposta">Responder em ' + slaDuracaoCurta(st.minutos) + '</span>';
  if (!full) return '';
  if (st.estado === 'no_prazo') return '<span class="sla-badge">Responder em ' + slaDuracaoCurta(st.minutos) + '</span>';
  if (st.estado === 'respondida') {
    return '<span class="sla-badge ' + (st.noPrazo ? 'is-ok' : 'is-late') + '">Respondida em ' + slaDuracaoCurta(st.minutos) +
      (p.firstResponseBy ? ' por ' + _slaEsc(p.firstResponseBy) : '') + (st.noPrazo ? '' : ' (fora do prazo)') + '</span>';
  }
  return '<span class="sla-muted">Sem SLA de resposta (pendência antiga)</span>';
}

/**
 * Selo da resolução, par do penRespostaBadge. Sem `full`, só fala quando
 * exige ação (estourada ou vencendo) — no quadro o silêncio é informação.
 */
function penResolucaoBadge(p, nowMs, opts) {
  const st = slaResolucaoEstado(p, nowMs == null ? Date.now() : nowMs);
  const full = opts && opts.full;
  if (st.estado === 'estourada') return '<span class="sla-badge is-late" title="Prazo de resolução passou">Vencida · ' + slaDuracaoCurta(st.minutos) + ' atrasada</span>';
  if (st.estado === 'vence_logo') return '<span class="sla-badge is-soon" title="Prazo de resolução">Resolver em ' + slaDuracaoCurta(st.minutos) + '</span>';
  if (!full) return '';
  if (st.estado === 'no_prazo') return '<span class="sla-badge">Resolver em ' + slaDuracaoCurta(st.minutos) + '</span>';
  if (st.estado === 'resolvida') {
    return '<span class="sla-badge ' + (st.noPrazo ? 'is-ok' : 'is-late') + '">Resolvida em ' + slaDuracaoCurta(st.minutos) +
      (st.noPrazo ? '' : ' (fora do prazo)') + '</span>';
  }
  return '<span class="sla-muted">Sem prazo de resolução</span>';
}

/** Sugestões de solicitante acompanham o cliente escolhido no formulário. */
function slaBindSolicitante(form, listId) {
  if (!form || !form.clientId) return;
  form.clientId.addEventListener('change', () => {
    const dl = document.getElementById(listId);
    if (!dl) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = penSolicitanteDatalistHtml(listId, form.clientId.value);
    dl.innerHTML = tmp.firstChild ? tmp.firstChild.innerHTML : '';
  });
}

/**
 * Prazo sugerido no formulário: preenche o campo de prazo pela prioridade
 * enquanto a pessoa não escolher uma data à mão (data-sla-auto="1").
 */
function slaBindPrazoAuto(form) {
  if (!form || !form.priority || !form.deadline) return;
  const hint = form.querySelector('[data-sla-hint]');
  const today = typeof localDateISO === 'function' ? localDateISO() : new Date().toISOString().slice(0, 10);
  const aplica = () => {
    if (hint) hint.textContent = slaResumo(form.priority.value);
    if (form.deadline.dataset.slaAuto === '1') form.deadline.value = slaPrazoSugerido(form.priority.value, today);
  };
  form.priority.addEventListener('change', aplica);
  form.deadline.addEventListener('input', () => { form.deadline.dataset.slaAuto = '0'; });
  aplica();
}

/**
 * Minutos de expediente entre dois instantes (seg–sex, SLA_EXPEDIENTE).
 * "De quem foi o tempo" mede em horas úteis pelo mesmo motivo do SLA: noite e
 * fim de semana não são culpa de ninguém.
 */
function slaMinutosUteis(inicioMs, fimMs) {
  if (!(fimMs > inicioMs)) return 0;
  let total = 0;
  const d = new Date(inicioMs); d.setHours(0, 0, 0, 0);
  while (d.getTime() < fimMs) {
    if (_slaDiaUtil(d)) {
      const ini = new Date(d).setHours(SLA_EXPEDIENTE.inicio, 0, 0, 0);
      const fim = new Date(d).setHours(SLA_EXPEDIENTE.fim, 0, 0, 0);
      const a = Math.max(ini, inicioMs), b = Math.min(fim, fimMs);
      if (b > a) total += (b - a) / 60000;
    }
    d.setDate(d.getDate() + 1);
  }
  return Math.round(total);
}

/**
 * Divide o tempo do chamado entre a equipe e quem pediu. Só "aguardando_cliente"
 * conta para o solicitante; qualquer outro status aberto é tempo da equipe.
 * O status inicial vem do "de" do primeiro evento — se os eventos antigos foram
 * podados por PEN_MAX_EVENTS, o trecho antes deles fica com o status que o
 * evento mais antigo diz ter deixado, que é o melhor palpite que sobra.
 */
function slaTempoPorLado(p, nowMs) {
  const res = { equipe: 0, solicitante: 0 };
  const inicio = Date.parse(p && p.createdAt);
  if (!Number.isFinite(inicio)) return res;
  const evs = (Array.isArray(p.events) ? p.events : [])
    .filter(e => e && e.type === 'status')
    .map(e => ({ t: Date.parse(e.at || e.createdAt), de: e.de, para: e.para }))
    .filter(e => Number.isFinite(e.t))
    .sort((a, b) => a.t - b.t);
  const fimFechado = Date.parse(p.completedAt);
  const fim = !_slaAberta(p.status) && Number.isFinite(fimFechado) ? fimFechado : (nowMs ?? Date.now());
  // Fechado sem eventos: o tempo até completedAt foi de trabalho, logo da equipe.
  let status = evs.length ? evs[0].de : (_slaAberta(p.status) ? p.status : 'aberto');
  let desde = inicio;
  const soma = (ate) => {
    if (!_slaAberta(status)) return;
    const min = slaMinutosUteis(desde, Math.min(ate, fim));
    if (status === 'aguardando_cliente') res.solicitante += min; else res.equipe += min;
  };
  for (const e of evs) {
    if (e.t >= fim) break;
    if (e.t > desde) { soma(e.t); desde = e.t; }
    status = e.para;
  }
  soma(fim);
  return res;
}

/** Linha "Tempo" do detalhe: equipe em destaque, solicitante ao lado. */
function penTempoPorLadoHtml(p, nowMs) {
  const t = slaTempoPorLado(p, nowMs);
  if (!t.equipe && !t.solicitante) return '<span class="sla-muted">—</span>';
  return `<span class="sla-badge" title="Horas úteis com a equipe">Com a equipe ${slaDuracaoCurta(t.equipe)}</span> `
    + `<span class="sla-muted" title="Horas úteis aguardando o solicitante">Com quem pediu ${slaDuracaoCurta(t.solicitante)}</span>`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SLA_PRIORIDADE, SLA_EXPEDIENTE, PEN_CANAIS, PEN_CATEGORIAS, penCanalLabel, penCategoriaLabel,
    slaAddBusinessHours, slaAddBusinessDays, slaPrazoSugerido, slaRespostaAte, slaResumo, slaOnSave,
    slaRespostaEstado, slaDuracaoCurta, buildRespostaKpis, buildRecorrentesModel, solicitantesDoCliente, penRespostaBadge,
    slaResolucaoEstado, penResolucaoBadge, slaNotaEhResposta,
    slaMinutosUteis, slaTempoPorLado, penTempoPorLadoHtml,
  };
}
