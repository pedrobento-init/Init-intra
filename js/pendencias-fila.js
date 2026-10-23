// pendencias-fila.js – Visualização em tabela ("Fila de atendimento").
// Parte de pendencias.js (dividido para facilitar manutenção). Scripts
// clássicos: carrega depois de pendencias-quadro.js e compartilha os globais.
//
// POR QUE EXISTE: o quadro é a visão de quem TRABALHA o dia — arrasta card,
// muda status. A fila é a de quem OLHA o conjunto: o que está vencendo, de
// quem é, com quem está. São perguntas diferentes, por isso duas telas e não
// uma com filtro.
//
// Tudo por delegação (data-action/data-sort), nenhum handler inline: a
// catraca de CSP (tests/no-inline-handlers.test.js) só pode diminuir.

// Ordenação da fila. Diferente do quadro, aqui é uma coluna só para a tabela
// inteira — e fica no aparelho, como a escolha de visualização.
const PEN_FILA_SORT_KEY = 'intra_pen_fila_sort';
let _penFilaSort = (function () {
  try {
    const raw = JSON.parse(localStorage.getItem(PEN_FILA_SORT_KEY) || 'null');
    if (raw && typeof raw.col === 'string') return { col: raw.col, dir: raw.dir === 'desc' ? 'desc' : 'asc' };
  } catch (_) {}
  return { col: 'prazo', dir: 'asc' }; // o que vence primeiro, primeiro
})();

// coluna → { label, classe, valor(p) para ordenar }.
// `valor` devolve string ou número; null/'' vão para o fim em ordem crescente.
const PEN_FILA_COLS = [
  { id: 'numero', label: 'Protocolo', cls: 'pf-num', valor: (p) => Number(p.numero) || 0 },
  { id: 'data', label: 'Aberta', cls: 'pf-data', valor: (p) => String(p.createdAt || '') },
  { id: 'titulo', label: 'Título', cls: 'pf-titulo', valor: (p) => String(getPendenciaTitulo(p) || '').toLowerCase() },
  { id: 'cliente', label: 'Cliente', cls: 'pf-cliente', valor: (p) => String(p.clientName || '').toLowerCase() },
  { id: 'solicitante', label: 'Quem pediu', cls: 'pf-solic', valor: (p) => String(p.solicitante || '').toLowerCase() },
  { id: 'responsavel', label: 'Com', cls: 'pf-resp', valor: (p) => String(p.responsible || '').toLowerCase() },
  { id: 'status', label: 'Status', cls: 'pf-status', valor: (p) => String(p.status || '') },
  { id: 'prioridade', label: 'Prioridade', cls: 'pf-pri', valor: (p) => _PEN_PRIORITY_WEIGHT[p.priority] || 0 },
  { id: 'prazo', label: 'Prazo', cls: 'pf-prazo', valor: (p) => String(p.deadline || '') },
];

function _penFilaCol(id) { return PEN_FILA_COLS.find((c) => c.id === id) || PEN_FILA_COLS[0]; }

/** Ordena a página atual. Vazio sempre por último, independente da direção. */
function _penFilaOrdena(linhas) {
  const col = _penFilaCol(_penFilaSort.col);
  const dir = _penFilaSort.dir === 'desc' ? -1 : 1;
  return linhas.slice().sort(function (a, b) {
    const va = col.valor(a);
    const vb = col.valor(b);
    const vazioA = va === '' || va === null || va === undefined;
    const vazioB = vb === '' || vb === null || vb === undefined;
    if (vazioA && vazioB) return 0;
    if (vazioA) return 1;   // sem valor vai para o fim
    if (vazioB) return -1;
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
    return String(va).localeCompare(String(vb)) * dir;
  });
}

function penFilaSort(colId) {
  const atual = _penFilaSort;
  _penFilaSort = (atual.col === colId)
    ? { col: colId, dir: atual.dir === 'asc' ? 'desc' : 'asc' }
    : { col: colId, dir: 'asc' };
  try { localStorage.setItem(PEN_FILA_SORT_KEY, JSON.stringify(_penFilaSort)); } catch (_) {}
  const area = document.getElementById('penViewArea');
  if (area) renderPenFila(area);
}

function _penFilaSeta(colId) {
  if (_penFilaSort.col !== colId) return '<span class="pf-seta" aria-hidden="true">↕</span>';
  return '<span class="pf-seta is-on" aria-hidden="true">' + (_penFilaSort.dir === 'asc' ? '↑' : '↓') + '</span>';
}

/** Célula de prazo: data + os dois selos de SLA, que já existem. */
function _penFilaPrazo(p) {
  const agora = Date.now();
  const venc = p.deadline ? formatDate(parseDeadline(p.deadline)) : '—';
  const atrasada = typeof penIsOverdue === 'function' ? penIsOverdue(p) : false;
  let selos = '';
  if (typeof penResolucaoBadge === 'function') selos += penResolucaoBadge(p, agora);
  if (typeof penRespostaBadge === 'function') selos += penRespostaBadge(p, agora);
  return '<span class="pf-prazo-data' + (atrasada ? ' is-late' : '') + '">' + escapeHtml(venc) + '</span>'
    + (selos ? '<span class="pf-selos">' + selos + '</span>' : '');
}

function _penFilaLinha(p) {
  const titulo = getPendenciaTitulo(p);
  const num = typeof penDisplayNumber === 'function' ? penDisplayNumber(p) : (p.numero || '');
  const st = (typeof STATUS_PEN_MAP !== 'undefined' && STATUS_PEN_MAP[p.status]) || null;
  return '<tr class="pf-row" tabindex="0" role="button" data-action="openPen" data-arg="' + escapeHtml(p.id) + '"'
    + ' aria-label="' + escapeHtml(num + ' — ' + titulo) + '">'
    + '<td class="pf-num"><span class="pen-display-num">' + escapeHtml(String(num)) + '</span></td>'
    + '<td class="pf-data">' + escapeHtml(p.createdAt ? formatDate(new Date(p.createdAt)) : '—') + '</td>'
    + '<td class="pf-titulo" title="' + escapeHtml(titulo) + '">' + escapeHtml(titulo) + '</td>'
    + '<td class="pf-cliente">' + escapeHtml(p.clientName || '—') + '</td>'
    + '<td class="pf-solic">' + escapeHtml(p.solicitante || '—') + '</td>'
    + '<td class="pf-resp">' + escapeHtml(p.responsible || '—') + '</td>'
    + '<td class="pf-status"><span class="pf-chip" style="--c:' + (st ? st.dot : 'var(--text-muted)') + '">'
      + escapeHtml(st ? st.label : p.status || '—') + '</span></td>'
    + '<td class="pf-pri">' + (typeof priorityTag === 'function' ? priorityTag(p.priority) : escapeHtml(p.priority || '')) + '</td>'
    + '<td class="pf-prazo">' + _penFilaPrazo(p) + '</td>'
    + '</tr>';
}

function renderPenFila(area) {
  const pens = Array.isArray(_filteredPens) ? _filteredPens : [];
  // Concluído/Fechado continuam fora da VISUALIZAÇÃO, igual ao quadro.
  const visiveis = pens.filter(function (p) { return penColVisible(p.status); });
  const linhas = _penFilaOrdena(visiveis);

  const cabecalho = PEN_FILA_COLS.map(function (c) {
    const on = _penFilaSort.col === c.id;
    return '<th class="' + c.cls + (on ? ' is-sorted' : '') + '" aria-sort="'
      + (on ? (_penFilaSort.dir === 'asc' ? 'ascending' : 'descending') : 'none') + '">'
      + '<button type="button" class="pf-th" data-action="penFilaSort" data-arg="' + c.id + '">'
      + escapeHtml(c.label) + _penFilaSeta(c.id) + '</button></th>';
  }).join('');

  const corpo = linhas.length
    ? linhas.map(_penFilaLinha).join('')
    : '<tr><td class="pf-vazio" colspan="' + PEN_FILA_COLS.length + '">Nenhuma pendência com os filtros atuais.</td></tr>';

  const resumo = _penServerMode ? _penServerSummary() : penStatusSummary(pens);

  area.innerHTML = resumo
    + '<div class="pf-wrap">'
    + '<table class="pf-table"><caption class="sr-only">Fila de atendimento: '
    + linhas.length + ' pendência' + (linhas.length === 1 ? '' : 's') + '</caption>'
    + '<thead><tr>' + cabecalho + '</tr></thead>'
    + '<tbody>' + corpo + '</tbody></table></div>'
    + (typeof _penPagerBar === 'function' ? _penPagerBar() : '');
}

// Abrir pelo teclado: a linha é role="button", então Enter/Espaço precisam
// funcionar como o clique (o actions.js já cobre data-action no keydown).
if (typeof registerActions === 'function') {
  registerActions({
    penSetView: (_el, v) => penSetView(v),
    penFilaSort: (_el, col) => penFilaSort(col),
    openPen: (_el, id) => { if (typeof openPendenciaDetail === 'function') openPendenciaDetail(id); },
  });
}

// Despacho da visualização atual — chamado por renderPenView e pelos patches
// otimistas do quadro.
function _penRenderAtual(area) {
  if (typeof penView !== 'undefined' && penView === 'fila') return renderPenFila(area);
  return renderPenKanban(area);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PEN_FILA_COLS, _penFilaOrdena, _penFilaCol };
}
